"""Owner-scoped adapter for Hermes's native GPT-Live session builder.

No speech engine, media relay, provider-key response or auxiliary reasoning model.
"""
import asyncio
from copy import deepcopy
import hashlib
import json
import re
import threading
import time
import urllib.request
import urllib.error
import socket

from .native import NativeError
from .operations import InvalidOperation, fields, identifier
from .spoken_turns import SpokenTurns
from .voice_credentials import resolve_source, confirm_source, save_shared_key
from . import grok_voice
from .live_context import instructions as live_instructions, profile_context, recent_history

VOICE_ERROR_CODES = {'VOICE_MEDIA_ONLY_REQUIRED', 'ELEVEN_KEY_REQUIRED', 'ELEVEN_KEY_REJECTED', 'ELEVEN_ACCESS_DENIED', 'ELEVEN_RATE_LIMITED', 'ELEVEN_CONNECTION_FAILED', 'ELEVEN_SAMPLE_UNAVAILABLE', 'VOICE_KEY_REJECTED', 'VOICE_PROVIDER_UNREACHABLE', 'VOICE_INVALID_ANSWER', 'VOICE_KEY_REQUIRED', 'VOICE_SETUP_FAILED', 'VOICE_PREFERENCES_FAILED', 'VOICE_ACCESS_DENIED', 'VOICE_OFFER_REJECTED', 'VOICE_MODEL_UNAVAILABLE', 'VOICE_LIMIT_REACHED', 'VOICE_RATE_LIMITED', 'VOICE_CREDITS_EXHAUSTED', 'VOICE_SPEND_LIMIT_REACHED', 'VOICE_QUOTA_EXHAUSTED', 'VOICE_PROVIDER_TIMEOUT', 'VOICE_PROVIDER_UNAVAILABLE'}

_CONFIG = threading.Lock()
PACE_START = '[Pebble Crew delivery]'
PACE_END = '[/Pebble Crew delivery]'


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
    source = resolve_source()
    return {'supported': True, 'provider': 'openai', 'configured': bool(source['key']),
            'voice': status['voice'], 'voices': list(native.GPT_LIVE_VOICES), 'setup_complete': source['confirmed'] and live.get('pebble_setup_complete') is True, 'key_confirmed': source['confirmed'], 'can_change_key': source['can_change_key']}


def without_pebble_delivery(instructions):
    cleaned, count = re.subn(re.escape(PACE_START) + r'.*?' + re.escape(PACE_END), '', instructions, flags=re.S)
    return cleaned.strip() if count else instructions


def save_preferences(voice, complete):
    from tools import voice_live as native
    from hermes_cli.config import _CONFIG_LOCK, read_user_config_raw, save_config
    if voice not in native.GPT_LIVE_VOICES or type(complete) is not bool:
        raise ValueError('Choose a supported voice')
    with _CONFIG_LOCK:
        config = deepcopy(read_user_config_raw() or {})
        if config.get('voice') is None:
            config['voice'] = {}
        if config['voice'].get('gpt_live') is None:
            config['voice']['gpt_live'] = {}
        live = config.setdefault('voice', {}).setdefault('gpt_live', {})
        source = resolve_source()
        if not source['key']:
            raise InvalidOperation('Set up an OpenAI voice key first', 'VOICE_KEY_REQUIRED')
        if isinstance(live.get('instructions'), str):
            live['instructions'] = without_pebble_delivery(live['instructions'])
        live['voice'] = voice
        live.pop('pebble_speed', None)
        live['pebble_key_confirmed'] = True
        if complete:
            live['pebble_setup_complete'] = True
        save_config(config, preserve_keys={('voice', 'gpt_live', key) for key in ('voice', 'instructions', 'pebble_key_confirmed', 'pebble_setup_complete') if key in live})
        confirm_source(source['profile'], source['key'], source['base'])
        actual = preferences()
        saved = (read_user_config_raw() or {}).get('voice', {}).get('gpt_live', {})
        if actual['voice'] != voice or (complete and not actual['setup_complete']) or (live.get('pebble_key_confirmed') is True and not actual['key_confirmed']) or saved.get('instructions') != live.get('instructions') or 'pebble_speed' in saved:
            raise ValueError('Hermes did not confirm the settings save')
    return actual


