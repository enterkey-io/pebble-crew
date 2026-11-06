import { expect, test } from '@playwright/test';

test('wrong password shows a readable sign-in error and leaves the form available for retry', async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined }),
  );
  await page.route('**/api/instance/status', (route) =>
    route.fulfill({ json: { setupRequired: false } }),
  );
  await page.route('**/api/auth/get-session', (route) => route.fulfill({ json: null }));
  await page.route('**/api/auth/sign-in/username', (route) =>
    route.fulfill({
      status: 401,
      json: { code: 'INVALID_USERNAME_OR_PASSWORD', message: 'Invalid username or password' },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const username = page.getByLabel('Username', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  await username.fill('owner');
  await password.fill('incorrect-test-password');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await submit.click();
  const error = page.getByRole('alert');
  await expect(error).toHaveText('Incorrect username or password.');
  await expect(error).toBeInViewport();
  await expect(password).toHaveAccessibleDescription('Incorrect username or password.');
  await expect(username).toHaveValue('owner');
  await expect(submit).toBeEnabled();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('invalid-password.png') });
});
