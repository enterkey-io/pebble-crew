import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
import { organization, showRail } from './section-fixture';
test('sections collapse without opening or creating a group and preserve rows after reload', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { organization: organization() });
  fixture.state.bots.forEach((b) => {
    b.pinned = false;
  });
  let creates = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/rpc') && r.postDataJSON().operation === 'room.create') creates++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const north = page.getByRole('region', { name: 'North', exact: true }).filter({ visible: true });
  await expect(north.locator('[data-placement-id]')).toHaveCount(2);
  await expect(north.locator('.pc-section-toggle')).toHaveCSS('justify-content', 'flex-start');
  await north.getByRole('button', { name: 'North', exact: true }).click();
  await expect(north.locator('[data-placement-id]')).toHaveCount(0);
  expect(creates).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await expect(north.getByRole('button', { name: 'North', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await north.getByRole('button', { name: 'North', exact: true }).click();
  await expect(north.locator('[data-placement-id]')).toHaveCount(2);
  await expect
    .poll(() =>
      north
        .locator('.pc-section-items')
        .evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight)),
    )
    .toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('sections-only.png'), animations: 'disabled' });
});

test('a direct row moves between sections and does not gain group membership', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context, { organization: organization() });
  fixture.state.bots.forEach((b) => {
    b.pinned = false;
  });
  let creates = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/rpc') && r.postDataJSON().operation === 'room.create') creates++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const north = page.getByRole('region', { name: 'North', exact: true }).filter({ visible: true }),
    south = page.getByRole('region', { name: 'South', exact: true }).filter({ visible: true });
  const row = north.locator('[data-placement-id="row-identity-0"]');
  await row.getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to section', exact: true }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'South', exact: true }).click();
  await expect(south.locator('[data-placement-id="row-identity-0"]')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(creates).toBe(0);
});

test('the new menu offers sections and explicit groups without Crew creation', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'New crew', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'New group chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New group chat', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Project discussion');
  const checks = dialog.getByRole('checkbox');
  await checks.nth(2).check();
  await checks.nth(3).check();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('.pc-chat-header')).toContainText('Project discussion');
});
