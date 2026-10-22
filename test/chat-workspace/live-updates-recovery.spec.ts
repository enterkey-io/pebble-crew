import { test, expect } from '@playwright/test';
import { installFixture, history } from './fixtures';
import { sidebarItem } from '../sidebar-menu';

test.use({ serviceWorkers: 'block' });

test('stream-only failures keep the same authenticated chat usable', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let leases = 0;
  let sends = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/v1/connect' && request.method() === 'POST') leases++;
    if (path === '/v1/rpc' && request.postDataJSON()?.operation === 'chat.send') sends++;
  });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Send while updates recover');
  const originalLeases = leases;
  const node = (await field.elementHandle())!;
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/events')) return new Response(null, { status: 503 });
      return original(input, init);
    };
    (window as unknown as { __breakStream: () => void }).__breakStream();
  });
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await field.press('Enter');
  await expect.poll(() => sends).toBe(1);
  expect(leases).toBe(originalLeases);
  expect(await node.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('stream-recovering-send.png'),
  });
});

test('missed replies recover in place without losing the draft, focus or message elements', async ({
  page,
  context,
}, info) => {
  const messages = [...history];
  await installFixture(context, { messages });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Still writing this');
  const fieldNode = (await field.elementHandle())!;
  const bubble = (await page.locator('[data-slot="message-response"]').first().elementHandle())!;
  await page.evaluate(() => {
    const original = window.fetch;
    let available = false;
    Reflect.set(window, '__restoreEvents', () => {
      available = true;
      window.dispatchEvent(new Event('online'));
    });
    window.fetch = async (input, init) => {
      if (String(input).endsWith('/v1/events') && !available)
        return new Response(null, { status: 503 });
      return original(input, init);
    };
    Reflect.get(window, '__breakStream')();
  });
  await expect(page.locator('main.pc-shell')).toHaveAttribute('data-live-updates', 'lost');
  messages.push({
    row_id: 29,
    role: 'assistant',
    timestamp: 1700100000,
    text: 'An update that arrived while live updates were interrupted.',
  });
  await page.keyboard.type(' and keeping it');
  await page.evaluate(() => Reflect.get(window, '__restoreEvents')());
  await expect(page.getByRole('log')).toContainText(
    'An update that arrived while live updates were interrupted.',
  );
  await expect(field).toHaveValue('Still writing this and keeping it');
  await expect(field).toBeFocused();
  expect(await fieldNode.evaluate((node) => node.isConnected)).toBe(true);
  expect(await bubble.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('live-updates-restored.png'),
  });
});

test('changing conversations remains available while only the event stream is down', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Arlo draft');
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) =>
      String(input).endsWith('/v1/events')
        ? new Response(null, { status: 503 })
        : original(input, init);
    Reflect.get(window, '__breakStream')();
  });
  await expect(page.locator('main.pc-shell')).toHaveAttribute('data-live-updates', 'lost');
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await sidebarItem(page, 'Mica').click();
  await expect(field).toHaveAttribute('placeholder', 'Message Mica');
  await field.fill('Mica draft');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await sidebarItem(page, 'Arlo').click();
  await expect(field).toHaveValue('Arlo draft');
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
});

test('a stream interruption does not abort or duplicate a pending send', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let sends = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'chat.send') {
      sends++;
      await held;
    }
    return route.fallback();
  });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Exactly once');
  await field.press('Enter');
  await expect.poll(() => sends).toBe(1);
  try {
    await page.evaluate(() => Reflect.get(window, '__breakStream')());
    await expect(page.locator('main.pc-shell')).toHaveAttribute('data-live-updates', 'lost');
    await field.fill('The next draft');
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('The next draft');
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  expect(sends).toBe(1);
});

test('a temporary ticket renewal failure does not interrupt a healthy stream or lease', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.clock.install();
  let leases = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/v1/connect' && request.method() === 'POST') leases++;
  });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Keep my draft');
  const initial = leases;
  let failures = 0;
  await page.route('**/api/hermes/ticket', async (route) => {
    failures++;
    if (failures === 1)
      return route.fulfill({ status: 503, json: { error: 'Temporary unavailability' } });
    return route.fallback();
  });
  await page.clock.fastForward(240_001);
  await expect.poll(() => failures).toBe(1);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  expect(leases).toBe(initial);
  await page.clock.fastForward(10_001);
  await expect.poll(() => failures).toBe(2);
  expect(leases).toBe(initial);
  await expect(field).toHaveValue('Keep my draft');
  await expect(page.locator('main.pc-shell')).toHaveAttribute('data-live-updates', 'live');
});

for (const code of ['RPC_FAILED', 'NATIVE_UNAVAILABLE'])
  test(`first conversation-open ${code} retries without an empty picker or reload`, async ({
    page,
    context,
  }) => {
    await installFixture(context);
    let opens = 0;
    await page.route('**/v1/rpc', async (route) => {
      if (route.request().postDataJSON().operation === 'bot.open' && ++opens === 1)
        return route.fulfill({ status: 503, json: { code } });
      return route.fallback();
    });
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled({
      timeout: 15000,
    });
    await expect(page.locator('.pc-chat-identity')).toContainText('Arlo');
    expect(opens).toBe(2);
    await expect(page.getByText('Choose a conversation', { exact: true })).toHaveCount(0);
    await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  });

test('a new lease cannot send on the old binding while a retired snapshot is still pending', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let leases = 0;
  let sends = 0;
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/v1/connect' &&
      response.request().method() === 'POST' &&
      response.ok()
    )
      leases++;
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/v1/rpc' &&
      request.postDataJSON()?.operation === 'chat.send'
    )
      sends++;
  });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await expect(page.locator('main.pc-shell')).toHaveAttribute('data-live-updates', 'live');
  await field.fill('Keep this until the new lease is bound');
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = false;
  let block = true;
  await page.route('**/v1/rpc', async (route) => {
    if (block && route.request().postDataJSON().operation === 'chat.snapshot') {
      pending = true;
      await held;
    }
    return route.fallback();
  });
  try {
    await page.evaluate(() => Reflect.get(window, '__breakStream')());
    await expect.poll(() => pending).toBe(true);
    await page.evaluate(() => Reflect.get(window, '__expireConnection')());
    await expect.poll(() => leases).toBe(2);
    await expect(page.locator('.connection-status')).toHaveAttribute('data-online', 'true');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(field).toHaveValue('Keep this until the new lease is bound');
    expect(sends).toBe(0);
  } finally {
    block = false;
    release();
  }
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('Keep this until the new lease is bound');
  expect(leases).toBe(2);
});
