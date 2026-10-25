import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { installFixture, history } from './fixtures';

async function measureTyping(
  browser: Browser,
  count: number,
  options: {
    url: string;
    label?: string;
    profile?: boolean;
    streaming?: boolean;
    screenshot?: string;
  },
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    serviceWorkers: 'block',
  });
  try {
    await installFixture(context, {
      messages: Array.from({ length: count }, (_, i) => ({
        ...history[i % history.length]!,
        row_id: i + 1,
        timestamp: 1700000000 + i * 600,
      })),
    });
    const page = await context.newPage();
    await page.goto(options.url);
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeEnabled();
    await expect(page.locator('[data-message-id]')).toHaveCount(count);
    await field.focus();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await cdp.send('HeapProfiler.collectGarbage');
    await page.evaluate(() => {
      const marks: number[] = [];
      document.addEventListener(
        'input',
        (event) => {
          if (!(event.target instanceof HTMLTextAreaElement)) return;
          const started = performance.now();
          requestAnimationFrame(() => marks.push(performance.now() - started));
        },
        true,
      );
      Object.assign(window, { __inputPaints: marks });
    });
    if (options.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    if (options.streaming)
      await page.evaluate(() => {
        const receive = (window as unknown as { __chatEvent: (event: unknown) => void })
          .__chatEvent;
        const event = (type: string, payload = {}) =>
          receive({ type, payload, session_id: 'session-arlo' });
        event('message.start');
        let emitted = 0;
        const timer = setInterval(() => {
          event('message.delta', { text: 'The next step is to review the project. ' });
          if (++emitted === 20) clearInterval(timer);
        }, 100);
      });
    const before = await cdp.send('Performance.getMetrics');
    const value = 'Please review this project and explain the next steps.';
    const started = performance.now();
    await field.pressSequentially(value, { delay: options.streaming ? 20 : 0 });
    await expect(field).toHaveValue(value);
    const elapsed = performance.now() - started;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const after = await cdp.send('Performance.getMetrics');
    const paints = await page.evaluate(
      () => (window as unknown as { __inputPaints: number[] }).__inputPaints,
    );
    paints.sort((a, b) => a - b);
    const metrics = Object.fromEntries(
      after.metrics.map(({ name, value }) => [
        name,
        value - (before.metrics.find((m) => m.name === name)?.value ?? 0),
      ]),
    );
    if (metrics.ScriptDuration === undefined)
      throw new Error('Browser did not report script duration');
    expect(paints).toHaveLength(value.length);
    const result = {
      scriptMs: metrics.ScriptDuration * 1000,
      count,
      streaming: !!options.streaming,
      characters: value.length,
      elapsed,
      paints: paints.length,
      medianPaint: paints[Math.floor(paints.length / 2)],
      p95Paint: paints[Math.floor(paints.length * 0.95)],
      maximumPaint: paints.at(-1),
      metrics,
    };
    if (options.label) {
      const directory = '.audit/request-input';
      await mkdir(directory, { recursive: true });
      if (options.profile) {
        const { profile } = await cdp.send('Profiler.stop');
        await writeFile(`${directory}/${options.label}.cpuprofile`, JSON.stringify(profile));
      }
      await writeFile(`${directory}/${options.label}.json`, JSON.stringify(result, null, 2) + '\n');
    }
    if (options.screenshot)
      await page.screenshot({ path: options.screenshot, animations: 'disabled' });
    return result;
  } finally {
    await context.close();
  }
}

const median = (values: number[]) =>
  values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test('typing work stays bounded as conversation history grows', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const short: number[] = [],
    long: number[] = [];
  // Interleave matching input against short and long histories on the same browser.
  // This catches history-wide key handling without assuming one machine's frame speed.
  for (let repeat = 0; repeat < 5; repeat++)
    for (const count of [28, 300]) {
      const result = await measureTyping(browser, count, {
        url: 'http://127.0.0.1:8093/',
        ...(repeat === 4 && count === 300
          ? { screenshot: testInfo.outputPath('long-conversation-input.png') }
          : {}),
      });
      (count === 28 ? short : long).push(result.scriptMs);
    }
  await testInfo.attach('input-history-scaling', {
    body: JSON.stringify({ short, long }),
    contentType: 'application/json',
  });
  expect(median(long)).toBeLessThan(Math.max(250, median(short) * 4));
});

test('measures typing work in a production conversation', async ({ browser }, testInfo) => {
  test.skip(!process.env.PEBBLE_INPUT_MEASURE, 'Explicit production profiling run');
  test.setTimeout(180000);
  const count = Number(process.env.PEBBLE_INPUT_ROWS ?? 300);
  const baseline = process.env.PEBBLE_INPUT_BASELINE_URL;
  const builds = baseline
    ? [
        { name: 'baseline', url: baseline },
        { name: 'candidate', url: 'http://127.0.0.1:8093/' },
      ]
    : [{ name: process.env.PEBBLE_INPUT_MEASURE, url: 'http://127.0.0.1:8093/' }];
  for (let repeat = 0; repeat < (baseline ? 5 : 1); repeat++)
    for (const build of builds) {
      const label = `${build.name}${baseline ? '-' + (repeat + 1) : ''}`;
      const result = await measureTyping(browser, count, {
        ...build,
        label,
        profile: !!process.env.PEBBLE_INPUT_PROFILE,
        streaming: !!process.env.PEBBLE_INPUT_STREAM,
        screenshot: testInfo.outputPath(`${label}.png`),
      });
      console.log(JSON.stringify({ label, ...result }));
    }
});
