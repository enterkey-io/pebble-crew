import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';
import { expectPinnedLayout } from '../chat-workspace/pinned-layout';
test.use({ serviceWorkers: 'block' });
test('regular and pinned pebble menus have full touch targets aligned to their right edge', async ({
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
    const trigger = page.getByRole('button', { name: `Actions for ${name}`, exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    const parent = trigger.locator(
      'xpath=ancestor::*[contains(@class,"pc-row") or contains(@class,"pc-pin")][1]',
    );
    const box = (await trigger.boundingBox())!;
    const row = (await parent.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(row.x + row.width - (box.x + box.width)).toBeLessThanOrEqual(5);
    await trigger.tap();
    const menu = page.getByRole('menu', { name: `Actions for ${name}`, exact: true });
    await expect(menu).toBeVisible();
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
    await expect(trigger).toBeFocused();
  }
});
