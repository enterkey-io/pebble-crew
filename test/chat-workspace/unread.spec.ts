import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

async function expectOnPhotoEdge(pin: Locator, badge: Locator) {
  const photo = pin.locator('.agent-avatar > img');
  await expect(photo).toBeVisible();
  const { x, y, radius } = await badge.evaluate((element) => {
    const circle = element.parentElement!.querySelector('img')!.getBoundingClientRect();
    const indicator = element.getBoundingClientRect();
    return {
      x: indicator.x + indicator.width / 2 - circle.x - circle.width / 2,
      y: indicator.y + indicator.height / 2 - circle.y - circle.height / 2,
      radius: circle.width / 2,
    };
  });
  expect(x).toBeGreaterThan(0);
  expect(Math.hypot(x, y)).toBeCloseTo(radius, 0);
  expect(y).toBeCloseTo(x, 0);
}

for (const theme of ['dark', 'light']) {
  test(`unread indicators occupy the row edge and replace the pinned Main badge in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    const mica = fixture.state.bots.find((b) => b.profile === 'mica')!;
    mica.unread = true;
    mica.appearance.kind = 'photo';
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const paint = canvas.getContext('2d')!;
      paint.fillStyle = '#4d726e';
      paint.fillRect(0, 0, 64, 64);
      return canvas.toDataURL();
    });
    await page.route('**/v1/rpc', async (route) => {
      const { operation, params } = route.request().postDataJSON();
      if (operation === 'bots.appearance.get' && params.profile === 'mica')
        await route.fulfill({ json: { result: { data: photo } } });
      else await route.fallback();
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    fixture.state.orchestrator = 'mica';
    fixture.state.bots.find((b) => b.profile === 'mica')!.manager = null;
    fixture.state.bots.find((b) => b.profile === 'arlo')!.manager = 'mica';
    await emit(page, 'workspace.changed');
    async function navigation() {
      if (info.project.use.isMobile) {
        await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
        await expect(page.getByRole('region', { name: 'navigation', exact: true })).toHaveCSS(
          'transform',
          'matrix(1, 0, 0, 1, 0, 0)',
        );
      }
    }
    await navigation();
    const pin = page
      .locator('.pinned-tile')
      .filter({ has: page.getByRole('button', { name: /^Mica .*Bot Chat$/ }) });
    const dot = pin.getByRole('img', { name: 'Unread messages', exact: true });
    await expect(dot).toBeVisible();
    await expect(pin.getByRole('img', { name: 'Main Pebble', exact: true })).toHaveCount(0);
    await expectOnPhotoEdge(pin, dot);
    await expect(dot).toHaveCSS('background-color', 'rgb(59, 130, 246)');
    await expect(dot).toHaveCSS('animation-name', 'unread-pulse');
    const row = page
      .locator('.pebble-row')
      .filter({ has: page.getByRole('button', { name: /^Ember .*Bot Chat$/ }) });
    const rowDot = row.getByRole('img', { name: 'Unread messages', exact: true });
    await expect(rowDot).toBeVisible();
    const spacing = await row.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const edge = node.querySelector('.row-unread')!.getBoundingClientRect();
      return {
        right: bounds.right - edge.right,
        center: Math.abs(edge.y + edge.height / 2 - bounds.y - bounds.height / 2),
      };
    });
    expect(spacing.right).toBeGreaterThanOrEqual(11);
    expect(spacing.right).toBeLessThanOrEqual(13);
    expect(spacing.center).toBeLessThan(1);
    await expect(row.locator('.pc-overflow')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`unread-${theme}.png`), animations: 'disabled' });
    await pin.screenshot({
      path: info.outputPath(`photo-dot-${theme}.png`),
      animations: 'disabled',
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(dot).toHaveCSS('animation-name', 'none');
    await expect(dot).toHaveCSS('opacity', '1');
    await pin.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
    await expect
      .poll(() => fixture.state.bots.find((b) => b.profile === 'mica')!.unread)
      .toBe(false);
    await navigation();
    await expect(pin.getByRole('img', { name: 'Unread messages', exact: true })).toHaveCount(0, {
      timeout: 1500,
    });
    const star = pin.getByRole('img', { name: 'Main Pebble', exact: true });
    await expect(star).toBeVisible();
    await expectOnPhotoEdge(pin, star);
    await pin.screenshot({
      path: info.outputPath(`photo-star-${theme}.png`),
      animations: 'disabled',
    });
    await row.getByRole('button', { name: /^Ember .*Bot Chat$/ }).click();
    await expect
      .poll(() => fixture.state.bots.find((b) => b.profile === 'ember')!.unread)
      .toBe(false);
    await navigation();
    await expect(rowDot).toHaveCount(0, { timeout: 1500 });
    fixture.state.bots.find((b) => b.profile === 'mica')!.unread = true;
    await emit(page, 'workspace.changed');
    await expect(dot).toBeVisible();
  });
}
