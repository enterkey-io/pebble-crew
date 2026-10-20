import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from test_workspace import WorkspaceNative
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.workspace import WorkspaceStore, WorkspaceService
from bot_web.reporting import assign, path, submit, drain, recover, receipts
from bot_web.runtime import live_context


class ReportingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.file = Path(self.directory.name) / 'workspace.sqlite'
        self.store = WorkspaceStore(self.file)
        self.native = WorkspaceNative()
        self.service = WorkspaceService(BotOperations(self.native), self.store)
        state = await self.service.invoke('workspace.detect_primary', {})
        await self.service.invoke('workspace.initialize', {'profile':'default', 'handle':'aurora',
            'appearance':{'kind':'shape','shape':'pebble','color':'iris'}, 'photo':None,
            'expected_revision':state['revision']})

    async def asyncTearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    def spec(self):
        state = self.store.read()
        return {'profile':'amy','id':state['bots']['amy']['id'], 'manager':'default',
            'manager_id':state['bots']['default']['id'], 'instructions':'Report blockers promptly. Verify results before reporting completion.',
            'expected_revision':state['revision'], 'policy_revision':state['reporting']['policy_revision']}

    async def test_existing_agents_are_unattached_until_assigned_and_forest_is_live(self):
        state = self.store.read()
        self.assertIsNone(state['bots']['amy']['manager'])
        data = json.loads(live_context(self.store,'amy').split('\n',1)[1])
        self.assertEqual(data['reporting_state'],'unattached')
        self.assertEqual(data['direct_reports'],[])
        self.assertEqual(data['your_reporting_path'][0]['profile'],'amy')
        assign(state,'default','amy')
        with self.assertRaises(InvalidOperation): self.service.graph(state)
        state = self.store.read()
        assign(state,'amy','default')
        self.store.save(state,state['revision'])
        data = json.loads(live_context(self.store,'default').split('\n',1)[1])
        self.assertEqual([b['profile'] for b in data['direct_reports']],['amy'])
        self.assertEqual(data['reporting_state'],'main')

    async def test_detached_manager_keeps_real_reports_and_reused_names_do_not_inherit_edges(self):
        state = self.store.read()
        child=deepcopy(state['bots']['amy']); child.update(id='child-id',profile='child',handle='child')
        state['bots']['child']=child
        assign(state,'child','amy'); self.service.graph(state)
        self.store.save(state,state['revision'])
        data=json.loads(live_context(self.store,'child').split('\n',1)[1])
        self.assertEqual(data['your_manager']['profile'],'amy')
        self.assertEqual(data['reporting_termination'],'unattached')
        state=self.store.read(); state['bots']['amy']['id']='replacement-id'
        self.store.save(state,state['revision'])
        data=json.loads(live_context(self.store,'child').split('\n',1)[1])
        self.assertEqual(data['reporting_state'],'invalid')
        self.assertIsNone(data['your_manager'])
        assign(state,'child',None); self.service.graph(state)

    async def test_main_management_commits_without_browser_or_owner_approval(self):
        spec=self.spec()
        first=submit(self.store,'default',spec)
        self.assertEqual(first,submit(self.store,'default',spec))
        self.assertEqual(first['state'],'queued')
        self.assertFalse(first['requires_owner_approval'])
        await drain(self.service)
        state=self.store.read()
        self.assertEqual(state['bots']['amy']['manager'],'default')
        self.assertEqual(state['bots']['amy']['role']['responsibilities'],spec['instructions'])
        self.assertEqual(receipts(self.store)[0]['state'],'applied')
        self.assertEqual(submit(self.store,'default',spec)['state'],'applied')
        self.assertEqual(receipts(self.store)[0]['result']['before']['manager'],None)
        self.assertEqual(self.native.profiles[1]['ui_meta']['hermes-bots']['workspaceRole'],state['bots']['amy']['role'])
        self.assertFalse(any(method in {'prompt.submit','profiles.create'} for method,_ in self.native.calls))
        self.assertEqual(json.loads(live_context(self.store,'amy').split('\n',1)[1])['your_role']['responsibilities'],spec['instructions'])

    async def test_subordinate_cannot_manage_and_revocation_fences_queued_changes(self):
        with self.assertRaises(InvalidOperation): submit(self.store,'amy',self.spec())
        submit(self.store,'default',self.spec())
        state=self.store.read()
        await self.service.invoke('reporting.policy',{'enabled':False,'expected_revision':state['revision'],'policy_revision':state['reporting']['policy_revision']})
        await drain(self.service)
        self.assertEqual(receipts(self.store)[0]['state'],'refused')
        self.assertIsNone(self.store.read()['bots']['amy']['manager'])
        with self.assertRaises(InvalidOperation): submit(self.store,'default',self.spec())

    async def test_stale_and_replaced_targets_never_apply(self):
        spec=self.spec(); submit(self.store,'default',spec)
        state=self.store.read(); state['bots']['amy']['role']['responsibilities']='New human edit'
        self.store.save(state,state['revision'])
        await drain(self.service)
        self.assertEqual(receipts(self.store)[0]['result']['code'],'STALE_REVISION')
        self.assertEqual(self.store.read()['bots']['amy']['role']['responsibilities'],'New human edit')
        spec=self.spec(); spec['id']='old-id'
        with self.assertRaises(InvalidOperation): submit(self.store,'default',spec)

    async def test_interrupted_application_is_uncertain_and_never_replayed(self):
        submit(self.store,'default',self.spec())
        with self.store.db: self.store.db.execute("UPDATE reporting_changes SET state='applying'")
        recover(self.store); await drain(self.service)
        self.assertEqual(receipts(self.store)[0]['state'],'uncertain')
        self.assertIsNone(self.store.read()['bots']['amy']['manager'])

    async def test_private_backup_and_migration_are_idempotent(self):
        self.assertEqual(self.file.with_suffix('.pre-reporting.sqlite').stat().st_mode & 0o777,0o600)
        revision=self.store.read()['revision']
        second=WorkspaceStore(self.file)
        try: self.assertEqual(second.read()['revision'],revision)
        finally: second.db.close()

    async def test_reporting_only_change_preserves_every_existing_instruction_field(self):
        state=self.store.read()
        state['bots']['amy']['role'].update(responsibilities='Existing job',boundaries='Never publish',expectedOutputs='Verified result')
        self.store.save(state,state['revision'])
        self.native.profiles[1]['ui_meta']['hermes-bots']['workspaceRole']=deepcopy(state['bots']['amy']['role'])
        spec=self.spec(); spec['instructions']=None
        submit(self.store,'default',spec); await drain(self.service)
        self.assertEqual(self.store.read()['bots']['amy']['role'],state['bots']['amy']['role'])
