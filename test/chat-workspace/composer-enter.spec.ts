import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('touch Return adds new lines and only the Send button submits, including during a reply', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch keyboard behavior is covered by the phone projects.');
  await installFixture(context);
  const sends: string[] = [];
  let stops = 0;
  await context.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'chat.send') sends.push(params.text);
    if (operation === 'chat.stop') stops++;
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await expect(field).toHaveAttribute('enterkeyhint', 'enter');
  await field.fill('First line');
  await field.press('Enter');
  await field.pressSequentially('Second line');
  await expect(field).toHaveValue('First line\nSecond line');
  expect(sends).toEqual([]);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => sends).toEqual(['First line\nSecond line']);
  await expect(field).toHaveValue('');
  await emit(page, 'message.start');
  await field.fill('A follow-up');
  await field.press('Enter');
  await expect(field).toHaveValue('A follow-up\n');
  expect(sends).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(stops).toBe(0);
});

test('desktop Enter sends while Shift Enter remains a new line', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop keyboard contract.');
  await installFixture(context);
  const sends: string[] = [];
  await context.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation === 'chat.send') sends.push(params.text);
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('First line');
  await field.press('Shift+Enter');
  await field.pressSequentially('Second line');
  await expect(field).toHaveValue('First line\nSecond line');
  expect(sends).toEqual([]);
  await field.press('Enter');
  await expect.poll(() => sends).toEqual(['First line\nSecond line']);
});
