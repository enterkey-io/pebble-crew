import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { organization, showRail } from './section-fixture';
test.use({ serviceWorkers: 'block' });

test('a shortcut remains a separate placement pointing at the same pebble', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { organization: organization() });
  fixture.state.bots.forEach((b) => {
    b.pinned = false;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const north = page.getByRole('region', { name: 'North', exact: true }).filter({ visible: true });
  const row = north.locator('[data-placement-id="row-identity-0"]');
  await row.getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add shortcut', exact: true }).click();
  const shortcut = page
    .getByRole('group', { name: 'Unsectioned conversations', exact: true })
    .filter({ visible: true })
    .locator('.pebble-row')
    .filter({ has: page.getByRole('button', { name: /^Arlo / }) });
  await expect(shortcut).toBeVisible();
  await expect(row).toBeVisible();
  await shortcut.getByRole('button').click();
  await expect(page.locator('.pc-chat-header')).toContainText('Arlo');
  await showRail(page);
  await shortcut.getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove shortcut', exact: true }).click();
  await expect(shortcut).toHaveCount(0);
  await expect(row).toBeVisible();
  await page.screenshot({ path: info.outputPath('section-shortcut.png'), animations: 'disabled' });
});
