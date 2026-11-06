import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';

test.use({ serviceWorkers: 'block' });

async function swipe(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  fingers = 1,
  surface = '.pc-mobile-conversation',
) {
  await page.locator(surface).evaluate(
    (node, { start, end, fingers }) => {
      const point = (p: { x: number; y: number }) => ({
        identifier: 0,
        clientX: p.x,
        clientY: p.y,
      });
      const dispatch = (type: string, p: { x: number; y: number }) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: {
            value: type === 'touchend' ? [] : Array.from({ length: fingers }, () => point(p)),
          },
          changedTouches: { value: [point(p)] },
        });
        node.dispatchEvent(event);
      };
      dispatch('touchstart', start);
      dispatch('touchmove', end);
      dispatch('touchend', end);
    },
    { start, end, fingers },
  );
}

test('installed PWA leading-edge swipe returns to the list without losing chat or draft', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await installFixture(context);
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('Keep this draft when I swipe back');
  await field.blur();
  const log = await page.getByRole('log').elementHandle();
  const input = await field.elementHandle();
  const readingPosition = await log!.evaluate((node) => {
    node.scrollTop = Math.min(100, node.scrollHeight - node.clientHeight);
    node.dispatchEvent(new Event('scroll'));
    return node.scrollTop;
  });
  const navigation = page.getByRole('region', { name: 'navigation', exact: true });
  await swipe(page, { x: 6, y: 220 }, { x: 9, y: 360 });
  await expect(navigation).not.toBeVisible();
  await swipe(page, { x: 130, y: 220 }, { x: 310, y: 225 });
  await expect(navigation).not.toBeVisible();
  await swipe(page, { x: 6, y: 220 }, { x: 180, y: 225 }, 2);
  await expect(navigation).not.toBeVisible();
  await swipe(page, { x: 6, y: 220 }, { x: 180, y: 225 });
  await expect(navigation).toBeVisible();
  expect(await log!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await input!.evaluate((node) => node.isConnected)).toBe(true);
  const right = page.viewportSize()!.width - 6;
  await swipe(page, { x: right, y: 220 }, { x: right - 2, y: 360 }, 1, '.pc-mobile-navigation');
  await expect(navigation).toBeVisible();
  await swipe(page, { x: right, y: 220 }, { x: right - 180, y: 225 }, 2, '.pc-mobile-navigation');
  await expect(navigation).toBeVisible();
  await swipe(page, { x: right, y: 220 }, { x: right - 180, y: 225 }, 1, '.pc-mobile-navigation');
  await expect(page.locator('.pc-phone-pages')).toHaveAttribute('data-navigation-open', 'false');
  await expect(navigation).not.toBeVisible();
  await expect(field).toBeVisible();
  expect((await field.boundingBox())!.x).toBeLessThan(page.viewportSize()!.width);
  await expect(field).toHaveValue('Keep this draft when I swipe back');
  await expect(field).not.toBeFocused();
  await expect.poll(() => log!.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0);
});

test('installed swipe uses browser touch input in both directions', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Playwright exposes touch sequences through CDP.');
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const navigation = page.getByRole('region', { name: 'navigation', exact: true });
  const client = await context.newCDPSession(page);
  const width = page.viewportSize()?.width ?? 0;
  const drag = async (from: number, to: number) => {
    const point = (x: number) => [{ x, y: 220, id: 1 }];
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: point(from),
    });
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point(from + ((to - from) * step) / 8),
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag(24, 160);
  await expect(navigation).toBeVisible();
  await expect.poll(async () => (await navigation.boundingBox())?.x).toBeCloseTo(0, 0);
  await drag(width - 24, width - 160);
  await expect(navigation).not.toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).not.toBeFocused();
});

test('ordinary mobile browser keeps its native edge navigation', async ({ page, context }) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await swipe(page, { x: 6, y: 220 }, { x: 180, y: 225 });
  await expect(page.getByRole('region', { name: 'navigation', exact: true })).not.toBeVisible();
});

for (const theme of ['dark', 'light'])
  test(`outgoing phone bubbles use up to 85 percent while short messages fit their text in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context, {
      messages: [
        {
          row_id: 1,
          role: 'user',
          text: 'Please keep the project changes grouped together so I can review the whole proposal. '.repeat(
            10,
          ),
          timestamp: 1700000000,
        },
        {
          row_id: 2,
          role: 'assistant',
          text: 'I will keep those changes together.',
          timestamp: 1700000010,
        },
        { row_id: 3, role: 'user', text: 'OK', timestamp: 1700000020 },
      ],
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    const long = page.locator('[data-message-id="1"]');
    const short = page.locator('[data-message-id="3"]');
    const rowBox = (await long.locator('[data-slot="message-content"]').boundingBox())!;
    const bubble = (await long.locator('[data-slot="bubble"]').boundingBox())!;
    expect(bubble.width / rowBox.width).toBeGreaterThanOrEqual(0.84);
    expect(bubble.width / rowBox.width).toBeLessThanOrEqual(0.851);
    expect(Math.abs(bubble.x + bubble.width - rowBox.x - rowBox.width)).toBeLessThanOrEqual(1);
    expect((await short.locator('[data-slot="bubble"]').boundingBox())!.width).toBeLessThan(
      rowBox.width * 0.4,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: info.outputPath(`phone-bubble-width-${theme}.png`),
      animations: 'disabled',
    });
  });
