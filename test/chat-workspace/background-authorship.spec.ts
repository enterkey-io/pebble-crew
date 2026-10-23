import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('native background completion stays activity during typing, recovery and reload', async ({
  page,
  context,
}, info) => {
  const messages: (Record<string, unknown> & { row_id: number })[] = [
    { role: 'user', row_id: 1, text: 'Check the example configuration.' },
  ];
  await installFixture(context, { messages });
  let running = false;
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === 'chat.snapshot' || operation === 'chat.history')
      return route.fulfill({
        json: {
          result: {
            session_id: 'session-arlo',
            messages,
            running,
            inflight: { assistant: running ? 'Checking the example configuration.' : '' },
            active_user_row_id: 1,
          },
        },
      });
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  running = true;
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: 'Checking the example configuration.' });
  await expect(page.getByRole('log')).toContainText('Checking the example configuration.');
  messages.push({
    role: 'user',
    row_id: 2,
    display_kind: 'process_complete',
    text: '[IMPORTANT: Background process fixture completed normally. PRIVATE_COMMAND_OUTPUT]',
    display_metadata: { display_text: 'Example process finished' },
  });
  await emit(page, 'message.delta', { text: ' The check is complete.' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(1);
  await expect(page.getByRole('log')).not.toContainText('PRIVATE_COMMAND_OUTPUT');
  running = false;
  messages.push({ role: 'assistant', row_id: 3, text: 'The configuration check is complete.' });
  await emit(page, 'message.complete', { status: 'complete' });
  await expect(page.getByRole('log')).toContainText('The configuration check is complete.');
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(1);
  await expect(page.getByRole('log')).not.toContainText('PRIVATE_COMMAND_OUTPUT');
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(1);
  await expect(page.getByRole('log')).not.toContainText('PRIVATE_COMMAND_OUTPUT');
  await page.getByRole('button', { name: '1 tool call', exact: false }).click();
  await expect(page.getByText('Example process finished', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('background-activity.png'),
  });
});
