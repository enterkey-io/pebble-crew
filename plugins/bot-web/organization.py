"""Sidebar organization, independent of profile roles and native chat membership."""
from copy import deepcopy
from contextlib import nullcontext
import hashlib
import json
from .operations import InvalidOperation, fields
from .native import NativeError


SCHEMA = 2


def _migrate(saved):
    migrated = deepcopy(saved)
    sections = migrated['sections']
    root = {'id': 'pebbles', 'name': 'Pebbles', 'collapsed': False,
            'items': [item for section in sections if section['id'] in {'pebbles', 'crews'} for item in section['items']]}
    migrated['sections'] = [root] + [s for s in sections if s['id'] not in {'pebbles', 'crews'}]
    migrated['schema'] = SCHEMA
    for crew in migrated['crews']:
        crew['managerId'] = None
    return migrated


def read(service, state):
    row = service.store.db.execute("SELECT value FROM presentation WHERE key='organization'").fetchone()
    if row:
        saved = json.loads(row[0])
        if saved.get('schema', 1) == 1:
            migrated = _migrate(saved)
            migrated['revision'] = saved['revision'] + 1
            with (nullcontext() if service.store.db.in_transaction else service.store.db):
                service.store.db.execute("INSERT OR IGNORE INTO presentation VALUES('organization-v1-backup',?)", (row[0],))
                service.store.db.execute("UPDATE presentation SET value=? WHERE key='organization' AND value=?", (json.dumps(migrated), row[0]))
            saved = json.loads(service.store.db.execute("SELECT value FROM presentation WHERE key='organization'").fetchone()[0])
        if saved.get('schema') != SCHEMA:
            raise InvalidOperation('This sidebar requires a compatible Pebble Crew update', 'REQUIRES_SETUP')
    else:
        members = {b['id'] for b in state['bots'].values() if b.get('available') and b.get('enrolled')}
        crews = [{'id': t['id'], 'name': t['name'], 'purpose': '', 'collapsed': False, 'managerId': None,
                  'members': [b['id'] for b in state['bots'].values() if b['id'] in members and b.get('team') == t['id']]}
                 for t in state['teams']]
        assigned = {i for c in crews for i in c['members']}
        saved = {'schema': SCHEMA, 'revision': 0, 'sections': [
            {'id': 'pebbles', 'name': 'Pebbles', 'collapsed': False,
             'items': [{'kind': 'pebble', 'id': i} for i in sorted(members-assigned)] +
                      [{'kind': 'crew', 'id': c['id']} for c in crews]}], 'crews': crews}
    return reconcile(saved, state)


def reconcile(saved, state):
    saved = deepcopy(saved)
    live = {b['id'] for b in state['bots'].values() if b.get('available') and b.get('enrolled')}
    reachable = set()
    for c in saved['crews']:
        c['members'] = [i for i in c['members'] if i in live]
        if c.get('managerId') not in c['members']:
            c['managerId'] = None
        reachable.update(c['members'])
    for section in saved['sections']:
        section['items'] = [i for i in section['items'] if i['kind'] == 'crew' or i['id'] in live]
        reachable.update(i['id'] for i in section['items'] if i['kind'] == 'pebble')
    root = next(s for s in saved['sections'] if s['id'] == 'pebbles')
    root['items'] += [{'kind': 'pebble', 'id': i} for i in sorted(live-reachable)]
    return saved


