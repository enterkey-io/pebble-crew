import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';

test.use({ serviceWorkers: 'block' });

test('owner bubbles use the phone width while short messages stay compact', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'user',
        text: 'Please review the project notes and send me a short summary of the decisions and next steps. '.repeat(
          3,
        ),
      },
      { row_id: 2, role: 'assistant', text: 'I will review the notes.' },
      { row_id: 3, role: 'user', text: 'Thanks.' },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const available = await page.locator('.pc-messages').evaluate((node) => {
      const style = getComputedStyle(node);
      return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    const long = (await page.locator('.pc-message.user').first().boundingBox())!;
    const short = (await page.locator('.pc-message.user').last().boundingBox())!;
    expect(long.width / available).toBeGreaterThan(0.84);
    expect(long.width / available).toBeLessThan(0.91);
    expect(short.width).toBeLessThan(available * 0.6);
    expect(Math.abs(long.x + long.width - short.x - short.width)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('owner-bubbles-phone.png'),
  });
});
