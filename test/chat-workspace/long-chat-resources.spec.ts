import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test('long chat keeps DOM and retained heap bounded across focus recovery and streaming', async ({
  page,
  context,
  browserName,
}, info) => {
  test.skip(browserName !== 'chromium', 'Renderer resource counters require Chromium CDP.');
  const messages = Array.from({ length: 300 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    row_id: index + 1,
    text:
      `Synthetic message ${index}. ` + 'A useful project update with a few details. '.repeat(12),
    timestamp: 1700000000 + index,
  }));
  await installFixture(context, { messages });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('[data-message-role]')).toHaveCount(300);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  async function sample() {
    await cdp.send('HeapProfiler.collectGarbage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const metric = (name: string) => metrics.find((item) => item.name === name)?.value ?? 0;
    return {
      ...dom,
      heap: metric('JSHeapUsedSize'),
      tasks: metric('TaskDuration'),
      layout: metric('LayoutDuration'),
    };
  }
  const samples = [await sample()];
  for (let round = 0; round < 5; round++) {
    for (let cycle = 0; cycle < 5; cycle++) {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await emit(page, 'workspace.changed');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
    await emit(page, 'message.start');
    await emit(page, 'message.delta', { text: `Live synthetic reply ${round}.` });
    await expect(page.getByRole('log')).toContainText(`Live synthetic reply ${round}.`);
    await emit(page, 'message.complete', { status: 'complete' });
    await expect(page.locator('[data-message-role]')).toHaveCount(300);
    samples.push(await sample());
  }
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('renderer-resources.json'),
    JSON.stringify({ messageCount: 300, samples }, null, 2),
  );
  await info.attach('renderer-resources', {
    body: JSON.stringify({ messageCount: 300, samples }, null, 2),
    contentType: 'application/json',
  });
  expect(samples.at(-1)!.nodes).toBeLessThan(samples[0]!.nodes * 1.2);
  expect(samples.at(-1)!.heap).toBeLessThan(samples[0]!.heap * 1.5);
});
