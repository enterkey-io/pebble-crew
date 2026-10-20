import { test, expect } from '@playwright/test';
import { installFixture, emit } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('reactions clear readable content and message actions for both authors and rich content', async ({
  page,
  context,
}, info) => {
  const messages = [
    { row_id: 1, role: 'user', text: 'Yes.' },
    { row_id: 2, role: 'assistant', text: 'Done.' },
    {
      row_id: 3,
      role: 'user',
      text: 'A longer message with several lines of readable text. '.repeat(8),
    },
    {
      row_id: 4,
      role: 'assistant',
      text: '## Results\n\n```js\nconst ready = true;\n```\n\nThe final line must stay readable.',
    },
    { row_id: 5, role: 'assistant', text: '| Item | State |\n| --- | --- |\n| Draft | Ready |' },
  ].map((message) => ({ ...message, timestamp: 1700000000 + message.row_id }));
  await installFixture(context, { messages });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  for (const message of messages) {
    const row = page.locator(`[data-message-id="${message.row_id}"]`);
    if (message.row_id < 3) {
      await row.getByRole('button', { name: 'React to message', exact: true }).click();
      await page.getByRole('menuitem', { name: 'React with thumbs up', exact: true }).click();
    } else {
      await emit(page, 'message.reaction', {
        row_id: message.row_id,
        reactions: [{ emoji: '👍', author: 'agent' }],
        role: message.role,
      });
    }
    await expect(row.locator('[data-slot="bubble-reactions"] button')).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`reaction-${message.row_id}.png`),
    });
    const collisions = await row.evaluate((node) => {
      const glyph = node
        .querySelector('[data-slot="bubble-reactions"] button > span')!
        .getBoundingClientRect();
      const surface = node.querySelector(
        '[data-slot="bubble-content"], [data-slot="message-response"]',
      )!;
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
      const hits: string[] = [];
      const edge = surface.getBoundingClientRect().bottom;
      if (glyph.top >= edge - 4 || glyph.bottom <= edge + 4)
        hits.push('reaction must straddle the message edge');
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (
          !text.textContent?.trim() ||
          text.parentElement?.closest('[data-slot="bubble-reactions"]')
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const bounds of range.getClientRects())
          if (
            glyph.left < bounds.right &&
            glyph.right > bounds.left &&
            glyph.top < bounds.bottom + 2 &&
            glyph.bottom > bounds.top - 2
          )
            hits.push(text.textContent);
      }
      const footer = node.querySelector('[data-slot="message-footer"]')!.getBoundingClientRect();
      if (glyph.bottom > footer.top - 2) hits.push('message footer');
      return hits;
    });
    expect(
      collisions,
      `Reaction on ${message.role} message ${message.row_id} covers content`,
    ).toEqual([]);
  }
});

test('sidebar row media and two-line identity remain centered and contained', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  Object.assign(fixture.state.bots[2]!, {
    name: 'Chloe',
    preview: "Hi Elliott — it's me, same Chloe, same memories.",
  });
  fixture.state.bots[2]!.role.title = "Aurora's Assistant";
  Object.assign(fixture.state.bots[3]!, {
    name: 'Brenna',
    preview: "Hi, I'm @brenna. Same Brenna you know.",
  });
  fixture.state.bots[3]!.role.title = 'LIFT Assistant';
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (page.viewportSize()!.width < 768)
    await page.getByLabel('Toggle navigation', { exact: true }).click();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('sidebar-identities.png'),
  });
  for (const name of ['Chloe', 'Brenna']) {
    const row = page
      .locator('.pebble-row')
      .filter({ has: page.getByRole('button', { name: new RegExp(`^${name} .*Bot Chat$`) }) });
    const geometry = await row.evaluate((node) => {
      const row = node.getBoundingClientRect();
      const avatar = node.querySelector('.agent-avatar')!.getBoundingClientRect();
      const identity = node
        .querySelector('.pc-row-copy,[data-slot="item-content"]')!
        .getBoundingClientRect();
      return {
        avatarOffset: avatar.y + avatar.height / 2 - (row.y + row.height / 2),
        identityOffset: identity.y + identity.height / 2 - (row.y + row.height / 2),
        top: identity.top - row.top,
        bottom: row.bottom - identity.bottom,
      };
    });
    expect(Math.abs(geometry.avatarOffset)).toBeLessThan(2);
    expect(Math.abs(geometry.identityOffset)).toBeLessThan(2);
    expect(geometry.top).toBeGreaterThanOrEqual(8);
    expect(geometry.bottom).toBeGreaterThanOrEqual(8);
  }
});

