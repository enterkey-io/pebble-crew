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

test('Library opens text and diagram previews and returns to the same details tab', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const id = 'a'.repeat(43);
  const diagramId = 'b'.repeat(43);
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'files.list')
      return route.fulfill({
        json: {
          result: {
            files: [
              { id, name: 'notes.txt', size: 19, kind: 'file', state: 'sent' },
              { id: diagramId, name: 'workflow.mmd', size: 50, kind: 'file', state: 'sent' },
            ],
          },
        },
      });
    return route.fallback();
  });
  await page.route('**/v1/files/read', async (route) => {
    const requested = route.request().postDataJSON().params.id;
    expect([id, diagramId]).toContain(requested);
    return route.fulfill({
      body: requested === diagramId ? 'flowchart LR\n Start --> Finish' : 'Plain owner notes.',
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
  await details.getByRole('button', { name: 'View workflow.mmd', exact: true }).click();
  await expect(reader.getByRole('img', { name: 'Mermaid diagram' })).toBeVisible();
  await expect
    .poll(() =>
      reader
        .getByRole('img')
        .evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0)),
    )
    .toBeGreaterThan(0);
  await reader.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(details.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('renders Mermaid and Pele fences and keeps source available for invalid diagrams', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  const remote: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('tracker.invalid')) remote.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const request = {
    request_id: '12345678-1234-1234-1234-123456789ac1',
    expires_at: Date.now() + 60_000,
  };
  await emit(page, 'document.open', {
    ...request,
    name: 'Workflow.md',
    format: 'markdown',
    text: [
      '# Workflow',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Draft] --> B[Review] --> C[Publish]',
      '  click A "https://tracker.invalid/visit"',
      '```',
      '',
      '```pele',
      'sequenceDiagram',
      '  Author->>Reviewer: Send plan',
      '  Reviewer-->>Author: Approved',
      '```',
    ].join('\n'),
  });
  const reader = page.getByRole('region', { name: 'Document viewer', exact: true });
  await expect(reader.getByRole('heading', { name: 'Workflow', exact: true })).toBeVisible();
  const diagrams = reader.getByRole('img', { name: 'Mermaid diagram' });
  await expect(diagrams).toHaveCount(2);
  await expect
    .poll(() =>
      diagrams.evaluateAll((images) =>
        images.every((img) => img instanceof HTMLImageElement && img.naturalWidth > 0),
      ),
    )
    .toBe(true);
  expect(remote).toEqual([]);
  await expect
    .poll(() =>
      reader.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return box.left >= -1 && box.right <= window.innerWidth + 1;
      }),
    )
    .toBe(true);
  await expect(reader.getByRole('button', { name: 'Close document' })).toBeInViewport();
  if (page.viewportSize()!.width < 768) {
    await expect(page.getByRole('separator', { name: 'Resize document viewer' })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: 'Expand document' })).toHaveCount(0);
  }
  await page.screenshot({ animations: 'disabled', path: info.outputPath('diagram-viewer.png') });
  await emit(page, 'document.open', {
    ...request,
    request_id: '12345678-1234-1234-1234-123456789ac2',
    name: 'Broken.mermaid',
    format: 'mermaid',
    text: 'This is invalid diagram syntax.',
  });
  await expect(reader.getByRole('alert')).toContainText('couldn’t be rendered');
  await expect(reader.locator('pre')).toHaveText('This is invalid diagram syntax.');
  await expect(reader.getByRole('button', { name: 'Download Broken.mermaid' })).toBeVisible();
});

test('document divider resizes the viewer and remembers its width', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.use.isMobile === true, 'Phones use a full-width viewer.');
  await page.setViewportSize({ width: 1520, height: 900 });
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();

  async function openDocument(requestId: string) {
    await emit(page, 'document.open', {
      name: 'Flow.mmd',
      format: 'mermaid',
      text: 'flowchart LR\n  Draft --> Review --> Publish',
      request_id: requestId,
      expires_at: Date.now() + 60_000,
    });
    await expect(page.getByRole('img', { name: 'Mermaid diagram' })).toBeVisible();
  }

  const dock = page.getByRole('complementary', { name: 'Document', exact: true });
  const handle = dock.getByRole('separator', { name: 'Resize document viewer' });
  const diagram = dock.getByRole('img', { name: 'Mermaid diagram' });
  await openDocument('12345678-1234-1234-1234-123456789ad1');
  await expect(dock).toHaveCSS('width', '560px');
  const previousSource = await diagram.getAttribute('src');
  const edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + 2, edge.y + 160);
  await page.mouse.down();
  await page.mouse.move(edge.x - 160, edge.y + 160, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await dock.boundingBox())!.width).toBeGreaterThan(710);
  await expect(diagram).not.toHaveAttribute('src', previousSource!);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await dock.boundingBox())!.width).toBeLessThan(710);
  const chosenWidth = Math.round((await dock.boundingBox())!.width);
  const chat = page.getByRole('region', { name: 'Conversation', exact: true });
  expect((await chat.boundingBox())!.width).toBeGreaterThanOrEqual(360);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('document-viewer-resized.png'),
  });

  await dock.getByText('Diagram source', { exact: true }).click();
  await dock.getByRole('button', { name: 'Expand document', exact: true }).click();
  const fullPage = page.getByRole('dialog', { name: 'Document', exact: true });
  await expect(fullPage).toBeVisible();
  expect(await fullPage.boundingBox()).toEqual({ x: 0, y: 0, width: 1520, height: 900 });
  await expect(fullPage.getByText('Flow.mmd', { exact: true })).toBeVisible();
  await expect(fullPage.locator('details')).toHaveAttribute('open', '');
  await expect(chat).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize document viewer' })).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('document-viewer-full-page.png'),
  });
  await fullPage.getByRole('button', { name: 'Return to sidebar', exact: true }).click();
  await expect(dock).toHaveCSS('width', `${chosenWidth}px`);
  await expect(dock.locator('details')).toHaveAttribute('open', '');
  await expect(chat).toBeVisible();
  await dock.getByRole('button', { name: 'Expand document', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dock).toHaveCSS('width', `${chosenWidth}px`);
  await expect(fullPage).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openDocument('12345678-1234-1234-1234-123456789ad2');
  await expect(dock).toHaveCSS('width', `${chosenWidth}px`);
  await handle.dblclick();
  await expect(dock).toHaveCSS('width', '560px');
});
