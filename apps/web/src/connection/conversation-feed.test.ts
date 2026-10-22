import { describe, expect, it, vi } from 'vitest';
import { ClientError } from '@hermes-client/core';
import { ConversationFeed } from './conversation-feed';

function fixture() {
  let target = {
    profile: 'synthetic',
    sessionId: 'before',
    identity: {},
    generation: 1,
    mutation: 0,
    pending: false,
  };
  let reply: (value: unknown) => void = () => {};
  const invoke = vi.fn(
    async () =>
      new Promise<unknown>((resolve) => {
        reply = resolve;
      }),
  );
  const apply = vi.fn((snapshot: { sessionId: string }) => {
    target.sessionId = snapshot.sessionId;
  });
  const receive = vi.fn(async () => {});
  const feed = new ConversationFeed({
    client: { invoke, supportsConnectionRecovery: true },
    target: () => ({ ...target }),
    apply,
    receive,
  });
  return {
    feed,
    apply,
    receive,
    invoke,
    target: () => target,
    select: () => {
      target = { ...target, identity: {}, generation: target.generation + 1 };
    },
    reply: (session = 'before') => reply({ session_id: session, messages: [], running: false }),
  };
}
describe('conversation recovery barriers', () => {
  it('uses a read-only snapshot for a stream gap and coalesces concurrent reads', async () => {
    const h = fixture();
    const first = h.feed.recover(false),
      second = h.feed.recover(false);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('chat.snapshot', { session_id: 'before' });
    h.reply();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });
  it('accepts an explicit-open snapshot only for the recovery revision it covered', async () => {
    const h = fixture();
    h.target().pending = true;
    h.feed.cover(h.target().identity, 2);
    expect(await h.feed.recover(true, 2)).toBe(true);
    expect(h.invoke).not.toHaveBeenCalled();
    h.target().pending = false;
    const gap = h.feed.recover(false, 3);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('chat.snapshot', { session_id: 'before' });
    h.reply();
    expect(await gap).toBe(true);
  });
  it('rebinds only a changed conversation without replacing browser authority', async () => {
    const h = fixture();
    h.invoke.mockRejectedValueOnce(new ClientError('CONVERSATION_CHANGED'));
    expect(await h.feed.recover(false)).toBe(false);
    const retry = h.feed.recover(false);
    expect(h.invoke).toHaveBeenLastCalledWith('bot.open', { profile: 'synthetic' });
    h.reply('after');
    expect(await retry).toBe(true);
  });
  it('replays a new-session delta after a rebind snapshot, including a racing completion', async () => {
    const h = fixture();
    const flight = h.feed.recover(true);
    await h.feed.event({
      type: 'message.delta',
      session_id: 'after',
      payload: { text: 'new reply' },
    });
    await h.feed.event({ type: 'message.complete', session_id: 'after' });
    expect(h.receive).not.toHaveBeenCalled();
    h.reply('after');
    expect(await flight).toBe(true);
    expect(h.target().sessionId).toBe('after');
    expect(h.receive.mock.calls).toHaveLength(2);
    expect(h.apply.mock.invocationCallOrder[0]).toBeLessThan(
      h.receive.mock.invocationCallOrder[0]!,
    );
  });
  it('rejects a snapshot overtaken by a send and asks for another read', async () => {
    const h = fixture();
    const flight = h.feed.recover(false);
    h.target().mutation++;
    h.reply();
    expect(await flight).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
  });
  it('does not read over a pending mutation or apply a read after selection changes', async () => {
    const h = fixture();
    h.target().pending = true;
    expect(await h.feed.recover(false)).toBe(false);
    expect(h.invoke).not.toHaveBeenCalled();
    h.target().pending = false;
    const flight = h.feed.recover(false);
    h.select();
    h.reply();
    expect(await flight).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
  });
  it('re-reads after an unversioned reaction crosses the snapshot barrier', async () => {
    const h = fixture();
    const flight = h.feed.recover(false);
    await h.feed.event({
      type: 'message.reaction',
      session_id: 'before',
      payload: { emoji: '👍' },
    });
    h.reply();
    expect(await flight).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.receive).not.toHaveBeenCalled();
    const retry = h.feed.recover(false);
    h.reply();
    expect(await retry).toBe(true);
  });
});
