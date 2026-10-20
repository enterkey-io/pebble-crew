import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('ordinary Send redirects working chat while Stop stays available and every message survives', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { messages: [] });
  const stored: { role: string; row_id: number; text: string; timestamp: number }[] = [];
  let sends = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'chat.send') {
      sends++;
      expect(params.queued).toBeUndefined();
      if (sends === 2) await held;
      return route.fulfill({
        json: {
          result: sends === 1 ? { status: 'streaming', user_row_id: 31 } : { status: 'redirected' },
        },
      });
    }
    if (operation === 'chat.history')
      return route.fulfill({ json: { result: { messages: stored } } });
    return route.fallback();
  });
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('Start the work');
  await input.press('Enter');
  await expect.poll(() => sends).toBe(1);
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: 'Here is the current work. ' });
  await expect(page.getByRole('log')).toContainText('Here is the current work.');
  await input.fill('Change direction');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('send-and-stop.png'), animations: 'disabled' });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const centers = await input.evaluate((field) => {
    const frame = field.closest('form')!;
    const action = frame.querySelector('[data-action="send"]')!;
    const a = field.getBoundingClientRect(),
      b = action.getBoundingClientRect();
    return Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
  });
  expect(centers).toBeLessThan(2);
  await input.fill('Use the revised direction');
  const fieldBox = (await input.boundingBox())!,
    actionBox = (await send.boundingBox())!;
  if (fieldBox.height > actionBox.height)
    expect(Math.abs(fieldBox.y + fieldBox.height - actionBox.y - actionBox.height)).toBeLessThan(2);
  await send.click();
  await expect.poll(() => sends).toBe(2);
  try {
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await input.fill('Use the revised direction');
    await input.press('Enter');
    expect(sends).toBe(2);
    await emit(page, 'message.delta', { text: 'Following the revised direction. ' });
  } finally {
    release();
  }
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => sends).toBe(3);
  await emit(page, 'message.delta', { text: 'Final continuation.' });
  await expect(page.getByRole('log').locator('[data-message-role]')).toHaveText([
    /Start the work/,
    /Here is the current work\./,
    /Use the revised direction/,
    /Following the revised direction\./,
    /Use the revised direction/,
    /Final continuation\./,
  ]);
  stored.push(
    ...[
      ['user', 'Start the work'],
      ['assistant', 'Here is the current work.'],
      ['user', 'Use the revised direction'],
      ['assistant', 'Following the revised direction.'],
      ['user', 'Use the revised direction'],
      ['assistant', 'Final continuation.'],
    ].map(([role, text], index) => ({
      role: role!,
      text: text!,
      row_id: 31 + index,
      timestamp: 1700000000 + index,
    })),
  );
  await emit(page, 'message.complete', {
    status: 'complete',
    persisted_turn: { complete: false, final_assistant_row_id: 36 },
  });
  await expect(page.getByRole('log').locator('[data-message-role]')).toHaveCount(6);
  await expect(page.locator('[data-message-id^="pending-"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('redirect-settled.png'), animations: 'disabled' });
});

test('native anchored live correction restores without duplicate partial replies or users', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  const before = 'The current work 😀. ';
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'bot.open')
      return route.fulfill({
        json: {
          result: {
            session_id: 'session-arlo',
            running: true,
            active_user_row_id: 31,
            correction_row_ids: [33],
            messages: [
              { row_id: 31, role: 'user', text: 'Start the work', timestamp: 1700000000 },
              { row_id: 32, role: 'assistant', text: before, timestamp: 1700000001 },
              { row_id: 33, role: 'user', text: 'Change direction', timestamp: 1700000002 },
            ],
            inflight: {
              user: 'Start the work',
              assistant: before + 'Following the change.',
              corrections: ['Change direction'],
              correction_offsets: [Array.from(before).length],
            },
          },
        },
      });
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const log = page.getByRole('log');
  await expect(log.locator('[data-message-role]')).toHaveText([
    /Start the work/,
    /The current work 😀\./,
    /Change direction/,
    /Following the change\./,
  ]);
  await page.reload();
  await expect(log.locator('[data-message-role]')).toHaveText([
    /Start the work/,
    /The current work 😀\./,
    /Change direction/,
    /Following the change\./,
  ]);
  await expect(page.locator('[data-message-id="33"]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('redirect-restored.png'), animations: 'disabled' });
});

test('opening during continuous deltas merges the native snapshot without gaps or repeated text', async ({
  page,
  context,
}) => {
  let opens = 0;
  const position = (offset: number) => ({ epoch: 'fixture', turn: 1, offset });
  async function delta(text: string, offset: number) {
    await page.evaluate(
      ({ text, position }) => {
        (window as unknown as { __chatEvent: (event: unknown) => void }).__chatEvent({
          type: 'message.delta',
          session_id: 'session-arlo',
          payload: { text },
          stream_position: position,
        });
      },
      { text, position: position(offset) },
    );
  }
  await installFixture(context, {
    messages: [],
    open: async () => {
      opens++;
      if (opens === 2) {
        await delta('A😀', 2);
        await delta('BC', 4);
      }
      return {
        session_id: 'session-arlo',
        running: true,
        active_user_row_id: 31,
        stream_position: position(opens === 1 ? 2 : 3),
        messages: [{ row_id: 31, role: 'user', text: 'Start' }],
        inflight: { assistant: opens === 1 ? 'A😀' : 'A😀B' },
      };
    },
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect.poll(() => opens).toBe(2);
  await expect(page.getByRole('log').locator('[data-message-role="assistant"]')).toContainText(
    'A😀BC',
  );
  await delta(' D', 6);
  await expect(page.getByRole('log').locator('[data-message-role="assistant"]')).toContainText(
    'A😀BC D',
  );
  await expect(page.getByRole('log').locator('[data-message-role]')).toHaveCount(2);
});
