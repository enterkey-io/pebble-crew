"""Owner-local presentation state; no transcript or credential storage."""
from copy import deepcopy
import hashlib
import json
import re
import time
from .operations import InvalidOperation, fields, identifier


async def identities(service, state, profiles):
    data = await service.ops.gateway.call('bot_web.identities', {})
    stamps = data.get('identities', {})
    for row in profiles:
        clock = data.get('cursors', {}).get(row['name'])
        if clock:
            row['_presentation_clock'] = clock
    live = {r['name'] for r in profiles}
    for row in profiles:
        name = row['name']
        stamp = stamps.get(name)
        old = state['bots'].get(name)
        if stamp and not old:
            candidates = [p for p, identity in state['bots'].items() if p not in live and identity.get('native_incarnation') == stamp]
            previous = candidates[0] if len(candidates) == 1 else None
            if previous:
                old = state['bots'].pop(previous)
                old['profile'] = name
                state['bots'][name] = old
                if state['orchestrator'] == previous:
                    state['orchestrator'] = name
                for bot in state['bots'].values():
                    if bot.get('manager') == previous:
                        bot['manager'] = name
                state['aliases'] = {k: name if v == previous else v for k, v in state['aliases'].items()}
        if old and stamp and (old.get('deleted') or
                (old.get('native_incarnation') and old['native_incarnation'] != stamp)):
            state.setdefault('retired', {})[old['id']] = deepcopy(old)
            state['aliases'] = {k: '!retired:'+old['id'] if v == name else v for k, v in state['aliases'].items()}
            state['aliases'][old['handle']] = '!retired:'+old['id']
            state['bots'].pop(name)
            if state['orchestrator'] == name:
                state['orchestrator'] = None
    for name, bot in state['bots'].items():
        bot['available'] = name in live
        if name not in live:
            bot['enrolled'] = False
    return stamps


async def bind(service, row, bot, stamp, *, enrollment_complete):
    bot['available'] = True
    bot['enrolled'] = enrollment_complete and isinstance(row.get('ui_meta', {}).get('hermes-bots'), dict)
    if not isinstance(stamp, str) or not re.fullmatch('[0-9a-f]{64}', stamp):
        return
    bot['native_incarnation'] = stamp
    marker = {'id': bot['id'], 'incarnation': stamp}
    if row.get('ui_meta', {}).get('pebble-crew') != marker:
        result = await service.ops.gateway.call('profiles.configure', {'name': row['name'],
            'ui_meta': {'pebble-crew': marker}, 'ui_meta_expected_revisions': {
                'pebble-crew': row.get('ui_meta_revisions', {}).get('pebble-crew', 0)}})
        if result.get('applied', {}).get('ui_meta') is not True:
            raise InvalidOperation('Profile identity changed; refresh to reconcile')


