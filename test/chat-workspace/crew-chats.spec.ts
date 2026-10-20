import { openSidebarMenu } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('replacing a chosen mention before the next paint preserves the replacement and sends it once', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  fixture.state.bots[0]!.handle = 'aurora';
  const sends: string[] = [];
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'room.send') sends.push(params.text);
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Research crew / }).click();
  await field.fill('@');
  await page.getByRole('option', { name: 'Arlo @aurora', exact: true }).evaluate(
    (option) =>
      new Promise<void>((resolve) => {
        if (!(option instanceof HTMLElement)) throw new Error('Expected an interactive option');
        requestAnimationFrame(() => {
          option.click();
          queueMicrotask(() => {
            const field = document.querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="Message"]',
            )!;
            field.focus();
            field.select();
            requestAnimationFrame(() => {
              document.execCommand('insertText', false, '@aurora please review this');
              resolve();
            });
          });
        });
      }),
  );
  await expect(field).toHaveValue('@aurora please review this');
  await field.press('Enter');
  await expect.poll(() => sends).toEqual(['@aurora please review this']);
});

async function newConversation(page: Page, kind: 'New crew' | 'Group chat') {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
  return page.getByRole('dialog', {
    name: kind === 'New crew' ? kind : 'New group chat',
    exact: true,
  });
}

test('crew creation includes description and members; chat mentions only its members and shows their avatars', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  fixture.state.bots[0]!.handle = 'aurora';
  const saves: Record<string, unknown>[] = [];
  const sends: string[] = [];
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'organization.save') saves.push(params.organization);
    if (operation === 'room.send') sends.push(params.text);
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  const dialog = await newConversation(page, 'New crew');
  await dialog.getByLabel('Name', { exact: true }).fill('Research desk');
  await dialog.getByLabel('Description', { exact: true }).fill('Review research together.');
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  for (const name of ['Arlo', 'Mica'])
    await dialog.getByRole('checkbox', { name, exact: true }).check();
  for (const name of ['Rowan', 'Sage', 'Ember', 'Cleo'])
    await dialog.getByRole('checkbox', { name, exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: 'Lumen', exact: true })).toBeDisabled();
  for (const name of ['Rowan', 'Sage', 'Ember', 'Cleo'])
    await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Wren', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Wren', exact: true }).uncheck();
  await expect(dialog.getByRole('heading', { name: 'New crew', exact: true })).toBeInViewport();
  await expect(dialog.getByLabel('Name', { exact: true })).toBeInViewport();
  await expect(dialog.getByLabel('Description', { exact: true })).toBeInViewport();
  await dialog.getByLabel('Crew members', { exact: true }).evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('new-crew-members.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  expect(saves.at(-1)).toMatchObject({
    crews: [
      {
        name: 'Research desk',
        purpose: 'Review research together.',
        members: ['identity-0', 'identity-1'],
      },
    ],
  });
  await openSidebarMenu(page, 'Research desk');
  await page.getByRole('menuitem', { name: 'Crew settings', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Crew settings', exact: true });
  await expect(edit.getByLabel('Description', { exact: true })).toHaveValue(
    'Review research together.',
  );
  for (const name of ['Arlo', 'Mica'])
    await expect(edit.getByRole('checkbox', { name, exact: true })).toBeChecked();
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /^Research desk .*Open chat$/ }).click();
  await expect(page.getByRole('log')).toContainText('I have the notes ready.');
  const header = page.locator('[data-message-id="room-m2"] [data-slot="message-header"]');
  await expect(header).toContainText('Mica');
  const avatar = header.locator('.agent-avatar');
  await expect(avatar).toBeVisible();
  const geometry = await avatar.boundingBox();
  expect(geometry!.width).toBeCloseTo(20, 2);
  expect(geometry!.height).toBeCloseTo(20, 2);
  await field.fill('@');
  await expect(page.getByRole('option', { name: 'Arlo @aurora', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Mica @mica', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Rowan/ })).toHaveCount(0);
  const menu = page
    .locator('[data-slot="command"]')
    .filter({ has: page.getByRole('option', { name: 'Arlo @aurora', exact: true }) });
  const [a, b] = await Promise.all([
    menu.boundingBox(),
    page.locator('[data-slot="prompt-input"]').boundingBox(),
  ]);
  expect(Math.abs(a!.width - b!.width)).toBeLessThan(1);
  await page.getByRole('option', { name: 'Arlo @aurora', exact: true }).click();
  await expect(field).toHaveValue('@aurora ');
  await field.fill('@aurora please review this');
  await field.press('Enter');
  await expect.poll(() => sends).toEqual(['@aurora please review this']);
  const committed = page.locator('[data-message-id^="committed-"]');
  await expect(committed).toHaveCount(1);
  await expect(committed).toContainText('@aurora please review this');
  await expect(page.locator('[data-message-id^="pending-"]')).toHaveCount(0);
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'room.state')
      return route.fulfill({
        json: { result: { driver_status: { working: true, pending_actions: [] } } },
      });
    await route.fallback();
  });
  await expect(
    page.locator('[data-slot="trace-title"]').filter({ hasText: 'Crew members are working' }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('crew-conversation-avatar.png'),
    animations: 'disabled',
  });
});

