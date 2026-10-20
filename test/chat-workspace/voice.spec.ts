import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('saved voice key approval survives reopening and reload across agents with separate voices', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let accepted = false,
    approvals = 0;
  const voices = new Map<string, string>();
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'voice.credential')
      return route.fulfill({ json: { result: { saved: true, validated: false } } });
    if (operation === 'voice.preferences') {
      if (!accepted) approvals++;
      accepted = true;
      voices.set(params.session_id, params.voice);
    }
    if (operation === 'voice.status' || operation === 'voice.preferences')
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: voices.get(params.session_id) ?? 'marin',
            voices: ['marin', 'cedar'],
            setup_complete: voices.has(params.session_id),
            key_confirmed: accepted,
          },
        },
      });
    if (operation === 'secrets.pending')
      return route.fulfill({ json: { result: { requests: [] } } });
    await route.fallback();
  });
  const openVoice = async (name: string) => {
    const actions = sidebarItem(page, name);
    if (!(await actions.isVisible()))
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await openSidebarMenu(page, name);
    await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
    await page.getByRole('tab', { name: 'Voice', exact: true }).click();
  };
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openVoice('Mica');
  await page.getByRole('button', { name: 'Use saved key', exact: true }).click();
  await page.getByRole('combobox', { name: 'Voice', exact: true }).click();
  await page.getByRole('option', { name: 'Cedar', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  await openVoice('Mica');
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Cedar');
  await expect(page.getByRole('button', { name: 'Use saved key', exact: true })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'OpenAI API key' })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('voice-shared-key-mica.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  await openVoice('Rowan');
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Marin');
  await expect(page.getByRole('button', { name: 'Use saved key', exact: true })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'OpenAI API key' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('voice-shared-key-rowan.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Close Edit Rowan', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openVoice('Mica');
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Cedar');
  await expect(page.getByRole('button', { name: 'Use saved key', exact: true })).toHaveCount(0);
  expect(approvals).toBe(1);
  expect(voices.get('session-mica')).toBe('cedar');
  expect(voices.get('session-rowan')).toBe('marin');
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  await emit(page, 'voice.setup', { replace_key: true });
  await page.getByLabel('API key', { exact: true }).fill('synthetic-replacement-key');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('tab', { name: 'Voice', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: 'OpenAI API key' })).toHaveCount(0);
});

test('private voice setup, Snow and selected-Pebble message colors', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let configured = false,
    keyConfirmed = false,
    setupComplete = false,
    voice = 'marin';
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
      expect(body.params).not.toHaveProperty('speed');
      keyConfirmed = configured;
      if (body.params.complete) setupComplete = true;
    }
    if (['voice.status', 'voice.preferences'].includes(body.operation))
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured,
            voice,
            voices: [
              'marin',
              'cedar',
              'quartz',
              'ripple',
              'vesper',
              'willow',
              'stone',
              'gleam',
              'meridian',
              'bossa',
              'tempo',
              'beacon',
              'delta',
              'cinder',
            ],
            setup_complete: setupComplete,
            key_confirmed: keyConfirmed,
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
  await expect(
    page
      .getByRole('group', { name: 'Female', exact: true })
      .getByRole('option', { name: 'Willow', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Male', exact: true })
      .getByRole('option', { name: 'Ripple', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Other', exact: true })
      .getByRole('option', { name: 'Cedar', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot=select-content]')).toHaveCSS('opacity', '1');
  await page.getByRole('option', { name: 'Quartz', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('option', { name: 'Quartz', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('voice-groups.png') });
  await page.getByRole('option', { name: 'Willow', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Willow');
  await expect(page.getByRole('slider', { name: 'Speed' })).toHaveCount(0);
  await expect(page.locator('[data-slot=select-content]')).toHaveCount(0);
  await expect
    .poll(async () => (await page.locator('.pc-chat-header').boundingBox())?.y)
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeInViewport({
    ratio: 0.999,
  });
  await expect(page.getByRole('button', { name: /Latest messages/ })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('voice-ready.png') });
  await expect(page.getByRole('button', { name: 'Replace API key', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Edit Arlo' }).click();
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
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  expect(submitted).toBe('synthetic-replacement-key');
  expect(await page.locator('body').innerText()).not.toContain(submitted);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).not.toContain(submitted);
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Marin');
  await page.getByRole('button', { name: 'Close Edit Arlo' }).click();
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
      answer: (sdp: string, preview: boolean) => Promise<string>;
      input: () => Promise<{ packets: number; energy: number }>;
      silenceOutput: (silent: boolean) => void;
      playback: () => { time: number; paused: boolean; attached: boolean };
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
}, info) => {
  test.skip(
    browserName === 'webkit',
    'The standalone local-peer probe produces zero ICE candidates in automated WebKit. Real Safari media requires separate acceptance.',
  );
  let setupComplete = false,
    keyConfirmed = false;
  let holdStatus = false,
    statusPending = false,
    releaseStatus = () => {};
  const followups: string[] = [];
  const messages = [{ row_id: 1, role: 'assistant', text: 'Ready.', timestamp: 1700000000 }];
  await installFixture(context, { voice: true, messages });
  await context.grantPermissions(['microphone']);
  const initialize = () => {
    let micReads = 0,
      channel: RTCDataChannel | undefined,
      remote: RTCPeerConnection | undefined,
      silentOutput = false;
    const tracks: MediaStreamTrack[] = [],
      commands: Record<string, unknown>[] = [],
      players: HTMLMediaElement[] = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      players.push(this);
      return play.call(this);
    };
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
    const input = async () => {
      let packets = 0,
        energy = 0;
      for (const report of (await remote?.getStats())?.values() ?? [])
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packets += report.packetsReceived ?? 0;
          energy += report.totalAudioEnergy ?? 0;
        }
      return { packets, energy };
    };
    window.__voiceTest = {
      input,
      playback: () => ({
        time: players.at(-1)?.currentTime ?? 0,
        paused: players.at(-1)?.paused ?? true,
        attached: !!players.at(-1)?.srcObject,
      }),
      silenceOutput: (silent) => {
        silentOutput = silent;
      },
      async answer(sdp, preview) {
        const peer = new RTCPeerConnection();
        remote = peer;
        peer.addEventListener('datachannel', (event) => {
          const events = event.channel;
          channel = events;
          events.addEventListener('message', (message) => {
            const command = JSON.parse(String(message.data));
            commands.push(command);
            if (command.type === 'session.close') {
              events.send(JSON.stringify({ type: 'session.closed', reason: 'close_requested' }));
              setTimeout(() => peer.close(), 50);
            }
          });
          events.addEventListener('open', () =>
            events.send(JSON.stringify({ type: 'session.started', session: { id: 'local-peer' } })),
          );
        });
        await peer.setRemoteDescription({ type: 'offer', sdp });
        const audio = new AudioContext(),
          destination = audio.createMediaStreamDestination(),
          oscillator = audio.createOscillator(),
          gate = audio.createGain();
        gate.gain.value = 0;
        oscillator.connect(gate).connect(destination);
        oscillator.start();
        void audio.resume();
        // Live advances on incoming audio, including silence. A connected data
        // channel alone must never make this fixture emit a passing preview.
        const clock = setInterval(() => {
          void input().then(({ packets }) => {
            gate.gain.value =
              !silentOutput &&
              packets > 10 &&
              (!preview || commands.some((event) => event.type === 'session.commentary.append'))
                ? 1
                : 0;
          });
        }, 50);
        peer.addEventListener('connectionstatechange', () => {
          if (peer.connectionState === 'closed') {
            clearInterval(clock);
            void audio.close();
          }
        });
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
    if (operation === 'voice.preferences') {
      expect(params).not.toHaveProperty('speed');
      keyConfirmed = true;
      if (params.complete) setupComplete = true;
    }
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
            setup_complete: setupComplete,
            key_confirmed: keyConfirmed,
          },
        },
      });
    if (operation === 'voice.session') {
      const sdp = await peerPage.evaluate(
        ({ sdp, preview }) => window.__voiceTest.answer(sdp, preview),
        { sdp: params.sdp, preview: params.preview },
      );
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
    .poll(() => page.evaluate(async () => (await window.__voiceTest.input()).packets), {
      message: 'Preview must send an active silent audio track to advance the Live timeline',
      timeout: 5000,
    })
    .toBeGreaterThan(10);
  expect(await page.evaluate(async () => (await window.__voiceTest.input()).energy)).toBeLessThan(
    0.0001,
  );
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
  expect(
    await peerPage.evaluate(
      () =>
        window.__voiceTest.commands().find((event) => event.type === 'session.commentary.append')
          ?.content,
    ),
  ).toBe('Hi, this is the Marin voice on Pebble Crew. How do I sound?');
  await expect(page.locator('[data-slot=voice-call-bar]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Voice', exact: true })).toHaveAttribute(
    'data-state',
    'active',
  );
  expect(await page.evaluate(() => window.__voiceTest.micReads())).toBe(0);
  await expect
    .poll(() =>
      page
        .locator('[data-slot=audio-activity] span')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThan(6);
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.playback().time))
    .toBeGreaterThan(0.2);
  expect(await page.evaluate(() => window.__voiceTest.playback().paused)).toBe(false);
  const mediaReceipt = JSON.stringify(
    await page.evaluate(async () => ({
      input: await window.__voiceTest.input(),
      playback: window.__voiceTest.playback(),
      microphoneRequests: window.__voiceTest.micReads(),
    })),
  );
  await writeFile(info.outputPath('preview-media.json'), mediaReceipt);
  await info.attach('preview-media.json', {
    body: mediaReceipt,
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('preview-playing.png') });
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  expect(await page.evaluate(() => window.__voiceTest.playback())).toMatchObject({
    paused: true,
    attached: false,
  });
  await page.evaluate(() => window.__voiceTest.silenceOutput(true));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Preparing voice preview' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('preview-waiting.png') });
  await expect(page.getByRole('alert')).toContainText('No preview audio arrived.', {
    timeout: 20000,
  });
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('preview-no-audio.png') });
  expect(followups).toEqual([]);
  expect(await page.evaluate(() => window.__voiceTest.micReads())).toBe(0);
  await page.evaluate(() => window.__voiceTest.silenceOutput(false));
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
  let providerRequests = 0,
    setupComplete = false,
    keyConfirmed = false;
  let denyPermission!: () => void;
  const permission = new Promise<void>((resolve) => (denyPermission = resolve));
  let captureRequested = false;
  await page.exposeFunction('holdVoicePermission', () => {
    captureRequested = true;
    return permission;
  });
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    // Browser cleanup tasks may run after the next frame opens the error panel.
    Object.defineProperty(window, 'setTimeout', {
      value: (callback: TimerHandler, delay?: number, ...args: unknown[]) =>
        schedule(callback, delay === undefined || delay === 0 ? 200 : delay, ...args),
    });
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      value: async () => {
        await Reflect.get(window, 'holdVoicePermission')();
        throw new DOMException('Denied', 'NotAllowedError');
      },
    });
  });
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'voice.preferences') {
      expect(params).not.toHaveProperty('speed');
      keyConfirmed = true;
      if (params.complete) setupComplete = true;
    }
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
            setup_complete: setupComplete,
            key_confirmed: keyConfirmed,
          },
        },
      });
    if (operation === 'voice.session') providerRequests++;
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await page.getByRole('button', { name: 'Use saved key', exact: true }).click();
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect.poll(() => captureRequested).toBe(true);
  await field.click();
  await field.fill('Keep my unsent draft');
  await expect(field).toHaveValue('Keep my unsent draft');
  denyPermission();
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked');
  await page.waitForTimeout(300);
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
  let microphoneRequests = 0,
    setupComplete = false,
    keyConfirmed = false;
  let savedVoice = 'marin';
  let rejectedKey = true;
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
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'voice.credential') {
      rejectedKey = false;
      return route.fulfill({ json: { result: { saved: true, validated: false } } });
    }
    if (operation === 'voice.preferences') {
      expect(params).not.toHaveProperty('speed');
      keyConfirmed = true;
      savedVoice = params.voice;
      if (params.complete) setupComplete = true;
    }
    if (['voice.status', 'voice.preferences'].includes(operation))
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: savedVoice,
            voices: ['marin', 'cedar'],
            setup_complete: setupComplete,
            key_confirmed: keyConfirmed,
          },
        },
      });
    if (operation === 'voice.session')
      return route.fulfill({
        status: 400,
        json: {
          code: rejectedKey ? 'VOICE_KEY_REJECTED' : 'VOICE_RATE_LIMITED',
          error: 'Untrusted vendor text must never appear.',
        },
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
    'all your pebbles',
  );
  await page.getByRole('button', { name: 'Use saved key', exact: true }).click();
  await page.getByRole('combobox', { name: 'Voice', exact: true }).click();
  await page.getByRole('option', { name: 'Cedar', exact: true }).click();
  const panel = await page.getByLabel('Voice settings', { exact: true }).elementHandle();
  const conversation = await page.locator('[data-message-id]').first().elementHandle();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('OpenAI rejected this saved key', {
    timeout: 20000,
  });
  await expect(page.getByRole('alert')).not.toContainText('microphone');
  expect(microphoneRequests).toBe(0);
  await expect(page.locator('body')).not.toContainText('Untrusted vendor');
  await expect(page.getByRole('form', { name: 'OpenAI API key' })).toBeVisible();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Use saved key', exact: true })).toHaveCount(0);
  expect(await panel?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await conversation?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.locator('.transcript [aria-label="Voice settings"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('preview-key-rejected.png') });
  await page.getByLabel('API key', { exact: true }).fill('synthetic-private-replacement');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Cedar');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const select = await page.getByRole('combobox', { name: 'Voice', exact: true }).elementHandle();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('rate limiting');
  expect(await select?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Cedar');
  await page.screenshot({ path: info.outputPath('preview-rate-limited.png') });
  await page.getByRole('button', { name: 'Close Edit Arlo', exact: true }).click();
  if (!(await sidebarItem(page, 'Arlo').isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await openSidebarMenu(page, 'Arlo');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Voice', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice', exact: true })).toContainText('Cedar');
  await expect(page.getByRole('button', { name: 'Use saved key', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('rate limiting');
  expect(microphoneRequests).toBe(0);
});
