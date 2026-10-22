import json
import time
import uuid
import unittest
from unittest.mock import patch
import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from test_security import TOKEN, ORIGIN, HOST, Native
from bot_web.server import create_app
from bot_web.trust import OwnerTrust
import httpx


class OwnerTrustTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.binding = {'schema': 1, 'issuer': ORIGIN, 'origin': ORIGIN, 'audience': str(uuid.uuid4()), 'key_id': 'owner-key',
            'public_key': json.loads(jwt.algorithms.OKPAlgorithm.to_jwk(self.key.public_key()))}
        self.trust = OwnerTrust(self.binding)
        self.subject = str(uuid.uuid4())
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(TOKEN, {ORIGIN}, {HOST}, Native(), trust=self.trust)), base_url='https://'+HOST)

    async def asyncTearDown(self):
        await self.http.aclose()

    def ticket(self, **changes):
        now = int(time.time())
        claims = {'iss': ORIGIN, 'aud': self.binding['audience'], 'origin': ORIGIN, 'scope': 'workspace.owner', 'sub': self.subject,
            'iat': now, 'exp': now+300, 'sid': 'a'*64, 'jti': str(uuid.uuid4()), **changes}
        return jwt.encode(claims, self.key, algorithm='EdDSA', headers={'kid': 'owner-key', 'typ': 'JWT'})

    async def test_persistent_enrollment_accepts_new_ticket_after_restart(self):
        headers = {'Origin': ORIGIN, 'Authorization': 'Bearer '+self.ticket()}
        first = await self.http.post('/v1/connect', headers=headers)
        self.assertEqual(first.status_code, 200)
        lease = first.json()['connection']
        renewed = await self.http.post('/v1/renew', headers={**headers, 'Authorization': 'Bearer '+self.ticket(), 'X-Bot-Connection': lease})
        self.assertEqual(renewed.status_code, 200)
        restarted = OwnerTrust(json.loads(json.dumps(self.binding)))
        self.assertIsNotNone(restarted.verify(self.ticket(), ORIGIN))
        denied = await self.http.post('/v1/pairing/request', headers={'Origin': ORIGIN}, json={'challenge': 'a'*43})
        self.assertEqual(denied.status_code, 403)

    async def test_scope_origin_audience_expiry_algorithm_and_unsigned_tokens_fail_closed(self):
        for changes in ({'aud': 'other'}, {'scope': 'operator'}, {'origin': 'https://evil.example'}, {'exp': int(time.time())-1}, {'exp': int(time.time())+301}, {'iat': int(time.time())+10}, {'sub': 'operator'}):
            self.assertIsNone(self.trust.verify(self.ticket(**changes), ORIGIN))
        self.assertIsNone(self.trust.verify(self.ticket(), 'https://evil.example'))
        self.assertIsNone(self.trust.verify('a.b.c', ORIGIN))
        self.assertIsNone(self.trust.verify(jwt.encode({'sub': 'operator'}, 'secret'*10, algorithm='HS256'), ORIGIN))

    async def test_oauth_callback_is_the_only_public_query_route_and_redirect_is_fixed(self):
        native = Native()
        app = create_app(TOKEN, {ORIGIN}, {HOST}, native, trust=self.trust, public_callback='https://'+HOST+'/v1/oauth/callback')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://'+HOST, follow_redirects=False) as browser:
            invalid = await browser.get('/v1/oauth/callback?state=s&code=a&code=b')
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(native.calls, [])
            invalid = await browser.get('/v1/oauth/callback?state=s&code=a&next=https://evil.example')
            self.assertEqual(invalid.status_code, 400)
            invalid = await browser.get('/v1/rpc?code=a')
            self.assertEqual(invalid.status_code, 403)
            accepted = await browser.get('/v1/oauth/callback?state=synthetic&code=synthetic')
            self.assertEqual(accepted.status_code, 303)
            self.assertEqual(accepted.headers['location'], ORIGIN)
            self.assertEqual(accepted.headers['referrer-policy'], 'no-referrer')
            self.assertNotIn('synthetic', accepted.text)
            self.assertEqual(native.calls[0][0], 'bot_web.connections.oauth')

    async def test_delayed_old_bearer_cannot_shorten_a_renewed_lease(self):
        now = int(time.time())
        old = self.ticket(exp=now+5)
        newer = self.ticket(exp=now+300)
        base = {'Origin': ORIGIN}
        connected = await self.http.post('/v1/connect', headers={**base, 'Authorization': 'Bearer '+old})
        lease = connected.json()['connection']
        headers = {**base, 'X-Bot-Connection': lease}
        self.assertEqual((await self.http.post('/v1/renew', headers={**headers, 'Authorization': 'Bearer '+newer})).status_code, 200)
        self.assertEqual((await self.http.post('/v1/renew', headers={**headers, 'Authorization': 'Bearer '+old})).status_code, 200)
        # The old bearer has now expired; the newer authorized ticket remains valid.
        with patch('bot_web.connection.time.time', return_value=now+10):
            self.assertEqual((await self.http.post('/v1/connect', headers={**base, 'Authorization': 'Bearer '+newer})).status_code, 200)
        self.assertEqual((await self.http.post('/v1/renew', headers={**headers, 'Authorization': 'Bearer '+newer})).status_code, 200)
