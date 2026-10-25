import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture, emit } from './fixtures';

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
            generation: 1,
            next: null,
            restart: false,
            requests: [
              {
                id: 'delete-long-profile',
                actor: 'retired-agent',
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
  await indicator.click();
  const card = page.locator('.request-card').first();
  await expect(card.getByRole('heading', { name: 'Delete pebble', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('requests.png'), animations: 'disabled' });
  const panel = page.locator('[aria-label="Conversation"]');
  await card.getByRole('button', { name: 'Read more', exact: true }).click();
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
    .include('.request-card')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await deletion.click();
  await expect(card.getByRole('button', { name: 'Delete permanently', exact: true })).toHaveCount(
    0,
  );
  expect(confirmed).toBe(profile);
  await expect(
    page.locator('[data-slot="approval-receipt"]').filter({ hasText: profile }),
  ).toContainText('Approved');
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
          generation: 1,
          next: null,
          restart: false,
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
  await expect(page.getByRole('tab', { name: 'Requests', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Change tools and skills', exact: true }),
  ).toBeVisible();
});

test('new pending approvals remain visible when optional receipt history fails', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation !== 'requests.list') return route.fallback();
    if (params.view === 'recent')
      return route.fulfill({ status: 503, json: { code: 'RPC_FAILED' } });
    return route.fulfill({
      json: {
        result: {
          generation: 1,
          next: null,
          requests: [
            {
              id: 'pending-without-history',
              actor: 'arlo',
              action: 'agent.attach',
              state: 'pending',
              fingerprint: 'native-request',
              spec: { profile: 'mica', toolsets: ['browser'] },
            },
          ],
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('[data-request-id="pending-without-history"]')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Change tools and skills', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Pending requests could not be loaded.', { exact: true }),
  ).toHaveCount(0);
});

test('background request failures keep the composer, draft and focus until discovery recovers', async ({
  page,
  context,
}, testInfo) => {
  await page.clock.install();
  await installFixture(context);
  let failing = false,
    failures = 0,
    receipts = 0;
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation !== 'requests.list') return route.fallback();
    if (failing) {
      failures++;
      return route.fulfill({ status: 503, json: { code: 'RPC_FAILED' } });
    }
    if (params.view === 'recent') receipts++;
    return route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await expect.poll(() => receipts).toBeGreaterThan(0);
  await field.fill('Keep this unsent draft');
  const element = await field.elementHandle();
  failing = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.clock.fastForward(5500);
    await expect.poll(() => failures).toBe(attempt);
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Keep this unsent draft');
    await expect(page.getByRole('region', { name: 'Waiting for your input' })).toHaveCount(0);
    expect(await field.evaluate((node, previous) => node === previous, element)).toBe(true);
    if (attempt < 3)
      await expect(page.getByRole('status', { name: 'Request updates', exact: true })).toHaveCount(
        0,
      );
  }
  const status = page.getByRole('status', { name: 'Request updates', exact: true });
  await expect(status).toBeVisible();
  await field.pressSequentially(' and keep typing');
  await expect(field).toHaveValue('Keep this unsent draft and keep typing');
  await page.screenshot({
    path: testInfo.outputPath('request-recovery.png'),
    animations: 'disabled',
  });
  failing = false;
  await status.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect(field).toHaveValue('Keep this unsent draft and keep typing');
});

test('request changes wait for one active scan and then discover the newest approval', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let hold = false,
    held = false,
    active = 0,
    maximum = 0,
    snapshots = 0;
  let requests: Record<string, unknown>[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('https://hermes.fixture.invalid/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'workspace.snapshot') snapshots++;
    if (operation !== 'requests.list') return route.fallback();
    const rows = params.view === 'pending' ? structuredClone(requests) : [];
    active++;
    maximum = Math.max(maximum, active);
    try {
      if (hold && !held && params.view === 'pending') {
        held = true;
        await barrier;
      }
      return await route.fulfill({
        json: { result: { generation: 1, next: null, requests: rows } },
      });
    } finally {
      active--;
    }
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  hold = true;
  await emit(page, 'requests.changed');
  await expect.poll(() => held).toBe(true);
  requests = [
    {
      id: 'newest-approval',
      actor: 'arlo',
      action: 'agent.attach',
      state: 'pending',
      fingerprint: 'newest',
      spec: { profile: 'mica', toolsets: ['browser'] },
    },
  ];
  try {
    for (let i = 0; i < 4; i++) {
      const before = snapshots;
      await emit(page, 'requests.changed');
      await expect.poll(() => snapshots).toBeGreaterThan(before);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
  } finally {
    release();
  }
  await expect(page.locator('[data-request-id="newest-approval"]')).toBeVisible();
  expect(maximum).toBe(1);
});
