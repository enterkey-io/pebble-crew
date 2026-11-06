import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emit, installFixture } from './fixtures';
import { expectPinRoleContrast } from './pinned-layout';

test.use({ serviceWorkers: 'block' });
test('appearance is applied before the application module starts', async ({ page, context }) => {
  await installFixture(context);
  await context.addInitScript(() => localStorage.setItem('pebble-crew.appearance', 'light'));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/workspace-*.js', async (route) => {
    await held;
    await route.continue();
  });
  const navigation = page.goto('/');
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await navigation;
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

async function openGeneral(page: import('@playwright/test').Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

test('General appearance follows the system or an explicit choice, persists and themes the installed screens', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openGeneral(page);
  const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
  await expect(appearance).toContainText('System');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance.click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openGeneral(page);
  await expect(appearance).toContainText('Dark');
  await appearance.click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 249, 246)');
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('general-light.png') });
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('chat-light.png') });
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Available Hermes agents' })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('agent-picker-light.png'),
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('sidebar resizes from its edge, keeps row contents inside, supports keyboard and remembers its width', async ({
  page,
  context,
}, info) => {
  test.skip(page.viewportSize()!.width < 768, 'Phones use the navigation drawer.');
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const rail = page.getByRole('complementary', { name: 'Pebbles and crews', exact: true });
  const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  await expect(rail).toHaveCSS('width', '352px');
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(700, bounds.y + 100, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(650);
  const expanded = (await rail.boundingBox())!.width;
  await expect
    .poll(() => page.evaluate(() => Number(localStorage.getItem('pebble-crew.sidebar-width'))))
    .toBeGreaterThan(650);
  const containment = await page.locator('.pebble-row').evaluateAll((rows) =>
    rows.every((row) => {
      const boundary = row.getBoundingClientRect();
      return [...row.querySelectorAll('[data-slot="item-content"], .pc-overflow')].every(
        (child) => {
          const box = child.getBoundingClientRect();
          return box.left >= boundary.left && box.right <= boundary.right;
        },
      );
    }),
  );
  expect(containment).toBe(true);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('sidebar-expanded.png') });
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(Math.abs((await rail.boundingBox())!.width - expanded)).toBeLessThan(2);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await rail.boundingBox())!.width).toBeLessThan(expanded);
  await handle.dblclick();
  await expect(rail).toHaveCSS('width', '352px');
});

test('the account stays at the visible bottom while the roster scrolls', async ({
  page,
  context,
}, info) => {
  const phone = !!info.project.use.isMobile;
  await page.setViewportSize({ width: phone ? 390 : 1440, height: phone ? 620 : 500 });
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();

  const rail = phone
    ? page.getByRole('region', { name: 'navigation', exact: true })
    : page.getByRole('complementary', { name: 'Pebbles and crews', exact: true });
  const list = rail.locator('.pc-rail-scroll');
  const position = () =>
    rail.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const footer = node.querySelector('footer')!.getBoundingClientRect();
      const account = node.querySelector('footer button')!;
      const button = account.getBoundingClientRect();
      const hit = document.elementFromPoint(
        button.left + button.width / 2,
        button.top + button.height / 2,
      );
      return {
        gap: Math.round(
          bounds.bottom - footer.bottom - parseFloat(getComputedStyle(node).paddingBottom),
        ),
        bottom: Math.round(footer.bottom),
        viewportBottom: Math.round(window.visualViewport?.height ?? window.innerHeight),
        accountHit: hit !== null && account.contains(hit),
      };
    });
  await expect.poll(position).toMatchObject({ accountHit: true, gap: 0 });
  const before = await position();
  expect(before.bottom).toBeLessThanOrEqual(before.viewportBottom);
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await position()).toEqual(before);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('sidebar-docked-account.png'),
  });
  await rail.getByRole('button', { name: 'Your account', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
});

