import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

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
  const branch = chart.locator('[data-org-profile="mica"]');
  await expect(branch.getByRole('button', { name: 'Edit Rowan', exact: true })).toBeVisible();
  await expect(branch.getByText('Hidden from chats', { exact: true })).toBeVisible();
  await chart.getByRole('button', { name: 'Edit Sage', exact: true }).click();
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
  await page.getByRole('button', { name: 'Close Edit Sage', exact: true }).click();
  await expect(branch.getByRole('button', { name: 'Edit Sage', exact: true })).toBeVisible();
  await emit(page, 'workspace.changed');
  await expect(branch.getByRole('button', { name: 'Edit Sage', exact: true })).toBeVisible();
  await chart.screenshot({ path: testInfo.outputPath('org-chart.png') });
  await chart.getByRole('button', { name: 'Close Org chart', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft');
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(120);
  expect(fixture.state.bots.find((bot) => bot.profile === 'sage')?.manager).toBe('mica');
});

test('owner can revoke Main Pebble management without losing the reporting cards', async ({
  page,
  context,
}, testInfo) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (testInfo.project.name.includes('iphone') || testInfo.project.name.includes('android'))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  const grant = page.getByRole('switch', { name: /Main Pebble management/ });
  await expect(grant).toBeChecked();
  await grant.click();
  await expect(grant).not.toBeChecked();
  expect(fixture.state.reporting?.management_enabled).toBe(false);
  await expect(page.getByRole('button', { name: 'Edit Arlo', exact: true })).toBeVisible();
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
