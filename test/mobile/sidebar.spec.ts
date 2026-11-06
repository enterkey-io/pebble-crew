import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';
import { sidebarItem } from '../sidebar-menu';
import { expectPinnedLayout } from '../chat-workspace/pinned-layout';
test.use({ serviceWorkers: 'block' });
test('pebbles, pins, groups and sections open their menu on press-and-hold', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    roomDisband: true,
    organization: {
      revision: 0,
      sections: [
        {
          id: 'pebbles',
          name: 'Pebbles',
          collapsed: false,
          items: [
            {
              id: 'identity-2',
              kind: 'pebble',
              placementId: 'row-identity-2',
              shortcut: false,
            },
          ],
        },
        { id: 'work', name: 'Work', collapsed: false, items: [] },
      ],
    },
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  const navigation = page.getByRole('region', { name: 'navigation', exact: true });
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
  const account = (await navigation
    .getByRole('button', { name: 'Your account', exact: true })
    .boundingBox())!;
  expect(add.x - (account.x + account.width)).toBeGreaterThan(100);
  expect((await navigation.boundingBox())!.width).toBe(page.viewportSize()!.width);
  for (const name of ['Rowan', 'Arlo', 'Research crew', 'Work section']) {
    const item = sidebarItem(page, name);
    const trigger = item.getByRole('button', { includeHidden: true }).first();
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await expect(item.locator('.pc-overflow,.pc-pin-actions')).toHaveCount(0);
    const box = (await trigger.boundingBox())!;
    const pointer = {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    };
    await trigger.dispatchEvent('pointerdown', pointer);
    await trigger.dispatchEvent('pointermove', { ...pointer, clientX: pointer.clientX + 2 });
    if (name === 'Research crew') {
      await trigger.dispatchEvent('pointercancel', pointer);
      await trigger.dispatchEvent('dragstart', {
        dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
      });
    }
    const menu = page.getByRole('menu', { name: `Actions for ${name}`, exact: true });
    await expect(menu).toBeVisible();
    await trigger.dispatchEvent('pointerup', pointer);
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
    if (name === 'Research crew') {
      await menu.getByRole('menuitem', { name: 'Delete group', exact: true }).tap();
      const confirmation = page.getByRole('alertdialog', { name: 'Delete Research crew?' });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: 'Cancel' }).tap();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(trigger).toBeVisible();
  }
});

for (const when of ['before', 'after'] as const) {
  test(`drag owns the gesture ${when} the long-press menu opens`, async ({ page, context }) => {
    await installFixture(context);
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
    const item = sidebarItem(page, 'Rowan');
    const trigger = item.getByRole('button', { includeHidden: true }).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.evaluate((node) => {
      node.setAttribute('data-original-drag-target', 'true');
    });
    const box = (await trigger.boundingBox())!;
    const pointer = {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    };
    await trigger.dispatchEvent('pointerdown', pointer);
    const menu = page.getByRole('menu', { name: 'Actions for Rowan', exact: true });
    if (when === 'after') await expect(menu).toBeVisible();
    await trigger.dispatchEvent('pointermove', { ...pointer, clientX: pointer.clientX + 20 });
    await trigger.dispatchEvent('dragstart', {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    });
    await expect(menu).toBeHidden();
    // The pending hold must not reopen after the native drag finishes.
    await trigger.dispatchEvent('dragend');
    await page.waitForTimeout(800);
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('data-original-drag-target', 'true');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents))
      .not.toBe('none');
    await trigger.dispatchEvent('contextmenu', {
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    });
    await expect(menu).toBeHidden();
    // A new stationary gesture still opens the same accessible menu.
    await trigger.dispatchEvent('pointerdown', pointer);
    await expect(menu).toBeVisible();
    await trigger.dispatchEvent('pointerup', pointer);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await trigger.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
}

test('trusted touch hold opens the menu without opening the chat on release', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Playwright exposes touch sequences through CDP.');
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const navigation = page.getByRole('region', { name: 'navigation', exact: true });
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  await expect.poll(async () => (await navigation.boundingBox())?.x).toBeCloseTo(0, 0);
  const row = sidebarItem(page, 'Rowan');
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const client = await context.newCDPSession(page);
  const point = (offset: number) => [
    { x: box.x + box.width / 2 + offset, y: box.y + box.height / 2, id: 1 },
  ];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(2) });
  const menu = page.getByRole('menu', { name: 'Actions for Rowan', exact: true });
  await expect(menu).toBeVisible();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(navigation).toBeVisible();
});
