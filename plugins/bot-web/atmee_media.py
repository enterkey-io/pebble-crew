"""Relay one renderer's audio and video to a private browser as fragmented MP4."""
import asyncio
from fractions import Fraction
from contextlib import suppress
from dataclasses import dataclass
from urllib.parse import urlsplit

from .operations import InvalidOperation

FPS = 25
AUDIO_RATE = 48_000
AUDIO_BYTES = AUDIO_RATE // FPS * 2


def dependencies():
    # Setup can still load stored avatars on installations without video wheels.
    try:
        import av
        from livekit import rtc
        return av, rtc
    except (ImportError, OSError):
        raise InvalidOperation('The optional video relay is not installed', 'ATMEE_MEDIA_SETUP_REQUIRED') from None


@dataclass
class VideoFrame:
    width: int
    height: int
    data: bytes


class Fragments:
    def __init__(self):
        self.parts = []

    def write(self, data):
        self.parts.append(bytes(data))
        return len(data)

    def take(self):
        value = b''.join(self.parts)
        self.parts.clear()
        return value


class Mux:
    def __init__(self, av, width, height):
        self.av = av
        self.fragments = Fragments()
        scale = min(1, 672 / max(width, height))
        self.width, self.height = (max(2, int(value * scale) // 2 * 2) for value in (width, height))
        self.container = av.open(self.fragments, 'w', format='mp4', options={
            'movflags': 'empty_moov+default_base_moof+frag_keyframe',
            'frag_duration': '160000',
        })
        self.video = self.container.add_stream('libx264', rate=FPS)
        self.video.width, self.video.height = self.width, self.height
        self.video.pix_fmt = 'yuv420p'
        self.video.codec_context.thread_count = 2
        self.video.options = {
            'preset': 'ultrafast', 'tune': 'zerolatency', 'profile': 'baseline',
            'level': '3.1', 'x264-params': 'keyint=10:min-keyint=10:scenecut=0:bframes=0:vbv-maxrate=1600:vbv-bufsize=1600',
        }
        self.audio = self.container.add_stream('aac', rate=AUDIO_RATE, layout='mono')
        self.audio.bit_rate = 48_000
        self.index = 0
        self.last = None
        self.picture = None

    def push(self, frame, pcm):
        if frame is not self.last:
            image = self.av.VideoFrame(frame.width, frame.height, 'yuv420p')
            data = memoryview(frame.data)
            offset = 0
            for plane in image.planes:
                count = plane.width * plane.height
                packed = data[offset:offset + count]
                if plane.width == plane.line_size:
                    plane.update(packed)
                else:
                    rows = bytearray(plane.buffer_size)
                    for row in range(plane.height):
                        start = row * plane.width
                        rows[row * plane.line_size:row * plane.line_size + plane.width] = packed[start:start + plane.width]
                    plane.update(rows)
                offset += count
            self.picture = image.reformat(width=self.width, height=self.height, format='yuv420p')
            self.last = frame
        self.picture.pts = self.index
        self.picture.time_base = Fraction(1, FPS)
        audio = self.av.AudioFrame(format='s16', layout='mono', samples=AUDIO_RATE // FPS)
        audio.sample_rate = AUDIO_RATE
        audio.pts = self.index * (AUDIO_RATE // FPS)
        audio.time_base = Fraction(1, AUDIO_RATE)
        audio.planes[0].update(pcm)
        self.index += 1
        for stream, value in ((self.video, self.picture), (self.audio, audio)):
            for packet in stream.encode(value):
                self.container.mux(packet)
        return self.fragments.take()

    def close(self):
        self.container.close()


def room_ticket(data):
    url = data.get('livekitUrl')
    token = data.get('agentToken')
    avatar = data.get('avatarParticipantIdentity')
    try:
        parsed = urlsplit(url if isinstance(url, str) else '')
        if (parsed.scheme == 'wss' and parsed.hostname and parsed.hostname.endswith('.livekit.cloud')
                and not (parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment)
                and parsed.path in {'', '/'} and isinstance(token, str) and 20 <= len(token) <= 8192
                and avatar == 'atmee-avatar-agent'):
            return url, token, avatar
    except ValueError:
        pass
    raise InvalidOperation('Atmee returned an invalid renderer connection', 'ATMEE_UNAVAILABLE')


class Relay:
    def __init__(self, av, rtc, avatar):
        self.av, self.rtc, self.avatar = av, rtc, avatar
        self.room = rtc.Room()
        self.video = None
        self.audio = bytearray()
        self.available = asyncio.Event()
        self.closed = asyncio.Event()
        self.playback_finished = asyncio.Event()
        self.tasks = set()
        self.tracks = {}
        self.speech = None
        self.generation = 0
        self.claimed = False

        @self.room.on('track_subscribed')
        def subscribed(track, _publication, participant):
            if participant.identity != self.avatar or track.kind in self.tracks:
                return
            if track.kind == rtc.TrackKind.KIND_VIDEO:
                stream = rtc.VideoStream.from_track(track=track, capacity=2, format=rtc.VideoBufferType.I420)
                task = asyncio.create_task(self.receive_video(stream))
            elif track.kind == rtc.TrackKind.KIND_AUDIO:
                stream = rtc.AudioStream.from_track(track=track, capacity=15, sample_rate=AUDIO_RATE, num_channels=1)
                task = asyncio.create_task(self.receive_audio(stream))
            else:
                return
            self.tracks[track.kind] = track.sid
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

        @self.room.on('track_unsubscribed')
        def unsubscribed(track, _publication, participant):
            if participant.identity == self.avatar and self.tracks.get(track.kind) == track.sid:
                self.tracks.pop(track.kind, None)

        @self.room.on('disconnected')
        def disconnected(_reason):
            self.closed.set()
            self.available.set()

    async def connect(self, url, token, timeout=18):
        await asyncio.wait_for(self.room.connect(url, token), timeout)
        participant = self.room.local_participant

        @participant.register_rpc_method('lk.playback_started')
        async def playback_started(data):
            return 'ok' if data.caller_identity == self.avatar else 'reject'

        @participant.register_rpc_method('lk.playback_finished')
        async def playback_finished(data):
            if data.caller_identity != self.avatar:
                return 'reject'
            self.playback_finished.set()
            return 'ok'

    async def receive_video(self, stream):
        try:
            async for event in stream:
                frame = event.frame
                if 0 < frame.width <= 1920 and 0 < frame.height <= 1920:
                    self.video = VideoFrame(frame.width, frame.height, bytes(frame.data))
                    self.available.set()
        finally:
            await stream.aclose()

    async def receive_audio(self, stream):
        try:
            async for event in stream:
                self.audio.extend(event.frame.data.cast('B'))
                if len(self.audio) > AUDIO_BYTES * 8:
                    del self.audio[:-AUDIO_BYTES * 4]
        finally:
            await stream.aclose()

    async def media(self):
        try:
            await asyncio.wait_for(self.available.wait(), 35)
            if self.closed.is_set() or self.video is None:
                return
            self.audio.clear()
            mux = Mux(self.av, self.video.width, self.video.height)
            tick = asyncio.get_running_loop().time()
            try:
                while not self.closed.is_set():
                    frame = self.video
                    chunk = bytes(self.audio[:AUDIO_BYTES])
                    del self.audio[:len(chunk)]
                    pcm = chunk.ljust(AUDIO_BYTES, b'\0')
                    # Closing an HTTP stream cannot close a mux while its encoder
                    # is still executing in the thread pool.
                    encoding = asyncio.create_task(asyncio.to_thread(mux.push, frame, pcm))
                    try:
                        data = await asyncio.shield(encoding)
                    except asyncio.CancelledError:
                        with suppress(Exception):
                            await encoding
                        raise
                    if data:
                        yield data
                    tick = max(tick + 1 / FPS, asyncio.get_running_loop().time() - 0.08)
                    await asyncio.sleep(max(0, tick - asyncio.get_running_loop().time()))
            finally:
                await asyncio.to_thread(mux.close)
        except TimeoutError:
            return

    async def say(self, upstream, generation):
        """Feed only 16 kHz mono PCM from the verified Hermes reply."""
        participant = self.room.local_participant
        writer = None
        self.playback_finished.clear()
        try:
            if generation != self.generation or self.closed.is_set():
                return
            writer = await participant.stream_bytes(
                'Speech audio', topic='lk.audio_stream', destination_identities=[self.avatar],
                attributes={'sample_rate': '16000', 'num_channels': '1'},
            )
            remaining = 2 * 16000 * 60
            while remaining and generation == self.generation and not self.closed.is_set():
                data = await asyncio.to_thread(upstream.read1, min(3200, remaining))
                if not data:
                    break
                if generation != self.generation:
                    return
                await writer.write(data)
                remaining -= len(data)
            await writer.aclose()
            writer = None
            if generation == self.generation and not self.closed.is_set():
                with suppress(TimeoutError):
                    await asyncio.wait_for(self.playback_finished.wait(), 12)
        finally:
            upstream.close()
            if writer:
                with suppress(Exception):
                    await writer.aclose()

    async def interrupt(self):
        self.generation += 1
        if self.speech:
            speech, self.speech = self.speech, None
            if speech is not asyncio.current_task():
                speech.cancel()
                await asyncio.gather(speech, return_exceptions=True)
            if not self.closed.is_set():
                with suppress(Exception):
                    await asyncio.wait_for(self.room.local_participant.perform_rpc(
                        destination_identity=self.avatar, method='lk.clear_buffer', payload=''), 2)

    async def close(self):
        self.closed.set()
        self.available.set()
        await self.interrupt()
        tasks = tuple(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(Exception):
            await asyncio.wait_for(self.room.disconnect(), 5)
