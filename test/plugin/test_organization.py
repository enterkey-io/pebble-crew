from copy import deepcopy
from test_presentation import PresentationTests
from bot_web.operations import InvalidOperation
from bot_web.native import NativeError
from bot_web.workspace import WorkspaceStore, WorkspaceService
from bot_web.operations import BotOperations


class OrganizationTests(PresentationTests):
    async def test_layout_reorder_and_collapse_persist_without_rewriting_native_roles_or_pin_order(self):
        original = deepcopy(self.store.read())
        org = await self.service.invoke('organization.get', {})
        changed = {'schema': 2, 'sections': list(reversed(org['sections'])), 'crews': org['crews']}
        changed['sections'][0]['collapsed'] = True
        before = len(self.native.calls)
        saved = await self.service.invoke('organization.save', {'organization': changed, 'expected_revision': org['revision']})
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(self.store.read()['bots'], original['bots'])
        self.assertFalse(any(m == 'profiles.configure' for m, _ in self.native.calls[before:]))
        reopened = WorkspaceStore(self.path)
        service = WorkspaceService(BotOperations(self.native), reopened)
        self.assertEqual(await service.invoke('organization.get', {}), saved)
        reopened.db.close()
        with self.assertRaises(InvalidOperation):
            await self.service.invoke('organization.save', {'organization': changed, 'expected_revision': 0})

    async def test_duplicate_foreign_and_missing_identity_placements_are_rejected(self):
        org = await self.service.invoke('organization.get', {})
        for mode in ['duplicate', 'foreign', 'missing']:
            changed = deepcopy({'schema': 2, 'sections': org['sections'], 'crews': org['crews']})
            items = changed['sections'][0]['items']
            if mode == 'duplicate':
                items.append(deepcopy(items[0]))
            elif mode == 'foreign':
                items.append({'kind': 'pebble', 'id': 'not-on-this-install'})
            else:
                items.pop()
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('organization.save', {'organization': changed, 'expected_revision': org['revision']})

    async def test_native_crew_chat_is_reused_and_never_mutates_existing_members(self):
        org = await self.service.invoke('organization.get', {})
        ids = [b['id'] for b in self.store.read()['bots'].values()]
        changed = {'schema': 2, 'sections': [{**s, 'items': [{'kind': 'crew', 'id': 'crew-a'}] if s['id'] == 'pebbles' else []} for s in org['sections']],
                   'crews': [{'id': 'crew-a', 'name': 'Research', 'purpose': '', 'managerId': None, 'collapsed': False, 'members': ids}]}
        saved = await self.service.invoke('organization.save', {'organization': changed, 'expected_revision': 0})
        rooms, creates = {}, []
        previous = self.native.call
        async def native(method, params):
            if method == 'groups.state':
                if params['room_id'] not in rooms:
                    raise NativeError('not found')
                return {'room': rooms[params['room_id']]}
            if method == 'groups.create':
                creates.append(deepcopy(params))
                rooms[params['room_id']] = {**params, 'created_at': 123}
                return {'room': rooms[params['room_id']]}
            return await previous(method, params)
        self.native.call = native
        params = {'id': 'crew-a', 'expected_revision': saved['revision'], 'confirm_new': False}
        first = await self.service.invoke('organization.chat', params)
        again = await self.service.invoke('organization.chat', params)
        self.assertEqual(first, again)
        self.assertEqual(len(creates), 1)
        self.assertEqual(len(first['room']['members']), 2)
        self.assertFalse(any(m == 'prompt.submit' for m, _ in self.native.calls))

    async def test_root_is_unnamed_and_shortcut_can_coexist_with_crew_membership(self):
        org = await self.service.invoke('organization.get', {})
        ids = [b['id'] for b in self.store.read()['bots'].values()]
        original = deepcopy(self.store.read())
        changed = {'schema':2, 'sections':[{'id':'pebbles','name':'Pebbles','collapsed':False,'items':[{'kind':'crew','id':'studio'},{'kind':'pebble','id':ids[0]}]}],
            'crews':[{'id':'studio','name':'Studio','purpose':'Build carefully','collapsed':False,'members':ids,'managerId':ids[1]}]}
        saved = await self.service.invoke('organization.save', {'organization':changed,'expected_revision':org['revision']})
        self.assertEqual(saved['crews'][0]['managerId'],ids[1])
        self.assertEqual(self.store.read()['bots'],original['bots'])
        from bot_web.organization import leadership
        context=leadership(self.store,self.store.read(),'default')
        self.assertEqual(context['crews'][0]['manager']['id'],ids[1])
        self.assertEqual(context['crews'][0]['purpose'],'Build carefully')
        self.assertFalse(context['crews'][0]['you_are_manager'])
        for mutation in ['manager','old-client','duplicate-crew']:
            invalid=deepcopy(changed)
            if mutation=='manager': invalid['crews'][0]['managerId']='foreign'
            elif mutation=='old-client': invalid.pop('schema')
            else:
                invalid['crews'].append({**invalid['crews'][0],'id':'second'})
                invalid['sections'][0]['items'].append({'kind':'crew','id':'second'})
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('organization.save', {'organization':invalid,'expected_revision':saved['revision']})

    async def test_legacy_migration_merges_crews_preserves_ids_pins_and_keeps_rollback_snapshot(self):
        import json
        org=await self.service.invoke('organization.get',{})
        original=deepcopy(self.store.read())
        old={'revision':7,'sections':org['sections']+[{'id':'crews','name':'Crews','collapsed':False,'items':[]}, {'id':'custom','name':'Custom','collapsed':True,'items':[]}], 'crews':[]}
        self.store.db.execute("INSERT OR REPLACE INTO presentation VALUES('organization',?)",(json.dumps(old),))
        self.store.db.commit()
        repaired=await self.service.invoke('organization.get',{})
        self.assertEqual(repaired['revision'],8)
        self.assertEqual(repaired['schema'],2)
        self.assertEqual([s['id'] for s in repaired['sections']],['pebbles','custom'])
        self.assertTrue(repaired['sections'][1]['collapsed'])
        self.assertEqual(self.store.read()['bots'],original['bots'])
        self.assertEqual(json.loads(self.store.db.execute("SELECT value FROM presentation WHERE key='organization-v1-backup'").fetchone()[0]),old)
        self.assertEqual(await self.service.invoke('organization.get',{}),repaired)

    async def test_main_manages_crew_purpose_manager_and_members_without_reporting_writes(self):
        from bot_web.organization import update_crew
        org=await self.service.invoke('organization.get',{})
        state=self.store.read();ids=[b['id'] for b in state['bots'].values()]
        value={'schema':2,'sections':[{'id':'pebbles','name':'Pebbles','collapsed':False,'items':[{'kind':'crew','id':'studio'}]}],
            'crews':[{'id':'studio','name':'Studio','purpose':'Original','managerId':None,'collapsed':False,'members':ids}]}
        saved=await self.service.invoke('organization.save',{'organization':value,'expected_revision':org['revision']})
        spec={'id':'studio','name':'Studio','purpose':'Ship the product','manager_id':ids[1],'members':ids,'expected_revision':saved['revision']}
        with self.assertRaises(InvalidOperation):update_crew(self.store,'amy',spec)
        result=update_crew(self.store,'default',spec)
        self.assertEqual(result['state'],'completed')
        with self.assertRaises(InvalidOperation):update_crew(self.store,'default',spec)
        self.assertEqual(self.store.read()['bots'],state['bots'])
        self.assertEqual((await self.service.invoke('organization.get',{}))['crews'][0]['managerId'],ids[1])
