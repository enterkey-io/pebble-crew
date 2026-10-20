import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { installFixture } from './fixtures';
import { installWorkFixture } from './work-fixture';

test.use({ serviceWorkers: 'block' });
async function navigation(page: Page, info: TestInfo) {
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
async function tasks(page: Page, info: TestInfo) {
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
}

for (const theme of ['light', 'dark']) {
  test(`composer action stays circular and neutral in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context);
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await page.getByLabel('Message', { exact: true }).fill('A draft');
    const action = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(action).toBeEnabled();
    const geometry = await action.evaluate((node) => {
      const box = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      const frame = node.closest('[data-slot="prompt-input"]')!.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        bottom: frame.bottom - box.bottom,
        right: frame.right - box.right,
      };
    });
    expect(geometry.width).toBe(geometry.height);
    expect(parseFloat(geometry.radius)).toBeGreaterThanOrEqual(geometry.width / 2);
    const rgb = geometry.background.match(/[\d.]+/g)!.map(Number);
    expect(Math.max(...rgb.slice(0, 3)) - Math.min(...rgb.slice(0, 3))).toBeLessThan(12);
    expect(geometry.bottom).toBeGreaterThanOrEqual(5);
    expect(geometry.right).toBeGreaterThanOrEqual(5);
    await page.screenshot({
      path: info.outputPath(`composer-${theme}.png`),
      animations: 'disabled',
    });
  });

  test(`org card hover and canvas cover their entire bounds in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context);
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await navigation(page, info);
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
    const chart = page.getByRole('region', { name: 'Org chart', exact: true });
    const card = chart.locator('[data-org-profile="arlo"] .pc-org-card');
    if (!info.project.use.isMobile) {
      const before = await card.evaluate((node) => getComputedStyle(node).backgroundColor);
      const box = (await card.boundingBox())!;
      await page.mouse.move(box.x + 12, box.y + box.height - 8);
      await expect
        .poll(() => card.evaluate((node) => getComputedStyle(node).backgroundColor))
        .not.toBe(before);
      await chart.getByRole('button', { name: 'Fit chart', exact: true }).click();
      const canvas = chart.getByRole('group', { name: 'Organization canvas', exact: true });
      const area = (await canvas.boundingBox())!;
      for (const x of [area.x + 12, area.x + area.width - 12]) {
        const y = area.y + area.height - 8;
        await page.mouse.move(x, y);
        expect(
          await page.evaluate(
            ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
            { x, y },
          ),
        ).toBe('grab');
      }
      const width = (await card.boundingBox())!.width;
      await page.mouse.wheel(0, -160);
      await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(width + 2);
      await page.mouse.wheel(0, 160);
      await expect.poll(async () => (await card.boundingBox())!.width).toBeLessThan(width + 2);
    }
    await chart.getByRole('button', { name: 'Center Main Pebble', exact: true }).click();
    await card.click();
    const handle = page.getByLabel('Handle', { exact: true });
    await expect(handle).toHaveCSS('border-top-width', '0px');
    await handle.focus();
    expect(
      await handle.evaluate((node) =>
        (getComputedStyle(node).boxShadow.match(/-?[\d.]+px/g) ?? []).every(
          (value) => parseFloat(value) === 0,
        ),
      ),
    ).toBe(true);
    const group = handle.locator('..');
    await expect(group).toHaveAttribute('data-slot', 'input-group');
    await expect(group).toHaveCSS('border-top-width', '1px');
    await page.screenshot({
      path: info.outputPath(`profile-${theme}.png`),
      animations: 'disabled',
    });
  });

  test(`task activity remains fully reachable and creation restores useful focus in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installWorkFixture(context);
    fixture.tasks.set('default', [
      {
        id: 'history-task',
        title: 'Review the launch',
        body: '',
        assignee: null,
        priority: 0,
        project_id: null,
        status: 'triage',
        result: null,
        revision: fixture.nextRevision(),
      },
    ]);
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await tasks(page, info);
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('New focus check');
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('tooltip', { name: 'Search Pebble Crew', exact: true }),
    ).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
    fixture.history.set(
      'history-task',
      Array.from({ length: 24 }, (_, i) => ({
        id: i + 1,
        kind: 'status',
        actor: 'owner',
        created_at: 1700000000 + i * 60,
        status: 'triage',
        summary: 'A recorded activity update.',
      })),
    );
    await page.getByRole('button', { name: 'Open task Review the launch', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Task', exact: true });
    await dialog.getByRole('tab', { name: 'Activity', exact: true }).click();
    const comment = dialog.getByLabel('Comment', { exact: true });
    await comment.scrollIntoViewIfNeeded();
    await comment.fill('The comment field and submit control remain usable.');
    const submit = dialog.getByRole('button', { name: 'Post comment', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 0.999 });
    await expect(dialog.getByRole('button', { name: 'Close Task', exact: true })).toBeInViewport({
      ratio: 0.999,
    });
    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 12);
    await page.screenshot({
      path: info.outputPath(`activity-bottom-${theme}.png`),
      animations: 'disabled',
    });
    await submit.click();
    await expect(
      dialog.getByText('The comment field and submit control remain usable.', { exact: true }),
    ).toBeVisible();
  });
}

test('cards reorder within a column, retain their order after reload, and keep native priority', async ({
  page,
  context,
}, info) => {
  const fixture = await installWorkFixture(context);
  fixture.tasks.set(
    'default',
    ['First', 'Second', 'Third'].map((title, index) => ({
      id: `order-${index}`,
      title,
      body: '',
      priority: 0,
      assignee: null,
      project_id: null,
      status: 'triage',
      result: null,
      revision: fixture.nextRevision(),
    })),
  );
  await tasks(page, info);
  const column = page.getByRole('region', { name: 'Triage', exact: true });
  const labels = () => column.locator('.pc-task-card > button').allTextContents();
  const third = page.getByRole('button', { name: 'Open task Third', exact: true });
  if (!info.project.use.isMobile) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await third.locator('..').dispatchEvent('dragstart', { dataTransfer: transfer });
    const first = await page
      .getByRole('button', { name: 'Open task First', exact: true })
      .boundingBox();
    await column.dispatchEvent('dragover', { dataTransfer: transfer, clientY: first!.y + 3 });
    await expect(column.locator('[data-slot="task-drop-marker"]')).toBeVisible();
    const card = await page.locator('[data-task-id="order-0"]').boundingBox();
    const lane = await column.boundingBox();
    expect(card!.x - lane!.x).toBeGreaterThanOrEqual(12);
    expect(lane!.x + lane!.width - card!.x - card!.width).toBeGreaterThanOrEqual(12);
    expect(card!.y - lane!.y).toBeGreaterThan(20);
    await page.screenshot({
      path: info.outputPath('padded-task-drop.png'),
      animations: 'disabled',
    });
    await column.dispatchEvent('drop', { dataTransfer: transfer, clientY: first!.y + 3 });
  } else {
    await third.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect
      .poll(async () => (await labels()).map((label) => label.trim().split('Unassigned')[0]))
      .toEqual(['First', 'Third', 'Second']);
    await page.keyboard.press('Alt+ArrowUp');
  }
  await expect
    .poll(async () => (await labels()).map((label) => label.trim().split('Unassigned')[0]))
    .toEqual(['Third', 'First', 'Second']);
  const revisions = fixture.tasks.get('default')!.map((row) => row.revision);
  expect(
    fixture.tasks.get('default')!.every((row) => row.priority === 0 && row.status === 'triage'),
  ).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await navigation(page, info);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await expect
    .poll(async () => (await labels()).map((label) => label.trim().split('Unassigned')[0]))
    .toEqual(['Third', 'First', 'Second']);
  expect(fixture.tasks.get('default')!.map((row) => row.revision)).toEqual(revisions);
  await page.screenshot({ path: info.outputPath('reordered-board.png'), animations: 'disabled' });
});

test('global task creation never focuses the unrelated Search tooltip', async ({
  page,
  context,
}, info) => {
  await installWorkFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await navigation(page, info);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('A task from chat');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tooltip', { name: 'Search Pebble Crew', exact: true })).toHaveCount(
    0,
  );
  if (!info.project.use.isMobile)
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeFocused();
});
