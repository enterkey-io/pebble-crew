"""Explicit agent sharing into the current owner chat, using bounded output reads."""
import base64
import json
from pathlib import Path
import time
import uuid

MAX_DOCUMENT_BYTES = 256 * 1024


def read_document(home, reference):
    from .attachments_native import output_path, read_output
    relative = output_path(home, reference)
    if relative.suffix.lower() not in {'.md', '.markdown', '.txt'}:
        raise ValueError('Markdown or text required')
    result = read_output(home, relative, 0, '', 'document-share-v1')
    if result['size'] > MAX_DOCUMENT_BYTES:
        raise ValueError('Document too large')
    blob = base64.b64decode(result['data'], validate=True)
    if len(blob) != result['size']:
        raise ValueError('Incomplete document')
    text = blob.decode('utf-8-sig', errors='strict')
    if any(ord(char) < 32 and char not in '\n\r\t' for char in text):
        raise ValueError('Text required')
    return {'name': relative.name[:180], 'text': text,
            'format': 'text' if relative.suffix.lower() == '.txt' else 'markdown'}


def register_runtime(ctx):
    def show(args, session_id=None, **_kwargs):
        store = None
        try:
            if not isinstance(args, dict) or set(args) != {'path'} or not isinstance(args['path'], str):
                raise ValueError()
            from .runtime import caller
            from .workspace import WorkspaceStore, workspace_path
            from .room_identity import runtime_room
            from gateway.session_context import get_session_env
            from hermes_cli.profiles import get_profile_dir
            from hermes_state import SessionDB
            from tui_gateway import server
            store = WorkspaceStore(workspace_path())
            profile = caller(store, session_id)
            key = get_session_env('HERMES_SESSION_KEY', '') or get_session_env('HERMES_SESSION_ID', '')
            ui_sid = get_session_env('HERMES_UI_SESSION_ID', '')
            if not profile or caller(store, key) != profile or runtime_room(store, profile, key):
                raise ValueError()
            home = Path(get_profile_dir(profile))
            with server._sessions_lock:
                row = server._sessions.get(ui_sid)
                launch = server._launch_home() if hasattr(server, '_launch_home') else server._hermes_home
                if not row or Path(row.get('profile_home') or launch).resolve() != home.resolve():
                    raise ValueError()
                if (home / 'state.db').is_symlink():
                    raise ValueError()
                db = SessionDB(db_path=home / 'state.db', read_only=True)
                try:
                    canonical = db.get_session_by_title('Bot Chat')
                    if not canonical or canonical.get('archived'):
                        raise ValueError()
                    lineage = db.get_compression_lineage(db.get_compression_tip(canonical['id']) or canonical['id'])
                    if len(lineage) > 32 or key not in lineage or row.get('session_key') not in lineage:
                        raise ValueError()
                finally:
                    db.close()
                document = read_document(home, args['path'])
                # Native dispatch serializes emission against session closure. The
                # event is live-only; no pending request can reopen an old document.
                request_id = str(uuid.uuid4())
                server._emit('document.open', ui_sid, {**document, 'request_id': request_id,
                             'expires_at': int(time.time() * 1000) + 60_000})
            return json.dumps({'requested': True, 'request_id': request_id,
                               'message': 'Shared in the current chat. The owner may close the reader. Include a Markdown file link in your reply so they can reopen it.'})
        except Exception:
            return json.dumps({'error': 'Document not shared. Use this Pebble’s open direct Bot Chat and a UTF-8 .md, .markdown or .txt file up to 256 KB in its generated output directory. No private paths or remote URLs.'})
        finally:
            if store:
                store.db.close()
    description = 'Share and open a Markdown or text document in the owner’s current Pebble Crew chat. Save it to your generated output directory first. This explicitly shares that file with the owner; never share private files or credentials. Does not start a model or change a persona.'
    ctx.register_tool(name='pebble_open_document', toolset='workspace', description=description,
        schema={'name': 'pebble_open_document', 'description': description,
                'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['path'],
                               'properties': {'path': {'type': 'string', 'description': 'Absolute path to the intended generated .md, .markdown or .txt output (UTF-8, up to 256 KB).'}}}}, handler=show)


def runtime_guidance(platform):
    from tui_gateway import server
    from model_tools import get_tool_definitions
    disabled = server._load_disabled_toolsets() if hasattr(server, '_load_disabled_toolsets') else None
    definitions = get_tool_definitions(enabled_toolsets=server._load_enabled_toolsets(platform), disabled_toolsets=disabled, quiet_mode=True, skip_tool_search_assembly=True)
    if not any(t.get('function', {}).get('name') == 'pebble_open_document' for t in definitions):
        return ''
    return ('To show the owner a plan or document in the reader, save a UTF-8 .md, .markdown or .txt output in your generated output directory, then call pebble_open_document(path=absolute_path). If deferred, first tool_describe(names=["pebble_open_document"]), then tool_call using the advertised schema. This explicitly shares the file into this direct Bot Chat only. Include a normal Markdown file link in your reply for reopening. Never share secrets, arbitrary local paths or remote URLs. A successful request does not mean the owner has read it.')
