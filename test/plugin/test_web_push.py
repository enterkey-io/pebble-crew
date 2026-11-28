import asyncio
import base64
import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

import test_security  # noqa: F401  (puts bot_web on the path)
from bot_web import web_push
from bot_web.operations import InvalidOperation
from bot_web.web_push import WebPush, allowed_endpoint, encrypt
from bot_web.workspace import WorkspaceStore

APPLE = 'https://web.push.apple.com/QGuQyavXutnMH8j6jiE6Gi'


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


class Device:
    """A browser's push keys, able to decrypt what it receives."""
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.public = self.key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.auth = b'0123456789abcdef'

    def decrypt(self, body):
        salt, (rs, idlen) = body[:16], struct.unpack('!IB', body[16:21])
        sender, cipher = body[21:21 + idlen], body[21 + idlen:]
        self.assertion = rs
        shared = self.key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender))
        ikm = HKDF(hashes.SHA256(), 32, self.auth, b'WebPush: info\x00' + self.public + sender).derive(shared)
        key = HKDF(hashes.SHA256(), 16, salt, b'Content-Encoding: aes128gcm\x00').derive(ikm)
        nonce = HKDF(hashes.SHA256(), 12, salt, b'Content-Encoding: nonce\x00').derive(ikm)
        plain = AESGCM(key).decrypt(nonce, cipher, None)
        assert plain.endswith(b'\x02')
        return json.loads(plain[:-1])

    def params(self, endpoint=APPLE):
        return {'endpoint': endpoint, 'p256dh': b64(self.public), 'auth': b64(self.auth)}


