import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });
async function historyFixture(context: BrowserContext) {
  const rows = Array.from({ length: 360 }, (_, i) => ({
    row_id: i + 1,
    role: i % 2 ? 'assistant' : 'user',
    timestamp: 1700000000 + i,
    text: `History row ${i + 1}. ${'Readable native history. '.repeat(5)}`,
  }));
  const calls: string[] = [];
  const behavior = { failOlder: false, running: false };
  const callsEnded: { id: string; ended_at: number }[] = [];
  const page = (before?: number) => {
    const earlier = before ? rows.filter((row) => row.row_id < before) : rows;
    const messages = earlier.slice(-60);
    return {
      messages,
      history_page: { older: earlier.length > 60 ? `before-${messages[0]!.row_id}` : null },
    };
  };
  const fixture = await installFixture(context, {
    attachments: true,
    open: (profile) => ({
      session_id: `session-${profile}`,
      ...page(),
      voice_calls: callsEnded,
      running: behavior.running,
      ...(behavior.running ? { inflight: { assistant: 'Live response' } } : {}),
    }),
    historyPage: (params) =>
      page(typeof params.before === 'string' ? Number(params.before.slice(7)) : undefined),
  });
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    calls.push(operation);
    if (operation === 'chat.history' && params.before && behavior.failOlder)
      return route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
    return route.fallback();
  });
  return { rows, calls, callsEnded, behavior, fixture };
}
async function loaded(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('[data-message-id="360"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('startup transfers one recent page and defers unopened details', async ({
  page,
  context,
}, info) => {
  const fixture = await historyFixture(context);
  await loaded(page);
  await expect(page.locator('[data-message-id]')).toHaveCount(60);
  await expect.poll(() => fixture.calls.filter((op) => op === 'bot.open').length).toBe(1);
  expect(
    fixture.calls.filter((op) =>
      [
        'chat.snapshot',
        'chat.history',
        'files.list',
        'media.list',
        'routines.list',
        'computer.status',
      ].includes(op),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('recent-history.png') });
  await page.locator('.pc-chat-identity').click();
  await expect.poll(() => fixture.calls.filter((op) => op === 'routines.list').length).toBe(1);
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.locator('.pc-chat-identity').click();
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('an activity-only tail opens on the last real message and keeps earlier history on demand', async ({
  page,
  context,
}, info) => {
  const fixture = await historyFixture(context);
  for (const row of fixture.rows.slice(-120)) {
    row.role = 'tool';
    row.text = '';
  }
  fixture.callsEnded.push(
    ...Array.from({ length: 20 }, (_, i) => ({
      id: i.toString(16).padStart(64, '0'),
      ended_at: 1700000280 + i,
    })),
  );
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const recent = page.getByText(/History row 240\./);
  await expect(recent).toBeInViewport();
  await expect(page.getByText(/History row 180\./)).toHaveCount(0);
  expect(fixture.calls.filter((op) => op === 'bot.open')).toHaveLength(1);
  expect(fixture.calls.filter((op) => op === 'chat.history')).toHaveLength(2);
  await page.screenshot({ path: info.outputPath('activity-tail-recent-message.png') });
  const earlier = page.getByRole('button', { name: 'Earlier messages', exact: true });
  await earlier.scrollIntoViewIfNeeded();
  await earlier.click();
  await expect(page.getByText(/History row 180\./)).toHaveCount(1);
  await expect(recent).toHaveCount(1);
});

test('older history loads on demand without moving the visible message or changing IDs', async ({
  page,
  context,
}, info) => {
  const fixture = await historyFixture(context);
  await loaded(page);
  const earlier = page.getByRole('button', { name: 'Earlier messages', exact: true });
  await earlier.scrollIntoViewIfNeeded();
  const row = page.locator('[data-message-id="301"]');
  const before = await row.boundingBox();
  await earlier.click();
  await expect(page.locator('[data-message-id="241"]')).toBeAttached();
  await expect(page.locator('[data-message-id]')).toHaveCount(120);
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - before!.y)).toBeLessThan(3);
  expect(fixture.calls.filter((op) => op === 'chat.history')).toHaveLength(1);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('older-history-anchor.png') });
});

