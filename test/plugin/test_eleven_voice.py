import io
import json
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from test_security import Native
from bot_web import eleven_voice
from bot_web.live_voice import LiveVoice
from bot_web.operations import BotOperations, InvalidOperation


class ElevenVoiceTests(unittest.TestCase):
    def test_catalog_reads_large_paginated_saved_voice_lists(self):
        pages = [
            {'voices': [{'voice_id': 'voice_A', 'name': 'First voice', 'description': 'x' * 280_000}],
             'has_more': True, 'next_page_token': 'next+page/='},
            {'voices': [{'voice_id': 'voice_A', 'name': 'Repeated voice'},
                        {'voice_id': 'voice_B', 'name': 'Second voice'}],
             'has_more': False},
        ]
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(json.dumps(page).encode()) for page in pages]
        with patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener):
            self.assertEqual(eleven_voice.catalog('private-key'),
                             {'voices': {'voice_A': 'First voice', 'voice_B': 'Second voice'}})
        requests = [call.args[0] for call in opener.open.call_args_list]
        queries = [parse_qs(urlsplit(req.full_url).query) for req in requests]
        self.assertEqual(queries[0]['voice_type'], ['saved'])
        self.assertEqual(queries[0]['page_size'], ['20'])
        self.assertEqual(queries[1]['next_page_token'], ['next+page/='])
        self.assertTrue(all(req.get_header('Xi-api-key') == 'private-key' for req in requests))

    def test_incomplete_catalog_reports_failure_instead_of_a_partial_list(self):
        page = {'voices': [{'voice_id': 'voice_A', 'name': 'First'}],
                'has_more': True, 'next_page_token': 'repeated'}
        with patch('bot_web.eleven_voice.request', return_value=page):
            with self.assertRaises(InvalidOperation) as raised:
                eleven_voice.catalog('private-key')
            self.assertEqual(raised.exception.code, 'ELEVEN_CONNECTION_FAILED')

    def test_saved_voice_is_preserved(self):
        with patch('bot_web.eleven_voice.source', return_value=('private-key', True)), \
             patch('bot_web.eleven_voice.voice_config',
                   return_value={'elevenlabs': {'pebble_voice': 'owner-choice'}}):
            self.assertEqual(eleven_voice.preferences()['voice'], 'owner-choice')

    def test_scoped_ticket_hides_api_key_and_preview_has_no_hermes_tools(self):
        with patch('bot_web.eleven_voice.source', return_value=('private-key', True)), \
             patch('bot_web.eleven_voice.voice_config', return_value={'elevenlabs': {'pebble_voice': 'selected_voice'}}), \
             patch('bot_web.eleven_voice.request', return_value={'value': 'synthetic_client_secret'}) as request:
            for preview in (False, True):
                key, session = eleven_voice.session_parameters('Alpha', preview)
                result = eleven_voice.create_session(key, session)
                path, key, payload = request.call_args.args
                self.assertEqual(path, '/v1/convai/realtime/client_secrets')
                self.assertEqual(key, 'private-key')
                self.assertNotIn('private-key', json.dumps(result))
                self.assertEqual(payload['expires_after']['seconds'], 120)
                self.assertEqual(payload['session']['audio']['output']['voice'], 'selected_voice')
                if preview:
                    self.assertNotIn('tools', session)
                    self.assertIsNone(session['audio']['input']['turn_detection'])
                else:
                    self.assertEqual(session['tools'][0]['name'], 'ask_pebble')

    def test_vendor_http_error_is_safe_and_redirects_are_never_followed(self):
        opener = Mock()
        opener.open.side_effect = HTTPError('https://api.elevenlabs.io', 401, 'private detail',
                                            {}, io.BytesIO(b'private vendor data'))
        with patch('bot_web.eleven_voice.urllib.request.build_opener', return_value=opener) as builder:
            with self.assertRaises(InvalidOperation) as raised:
                eleven_voice.request('/v2/voices', 'private-key')
            self.assertEqual(raised.exception.code, 'ELEVEN_KEY_REJECTED')
            self.assertNotIn('private', str(raised.exception))
            handler, = builder.call_args.args
            self.assertIsNone(handler.redirect_request(None, None, 302, None, {}, 'https://other.invalid'))


class ElevenVoiceReceiptTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_ticket_uses_existing_owned_call_receipt(self):
        ops = BotOperations(Native())
        ops.sessions['live-alpha'] = 'alpha'
        ops.session_incarnations['live-alpha'] = 'a' * 64
        voice = LiveVoice(ops)
        from contextlib import nullcontext
        from types import SimpleNamespace
        scope = SimpleNamespace(_config_profile_scope=lambda profile: nullcontext())
        with patch.dict('sys.modules', {'hermes_cli.web_server_profiles': scope}), \
             patch('bot_web.live_voice.supported', return_value=True), \
             patch('bot_web.eleven_voice.provider', return_value='elevenlabs'), \
             patch('bot_web.eleven_voice.session_parameters', return_value=('secret', {})), \
             patch('bot_web.eleven_voice.create_session', return_value={
                 'provider': 'elevenlabs', 'session': {'id': 'owned-call'}, 'client_secret': 'temporary'}):
            result = await voice.invoke('voice.session', {
                'session_id': 'live-alpha', 'provider': 'elevenlabs', 'preview': False})
            self.assertEqual(result['session']['id'], 'owned-call')
            self.assertEqual(voice.calls['owned-call']['session_id'], 'live-alpha')
            self.assertFalse(voice.calls['owned-call']['preview'])
            with self.assertRaises(InvalidOperation):
                await voice.invoke('voice.session', {
                    'session_id': 'foreign', 'provider': 'elevenlabs', 'preview': False})
