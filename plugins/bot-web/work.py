"""Explicitly scoped native projects and tasks, with owner-local retry receipts."""
import json
import os
import re
from pathlib import Path

from .operations import InvalidOperation, fields, identifier
from .work_native import NativeWork, task_revision
from .work_store import WorkStore, fingerprint, operation_id


OPERATIONS = {'work.describe', 'work.board', 'work.task', 'work.receipt',
    'work.project.create', 'work.project.update', 'work.task.create', 'work.task.update', 'work.task.comment', 'work.task.move'}


def text(value, limit, blank=True):
    if not isinstance(value, str) or len(value) > limit or (not blank and not value.strip()):
        raise InvalidOperation('Enter valid task or project text')
    return value if blank else value.strip()


def task_view(task):
    return {**{key: task.get(key) for key in ('id', 'title', 'body', 'status', 'assignee', 'priority', 'project_id', 'result')},
        'revision': task_revision(task)}


class WorkService:
    def __init__(self, workspace, path, native_factory=NativeWork):
        self.workspace = workspace
        self.store = WorkStore(path)
        self.native_factory = native_factory

    def close(self):
        self.store.close()

    def invoke(self, operation, params, actor='owner'):
        if operation not in OPERATIONS or not isinstance(params, dict):
            raise InvalidOperation('Work operation unavailable')
        with self.store.locked():
            state = self.workspace.read()
            if not state.get('initialized'):
                raise InvalidOperation('Complete Pebble Crew setup first', 'REQUIRES_SETUP')
            if operation == 'work.describe':
                fields(params, [])
            elif params.get('workspace_id') != state['id']:
                raise InvalidOperation('This project belongs to a different workspace')
            bot = self.store.catalog(state)
            # A stable identity survives a Main Pebble transfer or native rename,
            # while a removed/recreated profile must never inherit the catalog.
            from hermes_cli.profiles import get_profile_dir
            from .search_native import identity
            if identity(Path(get_profile_dir(bot['profile']))) != bot.get('native_incarnation'):
                raise InvalidOperation('The project catalog profile identity changed', 'REQUIRES_SETUP')
            native = self.native_factory(bot['profile'])
            with native.scoped():
                catalog = self.describe(state, native)
                if operation == 'work.describe':
                    return catalog
                if operation == 'work.receipt':
                    fields(params, ['workspace_id', 'operation_id'])
                    return self.store.receipt(params['operation_id'], actor)
                if operation == 'work.project.create':
                    return self.create_project(native, state, params, actor)
                board = next((b for b in catalog['boards'] if b['slug'] == params.get('board')), None)
                if operation == 'work.project.update':
                    if not any(b['project_id'] == params.get('project_id') and b['mapping'] == 'linked' for b in catalog['boards']):
                        raise InvalidOperation('Choose a project with a confirmed board link', 'REQUIRES_SETUP')
                    return self.update_project(native, state, params, actor)
                if board is None:
                    raise InvalidOperation('Choose an existing project board')
                if operation == 'work.board':
                    fields(params, ['workspace_id', 'board'])
                    view = native.board(board['slug'])
                    return {'workspace_id': state['id'], 'board': board,
                        'columns': [{'status': c['name'], 'tasks': [task_view(t) for t in self.store.ordered_tasks(board['slug'], c['name'], c['tasks'])]} for c in view['columns']]}
                if operation == 'work.task':
                    fields(params, ['workspace_id', 'board', 'id'])
                    return self.task(native, state, board, params['id'])
                if board['mapping'] not in ('general', 'linked'):
                    raise InvalidOperation('This board’s project links need repair in Hermes before changes can be saved', 'REQUIRES_SETUP')
                return self.mutate_task(native, state, board, operation, params, actor)

    def describe(self, state, native):
        projects = native.list_projects()
        boards = native.list_boards()
        items = []
        for board in boards:
            slug, pid = board['slug'], board.get('project_id')
            project = next((p for p in projects if p['id'] == pid), None)
            linked = bool(project and project.get('board_slug') == slug
                and sum(b.get('project_id') == pid for b in boards) == 1
                and sum(p.get('board_slug') == slug for p in projects) == 1)
            mapping = ('conflict' if pid else 'general') if slug == 'default' else (
                'linked' if linked else 'conflict' if pid else 'unlinked')
            items.append({'slug': slug, 'project_id': pid or None,
                'name': 'General tasks' if slug == 'default' else project['name'] if linked else board.get('name') or slug,
                'description': (project.get('description') if linked else board.get('description')) or '',
                'mapping': mapping, 'count': int(board.get('total', 0)),
                'revision': fingerprint(project if linked else {k: board.get(k) for k in ('slug', 'name', 'description', 'project_id')})})
        return {'workspace_id': state['id'], 'capabilities': {'edit_details': native.edit_details},
            'boards': items, 'unlinked_projects': [
                {'id': p['id'], 'name': p['name']} for p in projects
                if not any(b['project_id'] == p['id'] and b['mapping'] == 'linked' for b in items)]}

    def create_project(self, native, state, params, actor):
        fields(params, ['workspace_id', 'operation_id', 'name', 'description'])
        name, description = text(params['name'], 120, False), text(params['description'], 12000)
        intent = self.store.reserve(params['operation_id'], actor, 'work.project.create', params)
        if intent['state'] == 'completed':
            return intent
        slug = 'pebble-' + operation_id(params['operation_id']).replace('-', '')
        project = native.project(slug)
        if project and (project['name'] != name or (project.get('description') or '') != description):
            raise InvalidOperation('The partially created project changed in Hermes. Review it before retrying.', 'STALE_REVISION')
        if project is None:
            project = native.create_project(slug, name, description)
        if project.get('board_slug') not in (None, '', slug):
            raise InvalidOperation('This project was linked to another board', 'STALE_REVISION')
        self.store.save(intent['id'], 'project_created', {'project_id': project['id'], 'board': slug})
        existing = next((b for b in native.list_boards() if b['slug'] == slug), None)
        if existing and existing.get('project_id') != project['id']:
            raise InvalidOperation('The reserved board belongs to another project', 'STALE_REVISION')
        if existing is None:
            native.create_board(slug, project)
        self.store.save(intent['id'], 'board_created', {'project_id': project['id'], 'board': slug})
        native.link_project(project['id'], slug)
        catalog = self.describe(state, native)
        if not any(b['slug'] == slug and b['mapping'] == 'linked' for b in catalog['boards']):
            raise InvalidOperation('The project and its board could not be confirmed')
        return self.store.save(intent['id'], 'completed', {'project_id': project['id'], 'board': slug})

    def update_project(self, native, state, params, actor):
        fields(params, ['workspace_id', 'operation_id', 'project_id', 'expected_revision', 'name', 'description'])
        ident = identifier(params['project_id'])
        patch = {'name': text(params['name'], 120, False), 'description': text(params['description'], 12000)}
        intent = self.store.reserve(params['operation_id'], actor, 'work.project.update', params)
        if intent['state'] == 'completed':
            return intent
        project = native.edit_project(ident, params['expected_revision'], patch)
        return self.store.save(intent['id'], 'completed', {'project_id': ident, 'board': project['board_slug']})

    def task(self, native, state, board, ident):
        detail = native.task(board['slug'], identifier(ident))
        runs = detail.get('runs', [])
        events = []
        for event in detail.get('events', []):
            payload = event.get('payload') if isinstance(event.get('payload'), dict) else {}
            run = next((r for r in runs if r['id'] == event.get('run_id')), {})
            events.append({**{key: event.get(key) for key in ('id', 'kind', 'created_at')},
                'actor': payload.get('author') or payload.get('profile') or run.get('profile') or (detail['task'].get('created_by') if event['kind'] == 'created' else None),
                'status': payload.get('status'), 'summary': payload.get('summary') or payload.get('reason')})
        return {'workspace_id': state['id'], 'board': board, 'task': task_view(detail['task']),
            'comments': [{key: c.get(key) for key in ('id', 'author', 'body', 'created_at')} for c in detail['comments']],
            'events': events,
            'runs': [{key: r.get(key) for key in ('id', 'profile', 'status', 'started_at', 'ended_at', 'outcome', 'summary')} for r in runs],
            'dependencies': detail.get('link_tasks', []), 'mentions': self.store.mention_states(board['slug'], ident)}

    def assignee(self, state, value):
        if value is None:
            return None
        bot = state['bots'].get(identifier(value))
        if not bot or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
            raise InvalidOperation('Choose an available pebble')
        return value

    def mutate_task(self, native, state, board, operation, params, actor):
        base = ['workspace_id', 'operation_id', 'board']
        if operation == 'work.task.move':
            return self.move_task(native, state, board, params, actor)
        if operation == 'work.task.comment':
            fields(params, base + ['id', 'body'])
            body = text(params['body'], 12000, False)
            ident = identifier(params['id'])
            native.task(board['slug'], ident)
        else:
            fields(params, base + ['title', 'body', 'assignee', 'priority']
                + (['status'] if operation == 'work.task.create' and 'status' in params else [])
                + (['id', 'expected_revision'] if operation == 'work.task.update' else []))
            if operation == 'work.task.create' and params.get('status', 'triage') not in ('triage', 'todo', 'ready', 'blocked', 'done', 'archived'):
                raise InvalidOperation('Choose an available task status')
            patch = {'title': text(params['title'], 500, False), 'body': text(params['body'], 32000)}
            if type(params['priority']) is not int or not -(2**31) <= params['priority'] < 2**31:
                raise InvalidOperation('Choose a valid priority')
            patch['priority'] = params['priority']
            if operation == 'work.task.update' and not native.edit_details:
                raise InvalidOperation('Update Hermes to safely edit task details', 'UPDATE_REQUIRED')
            current = native.task(board['slug'], identifier(params['id']))['task'] if operation == 'work.task.update' else None
            # Editing instructions must not require reassigning historical work
            # whose original profile is currently unavailable or unenrolled.
            assignee = params['assignee'] if current and params['assignee'] == current.get('assignee') else self.assignee(state, params['assignee'])
        intent = self.store.reserve(params['operation_id'], actor, operation, params)
        if intent['state'] == 'completed':
            return intent
        if operation == 'work.task.create':
            if intent['state'] == 'uncertain':
                return intent
            if intent['state'] == 'reserved':
                author = 'owner' if actor == 'owner' else '@'+next(b['handle'] for b in state['bots'].values() if b['id'] == actor)
                task = native.create_task(board['slug'], {**patch, 'assignee': assignee}, board['project_id'], 'pebble:'+intent['id'], author)
                if task['status'] != 'triage' or task.get('project_id') != board['project_id']:
                    raise InvalidOperation('The saved task’s board and project could not be confirmed')
                intent = self.store.save(intent['id'], 'task_created', {'board': board['slug'], 'task_id': task['id'], 'revision': task_revision(task)})
            task = native.task(board['slug'], intent['task_id'])['task']
            if task_revision(task) != intent['revision']:
                raise InvalidOperation('The newly created task changed in Hermes. Review it before starting work.', 'STALE_REVISION')
            status = params.get('status', 'triage')
            if status != 'triage':
                if status in ('todo', 'ready'):
                    self.store.watch_task(native, state, board['slug'], task['id'], assignee)
                self.store.save(intent['id'], 'uncertain', {'board': board['slug'], 'task_id': task['id']})
                try:
                    task = native.move_task(board['slug'], task['id'], intent['revision'], status)
                except InvalidOperation:
                    self.store.save(intent['id'], 'task_created', {key: intent[key] for key in ('board', 'task_id', 'revision')})
                    raise
        elif operation == 'work.task.comment':
            if intent['state'] != 'reserved':
                return intent  # A crash after native append is uncertain; never append twice.
            self.store.save(intent['id'], 'uncertain', {'board': board['slug'], 'task_id': ident})
            comment_id = native.comment(board['slug'], ident, body, 'owner' if actor == 'owner' else '@'+next(b['handle'] for b in state['bots'].values() if b['id'] == actor))
            handles = {handle.lower() for handle in re.findall(r'(?<![\w@])@([a-zA-Z0-9_-]+)\b', body)}
            targets = [(b, comment_id) for b in state['bots'].values() if b.get('handle', '').lower() in handles
                and b.get('enrolled') and b.get('available', True) and not b.get('deleted') and b['id'] != actor]
            return self.store.finish_task(intent['id'], board['slug'], native.task(board['slug'], ident)['task'], targets)
        else:
            ident = identifier(params['id'])
            expected = intent.get('revision', params['expected_revision'])
            if task_revision(current) != expected:
                raise InvalidOperation('This task changed. Review the latest version before saving.', 'STALE_REVISION')
            # Assignment and details use native transitions separately. Persist each
            # confirmed boundary so a retry cannot erase a newer native edit.
            if current.get('assignee') != assignee:
                if current.get('status') not in ('triage', 'todo', 'ready', 'blocked', 'scheduled'):
                    raise InvalidOperation('Pause active work before changing its assignee.')
                current = native.assign_task(board['slug'], ident, expected, assignee)
                expected = task_revision(current)
                self.store.save(intent['id'], 'assigned', {'board': board['slug'], 'task_id': ident, 'revision': expected})
            if current['status'] in ('todo', 'ready'):
                self.store.watch_task(native, state, board['slug'], ident, assignee)
            task = native.edit_task(board['slug'], ident, expected, patch)
        return self.store.finish_task(intent['id'], board['slug'], task, dispatch=task['status'] in ('todo', 'ready'))


    def move_task(self, native, state, board, params, actor):
        fields(params, ['workspace_id', 'operation_id', 'board', 'id', 'expected_revision', 'status'] + (['before_id'] if 'before_id' in params else []))
        ident = identifier(params['id'])
        intent = self.store.reserve(params['operation_id'], actor, 'work.task.move', params)
        if intent['state'] != 'reserved':
            return intent  # Never repeat an uncertain transition or start another run.
        current = native.task(board['slug'], ident)['task']
        if task_revision(current) != params['expected_revision']:
            raise InvalidOperation('This task changed. Review it before moving.', 'STALE_REVISION')
        changing_status = params['status'] != current['status']
        if changing_status and params['status'] not in ('triage', 'todo', 'ready', 'blocked', 'done', 'archived'):
            raise InvalidOperation('Choose an available task status')
        placement = None
        if 'before_id' in params:
            before = identifier(params['before_id']) if params['before_id'] is not None else None
            column = next((c for c in native.board(board['slug'])['columns'] if c['name'] == params['status']), None)
            if column is None or before == ident or (before is not None and not any(t['id'] == before for t in column['tasks'])):
                raise InvalidOperation('The target position changed. Review the board.', 'STALE_REVISION')
            placement = [t['id'] for t in self.store.ordered_tasks(board['slug'], params['status'], column['tasks']) if t['id'] != ident]
            placement.insert(placement.index(before) if before is not None else len(placement), ident)
        if not changing_status:
            return self.store.finish_task(intent['id'], board['slug'], current, placement=placement)
        if params['status'] in ('todo', 'ready') and current.get('assignee'):
            self.assignee(state, current['assignee'])
            self.store.watch_task(native, state, board['slug'], ident, current['assignee'])
        self.store.save(intent['id'], 'uncertain', {'board': board['slug'], 'task_id': ident})
        try:
            task = native.move_task(board['slug'], ident, params['expected_revision'], params['status'])
        except InvalidOperation:
            # A native CAS/transition refusal is definite; it did not start work.
            self.store.save(intent['id'], 'reserved', {})
            raise
        author = 'owner' if actor == 'owner' else '@'+next(b['handle'] for b in state['bots'].values() if b['id'] == actor)
        labels = {'triage':'Triage','todo':'To do','ready':'Ready','running':'In progress','blocked':'Blocked','scheduled':'Scheduled','review':'Review','done':'Done','archived':'Archived'}
        native.comment(board['slug'], ident, f"Moved {labels.get(current['status'], current['status'])} → {labels[task['status']]}", author)
        return self.store.finish_task(intent['id'], board['slug'], task, dispatch=params['status'] in ('todo', 'ready'), placement=placement)


