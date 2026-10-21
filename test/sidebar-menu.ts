import type { Page } from '@playwright/test';

export function sidebarItem(page: Page, name: string) {
  const value = `Actions for ${name}`.replace(/[\\"]/g, '\\$&');
  return page.locator(`[data-context-label="${value}"]`).filter({ visible: true });
}

export async function openSidebarMenu(page: Page, name: string) {
  const item = sidebarItem(page, name);
  if (!(await item.isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const button = item.locator('button').first();
  await ((await button.count()) ? button : item).click({ button: 'right' });
}