test('agent switching retains the current conversation until the replacement is ready', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const message = page.getByLabel('Message', { exact: true });
  await expect(message).toBeEnabled();
  await message.fill('Keep the Arlo draft');
  await page.evaluate(() => {
    const flashes: string[] = [];
    Object.assign(window, { __conversationFlashes: flashes });
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll('h1,h2')].some(
          (node) => node.textContent === 'Choose a conversation',
        )
      )
        flashes.push('empty picker');
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = false;
  await page.route('**/v1/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation === 'bot.open' && request.params.profile === 'mica') {
      waiting = true;
      await held;
    }
    await route.fallback();
  });
  try {
    if (page.viewportSize()!.width < 768)
      await page.getByLabel('Toggle navigation', { exact: true }).click();
    await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
    await expect.poll(() => waiting).toBe(true);
    await expect(page.locator('.chat-title')).toContainText('Arlo');
    await expect(message).toHaveValue('Keep the Arlo draft');
    await expect(message).toHaveJSProperty('readOnly', true);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('heading', { name: 'Choose a conversation', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: info.outputPath('switch-pending.png') });
    release();
    await expect(message).toBeEnabled();
    await expect(page.locator('.chat-title')).toContainText('Mica');
    await expect(message).toHaveValue('');
    expect(
      await page.evaluate(
        () => (window as unknown as { __conversationFlashes: string[] }).__conversationFlashes,
      ),
    ).toEqual([]);
  } finally {
    release();
  }
});

test('a failed switch leaves the current conversation and draft usable', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  const message = page.getByLabel('Message', { exact: true });
  await expect(message).toBeEnabled();
  await message.fill('Keep this draft');
  await page.route('**/v1/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation === 'bot.open' && request.params.profile === 'mica')
      await route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
    else await route.fallback();
  });
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Mica .*Bot Chat$/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(message).toBeEnabled();
  await expect(message).toHaveValue('Keep this draft');
  await expect(page.locator('.chat-title')).toContainText('Arlo');
  await expect(
    page.getByRole('heading', { name: 'Choose a conversation', exact: true }),
  ).toHaveCount(0);
});

test('a late conversation response cannot replace a newer selection or its draft', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  const message = page.getByLabel('Message', { exact: true });
  await expect(message).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = false;
  await page.route('**/v1/rpc', async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation === 'bot.open' && request.params.profile === 'mica') {
      waiting = true;
      await held;
    }
    await route.fallback();
  });
  const open = async (name: string) => {
    if (page.viewportSize()!.width < 768)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${name} .*Bot Chat$`) }).click();
  };
  try {
    await open('Mica');
    await expect.poll(() => waiting).toBe(true);
    await open('Sage');
    await expect(message).toBeEnabled();
    await expect(page.locator('.chat-title')).toContainText('Sage');
    await message.fill('The Sage draft');
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/v1/rpc') &&
        r.request().postDataJSON().operation === 'bot.open' &&
        r.request().postDataJSON().params.profile === 'mica',
    );
    release();
    await response;
    await expect(page.locator('.chat-title')).toContainText('Sage');
    await expect(message).toHaveValue('The Sage draft');
  } finally {
    release();
  }
});
