import { test, expect } from '@playwright/test';
import { emit, installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('tooltips wait on first hover, stay warm between controls, and open on focus', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'Touch controls do not require hover.');
  await installFixture(context, {
    messages: [{ row_id: 1, role: 'assistant', text: 'A message to copy.' }],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const search = page.getByLabel('Search Pebble Crew', { exact: true });
  const point = (await search.boundingBox())!;
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.clock.runFor(200);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(page.getByRole('tooltip')).toHaveText('Search Pebble Crew');
  const copy = page.getByLabel('Copy message', { exact: true }).last();
  const next = (await copy.boundingBox())!;
  const message = (await page.locator('.pc-bubble').last().boundingBox())!;
  await page.mouse.move(message.x + 20, message.y + message.height / 2, { steps: 3 });
  await page.clock.runFor(170);
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 3 });
  await page.clock.runFor(50);
  await expect(page.getByRole('tooltip', { name: 'Copy message', exact: true })).toHaveAttribute(
    'data-state',
    'instant-open',
  );
  await page.mouse.move(700, 50);
  await page.clock.runFor(500);
  await search.focus();
  await expect(
    page.getByRole('tooltip', { name: 'Search Pebble Crew', exact: true }),
  ).toHaveAttribute('data-state', 'instant-open');
  await page.clock.resume();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip', { name: 'Search Pebble Crew', exact: true })).toBeHidden();
});

test('completion settles activity without moving the lane and stops its shimmer immediately', async ({
  page,
  context,
}) => {
  await installFixture(context, {
    messages: [{ row_id: 1, role: 'assistant', text: 'Earlier message.' }],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await emit(page, 'tool.start', { name: 'read_file' });
  await expect(page.locator('.pc-activity')).toHaveText('Reading files');
  await expect(page.locator('.pc-activity')).toHaveCSS('opacity', '1');
  const lane = (await page.locator('.pc-activity-lane').boundingBox())!;
  const frames = page.evaluate(async () => {
    const samples: { elapsed: number; opacity: number; animation: string; status: string }[] = [];
    const started = performance.now();
    while (performance.now() - started < 450) {
      const visual = document.querySelector('.pc-activity');
      const style = visual && getComputedStyle(visual);
      samples.push({
        elapsed: performance.now() - started,
        opacity: style ? Number(style.opacity) : 0,
        animation: style?.animationName ?? 'none',
        status: document.querySelector('.pc-activity-lane [role="status"]')?.textContent ?? '',
      });
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  await emit(page, 'message.complete', { status: 'done' });
  const sampled = await frames;
  const settling = sampled.filter((frame) => frame.opacity > 0 && frame.opacity < 0.95);
  expect(settling.length, JSON.stringify(sampled)).toBeGreaterThan(0);
  expect(settling.every((frame) => frame.animation === 'none' && frame.status === '')).toBe(true);
  await expect(page.locator('.pc-activity')).toHaveCount(0);
  const after = (await page.locator('.pc-activity-lane').boundingBox())!;
  expect(after.height).toBe(lane.height);
  expect(after.y).toBeCloseTo(lane.y, 0);
  await page.screenshot({ path: test.info().outputPath('activity-settled.png') });
});

test('the composer action changes meaning immediately and crossfades only its glyphs', async ({
  page,
  context,
}) => {
  await installFixture(context, { messages: [] });
  await page.goto('/');
  await page.getByLabel('Message', { exact: true }).fill('A draft to preserve');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(send).toBeEnabled();
  await send.focus();
  const button = (await send.elementHandle())!;
  const before = (await send.boundingBox())!;
  const frames = page.evaluate(async () => {
    const opacity: number[] = [];
    const started = performance.now();
    while (performance.now() - started < 350) {
      const glyph = document.querySelector('.pc-composer-row [data-glyph="stop"]');
      if (glyph) opacity.push(Number(getComputedStyle(glyph).opacity));
      await new Promise(requestAnimationFrame);
    }
    return opacity;
  });
  await emit(page, 'message.start');
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeEnabled();
  expect(await button.evaluate((node) => node === document.activeElement)).toBe(true);
  expect(await stop.evaluate((node, original) => node === original, button)).toBe(true);
  const after = (await stop.boundingBox())!;
  expect(after).toEqual(before);
  expect((await frames).filter((opacity) => opacity > 0 && opacity < 0.95).length).toBeGreaterThan(
    1,
  );
  let releaseStop!: () => void;
  const held = new Promise<void>((resolve) => (releaseStop = resolve));
  let calls = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.stop') return route.fallback();
    calls++;
    await held;
    await route.fulfill({ json: { result: {} } });
  });
  await stop.click();
  await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
  await expect(page.locator('.pc-activity')).toHaveText('Stopping');
  expect(await button.textContent()).toBe('');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('A draft to preserve');
  expect(calls).toBe(1);
  releaseStop();
});

test('switching conversations cannot display the former chat activity during file recovery', async ({
  page,
  context,
  isMobile,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await emit(page, 'tool.start', { name: 'terminal' });
  await expect(page.locator('.pc-activity')).toHaveText('Running a command');
  let releaseFiles!: () => void;
  const held = new Promise<void>((resolve) => (releaseFiles = resolve));
  let recovering = false;
  await page.route('**/v1/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation !== 'files.reconcile' || request.params.session_id !== 'session-mica')
      return route.fallback();
    recovering = true;
    await held;
    await route.fulfill({ json: { result: { state: 'clear' } } });
  });
  if (isMobile) await page.getByLabel('Toggle navigation', { exact: true }).click();
  await page.getByRole('button', { name: /Mica .* Bot Chat/ }).click();
  await expect.poll(() => recovering).toBe(true);
  expect(await page.locator('.pc-activity').count()).toBe(0);
  releaseFiles();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('reduced motion removes activity immediately and new runs never revive old work labels', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installFixture(context, { messages: [] });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await emit(page, 'tool.start', { name: 'web_search' });
  await expect(page.locator('.pc-activity')).toHaveText('Searching the web');
  await expect(page.locator('.pc-activity')).toHaveCSS('animation-name', 'none');
  await emit(page, 'message.complete', { status: 'done' });
  await expect(page.locator('.pc-activity')).toHaveCount(0);
  await emit(page, 'message.start');
  await emit(page, 'tool.start', { name: 'write_file' });
  await expect(page.locator('.pc-activity')).toHaveText('Updating files');
  await page.waitForTimeout(200);
  await expect(page.locator('.pc-activity')).toHaveText('Updating files');
});

test('a held send gesture cannot turn into a stop request when a run starts', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'Held pointer and keyboard gesture coverage is desktop-specific.');
  await installFixture(context, { messages: [] });
  let stops = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'chat.stop') stops++;
    await route.fallback();
  });
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await input.fill('Preserve this draft');
  for (const gesture of ['pointer', 'Space']) {
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(send).toBeEnabled();
    await send.focus();
    if (gesture === 'pointer') {
      const bounds = (await send.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
    } else await page.keyboard.down(gesture);
    await emit(page, 'message.start');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    if (gesture === 'pointer') await page.mouse.up();
    else await page.keyboard.up(gesture);
    await page.waitForTimeout(100);
    expect(stops).toBe(0);
    await expect(input).toHaveValue('Preserve this draft');
    await emit(page, 'message.complete', { status: 'done' });
  }
});

