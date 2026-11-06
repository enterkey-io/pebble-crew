import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_security import Native  # Loads the production plugin package under bot_web.
from bot_web.atmee_video import AtmeeVideo, catalog
from bot_web.live_voice import LiveVoice
from bot_web.operations import InvalidOperation
from bot_web.workspace import WorkspaceStore

CHARACTER = 'bbcb7c08-35d3-44c2-86cd-28825ed7165e'
CALL = '9c53b2f5-5c43-4b51-b553-504fa870e0e2'
KEY = 'sk_atmee_fixture-private'


class AtmeeVideoTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        root = TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.store = WorkspaceStore(Path(root.name) / 'workspace.sqlite')
        self.addCleanup(self.store.db.close)
        state = self.store.read()
        state['bots']['alpha'] = {'id': 'alpha-id', 'enrolled': True, 'available': True}
        self.store.save(state, state['revision'])
        self.ops = Mock(sessions={'sid-alpha': 'alpha'}, session_incarnations={'sid-alpha': 'alpha-stamp'},
                        session_conversations={'sid-alpha': 'alpha-chat'})
        self.ops.stamp = AsyncMock(return_value='alpha-stamp')
        self.ops.gateway.call = AsyncMock(return_value={'status': 'streaming', 'user_row_id': 7})
        self.voice = LiveVoice(self.ops, self.store)
        self.service = AtmeeVideo(self.store, self.ops, self.voice)

    def vendor(self, path, key, payload=None):
        self.assertEqual(key, KEY)
        if path == '/v1/api_keys/current':
            return {'active': True, 'scopes': ['sessions', 'avatars:read'], 'avatarId': CHARACTER}
        if path == '/v1/avatars/' + CHARACTER:
            return {'id': CHARACTER, 'name': 'Aimee', 'kind': 'conversational', 'readyToChat': True, 'private_field': KEY}
        if path == '/v1/sessions':
            self.assertEqual(payload['avatarId'], CHARACTER)
            self.assertEqual(payload['maxDurationSeconds'], 300)
            self.assertNotIn('visitorId', payload)
            self.assertEqual(payload['appTools']['tools'][0]['parameters']['properties'], {})
            return {'sessionId': CALL, 'serverUrl': 'wss://atmanity.livekit.cloud',
                    'userToken': 'temporary-livekit-ticket', 'actualDurationSeconds': 180}
        if path == '/v1/sessions/' + CALL + '/end':
            return {'alreadyEnded': False}
        self.fail(f'Unexpected vendor path: {path}')

    async def test_key_validation_and_selection_do_not_start_call(self):
        with patch('bot_web.atmee_video.provider', side_effect=self.vendor) as provider, \
                patch('bot_web.atmee_video.read_key', return_value=KEY), \
                patch('bot_web.atmee_video.save_key') as save:
            self.assertEqual(await self.service.invoke('atmee.key', {'value': KEY}), {'configured': True})
            save.assert_called_once_with(KEY)
            await self.service.invoke('atmee.select', {'bot_id': 'alpha-id', 'avatar_id': CHARACTER})
            data = await self.service.invoke('atmee.avatars', {'bot_id': 'alpha-id'})
            self.assertEqual(data['selected'], CHARACTER)
            self.assertEqual(data['avatars'], [{'id': CHARACTER, 'name': 'Aimee', 'ready': True}])
            self.assertNotIn(KEY, json.dumps(data))
            self.assertFalse(any(call.args[0] == '/v1/sessions' for call in provider.call_args_list))
        self.ops.gateway.call.assert_not_awaited()

    async def test_two_way_context_reaches_original_bot_even_without_delegation(self):
        with patch('bot_web.atmee_video.provider', side_effect=self.vendor), \
                patch('bot_web.atmee_video.read_key', return_value=KEY):
            await self.service.invoke('atmee.select', {'bot_id': 'alpha-id', 'avatar_id': CHARACTER})
            ticket = await self.service.invoke('atmee.start', {'session_id': 'sid-alpha', 'bot_id': 'alpha-id'})
            self.assertNotIn(KEY, json.dumps(ticket))
            session = {'session_id': 'sid-alpha', 'call_id': CALL}
            for speaker, line, text in [('owner', 'one', 'How about tomorrow?'), ('avatar', 'two', 'Tomorrow works.')]:
                caption = {**session, 'line_id': line, 'speaker': speaker, 'text': text}
                await self.service.invoke('atmee.caption', caption)
                await self.service.invoke('atmee.caption', caption)
            self.ops.gateway.call.assert_not_awaited()
            await self.service.invoke('atmee.end', session)
            await self.service.invoke('atmee.end', session)
            self.ops.gateway.call.assert_awaited_once()
            method, params = self.ops.gateway.call.await_args.args
            self.assertEqual((method, params['session_id'], params['display_kind']), ('prompt.submit', 'sid-alpha', 'hidden'))
            self.assertEqual(params['text'].count('How about tomorrow?'), 1)
            self.assertIn('Tomorrow works.', params['text'])
            self.assertEqual(self.voice.history('sid-alpha', (None, None))[0]['kind'], 'video')

    async def test_delegate_uses_latest_owner_words_once_and_refuses_changed_profile(self):
        with patch('bot_web.atmee_video.provider', side_effect=self.vendor), \
                patch('bot_web.atmee_video.read_key', return_value=KEY):
            await self.service.invoke('atmee.select', {'bot_id': 'alpha-id', 'avatar_id': CHARACTER})
            await self.service.invoke('atmee.start', {'session_id': 'sid-alpha', 'bot_id': 'alpha-id'})
            session = {'session_id': 'sid-alpha', 'call_id': CALL}
            await self.service.invoke('atmee.caption', {**session, 'line_id': 'user-line',
                                                       'speaker': 'owner', 'text': 'Check my next meeting.'})
            self.assertEqual((await self.service.invoke('atmee.delegate', {**session, 'line_id': 'other'}))['accepted'], False)
            result = await self.service.invoke('atmee.delegate', {**session, 'line_id': 'user-line'})
            self.assertEqual(result['user_row_id'], 7)
            self.assertEqual((await self.service.invoke('atmee.delegate', {**session, 'line_id': 'user-line'}))['accepted'], False)
            self.assertEqual(self.ops.gateway.call.await_args.args[1]['text'], 'Check my next meeting.')
            self.ops.stamp.return_value = 'different-pebble'
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('atmee.delegate', {**session, 'line_id': 'user-line'})
            await self.service.end(self.service.call)
            self.ops.gateway.call.assert_awaited_once()

    def test_catalog_stops_on_repeated_vendor_cursor(self):
        with patch('bot_web.atmee_video.provider', side_effect=[
            {'active': True, 'scopes': ['sessions', 'avatars:read']},
            {'items': [], 'nextBefore': '2026-11-05T12:34:56Z'},
            {'items': [], 'nextBefore': '2026-11-05T12:34:56Z'},
        ]):
            with self.assertRaises(InvalidOperation):
                catalog(KEY)
