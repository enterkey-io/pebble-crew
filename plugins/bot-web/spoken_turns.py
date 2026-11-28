"""Match a committed caller utterance to its native Hermes reply."""
import asyncio
import hashlib
import re
import time
import uuid

from .connection import Subscription
from .native import NativeError
from .operations import InvalidOperation, fields, identifier

CALL_LIFETIME = 30 * 60
TURN_LIMIT = 200
CAMERA_REF = re.compile(r'pebble-camera-([a-f0-9]{32})_')


class SpokenTurns:
    def __init__(self, ops, store):
        self.ops = ops
        self.db = store.db if store else None
        self.tasks = set()
        if self.db is not None:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS spoken_call (
                    id TEXT PRIMARY KEY, incarnation TEXT NOT NULL, conversation TEXT NOT NULL,
                    voice TEXT NOT NULL, expires INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS spoken_turn (
                    call TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL,
                    user_row INTEGER, assistant_row INTEGER, played INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(call,id)
                );
                CREATE TABLE IF NOT EXISTS spoken_camera_input (
                    incarnation TEXT NOT NULL, conversation TEXT NOT NULL, marker TEXT NOT NULL,
                    user_row INTEGER, text TEXT NOT NULL, PRIMARY KEY(incarnation,conversation,marker)
                );
                CREATE TABLE IF NOT EXISTS spoken_rows (
                    incarnation TEXT NOT NULL, conversation TEXT NOT NULL, first_row INTEGER NOT NULL,
                    last_row INTEGER, PRIMARY KEY(incarnation,conversation,first_row)
                );
                CREATE INDEX IF NOT EXISTS spoken_camera_input_rows
                    ON spoken_camera_input(incarnation,conversation,user_row);
            """)
            with self.db:
                self.db.execute("UPDATE spoken_turn SET state='uncertain' WHERE state='pending'")
                # A turn interrupted by a restart keeps only its spoken request hidden.
                self.db.execute('UPDATE spoken_rows SET last_row=first_row WHERE last_row IS NULL')

    def begin(self, sid, voice):
        if self.db is None or not self.ops.session_conversations.get(sid):
            raise InvalidOperation('Open the Pebble’s Bot Chat before calling')
        call = uuid.uuid4().hex
        stamp, conversation = self.target(sid)
        now = int(time.time())
        with self.db:
            self.db.execute('DELETE FROM spoken_turn WHERE call IN (SELECT id FROM spoken_call WHERE expires < ?)', (now,))
            self.db.execute('DELETE FROM spoken_call WHERE expires < ?', (now,))
            self.db.execute('INSERT INTO spoken_call VALUES(?,?,?,?,?)',
                            (call, stamp, conversation, voice, now + CALL_LIFETIME))
        return call

    def target(self, sid):
        return self.ops.session_incarnations.get(sid), self.ops.session_conversations.get(sid)

    def voice(self, sid, call):
        if self.db is None:
            raise InvalidOperation('Voice call unavailable')
        row = self.db.execute(
            'SELECT voice FROM spoken_call WHERE id=? AND incarnation=? AND conversation=? AND expires>=?',
            (identifier(call), *self.target(sid), int(time.time()))).fetchone()
        if not row:
            raise InvalidOperation('This voice call ended')
        return row[0]

    def end(self, sid, call):
        self.voice(sid, call)
        with self.db:
            self.db.execute('UPDATE spoken_call SET expires=? WHERE id=?', (int(time.time()) - 1, call))
        return self.db.execute("SELECT 1 FROM spoken_turn WHERE call=? AND state='ready' LIMIT 1",
                               (call,)).fetchone() is not None

    def status(self, call, ident):
        row = self.db.execute('SELECT state,user_row,assistant_row FROM spoken_turn WHERE call=? AND id=?',
                              (call, ident)).fetchone()
        if not row:
            raise InvalidOperation('Spoken turn unavailable')
        return {'state': row[0], 'user_row_id': row[1], 'assistant_row_id': row[2]}

    async def submit(self, sid, params, *, frame=None):
        fields(params, ['session_id', 'call_id', 'utterance_id', 'text'])
        call, ident = params['call_id'], identifier(params['utterance_id'])
        self.voice(sid, call)
        text = params['text']
        if not isinstance(text, str) or not text.strip() or len(text) > 6000:
            raise InvalidOperation('Invalid spoken request')
        digest = hashlib.sha256(text.encode() + (b'\0' + frame.encode('ascii') if frame else b'')).hexdigest()
        row = self.db.execute('SELECT digest FROM spoken_turn WHERE call=? AND id=?',
                              (call, ident)).fetchone()
        if row:
            if row[0] != digest:
                raise InvalidOperation('Spoken request changed')
            return self.status(call, ident)
        if self.db.execute('SELECT count(*) FROM spoken_turn WHERE call=?', (call,)).fetchone()[0] >= TURN_LIMIT:
            raise InvalidOperation('This voice call reached its turn limit')
        if self.db.execute("SELECT 1 FROM spoken_turn WHERE call=? AND state='pending'", (call,)).fetchone():
            raise InvalidOperation('The previous spoken turn is still running')
        with self.db:
            self.db.execute("INSERT INTO spoken_turn(call,id,digest,state) VALUES(?,?,?,'pending')",
                            (call, ident, digest))
        task = asyncio.create_task(self.run(sid, call, ident, text, frame))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return self.status(call, ident)

    def hide_spoken_rows(self, sid, messages):
        """A call is spoken, not typed: its requests, tool steps and replies stay
        out of the chat. The call marker and any closing message remain."""
        if self.db is None:
            return messages
        incarnation, conversation = self.target(sid)
        ids = [row['row_id'] for row in messages if type(row.get('row_id')) is int]
        if not incarnation or not conversation or not ids:
            return messages
        spans = self.db.execute(
            'SELECT first_row,last_row FROM spoken_rows WHERE incarnation=? AND conversation=? '
            'AND first_row<=? AND (last_row IS NULL OR last_row>=?)',
            (incarnation, conversation, max(ids), min(ids))).fetchall()
        if not spans:
            return messages
        def spoken(row_id):
            return type(row_id) is int and any(
                first <= row_id and (last is None or row_id <= last) for first, last in spans)
        return [{'role': 'system', **{key: row[key] for key in ('row_id', 'timestamp') if key in row}}
                if spoken(row.get('row_id')) else row for row in messages]

    def present_camera_inputs(self, sid, messages):
        if self.db is None:
            return messages
        incarnation, conversation = self.target(sid)
        if not incarnation or not conversation:
            return messages
        users = [row for row in messages if row.get('role') == 'user' and type(row.get('row_id')) is int]
        if not users:
            return messages
        marks = {row['row_id']: CAMERA_REF.search(row['text'])
                 for row in users if isinstance(row.get('text'), str)}
        ids = [row['row_id'] for row in users]
        placeholders = ','.join('?' for _ in ids)
        originals = dict(self.db.execute(
            'SELECT user_row,text FROM spoken_camera_input WHERE incarnation=? AND conversation=? '
            f'AND user_row IN ({placeholders})', (incarnation, conversation, *ids)))
        for row_id, marker in marks.items():
            if row_id in originals or marker is None:
                continue
            pending = self.db.execute(
                'SELECT text FROM spoken_camera_input WHERE incarnation=? AND conversation=? AND marker=? '
                'AND user_row IS NULL', (incarnation, conversation, marker[1])).fetchone()
            if pending:
                originals[row_id] = pending[0]
        return [{**row, 'text': originals[row['row_id']]}
                if row.get('role') == 'user' and row.get('row_id') in originals else row
                for row in messages]

    async def run(self, sid, call, ident, text, frame):
        gateway = self.ops.gateway
        events = Subscription({sid})
        gateway.listeners.add(events)
        state, user, assistant = 'uncertain', None, None
        marker = uuid.uuid4().hex if frame else None
        incarnation, conversation = self.target(sid)
        try:
            if marker:
                with self.db:
                    self.db.execute('INSERT INTO spoken_camera_input VALUES(?,?,?,NULL,?)',
                                    (incarnation, conversation, marker, text))
            receipt = await gateway.call('bot_web.spoken.camera_turn' if frame else 'prompt.submit', {
                'session_id': sid, 'text': text, 'queued': True, 'surface': 'voice-live',
                'voice_context': ('This is a live call. Speak in your usual voice. Keep replies easy to say aloud '
                                  'and use your normal memory, tools and approval rules.'
                                  + (' A still from the owner’s camera accompanies this utterance.' if frame else '')),
                **({'camera_frame': frame, 'camera_marker': marker} if marker else {}),
            })
            candidate = receipt.get('user_row_id')
            if type(candidate) is not int or candidate < 1:
                state = 'queued' if receipt.get('status') == 'queued' else 'uncertain'
                return
            user = candidate
            with self.db:
                self.db.execute('UPDATE spoken_turn SET user_row=? WHERE call=? AND id=?',
                                (user, call, ident))
                self.db.execute('INSERT OR IGNORE INTO spoken_rows VALUES(?,?,?,NULL)',
                                (incarnation, conversation, user))
                if marker:
                    self.db.execute('UPDATE spoken_camera_input SET user_row=? '
                                    'WHERE incarnation=? AND conversation=? AND marker=?',
                                    (user, incarnation, conversation, marker))
            async with asyncio.timeout(15 * 60):
                while True:
                    event = await events.get()
                    if event.get('type') == 'bridge.resync':
                        return
                    if event.get('type') != 'message.complete':
                        continue
                    payload = event.get('payload') or {}
                    result = payload.get('persisted_turn') or {}
                    if result.get('user_row_id') != user:
                        continue
                    candidate = result.get('final_assistant_row_id')
                    if payload.get('status') in {'error', 'failed', 'interrupted', 'cancelled'}:
                        state = 'failed'
                    elif type(candidate) is int and candidate > user:
                        state, assistant = 'ready', candidate
                    else:
                        state = 'silent'
                    return
        except (NativeError, TimeoutError):
            pass
        finally:
            gateway.listeners.discard(events)
            with self.db:
                self.db.execute('UPDATE spoken_turn SET state=?,assistant_row=? WHERE call=? AND id=?',
                                (state, assistant, call, ident))
                if user:
                    self.db.execute('UPDATE spoken_rows SET last_row=? WHERE incarnation=? AND conversation=? '
                                    'AND first_row=?', (assistant or user, incarnation, conversation, user))

    async def close(self):
        for task in tuple(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def reply_text(self, sid, row_id):
        """The reply's text for the call's captions, from the newest history page
        only. Call rows are hidden from chat, so the client cannot look it up."""
        page = await self.ops.invoke('chat.history', {'session_id': sid})
        for message in page.get('messages', []):
            text = message.get('text')
            if (message.get('row_id') == row_id and message.get('role') == 'assistant'
                    and message.get('display_kind') != 'hidden' and isinstance(text, str) and text.strip()):
                return text[:6000]
        return None

    async def speech(self, sid, params):
        fields(params, ['session_id', 'call_id', 'utterance_id'])
        call, ident = params['call_id'], identifier(params['utterance_id'])
        voice = self.voice(sid, call)
        row = self.db.execute(
            "SELECT assistant_row FROM spoken_turn WHERE call=? AND id=? AND state='ready' AND played=0",
            (call, ident)).fetchone()
        if not row:
            raise InvalidOperation('No new Hermes reply is available to read')
        before = None
        for _ in range(5):
            page = await self.ops.invoke('chat.history', {
                'session_id': sid, **({'before': before} if before else {})})
            for message in page.get('messages', []):
                if message.get('row_id') != row[0]:
                    continue
                text = message.get('text')
                if message.get('role') != 'assistant' or message.get('display_kind') == 'hidden' or not isinstance(text, str) or not text.strip():
                    raise InvalidOperation('This Hermes reply has no text to read')
                self.voice(sid, call)
                with self.db:
                    claimed = self.db.execute(
                        'UPDATE spoken_turn SET played=1 WHERE call=? AND id=? AND played=0',
                        (call, ident)).rowcount
                if claimed:
                    return voice, text
                raise InvalidOperation('This reply was already read')
            before = (page.get('history_page') or {}).get('older')
            if not before:
                break
        raise InvalidOperation('The confirmed Hermes reply could not be read')
