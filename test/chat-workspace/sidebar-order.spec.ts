import { test, expect } from '@playwright/test';
import { emit, installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('recent conversations rise within their section and leave the pins in place', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, {
    organization: {
      revision: 1,
      sections: [
        { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
        ...[
          { id: 'research', name: 'Research', ids: [2, 3] },
          { id: 'operations', name: 'Operations', ids: [4, 5] },
        ].map(({ id, name, ids }) => ({
          id,
          name,
          collapsed: false,
          items: ids.map((index) => ({
            kind: 'pebble' as const,
            id: `identity-${index}`,
            placementId: `placement-${index}`,
            shortcut: false,
          })),
        })),
      ],
    },
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  const research = page.getByRole('region', { name: 'Research' }).locator('.pebble-row');
  const operations = page.getByRole('region', { name: 'Operations' }).locator('.pebble-row');
  await expect(research.first()).toContainText('Rowan');
  await expect(operations.first()).toContainText('Ember');
  fixture.state.bots.find((bot) => bot.profile === 'sage')!.last_activity = 1700000201.5;
  fixture.state.bots.find((bot) => bot.profile === 'mica')!.last_activity = 1700000202.5;
  await emit(page, 'workspace.changed');
  await expect(research.first()).toContainText('Sage');
  await expect(operations.first()).toContainText('Ember');
  await expect(page.locator('.pc-pin strong')).toHaveText(['Arlo', 'Mica']);
});

test('pin drag shows the new order before saving and restores it on cancel', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let writes = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'presentation.order') writes++;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  const grid = page.locator('.pc-pins');
  const order = grid.locator('strong');
  const first = grid.locator('.pc-pin').filter({ hasText: 'Arlo' });
  const second = grid.locator('.pc-pin').filter({ hasText: 'Mica' });
  await expect(order).toHaveText(['Arlo', 'Mica']);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const slot = (tile: typeof first) =>
    tile.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const container = element.parentElement!.getBoundingClientRect();
      return { x: bounds.x - container.x, y: bounds.y - container.y };
    });
  const original = await slot(first);
  const distanceToFirst = async (tile: typeof first) => {
    const point = await slot(tile);
    return Math.hypot(point.x - original.x, point.y - original.y);
  };
  const start = async () => {
    const box = (await second.boundingBox())!;
    await first.dispatchEvent('dragstart', { dataTransfer: transfer });
    await grid.dispatchEvent('dragover', {
      dataTransfer: transfer,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    });
    await expect(order).toHaveText(['Mica', 'Arlo']);
    await expect(first.getByRole('button')).toHaveCSS('opacity', '0');
    await expect.poll(() => distanceToFirst(second)).toBeLessThan(1);
    expect(writes).toBe(0);
  };
  await start();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('pin-drag-preview.png') });
  await first.dispatchEvent('dragend', { dataTransfer: transfer });
  await expect(order).toHaveText(['Arlo', 'Mica']);
  await expect.poll(() => distanceToFirst(first)).toBeLessThan(1);
  expect(writes).toBe(0);
  await start();
  await grid.dispatchEvent('drop', { dataTransfer: transfer });
  await first.dispatchEvent('dragend', { dataTransfer: transfer });
  await expect.poll(() => writes).toBe(1);
  await expect(order).toHaveText(['Mica', 'Arlo']);
  await transfer.dispose();
});
