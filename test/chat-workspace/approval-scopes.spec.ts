import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';
test.use({ serviceWorkers: 'block' });

for (const choice of ['session', 'always'] as const) {
  test(`native ${choice} approval is offered inline and sends the exact decision`, async ({
    page,
    context,
  }) => {
    const fixture = await installFixture(context);
    fixture.setApprovals([
      {
        request_id: 'scope-request',
        command: 'Synthetic tool action',
        choices: ['once', 'session', 'always', 'deny'],
      },
    ]);
    let selected = '';
    await page.route('**/v1/rpc', async (route) => {
      const { operation, params } = route.request().postDataJSON();
      if (operation === 'chat.approve') selected = params.choice;
      await route.fallback();
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Approval needed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'More approval options', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(
      menu.getByRole('menuitem', { name: 'Allow for this session', exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: 'Always allow this action', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('approval-scopes.png'),
      animations: 'disabled',
    });
    await menu
      .getByRole('menuitem', {
        name: choice === 'session' ? 'Allow for this session' : 'Always allow this action',
        exact: true,
      })
      .click();
    await expect.poll(() => selected).toBe(choice);
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  });
}

test('once-only approvals never expose broader permission choices', async ({ page, context }) => {
  const fixture = await installFixture(context);
  fixture.setApprovals([
    { request_id: 'restricted', command: 'Restricted synthetic action', choices: ['once', 'deny'] },
  ]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'More approval options', exact: true }),
  ).toHaveCount(0);
});
