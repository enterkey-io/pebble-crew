"""Owner-scoped adapter for Hermes's native GPT-Live session builder.

No speech engine, media relay, provider-key response or auxiliary reasoning model.
"""
import asyncio
from copy import deepcopy
import json
import re
import threading
import time
import urllib.request
import urllib.error
import socket

from .operations import InvalidOperation, fields, identifier

VOICE_ERROR_CODES = {'VOICE_KEY_REJECTED', 'VOICE_PROVIDER_UNREACHABLE', 'VOICE_INVALID_ANSWER', 'VOICE_KEY_REQUIRED', 'VOICE_SETUP_FAILED', 'VOICE_ACCESS_DENIED', 'VOICE_OFFER_REJECTED', 'VOICE_MODEL_UNAVAILABLE', 'VOICE_LIMIT_REACHED', 'VOICE_PROVIDER_TIMEOUT', 'VOICE_PROVIDER_UNAVAILABLE'}

_CONFIG = threading.Lock()
PACE_START = '[Pebble Crew delivery]'
PACE_END = '[/Pebble Crew delivery]'
SPEEDS = (0.75, 1, 1.25, 1.5, 1.75, 2)
LEGACY_PACES = {'slower': 'Speak a little more slowly, with natural pauses.',
         'natural': 'Speak at a natural conversational pace.',
         'faster': 'Speak a little faster, remaining clear and conversational.'}


def supported():
    try:
        from tools.voice_live import build_session_config
        from hermes_cli.web_server_profiles import _config_profile_scope
        return callable(build_session_config) and callable(_config_profile_scope)
    except ImportError:
        return False


def preferences():
    from tools import voice_live as native
    status = native.resolve_gpt_live_status()
    live = native._live_section()
    instructions = str(live.get('instructions') or '')
    legacy = next((key for key, value in LEGACY_PACES.items() if f'{PACE_START}\n{value}\n{PACE_END}' in instructions), 'natural')
    speed = live.get('pebble_speed', {'slower': 0.75, 'natural': 1, 'faster': 1.25}[legacy])
    speed = speed if type(speed) in (int, float) and speed in SPEEDS else 1
    return {'supported': True, 'provider': 'openai', 'configured': status['available'],
            'voice': status['voice'], 'voices': list(native.GPT_LIVE_VOICES), 'speed': speed, 'speed_control': 'instruction', 'setup_complete': live.get('pebble_setup_complete') is True, 'can_change_key': not bool(live.get('api_key'))}


def speed_instruction(speed):
    return f'Aim for {speed:g} times your normal speaking speed. Keep pronunciation clear and natural.'


def save_preferences(voice, speed, complete):
    from tools import voice_live as native
    from hermes_cli.config import _CONFIG_LOCK, read_user_config_raw, save_config
    if voice not in native.GPT_LIVE_VOICES or type(speed) not in (int, float) or speed not in SPEEDS or type(complete) is not bool:
        raise ValueError('Choose a supported voice and speed')
    with _CONFIG_LOCK:
        config = deepcopy(read_user_config_raw() or {})
        live = config.setdefault('voice', {}).setdefault('gpt_live', {})
        instructions = str(live.get('instructions') or '')
        instructions = re.sub(re.escape(PACE_START) + r'.*?' + re.escape(PACE_END), '', instructions, flags=re.S).strip()
        live['instructions'] = f'{instructions}\n\n{PACE_START}\n{speed_instruction(speed)}\n{PACE_END}'.strip()
        live['voice'] = voice
        live['pebble_speed'] = speed
        if complete:
            live['pebble_setup_complete'] = True
        save_config(config)
        actual = read_user_config_raw() or {}
        if actual.get('voice', {}).get('gpt_live') != live:
            raise ValueError('Hermes did not confirm the settings save')
    return preferences()


