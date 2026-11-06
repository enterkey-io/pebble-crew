import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

for (const colorScheme of ['light', 'dark'] as const) {
  test(`resolved mentions preserve history and only open a profile in ${colorScheme} mode`, async ({
    page,
    context,
  }, info) => {
    await page.emulateMedia({ colorScheme });
    const source =
      'Hello **@tina**, @legacy-tina and @friend-7c18d43223d1407e. `@tina`\n\nhttps://example.test/@tina person@tina.test @unknown\n\n```text\n@tina\n```';
    const ownerText = 'Please  ask @tina\nKeep `@tina` and @unknown.';
    const nativeProfile = 'friend-7c18d43223d1407e';
    const events = [
      {
        seq: 1,
        event_id: 'mention-agent',
        kind: 'message.member',
        actor: { id: 'arlo', profile: 'arlo' },
        created_at: 1700000000,
        payload: { text: source },
      },
      {
        seq: 2,
        event_id: 'mention-owner',
        kind: 'message.user',
        created_at: 1700000100,
        payload: { text: ownerText },
      },
    ];
    const fixture = await installFixture(context, {
      messages: [
        { row_id: 1, role: 'assistant', text: source },
        { row_id: 2, role: 'user', text: ownerText },
      ],
      roomMembers: [
        { profile: 'arlo', member_id: 'arlo' },
        {
          profile: nativeProfile,
          member_id: nativeProfile,
          handle: 'legacy-tina',
          target: { kind: 'local', profile: nativeProfile },
        },
      ],
      roomLog: (params) => ({
        room_key: 'a'.repeat(64),
        reaction_revision: 0,
        reaction_updates: [],
        events: events.filter((event) => event.seq > Number(params.since_seq ?? 0)),
        cursor: 2,
        has_more: false,
      }),
    });
    const tina = fixture.state.bots[1]!;
    tina.name = 'Tina';
    tina.handle = 'tina';
    tina.profile = nativeProfile;
    tina.description = 'Synthetic mention profile';
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/v1/rpc') return;
      const { operation } = request.postDataJSON();
      if (/send|update|create|delete|trigger|run|start|dispatch/.test(operation))
        writes.push(operation);
    });
    await page.goto('/');
    const field = page.getByLabel('Message', { exact: true });
    await expect(field).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await field.fill('Unsent synthetic draft');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            sessionStorage.setItem('mention-copy', text);
          },
        },
      });
    });
    const log = page.getByRole('log');
    const mention = log.getByRole('button', { name: "View Tina's profile", exact: true });
    await expect(mention).toHaveCount(4);
    const before = [...writes];
    await mention.first().focus();
    await page.keyboard.press('Enter');
    const profile = page.getByRole('dialog', { name: "Tina's profile", exact: true });
    await expect(profile).toContainText('@tina');
    await expect(profile).toContainText('Synthetic mention profile');
    await expect(profile.getByRole('button')).toHaveCount(0);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`mention-profile-${colorScheme}.png`),
    });
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    await expect(mention.first()).toBeFocused();
    await expect(field).toHaveValue('Unsent synthetic draft');
    const agent = log.locator('[data-message-role="assistant"]').first();
    await agent.getByRole('button', { name: 'Copy message', exact: true }).click();
    expect(await page.evaluate(() => sessionStorage.getItem('mention-copy'))).toBe(source);
    expect(await log.locator('[data-message-role="user"] p').textContent()).toBe(ownerText);
    await expect(mention.first()).toHaveCSS('text-decoration-line', 'underline');
    await expect(mention.first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(log.locator('a[href="https://example.test/@tina"]')).toHaveText(
      'https://example.test/@tina',
    );
    await expect(log.locator('pre')).toContainText('@tina');
    if (info.project.use.isMobile)
      await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: /^Research crew / }).click();
    await expect(field).toBeEnabled();
    await expect(mention).toHaveCount(4);
    await log
      .getByRole('button', { name: "View Tina's profile", exact: true })
      .filter({ hasText: '@legacy-tina' })
      .click();
    await expect(profile).toContainText('@tina');
    await expect(profile).toContainText('Synthetic mention profile');
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    const stableIds = await mention.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-mention-id')),
    );
    expect(new Set(stableIds)).toEqual(new Set([tina.id]));
    expect(writes).toEqual(before);
    expect(tina.profile).toBe('friend-7c18d43223d1407e');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.mouse.move(0, 0);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath(`mentions-group-${colorScheme}.png`),
    });
  });
}
