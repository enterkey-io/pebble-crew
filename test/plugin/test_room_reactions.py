from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bot_web.workspace import WorkspaceStore
from bot_web.operations import InvalidOperation
from bot_web.room_reactions import owner_react, agent_react, project, feedback


class RoomReactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.native = root / 'native.sqlite'
        self.store = WorkspaceStore(root / 'workspace.sqlite')
        self.addCleanup(self.store.db.close)
        state = self.store.read()
        state['bots'] = {p: {'id': p+'-identity', 'name': p.title()} for p in ('alpha', 'beta')}
        self.store.save(state, state['revision'])
        members = [{'profile': p, 'target': {'kind': 'local', 'profile': p}} for p in ('alpha', 'beta')]
        self.room = {'room_id': 'group-a', 'members': members, 'created_at': 123.0}
        with closing(sqlite3.connect(self.native)) as db:
            db.executescript('''CREATE TABLE hosted_rooms(room_id TEXT PRIMARY KEY, created_at REAL, members_json TEXT, disbanded_at REAL);
                CREATE TABLE hosted_room_events(room_id TEXT, event_id TEXT, seq INTEGER, kind TEXT, payload_json TEXT);''')
            db.execute('INSERT INTO hosted_rooms VALUES(?,?,?,NULL)', ('group-a', 123.0, json.dumps(members)))
            db.execute('INSERT INTO hosted_rooms VALUES(?,?,?,NULL)', ('foreign', 124.0, '[]'))
            for room, event, seq, kind in [('group-a','user-a',1,'message.user'),('group-a','reply-a',2,'message.member'),('foreign','foreign-message',1,'message.user'),('group-a','control',3,'turn.started')]:
                db.execute('INSERT INTO hosted_room_events VALUES(?,?,?,?,?)', (room,event,seq,kind,json.dumps({'text':'Thanks' if kind == 'message.user' else 'Ready'})))
            db.commit()
        self.modules = patch.dict(sys.modules, {
            'gateway.hosted_rooms': SimpleNamespace(default_db_path=lambda: self.native),
            'gateway.response_filters': SimpleNamespace(is_intentional_silence_response=lambda text: text == 'NO_REPLY'),
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def owner(self, chosen, **extra):
        return owner_react(self.store, {'room_id': 'group-a', 'event_id': 'reply-a', 'emoji': chosen, **extra})

    def test_owner_and_multiple_members_replace_clear_persist_and_receive_feedback_without_native_writes(self):
        before = self.native.read_bytes()
        self.assertEqual(self.owner('❤️')['revision'], 1)
        self.owner('👍')
        agent_react(self.store, 'alpha', self.room, {'emoji':'❤️'})
        agent_react(self.store, 'beta', self.room, {'emoji':'👍'})
        log = project(self.store, 'group-a', {'events': [{'event_id':'user-a','kind':'message.user','payload':{'text':'Thanks'}}], 'cursor': 3})
        self.assertEqual(len(log['events'][0]['payload']['reactions']), 2)
        self.assertEqual({r['name'] for r in log['events'][0]['payload']['reactions']}, {'Alpha','Beta'})
        self.assertEqual(log['reaction_revision'], 4)
        self.assertTrue(any(r['event_id'] == 'reply-a' and r['reactions'][0]['name'] == 'You' for r in feedback(self.store,self.room)))
        self.owner(None)
        cleared = project(self.store,'group-a', {'events':[]})
        self.assertEqual(next(r for r in cleared['reaction_updates'] if r['event_id'] == 'reply-a')['reactions'], [])
        reopened = WorkspaceStore(self.store.path)
        try:
            self.assertEqual(project(reopened,'group-a',{'events':[]})['reaction_updates'], cleared['reaction_updates'])
        finally:
            reopened.db.close()
        self.assertEqual(self.native.read_bytes(), before)

    def test_foreign_control_and_spoofed_targets_are_rejected(self):
        for event in ('foreign-message','control','missing'):
            with self.assertRaises(InvalidOperation): self.owner('❤️', event_id=event)
        with self.assertRaises(InvalidOperation): self.owner('❤️', actor='alpha')
        for args in ({'emoji':'❤️','room_id':'foreign'}, {'emoji':'❤️','message_event_id':'foreign-message'}, {'emoji':'❤️','message_row_id':1}, {'emoji':'❤️','messages_back':True}):
            with self.assertRaises(InvalidOperation): agent_react(self.store, 'alpha', self.room, args)
        with self.assertRaises(InvalidOperation): agent_react(self.store,'alpha',{**self.room,'room_id':'foreign'}, {'emoji':'❤️'})

    def test_replaced_or_disbanded_room_does_not_inherit_reactions(self):
        self.owner('❤️')
        with closing(sqlite3.connect(self.native)) as db:
            db.execute('UPDATE hosted_rooms SET created_at=456 WHERE room_id=?', ('group-a',)); db.commit()
        self.assertEqual(project(self.store,'group-a',{'events':[]})['reaction_updates'], [])
        with self.assertRaises(InvalidOperation): agent_react(self.store,'alpha',self.room,{'emoji':'❤️'})
        with closing(sqlite3.connect(self.native)) as db:
            db.execute('UPDATE hosted_rooms SET disbanded_at=789 WHERE room_id=?', ('group-a',)); db.commit()
        with self.assertRaises(InvalidOperation): self.owner('❤️')
