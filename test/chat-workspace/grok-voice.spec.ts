import { test, expect } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('a Grok call knows the Pebble, hands real work to it and plays Grok’s voice', async ({
  page,
  context,
}, info) => {
  const messages = [{ row_id: 1, role: 'assistant', text: 'Ready.', timestamp: 1700000000 }];
  const callId = 'b'.repeat(32);
  let provider = 'openai',
    voice = 'eve',
    confirmed = false,
    completed = false,
    replyReady = false,
    ends = 0;
  const submitted: string[] = [];
  const sockets: WebSocketRoute[] = [];
  const fromBrowser: Record<string, unknown>[] = [];
  await installFixture(context, { voice: true, messages });
  await page.addInitScript(() => {
    let starts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      starts++;
      if (duration === undefined) return start.call(this, when, offset);
      return start.call(this, when, offset, duration);
    };
    Reflect.set(window, '__grokPlayback', () => starts);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          const output = audio.createMediaStreamDestination();
          oscillator.connect(output);
          oscillator.start();
          return output.stream;
        },
      },
    });
  });
  await page.routeWebSocket(
    /wss:\/\/api\.x\.ai\/v1\/realtime\?model=grok-voice-latest$/,
    (route) => {
      sockets.push(route);
      route.onMessage((raw) => {
        const data = JSON.parse(String(raw));
        if (data.type !== 'input_audio_buffer.append') fromBrowser.push(data);
        if (data.type === 'session.update') route.send(JSON.stringify({ type: 'session.updated' }));
      });
    },
  );
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { result } });
    if (operation === 'secrets.pending') return reply({ requests: [] });
    if (operation === 'voice.provider') provider = params.provider;
    if (operation === 'voice.preferences') {
      expect(params.provider).toBe('grok');
      confirmed = true;
      voice = params.voice;
      if (params.complete) completed = true;
    }
    if (['voice.status', 'voice.preferences', 'voice.provider'].includes(operation)) {
      const grok = provider === 'grok';
      return reply({
        supported: true,
        provider,
        providers: ['openai', 'elevenlabs', 'grok'],
        configured: true,
        voice: grok ? voice : 'marin',
        voices: grok ? ['eve', 'ara', 'leo', 'rex'] : ['marin', 'cedar'],
        voice_labels: {},
        setup_complete: grok && completed,
        key_confirmed: grok && confirmed,
      });
    }
    if (operation === 'voice.start')
      return reply({
        call_id: callId,
        provider: 'grok',
        token: 'synthetic-client-secret-value',
        model: 'grok-voice-latest',
        voice,
        instructions: 'You are Arlo, speaking with your owner. Dry wit.',
        history: [{ role: 'user', text: 'How is the launch going?' }],
      });
    if (operation === 'voice.submit') {
      expect(params.call_id).toBe(callId);
      submitted.push(params.text);
      return reply({ state: 'pending', user_row_id: 400 });
    }
    if (operation === 'voice.turn')
      return reply(
        replyReady
          ? {
              state: 'ready',
              user_row_id: 400,
              assistant_row_id: 401,
              assistant_text: 'Three tasks are open.',
            }
          : { state: 'pending', user_row_id: 400 },
      );
    if (operation === 'voice.end') {
      ends++;
      expect(params.call_id).toBe(callId);
      return reply({ call: { id: 'c'.repeat(64), ended_at: Date.now() / 1000 } });
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await page.getByText('Grok', { exact: true }).click();
  await expect(page.getByRole('form', { name: 'Grok API key' })).toBeVisible();
  await page.getByRole('button', { name: 'Use saved key' }).click();
  // Grok voices are grouped by female and male voices, like OpenAI's.
  const picker = page.getByRole('combobox', { name: 'Voice' });
  await picker.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox.getByText('Female', { exact: true })).toBeVisible();
  await expect(listbox.getByText('Male', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Female', exact: true }).getByRole('option'),
  ).toHaveText(['Eve', 'Ara']);
  await expect(
    page.getByRole('group', { name: 'Male', exact: true }).getByRole('option'),
  ).toHaveText(['Leo', 'Rex']);
  await page.screenshot({ path: info.outputPath('grok-voices.png'), animations: 'disabled' });
  await page.getByRole('option', { name: 'Leo' }).click();
  await expect(picker).toContainText('Leo');

  await page.getByRole('button', { name: 'Start call', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
  const enableAudio = page.getByRole('button', { name: 'Enable audio', exact: true });
  if (await enableAudio.isVisible()) await enableAudio.click();
  // The socket route only matches the grok-voice-latest model URL.
  expect(sockets).toHaveLength(1);
  // The session carries the Pebble's briefing, its recent chat, the voice and ask_pebble.
  const setup = fromBrowser.find((event) => event.type === 'session.update') as {
    session: { instructions: string; voice: string; tools: { name: string }[] };
  };
  expect(setup.session.voice).toBe('leo');
  expect(setup.session.instructions).toContain('Dry wit.');
  expect(setup.session.instructions).toContain('Owner: How is the launch going?');
  expect(setup.session.tools.map((tool) => tool.name)).toEqual(['ask_pebble']);

  const send = (event: Record<string, unknown>) => sockets.at(-1)?.send(JSON.stringify(event));
  send({
    type: 'response.function_call_arguments.done',
    name: 'ask_pebble',
    call_id: 'tool-1',
    arguments: JSON.stringify({ request: 'How many tasks are open?' }),
  });
  await expect.poll(() => submitted).toEqual(['How many tasks are open?']);
  replyReady = true;
  await expect
    .poll(() => fromBrowser.find((event) => event.type === 'conversation.item.create'))
    .toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'tool-1', output: 'Three tasks are open.' },
    });
  expect(fromBrowser.at(-1)).toEqual({ type: 'response.create' });

  const before = await page.evaluate(() => Reflect.get(window, '__grokPlayback')());
  send({
    type: 'response.output_audio.delta',
    delta: Buffer.alloc(4800, 1).toString('base64'),
  });
  send({ type: 'response.output_audio_transcript.delta', delta: 'Three tasks are open.' });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__grokPlayback')()))
    .toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Show voice transcript' }).click();
  await expect(page.getByRole('region', { name: 'Voice transcript' })).toContainText(
    'Three tasks are open.',
  );
  await page.getByRole('button', { name: 'Stop voice call' }).click();
  await expect.poll(() => ends).toBe(1);
});
