import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('reload restores the selected pebble behind the progress bar and rejects a replaced identity', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/rpc', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === 'bot.open' && body.params.profile === 'mica') await held;
    await route.fallback();
  });
  try {
    await page.reload();
    await expect(page.getByRole('progressbar', { name: 'Opening Pebble Crew' })).toBeVisible();
    await expect(page.locator('.pc-chat-identity')).toHaveCount(0);
    release();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
    fixture.replace('mica');
    await page.reload();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.locator('.pc-chat-identity')).toContainText('Arlo');
  } finally {
    release();
  }
});

test('reload restores a selected room and waits for its history', async ({ page, context }) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Research crew', exact: false }).click();
  await expect(page.getByRole('log')).toContainText('I have the notes ready.');
  await page.reload();
  await expect(page.getByRole('log')).toContainText('I have the notes ready.');
  await expect(page.locator('.pc-chat-identity')).toContainText('Research crew');
  await expect(page.getByRole('progressbar', { name: 'Opening Pebble Crew' })).toHaveCount(0);
});

test('startup stays on one quiet progress view until the native conversation is restored', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await context.addInitScript(() => {
    const screens: string[] = [];
    Object.assign(window, { __startupScreens: screens });
    new MutationObserver(() => {
      for (const heading of document.querySelectorAll('h1, h2'))
        if (['Connecting…', 'Choose a conversation', 'Chats'].includes(heading.textContent ?? ''))
          screens.push(heading.textContent!);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  let releaseAuth!: () => void;
  let releaseConnect!: () => void;
  let releaseOpen!: () => void;
  const auth = new Promise<void>((resolve) => (releaseAuth = resolve));
  const connect = new Promise<void>((resolve) => (releaseConnect = resolve));
  const open = new Promise<void>((resolve) => (releaseOpen = resolve));
  await page.route('**/api/instance/status', async (route) => {
    await auth;
    await route.fallback();
  });
  await page.route('**/v1/connect', async (route) => {
    await connect;
    await route.fallback();
  });
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'bot.open') await open;
    await route.fallback();
  });
  try {
    await page.goto('/');
    const progress = page.getByRole('progressbar', { name: 'Opening Pebble Crew' });
    await expect(progress).toBeVisible();
    await expect(page.getByRole('heading')).toHaveCount(0);
    const position = (await progress.locator('..').boundingBox())!;
    releaseAuth();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    releaseConnect();
    await expect(progress).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
    const bar = (await progress.locator('..').boundingBox())!;
    const signout = (await page
      .getByRole('button', { name: 'Sign out', exact: true })
      .boundingBox())!;
    expect(Math.abs(bar.x - signout.x)).toBeLessThan(1);
    expect(bar.width).toBe(position.width);
    expect(Math.abs(bar.y - position.y)).toBeLessThan(1);
    expect(signout.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    await page.screenshot({ path: test.info().outputPath('startup-progress.png') });
    releaseOpen();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.locator('.pc-chat-identity')).toContainText('Arlo');
    const transient = await page.evaluate(
      () => (window as unknown as { __startupScreens: string[] }).__startupScreens,
    );
    expect(transient).toEqual([]);
    await expect(progress).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('startup-restored.png') });
  } finally {
    releaseAuth();
    releaseConnect();
    releaseOpen();
  }
});

test('API-only connections still reach their real conversation picker', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.route('**/v1/connect', async (route) => {
    await route.fulfill({
      json: { protocol: 'hermes-bot-web.v1', connection: 'c'.repeat(43), capabilities: {} },
    });
  });
  await page.route('**/v1/rpc', async (route) => {
    const operation = route.request().postDataJSON().operation;
    if (operation === 'bots.list')
      await route.fulfill({
        json: { result: { bots: [{ profile: 'arlo', name: 'Arlo', canonical: true }] } },
      });
    else if (operation === 'rooms.list') await route.fulfill({ json: { result: { rooms: [] } } });
    else await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a conversation' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

for (const failure of ['uninitialized-chat', 'denied'] as const) {
  test(`an unavailable default (${failure}) leaves other pebbles accessible`, async ({
    page,
    context,
    isMobile,
  }) => {
    const fixture = await installFixture(context);
    if (failure === 'uninitialized-chat')
      fixture.state.bots.find((bot) => bot.profile === 'arlo')!.canonical = false;
    else
      await page.route('**/v1/rpc', async (route) => {
        const request = route.request().postDataJSON();
        if (request.operation === 'bot.open' && request.params.profile === 'arlo')
          await route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
        else await route.fallback();
      });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose a conversation' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    if (isMobile) await page.getByLabel('Toggle navigation', { exact: true }).click();
    await page.getByRole('button', { name: /Mica .* Bot Chat/ }).click();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.locator('.pc-chat-identity')).toContainText('Mica');
  });
}

test('a restored transcript observes later content growth and follows it', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let waiting = false;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'routines.list') {
      waiting = true;
      await held;
    }
    await route.fallback();
  });
  try {
    await page.goto('/');
    await expect.poll(() => waiting).toBe(true);
    await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect
      .poll(() =>
        page
          .getByRole('log')
          .evaluate((pane) => pane.scrollHeight - pane.clientHeight - pane.scrollTop),
      )
      .toBeLessThan(2);
    await page.locator('.pc-messages').evaluate((content) => {
      const resized = document.createElement('div');
      resized.style.height = '800px';
      content.append(resized);
    });
    await expect
      .poll(() =>
        page
          .getByRole('log')
          .evaluate((pane) => pane.scrollHeight - pane.clientHeight - pane.scrollTop),
      )
      .toBeLessThan(2);
  } finally {
    release();
  }
});
