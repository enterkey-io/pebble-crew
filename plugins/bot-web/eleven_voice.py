"""Owner-held ElevenLabs credentials and transcription and speech."""
import base64
import hashlib
import json
import re
import time
import urllib.error
from urllib.parse import unquote, urlencode, urlsplit
import urllib.request

from .operations import InvalidOperation

PROVIDER = 'elevenlabs'
KEY = 'ELEVENLABS_API_KEY'
VOICE_ID = re.compile(r'[A-Za-z0-9_-]{1,80}')
# Calls and samples use ElevenLabs' highest-quality stable voice model. The faster
# Flash model sounded noticeably worse to the owner.
SPEECH_MODEL = 'eleven_multilingual_v2'
# The former Realtime endpoint accepted "brian"; media endpoints use catalog IDs.
LEGACY_BRIAN = 'nPczCjzI2devNBz1zQrb'
DEFAULT_VOICE = '8dEUmyPMdDdK91vboYih'


def voice_config():
    from hermes_cli.config import read_user_config_raw
    return (read_user_config_raw() or {}).get('voice') or {}


PROVIDERS = ('openai', 'elevenlabs', 'grok')


def provider():
    selected = voice_config().get('pebble_provider')
    return selected if selected in PROVIDERS else 'openai'


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
    labels = {DEFAULT_VOICE: 'Sawyer', **({'brian': 'Brian'} if voice == 'brian' else {})}
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


def request(path, key, payload=None, *, timeout=15, max_bytes=256_000, method=None):
    req = urllib.request.Request('https://api.elevenlabs.io' + path,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={'xi-api-key': key, 'Content-Type': 'application/json'}, method=method)
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
        if error.code == 404 and path.startswith('/v1/voices/'):
            code = 'ELEVEN_SAMPLE_UNAVAILABLE'
        error.close()
        raise InvalidOperation('ElevenLabs refused the voice request', code) from None
    except (OSError, ValueError) as error:
        raise InvalidOperation('ElevenLabs voice request failed', 'ELEVEN_CONNECTION_FAILED') from None


def catalog(key):
    if not key:
        return {'voices': {}}
    query = {'page_size': 20, 'include_total_count': 'false'}
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


def audio_format(data):
    """Identify a sample by its bytes: MP3, WAV, Ogg or MP4/M4A."""
    if data[:3] == b'ID3' or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return 'mp3'
    if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
        return 'wav'
    if data[:4] == b'OggS':
        return 'ogg'
    if data[4:8] == b'ftyp':
        return 'mp4'
    return None


SAMPLE_LIMIT = 8 * 1024 * 1024
SAMPLE_TEXT = 'Hi, this is how I sound on Pebble Crew.'


def read_audio(req):
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as response:
        audio = response.read(SAMPLE_LIMIT + 1)
    # ElevenLabs' storage serves sample MP3s as text/plain, so the header cannot
    # be trusted either way. Accept only bytes that are actually audio.
    if not 0 < len(audio) <= SAMPLE_LIMIT or not audio_format(audio):
        raise ValueError()
    return audio


def sample(key, voice):
    if not isinstance(voice, str) or not VOICE_ID.fullmatch(voice):
        raise InvalidOperation('Choose an ElevenLabs voice')
    ident = LEGACY_BRIAN if voice == 'brian' else voice
    metadata = request('/v1/voices/' + ident, key, max_bytes=1_048_576)
    url = metadata.get('preview_url')
    if isinstance(url, str) and url:
        parsed = urlsplit(url)
        path = unquote(parsed.path)
        trusted = (
            parsed.hostname == 'storage.googleapis.com' and path.startswith('/eleven-public-prod/')
            or parsed.hostname in {'api.elevenlabs.io', 'api.us.elevenlabs.io', 'api.eu.elevenlabs.io'}
            and re.fullmatch(r'/v1/voices/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/audio', path)
        )
        if (not trusted or parsed.scheme != 'https' or parsed.username or parsed.password
                or parsed.port is not None or parsed.fragment or '..' in path.split('/')):
            raise InvalidOperation('ElevenLabs sample is unavailable', 'ELEVEN_SAMPLE_UNAVAILABLE')
        try:
            # Sample links are pre-signed or public; never forward the key to them.
            return {'audio': base64.b64encode(read_audio(urllib.request.Request(url))).decode('ascii')}
        except (OSError, ValueError):
            pass
    # Cloned and designed voices often have no stored sample. Read one short line instead.
    try:
        audio = read_audio(urllib.request.Request(
            'https://api.elevenlabs.io/v1/text-to-speech/' + ident + '?output_format=mp3_44100_64',
            data=json.dumps({'text': SAMPLE_TEXT, 'model_id': SPEECH_MODEL}).encode(),
            headers={'xi-api-key': key, 'Content-Type': 'application/json'}, method='POST'))
        return {'audio': base64.b64encode(audio).decode('ascii')}
    except urllib.error.HTTPError as error:
        code = {401: 'ELEVEN_KEY_REJECTED', 403: 'ELEVEN_ACCESS_DENIED', 429: 'ELEVEN_RATE_LIMITED'}.get(error.code, 'ELEVEN_SAMPLE_UNAVAILABLE')
        error.close()
        raise InvalidOperation('ElevenLabs sample is unavailable', code) from None
    except (OSError, ValueError):
        raise InvalidOperation('ElevenLabs sample is unavailable', 'ELEVEN_SAMPLE_UNAVAILABLE') from None


def transcription_token(key):
    data = request('/v1/single-use-token/realtime_scribe', key, method='POST')
    token = data.get('token')
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_.~-]{12,4096}', token):
        raise InvalidOperation('ElevenLabs returned an invalid transcription token', 'ELEVEN_CONNECTION_FAILED')
    return token


def speech_stream(key, voice, text, *, sample_rate=24000):
    if not isinstance(voice, str) or not VOICE_ID.fullmatch(voice):
        raise InvalidOperation('Choose an ElevenLabs voice')
    req = urllib.request.Request(
        'https://api.elevenlabs.io/v1/text-to-speech/' + (LEGACY_BRIAN if voice == 'brian' else voice) + '/stream?output_format=pcm_' + str(sample_rate),
        data=json.dumps({'text': text, 'model_id': SPEECH_MODEL}).encode(),
        headers={'xi-api-key': key, 'Content-Type': 'application/json'}, method='POST')
    try:
        return urllib.request.build_opener(NoRedirect()).open(req, timeout=15)
    except urllib.error.HTTPError as error:
        code = {401: 'ELEVEN_KEY_REJECTED', 403: 'ELEVEN_ACCESS_DENIED', 429: 'ELEVEN_RATE_LIMITED'}.get(error.code, 'ELEVEN_CONNECTION_FAILED')
        error.close()
        raise InvalidOperation('ElevenLabs could not read the reply', code) from None
    except OSError:
        raise InvalidOperation('ElevenLabs speech request failed', 'ELEVEN_CONNECTION_FAILED') from None
