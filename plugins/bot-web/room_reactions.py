"""Owner-local reaction overlay for immutable native Bot Mode group events.

No native transcript writes, model turns, or owner content copies. Every target
is resolved against a live native room; agents are bound by their native session.
"""
from contextlib import closing
import hashlib
import json
import sqlite3
import time
from .operations import InvalidOperation, fields, identifier


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS room_reactions(
        room_key TEXT NOT NULL, event_id TEXT NOT NULL, seq INTEGER NOT NULL,
        actor TEXT NOT NULL, emoji TEXT, updated REAL NOT NULL,
        PRIMARY KEY(room_key,event_id,actor))''')
    db.execute('CREATE TABLE IF NOT EXISTS room_reaction_versions(room_key TEXT PRIMARY KEY, revision INTEGER NOT NULL)')


def native_db():
    from gateway.hosted_rooms import default_db_path
    from pathlib import Path
    return sqlite3.connect(Path(default_db_path()).resolve().as_uri()+'?mode=ro', uri=True, timeout=2)


def room(db, room_id):
    row = db.execute('SELECT created_at,members_json FROM hosted_rooms WHERE room_id=? AND disbanded_at IS NULL', (identifier(room_id),)).fetchone()
    if not row:
        raise InvalidOperation('This group chat is no longer available')
    members = json.loads(row[1])
    key = hashlib.sha256(json.dumps([room_id, row[0], members], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'id': room_id, 'key': key, 'members': members, 'created_at': row[0]}


def receipt(store, target, event_id):
    state = store.read()
    bots = {b['id']: b for b in state['bots'].values()}
    reactions = []
    for actor, chosen in store.db.execute('SELECT actor,emoji FROM room_reactions WHERE room_key=? AND event_id=? AND emoji IS NOT NULL ORDER BY actor', (target['key'], event_id)):
        bot = bots.get(actor)
        if actor != 'owner' and not bot:
            continue
        reactions.append({'emoji': chosen, 'author': 'user' if actor == 'owner' else 'agent',
            'actor': actor, 'name': 'You' if actor == 'owner' else bot['name']})
    version = store.db.execute('SELECT revision FROM room_reaction_versions WHERE room_key=?', (target['key'],)).fetchone()
    return {'event_id': event_id, 'reactions': reactions, 'revision': version[0] if version else 0, 'room_key': target['key']}


def set_reaction(store, target, db, actor, chosen, *, event_id=None, messages_back=0):
    from .reactions import emoji
    try:
        chosen = emoji(chosen, clear=True)
    except ValueError as error:
        raise InvalidOperation(str(error)) from error
    if event_id is not None:
        row = db.execute("SELECT event_id,seq FROM hosted_room_events WHERE room_id=? AND event_id=? AND kind IN ('message.user','message.member')", (target['id'], identifier(event_id))).fetchone()
    else:
        if type(messages_back) is not int or not 0 <= messages_back <= 1000:
            raise InvalidOperation('Invalid reaction target')
        row = db.execute("SELECT event_id,seq FROM hosted_room_events WHERE room_id=? AND kind='message.user' ORDER BY seq DESC LIMIT 1 OFFSET ?", (target['id'], messages_back)).fetchone()
    if not row:
        raise InvalidOperation('That message is not in this group chat')
    with store.db:
        store.db.execute('INSERT INTO room_reaction_versions VALUES(?,1) ON CONFLICT(room_key) DO UPDATE SET revision=revision+1', (target['key'],))
        store.db.execute('INSERT INTO room_reactions VALUES(?,?,?,?,?,?) ON CONFLICT(room_key,event_id,actor) DO UPDATE SET emoji=excluded.emoji,updated=excluded.updated',
            (target['key'], row[0], row[1], actor, chosen, time.time()))
    return receipt(store, target, row[0])


def owner_react(store, params):
    fields(params, ['room_id', 'event_id', 'emoji'])
    with closing(native_db()) as db:
        return set_reaction(store, room(db, params['room_id']), db, 'owner', params['emoji'], event_id=params['event_id'])


def agent_react(store, profile, native_room, args):
    if not isinstance(args, dict) or set(args) - {'emoji', 'message_event_id', 'messages_back'} or 'emoji' not in args or ('message_event_id' in args and 'messages_back' in args):
        raise InvalidOperation('Use a group event id or a user-message offset')
    if 'message_event_id' in args:
        identifier(args['message_event_id'])
    identity = store.read()['bots'][profile]
    with closing(native_db()) as db:
        target = room(db, native_room['room_id'])
        if native_room['created_at'] != target['created_at']:
            raise InvalidOperation('This group chat was replaced')
        if not any(m.get('profile') == profile and (m.get('target') or {'kind': 'local', 'profile': profile}) == {'kind': 'local', 'profile': profile} for m in target['members']):
            raise InvalidOperation('Verified group membership required')
        return set_reaction(store, target, db, identity['id'], args['emoji'], event_id=args.get('message_event_id'), messages_back=args.get('messages_back', 0))


def project(store, room_id, result):
    from gateway.response_filters import is_intentional_silence_response
    with closing(native_db()) as db:
        target = room(db, room_id)
    updates = [receipt(store, target, row[0]) for row in store.db.execute(
        'SELECT event_id FROM room_reactions WHERE room_key=? GROUP BY event_id ORDER BY MAX(seq) DESC LIMIT 1000', (target['key'],))]
    known = {r['event_id']: r['reactions'] for r in updates}
    events = []
    for event in result.get('events', []):
        if event.get('kind') in {'message.user', 'message.member'}:
            payload = event.get('payload', {})
            payload = {**payload, 'reactions': known.get(event.get('event_id'), [])}
            if event.get('kind') == 'message.member' and is_intentional_silence_response(payload.get('text')):
                payload['text'] = ''
            event = {**event, 'payload': payload}
        events.append(event)
    version = store.db.execute('SELECT revision FROM room_reaction_versions WHERE room_key=?', (target['key'],)).fetchone()
    return {**result, 'events': events, 'reaction_updates': updates, 'reaction_revision': version[0] if version else 0, 'room_key': target['key']}


def feedback(store, native_room):
    with closing(native_db()) as db:
        target = room(db, native_room['room_id'])
        events = []
        for event_id, in store.db.execute('SELECT event_id FROM room_reactions WHERE room_key=? GROUP BY event_id ORDER BY MAX(updated) DESC LIMIT 20', (target['key'],)):
            reactions = receipt(store, target, event_id)['reactions']
            if not reactions:
                continue
            row = db.execute('SELECT payload_json FROM hosted_room_events WHERE room_id=? AND event_id=?', (target['id'], event_id)).fetchone()
            if row:
                events.append({'event_id': event_id, 'text': str(json.loads(row[0]).get('text', ''))[:400], 'reactions': reactions})
    return events
