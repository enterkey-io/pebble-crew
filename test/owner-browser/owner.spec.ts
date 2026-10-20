import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SHAPES } from '../../apps/web/src/avatar-lab/engine';
test('private first use, native onboarding, idle keepalive, reconnection, settings and ordinary login', async ({
  page,
  context,
}) => {
  await page.clock.install();
  let tickets = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/hermes/ticket') tickets++;
  });
  const proof = (
    await readFile(resolve(process.env.WORKSPACE_TEST_STATE!, 'setup-code.txt'), 'utf8')
  ).trim();
  page.on('requestfailed', (r) => {
    if (r.url().includes(':8789'))
      console.log(
        'Fixture bridge network failure',
        new URL(r.url()).pathname,
        r.failure()?.errorText,
      );
  });
  page.on('response', async (r) => {
    if (r.url().includes(':8789') && !r.ok())
      console.log(
        'Fixture bridge HTTP failure',
        new URL(r.url()).pathname,
        r.status(),
        r.request().postDataJSON()?.operation,
        (await r.json().catch(() => ({}))).code,
      );
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let sends = 0;
  await page.route('**/v1/rpc', async (route) => {
    const operation = route.request().postDataJSON().operation;
    if (operation === 'chat.send') sends++;
    if (operation === 'workspace.detect_primary') {
      // Reproduce native profiles advertising an existing stock avatar.
      const response = await route.fetch();
      const body = await response.json();
      body.result.bot.name = 'Aurora';
      body.result.bot.appearance = { kind: 'photo', shape: 'pebble', color: 'citron' };
      await route.fulfill({ response, json: body });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  for (const [path, type] of [
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/icons/pebble-180.png', 'image/png'],
    ['/icons/pebble-192.png', 'image/png'],
    ['/icons/pebble-512.png', 'image/png'],
    ['/service-worker.js', 'javascript'],
    ['/offline.html', 'text/html'],
  ]) {
    const asset = await page.request.get(path!);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()['content-type']).toContain(type!);
  }
  await expect(page.getByRole('heading', { name: 'Create your login' })).toBeVisible();
  await page.getByLabel('Private setup code').fill(proof);
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-owner-password-123');
  await page.getByLabel('Confirm password').fill('synthetic-owner-password-123');
  await page.getByRole('button', { name: 'Create login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customize Aurora' })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText('Your existing primary Hermes agent.', { exact: true }),
  ).toBeVisible();
  const picker = page.locator('.appearance-picker');
  await expect(picker.getByRole('button', { name: 'Animated', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(picker.getByRole('button', { name: 'Iris', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(picker.locator('.avatar-preview svg.avatar')).toHaveCount(1);
  await expect(
    picker.getByRole('group', { name: 'Avatar shape', exact: true }).getByRole('button'),
  ).toHaveCount(SHAPES.length);
  await expect(picker.getByRole('group', { name: 'Avatar shape', exact: true })).toHaveText('');
  await expect(picker.getByRole('group', { name: 'Avatar color', exact: true })).toHaveText('');
  const face = picker.locator('.avatar-preview [data-avatar-part="body"]');
  const initialGaze = await face.getAttribute('transform');
  await page.clock.runFor(7100);
  expect(await face.getAttribute('transform')).not.toBe(initialGaze);
  await picker.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(picker.locator('.avatar-preview svg.avatar')).toHaveCount(0);
  await expect(picker.locator('.empty-photo')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Start chatting', exact: true })).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Upload photo', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Animated', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Send an introduction' }).uncheck();
  await page.locator('.handle-input input').fill('aurora');
  await page.getByRole('button', { name: 'Snow', exact: true }).click();
  await page.getByRole('button', { name: 'petal', exact: true }).click();
  await expect(
    picker.getByRole('group', { name: 'Avatar shape', exact: true }).locator('path'),
  ).toHaveCount(SHAPES.length);
  for (const path of await picker
    .getByRole('group', { name: 'Avatar shape', exact: true })
    .locator('path')
    .all())
    await expect(path).toHaveAttribute('fill', '#f4f3ef');
  await expect(picker.locator('.avatar-preview path[fill="#f4f3ef"]')).toHaveCount(1);
  await page.screenshot({ animations: 'disabled', path: 'test-results/agent-setup-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Start chatting', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: 'test-results/agent-setup-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Accelerated timers diverge from Web Animations' clock. Real-frame browser journeys verify motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Start chatting', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  const sessionCookie = (await context.cookies()).find((c) => c.name.includes('session_token'));
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  await expect(page.locator('.chat-header').getByText('@aurora', { exact: true })).toBeVisible();
  await page.waitForTimeout(2500); // accelerated server lease is 1s; authenticated heartbeats must keep it alive.
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  expect(sends).toBe(0);
  await page.clock.fastForward(240001);
  await expect.poll(() => tickets).toBeGreaterThanOrEqual(2);
  await page.getByLabel('Message', { exact: true }).fill('Synthetic unsent draft stays here');
  await context.setOffline(true);
  // Break the browser stream explicitly: offline alone can retain an existing loopback socket.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(1500);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Synthetic unsent draft stays here',
  );
  expect(sends).toBe(0);
  const restart = await page.request.post('https://127.0.0.1:8789/fixture/restart-native', {
    headers: { Origin: 'https://127.0.0.1:5445', Authorization: 'Bearer ' + 'f'.repeat(43) },
  });
  expect(restart.ok()).toBeTruthy();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Synthetic unsent draft stays here',
  );
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New crew', exact: true }).click();
  const crew = page.getByRole('dialog', { name: 'New crew', exact: true });
  await crew.getByLabel('Name', { exact: true }).fill('Research');
  await crew.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Research .*Open chat$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Alpha', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(512, 512);
    let seed = 123456;
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        image.data[i + c] = seed & 255;
      }
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  expect(Buffer.byteLength(png)).toBeGreaterThan(65_536);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByLabel('Choose photo').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Photo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const savedPhoto = page.waitForRequest(
    (request) =>
      request.url().endsWith('/v1/avatar') &&
      request.postDataJSON().operation === 'bots.profile.update',
  );
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  expect(Buffer.byteLength((await savedPhoto).postData()!)).toBeGreaterThan(65_536);
  await expect(
    page
      .getByRole('navigation', { name: 'Pebbles', includeHidden: true })
      .locator('.agent-avatar img'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Animated', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Pebbles', includeHidden: true })
      .locator('.agent-avatar img'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Pebbles', includeHidden: true })
      .locator('.agent-avatar img'),
  ).toHaveCount(1);
  await page.getByLabel('Title', { exact: true }).fill('Team lead');
  await page.getByLabel('Description', { exact: true }).fill('Coordinates synthetic research');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await page.getByLabel('Instructions', { exact: true }).fill('Coordinate synthetic research.');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(
    page.getByRole('tabpanel', { name: 'Role', exact: true }).getByRole('status'),
  ).toHaveText('Role saved.');
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
    'Coordinate synthetic research.',
  );
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Team lead');
  await page.getByRole('button', { name: 'Close Edit Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  const accountPhoto = page.getByLabel('Your photo', { exact: true });
  await accountPhoto.setInputFiles({
    name: 'synthetic-owner.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Change photo', exact: true })).toBeEnabled();
  const personalImage = page.locator('.personal-avatar-large img');
  await expect
    .poll(() => personalImage.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(192);
  const savedPersonalPhoto = await personalImage.getAttribute('src');
  expect(savedPersonalPhoto).toMatch(/^data:image\/png;base64,/);
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-account-photo.png' });
  await page.getByLabel('Current password', { exact: true }).fill('synthetic-owner-password-123');
  await page.getByLabel('New password', { exact: true }).fill('synthetic-owner-password-456');
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('synthetic-owner-password-456');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password changed.');
  await page.getByRole('button', { name: 'Sign out other devices', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Other devices will be signed out within five minutes.',
  );
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Alpha', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Tools & skills', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(
          Number.parseFloat(
            document.documentElement.style.getPropertyValue('--app-viewport-height'),
          ) - (window.visualViewport?.height ?? innerHeight),
        ),
      ),
    )
    .toBeLessThan(1);
  await page
    .getByRole('button', { name: 'Save tools & skills', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: 'Save tools & skills', exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Close Edit Alpha', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('.pc-rail-footer .personal-avatar img')).toHaveAttribute(
    'src',
    savedPersonalPhoto!,
  );
  await expect(page.getByRole('heading', { name: 'Create your login' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-owner-password-456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('.pc-rail-footer .personal-avatar img')).toHaveAttribute(
    'src',
    savedPersonalPhoto!,
  );
  await page.getByRole('button', { name: 'Actions for Alpha', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Alpha Stone');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Edit Alpha Stone', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Alpha Stone .*Bot Chat$/ })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
  await page.getByRole('button', { name: /Gamma.*gamma/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hazel');
  await page.getByLabel('Handle', { exact: true }).fill('hazel');
  await page.getByLabel('Title', { exact: true }).fill('Researcher');
  await page.getByLabel('Description', { exact: true }).fill('Synthetic existing researcher');
  await page.getByRole('combobox', { name: 'Reports to', exact: true }).click();
  await page.getByRole('option', { name: 'Beta', exact: true }).click();
  const instructions =
    'Summarize sources.\n' +
    'Keep sources attributable. '.repeat(60) +
    '\nAsk before publishing. Return a research brief.';
  await page.getByLabel('Instructions', { exact: true }).fill(instructions);
  const beforeSetupRecovery = tickets;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect.poll(() => tickets).toBeGreaterThan(beforeSetupRecovery);
  await expect(page.getByRole('button', { name: 'Add pebble', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Hazel');
  await expect(page.getByRole('combobox', { name: 'Reports to', exact: true })).toContainText(
    'Beta',
  );
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(instructions);
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'seed', exact: true }).click();
  await page.getByRole('button', { name: 'Moss', exact: true }).click();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/native-existing-onboarding.png',
  });
  await page.getByRole('button', { name: 'Add pebble', exact: true }).click();
  await expect(page.locator('.chat-title')).toContainText('Hazel', { timeout: 30000 });
  await expect(page.getByRole('log')).toContainText('Native fixture reply', { timeout: 30000 });
  await expect(page.getByRole('log').locator('[data-message-role="user"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Hazel .*Bot Chat$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Hazel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Reports to', exact: true })).toContainText(
    'Beta',
  );
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(instructions);
  await expect(page.getByLabel('Boundaries', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Expected outputs', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Edit Hazel', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Create new pebble', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Nova');
  await page.getByLabel('Title', { exact: true }).fill('Analyst');
  await page.getByLabel('Description', { exact: true }).fill('Synthetic new-agent flow');
  await page.getByRole('button', { name: 'flint', exact: true }).click();
  await page.getByRole('button', { name: 'Umber', exact: true }).click();
  await page.getByRole('button', { name: 'Create pebble', exact: true }).click();
  await expect(page.locator('.chat-title')).toContainText('Nova', { timeout: 30000 });
  await expect(page.getByRole('log')).toContainText('Native fixture reply', { timeout: 30000 });
  await expect(page.getByRole('log').locator('[data-message-role="user"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(sends).toBe(0);
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-workspace.png' });
  await page.clock.resume();
  // Lease-expiry proof deliberately advanced the browser clock. Live document
  // request timestamps now need the same wall clock as the native fixture.
  await page.clock.setSystemTime(new Date());
  await page.getByLabel('Message', { exact: true }).fill('nativereaction');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const mine = page.locator('[data-message-role="user"]').filter({ hasText: 'nativereaction' });
  await expect(mine.getByRole('button', { name: '👍 · Nova', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('.pc-activity')).toHaveCount(0, { timeout: 30000 });
  const reply = page
    .locator('[data-message-role="assistant"]')
    .filter({ hasText: 'Native fixture reply' })
    .last();
  await reply.hover();
  await reply.getByRole('button', { name: 'React to message', exact: true }).click();
  await page.getByRole('menuitem', { name: 'React with heart', exact: true }).click();
  await expect(reply.getByRole('button', { name: '❤️ · You', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(sends).toBe(1); // A reaction must not dispatch a model turn.
  await page.getByLabel('Message', { exact: true }).fill('nativefeedback');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Native feedback received', { timeout: 30000 });
  await expect(page.locator('.pc-activity')).toHaveCount(0, { timeout: 30000 });
  await page.reload();
  await page.getByRole('button', { name: /^Nova .*Bot Chat$/ }).click();
  await expect(page.getByRole('button', { name: '👍 · Nova', exact: true })).toBeVisible({
    timeout: 30000,
  });
  const heart = page.getByRole('button', { name: '❤️ · You', exact: true });
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await heart.click();
  await expect(heart).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^Nova .*Bot Chat$/ }).click();
  await expect(page.getByRole('button', { name: '👍 · Nova', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(heart).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/native-reactions-desktop.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const input = (await page.getByLabel('Message', { exact: true }).boundingBox())!;
      return input.y + input.height;
    })
    .toBeLessThanOrEqual(844);
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/native-reactions-phone.png',
  });
  await page.getByLabel('Message', { exact: true }).fill('nativegeneratedmedia');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const chart = page.getByRole('img', { name: 'Project chart', exact: true });
  await expect(chart).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() => chart.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(320);
  const mediaDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download figures', exact: true }).click();
  const figures = await mediaDownload;
  expect(figures.suggestedFilename()).toBe('figures.csv');
  expect((await readFile((await figures.path())!)).length).toBe(1430000);
  await page.reload();
  await expect(chart).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() => chart.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(320);
  expect(errors).toEqual([]);
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/native-agent-media-phone.png',
  });
  await page.getByLabel('Message', { exact: true }).fill('nativedocument');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const reader = page.getByRole('region', { name: 'Document viewer', exact: true });
  await expect(reader.getByRole('heading', { name: 'Project plan', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(reader.getByText('Native document proof', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-document-phone.png' });
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'View plan.md', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'View plan.md', exact: true }).click();
  await expect(reader.getByText('Native document proof', { exact: true })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/native-document-desktop.png',
  });
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  // The chart and existing editor share actual native persistence, including
  // an explicitly unattached newly created agent and a manager change.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Message', { exact: true }).fill('Keep this native draft');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  const org = page.getByRole('region', { name: 'Org chart', exact: true });
  await expect(org.getByRole('heading', { name: 'Unattached', exact: true })).toBeVisible();
  await org.getByRole('button', { name: 'Edit Nova', exact: true }).click();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  const manager = page.getByRole('combobox', { name: 'Reports to', exact: true });
  await expect(manager).toContainText('No manager');
  await manager.click();
  await page.getByRole('option', { name: 'Alpha Stone', exact: true }).click();
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Verify results and report to Alpha Stone.');
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Edit Nova', exact: true })).toHaveCount(0);
  await expect(org.getByRole('button', { name: 'Edit Nova', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-org-desktop.png' });
  await org.getByRole('button', { name: 'Close Org chart', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this native draft');
  await page.reload();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  await org.getByRole('button', { name: 'Edit Nova', exact: true }).click();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await expect(manager).toContainText('Alpha Stone');
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
    'Verify results and report to Alpha Stone.',
  );
  await page.getByRole('button', { name: 'Close Edit Nova', exact: true }).click();
  await org.getByRole('button', { name: 'Close Org chart', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New project board', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Native owner project');
  await page.getByLabel('Description', { exact: true }).fill('Record original evidence.');
  await page.getByRole('button', { name: 'Create project board', exact: true }).click();
  await page.getByRole('button', { name: 'View Board', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Native owner project', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Native owner task');
  await page.getByLabel('Details', { exact: true }).fill('- [ ] Verify the native board');
  await page.getByRole('combobox', { name: 'Assigned to', exact: true }).click();
  await page.getByRole('option', { name: 'Nova', exact: true }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open task Native owner task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Verified native owner task');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task', exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Open task Verified native owner task', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByLabel('Comment', { exact: true }).fill('**Native persistence** verified.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('Native persistence', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-task-desktop.png' });
  await page.getByRole('button', { name: 'Close Task', exact: true }).click();
  await page.reload();
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /^Native owner project(?: \d+)?$/ }).click();
  await page
    .getByRole('button', { name: 'Open task Verified native owner task', exact: true })
    .click();
  await expect(page.getByRole('combobox', { name: 'Assigned to', exact: true })).toContainText(
    'Nova',
  );
  await expect(page.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue(
    '- [ ] Verify the native board',
  );
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Native persistence', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
