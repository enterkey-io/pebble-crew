import type { Page } from '@playwright/test';
import type { OrganizationState, RailItem } from '../../apps/web/src/ui/organization';
export const organization = (): OrganizationState => ({
  revision: 0,
  sections: [
    { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
    ...['North', 'South', 'West'].map((name, index) => ({
      id: name.toLowerCase(),
      name,
      collapsed: false,
      items: [index * 2, index * 2 + 1].map((n): RailItem => ({
        kind: 'pebble',
        id: `identity-${n}`,
        placementId: `row-identity-${n}`,
        shortcut: false,
      })),
    })),
  ],
});
export async function showRail(page: Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