def init_store(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS presentation(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS read_cursors(key TEXT PRIMARY KEY, cursor INTEGER NOT NULL);
    ''')


def preferences(store):
    row = store.db.execute("SELECT value FROM presentation WHERE key='preferences'").fetchone()
    return json.loads(row[0]) if row else {'revision': 0, 'pin_order': []}


async def snapshot(service, fresh=False):
    cached = getattr(service, '_snapshot', None)
    if not fresh and cached and time.monotonic() - cached[0] < 1:
        return deepcopy(cached[1])
    state, profiles = await service.sync(include_model=False)
    rooms = await service.ops.invoke('rooms.list', {})
    reads = dict(service.store.db.execute('SELECT key,cursor FROM read_cursors'))
    for bot in state['bots']:
        key = f"bot:{bot['id']}:{bot.get('cursor_type', 'count')}:{bot.get('conversation_id', '')}"
        bot['read_key'] = key
        bot['unread'] = bot.get('cursor', 0) > reads.get(key, bot.get('cursor', 0))
        if key not in reads:
            with service.store.db:
                service.store.db.execute('INSERT OR IGNORE INTO read_cursors VALUES(?,?)', (key, bot.get('cursor', 0)))
    for room in rooms.get('rooms', []):
        key = 'room:'+str(room.get('room_id', ''))+':'+str(room.get('created_at', ''))
        room['read_key'] = key
        room['cursor'] = room.get('latest_seq', 0)
        room['unread'] = room['cursor'] > reads.get(key, room['cursor'])
        if key not in reads:
            with service.store.db:
                service.store.db.execute('INSERT OR IGNORE INTO read_cursors VALUES(?,?)', (key, room['cursor']))
    result = {'workspace': state, 'bots': [service.ops.summary(r) for r in profiles
        if isinstance(r.get('ui_meta', {}).get('hermes-bots'), dict) and not r['ui_meta']['hermes-bots'].get('hidden')],
        'rooms': rooms.get('rooms', []), 'preferences': preferences(service.store)}
    from .organization import read as organization, chat_links
    result['organization'] = organization(service, service.store.read())
    result['crew_chats'] = chat_links(service, service.store.read())
    result['revision'] = hashlib.sha256(json.dumps(result, sort_keys=True, default=str).encode()).hexdigest()
    service._snapshot = (time.monotonic(), deepcopy(result))
    return result


async def invoke(service, operation, params, state, profiles):
    if operation == 'workspace.snapshot':
        fields(params, [])
        return await snapshot(service)
    if operation == 'presentation.read':
        fields(params, ['key', 'cursor'])
        data = await snapshot(service)
        counters = {b['read_key']: b.get('cursor', 0) for b in data['workspace']['bots']}
        counters.update({r['read_key']: r.get('cursor', 0) for r in data['rooms']})
        if params['key'] not in counters or type(params['cursor']) is not int or not 0 <= params['cursor'] <= counters[params['key']]:
            raise InvalidOperation('Read cursor is outside this conversation')
        with service.store.db:
            service.store.db.execute('INSERT INTO read_cursors VALUES(?,?) ON CONFLICT(key) DO UPDATE SET cursor=MAX(cursor,excluded.cursor)', (params['key'], params['cursor']))
        service._snapshot = None
        return {'saved': True}
    if operation == 'presentation.order':
        fields(params, ['ids', 'expected_revision'])
        prefs = preferences(service.store)
        ids = params['ids']
        if not isinstance(ids, list) or len(ids) > 1000 or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids) or not set(ids) <= {b['id'] for b in state['bots'].values() if b.get('available')}:
            raise InvalidOperation('Invalid pin order')
        if prefs['revision'] != params['expected_revision']:
            raise InvalidOperation('Pin order changed; refresh')
        prefs = {'revision': prefs['revision']+1, 'pin_order': ids}
        with service.store.db:
            service.store.db.execute("INSERT OR REPLACE INTO presentation VALUES('preferences',?)", (json.dumps(prefs),))
        return prefs
    if operation == 'agent.propose':
        fields(params, ['action', 'spec'])
        if params['action'] not in {'agent.hide', 'agent.delete'}:
            raise InvalidOperation('Unsupported owner proposal')
        validate_target(state, params['action'], params['spec'])
        request_id, status = service.store.request('owner', params['action'], params['spec'])
        return {'request_id': request_id, 'state': status}
    if operation in {'agent.hide', 'agent.delete', 'agent.pin'}:
        bot = validate_target(state, operation, params)
        profile = params['profile']
        if operation == 'agent.pin':
            await service.mirror(profile, {'pinned': params['pinned']})
            return {'state': 'completed'}
        if operation == 'agent.hide':
            await service.mirror(profile, {'hidden': params['hidden']})
            return {'state': 'completed'}
        if profile == 'default' or profile == state['orchestrator']:
            raise InvalidOperation('Reassign the lead first; the default Hermes profile cannot be deleted')
        if getattr(service, '_approved_delete', None) != bot['id']:
            raise InvalidOperation('Native deletion requires an exact owner-approved request')
        if any(b.get('available') and b.get('manager') == profile for b in state['bots'].values()):
            raise InvalidOperation('Reassign this pebble’s direct reports first')
        from .work import is_catalog_profile
        if is_catalog_profile(service.store.path, state['id'], bot['id']):
            raise InvalidOperation('This pebble holds the project catalog. Migrate the catalog in Hermes before deleting this profile.')
        # These pinned native builds freeze crew membership at creation. Do not
        # leave a live member pointing at a deleted/recreated profile name.
        offset = 0
        while True:
            page = await service.ops.gateway.call('groups.list', {'limit': 100, 'offset': offset})
            for room in page.get('rooms', []):
                if any(m.get('profile') == profile for m in room.get('members', []) if isinstance(m, dict)):
                    return {'state': 'blocked', 'reason': 'This pebble belongs to a live crew. Disband or replace that crew in Hermes before deleting the profile. Hide remains available.'}
            if page.get('next_offset') is None:
                break
            offset = page['next_offset']
        stamp = bot.get('native_incarnation')
        if not stamp:
            raise InvalidOperation('Native profile identity is not verified')
        result = await service.ops.gateway.call('bot_web.lifecycle', {'action': 'delete', 'profile': profile, 'incarnation': stamp})
        if result.get('files_deleted'):
            state = service.store.read()
            state['bots'][profile].update(available=False, enrolled=False, deleted=True)
            service.store.save(state, state['revision'])
        return result
    raise InvalidOperation('Presentation operation unavailable')


def validate_target(state, operation, params):
    extra = {'agent.hide': ['hidden'], 'agent.pin': ['pinned'], 'agent.delete': []}[operation]
    fields(params, ['profile', 'id', 'expected_revision', *extra])
    profile = identifier(params['profile'])
    bot = state['bots'].get(profile)
    if not bot or not bot.get('available', True) or bot['id'] != params['id'] or state['revision'] != params['expected_revision']:
        raise InvalidOperation('Pebble identity or workspace changed; refresh before proceeding')
    for key in extra:
        if type(params[key]) is not bool:
            raise InvalidOperation('Expected a boolean choice')
    return bot
