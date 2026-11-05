from copy import deepcopy
from pathlib import Path
import json
import unittest
import uuid
import test_workspace as fixture
from bot_web.work_store import WorkStore
from bot_web.plans import Plans
from bot_web.operations import InvalidOperation


class PlanBehaviorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.WorkspaceTests.asyncSetUp(self)
        self.ledger = WorkStore(self.path.with_name('work.sqlite'))
        self.board = {'catalog_id': 'catalog-stable', 'project_id': 'native-project', 'slug': 'product'}
        self.boards = [{**self.board, 'name': 'Product', 'mapping': 'linked'}]
        self.plans = Plans(self.store, self.ledger, lambda: ('catalog-stable', {'boards': self.boards}))
        self.state = self.store.read()

    async def asyncTearDown(self):
        self.ledger.close()
        await fixture.WorkspaceTests.asyncTearDown(self)

    def draft(self, **patch):
        return {'id': None, 'title': 'Launch', 'outcome': 'Reach 100 customers', 'body': 'Measure weekly', 'status': 'active', 'owner_id': self.state['bots']['default']['id'], 'parent_id': None, 'boards': [self.board], **patch}

    def save(self, draft, revision, actor='owner', ident=None):
        return self.plans.invoke('work.plan.save', {'workspace_id': self.state['id'], 'operation_id': ident or str(uuid.uuid4()), 'expected_revision': revision, 'plan': draft}, actor)

    async def test_save_reload_retry_and_native_reference_survive_main_transfer(self):
        before = deepcopy(self.state)
        ident = str(uuid.uuid4())
        first = self.save(self.draft(), 0, ident=ident)
        self.assertEqual(first['state'], 'completed')
        self.assertEqual(self.save(self.draft(), 0, ident=ident), first)
        self.assertEqual(self.store.read(), before)
        self.ledger.close()
        self.ledger = WorkStore(self.path.with_name('work.sqlite'))
        self.plans = Plans(self.store, self.ledger, lambda: ('catalog-stable', {'boards': self.boards}))
        current = self.store.read(); current['orchestrator'] = 'amy'; self.store.save(current, current['revision'])
        read = self.plans.snapshot(self.store.read())
        self.assertEqual(read['plans'][0]['boards'], [self.board])
        self.assertEqual(read['plans'][0]['id'], ident)
        self.assertEqual(self.ledger.path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_cycles_stale_writes_foreign_refs_and_non_main_are_rejected(self):
        parent = self.save(self.draft(), 0)['plan_id']
        child = self.save(self.draft(parent_id=parent), 1)['plan_id']
        for draft, revision, actor in [
            (self.draft(id=parent, parent_id=child), 2, 'owner'),
            (self.draft(), 0, 'owner'),
            (self.draft(boards=[{**self.board, 'catalog_id': 'replacement'}]), 2, 'owner'),
            (self.draft(owner_id='foreign'), 2, 'owner'),
            (self.draft(parent_id=[]), 2, 'owner'),
            (self.draft(), 2, self.state['bots']['amy']['id']),
        ]:
            with self.assertRaises(InvalidOperation): self.save(draft, revision, actor)
        self.assertEqual(self.plans.snapshot(self.store.read())['revision'], 2)
        self.assertEqual(self.save(self.draft(), 2, self.state['bots']['default']['id'])['state'], 'completed')

    async def test_missing_native_board_is_marked_unavailable_and_not_silently_relinked(self):
        self.save(self.draft(), 0)
        self.boards.clear()
        snapshot = self.plans.snapshot(self.state)
        self.assertEqual(snapshot['unavailable_boards'], [self.board])
        self.assertEqual(snapshot['plans'][0]['boards'], [self.board])
        with self.assertRaises(InvalidOperation): self.save(self.draft(), 1)

    async def test_board_outcomes_are_metadata_not_native_tasks_or_persona_changes(self):
        self.plans.invoke('work.board.outcome.save', {'workspace_id': self.state['id'], 'operation_id': str(uuid.uuid4()), 'expected_revision': 0, 'outcome': {'board': self.board, 'outcome': 'Ship a useful product'}}, 'owner')
        from bot_web.coordination import context
        self.save(self.draft(), 1)
        value = context(self.store, 'amy', self.board)
        self.assertEqual(value['board_outcome']['outcome'], 'Ship a useful product')
        self.assertEqual(value['goals'][0]['outcome'], 'Reach 100 customers')
        self.assertEqual(self.store.read(), self.state)
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_retired_crew_context_is_projected_out_and_exact_bytes_are_archived_on_write(self):
        from bot_web.runtime import live_context
        from bot_web.coordination import voice_context
        self.save(self.draft(), 0)
        graph=self.plans.read(self.state)
        graph['plans'][0]['crew_ids']=['old-studio']
        graph['board_outcomes']=[{'board':self.board,'outcome':'Ship it','crew_ids':['old-studio']}]
        raw=json.dumps({k:graph[k] for k in ('plans','board_outcomes')},indent=3)
        with self.ledger.db:
            self.ledger.db.execute('UPDATE plans_state SET payload=? WHERE workspace=?',(raw,self.state['id']))
            self.ledger.db.execute('DELETE FROM plans_before_sections')
        self.assertNotIn('crew_ids',self.plans.read(self.state)['plans'][0])
        self.assertNotIn('old-studio',voice_context(self.store,'default'))
        self.assertNotIn('old-studio',live_context(self.store,'default',compact=True))
        self.assertIsNone(self.ledger.db.execute('SELECT 1 FROM plans_before_sections').fetchone())
        self.save(self.draft(), 1)
        archive=self.ledger.db.execute('SELECT revision,payload FROM plans_before_sections WHERE workspace=?',(self.state['id'],)).fetchone()
        self.assertEqual(archive,(1,raw))
        with self.assertRaises(InvalidOperation) as retired: self.save(self.draft(crew_ids=['old-studio']),2)
        self.assertEqual(retired.exception.code,'UPDATE_REQUIRED')

    async def test_worker_linked_goal_precedes_unrelated_roots_and_outcome_links_are_bounded(self):
        from bot_web.coordination import context
        for index in range(8): self.save(self.draft(title='Earlier root ' + str(index), boards=[], owner_id=None), index)
        child = self.save(self.draft(title='Worker project goal', parent_id=self.plans.read(self.state)['plans'][0]['id']), 8)['plan_id']
        graph = self.plans.read(self.state)
        graph['board_outcomes'] = [{'board': self.board, 'outcome': 'G' * 2000, 'crew_ids': [('crew-' + str(i)).ljust(80, 'x') for i in range(100)]}]
        with self.ledger.db:
            self.ledger.db.execute('UPDATE plans_state SET payload=? WHERE workspace=?', (json.dumps({k: graph[k] for k in ('plans', 'board_outcomes')}), self.state['id']))
        value = context(self.store, 'amy', self.board)
        self.assertEqual(value['goals'][0]['id'], child)
        self.assertNotIn('crew_ids',value['board_outcome'])
        self.assertNotIn('crews',value)
        self.assertLess(len(json.dumps(value)), 7500)

    async def test_tasks_toggle_suspends_goals_everywhere_and_preserves_saved_data(self):
        from bot_web.coordination import context, voice_context
        from bot_web.plans import runtime_snapshot
        from bot_web.runtime import live_context
        self.save(self.draft(), 0)
        self.plans.invoke('work.board.outcome.save', {'workspace_id': self.state['id'], 'operation_id': str(uuid.uuid4()), 'expected_revision': 1, 'outcome': {'board': self.board, 'outcome': 'Ship a useful product'}}, 'owner')
        saved = self.plans.read(self.state)
        before = len(self.native.calls)
        revision = self.store.read()['revision']
        receipt = await self.service.invoke('workspace.features.set', {'workspace_id': self.state['id'], 'tasks': False, 'expected_revision': revision})
        self.assertFalse(receipt['features']['tasks'])
        self.assertEqual(len(self.native.calls), before, 'Changing Tasks must not call native tools or models')
        # Repeating a lost-response write is harmless and does not bump the revision.
        self.assertEqual(await self.service.invoke('workspace.features.set', {'workspace_id': self.state['id'], 'tasks': False, 'expected_revision': revision}), receipt)
        for profile in ('default', 'amy'):
            value = context(self.store, profile, self.board)
            self.assertFalse(value['tasks_enabled'])
            self.assertNotIn('goals', value)
            self.assertNotIn('board_outcome', value)
            self.assertIn('Native Kanban remains available', value['policy'])
            for text in (voice_context(self.store, profile), live_context(self.store, profile), live_context(self.store, profile, compact=True)):
                self.assertNotIn('Reach 100 customers', text)
                self.assertNotIn('Ship a useful product', text)
        for action in (
            lambda: self.save(self.draft(), 2),
            lambda: self.plans.invoke('work.plans', {'workspace_id': self.state['id']}, 'owner'),
            lambda: runtime_snapshot(self.store, {'workspace_id': self.state['id']}),
        ):
            with self.assertRaisesRegex(InvalidOperation, 'Tasks and goals are off'): action()
        self.assertEqual(self.plans.read(self.state), saved)
        self.store.db.close()
        from bot_web.workspace import WorkspaceStore
        self.store = WorkspaceStore(self.path)
        self.service.store = self.store
        self.plans.workspace = self.store
        self.assertFalse(self.store.read()['features']['tasks'])
        self.store.set_tasks(True, receipt['revision'], self.state['id'])
        self.assertEqual(self.plans.invoke('work.plans', {'workspace_id': self.state['id']}, 'owner')['plans'], saved['plans'])
        self.assertEqual(context(self.store, 'amy', self.board)['board_outcome']['outcome'], 'Ship a useful product')

    async def test_feature_settings_are_validated_and_do_not_overwrite_concurrent_changes(self):
        state = self.store.read()
        self.assertTrue(state['features']['tasks'])
        changed = self.store.save({**state, 'unrelated': 'keep'}, state['revision'])
        with self.assertRaises(InvalidOperation):
            self.store.set_tasks(False, state['revision'], self.state['id'])
        for enabled, revision in [('false', changed['revision']), (False, True), (False, -1)]:
            with self.assertRaises(InvalidOperation): self.store.set_tasks(enabled, revision, self.state['id'])
        await self.service.invoke('workspace.features.set', {'workspace_id': self.state['id'], 'tasks': False, 'expected_revision': changed['revision']})
        self.assertEqual(self.store.read()['unrelated'], 'keep')
        self.assertTrue(all(bot.get('enrolled') for bot in self.store.read()['bots'].values()))

    async def test_tasks_setting_rejects_another_workspace_before_any_write(self):
        before = self.store.read()
        with self.assertRaisesRegex(InvalidOperation, 'Choose this workspace'):
            await self.service.invoke('workspace.features.set', {'workspace_id': str(uuid.uuid4()), 'tasks': False, 'expected_revision': before['revision']})
        self.assertEqual(self.store.read(), before)

    async def test_tasks_default_and_write_preserve_other_feature_preferences(self):
        state = self.store.read()
        state['features'] = {'future_feature': False}
        self.store.save(state, state['revision'])
        current = self.store.read()
        self.assertTrue(current['features']['tasks'])
        self.store.set_tasks(False, current['revision'], self.state['id'])
        self.assertEqual(self.store.read()['features'], {'tasks': False, 'future_feature': False})

    async def test_disabling_tasks_keeps_native_work_catalog_and_board_reads_available(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from contextlib import nullcontext
        from bot_web.work import WorkService
        native = SimpleNamespace(scoped=nullcontext, edit_details=True,
            list_projects=lambda: [], list_boards=lambda: [{'slug': 'default', 'total': 1}],
            board=lambda slug: {'columns': [{'name': 'todo', 'tasks': [{'id': 'existing', 'title': 'Background work', 'status': 'todo'}]}]})
        service = WorkService(self.store, self.path.with_name('native-work.sqlite'))
        try:
            self.store.set_tasks(False, self.state['revision'], self.state['id'])
            with patch.object(service, 'catalog_native', return_value=('stable', native)):
                catalog = service.invoke('work.describe', {})
                self.assertFalse(catalog['capabilities']['plans'])
                self.assertTrue(catalog['capabilities']['proactive'])
                board = service.invoke('work.board', {'workspace_id': self.state['id'], 'board': 'default'})
                self.assertEqual(board['columns'][0]['tasks'][0]['title'], 'Background work')
        finally:
            service.close()
