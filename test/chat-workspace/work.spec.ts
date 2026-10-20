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
  await newItem(page, info, 'New project board');
  await page.getByLabel('Name', { exact: true }).fill('Research launch');
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Verify original sources and record a concise recommendation.');
  await page.getByRole('button', { name: 'Create project board', exact: true }).click();
  await expect(page.getByText('Project board created.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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
    .getByLabel('Instructions', { exact: true })
    .fill('- [ ] Read original sources\n- [ ] Summarize the result');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('button', { name: 'Open task board', exact: true }).click();
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
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue(
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
  await expect(page.getByText('Task created.', { exact: true })).toBeVisible();
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
  await newItem(page, info, 'New project board');
  await page.getByLabel('Name', { exact: true }).fill('Resume this project');
  await page.getByRole('button', { name: 'Create project board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume save', exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Resume save', exact: true }).click();
  await expect(page.getByText('Project board created.', { exact: true })).toBeVisible();
  expect(fixture.boards.filter((board) => board.name === 'Resume this project')).toHaveLength(1);
  expect(fixture.projectAttempts).toHaveLength(2);
  expect(new Set(fixture.projectAttempts).size).toBe(1);
});
