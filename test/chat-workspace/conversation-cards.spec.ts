import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });
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
