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
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(input).toHaveValue('');
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
