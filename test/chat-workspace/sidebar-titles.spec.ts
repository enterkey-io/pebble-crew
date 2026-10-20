import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });
test('role tags use the available row width and only truncate when the row is full', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  fixture.state.bots.find((b) => b.profile === 'rowan')!.role.title = 'Director of Marketing';
  fixture.state.bots.find((b) => b.profile === 'ember')!.role.title = 'Internal Systems Lead';
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  for (const [name, role] of [
    ['Rowan', 'Director of Marketing'],
    ['Ember', 'Internal Systems Lead'],
  ]) {
    const row = page
      .locator('.pebble-row')
      .filter({ has: page.getByRole('button', { name: new RegExp(`^${name} .*Bot Chat$`) }) });
    const badge = row.locator('[data-slot="badge"]');
    await expect(badge).toHaveText(role!);
    expect(await badge.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.screenshot({
    path: info.outputPath('full-sidebar-titles.png'),
    animations: 'disabled',
  });
  fixture.state.bots.find((b) => b.profile === 'rowan')!.role.title =
    'A genuinely long role that cannot fit within the remaining sidebar space';
  await emit(page, 'workspace.changed');
  const long = page
    .locator('.pebble-row')
    .filter({ has: page.getByRole('button', { name: /^Rowan .*Bot Chat$/ }) });
  await expect(long.locator('[data-slot="badge"]')).toContainText('A genuinely long role');
  const geometry = await long.evaluate((node) => {
    const title = node.querySelector('[data-slot="item-title"]')!.getBoundingClientRect();
    const boundary = node.getBoundingClientRect();
    return {
      right: title.right,
      edge: boundary.right,
      overflow: node.scrollWidth - node.clientWidth,
    };
  });
  expect(geometry.right).toBeLessThanOrEqual(geometry.edge);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
});
