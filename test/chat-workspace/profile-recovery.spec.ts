import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
test('unsaved profile tool choices survive transport replacement', async ({ page, context }) => {
  await installFixture(context);
  let leases = 0;
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/v1/connect' &&
      response.request().method() === 'POST' &&
      response.ok()
    )
      leases++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'Actions for Mica', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Mica', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Tools & skills', exact: true }).click();
  const browser = page.getByRole('checkbox', { name: 'Browser', exact: true });
  await browser.check();
  const before = leases;
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect.poll(() => leases).toBeGreaterThan(before);
  await expect(page.locator('.connection-status')).toContainText('Hermes connected');
  await expect(browser).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Save tools & skills', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('profile-tools-restored.png'),
  });
});

test('an unconfirmed tool save cannot be replayed from the open editor', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'Actions for Mica', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Mica', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Tools & skills', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Browser', exact: true }).check();
  let attempts = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'agent.attach') return route.fallback();
    attempts++;
    await route.abort();
  });
  const save = page.getByRole('button', { name: 'Save tools & skills', exact: true });
  await save.click();
  await expect(page.getByText('The save could not be confirmed.', { exact: false })).toBeVisible();
  await expect(save).toBeDisabled();
  expect(attempts).toBe(1);
});

test('existing-agent setup recovers from a failed refresh without retiring the agent', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let leases = 0;
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/v1/connect' &&
      response.request().method() === 'POST' &&
      response.ok()
    )
      leases++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'New', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
  await page.getByLabel('Search Hermes agents', { exact: true }).fill('existing');
  await page.getByRole('button', { name: /Existing Example.*existing-example/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Keep this name');
  let fail = true;
  await page.route('**/v1/rpc', async (route) => {
    if (fail && route.request().postDataJSON().operation === 'workspace.describe') {
      fail = false;
      return route.fulfill({ status: 503, json: { code: 'DISCONNECTED' } });
    }
    await route.fallback();
  });
  const breakStream = () =>
    page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await breakStream();
  await expect(page.getByText('Could not refresh this profile.', { exact: false })).toBeVisible();
  const before = leases;
  await breakStream();
  await expect.poll(() => leases).toBeGreaterThan(before);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Keep this name');
  await expect(page.getByRole('button', { name: 'Add pebble', exact: true })).toBeEnabled();
  await expect(page.getByText('Could not refresh this profile.', { exact: false })).toHaveCount(0);
});
