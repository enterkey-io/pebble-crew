import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test('reactions follow the lower outside corner on each message side without covering text', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    messages: [
      { row_id: 27, role: 'assistant', timestamp: 1700000000, text: 'Ready when you are.' },
      { row_id: 28, role: 'user', timestamp: 1700000001, text: 'Thanks.' },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  for (const [id, align] of [
    [27, 'start'],
    [28, 'end'],
  ] as const) {
    const row = page.locator(`[data-message-id="${id}"]`);
    if (!info.project.use.isMobile) await row.hover();
    await row.getByRole('button', { name: 'React to message', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'React to message', exact: true });
    await menu.getByRole('menuitem', { name: 'React with heart', exact: true }).click();
    await expect(menu).toHaveCount(0);
    const reactions = row.locator('[data-slot="bubble-reactions"]');
    await expect(reactions).toHaveAttribute('data-align', align);
    const emoji = reactions.getByRole('button', { name: '❤️ · You', exact: true });
    await expect(emoji).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(emoji).toHaveCSS('border-width', '0px');
    const placement = await row.evaluate((node) => {
      const bubble = node.querySelector('[data-slot="bubble-content"]')!.getBoundingClientRect();
      const reactions = node.querySelector('[data-slot="bubble-reactions"]')!;
      const mark = reactions.querySelector('button > span')!.getBoundingClientRect();
      const text = node.querySelector('[data-slot="bubble-content"] p')!.getBoundingClientRect();
      const box = reactions.getBoundingClientRect();
      return {
        left: box.left - bubble.left,
        right: bubble.right - box.right,
        top: mark.top - bubble.bottom,
        bottom: mark.bottom - bubble.bottom,
        textGap: mark.top - text.bottom,
      };
    });
    expect(placement[align === 'start' ? 'left' : 'right']).toBeGreaterThan(0);
    expect(placement[align === 'start' ? 'left' : 'right']).toBeLessThan(24);
    expect(placement.top).toBeLessThan(0);
    expect(placement.bottom).toBeGreaterThan(0);
    expect(placement.textGap).toBeGreaterThanOrEqual(0);
  }
  await page.screenshot({
    path: info.outputPath('reaction-placement.png'),
    animations: 'disabled',
  });
});
