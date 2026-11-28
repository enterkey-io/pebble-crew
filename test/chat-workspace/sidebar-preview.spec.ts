import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light']) {
  test(`sidebar previews flatten Markdown and summarize scripts in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context);
    fixture.state.bots[2]!.preview =
      '## Ready\n\n**Öykü** is _ready_. [Read the plan](https://example.test/private).';
    fixture.state.bots[3]!.preview = '```javascript\nconst secret = "never in the sidebar";\n```';
    fixture.state.bots[4]!.preview = '<script>window.example = "never in the sidebar"</script>';
    fixture.state.bots[5]!.preview = '![Reference photo](attachment://example)';
    await page.addInitScript(
      (value) => localStorage.setItem('pebble-crew.appearance', value),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    const row = (id: number) => page.locator(`[data-placement-id="row-identity-${id}"]`);
    await expect(row(2)).toContainText('Ready Öykü is ready. Read the plan.');
    await expect(row(2)).not.toContainText('**');
    await expect(row(2)).not.toContainText('https://');
    await expect(row(3)).toContainText('Code snippet');
    await expect(row(4)).toContainText('Code snippet');
    await expect(row(3)).not.toContainText('const secret');
    await expect(row(4).locator('script')).toHaveCount(0);
    await expect(row(5)).toContainText('Photo');
    await row(2).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`sidebar-preview-${theme}.png`),
      animations: 'disabled',
    });
  });
}
