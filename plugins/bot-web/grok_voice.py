"""Owner-held xAI credentials for Grok Voice calls, previews and browser tokens."""
import base64
import hashlib
import json
import urllib.error
import urllib.request

from .operations import InvalidOperation

PROVIDER = 'grok'
KEY = 'XAI_API_KEY'
MODEL = 'grok-voice-latest'
API = 'https://api.x.ai'
# xAI's built-in voices (docs.x.ai text-to-speech#voices). xAI publishes no gender,
# so these groups come from each published sample's measured speaking pitch.
FEMALE_VOICES = ('ara', 'aurora', 'carina', 'celeste', 'eve', 'helix', 'iris', 'liora', 'luna', 'ursa')
MALE_VOICES = ('altair', 'atlas', 'castor', 'cosmo', 'helios', 'kepler', 'leo', 'lumen', 'lux',
               'naksh', 'orion', 'perseus', 'rex', 'rigel', 'sal', 'sirius', 'zagan', 'zenith')
VOICES = FEMALE_VOICES + MALE_VOICES
DEFAULT_VOICE = 'eve'
SAMPLE_TEXT = 'Hi, this is my Grok voice on Pebble Crew. How do I sound?'


def _config():
    from .eleven_voice import voice_config
    return voice_config().get('grok') or {}


def source():
    from agent.secret_scope import get_secret_str
    from hermes_cli.config import load_env
    from hermes_cli.web_server_profiles import _config_profile_scope
    with _config_profile_scope('default'):
        key = load_env().get(KEY) or get_secret_str(KEY) or ''
        return key, bool(key) and _config().get('pebble_key_fingerprint') == hashlib.sha256(key.encode()).hexdigest()


def approve_key(key):
    from hermes_cli.web_server_profiles import _config_profile_scope
    from .eleven_voice import save_voice
    if not key:
        raise InvalidOperation('Add an xAI API key for Grok voice', 'VOICE_KEY_REQUIRED')
    with _config_profile_scope('default'):
        save_voice({'grok': {**_config(), 'pebble_key_fingerprint': hashlib.sha256(key.encode()).hexdigest()}})


def store_key(value):
    from hermes_cli.config import load_env, save_env_value_secure
    from hermes_cli.web_server_profiles import _config_profile_scope
    with _config_profile_scope('default'):
        receipt = save_env_value_secure(KEY, value)
        if receipt.get('success') is not True or load_env().get(KEY) != value:
            raise InvalidOperation('Hermes could not confirm the key save', 'VOICE_PREFERENCES_FAILED')
    approve_key(value)
    return {'saved': True, 'validated': False}


def selected_voice():
    voice = _config().get('pebble_voice')
    return voice if voice in VOICES else DEFAULT_VOICE


def preferences():
    key, confirmed = source()
    return {'supported': True, 'provider': PROVIDER, 'configured': bool(key),
            'voice': selected_voice(), 'voices': list(VOICES),
            'voice_labels': {voice: voice.title() for voice in VOICES},
            'setup_complete': confirmed and _config().get('pebble_setup_complete') is True,
            'key_confirmed': confirmed, 'can_change_key': True}


def save_preferences(voice, complete):
    from .eleven_voice import save_voice
    if voice not in VOICES or type(complete) is not bool:
        raise InvalidOperation('Choose a Grok voice')
    key, confirmed = source()
    if not confirmed:
        approve_key(key)
    settings = {**_config(), 'pebble_voice': voice}
    if complete:
        settings['pebble_setup_complete'] = True
    save_voice({'grok': settings})
    return preferences()


def _post(path, key, payload, *, max_bytes=256_000, timeout=20):
    from .eleven_voice import NoRedirect
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(), method='POST',
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    # Only a known error code leaves this boundary; never return or log vendor bodies.
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise InvalidOperation('xAI returned too much data', 'VOICE_PROVIDER_UNAVAILABLE')
            return body, response.headers.get('Content-Type', '')
    except urllib.error.HTTPError as error:
        code = {401: 'VOICE_KEY_REJECTED', 403: 'VOICE_ACCESS_DENIED', 429: 'VOICE_RATE_LIMITED'}.get(
            error.code, 'VOICE_PROVIDER_UNAVAILABLE' if error.code >= 500 else 'VOICE_SETUP_FAILED')
        error.close()
        raise InvalidOperation('xAI refused the voice request', code) from None
    except OSError:
        raise InvalidOperation('xAI could not be reached', 'VOICE_PROVIDER_UNREACHABLE') from None


def sample(key, voice):
    if voice not in VOICES:
        raise InvalidOperation('Choose a Grok voice')
    audio, _type = _post('/v1/tts', key, {'text': SAMPLE_TEXT, 'voice_id': voice, 'language': 'en'},
                         max_bytes=2_000_000)
    if len(audio) < 1000:
        raise InvalidOperation('xAI returned no sample audio', 'VOICE_PROVIDER_UNAVAILABLE')
    return {'audio': base64.b64encode(audio).decode('ascii')}


def client_secret(key):
    """A short-lived token for the owner's browser; the API key stays on the server."""
    body, _type = _post('/v1/realtime/client_secrets', key, {'expires_after': {'seconds': 300}})
    try:
        value = json.loads(body).get('value')
    except (ValueError, AttributeError):
        value = None
    if not isinstance(value, str) or not 16 <= len(value) <= 4096 or any(ch.isspace() for ch in value):
        raise InvalidOperation('xAI returned an invalid voice token', 'VOICE_PROVIDER_UNAVAILABLE')
    return value
