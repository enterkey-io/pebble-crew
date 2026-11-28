import type { Page } from '@playwright/test';

export async function atmeePortrait(page: Page) {
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 168;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c58f72';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') };
}

export function atmeeWav(seconds: number) {
  const sampleWav = Buffer.alloc(seconds * 8000 + 44, 0x80);
  sampleWav.write('RIFF', 0);
  sampleWav.writeUInt32LE(sampleWav.length - 8, 4);
  sampleWav.write('WAVEfmt ', 8);
  sampleWav.writeUInt32LE(16, 16);
  sampleWav.writeUInt16LE(1, 20);
  sampleWav.writeUInt16LE(1, 22);
  sampleWav.writeUInt32LE(8000, 24);
  sampleWav.writeUInt32LE(8000, 28);
  sampleWav.writeUInt16LE(1, 32);
  sampleWav.writeUInt16LE(8, 34);
  sampleWav.write('data', 36);
  sampleWav.writeUInt32LE(sampleWav.length - 44, 40);
  return sampleWav;
}

export async function installAtmeeMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async ({ video }: MediaStreamConstraints) => {
          if (video) {
            const canvas = document.createElement('canvas');
            canvas.width = 144;
            canvas.height = 192;
            const paint = canvas.getContext('2d')!;
            paint.fillStyle = '#50857a';
            paint.fillRect(0, 0, canvas.width, canvas.height);
            const stream = canvas.captureStream(10);
            const timer = setInterval(() => paint.fillRect(0, 0, canvas.width, canvas.height), 100);
            const track = stream.getVideoTracks()[0]!;
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              clearInterval(timer);
            };
            return stream;
          }
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          const output = audio.createMediaStreamDestination();
          const gain = audio.createGain();
          gain.gain.value = 0;
          Reflect.set(window, '__atmeeVoiceLevel', (level: number) => {
            gain.gain.value = level;
          });
          oscillator.connect(gain).connect(output);
          oscillator.start();
          const track = output.stream.getAudioTracks()[0]!;
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            void audio.close();
          };
          return output.stream;
        },
      },
    });
  });
  let pending = '';
  await page.routeWebSocket(
    /wss:\/\/api\.elevenlabs\.io\/v1\/speech-to-text\/realtime\?/,
    (route) => {
      route.onMessage((raw) => {
        if (JSON.parse(String(raw)).commit !== true || !pending) return;
        route.send(JSON.stringify({ message_type: 'committed_transcript', text: pending }));
        pending = '';
      });
      route.send(JSON.stringify({ message_type: 'session_started' }));
    },
  );
  return async (text: string) => {
    pending = text;
    await page.evaluate(() => Reflect.get(window, '__atmeeVoiceLevel')(0.3));
    await page.waitForTimeout(320);
    await page.evaluate(() => Reflect.get(window, '__atmeeVoiceLevel')(0));
  };
}