def execute(operation, params, actor='owner'):
    from .workspace import WorkspaceStore, workspace_path
    path = workspace_path()
    workspace = WorkspaceStore(path)
    service = WorkService(workspace, path.with_name('work.sqlite'))
    try:
        return service.invoke(operation, params, actor)
    finally:
        service.close()
        workspace.db.close()


def register_native():
    from tui_gateway import server
    def invoke(rid, params):
        try:
            fields(params, ['operation', 'params'])
            if params['operation'] == 'work.capabilities':
                fields(params['params'], [])
                native = NativeWork('default')
                return server._ok(rid, {'supported': True, 'edit_details': native.edit_details})
            return server._ok(rid, {'ok': True, 'value': execute(params['operation'], params['params'])})
        except InvalidOperation as error:
            return server._ok(rid, {'ok': False, 'code': error.code})
        except Exception:
            return server._ok(rid, {'ok': False, 'code': 'RPC_FAILED'})
    server.method('bot_web.work')(invoke)
    def delivery(rid, params):
        from .work_delivery import tick, settle
        if params.get('action') == 'recover':
            fields(params, ['action'])
            return server._ok(rid, settle('', 'recover'))
        if params.get('action') == 'tick':
            fields(params, ['action'])
            return server._ok(rid, tick())
        fields(params, ['action', 'id'])
        return server._ok(rid, settle(params['id'], params['action']))
    server.method('bot_web.work_delivery')(delivery)



