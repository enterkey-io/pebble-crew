"""Sidebar organization, independent of profile roles and native chat membership."""
from copy import deepcopy
import hashlib
import json
from .operations import InvalidOperation, fields
from .native import NativeError


def read(service, state):
    row = service.store.db.execute("SELECT value FROM presentation WHERE key='organization'").fetchone()
    if row:
        saved = json.loads(row[0])
    else:
        members = {b['id'] for b in state['bots'].values() if b.get('available') and b.get('enrolled')}
        crews = [{'id': t['id'], 'name': t['name'], 'purpose': '', 'collapsed': False,
                  'members': [b['id'] for b in state['bots'].values() if b['id'] in members and b.get('team') == t['id']]}
                 for t in state['teams']]
        assigned = {i for c in crews for i in c['members']}
        saved = {'revision': 0, 'sections': [
            {'id': 'pebbles', 'name': 'Pebbles', 'collapsed': False,
             'items': [{'kind': 'pebble', 'id': i} for i in sorted(members-assigned)]},
            {'id': 'crews', 'name': 'Crews', 'collapsed': False,
             'items': [{'kind': 'crew', 'id': c['id']} for c in crews]}], 'crews': crews}
    return reconcile(saved, state)


def reconcile(saved, state):
    saved = deepcopy(saved)
    live = {b['id'] for b in state['bots'].values() if b.get('available') and b.get('enrolled')}
    defaults = {'pebbles': 'Pebbles', 'crews': 'Crews'}
    for identity, label in defaults.items():
        section = next((s for s in saved['sections'] if s['id'] == identity), None)
        if section is None:
            saved['sections'].append({'id': identity, 'name': label, 'collapsed': False, 'items': []})
        else:
            section['name'] = label
    misplaced = []
    for section in saved['sections']:
        wrong = [i for i in section['items'] if (section['id'] == 'crews' and i['kind'] == 'pebble') or (section['id'] == 'pebbles' and i['kind'] == 'crew')]
        section['items'] = [i for i in section['items'] if i not in wrong]
        misplaced.extend(wrong)
    for item in misplaced:
        target = 'crews' if item['kind'] == 'crew' else 'pebbles'
        next(s for s in saved['sections'] if s['id'] == target)['items'].append(item)
    assigned = set()
    for c in saved['crews']:
        c['members'] = [i for i in c['members'] if i in live]
        assigned.update(c['members'])
    for s in saved['sections']:
        s['items'] = [i for i in s['items'] if i['kind'] == 'crew' or i['id'] in live]
        assigned.update(i['id'] for i in s['items'] if i['kind'] == 'pebble')
    next(s for s in saved['sections'] if s['id'] == 'pebbles')['items'] += [{'kind': 'pebble', 'id': i} for i in sorted(live-assigned)]
    return saved


def validate(value, state):
    fields(value, ['sections', 'crews'])
    sections, crews = value['sections'], value['crews']
    if not isinstance(sections, list) or not 1 <= len(sections) <= 100 or not isinstance(crews, list) or len(crews) > 100:
        raise InvalidOperation('Choose 1–100 sections and at most 100 crews')
    live = {b['id'] for b in state['bots'].values() if b.get('available') and b.get('enrolled')}
    seen, crew_ids, section_ids = set(), set(), set()
    def name(row):
        if not isinstance(row['id'], str) or not 1 <= len(row['id']) <= 80 or not isinstance(row['name'], str) or not 1 <= len(row['name'].strip()) <= 60 or type(row['collapsed']) is not bool:
            raise InvalidOperation('Invalid section or crew')
    def member(i):
        if not isinstance(i, str) or i not in live or i in seen:
            raise InvalidOperation('A pebble must appear once and belong to this installation')
        seen.add(i)
    for c in crews:
        fields(c, ['id', 'name', 'purpose', 'collapsed', 'members'])
        name(c)
        if c['id'] in crew_ids or not isinstance(c['purpose'], str) or len(c['purpose']) > 2000 or not isinstance(c['members'], list) or len(c['members']) > 1000:
            raise InvalidOperation('Invalid crew')
        crew_ids.add(c['id'])
        for i in c['members']:
            member(i)
    placed = set()
    for s in sections:
        fields(s, ['id', 'name', 'collapsed', 'items'])
        name(s)
        if s['id'] in section_ids or not isinstance(s['items'], list) or len(s['items']) > 1000:
            raise InvalidOperation('Invalid section')
        section_ids.add(s['id'])
        for item in s['items']:
            fields(item, ['kind', 'id'])
            if (s['id'] == 'crews' and item['kind'] != 'crew') or (s['id'] == 'pebbles' and item['kind'] != 'pebble'):
                raise InvalidOperation('Crews contains crews; Pebbles contains pebbles')
            if item['kind'] == 'pebble':
                member(item['id'])
            elif item['kind'] == 'crew' and isinstance(item['id'], str) and item['id'] in crew_ids and item['id'] not in placed:
                placed.add(item['id'])
            else:
                raise InvalidOperation('Invalid crew placement')
    if not {'pebbles', 'crews'} <= section_ids or any(s['name'] != {'pebbles':'Pebbles','crews':'Crews'}[s['id']] for s in sections if s['id'] in {'pebbles','crews'}):
        raise InvalidOperation('Built-in sections keep their names and purpose')
    if placed != crew_ids or seen != live:
        raise InvalidOperation('Every pebble and crew needs one sidebar placement')
    return deepcopy(value)


