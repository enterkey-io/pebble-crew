"""Owner-local reporting forest, scoped management and durable change receipts."""
from contextlib import closing
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

from .operations import InvalidOperation, fields, identifier

VERSION = 1


def initialize(store, path):
    import fcntl
    lock = os.open(Path(path).with_suffix('.reporting.lock'), os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        _initialize(store, path)
    finally:
        os.close(lock)


def _initialize(store, path):
    state = store.read()
    if 'reporting' not in state:
        # Preserve a consistent private rollback snapshot before changing semantics.
        backup = Path(path).with_suffix('.pre-reporting.sqlite')
        if not backup.exists():
            fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
            with closing(sqlite3.connect(backup)) as target:
                store.db.backup(target)
        with store.db:
            current = store.read()
            if 'reporting' not in current:
                current['reporting'] = {'version': VERSION, 'management_enabled': True, 'policy_revision': 0}
                for bot in current['bots'].values():
                    manager = current['bots'].get(bot.get('manager'))
                    bot['manager_id'] = manager['id'] if manager else None
                store.save(current, current['revision'])
    store.db.execute('''CREATE TABLE IF NOT EXISTS reporting_changes(
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, actor_id TEXT NOT NULL,
        spec TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        result TEXT, created INTEGER NOT NULL)''')
    store.db.commit()


def assign(state, profile, manager):
    bot = state['bots'][profile]
    if manager is not None:
        identifier(manager)
        target = state['bots'].get(manager)
        if not target or not target.get('enrolled') or not target.get('available', True) or target.get('deleted'):
            raise InvalidOperation('Choose an available enrolled pebble', 'INVALID_REPORTING')
        if manager == bot.get('manager') and bot.get('manager_id') not in (None, target['id']):
            raise InvalidOperation('Clear the old manager before selecting a replacement identity', 'INVALID_REPORTING')
        bot['manager_id'] = target['id']
    else:
        bot['manager_id'] = None
    bot['manager'] = manager


def path(state, profile):
    nodes = state['bots']
    route, seen = [], set()
    current = profile
    while current is not None:
        if current in seen:
            return route, 'cycle'
        seen.add(current)
        bot = nodes.get(current)
        if not bot or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
            return route, 'unavailable'
        route.append(current)
        manager = bot.get('manager')
        if manager is not None:
            parent = nodes.get(manager)
            if not parent or bot.get('manager_id') != parent['id']:
                return route, 'identity_changed'
        current = manager
    return route, 'owner' if route and route[-1] == state['orchestrator'] else 'unattached'


def validate(state, before):
    root = state['orchestrator']
    main = state['bots'].get(root)
    if not main or not main.get('enrolled') or main.get('manager') is not None:
        raise InvalidOperation('The Main Pebble must have no manager', 'INVALID_REPORTING')
    for name, bot in state['bots'].items():
        if not bot.get('enrolled') or not bot.get('available', True):
            continue
        route, end = path(state, name)
        if end not in {'owner', 'unattached'}:
            old_route, old_end = path(before, name)
            if route != old_route or end != old_end:
                raise InvalidOperation('Reporting must be acyclic and use current agent identities', 'INVALID_REPORTING')


def allowed(state, actor):
    bot = state['bots'].get(actor)
    return bool(bot and actor == state['orchestrator'] and bot.get('enrolled')
        and bot.get('available', True) and not bot.get('deleted')
        and state['reporting']['management_enabled'])


def receipts(store, actor=None):
    rows = store.db.execute('SELECT id,actor,spec,state,result,created FROM reporting_changes ORDER BY created DESC,rowid DESC LIMIT 50')
    return [{'id': r[0], 'actor': r[1], 'change': json.loads(r[2]), 'state': r[3],
        'result': json.loads(r[4]) if r[4] else None, 'created': r[5]}
        for r in rows if actor is None or r[1] == actor]


def submit(store, actor, spec):
    fields(spec, ['profile', 'id', 'manager', 'manager_id', 'instructions', 'expected_revision', 'policy_revision'])
    state = store.read()
    if not allowed(state, actor):
        raise InvalidOperation('Main Pebble management is not authorized', 'FORBIDDEN')
    raw = json.dumps(spec, sort_keys=True)
    fingerprint = hashlib.sha256((state['bots'][actor]['id']+raw).encode()).hexdigest()
    previous = store.db.execute('SELECT id,state FROM reporting_changes WHERE fingerprint=?', (fingerprint,)).fetchone()
    if previous:
        return {'request_id': previous[0], 'state': previous[1], 'requires_owner_approval': False}
    if type(spec['expected_revision']) is not int or spec['expected_revision'] != state['revision'] or type(spec['policy_revision']) is not int or spec['policy_revision'] != state['reporting']['policy_revision']:
        raise InvalidOperation('Refresh the organization before changing it', 'STALE_REVISION')
    target = state['bots'].get(identifier(spec['profile']))
    if not target or target['id'] != spec['id'] or not target.get('enrolled') or not target.get('available', True):
        raise InvalidOperation('Agent identity changed', 'INVALID_REPORTING')
    if spec['instructions'] is not None and (not isinstance(spec['instructions'], str) or len(spec['instructions']) > 12000):
        raise InvalidOperation('Instructions must be at most 12000 characters')
    parent = state['bots'].get(spec['manager']) if isinstance(spec['manager'], str) else None
    if (parent['id'] if parent else None) != spec['manager_id'] or (spec['manager'] is not None and not parent):
        raise InvalidOperation('Manager identity changed', 'INVALID_REPORTING')
    candidate = deepcopy(state)
    assign(candidate, spec['profile'], spec['manager'])
    validate(candidate, state)
    raw = json.dumps(spec, sort_keys=True)
    fingerprint = hashlib.sha256((state['bots'][actor]['id']+raw).encode()).hexdigest()
    with store.db:
        store.db.execute('INSERT OR IGNORE INTO reporting_changes VALUES(?,?,?,?,?,?,NULL,?)',
            (str(uuid.uuid4()), actor, state['bots'][actor]['id'], raw, fingerprint, 'queued', int(time.time())))
    row = store.db.execute('SELECT id,state FROM reporting_changes WHERE fingerprint=?', (fingerprint,)).fetchone()
    return {'request_id': row[0], 'state': row[1], 'requires_owner_approval': False}


async def drain(service):
    async with service.lock:
        queued = list(service.store.db.execute("SELECT id,actor,actor_id,spec FROM reporting_changes WHERE state='queued' ORDER BY created,rowid LIMIT 8"))
        for request_id, actor, actor_id, raw in queued:
            with service.store.db:
                claimed = service.store.db.execute("UPDATE reporting_changes SET state='applying' WHERE id=? AND state='queued'", (request_id,)).rowcount
            if not claimed:
                continue
            status, result = 'refused', {}
            try:
                await service.sync(include_model=False)
                state = service.store.read()
                spec = json.loads(raw)
                if not allowed(state, actor) or state['bots'][actor]['id'] != actor_id or type(spec['policy_revision']) is not int or spec['policy_revision'] != state['reporting']['policy_revision']:
                    raise InvalidOperation('Management permission changed', 'FORBIDDEN')
                if state['revision'] != spec['expected_revision']:
                    raise InvalidOperation('Organization changed; review before retrying', 'STALE_REVISION')
                target = state['bots'].get(spec['profile'])
                parent = state['bots'].get(spec['manager']) if spec['manager'] else None
                if not target or not target.get('enrolled') or not target.get('available', True) or target['id'] != spec['id'] or (parent['id'] if parent else None) != spec['manager_id']:
                    raise InvalidOperation('Agent identity changed', 'INVALID_REPORTING')
                candidate = deepcopy(state)
                assign(candidate, spec['profile'], spec['manager'])
                validate(candidate, state)
                role = deepcopy(target['role']) if spec['instructions'] is None else {**target['role'], 'responsibilities': spec['instructions'], 'boundaries': '', 'expectedOutputs': ''}
                # An uncertain mirror is retained for inspection, never automatically replayed.
                status = 'uncertain'
                await service.mirror(spec['profile'], {'workspaceRole': role})
                candidate['bots'][spec['profile']]['role'] = role
                saved = service.store.save(candidate, state['revision'])
                status, result = 'applied', {'revision': saved['revision'], 'profile': spec['profile'], 'before': {'manager': target['manager'], 'role': target['role']}, 'after': {'manager': spec['manager'], 'role': role}}
                service._snapshot = None
            except InvalidOperation as error:
                result = {'code': error.code}
            except Exception:
                result = {'code': 'REQUEST_FAILED'}
            with service.store.db:
                service.store.db.execute('UPDATE reporting_changes SET state=?,result=? WHERE id=?', (status, json.dumps(result), request_id))


def recover(store):
    with store.db:
        store.db.execute("UPDATE reporting_changes SET state='uncertain',result=? WHERE state='applying'", (json.dumps({'code': 'INTERRUPTED'}),))
