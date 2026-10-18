import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('private voice setup, Snow and selected-Pebble message colors', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let configured = false,
    voice = 'marin',
    pace = 'natural';
  let submitted = '';
  await page.route('**/v1/rpc', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === 'secrets.pending')
      return route.fulfill({ json: { result: { requests: [] } } });
    if (body.operation === 'voice.credential') {
      submitted = body.params.value;
      configured = true;
      return route.fulfill({ json: { result: { saved: true, validated: false } } });
    }
    if (body.operation === 'voice.preferences') {
      voice = body.params.voice;
      pace = body.params.pace;
    }
    if (['voice.status', 'voice.preferences'].includes(body.operation))
      return route.fulfill({
        json: { result: { supported: true, configured, voice, voices: ['marin', 'cedar'], pace } },
      });
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('.pc-message.user .pc-bubble').last()).toHaveCSS(
    'background-color',
    'rgb(52, 52, 54)',
  );
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await expect(page.getByRole('form', { name: 'OpenAI API key' })).toBeVisible();
  const card = page.getByRole('form', { name: 'OpenAI API key' });
  const field = card.getByLabel('VOICE_TOOLS_OPENAI_KEY');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(card).toBeInViewport({ ratio: 1 });
  await expect(card.getByRole('button', { name: 'Submit', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: info.outputPath('voice-secret-card.png') });
  await field.fill('synthetic-private-voice-key');
  await card.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start call' })).toBeVisible();
  expect(submitted).toBe('synthetic-private-voice-key');
  expect(await page.locator('body').innerText()).not.toContain(submitted);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).not.toContain(submitted);
  await page.getByLabel('Voice', { exact: true }).selectOption('cedar');
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('cedar');
  await page.getByLabel('Speaking pace').selectOption('slower');
  await expect(page.getByLabel('Speaking pace')).toHaveValue('slower');
  await page.screenshot({ path: info.outputPath('voice-ready.png') });
  await page.getByRole('button', { name: 'Change API key', exact: true }).click();
  await expect(page.getByLabel('VOICE_TOOLS_OPENAI_KEY')).toHaveValue('');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('cedar');
  await page.getByRole('button', { name: 'Close voice setup' }).click();
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  await expect(page.locator('.pc-message.user .pc-bubble').last()).toHaveCSS(
    'background-color',
    'rgb(155, 191, 232)',
  );
  await expect(page.locator('.pc-message.user .pc-bubble').last()).toHaveCSS(
    'color',
    'rgb(16, 17, 18)',
  );
  await page.screenshot({ path: info.outputPath('selected-pebble-bubbles.png') });
});

declare global {
  interface Window {
    __voiceTest: {
      answer: (sdp: string) => Promise<string>;
      send: (event: unknown) => void;
      commands: () => Record<string, unknown>[];
      micReads: () => number;
      stopped: () => boolean;
    };
  }
}

