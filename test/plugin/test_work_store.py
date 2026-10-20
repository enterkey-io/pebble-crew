from pathlib import Path
import tempfile
import unittest
import uuid
from bot_web.operations import InvalidOperation
from bot_web.work_store import WorkStore


class WorkBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_an_unconfirmed_native_write_cannot_be_misreported_as_a_definite_validation_refusal(self):
        import httpx
        from unittest.mock import AsyncMock
        from bot_web.server import create_app
        from test_security import Native, TOKEN, ORIGIN, HOST
        native = Native()
        native.call = AsyncMock(return_value={'ok': False, 'code': 'RPC_FAILED'})
        app = create_app(TOKEN, {ORIGIN}, {HOST}, native)
        headers = {'Origin': ORIGIN, 'Authorization': 'Bearer '+TOKEN}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://'+HOST) as http:
            connection = (await http.post('/v1/connect', headers=headers)).json()['connection']
            headers['X-Bot-Connection'] = connection
            payload = {'operation': 'work.project.create', 'params': {}}
            response = await http.post('/v1/rpc', headers=headers, json=payload)
            self.assertEqual(response.status_code, 502)
            self.assertNotEqual(response.json().get('code'), 'INVALID_PARAMETERS')
            native.call.return_value = {'ok': False, 'code': 'STALE_REVISION'}
            response = await http.post('/v1/rpc', headers=headers, json=payload)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['code'], 'STALE_REVISION')


class WorkReceiptTests(unittest.TestCase):
    def test_retries_share_a_receipt_but_other_actors_and_changed_payloads_cannot_reuse_it(self):
        with tempfile.TemporaryDirectory() as folder:
            store = WorkStore(Path(folder) / 'work.sqlite')
            try:
                ident = str(uuid.uuid4())
                spec = {'title': 'Verify sources', 'board': 'research'}
                first = store.reserve(ident, 'agent-identity', 'work.task.create', spec)
                store.save(ident, 'completed', {'board': 'research', 'task_id': 'native-1'})
                retried = store.reserve(ident, 'agent-identity', 'work.task.create', spec)
                self.assertEqual(retried['task_id'], 'native-1')
                self.assertEqual(first['id'], retried['id'])
                with self.assertRaises(InvalidOperation):
                    store.reserve(ident, 'replacement-agent', 'work.task.create', spec)
                with self.assertRaises(InvalidOperation):
                    store.reserve(ident, 'agent-identity', 'work.task.create', {**spec, 'board': 'other'})
                self.assertEqual(store.receipt(ident, 'replacement-agent')['state'], 'absent')
                self.assertEqual(store.path.stat().st_mode & 0o777, 0o600)
            finally:
                store.close()

    def test_catalog_binding_does_not_follow_a_main_pebble_transfer_or_recreated_profile(self):
        with tempfile.TemporaryDirectory() as folder:
            store = WorkStore(Path(folder) / 'work.sqlite')
            state = {'id': 'workspace-1', 'orchestrator': 'aurora', 'bots': {
                'aurora': {'id': 'identity-1', 'profile': 'aurora', 'enrolled': True},
                'mica': {'id': 'identity-2', 'profile': 'mica', 'enrolled': True}}}
            try:
                self.assertEqual(store.catalog(state)['profile'], 'aurora')
                state['orchestrator'] = 'mica'
                self.assertEqual(store.catalog(state)['profile'], 'aurora')
                state['bots']['aurora']['id'] = 'replacement'
                with self.assertRaises(InvalidOperation): store.catalog(state)
            finally:
                store.close()
