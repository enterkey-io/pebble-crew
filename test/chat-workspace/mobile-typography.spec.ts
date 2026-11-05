import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

for (const theme of ['dark', 'light']) {
  test(`shared typography remains readable and contained in chat, menus and settings in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context);
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    const phone = page.viewportSize()!.width < 768;
    const input = page.getByLabel('Message', { exact: true });
    await expect(input).toBeEnabled();
    await expect(page.locator('.pc-shell')).toHaveCSS('font-size', phone ? '15px' : '14px');
    await expect(page.locator('[data-slot="bubble-content"]').first()).toHaveCSS(
      'font-size',
      phone ? '16px' : '14px',
    );
    await expect(page.locator('[data-slot="message-footer"]').first()).toHaveCSS(
      'font-size',
      phone ? '13px' : '12px',
    );
    await expect(input).toHaveCSS('font-size', phone ? '17px' : '14px');
    await input.fill('A more readable message');
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`chat-type-${theme}.png`),
    });
    if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const item = page.getByRole('menuitem', { name: 'New pebble', exact: true });
    await expect(item).toHaveCSS('font-size', phone ? '15px' : '14px');
    const menu = (await page.getByRole('menu').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`menu-type-${theme}.png`),
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const general = page.getByRole('tab', { name: 'General', exact: true });
    await expect(general).toBeVisible();
    await expect(general).toHaveCSS('font-size', phone ? '15px' : '14px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`settings-type-${theme}.png`),
    });
    await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
    await expect(input).toHaveValue('A more readable message');
  });
}
