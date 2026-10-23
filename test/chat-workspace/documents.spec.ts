import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';
test.use({ serviceWorkers: 'block' });
const markdown =
  '# Release plan\n\n**Review this plan.**\n\n| Task | Status |\n| --- | --- |\n| Test | Complete |\n\n```ts\nconst answer = 42;\n```\n\n<script>window.documentCompromised=true</script>\n\n![Remote](https://tracker.invalid/pixel.png)';

test('shared documents open in a dock, preserve chat drafts and use the shared Markdown components', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: '[Project plan](/hermes/cache/generated/plan.md)\n\n[Notes](/hermes/cache/generated/notes.txt)',
      },
    ],
  });
  const remote: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('tracker.invalid')) remote.push(r.url());
  });
  let fail = false;
  await page.route('**/v1/files/read', (route) =>
    route.fulfill(
      fail
        ? { status: 400, json: { error: 'Unavailable' } }
        : {
            body: markdown,
            headers: {
              'content-type': 'application/octet-stream',
              'content-disposition': "attachment; filename*=UTF-8''plan.md",
            },
          },
    ),
  );
  await page.goto('/');
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill('Keep my draft');
  await page.getByRole('button', { name: 'View plan.md', exact: true }).click();
  const reader = page.getByRole('region', { name: 'Document viewer', exact: true });
  await expect(reader.getByRole('heading', { name: 'Release plan', exact: true })).toBeVisible();
  await expect(reader.getByRole('table')).toBeVisible();
  const dock = page.getByRole('complementary', { name: 'Document', exact: true });
  await expect
    .poll(async () => (await dock.boundingBox())!.width)
    .toBeGreaterThan(page.viewportSize()!.width < 768 ? page.viewportSize()!.width - 1 : 500);
  await expect.poll(() => dock.evaluate((node) => node.scrollLeft)).toBe(0);
  const headingBox = (await reader
    .getByRole('heading', { name: 'Release plan', exact: true })
    .boundingBox())!;
  const readerBox = (await reader.boundingBox())!;
  expect(headingBox.x).toBeGreaterThanOrEqual(readerBox.x + 12);
  expect(readerBox.x).toBeGreaterThanOrEqual(0);
  await expect(reader.locator('[data-slot="code-block"]')).toBeVisible();
  expect(remote).toEqual([]);
  expect(await page.evaluate(() => 'documentCompromised' in window)).toBe(false);
  if (page.viewportSize()!.width > 767) {
    await expect
      .poll(() =>
        dock.evaluate((panel) => {
          const chat = document
            .querySelector('[aria-label="Conversation"]')!
            .getBoundingClientRect();
          const reader = panel.getBoundingClientRect();
          return reader.left > chat.left && chat.right <= reader.left + 2;
        }),
      )
      .toBe(true);
  }
  await page.screenshot({ animations: 'disabled', path: info.outputPath('document-reader.png') });
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(composer).toHaveValue('Keep my draft');
  fail = true;
  await page.getByRole('button', { name: 'View notes.txt', exact: true }).click();
  await expect(reader.getByRole('alert')).toBeVisible();
  fail = false;
  await reader.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(reader.locator('pre').first()).toContainText('# Release plan');
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(composer).toHaveValue('Keep my draft');
});

test('agents open only current live documents and reconnect does not reopen a closed request', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeEnabled();
  const payload = {
    name: 'Review.md',
    text: '# Requested review\n\n' + 'A long plan.\n\n'.repeat(150),
    format: 'markdown',
    request_id: '12345678-1234-1234-1234-123456789abc',
    expires_at: Date.now() + 60000,
  };
  await emit(page, 'document.open', payload);
  const reader = page.getByRole('region', { name: 'Document viewer', exact: true });
  await expect(
    reader.getByRole('heading', { name: 'Requested review', exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.getByRole('complementary', { name: 'Document', exact: true }).boundingBox())!
          .width,
    )
    .toBeGreaterThan(page.viewportSize()!.width < 768 ? page.viewportSize()!.width - 1 : 500);
  await reader.locator('.pc-document-scroll').evaluate((node) => {
    node.scrollTop = 500;
  });
  await emit(page, 'document.open', {
    ...payload,
    name: 'Next.md',
    text: '# Next document\n\n' + 'New plan.\n\n'.repeat(150),
    request_id: '12345678-1234-1234-1234-123456789abe',
  });
  await expect(reader.getByRole('heading', { name: 'Next document', exact: true })).toBeVisible();
  await expect
    .poll(() => reader.locator('.pc-document-scroll').evaluate((node) => node.scrollTop))
    .toBe(0);
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(reader).toHaveCount(0);
  await emit(page, 'document.open', payload);
  await expect(reader).toHaveCount(0);
  await emit(page, 'document.open', {
    ...payload,
    request_id: '12345678-1234-1234-1234-123456789abd',
    expires_at: Date.now() - 1,
  });
  await expect(reader).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(composer).toBeEnabled({ timeout: 10000 });
  await expect(reader).toHaveCount(0);
});

test('Files opens a shared text preview and returns to the same details tab', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const id = 'a'.repeat(43);
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'files.list')
      return route.fulfill({
        json: {
          result: { files: [{ id, name: 'notes.txt', size: 19, kind: 'file', state: 'sent' }] },
        },
      });
    return route.fallback();
  });
  await page.route('**/v1/files/read', async (route) => {
    expect(route.request().postDataJSON().params.id).toBe(id);
    return route.fulfill({
      body: 'Plain owner notes.',
      headers: { 'content-type': 'application/octet-stream' },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Show details/ }).click();
  const details = page.locator('.details-panel');
  await details.getByRole('tab', { name: 'Library', exact: true }).click();
  await details.getByRole('button', { name: 'View notes.txt', exact: true }).click();
  const reader = page.getByRole('region', { name: 'Document viewer', exact: true });
  await expect(reader.locator('pre')).toHaveText('Plain owner notes.');
  await expect
    .poll(
      async () =>
        (await page.getByRole('complementary', { name: 'Document', exact: true }).boundingBox())!
          .width,
    )
    .toBeGreaterThan(page.viewportSize()!.width < 768 ? page.viewportSize()!.width - 1 : 500);
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(details.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(details.getByRole('button', { name: 'View notes.txt', exact: true })).toBeVisible();
});
