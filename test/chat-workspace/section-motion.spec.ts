import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('a section heading stays still as closing finishes and rapid toggles remain usable', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    organization: {
      revision: 0,
      sections: [
        { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
        {
          id: 'research',
          name: 'Research',
          collapsed: false,
          items: Array.from({ length: 10 }, (_, i) => ({
            kind: 'pebble' as const,
            id: `identity-${i + 2}`,
            placementId: `section-row-${i}`,
            shortcut: false,
          })),
        },
      ],
    },
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile) {
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await expect(page.locator('.pc-mobile-navigation')).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
  }
  const toggle = page
    .getByRole('region', { name: 'Research', exact: true })
    .getByRole('button', { name: /^Research/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const samples = toggle.evaluate(async (button) => {
    const name = button.querySelector('span')!;
    const frames: { y: number; height: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < 750) {
      const rect = name.getBoundingClientRect();
      frames.push({ y: rect.y, height: rect.height });
      await new Promise(requestAnimationFrame);
    }
    return frames;
  });
  await toggle.click();
  const frames = await samples;
  expect(Math.max(...frames.map((f) => f.y)) - Math.min(...frames.map((f) => f.y))).toBeLessThan(1);
  expect(
    Math.max(...frames.map((f) => f.height)) - Math.min(...frames.map((f) => f.height)),
  ).toBeLessThan(0.5);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const bounds = (await toggle.boundingBox())!;
  for (let i = 0; i < 3; i++) {
    if (info.project.use.isMobile)
      await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    else await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.waitForTimeout(60);
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('img', { name: 'Hermes connected', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Rowan .*Bot Chat$/ }).click();
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toHaveAttribute('placeholder', 'Message Rowan');
  await input.fill('The sidebar is still responsive');
  await expect(input).toHaveValue('The sidebar is still responsive');
});
