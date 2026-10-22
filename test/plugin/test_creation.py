"""Creation fails before side effects or retains the original partial outcome."""
import test_security
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock
from bot_web.workspace import WorkspaceStore, normalize_role
from bot_web.creation import create
from bot_web.operations import InvalidOperation
from bot_web.native import NativeError


class CreationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = WorkspaceStore(Path(self.directory.name) / 'workspace.sqlite')
        state = self.store.read()
        state.update(initialized=True, orchestrator='default', bots={'default': {'id': 'main', 'enrolled': True}})
        self.state = self.store.save(state, state['revision'])
        self.role = {key: '' for key in ('title', 'description', 'responsibilities', 'boundaries', 'expectedOutputs')}
        self.role.update(title='Operator', description='Runs the server', responsibilities=('Reviewed job ' * 800).strip())
        self.spec = {'name': 'ron', 'display_name': 'Ron', 'soul': 'Fresh persona ' * 800, 'role': self.role,
                     'model_source': 'default', 'model_fingerprint': 'approved-model', 'skills': [],
                     'toolsets': ['workspace', 'skills'], 'manager': 'default', 'team': None, 'expected_revision': self.state['revision']}
        self.failure = None
        async def call(method, params):
            if method == self.failure:
                raise NativeError('synthetic interrupted receipt')
            if method == 'bot_web.models':
                return {'supported': True, 'fingerprint': 'approved-model', 'configured': True}
            if method == 'profiles.create':
                self.assertFalse(params['mirror_credentials'])
                self.assertFalse(params['clone_channels'])
                self.assertTrue(params['no_alias'] and params['no_skills'])
                self.assertEqual(params['description'], self.role['description'])
                return {'ok': True, 'soul_written': True}
            if method == 'profiles.describe':
                return {'skills': [{'name': 'unreviewed-skill'}]}
            if method == 'profiles.configure':
                self.assertEqual(params['disabled_skills'], ['unreviewed-skill'])
                return {'applied': {'skills': True, 'toolsets': True}}
            return {}
        self.gateway = SimpleNamespace(call=AsyncMock(side_effect=call))
        async def sync():
            state = self.store.read()
            state['bots']['ron'] = {'id': 'new-ron', 'profile': 'ron'}
            self.store.save(state, state['revision'])
        self.service = SimpleNamespace(store=self.store, ops=SimpleNamespace(gateway=self.gateway, enable_existing=AsyncMock()), mirror=AsyncMock(), sync=sync)

    async def asyncTearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    async def test_full_role_and_isolation_survive_creation_and_large_proposal(self):
        request_id, status = self.store.request('default', 'agent.create', self.spec)
        self.service._creation_request = request_id
        with self.store.db:
            self.store.db.execute("UPDATE requests SET state='executing' WHERE id=?", (request_id,))
        result = await create(self.service, self.spec, self.state)
        self.assertEqual(result['state'], 'completed')
        self.assertEqual(self.store.read()['bots']['ron']['role'], self.role)
        self.assertEqual(self.store.requests()[0]['spec']['role'], self.role)
        self.assertEqual(self.service.mirror.call_args.args[1]['workspaceRole'], self.role)
        self.assertEqual(self.store.requests()[0]['state'], 'completed')
        self.assertEqual(self.store.incomplete_creations(), set())

    async def test_bad_role_and_missing_or_changed_auth_fail_before_native_creation(self):
        with self.assertRaises(InvalidOperation):
            await create(self.service, {**self.spec, 'role': {'description': 'not a complete role'}}, self.state)
        self.gateway.call.assert_not_awaited()
        for model, expected in [({'supported': False, 'reason': {'code': 'AUTH_MISSING', 'message': 'Sign in to Codex in Hermes.'}}, 'AUTH_MISSING'), ({'supported': True, 'fingerprint': 'different'}, 'MODEL_AUTHORIZATION_CHANGED')]:
            self.gateway.call.reset_mock()
            self.gateway.call.side_effect = None
            self.gateway.call.return_value = model
            with self.assertRaises(InvalidOperation) as error:
                await create(self.service, self.spec, self.state)
            self.assertEqual(error.exception.code, expected)
            self.assertEqual([call.args[0] for call in self.gateway.call.await_args_list], ['bot_web.models'])
            self.service.ops.enable_existing.assert_not_awaited()

    async def test_unknown_creation_and_known_partial_setup_are_never_enrolled_or_replayed(self):
        for index, (method, expected) in enumerate([('profiles.create', 'uncertain'), ('bot_web.runtime.prepare', 'partial'), ('profiles.configure', 'partial')]):
            self.failure = method
            self.gateway.call.reset_mock()
            self.spec['name'] = 'ron' + str(index)
            result = await create(self.service, self.spec, self.state)
            self.assertEqual(result['state'], expected)
            self.assertFalse(result['canonical'])
            self.assertEqual(result['profile'], self.spec['name'])
            self.assertEqual(sum(c.args[0] == 'profiles.create' for c in self.gateway.call.await_args_list), 1)
            self.service.ops.enable_existing.assert_not_awaited()
            self.assertNotIn('ron', self.store.read()['bots'])

    async def test_failure_after_native_marker_never_claims_chat_or_enrollment(self):
        self.service.ops.enable_existing.side_effect = NativeError('synthetic lost canonical receipt')
        result = await create(self.service, self.spec, self.state)
        self.assertEqual(result['state'], 'partial')
        self.service.mirror.assert_awaited_once()
        self.assertFalse(result['canonical'])
        self.assertEqual(self.store.incomplete_creations(), {'ron'})
        self.assertEqual(self.store.requests()[0]['state'], 'partial')

    def test_legacy_role_text_normalizes_without_losing_structured_fields(self):
        self.assertEqual(normalize_role('Old description')['description'], 'Old description')
        self.assertEqual(normalize_role(self.role), self.role)
        with self.assertRaises(InvalidOperation):
            normalize_role({**self.role, 'command': 'unreviewed'})
