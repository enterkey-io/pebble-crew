import type { Page } from '@playwright/test';

/** Use the platform's ordinary send action; touch Return deliberately inserts a newline. */
export async function submitMessage(page: Page) {
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  else await page.getByLabel('Message', { exact: true }).press('Enter');
}
