from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from test_security import Native
from bot_web import grok_voice
from bot_web.live_context import instructions, profile_context, recent_history
from bot_web.live_voice import LiveVoice
from bot_web.operations import BotOperations
from bot_web.workspace import WorkspaceStore


class LiveContextTests(unittest.IsolatedAsyncioTestCase):
    def test_briefing_carries_persona_memory_and_the_hand_off(self):
        text = instructions('Aurora', 'Research lead', {
            'soul': 'You are dry-witted and precise.',
            'user': 'Elliott prefers short answers.',
            'memory': 'The launch is on Friday.'}, handoff='Call the ask_pebble tool.')
        for expected in ('You are Aurora', 'Research lead', 'dry-witted and precise',
                         'Elliott prefers short answers', 'launch is on Friday', 'ask_pebble'):
            self.assertIn(expected, text)
        self.assertIn('Never invent results', text)
        self.assertNotIn('Notes about', instructions('Aurora', '', {}, handoff='x'))

    def test_profile_files_are_read_from_the_pebble_home_and_clipped(self):
        root = TemporaryDirectory()
        self.addCleanup(root.cleanup)
        home = Path(root.name)
        (home / 'memories').mkdir()
        (home / 'SOUL.md').write_text('Calm and kind. ' * 1000)
        (home / 'memories' / 'USER.md').write_text('Owner likes tea.')
        scope = SimpleNamespace(_config_profile_scope=lambda profile: nullcontext())
        with patch.dict('sys.modules', {'hermes_cli.web_server_profiles': scope}), \
                patch('hermes_constants.get_hermes_home', return_value=home), \
                patch('agent.prompt_builder.load_soul_md', side_effect=RuntimeError):
            context = profile_context('aurora')
        self.assertLessEqual(len(context['soul']), 6002)
        self.assertTrue(context['soul'].startswith('Calm and kind.'))
        self.assertEqual(context['user'], 'Owner likes tea.')
        self.assertEqual(context['memory'], '')

    async def test_recent_history_keeps_only_visible_owner_and_pebble_text(self):
        ops = SimpleNamespace(invoke=AsyncMock(return_value={'messages': [
            {'role': 'user', 'text': 'Old question'},
            {'role': 'system', 'row_id': 4},
            {'role': 'assistant', 'text': 'Hidden tool output', 'display_kind': 'hidden'},
            {'role': 'tool', 'text': 'raw'},
            {'role': 'assistant', 'text': 'Visible answer'},
        ]}))
        self.assertEqual(await recent_history(ops, 'live-alpha'), [
            {'role': 'user', 'text': 'Old question'}, {'role': 'assistant', 'text': 'Visible answer'}])

    def test_every_grok_voice_is_grouped_as_female_or_male(self):
        self.assertEqual(len(grok_voice.VOICES), 28)
        self.assertFalse(set(grok_voice.FEMALE_VOICES) & set(grok_voice.MALE_VOICES))
        self.assertIn(grok_voice.DEFAULT_VOICE, grok_voice.VOICES)


class LiveCallStartTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.native = Native()
        self.ops = BotOperations(self.native)
        self.ops.sessions['live-alpha'] = 'alpha'
        self.ops.session_incarnations['live-alpha'] = 'a' * 64
        self.ops.session_conversations['live-alpha'] = 'root-alpha'
        root = TemporaryDirectory()
        self.addCleanup(root.cleanup)
        store = WorkspaceStore(Path(root.name) / 'workspace.sqlite')
        self.addCleanup(store.db.close)
        self.voice = LiveVoice(self.ops, store)
        self.ops.bot = AsyncMock(return_value={'name': 'alpha'})
        self.ops.summary = lambda row: {'name': 'Aurora', 'description': 'Research lead'}
        self.scope = SimpleNamespace(_config_profile_scope=lambda profile: nullcontext())

    def patches(self, provider):
        return [patch('bot_web.live_voice.supported', return_value=True),
                patch.dict('sys.modules', {'hermes_cli.web_server_profiles': self.scope}),
                patch('bot_web.eleven_voice.provider', return_value=provider),
                patch('bot_web.live_voice.profile_context', return_value={'soul': 'Dry wit.', 'user': 'Elliott.', 'memory': ''}),
                patch('bot_web.live_voice.recent_history', AsyncMock(return_value=[{'role': 'user', 'text': 'Status?'}]))]

    async def test_grok_call_gets_a_short_lived_token_and_the_pebble_briefing(self):
        from contextlib import ExitStack
        with ExitStack() as stack:
            for item in self.patches('grok'):
                stack.enter_context(item)
            stack.enter_context(patch('bot_web.grok_voice.source', return_value=('synthetic-xai-key', True)))
            stack.enter_context(patch('bot_web.grok_voice.selected_voice', return_value='leo'))
            secret = stack.enter_context(patch('bot_web.grok_voice.client_secret', return_value='synthetic-client-secret-123'))
            started = await self.voice.invoke('voice.start', {'session_id': 'live-alpha'})
        secret.assert_called_once_with('synthetic-xai-key')
        self.assertEqual(started['provider'], 'grok')
        self.assertEqual(started['token'], 'synthetic-client-secret-123')
        self.assertEqual(started['voice'], 'leo')
        self.assertNotIn('synthetic-xai-key', repr(started))
        self.assertIn('You are Aurora', started['instructions'])
        self.assertIn('Dry wit.', started['instructions'])
        self.assertIn('ask_pebble', started['instructions'])
        self.assertEqual(started['history'], [{'role': 'user', 'text': 'Status?'}])
        self.assertEqual(self.voice.spoken.voice('live-alpha', started['call_id']), 'grok-leo')
        self.assertNotIn('prompt.submit', [call[0] for call in self.native.calls])

    async def test_openai_call_starts_a_record_and_its_session_carries_the_briefing(self):
        from contextlib import ExitStack
        with ExitStack() as stack:
            for item in self.patches('openai'):
                stack.enter_context(item)
            stack.enter_context(patch('bot_web.live_voice.resolve_source', return_value={
                'key': 'synthetic-openai-key', 'confirmed': True, 'base': 'https://example.invalid'}))
            create = stack.enter_context(patch('bot_web.live_voice.create_session', return_value={
                'session': {'id': 'sess'}, 'transport': {'type': 'webrtc', 'sdp': 'v=0'}}))
            started = await self.voice.invoke('voice.start', {'session_id': 'live-alpha'})
            self.assertEqual(started, {'call_id': started['call_id'], 'provider': 'openai'})
            await self.voice.invoke('voice.session', {'session_id': 'live-alpha', 'sdp': 'v=0 offer', 'preview': False})
        sdp, name, preview, items, coordination = create.call_args.args
        self.assertEqual((sdp, name, preview), ('v=0 offer', 'Aurora', False))
        self.assertEqual(items, [{'type': 'message', 'role': 'user',
                                  'content': [{'type': 'input_text', 'text': 'Status?'}]}])
        self.assertIn('Dry wit.', coordination)
        self.assertIn('Delegate', coordination)
