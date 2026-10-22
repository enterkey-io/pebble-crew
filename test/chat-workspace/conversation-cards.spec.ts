import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('only resolved approvals collapse; pending and uncertain work retain their full review surface', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const states = ['completed', 'denied', 'failed', 'pending', 'uncertain'];
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'requests.list')
      return route.fulfill({
        json: {
          result: {
            requests: states.map((state, index) => ({
              id: state,
              actor: 'arlo',
              action: 'agent.attach',
              state,
              created: 1700000000 + index,
              fingerprint: 'intent-' + state,
              spec: { profile: 'arlo', toolsets: ['browser'], skills: [] },
            })),
          },
        },
      });
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  for (const state of states) {
    const card = page.locator(`[data-request-id="${state}"]`);
    await expect(card).toBeAttached();
    if (['pending', 'uncertain'].includes(state)) {
      await expect(card.locator('[data-slot="confirmation"]')).toHaveCount(1);
      await expect(card.locator('[data-slot="approval-receipt"]')).toHaveCount(0);
    } else {
      await expect(card.locator('[data-slot="confirmation"]')).toHaveCount(0);
      await expect(card.locator('[data-slot="approval-receipt"]')).toContainText('Arlo');
    }
  }
});

for (const theme of ['dark', 'light'] as const)
  test(`${theme}: resolved approvals become compact receipts before subsequent owner and agent messages, including after reload`, async ({
    page,
    context,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    let opens = 0;
    const stored: { row_id: number; role: string; text: string; timestamp: number }[] = [];
    await installFixture(context, {
      messages: [],
      open: (profile) => {
        opens++;
        return { session_id: `session-${profile}`, running: false, messages: stored };
      },
    });
    const created = Math.floor(Date.now() / 1000) - 5;
    const requests = ['first', 'second'].map((id, index) => ({
      id,
      actor: 'arlo',
      action: 'agent.attach',
      state: 'pending',
      fingerprint: 'intent-' + id,
      spec: { profile: 'arlo', toolsets: ['browser'], skills: [] },
      created: created + index,
    }));
    await page.route('**/v1/rpc', async (route) => {
      const { operation, params } = route.request().postDataJSON();
      if (operation === 'requests.list')
        return route.fulfill({ json: { result: { requests: [...requests].reverse() } } });
      if (operation === 'requests.approve') {
        requests.find((request) => request.id === params.id)!.state = 'completed';
        return route.fulfill({ json: { result: { state: 'completed' } } });
      }
      if (operation === 'chat.send') {
        stored.push({ row_id: 31, role: 'user', text: params.text, timestamp: Date.now() / 1000 });
        return route.fulfill({ json: { result: { status: 'streaming', user_row_id: 31 } } });
      }
      if (operation === 'chat.history')
        return route.fulfill({
          json: { result: { session_id: 'session-arlo', running: false, messages: stored } },
        });
      await route.fallback();
    });
    await page.goto('/');
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeEnabled();
    const first = page.locator('[data-request-id="first"]');
    const second = page.locator('[data-request-id="second"]');
    for (const card of [first, second]) {
      await card.getByRole('button', { name: 'Approve exact request', exact: true }).click();
      await expect(
        card.getByRole('button', { name: 'Approve exact request', exact: true }),
      ).toHaveCount(0);
    }
    await field.fill('Both approvals are done. Please continue.');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    const sent = page.waitForRequest(
      (request) =>
        request.url().endsWith('/v1/rpc') && request.postDataJSON().operation === 'chat.send',
    );
    await field.press('Enter');
    await sent;
    await emit(page, 'message.start');
    await emit(page, 'message.delta', { text: 'I have the approvals and will continue.' });
    const log = page.getByRole('log');
    await expect(log).toContainText('I have the approvals and will continue.');
    async function verifyOrder() {
      await expect
        .poll(() =>
          log.evaluate((node) =>
            Array.from(node.querySelectorAll('[data-request-id], [data-message-role]')).map(
              (row) => row.getAttribute('data-request-id') ?? row.getAttribute('data-message-role'),
            ),
          ),
        )
        .toEqual(['first', 'second', 'user', 'assistant']);
    }
    await verifyOrder();
    for (const card of [first, second]) {
      await expect(card.locator('[data-slot="confirmation"]')).toHaveCount(0);
      await expect(card).toContainText('Approved');
      expect((await card.boundingBox())!.height).toBeLessThan(72);
    }
    stored.push({
      row_id: 32,
      role: 'assistant',
      text: 'I have the approvals and will continue.',
      timestamp: Date.now() / 1000,
    });
    await emit(page, 'message.complete', {
      status: 'complete',
      persisted_turn: { complete: false },
    });
    await verifyOrder();
    await page.reload();
    await expect(field).toBeEnabled();
    await verifyOrder();
    await expect(first.locator('[data-slot="confirmation"]')).toHaveCount(0);
    await first.getByRole('button', { name: /Approved/ }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(first.locator('[data-slot="confirmation"]')).toContainText('browser');
    const held = (await first.elementHandle())!;
    const opened = opens;
    await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
    await expect.poll(() => opens).toBeGreaterThan(opened);
    expect(await held.evaluate((node) => node.isConnected)).toBe(true);
    await expect(first.locator('[data-slot="confirmation"]')).toContainText('browser');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await verifyOrder();
    await first.getByRole('button', { name: /Approved/ }).click();
    await page.screenshot({
      path: info.outputPath('approval-receipts-in-order.png'),
      animations: 'disabled',
    });
  });
test('native approvals are actionable inside chat without opening the inspector', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  fixture.setApprovals([{ request_id: 'native-approval', command: 'Run the requested report' }]);
  await emit(page, 'approval.request');
  const card = page.getByRole('log').locator('[data-slot="confirmation"]');
  await expect(card).toContainText('Run the requested report');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('native-approval-in-chat.png'),
    animations: 'disabled',
  });
  await card.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(card).toHaveCount(0);
});

