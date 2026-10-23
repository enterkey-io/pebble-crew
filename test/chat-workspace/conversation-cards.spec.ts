import { test, expect, type Page } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });
type Request = {
  id: string;
  actor: string;
  action: string;
  state: string;
  fingerprint: string;
  spec: Record<string, unknown>;
  created: number;
};
const proposal = (id: string, actor = 'arlo'): Request => ({
  id,
  actor,
  action: 'agent.attach',
  state: 'pending',
  fingerprint: 'exact-' + id,
  spec: { profile: actor, toolsets: ['browser'], skills: [] },
  created: Date.now() / 1000 - 10,
});
async function journal(page: Page, requests: Request[]) {
  const decisions: Record<string, unknown>[] = [];
  const control = {
    listed: true,
    fail: false,
    corrupt: false,
    lost: false,
    corruptOld: false,
    failOld: false,
    reads: 0,
  };
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'requests.list') {
      control.reads++;
      if (control.fail) return route.abort('connectionreset');
      const found = control.listed
        ? requests
            .filter((row) => !control.failOld || row.id !== 'old')
            .map((row) => (control.corruptOld && row.id === 'old' ? { ...row, spec: [] } : row))
            .filter((row) =>
              params.view === 'pending' ? row.state === 'pending' : row.state !== 'pending',
            )
        : [];
      return route.fulfill({
        json: {
          result: {
            generation: 1,
            next: null,
            restart: false,
            requests: [
              ...found,
              ...(control.corrupt && params.view === 'pending' ? [{ id: 'broken', spec: [] }] : []),
            ],
          },
        },
      });
    }
    if (operation === 'requests.get' && params.id === 'old' && control.failOld)
      return route.abort('connectionreset');
    if (operation === 'requests.get' && params.id === 'old' && control.corruptOld)
      return route.fulfill({ json: { result: { request: { id: 'old', unreadable: true } } } });
    if (operation === 'requests.get')
      return route.fulfill({
        json: { result: { request: requests.find((row) => row.id === params.id) ?? null } },
      });
    if (operation === 'requests.approve' || operation === 'requests.deny') {
      decisions.push(params);
      if (control.lost) return route.abort('connectionreset');
      const row = requests.find((row) => row.id === params.id)!;
      row.state = operation === 'requests.approve' ? 'completed' : 'denied';
      return route.fulfill({ json: { result: { state: row.state } } });
    }
    return route.fallback();
  });
  return { decisions, control };
}
const dock = (page: Page) =>
  page.getByRole('region', { name: 'Waiting for your input', exact: true });
async function select(page: Page, name: string) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page
    .locator('.pc-pins')
    .filter({ visible: true })
    .getByRole('button', { name: new RegExp(name) })
    .click();
}

for (const theme of ['dark', 'light'] as const)
  test(`${theme}: fixed input queue preserves draft, details and exact independent decisions through scrolling and reconnect`, async ({
    page,
    context,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await installFixture(context);
    const requests: Request[] = [];
    const { decisions } = await journal(page, requests);
    await page.goto('/');
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('Keep this unfinished draft.');
    requests.push(proposal('first'), proposal('second'));
    requests[0]!.spec.description = 'Review sources and send a summary. '.repeat(24);
    await emit(page, 'requests.changed');
    const queue = dock(page);
    await expect(queue).toContainText('1 of 2');
    await expect(field).toBeHidden();
    await expect(
      page.getByRole('log').getByRole('button', { name: 'Approve exact request' }),
    ).toHaveCount(0);
    await expect(queue.getByRole('button', { name: 'Approve exact request' })).toBeInViewport();
    const first = queue.locator('[data-request-id="first"]');
    await first.getByRole('button', { name: 'Read more', exact: true }).click();
    await expect(first.locator('.request-fields')).toContainText('Review sources');
    await queue.getByRole('button', { name: 'Next request', exact: true }).click();
    await expect(queue).toContainText('2 of 2');
    await expect(queue.locator('[data-request-id="second"]')).toBeVisible();
    await queue.getByRole('button', { name: 'Previous request', exact: true }).click();
    await expect(first.locator('.request-fields')).toBeVisible();
    await first.getByRole('button', { name: 'Read less', exact: true }).click();
    const held = await queue.elementHandle();
    const before = await queue.boundingBox();
    await page.getByRole('log').evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll'));
    });
    expect((await queue.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
    await expect(page.locator('.connection-status')).toHaveAttribute('data-online', 'true');
    expect(await held!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(queue.getByRole('button', { name: 'Approve exact request' })).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath('fixed-input-queue.png'),
      animations: 'disabled',
    });
    await first.getByRole('button', { name: 'Approve exact request' }).click();
    await expect(queue).toContainText('1 of 1');
    await expect(page.getByRole('log').locator('[data-request-id="first"]')).toContainText(
      'Approved',
    );
    await queue.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(queue).toHaveCount(0);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue('Keep this unfinished draft.');
    expect(decisions).toEqual([
      { id: 'first', fingerprint: 'exact-first', review_digest: 'fixture-review' },
      { id: 'second', fingerprint: 'exact-second' },
    ]);
    await page.reload();
    await expect(field).toBeVisible();
    await expect(page.getByRole('log').locator('[data-request-id="first"]')).toContainText(
      'Approved',
    );
    await expect(page.getByRole('log').locator('[data-request-id="second"]')).toContainText(
      'Denied',
    );
    await page.screenshot({
      path: info.outputPath('compact-decision-receipts.png'),
      animations: 'disabled',
    });
  });

