import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { atmeePortrait, installAtmeeRoom } from '../atmee-room';

const character = 'bbcb7c08-35d3-44c2-86cd-28825ed7165e';
const call = '9c53b2f5-5c43-4b51-b553-504fa870e0e2';
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
  let ready = false;
  await page.route(/\/v1\/(rpc|avatar)$/, async (route) => {
    const { operation, params } = route.request().postDataJSON();
    let result;
    if (operation === 'atmee.ready') result = { ready: false };
    else if (operation === 'atmee.avatars') {
      result = { configured: true, can_create: true, avatars: [], selected };
    } else if (operation === 'atmee.build.status') {
      if (build && ready) build = { ...build, state: 'ready', avatar: character };
      result = { build };
    } else if (operation === 'atmee.build.start') {
      expect(new URL(route.request().url()).pathname).toBe('/v1/avatar');
      expect(params).toMatchObject({
        bot_id: 'identity-0',
        name: 'Arlo · Studio',
        persona: 'Arlo leads the team.',
        voice_style: 'composed',
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
  await expect(page.getByLabel('Avatar name')).toHaveValue('Arlo');
  const description = page.getByLabel('Avatar description');
  await expect(description).toHaveValue(/Team lead/);
  await page.getByLabel('Portrait', { exact: true }).setInputFiles(await atmeePortrait(page));
  await expect(page.getByRole('img', { name: 'Portrait preview' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Voice style' }).click();
  await page.getByRole('option', { name: 'Calm & clear' }).click();
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

test('Atmee setup, private camera preview and both sides of the call reach Hermes', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { atmee: true });
  let configured = false;
  let selected: string | null = null;
  let note = '';
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
            note,
          };
        case 'atmee.select':
          expect(params.bot_id).toBe('identity-0');
          selected = params.avatar_id;
          return { selected, note };
        case 'atmee.context':
          expect(params.avatar_id).toBe(character);
          note = params.note;
          return { note };
        case 'atmee.ready':
          return { ready: configured && !!selected };
        case 'atmee.start':
          expect(params.session_id).toBe('session-arlo');
          return {
            id: call,
            url: 'wss://atmanity.livekit.cloud',
            token: 'fixture-room-token-12345',
            duration: 300,
            context: note,
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
  await page.getByLabel('Call notes', { exact: true }).fill('Keep check-ins brief.');
  const save = page.getByRole('button', { name: 'Save call notes' });
  await save.click();
  await expect(page.getByLabel('Call notes', { exact: true })).toBeEnabled();
  await expect(save).toBeDisabled();
  expect(note).toBe('Keep check-ins brief.');
  await expect(
    page.getByText('The voice connection could not start.', { exact: false }),
  ).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('atmee-call-notes.png') });
  expect(operations).not.toContain('atmee.start');
  await page.getByRole('button', { name: 'Close Edit Arlo' }).click();

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
        message: { type: 'state', text: 'Keep check-ins brief.' },
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
