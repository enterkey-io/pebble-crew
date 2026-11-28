const mime = 'video/mp4; codecs="avc1.42C01F, mp4a.40.2"';

export function avatarMediaSource(): typeof MediaSource | undefined {
  const managed = Reflect.get(window, 'ManagedMediaSource') as typeof MediaSource | undefined;
  if (managed?.isTypeSupported(mime)) return managed;
  if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime)) return MediaSource;
}

function waitFor(
  target: MediaSource | SourceBuffer,
  name: 'sourceopen' | 'updateend',
  signal: AbortSignal,
  action: () => void,
) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    function clean() {
      target.removeEventListener(name, done);
      target.removeEventListener('error', failed);
      target.removeEventListener('sourceclose', failed);
      signal.removeEventListener('abort', failed);
    }
    function done() {
      clean();
      resolve();
    }
    function failed() {
      clean();
      reject(new Error('Video playback stopped'));
    }
    target.addEventListener(name, done);
    target.addEventListener('error', failed);
    target.addEventListener('sourceclose', failed);
    signal.addEventListener('abort', failed);
    try {
      action();
    } catch (cause) {
      clean();
      reject(cause);
    }
  });
}

export async function playAvatar(
  video: HTMLVideoElement,
  Source: typeof MediaSource,
  stream: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  onMutedAutoplay: () => void,
) {
  const source = new Source();
  const url = URL.createObjectURL(source);
  let playing = false;
  video.disableRemotePlayback = true;
  try {
    await waitFor(source, 'sourceopen', signal, () => {
      video.src = url;
    });
    const buffer = source.addSourceBuffer(mime);
    for await (const part of stream) {
      await waitFor(buffer, 'updateend', signal, () => buffer.appendBuffer(new Uint8Array(part)));
      if (!video.buffered.length) continue;
      const end = video.buffered.end(video.buffered.length - 1);
      if (!playing) {
        playing = true;
        void video.play().catch(() => {
          if (signal.aborted) return;
          video.muted = true;
          onMutedAutoplay();
          void video.play().catch(() => undefined);
        });
      }
      if (end - video.currentTime > 1.3) video.currentTime = Math.max(0, end - 0.35);
      const keepFrom = video.currentTime - 8;
      if (buffer.buffered.length && keepFrom > buffer.buffered.start(0) + 4)
        await waitFor(buffer, 'updateend', signal, () => buffer.remove(0, keepFrom));
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
