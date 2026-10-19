import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('chat activity uses operation icons in collapsed groups and expanded tool rows', async ({
  page,
  context,
}, info) => {
  const operations = [
    ['read_file', 'book-open'],
    ['terminal', 'square-terminal'],
    ['vision_analyze', 'image'],
    ['write_file', 'file-pen-line'],
    ['web_search', 'globe'],
    ['unknown_extension', 'wrench'],
  ];
  await installFixture(context, {
    messages: [
      ...operations.map(([name], i) => ({ row_id: i + 1, role: 'tool', name, text: 'Done' })),
      { row_id: 7, role: 'assistant', text: 'The review is ready.' },
      { row_id: 8, role: 'assistant', text: '', display_commentary: ['Checking the result.'] },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const group = page.getByRole('button', { name: /^6 tool calls/ });
  await expect(group.locator('svg.lucide-wrench')).toBeVisible();
  await group.click();
  for (const [i, [, icon]] of operations.entries())
    await expect(
      page.locator(`[data-tool-id="${i + 1}"] [data-slot="trace-icon"] svg.lucide-${icon}`),
    ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Activity', exact: true }).locator('svg.lucide-activity'),
  ).toBeVisible();
  await page.getByRole('log').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ animations: 'disabled', path: info.outputPath('activity-icons.png') });
});
