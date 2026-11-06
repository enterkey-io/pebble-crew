"""Owner-held ElevenLabs credentials and fixed Realtime session configuration."""
import hashlib
import json
import re
import secrets
import time
import urllib.error
from urllib.parse import urlencode
import urllib.request

from .operations import InvalidOperation

PROVIDER = 'elevenlabs'
KEY = 'ELEVENLABS_API_KEY'
VOICE_ID = re.compile(r'[A-Za-z0-9_-]{1,80}')
DEFAULT_VOICE = 'brian'
MODEL = 'eleven_realtime_v1_max'


def voice_config():
    from hermes_cli.config import read_user_config_raw
    return (read_user_config_raw() or {}).get('voice') or {}


def provider():
    return PROVIDER if voice_config().get('pebble_provider') == PROVIDER else 'openai'


def save_voice(settings):
    from hermes_cli.config import _CONFIG_LOCK, read_user_config_raw, save_config
    with _CONFIG_LOCK:
        config = read_user_config_raw() or {}
        config['voice'] = {**(config.get('voice') or {}), **settings}
        paths = {('voice', name) for name in settings}
        paths.update(('voice', 'elevenlabs', name) for name in settings.get('elevenlabs', {}))
        save_config(config, preserve_keys=paths)
    current = voice_config()
    if any(current.get(name) != value for name, value in settings.items()):
        raise InvalidOperation('Hermes could not confirm the voice setting', 'VOICE_PREFERENCES_FAILED')


def source():
    from agent.secret_scope import get_secret_str
    from hermes_cli.config import load_env
    from hermes_cli.web_server_profiles import _config_profile_scope
    with _config_profile_scope('default'):
        key = load_env().get(KEY) or get_secret_str(KEY) or ''
        config = voice_config().get('elevenlabs') or {}
        return key, bool(key) and config.get('pebble_key_fingerprint') == hashlib.sha256(key.encode()).hexdigest()


def approve_key(key):
    from hermes_cli.web_server_profiles import _config_profile_scope
    if not key:
        raise InvalidOperation('Add an ElevenLabs API key for voice', 'ELEVEN_KEY_REQUIRED')
    with _config_profile_scope('default'):
        config = voice_config().get('elevenlabs') or {}
        save_voice({'elevenlabs': {**config, 'pebble_key_fingerprint': hashlib.sha256(key.encode()).hexdigest()}})


def store_key(value):
    from hermes_cli.config import load_env, save_env_value_secure
    from hermes_cli.web_server_profiles import _config_profile_scope
    with _config_profile_scope('default'):
        receipt = save_env_value_secure(KEY, value)
        if receipt.get('success') is not True or load_env().get(KEY) != value:
            raise InvalidOperation('Hermes could not confirm the key save', 'VOICE_PREFERENCES_FAILED')
    approve_key(value)
    return {'saved': True, 'validated': False}


def preferences():
    config = voice_config().get('elevenlabs') or {}
    key, confirmed = source()
    voice = config.get('pebble_voice')
    if not isinstance(voice, str) or not VOICE_ID.fullmatch(voice):
        voice = DEFAULT_VOICE
    labels = {DEFAULT_VOICE: 'Brian'}
    return {'supported': True, 'provider': PROVIDER, 'configured': bool(key),
        'voice': voice, 'voices': list(dict.fromkeys([*labels, voice])), 'voice_labels': labels,
        'setup_complete': confirmed and config.get('pebble_setup_complete') is True,
        'key_confirmed': confirmed, 'can_change_key': True}