def validate(value, state):
    if not isinstance(value, dict) or value.get('schema') != SCHEMA:
        raise InvalidOperation('Reload Pebble Crew before changing this sidebar', 'REQUIRES_SETUP')
    fields(value, ['schema', 'sections', 'crews'])
    sections, crews = value['sections'], value['crews']
    if not isinstance(sections, list) or not 1 <= len(sections) <= 100 or not isinstance(crews, list) or len(crews) > 100:
        raise InvalidOperation('Choose 1–100 sidebar containers and at most 100 crews')
    live = {b['id'] for b in state['bots'].values() if b.get('available') and b.get('enrolled')}
    reachable, standalone, crew_ids, section_ids, assigned = set(), set(), set(), set(), set()
    def name(row):
        if not isinstance(row['id'], str) or not 1 <= len(row['id']) <= 80 or not isinstance(row['name'], str) or not 1 <= len(row['name'].strip()) <= 60 or type(row['collapsed']) is not bool:
            raise InvalidOperation('Invalid section or crew')
    for crew in crews:
        fields(crew, ['id', 'name', 'purpose', 'collapsed', 'members', 'managerId'])
        name(crew)
        if crew['id'] in crew_ids or not isinstance(crew['purpose'], str) or len(crew['purpose']) > 2000 or not isinstance(crew['members'], list) or len(crew['members']) > 1000:
            raise InvalidOperation('Invalid crew')
        crew_ids.add(crew['id'])
        seen = set()
        for member in crew['members']:
            if not isinstance(member, str) or member not in live or member in seen or member in assigned:
                raise InvalidOperation('Crew members must be unique agents in this installation')
            seen.add(member)
        if crew['managerId'] is not None and (not isinstance(crew['managerId'], str) or crew['managerId'] not in seen):
            raise InvalidOperation('Choose a Crew member as its manager')
        reachable.update(seen)
        assigned.update(seen)
    placed = set()
    for section in sections:
        fields(section, ['id', 'name', 'collapsed', 'items'])
        name(section)
        if section['id'] in section_ids or section['id'] == 'crews' or not isinstance(section['items'], list) or len(section['items']) > 1000:
            raise InvalidOperation('Invalid section')
        section_ids.add(section['id'])
        for item in section['items']:
            fields(item, ['kind', 'id'])
            ident = item['id']
            if not isinstance(ident, str):
                raise InvalidOperation('Invalid sidebar reference')
            if item['kind'] == 'pebble' and ident in live and ident not in standalone:
                standalone.add(ident)
                reachable.add(ident)
            elif item['kind'] == 'crew' and ident in crew_ids and ident not in placed:
                placed.add(ident)
            else:
                raise InvalidOperation('Each standalone row and Crew can have one sidebar placement')
    root = next((section for section in sections if section['id'] == 'pebbles'), None)
    if root is None or root['name'] != 'Pebbles':
        raise InvalidOperation('The unsectioned list must remain available')
    if placed != crew_ids or reachable != live:
        raise InvalidOperation('Keep every pebble and Crew reachable in the sidebar')
    return deepcopy(value)


def leadership(store, state, profile):
    class Context:
        pass
    context = Context()
    context.store = store
    org = read(context, state)
    by_id = {b['id']: (name, b) for name, b in state['bots'].items() if b.get('available') and b.get('enrolled')}
    identity = state['bots'][profile]['id']
    def public(ident):
        pair = by_id.get(ident)
        return {'id': ident, 'profile': pair[0], 'handle': '@'+pair[1]['handle']} if pair else None
    return {'revision': org['revision'], 'crews': [
        {'id': c['id'], 'name': c['name'], 'purpose': c['purpose'], 'manager': public(c['managerId']),
         'you_are_manager': c['managerId'] == identity, 'member_ids':c['members']}
        for c in org['crews'] if identity in c['members'] or state.get('orchestrator') == profile],
        'policy': 'Crew managers coordinate Crew work and purpose. Crew leadership does not change reporting lines or grant owner permissions.'}


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


def update_crew(store, profile, spec):
    fields(spec,['id','name','purpose','manager_id','members','expected_revision'])
    class Context:
        pass
    context=Context();context.store=store
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        state=store.read()
        if profile != state.get('orchestrator'):
            raise InvalidOperation('Only the current Main Pebble can manage Crews directly')
        org=read(context,state)
        if type(spec['expected_revision']) is not int or org['revision'] != spec['expected_revision']:
            raise InvalidOperation('Describe the current Crew before changing it','STALE_REVISION')
        target=next((c for c in org['crews'] if c['id']==spec['id']),None)
        if not target:
            raise InvalidOperation('Choose an existing Crew')
        changed=deepcopy(org)
        changed.pop('revision')
        target=next(c for c in changed['crews'] if c['id']==spec['id'])
        target.update(name=spec['name'],purpose=spec['purpose'],managerId=spec['manager_id'],members=spec['members'])
        # A manager edit cannot make a removed member disappear from the interface.
        reachable={m for c in changed['crews'] for m in c['members']} | {i['id'] for s in changed['sections'] for i in s['items'] if i['kind']=='pebble'}
        root=next(s for s in changed['sections'] if s['id']=='pebbles')
        for b in state['bots'].values():
            if b.get('enrolled') and b.get('available') and b['id'] not in reachable:
                root['items'].append({'kind':'pebble','id':b['id']})
        saved={**validate(changed,state),'revision':org['revision']+1}
        store.db.execute("INSERT OR REPLACE INTO presentation VALUES('organization',?)",(json.dumps(saved),))
    return {'state':'completed','organization_revision':saved['revision'],'crew_id':spec['id']}
