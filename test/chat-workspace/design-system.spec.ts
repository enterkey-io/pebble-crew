import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture, emit } from './fixtures';
import type { Page } from '@playwright/test';
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
}
async function newItem(page: Page, name: string) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function accessible(page: Page) {
  await page.waitForTimeout(200);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
}

test('shared design system: account settings, connections, requests, editor and keyboard menus', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await accessible(page);
  await openSidebarMenu(page, 'Arlo');
  const menu = page.getByRole('menu', { name: 'Actions for Arlo' });
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(1440 - 8);
  await page.keyboard.press('Escape');
  await expect(sidebarItem(page, 'Arlo').getByRole('button').first()).toBeVisible();
  await settings(page);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Teams', exact: true })).toHaveCount(0);
  await accessible(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings-account.png' });
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await expect(page.getByText('No connections', { exact: true })).toBeVisible();
  await accessible(page);
  await expect(page.getByRole('tab', { name: 'Requests', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Mica' })).toBeVisible();
  await accessible(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/edit-pebble-profile.png' });
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await page.getByLabel('Instructions', { exact: true }).fill('Coordinate the team.');
  const saveRole = page.getByRole('button', { name: 'Save role', exact: true });
  const primary = await saveRole.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(primary).toBe('rgb(236, 236, 235)');
  await saveRole.click();
  await expect(page.getByText('Role saved.', { exact: true })).toBeVisible();
  await accessible(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/edit-pebble-role.png' });
  await page.getByRole('tab', { name: 'Tools & skills', exact: true }).click();
  await expect(page.getByLabel('Browser', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save tools & skills', exact: true })).toHaveCSS(
    'background-color',
    primary,
  );
  await accessible(page);
});

test('editor preserves drafts across events and unrelated saves, resolves conflicts and guards navigation', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  await ready(page);
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByLabel('Handle', { exact: true }).fill('my-mica');
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await page.getByLabel('Instructions', { exact: true }).fill('My saved role instructions');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByText('Role saved.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('my-mica');
  fixture.state.bots.find((b) => b.profile === 'mica')!.handle = 'remote-mica';
  fixture.state.revision++;
  await emit(page, 'workspace.changed');
  await expect(page.getByText('The saved handle changed while you were editing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my edits' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  await page.getByLabel('Handle', { exact: true }).fill('unsaved');
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  let dialog = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('unsaved');
  fixture.replace('mica');
  await emit(page, 'workspace.changed');
  await expect(
    page.getByText('This pebble was removed or replaced.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('unsaved');
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  dialog = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('sidebar creates and edits crews without changing relationships; fresh and existing pebble flows are distinct', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  await ready(page);
  await newItem(page, 'New crew');
  let dialog = page.getByRole('dialog', { name: 'New crew', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Studio');
  await dialog.getByRole('checkbox', { name: 'Arlo', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Mica', exact: true }).check();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.state.bots.find((b) => b.profile === 'mica')!.manager).toBe('arlo');
  await expect(page.getByRole('button', { name: /^Studio .*Open chat$/ })).toBeVisible();
  await openSidebarMenu(page, 'Studio');
  await page.getByRole('menuitem', { name: 'Crew settings', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Crew settings', exact: true });
  await dialog.getByRole('button', { name: 'Remove crew', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Mica .*Bot Chat$/ })).toBeVisible();
  await newItem(page, 'New pebble');
  await accessible(page);
  await page.getByRole('button', { name: 'Create new', exact: false }).click();
  await page.getByLabel('Name', { exact: true }).fill('Nova');
  await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('nova');
  await page.getByLabel('Title', { exact: true }).fill('Researcher');
  await page.getByRole('button', { name: 'Create pebble', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Nova .*Bot Chat$/ })).toBeVisible();
  await newItem(page, 'New pebble');
  await page.getByRole('button', { name: 'Add existing', exact: false }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose a Hermes agent', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Existing Example.*existing-example/ }).click();
  await expect(page.getByRole('form', { name: 'Configure existing agent' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Hazel');
  await page.getByLabel('Title', { exact: true }).fill('Analyst');
  await page.getByRole('button', { name: 'seed', exact: true }).click();
  await page.getByRole('button', { name: 'Moss', exact: true }).click();
  await page.getByRole('button', { name: 'Add pebble', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Hazel .*Bot Chat$/ })).toBeVisible();
});

test('attachments are conversation bound, can be removed, send without text, and download in Files', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  const picker = page.getByLabel('Choose attachments');
  await picker.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic private note'),
  });
  await expect(page.locator('.attachment-chips')).toContainText('notes.txt');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.locator('.attachment-chips')).toHaveCount(0);
  await page.getByRole('button', { name: /^Arlo .*Bot Chat$/ }).click();
  await expect(page.locator('.attachment-chips')).toContainText('notes.txt');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.attachment-chips')).toHaveCount(0);
  await page.getByRole('button', { name: /Show details/ }).click();
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(page.locator('.file-list')).toContainText('notes.txt');
  const download = page.waitForEvent('download');
  await page
    .getByRole('tabpanel', { name: 'Library', exact: true })
    .getByRole('button', { name: 'Download notes.txt', exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('notes.txt');
  await accessible(page);
  await picker.setInputFiles({
    name: 'temporary.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Temporary'),
  });
  await expect(page.getByRole('button', { name: 'Remove temporary.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove temporary.txt' }).click();
  await expect(page.locator('.attachment-chips')).toHaveCount(0);
});

test('tool calls are grouped, empty reasoning rows are omitted, final sidecars are visible', async ({
  page,
  context,
}) => {
  await installFixture(context, {
    messages: [
      { row_id: 1, role: 'assistant', text: '', reasoning: 'PRIVATE_REASONING' },
      { row_id: 2, role: 'tool', text: 'Read complete', tool_name: 'read_file' },
      { row_id: 3, role: 'assistant', text: '' },
      { row_id: 4, role: 'tool', text: 'Write complete', tool_name: 'write_file' },
      {
        row_id: 5,
        role: 'assistant',
        text: '',
        codex_message_items: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'The final answer.' }],
          },
        ],
      },
    ],
  });
  await ready(page);
  const log = page.getByRole('log');
  await expect(log.locator('.activity-group')).toHaveCount(1);
  await expect(log.locator('[data-slot="message"]')).toHaveCount(1);
  await expect(log).toContainText('The final answer.');
  await expect(log).not.toContainText('PRIVATE_REASONING');
  await log.getByText('2 tool calls', { exact: true }).click();
  await expect(log).toContainText('Read complete');
  await accessible(page);
});

test('small screens keep dialogs bounded, nested unsaved confirmation restores focus, reduced motion scrolls deliberately', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  await ready(page);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New crew', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New crew', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Draft crew');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Draft crew');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/new-crew-mobile.png' });
  await page.keyboard.press('Escape');
  await page
    .getByRole('alertdialog', { name: 'Discard changes?' })
    .getByRole('button', { name: 'Discard' })
    .click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('pin feedback is immediate and rolls back on failure; details, scroll motion and zoom keep context', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let started = false;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'agent.pin') {
      started = true;
      await wait;
      await route.fulfill({ status: 400, json: { code: 'STALE_REVISION' } });
    } else await route.fallback();
  });
  await openSidebarMenu(page, 'Rowan');
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await expect(
    page
      .locator('.pinned-tile')
      .filter({ has: page.getByRole('button', { name: /^Rowan .*Bot Chat$/ }) }),
  ).toHaveCount(1);
  await expect(page.locator('.pin-saving')).toBeVisible();
  release();
  await expect(page.locator('.pinned-tile')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toBeVisible();
  const log = page.getByRole('log');
  await log.evaluate((n) => {
    n.scrollTop = 0;
    n.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: /Show details/ }).click();
  await page.getByRole('button', { name: /Hide details/ }).click();
  await expect(page.locator('.pc-details-slot')).toHaveCSS('width', '0px');
  await page.getByRole('button', { name: /Show details/ }).click();
  expect(await log.evaluate((n) => n.scrollTop)).toBeLessThan(150);
  const samples = await page.evaluate(async () => {
    const n = document.querySelector<HTMLElement>('[role=log]')!;
    const button = document.querySelector<HTMLButtonElement>('.jump-latest')!;
    const values: number[] = [];
    button.click();
    await new Promise<void>((resolve) => {
      const start = performance.now();
      function read() {
        values.push(n.scrollTop);
        if (performance.now() - start < 350) requestAnimationFrame(read);
        else resolve();
      }
      requestAnimationFrame(read);
    });
    return { values, bottom: n.scrollHeight - n.clientHeight };
  });
  expect(samples.values.some((v) => v > 0 && v < samples.bottom - 2)).toBe(true);
  expect(samples.values.at(-1)).toBeCloseTo(samples.bottom, 0);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
});

test('mobile browser Back closes the top overlay and keeps the underlying app available', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: /Show details/ }).click();
  await expect(page.locator('.pc-details-slot')).toHaveCSS('width', '390px');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Show details/ })).toBeFocused();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'navigation' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('browser Back protects an unsaved Crew then closes only its confirmation', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.setViewportSize({ width: 320, height: 640 });
  await ready(page);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await newItem(page, 'New crew');
  const crew = page.getByRole('dialog', { name: 'New crew', exact: true });
  await crew.getByLabel('Name', { exact: true }).fill('Back draft');
  await expect(crew.getByRole('button', { name: 'Create', exact: true })).toBeInViewport();
  await page.goBack();
  await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toHaveCount(0);
  await expect(crew.getByLabel('Name', { exact: true })).toHaveValue('Back draft');
  await page.goBack();
  await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('closing a new pebble preserves a creation draft until it is explicitly discarded', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await newItem(page, 'New pebble');
  await page.getByRole('button', { name: 'Create new', exact: false }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved Nova');
  await page.getByRole('button', { name: 'Close Create a pebble', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved Nova');
  await page.getByRole('button', { name: 'Close Create a pebble', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('resting pebbles look away, breathe, track only the hovered row smoothly, then settle', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await page.mouse.move(800, 800);
  const avatar = page.locator('.pinned-tile').first().locator('svg.avatar');
  const body = avatar.locator('[data-avatar-part="body"]');
  const center = () =>
    avatar.evaluate((svg) => {
      const eyes = [...svg.querySelectorAll('rect')];
      const local = (svg as SVGSVGElement).getCTM()!.inverse();
      return eyes.reduce((sum, eye) => sum + local.multiply(eye.getCTM()!).e, 0) / eyes.length;
    });
  await expect.poll(center).toBeGreaterThan(55);
  const before = await body.getAttribute('transform');
  await expect.poll(() => body.getAttribute('transform')).not.toBe(before);
  const samples = await page.evaluate(async () => {
    const row = document.querySelector('.pinned-tile')!,
      svg = row.querySelector('svg.avatar')!,
      box = row.getBoundingClientRect(),
      face = svg.getBoundingClientRect();
    const values: number[] = [];
    row.dispatchEvent(
      new PointerEvent('pointerenter', {
        pointerType: 'mouse',
        clientX: box.left + 1,
        clientY: face.top + face.height / 2,
      }),
    );
    await new Promise<void>((resolve) => {
      const start = performance.now();
      function read() {
        const eyes = [...svg.querySelectorAll('rect')];
        const local = (svg as SVGSVGElement).getCTM()!.inverse();
        values.push(
          eyes.reduce((sum, eye) => sum + local.multiply(eye.getCTM()!).e, 0) / eyes.length,
        );
        if (performance.now() - start < 400) requestAnimationFrame(read);
        else resolve();
      }
      requestAnimationFrame(read);
    });
    row.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    return values;
  });
  expect(samples.some((x) => x > 43 && x < 54)).toBe(true);
  expect(samples.at(-1)).toBeLessThan(43);
  await expect.poll(center).toBeGreaterThan(55);
  await emit(page, 'message.start');
  await emit(page, 'message.complete', { status: 'done' });
  await expect(avatar).toHaveAttribute('data-state', 'done');
  await expect(avatar).toHaveAttribute('data-state', 'ready', { timeout: 4000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(avatar).toHaveAttribute('data-motion', 'static');
  const frozen = await body.getAttribute('transform');
  await page.locator('.pinned-tile').first().hover();
  await page.waitForTimeout(350);
  expect(await body.getAttribute('transform')).toBe(frozen);
});

test('chat proportions, restrained header hover, new avatar choices and minimal live activity', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  const header = page.locator('.chat-title');
  const base = await header.evaluate((n) => getComputedStyle(n).backgroundColor);
  await header.hover();
  await expect(header).toHaveCSS('background-color', base);
  const user = page.locator('[data-message-role="user"] [data-slot="bubble"]').first();
  expect(await user.evaluate((n) => getComputedStyle(n).maxWidth)).toBe('80%');
  await expect(
    page.locator('[data-message-role="assistant"] [data-slot="message-response"]').first(),
  ).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await emit(page, 'message.start');
  const activity = page.locator('.pc-activity');
  await expect(activity).toHaveText('Thinking');
  expect(
    await activity
      .locator('[data-slot=trace-title]')
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toContain('shimmer');
  await emit(page, 'tool.start', { name: 'terminal' });
  await expect(activity).toHaveText('Running a command');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(activity.locator('[data-slot=trace-title]')).toHaveCSS('animation-name', 'none');
  await emit(page, 'message.complete', { status: 'done' });
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble' }).click();
  await expect(page.getByRole('group', { name: 'Avatar shape' }).getByRole('button')).toHaveCount(
    10,
  );
  await expect(page.getByRole('group', { name: 'Avatar color' }).getByRole('button')).toHaveCount(
    12,
  );
  await page.getByRole('button', { name: 'cairn', exact: true }).click();
  await page.getByRole('button', { name: 'Umber', exact: true }).click();
  await expect(page.getByRole('button', { name: 'cairn', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Umber', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Crew chat waits for pending membership save and opens native conversation instead of settings', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await ready(page);
  await newItem(page, 'New crew');
  const editor = page.getByRole('dialog', { name: 'New crew', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('Roundtable');
  await editor.getByRole('checkbox', { name: 'Arlo', exact: true }).check();
  await editor.getByRole('checkbox', { name: 'Mica', exact: true }).check();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving = false;
  let opens = 0;
  await page.route('**/v1/rpc', async (route) => {
    const data = route.request().postDataJSON();
    if (data.operation === 'organization.chat') opens++;
    if (
      data.operation === 'organization.save' &&
      data.params.organization.crews[0]?.members.length === 2
    ) {
      saving = true;
      await waiting;
    }
    await route.fallback();
  });
  try {
    await editor.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => saving).toBe(true);
    await page.getByRole('button', { name: /^Roundtable .*Open chat$/ }).click();
    await page.waitForTimeout(150);
    expect(opens).toBe(0);
    release();
    await expect.poll(() => opens).toBe(1);
    await expect(page.locator('.chat-title')).toContainText('Roundtable');
    await expect(page.getByRole('log')).toContainText('I have the notes ready.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    release();
  }
});
