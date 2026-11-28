import { test, expect } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
import { emit, installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('ElevenLabs preview, Hermes delegation, and call history use the selected Vox voice', async ({
  page,
  context,
}, info) => {
  const messages = [{ row_id: 1, role: 'assistant', text: 'Ready.', timestamp: 1700000000 }];
  let provider = 'openai',
    voice = 'brian',
    confirmed = false,
    completed = false,
    submissions = 0,
    ends = 0;
  const providerMessages: { type: string; item?: unknown; response?: unknown }[] = [];
  const sockets: WebSocketRoute[] = [];
  const pcm = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++)
    pcm.writeInt16LE(Math.sin((i * 2 * Math.PI * 440) / 24000) * 2500, i * 2);
  await installFixture(context, { voice: true, messages });
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
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
          oscillator.connect(output);
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
  await page.routeWebSocket('wss://api.elevenlabs.io/v1/convai/realtime', (route) => {
    sockets.push(route);
    route.onMessage((raw) => {
      const data = JSON.parse(String(raw));
      providerMessages.push(data);
      if (data.type === 'response.create' && data.response?.instructions) {
        route.send(JSON.stringify({ type: 'response.created' }));
        route.send(
          JSON.stringify({
            type: 'response.output_audio.delta',
            item_id: 'preview',
            delta: pcm.toString('base64'),
          }),
        );
        route.send(JSON.stringify({ type: 'response.done' }));
      }
    });
    route.send(JSON.stringify({ type: 'session.created' }));
  });
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { result } });
    if (operation === 'secrets.pending') return reply({ requests: [] });
    if (operation === 'voice.provider') provider = params.provider;
    if (operation === 'voice.vox_import') {
      expect(params.presets).toEqual([
        { handle: 'arlo', voice_id: 'vox_arlo', label: 'Vox · Arlo' },
      ]);
      voice = 'vox_arlo';
      return reply({ imported: 1 });
    }
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
        voice_labels:
          eleven && voice === 'vox_arlo'
            ? { vox_arlo: 'Vox · Arlo', brian: 'Brian' }
            : { brian: 'Brian' },
        setup_complete: eleven && completed,
        key_confirmed: eleven && confirmed,
      });
    }
    if (operation === 'voice.voices') return reply({ voices: { another_voice: 'Another voice' } });
    if (operation === 'voice.session') {
      expect(params.provider).toBe('elevenlabs');
      expect(params).not.toHaveProperty('sdp');
      return reply({
        provider,
        session: { id: params.preview ? 'preview' : 'call' },
        client_secret: 'synthetic_test_ticket',
      });
    }
    if (operation === 'voice.submit') {
      submissions++;
      expect(params.text).toBe('Check the report.');
      expect(params.context).toContain('Check the report.');
      messages.push({ row_id: 400, role: 'user', text: params.text, timestamp: 1700000001 });
      return reply({ user_row_id: 400 });
    }
    if (operation === 'voice.end') {
      ends++;
      expect(params.call_id).toBe('call');
      expect(params.transcript).toContain('Check the report.');
      return reply({ call: { id: 'a'.repeat(64), ended_at: Date.now() / 1000 } });
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await page.getByText('ElevenLabs', { exact: true }).click();
  await expect(page.getByRole('form', { name: 'ElevenLabs API key' })).toBeVisible();
  await page.getByRole('button', { name: 'Use saved key' }).click();
  await page.locator('[aria-label="Voice settings"] input[type="file"]').setInputFiles({
    name: 'vox.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([{ handle: 'arlo', voice_id: 'vox_arlo', label: 'Vox · Arlo' }]),
    ),
  });
  await expect(page.getByRole('combobox', { name: 'Voice' })).toContainText('Vox · Arlo');
  await page.screenshot({
    path: info.outputPath('eleven-voice-settings.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect
    .poll(() => providerMessages.find((message) => message.type === 'response.create')?.response)
    .toEqual({
      instructions:
        'Read this sample once, exactly as written: Hi, this is the Vox · Arlo voice on Pebble Crew. How do I sound?',
    });
  await expect(page.getByRole('button', { name: 'Stop preview', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, '__elevenMic')())).toEqual([]);
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
  const enableAudio = page.getByRole('button', { name: 'Enable audio', exact: true });
  if (await enableAudio.isVisible()) await enableAudio.click();
  await expect
    .poll(() => providerMessages.some((message) => message.type === 'input_audio_buffer.append'))
    .toBe(true);
  const send = (event: Record<string, unknown>) => sockets.at(-1)?.send(JSON.stringify(event));
  send({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'Check the report.',
  });
  const functionCall = {
    call_id: 'owned-tool',
    name: 'ask_pebble',
    arguments: '{"request":"Check the report."}',
  };
  send({ ...functionCall, type: 'response.function_call_arguments.done' });
  send({ type: 'response.output_item.done', item: { type: 'function_call', ...functionCall } });
  await expect.poll(() => submissions).toBe(1);
  messages.push({
    row_id: 401,
    role: 'assistant',
    text: 'The report is ready.',
    timestamp: 1700000002,
  });
  await emit(page, 'message.complete', {
    persisted_turn: { user_row_id: 400, final_assistant_row_id: 401 },
  });
  await expect
    .poll(() =>
      providerMessages
        .filter((message) => message.type === 'conversation.item.create')
        .map((message) => message.item),
    )
    .toEqual([
      { type: 'function_call_output', call_id: 'owned-tool', output: 'The report is ready.' },
    ]);
  send({ type: 'response.created' });
  send({
    type: 'response.output_audio.delta',
    item_id: 'live-reply',
    delta: pcm.toString('base64'),
  });
  await expect
    .poll(() =>
      page
        .locator('[data-slot="voice-call-bar"] [data-slot="audio-activity"] span')
        .first()
        .evaluate((node) => node.getBoundingClientRect().height),
    )
    .toBeGreaterThan(6);
  send({ type: 'input_audio_buffer.speech_started' });
  await expect
    .poll(() => providerMessages.some((message) => message.type === 'conversation.item.truncate'))
    .toBe(true);
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
