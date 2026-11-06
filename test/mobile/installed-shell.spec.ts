import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';
import { expectPinRoleContrast } from '../chat-workspace/pinned-layout';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 440, height: 956 },
  screen: { width: 440, height: 956 },
});

async function fullyExposed(control: Locator) {
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const points: [number, number][] = [
          [r.left + 3, r.top + r.height / 2],
          [r.right - 3, r.top + r.height / 2],
          [r.left + r.width / 2, r.top + 3],
          [r.left + r.width / 2, r.bottom - 3],
        ];
        return points.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit === node || (!!hit && node.contains(hit));
        });
      }),
    )
    .toBe(true);
}
async function loaded(page: Page) {
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-top', '62px');
    document.documentElement.style.setProperty('--app-safe-bottom', '34px');
  });
}

test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        get height() {
          return innerHeight - 62;
        },
        get width() {
          return innerWidth;
        },
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
        scale: 1,
      }),
    });
  });
  await installFixture(context);
  await page.goto('/');
  await loaded(page);
});

test('the document covers the full PWA canvas and all composer controls are exposed at cold open', async ({
  page,
}, info) => {
  const shell = (await page.locator('.pc-shell').boundingBox())!;
  const body = (await page.locator('body').boundingBox())!;
  expect(body.height).toBeGreaterThanOrEqual(shell.height);
  expect(body.y + body.height).toBeGreaterThanOrEqual(shell.y + shell.height);
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft');
  await page.getByLabel('Message', { exact: true }).blur();
  await fullyExposed(page.locator('[data-slot="prompt-input"]'));
  await fullyExposed(page.getByLabel('Message', { exact: true }));
  await fullyExposed(page.locator('[data-slot="prompt-input"] button').last());
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('installed-cold-chat.png'),
  });
});

test('the first tap after a cold open focuses the editable message field', async ({ page }) => {
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeEditable();
  await expect(composer).not.toBeFocused();
  await composer.tap();
  await expect(composer).toBeFocused();
  await composer.fill('First tap draft');
  await page.reload();
  await loaded(page);
  await expect(composer).toHaveValue('First tap draft');
  await expect(composer).not.toBeFocused();
  await composer.tap();
  await expect(composer).toBeFocused();
});

test('the installed sidebar follows the document scroll-to-top while the chat keeps its draft', async ({
  page,
}, info) => {
  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('Keep this while browsing the roster');
  await composer.blur();
  const open = page.getByRole('button', { name: 'Toggle navigation', exact: true });
  const navigation = page.getByRole('region', { name: 'navigation', exact: true });
  const account = navigation.getByRole('button', { name: 'Your account', exact: true });
  const search = navigation.getByRole('button', { name: 'Search Pebble Crew', exact: true });
  const offset = () => page.evaluate(() => window.scrollY);
  await open.tap();
  await fullyExposed(search);
  await fullyExposed(account);
  const headerY = (await search.boundingBox())!.y;
  const footerY = (await account.boundingBox())!.y;

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(offset).toBeGreaterThan(100);
  const lastOffset = await offset();
  await fullyExposed(search);
  await fullyExposed(account);
  expect((await search.boundingBox())!.y).toBeCloseTo(headerY, 0);
  expect((await account.boundingBox())!.y).toBeCloseTo(footerY, 0);

  await page.keyboard.press('Escape');
  await expect(composer).toHaveValue('Keep this while browsing the roster');
  await expect.poll(offset).toBe(0);
  await open.tap();
  await expect.poll(offset).toBe(lastOffset);

  // Playwright can reset the document offset but cannot tap UIKit's status bar.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(offset).toBe(0);
  await fullyExposed(navigation.getByRole('button', { name: /^Arlo .*Bot Chat$/ }));
  await fullyExposed(account);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('installed-sidebar-after-scroll-to-top.png'),
  });
});

