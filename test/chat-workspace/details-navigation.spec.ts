import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('details uses an edit icon and keeps the Files tab selected through reconnect', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let connections = 0;
  const fileErrors: number[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/connect')) connections++;
  });
  page.on('response', (response) => {
    if (
      response.url().endsWith('/v1/rpc') &&
      response.request().postDataJSON().operation === 'files.list' &&
      !response.ok()
    )
      fileErrors.push(response.status());
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  if (page.viewportSize()!.width < 768)
    await expect(details.getByRole('tab', { name: 'Routines', exact: true })).toBeFocused();
  const edit = details.getByRole('button', { name: 'Edit Arlo', exact: true });
  await expect(edit).toBeVisible();
  await expect(edit.locator('svg')).toHaveCount(1);
  await expect(edit).toHaveText('');
  await expect(details.getByText('Edit pebble', { exact: true })).toHaveCount(0);
  const files = details.getByRole('tab', { name: 'Files', exact: true });
  await files.click();
  await expect(details.getByText('No files shared here yet.', { exact: true })).toBeVisible();
  const beforeReconnect = connections;
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect.poll(() => connections).toBeGreaterThan(beforeReconnect);
  await expect(page.locator('.connection-status')).toHaveAttribute('data-online', 'true');
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await expect(details.getByText('No files shared here yet.', { exact: true })).toBeVisible();
  await expect(details.getByRole('alert')).toHaveCount(0);
  expect(fileErrors).toEqual([]);
  await page.mouse.move(0, 0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('details-files.png') });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit pebble', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Edit Arlo', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Arlo');
  await dialog.getByRole('button', { name: 'Close Edit Arlo', exact: true }).click();
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await details.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.pc-details-slot').boundingBox())?.width ?? 1)
    .toBeLessThan(0.5);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const composer = page.locator('[data-slot="prompt-input"]').last();
  await expect.poll(async () => (await composer.boundingBox())?.height ?? 1000).toBeLessThan(85);
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Ready');
  const inputBox = await field.boundingBox();
  const sendBox = await page
    .getByRole('button', { name: 'Send message', exact: true })
    .boundingBox();
  expect(
    Math.abs(inputBox!.y + inputBox!.height / 2 - (sendBox!.y + sendBox!.height / 2)),
  ).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('composer-after-details.png') });
});

test('a failed file load offers retry without claiming the conversation has no files', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let fail = true;
  await page.route('**/v1/rpc', async (route) => {
    if (fail && route.request().postDataJSON().operation === 'files.list')
      await route.fulfill({ status: 503, json: { code: 'REQUEST_FAILED' } });
    else await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  await details.getByRole('tab', { name: 'Files', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Files could not be loaded.');
  await expect(details.getByText('No files shared here yet.', { exact: true })).toHaveCount(0);
  fail = false;
  await details.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(details.getByText('No files shared here yet.', { exact: true })).toBeVisible();
  await expect(details.getByRole('alert')).toHaveCount(0);
});

test('Files stays discoverable when the connection cannot provide attachments', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { attachments: false });
  let fileCalls = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/rpc') && request.postDataJSON().operation === 'files.list')
      fileCalls++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  await details.getByRole('tab', { name: 'Files', exact: true }).click();
  await expect(details.getByText('Files aren’t available on this connection.')).toBeVisible();
  expect(fileCalls).toBe(0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('files-unavailable.png') });
});
