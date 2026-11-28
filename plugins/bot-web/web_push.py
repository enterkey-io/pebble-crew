"""Message alerts on the owner's phone and computer through standard Web Push.

The signing key and the list of devices stay in the workspace database. Each alert is
encrypted for its device (RFC 8291), so the push service that delivers it cannot read it.
An alert is sent only while no Pebble Crew window is in view.
"""
import asyncio
import base64
import json
import os
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

from .operations import InvalidOperation, shown_preview

# Browser push services only; the bridge never posts anywhere else.
PUSH_HOSTS = ('.push.apple.com', '.googleapis.com', '.push.services.mozilla.com', '.notify.windows.com')
MAX_DEVICES = 20
IN_VIEW_SECONDS = 40
CHECK_SECONDS = 30
# A live turn this close to a roster rise accounts for it.
QUIET_SECONDS = 120
BODY_LIMIT = 180
PUSH_ERROR_CODES = {'PUSH_UNSUPPORTED', 'PUSH_DEVICE_LIMIT', 'PUSH_REFUSED'}


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def unb64url(text):
    if not isinstance(text, str) or len(text) > 512:
        raise ValueError('bad base64')
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def allowed_endpoint(endpoint):
    if not isinstance(endpoint, str) or len(endpoint) > 1024:
        return False
    url = urllib.parse.urlsplit(endpoint)
    host = (url.hostname or '').lower()
    return (url.scheme == 'https' and not url.username and not url.password and url.port in (None, 443)
            and any(host.endswith(suffix) or host == suffix[1:] for suffix in PUSH_HOSTS))


