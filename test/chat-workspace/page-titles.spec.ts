import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installWorkFixture } from './work-fixture';
import { openSidebarMenu } from '../sidebar-menu';

test.use({ serviceWorkers: 'block' });
async function rail(page: Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
async function account(page: Page, item: string) {
  await rail(page);
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
test('document titles follow the visible page and restore the conversation after editors close', async ({
  page,
  context,
}) => {
  await installWorkFixture(context);
  await page.route('**/api/devices', (route) => route.fulfill({ json: { devices: [] } }));
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page).toHaveTitle('Arlo — Pebble Crew');
  await rail(page);
  await page
    .locator('.pc-pins')
    .filter({ visible: true })
    .getByRole('button', { name: /Mica/ })
    .click();
  await expect(page).toHaveTitle('Mica — Pebble Crew');
  await account(page, 'Settings');
  await expect(page).toHaveTitle('General settings — Pebble Crew');
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await expect(page).toHaveTitle('Connections — Pebble Crew');
  await expect(page.getByRole('tab', { name: 'Requests', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Devices', exact: true }).click();
  await expect(page).toHaveTitle('Devices — Pebble Crew');
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page).toHaveTitle('Mica — Pebble Crew');
  await account(page, 'Org chart');
  await expect(page).toHaveTitle('Org chart — Pebble Crew');
  await page.getByRole('button', { name: 'Close Org chart', exact: true }).click();
  await expect(page).toHaveTitle('Mica — Pebble Crew');
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await expect(page).toHaveTitle('Profile · Mica — Pebble Crew');
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await expect(page).toHaveTitle('Role · Mica — Pebble Crew');
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  await expect(page).toHaveTitle('Mica — Pebble Crew');
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await expect(page).toHaveTitle('General tasks — Pebble Crew');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page).toHaveTitle('New task — Pebble Crew');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveTitle('General tasks — Pebble Crew');
  await rail(page);
  await page.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page).toHaveTitle('Mica — Pebble Crew');
});
