import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { installWorkFixture } from './work-fixture';

test.use({ serviceWorkers: 'block' });
async function openTasks(page: Page, info: TestInfo) {
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
}

for (const operation of ['work.describe', 'work.board']) {
  test(`a temporary ${operation} failure recovers without flashing a board error`, async ({
    page,
    context,
  }, info) => {
    await installWorkFixture(context);
    let failed = false;
    const alerts: string[] = [];
    page.on('console', (message) => {
      if (message.text().startsWith('board-alert:')) alerts.push(message.text());
    });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        for (const alert of document.querySelectorAll('.pc-work-area [role="alert"]'))
          if (alert.textContent?.trim()) console.log('board-alert:' + alert.textContent);
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await context.route('**/v1/rpc', async (route) => {
      if (route.request().postDataJSON().operation === operation && !failed) {
        failed = true;
        return route.fulfill({ status: 502, json: { error: 'Synthetic temporary failure' } });
      }
      return route.fallback();
    });
    await page.goto('/');
    await openTasks(page, info);
    await expect(page.getByRole('region', { name: 'Triage', exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(failed).toBe(true);
    expect(alerts).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`board failure and retry use the shared recovery components in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installWorkFixture(context);
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    let failed = true;
    await context.route('**/v1/rpc', async (route) => {
      if (route.request().postDataJSON().operation === 'work.board' && failed)
        return route.fulfill({ status: 502, json: { error: 'Synthetic unavailable board' } });
      return route.fallback();
    });
    await page.goto('/');
    await openTasks(page, info);
    const recovery = page.getByRole('alert').filter({ hasText: 'Couldn’t load this board' });
    await expect(recovery).toBeVisible();
    const header = recovery.locator('[data-slot="empty-header"]');
    const button = recovery.getByRole('button', { name: 'Try again', exact: true });
    await expect(header).toBeVisible();
    await expect(button).toBeVisible();
    const content = await header.boundingBox();
    const action = await button.boundingBox();
    expect(content!.width).toBeLessThanOrEqual(384);
    expect(action!.x).toBeGreaterThanOrEqual(0);
    expect(action!.x + action!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      path: info.outputPath(`board-failure-${theme}.png`),
      animations: 'disabled',
    });
    failed = false;
    await button.click();
    await expect(page.getByRole('region', { name: 'Triage', exact: true })).toBeVisible();
    await expect(recovery).toHaveCount(0);
  });
}

test('a failed refresh retains the loaded board and its task elements', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  fixture.tasks.set('default', [
    {
      id: 'retained-task',
      title: 'Keep this task visible',
      body: '',
      priority: 0,
      assignee: null,
      project_id: null,
      status: 'triage',
      result: null,
      revision: fixture.nextRevision(),
    },
  ]);
  let failed = false;
  await context.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'work.board' && failed)
      return route.fulfill({ status: 502, json: { error: 'Synthetic refresh failure' } });
    return route.fallback();
  });
  await page.goto('/');
  await openTasks(page, info);
  const task = page.getByRole('button', { name: 'Open task Keep this task visible', exact: true });
  await expect(task).toBeVisible();
  const original = (await task.elementHandle())!;
  failed = true;
  await expect(
    page.getByRole('alert').filter({ hasText: 'Couldn’t refresh this board' }),
  ).toBeVisible({ timeout: 15000 });
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expect(task).toBeVisible();
  await page.screenshot({
    path: info.outputPath('board-refresh-failure.png'),
    animations: 'disabled',
  });
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
});

test('invalid catalog data keeps a compact error and navigation, without automatic retries', async ({
  page,
  context,
}, info) => {
  await installWorkFixture(context);
  await page.clock.install();
  let reads = 0;
  await context.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'work.describe') {
      reads++;
      return route.fulfill({
        json: {
          result: {
            workspace_id: 'another-workspace',
            boards: [],
            unlinked_projects: [],
            capabilities: { edit_details: true },
          },
        },
      });
    }
    return route.fallback();
  });
  await page.goto('/');
  await openTasks(page, info);
  const recovery = page.getByRole('alert').filter({ hasText: 'Couldn’t load project boards' });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveAttribute('data-error-code', 'INVALID_RESPONSE');
  await expect(recovery).toContainText('Hermes returned board data this app couldn’t read.');
  await page.clock.runFor(6000);
  expect(reads).toBe(1);
  await page.screenshot({ path: info.outputPath('catalog-failure.png'), animations: 'disabled' });
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('reconnecting retains the board and pauses its read loop until the new connection is live', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  fixture.tasks.set('default', [
    {
      id: 'offline-task',
      title: 'Board stays here',
      body: '',
      priority: 0,
      assignee: null,
      project_id: null,
      status: 'triage',
      result: null,
      revision: fixture.nextRevision(),
    },
  ]);
  await page.clock.install();
  let reads = 0;
  await context.route('**/v1/rpc', async (route) => {
    if (['work.describe', 'work.board'].includes(route.request().postDataJSON().operation)) reads++;
    return route.fallback();
  });
  await page.goto('/');
  await openTasks(page, info);
  const task = page.getByRole('button', { name: 'Open task Board stays here', exact: true });
  await expect(task).toBeVisible();
  const original = (await task.elementHandle())!;
  let reconnecting = false;
  let pausedReads: number;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('**/v1/connect', async (route) => {
    reconnecting = true;
    await held;
    return route.fallback();
  });
  try {
    await page.evaluate(() => {
      const stop = Reflect.get(window, '__breakStream');
      if (typeof stop !== 'function') throw new Error('Missing synthetic stream control');
      stop();
    });
    await expect.poll(() => reconnecting).toBe(true);
    pausedReads = reads;
    await page.clock.runFor(6500);
    expect(reads).toBe(pausedReads);
    await expect(task).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  } finally {
    release();
  }
  await expect.poll(() => reads).toBeGreaterThan(pausedReads);
  await expect(task).toBeVisible();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
});

test('an expired board authorization reconnects through the existing owner login', async ({
  page,
  context,
}, info) => {
  await installWorkFixture(context);
  let refused = true;
  let connections = 0;
  await context.route('**/v1/connect', async (route) => {
    if (route.request().method() === 'POST') connections++;
    return route.fallback();
  });
  await context.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'work.board' && refused)
      return route.fulfill({ status: 403, json: {} });
    return route.fallback();
  });
  await page.goto('/');
  await openTasks(page, info);
  const recovery = page.getByRole('alert').filter({ hasText: 'Couldn’t load this board' });
  await expect(recovery).toHaveAttribute('data-error-code', 'UNAUTHORIZED');
  refused = false;
  await recovery.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Triage', exact: true })).toBeVisible();
  expect(connections).toBe(2);
  await expect(recovery).toHaveCount(0);
});
