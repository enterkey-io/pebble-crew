import type { Page } from '@playwright/test';

export async function installAtmeeRoom(page: Page) {
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
        export const Track = { Kind: { Video: 'video' }, Source: { Microphone: 'microphone' } };
        export const RoomEvent = Object.fromEntries(['TrackSubscribed', 'TrackUnsubscribed', 'AudioPlaybackStatusChanged', 'Reconnecting', 'Reconnected', 'Disconnected'].map(name => [name, name]));
        export class Room {
          constructor() {
            this.handlers = {};
            this.canPlaybackAudio = true;
            this.agent = { identity: 'agent', isAgent: true, attributes: { 'lk.agent.name': 'Atmee' } };
            this.renderer = { identity: 'renderer', isAgent: true, attributes: { 'lk.publish_on_behalf': 'agent' } };
            this.remoteParticipants = new Map([['agent', this.agent], ['renderer', this.renderer]]);
            this.localParticipant = { identity: 'owner', publishTrack: (_, options) => { window.__mediaPublished.push(options.source); } };
            window.__mediaPublished = [];
          }
          on(event, handler) { this.handlers[event] = handler; }
          registerTextStreamHandler(topic, handler) { this.receiveCaption = handler; }
          registerRpcMethod() {}
          async connect() {
            const picture = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#35384c"/><circle cx="128" cy="111" r="49" fill="#eab79b"/><path d="M52 256a76 85 0 0 1 152 0" fill="#8293a9"/></svg>';
            this.handlers.TrackSubscribed({ kind: 'video', attach: (node) => { node.poster = 'data:image/svg+xml,' + encodeURIComponent(picture); } }, null, this.renderer);
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
