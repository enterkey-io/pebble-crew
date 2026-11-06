import { submitMessage } from '../composer';
import { atmeePortrait, atmeeWav, installAtmeeRoom } from '../atmee-room';
import { execFileSync } from 'node:child_process';
import { openSidebarMenu } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { focusOrgCard } from '../chat-workspace/org-chart-driver';
import { SHAPES } from '../../apps/web/src/avatar-lab/engine';
test.describe.configure({ mode: 'serial' });
let ownerCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
let syntheticPhoto = '';
function observeOwner(page: Page) {
  const errors: string[] = [];
  const signals = { tickets: 0, events: 0, sends: 0, errors };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/hermes/ticket') signals.tickets++;
    if (new URL(request.url()).pathname === '/v1/events') signals.events++;
    if (request.url().endsWith('/v1/rpc') && request.postDataJSON()?.operation === 'chat.send')
      signals.sends++;
  });
  page.on('pageerror', (error) => signals.errors.push(error.message));
  return signals;
}
async function installNativeStreamControl(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (!String(input).endsWith('/v1/events')) return original(input, init);
      const controller = new AbortController();
      Reflect.set(window, '__interruptNativeEvents', () => controller.abort());
      return original(input, {
        ...init,
        signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]),
      });
    };
  });
}
function expectNoChatSends(signals: ReturnType<typeof observeOwner>) {
  expect(signals.errors).toEqual([]);
  expect(signals.sends).toBe(0);
}

