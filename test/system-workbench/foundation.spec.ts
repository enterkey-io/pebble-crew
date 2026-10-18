import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generalCatalog, type GeneralComponentId } from '../../apps/web/src/ui-lab/catalog';

async function select(page: Page, id: GeneralComponentId) {
  await expect(page.getByRole('heading', { name: 'Component workbench' })).toBeVisible();
  if (await page.getByRole('combobox', { name: 'Component', exact: true }).isVisible())
    await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption(id);
  else
    await page
      .getByRole('navigation', { name: 'Components' })
      .getByRole('button', { name: generalCatalog.find((x) => x.id === id)!.name, exact: true })
      .click();
  await expect(page.locator(`[data-specimen="${id}"]`)).toBeVisible();
}
async function settled(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.timeline === document.timeline &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}
test('the complete foundation renders in the real app without native calls', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const api: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/(?:api|v1)\//.test(request.url())) api.push(request.url());
  });
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'Component workbench' })).toBeVisible();
  for (const item of generalCatalog) {
    await select(page, item.id);
    for (const mode of ['ready', 'disabled', 'error']) {
      await page.getByRole('combobox', { name: 'Preview state', exact: true }).selectOption(mode);
      await expect(page.locator(`[data-specimen="${item.id}"]`)).toHaveAttribute('data-mode', mode);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${item.id}/${mode} page overflow`,
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
  await select(page, 'field');
  await page.getByRole('combobox', { name: 'Preview state', exact: true }).selectOption('ready');
  await page.screenshot({ path: info.outputPath('foundation.png'), fullPage: true });
});
test('controls, portals and fixed editor geometry behave as a user expects', async ({
  page,
}, info) => {
  await page.goto('/system');
  await select(page, 'combobox');
  await page.getByRole('combobox', { name: 'Pebble', exact: true }).click();
  await page.getByRole('option', { name: 'Grace' }).click();
  await expect(page.getByRole('combobox', { name: 'Pebble', exact: true })).toContainText('Grace');
  await select(page, 'tags-input');
  const tags = page.getByRole('textbox', { name: 'Topics', exact: true });
  await tags.fill('Design');
  await tags.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Design' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Design' }).click();
  await expect(page.getByRole('button', { name: 'Remove Design' })).toHaveCount(0);
  await select(page, 'number-field');
  const number = page.getByRole('spinbutton', { name: 'Limit' });
  await number.fill('72');
  await expect(number).toHaveValue('72');
  await number.fill('');
  await expect(number).toHaveValue('');
  await select(page, 'slider');
  await page.getByRole('slider', { name: 'Volume' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuenow', '41');
  await select(page, 'dialog');
  const trigger = page.getByRole('button', { name: 'Open dialog', exact: true });
  await trigger.click();
  const title = page.getByRole('heading', { name: 'Edit sample' });
  await settled(page);
  const before = await title.boundingBox();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Role', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await settled(page);
  expect((await title.boundingBox())?.y).toBe(before?.y);
  await page.screenshot({ path: info.outputPath('editor.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(trigger).toBeFocused();
  await select(page, 'dropdown-menu');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeFocused();
  await select(page, 'questionnaire');
  await page.getByRole('radio', { name: 'Brief', exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Choice saved locally');
});
test('foundation keyboard and accessibility semantics', async ({ page }) => {
  await page.goto('/system');
  for (const id of [
    'input',
    'checkbox',
    'radio-group',
    'combobox',
    'slider',
    'progress',
    'questionnaire',
    'table',
    'stepper',
    'dialog',
  ] satisfies GeneralComponentId[]) {
    await select(page, id);
    if (id === 'dialog')
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    await settled(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations, `${id} accessibility`).toEqual([]);
    if (id === 'dialog') await page.keyboard.press('Escape');
  }
});
