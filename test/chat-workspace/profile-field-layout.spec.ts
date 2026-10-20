import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import { test, expect, type Page } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });
async function fieldLayout(page: Page) {
  for (const shape of await page
    .getByRole('group', { name: 'Avatar shape', exact: true })
    .locator('svg')
    .all()) {
    const bounds = (await shape.boundingBox())!;
    expect(
      bounds.width,
      'Shape previews must not inherit the default 16px control-icon size',
    ).toBeGreaterThanOrEqual(32);
    expect(bounds.height).toBeGreaterThanOrEqual(32);
  }
  for (const name of ['Name', 'Title', 'Description']) {
    const input = page.getByLabel(name, { exact: true });
    await expect(input).toBeVisible();
    const measured = await input.evaluate((node) => {
      const label = node.closest('label');
      if (!label?.firstChild) throw new Error('Unlabelled field');
      const range = document.createRange();
      range.selectNodeContents(label.firstChild);
      const text = range.getBoundingClientRect(),
        field = node.getBoundingClientRect();
      return {
        textLeft: text.left,
        fieldLeft: field.left,
        textBottom: text.bottom,
        fieldTop: field.top,
      };
    });
    expect(
      Math.abs(measured.textLeft - measured.fieldLeft),
      `${name} starts at field edge`,
    ).toBeLessThanOrEqual(2);
    expect(measured.textBottom, `${name} sits above its field`).toBeLessThanOrEqual(
      measured.fieldTop + 1,
    );
  }
}
test('Add and Edit keep field labels aligned with their controls', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'New', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Create new pebble', exact: true }).click();
  await fieldLayout(page);
  await page.screenshot({ path: info.outputPath('new-fields.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /^Close Create a pebble$/ }).click();
  if (!(await sidebarItem(page, 'Mica').isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await fieldLayout(page);
  await page.screenshot({ path: info.outputPath('edit-fields.png'), animations: 'disabled' });
});
