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
        return {'id': None, 'title': 'Launch', 'outcome': 'Reach 100 customers', 'body': 'Measure weekly', 'status': 'active', 'owner_id': self.state['bots']['default']['id'], 'parent_id': None, 'crew_ids': [], 'boards': [self.board], **patch}

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
        self.plans.invoke('work.board.outcome.save', {'workspace_id': self.state['id'], 'operation_id': str(uuid.uuid4()), 'expected_revision': 0, 'outcome': {'board': self.board, 'outcome': 'Ship a useful product', 'crew_ids': []}}, 'owner')
        from bot_web.coordination import context
        self.save(self.draft(), 1)
        value = context(self.store, 'amy', self.board)
        self.assertEqual(value['board_outcome']['outcome'], 'Ship a useful product')
        self.assertEqual(value['goals'][0]['outcome'], 'Reach 100 customers')
        self.assertEqual(self.store.read(), self.state)
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_full_crew_purpose_survives_compaction_and_voice_context(self):
        from bot_web.runtime import live_context
        from bot_web.coordination import voice_context
        ids = [b['id'] for b in self.state['bots'].values() if b.get('enrolled')]
        purpose = 'P' * 1980 + 'PURPOSE_END'
        await self.service.invoke('organization.save', {'expected_revision': 0, 'organization': {'schema': 2,
            'sections': [{'id': 'pebbles', 'name': 'Pebbles', 'collapsed': False, 'items': [{'kind': 'crew', 'id': 'studio'}]}],
            'crews': [{'id': 'studio', 'name': 'Studio', 'purpose': purpose, 'managerId': ids[0], 'collapsed': False, 'members': ids}]}})
        for index in range(20): self.save(self.draft(outcome='A goal. ' * 200), index)
        text = live_context(self.store, 'default', compact=True)
        data = json.loads(text.split('\n', 1)[1])
        self.assertEqual(data['coordination']['crews'][0]['purpose'], purpose)
        self.assertLess(len(text), 6500)
        self.assertIn('PURPOSE_END', voice_context(self.store, 'default'))
        self.assertTrue(data['coordination']['goals_more'])

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
        self.assertEqual(value['board_outcome']['crew_count'], 100)
        self.assertEqual(len(value['board_outcome']['crew_ids']), 6)
        self.assertLess(len(json.dumps(value)), 7500)
