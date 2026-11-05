import unittest
import test_workspace
from bot_web.operations import InvalidOperation

class RetiredCrewTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_workspace.WorkspaceTests.asyncSetUp
    asyncTearDown = test_workspace.WorkspaceTests.asyncTearDown
    async def test_old_crew_writes_refuse_before_mutating_profiles_reporting_or_rooms(self):
        before=self.store.read(); calls=len(self.native.calls)
        for operation,params in [('crews.save',{'id':'studio','members':['amy']}),('organization.chat',{'id':'studio','expected_revision':0,'confirm_new':False})]:
            with self.assertRaises(InvalidOperation) as refused: await self.service.invoke(operation,params)
            self.assertEqual(refused.exception.code,'UPDATE_REQUIRED')
        self.assertEqual(self.store.read(),before)
        self.assertFalse(any(method in {'profiles.configure','groups.create','groups.send','prompt.submit'} for method,_ in self.native.calls[calls:]))


    async def test_retired_team_proposal_stays_pending_with_original_fingerprint(self):
        state=self.store.read()
        state['teams']=[{'id':'legacy-team','name':'Old department'}]
        state=self.store.save(state,state['revision'])
        spec={'profile':'amy','role':state['bots']['amy']['role'],'manager':'default','team':'legacy-team','expected_revision':state['revision']}
        ident,_=self.store.request('default','agent.update',spec)
        original=self.store.request_by_id(ident)
        review=await self.service.invoke('requests.review',{'id':ident})
        self.assertEqual(review['kind'],'blocked')
        self.assertIn('retired team membership',review['reason'])
        result=await self.service.invoke('requests.approve',{'id':ident,'fingerprint':original['fingerprint']})
        self.assertEqual(result['state'],'pending')
        self.assertEqual(self.store.request_by_id(ident),original)
        self.assertIsNone(self.store.read()['bots']['amy']['team'])
