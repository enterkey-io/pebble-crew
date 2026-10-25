import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('background photo recovery preserves historical replies and user chronology', async ({
  page,
  context,
}) => {
  const messages = [
    { row_id: 1, role: 'user', text: 'Four days ago', timestamp: 1792600000 },
    { row_id: 2, role: 'assistant', text: 'Earlier reply stays visible', timestamp: 1792600010 },
    { row_id: 3, role: 'user', text: 'Today I need a photo', timestamp: 1792945600 },
    { row_id: 4, role: 'assistant', text: 'Recent reply stays visible', timestamp: 1792945610 },
    { row_id: 5, role: 'user', text: 'Use that style please', timestamp: 1792945620 },
  ];
  let phase: 'idle' | 'photo' | 'complete' = 'idle';
  let reads = 0;
  await installFixture(context, {
    messages,
    open: (profile) => {
      reads++;
      return {
        session_id: `session-${profile}`,
        messages,
        running: phase === 'photo',
        active_user_row_id: phase === 'photo' ? 1 : undefined,
        live_assistant_row_ids: [],
        inflight:
          phase === 'photo' ? { assistant: 'Preparing the photo', corrections: [] } : undefined,
      };
    },
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const stored = page
    .locator('[data-message-id]')
    .filter({ hasNot: page.locator('[data-message-phase="live"]') });
  const ids = () =>
    page
      .locator('[data-message-id][data-message-phase="committed"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-message-id')));
  await expect.poll(ids).toEqual(['1', '2', '3', '4', '5']);
  const recovered = async () => {
    const before = reads;
    await page.evaluate(() => Reflect.get(window, '__breakStream')());
    await expect.poll(() => reads).toBeGreaterThan(before);
  };
  phase = 'photo';
  await recovered();
  await expect.poll(ids).toEqual(['1', '2', '3', '4', '5']);
  await expect(page.locator('[data-message-id="2"]')).toContainText('Earlier reply stays visible');
  await expect(page.locator('[data-message-id="4"]')).toContainText('Recent reply stays visible');
  await expect(page.getByText('Preparing the photo', { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('background-photo-history.png'),
    animations: 'disabled',
  });
  phase = 'complete';
  messages.push({ row_id: 6, role: 'assistant', text: 'Photo ready', timestamp: 1792945630 });
  await recovered();
  await expect.poll(ids).toEqual(['1', '2', '3', '4', '5', '6']);
  await expect(stored).toHaveCount(6);
});