test('real browser WebRTC preview and call preserve native receipt ownership and stop the microphone', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'The standalone local-peer probe produces zero ICE candidates in automated WebKit. Real Safari media requires separate acceptance.',
  );
  const messages = [{ row_id: 1, role: 'assistant', text: 'Ready.', timestamp: 1700000000 }];
  await installFixture(context, { voice: true, messages });
  await context.grantPermissions(['microphone']);
  const initialize = () => {
    let micReads = 0,
      channel: RTCDataChannel | undefined;
    const tracks: MediaStreamTrack[] = [],
      commands: Record<string, unknown>[] = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        micReads++;
        const audio = new AudioContext(),
          destination = audio.createMediaStreamDestination();
        tracks.push(...destination.stream.getTracks());
        return destination.stream;
      },
    });
    window.__voiceTest = {
      async answer(sdp) {
        const peer = new RTCPeerConnection();
        peer.addEventListener('datachannel', (event) => {
          channel = event.channel;
          channel.addEventListener('message', (message) =>
            commands.push(JSON.parse(String(message.data))),
          );
          channel.addEventListener('open', () =>
            channel?.send(
              JSON.stringify({ type: 'session.started', session: { id: 'local-peer' } }),
            ),
          );
        });
        await peer.setRemoteDescription({ type: 'offer', sdp });
        const output = new AudioContext().createMediaStreamDestination().stream;
        for (const track of output.getAudioTracks()) peer.addTrack(track, output);
        await peer.setLocalDescription(await peer.createAnswer());
        if (peer.iceGatheringState !== 'complete')
          await new Promise<void>((resolve) => {
            peer.addEventListener('icegatheringstatechange', () => {
              if (peer.iceGatheringState === 'complete') resolve();
            });
          });
        return peer.localDescription?.sdp ?? '';
      },
      send(event) {
        channel?.send(JSON.stringify(event));
      },
      commands: () => commands,
      micReads: () => micReads,
      stopped: () => tracks.every((track) => track.readyState === 'ended'),
    };
  };
  await page.addInitScript(initialize);
  const peerPage = page;
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'secrets.pending')
      return route.fulfill({ json: { result: { requests: [] } } });
    if (operation === 'voice.status')
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: 'marin',
            voices: ['marin', 'cedar'],
            pace: 'natural',
          },
        },
      });
    if (operation === 'voice.session') {
      const sdp = await peerPage.evaluate((offer) => window.__voiceTest.answer(offer), params.sdp);
      return route.fulfill({
        json: { result: { session: { id: 'local-peer' }, transport: { type: 'webrtc', sdp } } },
      });
    }
    if (operation === 'voice.submit') {
      expect(params.text).toBe('Check the report.');
      expect(params.context).toContain('Check the report.');
      messages.push({ row_id: 400, role: 'user', text: params.text, timestamp: 1700000001 });
      return route.fulfill({ json: { result: { user_row_id: 400 } } });
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect
    .poll(
      () =>
        peerPage.evaluate(
          () =>
            window.__voiceTest
              .commands()
              .filter((event) => event.type === 'session.commentary.append').length,
        ),
      { timeout: 30000 },
    )
    .toBe(1);
  expect(await page.evaluate(() => window.__voiceTest.micReads())).toBe(0);
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible({
    timeout: 30000,
  });
  expect(await page.evaluate(() => window.__voiceTest.micReads())).toBe(1);
  await peerPage.evaluate(() => {
    window.__voiceTest.send({
      type: 'session.input_transcript.delta',
      delta: 'Check the report.',
      start_ms: 0,
      end_ms: 200,
    });
    window.__voiceTest.send({
      type: 'session.delegation.created',
      delegation: { id: 'owned-delegation' },
    });
  });
  await expect(page.locator('[data-message-id="400"]')).toContainText('Check the report.');
  await page.evaluate(() =>
    Reflect.get(
      window,
      '__chatEvent',
    )({
      type: 'message.complete',
      session_id: 'session-arlo',
      payload: { persisted_turn: { user_row_id: 399, final_assistant_row_id: 401 } },
    }),
  );
  expect(
    await peerPage.evaluate(() =>
      window.__voiceTest
        .commands()
        .some(
          (event) =>
            event.delegation_id === 'owned-delegation' &&
            event.type === 'session.commentary.append',
        ),
    ),
  ).toBe(false);
  messages.push({
    row_id: 402,
    role: 'assistant',
    text: 'The report is ready.',
    timestamp: 1700000002,
  });
  await page.evaluate(() =>
    Reflect.get(
      window,
      '__chatEvent',
    )({
      type: 'message.complete',
      session_id: 'session-arlo',
      payload: { persisted_turn: { user_row_id: 400, final_assistant_row_id: 402 } },
    }),
  );
  await expect
    .poll(() =>
      peerPage.evaluate(
        () =>
          window.__voiceTest
            .commands()
            .filter(
              (event) =>
                event.delegation_id === 'owned-delegation' &&
                event.content === 'The report is ready.',
            ).length,
      ),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Mute microphone' }).click();
  await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  expect(await page.evaluate(() => window.__voiceTest.stopped())).toBe(true);
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeVisible();
});

test('denied microphone returns to intact text chat without creating a provider session', async ({
  page,
  context,
}) => {
  await installFixture(context, { voice: true });
  let providerRequests = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    });
  });
  await page.route('**/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === 'secrets.pending')
      return route.fulfill({ json: { result: { requests: [] } } });
    if (operation === 'voice.status')
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: 'marin',
            voices: ['marin'],
            pace: 'natural',
          },
        },
      });
    if (operation === 'voice.session') providerRequests++;
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Keep my unsent draft');
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('microphone permission');
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('Keep my unsent draft');
  expect(providerRequests).toBe(0);
});