test('Main notice opens the exact originating conversation without impersonating its approval', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const { decisions } = await journal(page, [proposal('for-mica', 'mica')]);
  await page.goto('/');
  await expect(dock(page)).toContainText('Mica is waiting for you');
  await expect(dock(page).getByRole('button', { name: 'Approve exact request' })).toHaveCount(0);
  await dock(page).getByRole('button', { name: 'View request', exact: true }).click();
  await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  await dock(page).getByRole('button', { name: 'Approve exact request' }).click();
  expect(decisions[0]).toEqual({
    id: 'for-mica',
    fingerprint: 'exact-for-mica',
    review_digest: 'fixture-review',
  });
});

test('missing list entries and malformed siblings cannot erase known pending decisions', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const { control } = await journal(page, [proposal('one'), proposal('two')]);
  await page.goto('/');
  await expect(dock(page)).toContainText('1 of 2');
  control.listed = false;
  await emit(page, 'requests.changed');
  const before = control.reads;
  await expect.poll(() => control.reads).toBeGreaterThan(before);
  await expect(dock(page)).toContainText('1 of 2');
  await expect(dock(page).getByRole('button', { name: 'Approve exact request' })).toBeEnabled();
  control.listed = true;
  control.corrupt = true;
  await emit(page, 'requests.changed');
  await expect(dock(page)).toContainText('1 of 3');
  await dock(page).getByRole('button', { name: 'Next request' }).click();
  await dock(page).getByRole('button', { name: 'Next request' }).click();
  await expect(dock(page)).toContainText('A request could not be read');
  await expect(dock(page).getByRole('button', { name: 'Approve exact request' })).toHaveCount(0);
  control.corrupt = false;
  await dock(page).getByRole('button', { name: 'Try again' }).click();
  await expect(dock(page)).toContainText('1 of 2');
});

test('lost decisions stay in the input queue and status checks never replay approval', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const requests = [proposal('lost')];
  const { control, decisions } = await journal(page, requests);
  control.lost = true;
  await page.goto('/');
  await dock(page).getByRole('button', { name: 'Approve exact request' }).click();
  await expect(dock(page).getByRole('button', { name: 'Check status', exact: true })).toBeEnabled();
  await expect(dock(page).getByRole('button', { name: 'Approve exact request' })).toHaveCount(0);
  requests[0]!.state = 'completed';
  await dock(page).getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(dock(page)).toHaveCount(0);
  await expect(page.getByRole('log')).toContainText('Approved');
  expect(decisions).toHaveLength(1);
});

