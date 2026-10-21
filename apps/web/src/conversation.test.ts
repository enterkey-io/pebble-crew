import { CardPositions, projectTimeline } from './chat/presentation';
import { describe, it, expect } from 'vitest';
import { nativeMessages, roomMessages, messageDate, withSharedFiles } from './conversation';
import type { ChatMessage } from './conversation';
describe('native conversation projection', () => {
  it('retains durable identities and native timestamps without fabricating them', () => {
    const messages = nativeMessages([
      { role: 'assistant', text: 'Hello', row_id: 21, timestamp: 1700000000 },
      { role: 'user', text: 'Hi' },
      { role: 'system', text: 'private context' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: '21', timestamp: 1700000000 });
    expect(messages[1]?.timestamp).toBeUndefined();
    expect(messageDate(1700000000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(messageDate('invalid')).toBeUndefined();
  });
  it('uses actual crew participant identity and excludes control events', () => {
    const messages = roomMessages([
      {
        event_id: 'm1',
        kind: 'message.member',
        actor: { id: 'member-1', profile: 'research' },
        payload: { text: 'Ready' },
        created_at: 1700000000,
      },
      { event_id: 'control', kind: 'task.completed', payload: { text: 'Do not show as chat' } },
      { event_id: 'u1', kind: 'message.user', payload: { text: 'Start' }, created_at: 1700000001 },
    ]);
    expect(messages.map((m) => m.id)).toEqual(['m1', 'u1']);
    expect(messages[0]?.author).toBe('research');
    expect(messages[1]?.role).toBe('user');
  });
});

describe('lossless native timeline presentation', () => {
  it('keeps cards between existing messages as a new owner turn and agent reply arrive', () => {
    const positions = new CardPositions();
    const before: ChatMessage[] = [{ id: '1', role: 'assistant', text: 'Please approve.' }];
    const cards = [{ id: 'request', content: 'Pending' }];
    expect(positions.place(before, cards)[0]?.index).toBe(1);
    const after: ChatMessage[] = [
      ...before,
      { id: 'pending', renderKey: 'owner-turn', role: 'user', text: 'Approved, continue.' },
      { id: 'reply', role: 'assistant', text: 'Continuing.' },
    ];
    expect(positions.place(after, [{ ...cards[0]!, content: 'Approved' }])[0]?.index).toBe(1);
    const timeline = projectTimeline(after, positions.place(after, cards));
    expect(
      timeline.map((row) =>
        row.kind === 'card' ? row.card.id : row.kind === 'message' ? row.message.id : row.id,
      ),
    ).toEqual(['1', 'request', 'pending', 'reply']);
  });
  it('uses persisted creation time on restoration without reordering native messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'assistant', text: 'Before', timestamp: 1700000000 },
      { id: '2', role: 'user', text: 'After', timestamp: 1700000002 },
      { id: '3', role: 'assistant', text: 'Reply', timestamp: 1700000003 },
    ];
    const cards = [
      { id: 'second', createdAt: 1700000001500, content: 'Approved' },
      { id: 'first', createdAt: 1700000001000, content: 'Approved' },
    ];
    expect(
      new CardPositions().place(messages, cards).map(({ index, card }) => [index, card.id]),
    ).toEqual([
      [1, 'first'],
      [1, 'second'],
    ]);
    const positions = new CardPositions();
    const empty = [{ id: 'empty-chat-request', content: 'Pending' }];
    positions.place([], empty);
    expect(positions.place(messages, empty)[0]?.index).toBe(0);
  });
  it('retains native identities but excludes source records, empty/hidden reasoning and groups tools around meaningful final replies', () => {
    const source = [
      { row_id: 1, role: 'assistant', text: '', reasoning: 'private' },
      { row_id: 2, role: 'tool', text: 'Read result', name: 'read_file' },
      { row_id: 3, role: 'assistant', text: '', tool_calls: [{ id: 'x' }] },
      { row_id: 4, role: 'tool', text: 'Failure: unavailable', name: 'write_file' },
      {
        row_id: 5,
        role: 'assistant',
        text: '',
        codex_message_items: JSON.stringify([
          {
            type: 'message',
            role: 'assistant',
            phase: 'analysis',
            content: [{ type: 'output_text', text: 'private' }],
          },
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'Real final' }],
          },
        ]),
      },
    ];
    const messages = nativeMessages(source),
      items = projectTimeline(messages);
    expect(messages.map((m) => m.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(messages[0]).not.toHaveProperty('source');
    expect(JSON.stringify(messages)).not.toContain('private');
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe('activity');
    expect(items[1]).toMatchObject({ kind: 'message', message: { text: 'Real final' } });
    expect(JSON.stringify(items)).not.toContain('Real finalprivate');
  });
  it('replaces only conversation-owned references with file chips', () => {
    const files = [{ id: 'f'.repeat(43), name: 'notes.txt', size: 8 }];
    const result = withSharedFiles(
      [
        {
          role: 'user',
          text: `Read @file:/private/${files[0]!.id}_notes.txt and @file:/private/unrelated.txt`,
        },
      ],
      files,
    );
    expect(result[0]!.text).toContain('unrelated.txt');
    expect(result[0]!.text).not.toContain(files[0]!.id);
    expect(result[0]!.files).toEqual(files);
  });
});
