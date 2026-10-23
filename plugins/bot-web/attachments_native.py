"""Fixed attachment helpers at Hermes's extension seam; no native method is replaced."""
import base64
import hashlib
import json
from urllib.parse import unquote, urlsplit
import os
import stat
from pathlib import Path
import re

def register():
    from tui_gateway import server

    def attachment(rid, params):
        try:
            action = params.get('action')
            allowed = {'session_id', 'action', 'ids'} if action in {'pending', 'discard'} else {'session_id', 'action', 'id', 'content_base64', 'filename'}
            if set(params) != allowed:
                raise ValueError()
            session, error = server._sess_building(params, rid)
            if error:
                return error
            if action in {'pending', 'discard'}:
                ids = params['ids']
                if not isinstance(ids, list) or len(ids) > 5 or any(not re.fullmatch(r'[A-Za-z0-9_-]{43}', str(value)) for value in ids):
                    raise ValueError()
                prefixes = tuple('pebble_' + value + '_' for value in ids)
                queued = [path for path in session.get('attached_images', []) if Path(path).name.startswith(prefixes)] if prefixes else []
                if action == 'discard':
                    if session.get('running'):
                        raise ValueError('A turn is still running')
                    session['attached_images'] = [path for path in session.get('attached_images', []) if path not in queued]
                return server._ok(rid, {'running': bool(session.get('running')), 'pending': [value for value in ids if any(Path(path).name.startswith('pebble_' + value + '_') for path in queued)]})
            if action not in {'image', 'file'} or not re.fullmatch(r'[A-Za-z0-9_-]{43}', str(params['id'])):
                raise ValueError()
            data = base64.b64decode(params['content_base64'], validate=True)
            if not 0 < len(data) <= 10 * 1024 * 1024:
                raise ValueError()
            if action == 'file':
                name = params['id'] + '_' + Path(params['filename']).name
                root = server._session_home_dir(session, 'attachments') if hasattr(server, '_session_home_dir') else server._desktop_attachment_dir(session)
                target = root / server._sanitize_attachment_name(name)
                if target.exists() or target.is_symlink():
                    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(fd, 'rb') as saved:
                        metadata = os.fstat(saved.fileno())
                        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != len(data) or hashlib.sha256(saved.read(len(data)+1)).digest() != hashlib.sha256(data).digest():
                            raise ValueError()
                    ref = server._attachment_ref_path(session, target)
                    return server._ok(rid, {'attached': True, 'ref_text': '@file:' + server._format_ref_value(ref)})
                return server._methods['file.attach'](rid, {'session_id': params['session_id'], 'data_url': 'data:application/octet-stream;base64,' + params['content_base64'], 'name': name})
            existing = next((p for p in session.get('attached_images', []) if Path(p).name.startswith('pebble_' + params['id'] + '_')), None)
            if existing:
                return server._ok(rid, {'attached': True, 'path': existing})
            ext = server._sniff_image_ext(data, params['filename'])
            if ext not in {'.png', '.jpg', '.jpeg', '.webp'}:
                raise ValueError()
            path = server._queue_attached_image(session, data, ext, prefix='pebble_' + params['id'])
            return server._ok(rid, {'attached': True, 'path': str(path)})
        except Exception:
            return server._err(rid, 5071, 'Attachment state not confirmed')
    server.method('bot_web.attachments')(attachment)
    _register_generated()
    _register_catalog()


CHUNK_BYTES = 1024 * 1024
MAX_BYTES = 10 * CHUNK_BYTES
CACHE_NAMES = {'images', 'audio', 'videos', 'documents', 'screenshots', 'generated'}
LEGACY_ROOTS = {'image_cache', 'audio_cache', 'video_cache', 'document_cache', 'browser_screenshots'}
PRIVATE_NAMES = {'auth.json', 'config.yaml', 'credentials.json', 'state.db', 'shared-state.db',
                 'connection.json', 'install.json', 'profile.yaml', 'google_token.json'}


