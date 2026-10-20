import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('request review fits phones, keeps fields readable and confirms the exact deletion', async ({
  page,
  context,
}, testInfo) => {
  await installFixture(context);
  const profile = 'research-assistant-with-a-long-profile-name';
  let state = 'pending';
  let confirmed = '';
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'requests.list')
      return route.fulfill({
        json: {
          result: {
            requests: [
              {
                id: 'delete-long-profile',
                fingerprint: 'delete-exact-profile',
                action: 'agent.delete',
                state,
                spec: {
                  profile,
                  description: 'An existing research assistant with a detailed role to review.',
                  skills: ['research', 'summarize-existing-project-notes-with-checked-sources'],
                  soul: 'Keep this existing personality unchanged until deletion is approved.',
                },
              },
              {
                id: 'completed-role',
                action: 'agent.update',
                state: 'completed',
                spec: {
                  profile: 'mica',
                  role: {
                    title: 'Research assistant',
                    description: 'Verify sources before sharing a result.',
                  },
                },
              },
            ],
          },
        },
      });
    if (operation === 'requests.approve') {
      expect(params.id).toBe('delete-long-profile');
      expect(params.fingerprint).toBe('delete-exact-profile');
      confirmed = params.confirmation;
      state = 'completed';
      return route.fulfill({ json: { result: { state } } });
    }
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const indicator = page.getByRole('button', { name: '1 request to review', exact: true });
  await expect(indicator).toBeVisible();
  const dot = await indicator.evaluate((node) => getComputedStyle(node, '::after').backgroundColor);
  const rgb = dot.match(/\d+/g)?.map(Number);
  expect(rgb?.[2]).toBeGreaterThan((rgb?.[0] ?? 255) + 50);
  expect(rgb?.[2]).toBeGreaterThan((rgb?.[1] ?? 255) + 50);

  const phone =
    testInfo.project.name.includes('iphone') || testInfo.project.name.includes('android');
  if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Requests', exact: true }).click();
  const card = page.locator('.request-card').first();
  await expect(card.getByRole('heading', { name: 'Delete pebble', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('requests.png'), animations: 'disabled' });
  const panel = page.getByRole('tabpanel', { name: 'Requests', exact: true });
  const geometry = await panel.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewport: window.innerWidth,
    cards: [...element.querySelectorAll('.request-card')].map((card) => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }),
    fields: [...element.querySelectorAll('.request-fields > div')].map((field) => {
      const label = field.querySelector('dt')!.getBoundingClientRect();
      const value = field.querySelector('dd')!.getBoundingClientRect();
      return {
        labelBottom: label.bottom,
        valueTop: value.top,
        labelRight: label.right,
        valueLeft: value.left,
      };
    }),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  for (const bounds of geometry.cards) {
    expect(bounds.left).toBeGreaterThanOrEqual(12);
    expect(bounds.right).toBeLessThanOrEqual(geometry.viewport - 12);
  }
  for (const field of geometry.fields) {
    if (phone) expect(field.valueTop - field.labelBottom).toBeGreaterThanOrEqual(3);
    else expect(field.valueLeft - field.labelRight).toBeGreaterThanOrEqual(12);
  }
  if (phone) {
    await page.setViewportSize({ width: 320, height: 740 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
  }
  const deletion = card.getByRole('button', { name: 'Delete permanently', exact: true });
  await expect(deletion).toBeDisabled();
  await card.getByLabel('Confirm profile name', { exact: true }).fill(profile);
  await expect(deletion).toBeEnabled();
  await deletion.scrollIntoViewIfNeeded();
  const target = await deletion.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(phone ? 44 : 36);
  await page.screenshot({
    path: testInfo.outputPath('request-confirmation.png'),
    animations: 'disabled',
  });
  const a11y = await new AxeBuilder({ page })
    .include('.settings-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await deletion.click();
  await expect(card.getByRole('button', { name: 'Delete permanently', exact: true })).toHaveCount(
    0,
  );
  expect(confirmed).toBe(profile);
  await expect(page.getByText('Change completed.', { exact: true })).toBeVisible();
});

test('pending requests use a quiet header icon and respect reduced motion', async ({
  page,
  context,
}, testInfo) => {
  await installFixture(context);
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'requests.list') return route.fallback();
    return route.fulfill({
      json: {
        result: {
          requests: [
            {
              id: 'pending',
              action: 'agent.attach',
              state: 'pending',
              spec: { profile: 'mica', toolsets: ['browser'] },
            },
          ],
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const indicator = page.getByRole('button', { name: '1 request to review', exact: true });
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveText('');
  await expect(indicator.locator('svg')).toHaveCount(1);
  await expect
    .poll(() => indicator.evaluate((button) => getComputedStyle(button, '::after').animationName))
    .not.toBe('none');
  await page.screenshot({
    path: testInfo.outputPath('request-indicator.png'),
    animations: 'disabled',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => indicator.evaluate((button) => getComputedStyle(button, '::after').animationName))
    .toBe('none');
  await indicator.click();
  await expect(page.getByRole('tab', { name: 'Requests', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('heading', { name: 'Change tools and skills', exact: true }),
  ).toBeVisible();
});
