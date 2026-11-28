import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light']) {
  test(`the model picker uses a padded shared search and keeps its header fixed in ${theme}`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context);
    await page.addInitScript(
      (value) => localStorage.setItem('pebble-crew.appearance', value),
      theme,
    );
    await context.route('**/v1/rpc', async (route) => {
      if (route.request().postDataJSON().operation !== 'chat.model.options')
        return route.fallback();
      await route.fulfill({
        json: {
          result: {
            model: 'current-synthetic-model',
            provider: 'openai',
            providers: [
              {
                id: 'openai',
                name: 'OpenAI',
                models: [
                  'current-synthetic-model',
                  ...Array.from({ length: 24 }, (_, i) => `synthetic-model-${i + 1}`),
                ],
              },
              { id: 'anthropic', name: 'Anthropic', models: ['synthetic-claude-model'] },
            ],
          },
        },
      });
    });
    await page.goto('/');
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeEnabled();
    await field.fill('/models');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a model', exact: true });
    await expect(dialog).toBeVisible();
    const input = dialog.getByPlaceholder('Search providers');
    if (info.project.use.isMobile) await expect(dialog).toBeFocused();
    else await expect(input).toBeFocused();
    await input.hover();
    const bounds = (await dialog.boundingBox())!,
      search = (await input.boundingBox())!;
    expect(search.x - bounds.x).toBeGreaterThan(20);
    expect(bounds.x + bounds.width - search.x - search.width).toBeGreaterThan(16);
    await expect(dialog).toContainText('Current: current-synthetic-model');
    const current = dialog.locator('[data-slot="dialog-description"]');
    expect(await current.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const top = bounds.y;
    await page.screenshot({
      path: info.outputPath(`model-providers-${theme}.png`),
      animations: 'disabled',
    });
    await dialog.getByRole('option', { name: 'OpenAI', exact: true }).click();
    const models = page.getByRole('dialog', { name: 'OpenAI', exact: true });
    await expect(models).toBeVisible();
    await expect.poll(async () => Math.abs((await models.boundingBox())!.y - top)).toBeLessThan(1);
    await expect(models.getByLabel('Current model')).toBeVisible();
    await models.getByPlaceholder('Search models').fill('synthetic-model-24');
    await expect(models.getByRole('option')).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath(`model-search-${theme}.png`),
      animations: 'disabled',
    });
    await models.getByRole('button', { name: 'Providers', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(field).toBeEnabled();
  });
}