def create_session(sdp, name, preview, history=None, coordination=""):
    from tools import voice_live as native
    source = resolve_source()
    key, base = source['key'], source['base']
    if not key:
        raise InvalidOperation('Set up an OpenAI voice key first', 'VOICE_KEY_REQUIRED')
    if not source['confirmed']:
        raise InvalidOperation('Approve the saved voice key first', 'VOICE_KEY_REQUIRED')
    # Preserve native delegation/backchannel/interrupt policy and owner instructions;
    # replace only the generic frontend identity for this ephemeral session.
    session = native.build_session_config(history if not preview else None)
    session['instructions'] = session['instructions'].replace(
        'You are Hermes, a calm and friendly voice assistant.',
        f'You are the speaking voice of {name}, the selected Hermes agent.', 1)
    session['instructions'] = without_pebble_delivery(session['instructions'])
    if coordination and not preview:
        session['instructions'] += '\n' + coordination
    if preview:
        session['instructions'] = 'This is a short voice preview. Read the supplied sample once, then wait silently. Do not delegate or ask questions.'
        session['input'] = []
    request = urllib.request.Request(f'{base}/live/sessions', data=json.dumps({
        'session': session, 'transport': {'type': 'webrtc', 'sdp': sdp}}).encode(),
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}, method='POST')
    # Only a known error code leaves this boundary; never return/log vendor bodies.
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read(256_000))
    except urllib.error.HTTPError as error:
        code = {401: 'VOICE_KEY_REJECTED', 403: 'VOICE_ACCESS_DENIED', 404: 'VOICE_MODEL_UNAVAILABLE',
                429: 'VOICE_LIMIT_REACHED'}.get(error.code, 'VOICE_PROVIDER_UNAVAILABLE' if error.code >= 500 else 'VOICE_OFFER_REJECTED')
        if error.code == 429:
            try:
                body = json.loads(error.read(8192))
                detail = body.get('error') if isinstance(body, dict) else None
                detail = detail if isinstance(detail, dict) else {}
                vendor_code = detail.get('code')
                code = {'rate_limit_exceeded': 'VOICE_RATE_LIMITED', 'slow_down': 'VOICE_RATE_LIMITED',
                        'credit_balance_exhausted': 'VOICE_CREDITS_EXHAUSTED',
                        'organization_spend_limit_exceeded': 'VOICE_SPEND_LIMIT_REACHED',
                        'project_spend_limit_exceeded': 'VOICE_SPEND_LIMIT_REACHED',
                        'organization_usage_limit_exceeded': 'VOICE_QUOTA_EXHAUSTED',
                        'insufficient_quota': 'VOICE_QUOTA_EXHAUSTED'}.get(vendor_code, code) if isinstance(vendor_code, str) else code
                if code == 'VOICE_LIMIT_REACHED' and detail.get('type') == 'insufficient_quota':
                    code = 'VOICE_QUOTA_EXHAUSTED'
                elif code == 'VOICE_LIMIT_REACHED' and detail.get('type') == 'rate_limit_error':
                    code = 'VOICE_RATE_LIMITED'
            except (ValueError, OSError):
                pass
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



CALL_FOLLOW_UP = ('The owner just ended the live call. Send one brief closing message in your own voice, '
                  'based on the spoken turns of this call in this chat: follow up on anything left open, '
                  'or simply sign off warmly if nothing was. Do not repeat the call back. '
                  'Do not use tools or treat a discussion as approval.')


