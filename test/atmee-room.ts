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

export async function installAtmeeRoom(page: Page, dimensions = { width: 512, height: 512 }) {
  await page.addInitScript(() => {
    const Media = globalThis.MediaStream;
    if (!Media)
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        writable: true,
        value: null,
      });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () =>
          Media ? new Media() : { getTracks: () => [], getAudioTracks: () => [] },
      },
    });
  });
  await page.route('**/assets/livekit-client.esm-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        export const Track = { Kind: { Audio: 'audio', Video: 'video' }, Source: { Microphone: 'microphone' } };
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
              publishTrack: (_, options) => { window.__mediaPublished.push(options.source); },
              sendText: async (body, options) => { window.__atmeeApp.push({ message: JSON.parse(body), options }); },
            };
            window.__mediaPublished = [];
            window.__atmeeApp = [];
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
            this.handlers.TrackSubscribed({ kind: 'audio', attach() {} }, null, this.renderer);
            window.__caption = (identity, text) => this.receiveCaption({
              withAbortSignal() { return this; },
              async *[Symbol.asyncIterator]() { yield text; }
            }, { identity });
          }
          async startAudio() {}
          async disconnect() {}
        }
      `,
    }),
  );
}
