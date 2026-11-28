import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from test_security import Native
from bot_web import eleven_voice
from bot_web.live_voice import LiveVoice
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.workspace import WorkspaceStore


class ElevenVoiceTests(unittest.TestCase):
    def test_private_vox_import_matches_explicit_handle_and_preserves_saved_voice(self):
        with TemporaryDirectory() as root:
            store = WorkspaceStore(Path(root) / 'workspace.sqlite')
            self.addCleanup(store.db.close)
            state = store.read()
            state['bots']['native-alpha'] = {'handle': 'alpha'}
            store.save(state, state['revision'])
            presets = [{'handle': 'Alpha', 'voice_id': 'preset_Alpha', 'label': 'Vox · Alpha'}]
            self.assertEqual(eleven_voice.import_presets(store, presets), {'imported': 1})
            self.assertIsNone(eleven_voice.vox_preset(store, 'unknown'))
            preset = eleven_voice.vox_preset(store, 'native-alpha')
            self.assertEqual(tuple(preset), ('preset_Alpha', 'Vox · Alpha'))
            with self.assertRaises(InvalidOperation):
                eleven_voice.import_presets(store, presets + [
                    {'handle': 'alpha', 'voice_id': 'bad', 'label': 'Duplicate'}])
            with patch('bot_web.eleven_voice.source', return_value=('private-key', True)):
                with patch('bot_web.eleven_voice.voice_config', return_value={}):
                    self.assertEqual(eleven_voice.preferences(preset)['voice'], 'preset_Alpha')
                with patch('bot_web.eleven_voice.voice_config',
                           return_value={'elevenlabs': {'pebble_voice': 'owner-choice'}}):
                    self.assertEqual(eleven_voice.preferences(preset)['voice'], 'owner-choice')

    def test_scoped_ticket_hides_api_key_and_preview_has_no_hermes_tools(self):
        with patch('bot_web.eleven_voice.source', return_value=('private-key', True)), \
             patch('bot_web.eleven_voice.voice_config', return_value={}), \
             patch('bot_web.eleven_voice.request', return_value={'value': 'synthetic_client_secret'}) as request:
            for preview in (False, True):
                key, session = eleven_voice.session_parameters('Alpha', preview, ('vox_A', 'Vox'))
                result = eleven_voice.create_session(key, session)
                path, key, payload = request.call_args.args
                self.assertEqual(path, '/v1/convai/realtime/client_secrets')
                self.assertEqual(key, 'private-key')
                self.assertNotIn('private-key', json.dumps(result))
                self.assertEqual(payload['expires_after']['seconds'], 120)
                self.assertEqual(payload['session']['audio']['output']['voice'], 'vox_A')
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
