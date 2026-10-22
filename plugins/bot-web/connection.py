"""Owner-local connection evidence and subscription admission, independent of chats."""
import asyncio
import time

GLOBAL_EVENTS = frozenset({'workspace.changed', 'requests.changed', 'exchanges.changed'})


class Subscription(asyncio.Queue):
    def __init__(self, sessions):
        super().__init__(maxsize=256)
        self.sessions = sessions

    def put_nowait(self, event):
        kind = event.get('type')
        if kind in GLOBAL_EVENTS:
            event = {'type': kind}
        elif kind != 'bridge.resync' and event.get('session_id') not in self.sessions:
            return
        super().put_nowait(event)

    def end(self):
        while not self.empty():
            self.get_nowait()
        super().put_nowait({'type': 'bridge.resync'})


class NativeHealth:
    def __init__(self, native):
        self.native = native
        self.flight = None
        self.checked = None
        self.result = 'unconfirmed'

    async def read(self):
        if getattr(self.native, 'healthy', True) is False:
            return {'native': 'unavailable', 'age_ms': 0}
        if self.checked is None or time.monotonic() - self.checked >= 3:
            if self.flight is None:
                self.flight = asyncio.create_task(self._probe())
            await asyncio.shield(self.flight)
        return {'native': self.result, 'age_ms': max(0, int((time.monotonic() - self.checked) * 1000))}

    async def _probe(self):
        try:
            result = await asyncio.wait_for(self.native.call('bot_web.connection.health', {}), 2)
            self.result = 'responsive' if result == {'responsive': True} else 'unconfirmed'
        except (Exception, asyncio.CancelledError):
            self.result = 'unavailable' if getattr(self.native, 'healthy', True) is False else 'unconfirmed'
        finally:
            self.checked = time.monotonic()
            self.flight = None


def reclaimable(client, lease_seconds):
    if client['inflight']:
        return False
    expired = client.get('expires') is not None and time.time() >= client['expires']
    idle = time.monotonic() - client['touched'] > lease_seconds
    return expired or idle
