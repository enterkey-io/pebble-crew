import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installFixture, emit } from './fixtures';
import { expectPinnedLayout } from './pinned-layout';
test('populated production workspace: layout, drafts, scroll, crew authors and routine controls', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await expect(page.locator('.pinned-tile')).toHaveCount(2);
  await expectPinnedLayout(page.locator('.pinned-tile'));
  await expect(page.locator('.pebble-row')).toHaveCount(10);
  expect((await page.locator('.pc-composer').boundingBox())!.height).toBeLessThanOrEqual(56);
  await page.screenshot({ path: 'test-results/workspace-desktop.png' });
  const draft = await page.evaluate(() => {
    const css = [...document.styleSheets]
      .flatMap((s) => [...s.cssRules].map((r) => r.cssText))
      .join('\n');
    const root = document.querySelector('.workspace')!.cloneNode(true) as HTMLElement;
    const transcript = root.querySelector('.transcript')!;
    const groups = transcript.querySelectorAll('.message-group');
    for (const group of [...groups].slice(0, -6)) group.remove();
    return (
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pebble Crew conversation</title><style>' +
      css +
      '</style></head><body><div class="w-screen h-screen overflow-hidden">' +
      root.outerHTML +
      '</div></body></html>'
    );
  });
  await mkdir('.superdesign/tmp', { recursive: true });
  await writeFile('.superdesign/tmp/pebble-crew-chat.html', draft);
  await input.fill('Draft for Arlo');
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(input).toHaveValue('');
  await input.fill('Draft for Mica');
  await page.getByRole('button', { name: /^Arlo .*Bot Chat$/ }).click();
  await expect(input).toHaveValue('Draft for Arlo');
  await expect(input).toBeEnabled();
  const log = page.getByRole('log');
  await log.evaluate((n) => {
    n.scrollTop = 0;
    n.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect(await log.evaluate((n) => n.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Research crew', exact: false }).click();
  await expect(log).toContainText('I have the notes ready.');
  await expect(log.locator('[data-slot="message-header"]')).toHaveText(['Arlo', 'Mica']);
  await input.fill('Crew draft');
  await page.getByRole('button', { name: /^Arlo .*Bot Chat$/ }).click();
  await expect(input).toHaveValue('Draft for Arlo');
  await expect(input).toBeEnabled();
  await expect.poll(() => log.evaluate((n) => n.scrollTop)).toBe(0);
  await page.getByRole('button', { name: /Show details/ }).click();
  const toggle = page.getByRole('switch', { name: 'Pause Weekly research brief' });
  await toggle.click();
  await expect(page.getByRole('switch', { name: 'Resume Weekly research brief' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('.pinned-tile strong')).toHaveText(['Mica', 'Arlo']);
  fixture.setApprovals([{ request_id: 'exact-approval', command: 'Review synthetic operation' }]);
  await emit(page, 'approval.request');
  await page.setViewportSize({ width: 720, height: 450 });
  const approvalDialog = page.locator('.details-panel');
  await expect(approvalDialog).toContainText('Review synthetic operation');
  await approvalDialog.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvalDialog.locator('.approval')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1912, height: 1121 });
  await page.screenshot({ path: 'test-results/workspace-wide.png' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: /Show details/ }).click();
  await expect(page.locator('.pc-details-slot')).toHaveCSS('width', '288px');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workspace-tablet.png' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(input).toBeVisible();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'navigation' });
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: `test-results/workspace-rail-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeFocused();
    await page.screenshot({ path: `test-results/workspace-mobile-${width}.png` });
  }
});
test('live changes reconcile two browsers, protect the selected draft and never carry it to a replacement', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(second.getByLabel('Message', { exact: true })).toBeEnabled();
  const row = page.getByRole('button', { name: /^Mica .*Bot Chat$/ });
  await row.click();
  await page.getByLabel('Message', { exact: true }).fill('Private unsent draft');
  fixture.hide('mica');
  await emit(page, 'workspace.changed');
  await expect(page.getByRole('button', { name: /^Mica .*Bot Chat$/ })).toHaveCount(0);
  await expect(page.getByText('Private unsent draft', { exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: /^Mica .*Bot Chat$/ })).toHaveCount(0, {
    timeout: 6500,
  });
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('menuitem', { name: 'Show hidden pebbles', exact: true }).click();
  await page.getByLabel('Actions for Mica').click();
  await page.getByRole('menuitem', { name: 'Unhide', exact: true }).click();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Private unsent draft');
  fixture.replace('mica');
  await emit(page, 'workspace.changed');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await page.getByLabel('Actions for Rowan').click();
  await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review deletion' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await dialog.getByLabel('Confirm profile name').fill('rowan');
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(dialog).toContainText('completed');
  await expect(page.getByRole('button', { name: /^Rowan .*Bot Chat$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Review deletion' }).click();
  await second.close();
});
test('streaming, stop, IME and reconnection preserve drafts without submitting twice', async ({
  page,
  context,
}) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  let sends = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'chat.send') {
      sends++;
      await route.fulfill({ json: { result: { status: 'accepted' } } });
    } else await route.fallback();
  });
  await input.fill('Hello');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(sends).toBe(0);
  await input.press('Enter');
  await expect.poll(() => sends).toBe(1);
  await expect(input).toHaveValue('');
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: 'A live reply' });
  await expect(page.getByRole('log')).toContainText('A live reply');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
  await emit(page, 'message.complete', { status: 'interrupted' });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeAttached();
  fixture.state.bots[0]!.cursor = 29; // New native history exists before the new lease opens this chat.
  fixture.remove('quinn');
  await input.fill('Survives reconnect');
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(input).toBeEnabled({ timeout: 10000 });
  await expect(input).toHaveValue('Survives reconnect');
  expect(sends).toBe(1);
  await expect(page.getByRole('button', { name: /^Quinn .*Bot Chat$/ })).toHaveCount(0);
});
