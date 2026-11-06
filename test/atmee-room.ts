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

export async function installAtmeeRoom(
  page: Page,
  dimensions = { width: 512, height: 512 },
  media = { blockAudio: false, audioFromAgent: false },
) {
  const waveform = atmeeWav(3);
  for (let frame = 44; frame < waveform.length; frame++)
    waveform[frame] = Math.round(128 + 20 * Math.sin(((frame - 44) * 2 * Math.PI * 440) / 8000));
  await page.addInitScript(() => {
    const Media = globalThis.MediaStream;
    if (!Media)
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        writable: true,
        value: null,
      });
    const stopped: string[] = [];
    Reflect.set(window, '__mediaStopped', stopped);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          const kind = constraints.video ? 'video' : 'audio';
          const track = { kind, enabled: true, stop: () => stopped.push(kind) };
          const stream = Media ? new Media() : {};
          Object.defineProperties(stream, {
            getTracks: { value: () => [track] },
            getAudioTracks: { value: () => (kind === 'audio' ? [track] : []) },
            getVideoTracks: { value: () => (kind === 'video' ? [track] : []) },
          });
          return stream;
        },
      },
    });
  });
  await page.route('**/assets/livekit-client.esm-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        export const Track = { Kind: { Audio: 'audio', Video: 'video' }, Source: { Microphone: 'microphone', Camera: 'camera' } };
        export const RoomEvent = Object.fromEntries(['TrackSubscribed', 'TrackUnsubscribed', 'ParticipantConnected', 'ParticipantAttributesChanged', 'AudioPlaybackStatusChanged', 'Reconnecting', 'Reconnected', 'Disconnected'].map(name => [name, name]));
        export class Room {
          constructor() {
            this.handlers = {};
            this.canPlaybackAudio = true;
            this.agent = { identity: 'agent', isAgent: true, attributes: { 'lk.agent.name': 'Atmee' } };
            this.renderer = { identity: 'renderer', isAgent: true, attributes: { 'lk.publish_on_behalf': 'agent' } };
            this.remoteParticipants = new Map([['agent', this.agent], ['renderer', this.renderer]]);
            this.localParticipant = {
              identity: 'owner',
              publishTrack: (track, options) => {
                if (track?.kind !== (options.source === 'camera' ? 'video' : 'audio')) throw new Error('Wrong media track');
                window.__mediaPublished.push(options.source);
              },
              unpublishTrack: async (track) => { window.__mediaUnpublished.push(track.kind); },
              sendText: async (body, options) => { window.__atmeeApp.push({ message: JSON.parse(body), options }); },
            };
            window.__mediaPublished = [];
            window.__mediaUnpublished = [];
            window.__atmeeApp = [];
            this.blockAudio = ${media.blockAudio};
          }
          on(event, handler) { this.handlers[event] = handler; }
          registerTextStreamHandler(topic, handler) { this.receiveCaption = handler; }
          registerRpcMethod(method, handler) {
            window.__askPebble = (callerIdentity) => {
              if (method !== 'atmee.tool') throw new Error('Unexpected room RPC');
              return handler({ callerIdentity, payload: JSON.stringify({ id: 'fixture', name: 'ask_pebble', arguments: {} }) });
            };
          }
          async connect() {
            const dimensions = ${JSON.stringify(dimensions)};
            this.handlers.TrackSubscribed({
              kind: 'video',
              attach: (node) => {
                window.__atmeeResizeVideo = (width, height) => {
                  const unit = Math.min(width, height);
                  const picture = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="#35384c"/><circle cx="' + width / 2 + '" cy="' + height * .43 + '" r="' + unit * .23 + '" fill="#eab79b"/><ellipse cx="' + width / 2 + '" cy="' + height * .92 + '" rx="' + unit * .4 + '" ry="' + height * .24 + '" fill="#8293a9"/></svg>';
                  node.poster = 'data:image/svg+xml,' + encodeURIComponent(picture);
                  Object.defineProperties(node, {
                    videoWidth: { configurable: true, value: width },
                    videoHeight: { configurable: true, value: height },
                  });
                  node.dispatchEvent(new Event('resize'));
                };
                window.__atmeeResizeVideo(dimensions.width, dimensions.height);
              },
            }, { dimensions }, this.renderer);
            this.handlers.TrackSubscribed({
              kind: 'audio',
              attach: (node) => {
                this.audioElement = node;
                node.autoplay = !this.blockAudio;
                const bytes = Uint8Array.from(atob('${waveform.toString('base64')}'), char => char.charCodeAt(0));
                this.audioUrl = URL.createObjectURL(new Blob([bytes], {type:'audio/wav'}));
                node.src = this.audioUrl;
              },
              detach: () => {
                if (this.audioElement) {
                  this.audioElement.pause();
                  this.audioElement.removeAttribute('src');
                  this.audioElement.load();
                  this.audioElement = undefined;
                }
                if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
              },
            }, null, ${media.audioFromAgent} ? this.agent : this.renderer);
            window.__caption = (identity, text) => this.receiveCaption({
              withAbortSignal() { return this; },
              async *[Symbol.asyncIterator]() { yield text; }
            }, { identity });
          }
          async startAudio() {
            if (this.blockAudio && !this.deniedInitialPlayback) {
              this.deniedInitialPlayback = true;
              this.canPlaybackAudio = false;
              this.handlers.AudioPlaybackStatusChanged?.();
              throw new DOMException('Playback requires a gesture', 'NotAllowedError');
            }
            if (this.audioElement) await this.audioElement.play();
            this.canPlaybackAudio = true;
            this.handlers.AudioPlaybackStatusChanged?.();
          }
          async disconnect() {}
        }
      `,
    }),
  );
}
