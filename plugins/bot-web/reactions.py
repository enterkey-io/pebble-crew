"""A session-bound model tool over Hermes's own reaction store and event emitter."""
import json


class ReactionDisplay:
    """Project native silence markers without changing Hermes's stored history."""
    def __init__(self):
        self.prefixes = {}

    def event(self, event):
        kind, sid = event.get('type'), event.get('session_id')
        if kind in {'message.start', 'tool.start'}:
            self.prefixes[sid] = ''
        elif kind in {'message.delta', 'message.complete', 'message.interim'}:
            from gateway.response_filters import is_intentional_silence_response, is_partial_silence_marker
            payload = event.get('payload', {})
            text = payload.get('text')
            if kind == 'message.delta' and sid in self.prefixes and isinstance(text, str):
                text = self.prefixes[sid] + text
                if is_partial_silence_marker(text):
                    self.prefixes[sid] = text
                    return None
                self.prefixes.pop(sid, None)
                return {**event, 'payload': {**payload, 'text': text}}
            if kind == 'message.complete':
                self.prefixes.pop(sid, None)
            elif kind == 'message.interim':
                self.prefixes[sid] = ''
            if payload.get('status') != 'error' and is_intentional_silence_response(text):
                return {**event, 'payload': {**payload, 'text': ''}}
        return event

    def result(self, method, result):
        if method not in {'session.resume', 'session.history', 'session.events.since', 'bot_web.conversation.snapshot'} or not isinstance(result, dict):
            return result
        from gateway.response_filters import is_intentional_silence_response
        if isinstance(result.get('inflight'), dict) and is_intentional_silence_response(result['inflight'].get('assistant')):
            result = {**result, 'inflight': {**result['inflight'], 'assistant': ''}}
        if isinstance(result.get('messages'), list):
            result = {**result, 'messages': [
                {**row, 'text': '', 'codex_message_items': None} if row.get('role') == 'assistant' and row.get('status') != 'error'
                    and is_intentional_silence_response(row.get('text')) else row
                for row in result['messages']]}
        if isinstance(result.get('events'), list):
            replay = ReactionDisplay()
            result = {**result, 'events': [projected for event in result['events'] if (projected := replay.event(event)) is not None]}
        return result


def runtime_guidance(platform, *, group=False):
    """Advertise only an enabled capability, including its native discovery path."""
    from hermes_cli.config import load_config_readonly
    if not group and (load_config_readonly().get('display') or {}).get('message_reactions') is not True:
        return ''
    from tui_gateway import server
    from model_tools import get_tool_definitions
    # The older pinned adapter has no separate disabled-toolsets loader.
    disabled = server._load_disabled_toolsets() if hasattr(server, '_load_disabled_toolsets') else None
    tools = get_tool_definitions(enabled_toolsets=server._load_enabled_toolsets(platform),
        disabled_toolsets=disabled, quiet_mode=True,
        skip_tool_search_assembly=True)
    if not any(t.get('function', {}).get('name') == 'pebble_react' for t in tools):
        return ''
    return ('In this Pebble Crew chat you can send emoji reactions using pebble_react. '
        'Hermes may defer plugin tools: if pebble_react is not in your top-level tools, '
        'load it with tool_describe(names=["pebble_react"]), then invoke it through tool_call '
        'using that tool\'s advertised schema. It is not missing just because it is deferred. '
        'The emoji argument is required; omit target fields to react to the latest user message. '
        'On each human turn, consider whether a reaction would be useful before deciding how to respond. '
        'A brief thanks, acknowledgement or closing that needs no answer can receive just one fitting reaction, with no written reply. '
        f'After the reaction succeeds, end that reaction-only turn with the native {"(pass)" if group else "NO_REPLY"} silence marker; never explain that you reacted. '
        'Use reactions selectively, not automatically on every post. A reaction does not replace an answer or task the human asked for. '
        'Owner reactions arrive as native feedback on the next user turn.')


def emoji(value, *, clear=False):
    # Bound untrusted input; accept Unicode emoji sequences, including joined and
    # skin-tone variants, without a duplicate emoji database in the integration.
    import unicodedata
    if clear and value in (None, ''):
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= 32 or value != value.strip():
        raise ValueError('Choose an emoji')
    if any(unicodedata.category(c).startswith('C') and c != '\u200d' for c in value):
        raise ValueError('Invalid reaction')
    if not any(unicodedata.category(c) == 'So' or c == '\u20e3' for c in value):
        raise ValueError('Choose an emoji')
    return value


def register_runtime(ctx):
    def react(args, session_id=None, **_kwargs):
        store = None
        try:
            from .runtime import caller
            from .workspace import WorkspaceStore, workspace_path
            from gateway.session_context import get_session_env
            from hermes_cli.config import load_config_readonly
            store = WorkspaceStore(workspace_path())
            profile = caller(store, session_id)
            key = get_session_env('HERMES_SESSION_KEY', '') or get_session_env('HERMES_SESSION_ID', '')
            if not profile or caller(store, key) != profile:
                raise ValueError('Verified enrolled native caller required')
            from .room_identity import runtime_room_record
            room = runtime_room_record(store, profile, key)
            if room:
                from .room_reactions import agent_react
                return json.dumps({'success': True, **agent_react(store, profile, room, args)}, ensure_ascii=False)
            if (load_config_readonly().get('display') or {}).get('message_reactions') is not True:
                raise ValueError('Message reactions are not enabled')
            if not isinstance(args, dict) or 'emoji' not in args or set(args) - {'emoji', 'message_row_id', 'messages_back'}:
                raise ValueError('Invalid reaction fields')
            chosen = emoji(args.get('emoji'), clear=True)
            for field in ('message_row_id', 'messages_back'):
                if field in args and (type(args[field]) is not int or not 0 <= args[field] <= 9007199254740991):
                    raise ValueError('Invalid reaction target')
            from tools.react_to_message_tool import react_to_message_tool
            return react_to_message_tool(chosen or '', args.get('message_row_id'), args.get('messages_back'))
        except Exception:
            return json.dumps({'error': 'Reaction not confirmed. Use only messages in your current Pebble Crew conversation.'})
        finally:
            if store:
                store.db.close()

    schema = {'name': 'pebble_react',
        'description': 'React naturally to a message in this Pebble Crew conversation with one emoji. Consider a reaction on each human turn, but use one only when it fits. Defaults to the latest user message; messages_back selects earlier user messages. A different emoji replaces yours, the same emoji or an empty string removes it. Never narrate reactions or use them as progress indicators. If a reaction alone acknowledges a message that needs no answer, finish with NO_REPLY in direct chat or (pass) in a group after the tool succeeds. A reaction does not replace requested work.',
        'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['emoji'],
            'properties': {'emoji': {'type': 'string', 'maxLength': 32},
                'message_row_id': {'type': 'integer', 'minimum': 1},
                'message_event_id': {'type': 'string', 'maxLength': 128, 'description': 'Group chat only: a native event id from this group. Omit to react to its latest user message.'},
                'messages_back': {'type': 'integer', 'minimum': 0}}}}
    ctx.register_tool(name='pebble_react', toolset='workspace', description=schema['description'],
                      schema=schema, handler=react)