test('pinned pebbles wrap at a readable width and photos stay circular', async ({
  page,
  context,
}, info) => {
  const phone = page.viewportSize()!.width < 768;
  if (phone) await page.setViewportSize({ width: 320, height: 720 });
  await context.addInitScript(() => {
    localStorage.setItem('pebble-crew.sidebar-width', '280');
    localStorage.setItem('pebble-crew.appearance', 'light');
  });
  const fixture = await installFixture(context);
  const [main, , third] = fixture.state.bots;
  main!.appearance.kind = 'photo';
  third!.pinned = true;
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const paint = canvas.getContext('2d')!;
    const backdrop = paint.createLinearGradient(0, 0, 960, 600);
    backdrop.addColorStop(0, '#2e666e');
    backdrop.addColorStop(1, '#96d9c0');
    paint.fillStyle = backdrop;
    paint.fillRect(0, 0, 960, 600);
    paint.fillStyle = '#244756';
    paint.beginPath();
    paint.moveTo(0, 600);
    paint.lineTo(340, 220);
    paint.lineTo(610, 520);
    paint.lineTo(780, 340);
    paint.lineTo(960, 550);
    paint.lineTo(960, 600);
    paint.fill();
    return canvas.toDataURL('image/png');
  });
  let releasePhoto!: () => void;
  const heldPhoto = new Promise<void>((resolve) => {
    releasePhoto = resolve;
  });
  let photoRequests = 0;
  await page.route('https://hermes.fixture.invalid/**/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'bots.appearance.get' && params.profile === 'arlo') {
      photoRequests++;
      await heldPhoto;
      await route.fulfill({ json: { result: { data: photo } } });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const headerPhoto = page.locator('.pc-chat-identity .agent-avatar > img');
  if (phone) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();

  const rail = phone
    ? page.getByRole('region', { name: 'navigation', exact: true })
    : page.getByRole('complementary', { name: 'Pebbles and crews', exact: true });
  const pins = rail.locator('.pc-pins');
  const tiles = pins.getByRole('button', { name: /Bot Chat$/ });
  await expect(tiles).toHaveCount(3);
  await expect(rail).toHaveCSS('width', phone ? '320px' : '280px');
  const pinAvatar = tiles.first().locator('.agent-avatar');
  const pinPhoto = pinAvatar.locator('img');
  try {
    await expect.poll(() => photoRequests).toBe(1);
    await expect(pinAvatar.locator(':scope > img, :scope > svg')).toHaveCount(0);
    await expect(headerPhoto).toHaveCount(0);
  } finally {
    releasePhoto();
  }
  await expect(headerPhoto).toHaveCSS('border-radius', '50%');
  await expect(pinPhoto).toHaveCSS('border-radius', '50%');
  await expect(pinPhoto).toHaveCSS('object-fit', 'cover');
  await expect(pinPhoto).toHaveCSS('overflow', 'hidden');
  await expect
    .poll(() => pinPhoto.evaluate((image) => image.getBoundingClientRect().width))
    .toBe(await pinPhoto.evaluate((image) => image.getBoundingClientRect().height));
  await expect(tiles.first().getByRole('img', { name: 'Main Pebble' })).toBeVisible();
  await expect(tiles.nth(1).getByText('Executive assistant')).toBeVisible();
  const selected = tiles.first().locator('..');
  const idle = tiles.nth(1).locator('..');
  const idleBackground = await idle.evaluate((tile) => getComputedStyle(tile).backgroundColor);
  await expectPinRoleContrast(pins);
  if (!phone) {
    const selectedBackground = await selected.evaluate(
      (tile) => getComputedStyle(tile).backgroundColor,
    );
    await tiles.first().hover();
    await selected.evaluate((tile) =>
      Promise.all(tile.getAnimations().map((animation) => animation.finished)),
    );
    await expect(selected).toHaveCSS('background-color', selectedBackground);
    await tiles.nth(1).hover();
    await expect(idle).not.toHaveCSS('background-color', idleBackground);
  }
  await rail.screenshot({
    animations: 'disabled',
    path: info.outputPath('light-pin-tiles.png'),
  });
  await expectPinRoleContrast(pins);

  const cardLayout = () =>
    tiles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const title = node.querySelector('.pc-pin-title')!.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          height: rect.height,
          width: rect.width,
          titleInset: Math.min(title.left - rect.left, rect.right - title.right),
        };
      }),
    );
  await expect.poll(async () => new Set((await cardLayout()).map((card) => card.top)).size).toBe(2);
  const cards = await cardLayout();
  expect(cards[0]!.top).toBe(cards[1]!.top);
  expect(cards[2]!.top).toBeGreaterThan(cards[1]!.top);
  expect(Math.min(...cards.map((card) => card.width))).toBeGreaterThanOrEqual(100);
  expect(Math.min(...cards.map((card) => card.titleInset))).toBeGreaterThanOrEqual(7.5);
  expect(Math.max(...cards.map((card) => card.height))).toBeLessThan(150);
  expect(photoRequests).toBe(1);
  expect(await pins.evaluate((node) => node.scrollWidth)).toBe(
    await pins.evaluate((node) => node.clientWidth),
  );

  if (phone) {
    await page.setViewportSize({ width: 390, height: 720 });
  } else {
    await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).dblclick();
  }
  await expect.poll(async () => new Set((await cardLayout()).map((card) => card.top)).size).toBe(1);
});

