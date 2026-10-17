import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { connectionFixture, openConnections } from './connections-fixture';

test.use({ serviceWorkers: 'block' });

test('unsaved connection tools and key survive a new transport lease', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await connectionFixture(page);
  let leases = 0;
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/v1/connect' &&
      response.request().method() === 'POST' &&
      response.ok()
    )
      leases++;
  });
  await openConnections(page);
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).click();
  await page.getByRole('button', { name: /Tool access/ }).click();
  const changedTool = page.getByRole('checkbox', { name: 'document_action_15', exact: true });
  await changedTool.check();
  await page.getByRole('button', { name: 'Add or replace API key', exact: true }).click();
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('synthetic-unsaved-key');
  const initial = leases;
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect.poll(() => leases).toBeGreaterThan(initial);
  await expect(page.locator('.connection-status')).toContainText('Hermes connected');
  await expect(changedTool).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'API key', exact: true })).toHaveValue(
    'synthetic-unsaved-key',
  );
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('connection-draft-restored.png'),
  });
});

test('a changed remote tool policy requires an explicit keep or discard decision', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const fixture = await connectionFixture(page);
  await openConnections(page);
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).click();
  await page.getByRole('button', { name: /Tool access/ }).click();
  await page.getByRole('checkbox', { name: 'document_action_15', exact: true }).check();
  fixture.policies.set('Archive', ['document_action_1']);
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(page.getByText('Tool access changed elsewhere.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: 'document_action_15', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Keep my changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('Tool access saved. Applies when this pebble restarts.'),
  ).toBeVisible();
  expect(fixture.policies.get('Archive')).toEqual(['search_documents', 'document_action_15']);
});