def register_runtime(ctx):
    def tool(args, session_id=None, **_kwargs):
        from .runtime import caller
        from .workspace import WorkspaceStore, workspace_path
        import os
        store = None
        try:
            if os.environ.get('HERMES_KANBAN_TASK'):
                raise InvalidOperation('Use your task-scoped native Kanban tools in a worker session')
            fields(args, ['operation', 'params'])
            store = WorkspaceStore(workspace_path())
            profile = caller(store, session_id)
            if not profile:
                raise InvalidOperation('Use work tools from your current Pebble Crew conversation')
            actor = store.read()['bots'][profile]['id']
            return json.dumps(execute(args['operation'], args['params'], actor), ensure_ascii=False)
        except InvalidOperation as error:
            return json.dumps({'error': str(error), 'code': error.code})
        except Exception:
            return json.dumps({'error': 'The work operation could not be confirmed. Check its receipt before retrying.'})
        finally:
            if store:
                store.db.close()
    ctx.register_tool(name='workspace_work', toolset='workspace',
        description='Use native project boards and tasks. Describe first. Each project gets its own board; General tasks is for unfiled work. Tasks default to Triage. Explicit creation status or work.task.move to todo/ready queues assigned work with the native dispatcher. Read native events, comments and worker reports for progress.',
        schema={'name': 'workspace_work', 'description': 'Read bot-web:manage-work. work.describe provides workspace and explicit board references. Use a stable UUID operation_id for retries. Confirm completion from a receipt, never from a queued or uncertain response. Only explicit creation status or work.task.move to todo/ready starts the native queue. Comments @mention enrolled handles to notify their existing conversation.',
            'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['operation', 'params'],
                'properties': {'operation': {'type': 'string', 'enum': sorted(OPERATIONS)},
                    'params': {'type': 'object', 'additionalProperties': False, 'properties': {
                        **{key: {'type': 'string'} for key in ('workspace_id', 'operation_id', 'board', 'id', 'project_id', 'expected_revision', 'name', 'description', 'title', 'body', 'status')},
                        'assignee': {'type': ['string', 'null'], 'description': 'Exact enrolled Hermes profile name, or null for unassigned.'},
                        'priority': {'type': 'integer', 'description': 'Normal 0, low -1, high 1, urgent 2.'}}}}}}, handler=tool)
    ctx.register_skill('manage-work', Path(__file__).with_name('skills') / 'manage-work' / 'SKILL.md',
        description='Create separate native project boards and manage scoped tasks safely, with explicit task movement and comment mentions.')
    ctx.register_middleware('tool_execution', guard_native_create)
    ctx.register_hook('pre_llm_call', worker_reporting)


