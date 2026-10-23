import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installWorkFixture } from './work-fixture';

test.use({ serviceWorkers: 'block' });

async function rail(page: import('@playwright/test').Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
async function install(context: import('@playwright/test').BrowserContext) {
  const work = await installWorkFixture(context, { coordination: true });
  work.boards.push({
    slug: 'product',
    name: 'Product launch',
    description: 'Launch work',
    project_id: 'native-project',
    revision: 'a'.repeat(64),
    mapping: 'linked',
    count: 0,
  });
  const board = { catalog_id: 'stable-catalog', project_id: 'native-project', slug: 'product' };
  const graph = {
    workspace_id: work.workspace.id,
    revision: 0,
    plans: [] as Record<string, unknown>[],
    board_outcomes: [] as Record<string, unknown>[],
    boards: [{ ...board, name: 'Product launch' }],
    catalog_available: true,
    unavailable_boards: [],
  };
  const saves: Record<string, unknown>[] = [];
  const attempts: Record<string, unknown>[] = [];
  let planReads = 0;
  let routines = 0;
  const behavior = {
    interruptPlan: false,
    uncertainRoutine: false,
    interruptRoutineBefore: false,
    staleOutcome: false,
  };
  const receipts = new Map<string, Record<string, unknown>>();
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'work.plans') {
      planReads++;
      return route.fulfill({ json: { result: graph } });
    }
    if (operation === 'work.receipt' || operation === 'work.proactive.receipt')
      return route.fulfill({
        json: {
          result: receipts.get(params.operation_id) ?? { id: params.operation_id, state: 'absent' },
        },
      });
    if (operation === 'work.plan.save' || operation === 'work.board.outcome.save') {
      attempts.push(params);
      if (operation === 'work.board.outcome.save' && behavior.staleOutcome) {
        behavior.staleOutcome = false;
        graph.revision++;
      }

      if (params.expected_revision !== graph.revision)
        return route.fulfill({
          status: 409,
          json: { code: 'STALE_REVISION' },
        });
      saves.push(params);
      graph.revision++;
      if (operation === 'work.plan.save') {
        const plan = { ...params.plan, id: params.plan.id ?? params.operation_id };
        graph.plans = [...graph.plans.filter((p) => p.id !== plan.id), plan];
      } else graph.board_outcomes = [params.outcome];
      const result = {
        id: params.operation_id,
        state: 'completed',
        kind: 'plan',
        revision: graph.revision,
      };
      receipts.set(params.operation_id, result);
      if (behavior.interruptPlan) {
        behavior.interruptPlan = false;
        return route.abort('failed');
      }
      return route.fulfill({ json: { result } });
    }
    if (operation === 'work.proactive.status')
      return route.fulfill({
        json: {
          result: {
            workspace_id: work.workspace.id,
            main_id: 'identity-0',
            main_name: 'Arlo',
            timezone: 'America/Chicago',
            seen: false,
            routines: [...receipts.values()]
              .filter((r) => r.kind === 'routine')
              .map((r) => ({ id: r.id, name: r.name, state: r.state })),
          },
        },
      });
    if (operation === 'work.proactive.suggest')
      return route.fulfill({
        json: {
          result: {
            workspace_id: work.workspace.id,
            proposal_id: 'proposal-one',
            main_id: 'identity-0',
            main_name: 'Arlo',
            timezone: 'America/Chicago',
            unavailable: 0,
            suggestions: routines
              ? []
              : [
                  {
                    id: 'calendar',
                    name: 'Morning calendar brief',
                    prompt: 'Summarize my calendar. Read only; do not change events.',
                    time: '09:00',
                    days: 'weekdays',
                    tools: ['calendar_list_events'],
                  },
                ],
          },
        },
      });
    if (operation === 'work.proactive.enable') {
      saves.push(params);
      if (behavior.interruptRoutineBefore) {
        behavior.interruptRoutineBefore = false;
        return route.abort('failed');
      }
      routines++;
      const result = {
        id: params.operation_id,
        state: behavior.uncertainRoutine ? 'uncertain' : 'completed',
        kind: 'routine',
        job_id: 'native-routine',
        name: 'Morning calendar brief',
      };
      receipts.set(params.operation_id, result);
      return route.fulfill({ json: { result } });
    }
    return route.fallback();
  });
  return { work, saves, graph, receipts, behavior, attempts, planReads: () => planReads };
}

test('Plans and project goals use shared editors and preserve owner choices across reload', async ({
  page,
  context,
}, info) => {
  const fixture = await install(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page).toHaveTitle('Plans — Pebble Crew');
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New plan', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Company direction');
  await dialog
    .getByLabel('Goal', { exact: true })
    .fill('Reach 100 customers with a useful product.');
  await dialog.getByLabel('Details', { exact: true }).fill('Review progress every week.');
  await dialog.getByRole('checkbox', { name: 'Product launch', exact: true }).check();
  await expect(dialog.getByRole('heading', { name: 'New plan', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('plan-editor.png'), animations: 'disabled' });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    [],
  );
  await dialog.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Company direction', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('plans-overview.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Product launch', exact: true }).last().click();
  await page.getByRole('button', { name: 'Goal', exact: true }).click();
  const outcome = page.getByRole('dialog', { name: 'Project goal', exact: true });
  await outcome
    .getByLabel('Goal', { exact: true })
    .fill('Ship the first product and get ten paying customers.');
  await outcome.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(outcome).toHaveCount(0);
  expect(fixture.saves).toHaveLength(2);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Company direction', exact: true }).click();
  await expect(page.getByLabel('Goal', { exact: true })).toHaveValue(
    'Reach 100 customers with a useful product.',
  );
});

