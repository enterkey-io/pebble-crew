import { expect, test } from '@playwright/test';
import { history, installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

const withCode = history.map((message, index) =>
  index % 3 === 0
    ? { ...message, text: `Notes ${index}\n\n\`\`\`ts\nconst value = ${index};\n\`\`\`` }
    : message,
);

test('workspace refreshes while typing keep message code blocks in place', async ({
  page,
  context,
}) => {
  await installFixture(context, { messages: withCode });
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await expect(page.locator('[data-slot="code-block"]').first()).toBeVisible();
  await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-slot="code-block"]')];
    Object.assign(window, { __blocks: blocks });
  });
  await input.click();
  // Long enough to span several workspace refreshes; each one used to rebuild
  // every code block and mention chip in the conversation.
  await page.keyboard.type(
    'A long message that wraps onto new lines while I keep typing. '.repeat(3),
    {
      delay: 50,
    },
  );
  const kept = await page.evaluate(() =>
    (window as unknown as { __blocks: Element[] }).__blocks.map((block) => block.isConnected),
  );
  expect(kept.length).toBeGreaterThan(5);
  expect(kept.every(Boolean)).toBe(true);
});
