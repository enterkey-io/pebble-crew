import { describe, expect, it } from 'vitest';
import { nativeMessages } from '../conversation';
import { messageReactions, reactionReceipt, RoomReactionProjection } from './reactions';

describe('native message reactions', () => {
  it('keeps multiple group agents and ignores an older poll after a local reaction receipt', () => {
    const projection = new RoomReactionProjection();
    const reactions = messageReactions([
      { emoji: '👍', author: 'agent', actor: 'a', name: 'Arlo' },
      { emoji: '❤️', author: 'agent', actor: 'b', name: 'Mica' },
    ]);
    expect(reactions).toHaveLength(2);
    projection.accept({ key: 'group', revision: 2, updates: [{ id: 'message-a', reactions }] });
    projection.accept({ key: 'group', revision: 1, updates: [{ id: 'message-a', reactions: [] }] });
    expect(
      projection.project([{ id: 'message-a', role: 'user', text: 'Thanks' }])[0]?.reactions,
    ).toEqual(reactions);
    projection.accept({ key: 'group', revision: 3, updates: [{ id: 'message-a', reactions: [] }] });
    expect(
      projection.project([{ id: 'message-a', role: 'user', text: 'Thanks' }])[0]?.reactions,
    ).toEqual([]);
    projection.accept({ key: 'replacement', revision: 0, updates: [] });
    expect(
      projection.project([{ id: 'message-a', role: 'user', text: 'New chat' }])[0]?.reactions,
    ).toBeUndefined();
  });
  it('preserves both authors from native history and removes internal seen metadata', () => {
    const [message] = nativeMessages([
      {
        row_id: 12,
        role: 'assistant',
        text: 'Ready',
        display_metadata: {
          reactions: [
            { emoji: '👍', author: 'user', seen: true },
            { emoji: '❤️', author: 'agent' },
          ],
        },
      },
    ]);
    expect(message?.reactions).toEqual([
      { emoji: '👍', author: 'user' },
      { emoji: '❤️', author: 'agent' },
    ]);
    expect(
      messageReactions([{ emoji: 'x', author: 'unknown' }, null, { author: 'agent' }]),
    ).toEqual([]);
  });
  it('addresses only a durable native row and handles a cleared reaction list', () => {
    expect(reactionReceipt({ row_id: 12, reactions: [] })).toEqual({ id: '12', reactions: [] });
    for (const value of [
      { row_id: '12', reactions: [] },
      { row_id: -1, reactions: [] },
      { row_id: true, reactions: [] },
      { row_id: 12 },
    ])
      expect(() => reactionReceipt(value)).toThrow();
  });
});