class EncryptionTests(unittest.TestCase):
    def test_only_the_device_can_read_an_alert(self):
        device = Device()
        body = encrypt(b'{"title":"Arlo","body":"Done."}', device.public, device.auth)
        self.assertEqual(device.decrypt(body), {'title': 'Arlo', 'body': 'Done.'})
        self.assertNotIn(b'Done', body)

    def test_encryption_matches_the_rfc_8291_example(self):
        def d(text):
            return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
        sender = ec.derive_private_key(int.from_bytes(d('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), 'big'), ec.SECP256R1())
        body = encrypt(b'When I grow up, I want to be a watermelon',
                       d('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
                       d('BTBZMqHH6r4Tts7J_aSIgg'), local=sender, salt=d('DGv6ra1nlYgDCS1FRnbzlw'))
        self.assertEqual(b64(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')

    def test_alerts_go_only_to_browser_push_services(self):
        for endpoint in (APPLE, 'https://fcm.googleapis.com/fcm/send/abc',
                         'https://updates.push.services.mozilla.com/wpush/v2/x',
                         'https://wns2-par02p.notify.windows.com/w/?token=x'):
            self.assertTrue(allowed_endpoint(endpoint), endpoint)
        for endpoint in ('http://web.push.apple.com/x', 'https://evil.example/web.push.apple.com',
                         'https://push.apple.com.evil.example/x', 'https://127.0.0.1/x',
                         'https://user:pw@web.push.apple.com/x', 'https://web.push.apple.com:8443/x', None):
            self.assertFalse(allowed_endpoint(endpoint), endpoint)


class AlertTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        root = TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.store = WorkspaceStore(Path(root.name) / 'workspace.sqlite')
        self.addCleanup(self.store.db.close)
        self.rows = {'arlo': {'profile': 'arlo', 'name': 'Arlo', 'cursor': 4}}
        self.ops = SimpleNamespace(
            sessions={'live-arlo': 'arlo'},
            bot=AsyncMock(side_effect=lambda profile: {'name': profile}),
            summary=lambda row: {'name': self.rows[row['name']]['name']},
            invoke=AsyncMock(side_effect=lambda op, params: {'bots': list(self.rows.values())}))
        self.native = SimpleNamespace(listeners=set())
        self.push = WebPush(self.store, self.ops, self.native, 'https://crew.example.test')
        self.device = Device()
        self.posts = []

        opener = SimpleNamespace(open=lambda req, timeout: _Response(self, req))
        patcher = patch('bot_web.web_push.urllib.request.build_opener', return_value=opener)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.status = 201

    def received(self):
        return [self.device.decrypt(req.data) for req in self.posts]

    async def test_subscribing_confirms_with_a_first_alert_and_keeps_the_key(self):
        config = await self.push.invoke('push.config', {})
        self.assertEqual(len(base64.urlsafe_b64decode(config['public_key'] + '=')), 65)
        self.assertEqual((await self.push.invoke('push.subscribe', self.device.params()))['devices'], 1)
        self.assertEqual(self.received(), [{'title': 'Pebble Crew', 'body': 'Alerts are on for new messages.',
                                            'tag': 'pebble-alerts'}])
        headers = dict(self.posts[0].header_items())
        self.assertEqual(headers['Content-encoding'], 'aes128gcm')
        self.assertNotIn('Topic', headers)  # Apple refused it with BadWebPushTopic.
        self.assertTrue(headers['Authorization'].startswith('vapid t='))
        self.assertIn('k=' + config['public_key'], headers['Authorization'])
        token = headers['Authorization'].split('t=')[1].split(',')[0]
        claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
        self.assertEqual((claims['aud'], claims['sub']), ('https://web.push.apple.com', 'https://crew.example.test'))
        self.assertEqual((await self.push.invoke('push.config', {}))['public_key'], config['public_key'])

    async def test_refused_devices_and_bad_keys_are_not_saved(self):
        with self.assertRaises(InvalidOperation):
            await self.push.invoke('push.subscribe', self.device.params('https://evil.example/x'))
        with self.assertRaises(InvalidOperation):
            await self.push.invoke('push.subscribe', {**self.device.params(), 'auth': 'short'})
        self.status = 403
        with self.assertRaises(InvalidOperation) as refused:
            await self.push.invoke('push.subscribe', self.device.params())
        self.assertEqual(refused.exception.code, 'PUSH_REFUSED')
        self.assertEqual(refused.exception.reason, '403 BadJwtToken')
        self.assertEqual(self.push.devices(), [])

    async def test_a_finished_reply_alerts_with_the_pebble_and_its_text_only_when_out_of_view(self):
        await self.push.invoke('push.subscribe', self.device.params())
        self.posts.clear()
        await self.push.invoke('push.presence', {'visible': True})
        reply = {'type': 'message.complete', 'session_id': 'live-arlo', 'payload': {'text': 'Three tasks\n are open.'}}
        await self.push.reply(reply)
        self.assertEqual(self.posts, [])
        await self.push.invoke('push.presence', {'visible': False})
        await self.push.reply(reply)
        await self.push.reply({**reply, 'payload': {'text': ''}})
        await self.push.reply({**reply, 'payload': {'text': 'x', 'status': 'error'}})
        await self.push.reply({**reply, 'session_id': 'unknown'})
        await self.push.reply({**reply, 'payload': {'text': 'NO_REPLY'}})
        await self.push.reply({**reply, 'payload': {'text': '[PEBBLE_NO_REPLY]'}})
        self.assertEqual(self.received(), [{'title': 'Arlo', 'body': 'Three tasks are open.',
                                            'profile': 'arlo', 'tag': 'arlo'}])
        await self.push.reply({**reply, 'payload': {'text': 'word ' * 100}})
        body = self.received()[-1]['body']
        self.assertLessEqual(len(body), web_push.BODY_LIMIT + 1)
        self.assertTrue(body.endswith('…'))

    async def test_messages_without_a_reply_event_alert_once_and_owner_messages_do_not(self):
        now = [1000.0]
        self.push.clock = lambda: now[0]

        async def check(advance=web_push.CHECK_SECONDS):
            now[0] += advance
            await self.push.check_roster()

        await self.push.invoke('push.subscribe', self.device.params())
        self.posts.clear()
        await check()  # First look only learns the counts.
        self.rows['arlo']['cursor'] = 5
        await check()
        self.assertEqual(self.posts, [])  # Waits one check for a reply event.
        await check()
        self.assertEqual(self.received(), [{'title': 'Arlo', 'body': 'New message from Arlo',
                                            'profile': 'arlo', 'tag': 'arlo'}])
        self.posts.clear()
        await check(600)
        self.push.owner_sent('live-arlo')
        self.rows['arlo']['cursor'] = 6
        await check()
        await check()
        self.assertEqual(self.posts, [])

    async def test_a_reply_alerts_once_whichever_arrives_first(self):
        now = [1000.0]
        self.push.clock = lambda: now[0]
        await self.push.invoke('push.subscribe', self.device.params())
        await self.push.check_roster()
        self.posts.clear()
        reply = {'type': 'message.complete', 'session_id': 'live-arlo', 'payload': {'text': 'Done.'}}
        # The roster moves before the reply event lands.
        self.rows['arlo']['cursor'] = 5
        now[0] += 30
        await self.push.check_roster()
        now[0] += 5
        await self.push.reply(reply)
        now[0] += 30
        await self.push.check_roster()
        # The reply event lands before the roster moves.
        now[0] += 600
        await self.push.reply(reply)
        self.rows['arlo']['cursor'] = 6
        now[0] += 30
        await self.push.check_roster()
        now[0] += 30
        await self.push.check_roster()
        self.assertEqual([alert['body'] for alert in self.received()], ['Done.', 'Done.'])

    async def test_a_window_in_view_on_one_device_holds_alerts_for_every_device(self):
        await self.push.invoke('push.subscribe', self.device.params())
        self.posts.clear()
        reply = {'type': 'message.complete', 'session_id': 'live-arlo', 'payload': {'text': 'Done.'}}
        await self.push.invoke('push.presence', {'visible': True}, 'desktop')
        await self.push.invoke('push.presence', {'visible': True}, 'phone')
        await self.push.invoke('push.presence', {'visible': False}, 'phone')
        await self.push.reply(reply)
        self.assertEqual(self.posts, [])
        await self.push.invoke('push.presence', {'visible': False}, 'desktop')
        await self.push.reply(reply)
        self.assertEqual(len(self.posts), 1)
        # A window that stops reporting (closed lid, lost network) stops holding alerts.
        await self.push.invoke('push.presence', {'visible': True}, 'desktop')
        self.push.viewers['desktop'] = 0
        await self.push.reply(reply)
        self.assertEqual(len(self.posts), 2)

    async def test_one_signed_token_is_reused_for_an_hour(self):
        first = self.push._authorization(APPLE)
        self.assertEqual(self.push._authorization(APPLE + '/other'), first)
        self.assertNotEqual(self.push._authorization('https://fcm.googleapis.com/x'), first)

    async def test_withdrawn_devices_are_forgotten(self):
        await self.push.invoke('push.subscribe', self.device.params())
        self.status = 410
        await self.push.send({'title': 'x', 'body': 'y'})
        self.assertEqual(self.push.devices(), [])

    async def test_watch_hands_reply_events_to_alerts_and_survives_a_resync(self):
        await self.push.invoke('push.subscribe', self.device.params())
        self.posts.clear()
        task = asyncio.create_task(self.push.watch())
        for _ in range(50):
            await asyncio.sleep(0.01)
            if self.native.listeners:
                break
        queue, = self.native.listeners
        self.native.listeners.clear()  # The gateway dropped listeners after a disconnect.
        queue.put_nowait({'type': 'bridge.resync'})
        queue.put_nowait({'type': 'message.complete', 'session_id': 'live-arlo', 'payload': {'text': 'Hi.'}})
        for _ in range(100):
            await asyncio.sleep(0.01)
            if self.posts:
                break
        task.cancel()
        self.assertEqual(self.received()[-1]['body'], 'Hi.')
        self.assertEqual(len(self.native.listeners), 1)


class _Response:
    def __init__(self, test, req):
        test.posts.append(req)
        self.test = test
        if test.status >= 400:
            import io
            import urllib.error
            raise urllib.error.HTTPError(req.full_url, test.status, 'refused', {},
                                         io.BytesIO(b'{"reason":"BadJwtToken"}'))

    def __enter__(self):
        return SimpleNamespace(status=self.test.status)

    def __exit__(self, *args):
        return None
