"""Private conversation attachments. Paths are server-selected and never accepted from a browser."""
import asyncio
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from .operations import InvalidOperation, identifier, fields
from .native import NativeError

MAX_FILE = 10 * 1024 * 1024
MAX_SEND = 25 * 1024 * 1024
MAX_STORAGE = 512 * 1024 * 1024
MAX_UPLOAD_BODY = 14 * 1024 * 1024 + 4096

class AttachmentStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink():
            raise ValueError('Attachment root must be private')
        os.chmod(self.root, 0o700)
        path = self.root / 'files.sqlite'
        if path.is_symlink():
            raise ValueError('Attachment index must be private')
        self.db = sqlite3.connect(path, timeout=5)
        os.chmod(path, 0o600)
        self.db.executescript('''CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,principal TEXT NOT NULL,profile TEXT NOT NULL,incarnation TEXT NOT NULL,canonical TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sends(id TEXT PRIMARY KEY,principal TEXT NOT NULL,profile TEXT NOT NULL,incarnation TEXT NOT NULL,canonical TEXT NOT NULL,spec TEXT NOT NULL,state TEXT NOT NULL);''')
        self.locks = {}
        self.cleanup()

    def cleanup(self):
        # Only abandoned private staging; never native attachments or referenced history.
        rows = self.db.execute("SELECT id FROM files WHERE state='staged' AND created<?", (int(time.time()) - 86400,)).fetchall()
        for (file_id,) in rows:
            self.path(file_id).unlink(missing_ok=True)
            self.db.execute('DELETE FROM files WHERE id=?', (file_id,))
        self.db.commit()

    def path(self, file_id):
        if not isinstance(file_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', file_id):
            raise InvalidOperation('Invalid attachment ID')
        return self.root / (file_id + '.blob')

    async def target(self, ops, session_id):
        sid = identifier(session_id)
        if sid not in ops.sessions:
            raise InvalidOperation('Open this conversation first')
        profile = ops.sessions[sid]
        bot = await ops.bot(profile)
        incarnation = await ops.stamp(profile)
        if incarnation != ops.session_incarnations.get(sid):
            raise InvalidOperation('This conversation belongs to a retired profile')
        canonical = str((bot.get('canonical_session') or {}).get('id') or '')
        if not canonical:
            raise InvalidOperation('Canonical conversation unavailable')
        return profile, json.dumps(incarnation, sort_keys=True), canonical

    def row(self, file_id, principal, target):
        self.path(file_id)
        row = self.db.execute('SELECT id,name,kind,size,digest,state FROM files WHERE id=? AND principal=? AND profile=? AND incarnation=? AND canonical=?', (file_id, principal, *target)).fetchone()
        if not row:
            raise InvalidOperation('Attachment unavailable in this conversation')
        return dict(zip(('id', 'name', 'kind', 'size', 'digest', 'state'), row))

    def read(self, row):
        path = self.path(row['id'])
        # O_NOFOLLOW protects the final path. The private root is server-selected.
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        except OSError as error:
            raise InvalidOperation('Attachment unavailable') from error
        with os.fdopen(fd, 'rb') as stream:
            import stat
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != row['size']:
                raise InvalidOperation('Attachment changed')
            data = stream.read(MAX_FILE + 1)
        if len(data) > MAX_FILE or hashlib.sha256(data).hexdigest() != row['digest']:
            raise InvalidOperation('Attachment changed')
        return data

    async def upload(self, ops, principal, params):
        fields(params, ['session_id', 'name', 'data'])
        target = await self.target(ops, params['session_id'])
        if not isinstance(params['name'], str) or not 1 <= len(params['name']) <= 180 or re.search(r'[\x00-\x1f/\\]', params['name']) or params['name'] in {'.', '..'}:
            raise InvalidOperation('Choose a valid filename')
        if not isinstance(params['data'], str) or len(params['data']) > (MAX_FILE * 4 // 3 + 8):
            raise InvalidOperation('Attachment too large', 'INVALID_ATTACHMENT')
        try:
            data = base64.b64decode(params['data'], validate=True)
        except Exception as error:
            raise InvalidOperation('Invalid attachment bytes', 'INVALID_ATTACHMENT') from error
        if not data or len(data) > MAX_FILE:
            raise InvalidOperation('Attachment is empty or too large', 'INVALID_ATTACHMENT')
        kind = 'file'
        if Path(params['name']).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}:
            try:
                from PIL import Image
                with Image.open(io.BytesIO(data)) as image:
                    if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > 32_000_000 or getattr(image, 'n_frames', 1) != 1:
                        raise ValueError()
                    image.verify()
                kind = 'image'
            except Exception as error:
                raise InvalidOperation('Image cannot be safely decoded', 'INVALID_ATTACHMENT') from error
        self.cleanup()
        usage = self.db.execute('SELECT COALESCE(SUM(size),0),COUNT(*) FROM files').fetchone()
        if usage[0] + len(data) > MAX_STORAGE or usage[1] >= 5000:
            raise InvalidOperation('Attachment storage is full', 'ATTACHMENT_QUOTA')
        file_id = secrets.token_urlsafe(32)
        path = self.path(file_id)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
            with self.db:
                self.db.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?,?)', (file_id, principal, *target, params['name'], kind, len(data), hashlib.sha256(data).hexdigest(), 'staged', int(time.time())))
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return self.row(file_id, principal, target)

    async def invoke(self, ops, principal, operation, params):
        fields(params, ['session_id', 'id'] if operation in {'files.remove', 'files.read'} else ['session_id'])
        target = await self.target(ops, params['session_id'])
        if operation in {'files.reconcile', 'files.discard'}:
            receipts = self.db.execute("SELECT id FROM sends WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='uncertain'", (principal, *target)).fetchall()
            uncertain = [row[0] for row in self.db.execute("SELECT id FROM files WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='uncertain'", (principal, *target))]
            if not receipts:
                return {'state': 'clear'}
            history = await ops.invoke('chat.history', {'session_id': params['session_id']})
            # Unique native file/image names prove which actual input reached history.
            seen = '\n'.join(str(m.get('text', '')) for m in history.get('messages', []) if m.get('role') == 'user')
            accepted = bool(uncertain) and all(file_id in seen for file_id in uncertain)
            if accepted:
                with self.db:
                    self.db.execute("UPDATE sends SET state='accepted' WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='uncertain'", (principal, *target))
                    self.db.execute("UPDATE files SET state='sent' WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='uncertain'", (principal, *target))
                return {'state': 'accepted', 'ids': uncertain}
            if operation == 'files.discard':
                await ops.gateway.call('bot_web.attachments', {'session_id': params['session_id'], 'action': 'discard', 'ids': uncertain[:5]})
                with self.db:
                    self.db.execute("UPDATE sends SET state='discarded' WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='uncertain'", (principal, *target))
                    self.db.execute("UPDATE files SET state='staged' WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='uncertain'", (principal, *target))
                return {'state': 'discarded'}
            return {'state': 'uncertain'}
        if operation == 'files.list':
            rows = self.db.execute("SELECT id,name,kind,size,state,created FROM files WHERE principal=? AND profile=? AND incarnation=? AND canonical=? AND state='sent' ORDER BY created DESC LIMIT 500", (principal, *target)).fetchall()
            return {'files': [dict(zip(('id', 'name', 'kind', 'size', 'state', 'created'), row)) for row in rows], 'limits': {'file_bytes': MAX_FILE, 'send_bytes': MAX_SEND, 'count': 5}}
        row = self.row(params['id'], principal, target)
        if operation == 'files.read':
            return row, self.read(row)
        if row['state'] != 'staged':
            raise InvalidOperation('This attachment is already referenced by a send')
        self.path(row['id']).unlink(missing_ok=True)
        with self.db:
            self.db.execute('DELETE FROM files WHERE id=?', (row['id'],))
        return {'removed': True}

    async def submit(self, ops, principal, params):
        fields(params, ['session_id', 'text', 'attachments', 'request_id'])
        sid = identifier(params['session_id'])
        target = await self.target(ops, sid)
        request_id = identifier(params['request_id'])
        ids = params['attachments']
        if not isinstance(ids, list) or not 1 <= len(ids) <= 5 or any(not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',value) for value in ids) or len(set(ids)) != len(ids) or not isinstance(params['text'], str) or len(params['text']) > 16000:
            raise InvalidOperation('Invalid attachment send')
        lock = self.locks.setdefault(target, asyncio.Lock())
        async with lock:
            if await self.target(ops, sid) != target:
                raise InvalidOperation('Conversation changed')
            spec = json.dumps({'text': params['text'], 'ids': ids}, sort_keys=True)
            # Receipt deliberately stores a digest, not the owner's message body.
            digest = hashlib.sha256(spec.encode()).hexdigest()
            previous = self.db.execute('SELECT principal,profile,incarnation,canonical,spec,state FROM sends WHERE id=?', (request_id,)).fetchone()
            if previous:
                if tuple(previous[:4]) != (principal, *target) or previous[4] != digest:
                    raise InvalidOperation('Send ID belongs to another request')
                return {'state': previous[5], 'submitted': previous[5] == 'accepted'}
            if self.db.execute("SELECT 1 FROM sends WHERE profile=? AND incarnation=? AND canonical=? AND state='uncertain'", target).fetchone():
                raise NativeError('A previous attachment send needs inspection in Hermes')
            files = [self.row(file_id, principal, target) for file_id in ids]
            if any(row['state'] != 'staged' for row in files) or sum(row['size'] for row in files) > MAX_SEND:
                raise InvalidOperation('Attachments unavailable or too large')
            data = [(row, self.read(row)) for row in files]
            with self.db:
                self.db.execute('INSERT INTO sends VALUES(?,?,?,?,?,?,?)', (request_id, principal, *target, digest, 'uncertain'))
                self.db.executemany("UPDATE files SET state='uncertain' WHERE id=?", [(row['id'],) for row in files])
            refs = []
            for row, blob in data:
                if row['kind'] == 'image':
                    result = await ops.gateway.call('bot_web.attachments', {'action': 'image', 'session_id': sid, 'id': row['id'], 'content_base64': base64.b64encode(blob).decode(), 'filename': row['name']})
                else:
                    result = await ops.gateway.call('bot_web.attachments', {'action': 'file', 'session_id': sid, 'id': row['id'], 'content_base64': base64.b64encode(blob).decode(), 'filename': row['name']})
                    if isinstance(result.get('ref_text'), str):
                        refs.append(result['ref_text'])
                if result.get('attached') is not True:
                    raise NativeError('Attachment staging was not confirmed')
            receipt = await ops.invoke('chat.send', {'session_id': sid, 'text': (params['text'].strip() or 'Please review the attached files.') + ('\n\n' + '\n'.join(refs) if refs else '')})
            with self.db:
                self.db.execute("UPDATE sends SET state='accepted' WHERE id=?", (request_id,))
                self.db.executemany("UPDATE files SET state='sent' WHERE id=?", [(row['id'],) for row in files])
            return {'state': 'accepted', 'submitted': True, **({'user_row_id': receipt['user_row_id']} if isinstance(receipt.get('user_row_id'), (int, str)) else {})}


MAX_BYTES = MAX_FILE
CHUNK_BYTES = 1024 * 1024


def image_type(data):
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > 32_000_000 or getattr(image, 'n_frames', 1) != 1:
                return 'application/octet-stream'
            mime = Image.MIME[image.format]
            image.verify()
            return mime
    except Exception:
        return 'application/octet-stream'


def media_type(data):
    # ISO base media's file-type box, never the agent-supplied file extension.
    # Only hand MP4 containers to the browser's video decoder; HTML/SVG and
    # unknown binary files retain download-only application/octet-stream.
    if len(data) >= 24 and data[4:8] == b'ftyp':
        size = int.from_bytes(data[:4], 'big')
        brands = {b'isom', b'iso2', b'iso5', b'iso6', b'mp41', b'mp42', b'avc1', b'M4V '}
        if 16 <= size <= min(len(data), 4096) and any(
                data[offset:offset + 4] in brands for offset in [8, *range(16, size, 4)]):
            return 'video/mp4'
    return image_type(data)


class GeneratedMedia:
    def __init__(self, ops):
        self.ops = ops
        self.lock = asyncio.Lock()

    async def list(self, params):
        fields(params, ['session_id', 'cursor'])
        sid = identifier(params['session_id'])
        if sid not in self.ops.sessions or (params['cursor'] is not None and (not isinstance(params['cursor'], str) or len(params['cursor']) > 1000)):
            raise InvalidOperation('Open a conversation first')
        profile = self.ops.sessions[sid]
        stamp = await self.ops.stamp(profile)
        if stamp != self.ops.session_incarnations.get(sid): raise InvalidOperation('Conversation changed')
        canonical = ((await self.ops.bot(profile)).get('canonical_session') or {}).get('id')
        if not canonical: raise InvalidOperation('Conversation unavailable')
        result = await self.ops.gateway.call('bot_web.media.list', {**params, 'profile': profile, 'incarnation': stamp, 'canonical': canonical})
        if (await self.ops.stamp(profile) != stamp or ((await self.ops.bot(profile)).get('canonical_session') or {}).get('id') != canonical):
            raise InvalidOperation('Conversation changed')
        return result

    async def read(self, params):
        fields(params, ['session_id', 'row_id', 'reference'])
        sid = identifier(params['session_id'])
        if (sid not in self.ops.sessions or type(params['row_id']) is not int
                or not 0 < params['row_id'] <= 9007199254740991
                or not re.fullmatch(r'[0-9a-f]{64}', str(params['reference']))):
            raise InvalidOperation('Choose a saved assistant file')
        profile = self.ops.sessions[sid]
        async with self.lock:
            stamp = await self.ops.stamp(profile)
            if stamp != self.ops.session_incarnations.get(sid):
                raise InvalidOperation('Conversation changed')
            bot = await self.ops.bot(profile)
            canonical = (bot.get('canonical_session') or {}).get('id')
            if not canonical:
                raise InvalidOperation('Conversation unavailable')
            target = {'session_id': sid, 'profile': profile, 'incarnation': stamp,
                      'canonical': canonical, 'row_id': params['row_id'], 'reference': params['reference']}
            data, revision, size, name = bytearray(), '', None, ''
            while size is None or len(data) < size:
                chunk = await self.ops.gateway.call('bot_web.media', {**target, 'offset': len(data), 'revision': revision})
                if (type(chunk.get('size')) is not int or not 0 < chunk['size'] <= MAX_BYTES
                        or not isinstance(chunk.get('name'), str) or not 0 < len(chunk['name']) <= 180
                        or re.search(r'[\x00-\x1f/\\]', chunk['name'])
                        or not re.fullmatch(r'[0-9a-f]{64}', str(chunk.get('revision', '')))
                        or not isinstance(chunk.get('data'), str) or len(chunk['data']) > (CHUNK_BYTES + 2) // 3 * 4):
                    raise InvalidOperation('Invalid shared file response')
                part = base64.b64decode(chunk['data'], validate=True)
                if not revision:
                    revision, size, name = chunk['revision'], chunk['size'], chunk['name']
                if (revision != chunk['revision'] or size != chunk['size'] or name != chunk['name']
                        or len(part) != min(CHUNK_BYTES, size - len(data))):
                    raise InvalidOperation('Shared file changed')
                data.extend(part)
            if (await self.ops.stamp(profile) != stamp
                    or ((await self.ops.bot(profile)).get('canonical_session') or {}).get('id') != canonical):
                raise InvalidOperation('Conversation changed')
            blob = bytes(data)
            return blob, name, await asyncio.to_thread(media_type, blob)
