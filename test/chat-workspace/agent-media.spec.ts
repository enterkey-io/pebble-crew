import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('agent images and files render in chat, survive live updates and reload, and never fetch remote images', async ({
  page,
  context,
}, info) => {
  const chart = '/hermes/cache/generated/chart one.png';
  const csv = '/hermes/cache/generated/figures.csv';
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  const keys = new Map(
    [chart, csv].map((path) => [createHash('sha256').update(path).digest('hex'), path]),
  );
  const remote: string[] = [];
  const reads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('tracker.invalid')) remote.push(request.url());
  });
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: `Here are the results.\n\n![Project chart](<${chart}>)\n\n[Download figures](${csv})\n\n**Another copy**\nMEDIA:"${chart}"\n\n![External reference](https://tracker.invalid/image.png)\n\n\`MEDIA:/private/not-shared.png\``,
      },
    ],
  });
  await page.route('**/v1/files/read', async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== 'media.read') return route.fallback();
    expect(body.params.session_id).toBe('session-arlo');
    expect(body.params.row_id).toBe(1);
    expect(Object.keys(body.params).sort()).toEqual(['reference', 'row_id', 'session_id']);
    const source = keys.get(body.params.reference);
    expect(source).toBeDefined();
    reads.push(source!);
    await route.fulfill({
      body: source === chart ? png : Buffer.from('column,value\none,1\n'),
      headers: {
        'content-type': source === chart ? 'image/png' : 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${source === chart ? 'chart.png' : 'figures.csv'}`,
        'access-control-expose-headers': 'Content-Disposition',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  // Restored history starts at the latest message; older images load on approach.
  await page.locator('.message-image').first().scrollIntoViewIfNeeded();
  const image = page.getByRole('img', { name: 'Project chart', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(192);
  await expect(page.getByRole('img', { name: 'chart one.png', exact: true })).toBeVisible();
  const before = await image.getAttribute('src');
  const readCount = reads.length;
  await emit(page, 'message.reaction', { row_id: 1, reactions: [{ emoji: '👍', author: 'user' }] });
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled({ timeout: 10000 });
  await expect(image).toHaveAttribute('src', before!);
  expect(reads.length).toBe(readCount);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download figures', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('figures.csv');
  await expect(page.getByRole('link', { name: 'External reference', exact: true })).toHaveAttribute(
    'referrerpolicy',
    'no-referrer',
  );
  expect(remote).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.getByRole('log').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ animations: 'disabled', path: info.outputPath('agent-media.png') });
  await page.reload();
  await page.locator('.message-image').first().scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(192);
  expect(remote).toEqual([]);
});

test('an unavailable shared image can retry without a global connection error', async ({
  page,
  context,
}) => {
  await installFixture(context, {
    messages: [
      { row_id: 1, role: 'assistant', text: '![Saved chart](/hermes/cache/images/chart.png)' },
    ],
  });
  let fail = true;
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  await page.route('**/v1/files/read', (route) =>
    route.fulfill(
      fail
        ? { status: 400, json: { error: 'File unavailable' } }
        : {
            body: png,
            headers: {
              'content-type': 'image/png',
              'content-disposition': "attachment; filename*=UTF-8''chart.png",
              'access-control-expose-headers': 'Content-Disposition',
            },
          },
    ),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry image', exact: true })).toBeVisible();
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry image', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Saved chart', exact: true })).toBeVisible();
});

test('Library includes older agent-shared photos and documents and reuses authorized viewers', async ({
  page,
  context,
}, info) => {
  const png = await readFile('apps/web/public/icons/pebble-192.png');
  await installFixture(context);
  let catalogs = 0;
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'media.list') {
      catalogs++;
      expect(params.session_id).toBe('session-arlo');
      return route.fulfill({
        json: {
          result: {
            files: params.cursor
              ? [
                  {
                    row_id: 9,
                    reference: 'a'.repeat(64),
                    name: 'older-chart.png',
                    size: png.length,
                  },
                  { row_id: 10, reference: 'b'.repeat(64), name: 'older-plan.md', size: 100 },
                ]
              : [],
            next: params.cursor ? null : 'older-page',
          },
        },
      });
    }
    return route.fallback();
  });
  await page.route('**/v1/files/read', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation !== 'media.read') return route.fallback();
    expect(params.session_id).toBe('session-arlo');
    expect([9, 10]).toContain(params.row_id);
    return route.fulfill({
      body: params.row_id === 9 ? png : Buffer.from('# Older plan\n\n**Still available**'),
      headers: {
        'content-type': params.row_id === 9 ? 'image/png' : 'text/markdown',
        'content-disposition': `attachment; filename*=UTF-8''${params.row_id === 9 ? 'older-chart.png' : 'older-plan.md'}`,
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  await details.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(details).toContainText('older-chart.png');
  await expect(details).toContainText('older-plan.md');
  expect(catalogs).toBe(2);
  await details.getByRole('button', { name: 'View older-chart.png', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'older-chart.png', exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click();
  await page.screenshot({
    path: info.outputPath('library-agent-media.png'),
    animations: 'disabled',
  });
  await details.getByRole('button', { name: 'View older-plan.md', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Document viewer', exact: true })
      .getByRole('heading', { name: 'Older plan', exact: true }),
  ).toBeVisible();
});

test('Library bounds the initial scan of a long text-only history and continues on demand', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let catalogs = 0;
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation !== 'media.list') return route.fallback();
    catalogs++;
    await route.fulfill({ json: { result: { files: [], next: 'page-' + catalogs } } });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(catalogs).toBe(0);
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  await details.getByRole('tab', { name: 'Library', exact: true }).click();
  await expect(
    details.getByRole('progressbar', { name: 'Loading Library', exact: true }),
  ).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Load more', exact: true })).toBeVisible();
  expect(catalogs).toBe(3);
  await details.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(
    details.getByRole('progressbar', { name: 'Loading Library', exact: true }),
  ).toHaveCount(0);
  expect(catalogs).toBe(4);
  await details.getByRole('tab', { name: 'Routines', exact: true }).click();
  await page.waitForTimeout(250);
  expect(catalogs).toBe(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