test('an earlier-page failure keeps the chat, pending approval and retry available', async ({
  page,
  context,
}) => {
  const fixture = await historyFixture(context);
  fixture.fixture.setApprovals([
    {
      request_id: 'pending-approval',
      description: 'Read the test folder',
      choices: ['once', 'deny'],
    },
  ]);
  await loaded(page);
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minimize request', exact: true }).click();
  fixture.behavior.failOlder = true;
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(
    page.getByText('Earlier messages could not be loaded.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(60);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  fixture.behavior.failOlder = false;
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(page.locator('[data-message-id]')).toHaveCount(120);
  expect(fixture.calls.filter((op) => op === 'chat.approve')).toHaveLength(0);
});

test('loading older rows during streaming keeps the live reply and owner draft', async ({
  page,
  context,
}) => {
  await historyFixture(context);
  await loaded(page);
  await page.getByLabel('Message', { exact: true }).fill('My unsent draft');
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: 'Live text before paging. ' });
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(page.locator('[data-message-id="241"]')).toBeAttached();
  await emit(page, 'message.delta', { text: 'And after paging.' });
  await expect(
    page.getByText('Live text before paging. And after paging.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('My unsent draft');
  await expect(page.locator('[data-message-phase="live"]')).toHaveCount(1);
});

test('recovery fills a missed gap while preserving the reader, draft and mounted messages', async ({
  page,
  context,
}, info) => {
  const fixture = await historyFixture(context);
  await loaded(page);
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(page.locator('[data-message-id]')).toHaveCount(120);
  const anchor = page.locator('[data-message-id="301"]');
  await anchor.scrollIntoViewIfNeeded();
  const y = (await anchor.boundingBox())!.y;
  await page.getByLabel('Message', { exact: true }).fill('Draft across transport recovery');
  await anchor.evaluate((node) => Object.assign(window, { __retainedMessage: node }));
  fixture.rows.push(
    ...Array.from({ length: 90 }, (_, i) => ({
      row_id: 361 + i,
      role: 'assistant',
      text: `Missed native row ${361 + i}`,
      timestamp: 1700000361 + i,
    })),
  );
  await page.evaluate(() =>
    (window as unknown as { __expireConnection: () => void }).__expireConnection(),
  );
  await expect(page.locator('[data-message-id="450"]')).toBeAttached();
  await expect(page.locator('[data-message-id]')).toHaveCount(210);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Draft across transport recovery',
  );
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - y)).toBeLessThan(3);
  expect(
    await anchor.evaluate(
      (node) =>
        node === (window as unknown as { __retainedMessage: HTMLElement }).__retainedMessage,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('recovered-history-reader.png') });
});

test('a cached-session reload still fetches only one recent history page', async ({
  page,
  context,
}, info) => {
  const fixture = await historyFixture(context);
  await loaded(page);
  await page.getByLabel('Message', { exact: true }).fill('Draft survives reload');
  const firstOpenCount = fixture.calls.filter((op) => op === 'bot.open').length;
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Draft survives reload');
  await expect(page.locator('[data-message-id]')).toHaveCount(60);
  expect(fixture.calls.filter((op) => op === 'bot.open')).toHaveLength(firstOpenCount + 1);
  expect(
    fixture.calls.filter((op) =>
      ['chat.history', 'chat.snapshot', 'files.list', 'routines.list'].includes(op),
    ),
  ).toHaveLength(0);
  await info.attach('history-load-contract', {
    body: JSON.stringify({
      datasetRows: fixture.rows.length,
      renderedRows: 60,
      cachedSessionReload: true,
      startupHistoryCopies: 1,
      physicalPhone: false,
    }),
    contentType: 'application/json',
  });
});

test('a recent window cannot mark an older unseen native message as read', async ({
  page,
  context,
}) => {
  const fixture = await historyFixture(context);
  const bot = fixture.fixture.state.bots[0]!;
  bot.cursor_type = 'row';
  bot.cursor = 25;
  bot.unread = true;
  await loaded(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(bot.unread).toBe(true);
  expect(fixture.calls.filter((op) => op === 'presentation.read')).toHaveLength(0);
  bot.cursor = 360;
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect.poll(() => fixture.fixture.state.bots[0]!.unread).toBe(false);
});

test('routine changes invalidate an open inspector without reading unopened panels', async ({
  page,
  context,
}) => {
  const fixture = await historyFixture(context);
  await loaded(page);
  await emit(page, 'routines.changed', { profile: 'arlo' });
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(fixture.calls.filter((op) => op === 'routines.list')).toHaveLength(0);
  await page.locator('.pc-chat-identity').click();
  await expect.poll(() => fixture.calls.filter((op) => op === 'routines.list').length).toBe(1);
  await emit(page, 'routines.changed', { profile: 'arlo' });
  await expect.poll(() => fixture.calls.filter((op) => op === 'routines.list').length).toBe(2);
  await emit(page, 'routines.changed', { profile: 'mica' });
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await emit(page, 'routines.changed', { profile: 'arlo' });
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(fixture.calls.filter((op) => op === 'routines.list')).toHaveLength(2);
});
