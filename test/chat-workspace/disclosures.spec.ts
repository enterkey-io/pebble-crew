import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('Role disclosure spaces its explanation and action, supports keyboard, and stays within the editor', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await sidebarItem(page, 'Mica').isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Make Main Pebble', exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const section = page.locator('[data-slot="disclosure"]').filter({ has: trigger });
  const body = section.locator('[data-slot="disclosure-body"]');
  const action = body.getByRole('button', { name: 'Make Mica Main Pebble', exact: true });
  await expect(action).toBeVisible();
  await section.locator('[data-slot="disclosure-content"]').evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  await expect(body).toHaveCSS('row-gap', '16px');
  expect(
    await body.locator('p').evaluate((p) => {
      const style = getComputedStyle(p);
      return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
    }),
  ).toBeGreaterThanOrEqual(1.4);
  const description = (await body.locator('p').boundingBox())!;
  const button = (await action.boundingBox())!;
  expect(button.y - description.y - description.height).toBeGreaterThanOrEqual(15);
  const container = (await section.boundingBox())!;
  expect(button.x).toBeGreaterThanOrEqual(container.x);
  expect(button.x + button.width).toBeLessThanOrEqual(container.x + container.width + 1);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('role-disclosure.png') });
  await trigger.click();
  await expect(action).toBeHidden();
});

test('new pebble model and personality disclosure uses the same spaced fields', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await page.getByRole('button', { name: 'New', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Create new pebble', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Model and personality', exact: true });
  await trigger.click();
  const body = page
    .locator('[data-slot="disclosure"]')
    .filter({ has: trigger })
    .locator('[data-slot="disclosure-body"]');
  const personality = body.getByLabel('Personality', { exact: true });
  await expect(personality).toBeVisible();
  await body.locator('..').evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  await personality.scrollIntoViewIfNeeded();
  await expect(personality).toBeInViewport({ ratio: 1 });
  await expect(body).toHaveCSS('row-gap', '16px');
  const text = (await body.locator('p').boundingBox())!;
  const label = (await body.locator('label').boundingBox())!;
  expect(label.y - text.y - text.height).toBeGreaterThanOrEqual(15);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('new-pebble-disclosure.png'),
  });
});
