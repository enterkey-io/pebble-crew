import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block', reducedMotion: 'no-preference' });
type Frame = { top: number; target: number; opacity: number; time: number };
async function recordFrames(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.pc-transcript')!;
    const samples: Frame[] = [];
    const start = performance.now();
    Object.assign(window, { __messageFrames: samples, __messageFramesDone: false });
    const sample = (now: number) => {
      const rows = pane.querySelectorAll<HTMLElement>('.pc-message');
      const last = rows.item(rows.length - 1);
      samples.push({
        top: pane.scrollTop,
        target: pane.scrollHeight - pane.clientHeight,
        opacity: last ? Number(getComputedStyle(last).opacity) : 1,
        time: now - start,
      });
      if (now - start < 550) requestAnimationFrame(sample);
      else Object.assign(window, { __messageFramesDone: true });
    };
    requestAnimationFrame(sample);
  });
}
async function readFrames(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __messageFramesDone: boolean }).__messageFramesDone,
      ),
    )
    .toBe(true);
  return page.evaluate(() => (window as unknown as { __messageFrames: Frame[] }).__messageFrames);
}

test('new user messages and first reply text move the viewport through intermediate positions', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await input.fill('A longer new message that should enter gently. '.repeat(8));
  await recordFrames(page);
  await input.press('Enter');
  const user = await readFrames(page);
  expect(new Set(user.map((frame) => Math.round(frame.top))).size).toBeGreaterThan(3);
  await expect(page.locator('.pc-message.user').last()).toContainText('A longer new message');
  await emit(page, 'message.start');
  await recordFrames(page);
  await emit(page, 'message.delta', {
    text: 'The reply begins with enough text to create several lines and reveal the movement. '.repeat(
      5,
    ),
  });
  const agent = await readFrames(page);
  expect(new Set(agent.map((frame) => Math.round(frame.top))).size).toBeGreaterThan(3);
  expect(agent.some((frame) => frame.opacity < 0.95)).toBe(true);
  await info.attach('message-motion-frames', {
    body: JSON.stringify({ user, agent }),
    contentType: 'application/json',
  });
  await expect
    .poll(() =>
      page
        .getByRole('log')
        .evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
    )
    .toBeLessThan(2);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('message-motion-settled.png'),
  });
});

test('stream growth leaves a reader who scrolled up in control', async ({ page, context }) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: 'Starting reply. ' });
  const pane = page.getByRole('log');
  await pane.evaluate((node) => {
    node.scrollTop = 100;
    node.dispatchEvent(new Event('scroll'));
  });
  await emit(page, 'message.delta', {
    text: 'More text arrives while the reader is above. '.repeat(20),
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await pane.evaluate((node) => node.scrollTop)).toBeCloseTo(100, 0);
});

test('reduced motion settles at the latest message without an entrance', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('A reduced motion message. '.repeat(10));
  await input.press('Enter');
  await expect(page.locator('.pc-message.user').last()).toHaveCSS('opacity', '1');
  const distance = await page
    .getByRole('log')
    .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  expect(Math.abs(distance)).toBeLessThan(2);
});
