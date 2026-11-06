import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { atmeePortrait, atmeeWav, installAtmeeRoom } from '../atmee-room';

const character = 'bbcb7c08-35d3-44c2-86cd-28825ed7165e';
const call = '9c53b2f5-5c43-4b51-b553-504fa870e0e2';
const voiceDesign = '21a1896b-011e-4dcf-a8db-9382f0875d70';
const sampleWav = atmeeWav(1);

test.use({ serviceWorkers: 'block' });

test('create a private character from a portrait, voice style and reviewed Pebble profile', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { atmee: true });
  let selected: string | null = null;
  let build: {
    id: string;
    name: string;
    state: string;
    avatar: string | null;
    error: null;
  } | null = null;
  let submissions = 0;
  let designed = false;
  let sampled = 0;
  let ready = false;
  await page.route(/\/v1\/(rpc|avatar)$/, async (route) => {
    const { operation, params } = route.request().postDataJSON();
    let result;
    if (operation === 'atmee.ready') result = { ready: false };
    else if (operation === 'atmee.avatars') {
      result = { configured: true, can_create: true, can_design: true, avatars: [], selected };
    } else if (operation === 'atmee.build.profile') {
      result = {
        name: 'Arlo',
        persona: 'Arlo is the Team lead. From SOUL.md: Be direct.',
        has_soul: true,
      };
    } else if (operation === 'atmee.voice.status') {
      result = {
        design: designed ? { id: voiceDesign, state: 'ready', count: 2, error: null } : null,
      };
    } else if (operation === 'atmee.voice.design') {
      expect(params).toMatchObject({
        bot_id: 'identity-0',
        description: 'Warm voice with a calm and clear pace.',
      });
      expect(params).not.toHaveProperty('persona');
      designed = true;
      result = { design: { id: voiceDesign, state: 'pending', count: 0, error: null } };
    } else if (operation === 'atmee.voice.sample') {
      expect(params.voice).toEqual({ kind: 'designed', id: voiceDesign, index: 1 });
      sampled++;
      result = {
        audio: sampleWav.toString('base64'),
        mime: 'audio/wav',
      };
    } else if (operation === 'atmee.build.status') {
      if (build && ready) build = { ...build, state: 'ready', avatar: character };
      result = { build };
    } else if (operation === 'atmee.build.start') {
      expect(new URL(route.request().url()).pathname).toBe('/v1/avatar');
      expect(params).toMatchObject({
        bot_id: 'identity-0',
        name: 'Arlo · Studio',
        persona: 'Arlo leads the team.',
        voice: { kind: 'designed', id: voiceDesign, index: 1 },
      });
      expect(params.photo).toMatch(/^data:image\/jpeg;base64,/);
      submissions += 1;
      build = {
        id: params.request_id,
        name: params.name,
        state: 'preparing',
        avatar: null,
        error: null,
      };
      result = { build };
    } else if (operation === 'atmee.select') {
      expect(params.avatar_id).toBe(character);
      selected = character;
      result = { selected, note: '' };
    } else return route.fallback();
    return route.fulfill({ json: { result } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const start = page.getByRole('button', { name: 'Start video call' });
  await start.click();
  await page.getByRole('button', { name: 'New video avatar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose photo' })).toBeVisible();
  await expect(page.getByLabel('Portrait', { exact: true })).toBeHidden();
  await page.getByLabel('Portrait', { exact: true }).setInputFiles(await atmeePortrait(page));
  await expect(page.getByRole('img', { name: 'Portrait preview' })).toBeVisible();
  await page.getByLabel('Describe the voice').fill('Warm voice with a calm and clear pace.');
  await page.getByRole('button', { name: 'Generate voice samples' }).click();
  await expect(page.getByRole('radio', { name: 'Voice 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview Voice 2' }).click();
  await expect(page.getByLabel('Sample for Voice 2')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      page
        .getByLabel('Sample for Voice 2')
        .evaluate((element) => (element as HTMLAudioElement).readyState),
    )
    .toBeGreaterThan(0);

  expect(sampled).toBe(1);
  await page.getByRole('radio', { name: 'Voice 2' }).click();
  await expect(page.getByRole('button', { name: 'Create video avatar' })).toBeDisabled();
  await page.getByRole('button', { name: /Review Hermes profile/ }).click();
  await expect(page.getByLabel('Avatar name')).toHaveValue('Arlo');
  const description = page.getByLabel('Avatar instructions');
  await expect(description).toHaveValue(/SOUL.md: Be direct/);
  await page.getByLabel('Avatar name').fill('Arlo · Studio');
  await description.fill('Arlo leads the team.');
  await page
    .getByRole('button', { name: 'Create video avatar', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('atmee-character-builder.png'),
  });
  await page.getByRole('button', { name: 'Create video avatar', exact: true }).click();
  await expect(page.getByText('Creating Arlo · Studio…', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close Edit Arlo' }).click();
  ready = true;
  await start.click();
  await expect(page.getByText('Arlo · Studio is ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Use video avatar' }).click();
  await expect(page.getByRole('combobox', { name: 'Video avatar', exact: true })).toContainText(
    'Arlo · Studio',
  );
  expect(submissions).toBe(1);
});

test('a failed voice design explains the blocked create and accepts a recording instead', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { atmee: true });
  let failed = false;
  let submitted = false;
  await page.route(/\/v1\/(rpc|avatar|files\/upload)$/, async (route) => {
    const { operation, params } = route.request().postDataJSON();
    const ok = (result: unknown) => route.fulfill({ json: { result } });
    if (operation === 'atmee.ready') return ok({ ready: false });
    if (operation === 'atmee.avatars')
      return ok({
        configured: true,
        can_create: true,
        can_design: true,
        selected: null,
        avatars: [],
      });
    if (operation === 'atmee.build.profile')
      return ok({ name: 'Arlo', persona: 'You are Arlo.', has_soul: true });
    if (operation === 'atmee.build.status') return ok({ build: null });
    const error = 'Atmee’s voice provider returned no usable samples. Try again later.';
    if (operation === 'atmee.voice.design') {
      failed = true;
      return ok({ design: { id: voiceDesign, state: 'pending', count: 0, error: null } });
    }
    if (operation === 'atmee.voice.status')
      return ok({ design: failed ? { id: voiceDesign, state: 'failed', count: 0, error } : null });
    if (operation === 'atmee.build.recording') {
      expect(new URL(route.request().url()).pathname).toBe('/v1/files/upload');
      expect(params.voice).toEqual({
        kind: 'recording',
        data: 'data:audio/wav;base64,' + atmeeWav(12).toString('base64'),
      });
      submitted = true;
      return ok({
        build: {
          id: params.request_id,
          name: 'Arlo',
          state: 'preparing',
          avatar: null,
          error: null,
        },
      });
    }
    return route.fallback();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start video call' }).click();
  await page.getByRole('button', { name: 'New video avatar', exact: true }).click();
  await page.getByLabel('Portrait', { exact: true }).setInputFiles(await atmeePortrait(page));
  const create = page.getByRole('button', { name: 'Create video avatar', exact: true });
  await expect(create).toHaveAccessibleDescription('Choose a voice sample or upload a recording.');
  await page.getByLabel('Describe the voice').fill('Warm, articulate voice at a measured pace.');
  await page.getByRole('button', { name: 'Generate voice samples' }).click();
  await expect(page.getByRole('alert')).toContainText('returned no usable samples');
  await page.getByRole('radio', { name: 'Upload recording' }).click();
  await page
    .getByLabel('Voice recording')
    .setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: atmeeWav(12) });
  await expect(page.getByLabel('Recording preview')).toBeVisible();
  await expect(create).toHaveAccessibleDescription('Open Review Hermes profile before creating.');
  await page.getByRole('button', { name: /Review Hermes profile/ }).click();
  await expect(create).toBeEnabled();
  await create.scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('atmee-recording-ready.png'),
  });
  await create.click();
  await expect.poll(() => submitted).toBe(true);
});

