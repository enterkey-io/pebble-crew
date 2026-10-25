import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

test('native slash suggestions use the open conversation and commands never become model messages', async ({
  page,
  context,
}) => {
  await installFixture(context);
  const commands: string[] = [],
    prompts: string[] = [];
  await page.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'chat.commands') {
      expect(params.session_id).toBe('session-arlo');
      return route.fulfill({
        json: {
          result: {
            items:
              params.text === '/'
                ? [
                    { text: 'model', label: '/model', description: 'Change model' },
                    { text: 'context', label: '/context', description: 'Inspect context' },
                    { text: 'status', label: '/status', description: 'Session status' },
                  ]
                : [],
            replace_from: 1,
          },
        },
      });
    }
    if (operation === 'chat.command') {
      expect(params.session_id).toBe('session-arlo');
      commands.push(params.text);
      if (params.text === '/reset')
        return route.fulfill({ status: 400, json: { code: 'UNSUPPORTED_COMMAND' } });
      return route.fulfill({
        json: {
          result: {
            output:
              params.text === '/status'
                ? 'Native session status.'
                : 'Model changed to synthetic-model.',
          },
        },
      });
    }
    if (operation === 'chat.send') prompts.push(params.text);
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('/');
  await expect(page.getByRole('option', { name: '/model Change model' })).toBeVisible();
  const suggestions = page.locator('[data-slot="command"][aria-label="Hermes commands"]');
  const assertAnchored = async () => {
    // The dock resizes both surfaces; compare geometry from the same frame.
    const geometry = await suggestions.evaluate((menu) => {
      const composer = menu.closest('.composer-wrap')?.querySelector('[data-slot="prompt-input"]');
      if (!composer) throw new Error('The command menu lost its composer');
      const popup = menu.getBoundingClientRect(),
        input = composer.getBoundingClientRect();
      return {
        left: popup.left - input.left,
        width: popup.width - input.width,
        gap: input.top - popup.bottom,
      };
    });
    expect(Math.abs(geometry.left)).toBeLessThan(1);
    expect(Math.abs(geometry.width)).toBeLessThan(1);
    expect(geometry.gap).toBeCloseTo(8, 0);
  };
  await assertAnchored();
  if (!page.viewportSize() || page.viewportSize()!.width > 767) {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await assertAnchored();
    await page.getByRole('button', { name: /Show details$/ }).click();
    await expect(page.getByRole('button', { name: /Hide details$/ })).toBeVisible();
    await expect(page.locator('.pc-details')).toBeInViewport({ ratio: 0.999 });
    await assertAnchored();
  }
  await page.screenshot({
    path: `test-results/verification/slash-commands-${page.viewportSize()?.width}.png`,
  });
  await field.press('Enter');
  await expect(field).toHaveValue('/model ');
  await field.fill('/model synthetic-model');
  await field.press('Enter');
  await expect(
    page
      .getByRole('log')
      .getByRole('region', { name: '/model synthetic-model result', exact: true }),
  ).toContainText('Model changed to synthetic-model.');
  expect(commands).toEqual(['/model synthetic-model']);
  expect(prompts).toEqual([]);
  await field.fill('/s');
  const list = suggestions;
  await expect(list.getByRole('option')).toHaveCount(1);
  const node = await list.elementHandle();
  await field.press('t');
  await expect(
    list.getByRole('option', { name: '/status Session status', exact: true }),
  ).toBeVisible();
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  await field.press('a');
  await expect(page.getByRole('status', { name: 'Loading commands' })).toHaveCount(0);
  await field.press('Enter');
  await expect(
    page.getByRole('log').getByRole('region', { name: '/status result', exact: true }),
  ).toContainText('Native session status.');
  expect(commands).toEqual(['/model synthetic-model', '/status']);
  await expect(field).toHaveValue('');
  await field.fill('/reset');
  await field.press('Enter');
  await expect(page.locator('.banner')).toContainText('not supported in Pebble Crew');
  await expect(field).toHaveValue('/reset');
  expect(prompts).toEqual([]);
});
