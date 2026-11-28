import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('a long owner message is shortened with an ellipsis and expands on tap', async ({
  page,
  context,
}, info) => {
  const ending = 'THE FINAL SENTENCE OF THE LONG MESSAGE.';
  const long = `${'I have a lot to say about the knowledge loop and how it should work. '.repeat(20)}${ending}`;
  await installFixture(context, {
    messages: [
      { row_id: 1, role: 'user', text: long },
      { row_id: 2, role: 'assistant', text: 'Got it.' },
      { row_id: 3, role: 'user', text: 'Short note.' },
    ],
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const bubble = page.locator('.long-message');
  await expect(bubble).toHaveCount(1);
  await bubble.scrollIntoViewIfNeeded();
  await expect(bubble).toContainText('…');
  await expect(bubble).not.toContainText(ending);
  await expect(page.getByText('Short note.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('long-message.png'), animations: 'disabled' });
  await bubble
    .getByText(/knowledge loop/)
    .first()
    .click();
  await expect(bubble).toContainText(ending);
  const toggle = bubble.getByRole('button', { name: 'Hide', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(bubble).not.toContainText(ending);
  await bubble.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(bubble).toContainText(ending);
});
