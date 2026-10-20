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
      return route.fulfill({ json: { result: { output: 'Model changed to synthetic-model.' } } });
    }
    if (operation === 'chat.send') prompts.push(params.text);
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('/');
  await expect(page.getByRole('option', { name: '/model Change model' })).toBeVisible();
  await page.screenshot({
    path: `test-results/verification/slash-commands-${page.viewportSize()?.width}.png`,
  });
  await field.press('Enter');
  await expect(field).toHaveValue('/model ');
  await field.fill('/model synthetic-model');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Model changed to synthetic-model.');
  expect(commands).toEqual(['/model synthetic-model']);
  expect(prompts).toEqual([]);
  await field.fill('/reset');
  await field.press('Enter');
  await expect(page.locator('.banner')).toContainText('not supported in Pebble Crew');
  await expect(field).toHaveValue('/reset');
  expect(prompts).toEqual([]);
});
