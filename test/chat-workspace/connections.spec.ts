import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture } from './fixtures';
import { connectionFixture, openConnections } from './connections-fixture';

test('Connections overview is a compact list; discovery and edits live in focused views', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const fixture = await connectionFixture(page);
  await openConnections(page);
  await expect(page.locator('.connection-list .connection-row')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'API key' })).toHaveCount(0);
  expect(fixture.calls.map((c) => c.operation)).toEqual(['connections.list']);
  for (const row of await page.locator('.connection-list .connection-row').all())
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(88);
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/connections-overview-desktop.png',
  });
  await page.locator('.connection-row').filter({ hasText: 'Papertrail' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add or replace API key' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Tool access/ })).toContainText(
    'Uses Hermes tool settings',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/connections-oauth-desktop.png',
  });
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.locator('.connection-row').filter({ hasText: 'Papertrail' })).toBeFocused();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search services' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search services' }).fill('nonsense');
  await expect(page.getByText('No matching services', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search services' }).fill('calendar');
  await expect(page.locator('.connection-catalog .connection-row')).toHaveCount(1);
  let finishAdd = () => {};
  fixture.pendingAdd.wait = new Promise<void>((resolve) => {
    finishAdd = resolve;
  });
  await page.getByRole('button', { name: 'Add Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connections', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Pebble' })).toBeDisabled();
  finishAdd();
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(fixture.calls.find((c) => c.operation === 'connections.add')?.params.profile).toBe('arlo');
});

test('tool discovery preserves native policy; an explicit edit is guarded and saved only on confirmation', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const fixture = await connectionFixture(page);
  await openConnections(page);
  await page.locator('.connection-row').filter({ hasText: 'Papertrail' }).click();
  await page.getByRole('button', { name: /Tool access/ }).click();
  await expect(page.getByRole('button', { name: 'Choose tools', exact: true })).toBeVisible();
  expect(fixture.policies.get('Papertrail')).toBeNull();
  expect(
    fixture.calls.some((c) => c.operation === 'connections.permissions' && c.params.tools),
  ).toBe(false);
  await page.getByRole('button', { name: 'Choose tools', exact: true }).click();
  await page.getByRole('checkbox', { name: 'search_documents', exact: true }).check();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('Tool access saved. Applies when this pebble restarts.'),
  ).toBeVisible();
  expect(fixture.policies.get('Papertrail')).toEqual(['search_documents']);
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/connections-tools-desktop.png',
  });
});

test('OAuth completion refreshes the native tool policy; failed key saves never claim success', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const fixture = await connectionFixture(page);
  await openConnections(page);
  await page.locator('.connection-row').filter({ hasText: 'Papertrail' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const signIn = page.getByRole('link', { name: 'Continue sign-in' });
  await expect(signIn).toHaveAttribute('href', 'https://auth.example.test/authorize');
  await expect(signIn).toHaveAttribute('rel', 'noopener noreferrer');
  fixture.control.approve = true;
  await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tool access/ })).toContainText('No tools allowed');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.locator('.connection-row').filter({ hasText: 'Papertrail' })).toContainText(
    'Configured',
  );
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Tool access/ }).click();
  await page.getByRole('checkbox', { name: 'document_action_1', exact: true }).check();
  await page.getByRole('button', { name: 'Add or replace API key' }).click();
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('synthetic-key');
  fixture.control.keySaved = false;
  await page.getByRole('button', { name: 'Save key', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Change not confirmed');
  await expect(page.getByText('API key saved.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'API key', exact: true })).toHaveValue(
    'synthetic-key',
  );
  fixture.control.keySaved = true;
  await page.getByRole('button', { name: 'Save key', exact: true }).click();
  await expect(page.getByText('API key saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'API key' })).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'document_action_1', exact: true }),
  ).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  expect(fixture.policies.get('Archive')).toEqual(['search_documents']);
});

test('catalog and permission failures do not hide configured services or fabricate a setup requirement', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const fixture = await connectionFixture(page);
  fixture.control.catalogError = true;
  await openConnections(page);
  await expect(page.locator('.connection-list .connection-row')).toHaveCount(6);
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Services unavailable');
  fixture.control.catalogError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Calendar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'About Desktop setup', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Desktop needs setup in Hermes');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeFocused();
  fixture.control.permissionsError = true;
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).click();
  await expect(page.getByRole('alert')).toContainText('Connection details unavailable');
  fixture.control.permissionsError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /Tool access/ })).toBeVisible();
});
