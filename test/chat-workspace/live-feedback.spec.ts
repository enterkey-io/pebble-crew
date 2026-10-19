import { test, expect } from '@playwright/test';
import { installFixture, emit, history } from './fixtures';

test('a reaction arriving during a streamed reply never projects partial native history twice', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: 'Still writing this reply.' });
  let historyReads = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.history') return route.fallback();
    historyReads++;
    await route.fulfill({
      json: {
        result: {
          messages: [
            ...history,
            {
              row_id: 901,
              role: 'assistant',
              text: 'Still writing this reply.',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      },
    });
  });
  await emit(page, 'message.reaction', {
    row_id: 24,
    reactions: [{ emoji: '👍', author: 'agent' }],
  });
  await expect(
    page.locator('[data-message-id="24"]').getByRole('button', { name: '👍 · Arlo' }),
  ).toBeVisible();
  expect(historyReads).toBe(0);
  await expect(
    page.locator('[data-slot="message-response"]').filter({ hasText: 'Still writing this reply.' }),
  ).toHaveCount(1);
  await emit(page, 'message.complete', {
    status: 'done',
    persisted_turn: { final_assistant_row_id: 901 },
  });
  await expect(page.locator('[data-message-id="901"]')).toBeVisible();
  await expect(
    page.locator('[data-slot="message-response"]').filter({ hasText: 'Still writing this reply.' }),
  ).toHaveCount(1);
});

test('native activity describes the work and a reply keeps its bubble and footer when committed', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  const activity = page.locator('.pc-activity');
  await expect(activity).toHaveText('Thinking');
  for (const [name, label] of [
    ['read_file', 'Reading files'],
    ['write_file', 'Updating files'],
    ['web_search', 'Searching the web'],
    ['terminal', 'Running a command'],
    ['message_agent', 'Coordinating agents'],
  ]) {
    await emit(page, 'tool.start', { name });
    await expect(activity).toHaveText(label!);
  }
  await emit(page, 'status.update', { kind: 'compacting', text: 'Compressing context' });
  await expect(activity).toHaveText('Compressing context');
  const reply = 'Your research is ready.';
  await emit(page, 'message.delta', { text: reply });
  await expect(activity).toHaveCount(0);
  const streaming = page.locator('[data-message-phase="live"]');
  await expect(streaming.locator('time')).toBeVisible();
  await expect(streaming.locator('.caret')).toHaveCount(0);
  const bubble = (await streaming.locator('[data-slot="message-response"]').elementHandle())!;
  const before = (await bubble.boundingBox())!;
  const rowHeight = (await streaming.boundingBox())!.height;
  const final = {
    row_id: 901,
    role: 'assistant',
    text: reply,
    timestamp: new Date().toISOString(),
  };
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'chat.history')
      await route.fulfill({ json: { result: { messages: [...history, final] } } });
    else await route.fallback();
  });
  await emit(page, 'message.complete', {
    status: 'done',
    text: reply,
    persisted_turn: { final_assistant_row_id: 901 },
  });
  const committed = page.locator('[data-message-id="901"]');
  await expect(committed.locator('time')).toBeVisible();
  expect(await bubble.evaluate((node) => node.isConnected)).toBe(true);
  expect(
    (await committed.locator('[data-slot="message-response"]').boundingBox())!.height,
  ).toBeCloseTo(before.height, 0);
  expect((await committed.boundingBox())!.height).toBeCloseTo(rowHeight, 0);
  await expect(page.locator('[data-message-phase="live"]')).toHaveCount(0);
  await expect(activity).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reply-completed.png' });
});

test('an empty move submenu has a dimmed disabled None item', async ({ page, context }) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByLabel('Actions for Mica', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to crew', exact: true }).hover();
  const empty = page.getByRole('menuitem', { name: 'None', exact: true });
  await expect(empty).toBeVisible();
  await expect(empty).toHaveAttribute('aria-disabled', 'true');
  await expect(empty).toHaveCSS('opacity', '0.5');
});
