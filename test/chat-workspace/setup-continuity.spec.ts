import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('connection recovery retains the visible conversation without a red interruption banner', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('An unsent message');
  const bubble = (await page.locator('[data-slot="message-response"]').first().elementHandle())!;
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
  await page.evaluate(() =>
    (window as unknown as { __expireConnection: () => void }).__expireConnection(),
  );
  await expect.poll(() => reconnecting).toBe(true);
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  expect(await bubble.evaluate((node) => node.isConnected)).toBe(true);
  await expect(input).toHaveValue('An unsent message');
  resume();
  await expect(input).toBeEnabled();
  expect(await bubble.evaluate((node) => node.isConnected)).toBe(true);
  await expect(input).toHaveValue('An unsent message');
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
});

for (const flow of ['existing', 'new'] as const) {
  test(`${flow} pebble setup survives background refresh and transport recovery`, async ({
    page,
    context,
  }) => {
    await installFixture(context);
    let leases = 0;
    page.on('response', (response) => {
      if (
        new URL(response.url()).pathname === '/v1/connect' &&
        response.request().method() === 'POST' &&
        response.ok()
      )
        leases++;
    });
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    if (!(await page.getByRole('button', { name: 'New', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
    if (flow === 'existing') {
      await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
      await page.getByLabel('Search Hermes agents', { exact: true }).fill('existing');
      await page.getByRole('button', { name: /Existing Example.*existing-example/ }).click();
    } else await page.getByRole('button', { name: 'Create new pebble', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New pebble', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Unsaved Hazel');
    await dialog.getByLabel('Description', { exact: true }).fill('Keep my setup draft');
    const reporting = (await dialog
      .getByRole('combobox', { name: 'Reports to', exact: true })
      .boundingBox())!;
    const name = (await dialog.getByLabel('Name', { exact: true }).boundingBox())!;
    expect(reporting.width).toBeGreaterThanOrEqual(name.width - 1);
    await dialog.getByRole('combobox', { name: 'Reports to', exact: true }).click();
    await page.getByRole('option', { name: 'Mica', exact: true }).click();
    await dialog.getByLabel('Instructions', { exact: true }).fill('An unsaved responsibility');
    const initial = leases;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      (window as unknown as { __expireConnection: () => void }).__expireConnection();
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => leases).toBeGreaterThan(initial);
    await expect(page.locator('.connection-status')).toContainText('Hermes connected');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Unsaved Hazel');
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
      'Keep my setup draft',
    );
    await expect(dialog.getByRole('combobox', { name: 'Reports to', exact: true })).toContainText(
      'Mica',
    );
    await expect(dialog.getByLabel('Instructions', { exact: true })).toHaveValue(
      'An unsaved responsibility',
    );
    await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
    await expect(
      dialog.getByRole('button', {
        name: flow === 'existing' ? 'Add pebble' : 'Create pebble',
        exact: true,
      }),
    ).toBeEnabled();
    await page.screenshot({
      animations: 'disabled',
      scale: 'css',
      path: test.info().outputPath(`${flow}-setup-recovered.png`),
    });
  });
}

for (const state of ['missing in the roster', 'lost after the roster loads']) {
  test(`an active Bot Chat ${state} shows an error without opening setup`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    const missingInRoster = state === 'missing in the roster';
    fixture.state.bots[1]!.canonical = !missingInRoster;
    let chatAttempts = 0;
    const setupRequests: string[] = [];
    await page.route('**/v1/rpc', async (route) => {
      const { operation, params } = route.request().postDataJSON();
      if (['agent.enable', 'agent.onboard', 'agent.create', 'agent.propose'].includes(operation))
        setupRequests.push(operation);
      if (operation === 'bot.open' && params.profile === 'mica') {
        chatAttempts++;
        await route.fulfill({ status: 400, json: { code: 'BOT_CHAT_MISSING' } });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/');
    const input = page.getByLabel('Message', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('Keep this draft for Arlo.');
    const phone = page.viewportSize()!.width < 768;
    if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();

    const alert = page.getByRole('alertdialog', { name: 'Can’t open Mica’s chat' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('No active Bot Chat in Hermes.');
    await expect(page.getByRole('dialog', { name: 'New pebble', includeHidden: true })).toHaveCount(
      0,
    );
    expect(chatAttempts).toBe(missingInRoster ? 0 : 1);
    expect(setupRequests).toEqual([]);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('missing-bot-chat.png'),
    });
    if (missingInRoster) await page.keyboard.press('Escape');
    else await alert.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(alert).toHaveCount(0);
    if (phone && missingInRoster) {
      await expect(page.getByRole('region', { name: 'navigation', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(input).toHaveValue('Keep this draft for Arlo.');
    await expect(page.locator('.pc-chat-identity')).toContainText('Arlo');
  });
}