test('Main Pebble sees who is waiting and opens the originating chat to approve the exact request', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let state = 'pending';
  let approved: unknown;
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'requests.list')
      return route.fulfill({
        json: {
          result: {
            requests: [
              {
                id: 'agent-request',
                actor: 'mica',
                action: 'agent.attach',
                state,
                fingerprint: 'exact-intent',
                spec: { profile: 'mica', toolsets: ['browser'], skills: [] },
              },
            ],
          },
        },
      });
    if (operation === 'requests.approve') {
      approved = params;
      state = 'completed';
      return route.fulfill({ json: { result: { state } } });
    }
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const alert = page
    .getByRole('log')
    .locator('[data-slot="confirmation"]')
    .filter({ hasText: 'Mica is waiting for you' });
  await alert.scrollIntoViewIfNeeded();
  await alert.getByRole('button', { name: 'View request', exact: true }).click();
  await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  const request = page
    .getByRole('log')
    .locator('[data-slot="confirmation"]')
    .filter({ hasText: 'Change tools and skills' });
  await request.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('agent-request-in-chat.png'),
    animations: 'disabled',
  });
  await request.getByRole('button', { name: 'Approve exact request', exact: true }).click();
  await expect.poll(() => approved).toEqual({ id: 'agent-request', fingerprint: 'exact-intent' });
  await expect(
    request.getByRole('button', { name: 'Approve exact request', exact: true }),
  ).toHaveCount(0);
});

test('native multiple choice uses the shared questionnaire and returns its answer to the owning session', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let answered: unknown;
  let pending = true;
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'questions.pending')
      return route.fulfill({
        json: {
          result: {
            requests: pending
              ? [
                  {
                    id: 'question-1',
                    session_id: 'session-arlo',
                    answers: {},
                    questions: [
                      {
                        qid: 'q0',
                        question: 'Which project should I work on?',
                        choices: ['Website', 'Research'],
                        multi_select: false,
                      },
                    ],
                  },
                ]
              : [],
          },
        },
      });
    if (operation === 'questions.respond') {
      answered = params;
      pending = false;
      return route.fulfill({ json: { result: { state: 'answered' } } });
    }
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const card = page
    .getByRole('log')
    .locator('[data-slot="confirmation"]')
    .filter({ hasText: 'Which project should I work on?' });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('radio', { name: 'Research', exact: true }).check();
  await page.screenshot({ path: info.outputPath('question-in-chat.png'), animations: 'disabled' });
  await card.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect
    .poll(() => answered)
    .toEqual({
      session_id: 'session-arlo',
      id: 'question-1',
      question_id: 'q0',
      answer: 'Research',
    });
});
