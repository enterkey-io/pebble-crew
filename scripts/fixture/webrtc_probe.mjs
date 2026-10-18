import { chromium, webkit } from 'playwright';
// Premise: the installed automated browser can negotiate real local WebRTC.
// No app, provider, microphone, project source upload or owner state is involved.
for (const [name, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    await page.route('**/*', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<title>RTC premise probe</title>' }),
    );
    await page.goto('http://127.0.0.1/');
    const result = await page.evaluate(async () => {
      if (typeof RTCPeerConnection === 'undefined') return { available: false };
      const a = new RTCPeerConnection(),
        b = new RTCPeerConnection();
      const channel = a.createDataChannel('probe');
      const gather = async (peer) => {
        if (peer.iceGatheringState === 'complete') return;
        await Promise.race([
          new Promise((resolve) =>
            peer.addEventListener('icegatheringstatechange', () => {
              if (peer.iceGatheringState === 'complete') resolve();
            }),
          ),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      };
      await a.setLocalDescription(await a.createOffer());
      await gather(a);
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await gather(b);
      await a.setRemoteDescription(b.localDescription);
      await Promise.race([
        new Promise((resolve) => channel.addEventListener('open', resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      const out = {
        connected: channel.readyState === 'open',
        states: [a.connectionState, b.connectionState],
        candidates: [a, b].map(
          (peer) => (peer.localDescription?.sdp.match(/a=candidate:/g) || []).length,
        ),
        gathering: [a.iceGatheringState, b.iceGatheringState],
      };
      a.close();
      b.close();
      return out;
    });
    console.log(JSON.stringify({ name, ...result }));
  } finally {
    await browser.close();
  }
}
