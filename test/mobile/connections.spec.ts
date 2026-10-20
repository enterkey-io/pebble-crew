import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture } from '../chat-workspace/fixtures';
import { connectionFixture, openConnections } from '../chat-workspace/connections-fixture';
test.use({ serviceWorkers: 'block' });

test('phone connections have focused, scrollable service and credential flows', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await connectionFixture(page);
  await openConnections(page);
  await expect(page.locator('.connection-list .connection-row')).toHaveCount(6);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('connections-overview.png'),
  });
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).tap();
  await page.getByRole('button', { name: 'Add or replace API key' }).tap();
  const field = page.getByRole('textbox', { name: 'API key', exact: true });
  await expect(field).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeInViewport();
  expect(await page.locator('.pc-shell').evaluate((node) => node.scrollTop)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  expect(
    await field.evaluate((n) => parseFloat(getComputedStyle(n).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect((await field.boundingBox())!.x).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('connections-api-key.png'),
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await page.getByRole('button', { name: /Tool access/ }).tap();
  await expect(page.getByRole('checkbox')).toHaveCount(16);
  await expect(page.getByRole('checkbox', { name: 'search_documents', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'document_action_15', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
  await page
    .getByRole('checkbox', { name: 'document_action_8', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
  await page.screenshot({
    animations: 'disabled',
    scale: 'css',
    path: info.outputPath('connections-tools.png'),
  });
  await page.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(
    page.getByText('Tool access saved. Applies when this pebble restarts.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).tap();
  await page.getByRole('button', { name: 'Add connection', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeInViewport();
  expect(await page.locator('.pc-shell').evaluate((node) => node.scrollTop)).toBe(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('connections-catalog.png'),
  });
  await page.getByRole('textbox', { name: 'Search services' }).fill('Calendar');
  await page.getByRole('button', { name: 'Add Calendar', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('connections-oauth.png') });
});
