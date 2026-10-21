import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import type { OrganizationState } from '../../apps/web/src/ui/organization';

test.use({ serviceWorkers: 'block' });

const organization = (): OrganizationState => ({
  revision: 0,
  sections: [
    { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
    {
      id: 'crews',
      name: 'Crews',
      collapsed: false,
      items: ['north', 'south', 'west'].map((id) => ({ kind: 'crew', id })),
    },
  ],
  crews: ['North', 'South', 'West'].map((name, i) => ({
    id: name.toLowerCase(),
    name,
    managerId: null,
    purpose: `${name} crew`,
    collapsed: false,
    members: [`identity-${i * 2}`, `identity-${i * 2 + 1}`],
  })),
});

async function showRail(page: import('@playwright/test').Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}

async function crewFixture(context: import('@playwright/test').BrowserContext) {
  const fixture = await installFixture(context, { organization: organization() });
  fixture.state.bots.forEach((bot, index) => {
    bot.pinned = false;
    if (index > 5) {
      bot.managed = false;
      bot.canonical = false;
      bot.enrolled = false;
    }
  });
  return fixture;
}

test('crew chevrons collapse only members, persist and leave chat opening on the name', async ({
  page,
  context,
}, info) => {
  await crewFixture(context);
  let opened = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'organization.chat') opened++;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const crew = page.locator('[data-crew-id=north]').filter({ visible: true });
  await expect(crew.getByRole('button', { name: /^Mica .*Bot Chat$/ })).toBeVisible();
  await crew.getByRole('button', { name: 'Collapse North pebbles', exact: true }).click();
  await expect(
    crew.getByRole('button', { name: 'Expand North pebbles', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(crew.locator('.pc-crew-members')).toHaveCount(0);
  expect(opened).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await expect(crew.locator('.pc-crew-members')).toHaveCount(0);
  await crew.getByRole('button', { name: 'Expand North pebbles', exact: true }).click();
  await expect(crew.getByRole('button', { name: /^Mica .*Bot Chat$/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('crew-disclosures.png'), animations: 'disabled' });
  await crew.getByRole('button', { name: 'North 2 pebbles. Open chat', exact: true }).click();
  await expect.poll(() => opened).toBe(1);
  await expect(page.locator('.chat-title')).toContainText('North');
});

test('dragging a Crew reorders the whole block, ignores member targets and preserves membership', async ({
  page,
  context,
}, info) => {
  test.skip(
    !!info.project.use.isMobile,
    'Native desktop drag; touch disclosure and menus have separate coverage.',
  );
  await crewFixture(context);
  const saved: OrganizationState[] = [];
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'organization.save') saved.push(params.organization);
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const west = page.locator('[data-crew-id=west]'),
    north = page.locator('[data-crew-id=north]');
  const source = (await west.locator('.pc-crew-row').boundingBox())!;
  const target = (await north.locator('.pebble-row').first().boundingBox())!;
  await page.mouse.move(source.x + 110, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 110, source.y + source.height / 2 - 12, { steps: 3 });
  await page.mouse.move(target.x + 110, target.y + 5, { steps: 8 });
  await page.mouse.move(target.x + 111, target.y + 5);
  await expect(west).toHaveAttribute('data-dragging', 'true');
  await expect(
    page.locator('.pebble-row[data-drop-target],.pc-crew-members[data-drop-target]'),
  ).toHaveCount(0);
  await expect(north).toHaveAttribute('data-drop-edge', 'before');
  await page.screenshot({ path: info.outputPath('whole-crew-drag.png'), animations: 'disabled' });
  await page.mouse.up();
  await expect
    .poll(() =>
      saved
        .at(-1)
        ?.sections.find((s) => s.id === 'pebbles')
        ?.items.map((i) => i.id),
    )
    .toEqual(['west', 'north', 'south']);
  expect(saved.at(-1)!.crews).toEqual(organization().crews);
  await expect(page.locator('[data-dragging]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(
    await page
      .locator('[data-crew-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-crew-id'))),
  ).toEqual(['west', 'north', 'south']);
  const currentNorth = sidebarItem(page, 'North').getByRole('button', {
    name: 'North 2 pebbles. Open chat',
    exact: true,
  });
  await currentNorth.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect
    .poll(() =>
      saved
        .at(-1)
        ?.sections.find((s) => s.id === 'pebbles')
        ?.items.map((i) => i.id),
    )
    .toEqual(['west', 'south', 'north']);
  expect(saved.at(-1)!.crews).toEqual(organization().crews);
});

test('sections can move below the final section as complete blocks', async ({
  page,
  context,
}, info) => {
  test.skip(!!info.project.use.isMobile, 'Native desktop drag has separate touch-menu coverage.');
  const org = organization();
  org.sections = [
    org.sections[0]!,
    { id: 'first', name: 'First', collapsed: false, items: [{ kind: 'crew', id: 'north' }] },
    {
      ...org.sections[1]!,
      id: 'custom',
      name: 'Custom',
      items: [
        { kind: 'crew', id: 'south' },
        { kind: 'crew', id: 'west' },
      ],
    },
  ];
  const fixture = await installFixture(context, { organization: org });
  fixture.state.bots.forEach((bot, index) => {
    bot.pinned = false;
    if (index > 5) {
      bot.managed = false;
      bot.canonical = false;
      bot.enrolled = false;
    }
  });
  let latest = org;
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'organization.save') latest = params.organization;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const first = page.getByRole('region', { name: 'First', exact: true });
  const last = page.getByRole('region', { name: 'Custom', exact: true });
  await first
    .locator('.pc-section-header')
    .dragTo(last, { targetPosition: { x: 100, y: (await last.boundingBox())!.height - 4 } });
  await expect
    .poll(() => latest.sections.map((section) => section.id))
    .toEqual(['pebbles', 'custom', 'first']);
  expect(latest.crews).toEqual(org.crews);
});

test('sidebar context menus create a section or a crew with the selected pebble', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  const saves: OrganizationState[] = [];
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'organization.save') saves.push(params.organization);
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openSidebarMenu(page, 'Rowan');
  await page.getByRole('menuitem', { name: 'Move to crew', exact: true }).click();
  const choices = page.locator('[data-slot=context-menu-sub-content]');
  await expect(choices.getByRole('menuitem')).toHaveText(['New crew']);
  await expect(choices.getByRole('separator')).toHaveCount(0);
  await choices.getByRole('menuitem', { name: 'New crew', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New crew', exact: true });
  await expect(dialog.getByRole('checkbox', { name: 'Rowan', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Sage', exact: true }).check();
  await dialog.getByLabel('Name', { exact: true }).fill('Studio');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => saves.at(-1)?.crews[0]?.members).toEqual(['identity-2', 'identity-3']);
  await openSidebarMenu(page, 'Ember');
  await page.getByRole('menuitem', { name: 'Move to crew', exact: true }).click();
  await expect(choices.getByRole('menuitemcheckbox')).toHaveText(['Studio']);
  await expect(choices.getByRole('separator')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('move-context-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openSidebarMenu(page, 'Ember');
  await page.getByRole('menuitem', { name: 'Move to section', exact: true }).click();
  await expect(choices.getByRole('menuitem')).toHaveText(['New section']);
  await choices.getByRole('menuitem', { name: 'New section', exact: true }).click();
  const section = page.getByRole('dialog', { name: 'New section', exact: true });
  await section.getByLabel('Name', { exact: true }).fill('Operations');
  await section.getByRole('button', { name: 'Create', exact: true }).click();
  await expect
    .poll(() => saves.at(-1)?.sections.find((s) => s.name === 'Operations')?.items)
    .toEqual([{ kind: 'pebble', id: fixture.state.bots[4]!.id }]);
  await expect(page.locator('.pc-overflow,.pc-pin-actions')).toHaveCount(0);
});

test('sidebar menus are available from the keyboard and return focus to the pebble', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const button = sidebarItem(page, 'Mica').getByRole('button').first();
  await button.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Actions for Mica', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
});

for (const theme of ['dark', 'light'] as const)
  test(`${theme} left rail and details use the intended surfaces`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context);
    await page.addInitScript((mode) => localStorage.setItem('pebble-crew.appearance', mode), theme);
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await showRail(page);
    const rail = info.project.use.isMobile
      ? page.getByRole('dialog', { name: 'navigation', exact: true })
      : page.getByRole('complementary', { name: 'Pebbles and crews', exact: true });
    await expect(rail).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(11, 11, 13)' : 'rgb(242, 240, 236)',
    );
    await page.screenshot({
      path: info.outputPath(`sidebar-${theme}.png`),
      animations: 'disabled',
    });
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await page.locator('.chat-title').click();
    const details = page.locator('.pc-details').filter({ visible: true });
    await expect(details).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(17, 17, 19)' : 'rgb(250, 249, 246)',
    );
    await expect
      .poll(async () => {
        const bounds = (await details.boundingBox())!;
        return Math.abs(bounds.x + bounds.width - page.viewportSize()!.width);
      })
      .toBeLessThan(1);
    await page.screenshot({
      path: info.outputPath(`details-${theme}.png`),
      animations: 'disabled',
    });
  });