test('ad hoc group creation leaves crew membership and sidebar placement unchanged', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let organizationWrites = 0;
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'organization.save') organizationWrites++;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const dialog = await newConversation(page, 'Group chat');
  await dialog.getByLabel('Name', { exact: true }).fill('Planning discussion');
  for (const name of ['Arlo', 'Mica'])
    await dialog.getByRole('checkbox', { name, exact: true }).check();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.chat-title')).toContainText('Planning discussion');
  await expect(page.getByRole('log')).toContainText('I have the notes ready.');
  expect(organizationWrites).toBe(0);
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const rail = info.project.use.isMobile
    ? page.getByRole('dialog', { name: 'navigation', exact: true })
    : page.getByRole('complementary', { name: 'Pebbles and crews' });
  await expect(rail.locator('.pinned-tile strong')).toHaveText(['Arlo', 'Mica']);
  await expect(page.getByRole('heading', { name: 'Group chats', exact: true })).toHaveCount(0);
  await expect(
    rail
      .getByRole('navigation', { name: 'Group chats', exact: true })
      .getByRole('button', { name: 'Planning discussion Group chat', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('ad-hoc-group-navigation.png'),
    animations: 'disabled',
  });
});

test('group reactions persist through polling and distinguish each reacting pebble', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let revision = 0;
  let reactions: { emoji: string; author: string; actor?: string; name?: string }[] = [];
  const key = 'a'.repeat(64);
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'room.react') {
      expect(params.event_id).toBe('group-user');
      revision++;
      reactions = reactions.filter((r) => r.author !== 'user');
      if (params.emoji) reactions.push({ emoji: params.emoji, author: 'user' });
      return route.fulfill({
        json: { result: { event_id: 'group-user', reactions, revision, room_key: key } },
      });
    }
    if (operation === 'room.log')
      return route.fulfill({
        json: {
          result: {
            room_key: key,
            reaction_revision: revision,
            reaction_updates: [{ event_id: 'group-user', reactions }],
            events:
              params.since_seq === 0
                ? [
                    {
                      seq: 1,
                      kind: 'message.user',
                      event_id: 'group-user',
                      created_at: 1700000000,
                      payload: { text: 'Thanks, everyone.' },
                    },
                  ]
                : [],
            cursor: 1,
            has_more: false,
          },
        },
      });
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Research crew / }).click();
  const message = page.locator('[data-message-id="group-user"]');
  await expect(message).toContainText('Thanks, everyone.');
  await message.getByRole('button', { name: 'React to message', exact: true }).click();
  await page.getByRole('menuitem', { name: 'React with heart', exact: true }).click();
  await expect(message.getByRole('button', { name: '❤️ · You', exact: true })).toBeVisible();
  revision++;
  reactions.push(
    { emoji: '👍', author: 'agent', actor: 'identity-0', name: 'Arlo' },
    { emoji: '👍', author: 'agent', actor: 'identity-1', name: 'Mica' },
  );
  await expect(
    message.getByRole('button', { name: '👍 · Arlo and Mica', exact: true }),
  ).toBeVisible();
  const reaction = message.getByRole('button', { name: '👍 · Arlo and Mica', exact: true });
  await expect(reaction).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(reaction).toHaveCSS('box-shadow', 'none');
  await expect(reaction).toHaveCSS('border-width', '0px');
  await page.reload();
  await expect(page.getByRole('button', { name: '👍 · Arlo and Mica', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('group-reactions.png'), animations: 'disabled' });
});