async def invoke(service, operation, params, state):
    if operation == 'organization.get':
        fields(params, [])
        return read(service, state)
    if operation == 'organization.save':
        fields(params, ['organization', 'expected_revision'])
        checked = validate(params['organization'], state)
        with service.store.db:
            service.store.db.execute('BEGIN IMMEDIATE')
            current = read(service, state)
            if type(params['expected_revision']) is not int or current['revision'] != params['expected_revision']:
                raise InvalidOperation('Organization changed elsewhere. Refresh before trying again.', 'STALE_REVISION')
            saved = {**checked, 'revision': current['revision'] + 1}
            service.store.db.execute("INSERT OR REPLACE INTO presentation VALUES('organization',?)", (json.dumps(saved),))
        return saved
    if operation == 'organization.chat':
        fields(params, ['id', 'expected_revision', 'confirm_new'])
        org = read(service, state)
        if org['revision'] != params['expected_revision'] or type(params['confirm_new']) is not bool:
            raise InvalidOperation('Refresh this crew before opening its chat')
        crew = next((c for c in org['crews'] if c['id'] == params['id']), None)
        if not crew or not 2 <= len(crew['members']) <= 6:
            raise InvalidOperation('Choose 2–6 pebbles in Crew settings to open this chat.')
        bots = [next(b for b in state['bots'].values() if b['id'] == i and b.get('available') and b.get('enrolled')) for i in crew['members']]
        if any(b.get('hidden') or not b.get('native_incarnation') for b in bots):
            raise InvalidOperation('Crew membership needs to be available and verified')
        fingerprint = hashlib.sha256(json.dumps(sorted((b['id'], b['native_incarnation']) for b in bots)).encode()).hexdigest()
        row = service.store.db.execute("SELECT value FROM presentation WHERE key='crew-chats'").fetchone()
        links = json.loads(row[0]) if row else {}
        previous = links.get(crew['id'])
        if previous and previous['fingerprint'] != fingerprint and not params['confirm_new']:
            return {'state': 'new_chat_required', 'message': 'Crew membership changed. Start a new chat with these pebbles? The previous chat stays in Group chats.'}
        digest = hashlib.sha256((state['id'] + ':' + crew['id'] + ':' + fingerprint).encode()).hexdigest()[:32]
        room_id = 'crew-' + digest
        try:
            found = await service.ops.invoke('room.state', {'room_id': room_id})
        except NativeError:
            try:
                await service.ops.invoke('room.create', {'room_id': room_id, 'name': crew['name'], 'profiles': [b['profile'] for b in bots]})
            except NativeError:
                # A lost acknowledgement cannot justify another room identifier.
                pass
            found = await service.ops.invoke('room.state', {'room_id': room_id})
        room = found.get('room')
        if not isinstance(room, dict) or room.get('room_id') != room_id or {m.get('profile') for m in room.get('members', [])} != {b['profile'] for b in bots}:
            raise InvalidOperation('The native crew chat could not be verified')
        links[crew['id']] = {'fingerprint': fingerprint, 'room_id': room_id, 'created_at': room.get('created_at')}
        with service.store.db:
            service.store.db.execute("INSERT OR REPLACE INTO presentation VALUES('crew-chats',?)", (json.dumps(links),))
        return {'state': 'ready', 'room': room}
    raise InvalidOperation('Organization operation unavailable')


def chat_links(service, state):
    row = service.store.db.execute("SELECT value FROM presentation WHERE key='crew-chats'").fetchone()
    links = json.loads(row[0]) if row else {}
    org = read(service, state)
    bots = {b['id']: b for b in state['bots'].values() if b.get('available')}
    result = {}
    for crew in org['crews']:
        link = links.get(crew['id'])
        if not link or any(i not in bots for i in crew['members']):
            continue
        fingerprint = hashlib.sha256(json.dumps(sorted((bots[i]['id'], bots[i].get('native_incarnation')) for i in crew['members'])).encode()).hexdigest()
        if fingerprint == link['fingerprint']:
            result[crew['id']] = link['room_id']
    return result
