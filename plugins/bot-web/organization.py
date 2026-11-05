"""Presentation-only sections and stable placements. This module has no native mutation capability."""
from copy import deepcopy
from contextlib import nullcontext
import hashlib
import json
from .operations import InvalidOperation, fields, identifier
from .work_store import operation_id as checked_operation_id, fingerprint

SCHEMA = 3
ROOT = 'pebbles'


def reference_id(*parts):
    return 'row-' + hashlib.sha256(json.dumps(parts, separators=(',', ':')).encode()).hexdigest()[:32]


def direct(ident, *placement, shortcut=False):
    return {'kind': 'pebble', 'id': ident, 'placementId': reference_id('direct', *placement, ident), 'shortcut': shortcut}


def _convert(saved):
    """Preserve old list/shortcut occurrences, without retaining department semantics."""
    crews = {c['id']: c for c in saved.get('crews', [])}
    sections, seen_crews = [], set()
    legacy_sections = saved['sections']
    root = {'id': ROOT, 'name': 'Pebbles', 'collapsed': False, 'items': []}
    for section in legacy_sections:
        target = root if section['id'] in {ROOT, 'crews'} else {**section, 'items': []}
        converted = []
        for index, item in enumerate(section['items']):
            if item['kind'] == 'pebble':
                member = any(item['id'] in c['members'] for c in crews.values())
                target['items'].append(direct(item['id'], section['id'], index, shortcut=member))
            elif item['kind'] == 'crew' and item['id'] in crews and item['id'] not in seen_crews:
                seen_crews.add(item['id'])
                crew = crews[item['id']]
                converted.append({'id': 'section-' + reference_id('crew', crew['id'])[4:],
                    'name': crew['name'], 'collapsed': bool(crew.get('collapsed')), 'items': [
                        direct(member, 'crew', crew['id'], offset) for offset, member in enumerate(crew['members'])]})
        if target is not root:
            sections.append(target)
        sections.extend(converted)
    for crew in crews.values():
        if crew['id'] not in seen_crews:
            sections.append({'id': 'section-' + reference_id('crew', crew['id'])[4:], 'name': crew['name'],
                'collapsed': bool(crew.get('collapsed')), 'items': [direct(member, 'crew', crew['id'], offset) for offset, member in enumerate(crew['members'])]})
    return {'schema': SCHEMA, 'revision': saved.get('revision', 0) + 1, 'sections': [root] + sections}


def _initial(state):
    crews = [{'id': t['id'], 'name': t['name'], 'collapsed': False,
        'members': [b['id'] for b in state['bots'].values() if b.get('enrolled') and b.get('team') == t['id']]}
        for t in state.get('teams', [])]
    assigned = {i for c in crews for i in c['members']}
    old = {'revision': -1, 'sections': [{'id': ROOT, 'name': 'Pebbles', 'collapsed': False, 'items':
        [{'kind': 'pebble', 'id': b['id']} for b in state['bots'].values() if b.get('enrolled') and b['id'] not in assigned] +
        [{'kind': 'crew', 'id': c['id']} for c in crews]}], 'crews': crews}
    return _convert(old)


