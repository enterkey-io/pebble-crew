import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installWorkFixture } from './work-fixture';

test.use({ serviceWorkers: 'block' });
const phone = (info: TestInfo) =>
  info.project.name.includes('iphone') || info.project.name.includes('android');
async function navigation(page: Page, info: TestInfo) {
  if (phone(info))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
async function newItem(page: Page, info: TestInfo, name: string) {
  await navigation(page, info);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('project boards and tasks work through global creation and preserve the chat draft', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByLabel('Message', { exact: true }).fill('Keep this conversation draft');
  const transcript = page.getByRole('log');
  await transcript.evaluate((element) => {
    element.scrollTop = 120;
  });
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(120);
  await test.step('Open global project creation', () => newItem(page, info, 'New project board'));
  await page.getByLabel('Name', { exact: true }).fill('Research launch');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Verify original sources and record a concise recommendation.');
  await page.getByRole('button', { name: 'Create project board', exact: true }).click();
  await expect(page.getByText('Research launch board created', { exact: true })).toBeVisible();
  await test.step('Close project receipt', () =>
    page.getByRole('button', { name: 'Close', exact: true }).click());
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this conversation draft',
  );
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await navigation(page, info);
  await page.getByRole('button', { name: 'Research launch', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Research launch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Compare three sources');
  await expect(page.getByRole('combobox', { name: 'Project board', exact: true })).toContainText(
    'Research launch',
  );
  await page.getByRole('combobox', { name: 'Assigned to', exact: true }).click();
  await page.getByRole('option', { name: 'Mica', exact: true }).click();
  await page
    .getByLabel('Details', { exact: true })
    .fill('- [ ] Read original sources\n- [ ] Summarize the result');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toHaveCount(0);
  const task = page.getByRole('button', { name: 'Open task Compare three sources', exact: true });
  await expect(task).toBeVisible();
  const first = fixture.boards.find((b) => b.name === 'Research launch')!;
  expect(fixture.tasks.get(first.slug)?.[0]?.status).toBe('triage');
  const columns = await page.locator('.pc-work-column').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    }),
  );
  const viewport = page.viewportSize()!;
  expect(columns[0]!.width).toBeGreaterThanOrEqual(phone(info) ? viewport.width - 64 : 240);
  expect(columns[1]!.left).toBeGreaterThanOrEqual(columns[0]!.right + 12);
  if (phone(info)) expect(columns[0]!.left).toBeGreaterThanOrEqual(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('project-board.png'), animations: 'disabled' });
  await task.click();
  await page.getByLabel('Title', { exact: true }).fill('Compare four sources');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open task Compare four sources', exact: true }).click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByLabel('Comment', { exact: true }).fill('Please link the **original source**.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('original source', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('task-activity.png'), animations: 'disabled' });
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.screenshot({ path: info.outputPath('task-details.png'), animations: 'disabled' });
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole('button', { name: 'Close Task', exact: true }).click();
  await page.getByRole('button', { name: 'Project board settings', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Research evidence');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Project board', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Research evidence', exact: true })).toBeVisible();
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this conversation draft',
  );
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(120);
  expect(fixture.calls.some((op) => op.includes('dispatch') || op.includes('routine'))).toBe(false);
});

test('native changes and restored transport preserve an open task draft until its conflict is resolved', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  const task = {
    id: 'existing-task',
    title: 'Original title',
    body: 'Original instructions',
    priority: 0,
    assignee: null,
    project_id: null,
    status: 'triage',
    result: null,
    revision: fixture.nextRevision(),
  };
  fixture.tasks.set('default', [task]);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Open task Original title', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('My unsaved title');
  task.body = 'Changed directly in Hermes';
  task.revision = fixture.nextRevision();
  await expect(page.getByText('This task changed in Hermes.', { exact: false })).toBeVisible({
    timeout: 12000,
  });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.evaluate(() =>
    (window as typeof window & { __breakStream: () => void }).__breakStream(),
  );
  await expect
    .poll(() => fixture.calls.filter((call) => call === 'work.task').length)
    .toBeGreaterThan(1);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My unsaved title');
  await expect(page.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue(
    'Original instructions',
  );
  await page.screenshot({ path: info.outputPath('task-conflict.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Keep my edits', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toHaveCount(0);
  expect(task.title).toBe('My unsaved title');
  expect(task.body).toBe('Original instructions');
});

test('an uncertain task creation reconciles its existing receipt without a duplicate', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await newItem(page, info, 'New task');
  await page.getByLabel('Title', { exact: true }).fill('Keep this exact task');
  fixture.loseNextCreate();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Keep this exact task');
  await page.getByRole('button', { name: 'Check save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task created', exact: true })).toBeVisible();
  expect(fixture.tasks.get('default')).toHaveLength(1);
  expect(fixture.calls.filter((name) => name === 'work.task.create')).toHaveLength(1);
});

test('a partially created project resumes the original save without another board', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  fixture.interruptNextProject();
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await test.step('Open global project creation', () => newItem(page, info, 'New project board'));
  await page.getByLabel('Name', { exact: true }).fill('Resume this project');
  await page.getByRole('button', { name: 'Create project board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume save', exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Resume save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Resume this project board created', exact: true }),
  ).toBeVisible();
  expect(fixture.boards.filter((board) => board.name === 'Resume this project')).toHaveLength(1);
  expect(fixture.projectAttempts).toHaveLength(2);
  expect(new Set(fixture.projectAttempts).size).toBe(1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`task controls, content-sized editing and compact discard work in ${theme} mode`, async ({
    page,
    context,
  }, info) => {
    await installWorkFixture(context);
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);
    await navigation(page, info);
    const toggle = page.getByRole('radiogroup', { name: 'App area' });
    await expect(page.locator('.pc-rail-header:visible')).toHaveCSS('padding-left', '24px');
    await expect(toggle.getByRole('radio', { name: 'Chat', exact: true })).toBeChecked();
    const colors = await toggle.evaluate((element) =>
      [...element.querySelectorAll('[role=radio]')].map(
        (item) => getComputedStyle(item).backgroundColor,
      ),
    );
    expect(colors[0]).not.toBe(colors[1]);
    await toggle.getByRole('radio', { name: 'Tasks', exact: true }).click();
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('Check clear task controls');
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Open task Check clear task controls', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Task', exact: true });
    // Opening and cancelling is never an edit.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Open task Check clear task controls', exact: true })
      .click();
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(
      'Check clear task controls',
    );
    const scrollers = await dialog.evaluate(
      (element) =>
        [...element.querySelectorAll('*')].filter((node) => {
          const style = getComputedStyle(node);
          return (
            ['auto', 'scroll'].includes(style.overflowY) &&
            node.scrollHeight > node.clientHeight + 2
          );
        }).length,
    );
    expect(scrollers).toBe(0);
    await dialog.getByLabel('Title', { exact: true }).fill('An unsaved edit');
    await expect(dialog.getByRole('combobox', { name: 'Status', exact: true })).toBeDisabled();
    await expect(dialog.getByText('Save edits first', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const alert = page.getByRole('alertdialog');
    await expect(
      alert.getByRole('heading', { name: 'Discard changes?', exact: true }),
    ).toBeVisible();
    const bounds = await alert.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(340);
    expect(bounds!.height).toBeLessThanOrEqual(230);
    const discard = alert.getByRole('button', { name: 'Discard', exact: true });
    const contrast = await discard.evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, background: style.backgroundColor };
    });
    expect(contrast.text).toBe('rgb(255, 255, 255)');
    expect(contrast.background).not.toBe(contrast.text);
    await page.screenshot({
      path: info.outputPath(`discard-${theme}.png`),
      animations: 'disabled',
    });
    await alert.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('An unsaved edit');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Open task Check clear task controls', exact: true })
      .click();
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(
      'Check clear task controls',
    );
    await page.screenshot({
      path: info.outputPath(`task-editor-${theme}.png`),
      animations: 'disabled',
    });
  });
}

