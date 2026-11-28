import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
async function general(page: Page, phone: boolean) {
  if (phone && !(await page.getByRole('button', { name: 'Your account', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('App title', { exact: true })).toBeVisible();
}
for (const theme of ['dark', 'light']) {
  test(`app title is saved on Hermes and shared with another device in ${theme}`, async ({
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
    await general(page, !!info.project.use.isMobile);
    const title = page.getByLabel('App title', { exact: true });
    await title.fill('Elliott’s Team');
    await title.press('Enter');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.screenshot({
      path: info.outputPath(`app-title-settings-${theme}.png`),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
    await expect(page.locator('.pc-wordmark')).toHaveText('Elliott’s Team');
    const other = await context.newPage();
    try {
      await other.goto('/');
      await expect(other.locator('.pc-wordmark')).toHaveText('Elliott’s Team');
      await page.reload();
      await expect(page.locator('.pc-wordmark')).toHaveText('Elliott’s Team');
      await general(page, !!info.project.use.isMobile);
      await title.fill('Draft title');
      // Another device commits while this device retains an unsaved edit.
      await general(other, !!info.project.use.isMobile);
      await other.getByLabel('App title', { exact: true }).fill('Another device');
      await other.getByLabel('App title', { exact: true }).press('Enter');
      await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await page.bringToFront();
      await expect(
        page.getByText('App title changed elsewhere. Review your title before saving.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 12000 });
      await expect(title).toHaveValue('Draft title');
      await title.press('Enter');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    } finally {
      await other.close();
    }
  });
}