test('a new run interrupts settlement and a failed stop restores its actual activity', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await emit(page, 'tool.start', { name: 'read_file' });
  await expect(page.locator('.pc-activity')).toHaveCSS('opacity', '1');
  await emit(page, 'message.complete', { status: 'done' });
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  await emit(page, 'message.start');
  await emit(page, 'tool.start', { name: 'terminal' });
  await expect(page.locator('.pc-activity')).toHaveText('Running a command');
  await page.waitForTimeout(200);
  await expect(page.locator('.pc-activity')).toHaveText('Running a command');
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.stop') return route.fallback();
    await route.fulfill({ status: 500, json: { code: 'REQUEST_FAILED' } });
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await expect(page.locator('.pc-activity')).toHaveText('Running a command');
});

test('holding Enter after sending cannot repeatedly activate the new Stop action', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop keyboard repeat coverage.');
  await installFixture(context);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let stops = 0;
  await page.route('**/v1/rpc', async (route) => {
    const operation = route.request().postDataJSON().operation;
    if (operation === 'chat.send') await held;
    if (operation === 'chat.stop') stops++;
    await route.fallback();
  });
  try {
    await page.goto('/');
    await page.getByLabel('Message', { exact: true }).fill('A single message');
    await page.getByRole('button', { name: 'Send message', exact: true }).focus();
    await page.keyboard.down('Enter');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await page.waitForTimeout(100);
    expect(stops).toBe(0);
  } finally {
    release();
  }
});

test('enabling reduced motion during a run removes its exit fade', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await expect(page.locator('.pc-activity')).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.pc-activity')).toHaveCSS('animation-name', 'none');
  const frames = page.evaluate(async () => {
    const samples: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 250) {
      const visual = document.querySelector('.pc-activity');
      samples.push(visual ? Number(getComputedStyle(visual).opacity) : 0);
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  await emit(page, 'message.complete', { status: 'done' });
  expect((await frames).every((opacity) => opacity === 0 || opacity === 1)).toBe(true);
  await expect(page.locator('.pc-activity')).toHaveCount(0);
});
