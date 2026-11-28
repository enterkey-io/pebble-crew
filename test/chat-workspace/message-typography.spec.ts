import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

const text =
  'Body text uses the same size for every speaker.\n\n- Body text in a list.\n\n> Body text in a quote.\n\n| Column |\n| --- |\n| Body text in a table. |';
test.use({ serviceWorkers: 'block' });
for (const theme of ['dark', 'light'])
  test(`actual chat text has one body size across speakers, Markdown and live replies in ${theme}`, async ({
    page,
    context,
  }) => {
    await installFixture(context, {
      messages: [
        {
          row_id: 101,
          role: 'user',
          text: 'Body text uses the same size for every speaker.',
          timestamp: 1700100000,
        },
        { row_id: 102, role: 'assistant', text, timestamp: 1700100060 },
        {
          row_id: 103,
          role: 'assistant',
          text: 'A different agent reply uses that same size.',
          timestamp: 1700100120,
        },
      ],
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('pebble-crew.appearance', theme),
      theme,
    );
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    const expected = page.viewportSize()!.width < 768 ? '16px' : '14px';
    const body = page.locator(
      '[data-slot="bubble-content"] p, [data-slot="bubble-content"] li, [data-slot="bubble-content"] blockquote, [data-slot="bubble-content"] td',
    );
    expect(await body.count()).toBeGreaterThanOrEqual(6);
    for (const node of await body.all()) await expect(node).toHaveCSS('font-size', expected);
    await emit(page, 'message.start');
    await emit(page, 'message.delta', { text });
    const live = page.locator(
      '[data-message-phase="live"] .message-body p, [data-message-phase="live"] .message-body li, [data-message-phase="live"] .message-body td',
    );
    await expect(live.first()).toBeVisible();
    for (const node of await live.all()) await expect(node).toHaveCSS('font-size', expected);
  });

test('draft uses compact type without changing the sent message', async ({
  page,
  context,
}, info) => {
  await installFixture(context, {
    messages: [
      { row_id: 101, role: 'assistant', text: 'The first draft is ready.', timestamp: 1700100000 },
    ],
  });
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  const frame = page.locator('[data-slot="prompt-input"]');
  await expect(field).toBeEnabled();
  const empty = (await frame.boundingBox())!;
  const sample = 'Keep the same type.';
  await field.fill(sample);
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(send).toBeEnabled();
  const type = (locator: typeof field) =>
    locator.evaluate((node) => {
      const { fontSize, lineHeight, fontFamily, fontWeight } = getComputedStyle(node);
      return { fontSize, lineHeight, fontFamily, fontWeight };
    });
  const draftType = await type(field);
  const single = (await frame.boundingBox())!;
  const input = (await field.boundingBox())!;
  const action = (await send.boundingBox())!;
  const firstLineCenter = await field.evaluate((node) => {
    const style = getComputedStyle(node);
    return (
      node.getBoundingClientRect().top +
      parseFloat(style.paddingTop) +
      parseFloat(style.lineHeight) / 2
    );
  });
  await page.screenshot({ path: info.outputPath('composer-typing.png'), animations: 'disabled' });

  await field.fill(sample + '\nA second line.');
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(single.height);
  await field.fill(sample);
  await send.click();
  const sent = page.locator('[data-message-role="user"] .message-body p', { hasText: sample });
  await expect(sent).toBeVisible();
  await page.screenshot({ path: info.outputPath('composer-sent.png'), animations: 'disabled' });
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);

  const sentType = await type(sent);
  const narrow = page.viewportSize()!.width < 768;
  expect(sentType).toEqual({
    ...draftType,
    fontSize: narrow ? '16px' : '14px',
    lineHeight: narrow ? '26px' : '22.75px',
  });
  expect(draftType.fontSize).toBe(sentType.fontSize);
  expect(draftType.lineHeight).toBe(narrow ? '24px' : '21px');
  if (touch) {
    expect(parseFloat(draftType.fontSize)).toBeGreaterThanOrEqual(16);
    expect(Math.min(action.width, action.height)).toBeGreaterThanOrEqual(44);
  }
  // Buttons sit 6px inside the field so they never touch its edge.
  expect(single.height).toBeLessThanOrEqual(touch ? 56 : 48);
  expect(single.height).toBe(empty.height);
  expect(Math.abs(firstLineCenter - (action.y + action.height / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(input.y + input.height / 2 - (action.y + action.height / 2))).toBeLessThanOrEqual(
    1,
  );
});

test('wide touch view keeps the original transcript type', async ({ page, context }) => {
  test.skip(
    !(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)),
    'Touch viewport',
  );
  await page.setViewportSize({ width: 900, height: 650 });
  await installFixture(context);
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(field).toBeEnabled();
  await expect(page.locator('[data-slot="bubble-content"]').first()).toHaveCSS('font-size', '14px');
  await expect(field).toHaveCSS('font-size', '14px');
  await page.setViewportSize({ width: 900, height: 430 });
  await expect(field).toHaveCSS('font-size', '16px');
  await expect(page.locator('[data-slot="bubble-content"]').first()).toHaveCSS('font-size', '14px');
});
