import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('Markdown preserves code, lists, quotes and tables without widening the conversation', async ({
  page,
  context,
}, info) => {
  const code = `const greeting = "Hello, Pebble Crew";\n  const details = "${'long-value-'.repeat(24)}";\n`;
  await installFixture(context, {
    messages: [
      {
        row_id: 1,
        role: 'assistant',
        text: [
          '## Research notes',
          'A **clear** answer with *emphasis*, ~~old text~~ and `inline code`.',
          '```typescript\n' + code + '```',
          '> Keep the original indentation and content.',
          '1. Review the draft\n2. Share it\n   - With the crew\n   - With the owner',
          '- [x] Sources checked\n- [ ] Review pending',
          '| Item | Status |\n| --- | --- |\n| ' + 'Wide column '.repeat(18) + ' | Ready |',
          '| First heading | Second heading | Third heading | Fourth heading | Fifth heading | Sixth heading | Seventh heading | Eighth heading |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |',
          '<script>window.UNSAFE_MARKDOWN = true</script>',
        ].join('\n\n'),
      },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const body = page.getByRole('log').locator('.message-body');
  await expect(body.getByRole('heading', { name: 'Research notes' })).toBeVisible();
  await expect(body.locator('strong')).toHaveText('clear');
  await expect(body.locator('em')).toHaveText('emphasis');
  await expect(body.locator('del')).toHaveText('old text');
  await expect(body.locator('[data-slot=code-block-title]')).toHaveText('typescript');
  await expect(body.locator('pre code')).toHaveText(code, { useInnerText: false });
  await expect(body.locator('pre')).toHaveCSS('white-space', 'pre');
  await expect(body.locator('pre')).toHaveCSS('overflow-x', 'auto');
  await expect(body.locator('ol > li')).toHaveCount(2);
  await expect(body.locator('ol ul > li')).toHaveCount(2);
  await expect(body.locator('.task-list-item input:checked')).toHaveCount(1);
  await expect(body.locator('blockquote')).toContainText('original indentation');
  await expect(body.locator('table').first().locator('th')).toHaveText(['Item', 'Status']);
  for (const header of await body.locator('table th').all())
    expect((await header.boundingBox())!.height).toBeLessThan(48);
  expect(
    await body
      .locator('[data-slot="table-container"]')
      .nth(1)
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await expect(body.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  const bounds = (await body.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await body.locator('pre').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
    true,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('synthetic-copied-code', text);
        },
      },
    });
  });
  await body.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(body.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('synthetic-copied-code'))).toBe(code);
  await page.getByRole('log').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('markdown.png'),
  });
});
