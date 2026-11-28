import { test, expect } from '@playwright/test';
import { emit, installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light']) {
  test(`work captions follow real actions and agent updates in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context);
    await page.addInitScript(
      (value) => localStorage.setItem('pebble-crew.appearance', value),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await emit(page, 'message.start');
    const caption = page.locator('.pc-activity');
    await expect(caption).toHaveText('Thinking');
    const height = (await caption.boundingBox())!.height;
    await emit(page, 'tool.start', {
      tool_id: 'read-plan',
      name: 'read_file',
      args: { path: '/private/hidden.txt' },
    });
    await expect(caption).toHaveText('Reading project files');
    await emit(page, 'tool.complete', { tool_id: 'read-plan', name: 'read_file' });
    await expect(caption).toHaveText('Reviewing the files');
    await emit(page, 'status.update', {
      kind: 'progress',
      text: 'Checking available Claude models',
    });
    await expect(caption).toHaveText('Checking available Claude models');
    await emit(page, 'message.delta', { text: 'I’ll check the installed models.' });
    await expect(caption).toHaveCount(0);
    await emit(page, 'tool.start', {
      tool_id: 'models',
      name: 'terminal',
      args: { command: 'PRIVATE_COMMAND_MUST_NOT_APPEAR' },
    });
    await expect(caption).toHaveText('Checking available Claude models');
    await emit(page, 'tool.complete', { tool_id: 'models', name: 'terminal' });
    await expect(caption).toHaveText('Checking available Claude models');
    await emit(page, 'status.update', {
      kind: 'reasoning',
      text: 'PRIVATE_REASONING_MUST_NOT_APPEAR',
    });
    await expect(caption).toHaveText('Checking available Claude models');
    await emit(page, 'status.update', { kind: 'progress', text: 'Checking the website project' });
    await expect(caption).toHaveText('Checking the website project');
    expect((await caption.boundingBox())!.height).toBeCloseTo(height, 0);
    await page.screenshot({
      path: info.outputPath(`public-work-caption-${theme}.png`),
      animations: 'disabled',
    });
    await emit(page, 'message.delta', { text: 'The project is on track.' });
    await expect(caption).toHaveCount(0);
    await expect(page.locator('[data-message-phase="live"]')).toContainText(
      'The project is on track.',
    );
  });
}
