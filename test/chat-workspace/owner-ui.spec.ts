import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import type { Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function newPebble(page: Page) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
}

test('empty system sections disappear; system names and item kinds stay fixed', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  fixture.state.bots.forEach((bot, index) => {
    if (index) {
      bot.managed = false;
      bot.enrolled = false;
      bot.canonical = false;
    }
  });
  await ready(page);
  await expect(
    page.locator('.pc-list:is([aria-label="Pebbles"],[aria-label="Crews"])'),
  ).toHaveCount(0);
  await expect(page.locator('.pc-section-empty')).toHaveCount(0);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New crew', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New crew', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Studio');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.pc-list[aria-label="Crews"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for Crews section' })).toHaveCount(0);
  await page.getByLabel('Actions for Arlo', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Move (up|down|earlier)/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Move to section', exact: true }).hover();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Crews', exact: true })).toHaveCount(0);
});

test('menus open beside their work, connection stays visible, search has neutral inset spacing', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await expect(page.locator('.connection-status i')).toHaveCSS(
    'background-color',
    'rgb(133, 184, 154)',
  );
  const trigger = page.getByRole('button', { name: 'Add attachment', exact: true });
  const triggerBox = (await trigger.boundingBox())!;
  await trigger.click();
  const menu = page.locator('[data-placement="composer"]');
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(triggerBox.x - 1);
  await expect
    .poll(async () => {
      const b = (await menu.boundingBox())!;
      return b.y + b.height;
    })
    .toBeLessThan(triggerBox.y);
  await expect(menu.locator('svg')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  const account = page.locator('[data-placement="account"]');
  await expect(account.locator('[role="menuitem"] svg')).toHaveCount(3);
  const insets = await account.locator('[role="menuitem"]').evaluateAll((items) =>
    items.map((item) => {
      const c = getComputedStyle(item);
      return [c.paddingLeft, c.paddingRight];
    }),
  );
  expect(new Set(insets.map((v) => JSON.stringify(v))).size).toBe(1);
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-account-menu.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search Pebble Crew', exact: true }).click();
  const input = page.locator('[data-slot="command-input"]');
  await expect(input).toBeFocused();
  const wrapper = page.locator('[data-slot="command-input-wrapper"]');
  expect(
    await wrapper.evaluate((n) => parseFloat(getComputedStyle(n).paddingLeft)),
  ).toBeGreaterThanOrEqual(20);
  expect(
    await input.evaluate((n) => parseFloat(getComputedStyle(n).paddingTop)),
  ).toBeGreaterThanOrEqual(10);
  await expect(input).toHaveCSS('outline-style', 'none');
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-search.png' });
});

test('only closed header chevron nudges; Files uses a delayed loading bar without loading copy', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await page.getByRole('button', { name: /Show details/ }).click();
  const header = page.locator('.chat-title');
  await page.mouse.move(800, 800);
  const arrow = page.locator('.pc-details-chevron');
  const atRest = await arrow.evaluate((n) => getComputedStyle(n).translate);
  await header.hover();
  await page.waitForTimeout(250);
  expect(await arrow.evaluate((n) => getComputedStyle(n).translate)).toBe(atRest);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'files.list') await wait;
    await route.fallback();
  });
  try {
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Loading files' })).toBeVisible();
    await expect(page.locator('.details-panel')).not.toContainText(/Loading files/);
    await page.screenshot({ animations: 'disabled', path: 'test-results/owner-files-loading.png' });
  } finally {
    release();
  }
  await expect(page.getByRole('progressbar', { name: 'Loading files' })).toHaveCount(0);
});

