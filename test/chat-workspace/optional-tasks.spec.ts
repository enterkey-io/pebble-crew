import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installWorkFixture } from './work-fixture';

test.use({ serviceWorkers: 'block' });
async function rail(page: Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
async function general(page: Page) {
  await rail(page);
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}
async function fixture(context: BrowserContext) {
  const fixture = await installWorkFixture(context, { coordination: true });
  fixture.workspace.features = { tasks: true };
  const behavior = { loseResponse: false, refuse: false, stale: false };
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation !== 'workspace.features.set') return route.fallback();
    if (behavior.refuse) {
      behavior.refuse = false;
      return route.abort('failed');
    }
    if (behavior.stale) {
      behavior.stale = false;
      fixture.workspace.revision++;
    }
    if (params.expected_revision !== fixture.workspace.revision)
      return route.fulfill({ status: 409, json: { code: 'STALE_REVISION' } });
    fixture.workspace.features = { tasks: params.tasks };
    fixture.workspace.revision++;
    if (behavior.loseResponse) {
      behavior.loseResponse = false;
      return route.abort('failed');
    }
    return route.fulfill({
      json: {
        result: {
          features: fixture.workspace.features,
          revision: fixture.workspace.revision,
        },
      },
    });
  });
  return { ...fixture, behavior };
}

test('Tasks can be hidden for the installation without hiding chats, Crews or proactive routines', async ({
  page,
  context,
}, info) => {
  const installed = await fixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  const setting = page.getByRole('switch', { name: 'Tasks', exact: true });
  await expect(setting).toBeChecked();
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(setting).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    await expect(async () => {
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }).toPass({ timeout: 3000 });
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`tasks-off-${theme}.png`),
    });
  }
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(page);
  await expect(page.getByRole('radiogroup', { name: 'App area' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'New task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'New project board', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('menuitem', { name: 'New crew', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // A second browser tab receives the installation preference, not a local-storage value.
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('Message', { exact: true })).toBeEnabled();
  await rail(second);
  await expect(second.getByRole('radiogroup', { name: 'App area' })).toHaveCount(0);
  await second.close();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await rail(page);
  await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
  await rail(page);
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toContainText(
    'General tasks',
  );
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toContainText('Plans');
  expect(installed.boards).toHaveLength(1);
});

test('Tasks setting reconciles a lost response and leaves failed changes retryable', async ({
  page,
  context,
}) => {
  const installed = await fixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  const setting = page.getByRole('switch', { name: 'Tasks', exact: true });
  installed.behavior.loseResponse = true;
  await setting.click();
  await expect(setting).not.toBeChecked();
  await expect(setting).toBeEnabled();
  await expect(page.getByText('Couldn’t save Tasks. Try again.')).toHaveCount(0);
  installed.behavior.refuse = true;
  await setting.click();
  await expect(page.getByText('Couldn’t save Tasks. Try again.', { exact: true })).toBeVisible();
  await expect(setting).not.toBeChecked();
  installed.behavior.stale = true;
  await setting.click();
  await expect(page.getByText('Settings changed. Try again.', { exact: true })).toBeVisible();
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await expect(setting).toBeEnabled();
});

test('old bridges keep Tasks enabled without advertising an unsupported setting', async ({
  page,
  context,
}) => {
  await installWorkFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await general(page);
  await expect(page.getByRole('switch', { name: 'Tasks', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await rail(page);
  await expect(page.getByRole('radio', { name: 'Tasks', exact: true })).toBeVisible();
});
