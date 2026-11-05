import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture } from './fixtures';

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

test('three compact pins fit the narrow sidebar and photos stay circular', async ({
  page,
  context,
}, info) => {
  const phone = page.viewportSize()!.width < 768;
  if (phone) await page.setViewportSize({ width: 320, height: 720 });
  await context.addInitScript(() => localStorage.setItem('pebble-crew.sidebar-width', '280'));
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
  const cards = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    }),
  );
  expect(cards.map((card) => card.top)).toEqual(Array(3).fill(cards[0]?.top));
  expect(Math.max(...cards.map((card) => card.height))).toBeLessThan(150);
  expect(photoRequests).toBe(1);
  expect(await pins.evaluate((node) => node.scrollWidth)).toBe(
    await pins.evaluate((node) => node.clientWidth),
  );
  await rail.screenshot({
    animations: 'disabled',
    path: info.outputPath('compact-photo-pins.png'),
  });
});
