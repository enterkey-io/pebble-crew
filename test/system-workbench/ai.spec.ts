import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { aiCatalog, type AIPatternId } from '../../apps/web/src/ui-lab/catalog';
async function select(page: Page, id: AIPatternId) {
  if (await page.getByRole('combobox', { name: 'Component', exact: true }).isVisible())
    await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption(id);
  else
    await page
      .getByRole('navigation', { name: 'Components' })
      .getByRole('button', { name: aiCatalog.find((x) => x.id === id)!.name, exact: true })
      .click();
  await expect(page.locator(`[data-ai-specimen="${id}"]`)).toBeVisible();
}
async function settled(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (a) =>
            a.timeline === document.timeline &&
            a.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}
test('all AI patterns and declared states render without native or provider traffic', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const api: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/\/(?:api|v1)\//.test(r.url())) api.push(r.url());
  });
  await page.goto('/system');
  await page.getByRole('tab', { name: 'AI elements', exact: true }).click();
  for (const item of aiCatalog) {
    await select(page, item.id);
    const states = await page
      .getByRole('combobox', { name: 'AI state' })
      .locator('option')
      .evaluateAll((options) =>
        options.flatMap((option) => (option instanceof HTMLOptionElement ? [option.value] : [])),
      );
    expect(states.length).toBeGreaterThan(1);
    for (const state of states) {
      await page.getByRole('combobox', { name: 'AI state' }).selectOption(state);
      await expect(page.locator(`[data-ai-specimen="${item.id}"]`)).toHaveAttribute(
        'data-mode',
        state,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${item.id}/${state} overflow`,
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
  await select(page, 'tool');
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('complete');
  await page.getByRole('button', { name: 'Read file' }).click();
  await settled(page);
  await page.screenshot({ path: info.outputPath('tool.png'), fullPage: true });
});
test('AI actions respect availability and require explicit decisions', async ({ page }) => {
  await page.goto('/system');
  await page.getByRole('tab', { name: 'AI elements', exact: true }).click();
  await select(page, 'checkpoint');
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('unavailable');
  await expect(page.locator('[data-ai-specimen="checkpoint"]').getByRole('button')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('available');
  await page.getByRole('button', { name: 'Before editing notes', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Restore confirmed locally');
  await select(page, 'confirmation');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Allowed once locally');
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('expired');
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  await select(page, 'inline-citation');
  await page.getByRole('button', { name: 'Source: 1', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open source' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await page.keyboard.press('Escape');
  await select(page, 'queue');
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('queued');
  await expect(
    page.locator('[data-ai-specimen="queue"]').getByRole('button', { name: 'Cancel' }),
  ).toHaveCount(0);
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('actionable');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Cancelled locally');
  await select(page, 'prompt-input');
  await page.getByRole('combobox', { name: 'AI state' }).selectOption('ready');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A local draft');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Sent locally');
  await page.getByRole('tab', { name: 'Private requests', exact: true }).click();
  const secret = page.getByLabel('TEST_DEMO_KEY', { exact: true });
  await secret.fill('SYNTHETIC_NOT_A_SECRET');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(secret).toHaveValue('');
  await expect(page.getByRole('status')).toHaveText('Submitted locally; the value was discarded.');
  expect(await page.content()).not.toContain('SYNTHETIC_NOT_A_SECRET');
});
test('AI patterns have accessible settled controls', async ({ page }) => {
  await page.goto('/system');
  await page.getByRole('tab', { name: 'AI elements', exact: true }).click();
  for (const item of aiCatalog) {
    await select(page, item.id);
    await settled(page);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations, item.id).toEqual([]);
  }
});