def create_session(sdp, name, preview, history=None):
    from tools import voice_live as native
    live = native._live_section()
    key, base = native._resolve_credentials(live)
    if not key:
        raise InvalidOperation('Set up an OpenAI voice key first', 'VOICE_KEY_REQUIRED')
    # Preserve native delegation/backchannel/interrupt policy and owner instructions;
    # replace only the generic frontend identity for this ephemeral session.
    session = native.build_session_config(history if not preview else None)
    session['instructions'] = session['instructions'].replace(
        'You are Hermes, a calm and friendly voice assistant.',
        f'You are the speaking voice of {name}, the selected Hermes agent.', 1)
    if preview:
        session['instructions'] = 'This is a short voice preview. Read the supplied sample once, then wait silently. Do not delegate or ask questions.'
        session['instructions'] += '\n' + speed_instruction(preferences()['speed'])
        session['input'] = []
    request = urllib.request.Request(f'{base}/live/sessions', data=json.dumps({
        'session': session, 'transport': {'type': 'webrtc', 'sdp': sdp}}).encode(),
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}, method='POST')
    # Never echo/log vendor bodies, SDP or keys on errors.
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read(256_000))
    except urllib.error.HTTPError as error:
        code = {401: 'VOICE_KEY_REJECTED', 403: 'VOICE_ACCESS_DENIED', 404: 'VOICE_MODEL_UNAVAILABLE',
                429: 'VOICE_LIMIT_REACHED'}.get(error.code, 'VOICE_PROVIDER_UNAVAILABLE' if error.code >= 500 else 'VOICE_OFFER_REJECTED')
        error.close()
        raise InvalidOperation('Voice provider refused the session', code) from None
    except (TimeoutError, socket.timeout):
        raise InvalidOperation('Voice provider timed out', 'VOICE_PROVIDER_TIMEOUT') from None
    except urllib.error.URLError:
        raise InvalidOperation('Voice provider could not be reached', 'VOICE_PROVIDER_UNREACHABLE') from None
    except (ValueError, TypeError):
        raise InvalidOperation('Invalid voice provider answer', 'VOICE_INVALID_ANSWER') from None
    if not isinstance(value, dict) or not isinstance(value.get('session'), dict) or not isinstance(value.get('session', {}).get('id'), str) or not value['session']['id']:
        raise InvalidOperation('Invalid voice answer', 'VOICE_INVALID_ANSWER')
    transport = value.get('transport', {})
    if not isinstance(transport, dict) or transport.get('type') != 'webrtc' or not isinstance(transport.get('sdp'), str) or len(transport['sdp']) > 128_000:
        raise InvalidOperation('Invalid voice answer', 'VOICE_INVALID_ANSWER')
    return {'session': {'id': str(value.get('session', {}).get('id') or '')[:256]},
            'transport': {'type': 'webrtc', 'sdp': transport['sdp']}}


