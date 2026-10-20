import { openSidebarMenu } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('default pebbles are a flat list even when their old section was collapsed', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'organization.get') return route.fallback();
    await route.fulfill({
      json: {
        result: {
          revision: 0,
          sections: [
            { id: 'crews', name: 'Crews', collapsed: false, items: [] },
            {
              id: 'pebbles',
              name: 'Pebbles',
              collapsed: true,
              items: fixture.state.bots.map((bot) => ({ kind: 'pebble', id: bot.id })),
            },
          ],
          crews: [],
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const phone = page.viewportSize()!.width < 768;
  if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const rail = phone
    ? page.getByRole('dialog', { name: 'navigation' })
    : page.getByRole('complementary', { name: 'Pebbles and crews' });
  const list = rail.getByRole('group', { name: 'Unsectioned pebbles', exact: true });
  await expect(list.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Pebbles', exact: true })).toHaveCount(0);
  await expect(list.locator('.pc-section-header')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('flat-pebble-list.png') });
});

test('custom sections are optional and None returns a pebble to the plain list', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const phone = page.viewportSize()!.width < 768;
  if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const rail = phone
    ? page.getByRole('dialog', { name: 'navigation' })
    : page.getByRole('complementary', { name: 'Pebbles and crews' });
  await rail.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New section', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New section', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Studio');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const studio = rail.getByRole('region', { name: 'Studio', exact: true });
  await openSidebarMenu(page, 'Rowan');
  await page.getByRole('menuitem', { name: 'Move to section', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Pebbles', exact: true })).toHaveCount(0);
  await page.getByRole('menuitemcheckbox', { name: 'Studio', exact: true }).click();
  await expect(studio.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toBeVisible();
  await openSidebarMenu(page, 'Rowan');
  await page.getByRole('menuitem', { name: 'Move to section', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'None', exact: true }).click();
  const list = rail.getByRole('group', { name: 'Unsectioned pebbles', exact: true });
  await expect(list.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toBeVisible();
  await expect(studio.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toHaveCount(0);
});