def normalize_reference(value):
    if not isinstance(value, str) or not 0 < len(value) <= 4096:
        raise ValueError('Invalid reference')
    if re.search(r'%(?![0-9A-Fa-f]{2})', value):
        raise ValueError('Invalid escape')
    value = unquote(value, errors='strict')
    if re.search(r'[\x00-\x1f\x7f]', value):
        raise ValueError('Invalid reference')
    return value


def reference_key(value):
    return hashlib.sha256(normalize_reference(value).encode()).hexdigest()


def media_line(value):
    match = re.fullmatch(r'\s*MEDIA:\s*(.+?)\s*', value)
    if not match:
        return None
    value = match[1]
    if len(value) > 1 and (value[0], value[-1]) in {('"', '"'), ("'", "'"), ('<', '>')}:
        value = value[1:-1]
    return value


def references(text):
    from markdown_it import MarkdownIt
    if not isinstance(text, str) or len(text.encode()) > 1024 * 1024:
        raise ValueError('Message too large')
    result = []
    parser = MarkdownIt()
    validate_link = parser.validateLink
    parser.validateLink = lambda value: value.startswith('file:') or validate_link(value)
    tokens = parser.parse(text)
    for index, token in enumerate(tokens):
        if token.type != 'inline':
            continue
        children = token.children or []
        for child_index, child in enumerate(children):
            if child.type in {'image', 'link_open'}:
                value = child.attrGet('src' if child.type == 'image' else 'href')
                if value:
                    result.append(value)
            elif (child.type == 'text' and index and tokens[index - 1].type == 'paragraph_open'
                  and (child_index == 0 or children[child_index - 1].type in {'softbreak', 'hardbreak'})
                  and (child_index == len(children) - 1 or children[child_index + 1].type in {'softbreak', 'hardbreak'})):
                result.extend(value for line in child.content.splitlines() if (value := media_line(line)))
    if len(result) > 64:
        raise ValueError('Too many file references')
    return result


def output_path(home, reference):
    parsed = urlsplit(reference)
    if parsed.scheme not in {'', 'file'} or parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError('Local output required')
    path = Path(normalize_reference(parsed.path))
    if '..' in path.parts:
        raise ValueError('Private path')
    if not path.is_absolute():
        path = home / 'cache' / 'generated' / path
    relative = path.relative_to(home)
    parts = relative.parts
    if any(part.startswith('.') for part in parts):
        raise ValueError('Private path')
    if not (len(parts) >= 3 and parts[0] == 'cache' and parts[1] in CACHE_NAMES
            or len(parts) >= 2 and parts[0] in LEGACY_ROOTS):
        raise ValueError('Not a generated artifact')
    if any(part.lower() in PRIVATE_NAMES or part.lower().endswith(('.pem', '.key', '.p12', '.sqlite', '.db', '.db-wal', '.db-shm')) for part in parts):
        raise ValueError('Private path')
    return relative