test('private first use, native onboarding, idle keepalive and reconnection', async ({
  page,
  context,
}) => {
  await page.clock.install();
  await installNativeStreamControl(page);
  const signals = observeOwner(page);
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
  await page.route('**/v1/rpc', async (route) => {
    const operation = route.request().postDataJSON().operation;
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
  await expect(page).toHaveTitle('Create admin login — Pebble Crew');
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
  await expect(
    picker.getByRole('img', { name: 'Selected avatar' }).locator('img, svg'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start chatting', exact: true })).toBeDisabled();
  await expect(picker.getByRole('button', { name: 'Upload photo', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Animated', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Send an introduction' }).uncheck();
  await page.getByLabel('Handle', { exact: true }).fill('aurora');
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
  const proactive = page.getByRole('dialog', { name: 'Proactive help', exact: true });
  await expect(proactive).toBeVisible();
  await proactive.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  const sessionCookie = (await context.cookies()).find((c) => c.name.includes('session_token'));
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  await expect(page.locator('.chat-header').getByText('@aurora', { exact: true })).toBeVisible();
  await page.waitForTimeout(2500); // accelerated server lease is 1s; authenticated heartbeats must keep it alive.
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  expect(signals.sends).toBe(0);
  await page.clock.fastForward(240001);
  await expect.poll(() => signals.tickets).toBeGreaterThanOrEqual(2);
  await page.getByLabel('Message', { exact: true }).fill('Synthetic unsent draft stays here');
  await context.setOffline(true);
  // Interrupt the actual fetch; browser network notifications alone are only scheduling hints.
  await page.evaluate(() => Reflect.get(window, '__interruptNativeEvents')());
  await page.waitForTimeout(1500);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Synthetic unsent draft stays here',
  );
  expect(signals.sends).toBe(0);
  const restart = await page.request.post('https://127.0.0.1:8789/fixture/restart-native', {
    headers: { Origin: 'https://127.0.0.1:5445', Authorization: 'Bearer ' + 'f'.repeat(43) },
  });
  expect(restart.ok()).toBeTruthy();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Synthetic unsent draft stays here',
  );
  expectNoChatSends(signals);
  ownerCookies = await context.cookies();
});

test('three Markdown uploads stay attachment cards across native completion and reload', async ({
  page,
  context,
}, info) => {
  await context.addCookies(ownerCookies);
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await page.getByRole('button', { name: /^Aurora .*Bot Chat$/ }).click();
  const documents = [0, 1, 2].map((index) => ({
    name: `reference ${index}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Reference ${index}\n\nPRIVATE_REFERENCE_DOCUMENT_${index}`),
  }));
  await page.getByLabel('Choose attachments').setInputFiles(documents);
  await expect(page.locator('.attachment-chips li')).toHaveCount(3);
  await field.fill('nativethreedocuments: use these as reference.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('log')).toContainText(
    'Three reference documents received by Hermes.',
    { timeout: 60000 },
  );
  async function assertClean() {
    const message = page
      .locator('[data-message-role="user"]')
      .filter({ hasText: 'nativethreedocuments:' });
    await expect(message).toHaveCount(1);
    for (const document of documents) await expect(message).toContainText(document.name);
    await expect(message).not.toContainText('PRIVATE_REFERENCE_DOCUMENT');
    await expect(message).not.toContainText('Attached Context');
    await expect(message).not.toContainText('@file:');
  }
  await assertClean();
  await page.reload();
  await expect(field).toBeEnabled();
  await assertClean();
  await page.screenshot({
    path: info.outputPath('three-markdown-attachments-desktop.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertClean();
  await page.screenshot({
    path: info.outputPath('three-markdown-attachments-phone.png'),
    animations: 'disabled',
  });
});

test('native private replies update durable owner history through the real live stream', async ({
  page,
  context,
}, info) => {
  await context.addCookies(ownerCookies);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await page.getByRole('button', { name: /^Aurora .*Bot Chat$/ }).click();
  await expect(field).toBeEnabled();
  await field.fill('nativehandoff: send the private test request to Beta');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('log')).toContainText(
    'nativehandoff: send the private test request to Beta',
  );
  const link = page.getByRole('button', { name: '3 messages with Beta', exact: true });
  await expect(link).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('log')).not.toContainText('Teammate delivery proof');
  await link.click();
  const viewer = page.getByRole('dialog', { name: /^(Aurora and Beta|Beta and Aurora)$/ });
  await expect(viewer.locator('[data-exchange-message]')).toHaveCount(3);
  await expect(viewer).toContainText('Teammate delivery proof');
  await page.screenshot({
    path: info.outputPath('native-live-exchange.png'),
    animations: 'disabled',
  });
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(field).toBeEnabled();
  await expect(link).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText('Teammate delivery proof');
  expect(errors).toEqual([]);
});

test('native group chats, avatar switching and role persistence', async ({ page, context }) => {
  await context.addCookies(ownerCookies);
  const signals = observeOwner(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New group chat', exact: true }).click();
  const crew = page.getByRole('dialog', { name: 'New group chat', exact: true });
  await crew.getByLabel('Name', { exact: true }).fill('Research');
  for (const name of ['Alpha', 'Beta'])
    await crew.getByRole('checkbox', { name, exact: true }).check();
  await crew.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Research .*Open chat$/ })).toBeVisible();
  await expect(page.locator('.chat-title')).toContainText('Research');
  const groupField = page.getByLabel('Message', { exact: true });
  await groupField.fill('@');
  await page.getByRole('option', { name: 'Alpha @alpha', exact: true }).click();
  await groupField.fill('@alpha Hello from the group');
  await submitMessage(page);
  const groupMessage = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: '@alpha Hello from the group' });
  await expect(groupMessage).toHaveCount(1);
  await expect(groupMessage).toHaveAttribute('data-message-id', /^user:/);
  await expect(page.locator('[data-message-id^="pending-"]')).toHaveCount(0);
  const groupReply = page
    .locator('[data-message-role="assistant"]')
    .filter({ hasText: 'Native fixture reply' })
    .last();
  await expect(groupReply).toBeVisible({ timeout: 30000 });
  await expect(groupReply.locator('[data-slot="message-header"] .agent-avatar')).toBeVisible();
  await groupReply.getByRole('button', { name: 'React to message', exact: true }).click();
  await page.getByRole('menuitem', { name: 'React with heart', exact: true }).click();
  await expect(groupReply.getByRole('button', { name: '❤️ · You', exact: true })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/native-crew-conversation.png',
  });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New group chat', exact: true }).click();
  const groupDialog = page.getByRole('dialog', { name: 'New group chat', exact: true });
  await groupDialog.getByLabel('Name', { exact: true }).fill('Quick discussion');
  for (const name of ['Alpha', 'Beta'])
    await groupDialog.getByRole('checkbox', { name, exact: true }).check();
  await groupDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.chat-title')).toContainText('Quick discussion');
  await expect(
    page.getByRole('button', {
      name: 'Quick discussion Open chat',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Research .*Open chat$/ })).toBeVisible();
  await openSidebarMenu(page, 'Alpha');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  syntheticPhoto = await page.evaluate(() => {
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
  expect(Buffer.byteLength(syntheticPhoto)).toBeGreaterThan(65_536);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByLabel('Choose photo').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(syntheticPhoto, 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Photo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const thumbnail = page.waitForResponse((response) => {
    const payload = response.request().postDataJSON();
    return (
      payload?.operation === 'bots.appearance.thumbnails' &&
      payload.params.targets.some((target: { profile: string }) => target.profile === 'alpha')
    );
  });
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
      .locator('.pebble-row')
      .filter({ has: page.getByText('Alpha', { exact: true }) })
      .locator('.agent-avatar img'),
  ).toHaveCount(1);
  expect((await (await thumbnail).json()).result.photos.alpha).toMatch(/^data:image\/png;base64,/);
  await page.getByRole('button', { name: 'Animated', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Pebbles', includeHidden: true })
      .locator('.pebble-row')
      .filter({ has: page.getByText('Alpha', { exact: true }) })
      .locator('.agent-avatar img'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Pebbles', includeHidden: true })
      .locator('.pebble-row')
      .filter({ has: page.getByText('Alpha', { exact: true }) })
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
  expectNoChatSends(signals);
  ownerCookies = await context.cookies();
});

test('owner photo, account settings, tools layout and ordinary login persist', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const signals = observeOwner(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await expect(page).toHaveTitle('Account settings — Pebble Crew');
  const accountPhoto = page.getByLabel('Your photo', { exact: true });
  await accountPhoto.setInputFiles({
    name: 'synthetic-owner.png',
    mimeType: 'image/png',
    buffer: Buffer.from(syntheticPhoto, 'base64'),
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
  await openSidebarMenu(page, 'Alpha');
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
  await expect(page).toHaveTitle('Sign in — Pebble Crew');
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect username or password.');
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('owner');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-owner-password-456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('.pc-rail-footer .personal-avatar img')).toHaveAttribute(
    'src',
    savedPersonalPhoto!,
  );
  expectNoChatSends(signals);
  ownerCookies = await context.cookies();
});

test('native existing-agent onboarding survives recovery and preserves reporting and Instructions', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  await installNativeStreamControl(page);
  const signals = observeOwner(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openSidebarMenu(page, 'Alpha');
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
  const beforeSetupRecovery = signals.events;
  await page.evaluate(() => Reflect.get(window, '__interruptNativeEvents')());
  await expect.poll(() => signals.events).toBeGreaterThan(beforeSetupRecovery);
  await expect(page.locator('main.pc-shell')).toHaveAttribute('data-live-updates', 'live');
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
  await openSidebarMenu(page, 'Hazel');
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
  expect(signals.errors).toEqual([]);
  expect(signals.sends).toBe(0);
  await page.screenshot({ animations: 'disabled', path: 'test-results/owner-workspace.png' });
  ownerCookies = await context.cookies();
});

test('native chat reactions, generated media and agent-opened documents', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let sends = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/rpc') && request.postDataJSON()?.operation === 'chat.send')
      sends++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Nova .*Bot Chat$/ }).click();
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
  await page.getByRole('button', { name: 'Play sample-video.mp4', exact: true }).click();
  const clip = page.locator('video[aria-label="sample-video.mp4"]');
  await expect
    .poll(() => clip.evaluate((node: HTMLVideoElement) => node.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await clip.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(320);
  await clip.evaluate((node: HTMLVideoElement) => node.pause());
  await page.getByRole('button', { name: 'View sample-video.mp4', exact: true }).click();
  const videoViewer = page.getByRole('dialog', { name: 'sample-video.mp4', exact: true });
  await expect(videoViewer.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-video-phone.png' });
  await videoViewer.getByRole('button', { name: 'Close video', exact: true }).click();
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
  await page.getByRole('button', { name: /Show details/ }).click();
  const library = page.locator('.details-panel');
  await library.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(library).toContainText('chart one.png');
  await expect(library).toContainText('figures.csv');
  await expect(library).toContainText('sample-video.mp4');
  await library.getByRole('button', { name: 'View chart one.png', exact: true }).click();
  const sharedViewer = page.getByRole('dialog', { name: 'chart one.png', exact: true });
  await expect(sharedViewer).toBeVisible();
  await sharedViewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-library-phone.png' });
  await library.getByRole('button', { name: 'Close details', exact: true }).click();
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
  expect(errors).toEqual([]);
});

test('ordinary Send redirects the real native turn on phone and survives reload', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Nova .*Bot Chat$/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByLabel('Message', { exact: true });
  await input.fill('nativeworking');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await submitMessage(page);
  await expect
    .poll(
      async () => {
        const response = await context.request.get('https://127.0.0.1:8789/fixture/busy-state', {
          headers: { Origin: 'https://127.0.0.1:5445', Authorization: 'Bearer ' + 'f'.repeat(43) },
        });
        return (await response.json()).working;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await input.fill('nativecorrection');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/native-send-working-phone.png',
    animations: 'disabled',
  });
  await submitMessage(page);
  await expect(page.getByRole('log')).toContainText('Native redirected reply', { timeout: 30000 });
  await expect(
    page.locator('[data-message-role="user"]').filter({ hasText: /^nativecorrection/ }),
  ).toHaveCount(1);
  await expect(page.locator('[data-message-id^="pending-"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('log')).toContainText('Native redirected reply', { timeout: 30000 });
  await expect(
    page.locator('[data-message-role="user"]').filter({ hasText: /^nativecorrection/ }),
  ).toHaveCount(1);
});

test('native organization edits and task activity persist through reload', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Nova .*Bot Chat$/ }).click();
  // The chart and existing editor share actual native persistence, including
  // an explicitly unattached newly created agent and a manager change.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Message', { exact: true }).fill('Keep this native draft');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  const org = page.getByRole('region', { name: 'Org chart', exact: true });
  await expect(org.getByRole('heading', { name: 'Unattached', exact: true })).toBeVisible();
  await (await focusOrgCard(page, 'Nova')).click();
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
  await expect(org.getByRole('button', { name: /^Edit Nova(?:\s|$)/ })).toBeInViewport();
  await org.getByRole('button', { name: 'Fit chart', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/native-org-desktop.png' });
  await org.getByRole('button', { name: 'Close Org chart', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this native draft');
  await page.reload();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Org chart', exact: true }).click();
  await (await focusOrgCard(page, 'Nova')).click();
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

test('existing legacy creation survives another approval and completes once through the fixed composer', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const home = (
    await readFile(resolve(process.env.WORKSPACE_TEST_STATE!, 'native-home.txt'), 'utf8')
  ).trim();
  function fixture(action: string) {
    return JSON.parse(
      execFileSync(
        process.env.HERMES_NATIVE_PYTHON!,
        ['scripts/fixture/approval_seed.py', home, action],
        { encoding: 'utf8', env: { ...process.env, PYTHONPATH: process.env.HERMES_NATIVE_ROOT } },
      ).trim(),
    );
  }
  const seeded = fixture('seed');
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: new RegExp('^' + seeded.name + ' .*Bot Chat$') }).click();
  const queue = page.getByRole('region', { name: 'Waiting for your input', exact: true });
  await expect(queue).toContainText('1 of 2');
  await expect(queue.locator('[data-request-id="' + seeded.id + '"]')).toBeVisible();
  await queue.getByRole('button', { name: 'Minimize request', exact: true }).click();
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill('Unsent note while reviewing');
  expect(fixture('pending')).toEqual({ state: 'pending', fingerprint: seeded.fingerprint });
  await queue.getByRole('button', { name: /Review pending requests$/ }).click();
  await expect(queue.locator('[data-request-id="' + seeded.id + '"]')).toBeVisible();

  await queue.getByRole('button', { name: 'Next request', exact: true }).click();
  await queue.getByRole('button', { name: 'Approve exact request' }).click();
  await expect(queue.getByRole('button', { name: 'Next request', exact: true })).toHaveCount(0);
  await expect(queue).not.toContainText('1 of 1');
  await expect(queue).toContainText('Older request');
  await expect(queue.getByRole('button', { name: 'Approve exact request' })).toBeDisabled();
  await queue.getByRole('checkbox', { name: 'Use this current setup', exact: true }).check();
  await queue.getByRole('button', { name: 'Approve exact request' }).click();
  await expect(queue).toHaveCount(0, { timeout: 30000 });
  await expect(
    page.getByRole('log').locator('[data-request-id="' + seeded.id + '"]'),
  ).toContainText('Approved');
  const result = fixture('read');
  expect(result).toEqual({
    id: seeded.id,
    state: 'completed',
    fingerprint: seeded.fingerprint,
    manager: 'beta',
    canonical: true,
  });
  await page.screenshot({
    path: 'test-results/native-existing-approval.png',
    animations: 'disabled',
  });
});

test('owner-wide Tasks setting survives native reload and restores the existing boards', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  const signals = observeOwner(page);
  async function general() {
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  }
  await general();
  const setting = page.getByRole('switch', { name: 'Tasks', exact: true });
  await expect(setting).toBeChecked();
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(setting).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByRole('radiogroup', { name: 'App area' })).toHaveCount(0);
  await general();
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toContainText(
    'General tasks',
  );
  expectNoChatSends(signals);
});

test('voice provider selection persists in the native owner without opening a paid session', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const signals = observeOwner(page);
  const voiceSessions: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/rpc') && request.postDataJSON()?.operation === 'voice.session')
      voiceSessions.push(request.url());
  });
  const openVoice = async () => {
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 30000 });
    await openSidebarMenu(page, 'Alpha Stone');
    await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Edit Alpha Stone', exact: true });
    await settings.getByRole('tab', { name: 'Voice', exact: true }).click();
    await expect(settings.getByRole('radiogroup', { name: 'Voice provider' })).toBeVisible({
      timeout: 30000,
    });
    return settings;
  };
  await page.goto('/');
  let settings = await openVoice();
  await expect(settings.getByRole('radio', { name: 'OpenAI' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await settings.getByRole('radio', { name: 'ElevenLabs' }).click();
  await expect(settings.getByRole('form', { name: 'ElevenLabs API key' })).toBeVisible();
  await page.reload();
  settings = await openVoice();
  await expect(settings.getByRole('radio', { name: 'ElevenLabs' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await settings.getByRole('radio', { name: 'OpenAI' }).click();
  await expect(settings.getByRole('radio', { name: 'OpenAI' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(voiceSessions).toEqual([]);
  expectNoChatSends(signals);
});

test('owner can delete a native group from its sidebar menu', async ({ page, context }) => {
  await context.addCookies(ownerCookies);
  const signals = observeOwner(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New group chat', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New group chat', exact: true });
  await create.getByLabel('Name', { exact: true }).fill('Disposable discussion');
  for (const name of ['Alpha Stone', 'Beta'])
    await create.getByRole('checkbox', { name, exact: true }).check();
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  const group = page.getByRole('button', { name: /^Disposable discussion .*Open chat$/ });
  await expect(group).toBeVisible();
  const confirm = page.getByRole('alertdialog', { name: 'Delete Disposable discussion?' });
  const openDelete = async () => {
    await openSidebarMenu(page, 'Disposable discussion');
    await page.getByRole('menuitem', { name: 'Delete group', exact: true }).click();
    await expect(confirm).toBeVisible();
  };
  await openDelete();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(group).toBeVisible();
  await openDelete();
  await confirm.getByRole('button', { name: 'Delete group', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(group).toHaveCount(0);
  await expect(page.locator('.chat-title')).not.toContainText('Disposable discussion');
  await expect(page.getByText('This conversation is no longer in your sidebar.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  await expect(group).toHaveCount(0);
  expectNoChatSends(signals);
});

test('bare model command shows the current native model without prompting it', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const signals = observeOwner(page);
  await page.goto('/');
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill('/model');
  await submitMessage(page);
  const picker = page.getByRole('dialog', { name: 'Choose a model' });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('Current: fixture-model', { timeout: 20000 });
  expectNoChatSends(signals);
});

test('a native video call without a tool request hands both sides to the existing Bot Chat', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  await installAtmeeRoom(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add API key', exact: true }).click();
  const key = page.getByRole('form', { name: 'Atmee API key' });
  await key.getByLabel('API key').fill('sk_atmee_native-synthetic');
  await key.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('API key saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close Settings' }).click();
  const start = page.getByRole('button', { name: 'Start video call' });
  await start.click();
  await page.getByRole('combobox', { name: 'Video avatar' }).click();
  await page.getByRole('option', { name: 'Synthetic character' }).click();
  await expect(page.getByRole('combobox', { name: 'Video avatar' })).toContainText(
    'Synthetic character',
  );
  await page.getByRole('button', { name: /^Close Edit / }).click();
  await start.click();
  await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeEnabled({
    timeout: 20000,
  });
  for (const [identity, text] of [
    ['owner', 'Owner video context sentinel'],
    ['agent', 'Avatar video context sentinel'],
  ] as const) {
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/v1/rpc') &&
        response.request().postDataJSON()?.operation === 'atmee.caption' &&
        response.ok(),
    );
    await page.evaluate(
      ({ identity, text }) => {
        (window as unknown as { __caption: (identity: string, text: string) => void }).__caption(
          identity,
          text,
        );
      },
      { identity, text },
    );
    await saved;
  }
  await page.getByRole('button', { name: 'End video call' }).click();
  const transcript = page.getByRole('log');
  await expect(transcript.getByText('Native video context received', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(transcript.getByText('Video call ended', { exact: true })).toBeVisible();
  await page.reload();
  await expect(transcript.getByText('Video call ended', { exact: true })).toBeVisible();
});

test('Aurora remembers a text fact in video and a video correction in text and the next call', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  await installAtmeeRoom(page);
  await page.goto('/');
  await expect(page.locator('.chat-header')).toContainText('Aurora');
  const nativeHome = (
    await readFile(resolve(process.env.WORKSPACE_TEST_STATE!, 'native-home.txt'), 'utf8')
  ).trim();
  const memory = () => readFile(resolve(nativeHome, 'memories', 'MEMORY.md'), 'utf8');
  const composer = page.getByLabel('Message', { exact: true });
  const transcript = page.getByRole('log');
  const start = page.getByRole('button', { name: 'Start video call' });
  const call = page.getByRole('region', { name: 'Video call with Aurora' });
  const type = async (text: string) => {
    await expect(composer).toBeEnabled();
    await composer.fill(text);
    await submitMessage(page);
  };
  const startCall = async () => {
    await start.click();
    await expect(call.getByRole('button', { name: 'Mute microphone' })).toBeEnabled({
      timeout: 20000,
    });
  };
  const briefing = () =>
    page.evaluate(
      () => (Reflect.get(window, '__atmeeApp') as { message: { text: string } }[])[0]?.message.text,
    );
  const speak = (speaker: 'owner' | 'agent', text: string) =>
    page.evaluate(
      ({ speaker, text }) => {
        (
          window as unknown as {
            __caption: (identity: string, text: string) => void;
          }
        ).__caption(speaker, text);
      },
      { speaker, text },
    );
  const ask = (identity = 'agent') =>
    page.evaluate(
      (identity) =>
        (window as unknown as { __askPebble: (identity: string) => Promise<string> }).__askPebble(
          identity,
        ),
      identity,
    );
  const endCall = async () => {
    const ended = page.waitForResponse(
      (response) =>
        response.url().endsWith('/v1/rpc') &&
        response.request().postDataJSON()?.operation === 'atmee.end' &&
        response.ok(),
    );
    await call.getByRole('button', { name: 'End video call' }).click();
    await ended;
    await expect(call).toBeHidden();
  };
  await type('nativevideo remember Cedar');
  await expect(transcript.getByText('Aurora saved Cedar', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(await memory()).toContain('meeting location is Cedar.');
  await startCall();
  await expect.poll(briefing, { timeout: 10000 }).toContain('Aurora saved Cedar');
  await speak('owner', 'nativevideo recall');
  expect(await ask('renderer')).toBe('Unsupported request.');
  expect(await ask()).toBe('Aurora remembers Cedar');
  await speak('owner', 'nativevideo correct: the location is Juniper');
  expect(await ask()).toBe('Aurora saved Juniper');
  expect(await memory()).toContain('meeting location is Juniper.');
  expect(await memory()).not.toContain('meeting location is Cedar.');
  await speak('agent', 'Juniper is the new meeting location.');
  await endCall();
  await page.reload();
  await type('nativevideo recall in text');
  await expect(transcript.getByText('Aurora remembers Juniper', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await startCall();
  await expect.poll(briefing, { timeout: 10000 }).toContain('Juniper is the new meeting location.');
  expect(await briefing()).toContain('nativevideo recall in text');
  await speak('owner', 'nativevideo recall in the next call');
  expect(await ask()).toBe('Aurora remembers Juniper');
  await endCall();
});

test('owner creates Aurora with a generated voice and with a recording', async ({
  page,
  context,
}) => {
  await context.addCookies(ownerCookies);
  const signals = observeOwner(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page
    .getByRole('region', { name: 'Atmee' })
    .getByRole('button', { name: /^(Add API key|Replace key)$/ })
    .click();
  const key = page.getByRole('form', { name: 'Atmee API key' });
  await key.getByLabel('API key').fill('invalid-atmee-key');
  await key.getByRole('button', { name: 'Submit' }).click();
  await expect(key.getByRole('alert')).toContainText('Atmee rejected this API key.');
  await key.getByLabel('API key').fill('sk_atmee_native-builder');
  await key.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('API key saved')).toBeVisible();
  await expect(key).toBeHidden();
  const home = (
    await readFile(resolve(process.env.WORKSPACE_TEST_STATE!, 'native-home.txt'), 'utf8')
  ).trim();
  const stored = await readFile(resolve(home, '.env'), 'utf8');
  expect(stored.includes('ATMEE_API_KEY=sk_atmee_native-builder')).toBe(true);
  await writeFile(resolve(home, 'SOUL.md'), 'Synthetic Aurora prioritizes clear decisions.\n');

  await page.getByRole('button', { name: 'Close Settings' }).click();
  const openVideo = async () => {
    await openSidebarMenu(page, 'Aurora');
    await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
    await page.getByRole('tab', { name: 'Voice', exact: true }).click();
  };
  await openVideo();
  await page.getByRole('button', { name: 'New video avatar', exact: true }).click();
  await page.getByRole('button', { name: /Review Hermes profile/ }).click();
  await expect(page.getByLabel('Avatar name')).toHaveValue('Aurora');
  await expect(page.getByLabel('Avatar instructions')).toHaveValue(
    /Synthetic Aurora prioritizes clear decisions/,
  );
  await page.getByLabel('Portrait', { exact: true }).setInputFiles(await atmeePortrait(page));
  await page.getByLabel('Avatar name').fill('Aurora · Video test');
  await page.getByLabel('Avatar instructions').fill('Approved Aurora character description.');
  await page.getByRole('radio', { name: 'Design a voice', exact: true }).click();
  await page.getByLabel('Describe the voice').fill('Warm and conversational with a calm tone.');
  await page.getByRole('button', { name: 'Generate voice samples' }).click();
  for (const name of ['Voice 1', 'Voice 2']) {
    await page.getByRole('button', { name: `Preview ${name}` }).click();
    const audio = page.getByLabel(`Sample for ${name}`);
    await expect(audio).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() =>
        audio.evaluate((element) =>
          element instanceof HTMLAudioElement ? element.currentTime : 0,
        ),
      )
      .toBeGreaterThan(0);
  }
  await page.getByRole('radio', { name: 'Voice 1' }).click();
  await page.getByRole('button', { name: 'Create video avatar', exact: true }).click();
  await expect(page.getByText('Aurora · Video test is ready.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Use video avatar', exact: true }).click();
  const selected = page.getByRole('combobox', { name: 'Video avatar', exact: true });
  await expect(selected).toContainText('Aurora · Video test');
  await page.getByRole('button', { name: 'Close Edit Aurora' }).click();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openVideo();
  await expect(selected).toContainText('Aurora · Video test');

  await page.getByRole('button', { name: 'New video avatar', exact: true }).click();
  await page.getByLabel('Portrait', { exact: true }).setInputFiles(await atmeePortrait(page));
  await page.getByRole('radio', { name: 'Upload recording', exact: true }).click();
  await page.getByLabel('Voice recording').setInputFiles({
    name: 'voice.wav',
    mimeType: 'audio/wav',
    buffer: atmeeWav(12),
  });
  await page.getByRole('button', { name: /Review Hermes profile/ }).click();
  await page.getByLabel('Avatar name').fill('Aurora · Recording test');
  await page.getByLabel('Avatar instructions').fill('Approved Aurora character description.');
  await page.getByRole('button', { name: 'Create video avatar', exact: true }).click();
  await expect(page.getByText('Aurora · Recording test is ready.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Use video avatar', exact: true }).click();
  await expect(selected).toContainText('Aurora · Recording test');
  expectNoChatSends(signals);
});
