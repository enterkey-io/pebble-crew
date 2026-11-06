import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { installAtmeeRoom } from '../atmee-room';

const character = 'bbcb7c08-35d3-44c2-86cd-28825ed7165e';
const call = '9c53b2f5-5c43-4b51-b553-504fa870e0e2';
test.use({ serviceWorkers: 'block' });

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
  await installAtmeeRoom(page);
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (!operation.startsWith('atmee.')) return route.fallback();
    operations.push(operation);
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
  await expect(page.getByText('Add an Atmee API key in Settings → Connections.')).toBeVisible();
  expect(operations).not.toContain('atmee.start');
  await page.getByRole('button', { name: 'Close Edit Arlo' }).click();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add API key' }).click();
  const key = page.getByRole('form', { name: 'Atmee API key' });
  await expect(key.getByLabel('API key')).toHaveAttribute('type', 'password');
  await key.getByLabel('API key').fill('sk_atmee_fixture-only');
  await key.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('API key saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close Settings' }).click();
  await start.click();
  await page.getByRole('combobox', { name: 'Character', exact: true }).click();
  await page.getByRole('option', { name: 'Aimee' }).click();
  await expect(page.getByRole('combobox', { name: 'Character' })).toContainText('Aimee');
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
  const remote = (await stage.locator('video').first().boundingBox())!;
  expect(bounds.x).toBeGreaterThan(remote.x + remote.width / 2);
  expect(bounds.y + bounds.height).toBeGreaterThan(remote.y + remote.height / 2);
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
  await stage.getByRole('button', { name: 'End video call' }).click();
  await expect(stage).toBeHidden();
  await expect
    .poll(() => operations.filter((operation) => operation === 'atmee.end').length)
    .toBe(1);
});
