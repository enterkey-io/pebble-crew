import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('Role uses one clear instruction field and preserves older role text and dirty drafts', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  const bot = fixture.state.bots.find((item) => item.profile === 'mica');
  if (!bot) throw new Error('Role fixture missing');
  bot.role = {
    title: 'Researcher',
    description: 'Looks up sources',
    responsibilities: 'Read sources.',
    boundaries: 'Ask before publishing.',
    expectedOutputs: 'A short brief.',
  };
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await sidebarItem(page, 'Mica').isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Researcher');
  await expect(page.getByLabel('Instructions', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  const field = page.getByLabel('Instructions', { exact: true });
  const original =
    'Read sources.\n\nBoundaries:\nAsk before publishing.\n\nExpected outputs:\nA short brief.';
  await expect(field).toHaveValue(original);
  await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Boundaries', { exact: true })).toHaveCount(0);
  const group = page.locator('[data-slot=field]').filter({ has: field });
  const label = await group.locator('[data-slot=field-label]').boundingBox();
  const input = await field.boundingBox();
  if (!label || !input) throw new Error('Instruction field has no geometry');
  expect(input.y - label.y - label.height).toBeGreaterThan(8);
  expect(input.width).toBeGreaterThan(200);
  await expect(field).toHaveAccessibleDescription(/Adds to this agent’s Hermes instructions/);
  await page.screenshot({ path: info.outputPath('role-instructions.png'), animations: 'disabled' });
  const instructions =
    'Research carefully.\n' + 'Cite each source. '.repeat(80) + '\nAsk before publishing.';
  await field.fill(instructions);
  bot.role.boundaries = 'A concurrent agent update';
  fixture.state.revision++;
  await emit(page, 'workspace.changed');
  await expect(page.getByText('The saved role changed while you were editing.')).toBeVisible();
  await expect(field).toHaveValue(instructions);
  await page.getByRole('button', { name: 'Keep my edits', exact: true }).click();
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByText('Role saved.', { exact: true })).toBeVisible();
  expect(bot.role.responsibilities).toBe(instructions);
  expect(bot.role.boundaries).toBe('');
  expect(bot.role.expectedOutputs).toBe('');
  await page.getByRole('button', { name: 'Close Edit Mica', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (!(await sidebarItem(page, 'Mica').isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Role', exact: true }).click();
  await expect(field).toHaveValue(instructions);
});