class LiveVoice:
    def __init__(self, ops):
        self.ops = ops
        self.inflight = set()
        self.calls = {}

    async def invoke(self, operation, params):
        if not supported():
            if operation == 'voice.status':
                return {'supported': False}
            raise InvalidOperation('This Hermes build does not have native live voice')
        sid = identifier(params.get('session_id'))
        profile = self.ops.sessions.get(sid)
        if not profile or await self.ops.stamp(profile) != self.ops.session_incarnations.get(sid):
            raise InvalidOperation('Reopen this Pebble before using voice')
        if operation == 'voice.end':
            fields(params, ['session_id', 'call_id', 'transcript'])
            call_id, transcript = params['call_id'], params['transcript']
            if not isinstance(call_id, str) or not isinstance(transcript, str) or not transcript.strip() or len(transcript) > 6000:
                raise InvalidOperation('Invalid call follow-up')
            call = self.calls.get(call_id)
            if not call or call['session_id'] != sid or call['preview'] or call['expires'] < time.monotonic():
                raise InvalidOperation('Call follow-up unavailable')
            if call['followed_up']:
                return {'submitted': False}
            # Consume before dispatch. A timed-out accepted turn is never retried.
            call['followed_up'] = True
            receipt = await self.ops.gateway.call('prompt.submit', {'session_id': sid,
                'text': 'The live voice call has ended. Send one brief, natural follow-up in this text chat, in your existing personality. Refer only to the actual discussion in the voice context. If a decision was left open, offer to pick it up when the owner is ready. Do not claim actions happened or treat discussion as approval. Do not use tools, make changes, or start tasks. Do not invent unfinished work.',
                'surface': 'voice-live', 'voice_context': transcript, 'display_kind': 'hidden', 'queued': True})
            return {'submitted': True, **receipt}
        if operation == 'voice.submit':
            fields(params, ['session_id', 'text', 'context'])
            text, context = params['text'], params['context']
            if not isinstance(text, str) or not text.strip() or len(text) > 6000 or not isinstance(context, str) or len(context) > 6000:
                raise InvalidOperation('Invalid spoken request')
            # A racing writer queues safely. The client never retries or guesses the
            # receipt of a queued turn, and only speaks an exactly matching completion.
            return await self.ops.gateway.call('prompt.submit', {'session_id': sid,
                'text': text, 'surface': 'voice-live', 'voice_context': context, 'queued': True})
        allowed = {'voice.status': ['session_id'], 'voice.preferences': ['session_id', 'voice', 'speed', 'complete'],
                   'voice.credential': ['session_id', 'value'], 'voice.session': ['session_id', 'sdp', 'preview']}
        if operation not in allowed:
            raise InvalidOperation('Unsupported voice operation')
        fields(params, allowed[operation])
        if sid in self.inflight:
            raise InvalidOperation('Voice setup is already in progress')
        # A single owner/profile-scoped config operation, off the event loop. Do not
        # hold native session/skills locks over provider I/O.
        history = []
        if operation == 'voice.session' and params.get('preview') is False:
            saved = await self.ops.invoke('chat.history', {'session_id': sid})
            budget = 6000
            for row in reversed(saved.get('messages', [])):
                text = str(row.get('text') or '').strip()[:1200]
                if row.get('role') not in {'user', 'assistant'} or not text or row.get('display_kind') == 'hidden':
                    continue
                if len(history) >= 24 or len(text) > budget:
                    break
                budget -= len(text)
                history.insert(0, {'type': 'message', 'role': row['role'], 'content': [{'type': 'output_text' if row['role'] == 'assistant' else 'input_text', 'text': text}]})
        bot = await self.ops.bot(profile)
        name = self.ops.summary(bot)['name']
        def execute():
            from hermes_cli.web_server_profiles import _config_profile_scope
            with _CONFIG, _config_profile_scope(profile):
                if operation == 'voice.status':
                    return preferences()
                if operation == 'voice.preferences':
                    return save_preferences(params['voice'], params['speed'], params['complete'])
                if operation == 'voice.credential':
                    value = params['value']
                    if not isinstance(value, str) or not re.fullmatch(r'[\x21-\x7e]{8,4096}', value):
                        raise ValueError('Invalid credential')
                    # Do not overwrite a higher-precedence inline voice key or a
                    # reasoning-provider key. Native lifecycle owns storage/refusals.
                    from tools import voice_live as native
                    if native._live_section().get('api_key'):
                        raise ValueError('Voice already has an explicitly configured key')
                    from hermes_cli.config import save_env_value_secure, load_env
                    receipt = save_env_value_secure('VOICE_TOOLS_OPENAI_KEY', value)
                    if receipt.get('success') is not True or load_env().get('VOICE_TOOLS_OPENAI_KEY') != value:
                        raise ValueError('Native secret save not confirmed')
                    return {'saved': True, 'validated': False}
                sdp = params['sdp']
                if not isinstance(sdp, str) or not sdp.startswith('v=0') or len(sdp) > 48_000 or type(params['preview']) is not bool:
                    raise ValueError('Invalid voice offer')
                return create_session(sdp, name, params['preview'], history)
        self.inflight.add(sid)
        try:
            result = await asyncio.to_thread(execute)
            if await self.ops.stamp(profile) != self.ops.session_incarnations.get(sid):
                raise InvalidOperation('This Pebble changed during setup')
            if operation == 'voice.session':
                self.calls = {key: value for key, value in self.calls.items() if value['expires'] > time.monotonic()}
                if len(self.calls) >= 64:
                    self.calls.pop(next(iter(self.calls)))
                self.calls[result['session']['id']] = {'session_id': sid, 'preview': params['preview'], 'expires': time.monotonic() + 14400, 'followed_up': False}
            return result
        except InvalidOperation:
            raise
        except Exception:
            raise InvalidOperation('Voice setup could not be confirmed', 'VOICE_SETUP_FAILED') from None
        finally:
            self.inflight.discard(sid)


