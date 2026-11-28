import { test, expect } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('ElevenLabs transcribes the microphone and plays the matching Hermes reply', async ({
  page,
  context,
}, info) => {
  const messages = [{ row_id: 1, role: 'assistant', text: 'Ready.', timestamp: 1700000000 }];
  let provider = 'openai',
    voice = 'brian',
    confirmed = false,
    completed = false,
    submissions = 0,
    ends = 0,
    catalogs = 0,
    speechRequests = 0,
    committed = 0,
    replyReady = false,
    olderPages = 0;
  const callId = 'a'.repeat(32);
  let utteranceId = '';
  const sockets: WebSocketRoute[] = [];
  const pcm = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++)
    pcm.writeInt16LE(Math.sin((i * 2 * Math.PI * 440) / 24000) * 2500, i * 2);
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(pcm.length + 36, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  // A long conversation: older pages keep going, as in a real chat.
  await installFixture(context, {
    voice: true,
    messages,
    historyPage: (params) => {
      const page = typeof params.before === 'string' ? Number(params.before.slice(5)) : 0;
      return {
        messages: page ? [] : messages,
        history_page: page < 40 ? { older: `older${page + 1}` } : {},
      };
    },
  });
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    let starts = 0;
    let stops = 0;
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      starts++;
      if (duration === undefined) return start.call(this, when, offset);
      return start.call(this, when, offset, duration);
    };
    AudioBufferSourceNode.prototype.stop = function (when) {
      stops++;
      return stop.call(this, when);
    };
    Reflect.set(window, '__elevenPlayback', () => ({ starts, stops }));
    Reflect.set(window, '__elevenMic', () =>
      tracks.map((track) => ({
        state: track.readyState,
        enabled: track.enabled,
      })),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const output = context.createMediaStreamDestination();
          const gain = context.createGain();
          gain.gain.value = 0;
          Reflect.set(window, '__elevenSpeak', (level: number) => {
            gain.gain.value = level;
          });
          oscillator.connect(gain).connect(output);
          oscillator.start();
          const track = output.stream.getAudioTracks()[0];
          if (track) {
            tracks.push(track);
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              void context.close();
            };
          }
          return output.stream;
        },
      },
    });
  });
  await page.routeWebSocket(
    /wss:\/\/api\.elevenlabs\.io\/v1\/speech-to-text\/realtime\?/,
    (route) => {
      sockets.push(route);
      route.onMessage((raw) => {
        const data = JSON.parse(String(raw));
        expect(data.message_type).toBe('input_audio_chunk');
        if (data.commit === true) committed++;
      });
      route.send(JSON.stringify({ message_type: 'session_started' }));
    },
  );
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { result } });
    if (operation === 'secrets.pending') return reply({ requests: [] });
    if (operation === 'chat.history' && params.before) olderPages++;
    if (operation === 'voice.provider') provider = params.provider;
    if (operation === 'voice.preferences') {
      expect(params.provider).toBe('elevenlabs');
      confirmed = true;
      voice = params.voice;
      if (params.complete) completed = true;
    }
    if (['voice.status', 'voice.preferences', 'voice.provider'].includes(operation)) {
      const eleven = provider === 'elevenlabs';
      return reply({
        supported: true,
        provider,
        providers: ['openai', 'elevenlabs'],
        configured: true,
        voice: eleven ? voice : 'marin',
        voices: eleven ? [voice, 'brian'] : ['marin', 'cedar'],
        voice_labels: { brian: 'Brian' },
        setup_complete: eleven && completed,
        key_confirmed: eleven && confirmed,
      });
    }
    if (operation === 'voice.voices') {
      catalogs++;
      if (catalogs === 1)
        return route.fulfill({ status: 400, json: { code: 'ELEVEN_ACCESS_DENIED' } });
      return reply({ voices: { soft_voice: 'Soft Voice', bright_voice: 'Bright Voice' } });
    }
    if (operation === 'voice.sample') {
      expect(params.voice).toBe('soft_voice');
      return reply({ audio: Buffer.concat([wav, pcm]).toString('base64') });
    }
    if (operation === 'voice.start')
      return reply({ call_id: callId, token: 'synthetic_test_ticket' });
    if (operation === 'voice.submit') {
      submissions++;
      expect(params.text).toBe('About the numbers. Check the report.');
      expect(params).not.toHaveProperty('context');
      expect(params.call_id).toBe(callId);
      utteranceId = params.utterance_id;
      messages.push({ row_id: 400, role: 'system', text: '', timestamp: 1700000001 });
      return reply({ state: 'pending', user_row_id: 400 });
    }
    if (operation === 'voice.turn')
      return reply(
        replyReady
          ? {
              state: 'ready',
              user_row_id: 400,
              assistant_row_id: 401,
              assistant_text: 'The report is ready.',
            }
          : { state: 'pending', user_row_id: 400 },
      );
    if (operation === 'voice.end') {
      ends++;
      expect(params.call_id).toBe(callId);
      expect(params).not.toHaveProperty('transcript');
      expect(params.follow_up).toBe(true);
      return reply({ call: { id: 'a'.repeat(64), ended_at: Date.now() / 1000 } });
    }
    await route.fallback();
  });
  await page.route('**/v1/voice/speech', async (route) => {
    speechRequests++;
    expect(route.request().postDataJSON()).toEqual({
      operation: 'voice.speech',
      params: { session_id: 'session-arlo', call_id: callId, utterance_id: utteranceId },
    });
    await route.fulfill({
      contentType: 'application/octet-stream',
      body: Buffer.concat([pcm, pcm, pcm, pcm]),
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await page.getByText('ElevenLabs', { exact: true }).click();
  await expect(page.getByRole('form', { name: 'ElevenLabs API key' })).toBeVisible();
  await page.getByRole('button', { name: 'Use saved key' }).click();
  await expect(page.getByRole('alert')).toContainText('Voices read access');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Voice' });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await picker.click();
  await expect(page.getByRole('option', { name: 'Bright Voice' })).toBeVisible();
  await page.getByRole('option', { name: 'Soft Voice' }).click();
  await expect(picker).toContainText('Soft Voice');
  await expect(page.getByRole('button', { name: 'Import Vox voices' })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('eleven-voice-settings.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop preview', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, '__elevenMic')())).toEqual([]);
  expect(sockets).toHaveLength(0);
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  const previewStarts = await page.evaluate(() => Reflect.get(window, '__elevenPlayback')().starts);
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
  const enableAudio = page.getByRole('button', { name: 'Enable audio', exact: true });
  if (await enableAudio.isVisible()) await enableAudio.click();
  const send = (event: Record<string, unknown>) => sockets.at(-1)?.send(JSON.stringify(event));
  send({
    message_type: 'response.function_call_arguments.done',
    arguments: '{"request":"provider text"}',
  });
  // Words ElevenLabs finalizes on its own are kept for the owner's next turn.
  send({ message_type: 'committed_transcript', text: 'About the numbers.' });
  await page.waitForTimeout(200);
  expect(submissions).toBe(0);
  await page.evaluate(() => Reflect.get(window, '__elevenSpeak')(0.3));
  await page.waitForTimeout(300);
  await page.evaluate(() => Reflect.get(window, '__elevenSpeak')(0));
  await expect.poll(() => committed).toBe(1);
  send({ message_type: 'committed_transcript', text: 'Check the report.' });
  await expect.poll(() => submissions).toBe(1);
  // The bridge hides call rows from chat, as it does for a real call.
  messages.push({ row_id: 401, role: 'system', text: '', timestamp: 1700000002 });
  const pagesBeforeReply = olderPages;
  replyReady = true;
  await expect.poll(() => speechRequests).toBe(1);
  // Call rows are hidden from chat; the reply must play without paging back
  // through history to find them.
  expect(olderPages).toBe(pagesBeforeReply);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__elevenPlayback')().starts))
    .toBeGreaterThan(previewStarts);
  const beforeInterruption = await page.evaluate(
    () => Reflect.get(window, '__elevenPlayback')().stops,
  );
  await page.evaluate(() => Reflect.get(window, '__elevenSpeak')(0.3));
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__elevenPlayback')().stops))
    .toBeGreaterThan(beforeInterruption);
  await page.evaluate(() => Reflect.get(window, '__elevenSpeak')(0));
  await page.getByRole('button', { name: 'Show voice transcript' }).click();
  await expect(page.getByRole('region', { name: 'Voice transcript' })).toContainText(
    'The report is ready.',
  );
  const surface = page.locator('[data-slot="voice-call-surface"]');
  const stop = page.getByRole('button', { name: 'Stop voice call' });
  await expect(stop).toBeInViewport({ ratio: 1 });
  const frame = (await surface.boundingBox())!;
  const button = (await stop.boundingBox())!;
  expect(button.x + button.width).toBeLessThan(frame.x + frame.width - 8);
  await page.screenshot({
    path: info.outputPath('hermes-voice-active.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Mute microphone' }).click();
  expect(await page.evaluate(() => Reflect.get(window, '__elevenMic')())).toEqual([
    { state: 'live', enabled: false },
  ]);
  await page.getByRole('button', { name: 'Stop voice call', exact: true }).click();
  await expect.poll(() => ends).toBe(1);
  await expect(page.getByText('Voice call ended', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__elevenMic')())).toEqual([
    { state: 'ended', enabled: false },
  ]);
});
