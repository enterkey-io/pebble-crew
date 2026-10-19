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
    const chatBox = await page
      .getByRole('region', { name: 'Conversation', exact: true })
      .boundingBox();
    const dock = await page
      .getByRole('complementary', { name: 'Document', exact: true })
      .boundingBox();
    expect(dock!.x).toBeGreaterThan(chatBox!.x);
    expect(chatBox!.x + chatBox!.width).toBeLessThanOrEqual(dock!.x + 2);
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
    text: '# Requested review\n\nHere is the plan.',
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
