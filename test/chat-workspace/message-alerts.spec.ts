import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');

/** A browser that grants notifications and has a push service, recording what it does. */
async function fakePush(page: Page) {
  await page.addInitScript((key) => {
    const record: Record<string, unknown>[] = [];
    Reflect.set(window, '__push', record);
    let subscription: unknown = null;
    const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill).buffer;
    const pushManager = {
      getSubscription: async () => subscription,
      subscribe: async (options: { applicationServerKey: Uint8Array }) => {
        record.push({ subscribe: Array.from(options.applicationServerKey).length });
        subscription = {
          endpoint: 'https://web.push.apple.com/synthetic-device',
          options: { applicationServerKey: options.applicationServerKey.buffer },
          getKey: (name: string) => (name === 'p256dh' ? bytes(65, 4) : bytes(16, 9)),
          unsubscribe: async () => {
            record.push({ unsubscribe: true });
            subscription = null;
            return true;
          },
        };
        return subscription;
      },
    };
    const worker = new EventTarget();
    Object.assign(worker, {
      ready: Promise.resolve({ pushManager }),
      register: async () => ({ pushManager }),
      controller: null,
    });
    Object.defineProperty(navigator, 'serviceWorker', { value: worker });
    Reflect.set(window, 'PushManager', function PushManager() {});
    class FakeNotification {
      static permission = 'default';
      static async requestPermission() {
        FakeNotification.permission = 'granted';
        record.push({ permission: 'granted' });
        return 'granted';
      }
    }
    Reflect.set(window, 'Notification', FakeNotification);
    void key;
  }, publicKey);
}

async function openGeneral(page: Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
}

test('message alerts turn on and off per device, and the server knows when the app is in view', async ({
  page,
  context,
}, info) => {
  const calls: { operation: string; params: Record<string, unknown> }[] = [];
  await installFixture(context);
  await fakePush(page);
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (!operation.startsWith('push.')) return route.fallback();
    calls.push({ operation, params });
    if (operation === 'push.config')
      return route.fulfill({ json: { result: { public_key: publicKey, devices: 0 } } });
    return route.fulfill({ json: { result: { devices: 1, ok: true } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect
    .poll(() => calls.filter((call) => call.operation === 'push.presence').at(-1)?.params)
    .toEqual({ visible: true });

  await openGeneral(page);
  const alerts = page.getByRole('switch', { name: 'Message alerts' });
  await expect(alerts).not.toBeChecked();
  await expect(
    page.getByText('Notify this device of new messages while Pebble Crew is closed.'),
  ).toBeVisible();
  await alerts.click();
  await expect(alerts).toBeChecked();
  const subscribe = calls.find((call) => call.operation === 'push.subscribe')!;
  expect(subscribe.params).toEqual({
    endpoint: 'https://web.push.apple.com/synthetic-device',
    p256dh: Buffer.alloc(65, 4).toString('base64url'),
    auth: Buffer.alloc(16, 9).toString('base64url'),
  });
  expect(await page.evaluate(() => Reflect.get(window, '__push'))).toEqual([
    { permission: 'granted' },
    { subscribe: 65 },
  ]);
  await page.screenshot({ path: info.outputPath('message-alerts-on.png'), animations: 'disabled' });

  await alerts.click();
  await expect(alerts).not.toBeChecked();
  expect(calls.find((call) => call.operation === 'push.unsubscribe')?.params).toEqual({
    endpoint: 'https://web.push.apple.com/synthetic-device',
  });

  // Leaving the app tells the server at once, so the next reply alerts.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => calls.filter((call) => call.operation === 'push.presence').at(-1)?.params)
    .toEqual({ visible: false });
});

test('a refused device leaves alerts off with a short reason', async ({ page, context }) => {
  await installFixture(context);
  await fakePush(page);
  await page.route('**/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === 'push.config')
      return route.fulfill({ json: { result: { public_key: publicKey, devices: 0 } } });
    if (operation === 'push.subscribe')
      return route.fulfill({
        status: 400,
        json: {
          code: 'PUSH_REFUSED',
          message: 'The notification service did not accept this device. Try again.',
        },
      });
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openGeneral(page);
  const alerts = page.getByRole('switch', { name: 'Message alerts' });
  await alerts.click();
  await expect(
    page.getByText('The notification service did not accept this device. Try again.'),
  ).toBeVisible();
  await expect(alerts).not.toBeChecked();
  expect(await page.evaluate(() => Reflect.get(window, '__push'))).toContainEqual({
    unsubscribe: true,
  });
});

test('a tapped alert opens that Pebble’s chat, at launch or while the app is open', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await fakePush(page);
  await page.goto('/#chat=mica');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Mica', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.evaluate(() => {
    const event = new MessageEvent('message', {
      data: { type: 'pebble.open-chat', profile: 'rowan' },
    });
    navigator.serviceWorker.dispatchEvent(event);
  });
  await expect(page.getByRole('heading', { name: 'Rowan', exact: true })).toBeVisible();

  // iOS can show the app before the service worker saves the tapped chat.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const cache = await caches.open('pebble-open-chat');
    await cache.put(
      '/pending-chat',
      new Response(JSON.stringify({ profile: 'rowan', at: Date.now() })),
    );
  });
  await expect(page.getByRole('heading', { name: 'Rowan', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Rowan', exact: true }).waitFor();

  // A suspended iPhone app misses that message; it finds the saved chat when it returns.
  await page.evaluate(async () => {
    const cache = await caches.open('pebble-open-chat');
    await cache.put(
      '/pending-chat',
      new Response(JSON.stringify({ profile: 'mica', at: Date.now() })),
    );
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByRole('heading', { name: 'Mica', exact: true })).toBeVisible();
  expect(
    await page.evaluate(async () => (await caches.open('pebble-open-chat')).match('/pending-chat')),
  ).toBeFalsy();
});

test('an alert tapped while the connection is down opens its chat once it is back', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await fakePush(page);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  let reconnecting = false;
  let resume = () => {};
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route('**/v1/connect', async (route) => {
    if (route.request().method() === 'POST') {
      reconnecting = true;
      await waiting;
    }
    await route.fallback();
  });
  // iOS resumes a suspended app with its connection dropped.
  await page.evaluate(() =>
    (window as unknown as { __expireConnection: () => void }).__expireConnection(),
  );
  await expect.poll(() => reconnecting).toBe(true);
  await page.evaluate(() => {
    const event = new MessageEvent('message', {
      data: { type: 'pebble.open-chat', profile: 'rowan' },
    });
    navigator.serviceWorker.dispatchEvent(event);
  });
  resume();
  await expect(page.getByRole('heading', { name: 'Rowan', exact: true })).toBeVisible();
});
