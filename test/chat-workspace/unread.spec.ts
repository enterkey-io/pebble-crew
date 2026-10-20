import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light']) {
  test(`unread indicators occupy the row edge and replace the pinned Main badge in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    fixture.state.orchestrator = 'mica';
    fixture.state.bots.find((b) => b.profile === 'mica')!.unread = true;
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    async function navigation() {
      if (info.project.use.isMobile)
        await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    }
    await navigation();
    const pin = page
      .locator('.pinned-tile')
      .filter({ has: page.getByRole('button', { name: /^Mica .*Bot Chat$/ }) });
    const dot = pin.getByRole('img', { name: 'Unread messages', exact: true });
    await expect(dot).toBeVisible();
    await expect(pin.getByRole('img', { name: 'Main Pebble', exact: true })).toHaveCount(0);
    const avatar = (await pin.locator('.agent-avatar').boundingBox())!;
    const badge = (await dot.boundingBox())!;
    expect(badge.x + badge.width / 2).toBeGreaterThan(avatar.x + avatar.width * 0.7);
    expect(badge.y + badge.height / 2).toBeGreaterThan(avatar.y + avatar.height * 0.65);
    await expect(dot).toHaveCSS('background-color', 'rgb(59, 130, 246)');
    await expect(dot).toHaveCSS('animation-name', 'unread-pulse');
    const row = page
      .locator('.pebble-row')
      .filter({ has: page.getByRole('button', { name: /^Ember .*Bot Chat$/ }) });
    const rowDot = row.getByRole('img', { name: 'Unread messages', exact: true });
    await expect(rowDot).toBeVisible();
    const bounds = (await row.boundingBox())!,
      edge = (await rowDot.boundingBox())!;
    expect(bounds.x + bounds.width - edge.x - edge.width).toBeLessThanOrEqual(4);
    expect(Math.abs(edge.y + edge.height / 2 - bounds.y - bounds.height / 2)).toBeLessThan(1);
    await expect
      .poll(() =>
        row.evaluate((node) => {
          const menu = node
            .querySelector('[aria-label="Actions for Ember"]')!
            .getBoundingClientRect();
          const dot = node.querySelector('.row-unread')!.getBoundingClientRect();
          return dot.left - menu.right;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: info.outputPath(`unread-${theme}.png`), animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(dot).toHaveCSS('animation-name', 'none');
    await expect(dot).toHaveCSS('opacity', '1');
    await pin.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
    await expect
      .poll(() => fixture.state.bots.find((b) => b.profile === 'mica')!.unread)
      .toBe(false);
    await navigation();
    await expect(pin.getByRole('img', { name: 'Unread messages', exact: true })).toHaveCount(0);
    await expect(pin.getByRole('img', { name: 'Main Pebble', exact: true })).toBeVisible();
    await row.getByRole('button', { name: /^Ember .*Bot Chat$/ }).click();
    await expect
      .poll(() => fixture.state.bots.find((b) => b.profile === 'ember')!.unread)
      .toBe(false);
    await navigation();
    await expect(rowDot).toHaveCount(0);
    fixture.state.bots.find((b) => b.profile === 'mica')!.unread = true;
    await emit(page, 'workspace.changed');
    await expect(dot).toBeVisible();
  });
}
