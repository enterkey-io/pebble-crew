import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installWorkFixture } from './work-fixture';
import { emit } from './fixtures';

test.use({ serviceWorkers: 'block' });
async function rail(page: Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
async function general(page: Page) {
  await rail(page);
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}
async function fixture(context: BrowserContext) {
  const fixture = await installWorkFixture(context, { coordination: true });
  fixture.workspace.features = { tasks: true };
  const graph = {
    workspace_id: fixture.workspace.id,
    revision: 0,
    plans: [] as Record<string, unknown>[],
    board_outcomes: [],
    boards: [],
    catalog_available: true,
    unavailable_boards: [],
  };
  const receipts = new Map<string, Record<string, unknown>>();
  const behavior = {
    loseResponse: false,
    refuse: false,
    stale: false,
    afterWrite: undefined as (() => void) | undefined,
  };
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'work.plans') return route.fulfill({ json: { result: graph } });
    if (operation === 'work.plan.save') {
      if (fixture.workspace.features?.tasks === false)
        return route.fulfill({ status: 400, json: { code: 'REQUIRES_SETUP' } });
      graph.revision++;
      graph.plans.push({ ...params.plan, id: params.plan.id ?? params.operation_id });
      const receipt = {
        id: params.operation_id,
        state: 'completed',
        kind: 'plan',
        revision: graph.revision,
      };
      receipts.set(params.operation_id, receipt);
      return route.fulfill({ json: { result: receipt } });
    }
    if (operation === 'work.receipt' && receipts.has(params.operation_id))
      return route.fulfill({ json: { result: receipts.get(params.operation_id) } });
    if (operation !== 'workspace.features.set') return route.fallback();
    expect(params.workspace_id).toBe(fixture.workspace.id);
    if (behavior.refuse) {
      behavior.refuse = false;
      return route.abort('failed');
    }
    if (behavior.stale) {
      behavior.stale = false;
      fixture.workspace.revision++;
    }
    if (params.expected_revision !== fixture.workspace.revision)
      return route.fulfill({ status: 409, json: { code: 'STALE_REVISION' } });
    fixture.workspace.features = { tasks: params.tasks };
    fixture.workspace.revision++;
    behavior.afterWrite?.();
    if (behavior.loseResponse) {
      behavior.loseResponse = false;
      return route.abort('failed');
    }
    return route.fulfill({
      json: {
        result: {
          features: fixture.workspace.features,
          revision: fixture.workspace.revision,
        },
      },
    });
  });
  return { ...fixture, behavior };
}

test('Tasks can be hidden for the installation without hiding chats, Crews or proactive routines', async ({
  page,
  context,
}, info) => {
  const installed = await fixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  const setting = page.getByRole('switch', { name: 'Tasks', exact: true });
  await expect(setting).toBeChecked();
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(setting).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    await expect(async () => {
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }).toPass({ timeout: 3000 });
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`tasks-off-${theme}.png`),
    });
  }
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await expect(page.getByRole('radiogroup', { name: 'App area' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'New task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'New project board', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('menuitem', { name: 'New crew', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // A second browser tab receives the installation preference, not a local-storage value.
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(second);
  await expect(second.getByRole('radiogroup', { name: 'App area' })).toHaveCount(0);
  await second.close();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toContainText(
    'General tasks',
  );
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toContainText('Plans');
  expect(installed.boards).toHaveLength(1);
});

test('Tasks setting reconciles a lost response and leaves failed changes retryable', async ({
  page,
  context,
}) => {
  const installed = await fixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  const setting = page.getByRole('switch', { name: 'Tasks', exact: true });
  installed.behavior.loseResponse = true;
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(setting).toBeEnabled();
  await expect(page.getByText('Couldn’t save Tasks. Try again.')).toHaveCount(0);
  installed.behavior.refuse = true;
  await setting.click();
  await expect(page.getByText('Couldn’t save Tasks. Try again.', { exact: true })).toBeVisible();
  await expect(setting).not.toBeChecked();
  installed.behavior.stale = true;
  await setting.click();
  await expect(page.getByText('Settings changed. Try again.', { exact: true })).toBeVisible();
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await expect(setting).toBeEnabled();
});

test('old bridges keep Tasks enabled without advertising an unsupported setting', async ({
  page,
  context,
}) => {
  await installWorkFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  await expect(page.getByRole('switch', { name: 'Tasks', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await rail(page);
  await expect(page.getByRole('radio', { name: 'Tasks', exact: true })).toBeVisible();
});

test('a successful setting receipt reads current agent information before applying its revision', async ({
  page,
  context,
}) => {
  const installed = await fixture(context);
  let saved = false,
    described = 0;
  installed.behavior.afterWrite = () => {
    saved = true;
    installed.workspace.bots.find((bot) => bot.profile === 'arlo')!.role.title = 'Fresh role';
    installed.workspace.revision += 10;
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (saved && operation === 'workspace.describe') described++;
    if (saved && operation === 'workspace.snapshot') await held;
    await route.fallback();
  });
  try {
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await general(page);
    await page.getByRole('switch', { name: 'Tasks', exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Tasks', exact: true })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Tasks', exact: true })).toBeEnabled();
    expect(described).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
    await rail(page);
    await expect(page.getByRole('button', { name: /^Arlo Fresh role Bot Chat$/ })).toBeVisible();
  } finally {
    release();
  }
});

test('turning Tasks off in another tab preserves an open plan draft and does not reopen Tasks later', async ({
  page,
  context,
}, info) => {
  const installed = await fixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New plan', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('Keep this plan draft');
  await editor.getByLabel('Goal', { exact: true }).fill('A useful outcome');
  installed.workspace.features = { tasks: false };
  installed.workspace.revision++;
  await emit(page, 'workspace.changed');
  await expect(editor.getByText('Tasks is off. Your draft is kept here.')).toBeVisible();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Keep this plan draft');
  await expect(editor.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('paused-plan-draft.png') });
  installed.workspace.features = { tasks: true };
  installed.workspace.revision++;
  await emit(page, 'workspace.changed');
  await expect(editor.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
});

test('stored preferences alone do not advertise a setting on an older host', async ({
  page,
  context,
}) => {
  const installed = await installWorkFixture(context, { workspaceSettings: false });
  installed.workspace.features = { tasks: true };
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  await expect(page.getByRole('switch', { name: 'Tasks', exact: true })).toHaveCount(0);
});