test('existing agents get identity, appearance and role setup before native enrollment and introduction', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  const calls: { operation: string; params: Record<string, unknown> }[] = [];
  page.on('request', (r) => {
    if (['/v1/rpc', '/v1/avatar'].includes(new URL(r.url()).pathname)) calls.push(r.postDataJSON());
  });
  await ready(page);
  await newPebble(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-new-pebble.png' });
  await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
  await page.getByLabel('Search Hermes agents', { exact: true }).fill('existing');
  const choice = page.getByRole('button', { name: /Existing Example.*existing-example/ });
  expect((await choice.boundingBox())!.height).toBeLessThanOrEqual(64);
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-agent-picker.png' });
  await choice.click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Existing Example');
  await page.getByLabel('Name', { exact: true }).fill('Hazel');
  await page.getByLabel('Handle', { exact: true }).fill('hazel');
  await page.getByLabel('Title', { exact: true }).fill('Researcher');
  await page.getByLabel('Description', { exact: true }).fill('Explores useful questions');
  await page.getByRole('combobox', { name: 'Reports to', exact: true }).click();
  await page.getByRole('option', { name: 'Mica', exact: true }).click();
  await page.getByText('Responsibilities & boundaries', { exact: true }).click();
  await page.getByLabel('Responsibilities', { exact: true }).fill('Research and summarize');
  await page.getByLabel('Boundaries', { exact: true }).fill('Ask before publishing');
  await page.getByLabel('Expected outputs', { exact: true }).fill('A concise research brief');
  await expect(
    page.getByRole('checkbox', { name: 'Send me a welcome message', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'seed', exact: true }).click();
  await page.getByRole('button', { name: 'Moss', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-existing-setup.png' });
  await page.getByRole('button', { name: 'Add pebble', exact: true }).click();
  await expect(page.locator('.chat-title')).toContainText('Hazel');
  const added = fixture.state.bots.find((b) => b.profile === 'existing-example')!;
  expect(added.name).toBe('Hazel');
  expect(added.appearance).toEqual({ kind: 'shape', shape: 'seed', color: 'moss' });
  expect(added.role.title).toBe('Researcher');
  expect(added.manager).toBe('mica');
  expect(added.role.responsibilities).toBe('Research and summarize');
  expect(added.role.boundaries).toBe('Ask before publishing');
  expect(added.role.expectedOutputs).toBe('A concise research brief');
  await expect.poll(() => calls.filter((c) => c.operation === 'agent.welcome').length).toBe(1);
  expect(calls.filter((c) => c.operation === 'agent.onboard')).toHaveLength(1);
  expect(calls.some((c) => c.operation === 'chat.send')).toBe(false);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(calls.filter((c) => c.operation === 'agent.welcome')).toHaveLength(1);
  await page.getByRole('button', { name: 'Actions for Hazel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Reports to', exact: true })).toContainText(
    'Mica',
  );
  await page.getByText('Responsibilities & boundaries', { exact: true }).click();
  await expect(page.getByLabel('Responsibilities', { exact: true })).toHaveValue(
    'Research and summarize',
  );
});

test('Edit uses the same profile controls, persists names and retains all shape/color choices in photo mode', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await page.getByLabel('Actions for Mica', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mica Stone');
  await page.getByLabel('Title', { exact: true }).fill('Coordinator');
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Avatar shape' }).getByRole('button')).toHaveCount(
    10,
  );
  await expect(page.getByRole('group', { name: 'Avatar color' }).getByRole('button')).toHaveCount(
    12,
  );
  await page.getByRole('button', { name: 'drift', exact: true }).click();
  await page.getByRole('button', { name: 'Heather', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-edit-profile.png' });
  await page.getByRole('button', { name: 'Close Edit Mica Stone', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Mica Stone .*Bot Chat$/ })).toBeVisible();
  await page.getByLabel('Actions for Mica Stone', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Mica Stone');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-edit-mobile.png' });
});

test('whole rows drag between sections, pins and crews without exposed handles', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  fixture.state.bots.forEach((b, index) => {
    if (index > 3) {
      b.managed = false;
      b.canonical = false;
      b.enrolled = false;
    }
  });
  await ready(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New section', exact: true }).click();
  const sectionDialog = page.getByRole('dialog', { name: 'New section', exact: true });
  await sectionDialog.getByLabel('Name', { exact: true }).fill('Studio');
  await sectionDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(sectionDialog).toHaveCount(0);
  const studio = page.locator('.pc-list[aria-label="Studio"]');
  const row = page
    .locator('.pebble-row')
    .filter({ has: page.getByRole('button', { name: /^Rowan .*Bot Chat$/ }) });
  await row.dragTo(studio.locator('.pc-section-header'));
  await expect(studio.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toBeVisible();
  await expect(row.locator('.pc-section-grip')).toHaveCount(0);
  const pins = page.locator('.pinned-tile');
  await pins.nth(1).dragTo(pins.nth(0));
  await expect(pins.locator('strong')).toHaveText(['Mica', 'Arlo']);
  await page
    .locator('.pinned-tile')
    .filter({ has: page.getByRole('button', { name: /^Mica .*Bot Chat$/ }) })
    .dragTo(studio.locator('.pc-section-header'));
  await expect(studio.getByRole('button', { name: /^Mica .*Bot Chat$/ })).toBeVisible();
  await expect(pins.locator('strong')).toHaveText(['Arlo']);
  for (const name of ['First crew', 'Second crew']) {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New crew', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New crew', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const crews = page.locator('.pc-list[aria-label="Crews"]');
  const first = crews
    .locator('.pc-crew-row')
    .filter({ has: page.getByRole('button', { name: /^First crew / }) });
  const second = crews
    .locator('.pc-crew-row')
    .filter({ has: page.getByRole('button', { name: /^Second crew / }) });
  await second.dragTo(first);
  await expect(crews.locator('.pc-crew strong')).toHaveText(['Second crew', 'First crew']);
  const member = studio
    .locator('.pebble-row')
    .filter({ has: page.getByRole('button', { name: /^Rowan / }) });
  await member.click({ trial: true });
  await first.click({ trial: true });
  const from = (await member.boundingBox())!,
    to = (await first.boundingBox())!;
  await page.mouse.move(from.x + 24, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 36, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2);
  await page.mouse.up();
  await expect(
    crews
      .locator('.pc-crew-members')
      .last()
      .getByRole('button', { name: /^Rowan / }),
  ).toBeVisible();
});

test('a lost creation reply checks the same request and finishes setup without creating twice', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  fixture.loseNextCreationReply();
  const operations: string[] = [];
  page.on('request', (r) => {
    if (['/v1/rpc', '/v1/avatar'].includes(new URL(r.url()).pathname))
      operations.push(r.postDataJSON().operation);
  });
  await ready(page);
  await newPebble(page);
  await page.getByRole('button', { name: 'Create new pebble', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Nova');
  await page.getByRole('button', { name: 'Create pebble', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.locator('.chat-title')).toContainText('Nova');
  expect(fixture.state.bots.filter((b) => b.profile === 'nova')).toHaveLength(1);
  expect(operations.filter((o) => o === 'agent.propose')).toHaveLength(1);
  expect(operations.filter((o) => o === 'requests.approve')).toHaveLength(1);
});
