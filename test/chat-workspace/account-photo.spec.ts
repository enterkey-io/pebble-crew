import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installFixture } from './fixtures';
import {
  encodeOwnerPhoto,
  photoPixels,
  OWNER_PHOTO_BYTES,
} from '../../packages/owner-service/src/photo';

test.use({ serviceWorkers: 'block' });

test('personal photos have no shape controls, persist on reload and keep a chat draft during reconnect', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  let image: string | null = null;
  let saves = 0;
  let fail = false;
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({ json: { user: { id: 'owner', image }, session: { id: 'owner-session' } } }),
  );
  await page.route('**/api/owner/photo', async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { error: 'Photo could not be saved.' } });
    const pixels = photoPixels(route.request().postDataJSON());
    if (pixels) expect(pixels.length).toBe(OWNER_PHOTO_BYTES);
    image = pixels ? await encodeOwnerPhoto(pixels) : null;
    saves++;
    await route.fulfill({ json: { image } });
  });
  await page.goto('/');
  const message = page.getByLabel('Message', { exact: true });
  await expect(message).toBeEnabled();
  await message.fill('Keep my draft');
  const phone = page.viewportSize()!.width < 768;
  async function openPhoto() {
    if (phone && !(await page.getByRole('dialog', { name: 'navigation' }).isVisible()))
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Your photo', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Account', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    return page.getByRole('region', { name: 'Settings', exact: true });
  }
  const dialog = await openPhoto();
  await expect(dialog.getByRole('group', { name: 'Avatar shape' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
  const input = dialog.getByLabel('Your photo', { exact: true });
  await input.setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: await readFile('apps/web/public/icons/pebble-192.png'),
  });
  await expect(dialog.getByRole('button', { name: 'Change photo', exact: true })).toBeEnabled();
  await expect
    .poll(() => dialog.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(192);
  const saved = image;
  await page.evaluate(() => (window as unknown as { __breakStream: () => void }).__breakStream());
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveAttribute('src', saved!);
  for (const pin of await page.locator('.pc-pin-open').all())
    await expect(pin).toHaveCSS('opacity', '1');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('account-photo.png') });
  fail = true;
  await input.setInputFiles({
    name: 'another.png',
    mimeType: 'image/png',
    buffer: await readFile('apps/web/public/icons/pebble-180.png'),
  });
  await expect(dialog.getByRole('alert')).toContainText('Photo could not be saved.');
  await expect(dialog.locator('img')).toHaveAttribute('src', saved!);
  fail = false;
  await input.setInputFiles({
    name: 'invalid.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg onload="alert(1)"/>'),
  });
  await expect(dialog.getByRole('alert')).toContainText('JPEG');
  expect(saves).toBe(1);
  await dialog.getByRole('button', { name: 'Close Settings', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: 'navigation' });
  if (phone && (await navigation.isVisible()))
    await navigation.getByRole('button', { name: 'Close navigation' }).click();
  await expect(message).toHaveValue('Keep my draft');
  await page.reload();
  await expect(message).toBeEnabled();
  const restored = await openPhoto();
  await expect(restored.locator('img')).toHaveAttribute('src', saved!);
  await restored.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(restored.getByRole('button', { name: 'Choose photo', exact: true })).toBeEnabled();
  await expect(restored.locator('img')).toHaveCount(0);
  expect(saves).toBe(2);
});
