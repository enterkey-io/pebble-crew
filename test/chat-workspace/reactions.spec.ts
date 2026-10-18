import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture, emit, history } from './fixtures';

test('reactions can be added, replaced, removed and restored without sending a message', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let sends = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/rpc') && r.postDataJSON().operation === 'chat.send') sends++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const row = page.locator('[data-message-id="28"]');
  await row.hover();
  await row.getByRole('button', { name: 'React to message' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/reaction-picker-desktop.png',
  });
  await page.getByRole('menuitem', { name: 'React with heart', exact: true }).click();
  await expect(row.getByRole('button', { name: '❤️ · You', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await row.hover();
  await row.getByRole('button', { name: 'React to message' }).click();
  await expect(row.getByRole('button', { name: 'React to message' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await menu.evaluate(async (node) => {
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await page.getByRole('menuitem', { name: 'React with laugh', exact: true }).click();
  await expect(row.getByRole('button', { name: '❤️ · You', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: '😂 · You', exact: true })).toBeVisible();
  const emoji = row.getByRole('button', { name: '😂 · You', exact: true });
  for (const hovered of [false, true]) {
    if (hovered) await emoji.hover();
    await expect(emoji).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(emoji).toHaveCSS('border-top-width', '0px');
    await expect(emoji).toHaveCSS('box-shadow', 'none');
  }
  const overlap = await row.evaluate((node) => {
    const bubble = node.querySelector('[data-slot="bubble-content"]')!.getBoundingClientRect();
    const reactions = node.querySelector('[data-slot="bubble-reactions"]')!.getBoundingClientRect();
    return {
      left: reactions.left - bubble.left,
      top: reactions.top - bubble.bottom,
      bottom: reactions.bottom - bubble.bottom,
    };
  });
  expect(overlap.left).toBeGreaterThan(0);
  expect(overlap.left).toBeLessThan(24);
  expect(overlap.top).toBeLessThan(0);
  expect(overlap.bottom).toBeGreaterThan(0);
  const movingOverlap = await row.evaluate(async (node) => {
    const pane = node.closest<HTMLElement>('[role="log"]')!;
    const original = pane.scrollTop;
    const samples = [];
    for (const offset of [0, 36, 72, 0]) {
      pane.scrollTop = original - offset;
      await new Promise(requestAnimationFrame);
      const bubble = node.querySelector('[data-slot="bubble-content"]')!.getBoundingClientRect();
      const reaction = node
        .querySelector('[data-slot="bubble-reactions"]')!
        .getBoundingClientRect();
      samples.push({ top: reaction.top - bubble.bottom, bottom: reaction.bottom - bubble.bottom });
    }
    pane.scrollTop = original;
    return samples;
  });
  for (const sample of movingOverlap) {
    expect(sample.top).toBeLessThan(0);
    expect(sample.bottom).toBeGreaterThan(0);
  }
  expect((await row.getByRole('button', { name: '😂 · You' }).boundingBox())!.height).toBeLessThan(
    30,
  );
  await page.reload();
  await expect(row.getByRole('button', { name: '😂 · You', exact: true })).toBeVisible();
  await row.getByRole('button', { name: '😂 · You', exact: true }).click();
  await expect(row.locator('.pc-reactions')).toHaveCount(0);
  expect(sends).toBe(0);
});

test('reaction picker supports keyboard selection, Escape and focus return', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const row = page.locator('[data-message-id="28"]');
  const trigger = row.getByRole('button', { name: 'React to message', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const heart = page.getByRole('menuitem', { name: 'React with heart', exact: true });
  await page.keyboard.press('ArrowDown');
  await expect(heart).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: '❤️ · You', exact: true })).toBeVisible();
  await trigger.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('older integrations without native reaction support expose no reaction controls', async ({
  page,
  context,
}) => {
  await installFixture(context, { reactions: false });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'React to message', exact: true })).toHaveCount(0);
});

test('agent reaction events paint the exact message, not the latest bubble', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'chat.history') {
      await route.fulfill({
        json: {
          result: {
            messages: history.map((m) =>
              m.row_id === 24
                ? { ...m, display_metadata: { reactions: [{ emoji: '👍', author: 'agent' }] } }
                : m,
            ),
          },
        },
      });
    } else await route.fallback();
  });
  await emit(page, 'message.reaction', {
    row_id: 24,
    reactions: [{ emoji: '👍', author: 'agent' }],
    role: 'user',
  });
  const row = page.locator('[data-message-id="24"]');
  await expect(row.getByRole('button', { name: '👍 · Arlo', exact: true })).toBeVisible();
  await expect(page.locator('[data-message-id="28"] .pc-reactions')).toHaveCount(0);
});
