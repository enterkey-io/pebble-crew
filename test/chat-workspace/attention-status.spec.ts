import { test, expect } from '@playwright/test';
import { emit, installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light']) {
  test(`pending approval is gold on every avatar and clears after completion in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    const request = {
      id: 'approval-gold',
      actor: 'arlo',
      action: 'agent.update',
      state: 'pending',
      fingerprint: 'gold-request',
      spec: { profile: 'mica' },
      created: 1700000002,
    };
    fixture.setRequests([request]);
    await page.addInitScript(
      (value) => localStorage.setItem('pebble-crew.appearance', value),
      theme,
    );
    await page.goto('/');
    await expect(page.locator('.pc-chat-identity [data-status="attention"]')).toBeVisible();
    const gold = theme === 'dark' ? 'rgb(215, 171, 76)' : 'rgb(155, 107, 17)';
    const header = page.locator('.pc-chat-identity');
    await expect(header.locator('[data-avatar-badge]')).toHaveCount(1);
    await expect(header.locator('[data-status="attention"]')).toHaveCSS('background-color', gold);
    await expect(header.locator('.avatar-decoration').first()).toHaveCSS('display', 'none');
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    const pin = page
      .locator('.pc-pin')
      .filter({ has: page.getByRole('button', { name: /^Arlo .*Bot Chat$/ }) });
    await expect(pin.locator('[data-status="attention"]')).toBeVisible();
    await expect(pin.locator('[data-avatar-badge]')).toHaveCount(1);
    await pin.screenshot({
      path: info.outputPath(`gold-pin-${theme}.png`),
      animations: 'disabled',
    });
    if (info.project.use.isMobile) await page.goBack();
    await header.click();
    await expect(page.locator('.pc-details-identity [data-status="attention"]')).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`gold-details-${theme}.png`),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await emit(page, 'message.start', {}, 'arlo');
    await expect(header.locator('[data-status="attention"]')).toBeVisible();
    fixture.setRequests([{ ...request, state: 'completed' }]);
    await emit(page, 'requests.changed');
    await expect(header.locator('[data-status="active"]')).toBeVisible({ timeout: 10000 });
    await expect(header.locator('[data-avatar-badge]')).toHaveCount(1);
    await emit(page, 'message.complete', { status: 'done' }, 'arlo');
    await expect(header.getByRole('img', { name: 'Main Pebble', exact: true })).toBeVisible();
    await expect(header.locator('.status-dot')).toHaveCount(0);
  });

  test(`gold sidebar alert reveals an offscreen approval in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    fixture.setRequests([
      {
        id: 'offscreen-approval',
        actor: 'wren',
        action: 'agent.update',
        state: 'pending',
        fingerprint: 'waiting-wren',
        spec: { profile: 'wren' },
      },
    ]);
    await page.addInitScript(
      (value) => localStorage.setItem('pebble-crew.appearance', value),
      theme,
    );
    if (!info.project.use.isMobile) await page.setViewportSize({ width: 1440, height: 600 });
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    const alert = page.getByRole('button', { name: 'Needs attention below', exact: true });
    await expect(alert).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`gold-alert-${theme}.png`),
      animations: 'disabled',
    });
    await alert.click();
    const row = page.locator('[data-placement-id="row-identity-11"]');
    await expect(row.locator('.agent-avatar [data-status="attention"]')).toBeInViewport();
    await expect(row.locator(':scope > .status-dot')).toHaveCount(0);
    await expect(alert).toHaveCount(0);
  });
}