test('proactive setup starts unchecked, reviews schedule, saves without a model turn and stays out of Tasks', async ({
  page,
  context,
}, info) => {
  const fixture = await install(context);
  let sends = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/rpc') && request.postDataJSON().operation === 'chat.send')
      sends++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set up', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Proactive help', exact: true });
  await panel.getByRole('button', { name: 'Find suggestions', exact: true }).click();
  const choice = panel.getByRole('checkbox', { name: 'Morning calendar brief', exact: true });
  await expect(choice).not.toBeChecked();
  await expect(panel.getByRole('button', { name: 'Enable selected', exact: true })).toBeDisabled();
  await choice.check();
  await panel.getByLabel('Time', { exact: true }).fill('08:30');
  await panel
    .getByLabel('Instructions', { exact: true })
    .fill('Read today’s calendar and flag preparation. Never change events.');
  await expect(panel).toContainText('America/Chicago');
  await page.screenshot({ path: info.outputPath('proactive-review.png'), animations: 'disabled' });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    [],
  );
  await panel.getByRole('button', { name: 'Enable selected', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(fixture.saves).toHaveLength(1);
  expect(fixture.saves[0]).toMatchObject({
    time: '08:30',
    days: 'weekdays',
    timezone: 'America/Chicago',
  });
  expect(sends).toBe(0);
});

test('Plan conflicts preserve local edits and interrupted saves check the original receipt', async ({
  page,
  context,
}) => {
  const fixture = await install(context);
  const id = crypto.randomUUID();
  fixture.graph.plans.push({
    id,
    title: 'Company direction',
    outcome: 'Original goal',
    body: 'Original details',
    status: 'active',
    owner_id: null,
    parent_id: null,
    crew_ids: [],
    boards: [],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Company direction', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Goal', { exact: true }).fill('My local goal');
  fixture.graph.revision++;
  fixture.graph.plans[0] = {
    ...fixture.graph.plans[0],
    title: 'Current direction',
    outcome: 'A remote goal',
    body: 'Updated details',
  };
  await expect(dialog.getByRole('button', { name: 'Keep my changes', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(dialog.getByLabel('Goal', { exact: true })).toHaveValue('My local goal');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Current direction');
  await dialog.getByRole('button', { name: 'Keep my changes', exact: true }).click();
  fixture.behavior.interruptPlan = true;
  await dialog.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Goal', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.saves).toHaveLength(1);
  expect(fixture.graph.plans[0]).toMatchObject({
    title: 'Current direction',
    outcome: 'My local goal',
    body: 'Updated details',
  });
});

test('unconfirmed proactive routines remain recoverable after closing and reloading', async ({
  page,
  context,
}) => {
  const fixture = await install(context);
  fixture.behavior.uncertainRoutine = true;
  async function open() {
    await rail(page);
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Set up', exact: true }).click();
  }
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await open();
  const dialog = page.getByRole('dialog', { name: 'Proactive help', exact: true });
  await dialog.getByRole('button', { name: 'Find suggestions', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Morning calendar brief', exact: true }).check();
  await dialog.getByRole('button', { name: 'Enable selected', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Check save', exact: true }).first(),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const id = fixture.saves[0]!.operation_id as string;
  await open();
  await expect(dialog.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
  fixture.receipts.set(id, { ...fixture.receipts.get(id), state: 'completed' });
  await dialog.getByRole('button', { name: 'Check save', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Check save', exact: true })).toHaveCount(0);
  expect(fixture.saves).toHaveLength(1);
});

test('a stale project goal retry uses a new save identity after receiving the current revision', async ({
  page,
  context,
}) => {
  const fixture = await install(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await page.getByRole('button', { name: 'Product launch', exact: true }).click();
  await page.getByRole('button', { name: 'Goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project goal', exact: true });
  await dialog.getByLabel('Goal', { exact: true }).fill('Preserve this goal through a stale save.');
  fixture.behavior.staleOutcome = true;
  const reads = fixture.planReads();
  await dialog.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect.poll(fixture.planReads, { timeout: 10000 }).toBeGreaterThan(reads);
  await dialog.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.attempts).toHaveLength(2);
  expect(fixture.attempts[0]!.operation_id).not.toBe(fixture.attempts[1]!.operation_id);
  expect(fixture.saves).toHaveLength(1);
});

test('a definitively unsaved routine can be selected again after refreshing suggestions', async ({
  page,
  context,
}) => {
  const fixture = await install(context);
  fixture.behavior.interruptRoutineBefore = true;
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set up', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Proactive help', exact: true });
  await dialog.getByRole('button', { name: 'Find suggestions', exact: true }).click();
  const choice = dialog.getByRole('checkbox', { name: 'Morning calendar brief', exact: true });
  await choice.check();
  await dialog.getByRole('button', { name: 'Enable selected', exact: true }).click();
  await dialog.getByRole('button', { name: 'Check save', exact: true }).click();
  await dialog.getByRole('button', { name: 'Refresh suggestions', exact: true }).click();
  await expect(choice).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Enable selected', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Enable selected', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.saves).toHaveLength(2);
  expect(fixture.saves[0]!.operation_id).not.toBe(fixture.saves[1]!.operation_id);
});