class LiveVoice:
    def __init__(self, ops, workspace=None):
        self.ops = ops
        self.workspace = workspace
        self.inflight = set()
        self.spoken = SpokenTurns(ops, workspace)
        self.starting = set()

    def selected_provider(self, profile):
        from hermes_cli.web_server_profiles import _config_profile_scope
        from . import eleven_voice
        with _CONFIG, _config_profile_scope(profile):
            return eleven_voice.provider()

    async def briefing(self, sid, profile, summary, *, handoff):
        """The selected Pebble's persona, memory of the owner and recent chat."""
        try:
            context = await asyncio.to_thread(profile_context, profile)
            history = await recent_history(self.ops, sid)
        except InvalidOperation:
            raise
        except Exception:
            raise InvalidOperation('Voice setup could not be confirmed', 'VOICE_SETUP_FAILED') from None
        return live_instructions(summary.get('name') or profile, summary.get('description') or '',
                                 context, handoff=handoff), history

    async def start_live(self, sid, profile, provider):
        """A GPT-Live or Grok call. The live model talks; the Pebble does the work
        through spoken turns in its own Bot Chat."""
        def credentials():
            from hermes_cli.web_server_profiles import _config_profile_scope
            with _CONFIG, _config_profile_scope(profile):
                if provider == 'openai':
                    source = resolve_source()
                    if not source['key']:
                        raise InvalidOperation('Set up an OpenAI voice key first', 'VOICE_KEY_REQUIRED')
                    if not source['confirmed']:
                        raise InvalidOperation('Approve the saved voice key first', 'VOICE_KEY_REQUIRED')
                    return None, None
                key, confirmed = grok_voice.source()
                if not confirmed:
                    raise InvalidOperation('Confirm the xAI key first', 'VOICE_KEY_REQUIRED')
                return key, grok_voice.selected_voice()
        key, voice = await asyncio.to_thread(credentials)
        if provider == 'openai':
            return {'call_id': self.spoken.begin(sid, 'gpt-live'), 'provider': 'openai'}
        summary = self.ops.summary(await self.ops.bot(profile))
        instructions, history = await self.briefing(sid, profile, summary, handoff=(
            'Call the ask_pebble tool with the request in the owner\'s words; it reaches the '
            'real you, with all your tools and memory, and returns your answer.'))
        token = await asyncio.to_thread(grok_voice.client_secret, key)
        return {'call_id': self.spoken.begin(sid, 'grok-' + voice), 'provider': 'grok', 'token': token,
                'model': grok_voice.MODEL, 'voice': voice, 'instructions': instructions, 'history': history}

    def history(self, sid, bounds):
        conversation = self.ops.session_conversations.get(sid)
        if not self.workspace or not conversation:
            return []
        lower, upper = bounds
        rows = self.workspace.db.execute(
            'SELECT v.id, v.ended_at, a.id FROM voice_calls v LEFT JOIN atmee_call a ON a.voice_id=v.id '
            'WHERE v.incarnation=? AND v.conversation=? AND v.ended_at>=? AND v.ended_at<? '
            'ORDER BY v.ended_at DESC,v.id LIMIT 1000',
            (self.ops.session_incarnations[sid], conversation, lower or 0, upper or float('inf')))
        return [{'id': row[0], 'ended_at': row[1], **({'kind': 'video'} if row[2] else {})} for row in rows]

    async def follow_up(self, sid):
        """Ask the agent for one short closing message after the owner hangs up."""
        try:
            await self.ops.gateway.call('prompt.submit', {
                'session_id': sid, 'surface': 'voice-live', 'queued': True, 'display_kind': 'hidden',
                'text': CALL_FOLLOW_UP,
            })
            return True
        except NativeError:
            return False

    def record_call(self, sid, call_id, *, video_id=None):
        conversation = self.ops.session_conversations.get(sid)
        if not self.workspace or not conversation:
            return None, True
        stamp = self.ops.session_incarnations[sid]
        ident = hashlib.sha256(json.dumps([stamp, conversation, call_id]).encode()).hexdigest()
        with self.workspace.db:
            added = self.workspace.db.execute('INSERT OR IGNORE INTO voice_calls VALUES(?,?,?,?)',
                (ident, stamp, conversation, time.time())).rowcount
            if video_id:
                self.workspace.db.execute('UPDATE atmee_call SET voice_id=? WHERE id=?', (ident, video_id))
            ended_at, = self.workspace.db.execute('SELECT ended_at FROM voice_calls WHERE id=?', (ident,)).fetchone()
        return {'id': ident, 'ended_at': ended_at}, bool(added)

    async def invoke(self, operation, params, *, speech_rate=24000, video=False):
        if not supported():
            if operation == 'voice.status':
                return {'supported': False}
            raise InvalidOperation('This Hermes build does not have native live voice')
        sid = identifier(params.get('session_id'))
        profile = self.ops.sessions.get(sid)
        if not profile or await self.ops.stamp(profile) != self.ops.session_incarnations.get(sid):
            raise InvalidOperation('Reopen this Pebble before using voice')
        from . import eleven_voice
        def eleven_config(require_selection=False):
            from hermes_cli.web_server_profiles import _config_profile_scope
            with _CONFIG, _config_profile_scope(profile):
                if require_selection and eleven_voice.provider() != 'elevenlabs':
                    raise InvalidOperation('Choose ElevenLabs for a Hermes voice call', 'VOICE_MEDIA_ONLY_REQUIRED')
                key, confirmed = eleven_voice.source()
                if not confirmed:
                    raise InvalidOperation('Confirm the ElevenLabs key first', 'ELEVEN_KEY_REQUIRED')
                return key, eleven_voice.preferences()['voice']

        if operation == 'voice.start':
            fields(params, ['session_id'])
            if sid in self.starting:
                raise InvalidOperation('A voice call is starting')
            self.starting.add(sid)
            try:
                selected = 'elevenlabs' if video else await asyncio.to_thread(self.selected_provider, profile)
                if selected in ('openai', 'grok'):
                    return await self.start_live(sid, profile, selected)
                # A video call always speaks through ElevenLabs, so it needs only the
                # shared key; the audio-call provider choice does not apply to it.
                key, voice = await asyncio.to_thread(eleven_config, not video)
                token = await asyncio.to_thread(eleven_voice.transcription_token, key)
                return {'call_id': self.spoken.begin(sid, voice), 'token': token}
            finally:
                self.starting.discard(sid)
        if operation == 'voice.submit':
            return await self.spoken.submit(sid, params)
        if operation == 'voice.turn':
            fields(params, ['session_id', 'call_id', 'utterance_id'])
            self.spoken.voice(sid, params['call_id'])
            status = self.spoken.status(params['call_id'], identifier(params['utterance_id']))
            if status['state'] == 'ready' and type(status['assistant_row_id']) is int:
                text = await self.spoken.reply_text(sid, status['assistant_row_id'])
                if text:
                    status['assistant_text'] = text
            return status
        if operation == 'voice.speech':
            voice, text = await self.spoken.speech(sid, params)
            key, _voice = await asyncio.to_thread(eleven_config)
            return await asyncio.to_thread(eleven_voice.speech_stream, key, voice, text, sample_rate=speech_rate)
        if operation == 'voice.end':
            fields(params, ['session_id', 'call_id', 'follow_up'] if 'follow_up' in params else ['session_id', 'call_id'])
            follow_up = params.get('follow_up', False)
            if type(follow_up) is not bool:
                raise InvalidOperation('Invalid call follow-up')
            call = identifier(params['call_id'])
            try:
                has_reply = self.spoken.end(sid, call)
            except InvalidOperation:
                # An expired or already ended call cannot create another record.
                return {}
            saved, added = self.record_call(sid, call)
            if saved and added:
                self.ops.gateway._publish({'type': 'voice.call.ended', 'session_id': sid, 'payload': saved})
            result = {'call': saved} if saved else {}
            if added and has_reply and follow_up and not await self.follow_up(sid):
                result['follow_up_unconfirmed'] = True
            return result
        allowed = {'voice.status': ['session_id'], 'voice.preferences': ['session_id', 'voice', 'complete'],
                   'voice.credential': ['session_id', 'value'], 'voice.session': ['session_id', 'sdp', 'preview'],
                   'voice.provider': ['session_id', 'provider'], 'voice.voices': ['session_id'],
                   'voice.sample': ['session_id', 'voice']}
        if operation not in allowed:
            raise InvalidOperation('Unsupported voice operation')
        requested = params.get('provider', 'openai')
        expected = allowed[operation]
        if operation in {'voice.session', 'voice.preferences', 'voice.credential'} and 'provider' in params:
            expected = [field for field in expected if field != 'sdp' or requested != 'elevenlabs'] + ['provider']
        fields(params, expected)
        if requested not in eleven_voice.PROVIDERS:
            raise InvalidOperation('Choose a supported voice provider')
        from . import eleven_voice
        if operation in {'voice.voices', 'voice.sample'}:
            def read_eleven():
                from hermes_cli.web_server_profiles import _config_profile_scope
                with _CONFIG, _config_profile_scope(profile):
                    selected = eleven_voice.provider()
                    key, confirmed = (eleven_voice.source() if selected == 'elevenlabs'
                                      else grok_voice.source() if selected == 'grok' else ('', False))
                if selected == 'grok':
                    if operation == 'voice.voices':
                        return {'voices': grok_voice.preferences()['voice_labels']}
                    if not confirmed:
                        raise InvalidOperation('Confirm the xAI key first', 'VOICE_KEY_REQUIRED')
                    return grok_voice.sample(key, params['voice'])
                if operation == 'voice.voices':
                    return eleven_voice.catalog(key if confirmed else '')
                if not confirmed:
                    raise InvalidOperation('Confirm the ElevenLabs key first', 'ELEVEN_KEY_REQUIRED')
                return eleven_voice.sample(key, params['voice'])
            return await asyncio.to_thread(read_eleven)
        if sid in self.inflight:
            raise InvalidOperation('Voice setup is already in progress')
        # A single owner/profile-scoped config operation, off the event loop. Do not
        # hold native session/skills locks over provider I/O.
        if operation == 'voice.session' and requested != 'openai':
            raise InvalidOperation('Choose OpenAI for a GPT-Live session', 'VOICE_PREFERENCES_FAILED')
        summary = self.ops.summary(await self.ops.bot(profile)) if operation == 'voice.session' else {}
        name = summary.get('name', '')
        briefing = None
        if operation == 'voice.session' and params.get('preview') is False:
            briefing = await self.briefing(sid, profile, summary, handoff=(
                'Delegate it to your backend (the Hermes agent is you, with all your tools and memory).'))
        def execute_configured():
            from hermes_cli.web_server_profiles import _config_profile_scope
            with _CONFIG, _config_profile_scope(profile):
                if operation == 'voice.provider':
                    eleven_voice.save_voice({'pebble_provider': requested})
                selected = eleven_voice.provider()
                if operation in {'voice.status', 'voice.provider'}:
                    status = (eleven_voice.preferences() if selected == 'elevenlabs'
                              else grok_voice.preferences() if selected == 'grok' else preferences())
                    return {**status, 'providers': list(eleven_voice.PROVIDERS)}
                if requested != selected:
                    raise InvalidOperation('Voice provider changed. Reopen voice settings.', 'VOICE_PREFERENCES_FAILED')
                if selected == 'grok':
                    if operation == 'voice.preferences':
                        return {**grok_voice.save_preferences(params['voice'], params['complete']), 'providers': list(eleven_voice.PROVIDERS)}
                    if operation == 'voice.credential':
                        value = params['value']
                        if not isinstance(value, str) or not re.fullmatch(r'[\x21-\x7e]{8,4096}', value):
                            raise ValueError('Invalid credential')
                        return grok_voice.store_key(value)
                if selected == 'elevenlabs':
                    if operation == 'voice.preferences':
                        return {**eleven_voice.save_preferences(params['voice'], params['complete']), 'providers': list(eleven_voice.PROVIDERS)}
                    if operation == 'voice.credential':
                        value = params['value']
                        if not isinstance(value, str) or not re.fullmatch(r'[\x21-\x7e]{8,4096}', value):
                            raise ValueError('Invalid credential')
                        return eleven_voice.store_key(value)
                if operation == 'voice.preferences':
                    return {**save_preferences(params['voice'], params['complete']), 'providers': list(eleven_voice.PROVIDERS)}
                if operation == 'voice.credential':
                    value = params['value']
                    if not isinstance(value, str) or not re.fullmatch(r'[\x21-\x7e]{8,4096}', value):
                        raise ValueError('Invalid credential')
                    # Do not overwrite a higher-precedence inline voice key or a
                    # reasoning-provider key. Native lifecycle owns storage/refusals.
                    if not resolve_source()['can_change_key']:
                        raise ValueError('Voice already has an explicitly configured key')
                    save_shared_key(value)
                    return {'saved': True, 'validated': False}
                sdp = params['sdp']
                if not isinstance(sdp, str) or not sdp.startswith('v=0') or len(sdp) > 48_000 or type(params['preview']) is not bool:
                    raise ValueError('Invalid voice offer')
                if briefing is None:
                    return create_session(sdp, name, True)
                instructions, history = briefing
                items = [{'type': 'message', 'role': turn['role'],
                          'content': [{'type': 'input_text' if turn['role'] == 'user' else 'output_text',
                                       'text': turn['text']}]} for turn in history]
                return create_session(sdp, name, False, items or None, instructions)
        if sid in self.inflight:
            raise InvalidOperation('Voice setup is already in progress')
        self.inflight.add(sid)
        try:
            result = await asyncio.to_thread(execute_configured)
            return result
        except InvalidOperation:
            raise
        except Exception:
            code = 'VOICE_PREFERENCES_FAILED' if operation == 'voice.preferences' else 'VOICE_SETUP_FAILED'
            raise InvalidOperation('Voice setup could not be confirmed', code) from None
        finally:
            self.inflight.discard(sid)


