"""Durable agent-initiated profile/routine commands; no nested native RPC in a model turn."""
from copy import deepcopy
import asyncio
import json
import time
from .operations import InvalidOperation, fields, identifier
from .work_store import operation_id

ACTIONS = {'agent.appearance.update', 'routines.manage', 'group.create'}


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS agent_management(
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, actor_id TEXT NOT NULL,
        actor_incarnation TEXT, target_id TEXT NOT NULL, target_incarnation TEXT,
        policy_revision INTEGER NOT NULL, action TEXT NOT NULL, spec TEXT NOT NULL,
        state TEXT NOT NULL, result TEXT, created INTEGER NOT NULL)''')
    db.commit()


def authorized(state, actor, target):
    bot = state['bots'].get(actor)
    other = state['bots'].get(target)
    if not bot or not other or any(not b.get('enrolled') or not b.get('available', True) or b.get('deleted') for b in (bot, other)):
        raise InvalidOperation('Choose current enrolled pebbles', 'FORBIDDEN')
    if actor != target and actor != state.get('orchestrator'):
        raise InvalidOperation('Only the current Main Pebble can change another pebble', 'FORBIDDEN')
    return bot, other


def submit(store, actor, action, spec):
    if action not in ACTIONS:
        raise InvalidOperation('Management action unavailable')
    if action == 'group.create':
        fields(spec, ['operation_id', 'expected_revision', 'name', 'members'])
        if not isinstance(spec['name'], str) or not 1 <= len(spec['name'].strip()) <= 80 or not isinstance(spec['members'], list) or not 2 <= len(spec['members']) <= 6 or any(not isinstance(i, str) for i in spec['members']) or len(set(spec['members'])) != len(spec['members']):
            raise InvalidOperation('Choose a name and 2–6 distinct pebble IDs')
        state = store.read()
        spec = {**spec, 'profile': actor, 'id': state['bots'].get(actor, {}).get('id')}
    keys = ['operation_id', 'profile', 'id', 'expected_revision']
    fields(spec, keys + (['appearance', 'photo'] if action == 'agent.appearance.update' else ['name', 'members'] if action == 'group.create' else ['command']))
    operation_id(spec['operation_id'])
    identifier(spec['profile'])
    if action == 'agent.appearance.update':
        from .workspace import appearance, normalize_photo
        appearance(spec['appearance'])
        if spec['photo'] is not None:
            spec = {**spec, 'photo': normalize_photo(spec['photo'])}
    elif action == 'routines.manage':
        from .routines_native import validate_command
        validate_command(spec['command'])
    raw = json.dumps(spec, sort_keys=True, separators=(',', ':'))
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        state = store.read()
        bot, target = authorized(state, actor, spec['profile'])
        previous = store.db.execute('SELECT actor_id,action,spec,state,result FROM agent_management WHERE id=?', (spec['operation_id'],)).fetchone()
        if previous:
            if previous[:3] != (bot['id'], action, raw):
                raise InvalidOperation('Operation ID was already used for another change', 'STALE_REVISION')
            return receipt(spec['operation_id'], previous[3], previous[4])
        if target['id'] != spec['id'] or type(spec['expected_revision']) is not int or spec['expected_revision'] != state['revision']:
            raise InvalidOperation('Describe the current target before changing it', 'STALE_REVISION')
        store.db.execute('INSERT INTO agent_management VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?)',
            (spec['operation_id'], actor, bot['id'], bot.get('native_incarnation'), target['id'], target.get('native_incarnation'),
             state['reporting']['policy_revision'], action, raw, 'queued', int(time.time())))
    return receipt(spec['operation_id'], 'queued', None)


def receipt(ident, state, raw):
    return {'operation_id': ident, 'state': state, 'requires_owner_approval': False,
        'result': json.loads(raw) if raw else None}


def receipts(store, actor):
    values, size = [], 0
    for row in store.db.execute('SELECT id,state,result FROM agent_management WHERE actor=? ORDER BY created DESC,rowid DESC LIMIT 30', (actor,)):
        value = receipt(*row)
        length = len(json.dumps(value))
        if size + length > 64000:
            value['result'] = {'summary_only': True, 'message': 'List current settings to inspect this older result.'}
            length = len(json.dumps(value))
        values.append(value)
        size += length
    return values


def recover(store):
    with store.db:
        store.db.execute("UPDATE agent_management SET state='uncertain',result=? WHERE state='applying'",
            (json.dumps({'code': 'INTERRUPTED', 'message': 'Inspect the target before retrying; this operation will not replay automatically.'}),))


async def drain(service):
    async with service.lock:
        rows = list(service.store.db.execute("SELECT id,actor,actor_id,actor_incarnation,target_id,target_incarnation,policy_revision,action,spec FROM agent_management WHERE state='queued' ORDER BY created,rowid LIMIT 8"))
        for ident, actor, actor_id, actor_incarnation, target_id, target_incarnation, policy, action, raw in rows:
            with service.store.db:
                if not service.store.db.execute("UPDATE agent_management SET state='applying' WHERE id=? AND state='queued'", (ident,)).rowcount:
                    continue
            status, result = 'refused', {}
            try:
                await service.sync(include_model=False)
                state = service.store.read()
                spec = json.loads(raw)
                bot, target = authorized(state, actor, spec['profile'])
                if (bot['id'], bot.get('native_incarnation'), target['id'], target.get('native_incarnation')) != (actor_id, actor_incarnation, target_id, target_incarnation):
                    raise InvalidOperation('An agent identity changed', 'STALE_REVISION')
                if actor != spec['profile'] and state['reporting']['policy_revision'] != policy:
                    raise InvalidOperation('The Main Pebble changed', 'FORBIDDEN')
                if state['revision'] != spec['expected_revision']:
                    raise InvalidOperation('Settings changed; describe the target again', 'STALE_REVISION')
                status = 'uncertain'
                if action == 'agent.appearance.update':
                    look = deepcopy(spec['appearance'])
                    if spec['photo'] is not None:
                        saved = await service.ops.gateway.call('profiles.set_asset', {'name': spec['profile'], 'asset': 'avatar', 'data': spec['photo']})
                        if saved.get('ok') is not True:
                            raise RuntimeError('Native photo save was not confirmed')
                    elif look['kind'] == 'photo':
                        saved = await service.ops.gateway.call('profiles.get_asset', {'name': spec['profile'], 'asset': 'avatar'})
                        if not saved.get('found'):
                            raise InvalidOperation('Choose a saved photo or a shape')
                    await service.mirror(spec['profile'], {'workspaceAppearance': look})
                    state['bots'][spec['profile']]['appearance'] = look
                    service.store.save(state, state['revision'])
                    result = {'profile': spec['profile'], 'appearance': look}
                elif action == 'group.create':
                    by_id = {b['id']: b for b in state['bots'].values() if b.get('enrolled') and b.get('available', True)}
                    if any(i not in by_id for i in spec['members']):
                        raise InvalidOperation('A selected pebble is unavailable', 'STALE_REVISION')
                    from .groups import create
                    result = await create(service, {'room_id': 'group-' + ident, 'name': spec['name'], 'profiles': [by_id[i]['profile'] for i in spec['members']]})
                    if result['state'] != 'ready':
                        raise RuntimeError('Group creation is unconfirmed')
                else:
                    result = await service.ops.gateway.call('bot_web.routines', {'profile': spec['profile'], 'command': spec['command']})
                    if result.get('success') is not True:
                        status = 'refused'
                        result = {'code': result.get('code', 'ROUTINE_REJECTED')}
                if status == 'uncertain':
                    status = 'applied'
                service._snapshot = None
            except InvalidOperation as error:
                status, result = 'refused', {'code': error.code}
            except Exception:
                result = {'code': 'UNCONFIRMED', 'message': 'Inspect the target before another change. This operation will not replay automatically.'}
            with service.store.db:
                service.store.db.execute('UPDATE agent_management SET state=?,result=? WHERE id=?', (status, json.dumps(result), ident))
            if status == 'applied' and action == 'routines.manage' and spec['command']['action'] != 'list':
                for queue in tuple(service.ops.gateway.listeners):
                    try:
                        queue.put_nowait({'type': 'routines.changed', 'payload': {'profile': spec['profile']}})
                    except asyncio.QueueFull:
                        pass  # A missed hint does not alter the confirmed native receipt.
