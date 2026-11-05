from copy import deepcopy
import uuid
import unittest
import asyncio
import test_reporting as fixture
from bot_web.operations import InvalidOperation
from bot_web.agent_management import submit, drain, receipts, recover
from bot_web.routines_native import validate_command, config_revision


class AgentManagementTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixture.ReportingTests.asyncSetUp
    asyncTearDown = fixture.ReportingTests.asyncTearDown
    def appearance_spec(self, profile='amy'):
        state = self.store.read()
        return {'operation_id': str(uuid.uuid4()), 'profile': profile, 'id': state['bots'][profile]['id'],
            'expected_revision': state['revision'], 'appearance': {'kind': 'shape', 'shape': 'kite', 'color': 'clay'}, 'photo': None}

    async def test_agent_self_avatar_and_main_other_avatar_save_native_metadata_once(self):
        spec = self.appearance_spec()
        original = deepcopy(self.store.read()['bots']['amy'])
        queued = submit(self.store, 'amy', 'agent.appearance.update', spec)
        self.assertEqual(queued, submit(self.store, 'amy', 'agent.appearance.update', spec))
        self.assertEqual(self.store.read()['bots']['amy'], original)
        await drain(self.service)
        self.assertEqual(receipts(self.store, 'amy')[0]['state'], 'applied')
        self.assertEqual(self.store.read()['bots']['amy']['appearance'], spec['appearance'])
        self.assertEqual(self.native.profiles[1]['ui_meta']['hermes-bots']['workspaceAppearance'], spec['appearance'])
        before = len(self.native.calls)
        self.assertEqual(submit(self.store, 'amy', 'agent.appearance.update', spec)['state'], 'applied')
        await drain(self.service)
        self.assertEqual(len(self.native.calls), before)
        after = self.appearance_spec()
        after['appearance']['color'] = 'moss'
        submit(self.store, 'default', 'agent.appearance.update', after)
        await drain(self.service)
        self.assertEqual(receipts(self.store, 'default')[0]['state'], 'applied')
        self.assertEqual(self.store.read()['bots']['amy']['role'], original['role'])
        self.assertFalse(any(m == 'prompt.submit' for m, _ in self.native.calls))

    async def test_other_agents_cannot_change_main_and_queued_former_main_is_refused(self):
        with self.assertRaises(InvalidOperation):
            submit(self.store, 'amy', 'agent.appearance.update', self.appearance_spec('default'))
        submit(self.store, 'default', 'agent.appearance.update', self.appearance_spec())
        await self.service.invoke('workspace.set_orchestrator', {'profile': 'amy', 'expected_revision': self.store.read()['revision']})
        await drain(self.service)
        self.assertEqual(receipts(self.store, 'default')[0]['state'], 'refused')
        self.assertNotEqual(self.store.read()['bots']['amy']['appearance']['color'], 'clay')

    async def test_reused_operation_and_changed_target_are_refused(self):
        spec = self.appearance_spec()
        submit(self.store, 'amy', 'agent.appearance.update', spec)
        changed = deepcopy(spec); changed['appearance']['color'] = 'moss'
        with self.assertRaises(InvalidOperation): submit(self.store, 'amy', 'agent.appearance.update', changed)
        state = self.store.read(); state['bots']['amy']['id'] = 'replacement'
        self.store.save(state, state['revision'])
        await drain(self.service)
        self.assertEqual(receipts(self.store, 'amy')[0]['state'], 'refused')

    async def test_interrupted_application_never_replays(self):
        spec = self.appearance_spec()
        submit(self.store, 'amy', 'agent.appearance.update', spec)
        with self.store.db: self.store.db.execute("UPDATE agent_management SET state='applying'")
        recover(self.store)
        await drain(self.service)
        self.assertEqual(receipts(self.store, 'amy')[0]['state'], 'uncertain')
        self.assertEqual(submit(self.store, 'amy', 'agent.appearance.update', spec)['state'], 'uncertain')

    async def test_routine_management_is_target_scoped_and_failures_are_not_applied(self):
        spec = self.appearance_spec(); spec.pop('appearance'); spec.pop('photo')
        spec['command'] = {'action': 'create', 'name': 'Future check', 'prompt': 'Summarize the project here.', 'schedule': '0 9 * * 1'}
        submit(self.store, 'default', 'routines.manage', spec)
        previous = self.native.call
        events=asyncio.Queue();self.native.listeners.add(events)
        calls = []
        async def native(method, params):
            if method == 'bot_web.routines':
                calls.append(params)
                return {'success': True, 'job_id': 'native-job'}
            return await previous(method, params)
        self.native.call = native
        await drain(self.service)
        self.assertEqual(calls, [{'profile': 'amy', 'command': spec['command']}])
        self.assertEqual(receipts(self.store, 'default')[0]['state'], 'applied')
        self.assertEqual(receipts(self.store, 'default')[0]['result']['job_id'], 'native-job')
        self.assertEqual(events.get_nowait(),{'type':'routines.changed','payload':{'profile':'amy'}})
        spec['operation_id'] = str(uuid.uuid4()); spec['expected_revision'] = self.store.read()['revision']
        submit(self.store, 'amy', 'routines.manage', spec)
        async def failed(method, params):
            if method == 'bot_web.routines': return {'success': False, 'code': 'STALE_REVISION'}
            return await previous(method, params)
        self.native.call = failed
        await drain(self.service)
        self.assertEqual(receipts(self.store, 'amy')[0]['state'], 'refused')
        self.assertEqual(receipts(self.store, 'amy')[0]['result']['code'], 'STALE_REVISION')

    async def test_routine_execution_and_arbitrary_provider_changes_are_not_management(self):
        for command in [{'action': 'run', 'job_id': 'native-job'},
                {'action': 'create', 'name': 'Job', 'prompt': 'Read', 'schedule': '1h', 'provider': 'other'},
                {'action': 'remove', 'job_id': 'native-job'}, {'action': 'list', 'profile': 'default'}]:
            with self.assertRaises(InvalidOperation): validate_command(command)
        job = {'name': 'Review', 'prompt': 'Read', 'schedule': {'kind': 'cron', 'expr': '0 9 * * 1'}, 'enabled': True}
        self.assertEqual(config_revision(job), config_revision({**job, 'last_run_at': 'later'}))
        self.assertNotEqual(config_revision(job), config_revision({**job, 'prompt': 'Changed'}))
