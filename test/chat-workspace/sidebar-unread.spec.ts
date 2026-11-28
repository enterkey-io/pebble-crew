import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { emit, installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

async function centeredInList(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const rail = element.closest('.pc-rail, .pc-mobile-navigation')!;
        const top = rail.querySelector('.pc-rail-top')!.getBoundingClientRect().bottom;
        const bottom = rail.querySelector('.pc-rail-footer')!.getBoundingClientRect().top;
        const rect = element.getBoundingClientRect();
        return Math.abs(rect.top + rect.height / 2 - (top + bottom) / 2);
      }),
    )
    .toBeLessThan(24);
}

async function exposed(button: Locator, page: Page) {
  await expect(button).toBeVisible();
  expect(
    await button.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
  const bounds = (await button.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const theme of ['dark', 'light']) {
  for (const installed of [false, true]) {
    test(`sidebar jumps to offscreen unread chats in ${theme}${installed ? ' installed PWA' : ''}`, async ({
      page,
      context,
    }, info) => {
      test.skip(installed && !info.project.use.isMobile, 'Installed page scrolling is phone only');
      if (installed)
        await page.addInitScript(() =>
          Object.defineProperty(navigator, 'standalone', { value: true }),
        );
      await page.addInitScript(
        (theme) => localStorage.setItem('pebble-crew.appearance', theme),
        theme,
      );
      const placement = (index: number) => ({
        kind: 'pebble' as const,
        id: `identity-${index}`,
        placementId: `row-${index}`,
        shortcut: false,
      });
      const fixture = await installFixture(context, {
        projects: true,
        organization: {
          revision: 0,
          sections: [
            {
              id: 'pebbles',
              name: 'Pebbles',
              collapsed: false,
              items: [...Array.from({ length: 34 }, (_, i) => placement(i))],
            },
            { id: 'later', name: 'Later', collapsed: true, items: [placement(34), placement(35)] },
          ],
        },
      });
      const template = structuredClone(fixture.state.bots[2]!);
      fixture.state.bots = fixture.state.bots.filter((b) => b.managed);
      for (let i = 12; i < 36; i++)
        fixture.state.bots.push({
          ...structuredClone(template),
          id: `identity-${i}`,
          profile: `pebble-${i}`,
          handle: `pebble-${i}`,
          name: `Pebble ${i}`,
          pinned: false,
          read_key: `read-${i}`,
        });
      for (const [i, bot] of fixture.state.bots.entries()) bot.unread = [1, 18, 35].includes(i);
      await page.goto('/');
      await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
      if (info.project.use.isMobile) {
        await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
        await expect(page.getByRole('region', { name: 'navigation', exact: true })).toHaveCSS(
          'transform',
          'matrix(1, 0, 0, 1, 0, 0)',
        );
      }
      if (installed) await expect(page.locator('[data-native-sidebar-scroll]')).toHaveCount(1);
      const above = page.getByRole('button', { name: 'Unread messages above', exact: true });
      const below = page.getByRole('button', { name: 'Unread messages below', exact: true });
      await exposed(below, page);
      await expect(above).toHaveCount(0);

      await below.click();
      const middle = page.locator('[data-unread-target][data-unread-chat="pebble:identity-18"]');
      await centeredInList(middle);
      await exposed(above, page);
      await exposed(below, page);
      if (info.project.use.isMobile)
        expect((await page.locator('.pc-mobile-navigation').boundingBox())!.x).toBe(0);
      await page.screenshot({
        path: info.outputPath(`unread-edges-${theme}${installed ? '-pwa' : ''}.png`),
        animations: 'disabled',
      });
      expect(fixture.state.bots.filter((b) => b.unread).map((b) => b.id)).toEqual([
        'identity-1',
        'identity-18',
        'identity-35',
      ]);
      await expect(page.locator('.pc-chat-identity')).toContainText('Arlo');
      const [header, footer] = await Promise.all([
        page.locator('.pc-rail-top').boundingBox(),
        page.locator('.pc-rail-footer').boundingBox(),
      ]);
      expect((await above.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      const belowBounds = (await below.boundingBox())!;
      expect(belowBounds.y + belowBounds.height).toBeLessThanOrEqual(footer!.y);

      await below.click();
      const later = page.getByRole('button', { name: 'Later', exact: false });
      await expect(later).toBeInViewport();
      await expect(later).toHaveAttribute('aria-expanded', 'false');
      await expect(later.getByRole('img', { name: 'Unread messages', exact: true })).toBeVisible();
      await expect(below).toHaveCount(0);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await above.click();
      await centeredInList(middle);
      await above.click();
      await expect(above).toHaveCount(0);
      await exposed(below, page);

      for (const bot of fixture.state.bots) bot.unread = false;
      await emit(page, 'workspace.changed');
      await expect(above).toHaveCount(0);
      await expect(below).toHaveCount(0);
      fixture.state.bots[35]!.unread = true;
      await emit(page, 'workspace.changed');
      await exposed(below, page);
      await page.getByRole('radio', { name: 'Tasks', exact: true }).click();
      await expect(above).toHaveCount(0);
      await expect(below).toHaveCount(0);
    });
  }
}

test('a visible pin or shortcut suppresses offscreen alerts for the same unread chat', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, {
    organization: {
      revision: 0,
      sections: [
        {
          id: 'pebbles',
          name: 'Pebbles',
          collapsed: false,
          items: [
            ...Array.from({ length: 12 }, (_, i) => ({
              kind: 'pebble' as const,
              id: `identity-${i}`,
              placementId: `row-${i}`,
              shortcut: false,
            })),
            { kind: 'pebble', id: 'identity-1', placementId: 'mica-shortcut', shortcut: true },
          ],
        },
      ],
    },
  });
  for (const bot of fixture.state.bots) bot.unread = bot.profile === 'mica';
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const jumps = page.getByRole('button', { name: /^Unread messages (above|below)$/ });
  await expect(page.locator('.pc-pin [aria-label="Unread messages"]')).toBeVisible();
  await expect(jumps).toHaveCount(0);
  await page
    .locator('.pc-rail-scroll')
    .evaluate((list) => list.scrollTo({ top: list.scrollHeight, behavior: 'instant' }));
  await expect(page.locator('[data-placement-id="mica-shortcut"]')).toBeInViewport();
  await expect(jumps).toHaveCount(0);
  await emit(page, 'message.start', {}, 'arlo');
  await expect(page.locator('.pc-pin [data-avatar-badge="active"]')).toHaveCount(1);
  await expect(jumps).toHaveCount(0);
});

test('the pinned unread badge determines visibility even while its title is still on screen', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  for (const bot of fixture.state.bots) bot.unread = bot.profile === 'mica';
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile) {
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await expect(page.getByRole('region', { name: 'navigation', exact: true })).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
  }
  await page.locator('.pc-rail-scroll').evaluate((list) => {
    const badge = list.querySelector('.pc-pin .avatar-status')!.getBoundingClientRect();
    list.scrollTop = badge.bottom - list.getBoundingClientRect().top + 1;
  });
  await expect(
    page.getByRole('button', { name: 'Unread messages above', exact: true }),
  ).toBeVisible();
  const mica = page
    .locator('.pc-pin')
    .filter({ has: page.getByRole('button', { name: /^Mica .*Bot Chat$/ }) });
  const label = mica.locator('strong');
  await expect(label).toBeInViewport();
});
