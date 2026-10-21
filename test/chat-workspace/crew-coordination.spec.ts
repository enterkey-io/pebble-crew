import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
import type { OrganizationState } from '../../apps/web/src/ui/organization';

test.use({ serviceWorkers: 'block' });
async function showRail(page: import('@playwright/test').Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
}
const org = (): OrganizationState => ({
  revision: 0,
  sections: [
    { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [{ kind: 'crew', id: 'studio' }] },
  ],
  crews: [
    {
      id: 'studio',
      name: 'Studio',
      purpose: 'Build the product',
      managerId: 'identity-2',
      collapsed: false,
      members: ['identity-0', 'identity-1', 'identity-2'],
    },
  ],
});
test('Pins, normal shortcuts and compact manager-first Crew rows share one identity', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { organization: org() });
  fixture.state.bots.slice(3).forEach((bot) => {
    bot.managed = false;
    bot.enrolled = false;
    bot.canonical = false;
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await expect(page.getByRole('region', { name: 'Crews', exact: true })).toHaveCount(0);
  const crew = page.locator('[data-crew-id=studio]').filter({ visible: true });
  await expect(crew.getByRole('img', { name: 'Crew manager', exact: true })).toHaveCount(1);
  expect(
    await crew
      .locator('.pc-crew-member button')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
  ).toEqual(['Rowan Operations', 'Arlo Team lead', 'Mica Executive assistant']);
  const member = crew
    .locator('.pc-crew-member')
    .filter({ has: page.getByRole('button', { name: /^Mica / }) });
  await expect(member).toBeVisible();
  const pins = page.locator('.pc-pins').filter({ visible: true });
  await expect(pins.getByRole('button', { name: /Mica/ })).toBeVisible();
  await member.getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add shortcut', exact: true }).click();
  const shortcut = page
    .locator('.pc-unsectioned > .pebble-row')
    .filter({ has: page.getByRole('button', { name: /^Mica / }) });
  await expect(shortcut).toBeVisible();
  await expect(shortcut).toHaveCSS('opacity', '1');
  await expect
    .poll(async () =>
      Math.abs(
        (await shortcut.boundingBox())!.y -
          (await pins.boundingBox())!.y -
          (await pins.boundingBox())!.height,
      ),
    )
    .toBeLessThan(90);
  expect((await shortcut.boundingBox())!.height).toBeGreaterThan(
    (await member.boundingBox())!.height + 12,
  );
  await page.screenshot({
    path: info.outputPath('crew-shortcuts-manager.png'),
    animations: 'disabled',
  });
  await shortcut.getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove shortcut', exact: true }).click();
  await expect(shortcut).toHaveCount(0);
  await expect(member).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await expect(crew.getByRole('img', { name: 'Crew manager', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('pebble-crew.appearance', 'light'));
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await expect(crew.getByRole('img', { name: 'Crew manager', exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('crew-manager-light.png'),
    animations: 'disabled',
  });
});

test('both direct chats open the same live exchange without losing draft or scroll', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { exchanges: true });
  let count = 2;
  const actors = [
    { id: 'identity-0', profile: 'arlo', name: 'Arlo' },
    { id: 'identity-1', profile: 'mica', name: 'Mica' },
  ];
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'exchange.references') {
      await route.fulfill({
        json: {
          result: {
            supported: true,
            exchanges: [
              {
                id: 'exchange-one',
                created_at: 1700001000000,
                count,
                peer: actors.find((a) => a.id !== params.identity),
                state: 'completed',
              },
            ],
          },
        },
      });
      return;
    }
    if (operation === 'exchange.read') {
      await route.fulfill({
        json: {
          result: {
            id: 'exchange-one',
            participants: actors,
            state: 'completed',
            messages: [
              {
                id: '1',
                author: 'identity-0',
                text: 'Please check the project.',
                created_at: 1700001000000,
              },
              {
                id: '2',
                author: 'identity-1',
                text: 'I checked it. The plan is ready.',
                created_at: 1700001001000,
              },
              ...(count === 3
                ? [
                    {
                      id: '3',
                      author: 'identity-0',
                      text: 'Thanks, keep the current plan.',
                      created_at: 1700001002000,
                    },
                  ]
                : []),
            ],
          },
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Keep my draft');
  const link = page.getByRole('button', { name: '2 messages with Mica', exact: true });
  await expect(link).toBeVisible();
  await link.click();
  const dialog = page.getByRole('dialog', { name: 'Arlo and Mica', exact: true });
  await expect(dialog.locator('[data-exchange-message]')).toHaveCount(2);
  await expect(dialog).toContainText('Please check the project.');
  count = 3;
  await expect(dialog.locator('[data-exchange-message]')).toHaveCount(3);
  await expect(
    dialog.getByRole('button', { name: 'Close', exact: true }).locator('svg'),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('shared-exchange.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(field).toHaveValue('Keep my draft');
  await expect(
    page.getByRole('button', { name: '3 messages with Mica', exact: true }),
  ).toBeVisible();
  await showRail(page);
  const mica = page
    .locator('.pc-pins')
    .filter({ visible: true })
    .getByRole('button', { name: /Mica/ });
  await mica.click();
  const other = page.getByRole('button', { name: '3 messages with Arlo', exact: true });
  await expect(other).toBeVisible();
  await other.click();
  await expect(dialog.locator('[data-exchange-message]')).toHaveCount(3);
  expect(fixture.state.bots[0]!.profile).toBe('arlo');
});

test('a confirmed peer call becomes a thin link while a failed reused call stays visible', async ({
  page,
  context,
}) => {
  await installFixture(context, {
    exchanges: true,
    messages: [
      { row_id: 1, role: 'user', text: 'Ask Mica', timestamp: 1700000000 },
      {
        row_id: 2,
        role: 'tool',
        name: 'message_agent',
        tool_call_id: 'same-id',
        text: 'Queued',
        timestamp: 1700000001,
      },
      {
        row_id: 3,
        role: 'tool',
        name: 'message_agent',
        tool_call_id: 'same-id',
        text: 'Recipient unavailable',
        timestamp: 1700000002,
      },
      { row_id: 4, role: 'assistant', text: 'The second request failed.', timestamp: 1700000003 },
    ],
  });
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'exchange.references') {
      await route.fulfill({
        json: {
          result: {
            exchanges: [
              {
                id: 'verified',
                created_at: 1700000001000,
                count: 1,
                peer: { id: 'identity-1', profile: 'mica', name: 'Mica' },
                state: 'queued',
                tool_receipts: [{ call_id: 'same-id', timestamp: 1700000001 }],
              },
            ],
          },
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: '1 message with Mica', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /1 tool call/ })).toHaveCount(1);
  await page.getByRole('button', { name: /1 tool call/ }).click();
  await expect(page.getByText('Recipient unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Queued', { exact: true })).toHaveCount(0);
});

test('the owner can change a Crew manager and purpose without changing reporting', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { organization: org() });
  const reporting = fixture.state.bots.map((bot) => [bot.id, bot.manager]);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  const crew = page.locator('[data-crew-id=studio]').filter({ visible: true });
  await crew.locator('.pc-crew-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Crew settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Crew settings', exact: true });
  await dialog.getByRole('combobox', { name: 'Crew manager', exact: true }).click();
  await page.getByRole('option', { name: 'Mica', exact: true }).click();
  await dialog.getByLabel('Purpose', { exact: true }).fill('Prepare a careful launch');
  const frame = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, bottom: rect.bottom };
  });
  for (const name of ['Remove crew', 'Cancel', 'Save changes']) {
    const button = dialog.getByRole('button', { name, exact: true });
    await expect(button).toBeInViewport();
    const bounds = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(frame.left + 8);
    expect(bounds.right).toBeLessThanOrEqual(frame.right - 8);
    expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom - 8);
  }
  await page.screenshot({
    path: info.outputPath('crew-manager-editor.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(crew.locator('.pc-crew-member').first().getByRole('button')).toContainText('Mica');
  expect(fixture.state.bots.map((bot) => [bot.id, bot.manager])).toEqual(reporting);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await showRail(page);
  await expect(crew.locator('.pc-crew-member').first().getByRole('button')).toContainText('Mica');
});
