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
  it('uses only an exact native group-send receipt, not the outgoing browser id', async () => {
    const edit = { roomId: 'group-a', eventId: 'outgoing-id', text: 'Hello' };
    const event = { room_id: 'group-a', event_id: 'user:native-hash', kind: 'message.user' };
    const receipt = { accepted: true, client_event_id: edit.eventId, event };
    const domain = new ConversationDomain({ invoke: async () => receipt });
    expect(await domain.sendRoom(edit)).toBe('user:native-hash');
    for (const invalid of [
      { ...receipt, accepted: false },
      { ...receipt, client_event_id: 'another-tab' },
      { ...receipt, event: { ...event, room_id: 'foreign' } },
      { ...receipt, event: { ...event, kind: 'message.member' } },
    ]) {
      const rejected = new ConversationDomain({ invoke: async () => invalid });
      await expect(rejected.sendRoom(edit)).rejects.toThrow();
    }
  });
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
      choices: ['once', 'deny'],
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
        return operation === 'room.approve'
          ? { approved: true, result: { resolved: 1 } }
          : { resolved: 1 };
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
      disposition: 'uncertain',
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
  it('decodes native busy send receipts without inventing a row identity', async () => {
    for (const status of ['streaming', 'redirected', 'steered', 'queued']) {
      const domain = new ConversationDomain({ invoke: async () => ({ status }) });
      expect(await domain.send({ sessionId: 's1', text: 'Change direction' })).toEqual({
        accepted: true,
        disposition: status === 'streaming' ? 'started' : status,
        userRowId: undefined,
      });
    }
  });
  it('translates Python correction offsets after emoji and rejects invalid chronology', () => {
    const snapshot = {
      session_id: 's1',
      messages: [],
      running: true,
      active_user_row_id: 3,
      correction_row_ids: [5],
      inflight: { assistant: 'A😀B', corrections: ['Change'], correction_offsets: [2] },
    };
    expect(decodeBotConversation(snapshot).corrections).toEqual([
      { text: 'Change', offset: 3, rowId: '5' },
    ]);
    expect(
      decodeBotConversation({
        ...snapshot,
        inflight: { ...snapshot.inflight, correction_offsets: [9] },
      }).corrections[0]?.offset,
    ).toBeUndefined();
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

it('only confirms an exact native decision when Hermes reports one resolved approval', async () => {
  const target = { kind: 'chat' as const, sessionId: 'session', requestId: 'request' };
  expect(
    await new ConversationDomain({ invoke: async () => ({ resolved: 1 }) }).decide(target, 'once'),
  ).toBe('resolved');
  expect(
    await new ConversationDomain({ invoke: async () => ({ resolved: 0 }) }).decide(target, 'once'),
  ).toBe('expired');
  await expect(
    new ConversationDomain({ invoke: async () => ({}) }).decide(target, 'once'),
  ).rejects.toThrow();
});

it('reads the native room decision envelope without mistaking expired approval for success', async () => {
  const target = {
    kind: 'room' as const,
    roomId: 'room',
    memberId: 'member',
    taskId: 'task',
    executionGeneration: 1,
    requestId: 'approval',
  };
  expect(
    await new ConversationDomain({
      invoke: async () => ({ approved: true, result: { resolved: 0 } }),
    }).decide(target, 'once'),
  ).toBe('expired');
  expect(
    await new ConversationDomain({
      invoke: async () => ({ approved: true, result: { resolved: 1 } }),
    }).decide(target, 'once'),
  ).toBe('resolved');
});

it('keeps verified uploaded Markdown cards separate from owner-authored message text', () => {
  const files = ['a', 'b', 'c'].map((letter) => ({
    id: letter.repeat(43),
    name: `${letter}.md`,
    size: 42,
  }));
  const messages = decodeNativeMessages([
    { role: 'user', row_id: 17, text: 'Use these references.', shared_files: files },
  ]);
  expect(messages[0]?.text).toBe('Use these references.');
  expect(messages[0]?.files).toEqual(files);
  expect(() =>
    decodeNativeMessages([
      { role: 'user', text: '', shared_files: [{ ...files[0], id: '../private' }] },
    ]),
  ).toThrow();
});

it('keeps native process completion and automation out of owner-authored messages', () => {
  const history = decodeHistory({
    messages: [
      { role: 'user', row_id: 1, text: 'Actual owner question' },
      {
        role: 'user',
        row_id: 2,
        text: 'PRIVATE_PROCESS_OUTPUT',
        display_kind: 'process_complete',
        display_metadata: { display_text: 'Background process finished' },
      },
      { role: 'user', row_id: 3, text: 'PRIVATE_WAKE', display_kind: 'internal_notification' },
      { role: 'assistant', row_id: 4, text: 'Actual assistant answer' },
      { role: 'user', row_id: 5, text: 'PRIVATE_HIDDEN', display_kind: 'hidden' },
      { role: 'user', row_id: 6, text: 'PRIVATE_FUTURE', display_kind: 'future_automation' },
      {
        role: 'user',
        row_id: 7,
        text: '[IMPORTANT: Background process is what I want to discuss]',
      },
      { role: 'user', row_id: 8, text: 'My correction', display_kind: 'steer' },
    ],
  });
  expect(history.coverage).toEqual({ count: 8, maxRow: 8 });
  expect(history.messages.filter((m) => m.role === 'user').map((m) => m.id)).toEqual([
    '1',
    '7',
    '8',
  ]);
  expect(history.messages.find((m) => m.id === '2')).toMatchObject({
    role: 'tool',
    toolName: 'process',
    text: '',
    context: 'Background process finished',
  });
  expect(JSON.stringify(history)).not.toContain('PRIVATE_');
});

it('does not turn queued or live machinery inputs into restored owner corrections', () => {
  const value = decodeBotConversation({
    session_id: 'native',
    messages: [],
    running: true,
    inflight: {
      assistant: 'Working',
      display_kind: 'process_complete',
      corrections: ['PRIVATE_WAKE'],
    },
    deferred_prompts: [
      { text: 'PRIVATE_QUEUED', display_kind: 'hidden' },
      { text: 'PRIVATE_QUEUED', display_kind: 'process_complete' },
      { text: 'Actual queued owner message', row_id: 8 },
    ],
  });
  expect(value.inflight).toBe('Working');
  expect(value.corrections).toEqual([]);
  expect(value.deferred).toEqual([{ text: 'Actual queued owner message', rowId: '8' }]);
  expect(JSON.stringify(value)).not.toContain('PRIVATE_');
});

it('decodes live assistant row provenance and rejects invalid row references', () => {
  const snapshot = {
    session_id: 'chat',
    running: true,
    messages: [],
    live_assistant_row_ids: [4, 8],
  };
  expect(decodeBotConversation(snapshot).liveAssistantIds).toEqual(['4', '8']);
  for (const value of [[null], [0], [{}]])
    expect(() => decodeBotConversation({ ...snapshot, live_assistant_row_ids: value })).toThrow();
});