def encrypt(payload, p256dh, auth, *, local=None, salt=None):
    """aes128gcm content coding for one device (RFC 8291 / RFC 8188)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    receiver = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), p256dh)
    local = local or ec.generate_private_key(ec.SECP256R1())
    sender = local.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = local.exchange(ec.ECDH(), receiver)
    ikm = HKDF(hashes.SHA256(), 32, auth, b'WebPush: info\x00' + p256dh + sender).derive(shared)
    salt = salt or os.urandom(16)
    key = HKDF(hashes.SHA256(), 16, salt, b'Content-Encoding: aes128gcm\x00').derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b'Content-Encoding: nonce\x00').derive(ikm)
    body = AESGCM(key).encrypt(nonce, payload + b'\x02', None)
    return salt + struct.pack('!IB', 4096, len(sender)) + sender + body


class WebPush:
    def __init__(self, store, ops, native, origin):
        self.store, self.ops, self.native, self.origin = store, ops, native, origin
        # Each open window reports separately; any one in view holds alerts for all devices.
        self.viewers = {}
        self.counts = {}
        # When each Pebble's chat last had a live turn, and roster rises still waiting on one.
        self.active = {}
        self.pending = {}
        self.clock = time.monotonic
        self.last_refusal = ''
        self.tokens = {}
        with store.db:
            store.db.execute('CREATE TABLE IF NOT EXISTS push_key(id INTEGER PRIMARY KEY CHECK(id=1), private_pem TEXT NOT NULL)')
            store.db.execute('CREATE TABLE IF NOT EXISTS push_devices(endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, '
                             'auth TEXT NOT NULL, created INTEGER NOT NULL)')

    def _key(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        row = self.store.db.execute('SELECT private_pem FROM push_key WHERE id=1').fetchone()
        if not row:
            pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
            with self.store.db:
                self.store.db.execute('INSERT OR IGNORE INTO push_key VALUES(1,?)', (pem,))
            row = self.store.db.execute('SELECT private_pem FROM push_key WHERE id=1').fetchone()
        return serialization.load_pem_private_key(row[0].encode(), None)

    def public_key(self):
        from cryptography.hazmat.primitives import serialization
        return b64url(self._key().public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))

    def devices(self):
        return self.store.db.execute('SELECT endpoint,p256dh,auth FROM push_devices').fetchall()

    def _authorization(self, endpoint):
        # Apple asks that a token be reused for at least an hour; each lasts twelve.
        audience = '{0.scheme}://{0.netloc}'.format(urllib.parse.urlsplit(endpoint))
        cached = self.tokens.get(audience)
        if cached and cached[0] > time.time():
            return cached[1]
        value = self._sign(audience)
        self.tokens[audience] = (time.time() + 3600, value)
        return value

    def _sign(self, audience):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
        header = b64url(json.dumps({'typ': 'JWT', 'alg': 'ES256'}).encode())
        claims = b64url(json.dumps({'aud': audience, 'exp': int(time.time()) + 12 * 3600,
                                    'sub': self.origin}).encode())
        key = self._key()
        r, s = decode_dss_signature(key.sign(f'{header}.{claims}'.encode(), ec.ECDSA(hashes.SHA256())))
        token = f'{header}.{claims}.{b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))}'
        return f'vapid t={token}, k={self.public_key()}'

    def _request(self, endpoint, p256dh, auth, message):
        body = encrypt(json.dumps(message, ensure_ascii=False).encode(), unb64url(p256dh), unb64url(auth))
        return urllib.request.Request(endpoint, data=body, method='POST', headers={
            'Authorization': self._authorization(endpoint), 'Content-Encoding': 'aes128gcm',
            # No Topic header: Apple refuses values other services accept (BadWebPushTopic).
            # Alerts from one Pebble still replace each other on the device by their tag.
            'Content-Type': 'application/octet-stream', 'TTL': '86400', 'Urgency': 'high'})

    @staticmethod
    def _post(req):
        """(status, reason). The reason is the push service's short error word only."""
        import re
        from .eleven_voice import NoRedirect
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as response:
                return response.status, ''
        except urllib.error.HTTPError as error:
            try:
                reason = json.loads(error.read(2048) or b'{}').get('reason', '')
            except (ValueError, AttributeError, OSError):
                reason = ''
            error.close()
            return error.code, reason if isinstance(reason, str) and re.fullmatch(r'[A-Za-z]{1,40}', reason) else ''
        except OSError as error:
            return 0, type(error).__name__

    async def send(self, message, devices=None):
        sent = 0
        for endpoint, p256dh, auth in devices if devices is not None else self.devices():
            status, reason = await asyncio.to_thread(self._post, self._request(endpoint, p256dh, auth, message))
            self.last_refusal = '' if 200 <= status < 300 else f'{status} {reason}'.strip()
            if status in (404, 410):
                # The browser withdrew this subscription; forget it.
                with self.store.db:
                    self.store.db.execute('DELETE FROM push_devices WHERE endpoint=?', (endpoint,))
            elif 200 <= status < 300:
                sent += 1
        return sent

    async def invoke(self, operation, params, viewer=''):
        from .operations import fields
        if operation == 'push.config':
            fields(params, [])
            return {'public_key': self.public_key(), 'devices': len(self.devices())}
        if operation == 'push.presence':
            fields(params, ['visible'])
            if type(params['visible']) is not bool:
                raise InvalidOperation('Invalid presence')
            if params['visible']:
                self.viewers[viewer] = time.monotonic() + IN_VIEW_SECONDS
            else:
                self.viewers.pop(viewer, None)
            return {'ok': True}
        if operation == 'push.unsubscribe':
            fields(params, ['endpoint'])
            with self.store.db:
                self.store.db.execute('DELETE FROM push_devices WHERE endpoint=?', (params['endpoint'],))
            return {'devices': len(self.devices())}
        if operation == 'push.subscribe':
            fields(params, ['endpoint', 'p256dh', 'auth'])
            endpoint = params['endpoint']
            if not allowed_endpoint(endpoint):
                raise InvalidOperation('This browser’s notification service is not supported', 'PUSH_UNSUPPORTED')
            try:
                if len(unb64url(params['p256dh'])) != 65 or len(unb64url(params['auth'])) != 16:
                    raise ValueError
            except (ValueError, TypeError):
                raise InvalidOperation('Invalid notification keys') from None
            with self.store.db:
                if not self.store.db.execute('SELECT 1 FROM push_devices WHERE endpoint=?', (endpoint,)).fetchone() \
                        and len(self.devices()) >= MAX_DEVICES:
                    raise InvalidOperation('Too many devices have alerts on. Turn one off first.', 'PUSH_DEVICE_LIMIT')
                self.store.db.execute('INSERT INTO push_devices VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET '
                                      'p256dh=excluded.p256dh, auth=excluded.auth',
                                      (endpoint, params['p256dh'], params['auth'], int(time.time())))
            device = [(endpoint, params['p256dh'], params['auth'])]
            sent = await self.send({'title': 'Pebble Crew', 'body': 'Alerts are on for new messages.',
                                    'tag': 'pebble-alerts'}, device)
            if not sent:
                with self.store.db:
                    self.store.db.execute('DELETE FROM push_devices WHERE endpoint=?', (endpoint,))
                error = InvalidOperation('The notification service did not accept this device. Try again.', 'PUSH_REFUSED')
                error.reason = self.last_refusal  # Owner-local diagnostics; never the device address.
                raise error
            return {'devices': len(self.devices())}
        raise InvalidOperation('Unknown notification operation')

    def owner_sent(self, sid):
        profile = self.ops.sessions.get(sid)
        if profile:
            self.active[profile] = self.clock()

    def in_view(self):
        now = time.monotonic()
        self.viewers = {key: until for key, until in self.viewers.items() if until > now}
        return bool(self.viewers)

    async def _name(self, profile):
        try:
            return self.ops.summary(await self.ops.bot(profile)).get('name') or profile
        except Exception:
            return profile

    async def reply(self, event):
        """A Pebble finished a reply in its Bot Chat."""
        payload = event.get('payload') or {}
        profile = self.ops.sessions.get(event.get('session_id'))
        if not profile:
            return
        # The roster check below must not alert for this reply a second time.
        self.active[profile] = self.clock()
        text = payload.get('text')
        if payload.get('status') in {'error', 'failed', 'interrupted', 'cancelled'} or not isinstance(text, str) \
                or not shown_preview(text).strip() or self.in_view() or not self.devices():
            return  # Only a message the Pebble sent alerts; a silent background turn does not.
        body = ' '.join(text.split())
        body = body if len(body) <= BODY_LIMIT else body[:BODY_LIMIT].rsplit(' ', 1)[0] + '…'
        await self.send({'title': await self._name(profile), 'body': body, 'profile': profile, 'tag': profile})

    async def check_roster(self):
        """Messages that arrived without a live reply event, such as scheduled check-ins.
        A rise waits one check for its reply event, which can land before or after the
        roster moves, so one message never alerts twice."""
        rows = {row['profile']: row for row in (await self.ops.invoke('bots.list', {}))['bots']}
        seen, self.counts = self.counts, {profile: row.get('cursor', 0) for profile, row in rows.items()}
        now = self.clock()
        for profile, count in self.counts.items():
            if seen and count > seen.get(profile, count):
                self.pending.setdefault(profile, now)
        if self.in_view():
            self.pending.clear()
            return
        for profile, since in list(self.pending.items()):
            if now - since < CHECK_SECONDS:
                continue
            del self.pending[profile]
            if self.active.get(profile, float('-inf')) >= since - QUIET_SECONDS or profile not in rows:
                continue
            name = rows[profile].get('name') or profile
            await self.send({'title': name, 'body': f'New message from {name}', 'profile': profile, 'tag': profile})

    async def watch(self):
        events = asyncio.Queue(maxsize=500)
        next_check = 0.0
        while True:
            self.native.listeners.add(events)
            try:
                event = await asyncio.wait_for(events.get(), timeout=5)
            except TimeoutError:
                event = None
            try:
                if event and event.get('type') == 'message.complete':
                    await self.reply(event)
                if time.monotonic() >= next_check:
                    next_check = time.monotonic() + CHECK_SECONDS
                    if self.devices():
                        await self.check_roster()
                    else:
                        self.counts, self.pending = {}, {}
            except Exception:
                pass  # An alert is best effort; chats are unaffected.