test('reopening a section reuses its photo and an edited photo refreshes', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, {
    organization: {
      revision: 1,
      sections: [
        { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
        {
          id: 'design',
          name: 'Design',
          collapsed: false,
          items: [3, 4].map((index) => ({
            kind: 'pebble',
            id: `identity-${index}`,
            placementId: `row-${index}`,
            shortcut: false,
          })),
        },
      ],
    },
  });
  fixture.state.bots[3]!.appearance.kind = 'photo';
  const [original, edited] = await page.evaluate(() =>
    ['#334b53', '#879d65'].map((color) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL();
    }),
  );
  let photo = original;
  let reads = 0;
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'bots.appearance.get' && params.profile === 'sage') {
      reads++;
      await route.fulfill({ json: { result: { data: photo } } });
    } else await route.fallback();
  });

  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const section = page.getByRole('button', { name: 'Design', exact: true });
  const sage = page.getByRole('button', { name: /^Sage .*Bot Chat$/ });
  const ember = page.getByRole('button', { name: /^Ember .*Bot Chat$/ });
  const avatar = sage.locator('.agent-avatar > img');
  await expect(avatar).toHaveAttribute('src', original!);
  await section.click();
  await expect(sage).toHaveCount(0);
  await section.click();
  await expect(avatar).toHaveAttribute('src', original!);
  await expect(ember.locator('svg.avatar')).toBeVisible();
  expect(reads).toBe(1);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('reopened-section.png') });

  photo = edited;
  fixture.state.revision++;
  await emit(page, 'workspace.changed');
  await expect(avatar).toHaveAttribute('src', edited!);
  expect(reads).toBe(2);
});

test('cold sidebar photo avatars arrive in bounded batches without per-profile RPCs', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, { avatarThumbnails: true });
  const template = fixture.state.bots[2]!;
  while (fixture.state.bots.filter((bot) => bot.managed).length < 35) {
    const index = fixture.state.bots.length;
    const profile = `photo-${index}`;
    fixture.state.bots.push({
      ...template,
      profile,
      id: `identity-${index}`,
      handle: profile,
      name: `Photo Pebble ${index}`,
      read_key: `bot:identity-${index}`,
    });
  }
  for (const bot of fixture.state.bots) bot.appearance = { ...bot.appearance, kind: 'photo' };
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = '#4a746c';
    paint.fillRect(0, 0, 32, 32);
    return canvas.toDataURL();
  });
  const requests: string[][] = [];
  let individual = 0;
  await page.route('https://hermes.fixture.invalid/**/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'bots.appearance.get') individual++;
    if (operation !== 'bots.appearance.thumbnails') return route.fallback();
    const profiles = (params.targets as { profile: string }[]).map((target) => target.profile);
    requests.push(profiles);
    return route.fulfill({
      json: { result: { photos: Object.fromEntries(profiles.map((profile) => [profile, photo])) } },
    });
  });
  for (let load = 0; load < 2; load++) {
    requests.length = 0;
    if (load === 0) await page.goto('/');
    else await page.reload();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    const list = page.getByRole('navigation', { name: 'Pebbles', exact: true });
    await expect(list.locator(':is(.pc-pin, .pebble-row) .agent-avatar img')).toHaveCount(35);
    expect(individual).toBe(0);
    expect(requests.every((batch) => batch.length > 0 && batch.length <= 8)).toBe(true);
    expect(requests.length).toBeLessThanOrEqual(6);
    expect(new Set(requests.flat()).size).toBe(35);
  }
  await page.screenshot({
    path: info.outputPath('batched-photo-avatars.png'),
    animations: 'disabled',
  });
});
