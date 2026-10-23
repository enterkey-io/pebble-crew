"""Owner-local strategic outcomes linked to native work, never a second task store."""
from copy import deepcopy
from types import SimpleNamespace
import json

from .operations import InvalidOperation, fields
from .work_store import operation_id

PLAN_OPERATIONS = {'work.plans', 'work.plan.save', 'work.board.outcome.save'}
STATUSES = {'active', 'paused', 'completed', 'archived'}


def text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise InvalidOperation('Enter valid Plan text')
    return value.strip() if required else value


def ids(value, maximum=100):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(i, str) or not i or len(i) > 128 for i in value) or len(set(value)) != len(value):
        raise InvalidOperation('Choose unique current references')
    return value


def board_key(ref):
    fields(ref, ['catalog_id', 'project_id', 'slug'])
    if not all(isinstance(v, str) and 0 < len(v) <= 128 for v in ref.values()):
        raise InvalidOperation('Choose a linked project board')
    return ref['catalog_id'], ref['project_id'], ref['slug']


class Plans:
    def __init__(self, workspace, ledger, catalog):
        self.workspace, self.ledger, self.catalog = workspace, ledger, catalog
        self.ledger.db.execute('CREATE TABLE IF NOT EXISTS plans_state(workspace TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)')
        self.ledger.db.commit()

    def read(self, state):
        row = self.ledger.db.execute('SELECT revision,payload FROM plans_state WHERE workspace=?', (state['id'],)).fetchone()
        return {'revision': row[0], **json.loads(row[1])} if row else {'revision': 0, 'plans': [], 'board_outcomes': []}

    def references(self):
        try:
            identity, catalog = self.catalog()
            return [{**{'catalog_id': identity, 'project_id': b['project_id'], 'slug': b['slug']}, 'name': b['name']} for b in catalog['boards'] if b['mapping'] == 'linked'], True
        except Exception:
            return [], False

    def snapshot(self, state):
        data = self.read(state)
        boards, available = self.references()
        live = {board_key({k: b[k] for k in ('catalog_id', 'project_id', 'slug')}) for b in boards}
        return {'workspace_id': state['id'], **data, 'boards': boards, 'catalog_available': available,
                'unavailable_boards': [ref for p in data['plans'] for ref in p['boards'] if board_key(ref) not in live]}

    def invoke(self, operation, params, actor):
        state = self.workspace.read()
        if params.get('workspace_id') != state['id']:
            raise InvalidOperation('Choose this workspace')
        if operation == 'work.plans':
            fields(params, ['workspace_id'])
            return self.snapshot(state)
        fields(params, ['workspace_id', 'operation_id', 'expected_revision', 'plan' if operation == 'work.plan.save' else 'outcome'])
        operation_id(params['operation_id'])
        # Hold the identity owner's writer boundary through the local graph commit.
        with self.workspace.db:
            self.workspace.db.execute('BEGIN IMMEDIATE')
            state = self.workspace.read()
            main = state['bots'].get(state.get('orchestrator'))
            if actor != 'owner' and (not main or actor != main['id'] or not main.get('enrolled') or not main.get('available', True)):
                raise InvalidOperation('Only the current Main Pebble can manage Plans for the owner')
            receipt = self.ledger.reserve(params['operation_id'], actor, operation, params)
            if receipt['state'] == 'completed':
                return receipt
            current = self.read(state)
            if type(params['expected_revision']) is not int or params['expected_revision'] != current['revision']:
                raise InvalidOperation('Plans changed. Review the latest version before saving.', 'STALE_REVISION')
            boards, available = self.references()
            live_boards = {board_key({k: b[k] for k in ('catalog_id', 'project_id', 'slug')}) for b in boards}
            from .organization import read
            crews = {c['id'] for c in read(SimpleNamespace(store=self.workspace), state)['crews']}
            live_bots = {b['id'] for b in state['bots'].values() if b.get('enrolled') and b.get('available', True) and not b.get('deleted')}
            updated = deepcopy(current)
            if operation == 'work.plan.save':
                plan = deepcopy(params['plan'])
                fields(plan, ['id', 'title', 'outcome', 'body', 'status', 'owner_id', 'parent_id', 'crew_ids', 'boards'])
                if plan['id'] is None:
                    plan['id'] = params['operation_id']
                operation_id(plan['id'])
                if not isinstance(plan['status'], str) or plan['status'] not in STATUSES or (plan['owner_id'] is not None and (not isinstance(plan['owner_id'], str) or plan['owner_id'] not in live_bots)):
                    raise InvalidOperation('Choose a current Plan owner and status')
                plan['title'] = text(plan['title'], 120, True)
                plan['outcome'] = text(plan['outcome'], 2000, True)
                plan['body'] = text(plan['body'], 12000)
                if not set(ids(plan['crew_ids'])) <= crews:
                    raise InvalidOperation('Choose current Crews')
                if not isinstance(plan['boards'], list) or len(plan['boards']) > 100:
                    raise InvalidOperation('Choose linked project boards')
                keys = [board_key(ref) for ref in plan['boards']]
                if len(keys) != len(set(keys)) or not set(keys) <= live_boards:
                    raise InvalidOperation('A project board link changed. Review its current identity.', 'STALE_REVISION')
                by_id = {p['id']: p for p in current['plans']}
                if plan['parent_id'] is not None and (not isinstance(plan['parent_id'], str) or plan['parent_id'] not in by_id):
                    raise InvalidOperation('Choose an existing parent Plan')
                by_id[plan['id']] = plan
                if len(by_id) > 100:
                    raise InvalidOperation('Keep at most 100 Plans')
                seen, parent = {plan['id']}, plan['parent_id']
                while parent is not None:
                    if parent in seen:
                        raise InvalidOperation('Plan parents cannot form a cycle')
                    seen.add(parent)
                    parent = by_id[parent]['parent_id']
                updated['plans'] = list(by_id.values())
                evidence = {'plan_id': plan['id']}
            else:
                outcome = deepcopy(params['outcome'])
                fields(outcome, ['board', 'outcome', 'crew_ids'])
                key = board_key(outcome['board'])
                if key not in live_boards or not available or not set(ids(outcome['crew_ids'])) <= crews:
                    raise InvalidOperation('Choose a current linked board and Crews', 'STALE_REVISION')
                outcome['outcome'] = text(outcome['outcome'], 2000, True)
                updated['board_outcomes'] = [v for v in current['board_outcomes'] if board_key(v['board']) != key] + [outcome]
                evidence = {'board': outcome['board']['slug']}
            updated['revision'] += 1
            with self.ledger.db:
                self.ledger.db.execute('INSERT INTO plans_state VALUES(?,?,?) ON CONFLICT(workspace) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
                    (state['id'], updated['revision'], json.dumps({k: updated[k] for k in ('plans', 'board_outcomes')})))
                self.ledger.db.execute("UPDATE intents SET state='completed',evidence=? WHERE id=?", (json.dumps({'kind': 'plan', 'revision': updated['revision'], **evidence}), params['operation_id']))
            return self.ledger.receipt(params['operation_id'], actor)


