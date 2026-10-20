import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';
import { sidebarItem } from '../sidebar-menu';
import { expectPinnedLayout } from '../chat-workspace/pinned-layout';
test.use({ serviceWorkers: 'block' });
test('regular and pinned pebbles open the shared menu on press-and-hold without overflow buttons', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  const navigation = page.getByRole('dialog', { name: 'navigation', exact: true });
  await expectPinnedLayout(navigation.locator('.pinned-tile'));
  await page.screenshot({
    animations: 'disabled',
    scale: 'css',
    path: info.outputPath('sidebar-pins.png'),
  });
  expect((await navigation.boundingBox())!.width).toBeGreaterThanOrEqual(
    Math.min(360, page.viewportSize()!.width - 24) - 0.25,
  );
  const add = (await navigation.getByRole('button', { name: 'New', exact: true }).boundingBox())!;
  const close = (await navigation
    .getByRole('button', { name: 'Close navigation', exact: true })
    .boundingBox())!;
  expect(close.x - (add.x + add.width)).toBeGreaterThanOrEqual(7.75);
  for (const name of ['Rowan', 'Arlo']) {
    const item = sidebarItem(page, name);
    const trigger = item.getByRole('button', { includeHidden: true }).first();
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await expect(item.locator('.pc-overflow,.pc-pin-actions')).toHaveCount(0);
    const box = (await trigger.boundingBox())!;
    await trigger.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    });
    const menu = page.getByRole('menu', { name: `Actions for ${name}`, exact: true });
    await expect(menu).toBeVisible();
    await trigger.dispatchEvent('pointerup', {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      button: 0,
    });
    await menu.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      animations: 'disabled',
      scale: 'css',
      path: info.outputPath(`sidebar-${name.toLowerCase()}.png`),
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeVisible();
  }
});
