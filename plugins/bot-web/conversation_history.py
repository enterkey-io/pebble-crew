"""Bounded display pages over Hermes's own deduplicated transcript projection.

Cursors address a durable row in the bound native conversation, never an offset
that a new message can shift. They grant no access outside that conversation.
"""
import base64
import inspect
import json

PAGE_ROWS = 60
PAGE_BYTES = 2 * 1024 * 1024
DISPLAY_KEYS = frozenset({'role', 'text', 'row_id', 'timestamp', 'name', 'tool_name',
    'tool_call_id', 'context', 'display_kind', 'display_metadata', 'display_commentary',
    'codex_message_items'})


def cursor(key, row_id):
    return base64.urlsafe_b64encode(json.dumps([1, key, row_id], separators=(',', ':')).encode()).decode().rstrip('=')


def boundary(value, key):
    if value is None:
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= 1024:
        raise ValueError('Invalid history cursor')
    try:
        version, bound, row = json.loads(base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True))
    except (ValueError, TypeError):
        raise ValueError('Invalid history cursor') from None
    if type(version) is not int or version != 1 or bound != key or type(row) is not int or not 0 < row <= 9007199254740991:
        raise ValueError('History cursor belongs to another conversation')
    return row


def display_rows(server, rows, home):
    from conversation_presentation import project_message
    # Both supported native versions own image/skill/commentary projections.
    display = server._history_to_messages
    options = {'profile_home': home, 'image_urls': False} if 'image_urls' in inspect.signature(display).parameters else {}
    def compact_content(content):
        if not isinstance(content, list):
            return content
        return [{'type': 'text', 'text': '[image]'} if isinstance(part, dict) and part.get('type') in {'image_url', 'input_image', 'image'} else part for part in content]
    native = [{**row, 'content': compact_content(row.get('content')), '_row_id': row['id']} for row in rows]
    tools = {row.get('tool_call_id'): row['id'] for row in rows if row.get('role') == 'tool' and row.get('tool_call_id')}
    projected = {}
    tool_rows = iter(row['id'] for row in rows if row.get('role') == 'tool' and row.get('display_kind') != 'hidden')
    for value in display(native, **options):
        if value.get('role') == 'tool':
            tool_row = next(tool_rows, None)
            if tool_row is not None:
                value = {**value, 'row_id': tool_row}
        item = project_message(value)
        item = {k: v for k, v in item.items() if k in DISPLAY_KEYS}
        metadata = item.get('display_metadata')
        if isinstance(metadata, dict):
            item['display_metadata'] = {'reactions': metadata.get('reactions', [])}
        sidecar = item.get('codex_message_items')
        if item.get('text'):
            item.pop('codex_message_items', None)
        elif sidecar:
            try:
                items = json.loads(sidecar) if isinstance(sidecar, str) else sidecar
                item['codex_message_items'] = [part for part in items if isinstance(part, dict)
                    and part.get('type') == 'message' and part.get('role') == 'assistant'
                    and part.get('phase') not in {'analysis', 'commentary'}] if isinstance(items, list) else []
            except ValueError:
                item['codex_message_items'] = []
        if item.get('role') == 'tool' and item.get('tool_call_id') in tools:
            item['row_id'] = tools[item['tool_call_id']]
        if type(item.get('row_id')) is int:
            projected[item['row_id']] = item
    return [projected.get(row['id'], {'role': 'system', 'row_id': row['id']}) for row in rows]


def read_page(server, session, before=None):
    key = server._submit_row_target_key(session) if hasattr(server, '_submit_row_target_key') else (getattr(session.get('agent'), 'session_id', None) or session.get('session_key'))
    if not key:
        return {'messages': [], 'history_page': {'older': None}}
    with server._session_db(session) as db:
        if db is None:
            raise ValueError('Native history unavailable')
        lineage = db.get_compression_lineage(key)
        if not lineage:
            raise ValueError('Native conversation unavailable')
        bound_key = lineage[0]
        row_id = boundary(before, bound_key)
        # Use native ordering, compaction deduplication and inactive-row rules.
        # Scanning to a cursor happens only on demand and retains one page. No
        # transcript payload crosses stdio until after display projection.
        options = inspect.signature(db.get_messages).parameters
        legacy = None
        if 'include_ancestors' not in options and 'kwargs' not in options and not any(p.kind == inspect.Parameter.VAR_KEYWORD for p in options.values()):
            # Legacy Hermes has no lineage paging API. Retain its canonical
            # ancestor/deduplication semantics, but never serialize that full
            # display history into stdio/HTTP or retain it on the phone.
            legacy = [{**row, 'id': row['_row_id']} for row in db.get_messages_as_conversation(
                key, include_ancestors=True, include_row_ids=True) if type(row.get('_row_id')) is int]
        offset, selected, found = 0, [], row_id is None
        while True:
            batch = legacy[::-1][offset:][:PAGE_ROWS + 1][::-1] if legacy is not None else db.get_messages(
                key, include_compacted=True, include_ancestors=True, latest=True, limit=PAGE_ROWS + 1, offset=offset)
            if not batch:
                if not found:
                    raise ValueError('History changed; reload its earlier pages')
                break
            if not found:
                index = next((i for i, row in enumerate(batch) if row['id'] == row_id), None)
                if index is not None:
                    selected = batch[:index]
                    found = True
            else:
                selected = batch + selected
            if found and (len(selected) > PAGE_ROWS or len(batch) < PAGE_ROWS + 1):
                break
            if len(batch) < PAGE_ROWS + 1:
                if not found:
                    raise ValueError('History changed; reload its earlier pages')
                break
            offset += len(batch)
        more = len(selected) > PAGE_ROWS
        chosen = selected[-PAGE_ROWS:]
        messages = display_rows(server, chosen, session.get('profile_home'))
        # Never omit a row merely because the byte budget ends. Its cursor is
        # left for the next page, including rows with no visible human text.
        size = 0
        kept = []
        for message in reversed(messages):
            cost = len(json.dumps(message, ensure_ascii=False).encode())
            if kept and size + cost > PAGE_BYTES:
                more = True
                break
            kept.append(message)
            size += cost
        messages = list(reversed(kept))
        first = next((m.get('row_id') for m in messages if type(m.get('row_id')) is int), None)
        if messages and more and first is None:
            raise ValueError('Native history has no durable page boundary')
        return {'messages': messages, 'history_page': {'older': cursor(bound_key, first) if more and first else None}}
