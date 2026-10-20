"""Translate public mentions through a room's frozen, profile-bound native roster."""
from copy import deepcopy
import json
from pathlib import Path
import re
import sqlite3
from .operations import InvalidOperation

MENTION = re.compile(r'(?<![A-Za-z0-9_])@([A-Za-z][A-Za-z0-9_-]{1,127})(?![A-Za-z0-9_-])')


def maps(state, members):
    incoming, outgoing = {}, {}
    for member in members:
        target = member.get('target') or {'kind': 'local', 'profile': member.get('profile')}
        if target.get('kind') != 'local' or target.get('profile') != member.get('profile'):
            continue
        profile = member.get('profile')
        bot = state['bots'].get(profile)
        if not bot or not bot.get('enrolled'):
            continue
        native = member.get('handle')
        if not isinstance(native, str):
            continue
        incoming[native.lower()] = bot['handle']
        outgoing[bot['handle'].lower()] = native
        for alias, owner in state['aliases'].items():
            if owner == profile:
                outgoing[alias.lower()] = native
    return incoming, outgoing


def replace(text, mapping):
    return MENTION.sub(lambda m: '@'+mapping.get(m[1].lower(), m[1]), text)


def translate_send(state, members, text):
    _, outgoing = maps(state, members)
    known = {b['handle'].lower() for b in state['bots'].values()} | set(state['aliases'])
    for match in MENTION.finditer(text):
        if match[1].lower() in known and match[1].lower() not in outgoing:
            raise InvalidOperation('That agent is not a member of this room')
    return replace(text, outgoing)


def translate_log(state, members, result):
    incoming, _ = maps(state, members)
    result = deepcopy(result)
    for event in result.get('events', []):
        payload = event.get('payload')
        if isinstance(payload, dict) and isinstance(payload.get('text'), str):
            payload['text'] = replace(payload['text'], incoming)
    return result


def runtime_room_record(store, profile, session_id):
    from hermes_cli.profiles import get_profile_dir
    path = Path(get_profile_dir(profile)) / 'state.db'
    db = sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True, timeout=1)
    try:
        row = db.execute('SELECT source,title FROM sessions WHERE id=?', (session_id,)).fetchone()
    finally:
        db.close()
    if not row:
        return None
    source, title = row
    if not isinstance(title, str) or not title.startswith('Group: '):
        # Native creation defers the requested title until the first turn ends.
        # Use only its context-local, identity-bound record during that first turn;
        # model prose and arbitrary process-global active sessions are never evidence.
        from tui_gateway import server
        record = server._current_runtime_session_record.get() or {}
        from hermes_constants import get_process_hermes_home
        bound_home = record.get('profile_home') or get_process_hermes_home()
        if record.get('session_key') != session_id or Path(bound_home).resolve() != path.parent.resolve():
            return None
        source, title = record.get('source'), record.get('pending_title')
    if source != 'bot_room' or not isinstance(title, str) or not title.startswith('Group: '):
        return None
    room_id = title[len('Group: '):]
    # Hermes moved room coordination from state.db to shared-state.db between
    # supported builds. Resolve it through its own adapter, never a guessed filename.
    from gateway.hosted_rooms import default_db_path
    path = Path(default_db_path())
    db = sqlite3.connect(path.resolve().as_uri()+'?mode=ro', uri=True, timeout=1)
    try:
        row = db.execute('SELECT members_json,created_at FROM hosted_rooms WHERE room_id=? AND disbanded_at IS NULL', (room_id,)).fetchone()
    finally:
        db.close()
    return {'room_id': room_id, 'members': json.loads(row[0]), 'created_at': row[1]} if row else None


def runtime_room(store, profile, session_id):
    room = runtime_room_record(store, profile, session_id)
    return room['members'] if room else None
