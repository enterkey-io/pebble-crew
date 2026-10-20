import { expect, test } from '@playwright/test';
import { SHAPES } from '../../apps/web/src/avatar-lab/engine';

const pose = '#hero svg [data-avatar-part="body"]';

test('appearance and activity controls work without contacting Hermes or external services', async ({
  page,
}) => {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:8092' || url.pathname.startsWith('/api/'))
      unexpected.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/avatar-lab.html');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A little character.');
  await expect(page.locator('link[href*="workspace-"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/avatar-lab-desktop.png' });
  await page.getByRole('button', { name: 'Petal', exact: true }).click();
  await page.getByRole('button', { name: 'Lagoon', exact: true }).click();
  await expect(page.locator('#hero-name')).toHaveText('Petal');
  await expect(page.locator('#hero svg [data-avatar-part="body"] > path')).toHaveAttribute(
    'fill',
    '#8dcec6',
  );
  await page.getByRole('button', { name: 'Working', exact: true }).click();
  await page.getByRole('button', { name: 'Snow', exact: true }).click();
  await expect(page.locator('#hero svg [data-avatar-part="body"] > path')).toHaveAttribute(
    'fill',
    '#f4f3ef',
  );
  await expect(page.locator('#color-name')).toHaveText('Snow');
  const before = await page.locator(pose).getAttribute('transform');
  await expect.poll(() => page.locator(pose).getAttribute('transform')).not.toBe(before);
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.locator('#metrics')).toHaveAttribute('data-running', 'false');
  const paused = await page.locator('#hero').innerHTML();
  await page.waitForTimeout(500);
  expect(await page.locator('#hero').innerHTML()).toBe(paused);
  await page.getByRole('button', { name: 'Needs you', exact: true }).click();
  await expect(page.locator('#hero-status')).toHaveText('Needs you');
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('system reduced motion and user pause stop scheduling while controls remain usable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/avatar-lab.html');
  await expect(page.getByLabel('Reduce motion', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Reduce motion', { exact: true })).toBeDisabled();
  await expect(page.locator('#metrics')).toHaveAttribute('data-running', 'false');
  const count = await page.locator('#metrics').getAttribute('data-callbacks');
  await page.waitForTimeout(500);
  await expect(page.locator('#metrics')).toHaveAttribute('data-callbacks', count!);
  await page.getByRole('button', { name: 'Kite', exact: true }).click();
  await expect(page.locator('#hero-name')).toHaveText('Kite');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#metrics')).toHaveAttribute('data-running', 'true');
  await page.getByLabel('Reduce motion', { exact: true }).check();
  await expect(page.locator('#metrics')).toHaveAttribute('data-running', 'false');
});

test('large rosters dispose old instances, skip offscreen poses and handle simulated visibility changes', async ({
  page,
}) => {
  await page.goto('/avatar-lab.html');
  await expect(page.locator('#metrics')).toHaveAttribute(
    'data-mounted',
    String(25 + SHAPES.length),
  );
  await page.getByRole('button', { name: '120', exact: true }).click();
  await expect(page.locator('#metrics')).toHaveAttribute(
    'data-mounted',
    String(121 + SHAPES.length),
  );
  await page.waitForTimeout(150);
  const visible = Number(await page.locator('#metrics').getAttribute('data-visible'));
  expect(visible).toBeGreaterThan(0);
  expect(visible).toBeLessThan(121 + SHAPES.length);
  const hero = await page.locator('#hero').innerHTML();
  await page.waitForTimeout(350);
  expect(await page.locator('#hero').innerHTML()).toBe(hero);
  await page.getByRole('button', { name: '24', exact: true }).click();
  await expect(page.locator('#metrics')).toHaveAttribute(
    'data-mounted',
    String(25 + SHAPES.length),
  );
  // Headless Chromium keeps tabs visible. Drive its visibility boundary explicitly;
  // actual foreground/background switching is a separate headed-browser check.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#metrics')).toHaveAttribute('data-running', 'false');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#metrics')).toHaveAttribute('data-running', 'true');
});

test('phone layout has reachable controls and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/avatar-lab.html');
  await page.getByRole('button', { name: 'Arch', exact: true }).click();
  await page.getByRole('button', { name: 'Sky', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#hero-name')).toHaveText('Arch');
  await page.getByRole('button', { name: '120', exact: true }).click();
  await expect(page.locator('#roster .roster-agent')).toHaveCount(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('records scoped sampler/write measurements for typical and dense rosters', async ({
  page,
  browser,
}) => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const measurements = [];
  for (const { count, height } of [
    { count: 24, height: 900 },
    { count: 60, height: 900 },
    { count: 120, height: 900 },
    { count: 120, height: 2400 },
  ]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto('/avatar-lab.html');
    await page.getByRole('button', { name: String(count), exact: true }).click();
    await page.locator('#roster').evaluate((node) => node.scrollIntoView({ block: 'start' }));
    const start = Number(await page.locator('#metrics').getAttribute('data-paints'));
    await expect
      .poll(async () => Number(await page.locator('#metrics').getAttribute('data-paints')))
      .toBeGreaterThan(start + 25);
    const data = await page
      .locator('#metrics')
      .evaluate((node) => ({ ...(node as HTMLElement).dataset }));
    expect(Number.isFinite(Number(data.p95))).toBe(true);
    measurements.push({
      roster: count,
      viewport: { width: 1280, height },
      mounted: Number(data.mounted),
      visible: Number(data.visible),
      updateP95Ms: Number(data.p95),
      observedBatchFps: Number(data.fps),
    });
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/avatar-demo-measurements.json',
    JSON.stringify(
      {
        browser: browser.version(),
        platform: process.platform,
        architecture: process.arch,
        fixture: 'headless Chromium, bundled original avatars, simulated activity, no Hermes',
        scope:
          'JavaScript pose sampling and SVG attribute writes only; excludes layout/paint/GPU, total CPU, energy and native clients',
        certified: false,
        measurements,
      },
      null,
      2,
    ) + '\n',
  );
});

test('photo replaces animation locally, can be removed, and rejects vector uploads', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.method()));
  await page.goto('/avatar-lab.html');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#8dcec6';
    ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('#photo-file').setInputFiles({
    name: 'synthetic-avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.locator('#hero img')).toBeVisible();
  await expect(page.locator('#hero-name')).toHaveText('Photo avatar');
  await expect(page.locator('#hero img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('#metrics')).toHaveAttribute(
    'data-mounted',
    String(23 + SHAPES.length),
  );
  await page.getByRole('button', { name: 'Animated shape', exact: true }).click();
  await expect(page.locator('#hero svg')).toBeVisible();
  await expect(page.locator('#metrics')).toHaveAttribute(
    'data-mounted',
    String(25 + SHAPES.length),
  );
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(page.locator('#hero img')).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.locator('#hero img')).toHaveCount(0);
  await expect(page.locator('#hero svg')).toBeVisible();
  await page.locator('#photo-file').setInputFiles({
    name: 'disguised.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg onload="alert(1)"></svg>'),
  });
  await expect(page.locator('#photo-status')).toContainText('JPEG, PNG or WebP');
  await expect(page.locator('#hero svg')).toBeVisible();
  expect(requests.every((method) => method === 'GET')).toBe(true);
});
