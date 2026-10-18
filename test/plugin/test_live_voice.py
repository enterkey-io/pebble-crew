import asyncio
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch
from test_security import Native
from bot_web.native import NativeGateway
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.live_voice import LiveVoice


class VoiceBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.native = Native()
        self.ops = BotOperations(self.native)
        self.ops.sessions['live-alpha'] = 'alpha'
        self.ops.session_incarnations['live-alpha'] = 'a'*64
        self.voice = LiveVoice(self.ops)

    async def test_delegation_uses_native_live_surface_and_the_normal_model(self):
        with patch('bot_web.live_voice.supported', return_value=True):
            await self.voice.invoke('voice.submit', {'session_id': 'live-alpha', 'text': 'Check the report', 'context': 'User: the report'})
        method, params = self.native.calls[-1]
        self.assertEqual(method, 'prompt.submit')
        self.assertEqual(params, {'session_id': 'live-alpha', 'text': 'Check the report', 'surface': 'voice-live', 'voice_context': 'User: the report', 'queued': True})
        self.assertNotIn('voice_turn', params)
        self.assertNotIn('session.interrupt', [call[0] for call in self.native.calls])

    async def test_changed_profile_or_foreign_session_cannot_start_voice(self):
        with patch('bot_web.live_voice.supported', return_value=True):
            for sid in ['foreign', 'live-alpha']:
                self.native.incarnation = 'b'*64
                with self.assertRaises(InvalidOperation):
                    await self.voice.invoke('voice.session', {'session_id': sid, 'sdp': 'v=0\r\n', 'preview': False})
        self.assertNotIn('prompt.submit', [call[0] for call in self.native.calls])

    async def test_secret_prompt_only_exposes_metadata_and_only_its_session_can_reply_once(self):
        native = NativeGateway()
        native.healthy = True
        stdin = SimpleNamespace(write=Mock(), drain=AsyncMock())
        native.process = SimpleNamespace(stdin=stdin, returncode=None)
        await native._server_request({'id': 'request-one', 'method': 'secret', 'params': {'session_id': 'live-alpha', 'env_var': 'VOICE_TOOLS_OPENAI_KEY', 'prompt': 'OpenAI voice key'}})
        listed = await native.secret_prompt('secrets.pending', {'session_id': 'live-alpha'})
        self.assertEqual(listed, {'requests': [{'id': 'request-one', 'label': 'VOICE_TOOLS_OPENAI_KEY', 'prompt': 'OpenAI voice key'}]})
        with self.assertRaises(InvalidOperation):
            await native.secret_prompt('secrets.respond', {'session_id': 'foreign', 'id': 'request-one', 'value': 'synthetic-test'})
        receipt = await native.secret_prompt('secrets.respond', {'session_id': 'live-alpha', 'id': 'request-one', 'value': 'synthetic-test'})
        self.assertEqual(receipt, {'submitted': True})
        self.assertEqual(json.loads(stdin.write.call_args.args[0])['result'], {'value': 'synthetic-test'})
        self.assertEqual(await native.secret_prompt('secrets.pending', {'session_id': 'live-alpha'}), {'requests': []})
        with self.assertRaises(InvalidOperation):
            await native.secret_prompt('secrets.respond', {'session_id': 'live-alpha', 'id': 'request-one', 'value': 'replay'})

    async def test_voice_and_secret_routes_require_this_connections_opened_session(self):
        import httpx
        from bot_web.server import create_app
        from test_security import TOKEN, ORIGIN, HOST
        app = create_app(TOKEN, {ORIGIN}, {HOST}, self.native)
        headers = {'Origin': ORIGIN, 'Authorization': 'Bearer '+TOKEN}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://'+HOST) as http:
            first = (await http.post('/v1/connect', headers=headers)).json()['connection']
            second = (await http.post('/v1/connect', headers=headers)).json()['connection']
            await http.post('/v1/rpc', headers=headers | {'X-Bot-Connection': first}, json={'operation': 'bot.open', 'params': {'profile': 'alpha'}})
            for operation in ['voice.status', 'voice.credential', 'voice.session', 'voice.submit', 'secrets.pending', 'secrets.respond']:
                response = await http.post('/v1/rpc', headers=headers | {'X-Bot-Connection': second}, json={'operation': operation, 'params': {'session_id': 'live-alpha'}})
                self.assertEqual(response.status_code, 400, operation)
            response = await http.post('/v1/rpc', headers={**headers, 'Origin': 'https://evil.invalid', 'X-Bot-Connection': first}, json={'operation': 'voice.credential', 'params': {'session_id': 'live-alpha', 'value': 'synthetic'}})
            self.assertEqual(response.status_code, 403)

    async def test_call_followup_is_hidden_single_use_and_refuses_preview_or_foreign_calls(self):
        import time
        self.voice.calls['actual-call'] = {'session_id': 'live-alpha', 'preview': False, 'expires': time.monotonic() + 60, 'followed_up': False}
        params = {'session_id': 'live-alpha', 'call_id': 'actual-call', 'transcript': 'User: We have not decided yet.'}
        with patch('bot_web.live_voice.supported', return_value=True):
            await self.voice.invoke('voice.end', params)
            self.assertEqual(await self.voice.invoke('voice.end', params), {'submitted': False})
            for call_id, call in [('preview', {'session_id': 'live-alpha', 'preview': True}), ('foreign', {'session_id': 'another-chat', 'preview': False})]:
                self.voice.calls[call_id] = {**call, 'expires': time.monotonic() + 60, 'followed_up': False}
                with self.assertRaises(InvalidOperation):
                    await self.voice.invoke('voice.end', {**params, 'call_id': call_id})
        submits = [call for call in self.native.calls if call[0] == 'prompt.submit']
        self.assertEqual(len(submits), 1)
        method, request = submits[0]
        self.assertEqual(method, 'prompt.submit')
        self.assertEqual(request['display_kind'], 'hidden')
        self.assertEqual(request['voice_context'], params['transcript'])
        self.assertIn('Do not use tools', request['text'])

    async def test_expired_secret_cannot_be_answered(self):
        native = NativeGateway()
        native.secrets['expired'] = {'id': 'expired', 'session_id': 'live-alpha', 'label': 'TEST_KEY', 'prompt': 'Test', 'expires': 0}
        with self.assertRaises(InvalidOperation):
            await native.secret_prompt('secrets.respond', {'session_id': 'live-alpha', 'id': 'expired', 'value': 'test'})
        self.assertEqual(native.secrets, {})

