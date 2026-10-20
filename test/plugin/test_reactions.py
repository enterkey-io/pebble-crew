import asyncio
import unittest
import sys
from types import SimpleNamespace
from unittest.mock import patch
from test_security import Native
from bot_web.operations import BotOperations, InvalidOperation
from bot_web.native import NativeError, NativeGateway
from bot_web.reactions import emoji, runtime_guidance, ReactionDisplay


class ReactionGateway(Native):
    _publish = NativeGateway._publish

    def __init__(self):
        super().__init__()
        self.display = ReactionDisplay()

    async def call(self, method, params):
        if method == 'message.react':
            self.calls.append((method, params))
            if params['row_id'] != 12:
                raise NativeError('Message does not belong to this session')
            return {'row_id': 12, 'reactions': [{'emoji': params['emoji'], 'author': 'user'}] if params['emoji'] else []}
        return await super().call(method, params)


class ReactionsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.native = ReactionGateway()
        self.ops = BotOperations(self.native)
        self.opened = await self.ops.invoke('bot.open', {'profile': 'alpha'})
        self.params = {'session_id': self.opened['session_id'], 'row_id': 12, 'emoji': '❤️'}

    async def test_open_enables_feedback_in_only_the_native_opened_session_without_a_prompt(self):
        self.assertIn(('bot_web.reactions.enable', {'session_id': 'live-alpha'}), self.native.calls)
        self.assertFalse(any(m == 'prompt.submit' for m, _ in self.native.calls))

    async def test_user_reaction_uses_native_store_user_author_and_publishes_live_result(self):
        events = asyncio.Queue()
        self.native.listeners.add(events)
        result = await self.ops.invoke('chat.react', self.params)
        self.assertEqual(result['reactions'], [{'emoji': '❤️', 'author': 'user'}])
        self.assertEqual(self.native.calls[-1], ('message.react', {**self.params, 'author': 'user'}))
        self.assertEqual(await events.get(), {'type': 'message.reaction', 'session_id': 'live-alpha', 'payload': result})
        self.assertEqual((await self.ops.invoke('chat.react', {**self.params, 'emoji': None}))['reactions'], [])

    async def test_cannot_spoof_an_agent_author_or_target_another_connection_profile_or_row(self):
        for invalid in ({**self.params, 'author': 'agent'}, {**self.params, 'profile': 'ordinary'},
                        {**self.params, 'row_id': True}, {**self.params, 'row_id': '12'},
                        {**self.params, 'row_id': -1}, {**self.params, 'row_id': 2**53},
                        {**self.params, 'session_id': 'unopened'}, {**self.params, 'emoji': 'hello'},
                        {**self.params, 'emoji': '❤️\n'}, {**self.params, 'emoji': '❤️'*33}):
            with self.assertRaises(InvalidOperation):
                await self.ops.invoke('chat.react', invalid)
        self.assertFalse(any(m == 'message.react' for m, _ in self.native.calls))
        with self.assertRaises(NativeError):
            await self.ops.invoke('chat.react', {**self.params, 'row_id': 999})

    async def test_retired_profile_cannot_receive_reactions(self):
        self.native.incarnation = 'b'*64
        with self.assertRaises(InvalidOperation):
            await self.ops.invoke('chat.react', self.params)
        self.assertFalse(any(m == 'message.react' for m, _ in self.native.calls))

    def test_unicode_sequences_and_clear(self):
        for value in ('👍🏽', '❤️', '👩\u200d💻', '🇺🇸', '1️⃣'):
            self.assertEqual(emoji(value), value)
        self.assertIsNone(emoji(None, clear=True))

    def test_guidance_uses_discovery_only_when_the_native_tool_is_enabled(self):
        config = {'display': {'message_reactions': True}}
        definitions = [{'function': {'name': 'pebble_react'}}]
        server = SimpleNamespace(_load_enabled_toolsets=lambda platform: ['workspace'],
            _load_disabled_toolsets=lambda: None)
        with patch.dict(sys.modules, {
            'hermes_cli.config': SimpleNamespace(load_config_readonly=lambda: config),
            'tui_gateway': SimpleNamespace(server=server),
            'model_tools': SimpleNamespace(get_tool_definitions=lambda **kwargs: definitions),
        }):
            guidance = runtime_guidance('tui')
            self.assertIn('tool_describe(names=["pebble_react"])', guidance)
            self.assertIn('tool_call', guidance)
            self.assertIn('On each human turn', guidance)
            self.assertIn('NO_REPLY', guidance)
            self.assertIn('not automatically on every post', guidance)
            definitions.clear()
            self.assertEqual(runtime_guidance('tui'), '')
            config['display']['message_reactions'] = False
            self.assertEqual(runtime_guidance('tui'), '')