def saved_plans(workspace, state):
    """Read existing metadata without creating stores or depending on native catalog health."""
    path = workspace.path.with_name('work.sqlite')
    if not path.is_file():
        return {'revision': 0, 'plans': [], 'board_outcomes': []}
    import sqlite3
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='plans_state'").fetchone():
            return {'revision': 0, 'plans': [], 'board_outcomes': []}
        row = db.execute('SELECT revision,payload FROM plans_state WHERE workspace=?', (state['id'],)).fetchone()
    return {'revision': row[0], **json.loads(row[1])} if row else {'revision': 0, 'plans': [], 'board_outcomes': []}


def runtime_snapshot(workspace, params):
    """Read strategic metadata in a verified private/worker scope without broadening native work access."""
    fields(params, ['workspace_id', 'plan_id'] if 'plan_id' in params else ['workspace_id'])
    state = workspace.read()
    if params['workspace_id'] != state['id']:
        raise InvalidOperation('Choose this workspace')
    data = saved_plans(workspace, state)
    if 'plan_id' in params:
        ident = operation_id(params['plan_id'])
        data['plans'] = [p for p in data['plans'] if p['id'] == ident]
    return {'workspace_id': state['id'], **data, 'boards': [], 'catalog_available': False,
        'unavailable_boards': [ref for p in data['plans'] for ref in p['boards']]}
