import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

const text =
  'Body text uses the same size for every speaker.\n\n- Body text in a list.\n\n> Body text in a quote.\n\n| Column |\n| --- |\n| Body text in a table. |';
test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light'])
  test(`actual chat text has one body size across speakers, Markdown and live replies in ${theme}`, async ({
    page,
    context,
  }) => {
    await installFixture(context, {
      messages: [
        {
          row_id: 101,
          role: 'user',
          text: 'Body text uses the same size for every speaker.',
          timestamp: 1700100000,
        },
        { row_id: 102, role: 'assistant', text, timestamp: 1700100060 },
        {
          row_id: 103,
          role: 'assistant',
          text: 'A different agent reply uses that same size.',
          timestamp: 1700100120,
        },
      ],
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    const expected = page.viewportSize()!.width < 768 ? '16px' : '14px';
    const body = page.locator(
      '[data-slot="bubble-content"] p, [data-slot="bubble-content"] li, [data-slot="bubble-content"] blockquote, [data-slot="bubble-content"] td',
    );
    expect(await body.count()).toBeGreaterThanOrEqual(6);
    for (const node of await body.all()) await expect(node).toHaveCSS('font-size', expected);
    await emit(page, 'message.start');
    await emit(page, 'message.delta', { text });
    const live = page.locator(
      '[data-message-phase="live"] .message-body p, [data-message-phase="live"] .message-body li, [data-message-phase="live"] .message-body td',
    );
    await expect(live.first()).toBeVisible();
    for (const node of await live.all()) await expect(node).toHaveCSS('font-size', expected);
  });