test('the phone header is centered and navigation glyphs are readable at every supported phone width', async ({
  page,
}, info) => {
  for (const width of [440, 390, 320]) {
    await page.setViewportSize({ width, height: 956 });
    const identity = page.locator('.pc-chat-identity');
    const box = (await identity.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    const avatar = (await identity.locator('.agent-avatar').boundingBox())!;
    const chevron = (await identity.locator('.pc-details-chevron').boundingBox())!;
    expect(Math.abs((avatar.x + chevron.x + chevron.width) / 2 - width / 2)).toBeLessThanOrEqual(1);
    const back = page.getByRole('button', { name: 'Toggle navigation', exact: true });
    expect((await back.locator('svg').boundingBox())!.width).toBeGreaterThanOrEqual(22);
    await fullyExposed(back);
    await fullyExposed(identity);
    await fullyExposed(page.getByRole('button', { name: 'Refresh', exact: true }));
  }
  await page.screenshot({ animations: 'disabled', path: info.outputPath('installed-header.png') });
});

for (const theme of ['dark', 'light'])
  test(`navigation preserves its brand, header search, footer account and shared title labels in ${theme}`, async ({
    page,
  }, info) => {
    await page.evaluate((theme) => localStorage.setItem('pebble-crew.appearance', theme), theme);
    await page.reload();
    await loaded(page);
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    const navigation = page.getByRole('region', { name: 'navigation', exact: true });
    const header = navigation.locator('.pc-rail-header');
    await expect(header.getByText('Pebble Crew', { exact: true })).toBeVisible();
    await fullyExposed(header.getByRole('button', { name: 'Search Pebble Crew', exact: true }));
    const account = navigation
      .locator('.pc-rail-footer')
      .getByRole('button', { name: 'Your account', exact: true });
    await fullyExposed(account);
    await fullyExposed(navigation.getByText('Hermes connected', { exact: true }));
    const pin = navigation.locator('.pc-pins').getByText('Team lead', { exact: true });
    const row = navigation
      .getByRole('button', { name: /^Sage Researcher/ })
      .getByText('Researcher', { exact: true });
    await expect(pin).toBeVisible();
    await expect(row).toBeVisible();
    for (const label of await navigation.locator('.pc-pin-title').all()) {
      expect(
        await label.evaluate(
          (e) => e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth,
        ),
      ).toBe(true);
    }
    await expect(row).toHaveCSS(
      'font-size',
      await pin.evaluate((e) => getComputedStyle(e).fontSize),
    );
    await expect(row).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expectPinRoleContrast(navigation.locator('.pc-pins'));
    for (const button of await header.getByRole('button').all()) {
      const svg = button.locator('svg').first();
      if (await svg.count()) expect((await svg.boundingBox())!.width).toBeGreaterThanOrEqual(20);
    }
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`installed-navigation-${theme}.png`),
    });
  });

for (const title of ['Settings', 'Org chart']) {
  test(`the installed ${title} page keeps its title and exit below the phone status area`, async ({
    page,
  }, info) => {
    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill('Keep this draft when I leave');
    await composer.blur();
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
    await page.getByRole('button', { name: 'Your account', exact: true }).tap();
    await page.getByRole('menuitem', { name: title, exact: true }).press('Enter');

    const heading = page.getByRole('heading', { name: title, exact: true });
    const close = page.getByRole('button', { name: `Close ${title}`, exact: true });
    for (const control of [heading, close]) {
      await expect
        .poll(async () => (await control.boundingBox())?.y ?? 0, { timeout: 3000 })
        .toBeGreaterThanOrEqual(62);
      await fullyExposed(control);
    }
    if (title === 'Settings') {
      await page.getByRole('tab', { name: 'Connections', exact: true }).tap();
      await expect(page.getByRole('tab', { name: 'Connections', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await fullyExposed(close);
    } else {
      const fit = page.getByRole('button', { name: 'Fit chart', exact: true });
      await fullyExposed(fit);
      const bounds = await fit.boundingBox();
      if (!bounds) throw new Error('The Fit chart control is missing');
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(956 - 34);
    }
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`installed-${title.toLowerCase().replace(' ', '-')}.png`),
    });
    await close.tap();
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue('Keep this draft when I leave');
  });
}

for (const dismissal of ['close button', 'browser back'] as const) {
  test(`the pebble editor returns to details after ${dismissal}`, async ({ page }, info) => {
    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill('Keep this draft');
    await composer.blur();
    const identity = page.getByRole('button', { name: /Show details/ });
    await identity.tap();
    const details = page.getByRole('button', { name: 'Close details', exact: true });
    await fullyExposed(details);
    const detailsHistory = await page.evaluate(() => history.state?.pebbleDrawer);
    expect(typeof detailsHistory).toBe('string');
    const detailBounds = await details.boundingBox();
    if (!detailBounds) throw new Error('The details close control is missing');
    expect(detailBounds.y).toBeGreaterThanOrEqual(62);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('installed-details.png'),
    });

    await page.getByRole('button', { name: 'Edit Arlo', exact: true }).tap();
    const editor = page.getByRole('dialog', { name: 'Edit pebble', exact: true });
    const editorClose = editor.getByRole('button', { name: 'Close Edit Arlo', exact: true });
    await fullyExposed(editorClose);
    const editorBounds = await editor.boundingBox();
    if (!editorBounds) throw new Error('The pebble editor is missing');
    expect(editorBounds.y).toBeGreaterThanOrEqual(62);
    expect(editorBounds.y + editorBounds.height).toBeLessThanOrEqual(956 - 34);
    if (dismissal === 'close button') await editorClose.tap();
    else await page.goBack();
    await expect(editor).toHaveCount(0);
    await fullyExposed(details);
    await expect.poll(() => page.evaluate(() => history.state?.pebbleDrawer)).toBe(detailsHistory);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('installed-details-after-edit.png'),
    });

    await page.goBack();
    await expect(details).not.toBeVisible();
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue('Keep this draft');
  });
}