def output_descriptor(home, relative):
    directory = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in relative.parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(relative.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    finally:
        os.close(directory)
    return fd


def describe_output(home, relative):
    with os.fdopen(output_descriptor(home, relative), 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= MAX_BYTES:
            raise ValueError('Artifact unavailable')
        return {'name': relative.name[:180], 'size': info.st_size}


def read_output(home, relative, offset, expected, text_revision):
    fd = output_descriptor(home, relative)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= MAX_BYTES:
            raise ValueError('Artifact unavailable or too large')
        witness = [before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns]
        revision = hashlib.sha256(json.dumps([text_revision, witness]).encode()).hexdigest()
        if expected and revision != expected:
            raise ValueError('Artifact changed')
        if offset >= before.st_size:
            raise ValueError('Invalid file offset')
        stream.seek(offset)
        data = stream.read(min(CHUNK_BYTES, before.st_size - offset))
        after = os.fstat(stream.fileno())
        if witness != [after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns]:
            raise ValueError('Artifact changed')
        return {'data': base64.b64encode(data).decode(), 'size': before.st_size,
                'name': relative.name[:180], 'revision': revision}


def selected_message(db, canonical_id, row_id):
    canonical = db.get_session_by_title('Bot Chat')
    if not canonical or canonical.get('archived') or canonical['id'] != canonical_id:
        raise ValueError('Canonical conversation changed')
    lineage = db.get_compression_lineage(db.get_compression_tip(canonical_id) or canonical_id)
    if len(lineage) > 32:
        raise ValueError('Conversation lineage too large')
    for sid in lineage:
        rows = db.get_messages_around(sid, row_id, window=0).get('window', [])
        found = next((row for row in rows if row.get('id') == row_id), None)
        if found:
            if (found.get('role') != 'assistant' or found.get('display_kind') == 'hidden'
                    or found.get('_compressed_summary')
                    or not (found.get('active') == 1 or found.get('compacted') == 1)):
                raise ValueError('Only visible assistant files can be read')
            return found, lineage
    raise ValueError('Saved message unavailable')


def _register_generated():
    from tui_gateway import server
    from search_native import identity, visible_text

    def read(rid, params):
        try:
            required = {'session_id', 'profile', 'incarnation', 'canonical', 'row_id', 'reference', 'offset', 'revision'}
            if not isinstance(params, dict) or set(params) != required:
                raise ValueError()
            if (type(params['row_id']) is not int or params['row_id'] <= 0
                    or type(params['offset']) is not int or not 0 <= params['offset'] < MAX_BYTES
                    or params['offset'] % CHUNK_BYTES
                    or not re.fullmatch(r'[0-9a-f]{64}', str(params['reference']))
                    or not re.fullmatch(r'(?:[0-9a-f]{64})?', str(params['revision']))):
                raise ValueError()
            session, error = server._sess_nowait({'session_id': params['session_id']}, rid)
            if error:
                return error
            from hermes_cli.profiles import get_profile_dir, list_profiles
            if params['profile'] not in {p.name for p in list_profiles()}:
                raise ValueError()
            home = Path(get_profile_dir(params['profile']))
            launch = server._launch_home() if hasattr(server, '_launch_home') else server._hermes_home
            if Path(session.get('profile_home') or launch).resolve() != home.resolve():
                raise ValueError()
            stamp = identity(home)
            if stamp != params['incarnation'] or (home / 'state.db').is_symlink():
                raise ValueError()
            database = os.stat(home / 'state.db', follow_symlinks=False)
            if not stat.S_ISREG(database.st_mode):
                raise ValueError()
            database_witness = [database.st_dev, database.st_ino]
            from hermes_state import SessionDB
            db = SessionDB(db_path=home / 'state.db', read_only=True)
            try:
                row, lineage = selected_message(db, params['canonical'], params['row_id'])
                if session.get('session_key') not in lineage:
                    raise ValueError()
                text = visible_text(row, home)
                matches = set()
                for value in references(text):
                    try:
                        if reference_key(value) == params['reference']:
                            matches.add(output_path(home, value))
                    except (ValueError, UnicodeError):
                        continue
                if len(matches) != 1:
                    raise ValueError()
                relative = matches.pop()
                revision = hashlib.sha256(json.dumps([stamp, database_witness, params['canonical'], row['id'], text]).encode()).hexdigest()
                result = read_output(home, relative, params['offset'], params['revision'], revision)
                current, current_lineage = selected_message(db, params['canonical'], params['row_id'])
                current_database = os.stat(home / 'state.db', follow_symlinks=False)
                if (identity(home) != stamp or visible_text(current, home) != text
                        or [current_database.st_dev, current_database.st_ino] != database_witness
                        or not stat.S_ISREG(current_database.st_mode)
                        or server._sessions.get(params['session_id']) is not session
                        or Path(session.get('profile_home') or launch).resolve() != home.resolve()
                        or session.get('session_key') not in current_lineage
                        or (hasattr(server, '_submit_row_target_key') and server._submit_row_target_key(session) not in current_lineage)):
                    raise ValueError()
                return server._ok(rid, result)
            finally:
                db.close()
        except Exception:
            return server._err(rid, 5082, 'Shared file unavailable in this conversation')
    server.method('bot_web.media')(read)


def _register_catalog():
    from tui_gateway import server
    from search_native import identity, visible_text

    def catalog(rid, params):
        try:
            if not isinstance(params, dict) or set(params) != {'session_id', 'profile', 'incarnation', 'canonical', 'cursor'}:
                raise ValueError()
            session, error = server._sess_nowait({'session_id': params['session_id']}, rid)
            if error: return error
            from hermes_cli.profiles import get_profile_dir, list_profiles
            if params['profile'] not in {p.name for p in list_profiles()}: raise ValueError()
            home = Path(get_profile_dir(params['profile']))
            launch = server._launch_home() if hasattr(server, '_launch_home') else server._hermes_home
            if Path(session.get('profile_home') or launch).resolve() != home.resolve(): raise ValueError()
            stamp = identity(home)
            path = home / 'state.db'
            if stamp != params['incarnation'] or path.is_symlink(): raise ValueError()
            database = os.stat(path, follow_symlinks=False)
            if not stat.S_ISREG(database.st_mode): raise ValueError()
            from hermes_state import SessionDB
            db = SessionDB(db_path=path, read_only=True)
            try:
                canonical = db.get_session_by_title('Bot Chat')
                if not canonical or canonical.get('archived') or canonical['id'] != params['canonical']: raise ValueError()
                lineage = list(reversed(db.get_compression_lineage(db.get_compression_tip(canonical['id']) or canonical['id'])))
                if len(lineage) > 32 or session.get('session_key') not in lineage: raise ValueError()
                heads = [[sid, [row['id'] for row in db.get_messages(sid, include_compacted=True, limit=1, latest=True)]] for sid in lineage]
                witness = hashlib.sha256(json.dumps([stamp, database.st_dev, database.st_ino, heads]).encode()).hexdigest()
                segment, offset = 0, 0
                if params['cursor'] is not None:
                    cursor = json.loads(base64.urlsafe_b64decode(params['cursor']).decode())
                    if (not isinstance(cursor, list) or len(cursor) != 3 or cursor[0] != witness
                            or type(cursor[1]) is not int or type(cursor[2]) is not int or not 0 <= cursor[1] < len(lineage) or not 0 <= cursor[2] <= 1000000): raise ValueError()
                    _, segment, offset = cursor
                rows = db.get_messages(lineage[segment], include_compacted=True, limit=25, offset=offset, latest=True)
                files, seen = [], set()
                for row in reversed(rows):
                    if row.get('role') != 'assistant' or row.get('display_kind') == 'hidden' or row.get('_compressed_summary'): continue
                    for reference in references(visible_text(row, home)):
                        try:
                            relative = output_path(home, reference)
                            item = describe_output(home, relative)
                            key = (row['id'], str(relative))
                            if key not in seen:
                                files.append({**item, 'row_id': row['id'], 'reference': reference_key(reference)})
                                seen.add(key)
                        except (ValueError, OSError, UnicodeError): continue
                offset += len(rows)
                if len(rows) < 25: segment, offset = segment + 1, 0
                next_cursor = base64.urlsafe_b64encode(json.dumps([witness, segment, offset]).encode()).decode() if segment < len(lineage) else None
                after = os.stat(path, follow_symlinks=False)
                if (identity(home) != stamp or [after.st_dev, after.st_ino] != [database.st_dev, database.st_ino]
                        or server._sessions.get(params['session_id']) is not session
                        or Path(session.get('profile_home') or launch).resolve() != home.resolve()
                        or (hasattr(server, '_submit_row_target_key') and server._submit_row_target_key(session) not in lineage)):
                    raise ValueError()
                return server._ok(rid, {'files': files, 'next': next_cursor})
            finally: db.close()
        except Exception:
            return server._err(rid, 5082, 'Library changed or is unavailable. Refresh it to try again.')
    server.method('bot_web.media.list')(catalog)
