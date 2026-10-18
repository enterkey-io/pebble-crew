import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('private voice setup, Snow and selected-Pebble message colors', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let configured = false,
    setupComplete = false,
    voice = 'marin',
    speed = 1;
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
      speed = body.params.speed;
    }
    if (['voice.status', 'voice.preferences'].includes(body.operation))
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured,
            voice,
            voices: ['marin', 'cedar'],
            speed,
            speed_control: 'instruction',
            setup_complete: setupComplete,
          },
        },
      });
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(
    page.locator('[data-message-role="user"] [data-slot="bubble-content"]').last(),
  ).toHaveCSS('background-color', 'rgb(32, 32, 35)');
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await expect(page.getByRole('form', { name: 'OpenAI API key' })).toBeVisible();
  const card = page.getByRole('form', { name: 'OpenAI API key' });
  const field = card.getByLabel('API key', { exact: true });
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
  await page.getByRole('combobox', { name: 'Voice', exact: true }).click();
  await page.getByRole('option', { name: 'Cedar', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Cedar');
  await page.getByRole('slider', { name: 'Speed' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('slider', { name: 'Speed' })).toHaveAttribute(
    'aria-valuenow',
    '0.75',
  );
  await expect(page.locator('[data-slot=select-content]')).toHaveCount(0);
  await expect
    .poll(async () => (await page.locator('.pc-chat-header').boundingBox())?.y)
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(page.getByRole('button', { name: /Latest messages/ })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('voice-ready.png') });
  await expect(page.getByRole('button', { name: 'Replace API key', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close voice setup' }).click();
  setupComplete = true;
  await page.evaluate(() =>
    Reflect.get(
      window,
      '__chatEvent',
    )({
      type: 'voice.setup',
      session_id: 'session-arlo',
      payload: { replace_key: true },
    }),
  );
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await page.getByLabel('API key', { exact: true }).fill('synthetic-replacement-key');
  await card.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeVisible();
  expect(submitted).toBe('synthetic-replacement-key');
  expect(await page.locator('body').innerText()).not.toContain(submitted);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).not.toContain(submitted);
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Marin');
  await page.getByRole('button', { name: 'Close voice setup' }).click();
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  await expect(
    page.locator('[data-message-role="user"] [data-slot="bubble-content"]').last(),
  ).toHaveCSS('background-color', 'rgb(155, 191, 232)');
  await expect(
    page.locator('[data-message-role="user"] [data-slot="bubble-content"]').last(),
  ).toHaveCSS('color', 'rgb(16, 17, 18)');
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
  let setupComplete = false;
  let holdStatus = false,
    statusPending = false,
    releaseStatus = () => {};
  const followups: string[] = [];
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
          destination = audio.createMediaStreamDestination(),
          oscillator = audio.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        void audio.resume();
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
        const audio = new AudioContext(),
          destination = audio.createMediaStreamDestination(),
          oscillator = audio.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        void audio.resume();
        const output = destination.stream;
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
    if (operation === 'voice.preferences' && params.complete) setupComplete = true;
    if (operation === 'voice.status' && holdStatus)
      await new Promise<void>((resolve) => {
        statusPending = true;
        releaseStatus = resolve;
      });
    if (['voice.status', 'voice.preferences'].includes(operation))
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: 'marin',
            voices: ['marin', 'cedar'],
            speed: 1,
            speed_control: 'instruction',
            setup_complete: setupComplete,
          },
        },
      });
    if (operation === 'voice.session') {
      const sdp = await peerPage.evaluate((offer) => window.__voiceTest.answer(offer), params.sdp);
      return route.fulfill({
        json: { result: { session: { id: 'local-peer' }, transport: { type: 'webrtc', sdp } } },
      });
    }
    if (operation === 'voice.end') {
      followups.push(params.transcript);
      return route.fulfill({ json: { result: { submitted: true } } });
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
  await page.getByRole('button', { name: 'Use saved key', exact: true }).click();
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
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible({
    timeout: 30000,
  });
  expect(await page.evaluate(() => window.__voiceTest.micReads())).toBe(1);
  await page.getByRole('button', { name: 'Show voice transcript' }).click();
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
  await expect(page.getByRole('region', { name: 'Voice transcript' })).toContainText(
    'Check the report.',
  );
  const bar = page.locator('[data-slot=voice-call-bar]');
  await expect(bar).toBeInViewport({ ratio: 1 });
  expect((await bar.boundingBox())!.y).toBeLessThan(180);
  await expect
    .poll(() =>
      page
        .locator('[data-slot=audio-activity] span')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThan(6);
  await page.screenshot({
    path: `test-results/verification/voice-active-${page.viewportSize()?.width}.png`,
  });
  await page.getByRole('button', { name: 'Voice settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Voice', exact: true })).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(page.getByRole('tab', { name: 'Model', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close Edit Arlo', exact: true }).click();
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
  await page.getByRole('button', { name: 'Stop voice call', exact: true }).click();
  expect(await page.evaluate(() => window.__voiceTest.stopped())).toBe(true);
  await expect.poll(() => followups.length).toBe(1);
  expect(followups[0]).toContain('Check the report.');
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).not.toBeVisible();
  holdStatus = true;
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await expect(page.locator('[data-slot=voice-call-bar]')).toBeVisible();
  await expect(page.locator('[data-slot=card][aria-label="Voice settings"]')).toHaveCount(0);
  await expect.poll(() => statusPending).toBe(true);
  releaseStatus();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
  expect(await page.evaluate(() => window.__voiceTest.micReads())).toBe(2);
  await page.getByRole('button', { name: 'Stop voice call' }).click();
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
    if (['voice.status', 'voice.preferences'].includes(operation))
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: 'marin',
            voices: ['marin'],
            speed: 1,
            speed_control: 'instruction',
            setup_complete: false,
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
  await page.getByRole('button', { name: 'Use saved key', exact: true }).click();
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked');
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('Keep my unsent draft');
  expect(providerRequests).toBe(0);
  await page.screenshot({ path: 'test-results/verification/voice-permission-error.png' });
});

test('Preview reports a saved-key rejection without requesting or blaming the microphone', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let microphoneRequests = 0;
  await page.exposeFunction('voiceMicrophoneProbe', () => {
    microphoneRequests++;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        await Reflect.get(window, 'voiceMicrophoneProbe')();
        throw new DOMException('Denied', 'NotAllowedError');
      },
    });
  });
  await page.route('**/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (['voice.status', 'voice.preferences'].includes(operation))
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: 'marin',
            voices: ['marin', 'cedar'],
            speed: 1,
            speed_control: 'instruction',
            setup_complete: false,
          },
        },
      });
    if (operation === 'voice.session')
      return route.fulfill({
        status: 400,
        json: { code: 'VOICE_KEY_REJECTED', error: 'Untrusted vendor text must never appear.' },
      });
    if (operation === 'secrets.pending')
      return route.fulfill({ json: { result: { requests: [] } } });
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await expect(
    page.getByRole('form', { name: 'OpenAI API key' }).locator('[data-slot=input]'),
  ).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot=confirmation]')).toContainText('OpenAI API key');
  await expect(page.getByLabel('Voice settings', { exact: true })).toContainText(
    'Saved keys are never displayed',
  );
  await page.getByRole('button', { name: 'Use saved key', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('OpenAI rejected the saved API key', {
    timeout: 20000,
  });
  await expect(page.getByRole('alert')).not.toContainText('microphone');
  expect(microphoneRequests).toBe(0);
  await expect(page.locator('body')).not.toContainText('Untrusted vendor');
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('preview-key-rejected.png') });
});