test('Atmee setup, private camera preview and both sides of the call reach Hermes', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { atmee: true });
  let configured = false;
  let selected: string | null = null;
  const briefing = 'Recent chat: We moved the check-in to Thursday.';
  const operations: string[] = [];
  const captured: unknown[] = [];
  await installAtmeeRoom(page, { width: 384, height: 672 });
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (!operation.startsWith('atmee.')) return route.fallback();
    operations.push(operation);
    if (operation === 'atmee.key' && params.value === 'sk_atmee_missing-scope') {
      return route.fulfill({ status: 400, json: { code: 'ATMEE_KEY_SCOPE' } });
    }
    const result = (() => {
      switch (operation) {
        case 'atmee.status':
          return { configured };
        case 'atmee.key':
          expect(params.value).toBe('sk_atmee_fixture-only');
          configured = true;
          return { configured };
        case 'atmee.avatars':
          return {
            configured,
            avatars: configured ? [{ id: character, name: 'Aimee', ready: true }] : [],
            selected,
          };
        case 'atmee.select':
          expect(params.bot_id).toBe('identity-0');
          selected = params.avatar_id;
          return { selected };
        case 'atmee.ready':
          return { ready: configured && !!selected };
        case 'atmee.start':
          expect(params.session_id).toBe('session-arlo');
          return {
            id: call,
            url: 'wss://atmanity.livekit.cloud',
            token: 'fixture-room-token-12345',
            duration: 300,
            context: briefing,
          };
        case 'atmee.caption':
          captured.push(params);
          return { saved: true };
        case 'atmee.end':
          return { ended: true };
        default:
          throw new Error('Unexpected operation: ' + operation);
      }
    })();
    return route.fulfill({ json: { result } });
  });
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Start video call' });
  await start.click();
  await expect(page.getByRole('tab', { name: 'Voice', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const addKey = page.getByRole('button', { name: 'Add Atmee API key' });
  await expect(addKey).toBeVisible();
  expect(operations).not.toContain('atmee.start');
  await addKey.click();
  const key = page.getByRole('form', { name: 'Atmee API key' });
  await expect(key.getByLabel('API key')).toHaveAttribute('type', 'password');
  await key.getByLabel('API key').fill('sk_atmee_missing-scope');
  await key.getByRole('button', { name: 'Submit' }).click();
  await expect(key.getByRole('alert')).toContainText('Enable avatar read access');
  await key.getByLabel('API key').fill('sk_atmee_fixture-only');
  await key.getByRole('button', { name: 'Submit' }).click();
  await expect(key).toHaveCount(0);
  await expect(addKey).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Video avatar', exact: true }).click();
  await page.getByRole('option', { name: 'Aimee' }).click();
  await expect(page.getByRole('combobox', { name: 'Video avatar' })).toContainText('Aimee');
  await expect(page.getByLabel('Call notes', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Atmee receives a few recent messages', { exact: false }),
  ).toBeVisible();
  expect(operations).not.toContain('atmee.start');
  await page.getByRole('button', { name: 'Close Edit Arlo' }).click();

  const composer = page.locator('[data-slot="prompt-input"]').filter({ has: start });
  await expect(composer.getByRole('button', { name: 'Start video call' })).toHaveAttribute(
    'data-variant',
    'quiet',
  );
  await expect(
    page.locator('[data-slot="chat-header"]').getByRole('button', { name: 'Start video call' }),
  ).toHaveCount(0);
  const primary = composer.locator('button[data-action]');
  const field = composer.getByLabel('Message', { exact: true });
  await field.fill('A draft survives starting a call');
  await expect(primary).toHaveAccessibleName('Send message');
  const triggerBounds = (await start.boundingBox())!;
  const primaryBounds = (await primary.boundingBox())!;
  expect(triggerBounds.x + triggerBounds.width).toBeLessThanOrEqual(primaryBounds.x);
  expect(
    Math.abs(
      triggerBounds.y + triggerBounds.height / 2 - primaryBounds.y - primaryBounds.height / 2,
    ),
  ).toBeLessThan(2);
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    expect(triggerBounds.width).toBeGreaterThanOrEqual(44);
    expect(triggerBounds.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('atmee-call-composer.png'),
  });
  await start.click();
  const stage = page.getByRole('region', { name: 'Video call with Arlo' });
  await stage.getByRole('button', { name: 'Turn camera on' }).click();
  const selfie = stage.locator('video[aria-label="Your camera preview"]');
  await expect(selfie).toBeVisible();
  const bounds = (await selfie.boundingBox())!;
  const remoteVideo = stage.getByLabel('Arlo’s video', { exact: true });
  const remote = (await remoteVideo.boundingBox())!;
  expect(Math.abs(remote.width / remote.height - 384 / 672)).toBeLessThan(0.02);
  expect(bounds.x).toBeGreaterThan(remote.x + remote.width / 2);
  expect(bounds.y + bounds.height).toBeGreaterThan(remote.y + remote.height / 2);
  expect(bounds.x + bounds.width).toBeLessThan(remote.x + remote.width);
  expect(bounds.y + bounds.height).toBeLessThan(remote.y + remote.height);
  expect(
    await page.evaluate(
      () => (window as unknown as { __mediaPublished: string[] }).__mediaPublished,
    ),
  ).toEqual(['microphone']);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __atmeeApp: unknown[] }).__atmeeApp))
    .toEqual([
      {
        message: { type: 'state', text: briefing },
        options: { topic: 'atmee.app', destinationIdentities: ['agent'] },
      },
    ]);
  for (const [identity, text] of [
    ['owner', 'Should we meet tomorrow?'],
    ['agent', 'Tomorrow works.'],
  ] as const) {
    await page.evaluate(
      ({ identity, text }) => {
        (window as unknown as { __caption: (identity: string, text: string) => void }).__caption(
          identity,
          text,
        );
      },
      { identity, text },
    );
  }
  await expect.poll(() => captured.length).toBe(2);
  expect(captured).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        session_id: 'session-arlo',
        speaker: 'owner',
        text: 'Should we meet tomorrow?',
      }),
      expect.objectContaining({
        session_id: 'session-arlo',
        speaker: 'avatar',
        text: 'Tomorrow works.',
      }),
    ]),
  );
  await selfie.evaluate((node: HTMLVideoElement) => {
    node.srcObject = null;
    node.poster =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><rect width="120" height="160" fill="#405851"/><circle cx="60" cy="65" r="22" fill="#d89b82"/><path d="M18 160a42 49 0 0 1 84 0" fill="#d5bfa2"/></svg>',
      );
  });
  await page.screenshot({ animations: 'disabled', path: info.outputPath('atmee-self-view.png') });
  await page.evaluate(() => Reflect.get(window, '__atmeeResizeVideo')(672, 384));
  await expect
    .poll(async () => {
      const frame = (await remoteVideo.boundingBox())!;
      return Math.abs(frame.width / frame.height - 672 / 384);
    })
    .toBeLessThan(0.02);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('atmee-landscape.png') });
  await stage.getByRole('button', { name: 'End video call' }).click();
  await expect(stage).toBeHidden();
  await expect
    .poll(() => operations.filter((operation) => operation === 'atmee.end').length)
    .toBe(1);
});
