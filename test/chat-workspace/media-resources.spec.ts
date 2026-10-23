import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
test('scrolling through image history releases offscreen blobs and keeps an open viewer alive', async ({
  page,
  context,
}, info) => {
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  await page.addInitScript(() => {
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      live.delete(url);
      revoke(url);
    };
    Object.assign(window, { __liveMedia: live });
  });
  await installFixture(context, {
    messages: Array.from({ length: 24 }, (_, index) => ({
      role: 'assistant',
      row_id: index + 1,
      text: `Image ${index}\n\n![Image ${index}](/hermes/cache/generated/example-${index}.png)`,
    })),
  });
  let reads = 0;
  await context.route('https://hermes.fixture.invalid/v1/files/read', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation !== 'media.read') return route.fallback();
    reads++;
    return route.fulfill({
      body: png,
      headers: {
        'content-type': 'image/png',
        'content-disposition': 'attachment; filename="example.png"',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const liveCount = () =>
    page.evaluate(() => (Reflect.get(window, '__liveMedia') as Set<string>).size);
  for (const index of [0, 6, 12, 18, 23, 0]) {
    const image = page.getByRole('img', { name: `Image ${index}`, exact: true });
    await page.locator('.message-image').nth(index).scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await expect.poll(liveCount).toBeLessThan(8);
  }
  const first = page.locator('.message-image').first();
  const before = await first.boundingBox();
  await page.getByRole('button', { name: 'View Image 0', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Image 0', exact: true });
  await expect(viewer).toBeVisible();
  const source = await viewer.getByRole('img').getAttribute('src');
  await page.locator('.pc-transcript').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(viewer.getByRole('img')).toHaveAttribute('src', source!);
  await expect
    .poll(() => page.evaluate((url) => Reflect.get(window, '__liveMedia').has(url), source))
    .toBe(true);
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect
    .poll(() => page.evaluate((url) => Reflect.get(window, '__liveMedia').has(url), source))
    .toBe(false);
  await expect.poll(liveCount).toBeLessThan(8);
  expect((await first.boundingBox())!.height).toBeCloseTo(before!.height, 0);
  expect(reads).toBeGreaterThan(6);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('bounded-image-history.png'),
  });
});
