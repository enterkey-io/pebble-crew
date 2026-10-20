import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light']) {
  test(`empty composer offers voice and typing changes the same circular action to Send in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context, { voice: true, messages: [] });
    await context.route('**/v1/rpc', async (route) => {
      const { operation } = route.request().postDataJSON();
      if (operation === 'voice.status')
        return route.fulfill({
          json: {
            result: {
              supported: true,
              configured: true,
              voice: 'marin',
              voices: ['marin'],
              setup_complete: false,
              key_confirmed: false,
            },
          },
        });
      if (operation === 'secrets.pending')
        return route.fulfill({ json: { result: { requests: [] } } });
      return route.fallback();
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeEnabled();
    const frame = page.locator('[data-slot="prompt-input"]');
    await expect(frame).toHaveCSS('border-top-width', '0px');
    const edge = await frame.evaluate((node) => getComputedStyle(node).boxShadow);
    await expect(frame).toHaveCSS(
      'box-shadow',
      theme === 'dark'
        ? 'rgb(46, 46, 49) 0px 0px 0px 1px inset'
        : 'rgb(232, 229, 223) 0px 0px 0px 1px inset',
    );
    const voice = page.getByRole('button', { name: 'Voice chat', exact: true });
    await expect(voice).toBeEnabled();
    const action = await voice.elementHandle();
    const bounds = (await voice.boundingBox())!;
    const plus = page.getByRole('button', { name: 'Add attachment', exact: true });
    const style = await plus.evaluate((node) => {
      const style = getComputedStyle(node),
        box = node.getBoundingClientRect();
      return {
        radius: parseFloat(style.borderRadius),
        width: box.width,
        height: box.height,
        background: style.backgroundColor,
      };
    });
    expect(style.radius).toBeGreaterThanOrEqual(style.width / 2);
    expect(style.width).toBe(style.height);
    expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({
      path: info.outputPath(`composer-voice-${theme}.png`),
      animations: 'disabled',
    });
    await field.fill('Send this message');
    await expect(frame).toHaveCSS('box-shadow', edge);
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(send).toBeEnabled();
    expect(await send.evaluate((node, before) => node === before, action)).toBe(true);
    expect(await send.boundingBox()).toEqual(bounds);
    await expect(page.getByRole('button', { name: 'Voice chat', exact: true })).toHaveCount(0);
    await expect(send.locator('[data-glyph="send"]')).toHaveCSS('opacity', '1');
    await expect(send.locator('[data-glyph="voice"]')).toHaveCSS('opacity', '0');
    await page.screenshot({
      path: info.outputPath(`composer-send-${theme}.png`),
      animations: 'disabled',
    });
    await field.fill('   ');
    await expect(voice).toBeEnabled();
    await voice.click();
    await expect(page.getByRole('dialog', { name: /Edit/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use saved key', exact: true })).toBeVisible();
  });
}