class ProviderErrorTests(unittest.TestCase):
    def test_provider_http_failures_remain_specific_without_echoing_private_bodies(self):
        import io
        import urllib.error
        from bot_web.live_voice import create_session
        native = SimpleNamespace(_live_section=lambda: {}, _resolve_credentials=lambda _: ('synthetic-private-key', 'https://provider.invalid/v1'), build_session_config=lambda _: {'instructions': 'Native instructions'})
        for status, code in [(401, 'VOICE_KEY_REJECTED'), (403, 'VOICE_ACCESS_DENIED'), (404, 'VOICE_MODEL_UNAVAILABLE'), (429, 'VOICE_LIMIT_REACHED'), (500, 'VOICE_PROVIDER_UNAVAILABLE'), (400, 'VOICE_OFFER_REJECTED')]:
            error = urllib.error.HTTPError('https://private.invalid', status, 'private body', {}, io.BytesIO(b'secret vendor detail'))
            with patch.dict('sys.modules', {'tools.voice_live': native}), patch('bot_web.live_voice.urllib.request.urlopen', side_effect=error), self.assertRaises(InvalidOperation) as caught:
                create_session('v=0\r\n', 'Synthetic', False)
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn('private', str(caught.exception))
            self.assertNotIn('secret', str(caught.exception))

    def test_native_session_builder_errors_are_not_relabeled_as_microphone_failures(self):
        import urllib.error
        from bot_web.live_voice import create_session
        native = SimpleNamespace(_live_section=lambda: {}, _resolve_credentials=lambda _: ('', 'https://provider.invalid/v1'))
        with patch.dict('sys.modules', {'tools.voice_live': native}), self.assertRaises(InvalidOperation) as caught:
            create_session('v=0\r\n', 'Synthetic', False)
        self.assertEqual(caught.exception.code, 'VOICE_KEY_REQUIRED')
