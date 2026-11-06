import { describe, expect, it } from 'vitest';
import { fixtureState } from '../../../../test/chat-workspace/fixtures';
import { messageMentions } from './mentions';
import { plainMentions } from './mention-markdown';

function roster() {
  const bots = fixtureState().bots;
  const tina = bots[1]!;
  tina.handle = 'tina';
  tina.name = 'Tina';
  tina.profile = 'friend-7c18d43223d1407e';
  return { bots, tina };
}

describe('message mention identity', () => {
  it('binds public, native and frozen local roster aliases to the unchanged identity', () => {
    const { bots, tina } = roster();
    const mentions = messageMentions(bots, [
      {
        members: [
          {
            profile: tina.profile,
            handle: 'legacy-tina',
            target: { kind: 'local', profile: tina.profile },
          },
          {
            profile: tina.profile,
            handle: 'remote-tina',
            target: { kind: 'remote', profile: tina.profile },
          },
          {
            profile: tina.profile,
            handle: 'wrong-tina',
            target: { kind: 'local', profile: 'other' },
          },
          { profile: 'unknown', handle: 'unknown' },
        ],
      },
    ]);
    expect(mentions.get('tina')).toBe(tina);
    expect(mentions.get(tina.profile)).toBe(tina);
    expect(mentions.get('legacy-tina')).toBe(tina);
    for (const token of ['remote-tina', 'wrong-tina', 'unknown'])
      expect(mentions.has(token)).toBe(false);
    expect(tina.profile).toBe('friend-7c18d43223d1407e');
  });

  it('leaves ambiguous aliases and deleted or unenrolled identities unresolved', () => {
    const { bots, tina } = roster();
    bots[2]!.enrolled = false;
    bots[3]!.deleted = true;
    const mentions = messageMentions(bots, [
      {
        members: [
          { profile: tina.profile, handle: 'arlo' },
          { profile: tina.profile, handle: 'shared-alias' },
          { profile: bots[0]!.profile, handle: 'shared-alias' },
        ],
      },
    ]);
    for (const token of ['arlo', 'shared-alias', bots[2]!.handle, bots[3]!.handle])
      expect(mentions.has(token)).toBe(false);
  });

  it('preserves owner plaintext and excludes Markdown code, links and email contexts', () => {
    const { bots } = roster();
    const mentions = messageMentions(bots, []);
    const text =
      'Hello  **@TINA**\n\n`@tina`\n```\n@tina\n```\nhttps://example.test/@tina\nname@tina.test\n[@tina](https://example.test)\n\\@tina\n@tina-extra\nBye @tina!';
    const matches = plainMentions(text, mentions);
    expect(matches.map((m) => text.slice(m.start, m.end))).toEqual(['@TINA', '@tina']);
    expect(matches.every((m) => m.bot.profile === 'friend-7c18d43223d1407e')).toBe(true);
  });
});
