import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';
import type { OrganizationState } from '../../apps/web/src/ui/organization';

test.use({ serviceWorkers: 'block' });

for (const theme of ['dark', 'light']) {
  test(`mobile list is a full page with pinned pebbles, sections and header search in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const organization: OrganizationState = {
      revision: 1,
      sections: [
        { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
        {
          id: 'personal',
          name: 'Personal',
          collapsed: false,
          items: [2, 3, 4, 5, 6].map((n) => ({
            kind: 'pebble',
            id: `identity-${n}`,
            placementId: `row-identity-${n}`,
            shortcut: false,
          })),
        },
      ],
    };
    const fixture = await installFixture(context, { organization });
    fixture.state.bots[2]!.pinned = true;
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    const input = page.getByLabel('Message', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('Keep my draft while I browse');
    const originalInput = await input.elementHandle();
    const log = page.getByRole('log');
    const transcript = await log.elementHandle();
    await log.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll'));
    });
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).press('Enter');
    const navigation = page.getByRole('region', { name: 'navigation', exact: true });
    await expect(navigation).toBeVisible();
    await expect.poll(async () => (await navigation.boundingBox())!.x).toBe(0);
    const bounds = (await navigation.boundingBox())!;
    expect(bounds.width).toBe(page.viewportSize()!.width);
    await expect(page.getByRole('dialog', { name: 'navigation' })).toHaveCount(0);
    const search = navigation.getByRole('button', { name: 'Search Pebble Crew', exact: true });
    const searchBox = (await search.boundingBox())!;
    expect(searchBox.y - bounds.y).toBeLessThan(100);
    const pins = navigation.locator('.pc-pins .pinned-tile');
    await expect(pins).toHaveCount(3);
    const avatars = await pins.locator('.agent-avatar').evaluateAll((nodes) =>
      nodes.map((node) => ({
        x: node.getBoundingClientRect().x,
        y: node.getBoundingClientRect().y,
        width: node.getBoundingClientRect().width,
      })),
    );
    expect(avatars[0]!.width).toBe(72);
    expect(avatars[1]!.x).toBeGreaterThan(avatars[0]!.x);
    expect(avatars[0]!.y).toBe(avatars[1]!.y);
    await expect(navigation.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
    await expect(navigation.getByRole('img', { name: '4 members', exact: true })).toBeVisible();
    const account = navigation.getByRole('button', { name: 'Your account', exact: true });
    await expect(navigation).toBeFocused();
    await expect(account).not.toBeFocused();
    await expect(account).toHaveCSS('box-shadow', 'none');
    await expect(account).toHaveCSS('border-top-width', '0px');
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`mobile-list-${theme}.png`),
    });
    if (info.project.name === 'android-chromium') {
      await page.keyboard.press('Tab');
      await expect(search).toBeFocused();
    }
    await account.click();
    await expect(page.getByRole('menu', { name: 'Your account', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();
    await expect
      .poll(() => account.evaluate((button) => button.matches(':focus-visible')))
      .toBe(true);
    await search.click();
    await expect(page.locator('[data-slot="command-input"]')).toBeVisible();
    await page.locator('[data-slot="command-input"]').fill('Mica');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="command-input"]')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('.pc-mobile-navigation')).toHaveAttribute('aria-hidden', 'true');
    await expect(input).toBeVisible();
    expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await transcript!.evaluate((node) => node.isConnected && node.scrollTop === 0)).toBe(
      true,
    );
    await expect(input).toHaveValue('Keep my draft while I browse');
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
    await expect(navigation).toBeFocused();
    await expect(account).not.toBeFocused();
    await navigation.getByRole('button', { name: /Mica.*Bot Chat/ }).click();
    await expect(input).toHaveAttribute('placeholder', 'Message Mica');
    await expect
      .poll(async () => {
        const box = (await page.locator('[data-slot="prompt-input"]').boundingBox())!;
        return page.evaluate(({ y, height }) => innerHeight - y - height, box);
      })
      .toBeLessThanOrEqual(36);

    await expect(navigation).not.toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`mobile-chat-${theme}.png`),
    });
  });
}
