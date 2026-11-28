import { test, expect } from '@playwright/test';
import { openSidebarMenu, sidebarItem } from '../sidebar-menu';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

// Video calls are discontinued. A host that still advertises Atmee setup must not
// surface any video entry point, and saved video calls read as plain calls.
test('a host advertising Atmee shows no video call entry points', async ({ page, context }) => {
  const messages = [
    { row_id: 1, role: 'user', text: 'Before the calls', timestamp: 1700000000 },
    { row_id: 2, role: 'assistant', text: 'After the calls', timestamp: 1700000030 },
  ];
  const voice_calls = [
    { id: 'a'.repeat(64), ended_at: 1700000010, kind: 'video' },
    { id: 'b'.repeat(64), ended_at: 1700000020 },
  ];
  await installFixture(context, {
    voice: true,
    atmee: true,
    open: (profile) => ({ session_id: `session-${profile}`, messages, voice_calls }),
    historyPage: () => ({ messages, voice_calls }),
  });
  await page.route('**/v1/rpc', async (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === 'voice.status')
      return route.fulfill({
        json: {
          result: {
            supported: true,
            configured: true,
            voice: 'marin',
            voices: ['marin', 'cedar'],
            setup_complete: true,
            key_confirmed: true,
          },
        },
      });
    await route.fallback();
  });
  const video = /atmee|\bvideo\b|camera/i;

  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const log = page.getByRole('log');
  await expect(log).toContainText(/Before the calls[\s\S]*Call ended[\s\S]*Voice call ended/);
  await expect(log).not.toContainText('Video call ended');
  await expect(page.getByRole('button', { name: video })).toHaveCount(0);

  if (!(await sidebarItem(page, 'Mica').isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await openSidebarMenu(page, 'Mica');
  await page.getByRole('menuitem', { name: 'Edit pebble', exact: true }).click();
  await page.getByRole('tab', { name: 'Voice', exact: true }).click();
  const editor = page.getByRole('tabpanel');
  await expect(editor.getByRole('combobox', { name: 'Voice', exact: true })).toBeVisible();
  await expect(editor).not.toContainText(video);
  await page.getByRole('button', { name: /^Close Edit / }).click();

  if (!(await page.getByRole('button', { name: 'Your account', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const settings = page.getByRole('tabpanel');
  await expect(settings.getByRole('heading').first()).toBeVisible();
  await expect(settings).not.toContainText(video);
  await expect(page.getByRole('form', { name: 'Atmee API key' })).toHaveCount(0);
});
