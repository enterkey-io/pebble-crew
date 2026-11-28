import { test, expect } from '@playwright/test';
import { installFixture, names } from './fixtures';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark']) {
  test(`group overflow count is bold and high contrast in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context, {
      roomMembers: names.map((name) => ({
        profile: name.toLowerCase(),
        member_id: name.toLowerCase(),
      })),
    });
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const paint = canvas.getContext('2d')!;
      paint.fillStyle = '#ca9170';
      paint.fillRect(0, 0, 64, 64);
      return canvas.toDataURL();
    });
    fixture.state.bots[1]!.appearance.kind = 'photo';
    fixture.setPhoto('mica', photo);
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    if (info.project.use.isMobile) {
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
      await expect(page.locator('.pc-mobile-navigation')).toHaveCSS(
        'transform',
        'matrix(1, 0, 0, 1, 0, 0)',
      );
    }
    const portrait = page.getByRole('img', { name: '12 members', exact: true });
    await portrait.scrollIntoViewIfNeeded();
    await expect(portrait).toHaveCSS('width', '44px');
    await expect(portrait.locator('[data-member="0"]')).toHaveCSS('width', '24px');
    await expect(portrait.locator('[data-member="0"] .avatar-silhouette')).toHaveCSS(
      'stroke-width',
      '8px',
    );
    const photoAvatar = portrait.locator('[data-member="1"] .avatar-photo');
    await expect(photoAvatar.locator('img')).toBeVisible();
    await expect(photoAvatar).toHaveCSS('outline-width', '2px');
    await expect(photoAvatar).toHaveCSS('outline-style', 'solid');
    await expect(photoAvatar).toHaveCSS('border-radius', '50%');
    const count = portrait.locator('[data-slot="badge"]');
    await expect(count).toHaveText('+7');
    await expect(count).toHaveCSS('font-weight', '700');
    expect(
      await count.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    const contrast = await count.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThan(7);
    const bounds = (await count.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(20);
    await portrait.screenshot({
      path: info.outputPath(`group-count-${theme}.png`),
      animations: 'disabled',
    });
    await page.screenshot({
      path: info.outputPath(`group-row-${theme}.png`),
      animations: 'disabled',
    });
  });
}