test('native approvals use the fixed queue, reject stale snapshots and leave receipts', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  fixture.setApprovals([
    { request_id: 'one', command: 'Review the report' },
    { request_id: 'two', command: 'Apply the reviewed update' },
  ]);
  await emit(page, 'approval.request');
  await expect(dock(page)).toContainText('1 of 2');
  await expect(dock(page)).toContainText('Review the report');
  await page.screenshot({
    path: info.outputPath('native-input-queue.png'),
    animations: 'disabled',
  });
  await dock(page).getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(dock(page)).toContainText('1 of 1');
  await expect(page.getByRole('log')).toContainText('Tool action denied');
  fixture.setApprovals([]);
  await emit(page, 'approval.request');
  await expect(dock(page)).toHaveCount(0);
  await expect(page.getByRole('log')).toContainText('Approval no longer pending in Hermes');
});

test('question drafts and secret forms survive queue switching, navigation and reconnect', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  let question = true,
    secret = true;
  let answer: unknown,
    secretValue = '';
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'questions.pending')
      return route.fulfill({
        json: {
          result: {
            requests:
              question && params.session_id === 'session-arlo'
                ? [
                    {
                      id: 'question',
                      answers: {},
                      questions: [
                        {
                          qid: 'q0',
                          question: 'Which project?',
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
      answer = params;
      question = false;
      return route.fulfill({ json: { result: { state: 'answered' } } });
    }
    if (operation === 'secrets.pending')
      return route.fulfill({
        json: {
          result: {
            requests:
              secret && params.session_id === 'session-arlo'
                ? [
                    {
                      id: 'secret',
                      label: 'Service API key',
                      prompt: 'Connect the chosen service.',
                    },
                  ]
                : [],
          },
        },
      });
    if (operation === 'secrets.respond') {
      secretValue = params.value;
      secret = false;
      return route.fulfill({ json: { result: { submitted: true } } });
    }
    return route.fallback();
  });
  await page.goto('/');
  await expect(dock(page)).toContainText('1 of 2');
  await dock(page).getByRole('radio', { name: 'Research', exact: true }).check();
  await dock(page)
    .getByRole('textbox', { name: 'Your answer', exact: true })
    .fill('Use official sources.');
  await dock(page).getByRole('button', { name: 'Next request' }).click();
  await dock(page)
    .getByLabel('Service API key', { exact: true })
    .fill('synthetic-secret-do-not-record');
  await dock(page).getByRole('button', { name: 'Previous request' }).click();
  await expect(dock(page).getByRole('radio', { name: 'Research', exact: true })).toBeChecked();
  await select(page, 'Mica');
  await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  await select(page, 'Arlo');
  await expect(dock(page).getByRole('radio', { name: 'Research', exact: true })).toBeChecked();
  await expect(dock(page).getByRole('textbox', { name: 'Your answer' })).toHaveValue(
    'Use official sources.',
  );
  await dock(page).getByRole('button', { name: 'Next request' }).click();
  await expect(dock(page).getByLabel('Service API key', { exact: true })).toHaveValue(
    'synthetic-secret-do-not-record',
  );
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(dock(page).getByLabel('Service API key', { exact: true })).toHaveValue(
    'synthetic-secret-do-not-record',
  );
  await dock(page).getByRole('button', { name: 'Submit', exact: true }).click();
  await expect.poll(() => secretValue).toBe('synthetic-secret-do-not-record');
  await expect(dock(page)).toContainText('1 of 1');
  await page.screenshot({
    path: info.outputPath('question-input-queue.png'),
    animations: 'disabled',
  });
  await dock(page).getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(dock(page)).toHaveCount(0);
  expect(answer).toEqual({
    session_id: 'session-arlo',
    id: 'question',
    question_id: 'q0',
    answer: 'Use official sources.',
  });
  await expect(page.getByRole('log')).not.toContainText('synthetic-secret-do-not-record');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('synthetic-secret-do-not-record');
});

for (const fault of ['corruptOld', 'failOld'] as const)
  test(`${fault}: one broken exact recovery cannot hide a new healthy request`, async ({
    page,
    context,
  }) => {
    await installFixture(context);
    const requests = [proposal('old')];
    const { control } = await journal(page, requests);
    await page.goto('/');
    await expect(dock(page)).toContainText('1 of 1');
    requests.push(proposal('new-ron'));
    control[fault] = true;
    await emit(page, 'requests.changed');
    const healthy = dock(page).locator('[data-request-id="new-ron"]');
    await expect(healthy).toBeAttached();
    await dock(page).getByRole('button', { name: 'Next request' }).click();
    await expect(healthy).toBeVisible();
    await expect(healthy.getByRole('button', { name: 'Approve exact request' })).toBeEnabled();
  });

test('owner-created requests remain in the Main composer after reload', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await journal(page, [proposal('owner-request', 'owner')]);
  await page.goto('/');
  await expect(dock(page).locator('[data-request-id="owner-request"]')).toBeVisible();
  await page.reload();
  await expect(dock(page).locator('[data-request-id="owner-request"]')).toBeVisible();
});

test('questions completed on another device leave an inactive receipt and release the composer', async ({
  page,
  context,
}) => {
  await installFixture(context, { voice: true });
  let pending = true;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'questions.pending') return route.fallback();
    return route.fulfill({
      json: {
        result: {
          requests: pending
            ? [
                {
                  id: 'external',
                  answers: {},
                  questions: [{ qid: 'q0', question: 'Choose a project', choices: ['Website'] }],
                },
              ]
            : [],
        },
      },
    });
  });
  await page.goto('/');
  await expect(dock(page)).toContainText('Choose a project');
  pending = false;
  await emit(page, 'questions.changed');
  await expect(dock(page)).toHaveCount(0);
  await expect(page.getByRole('log')).toContainText('Question no longer pending');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
});

