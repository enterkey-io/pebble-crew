"""Create private Atmee characters from explicitly reviewed owner inputs."""
import asyncio
import base64
import hashlib
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
    'ATMEE_BUILD_SCOPE': 'Use an account-wide Atmee key with character and generation write access.',
    'ATMEE_BUILD_CREDITS': 'Check your Atmee credits and V2 access.',
    'ATMEE_BUILD_INPUT': 'Atmee could not use these inputs. Try another photo or voice style.',
    'ATMEE_KEY_REJECTED': 'Atmee rejected this API key.',
    'STALE_REVISION': 'The Atmee key or Pebble changed. Reopen this editor.',
}
UNCERTAIN = 'Check your Atmee characters before starting another build. Atmee may have received this one.'


def clean_text(value, limit):
    if not isinstance(value, str) or not 0 < len(value.strip()) <= limit:
        raise InvalidOperation('Invalid character description or name')
    return value.strip()


def portrait_upload(key, photo):
    ticket = atmee.provider('/v1/uploads', key, {'kind': 'portrait', 'contentType': 'image/png'})
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
        if headers.setdefault('content-type', 'image/png') != 'image/png':
            raise ValueError()
        blob = base64.b64decode(photo.split(',', 1)[1])
        request = Request(target, data=blob, headers=headers, method='PUT')
        with build_opener(atmee.NoRedirect()).open(request, timeout=20):
            pass
    except (URLError, OSError, ValueError, TypeError):
        raise InvalidOperation('Could not upload portrait', 'ATMEE_UNAVAILABLE') from None
    for _ in range(5):
        status = atmee.provider('/v1/uploads/' + upload, key).get('status')
        if status == 'uploaded':
            return 'upload:' + upload
        if status != 'pending':
            break
        time.sleep(0.6)
    raise InvalidOperation('Could not confirm portrait upload', 'ATMEE_UNAVAILABLE')


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
            self.db.execute("UPDATE atmee_build SET state='failed',error=? WHERE state='preparing'",
                            ('Build interrupted. Check your Atmee usage before starting again.',))
            self.db.execute("UPDATE atmee_build SET state='uncertain',error=? WHERE state='creating'", (UNCERTAIN,))

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
        fields(params, ['bot_id'] if operation == 'atmee.build.status' else
               ['bot_id', 'request_id', 'name', 'persona', 'voice_style', 'photo'])
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
        request_id, style = params['request_id'], params['voice_style']
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
        if not isinstance(style, str) or style not in STYLES:
            raise InvalidOperation('Invalid voice style')
        name = clean_text(params['name'], 100)
        persona = clean_text(params['persona'], 3000)
        from .workspace import normalize_photo
        photo = normalize_photo(params['photo'], size=896, square=False)
        with self.db:
            self.db.execute('INSERT INTO atmee_build VALUES(?,?,?,?,?,NULL,NULL,?)',
                            (request_id, bot, fingerprint, name, 'preparing', time.time()))
        task = asyncio.create_task(self.run(key, bot, request_id, name, persona, style, photo))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return {'build': self.receipt((request_id, name, 'preparing', None, None))}

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
            error = 'Atmee could not finish this character. Check the build in Atmee Studio.'
        if state != 'building':
            self.change(request_id, state, avatar=avatar, error=error)
        return self.receipt((request_id, name, state, avatar, error))

    async def run(self, key, bot, request_id, name, persona, style, photo):
        creating = False
        try:
            if not atmee.can_build(await asyncio.to_thread(atmee.key_permissions, key)):
                raise InvalidOperation('Key cannot create characters', 'ATMEE_BUILD_SCOPE')
            account = await asyncio.to_thread(atmee.provider, '/v1/account', key)
            access = account.get('v2Access')
            plan = (account.get('plan') or {}).get('code')
            if access == 'unavailable' or (access == 'invite_required' and plan in {'free', 'starter'}):
                raise InvalidOperation('Atmee V2 access is required', 'ATMEE_BUILD_CREDITS')
            limits = account.get('limits') or {}
            if limits.get('apiAccess') is False:
                raise InvalidOperation('Atmee API access is required', 'ATMEE_BUILD_SCOPE')
            sizes = limits.get('v2Resolutions') or []
            portrait_size = {'width': 384, 'height': 672}
            self.check_scope(bot, key)
            portrait = await asyncio.to_thread(portrait_upload, key, photo)
            self.check_scope(bot, key)
            voice = await asyncio.to_thread(generated_voice, key, request_id, name, style)
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
                            error='Atmee saved a draft. Check the character in Atmee Studio.')
            else:
                self.change(request_id, 'building', avatar=avatar)
        except InvalidOperation as error:
            if creating and error.code == 'ATMEE_UNAVAILABLE':
                self.change(request_id, 'uncertain', error=UNCERTAIN)
            else:
                self.change(request_id, 'failed', error=ERRORS.get(error.code, 'Atmee could not finish the build. Check your Atmee account before trying again.'))
        except Exception:
            self.change(request_id, 'uncertain' if creating else 'failed',
                        error=UNCERTAIN if creating else 'Could not prepare the Atmee character.')

    def check_scope(self, bot, key):
        self.pebble(bot)
        if atmee.read_key() != key:
            raise InvalidOperation('The key changed', 'STALE_REVISION')
