import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';

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
        offsetTop: 0,
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
    const styles = await pin.evaluate((e) => ({
      size: getComputedStyle(e).fontSize,
      background: getComputedStyle(e).backgroundColor,
    }));
    await expect(row).toHaveCSS('font-size', styles.size);
    await expect(row).toHaveCSS('background-color', styles.background);
    expect(styles.background).not.toBe('rgba(0, 0, 0, 0)');
    for (const button of await header.getByRole('button').all()) {
      const svg = button.locator('svg').first();
      if (await svg.count()) expect((await svg.boundingBox())!.width).toBeGreaterThanOrEqual(20);
    }
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`installed-navigation-${theme}.png`),
    });
  });
