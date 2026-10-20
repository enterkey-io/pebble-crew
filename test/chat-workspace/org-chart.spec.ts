import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';
import { focusOrgCard, touchChart } from './org-chart-driver';
import AxeBuilder from '@axe-core/playwright';

test.use({ serviceWorkers: 'block' });

for (const theme of ['light', 'dark']) {
  test(`connected org chart has fixed cards and working view controls in ${theme} mode`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    fixture.state.bots = fixture.state.bots.slice(0, 6);
    fixture.state.bots[2]!.manager = 'mica';
    fixture.state.bots[4]!.manager = 'mica';
    fixture.state.bots[5]!.manager = 'rowan';
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
    const chart = page.getByRole('region', { name: 'Org chart', exact: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(chart.getByRole('switch')).toHaveCount(0);
    const cards = chart.locator('.pc-org-card');
    await expect(cards).toHaveCount(6);
    await expect(chart.locator('.pc-org-connectors path')).toHaveCount(5);
    for (const card of await cards.all()) {
      expect(
        await card.evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight })),
      ).toEqual({ width: 238, height: 126 });
    }
    const initialCanvas = await chart
      .getByRole('group', { name: 'Organization canvas', exact: true })
      .boundingBox();
    const initialMain = await chart.locator('[data-org-profile="arlo"] .pc-org-card').boundingBox();
    if (!initialCanvas || !initialMain) throw new Error('Initial chart view missing');
    expect(
      Math.abs(initialMain.x + initialMain.width / 2 - initialCanvas.x - initialCanvas.width / 2),
    ).toBeLessThan(1);
    await page.screenshot({
      path: info.outputPath(`org-main-${theme}.png`),
      animations: 'disabled',
      scale: 'css',
    });
    await chart.getByRole('button', { name: 'Fit chart', exact: true }).click();
    const fittedWidth = await chart.locator('.pc-org-diagram').evaluate((node) => {
      const viewport = node.closest('.pc-org-viewport');
      if (!(viewport instanceof HTMLElement)) throw new Error('Chart viewport missing');
      return (
        240 *
        Math.min(
          1,
          (viewport.clientWidth - 48) / node.clientWidth,
          (viewport.clientHeight - 48) / node.clientHeight,
        )
      );
    });
    await expect
      .poll(async () => Math.abs(((await cards.first().boundingBox())?.width ?? 0) - fittedWidth))
      .toBeLessThan(0.1);
    for (const card of await cards.all()) await expect(card).toBeInViewport({ ratio: 0.999 });
    for (const path of await chart.locator('.pc-org-connectors path').all()) {
      const connection = await path.evaluate((element) => {
        if (!(element instanceof SVGPathElement)) throw new Error('Expected a chart connection');
        const matrix = element.getScreenCTM();
        if (!matrix) throw new Error('Connection is not rendered');
        const start = element.getPointAtLength(0).matrixTransform(matrix);
        const end = element.getPointAtLength(element.getTotalLength()).matrixTransform(matrix);
        const css = getComputedStyle(element);
        return {
          from: element.dataset.orgParent,
          to: element.dataset.orgChild,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          stroke: css.stroke,
        };
      });
      expect(connection.stroke).not.toMatch(/none|transparent|rgba\([^)]*, 0\)$/);
      const parent = await chart
        .locator(`[data-org-profile="${connection.from}"] .pc-org-card`)
        .boundingBox();
      const child = await chart
        .locator(`[data-org-profile="${connection.to}"] .pc-org-card`)
        .boundingBox();
      if (!parent || !child) throw new Error('Connected cards missing');
      expect(Math.abs(connection.start.x - parent.x - parent.width / 2)).toBeLessThan(1);
      expect(Math.abs(connection.start.y - parent.y - parent.height)).toBeLessThan(1);
      expect(Math.abs(connection.end.x - child.x - child.width / 2)).toBeLessThan(1);
      expect(Math.abs(connection.end.y - child.y)).toBeLessThan(1);
    }
    await page.screenshot({
      path: info.outputPath(`org-overview-${theme}.png`),
      animations: 'disabled',
      scale: 'css',
    });
    expect((await new AxeBuilder({ page }).include('.pc-org-page').analyze()).violations).toEqual(
      [],
    );
    const main = chart.locator('[data-org-profile="arlo"] .pc-org-card');
    const before = await main.boundingBox();
    if (!before) throw new Error('Main card missing');
    await chart.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect
      .poll(async () => (await main.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before.width * 1.1);
    await chart.getByRole('button', { name: 'Center Main Pebble', exact: true }).click();
    await expect
      .poll(async () => Math.abs(((await main.boundingBox())?.width ?? 0) - 240))
      .toBeLessThan(0.25);
    const canvas = chart.getByRole('group', { name: 'Organization canvas', exact: true });
    const viewport = await canvas.boundingBox();
    const centered = await main.boundingBox();
    if (!viewport || !centered) throw new Error('Canvas not rendered');
    expect(
      Math.abs(centered.x + centered.width / 2 - viewport.x - viewport.width / 2),
    ).toBeLessThan(1);
    await page.mouse.move(viewport.x + 16, viewport.y + 24);
    await page.mouse.down();
    await page.mouse.move(viewport.x + 76, viewport.y + 64, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await main.boundingBox())?.x ?? 0)
      .toBeGreaterThan(centered.x + 30);

    if (info.project.use.isMobile) {
      const x = viewport.x + viewport.width / 2,
        y = viewport.y + viewport.height / 2;
      const beforePinch = await main.boundingBox();
      await touchChart(canvas, 'touchstart', [
        { x: x - 30, y },
        { x: x + 30, y },
      ]);
      await touchChart(canvas, 'touchmove', [
        { x: x - 50, y },
        { x: x + 50, y },
      ]);
      await touchChart(canvas, 'touchend', []);
      await expect
        .poll(async () => (await main.boundingBox())?.width ?? 0)
        .toBeGreaterThan((beforePinch?.width ?? 240) * 1.4);
      const beforePan = await main.boundingBox();
      await touchChart(canvas, 'touchstart', [{ x, y }]);
      await touchChart(canvas, 'touchmove', [{ x: x + 50, y: y + 30 }]);
      await touchChart(canvas, 'touchend', []);
      await expect
        .poll(async () => (await main.boundingBox())?.x ?? 0)
        .toBeGreaterThan((beforePan?.x ?? 0) + 30);
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    }
  });
}