def worker_reporting(**_kwargs):
    from agent.delegation_context import is_dispatcher_owned_worker_context
    if not os.environ.get('HERMES_KANBAN_TASK') or not is_dispatcher_owned_worker_context():
        return None
    return {'context': 'Pebble Crew task reporting: use kanban_show to read the task and existing comments before work. '
        'Leave a concise kanban_comment(task_id=<your native task id>, body=...) with your approach, meaningful progress, blockers and verified result so other agents and the owner can follow the work. '
        'Use native kanban_complete/kanban_block/kanban_request_review with a concrete summary; a final chat reply alone does not finish the task. '
        'If the deliverable is a message to the owner, put the exact message in your completion summary/result for delivery to their existing Bot Chat. '
        'Do not claim a message was sent unless you used a delivery tool and verified it. Never mark unfinished work complete.'}


def guard_native_create(tool_name=None, args=None, next_call=None, **_kwargs):
    if tool_name != 'kanban_create' or not isinstance(args, dict):
        return next_call()
    from .workspace import workspace_path
    path = workspace_path().with_name('work.sqlite')
    if not path.exists():
        return next_call()
    try:
        from hermes_cli import kanban_db
        # Native resolution retains a dispatcher's board fence; never set the
        # ambient board pointer or substitute the catalog's current board.
        database = Path(kanban_db.kanban_db_path(args.get('board'))).resolve()
        if database == (kanban_db.kanban_home() / 'kanban.db').resolve():
            slug = 'default'
        elif database.name == 'kanban.db' and database.parent.parent == kanban_db.boards_root().resolve():
            slug = database.parent.name
        else:
            raise InvalidOperation('The task database has no confirmed native board identity')
        board = kanban_db.read_board_metadata(slug)
        scoped = {**args, 'board': slug}
        project = args.get('project', args.get('project_id'))
        expected = board.get('project_id')
        if board['slug'] == 'default' and project:
            return json.dumps({'error': 'Create or choose a dedicated project board; General tasks is for unfiled work.'})
        if expected and project is not None and project != expected:
            return json.dumps({'error': 'The task project must match its board. Choose that project’s own board.'})
        if expected and project is None:
            scoped['project'] = expected
    except Exception:
        return json.dumps({'error': 'The native board/project scope could not be verified; no task was created.'})
    return next_call(scoped)


