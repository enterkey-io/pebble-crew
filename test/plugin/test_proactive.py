from contextlib import nullcontext
from copy import deepcopy
import unittest
import uuid
import test_workspace as fixture
from bot_web.work_store import WorkStore
from bot_web.proactive import Proactive
from bot_web.operations import InvalidOperation


class NativeJobs:
    def __init__(self):
        self.saved = []; self.creates = 0; self.mode = 'ok'; self.fingerprint = 'fresh-tools'; self.zone = 'America/Chicago'
    def scoped(self): return nullcontext()
    def timezone(self): return self.zone
    def discover(self): return {'fingerprint': self.fingerprint, 'timezone': self.zone, 'capabilities': [{'family': 'calendar', 'server': 'calendar', 'tool': 'calendar_list_events'}], 'unavailable': 0}
    def jobs(self): return deepcopy(self.saved)
    def job(self, ident): return next((deepcopy(job) for job in self.saved if job['id'] == ident), None)
    def create(self, spec):
        self.creates += 1
        if self.mode == 'before': raise TimeoutError()
        job = {**spec, 'id': str(self.creates), 'enabled': True, 'deliver': 'bot-chat', 'schedule': {'kind': 'cron', 'expr': spec['schedule']}}
        self.saved.append(job)
        if self.mode == 'after': raise TimeoutError()
        return job


class ProactiveBehaviorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.WorkspaceTests.asyncSetUp(self)
        self.ledger = WorkStore(self.path.with_name('work.sqlite')); self.jobs = NativeJobs()
        self.subject = Proactive(self.store, self.ledger, lambda profile: self.jobs)
        self.main = self.store.read()['bots']['default']; self.main['native_incarnation'] = 'a' * 64
        self.subject.main = lambda: (self.store.read(), self.main)
        self.workspace = self.store.read()['id']
    async def asyncTearDown(self):
        self.ledger.close(); await fixture.WorkspaceTests.asyncTearDown(self)
    def invoke(self, operation, params=None, actor='owner'):
        return self.subject.invoke('work.proactive.' + operation, {'workspace_id': self.workspace, **(params or {})}, actor)
    def request(self):
        proposal = self.invoke('suggest')
        return {'proposal_id': proposal['proposal_id'], 'operation_id': str(uuid.uuid4()), 'template_id': 'calendar', 'prompt': 'Read my calendar and send a concise summary.', 'time': '09:00', 'days': 'weekdays', 'timezone': proposal['timezone']}

    async def test_setup_is_opt_in_and_only_persists_one_native_job_for_exact_retries(self):
        request = self.request()
        self.assertEqual(self.jobs.creates, 0)
        first = self.invoke('enable', request)
        self.assertEqual(first['state'], 'completed')
        self.assertEqual(self.invoke('enable', request), first)
        self.assertEqual(self.jobs.creates, 1)
        self.assertEqual(self.jobs.saved[0]['schedule']['expr'], '0 9 * * 1-5')
        self.assertEqual(self.invoke('suggest')['suggestions'], [])
        self.assertFalse(any(method == 'prompt.submit' for method, _ in self.native.calls))

    async def test_unknown_native_save_never_replays_even_when_scan_is_empty(self):
        request = self.request(); self.jobs.mode = 'before'
        self.assertEqual(self.invoke('enable', request)['state'], 'uncertain')
        self.assertEqual(self.invoke('enable', request)['state'], 'uncertain')
        self.assertEqual(self.invoke('receipt', {'operation_id': request['operation_id']})['state'], 'uncertain')
        self.assertEqual(self.jobs.creates, 1)

    async def test_lost_acknowledgement_reconciles_the_existing_native_job(self):
        request = self.request(); self.jobs.mode = 'after'
        self.assertEqual(self.invoke('enable', request)['state'], 'completed')
        self.assertEqual(self.invoke('receipt', {'operation_id': request['operation_id']})['state'], 'completed')
        self.assertEqual(self.jobs.creates, 1)

    async def test_changed_permissions_timezone_main_and_payload_collisions_are_rejected(self):
        request = self.request()
        for attribute, value in [('fingerprint', 'changed'), ('zone', 'UTC')]:
            old = getattr(self.jobs, attribute); setattr(self.jobs, attribute, value)
            with self.assertRaises(InvalidOperation): self.invoke('enable', request)
            setattr(self.jobs, attribute, old)
        with self.assertRaises(InvalidOperation): self.invoke('enable', request, actor=self.main['id'])
        self.assertEqual(self.jobs.creates, 0)
        self.invoke('enable', request)
        with self.assertRaises(InvalidOperation): self.invoke('enable', {**request, 'time': '10:00'})
        self.assertEqual(self.jobs.creates, 1)
        self.main = {**self.main, 'id': 'replacement'}
        with self.assertRaises(InvalidOperation): self.invoke('enable', {**request, 'operation_id': str(uuid.uuid4())})

    async def test_duplicate_or_changed_native_readback_stays_uncertain(self):
        request = self.request(); self.jobs.mode = 'before'; self.invoke('enable', request)
        marker = self.ledger.receipt(request['operation_id'], 'owner')['marker']
        self.jobs.saved = [{'id': 'foreign', 'prompt': '[' + marker + ']', 'name': 'changed'}]
        self.assertEqual(self.invoke('receipt', {'operation_id': request['operation_id']})['state'], 'uncertain')
        self.assertEqual(self.jobs.creates, 1)

    async def test_uncertain_family_stays_visible_and_cannot_be_bypassed_with_new_uuid(self):
        request = self.request(); self.jobs.mode = 'before'
        self.invoke('enable', request)
        status = self.invoke('status')
        self.assertEqual(status['routines'][0]['id'], request['operation_id'])
        self.assertEqual(status['routines'][0]['state'], 'uncertain')
        self.assertEqual(self.invoke('suggest')['suggestions'], [])
        self.main = {**self.main, 'id': 'a-new-main'}
        self.assertEqual(self.invoke('suggest')['suggestions'], [])
        self.assertEqual(self.jobs.creates, 1)

    async def test_physical_profile_replacement_blocks_uncertain_receipt_native_reads(self):
        from unittest.mock import patch
        from types import SimpleNamespace, ModuleType
        import sys
        request = self.request(); self.jobs.mode = 'before'
        self.invoke('enable', request)
        state = self.store.read(); bot = state['bots']['default']; bot['native_incarnation'] = self.main['native_incarnation']; self.store.save(state, state['revision'])
        module = ModuleType('hermes_cli.profiles'); module.get_profile_dir = lambda profile: self.path.parent
        with patch.dict(sys.modules, {'hermes_cli.profiles': module}), patch('bot_web.search_native.identity', return_value='replacement'), patch.object(self.jobs, 'jobs', side_effect=AssertionError('Do not read a replaced profile')):
            self.assertEqual(self.invoke('receipt', {'operation_id': request['operation_id']})['state'], 'uncertain')

    async def test_exact_returned_id_is_verified_and_disabled_creation_does_not_replay(self):
        from unittest.mock import patch
        request = self.request()
        original = self.jobs.create
        def disabled(spec):
            job = original(spec)
            self.jobs.saved[0]['enabled'] = False
            return job
        with patch.object(self.jobs, 'create', side_effect=disabled), patch.object(self.jobs, 'job', wraps=self.jobs.job) as readback:
            receipt = self.invoke('enable', request)
            self.assertEqual(receipt['state'], 'completed')
            self.assertFalse(receipt['enabled'])
            readback.assert_called_once_with('1')
        self.assertEqual(self.invoke('enable', request), receipt)
        self.assertEqual(self.jobs.creates, 1)
