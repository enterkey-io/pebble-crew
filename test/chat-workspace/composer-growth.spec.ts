import { submitMessage } from '../composer';
import { expect, test } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block', reducedMotion: 'no-preference' });

type Frame = { gap: number; fromBottom: number; field: number };

test('typing more lines moves the whole conversation up with the composer in the same frame', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await input.fill(
    'A message long enough to fill the conversation above the composer. '.repeat(14),
  );
  await submitMessage(page);
  const log = page.getByRole('log');
  await expect
    .poll(() =>
      log.evaluate((node) => ({
        overflow: node.scrollHeight > node.clientHeight + 40,
        bottom: Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2,
      })),
    )
    .toEqual({ overflow: true, bottom: true });
  await page.waitForTimeout(400);
  await input.click();

  await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.pc-transcript')!;
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
    const composer = field.closest<HTMLElement>('.pc-composer')!;
    const frames: Frame[] = [];
    Object.assign(window, { __growth: frames, __growthDone: false });
    const measure = (): Frame => {
      const rows = pane.querySelectorAll<HTMLElement>('[data-message-id]');
      const last = rows.item(rows.length - 1);
      return {
        gap: composer.getBoundingClientRect().top - last.getBoundingClientRect().bottom,
        fromBottom: pane.scrollHeight - pane.clientHeight - pane.scrollTop,
        field: field.getBoundingClientRect().height,
      };
    };
    // Each frame's sample is replaced by the state after the app's own resize
    // handling, which runs after animation frames and before paint.
    new ResizeObserver(() => {
      if (frames.length) frames[frames.length - 1] = measure();
    }).observe(pane);
    const sample = () => {
      frames.push(measure());
      if (!(window as unknown as { __growthDone: boolean }).__growthDone)
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const line of ['First line', 'Second line', 'Third line', 'Fourth line']) {
    await page.keyboard.type(line, { delay: 15 });
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(80);
  }
  await page.keyboard.type('Fifth line');
  await page.waitForTimeout(150);
  // Deleting lines brings the conversation back down with the composer.
  for (const line of ['Fifth line', 'Fourth line']) {
    await page.keyboard.press('Backspace', { delay: 0 });
    for (let character = 1; character < line.length + 1; character++)
      await page.keyboard.press('Backspace');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(150);
  const frames = await page.evaluate(() => {
    Object.assign(window, { __growthDone: true });
    return (window as unknown as { __growth: Frame[] }).__growth;
  });
  await info.attach('composer-growth-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  // The composer grew, and in every painted frame the latest message kept the
  // same distance above the composer with the conversation still at its end.
  const heights = frames.map((frame) => frame.field);
  expect(Math.max(...heights) - heights[0]!).toBeGreaterThan(40);
  expect(Math.max(...heights) - heights.at(-1)!).toBeGreaterThan(20);
  await expect(input).toHaveValue('First line\nSecond line\nThird line');
  const gaps = frames.map((frame) => frame.gap);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1.5);
  expect(Math.max(...frames.map((frame) => Math.abs(frame.fromBottom)))).toBeLessThan(1.5);
  await page.screenshot({ path: info.outputPath('composer-grown.png'), animations: 'disabled' });
});