test('org chart preserves unattached branches and edits through the shared profile controls', async ({
  page,
  context,
}, testInfo) => {
  const fixture = await installFixture(context);
  Object.assign(
    fixture.state.bots.find((bot) => bot.profile === 'mica')!,
    { manager: null },
  );
  Object.assign(
    fixture.state.bots.find((bot) => bot.profile === 'rowan')!,
    { manager: 'mica', hidden: true },
  );
  Object.assign(
    fixture.state.bots.find((bot) => bot.profile === 'sage')!,
    { manager: null },
  );
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft');
  const transcript = page.getByRole('log');
  await transcript.evaluate((element) => {
    element.scrollTop = 120;
  });
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(120);
  const mobile =
    testInfo.project.name.includes('iphone') || testInfo.project.name.includes('android');
  if (mobile) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  const chart = page.getByRole('region', { name: 'Org chart', exact: true });
  await expect(chart.getByRole('heading', { name: 'Unattached', exact: true })).toBeVisible();
  await expect(chart.locator('[data-org-parent="mica"][data-org-child="rowan"]')).toHaveCount(1);
  await expect(chart.getByRole('button', { name: /^Edit Rowan(?:\s|$)/ })).toBeVisible();
  await expect(chart.getByText('Hidden from chats', { exact: true })).toBeVisible();
  await (await focusOrgCard(page, 'Sage')).click();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Reports to', exact: true })).toContainText(
    'No manager',
  );
  await page.getByRole('combobox', { name: 'Reports to', exact: true }).click();
  await page.getByRole('option', { name: 'Mica', exact: true }).click();
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Verify your result, then send Mica a concise report.');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Edit Sage', exact: true })).toHaveCount(0);
  await expect(chart.locator('[data-org-parent="mica"][data-org-child="sage"]')).toHaveCount(1);
  await emit(page, 'workspace.changed');
  await expect(chart.locator('[data-org-parent="mica"][data-org-child="sage"]')).toHaveCount(1);
  await chart.screenshot({ path: testInfo.outputPath('org-chart.png') });
  await chart.getByRole('button', { name: 'Close Org chart', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft');
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(120);
  expect(fixture.state.bots.find((bot) => bot.profile === 'sage')?.manager).toBe('mica');
});

