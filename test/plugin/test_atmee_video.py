import asyncio
import base64
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_security import Native  # Loads the production plugin package under bot_web.
from bot_web.atmee_video import AtmeeVideo, catalog
from bot_web.atmee_build import portrait_upload
from bot_web.live_voice import LiveVoice
from bot_web.operations import InvalidOperation
from bot_web.workspace import WorkspaceStore

CHARACTER = 'bbcb7c08-35d3-44c2-86cd-28825ed7165e'
CALL = '9c53b2f5-5c43-4b51-b553-504fa870e0e2'
KEY = 'sk_atmee_fixture-private'
REQUEST = 'ec20a4d8-4d29-4ec1-97f5-22fa53b26615'
UPLOAD = '454a83fb-d7f8-4f81-bd1d-78f9be68a2c5'


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

    async def test_storage_refusal_returns_save_failure(self):
        from contextlib import nullcontext
        from types import SimpleNamespace
        config = SimpleNamespace(save_env_value_secure=Mock(side_effect=ValueError('private path')))
        profile_scope = SimpleNamespace(_config_profile_scope=lambda profile: nullcontext())
        with patch('bot_web.atmee_video.provider', side_effect=self.vendor), \
             patch.dict('sys.modules', {'hermes_cli.config': config,
                                       'hermes_cli.web_server_profiles': profile_scope}):
            with self.assertRaises(InvalidOperation) as failure:
                await self.service.invoke('atmee.key', {'value': KEY})
        self.assertEqual(failure.exception.code, 'ATMEE_KEY_SAVE_FAILED')
        self.assertNotIn('private path', str(failure.exception))

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

    async def test_call_briefing_uses_only_selected_character_and_conversation(self):
        other_character = 'da86f31a-6dc7-405d-bb87-a63d5ecdf151'
        with self.store.db:
            for index, incarnation, conversation, avatar, text in [
                (1, 'alpha-stamp', 'alpha-chat', CHARACTER, 'Previous same-character call'),
                (2, 'alpha-stamp', 'other-chat', CHARACTER, 'Other conversation'),
                (3, 'alpha-stamp', 'alpha-chat', other_character, 'Other character'),
                (4, 'other-stamp', 'alpha-chat', CHARACTER, 'Other Pebble'),
            ]:
                ident = f'previous-{index}'
                self.store.db.execute('INSERT INTO atmee_call(id,incarnation,conversation,ended_at) VALUES(?,?,?,?)',
                                      (ident, incarnation, conversation, index))
                self.store.db.execute('INSERT INTO atmee_call_character VALUES(?,?)', (ident, avatar))
                self.store.db.execute('INSERT INTO atmee_caption(call,line,speaker,text) VALUES(?,?,?,?)',
                                      (ident, 'one', 'owner', text))
        with (
            patch('bot_web.atmee_video.provider', side_effect=self.vendor) as provider,
            patch('bot_web.atmee_video.read_key', return_value=KEY),
        ):
            await self.service.invoke('atmee.select', {'bot_id': 'alpha-id', 'avatar_id': CHARACTER})
            self.assertEqual(await self.service.invoke('atmee.context', {
                'bot_id': 'alpha-id', 'avatar_id': CHARACTER, 'note': 'Keep check-ins brief.',
            }), {'note': 'Keep check-ins brief.'})
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('atmee.context', {
                    'bot_id': 'alpha-id', 'avatar_id': other_character, 'note': 'Wrong character',
                })
            self.assertEqual((await self.service.invoke('atmee.avatars', {'bot_id': 'alpha-id'}))['note'],
                             'Keep check-ins brief.')
            ticket = await self.service.invoke('atmee.start', {'session_id': 'sid-alpha', 'bot_id': 'alpha-id'})
            self.assertIn('Keep check-ins brief.', ticket['context'])
            self.assertIn('Previous same-character call', ticket['context'])
            self.assertNotIn('Other ', ticket['context'])
            self.assertNotIn('Keep check-ins brief.', json.dumps(provider.call_args.args[2]))
            await self.service.end(self.service.call, deliver=False)

    def test_catalog_stops_on_repeated_vendor_cursor(self):
        with patch('bot_web.atmee_video.provider', side_effect=[
            {'active': True, 'scopes': ['sessions', 'avatars:read']},
            {'items': [], 'nextBefore': '2026-11-05T12:34:56Z'},
            {'items': [], 'nextBefore': '2026-11-05T12:34:56Z'},
        ]):
            with self.assertRaises(InvalidOperation):
                catalog(KEY)

    def portrait(self):
        from PIL import Image
        raster = io.BytesIO()
        Image.new('RGB', (32, 64), 'red').save(raster, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(raster.getvalue()).decode()

    async def test_build_carries_reviewed_inputs_and_resumes_from_its_receipt(self):
        scopes = ['sessions', 'avatars:read', 'avatars:write', 'generation:write']
        create_params = {'bot_id': 'alpha-id', 'request_id': REQUEST, 'name': 'Aurora',
                         'persona': 'Aurora is a chief of staff.', 'voice_style': 'composed', 'photo': self.portrait()}
        calls = []
        def vendor(path, key, payload=None, *, idempotency=None):
            self.assertEqual(key, KEY)
            calls.append(path)
            if path == '/v1/api_keys/current':
                return {'active': True, 'scopes': scopes}
            if path == '/v1/account':
                return {'v2Access': 'granted', 'limits': {'v2Resolutions': [{'width': 384, 'height': 672}]}}
            if path == '/v1/generation/voices':
                self.assertEqual(idempotency, REQUEST)
                self.assertIn('Composed', payload['voiceDescription'])
                self.assertNotIn('chief of staff', json.dumps(payload))
                return {'voices': [{'upload': 'upload:' + UPLOAD}]}
            if path == '/v1/avatars':
                self.assertEqual(payload['persona'], {'whoPrompt': create_params['persona']})
                self.assertEqual(payload['visibility'], 'private')
                self.assertEqual(payload['engine'], 'v2')
                self.assertEqual(payload['resolution'], {'width': 384, 'height': 672})
                self.assertEqual(payload['assets']['voice']['url'], 'upload:' + UPLOAD)
                return {'avatarId': CHARACTER, 'kind': 'conversational', 'status': 'building',
                        'statusUrl': '/v1/avatars/' + CHARACTER}
            if path == '/v1/avatars/' + CHARACTER:
                return {'id': CHARACTER, 'readyToChat': True}
            self.fail(path)

        with (
            patch('bot_web.atmee_video.read_key', return_value=KEY),
            patch('bot_web.atmee_video.provider', side_effect=vendor),
            patch('bot_web.atmee_build.portrait_upload', return_value='upload:' + CALL) as upload,
        ):
            first = await self.service.invoke('atmee.build.start', create_params)
            self.assertEqual(first['build']['state'], 'preparing')
            self.assertEqual(await self.service.invoke('atmee.build.start', create_params), first)
            await asyncio.gather(*self.service.builds.tasks)
            reopened = AtmeeVideo(self.store, self.ops, self.voice)
            reopened.recover()
            ready = await reopened.invoke('atmee.build.status', {'bot_id': 'alpha-id'})
            self.assertEqual(ready['build']['avatar'], CHARACTER)
            self.assertEqual(ready['build']['state'], 'ready')
            self.assertEqual(await reopened.invoke('atmee.build.start', create_params), ready)
            upload.assert_called_once()
            self.assertEqual(calls.count('/v1/generation/voices'), 1)
            self.assertEqual(calls.count('/v1/avatars'), 1)
        self.ops.gateway.call.assert_not_awaited()

    async def test_voice_design_reuses_its_receipt_and_passes_the_selected_sample(self):
        scopes = ['sessions', 'avatars:read', 'avatars:write', 'generation:write']
        design = {'bot_id': 'alpha-id', 'request_id': REQUEST, 'name': 'Aurora',
                  'description': 'Warm, articulate voice at a measured pace.'}
        selection = {'kind': 'designed', 'id': REQUEST, 'index': 1}
        generated = []
        def vendor(path, key, payload=None, *, idempotency=None):
            if path == '/v1/api_keys/current':
                return {'active': True, 'scopes': scopes}
            if path == '/v1/generation/voices':
                generated.append(idempotency)
                self.assertEqual(payload['voiceDescription'], design['description'])
                return {'voices': [
                    {'upload': 'upload:' + CALL, 'url': 'https://assets.atmee.ai/first.mp3'},
                    {'upload': 'upload:' + UPLOAD, 'url': 'https://assets.atmee.ai/second.mp3'}]}
            if path == '/v1/account':
                return {'v2Access': 'granted'}
            if path == '/v1/avatars':
                self.assertEqual(payload['assets']['voice']['url'], 'upload:' + UPLOAD)
                return {'avatarId': CHARACTER, 'kind': 'conversational', 'status': 'building'}
            self.fail(path)
        with (patch('bot_web.atmee_video.read_key', return_value=KEY),
              patch('bot_web.atmee_video.provider', side_effect=vendor),
              patch('bot_web.atmee_build.portrait_upload', return_value='upload:' + CALL),
              patch('bot_web.atmee_build.fetch_voice_sample', return_value={'audio': 'audio'}) as sample):
            pending = await self.service.invoke('atmee.voice.design', design)
            self.assertEqual(pending['design']['state'], 'pending')
            await asyncio.gather(*self.service.builds.tasks)
            reopened = AtmeeVideo(self.store, self.ops, self.voice)
            reopened.recover()
            ready = await reopened.invoke('atmee.voice.status', {'bot_id': 'alpha-id'})
            self.assertEqual(ready, await reopened.invoke('atmee.voice.design', design))
            self.assertEqual(ready['design']['count'], 2)
            self.assertNotIn('https', json.dumps(ready))
            await reopened.invoke('atmee.voice.sample', {'bot_id': 'alpha-id', 'voice': selection})
            sample.assert_called_once_with('https://assets.atmee.ai/second.mp3')
            await reopened.invoke('atmee.build.start', {'bot_id': 'alpha-id', 'request_id': CALL,
                'name': 'Aurora', 'persona': 'Approved', 'voice': selection, 'photo': self.portrait()})
            await asyncio.gather(*reopened.builds.tasks)
            self.assertEqual(generated, [REQUEST])

    async def test_existing_avatar_voice_can_be_reused_without_generation_access(self):
        def vendor(path, key, payload=None, **kwargs):
            if path == '/v1/api_keys/current':
                return {'active': True, 'scopes': ['sessions', 'avatars:read', 'avatars:write']}
            if path == '/v1/account':
                return {'v2Access': 'granted'}
            if path == '/v1/avatars/' + CHARACTER + '/voice':
                return {'url': 'https://assets.atmee.ai/existing.wav?token=fixture'}
            if path == '/v1/avatars':
                self.assertEqual(payload['assets']['voice']['url'], 'https://assets.atmee.ai/existing.wav?token=fixture')
                return {'avatarId': CHARACTER, 'kind': 'conversational', 'status': 'building'}
            self.fail(path)
        with (patch('bot_web.atmee_video.read_key', return_value=KEY),
              patch('bot_web.atmee_video.provider', side_effect=vendor),
              patch('bot_web.atmee_build.portrait_upload', return_value='upload:' + CALL)):
            await self.service.invoke('atmee.build.start', {'bot_id': 'alpha-id', 'request_id': REQUEST,
                'name': 'Aurora', 'persona': 'Approved', 'photo': self.portrait(),
                'voice': {'kind': 'existing', 'id': CHARACTER}})
            await asyncio.gather(*self.service.builds.tasks)
            self.assertEqual(self.store.db.execute('SELECT state FROM atmee_build').fetchone()[0], 'building')

    async def test_create_timeout_never_replays_the_vendor_create(self):
        with self.store.db:
            self.store.db.execute("INSERT INTO atmee_build VALUES(?,?,?,?,?,NULL,NULL,0)",
                                  (REQUEST, 'alpha-id', 'unneeded', 'Aurora', 'creating'))
        self.service.recover()
        status = self.store.db.execute('SELECT state,error FROM atmee_build WHERE id=?', (REQUEST,)).fetchone()
        self.assertEqual(status[0], 'uncertain')
        self.assertIn('before starting another', status[1])

    def test_presigned_upload_validates_its_destination_and_omits_api_key(self):
        ticket = {'uploadId': UPLOAD, 'uploadHeaders': {'Content-Type': 'image/png'}}
        with (
            patch('bot_web.atmee_video.provider', return_value={**ticket, 'uploadUrl': 'https://127.0.0.1/image'}),
            patch('bot_web.atmee_build.build_opener') as opener,
        ):
            with self.assertRaises(InvalidOperation):
                portrait_upload(KEY, self.portrait())
            opener.assert_not_called()
        with (
            patch('bot_web.atmee_video.provider', side_effect=[{**ticket,
                'uploadUrl': 'https://atmee.s3.amazonaws.com/image?signature=fixture'}, {'status': 'uploaded'}]),
            patch('bot_web.atmee_build.build_opener') as opener,
        ):
            self.assertEqual(portrait_upload(KEY, self.portrait()), 'upload:' + UPLOAD)
            put = opener.return_value.open.call_args.args[0]
            self.assertEqual(put.method, 'PUT')
            self.assertEqual({key.lower(): value for key, value in put.header_items()}, {'content-type': 'image/png'})