def register_runtime(ctx):
    if not supported():
        return
    def setup(args, session_id=None, **_kwargs):
        store = None
        try:
            if args != {}:
                raise ValueError('No secret values accepted')
            from .runtime import caller
            from .workspace import WorkspaceStore, workspace_path
            from gateway.session_context import get_session_env
            from tui_gateway import server
            store = WorkspaceStore(workspace_path())
            profile = caller(store, session_id)
            from .room_identity import runtime_room
            key = get_session_env('HERMES_SESSION_KEY', '') or get_session_env('HERMES_SESSION_ID', '')
            if not profile or caller(store, key) != profile or runtime_room(store, profile, key):
                raise ValueError('A verified direct chat is required')
            ui_sid = get_session_env('HERMES_UI_SESSION_ID')
            if not profile or not ui_sid:
                raise ValueError('Open this direct chat first')
            with server._sessions_lock:
                row = server._sessions.get(ui_sid)
                if not row:
                    raise ValueError('Chat closed')
                from hermes_cli.profiles import get_profile_dir
                from pathlib import Path
                if Path(row['profile_home']).resolve() != Path(get_profile_dir(profile)).resolve():
                    raise ValueError('Different owner profile')
            server._emit('voice.setup', ui_sid, {})
            return json.dumps({'requested': True, 'message': 'Requested private voice setup in the current direct chat. The owner can also open Voice in the composer, enter a key privately, select/preview a voice and start a live call. Never ask for keys as chat text.'})
        except Exception:
            return json.dumps({'error': 'Open this Pebble’s direct chat and select Voice. Never send API keys in messages.'})
        finally:
            if store:
                store.db.close()
    schema = {'name': 'pebble_voice_setup', 'description': 'Open private live-voice setup in the current Pebble Crew chat. The owner enters any key outside chat, chooses/previews a voice and starts the call. Never accepts credentials or starts a metered call itself.',
              'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {}}}
    ctx.register_tool(name='pebble_voice_setup', toolset='workspace', description=schema['description'], schema=schema, handler=setup)


def runtime_guidance(platform):
    if not supported():
        return ''
    from tui_gateway import server
    from model_tools import get_tool_definitions
    disabled = server._load_disabled_toolsets() if hasattr(server, '_load_disabled_toolsets') else None
    tools = get_tool_definitions(enabled_toolsets=server._load_enabled_toolsets(platform), disabled_toolsets=disabled, quiet_mode=True, skip_tool_search_assembly=True)
    if not any(t.get('function', {}).get('name') == 'pebble_voice_setup' for t in tools):
        return ''
    return ('For live voice setup, use pebble_voice_setup with no arguments. If deferred, first use tool_describe(names=["pebble_voice_setup"]), then tool_call with its advertised schema. This opens private key entry and voice controls; never ask for an API key as chat text. The owner starts calls explicitly.')
