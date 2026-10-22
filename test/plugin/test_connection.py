import asyncio
import unittest
from unittest.mock import AsyncMock
from test_security import Native
from bot_web.connection import Subscription, reclaimable, NativeHealth
from bot_web.operations import BotOperations

class ConnectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_bound_sessions_and_redacted_globals_enter_a_subscription(self):
        sessions = {'own'}
        queue = Subscription(sessions)
        for _ in range(1000):
            queue.put_nowait({'type': 'message.delta', 'session_id': 'other', 'payload': {'text': 'private'}})
        self.assertTrue(queue.empty())
        queue.put_nowait({'type': 'workspace.changed', 'session_id': 'other', 'payload': {'secret': 'never forward'}})
        self.assertEqual(queue.get_nowait(), {'type': 'workspace.changed'})
        sessions.add('newly-bound')
        event = {'type': 'message.delta', 'session_id': 'newly-bound', 'payload': {'text': 'allowed'}}
        queue.put_nowait(event)
        self.assertEqual(queue.get_nowait(), event)

    async def test_reclamation_preserves_inflight_operations(self):
        client = {'touched': 0, 'expires': 0, 'inflight': 1}
        self.assertFalse(reclaimable(client, 1))
        client['inflight'] = 0
        self.assertTrue(reclaimable(client, 1))

    async def test_health_probes_coalesce_without_model_calls(self):
        native = Native()
        native.call = AsyncMock(return_value={'responsive': True})
        health = NativeHealth(native)
        values = await asyncio.gather(*(health.read() for _ in range(8)))
        self.assertTrue(all(value['native'] == 'responsive' for value in values))
        native.call.assert_awaited_once_with('bot_web.connection.health', {})

    async def test_snapshot_reads_do_not_resume_or_enable_a_profile(self):
        native = Native()
        native.call = AsyncMock(return_value={'messages': [], 'running': False})
        ops = BotOperations(native)
        ops.sessions['live-alpha'] = 'alpha'
        ops.session_incarnations['live-alpha'] = 'current'
        ops.stamp = AsyncMock(return_value='current')
        result = await ops.invoke('chat.snapshot', {'session_id': 'live-alpha'})
        self.assertEqual(result['session_id'], 'live-alpha')
        native.call.assert_awaited_once_with('bot_web.conversation.snapshot', {'session_id': 'live-alpha'})

    async def test_binding_is_installed_before_snapshot_capture(self):
        native = Native()
        original = native.call
        bound = set()
        async def call(method, params):
            if method == 'bot_web.conversation.snapshot':
                self.assertIn('live-alpha', bound)
                return {'messages': [], 'running': False}
            return await original(method, params)
        native.call = call
        ops = BotOperations(native)
        await ops.invoke('bot.open', {'profile': 'alpha'}, bind=bound.add)

    async def test_changed_profile_is_a_conversation_error_not_lease_loss(self):
        from bot_web.operations import InvalidOperation
        native = Native()
        ops = BotOperations(native)
        ops.sessions['live-alpha'] = 'alpha'
        ops.session_incarnations['live-alpha'] = 'before'
        ops.stamp = AsyncMock(return_value='after')
        with self.assertRaises(InvalidOperation) as raised:
            await ops.invoke('chat.snapshot', {'session_id': 'live-alpha'})
        self.assertEqual(raised.exception.code, 'CONVERSATION_CHANGED')
