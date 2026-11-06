"""Create private Atmee characters from explicitly reviewed owner inputs."""
import asyncio
import base64
import hashlib
import json
import os
import stat
import re
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener

from . import atmee_video as atmee
from .operations import InvalidOperation, fields, identifier

STYLES = {
    'warm': 'Warm and conversational, gentle resonance, relaxed pace and friendly inflection.',
    'composed': 'Composed and articulate, clear pronunciation, steady pace and restrained warmth.',
    'bright': 'Bright and upbeat, crisp consonants, lively intonation and an easy conversational pace.',
    'soft': 'Soft and reassuring, smooth timbre, unhurried delivery and gentle intonation.',
}
STORAGE_HOSTS = ('atmanity.us', 'atmee.ai', 'r2.cloudflarestorage.com', 'amazonaws.com', 'storage.googleapis.com')
PENDING = {'preparing', 'creating', 'building'}
ERRORS = {
    'ATMEE_BUILD_SCOPE': 'Use an account-wide Atmee key with avatar and generation write access.',
    'ATMEE_BUILD_CREDITS': 'This Atmee account has no V2-eligible credits. Check your plan or invite in Atmee Studio.',
    'ATMEE_BUILD_INPUT': 'Atmee could not use these inputs. Try another photo or voice style.',
    'ATMEE_KEY_REJECTED': 'Atmee rejected this API key.',
    'STALE_REVISION': 'The Atmee key or Pebble changed. Reopen this editor.',
}
VOICE_WINDOW = 23 * 3600
UNCERTAIN = 'Check your Atmee video avatars before starting another build. Atmee may have received this one.'


def clean_text(value, limit):
    if not isinstance(value, str) or not 0 < len(value.strip()) <= limit:
        raise InvalidOperation('Invalid character description or name')
    return value.strip()


def prepare_profile(profile, bot):
    from hermes_cli.profiles import get_profile_dir
    home = get_profile_dir(profile)
    if profile != 'default' and home.is_symlink():
        raise InvalidOperation('The Hermes profile could not be verified')
    soul = ''
    try:
        fd = os.open(home / 'SOUL.md', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as source:
            if stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                soul = source.read(16_000).decode('utf-8', errors='ignore').strip()
    except OSError:
        pass
    name = (bot.get('name') or profile).strip()[:100]
    role = bot.get('role') or {}
    title = str(role.get('title') or bot.get('title') or '').strip()
    summary = '\n'.join(dict.fromkeys(
        text for value in (bot.get('description'), role.get('description'))
        if isinstance(value, str) and (text := value.strip())))
    instructions = '\n'.join(
        value.strip() for field in ('responsibilities', 'boundaries', 'expectedOutputs')
        if isinstance((value := role.get(field)), str) and value.strip()
    )
    persona = '\n\n'.join(text for text in (
        f'You are {name}' + (f', {title}.' if title else '.'),
        soul[:2300], summary, instructions,
    ) if text)
    return {'name': name, 'persona': persona[:3000].rstrip(), 'has_soul': bool(soul)}


def video_account(key):
    account = atmee.provider('/v1/account', key)
    if (account.get('limits') or {}).get('apiAccess') is False:
        raise InvalidOperation('Atmee API access is required', 'ATMEE_BUILD_SCOPE')
    if account.get('v2Access') in {'unavailable', 'invite_required'}:
        balance = atmee.provider('/v1/account/balance', key)
        if not balance.get('unlimited') and not (balance.get('v2SpendableMicrocredits') or 0) > 0:
            raise InvalidOperation('This Atmee account has no V2-eligible credits', 'ATMEE_BUILD_CREDITS')
    return account


def voice_url(value):
    parsed = urlsplit(value if isinstance(value, str) else '')
    host = parsed.hostname or ''
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port is not None
            or parsed.fragment or not any(host == item or host.endswith('.' + item) for item in STORAGE_HOSTS)):
        raise ValueError('Invalid voice preview location')
    return value


