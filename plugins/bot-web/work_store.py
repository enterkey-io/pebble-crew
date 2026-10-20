"""Owner-local catalog identity and write receipts; Hermes owns all work records."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid

from .operations import InvalidOperation


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def operation_id(value):
    if not isinstance(value, str):
        raise InvalidOperation('Invalid operation identity')
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError()
    except ValueError:
        raise InvalidOperation('Invalid operation identity') from None
    return value


class WorkStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        self.db = sqlite3.connect(self.path, timeout=5)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS catalog(workspace TEXT PRIMARY KEY, identity TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS intents(
                id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL,
                state TEXT NOT NULL, evidence TEXT NOT NULL);
        ''')

    def close(self):
        self.db.close()

    @contextmanager
    def locked(self):
        fd = os.open(self.path.with_suffix('.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def catalog(self, state):
        row = self.db.execute('SELECT identity FROM catalog WHERE workspace=?', (state['id'],)).fetchone()
        if row is None:
            bot = state['bots'].get(state['orchestrator'])
            if not bot or not bot.get('enrolled') or not bot.get('available', True):
                raise InvalidOperation('Choose the Main Pebble before setting up project boards', 'REQUIRES_SETUP')
            with self.db:
                self.db.execute('INSERT INTO catalog VALUES(?,?)', (state['id'], bot['id']))
            identity = bot['id']
        else:
            identity = row[0]
        bot = next((b for b in state['bots'].values() if b['id'] == identity), None)
        if not bot or bot.get('deleted') or not bot.get('available', True):
            raise InvalidOperation('The project catalog’s Hermes profile is unavailable. Restore that profile before editing projects.', 'REQUIRES_SETUP')
        return bot

    def reserve(self, ident, actor, operation, spec):
        operation_id(ident)
        digest = fingerprint({'actor': actor, 'operation': operation, 'spec': spec})
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO intents VALUES(?,?,?,\'reserved\',\'{}\')', (ident, actor, digest))
        row = self.db.execute('SELECT actor,fingerprint,state,evidence FROM intents WHERE id=?', (ident,)).fetchone()
        if row[:2] != (actor, digest):
            raise InvalidOperation('This save identity belongs to a different change')
        return {'id': ident, 'state': row[2], **json.loads(row[3])}

    def save(self, ident, state, evidence):
        with self.db:
            self.db.execute('UPDATE intents SET state=?,evidence=? WHERE id=?', (state, json.dumps(evidence), ident))
        return {'id': ident, 'state': state, **evidence}

    def receipt(self, ident, actor):
        row = self.db.execute('SELECT state,evidence FROM intents WHERE id=? AND actor=?', (operation_id(ident), actor)).fetchone()
        if row is None:
            return {'id': ident, 'state': 'absent'}
        return {'id': ident, 'state': row[0], **json.loads(row[1])}
