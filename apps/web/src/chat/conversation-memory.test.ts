import { expect, it } from 'vitest';
import { StreamHandoff } from '@hermes-client/protocol';
import { ConversationMemory } from './conversation-memory';
import type { ConversationView } from './conversation-memory';
import { WorkProgress } from './activity';
import { SendProjection } from './send-projection';
import { cardsWithinHistory } from './presentation';

function view(profile: string, text = 'Saved message'): ConversationView {
  return {
    profile,
    sessionId: 'session-' + profile,
    messages: [{ id: '1', role: 'assistant', text }],
    stream: '',
    running: false,
    activity: '',
    older: 'older-1',
    projection: new SendProjection(),
    handoff: new StreamHandoff(),
    progress: new WorkProgress(),
    binding: { connection: {}, epoch: 1 },
    calls: [],
    read: undefined,
    blocked: false,
    attachmentUncertain: false,
  };
}
it('returns the same inactive view and releases it when it becomes active', () => {
  const memory = new ConversationMemory();
  memory.bind('owner-a');
  const cached = view('alpha');
  memory.remember('bot-a', cached);
  expect(memory.take('bot-a', 'alpha')).toBe(cached);
  expect(memory.take('bot-a', 'alpha')).toBeUndefined();
});
it('evicts by memory and recency rather than keeping every opened conversation', () => {
  const memory = new ConversationMemory(1200, 2);
  memory.remember('a', view('alpha', 'x'.repeat(200)));
  memory.remember('b', view('beta', 'x'.repeat(200)));
  expect(memory.take('a', 'alpha')).toBeUndefined();
  expect(memory.take('b', 'beta')).toBeDefined();
  memory.remember('too-large', view('alpha', 'x'.repeat(2000)));
  expect(memory.take('too-large', 'alpha')).toBeUndefined();
  const small = new ConversationMemory(10000, 2);
  for (const key of ['a', 'b', 'c']) small.remember(key, view(key));
  expect(small.take('a', 'a')).toBeUndefined();
  expect(small.take('b', 'b')).toBeDefined();
  expect(small.take('c', 'c')).toBeDefined();
});
it('does not reuse a different profile or owner’s view', () => {
  const memory = new ConversationMemory();
  memory.bind('owner-a');
  memory.remember('bot-a', view('alpha'));
  expect(memory.take('bot-a', 'beta')).toBeUndefined();
  memory.remember('bot-a', view('alpha'));
  memory.bind('owner-b');
  expect(memory.take('bot-a', 'alpha')).toBeUndefined();
  memory.remember('bot-a', view('alpha'));
  memory.clear();
  expect(memory.take('bot-a', 'alpha')).toBeUndefined();
});
it('keeps resolved receipts inside the loaded history window while pending input remains visible', () => {
  const messages = [{ id: '4', role: 'user' as const, text: 'Recent', timestamp: 1700000400 }];
  const cards = [
    { id: 'old', createdAt: 1700000100 * 1000, content: 'Approved' },
    { id: 'recent', createdAt: 1700000500 * 1000, content: 'Approved' },
    { id: 'pending', createdAt: 1700000100 * 1000, content: 'Needs input', needsInput: true },
  ];
  expect(cardsWithinHistory(messages, cards, true).map((card) => card.id)).toEqual([
    'recent',
    'pending',
  ]);
  expect(cardsWithinHistory(messages, cards, false)).toBe(cards);
});
