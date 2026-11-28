import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

async function expectOnPhotoEdge(pin: Locator, badge: Locator, side = 1) {
  const photo = pin.locator('.agent-avatar > img');
  await expect(photo).toBeVisible();
  const { x, y, radius } = await badge.evaluate((element) => {
    const circle = element.parentElement!.querySelector('img')!.getBoundingClientRect();
    const indicator = element.getBoundingClientRect();
    return {
      x: indicator.x + indicator.width / 2 - circle.x - circle.width / 2,
      y: indicator.y + indicator.height / 2 - circle.y - circle.height / 2,
      radius: circle.width / 2,
    };
  });
  expect(x * side).toBeGreaterThan(0);
  expect(Math.hypot(x, y)).toBeCloseTo(radius, 0);
  expect(y).toBeCloseTo(Math.abs(x), 0);
  return { x, y };
}

for (const theme of ['dark', 'light']) {
  test(`unread indicators occupy every avatar and replace the pinned Main badge in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    const mica = fixture.state.bots.find((b) => b.profile === 'mica')!;
    mica.unread = true;
    mica.appearance.kind = 'photo';
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const paint = canvas.getContext('2d')!;
      paint.fillStyle = '#4d726e';
      paint.fillRect(0, 0, 64, 64);
      return canvas.toDataURL();
    });
    await page.route('**/v1/rpc', async (route) => {
      const { operation, params } = route.request().postDataJSON();
      if (operation === 'bots.appearance.get' && params.profile === 'mica')
        await route.fulfill({ json: { result: { data: photo } } });
      else await route.fallback();
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    fixture.state.orchestrator = 'mica';
    fixture.state.bots.find((b) => b.profile === 'mica')!.manager = null;
    fixture.state.bots.find((b) => b.profile === 'arlo')!.manager = 'mica';
    await emit(page, 'workspace.changed');
    async function navigation() {
      if (info.project.use.isMobile) {
        await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
        await expect(page.getByRole('region', { name: 'navigation', exact: true })).toHaveCSS(
          'transform',
          'matrix(1, 0, 0, 1, 0, 0)',
        );
      }
    }
    await navigation();
    const pin = page
      .locator('.pinned-tile')
      .filter({ has: page.getByRole('button', { name: /^Mica .*Bot Chat$/ }) });
    const dot = pin.getByRole('img', { name: 'Unread messages', exact: true });
    await expect(dot).toBeVisible();
    await expect(pin.getByRole('img', { name: 'Main Pebble', exact: true })).toHaveCount(0);
    await expectOnPhotoEdge(pin, dot);
    await expect(dot).toHaveCSS('background-color', 'rgb(59, 130, 246)');
    await expect(dot).toHaveCSS('animation-name', 'unread-pulse');
    const row = page
      .locator('.pebble-row')
      .filter({ has: page.getByRole('button', { name: /^Ember .*Bot Chat$/ }) });
    const rowDot = row.getByRole('img', { name: 'Unread messages', exact: true });
    await expect(rowDot).toBeVisible();
    await expect(row.locator('.agent-avatar [data-avatar-badge="unread"]')).toHaveCount(1);
    await expect(row.locator(':scope > .status-dot')).toHaveCount(0);
    await expect(row.locator('.pc-overflow')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`unread-${theme}.png`), animations: 'disabled' });
    await pin.screenshot({
      path: info.outputPath(`photo-dot-${theme}.png`),
      animations: 'disabled',
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(dot).toHaveCSS('animation-name', 'none');
    await expect(dot).toHaveCSS('opacity', '1');
    await pin.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
    await expect
      .poll(() => fixture.state.bots.find((b) => b.profile === 'mica')!.unread)
      .toBe(false);
    if (info.project.use.isMobile)
      await expect(page.locator('.pc-mobile-conversation')).toHaveCSS('transform', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await emit(page, 'message.start', {}, 'mica');
    const identity = page.locator('.pc-chat-identity');
    const activity = identity.getByRole('img', { name: 'Active', exact: true });
    const headerStar = identity.getByRole('img', { name: 'Main Pebble', exact: true });
    await expect(activity).toBeVisible();
    const activeOffset = await expectOnPhotoEdge(identity, activity);
    await expect(headerStar).toHaveCount(0);
    await expect(identity.locator('[data-avatar-badge]')).toHaveCount(1);
    await expect(page.locator('.agent-avatar .photo-status')).toHaveCount(0);
    await expect(activity).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(149, 186, 165)' : 'rgb(50, 108, 74)',
    );
    await expect(activity).toHaveCSS('animation-name', 'unread-pulse');
    const activeBounds = (await activity.boundingBox())!;
    await identity.screenshot({
      path: info.outputPath(`photo-activity-${theme}.png`),
      animations: 'disabled',
    });
    await navigation();
    const pinnedWorking = pin.getByRole('img', { name: 'Active', exact: true });
    await expect(pinnedWorking).toBeVisible();
    await expect(pin.locator('[data-avatar-badge]')).toHaveCount(1);
    await expectOnPhotoEdge(pin, pinnedWorking);
    const pinnedActiveSize = (await pinnedWorking.boundingBox())!.width;
    await pin.screenshot({
      path: info.outputPath(`photo-pin-working-${theme}.png`),
      animations: 'disabled',
    });
    if (info.project.use.isMobile) {
      await page.goBack();
      await expect(identity).toBeVisible();
    }
    await identity.click();
    const detailsAvatar = page.locator('.pc-details-identity');
    const detailsWorking = detailsAvatar.getByRole('img', { name: 'Active', exact: true });
    await expect(detailsWorking).toBeVisible();
    await expect(detailsAvatar.locator('[data-avatar-badge]')).toHaveCount(1);
    await expectOnPhotoEdge(detailsAvatar, detailsWorking);
    await detailsAvatar.screenshot({
      path: info.outputPath(`photo-details-working-${theme}.png`),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await expect(identity).toBeVisible();
    await emit(page, 'message.complete', { status: 'done' }, 'mica');
    await expect(activity).toHaveCount(0);
    const idleOffset = await expectOnPhotoEdge(identity, headerStar);
    await expect(identity.locator('[data-avatar-badge]')).toHaveCount(1);
    const idleBounds = (await headerStar.boundingBox())!;
    expect(idleBounds.width).toBe(activeBounds.width);
    expect(idleOffset.x).toBeCloseTo(activeOffset.x, 0);
    expect(idleOffset.y).toBeCloseTo(activeOffset.y, 0);
    await identity.screenshot({
      path: info.outputPath(`photo-header-idle-${theme}.png`),
      animations: 'disabled',
    });
    await navigation();
    await expect(pin.getByRole('img', { name: 'Unread messages', exact: true })).toHaveCount(0, {
      timeout: 1500,
    });
    const star = pin.getByRole('img', { name: 'Main Pebble', exact: true });
    await expect(star).toBeVisible();
    expect((await star.boundingBox())!.width).toBe(pinnedActiveSize);
    await expectOnPhotoEdge(pin, star);
    await pin.screenshot({
      path: info.outputPath(`photo-star-${theme}.png`),
      animations: 'disabled',
    });
    await row.getByRole('button', { name: /^Ember .*Bot Chat$/ }).click();
    await expect
      .poll(() => fixture.state.bots.find((b) => b.profile === 'ember')!.unread)
      .toBe(false);
    await navigation();
    await expect(rowDot).toHaveCount(0, { timeout: 1500 });
    fixture.state.bots.find((b) => b.profile === 'mica')!.unread = true;
    await emit(page, 'workspace.changed');
    await expect(dot).toBeVisible();
  });
}

test('open conversation uses one avatar badge while roster unread changes during a reply', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  const arlo = fixture.state.bots.find((bot) => bot.profile === 'arlo')!;
  const header = page.locator('.pc-chat-identity');
  const pin = page.locator('.pc-pin').filter({
    has: page.getByRole('button', { name: /^Arlo .*Bot Chat$/ }),
  });
  await emit(page, 'message.start', {}, 'arlo');
  await expect(header.getByRole('img', { name: 'Active', exact: true })).toBeVisible();
  arlo.unread = true;
  arlo.cursor = 9000;
  arlo.cursor_type = 'row';
  arlo.role.title = 'Working team lead';
  await emit(page, 'workspace.changed', {}, 'arlo');
  await expect(header).toContainText('Working team lead');
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await expect(pin.getByRole('img', { name: 'Active', exact: true })).toBeVisible();
  await expect(pin.getByRole('img', { name: 'Unread messages', exact: true })).toHaveCount(0);
  await pin.screenshot({
    path: info.outputPath('shared-avatar-active.png'),
    animations: 'disabled',
  });
  if (info.project.use.isMobile) await page.goBack();
  await emit(page, 'message.complete', { status: 'done' }, 'arlo');
  await expect(header.getByRole('img', { name: 'Unread messages', exact: true })).toBeVisible();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await expect(pin.getByRole('img', { name: 'Unread messages', exact: true })).toBeVisible();
});
