import { describe, expect, it } from 'vitest';
import {
  ConversationDomain,
  approvalKey,
  decodeApprovals,
  decodeBotConversation,
  decodeHistory,
  decodeNativeMessages,
  decodeRoomMessages,
} from './conversation-domain';

describe('conversation presentation boundary', () => {
  it('keeps actual receipts and read coverage while removing hidden source fields', () => {
    const data = decodeHistory({
      messages: [
        { role: 'system', row_id: 1, text: 'PRIVATE SYSTEM' },
        {
          role: 'assistant',
          row_id: 2,
          text: '',
          reasoning: 'PRIVATE ANALYSIS',
          display_commentary: ['Reading notes'],
          codex_message_items: JSON.stringify([
            {
              type: 'message',
              role: 'assistant',
              phase: 'analysis',
              content: [{ type: 'output_text', text: 'PRIVATE ANALYSIS' }],
            },
            {
              type: 'message',
              role: 'assistant',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'Public answer' }],
            },
          ]),
        },
        { role: 'user', row_id: 3, text: 'Hello', timestamp: 1700000000 },
      ],
    });
    expect(data.coverage).toEqual({ count: 3, maxRow: 3 });
    expect(data.messages.map((x) => x.id)).toEqual(['2', '3']);
    expect(data.messages[0]).toMatchObject({
      text: 'Public answer',
      commentary: ['Reading notes'],
    });
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
    expect(data.messages[1]?.timestamp).toBe(1700000000);
  });
  it('handles malformed external data and bounds before presentation', () => {
    expect(() => decodeNativeMessages({ messages: [] })).toThrow();
    expect(() => decodeNativeMessages(Array.from({ length: 10001 }, () => null))).toThrow();
    expect(() =>
      decodeNativeMessages([{ role: 'assistant', text: 'x'.repeat(1000001) }]),
    ).toThrow();
    expect(
      decodeNativeMessages([
        null,
        1,
        [],
        { role: 'unknown', text: 'hidden' },
        { role: 'assistant', codex_message_items: '{broken' },
      ]),
    ).toEqual([
      { role: 'assistant', text: '', id: undefined, timestamp: undefined, reactions: [] },
    ]);
  });
  it('requires a native session identity and never guesses a committed timestamp', () => {
    expect(() => decodeBotConversation({ messages: [] })).toThrow();
    expect(
      decodeBotConversation({
        session_id: 'session-1',
        messages: [{ role: 'assistant', row_id: 4, text: 'Hello' }],
        running: true,
        inflight: { assistant: 'Live' },
      }),
    ).toMatchObject({
      sessionId: 'session-1',
      running: true,
      inflight: 'Live',
      history: { messages: [{ id: '4', timestamp: undefined }] },
    });
  });
  it('keeps room member identity and ignores unrelated control messages', () => {
    const result = decodeRoomMessages([
      { kind: 'task.completed', event_id: 'control', payload: { text: 'not chat' } },
      {
        kind: 'message.member',
        event_id: 'm1',
        actor: { profile: 'grace', id: 'member-7' },
        payload: { text: 'Ready' },
      },
      { kind: 'message.user', seq: 2, payload: { text: 'Start' } },
    ]);
    expect(result).toMatchObject([
      { id: 'm1', role: 'assistant', author: 'grace' },
      { id: '2', role: 'user' },
    ]);
  });
  it('carries complete room approval authority and distinguishes replacement generations', () => {
    const [approval] = decodeApprovals(
      [
        {
          request_id: 'r1',
          member_id: 'm1',
          task_id: 't1',
          execution_generation: 2,
          approval: { command: 'read notes' },
        },
      ],
      { kind: 'room', roomId: 'room-1' },
    );
    expect(approval).toEqual({
      description: 'read notes',
      target: {
        kind: 'room',
        roomId: 'room-1',
        memberId: 'm1',
        taskId: 't1',
        executionGeneration: 2,
        requestId: 'r1',
      },
    });
    if (!approval || approval.target.kind !== 'room') throw new Error('Missing fixture');
    expect(approvalKey(approval.target)).not.toBe(
      approvalKey({ ...approval.target, executionGeneration: 3 }),
    );
    expect(() =>
      decodeApprovals([{ request_id: 'r1', member_id: 'm1', task_id: 't1' }], {
        kind: 'room',
        roomId: 'room-1',
      }),
    ).toThrow();
  });
  it('sends only the addressed approval target and allowed decision', async () => {
    const calls: { operation: string; params: Readonly<Record<string, unknown>> }[] = [];
    const domain = new ConversationDomain({
      invoke: async (operation, params) => {
        calls.push({ operation, params });
        return {};
      },
    });
    await domain.decide({ kind: 'chat', sessionId: 's1', requestId: 'r1' }, 'once');
    await domain.decide(
      {
        kind: 'room',
        roomId: 'room-1',
        memberId: 'm1',
        taskId: 't1',
        executionGeneration: 4,
        requestId: 'r2',
      },
      'deny',
    );
    expect(calls).toEqual([
      { operation: 'chat.approve', params: { session_id: 's1', request_id: 'r1', choice: 'once' } },
      {
        operation: 'room.approve',
        params: {
          room_id: 'room-1',
          member_id: 'm1',
          task_id: 't1',
          execution_generation: 4,
          request_id: 'r2',
          choice: 'deny',
        },
      },
    ]);
  });
  it('decodes history and reaction receipts through the same transport boundary', async () => {
    const domain = new ConversationDomain({
      invoke: async (operation) =>
        operation === 'chat.history'
          ? { messages: [{ role: 'assistant', row_id: 10, text: 'Hello' }] }
          : {
              row_id: 10,
              reactions: [
                { emoji: '👍', author: 'user' },
                { emoji: '🎉', author: 'agent' },
              ],
            },
    });
    expect((await domain.history('s1')).messages[0]?.id).toBe('10');
    expect(await domain.react('s1', 10, '👍')).toEqual({
      id: '10',
      reactions: [
        { emoji: '👍', author: 'user' },
        { emoji: '🎉', author: 'agent' },
      ],
    });
    await expect(domain.react('s1', NaN, '👍')).rejects.toThrow();
  });
  it('does not turn queued or uncertain sends into acceptance or retry them', async () => {
    let calls = 0;
    const queued = new ConversationDomain({
      invoke: async () => {
        calls++;
        return { state: 'queued' };
      },
    });
    expect(await queued.send({ sessionId: 's1', text: 'Hello' })).toEqual({
      accepted: false,
      userRowId: undefined,
    });
    const uncertain = new ConversationDomain({
      invoke: async () => {
        calls++;
        throw new Error('Lost receipt');
      },
    });
    await expect(uncertain.send({ sessionId: 's1', text: 'Hello' })).rejects.toThrow(
      'Lost receipt',
    );
    expect(calls).toBe(2);
  });
});

it('accepts only complete authorized shared-file records at the presentation boundary', async () => {
  const file = { id: 'a'.repeat(43), name: 'notes.txt', size: 12, kind: 'file', state: 'sent' };
  const domain = new ConversationDomain({ invoke: async () => ({ files: [file] }) });
  expect(await domain.files('s1')).toEqual([file]);
  const malformed = new ConversationDomain({
    invoke: async () => ({ files: [{ ...file, id: '../../private', size: -1 }] }),
  });
  await expect(malformed.files('s1')).rejects.toThrow();
});
