import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { installFixture } from './fixtures';
import { organization, showRail } from './section-fixture';

test.use({ serviceWorkers: 'block' });

async function startDrag(page: Page, source: Locator, phone: boolean) {
  await source.scrollIntoViewIfNeeded();
  const transfer = phone ? await page.evaluateHandle(() => new DataTransfer()) : undefined;
  if (transfer) await source.dispatchEvent('dragstart', { dataTransfer: transfer });
  else {
    const box = (await source.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 3 });
  }
  return {
    async over(target: Locator, fraction: number) {
      if (transfer) await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height * fraction };
      if (transfer) await target.dispatchEvent('dragover', { dataTransfer: transfer, ...point });
      else {
        await target.hover({ position: { x: box.width / 2, y: box.height * fraction } });
        const settled = (await target.boundingBox())!;
        await page.mouse.move(
          settled.x + settled.width / 2 + 1,
          settled.y + settled.height * fraction,
        );
      }
    },
    async drop(target: Locator) {
      if (transfer) {
        await target.dispatchEvent('drop', { dataTransfer: transfer });
        await transfer.dispose();
      } else await page.mouse.up();
    },
    async cancel() {
      if (transfer) {
        await source.dispatchEvent('dragend', { dataTransfer: transfer });
        await transfer.dispose();
      } else {
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
    },
  };
}

for (const theme of ['dark', 'light']) {
  test(`section dragging opens a movable insertion gap, persists only on drop in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context, { organization: organization() });
    fixture.state.bots.splice(6);
    fixture.state.bots.forEach((bot) => {
      bot.pinned = false;
    });
    await page.addInitScript(
      (value) => localStorage.setItem('pebble-crew.appearance', value),
      theme,
    );
    let writes = 0;
    page.on('request', (request) => {
      if (
        request.url().endsWith('/v1/rpc') &&
        request.postDataJSON().operation === 'organization.save'
      )
        writes++;
    });
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await showRail(page);
    const north = page.getByRole('region', { name: 'North', exact: true });
    const south = page.getByRole('region', { name: 'South', exact: true });
    const west = page.getByRole('region', { name: 'West', exact: true });
    const stack = north.locator('..');
    const gap = stack.locator('[data-section-insertion]');
    const names = () =>
      stack
        .locator('.pc-list')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    const northTop = (await north.boundingBox())!.y - (await stack.boundingBox())!.y;
    const first = await startDrag(
      page,
      west.locator('.pc-section-header'),
      !!info.project.use.isMobile,
    );
    await first.over(north, 0.2);
    await expect(gap).toHaveAttribute('data-before-section', 'north');
    await expect.poll(async () => (await gap.boundingBox())!.height).toBeGreaterThan(39);
    await expect
      .poll(async () => (await north.boundingBox())!.y - (await stack.boundingBox())!.y - northTop)
      .toBeGreaterThan(30);
    await expect(stack.locator('[data-drop-target]')).toHaveCount(0);
    expect(writes).toBe(0);
    await page.screenshot({
      path: info.outputPath(`section-insertion-${theme}.png`),
      animations: 'disabled',
    });
    await first.cancel();
    await expect(gap).toHaveCount(0);
    await expect.poll(names).toEqual(['North', 'South', 'West']);
    expect(writes).toBe(0);
    await south.getByRole('button', { name: 'South', exact: true }).click();
    await expect(south.getByRole('button', { name: 'South', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(south.locator('[data-placement-id]')).toHaveCount(0);
    await expect.poll(() => writes).toBe(1);
    const second = await startDrag(
      page,
      west.locator('.pc-section-header'),
      !!info.project.use.isMobile,
    );
    await second.over(north, 0.8);
    await expect(gap).toHaveAttribute('data-before-section', 'south');
    await expect.poll(async () => (await gap.boundingBox())!.height).toBeGreaterThan(39);
    await expect(stack.locator('[data-drop-target]')).toHaveCount(0);
    expect(writes).toBe(1);
    await second.over(gap, 0.5);
    await expect(gap).toHaveAttribute('data-before-section', 'south');
    await second.drop(gap);
    await expect.poll(names).toEqual(['North', 'West', 'South']);
    await expect.poll(() => writes).toBe(2);
    await expect(gap).toHaveCount(0);
    const third = await startDrag(
      page,
      north.locator('.pc-section-header'),
      !!info.project.use.isMobile,
    );
    await third.over(south, 0.85);
    await expect(gap).toHaveAttribute('data-before-section', 'end');
    await expect.poll(async () => (await gap.boundingBox())!.height).toBeGreaterThan(39);
    await third.over(gap, 0.5);
    await third.drop(gap);
    await expect.poll(names).toEqual(['West', 'South', 'North']);
    await expect.poll(() => writes).toBe(3);
    await page.reload();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await showRail(page);
    await expect.poll(names).toEqual(['West', 'South', 'North']);
    await expect(north.locator('[data-placement-id]')).toHaveCount(2);
    await expect(west.locator('[data-placement-id]')).toHaveCount(2);
    await expect(south.getByRole('button', { name: 'South', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
}

test('pebble dragging retains section placement targets without section insertion gaps', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { organization: organization() });
  fixture.state.bots.splice(6);
  fixture.state.bots.forEach((bot) => {
    bot.pinned = false;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const north = page.getByRole('region', { name: 'North', exact: true });
  const south = page.getByRole('region', { name: 'South', exact: true });
  const row = north.locator('[data-placement-id="row-identity-0"]');
  const drag = await startDrag(page, row, !!info.project.use.isMobile);
  await drag.over(south, 0.05);
  await expect(south).toHaveAttribute('data-drop-edge', 'inside');
  await expect(page.locator('[data-section-insertion]')).toHaveCount(0);
  await drag.drop(south);
  await expect(south.locator('[data-placement-id="row-identity-0"]')).toBeVisible();
  await expect(row).toHaveCount(0);
});
