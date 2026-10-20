import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('shared MP4 plays inline and opens a centered zoomable player with seek, mute and download', async ({
  page,
  context,
}, info) => {
  const bytes = await readFile('test/fixtures/sample-video.mp4');
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: '[Project clip](/hermes/cache/videos/sample-video.mp4)',
      },
    ],
  });
  let reads = 0;
  await page.route('**/v1/files/read', (route) => {
    reads++;
    expect(route.request().postDataJSON().params.row_id).toBe(1);
    return route.fulfill({
      body: bytes,
      headers: {
        'content-type': 'video/mp4',
        'content-disposition': "attachment; filename*=UTF-8''sample-video.mp4",
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.goto('/');
  const load = page.getByRole('button', { name: 'Play sample-video.mp4', exact: true });
  await expect(load).toBeVisible();
  expect(reads).toBe(0);
  await load.click();
  const inline = page.locator('.message-image video');
  await expect
    .poll(() => inline.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => inline.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await inline.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 0.5;
  });
  await expect(inline).toHaveCSS('border-top-left-radius', '16px');
  await page.getByRole('button', { name: 'View sample-video.mp4', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'sample-video.mp4', exact: true });
  const video = viewer.locator('video');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(video).toHaveCSS('opacity', '1');
  expect(await inline.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(0.5, 1);
  await viewer.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.5);
  await viewer.getByRole('button', { name: 'Pause video', exact: true }).click();
  await viewer.getByRole('button', { name: 'Mute video', exact: true }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  const seek = viewer.getByRole('slider', { name: 'Video position', exact: true });
  await seek.focus();
  await seek.press('Home');
  await seek.press('ArrowRight');
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(0.1, 1);
  const before = (await video.boundingBox())!;
  expect(Math.abs(before.x + before.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(3);
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect
    .poll(async () => (await video.boundingBox())!.width)
    .toBeGreaterThan(before.width + 50);
  const zoomed = (await video.boundingBox())!;
  await info.attach('video-zoom-bounds', {
    body: JSON.stringify({ before, zoomed, viewport: page.viewportSize() }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('video-zoom-check.png'), animations: 'disabled' });
  await expect
    .poll(async () => {
      const box = (await video.boundingBox())!;
      return Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2);
    })
    .toBeLessThan(3);
  await viewer.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.4);
  await viewer.getByRole('button', { name: 'Pause video', exact: true }).click();
  const playingBounds = (await video.boundingBox())!;
  expect(playingBounds.width).toBeGreaterThan(before.width + 50);
  expect(
    Math.abs(playingBounds.x + playingBounds.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThan(3);
  const download = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Download video', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('sample-video.mp4');
  expect(await readFile((await file.path())!)).toEqual(bytes);
  await page.screenshot({ path: info.outputPath('video-viewer.png'), animations: 'disabled' });
  await viewer.getByRole('button', { name: 'Close video', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await page.getByRole('button', { name: 'View sample-video.mp4', exact: true }).click();
  await expect(viewer.locator('video')).toHaveCSS('opacity', '1');
  expect(await viewer.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await expect(viewer.getByRole('button', { name: 'Unmute video', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close video', exact: true }).click();
  expect(reads).toBe(1);
  await expect(inline).toBeVisible();
  await page.screenshot({ path: info.outputPath('video-inline.png'), animations: 'disabled' });
  await page.reload();
  await expect(load).toBeVisible();
  expect(reads).toBe(1);
});