def read(store, state):
    db = store.db
    row = db.execute("SELECT value FROM presentation WHERE key='organization'").fetchone()
    if row:
        saved = json.loads(row[0])
        if saved.get('schema', 1) == SCHEMA:
            return reconcile(saved, state)
        if saved.get('schema', 1) not in {1, 2}:
            raise InvalidOperation('This sidebar requires a compatible Pebble Crew update', 'UPDATE_REQUIRED')
        converted = _convert(saved)
    else:
        converted = _initial(state)
    # Persist the retirement barrier and exact rollback provenance in one SQLite transaction.
    with (nullcontext() if db.in_transaction else db):
        if row:
            changed = db.execute("UPDATE presentation SET value=? WHERE key='organization' AND value=?", (json.dumps(converted), row[0])).rowcount
        else:
            changed = db.execute("INSERT OR IGNORE INTO presentation VALUES('organization',?)", (json.dumps(converted),)).rowcount
        if changed:
            links = db.execute("SELECT value FROM presentation WHERE key='crew-chats'").fetchone()
            archive = {'organization': row[0] if row else None, 'crew_chats': links[0] if links else None, 'teams': deepcopy(state.get('teams', []))}
            db.execute("INSERT OR IGNORE INTO presentation VALUES('sidebar-before-sections',?)", (json.dumps(archive),))
            db.execute("INSERT OR REPLACE INTO presentation VALUES('sidebar-retirement',?)", (json.dumps({'schema': SCHEMA}),))
    current = json.loads(db.execute("SELECT value FROM presentation WHERE key='organization'").fetchone()[0])
    if current.get('schema') != SCHEMA:
        raise InvalidOperation('Sidebar changed during conversion. Retry.', 'STALE_REVISION')
    return reconcile(current, state)


def reconcile(saved, state, rooms=None):
    """Join available identities without deleting references based on a partial catalog."""
    value = deepcopy(saved)
    root = next(s for s in value['sections'] if s['id'] == ROOT)
    direct_ids = {item['id'] for section in value['sections'] for item in section['items'] if item['kind'] == 'pebble'}
    for bot in state['bots'].values():
        if bot.get('enrolled') and bot.get('available') and not bot.get('deleted') and bot['id'] not in direct_ids:
            root['items'].append(direct(bot['id']))
    groups = {item['readKey'] for section in value['sections'] for item in section['items'] if item['kind'] == 'group'}
    for room in rooms or []:
        if room.get('read_key') and room['read_key'] not in groups:
            root['items'].append({'kind': 'group', 'id': room['room_id'], 'readKey': room['read_key'],
                'placementId': reference_id('group', room['read_key'])})
            groups.add(room['read_key'])
    return value


def validate(value, state, existing):
    if not isinstance(value, dict) or value.get('schema') != SCHEMA:
        raise InvalidOperation('Reload Pebble Crew before changing this sidebar', 'UPDATE_REQUIRED')
    fields(value, ['schema', 'sections'])
    sections = value['sections']
    if not isinstance(sections, list) or not 1 <= len(sections) <= 100:
        raise InvalidOperation('Choose 1–100 sections')
    sections_seen, placements = set(), set()
    known = {b['id'] for b in state['bots'].values()} | {
        i['id'] for s in existing['sections'] for i in s['items'] if i['kind'] == 'pebble'}
    count = 0
    for section in sections:
        fields(section, ['id', 'name', 'collapsed', 'items'])
        identifier(section['id'])
        if section['id'] in sections_seen or section['id'] == 'crews' or not isinstance(section['name'], str) or not 1 <= len(section['name'].strip()) <= 60 or type(section['collapsed']) is not bool or not isinstance(section['items'], list):
            raise InvalidOperation('Choose a valid section')
        sections_seen.add(section['id'])
        for item in section['items']:
            if not isinstance(item, dict) or item.get('kind') not in {'pebble', 'group'}:
                raise InvalidOperation('Choose a direct or group conversation')
            fields(item, ['kind', 'id', 'placementId'] + (['shortcut'] if item['kind'] == 'pebble' else ['readKey']))
            identifier(item['placementId'])
            if not isinstance(item['id'], str) or not 1 <= len(item['id']) <= 128 or item['placementId'] in placements:
                raise InvalidOperation('Sidebar placements need distinct identities')
            if item['kind'] == 'pebble':
                if item['id'] not in known or type(item['shortcut']) is not bool:
                    raise InvalidOperation('Choose a known pebble')
            elif not isinstance(item['readKey'], str) or not item['readKey'].startswith('room:' + item['id'] + ':') or len(item['readKey']) > 512:
                raise InvalidOperation('Keep the original group conversation identity')
            placements.add(item['placementId'])
            count += 1
    root = next((s for s in sections if s['id'] == ROOT), None)
    if count > 5000 or root is None or root['name'] != 'Pebbles':
        raise InvalidOperation('Keep the unnamed list available')
    return deepcopy(value)