test('legacy binding stays visible and requires acknowledgment of the currently displayed identity', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  const requests = [proposal('legacy'), proposal('other')];
  await journal(page, requests);
  let identity = '11111111-2222-4333-8444-555555555555';
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation !== 'requests.review' || params.id !== 'legacy') return route.fallback();
    return route.fulfill({
      json: {
        result: {
          kind: 'ready',
          digest: identity,
          legacy: true,
          current_context: true,
          manager: 'alina',
          manager_identity: identity,
        },
      },
    });
  });
  await page.goto('/');
  const queue = dock(page),
    approve = queue.getByRole('button', { name: 'Approve exact request' });
  await expect(queue).toContainText('Current manager: alina');
  await expect(queue.getByText('Identity: ' + identity, { exact: true })).toBeVisible();
  await expect(approve).toBeInViewport({ ratio: 1 });
  await expect(approve).toBeDisabled();
  await queue.getByRole('checkbox', { name: 'Use this current setup', exact: true }).check();
  await expect(approve).toBeEnabled();
  await page.screenshot({
    path: info.outputPath('legacy-current-binding.png'),
    animations: 'disabled',
  });
  await queue.getByRole('button', { name: 'Next request' }).click();
  identity = '66666666-7777-4888-8999-000000000000';
  await queue.getByRole('button', { name: 'Previous request' }).click();
  await expect(queue.getByText('Identity: ' + identity, { exact: true })).toBeVisible();
  await expect(
    queue.getByRole('checkbox', { name: 'Use this current setup', exact: true }),
  ).not.toBeChecked();
  await expect(approve).toBeDisabled();
});

test('an older native approval response cannot replace a newer queue snapshot', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  let calls = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.approvals') return route.fallback();
    const call = ++calls;
    if (call === 1) await held;
    return route.fulfill({
      json: {
        result: {
          approvals: (call === 1 ? ['one'] : ['one', 'two']).map((id) => ({
            request_id: id,
            command: 'Review report ' + id,
          })),
        },
      },
    });
  });
  try {
    await emit(page, 'approval.request');
    await expect.poll(() => calls).toBe(1);
    await emit(page, 'approval.request');
    await expect(dock(page)).toContainText('1 of 2');
    const stale = page.waitForResponse(
      async (response) =>
        response.url().endsWith('/v1/rpc') &&
        response.request().postDataJSON().operation === 'chat.approvals' &&
        (await response.json()).result.approvals.length === 1,
    );
    release();
    await stale;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(dock(page)).toContainText('1 of 2');
    await expect(dock(page).locator('[data-attention-id]')).toHaveCount(2);
  } finally {
    release();
  }
});
