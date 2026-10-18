import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('installed chat uses standard user bubbles, unboxed replies and separate action footers', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'user',
        text: 'Please review the project notes and summarize the decisions for our next meeting. '.repeat(
          4,
        ),
        timestamp: 1700000000,
      },
      {
        row_id: 2,
        role: 'assistant',
        text: '## Next steps\n\nThe notes are ready. There are two decisions to review:\n\n- Confirm the schedule\n- Share the project brief',
        timestamp: 1700000010,
      },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const user = page.locator('[data-message-id="1"]');
  const agent = page.locator('[data-message-id="2"]');
  await expect(user.locator('[data-slot="message"]')).toHaveAttribute('data-align', 'end');
  await expect(agent.locator('[data-slot="message"]')).toHaveAttribute('data-align', 'start');
  await expect(user.locator('[data-slot="bubble"]')).toHaveAttribute('data-variant', 'muted');
  await expect(agent.locator('[data-slot="bubble"]')).toHaveAttribute('data-variant', 'ghost');
  await expect(agent.getByRole('heading', { name: 'Next steps' })).toBeVisible();
  await expect(agent.locator('[data-slot="message-response"]')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(user.locator('[data-slot="bubble-content"] time')).toHaveCount(0);
  const surface = (await user.locator('[data-slot="bubble-content"]').boundingBox())!;
  const frame = (await user.locator('[data-slot="message-content"]').boundingBox())!;
  expect(surface.width / frame.width).toBeGreaterThan(0.79);
  expect(surface.width / frame.width).toBeLessThan(0.81);
  for (const row of [user, agent]) {
    const content = (await row.locator('[data-slot="bubble-content"]').boundingBox())!;
    const footer = row.locator('[data-slot="message-footer"]');
    const bounds = (await footer.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(content.y + content.height);
    await expect(footer.locator('time')).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Copy message', exact: true })).toBeVisible();
    await expect(footer).toHaveCSS('position', 'static');
  }
  await expect(
    page.locator('.pc-bubble, .pc-message, .pc-message-meta, .pc-message-actions'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('standard-transcript.png'),
  });
});
