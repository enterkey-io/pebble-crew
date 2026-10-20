import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';
test.use({ serviceWorkers: 'block' });

test('touch reaction picker stays inside the screen and works without hover', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const row = page.locator('[data-message-id="28"]');
  await row.getByRole('button', { name: 'React to message', exact: true }).tap();
  const menu = page.getByRole('menu');
  await menu.evaluate(async (node) => {
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  const bounds = (await menu.boundingBox())!;
  const size = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
  const choice = page.getByRole('menuitem', { name: 'React with celebrate', exact: true });
  expect((await choice.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('reaction-picker.png') });
  await choice.tap();
  await expect(menu).toBeHidden();
  const chip = row.getByRole('button', { name: '🎉 · You', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(chip).toHaveCSS('border-top-width', '0px');
  await expect(chip).toHaveCSS('box-shadow', 'none');
  const overlap = await row.evaluate((node) => {
    const bubble = node.querySelector('[data-slot="bubble-content"]')!.getBoundingClientRect();
    const reactions = node
      .querySelector('[data-slot="bubble-reactions"] button > span')!
      .getBoundingClientRect();
    return {
      top: reactions.top - bubble.bottom,
      bottom: reactions.bottom - bubble.bottom,
      height: reactions.height,
    };
  });
  expect(overlap.top).toBeLessThan(0);
  expect(overlap.bottom).toBeGreaterThan(0);
  expect(overlap.height).toBeLessThan(30);
  expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('reaction-saved.png') });
  await chip.tap();
  await expect(chip).toHaveCount(0);
});

test('message action focus does not leave a desktop tooltip over touch conversations', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.clock.install();
  const trigger = page
    .locator('[data-message-id="28"]')
    .getByRole('button', { name: 'React to message', exact: true });
  await trigger.focus();
  await page.clock.runFor(1000);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('tooltip')).toBeHidden();
  await page.clock.resume();
});
