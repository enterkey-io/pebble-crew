"""Brief public work captions, scoped to the caller's live native conversation."""
import json
import unicodedata


def caption(value):
    if (not isinstance(value, str) or not value.strip() or len(value.encode('utf-16-le')) > 240
            or any(unicodedata.category(c) in {'Cc', 'Cf'} for c in value)):
        raise ValueError('Use one short line of plain text, at most 120 characters')
    return value.strip()


def runtime_guidance(platform):
    from tui_gateway import server
    from model_tools import get_tool_definitions
    disabled = server._load_disabled_toolsets() if hasattr(server, '_load_disabled_toolsets') else None
    tools = get_tool_definitions(enabled_toolsets=server._load_enabled_toolsets(platform),
        disabled_toolsets=disabled, quiet_mode=True, skip_tool_search_assembly=True)
    if not any(t.get('function', {}).get('name') == 'pebble_progress' for t in tools):
        return ''
    return ('Before multi-step or longer-running work, use pebble_progress to publish a short, '
        'natural, user-visible action caption such as "Checking available Claude models" '
        'or "Checking the website project". Name the subject from the current conversation in your own voice; '
        'avoid generic labels like "Thinking" or "Running a command". Update it when the action changes, '
        'including when returning to work after an interim reply. When possible '
        'publish alongside real tool calls instead of adding extra planning turns. '
        'Describe real work you are doing, never hidden reasoning, secrets, commands or invented progress. '
        'This is optional for quick replies; do not delay a simple answer to narrate it. If unavailable, continue the requested work normally. '
        'If deferred, load it with tool_describe(names=["pebble_progress"]), then invoke through '
        'tool_call using its advertised schema. It replaces a temporary status line, not a chat message.')


def register_runtime(ctx):
    def publish(args, session_id=None, **_kwargs):
        store = None
        try:
            if not isinstance(args, dict) or set(args) != {'text'}:
                raise ValueError('Invalid progress fields')
            text = caption(args['text'])
            from .runtime import caller
            from .workspace import WorkspaceStore, workspace_path
            from gateway.session_context import get_session_env
            store = WorkspaceStore(workspace_path())
            profile = caller(store, session_id)
            key = get_session_env('HERMES_SESSION_KEY', '') or get_session_env('HERMES_SESSION_ID', '')
            if not profile or not key or caller(store, key) != profile:
                raise ValueError('Verified enrolled native caller required')
            from tui_gateway import server
            with server._sessions_lock:
                matches = [sid for sid, session in server._sessions.items()
                    if session.get('session_key') == key or getattr(session.get('agent'), 'session_id', None) == key]
            if len(matches) != 1:
                raise ValueError('A live native conversation is required')
            server._emit('status.update', matches[0], {'kind': 'progress', 'text': text})
            return json.dumps({'published': True})
        except Exception:
            return json.dumps({'published': False, 'error': 'Progress requires one short line in your current live Pebble Crew conversation.'})
        finally:
            if store:
                store.db.close()

    schema = {'name': 'pebble_progress',
        'description': 'Publish one brief public progress caption for the current Pebble Crew conversation. Describe the real action you are taking in natural language. Never reveal hidden reasoning, secrets, commands or fabricated progress. Update only when the action changes; quick replies need no caption. This replaces a temporary status line and never posts a user or assistant chat message. Native tool auditing is preserved.',
        'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['text'],
            'properties': {'text': {'type': 'string', 'minLength': 1, 'maxLength': 120}}}}
    ctx.register_tool(name='pebble_progress', toolset='workspace', description=schema['description'], schema=schema, handler=publish)
