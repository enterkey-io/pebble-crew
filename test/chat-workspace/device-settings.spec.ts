import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('owner creates a connection QR and revokes only the chosen native device', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let rows = [
    { id: 'synthetic-device-mac', name: 'Mac', lastSeen: 1792500000000 },
    { id: 'synthetic-device-phone', name: 'iPhone', lastSeen: 1792500000000 },
  ];
  let created = 0;
  let pairingState: 'pending' | 'connecting' | 'connected' = 'pending';
  await context.route('**/api/devices**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/devices/invitation') {
      created++;
      await route.fulfill({
        status: 201,
        json: {
          id: 'a'.repeat(64),
          link: `https://owner.fixture.invalid/connect-device#invitation=${'A'.repeat(43)}`,
          desktopLink: `pebblecrew://connect?origin=https%3A%2F%2Fowner.fixture.invalid#invitation=${'A'.repeat(43)}`,
          expires: Date.now() + 300000,
        },
      });
    } else if (path === '/api/devices/invitation/status') {
      await route.fulfill({ json: { state: pairingState, name: 'New iPhone' } });
    } else if (path === '/api/devices/revoke') {
      const body: unknown = route.request().postDataJSON();
      if (body && typeof body === 'object' && 'id' in body)
        rows = rows.filter((row) => row.id !== body.id);
      await route.fulfill({ json: { revoked: true } });
    } else await route.fulfill({ json: { devices: rows } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'Your account', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Requests', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Devices', exact: true }).click();
  const devices = page.getByRole('region', { name: 'Devices', exact: true });
  await expect(devices.getByText('Mac', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add a device', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a device', exact: true });
  await expect(
    dialog.getByText('On your phone, open Pebble Crew and tap Scan QR code.', { exact: true }),
  ).toBeVisible();
  const qr = dialog.getByRole('img', { name: 'Pebble Crew device connection QR code' });
  await expect(qr).toBeVisible();
  await expect
    .poll(() => qr.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(200);
  await expect(
    dialog.getByRole('button', { name: 'Connect Pebble Crew on this Mac', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Copy Mac setup link', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Connect using a copied link', exact: true }).click();
  await expect(
    dialog.getByText('Copy this link, then paste it into the Pebble Crew app on your Mac.'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Copy Mac setup link', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Connect using a copied link', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Add a device', exact: true })).toBeInViewport();
  await expect(qr).toBeInViewport({ ratio: 1 });
  expect(created).toBe(1);
  await page.screenshot({ path: test.info().outputPath('device-qr.png'), animations: 'disabled' });
  pairingState = 'connecting';
  await expect(
    dialog.getByRole('status', { name: 'Connecting device', exact: true }),
  ).toBeVisible();
  await expect(qr).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Connect Pebble Crew on this Mac', exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Copy Mac setup link', exact: true }),
  ).toHaveCount(0);
  await expect(devices.getByText('New iPhone', { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('device-connecting.png'),
    animations: 'disabled',
  });
  rows.push({ id: 'synthetic-new-device', name: 'New iPhone', lastSeen: Date.now() });
  pairingState = 'connected';
  await expect(dialog).toHaveCount(0);
  await expect(devices.getByText('New iPhone', { exact: true })).toBeVisible();
  await expect(page.getByText('New iPhone connected.', { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('device-connected.png'),
    animations: 'disabled',
  });
  await devices.getByRole('button', { name: 'Revoke access', exact: true }).first().click();
  await expect(devices.getByText('Mac', { exact: true })).toHaveCount(0);
  await expect(devices.getByText('iPhone', { exact: true })).toBeVisible();
});

test('expired invitations recover with a new code in light mode', async ({ page, context }) => {
  await installFixture(context);
  await page.emulateMedia({ colorScheme: 'light' });
  let state = 'pending';
  let created = 0;
  await context.route('**/api/devices**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/devices/invitation') {
      created++;
      state = 'pending';
      return route.fulfill({
        status: 201,
        json: {
          id: String(created).repeat(64),
          link: `https://owner.fixture.invalid/connect-device#invitation=${'A'.repeat(43)}`,
          desktopLink: `pebblecrew://connect?origin=https%3A%2F%2Fowner.fixture.invalid#invitation=${'A'.repeat(43)}`,
          expires: Date.now() + 300000,
        },
      });
    }
    if (path.endsWith('/status')) return route.fulfill({ json: { state } });
    return route.fulfill({ json: { devices: [] } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'Your account', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Devices', exact: true }).click();
  await page.getByRole('button', { name: 'Add a device', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a device', exact: true });
  await expect(dialog.getByRole('img')).toBeVisible();
  state = 'expired';
  await expect(
    dialog.getByText('This code has expired. Create a new one to connect.'),
  ).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Create a new code', exact: true }).click();
  await expect(dialog.getByRole('img')).toBeVisible();
  expect(created).toBe(2);
  await page.screenshot({
    path: test.info().outputPath('device-qr-light.png'),
    animations: 'disabled',
  });
});