def register_runtime(ctx):
    if not supported():
        return
    def setup(args, session_id=None, **_kwargs):
        store = None
        try:
            if not isinstance(args, dict) or set(args) - {'replace_key'} or ('replace_key' in args and type(args['replace_key']) is not bool):
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
            server._emit('voice.setup', ui_sid, {'replace_key': args.get('replace_key', False)})
            return json.dumps({'requested': True, 'message': 'Requested private voice setup in the current direct chat. The owner can also open Voice in the composer, enter a key privately, select/preview a voice and start a live call. Never ask for keys as chat text.'})
        except Exception:
            return json.dumps({'error': 'Open this Pebble’s direct chat and select Voice. Never send API keys in messages.'})
        finally:
            if store:
                store.db.close()
    schema = {'name': 'pebble_voice_setup', 'description': 'Open private live-voice setup in the current Pebble Crew chat. When the owner asks to replace their key, set replace_key to true to request private key entry. The owner enters any key outside chat, chooses/previews a voice and starts the call. Never accepts credentials or starts a metered call itself.',
              'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {'replace_key': {'type': 'boolean', 'description': 'Request private key entry when the owner asks to replace the saved voice key.'}}}}
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
    return ('For live voice setup, use pebble_voice_setup with no arguments. When the owner asks to replace their voice key, use replace_key=true to open private key entry; the submitted value is stored by Hermes outside the chat. If deferred, first use tool_describe(names=["pebble_voice_setup"]), then tool_call with its advertised schema. Never ask for an API key as chat text. The owner starts calls explicitly.')
