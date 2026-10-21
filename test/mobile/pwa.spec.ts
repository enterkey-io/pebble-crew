import { test, expect } from '@playwright/test';

test('installable app metadata and original icons are served; offline cache contains only public assets', async ({
  page,
  context,
  browserName,
}, info) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Connect Hermes — Pebble Crew');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  expect(await manifest.json()).toMatchObject({
    name: 'Pebble Crew',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  const icon = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/icons/pebble-512.png';
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  expect(icon).toEqual([512, 512]);
  if (browserName === 'chromium') {
    const session = await context.newCDPSession(page);
    const result = await session.send('Page.getInstallabilityErrors');
    expect(result.installabilityErrors).toEqual([]);
    await session.detach();
  }
  const paths = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    )
      .flat()
      .sort();
  });
  expect(paths).toEqual([
    '/icons/pebble-180.png',
    '/icons/pebble-192.png',
    '/icons/pebble-512.png',
    '/offline.css',
    '/offline.html',
  ]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  await expect(page.getByRole('log')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('offline.png') });
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).tap();
  await expect(page).toHaveTitle('Connect Hermes — Pebble Crew');
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toHaveCount(0);
});
