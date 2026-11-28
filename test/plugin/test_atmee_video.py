import asyncio
import base64
import io
import json
import socket
from email.message import Message
from urllib.error import HTTPError
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_security import Native  # Loads the production plugin package under bot_web.
from bot_web.atmee_video import AtmeeVideo, VoiceDesignFailure, catalog, provider
from bot_web.atmee_build import PreviewConnection, fetch_voice_sample, portrait_upload, storage_url, video_account
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
        self.ops.invoke = AsyncMock(return_value={'messages': []})
        self.ops.gateway.call = AsyncMock(return_value={'status': 'streaming', 'user_row_id': 7})
        self.voice = LiveVoice(self.ops, self.store)
        self.service = AtmeeVideo(self.store, self.ops, self.voice)

    def vendor(self, path, key, payload=None, **kwargs):
        self.assertEqual(key, KEY)
        if path == '/v1/api_keys/current':
            return {'active': True, 'scopes': ['sessions', 'avatars:read'], 'avatarId': CHARACTER}
        if path == '/v1/avatars/' + CHARACTER:
            return {'id': CHARACTER, 'name': 'Aimee', 'kind': 'conversational', 'readyToChat': True, 'private_field': KEY}
        if path == '/v1/avatar_sessions':
            self.assertEqual(payload, {'avatarId': CHARACTER})
            return {'sessionId': CALL, 'livekitUrl': 'wss://atmanity.livekit.cloud',
                    'agentToken': 'server-side-livekit-ticket', 'maxDurationSeconds': 3600,
                    'avatarParticipantIdentity': 'atmee-avatar-agent'}
        if path == '/v1/avatar_sessions/' + CALL + '/end':
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
            self.assertFalse(any(call.args[0] == '/v1/avatar_sessions' for call in provider.call_args_list))
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

    async def test_slow_setup_returns_a_coded_failure_before_proxies_give_up(self):
        relay = Mock(closed=asyncio.Event(), connect=AsyncMock(), close=AsyncMock())
        async def slow_voice(operation, params, **options):
            await asyncio.sleep(5)
        with (
            patch('bot_web.atmee_video.provider', side_effect=self.vendor) as provider,
            patch('bot_web.atmee_video.read_key', return_value=KEY),
            patch('bot_web.atmee_video.START_BUDGET', 2.3),
            patch('bot_web.atmee_media.dependencies', return_value=(None, None)),
            patch('bot_web.atmee_media.Relay', return_value=relay),
            patch.object(self.voice, 'invoke', side_effect=slow_voice),
        ):
            await self.service.invoke('atmee.select', {'bot_id': 'alpha-id', 'avatar_id': CHARACTER})
            with self.assertRaises(InvalidOperation) as failure:
                await self.service.invoke('atmee.start', {'session_id': 'sid-alpha', 'bot_id': 'alpha-id',
                                                          'mode': 'hermes-provider-duration'})
        self.assertEqual(failure.exception.code, 'ATMEE_UNAVAILABLE')
        self.assertFalse(any(call.args[0] == '/v1/avatar_sessions' for call in provider.call_args_list))
        self.assertIsNone(self.service.call)
        self.assertFalse(self.service.starting)

    async def test_renderer_receives_no_persona_and_turn_uses_only_selected_bot(self):
        relay = Mock(closed=asyncio.Event(), connect=AsyncMock(), close=AsyncMock())
        async def voice_start(operation, params, **options):
            self.assertEqual((operation, params), ('voice.start', {'session_id': 'sid-alpha'}))
            # Video always speaks through ElevenLabs, whatever the audio-call choice.
            self.assertEqual(options, {'video': True})
            return {'call_id': self.voice.spoken.begin('sid-alpha', 'synthetic_voice'),
                    'token': 'speech-transcription-ticket'}
        with (
            patch('bot_web.atmee_video.provider', side_effect=self.vendor) as provider,
            patch('bot_web.atmee_video.read_key', return_value=KEY),
            patch('bot_web.atmee_media.dependencies', return_value=(None, None)),
            patch('bot_web.atmee_media.Relay', return_value=relay),
            patch.object(self.voice, 'invoke', side_effect=voice_start),
            patch.object(self.voice.spoken, 'submit', AsyncMock(return_value={'state': 'pending'})) as submit,
        ):
            await self.service.invoke('atmee.select', {'bot_id': 'alpha-id', 'avatar_id': CHARACTER})
            start = {'session_id': 'sid-alpha', 'bot_id': 'alpha-id'}
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('atmee.start', start)
            with self.assertRaises(InvalidOperation) as old_client:
                await self.service.invoke('atmee.start', {**start, 'mode': 'hermes'})
            self.assertEqual(old_client.exception.code, 'UPDATE_REQUIRED')
            self.assertFalse(any(call.args[0] == '/v1/avatar_sessions' for call in provider.call_args_list))
            ticket = await self.service.invoke('atmee.start', {**start, 'mode': 'hermes-provider-duration'})
            self.assertEqual(ticket, {'id': CALL, 'duration': 3600,
                                      'transcription_token': 'speech-transcription-ticket'})
            relay.connect.assert_awaited_once()
            url, token, budget = relay.connect.await_args.args
            self.assertEqual((url, token), ('wss://atmanity.livekit.cloud', 'server-side-livekit-ticket'))
            self.assertLessEqual(budget, 18)
            from time import time
            later = int(time()) + 31 * 60
            with patch('bot_web.spoken_turns.time.time', return_value=later):
                self.assertEqual(self.voice.spoken.voice('sid-alpha', self.service.call.voice_id), 'synthetic_voice')
            session = {'session_id': 'sid-alpha', 'call_id': CALL}
            result = await self.service.invoke('atmee.utterance', {
                **session, 'utterance_id': REQUEST, 'text': 'What can you see?', 'camera_frame': 'ZmFrZQ==',
            })
            self.assertEqual(result, {'state': 'pending'})
            submit.assert_awaited_once_with('sid-alpha', {
                'session_id': 'sid-alpha', 'call_id': self.service.call.voice_id,
                'utterance_id': REQUEST, 'text': 'What can you see?',
            }, frame='ZmFrZQ==')
            self.ops.stamp.return_value = 'different-pebble'
            with self.assertRaises(InvalidOperation):
                await self.service.invoke('atmee.utterance', {
                    **session, 'utterance_id': REQUEST, 'text': 'Who are you?', 'camera_frame': None,
                })
            self.ops.stamp.return_value = 'alpha-stamp'
            with patch.object(self.voice.spoken, 'end', return_value=True), \
                    patch.object(self.voice, 'follow_up', AsyncMock(return_value=True)) as follow_up:
                await self.service.invoke('atmee.end', session)
                await self.service.invoke('atmee.end', session)
            # A call with a conversation gets exactly one closing message.
            follow_up.assert_awaited_once_with('sid-alpha')
            relay.close.assert_awaited_once()
            ends = [call for call in provider.call_args_list if call.args[0].endswith('/end')]
            self.assertEqual(len(ends), 1)
            self.assertEqual(self.voice.history('sid-alpha', (None, None))[0]['kind'], 'video')
        self.ops.gateway.call.assert_not_awaited()

    async def test_renderer_sends_only_pcm_to_the_renderer_identity(self):
        from bot_web.atmee_media import Relay
        from types import SimpleNamespace
        write = AsyncMock()
        writer = SimpleNamespace(write=write, aclose=AsyncMock())
        playback_finished = asyncio.Event()
        async def stream_bytes(*_args, **_kwargs):
            playback_finished.set()
            return writer
        stream_bytes = AsyncMock(side_effect=stream_bytes)
        relay = SimpleNamespace(
            room=SimpleNamespace(local_participant=SimpleNamespace(stream_bytes=stream_bytes)),
            playback_finished=playback_finished, avatar='atmee-avatar-agent',
            generation=4, closed=asyncio.Event(),
        )
        pcm = bytes(range(256)) * 20
        audio = io.BytesIO(pcm)
        await Relay.say(relay, audio, 4)
        stream_bytes.assert_awaited_once_with('Speech audio', topic='lk.audio_stream',
            destination_identities=['atmee-avatar-agent'], attributes={'sample_rate': '16000', 'num_channels': '1'})
        self.assertEqual(b''.join(call.args[0] for call in write.await_args_list), pcm)
        self.assertTrue(audio.closed)
        writer.aclose.assert_awaited_once()

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
                    {'upload': 'upload:' + UPLOAD, 'url': 'https://voice-assets.example.net/second.mp3?signature=one%2Btwo'}]}
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
            sample.assert_called_once_with('https://voice-assets.example.net/second.mp3?signature=one%2Btwo')
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

    def test_upload_targets_allow_atmee_storage_without_allowing_other_supabase_projects(self):
        url = 'https://fpgwbdmvvurxnanvxjld.supabase.co/storage/v1/object/upload/sign/assets/test?token=fixture'
        self.assertEqual(storage_url(url), url)
        for host in ('other-project.supabase.co', 'fpgwbdmvvurxnanvxjld.supabase.co.example.net',
                     'sub.fpgwbdmvvurxnanvxjld.supabase.co'):
            with self.subTest(host=host), self.assertRaises(ValueError):
                storage_url('https://' + host + '/upload?token=fixture')

    def test_preview_rejects_non_public_dns_before_connecting(self):
        private_addresses = ('127.0.0.1', '100.64.0.1', '169.254.169.254', '224.0.0.1',
                             '::ffff:127.0.0.1', '64:ff9b::a00:1')
        for address in private_addresses:
            with self.subTest(address=address):
                connection = PreviewConnection('voice-assets.example.net', timeout=15)
                answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.1.1.1', 443)),
                           (socket.AF_INET6, socket.SOCK_STREAM, 6, '', (address, 443, 0, 0))]
                with (patch('bot_web.atmee_build.socket.getaddrinfo', return_value=answers),
                      patch('bot_web.atmee_build.socket.socket') as dial):
                    with self.assertRaises(ValueError):
                        connection.connect()
                    dial.assert_not_called()

    def test_preview_checks_tls_name_and_uses_the_checked_socket_address(self):
        address = ('1.1.1.1', 443)
        connection = PreviewConnection('voice-assets.example.net', timeout=15)
        dns = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', address)]
        with (patch('bot_web.atmee_build.socket.getaddrinfo', return_value=dns) as resolve,
              patch('bot_web.atmee_build.socket.socket') as dial,
              patch.object(connection._context, 'wrap_socket') as tls):
            connection.connect()
            transport = dial.return_value.__enter__.return_value
            resolve.assert_called_once_with('voice-assets.example.net.', 443, type=socket.SOCK_STREAM)
            transport.connect.assert_called_once_with(address)
            tls.assert_called_once_with(transport, server_hostname='voice-assets.example.net')

    def test_preview_never_follows_a_redirect_or_accepts_html(self):
        url = 'https://voice-assets.example.net/sample.mp3?signature=one%2Btwo'
        for status, mime in ((302, 'audio/mpeg'), (200, 'text/html')):
            with self.subTest(status=status, mime=mime):
                with patch('bot_web.atmee_build.PreviewConnection') as connect:
                    connection = connect.return_value
                    response = connection.getresponse.return_value.__enter__.return_value
                    response.status = status
                    response.headers.get_content_type.return_value = mime
                    with self.assertRaises(InvalidOperation):
                        fetch_voice_sample(url)
                    connect.assert_called_once_with('voice-assets.example.net', timeout=15)
                    connection.request.assert_called_once_with('GET', '/sample.mp3?signature=one%2Btwo')
                    response.read.assert_not_called()
                    connection.close.assert_called_once()

    def test_voice_errors_preserve_safe_provider_reason_and_retry_delay(self):
        for status, mime, body, code in (
            (403, 'text/html', b'<html>Cloudflare private diagnostics</html>', 'ATMEE_VOICE_EDGE_BLOCKED'),
            (400, 'application/json', b'{"error":"moderation_flagged","message":"private diagnostics"}', 'ATMEE_VOICE_MODERATED'),
            (409, 'application/json', b'{"error":"request_in_progress"}', 'ATMEE_VOICE_BUSY'),
            (502, 'application/json', b'{"error":"provider_failed"}', 'ATMEE_VOICE_PROVIDER_FAILED'),
        ):
            headers = Message()
            headers['Content-Type'] = mime
            headers['Retry-After'] = '5'
            opener = Mock()
            opener.open.side_effect = HTTPError('https://api.atmanity.us', status, '', headers, io.BytesIO(body))
            with patch('bot_web.atmee_video.build_opener', return_value=opener):
                with self.assertRaises(VoiceDesignFailure) as failure:
                    provider('/v1/generation/voices', KEY, {}, idempotency=REQUEST)
            self.assertEqual(failure.exception.code, code)
            self.assertNotIn('private diagnostics', str(failure.exception))
            self.assertEqual(failure.exception.retry_after, 5 if status == 409 else None)

    def test_v2_balance_takes_precedence_over_invitation_flag(self):
        account = {'plan': {'code': 'growth'}, 'v2Access': 'invite_required'}
        with patch('bot_web.atmee_video.provider', side_effect=[account, {'v2SpendableMicrocredits': 100}]):
            self.assertIs(video_account(KEY), account)
        with patch('bot_web.atmee_video.provider', side_effect=[account, {'v2SpendableMicrocredits': 0}]):
            with self.assertRaises(InvalidOperation) as failure:
                video_account(KEY)
        self.assertEqual(failure.exception.code, 'ATMEE_BUILD_CREDITS')

    async def test_recording_creates_avatar_without_a_voice_generation_request(self):
        wave = b'RIFF' + b'0000' + b'WAVEaudio'
        def vendor(path, key, payload=None, **kwargs):
            if path == '/v1/api_keys/current':
                return {'active': True, 'scopes': ['sessions', 'avatars:read', 'avatars:write']}
            if path == '/v1/account':
                return {'v2Access': 'granted'}
            if path == '/v1/avatars':
                self.assertEqual(payload['assets']['voice']['url'], 'upload:' + UPLOAD)
                return {'avatarId': CHARACTER, 'kind': 'conversational', 'status': 'building'}
            self.fail(path)
        params = {'bot_id': 'alpha-id', 'request_id': REQUEST, 'name': 'Aurora',
                  'persona': 'Approved', 'photo': self.portrait(),
                  'voice': {'kind': 'recording', 'data': 'data:audio/wav;base64,' + base64.b64encode(wave).decode()}}
        with (patch('bot_web.atmee_video.read_key', return_value=KEY),
              patch('bot_web.atmee_video.provider', side_effect=vendor),
              patch('bot_web.atmee_build.portrait_upload', return_value='upload:' + CALL),
              patch('bot_web.atmee_build.media_upload', return_value='upload:' + UPLOAD) as upload):
            await self.service.invoke('atmee.build.recording', params)
            await asyncio.gather(*self.service.builds.tasks)
            upload.assert_called_once_with(KEY, 'voice', 'audio/wav', wave)
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