def fetch_voice_sample(url):
    try:
        with build_opener(atmee.NoRedirect()).open(Request(voice_url(url)), timeout=15) as response:
            limit = 12 * 1024 * 1024
            mime = response.headers.get_content_type()
            if mime not in {'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac',
                            'audio/ogg', 'audio/flac', 'audio/webm', 'audio/x-m4a'}:
                raise ValueError()
            data = response.read(limit + 1)
        if not 0 < len(data) <= limit:
            raise ValueError()
        return {'audio': base64.b64encode(data).decode('ascii'), 'mime': mime}
    except (OSError, ValueError):
        raise InvalidOperation('Could not load the Atmee voice sample', 'ATMEE_VOICE_UNAVAILABLE') from None


def existing_voice(key, ident):
    result = atmee.provider('/v1/avatars/' + ident + '/voice', key)
    try:
        return voice_url(result.get('url'))
    except ValueError:
        raise InvalidOperation('This Atmee avatar has no reusable voice sample', 'ATMEE_VOICE_UNAVAILABLE') from None


def read_voice(value):
    if isinstance(value, dict) and isinstance(value.get('id'), str) and atmee.UUID.fullmatch(value['id']):
        if set(value) == {'kind', 'id'} and value['kind'] == 'existing':
            return value
        if (set(value) == {'kind', 'id', 'index'} and value['kind'] == 'designed'
                and type(value['index']) is int and 0 <= value['index'] < 6):
            return value
    raise InvalidOperation('Choose an Atmee voice', 'ATMEE_VOICE_UNAVAILABLE')


def read_recording(value):
    if not isinstance(value, dict) or set(value) != {'kind', 'data'} or value['kind'] != 'recording':
        raise InvalidOperation('Choose an audio recording', 'ATMEE_BUILD_INPUT')
    data = value['data']
    if not isinstance(data, str) or len(data) > 11_185_000:
        raise InvalidOperation('Choose an audio recording up to 8 MB', 'ATMEE_BUILD_INPUT')
    match = re.fullmatch(r'data:(audio/(?:wav|mpeg|mp4));base64,([A-Za-z0-9+/=]+)', data)
    if match:
        mime, encoded = match.groups()
        try:
            audio = base64.b64decode(encoded, validate=True)
        except ValueError:
            audio = b''
        signatures = {
            'audio/wav': audio[:4] == b'RIFF' and audio[8:12] == b'WAVE',
            'audio/mpeg': audio.startswith(b'ID3') or len(audio) >= 2 and audio[0] == 255 and audio[1] & 224 == 224,
            'audio/mp4': audio[4:8] == b'ftyp',
        }
        if 12 <= len(audio) <= 8 * 1024 * 1024 and signatures[mime]:
            return {'kind': 'recording', 'mime': mime, 'audio': audio}
    raise InvalidOperation('Choose an MP3, M4A or WAV recording', 'ATMEE_BUILD_INPUT')


def portrait_upload(key, photo):
    return media_upload(key, 'portrait', 'image/png', base64.b64decode(photo.split(',', 1)[1]))


def media_upload(key, kind, mime, blob):
    ticket = atmee.provider('/v1/uploads', key, {'kind': kind, 'contentType': mime})
    upload, target, supplied = ticket.get('uploadId'), ticket.get('uploadUrl'), ticket.get('uploadHeaders')
    if not isinstance(upload, str) or not atmee.UUID.fullmatch(upload) or not isinstance(supplied, dict):
        raise InvalidOperation('Invalid Atmee upload ticket', 'ATMEE_UNAVAILABLE')
    try:
        parsed = urlsplit(target if isinstance(target, str) else '')
        host = parsed.hostname or ''
        if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port is not None
                or parsed.fragment or not any(host == item or host.endswith('.' + item) for item in STORAGE_HOSTS)):
            raise ValueError()
        headers = {}
        for name, value in supplied.items():
            if (not re.fullmatch(r'content-type|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+', name.lower())
                    or not isinstance(value, str) or not re.fullmatch(r'[ -~]{1,1000}', value)):
                raise ValueError()
            headers[name.lower()] = value
        if headers.setdefault('content-type', mime) != mime:
            raise ValueError()
        request = Request(target, data=blob, headers=headers, method='PUT')
        with build_opener(atmee.NoRedirect()).open(request, timeout=20):
            pass
    except (URLError, OSError, ValueError, TypeError):
        raise InvalidOperation('Could not upload Atmee media', 'ATMEE_UNAVAILABLE') from None
    for _ in range(5):
        status = atmee.provider('/v1/uploads/' + upload, key).get('status')
        if status == 'uploaded':
            return 'upload:' + upload
        if status != 'pending':
            break
        time.sleep(0.6)
    raise InvalidOperation('Could not confirm Atmee media upload', 'ATMEE_UNAVAILABLE')