def save_preferences(voice, complete):
    if not isinstance(voice, str) or not VOICE_ID.fullmatch(voice) or type(complete) is not bool:
        raise InvalidOperation('Choose a valid ElevenLabs voice')
    key, confirmed = source()
    if not confirmed:
        approve_key(key)
    current = voice_config().get('elevenlabs') or {}
    settings = {**current, 'pebble_voice': voice}
    if complete:
        settings['pebble_setup_complete'] = True
    save_voice({'elevenlabs': settings})
    return preferences()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(path, key, payload=None, *, timeout=15, max_bytes=256_000):
    req = urllib.request.Request('https://api.elevenlabs.io' + path,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError("Response exceeds the size limit")
            value = json.loads(body)
            if not isinstance(value, dict):
                raise ValueError('Expected an object')
            return value
    except urllib.error.HTTPError as error:
        code = {401: 'ELEVEN_KEY_REJECTED', 403: 'ELEVEN_ACCESS_DENIED', 429: 'ELEVEN_RATE_LIMITED'}.get(error.code, 'ELEVEN_CONNECTION_FAILED')
        error.close()
        raise InvalidOperation('ElevenLabs refused the voice request', code) from None
    except (OSError, ValueError) as error:
        raise InvalidOperation('ElevenLabs voice request failed', 'ELEVEN_CONNECTION_FAILED') from None


def catalog(key):
    if not key:
        return {'voices': {}}
    query = {'voice_type': 'saved', 'page_size': 20, 'include_total_count': 'false'}
    voices = {}
    visited = set()
    deadline = time.monotonic() + 15
    while len(visited) < 100:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        page = request('/v2/voices?' + urlencode(query), key, timeout=remaining, max_bytes=1_048_576)
        entries = page.get('voices')
        has_more = page.get('has_more')
        if not isinstance(entries, list) or type(has_more) is not bool:
            break
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            ident, name = entry.get('voice_id'), entry.get('name')
            if isinstance(ident, str) and VOICE_ID.fullmatch(ident) and isinstance(name, str) and 0 < len(name) <= 100:
                voices.setdefault(ident, name)
        if not has_more:
            return {'voices': voices}
        cursor = page.get('next_page_token')
        if not isinstance(cursor, str) or not 0 < len(cursor) <= 4096 or cursor in visited:
            break
        visited.add(cursor)
        query['next_page_token'] = cursor
    raise InvalidOperation('ElevenLabs returned an incomplete voice list', 'ELEVEN_CONNECTION_FAILED')


def session_parameters(name, preview):
    key, confirmed = source()
    if not confirmed:
        raise InvalidOperation('Approve an ElevenLabs key first', 'ELEVEN_KEY_REQUIRED')
    voice = preferences()['voice']
    instructions = ('Read the supplied preview line once. Then wait silently.' if preview else
        f'You are the speaking voice for {name}, a Hermes Pebble. Talk naturally. '
        'For work, tools, personal facts, or decisions that depend on workspace context, call ask_pebble. '
        'Pass the request faithfully, including essential spoken context. Never claim that a tool or approval '
        'completed until Hermes confirms it. When a result arrives, speak it concisely.')
    session = {'type': 'realtime', 'model': MODEL, 'instructions': instructions,
        'output_modalities': ['audio'], 'max_duration_seconds': 60 if preview else 3600,
        'audio': {'input': {'format': {'type': 'audio/pcm', 'rate': 24000},
            'turn_detection': None if preview else {'type': 'semantic_vad', 'eagerness': 'medium',
                'create_response': True, 'interrupt_response': True}},
            'output': {'format': {'type': 'audio/pcm', 'rate': 24000}, 'voice': voice}}}
    if not preview:
        session['tools'] = [{'type': 'function', 'name': 'ask_pebble',
            'description': 'Send a request to the selected Hermes Pebble using its existing tools and memory.',
            'parameters': {'type': 'object', 'properties': {'request': {'type': 'string'}},
                'required': ['request'], 'additionalProperties': False}}]
    return key, session


def create_session(key, session):
    value = request('/v1/convai/realtime/client_secrets', key,
        {'session': session, 'expires_after': {'anchor': 'created_at', 'seconds': 120}})
    secret = value.get('value') if isinstance(value, dict) else None
    if not isinstance(secret, str) or not re.fullmatch(r'[A-Za-z0-9_.~-]{12,4096}', secret):
        raise InvalidOperation('ElevenLabs returned an invalid credential', 'ELEVEN_CONNECTION_FAILED')
    return {'provider': PROVIDER, 'session': {'id': secrets.token_urlsafe(24)}, 'client_secret': secret}
