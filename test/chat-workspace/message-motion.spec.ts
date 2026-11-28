import { submitMessage } from '../composer';
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
      const rows = pane.querySelectorAll<HTMLElement>('[data-message-id]');
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
async function setVisibility(page: import('@playwright/test').Page, state: 'hidden' | 'visible') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
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
  await submitMessage(page);
  const user = await readFrames(page);
  expect(new Set(user.map((frame) => Math.round(frame.top))).size).toBeGreaterThan(3);
  await expect(page.locator('[data-message-role="user"]').last()).toContainText(
    'A longer new message',
  );
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
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
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
  await submitMessage(page);
  await expect(page.locator('[data-message-role="user"]').last()).toHaveCSS('opacity', '1');
  const distance = await page
    .getByRole('log')
    .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  expect(Math.abs(distance)).toBeLessThan(2);
});

test('returning to a settled conversation does not replay its scroll; scrolled-up readers stay put', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const pane = page.getByRole('log');
  await expect
    .poll(() =>
      pane.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
    )
    .toBeLessThan(2);
  const away = await context.newPage();
  for (const scrolledUp of [false, true]) {
    await page.bringToFront();
    if (scrolledUp)
      await pane.evaluate((node) => {
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
        node.scrollTop = 100;
        node.dispatchEvent(new Event('scroll'));
      });
    const before = await pane.evaluate((node) => node.scrollTop);
    await away.bringToFront();
    await setVisibility(page, 'hidden');
    await page.waitForTimeout(300);
    await recordFrames(page);
    await page.bringToFront();
    await setVisibility(page, 'visible');
    const frames = await readFrames(page);
    expect(Math.max(...frames.map((frame) => Math.abs(frame.top - before)))).toBeLessThan(2);
    await info.attach(scrolledUp ? 'resume-scrolled-up-frames' : 'resume-latest-frames', {
      body: JSON.stringify(frames),
      contentType: 'application/json',
    });
  }
  await away.close();
  await page.screenshot({
    path: info.outputPath('resume-scroll-settled.png'),
    animations: 'disabled',
  });
});

test('background layout scrolling cannot turn off latest-follow or replace a saved reading position', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const pane = page.getByRole('log');
  await expect
    .poll(() =>
      pane.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
    )
    .toBeLessThan(2);
  for (const reading of [false, true]) {
    if (reading)
      await pane.evaluate((node) => {
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
        node.scrollTop = 100;
        node.dispatchEvent(new Event('scroll'));
      });
    const before = await pane.evaluate((node) => node.scrollTop);
    await setVisibility(page, 'hidden');
    await pane.evaluate((node) => {
      node.scrollTop = Math.max(0, node.scrollTop / 2);
      node.dispatchEvent(new Event('scroll'));
    });
    await setVisibility(page, 'visible');
    await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeCloseTo(before, 0);
  }
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('background-scroll-restoration.png'),
  });
});

test('layout growth at the last auto-follow position keeps the next reply in view', async ({
  page,
  context,
}, info) => {
  const messages = Array.from({ length: 32 }, (_, i) => ({
    row_id: i + 1,
    role: i % 2 ? 'assistant' : 'user',
    text: 'Conversation history before the next agent reply. '.repeat(5),
    timestamp: 1700100000 + i * 60,
  }));
  await installFixture(context, { messages });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const pane = page.getByRole('log');
  const gap = () => pane.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  await expect.poll(gap).toBeLessThan(2);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const layoutGap = await pane.evaluate((node) => {
    node.style.paddingBottom = '200px';
    node.dispatchEvent(new Event('scroll'));
    return node.scrollHeight - node.clientHeight - node.scrollTop;
  });
  expect(layoutGap).toBeGreaterThan(96);

  const reply = 'This new reply should come into view without another scroll. '.repeat(12).trim();
  await emit(page, 'message.start');
  await emit(page, 'message.delta', { text: reply });
  await expect(pane.getByText(reply, { exact: true })).toBeVisible();
  await expect.poll(gap).toBeLessThan(2);
  await expect(page.getByRole('button', { name: /Latest messages/ })).toHaveCount(0);

  messages.push({ row_id: 33, role: 'assistant', text: reply, timestamp: 1700102000 });
  await emit(page, 'message.complete', { persisted_turn: { final_assistant_row_id: 33 } });
  await expect(pane.locator('[data-message-id="33"]')).toContainText(reply);
  await expect.poll(gap).toBeLessThan(2);
  await page.screenshot({
    path: info.outputPath('follow-after-layout-growth.png'),
    animations: 'disabled',
  });
});

test('a layout-driven change to the scroll offset keeps replies following', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  const pane = page.getByRole('log');
  const gap = () => pane.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  await expect.poll(gap).toBeLessThan(2);
  await pane.evaluate((node) => {
    node.style.paddingBottom = '120px';
    node.scrollTop -= 160;
    node.dispatchEvent(new Event('scroll'));
  });
  await emit(page, 'message.start');
  await emit(page, 'message.delta', {
    text: 'The next reply follows after the viewport moves. '.repeat(12).trim(),
  });
  await expect(pane.getByText(/The next reply follows/)).toBeVisible();
  await expect.poll(gap).toBeLessThan(2);
  await expect(page.getByRole('button', { name: /Latest messages/ })).toHaveCount(0);
  await pane.evaluate((node) => (node.style.paddingBottom = ''));
  await expect.poll(gap).toBeLessThan(2);
  await page.screenshot({
    path: info.outputPath('follow-after-layout-displacement.png'),
    animations: 'disabled',
  });

  await pane.evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
    node.scrollTop -= 200;
    node.dispatchEvent(new Event('scroll'));
  });
  const readerTop = await pane.evaluate((node) => node.scrollTop);
  await expect(page.getByRole('button', { name: /Latest messages/ })).toBeVisible();
  await emit(page, 'message.delta', { text: ' More text while the reader is above. '.repeat(20) });
  await expect(pane.getByText(/More text while the reader is above/)).toBeVisible();
  await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeCloseTo(readerTop, 0);
  await page.getByRole('button', { name: /Latest messages/ }).click();
  await expect.poll(gap).toBeLessThan(2);
});

test('a reply that arrives while the window is visible but not focused comes into view', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  const pane = page.getByRole('log');
  const gap = () => pane.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  await input.fill('Write a few paragraphs while I look at another window.');
  await submitMessage(page);
  await expect.poll(gap).toBeLessThan(2);
  // The owner clicks into another app beside this window; the page stays visible.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await emit(page, 'message.start');
  for (let paragraph = 1; paragraph <= 8; paragraph++) {
    await emit(page, 'message.delta', {
      text:
        `Paragraph ${paragraph} of the reply arrives while another window has focus. `.repeat(3) +
        '\n\n',
    });
    await page.waitForTimeout(60);
  }
  await expect(pane.getByText(/Paragraph 8 of the reply/)).toBeInViewport();
  await expect.poll(gap).toBeLessThan(2);
  await expect(page.getByRole('button', { name: /Latest messages/ })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('unfocused-reply-in-view.png'),
    animations: 'disabled',
  });
});
