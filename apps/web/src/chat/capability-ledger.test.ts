import { it, expect } from 'vitest';
import { conversationCapabilities } from './capability-ledger';
import { aiCatalog } from '../ui-lab/catalog';
it('derives scope-specific access from bridge flags without enabling unverified native operations', () => {
  const bridge = {
    supportsAttachments: true,
    supportsGeneratedMedia: true,
    supportsReactions: true,
    supportsRoomReactions: true,
    supportsLiveVoice: true,
    supportsSecrets: true,
    supportsComputer: true,
  };
  const bot = conversationCapabilities(bridge, 'bot');
  expect(bot).toMatchObject({ attachments: true, reactions: true, voice: true, secrets: true });
  expect(Object.keys(bot.patterns).sort()).toEqual(aiCatalog.map((x) => x.id).sort());
  for (const key of [
    'checkpoint',
    'context',
    'inline-citation',
    'plan',
    'queue',
    'reasoning',
    'sources',
    'stack-trace',
    'test-results',
  ] as const)
    expect(bot.patterns[key]).toBe('unverified');
  expect(conversationCapabilities(bridge, 'room')).toMatchObject({
    attachments: false,
    reactions: true,
    voice: false,
    secrets: false,
  });
  expect(conversationCapabilities(null, 'none')).toMatchObject({
    attachments: false,
    reactions: false,
    voice: false,
    secrets: false,
  });
  expect(
    conversationCapabilities({ ...bridge, supportsRoomReactions: false }, 'room').reactions,
  ).toBe(false);
  expect(conversationCapabilities({ ...bridge, supportsLiveVoice: false }, 'bot').voice).toBe(
    false,
  );
});
