import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

const photos = [
  { path: '/hermes/cache/generated/wall-push.png', title: 'Wall push-up', row: 1 },
  { path: '/hermes/cache/generated/chair-squat.png', title: 'Chair squat', row: 1 },
  { path: '/hermes/cache/generated/plank.png', title: 'Forearm plank', row: 2 },
];

async function swipe(page: Page, from: number, to: number) {
  // A one-finger horizontal swipe on the photo canvas.
  await page.getByRole('group', { name: 'Image canvas' }).evaluate(
    (node, [start, end]) => {
      const y = node.getBoundingClientRect().top + node.clientHeight / 2;
      const touch = (x: number) =>
        new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
      node.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [touch(start!)],
          changedTouches: [touch(start!)],
        }),
      );
      node.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [touch(end!)],
          changedTouches: [touch(end!)],
        }),
      );
      node.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          touches: [],
          changedTouches: [touch(end!)],
        }),
      );
    },
    [from, to],
  );
}

test('chat photos open in one gallery with titles, thumbnails, swipe and save to Photos', async ({
  page,
  context,
}, info) => {
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  const keys = new Map(photos.map((p) => [createHash('sha256').update(p.path).digest('hex'), p]));
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: `Two to start.\n\n![${photos[0]!.title}](${photos[0]!.path})\n\n![${photos[1]!.title}](${photos[1]!.path})`,
      },
      {
        row_id: 2,
        role: 'assistant',
        text: `And the last one.\n\n![${photos[2]!.title}](${photos[2]!.path})`,
      },
    ],
  });
  await page.route('**/v1/files/read', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== 'media.read') return route.fallback();
    const photo = keys.get(body.params.reference);
    expect(photo?.row).toBe(body.params.row_id);
    await route.fulfill({
      body: png,
      headers: {
        'content-type': 'image/png',
        'content-disposition': `attachment; filename*=UTF-8''${photo!.path.split('/').pop()}`,
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  for (const [index, photo] of photos.entries()) {
    await page.locator('.message-image').nth(index).scrollIntoViewIfNeeded();
    await expect(page.getByRole('img', { name: photo.title, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: `View ${photos[1]!.title}`, exact: true }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.locator('.gallery-caption', { hasText: photos[1]!.title })).toBeVisible();
  const strip = viewer.getByRole('group', { name: 'Photos', exact: true });
  await expect(strip.getByRole('button')).toHaveCount(3);
  await expect(strip.getByRole('button', { name: `Show ${photos[1]!.title}` })).toHaveAttribute(
    'aria-current',
    'true',
  );
  const shown = viewer.getByRole('img', { name: photos[1]!.title, exact: true });
  await expect(shown).toBeVisible();

  // Synthetic touches need the Touch constructor (Chromium); WebKit uses the keyboard path.
  if (info.project.name.includes('android')) {
    await swipe(page, 300, 80);
  } else {
    await page.keyboard.press('ArrowRight');
  }
  await expect(viewer.locator('.gallery-caption', { hasText: photos[2]!.title })).toBeVisible();
  await expect(strip.getByRole('button', { name: `Show ${photos[2]!.title}` })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await strip.getByRole('button', { name: `Show ${photos[0]!.title}` }).click();
  await expect(viewer.locator('.gallery-caption', { hasText: photos[0]!.title })).toBeVisible();
  await page.screenshot({ path: info.outputPath('photo-gallery.png'), animations: 'disabled' });

  await page.evaluate(() => {
    Reflect.set(window, '__shared', []);
    Reflect.set(navigator, 'canShare', () => true);
    Reflect.set(navigator, 'share', async (data?: ShareData) => {
      (Reflect.get(window, '__shared') as string[]).push(
        ...(data?.files ?? []).map((f) => `${f.name}:${f.type}`),
      );
    });
  });
  // A long press must reach the photo itself so iPhone shows its own image menu
  // (Save to Photos, Share). The zoom layer would otherwise swallow the touch.
  const current = viewer.getByRole('img', { name: photos[0]!.title, exact: true });
  const reach = await current.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const style = getComputedStyle(node);
    return {
      hit: hit === node,
      pointer: style.pointerEvents,
      callout: style.getPropertyValue('-webkit-touch-callout') || 'default',
    };
  });
  expect(reach.hit).toBe(true);
  expect(reach.pointer).not.toBe('none');
  expect(reach.callout).not.toBe('none');
  await viewer.getByRole('button', { name: 'Save photo', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__shared') as string[]))
    .toEqual(['wall-push.png:image/png']);
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
});

test('Library shows square photo previews and opens a swipeable gallery', async ({
  page,
  context,
}, info) => {
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  await installFixture(context);
  const files = [
    { row_id: 3, reference: 'a'.repeat(64), name: 'first.png', size: png.length },
    { row_id: 4, reference: 'b'.repeat(64), name: 'notes.md', size: 100 },
    { row_id: 5, reference: 'c'.repeat(64), name: 'second.png', size: png.length },
  ];
  await page.route('**/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === 'media.list')
      return route.fulfill({ json: { result: { files, next: null } } });
    return route.fallback();
  });
  await page.route('**/v1/files/read', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation !== 'media.read') return route.fallback();
    const file = files.find((item) => item.row_id === params.row_id)!;
    return route.fulfill({
      body: file.name.endsWith('.png') ? png : Buffer.from('# Notes'),
      headers: {
        'content-type': file.name.endsWith('.png') ? 'image/png' : 'text/markdown',
        'content-disposition': `attachment; filename*=UTF-8''${file.name}`,
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  await details.getByRole('tab', { name: 'Library', exact: true }).click();
  const tiles = details.getByRole('list', { name: 'Library items' }).getByRole('listitem');
  await expect(tiles).toHaveCount(3);
  // Square tiles; photos show a cropped preview, files show their name.
  for (const tile of await tiles.all()) {
    const box = (await tile.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2);
  }
  await expect(tiles.nth(0).locator('img')).toHaveCSS('object-fit', 'cover');
  await expect(tiles.nth(1)).toContainText('notes.md');
  await page.screenshot({ path: info.outputPath('library-grid.png'), animations: 'disabled' });
  await details.getByRole('button', { name: 'View first.png', exact: true }).click();
  const viewer = page.getByRole('dialog');
  const strip = viewer.getByRole('group', { name: 'Photos', exact: true });
  await expect(strip.getByRole('button')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(strip.getByRole('button', { name: 'Show second.png' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await expect(tiles).toHaveCount(3);
});

test('several photos sent together form a titled stack that opens as a gallery', async ({
  page,
  context,
}, info) => {
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  const stack = [
    { path: '/hermes/cache/generated/s1.png', title: 'Wall push-up' },
    { path: '/hermes/cache/generated/s2.png', title: 'Chair squat' },
    { path: '/hermes/cache/generated/s3.png', title: 'Forearm plank' },
  ];
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: `Your routine:\n\n${stack.map((p) => `![${p.title}](${p.path})`).join('\n')}\n\nAnd one on its own:\n\n![Glute bridge](/hermes/cache/generated/single.png)`,
      },
    ],
  });
  await page.route('**/v1/files/read', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== 'media.read') return route.fallback();
    await route.fulfill({
      body: png,
      headers: {
        'content-type': 'image/png',
        'content-disposition': `attachment; filename*=UTF-8''photo.png`,
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const card = page.getByRole('button', {
    name: 'View 3 photos, starting with Wall push-up',
    exact: true,
  });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.getByText('Wall push-up', { exact: true })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Wall push-up', exact: true })).toBeVisible();
  // The single photo stays a normal chat photo.
  await page.locator('.message-image').last().scrollIntoViewIfNeeded();
  await expect(page.getByRole('img', { name: 'Glute bridge', exact: true })).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('photo-stack.png'), animations: 'disabled' });
  await card.click();
  const viewer = page.getByRole('dialog');
  const strip = viewer.getByRole('group', { name: 'Photos', exact: true });
  await expect(strip.getByRole('button')).toHaveCount(3);
  await expect(viewer.locator('.gallery-caption', { hasText: 'Wall push-up' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('.gallery-caption', { hasText: 'Chair squat' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('photo-stack-open.png'), animations: 'disabled' });
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(viewer).toHaveCount(0);
});

test('chat shows small copies, only the open photo loads its original, and stacks take the photo shape', async ({
  page,
  context,
}, info) => {
  const wide = [1, 2, 3].map((n) => ({
    path: `/hermes/cache/generated/wide${n}.jpg`,
    title: `Beach ${n}`,
  }));
  const tall = [1, 2].map((n) => ({
    path: `/hermes/cache/generated/tall${n}.jpg`,
    title: `Tower ${n}`,
  }));
  const all = [...wide, ...tall];
  const keys = new Map(all.map((p) => [createHash('sha256').update(p.path).digest('hex'), p]));
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: `Beach day:\n\n${wide.map((p) => `![${p.title}](${p.path})`).join('\n')}`,
      },
      {
        row_id: 2,
        role: 'assistant',
        text: `City:\n\n${tall.map((p) => `![${p.title}](${p.path})`).join('\n')}`,
      },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  // Each size is a distinct, real image so the page can tell which one it shows.
  const images = await page.evaluate(() => {
    const draw = (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#c87a5a';
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL('image/png').split(',')[1]!;
    };
    return {
      wide: { thumb: draw(36, 24), preview: draw(128, 85), full: draw(300, 200) },
      tall: { thumb: draw(24, 36), preview: draw(85, 128), full: draw(200, 300) },
    };
  });
  const reads: string[] = [];
  await page.route('**/v1/files/read', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== 'media.read') return route.fallback();
    const photo = keys.get(body.params.reference)!;
    const size: 'thumb' | 'preview' | 'full' = body.params.variant ?? 'full';
    reads.push(`${photo.title}:${size}`);
    await route.fulfill({
      body: Buffer.from(images[photo.path.includes('wide') ? 'wide' : 'tall'][size], 'base64'),
      headers: {
        'content-type': 'image/png',
        'content-disposition': `attachment; filename*=UTF-8''${photo.path.split('/').pop()}`,
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const beach = page.getByRole('button', {
    name: 'View 3 photos, starting with Beach 1',
    exact: true,
  });
  const city = page.getByRole('button', {
    name: 'View 2 photos, starting with Tower 1',
    exact: true,
  });
  // The newest stack is on screen first; a wide stack further up is read when reached.
  await expect(city).toHaveAttribute('data-shape', 'portrait');
  const tallBox = (await city.boundingBox())!;
  expect(tallBox.height).toBeGreaterThan(tallBox.width * 1.1);
  // Let the conversation finish following the grown card before scrolling up.
  const log = page.locator('.pc-transcript');
  let last = -1;
  await expect
    .poll(async () => {
      const top = await log.evaluate((node) => node.scrollTop);
      const settled = top === last;
      last = top;
      return settled;
    })
    .toBe(true);
  await beach.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await expect(beach).toHaveAttribute('data-shape', 'landscape');
  await beach.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const wideBox = (await beach.boundingBox())!;
  expect(wideBox.width).toBeGreaterThan(wideBox.height * 1.2);
  await page.screenshot({
    path: info.outputPath('photo-stack-shapes.png'),
    animations: 'disabled',
  });
  // The top card is chat-sized and the cards behind it are thumbnails; nothing is full size.
  expect(reads).toContain('Beach 1:preview');
  expect(reads).toContain('Beach 2:thumb');
  expect(reads.filter((read) => read.endsWith(':full'))).toEqual([]);

  await beach.click();
  const viewer = page.getByRole('dialog');
  const shown = viewer.getByRole('img', { name: 'Beach 1', exact: true });
  // The original replaces the chat copy for the open photo only.
  await expect.poll(() => shown.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(300);
  const strip = viewer.getByRole('group', { name: 'Photos', exact: true });
  await expect(strip.locator('img')).toHaveCount(3);
  await expect.poll(() => reads.filter((read) => read.endsWith(':full'))).toEqual(['Beach 1:full']);
  for (const title of ['Beach 2', 'Beach 3']) expect(reads).toContain(`${title}:thumb`);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => reads.filter((read) => read.endsWith(':full')))
    .toEqual(['Beach 1:full', 'Beach 2:full']);
  await page.screenshot({
    path: info.outputPath('photo-gallery-sizes.png'),
    animations: 'disabled',
  });
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(viewer).toHaveCount(0);
});