test('tasks move through their status control and comments autocomplete Pebble handles', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Follow up original sources');
  await page.getByRole('combobox', { name: 'Assigned to', exact: true }).click();
  await page.getByRole('option', { name: 'Mica', exact: true }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open task Follow up original sources', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'To do', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toContainText('To do');
  expect(fixture.tasks.get('default')?.[0]?.status).toBe('todo');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByLabel('Comment', { exact: true }).fill('Please check this @');
  await expect(page.getByRole('listbox', { name: 'Mention a Pebble', exact: true })).toBeVisible();
  await page.getByRole('option', { name: /Mica/ }).click();
  await expect(page.getByLabel('Comment', { exact: true })).toHaveValue('Please check this @mica ');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('Please check this @mica', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Task', exact: true }).click();
  const toDo = page.getByRole('region', { name: 'To do', exact: true });
  await expect(
    toDo.getByRole('button', { name: 'Open task Follow up original sources', exact: true }),
  ).toBeVisible();
  if (!phone(info)) {
    const card = page.getByRole('button', {
      name: 'Open task Follow up original sources',
      exact: true,
    });
    await expect(card.locator('..')).toHaveAttribute('draggable', 'true');
    await card.dragTo(page.getByRole('region', { name: 'Triage', exact: true }));
    await expect.poll(() => fixture.tasks.get('default')?.[0]?.status).toBe('triage');
  }
  // The same native move is available without a pointer drag on phones/keyboard.
  await page
    .getByRole('button', { name: 'Task actions for Follow up original sources', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Move to', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blocked', exact: true }).click();
  await expect.poll(() => fixture.tasks.get('default')?.[0]?.status).toBe('blocked');
});

test('a late task move cannot put an old board’s task into the newly opened project', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  fixture.boards.push({
    slug: 'other',
    name: 'Other project',
    description: '',
    project_id: 'project-other',
    revision: fixture.nextRevision(),
    mapping: 'linked',
    count: 0,
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Keep on original board');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  let release = () => {};
  fixture.holdNextMove(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await page
    .getByRole('button', { name: 'Task actions for Keep on original board', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Move to', exact: true }).click();
  await page.getByRole('menuitem', { name: 'To do', exact: true }).click();
  await navigation(page, info);
  await page.getByRole('button', { name: 'Other project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Other project', exact: true })).toBeVisible();
  await expect(page.getByLabel('Task columns', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const board = document.querySelector('[aria-label="Tasks"]');
    if (!board) throw new Error('The new project board must be mounted');
    const wrongTask = () =>
      !!board.querySelector('[aria-label="Open task Keep on original board"]');
    document.documentElement.dataset.oldTaskLeaked = String(wrongTask());
    new MutationObserver(() => {
      if (wrongTask()) document.documentElement.dataset.oldTaskLeaked = 'true';
    }).observe(board, { childList: true, subtree: true });
  });
  const read = page.waitForResponse(
    (response) =>
      response.url().endsWith('/v1/rpc') &&
      response.request().postDataJSON()?.operation === 'work.task',
  );
  release();
  await (await read).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole('button', { name: 'Open task Keep on original board', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-old-task-leaked', 'false');
  await expect(page.getByRole('heading', { name: 'Other project', exact: true })).toBeVisible();
});
