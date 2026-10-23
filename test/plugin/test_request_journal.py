"""Pending authority is independent of history, payload faults and global edits."""
import test_security
import json
from pathlib import Path
import tempfile
import unittest
from bot_web.workspace import WorkspaceStore
from bot_web.request_review import review


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = WorkspaceStore(Path(self.directory.name) / 'workspace.sqlite')
        state = self.store.read()
        state.update(initialized=True, orchestrator='default', model_grant={'supported': True, 'fingerprint': 'model'}, bots={
            'default': {'id': 'aurora', 'enrolled': True}, 'alina': {'id': 'alina-one', 'enrolled': True}})
        self.store.save(state, state['revision'])

    def tearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    def insert(self, ident, state='pending', raw='{}'):
        with self.store.db:
            # Exact old positional insertion remains supported after initialization.
            self.store.db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)', (ident, 'default', 'agent.attach', raw, ident, state, None, 100))

    def test_pending_survives_history_and_exact_recovery_ignores_pages(self):
        self.insert('ron')
        for i in range(120): self.insert('done'+str(i), 'completed')
        self.assertEqual(self.store.request_by_id('ron')['state'], 'pending')
        self.assertIn('ron', [r['id'] for r in self.store.requests()])
        page = self.store.request_page('pending', None)
        self.assertEqual([r['id'] for r in page['requests']], ['ron'])
        self.assertIsNone(page['next'])

    def test_complete_bounded_scan_and_cross_process_generation(self):
        for i in range(205): self.insert('r'+str(i))
        cursor, found = None, []
        while True:
            page = self.store.request_page('pending', cursor)
            self.assertLessEqual(len(page['requests']), 25)
            found.extend(r['id'] for r in page['requests'])
            cursor = page['next']
            if cursor is None: break
        self.assertEqual(len(set(found)), 205)
        page = self.store.request_page('pending', None)
        other = WorkspaceStore(self.store.path)
        try:
            with other.db: other.db.execute("UPDATE requests SET state='denied' WHERE id='r0'")
            self.assertTrue(self.store.request_page('pending', page['next'])['restart'])
        finally: other.db.close()

    def test_corrupt_row_is_visible_and_does_not_hide_healthy_requests(self):
        self.insert('good')
        self.insert('bad', raw='{broken')
        page = self.store.request_page('pending', None)
        self.assertEqual(len(page['requests']), 2)
        self.assertTrue(self.store.request_by_id('bad')['unreadable'])
        self.assertEqual(self.store.request_by_id('good')['spec'], {})

    def creation(self):
        state = self.store.read()
        spec = {'name': 'ron', 'manager': 'alina', 'team': None, 'model_fingerprint': 'model', 'expected_revision': state['revision'], 'role': ''}
        ident, _ = self.store.request('default', 'agent.create', spec)
        return self.store.request_by_id(ident)

    def test_same_id_creation_review_survives_unrelated_edit_and_main_transfer(self):
        request = self.creation()
        first = review(self.store, request, self.store.read())
        state = self.store.read()
        state['bots']['default']['description'] = 'Unrelated'
        state['orchestrator'] = 'alina'
        self.store.save(state, state['revision'])
        second = review(self.store, request, self.store.read())
        self.assertEqual(second['kind'], 'ready')
        self.assertEqual(first['digest'], second['digest'])
        self.assertEqual(second['request']['id'], request['id'])
        self.assertEqual(second['request']['fingerprint'], request['fingerprint'])

    def test_captured_manager_replacement_and_changed_model_block(self):
        request = self.creation()
        state = self.store.read()
        state['bots']['alina']['id'] = 'replacement'
        self.store.save(state, state['revision'])
        self.assertEqual(review(self.store, request, self.store.read())['kind'], 'blocked')
        state = self.store.read()
        state['bots']['alina']['id'] = 'alina-one'
        state['model_grant']['fingerprint'] = 'changed'
        self.store.save(state, state['revision'])
        self.assertEqual(review(self.store, request, self.store.read())['kind'], 'blocked')

    def test_legacy_same_id_explicit_current_binding_without_fabricated_history(self):
        request = self.creation()
        with self.store.db: self.store.db.execute('DELETE FROM request_context WHERE request=?', (request['id'],))
        current = review(self.store, request, self.store.read())
        self.assertTrue(current['legacy'])
        self.assertTrue(current['current_context'])
        self.assertEqual(current['manager_identity'], 'alina-one')
        self.assertEqual(current['request']['id'], request['id'])


    def test_bad_receipt_or_timestamp_never_removes_uncertain_name_protection(self):
        prior = self.creation()
        with self.store.db:
            self.store.db.execute("UPDATE requests SET state='uncertain',result='[]',created='broken' WHERE id=?", (prior['id'],))
        self.assertIn('ron', self.store.incomplete_creations())
        spec = prior['spec']
        ident, _ = self.store.request('owner', 'agent.create', spec)
        self.assertEqual(review(self.store, self.store.request_by_id(ident), self.store.read())['kind'], 'blocked')
        with self.store.db: self.store.db.execute("UPDATE requests SET spec='broken' WHERE id=?", (prior['id'],))
        self.assertIn(None, self.store.incomplete_creations())
        self.assertEqual(review(self.store, self.store.request_by_id(ident), self.store.read())['kind'], 'blocked')


    def test_history_pages_do_not_repeat_full_workspace_snapshots(self):
        self.insert('history', 'completed')
        large = {'bots': {'synthetic': {'instructions': 'x' * 5000000}}, 'state': 'completed'}
        with self.store.db: self.store.db.execute('UPDATE requests SET result=? WHERE id=?', (json.dumps(large), 'history'))
        page = self.store.request_page('recent', None)
        self.assertLess(len(json.dumps(page)), 10000)
        self.assertEqual(self.store.request_by_id('history')['result'], {'state': 'completed'})
        self.assertGreater(len(self.store.db.execute('SELECT result FROM requests WHERE id=?', ('history',)).fetchone()[0]), 5000000)
