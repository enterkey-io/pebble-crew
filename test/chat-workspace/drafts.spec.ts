import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('unsent drafts survive reload and navigation separately for each pebble', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  const arlo = 'A plan for Arlo\nwith **details** and 🪨';
  await input.fill(arlo);
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue(arlo);
  async function select(name: string) {
    if (!(await page.getByRole('button', { name: new RegExp(`^${name} .*Bot Chat$`) }).isVisible()))
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${name} .*Bot Chat$`) }).click();
    await expect(input).toBeEditable();
  }
  await select('Mica');
  await expect(input).toHaveValue('');
  await input.fill('Mica has a separate draft');
  await page.goto('/offline.html');
  await page.goto('/');
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Mica has a separate draft');
  await select('Arlo');
  await expect(input).toHaveValue(arlo);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('restored-draft.png') });
  await input.fill('');
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('');
});

test('sending and signing out clear saved drafts without retaining submitted text', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('Send this once');
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.operation === 'chat.send',
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(input).toHaveValue('');
  expect((await (await accepted).json()).result.state).toBe('accepted');
  await expect
    .poll(() =>
      page.evaluate(
        () => Object.keys(localStorage).filter((key) => key.startsWith('pebblecrew.draft.')).length,
      ),
    )
    .toBe(0);
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('');
  await input.fill('Private draft to clear on sign out');
  if (!(await page.getByRole('button', { name: 'Your account', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('pebblecrew.draft.')),
    ),
  ).toEqual([]);
});

test('reloading before a send receipt restores an editable tracked draft', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.send') return route.fallback();
    await barrier;
    // The old document may have retired while its response was held.
    try {
      await route.fulfill({ json: { result: { state: 'accepted' } } });
    } catch {
      /* Navigation retired this fixture request. */
    }
  });
  try {
    await page.goto('/');
    const input = page.getByLabel('Message', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('Keep this until Hermes confirms it');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(input).toHaveValue('');
    await page.reload();
    await expect(input).toHaveValue('Keep this until Hermes confirms it');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await input.fill('Revised draft after reloading');
    await expect(input).toHaveValue('Revised draft after reloading');
  } finally {
    release();
  }
});

for (const revise of [false, true]) {
  test(
    revise
      ? 'an old receipt preserves edits made after returning to the conversation'
      : 'a receipt clears a restored submission after navigating away and back',
    async ({ page, context }) => {
      await installFixture(context);
      let release!: () => void;
      let held = false;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
        if (route.request().postDataJSON().operation !== 'chat.send') return route.fallback();
        held = true;
        await barrier;
        await route.fulfill({ json: { result: { state: 'accepted' } } });
      });
      async function select(name: string) {
        const row = page.getByRole('button', { name: new RegExp(`^${name} .*Bot Chat$`) });
        if (!(await row.isVisible()))
          await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
        await row.click();
        await expect(page.getByLabel('Message', { exact: true })).toBeEditable();
      }
      try {
        await page.goto('/');
        const input = page.getByLabel('Message', { exact: true });
        await expect(input).toBeEnabled();
        await input.fill('A submission awaiting its receipt');
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await expect.poll(() => held).toBe(true);
        await select('Mica');
        await select('Arlo');
        await expect(input).toHaveValue('A submission awaiting its receipt');
        if (revise) await input.fill('My next message, not the submitted one');
        release();
        await expect(input).toHaveValue(revise ? 'My next message, not the submitted one' : '');
      } finally {
        release();
      }
    },
  );
}

test('a late send receipt preserves the newer draft in another browser tab', async ({
  page,
  context,
}) => {
  await installFixture(context, { attachments: true });
  let release!: () => void;
  let held = false;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.send') return route.fallback();
    held = true;
    await barrier;
    await route.fulfill({ json: { result: { state: 'accepted' } } });
  });
  const other = await context.newPage();
  try {
    await page.goto('/');
    const input = page.getByLabel('Message', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('Submission from the first browser tab');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.getByRole('button', { name: 'Add attachment', exact: true })).toBeDisabled();
    await other.goto('/');
    const otherInput = other.getByLabel('Message', { exact: true });
    await expect(otherInput).toBeEnabled();
    await otherInput.fill('A newer draft in the second browser tab');
    release();
    await expect(page.getByRole('button', { name: 'Add attachment', exact: true })).toBeEnabled();
    await other.reload();
    await expect(otherInput).toHaveValue('A newer draft in the second browser tab');
  } finally {
    release();
    await other.close();
  }
});
