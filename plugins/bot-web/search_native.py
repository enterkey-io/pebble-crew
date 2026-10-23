"""Read-only native Bot Chat search. No sessions are opened or resumed."""
import hashlib
import json
import os
from pathlib import Path


def identity(home):
    home = Path(home)
    if home.is_symlink() or not home.is_dir():
        raise ValueError('Profile unavailable')
    stat = home.stat()
    fd = os.open(home / '.pebble-crew-identity', os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        if os.fstat(stream.fileno()).st_nlink != 1:
            raise ValueError('Linked identity')
        value = json.loads(stream.read(512))
    if value.get('witness') != [stat.st_dev, stat.st_ino] or not isinstance(value.get('nonce'), str) or len(value['nonce']) != 64:
        raise ValueError('Profile changed')
    return hashlib.sha256(value['nonce'].encode()).hexdigest()


def visible_text(row, home):
    from tui_gateway import server
    import inspect
    display = server._history_to_messages
    kwargs = {'profile_home': str(home), 'image_urls': False} if 'profile_home' in inspect.signature(display).parameters else {}
    projected = display([{**row, '_row_id': row['id']}], **kwargs)
    parts = []
    from conversation_presentation import project_message
    for message in map(project_message, projected):
        if message.get('role') not in {'user', 'assistant'}:
            continue
        text = message.get('text')
        if isinstance(text, str) and text.strip():
            parts.append(text)
        elif message.get('role') == 'assistant':
            items = message.get('codex_message_items')
            if isinstance(items, str):
                try:
                    items = json.loads(items)
                except ValueError:
                    items = []
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get('type') == 'message' and item.get('role') == 'assistant' and item.get('phase') not in {'analysis', 'commentary'}:
                    parts.extend(p['text'] for p in item.get('content', []) if isinstance(p, dict) and p.get('type') in {'text', 'output_text'} and isinstance(p.get('text'), str))
    return '\n'.join(parts)


def search_database(home, query):
    from hermes_state import SessionDB
    path = Path(home) / 'state.db'
    if not path.is_file() or path.is_symlink():
        return {'hits': [], 'limited': False, 'canonical': ''}
    db = SessionDB(db_path=path, read_only=True)
    try:
        canonical = db.get_session_by_title('Bot Chat')
        if not canonical or canonical.get('archived'):
            return {'hits': [], 'limited': False, 'canonical': ''}
        root = canonical['id']
        tip = db.get_compression_tip(root) or root
        lineage = db.get_compression_lineage(tip)
        candidates, limited = {}, False
        # Search uses the native FTS index and its inactive-row filter. The
        # private implementation omits the public wrapper's query logging.
        for offset in range(0, 800, 100):
            batch = db._search_messages_impl('"'+query.replace('"', '""')+'"', role_filter=['user', 'assistant'], include_inactive=False,
                limit=100, offset=offset, fields={'id', 'session_id', 'role', 'timestamp'})
            for row in batch:
                if row['session_id'] in lineage:
                    candidates.setdefault(row['session_id'], set()).add(row['id'])
            if len(batch) < 100:
                break
        else:
            limited = True
        hits, remaining, byte_budget = [], 20000, 8 * 1024 * 1024
        for sid, ids in candidates.items():
            offset = 0
            while ids and remaining > 0 and byte_budget > 0:
                rows = db.get_messages(sid, include_inactive=False, include_compacted=True, limit=min(200, remaining), offset=offset)
                remaining -= len(rows)
                offset += len(rows)
                for row in rows:
                    if row.get('id') in ids and row.get('role') in {'user', 'assistant'}:
                        text = visible_text(row, home)
                        byte_budget -= len(text.encode('utf-8'))
                        ids.discard(row['id'])
                        if byte_budget >= 0 and text.strip() and query.casefold() in text.casefold():
                            hits.append({'id': str(row['id']), 'text': text[:100000]})
                if len(rows) < 200:
                    break
            if ids and (remaining <= 0 or byte_budget <= 0):
                limited = True
        return {'hits': hits[:40], 'limited': limited or len(hits) > 40, 'canonical': root}
    finally:
        db.close()


def register():
    from tui_gateway import server
    def search(rid, params):
        try:
            if not isinstance(params, dict) or set(params) != {'profile', 'incarnation', 'query'} or not isinstance(params['query'], str) or not 0 <= len(params['query']) <= 200:
                raise ValueError()
            from hermes_cli.profiles import get_profile_dir, list_profiles
            if params['profile'] not in {p.name for p in list_profiles()}:
                raise ValueError()
            home = Path(get_profile_dir(params['profile']))
            stamp = identity(home)
            if params['incarnation'] != stamp:
                raise ValueError()
            result = search_database(home, params['query']) if params['query'] else {'verified': True}
            if identity(home) != stamp:
                raise ValueError()
            return server._ok(rid, result)
        except Exception:
            return server._err(rid, 5081, 'Read-only search unavailable')
    server.method('bot_web.search')(search)
