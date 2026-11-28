import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
async function choose(page: Page, name: string, phone: boolean) {
  if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.locator('.pc-pin').filter({ hasText: name }).getByRole('button').click();
  await expect(page.locator('.pc-chat-header h1')).toHaveText(name);
}
test('returning to a chat paints cached messages and scroll while its lightweight snapshot is pending', async ({
  page,
  context,
}, info) => {
  const stored = new Map(
    ['arlo', 'mica'].map((profile, index) => [
      profile,
      Array.from({ length: 30 }, (_, i) => ({
        row_id: index * 1000 + i + 1,
        role: i % 2 ? 'assistant' : 'user',
        text: `${profile} conversation row ${i + 1}. ${'Saved native message. '.repeat(12)}`,
        timestamp: 1700000000 + i * 60,
      })),
    ]),
  );
  await installFixture(context, {
    open: (profile) => ({
      session_id: `session-${profile}`,
      messages: stored.get(profile) ?? [],
      history_page: { older: null },
      running: false,
    }),
  });
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let snapshots = 0,
    opens = 0;
  await context.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'bot.open' && params.profile === 'arlo') opens++;
    if (operation === 'chat.snapshot' && params.session_id === 'session-arlo') {
      snapshots++;
      await pending;
    }
    await route.fallback();
  });
  try {
    await page.goto('/');
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeEnabled();
    await expect(page.locator('[data-message-id="30"]')).toBeVisible();
    await field.fill('Draft for Arlo');
    const pane = page.locator('.pc-transcript');
    await pane.evaluate((node) => {
      node.scrollTop = 400;
    });
    await expect(page.getByRole('button', { name: /Latest messages/ })).toBeVisible();
    const top = await pane.evaluate((node) => node.scrollTop);
    await choose(page, 'Mica', !!info.project.use.isMobile);
    await expect(field).toHaveAttribute('placeholder', 'Message Mica');
    await expect(page.locator('[data-message-id="1030"]')).toBeVisible();
    await field.fill('Draft for Mica');
    stored
      .get('arlo')!
      .push({ row_id: 31, role: 'assistant', text: 'Arlo caught-up reply', timestamp: 1700001800 });
    await choose(page, 'Arlo', !!info.project.use.isMobile);
    await expect.poll(() => snapshots).toBe(1);
    await expect(field).toHaveValue('Draft for Arlo');
    await expect(page.locator('[data-message-id="30"]')).toBeAttached();
    await expect(page.locator('[data-message-id="1030"]')).toHaveCount(0);
    await expect(page.getByText('Arlo caught-up reply', { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => Math.abs((await pane.evaluate((node) => node.scrollTop)) - top))
      .toBeLessThan(3);
    await field.fill('Typing while the background read is pending');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    expect(opens).toBe(1);
    release?.();
    await expect(page.getByText('Arlo caught-up reply', { exact: true })).toBeAttached();
    await expect(field).toHaveValue('Typing while the background read is pending');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect
      .poll(async () => Math.abs((await pane.evaluate((node) => node.scrollTop)) - top))
      .toBeLessThan(3);
    await page.screenshot({
      path: info.outputPath('warm-conversation.png'),
      animations: 'disabled',
    });
  } finally {
    release?.();
  }
});
