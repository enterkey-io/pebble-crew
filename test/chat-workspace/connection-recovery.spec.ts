import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { connectionFixture, openConnections } from './connections-fixture';

test.use({ serviceWorkers: 'block' });

for (const outcome of ['accepted', 'failed', 'attachment-recovery'] as const) {
  test(`a late ${outcome} receipt preserves the newer composer draft`, async ({
    page,
    context,
  }) => {
    await installFixture(context);
    await page.goto('/');
    const field = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(field).toBeEnabled();
    if (outcome === 'attachment-recovery') {
      await page.getByLabel('Choose attachments', { exact: true }).setInputFiles({
        name: 'note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('synthetic attachment'),
      });
      await expect(page.locator('.attachment-chips [data-status="ready"]')).toHaveCount(1);
    }
    let requested = false;
    let ids: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/v1/rpc', async (route) => {
      const { operation, params } = route.request().postDataJSON();
      if (operation === 'chat.send') {
        requested = true;
        ids = params.attachments ?? [];
        await held;
        if (outcome !== 'accepted')
          return route.fulfill({ status: 500, json: { code: 'REQUEST_FAILED' } });
      }
      if (operation === 'files.reconcile' && outcome === 'attachment-recovery')
        return route.fulfill({ json: { result: { state: 'accepted', ids } } });
      await route.fallback();
    });
    try {
      await field.fill('First message');
      await field.press('Enter');
      await expect.poll(() => requested).toBe(true);
      await expect(field).toBeEnabled();
      await field.fill('My next draft');
    } finally {
      release();
    }
    if (outcome === 'accepted')
      await expect(page.getByRole('button', { name: 'Add attachment', exact: true })).toBeEnabled();
    else {
      await expect(page.locator('.banner')).toContainText('Your message may not have been sent.');
      if (outcome === 'attachment-recovery') {
        await page.getByRole('button', { name: 'Check send outcome', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Check send outcome', exact: true }),
        ).toHaveCount(0);
      }
    }
    await expect(field).toHaveValue('My next draft');
  });
}

test('reconnecting keeps composer controls, typography, focus and the editable draft in place', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  const attachment = page.getByRole('button', { name: 'Add attachment', exact: true });
  const voice = page.getByRole('button', { name: 'Voice chat', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(field).toBeEnabled();
  await expect(attachment).toBeEnabled();
  await field.fill('Draft');
  const fieldNode = (await field.elementHandle())!;
  const attachmentNode = (await attachment.elementHandle())!;
  const voiceNode = (await voice.elementHandle())!;
  const measure = () =>
    field.evaluate((node) => {
      const form = node.closest('form')!;
      const style = getComputedStyle(node);
      return {
        field: node.getBoundingClientRect().toJSON(),
        form: form.getBoundingClientRect().toJSON(),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    });
  const before = await measure();
  let reconnecting = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/connect', async (route) => {
    if (route.request().method() === 'POST') {
      reconnecting = true;
      await held;
    }
    await route.fallback();
  });
  let sends = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/v1/rpc' &&
      request.postDataJSON()?.operation === 'chat.send'
    )
      sends++;
  });
  try {
    await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
    await expect.poll(() => reconnecting).toBe(true);
    await expect(attachment).toHaveCount(1);
    expect(await attachmentNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await voiceNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await fieldNode.evaluate((node) => node.isConnected)).toBe(true);
    await expect(field).toBeEnabled();
    await expect(field).toBeFocused();
    await expect(attachment).toBeDisabled();
    await expect(voice).toBeDisabled();
    await expect(send).toBeDisabled();
    await page.keyboard.type(' offline');
    await expect(field).toHaveValue('Draft offline');
    await field.press('Enter');
    expect(sends).toBe(0);
    const disconnected = await measure();
    expect(disconnected.fontSize).toBe(before.fontSize);
    expect(disconnected.lineHeight).toBe(before.lineHeight);
    expect(disconnected.field.height).toBeCloseTo(before.field.height, 0);
    expect(disconnected.form.height).toBeCloseTo(before.form.height, 0);
    expect(disconnected.field.width).toBeCloseTo(before.field.width, 0);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('composer-disconnected.png'),
    });
  } finally {
    release();
  }
  await expect(attachment).toBeEnabled();
  await expect(send).toBeEnabled();
  await expect(field).toHaveValue('Draft offline');
  expect(await fieldNode.evaluate((node) => node.isConnected)).toBe(true);
  expect(await attachmentNode.evaluate((node) => node.isConnected)).toBe(true);
  const restored = await measure();
  expect(restored.fontSize).toBe(before.fontSize);
  expect(restored.lineHeight).toBe(before.lineHeight);
  expect(restored.field.height).toBeCloseTo(before.field.height, 0);
  expect(restored.form.height).toBeCloseTo(before.form.height, 0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('composer-restored.png') });
});

test('unsaved connection tools and key survive a new transport lease', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await connectionFixture(page);
  let leases = 0;
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/v1/connect' &&
      response.request().method() === 'POST' &&
      response.ok()
    )
      leases++;
  });
  await openConnections(page);
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).click();
  await page.getByRole('button', { name: /Tool access/ }).click();
  const changedTool = page.getByRole('checkbox', { name: 'document_action_15', exact: true });
  await changedTool.check();
  await page.getByRole('button', { name: 'Add or replace API key', exact: true }).click();
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('synthetic-unsaved-key');
  const initial = leases;
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect.poll(() => leases).toBeGreaterThan(initial);
  await expect(page.locator('.connection-status')).toContainText('Hermes connected');
  await expect(changedTool).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'API key', exact: true })).toHaveValue(
    'synthetic-unsaved-key',
  );
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await expect(page.locator('.banner[role="alert"]')).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('connection-draft-restored.png'),
  });
});

test('a changed remote tool policy requires an explicit keep or discard decision', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const fixture = await connectionFixture(page);
  await openConnections(page);
  await page.locator('.connection-row').filter({ hasText: 'Archive' }).click();
  await page.getByRole('button', { name: /Tool access/ }).click();
  await page.getByRole('checkbox', { name: 'document_action_15', exact: true }).check();
  fixture.policies.set('Archive', ['document_action_1']);
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(page.getByText('Tool access changed elsewhere.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: 'document_action_15', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Keep my changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('Tool access saved. Applies when this pebble restarts.'),
  ).toBeVisible();
  expect(fixture.policies.get('Archive')).toEqual(['search_documents', 'document_action_15']);
});