def save(store, state, value, expected, operation, *, command_hash=None):
    checked_operation_id(operation)
    payload_hash = command_hash or fingerprint({'organization': value, 'expected_revision': expected})
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        prior = store.db.execute('SELECT value FROM presentation WHERE key=?', ('sidebar-operation:' + operation,)).fetchone()
        if prior:
            prior = json.loads(prior[0])
            if prior['hash'] != payload_hash:
                raise InvalidOperation('Operation ID was reused for another layout', 'STALE_REVISION')
            return prior['result']
        current = read(store, state)
        if type(expected) is not int or current['revision'] != expected:
            raise InvalidOperation('Sidebar changed elsewhere. Review before trying again.', 'STALE_REVISION')
        checked = validate(value, state, current)
        saved = {**checked, 'revision': current['revision'] + 1}
        store.db.execute("UPDATE presentation SET value=? WHERE key='organization'", (json.dumps(saved),))
        store.db.execute('INSERT INTO presentation VALUES(?,?)', ('sidebar-operation:' + operation, json.dumps({'hash': payload_hash, 'result': saved})))
    return saved


async def invoke(service, operation, params, state):
    if operation == 'organization.get':
        fields(params, [])
        return read(service.store, state)
    if operation == 'organization.save':
        fields(params, ['organization', 'expected_revision', 'operation_id'])
        return save(service.store, state, params['organization'], params['expected_revision'], params['operation_id'])
    raise InvalidOperation('Crews were replaced by sections and explicit group chats. Reload Pebble Crew.', 'UPDATE_REQUIRED')


def agent_edit(store, actor, action, spec):
    """An enrolled owner-conversation caller may arrange presentation, never room membership."""
    state = store.read()
    bot = state['bots'].get(actor)
    if not bot or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
        raise InvalidOperation('Verified enrolled agent required', 'FORBIDDEN')
    current = read(store, state)
    command_hash = fingerprint({'actor': bot['id'], 'action': action, 'spec': spec})
    if 'operation_id' in spec:
        checked_operation_id(spec['operation_id'])
        prior = store.db.execute('SELECT value FROM presentation WHERE key=?', ('sidebar-operation:' + spec['operation_id'],)).fetchone()
        if prior:
            prior = json.loads(prior[0])
            if prior['hash'] != command_hash:
                raise InvalidOperation('Operation ID was reused for another command', 'STALE_REVISION')
            return prior['result']
    if action == 'sidebar.describe':
        fields(spec, [])
        return current
    common = ['operation_id', 'expected_revision']
    if action == 'sidebar.section.create':
        fields(spec, common + ['name'])
        changed = deepcopy(current)
        section_id = 'section-' + str(spec['operation_id'])
        changed['sections'].append({'id': section_id, 'name': spec['name'], 'collapsed': False, 'items': []})
    elif action == 'sidebar.move':
        fields(spec, common + ['placement_id', 'section_id', 'before_id'])
        changed = deepcopy(current)
        item = next((i for s in changed['sections'] for i in s['items'] if i['placementId'] == spec['placement_id']), None)
        target = next((s for s in changed['sections'] if s['id'] == spec['section_id']), None)
        if not item or target is None:
            raise InvalidOperation('Describe the current sidebar first', 'STALE_REVISION')
        for section in changed['sections']:
            section['items'] = [i for i in section['items'] if i['placementId'] != item['placementId']]
        if spec['before_id'] is None:
            target['items'].append(item)
        else:
            index = next((n for n, i in enumerate(target['items']) if i['placementId'] == spec['before_id']), None)
            if index is None:
                raise InvalidOperation('The destination row changed', 'STALE_REVISION')
            target['items'].insert(index, item)
    else:
        raise InvalidOperation('Sidebar operation unavailable')
    changed.pop('revision')
    return save(store, state, changed, spec['expected_revision'], spec['operation_id'], command_hash=command_hash)
