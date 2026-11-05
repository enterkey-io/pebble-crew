"""Explicit native group creation with a frozen owner-local intent and read-back recovery."""
from copy import deepcopy
import json
from .operations import InvalidOperation, fields, identifier
from .native import NativeError
from .work_store import fingerprint


def public_room(room):
    return {**room, 'read_key': 'room:' + str(room['room_id']) + ':' + str(room['created_at'])}


async def create(service, params):
    fields(params, ['room_id', 'name', 'profiles'])
    ident = identifier(params['room_id'])
    name, profiles = params['name'], params['profiles']
    if not isinstance(name, str) or not name.strip() or len(name) > 80 or not isinstance(profiles, list) or not 2 <= len(profiles) <= 6 or any(not isinstance(p, str) for p in profiles) or len(set(profiles)) != len(profiles):
        raise InvalidOperation('Choose a name and 2–6 distinct pebbles')
    requested = fingerprint(params)
    key = 'group-create:' + ident
    row = service.store.db.execute('SELECT value FROM presentation WHERE key=?', (key,)).fetchone()
    if row:
        intent = json.loads(row[0])
        if intent['request'] != requested:
            raise InvalidOperation('This creation ID belongs to another group', 'STALE_REVISION')
    else:
        await service.sync(include_model=False)
        state = service.store.read()
        members, identities = [], []
        for profile in profiles:
            identifier(profile)
            bot = state['bots'].get(profile)
            if not bot or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted') or not bot.get('native_incarnation'):
                raise InvalidOperation('Choose current available pebbles')
            native = await service.ops.bot(profile)
            members.append({'member_id': profile, 'profile': profile, 'handle': 'hermes' if profile == 'default' else profile,
                'target': {'kind': 'local', 'profile': profile}, 'display_name': service.ops.summary(native)['name']})
            identities.append({'profile': profile, 'id': bot['id'], 'incarnation': bot['native_incarnation']})
        intent = {'request': requested, 'payload': {'room_id': ident, 'name': name.strip(), 'members': members},
            'identities': identities, 'attempted': False, 'state': 'reserved'}
        with service.store.db:
            service.store.db.execute('INSERT OR IGNORE INTO presentation VALUES(?,?)', (key, json.dumps(intent)))
        intent = json.loads(service.store.db.execute('SELECT value FROM presentation WHERE key=?', (key,)).fetchone()[0])
        if intent['request'] != requested:
            raise InvalidOperation('This creation ID belongs to another group', 'STALE_REVISION')
    if intent['state'] == 'ready':
        return {'state': 'ready', 'room': deepcopy(intent['room'])}
    try:
        found = await service.ops.gateway.call('groups.state', {'room_id': ident, 'include_disbanded': True})
    except NativeError as error:
        if error.reason != 'room_not_found':
            return {'state': 'uncertain'}
        if intent['attempted']:
            return {'state': 'uncertain'}
        # Freeze the payload before calling create. A replay cannot borrow changed display names.
        state = service.store.read()
        for selected in intent['identities']:
            bot = state['bots'].get(selected['profile'])
            if not bot or not bot.get('enrolled') or not bot.get('available', True) or (bot['id'], bot.get('native_incarnation')) != (selected['id'], selected['incarnation']):
                raise InvalidOperation('A selected pebble changed; review the group', 'STALE_REVISION')
        intent.update(attempted=True, state='uncertain')
        with service.store.db:
            service.store.db.execute('UPDATE presentation SET value=? WHERE key=?', (json.dumps(intent), key))
        try:
            await service.ops.gateway.call('groups.create', intent['payload'])
        except Exception:
            pass  # Same identity read-back resolves a lost creation acknowledgement.
        try:
            found = await service.ops.gateway.call('groups.state', {'room_id': ident, 'include_disbanded': True})
        except Exception:
            return {'state': 'uncertain'}
    if not intent['attempted']:
        raise InvalidOperation('That group ID already exists; it was not created by this operation', 'STALE_REVISION')
    room = found.get('room')
    payload = intent['payload']
    if not isinstance(room, dict) or room.get('room_id') != ident or room.get('name') != payload['name'] or room.get('members') != payload['members'] or not isinstance(room.get('created_at'), (int, float)):
        return {'state': 'uncertain'}
    intent.update(state='ready', room=public_room(room))
    with service.store.db:
        service.store.db.execute('UPDATE presentation SET value=? WHERE key=?', (json.dumps(intent), key))
    service._snapshot = None
    return {'state': 'ready', 'room': deepcopy(intent['room'])}
