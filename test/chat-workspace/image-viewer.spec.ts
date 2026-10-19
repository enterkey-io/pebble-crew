import { test, expect } from '@playwright/test';
import type { BrowserContext, Page, Locator } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

async function setup(page: Page, context: BrowserContext) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1600;
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('Test image canvas unavailable');
    const sky = paint.createLinearGradient(0, 0, 2400, 1600);
    sky.addColorStop(0, '#d5c5a5');
    sky.addColorStop(1, '#536d67');
    paint.fillStyle = sky;
    paint.fillRect(0, 0, 2400, 1600);
    paint.fillStyle = '#f0dfc3';
    paint.beginPath();
    paint.arc(1750, 420, 220, 0, Math.PI * 2);
    paint.fill();
    for (let index = 0; index < 4; index++) {
      paint.fillStyle = ['#9b8f71', '#667b68', '#455f55', '#304f48'][index] ?? '#304f48';
      paint.beginPath();
      paint.moveTo(0, 1000 + index * 160);
      paint.bezierCurveTo(900, 300 + index * 180, 1300, 1500, 2400, 650 + index * 160);
      paint.lineTo(2400, 1600);
      paint.lineTo(0, 1600);
      paint.fill();
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  if (!png) throw new Error('Test image was not encoded');
  let reads = 0;
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: '![Field notes](/hermes/cache/generated/field-notes.png)',
      },
    ],
  });
  await page.route('**/v1/files/read', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== 'media.read') return route.fallback();
    reads++;
    await route.fulfill({
      body: Buffer.from(png, 'base64'),
      headers: {
        'content-type': 'image/png',
        'content-disposition': "attachment; filename*=UTF-8''field-notes.png",
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const trigger = page.getByRole('button', { name: 'View Field notes', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger.getByRole('img')).toBeVisible();
  return { trigger, reads: () => reads };
}

async function bounds(image: Locator) {
  const box = await image.boundingBox();
  if (!box) throw new Error('Visible photo has no bounds');
  return box;
}

async function touch(canvas: Locator, type: string, points: { x: number; y: number }[]) {
  await canvas.evaluate(
    (element, { type, points }) => {
      const touches = points.map(({ x, y }, identifier) => ({
        identifier,
        target: element,
        clientX: x,
        clientY: y,
        pageX: x + window.scrollX,
        pageY: y + window.scrollY,
      }));
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        targetTouches: { value: touches },
        changedTouches: { value: touches },
      });
      element.dispatchEvent(event);
    },
    { type, points },
  );
}

test('photo viewer supports wheel, keyboard and mouse pan without disturbing chat', async ({
  page,
  context,
}, info) => {
  const { trigger, reads } = await setup(page, context);
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Keep this photo draft');
  await trigger.focus();
  const scroll = await page.getByRole('log').evaluate((node) => node.scrollTop);
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Field notes', exact: true });
  const image = viewer.getByRole('img', { name: 'Field notes', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(2400);
  await expect(viewer).toHaveCSS('border-top-width', '0px');
  await expect(viewer).toHaveCSS('border-radius', '0px');
  await expect(viewer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(viewer.getByRole('group', { name: 'Image canvas' })).toBeFocused();
  await expect(viewer.getByRole('group', { name: 'Image canvas' })).toHaveCSS('overflow', 'hidden');
  await expect(image).toHaveCSS('pointer-events', 'none');
  const fit = await bounds(image);
  expect(Math.abs(fit.x + fit.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(1);
  const readCount = reads();
  await page.screenshot({ path: info.outputPath('image-viewer-fit.png') });

  await page.keyboard.press('Control+Equal');
  await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(fit.width * 1.3);
  await page.keyboard.press('Control+Minus');
  await expect.poll(async () => Math.abs((await bounds(image)).width - fit.width)).toBeLessThan(1);
  await page.keyboard.press('Meta+Equal');
  await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(fit.width * 1.3);
  await page.keyboard.press('Control+Digit0');
  await expect.poll(async () => Math.abs((await bounds(image)).width - fit.width)).toBeLessThan(1);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewer test requires a viewport');
  if (!(info.project.use.isMobile && info.project.use.browserName === 'webkit')) {
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -240);
    await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(fit.width * 1.05);
  }
  await expect(page.getByRole('log')).toHaveJSProperty('scrollTop', scroll);
  await page.keyboard.press('Control+Digit0');
  await expect.poll(async () => Math.abs((await bounds(image)).width - fit.width)).toBeLessThan(1);
  for (let index = 0; index < 4; index++) {
    const previous = (await bounds(image)).width;
    await page.keyboard.press('Control+Equal');
    await expect
      .poll(async () => (await bounds(image)).width)
      .toBeGreaterThan(previous + fit.width * 0.2);
  }
  const beforePan = await bounds(image);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2 + 80, viewport.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await bounds(image)).x).toBeGreaterThan(beforePan.x + 30);
  await expect(viewer).toBeVisible();
  await page.mouse.move(1, 1);
  await page.screenshot({ path: info.outputPath('image-viewer-zoomed.png') });

  const photo = await image.elementHandle();
  const source = await image.getAttribute('src');
  await emit(page, 'message.reaction', { row_id: 1, reactions: [{ emoji: '👍', author: 'user' }] });
  await page.evaluate(() => Reflect.get(window, '__breakStream')());
  await expect(field).toBeEnabled({ timeout: 10000 });
  expect(await photo?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(image).toHaveAttribute('src', source ?? '');
  expect(reads()).toBe(readCount);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(field).toHaveValue('Keep this photo draft');

  await trigger.click();
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveCSS('pointer-events', 'auto');
  await page.mouse.click(8, viewport.height / 2);
  await expect(viewer).toHaveCount(0);
  await trigger.click();
  await expect(viewer).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(viewer).toHaveCount(0);
  await expect(field).toHaveValue('Keep this photo draft');
  expect(reads()).toBe(readCount);
});

test('phone photo viewer supports pinch and one-finger pan', async ({ page, context }, info) => {
  test.skip(!info.project.use.isMobile, 'Touch gestures use the phone browser projects.');
  const { trigger } = await setup(page, context);
  await trigger.tap();
  const viewer = page.getByRole('dialog', { name: 'Field notes', exact: true });
  const image = viewer.getByRole('img', { name: 'Field notes', exact: true });
  await expect(image).toBeVisible();
  const fit = await bounds(image);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Touch viewer test requires a viewport');
  const x = viewport.width / 2,
    y = viewport.height / 2;
  const canvas = viewer.getByRole('group', { name: 'Image canvas' });
  await touch(canvas, 'touchstart', [
    { x: x - 35, y },
    { x: x + 35, y },
  ]);
  await touch(canvas, 'touchmove', [
    { x: x - 105, y },
    { x: x + 105, y },
  ]);
  await touch(canvas, 'touchend', []);
  await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(fit.width * 2.5);
  const beforePan = await bounds(image);
  await touch(canvas, 'touchstart', [{ x, y }]);
  for (let index = 1; index <= 4; index++) {
    await touch(canvas, 'touchmove', [{ x: x + index * 20, y }]);
    await page.waitForTimeout(16);
  }
  await touch(canvas, 'touchend', []);
  await expect.poll(async () => (await bounds(image)).x).toBeGreaterThan(beforePan.x + 30);
  await expect(viewer).toBeVisible();
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await page.screenshot({ path: info.outputPath('image-viewer-touch.png') });
  await viewer.getByRole('button', { name: 'Fit image', exact: true }).tap();
  await expect.poll(async () => Math.abs((await bounds(image)).width - fit.width)).toBeLessThan(1);
  await viewer.getByRole('button', { name: 'Close image', exact: true }).tap();
  await expect(viewer).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('borderless photo viewer fits resized viewports and respects reduced motion', async ({
  page,
  context,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const { trigger } = await setup(page, context);
  await trigger.click();
  const viewer = page.getByRole('dialog', { name: 'Field notes', exact: true });
  const image = viewer.getByRole('img', { name: 'Field notes', exact: true });
  await expect(image).toBeVisible();
  const fit = await bounds(image);
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await bounds(image)).width).toBeGreaterThan(fit.width * 1.3);
  await viewer.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(async () => Math.abs((await bounds(image)).width - fit.width)).toBeLessThan(1);
  await page.setViewportSize({ width: 760, height: 420 });
  await viewer.getByRole('button', { name: 'Fit image', exact: true }).click();
  await expect.poll(async () => (await bounds(image)).width).toBeLessThanOrEqual(728);
  await expect.poll(async () => (await bounds(image)).height).toBeLessThanOrEqual(292);
  await expect(viewer.getByRole('button', { name: 'Close image' })).toBeInViewport();
  await expect(viewer.getByRole('button', { name: 'Fit image' })).toBeInViewport();
  await viewer.getByRole('button', { name: 'Fit image' }).hover();
  await expect(viewer.getByRole('button', { name: 'Fit image' })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await page.screenshot({ path: info.outputPath('image-viewer-landscape.png') });
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(viewer).toHaveCount(0);
});