test('org card stays open on a refused save and preserves unsaved changes from another tab', async ({
  page,
  context,
}, testInfo) => {
  const fixture = await installFixture(context);
  let refuse = true;
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'roles.update' && refuse)
      return route.fulfill({
        status: 409,
        json: { code: 'STALE_REVISION', error: 'Workspace changed' },
      });
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (testInfo.project.name.includes('iphone') || testInfo.project.name.includes('android'))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  await (await focusOrgCard(page, 'Mica')).click();
  await page.getByLabel('Name', { exact: true }).fill('Mica Research');
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await page.getByLabel('Instructions', { exact: true }).fill('Verify sources and report to Arlo.');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
    'Verify sources and report to Arlo.',
  );
  expect(fixture.state.bots.find((bot) => bot.profile === 'mica')?.role.responsibilities).not.toBe(
    'Verify sources and report to Arlo.',
  );
  refuse = false;
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByText('Role saved.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Mica Research');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit pebble', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit Mica Research(?:\s|$)/ })).toBeVisible();
});

test('org chart has no management switch even when an older response contains a disabled flag', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'reporting.describe') return route.fallback();
    return route.fulfill({
      json: {
        result: {
          workspace: {
            ...fixture.state,
            reporting: { ...fixture.state.reporting, management_enabled: false },
          },
          changes: [],
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  const chart = page.getByRole('region', { name: 'Org chart', exact: true });
  await expect(chart.getByRole('switch')).toHaveCount(0);
  await expect(chart.getByText(/without asking you first|Let Arlo manage/)).toHaveCount(0);
  await expect(chart.getByRole('button', { name: /^Edit Arlo(?:\s|$)/ })).toBeVisible();
});

test('a refused agent change updates in the open chart without a workspace revision', async ({
  page,
  context,
}, testInfo) => {
  const fixture = await installFixture(context);
  let receiptState = 'queued';
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'reporting.describe') return route.fallback();
    await route.fulfill({
      json: {
        result: {
          workspace: fixture.state,
          changes: [
            {
              id: 'reporting-receipt',
              actor: 'arlo',
              state: receiptState,
              change: { profile: 'mica', instructions: null },
            },
          ],
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (testInfo.project.name.includes('iphone') || testInfo.project.name.includes('android'))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  const chart = page.getByRole('region', { name: 'Org chart', exact: true });
  await chart.getByRole('button', { name: 'Recent changes', exact: true }).click();
  await expect(chart.getByText('Saving…', { exact: true })).toBeVisible();
  const revision = fixture.state.revision;
  receiptState = 'refused';
  await expect(chart.getByText('Needs review', { exact: true })).toBeVisible({ timeout: 10000 });
  expect(fixture.state.revision).toBe(revision);
  // Room and crew navigation must reveal the conversation, not just update
  // the transcript hidden behind the chart.
  if (testInfo.project.name.includes('iphone') || testInfo.project.name.includes('android'))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Research crew', exact: false }).click();
  await expect(chart).toHaveCount(0);
  await expect(page.locator('.pc-chat-identity')).toContainText('Research crew');
  await expect(page.getByRole('log')).toContainText('I have the notes ready.');
});