def is_catalog_profile(path, workspace_id, identity):
    """A bound catalog needs explicit migration before its profile is deleted."""
    import sqlite3
    from contextlib import closing
    path = Path(path).with_name('work.sqlite')
    if not path.exists():
        return False
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True)) as conn:
        row = conn.execute('SELECT identity FROM catalog WHERE workspace=?', (workspace_id,)).fetchone()
        return bool(row and row[0] == identity)


def runtime_guidance(platform):
    from tui_gateway import server
    from model_tools import get_tool_definitions
    disabled = server._load_disabled_toolsets() if hasattr(server, '_load_disabled_toolsets') else None
    definitions = get_tool_definitions(enabled_toolsets=server._load_enabled_toolsets(platform),
        disabled_toolsets=disabled, quiet_mode=True, skip_tool_search_assembly=True)
    if not any(t.get('function', {}).get('name') == 'workspace_work' for t in definitions):
        return ''
    return ('Use workspace_work for project boards and tasks. If deferred, describe it with '
        'tool_describe(names=["workspace_work"]) and invoke via tool_call. Read bot-web:manage-work '
        'and work.describe first. Each substantive project has its own board; General tasks is '
        'for unfiled work. New tasks default to Triage. Only explicit todo/ready status queues assigned execution. Read native task events, comments and worker summaries; post meaningful progress and verified results to the task. Routine definitions '
        'stay with the agent, outside Tasks.')