def generated_voice(key, request_id, name, style):
    result = atmee.provider('/v1/generation/voices', key,
                            {'voiceDescription': STYLES[style], 'avatarName': name, 'language': 'en'},
                            idempotency=request_id)
    voices = result.get('voices')
    for voice in voices if isinstance(voices, list) else []:
        upload = voice.get('upload') if isinstance(voice, dict) else None
        if isinstance(upload, str) and upload.startswith('upload:') and atmee.UUID.fullmatch(upload[7:]):
            return upload
    raise InvalidOperation('Atmee returned no usable voice', 'ATMEE_UNAVAILABLE')


class AtmeeBuilds:
    def __init__(self, store, pebble):
        self.db = store.db
        self.pebble = pebble
        self.tasks = set()

    def recover(self):
        with self.db:
            unsubmitted = {row[0] for row in self.db.execute("SELECT id FROM atmee_build WHERE state='preparing'")}
            if unsubmitted:
                for ident, encoded in self.db.execute("SELECT id,options FROM atmee_voice_design WHERE state='ready'").fetchall():
                    options = json.loads(encoded)
                    changed = False
                    for option in options:
                        if option.get('build') in unsubmitted:
                            option.pop('build')
                            changed = True
                    if changed:
                        self.db.execute('UPDATE atmee_voice_design SET options=? WHERE id=?',
                                        (json.dumps(options), ident))
            self.db.execute("UPDATE atmee_build SET state='failed',error=? WHERE state='preparing'",
                            ('Build interrupted. Check your Atmee usage before starting again.',))
            self.db.execute("UPDATE atmee_build SET state='uncertain',error=? WHERE state='creating'", (UNCERTAIN,))
            self.db.execute("UPDATE atmee_voice_design SET state='failed',error=? WHERE state='pending'",
                            ('Voice design was interrupted. Check Atmee usage before generating again.',))

    async def shutdown(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.recover()

    def receipt(self, row):
        request_id, name, state, avatar, error = row
        return {'id': request_id, 'name': name, 'state': 'preparing' if state == 'creating' else state,
                'avatar': avatar, 'error': error}

    def change(self, request_id, state, *, avatar=None, error=None):
        with self.db:
            self.db.execute('UPDATE atmee_build SET state=?,avatar=?,error=? WHERE id=?',
                            (state, avatar, error, request_id))

    async def invoke(self, operation, params):
        if operation == 'atmee.build.profile':
            fields(params, ['bot_id'])
            profile, bot = self.pebble(identifier(params['bot_id']))
            key = atmee.read_key()
            if not key:
                raise InvalidOperation('Add an Atmee API key', 'ATMEE_KEY_REJECTED')
            await asyncio.to_thread(video_account, key)
            return await asyncio.to_thread(prepare_profile, profile, bot)
        if operation.startswith('atmee.voice.'):
            return await self.voice_operation(operation, params)
        build_fields = ['bot_id', 'request_id', 'name', 'persona', 'photo']
        fields(params, ['bot_id'] if operation == 'atmee.build.status' else
               [*build_fields, 'voice' if 'voice' in params else 'voice_style'])
        bot = identifier(params['bot_id'])
        self.pebble(bot)
        key = atmee.read_key()
        if not key:
            return {'build': None}
        fingerprint = hashlib.sha256(key.encode()).hexdigest()
        latest = self.db.execute('SELECT id,name,state,avatar,error FROM atmee_build WHERE bot=? AND key_hash=? '
                                 'ORDER BY created DESC LIMIT 1', (bot, fingerprint)).fetchone()
        if operation == 'atmee.build.status':
            return {'build': await self.status(key, latest) if latest else None}
        request_id = params['request_id']
        if not isinstance(request_id, str) or not atmee.UUID.fullmatch(request_id):
            raise InvalidOperation('Invalid character request')
        seen = self.db.execute('SELECT id,name,state,avatar,error,bot,key_hash FROM atmee_build WHERE id=?',
                               (request_id,)).fetchone()
        if seen:
            if seen[5:] != (bot, fingerprint):
                raise InvalidOperation('Invalid character request')
            return {'build': self.receipt(seen[:5])}
        if latest and latest[2] in PENDING:
            return {'build': self.receipt(latest)}
        if len(self.tasks) >= 2:
            raise InvalidOperation('Atmee builds are busy', 'CAPACITY')
        if operation == 'atmee.build.recording':
            voice = read_recording(params.get('voice'))
        else:
            voice = read_voice(params['voice']) if 'voice' in params else params['voice_style']
        if isinstance(voice, str) and voice not in STYLES:
            raise InvalidOperation('Invalid voice style')
        if not isinstance(voice, (str, dict)):
            raise InvalidOperation('Invalid voice')
        designed = isinstance(voice, dict) and voice['kind'] == 'designed'
        if designed:
            self.design_option(voice, bot, fingerprint)
        name = clean_text(params['name'], 100)
        persona = clean_text(params['persona'], 3000)
        from .workspace import normalize_photo
        photo = normalize_photo(params['photo'], size=896, square=False)
        with self.db:
            self.db.execute('INSERT INTO atmee_build VALUES(?,?,?,?,?,NULL,NULL,?)',
                            (request_id, bot, fingerprint, name, 'preparing', time.time()))
            if designed:
                self.reserve_design(voice, request_id)
        task = asyncio.create_task(self.run(key, bot, request_id, name, persona, voice, photo))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return {'build': self.receipt((request_id, name, 'preparing', None, None))}

    def design_receipt(self, row):
        if not row:
            return {'design': None}
        request_id, state, options, error = row
        if error == 'Atmee could not design a voice. Check Atmee usage before trying again.':
            error = 'The previous request ended without a saved voice sample. Check Atmee Studio or upload a recording.'
        options = json.loads(options) if options else []
        return {'design': {'id': request_id, 'state': state, 'count': len(options),
                           'used': [index for index, option in enumerate(options) if option.get('build')],
                           'error': error}}

    def reserve_design(self, selection, request_id):
        row = self.db.execute('SELECT options FROM atmee_voice_design WHERE id=?',
                              (selection['id'],)).fetchone()
        options = json.loads(row[0])
        option = options[selection['index']]
        if request_id is None:
            option.pop('build', None)
        else:
            option['build'] = request_id
        self.db.execute('UPDATE atmee_voice_design SET options=? WHERE id=?',
                        (json.dumps(options), selection['id']))

    def design_option(self, selection, bot, fingerprint, request_id=None):
        row = self.db.execute("SELECT options FROM atmee_voice_design WHERE id=? AND bot=? AND key_hash=? "
                              "AND state='ready' AND created>?", (selection['id'], bot, fingerprint,
                                                                 time.time() - VOICE_WINDOW)).fetchone()
        options = json.loads(row[0]) if row else []
        if selection['index'] >= len(options):
            raise InvalidOperation('This voice design expired. Generate new samples.', 'ATMEE_VOICE_UNAVAILABLE')
        option = options[selection['index']]
        if option.get('build') and option['build'] != request_id:
            raise InvalidOperation('This generated voice is already used', 'ATMEE_VOICE_UNAVAILABLE')
        return option

    async def voice_operation(self, operation, params):
        extras = {'atmee.voice.status': [], 'atmee.voice.design': ['request_id', 'description', 'name'],
                  'atmee.voice.sample': ['voice']}
        fields(params, ['bot_id', *extras[operation]])
        bot = identifier(params['bot_id'])
        self.pebble(bot)
        key = atmee.read_key()
        if not key:
            raise InvalidOperation('Add an Atmee API key', 'ATMEE_KEY_REJECTED')
        fingerprint = hashlib.sha256(key.encode()).hexdigest()
        if operation == 'atmee.voice.sample':
            voice = read_voice(params['voice'])
            url = (self.design_option(voice, bot, fingerprint)['url'] if voice['kind'] == 'designed'
                   else await asyncio.to_thread(existing_voice, key, voice['id']))
            self.check_scope(bot, key)
            return await asyncio.to_thread(fetch_voice_sample, url)
        latest = self.db.execute('SELECT id,state,options,error FROM atmee_voice_design WHERE bot=? AND key_hash=? '
                                 'AND created>? ORDER BY created DESC LIMIT 1',
                                 (bot, fingerprint, time.time() - VOICE_WINDOW)).fetchone()
        if operation == 'atmee.voice.status':
            return self.design_receipt(latest)
        request_id = params['request_id']
        if not isinstance(request_id, str) or not atmee.UUID.fullmatch(request_id):
            raise InvalidOperation('Invalid voice design request')
        description = clean_text(params['description'], 1000)
        if len(description) < 20:
            raise InvalidOperation('Describe the voice in at least 20 characters', 'ATMEE_BUILD_INPUT')
        name = clean_text(params['name'], 100)
        prior = self.db.execute('SELECT id,state,options,error,bot,key_hash FROM atmee_voice_design WHERE id=?',
                                (request_id,)).fetchone()
        if prior:
            if prior[4:] != (bot, fingerprint):
                raise InvalidOperation('Invalid voice design request')
            return self.design_receipt(prior[:4])
        if latest and latest[1] == 'pending':
            return self.design_receipt(latest)
        if len(self.tasks) >= 2:
            raise InvalidOperation('Atmee is busy', 'CAPACITY')
        with self.db:
            self.db.execute("DELETE FROM atmee_voice_design WHERE created<? AND state!='pending'",
                            (time.time() - 2 * VOICE_WINDOW,))
            self.db.execute("INSERT INTO atmee_voice_design VALUES(?,?,?,?,'pending',NULL,NULL)",
                            (request_id, bot, fingerprint, time.time()))
        task = asyncio.create_task(self.design(key, bot, request_id, description, name))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return self.design_receipt((request_id, 'pending', None, None))

    async def design(self, key, bot, request_id, description, name):
        options, error = [], None
        try:
            if not atmee.can_build(await asyncio.to_thread(atmee.key_permissions, key)):
                raise InvalidOperation('Key cannot design a voice', 'ATMEE_BUILD_SCOPE')
            self.check_scope(bot, key)
            await asyncio.to_thread(video_account, key)
            payload = {
                'voiceDescription': description, 'avatarName': name, 'language': 'en',
                'sampleText': (
                    'Hello, it is good to see you. Let’s take a moment to decide what matters most today, '
                    'and then we can get started. Tell me what you are working on, what is going well, and '
                    'where you could use a little help. We can take it one step at a time.'
                ),
            }
            for attempt in range(3):
                self.check_scope(bot, key)
                try:
                    result = await asyncio.to_thread(atmee.provider, atmee.VOICE_DESIGN_PATH, key,
                                                     payload, idempotency=request_id)
                    break
                except atmee.VoiceDesignFailure as failure:
                    if attempt == 2 or failure.retry_after is None:
                        raise
                    await asyncio.sleep(failure.retry_after)
            self.check_scope(bot, key)
            rows = result.get('voices')
            for item in rows[:6] if isinstance(rows, list) else []:
                upload = item.get('upload') if isinstance(item, dict) else None
                if not isinstance(upload, str) or not upload.startswith('upload:') or not atmee.UUID.fullmatch(upload[7:]):
                    continue
                if item.get('unavailable') is True:
                    continue
                try:
                    url = voice_url(item.get('url'))
                except ValueError:
                    url = None
                options.append({'upload': upload, 'url': url})
            if not options:
                raise atmee.VoiceDesignFailure('ATMEE_VOICE_PROVIDER_FAILED')
        except atmee.VoiceDesignFailure as failure:
            error = atmee.VOICE_DESIGN_ERRORS[failure.code]
        except InvalidOperation as failure:
            error = ERRORS.get(failure.code, 'Atmee did not confirm voice design. Check Atmee Studio before trying again.')
        except (OSError, ValueError, TypeError):
            error = atmee.VOICE_DESIGN_ERRORS['ATMEE_VOICE_UNCONFIRMED']
        with self.db:
            self.db.execute('UPDATE atmee_voice_design SET state=?,options=?,error=? WHERE id=?',
                            ('failed' if error else 'ready', json.dumps(options) if not error else None,
                             error, request_id))

    async def status(self, key, row):
        request_id, name, state, avatar, error = row
        if state != 'building':
            return self.receipt(row)
        remote = await asyncio.to_thread(atmee.provider, '/v1/avatars/' + avatar, key)
        if remote.get('id') != avatar:
            raise InvalidOperation('Invalid character build receipt', 'ATMEE_UNAVAILABLE')
        if remote.get('readyToChat') is True:
            state = 'ready'
        elif remote.get('status') in {'failed', 'stalled', 'moderation_hold', 'draft'}:
            state = 'failed'
            error = 'Atmee could not finish this video avatar. Check the build in Atmee Studio.'
        if state != 'building':
            self.change(request_id, state, avatar=avatar, error=error)
        return self.receipt((request_id, name, state, avatar, error))

    async def run(self, key, bot, request_id, name, persona, voice_choice, photo):
        creating = False
        try:
            permissions = await asyncio.to_thread(atmee.key_permissions, key)
            if not atmee.can_create(permissions) or (isinstance(voice_choice, str) and not atmee.can_build(permissions)):
                raise InvalidOperation('Key cannot create video avatars', 'ATMEE_BUILD_SCOPE')
            account = await asyncio.to_thread(video_account, key)
            limits = account.get('limits') or {}
            sizes = limits.get('v2Resolutions') or []
            portrait_size = {'width': 384, 'height': 672}
            self.check_scope(bot, key)
            portrait = await asyncio.to_thread(portrait_upload, key, photo)
            self.check_scope(bot, key)
            if isinstance(voice_choice, str):
                voice = await asyncio.to_thread(generated_voice, key, request_id, name, voice_choice)
            elif voice_choice['kind'] == 'recording':
                voice = await asyncio.to_thread(media_upload, key, 'voice', voice_choice['mime'], voice_choice['audio'])
            elif voice_choice['kind'] == 'existing':
                voice = await asyncio.to_thread(existing_voice, key, voice_choice['id'])
            else:
                voice = self.design_option(voice_choice, bot, hashlib.sha256(key.encode()).hexdigest(), request_id)['upload']
            self.check_scope(bot, key)
            manifest = {
                'schemaVersion': 1, 'name': name, 'engine': 'v2', 'language': 'en',
                'visibility': 'private', 'persona': {'whoPrompt': persona},
                'assets': {'image': {'url': portrait}, 'voice': {'url': voice}},
            }
            if portrait_size in sizes:
                manifest['resolution'] = portrait_size
            self.change(request_id, 'creating')
            creating = True
            result = await asyncio.to_thread(atmee.provider, '/v1/avatars', key, manifest)
            avatar = result.get('avatarId')
            status = result.get('status')
            if (not isinstance(avatar, str) or not atmee.UUID.fullmatch(avatar)
                    or status not in {'building', 'ready', 'draft'}):
                raise InvalidOperation('Invalid character build receipt', 'ATMEE_UNAVAILABLE')
            if result.get('kind') != 'conversational' or status == 'draft':
                self.change(request_id, 'failed', avatar=avatar,
                            error='Atmee saved a draft. Check the video avatar in Atmee Studio.')
            else:
                self.change(request_id, 'building', avatar=avatar)
        except InvalidOperation as error:
            if creating and error.code == 'ATMEE_UNAVAILABLE':
                self.change(request_id, 'uncertain', error=UNCERTAIN)
            else:
                self.change(request_id, 'failed', error=ERRORS.get(error.code, 'Atmee could not finish the build. Check your Atmee account before trying again.'))
        except Exception:
            self.change(request_id, 'uncertain' if creating else 'failed',
                        error=UNCERTAIN if creating else 'Could not prepare the video avatar.')

        finally:
            if not creating and isinstance(voice_choice, dict) and voice_choice['kind'] == 'designed':
                with self.db:
                    self.reserve_design(voice_choice, None)

    def check_scope(self, bot, key):
        self.pebble(bot)
        if atmee.read_key() != key:
            raise InvalidOperation('The key changed', 'STALE_REVISION')
