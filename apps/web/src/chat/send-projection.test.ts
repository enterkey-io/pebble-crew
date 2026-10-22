import { it, expect } from 'vitest';
import { SendProjection } from './send-projection';
import type { ChatMessage } from '../conversation';

it('a native receipt without a timestamp keeps the visible send time', () => {
  const view = new SendProjection();
  view.begin(
    {
      role: 'user',
      text: 'Hello',
      id: 'pending',
      renderKey: 'pending',
      timestamp: '2026-10-16T17:00:00Z',
    },
    [],
  );
  view.acknowledge(5, 'pending');
  expect(view.project([{ id: '5', role: 'user', text: 'Hello' }])[0]?.timestamp).toBe(
    '2026-10-16T17:00:00Z',
  );
});

it('keeps the streamed time when Hermes commits a different completion time', () => {
  const view = new SendProjection();
  view.beginReply();
  const timestamp = view.reply.timestamp;
  view.completeReply(9);
  expect(
    view.project([{ id: '9', role: 'assistant', text: 'Done', timestamp: 1 }], true)[0]?.timestamp,
  ).toBe(timestamp);
});
it('keeps one bubble and its render identity when history beats a delayed receipt', () => {
  const view = new SendProjection(),
    pending: ChatMessage & { id: string; renderKey: string } = {
      id: 'pending-a',
      renderKey: 'pending-a',
      role: 'user',
      text: 'Again',
      timestamp: '2026-10-16T12:00:00Z',
    };
  expect(view.begin(pending, [])[0]?.timestamp).toBe(pending.timestamp);
  expect(
    view
      .project([
        { id: '11', role: 'user', text: 'Again' },
        { id: '12', role: 'assistant', text: 'Here' },
      ])
      .map((m) => m.id),
  ).toEqual(['pending-a', '12']);
  expect(view.acknowledge(11, 'pending-a').map((m) => m.renderKey ?? m.id)).toEqual([
    'pending-a',
    '12',
  ]);
  expect(view.project([{ id: '11', role: 'user', text: 'Again' }])[0]?.renderKey).toBe('pending-a');
});
it('does not conflate another browser sending the same text and releases legacy pending only on authoritative completion', () => {
  const view = new SendProjection();
  view.begin({ id: 'pending-b', renderKey: 'pending-b', role: 'user', text: 'Same' }, []);
  view.project([
    { id: '1', role: 'user', text: 'Same' },
    { id: '2', role: 'user', text: 'Same' },
  ]);
  expect(view.acknowledge('2', 'pending-b').map((m) => m.renderKey ?? m.id)).toEqual([
    '1',
    'pending-b',
  ]);
  const legacy = new SendProjection();
  legacy.begin({ id: 'pending-old', renderKey: 'pending-old', role: 'user', text: 'Same' }, []);
  legacy.acknowledge(undefined, 'pending-old');
  expect(legacy.project([{ id: '9', role: 'user', text: 'Same' }], true).map((m) => m.id)).toEqual([
    '9',
  ]);
});

it('retains the local bubble if completion beats the submit receipt', () => {
  const view = new SendProjection();
  view.begin({ id: 'pending-fast', renderKey: 'pending-fast', role: 'user', text: 'Hi' }, []);
  expect(
    view
      .project(
        [
          { id: '1', role: 'user', text: 'Hi' },
          { id: '2', role: 'assistant', text: 'Done' },
        ],
        true,
      )
      .map((m) => m.renderKey ?? m.id),
  ).toEqual(['pending-fast', '2']);
  expect(view.acknowledge(1, 'pending-fast').map((m) => m.renderKey ?? m.id)).toEqual([
    'pending-fast',
    '2',
  ]);
});

it('seals live intervals around repeated sends and accepts independent native receipts', () => {
  const view = new SendProjection();
  const local = (id: string) => ({ id, renderKey: id, role: 'user' as const, text: 'Again' });
  view.begin(local('first'), []);
  let messages = view.acknowledge(1, 'first');
  view.beginReply();
  view.begin(local('second'), messages, 'A');
  messages = view.acknowledge(undefined, 'second');
  view.begin(local('third'), messages, 'AB');
  messages = view.acknowledge(undefined, 'third');
  expect(view.display(messages, 'ABC').messages.map((row) => [row.role, row.text])).toEqual([
    ['user', 'Again'],
    ['assistant', 'A'],
    ['user', 'Again'],
    ['assistant', 'B'],
    ['user', 'Again'],
    ['assistant', 'C'],
  ]);
  const settled = view.project(
    [
      { id: '1', role: 'user', text: 'Again' },
      { id: '2', role: 'assistant', text: 'A' },
      { id: '3', role: 'user', text: 'Again' },
      { id: '4', role: 'assistant', text: 'B' },
      { id: '5', role: 'user', text: 'Again' },
      { id: '6', role: 'assistant', text: 'C' },
      { id: '7', role: 'user', text: 'Again from another browser' },
    ],
    true,
  );
  expect(settled.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(settled[0]?.renderKey).toBe('first');
});

it('keeps a native deferred send after the current reply until the next turn starts', () => {
  const view = new SendProjection();
  view.beginReply();
  view.begin({ id: 'follow', renderKey: 'follow', role: 'user', text: 'Next' }, [], 'A');
  let messages = view.acknowledge(undefined, 'follow', true);
  expect(view.display(messages, 'AB').messages.map((row) => row.text)).toEqual(['AB', 'Next']);
  messages = view.project([{ id: '2', role: 'assistant', text: 'AB' }], true);
  expect(view.display(messages, '').messages.map((row) => row.text)).toEqual(['AB', 'Next']);
  view.beginReply();
  messages = view.project([{ id: '2', role: 'assistant', text: 'AB' }]);
  expect(view.display(messages, 'C').messages.map((row) => row.text)).toEqual(['AB', 'Next', 'C']);
});

it('restores only an anchored native live span and does not infer identity from repeated prose', () => {
  const view = new SendProjection();
  const history: { messages: ChatMessage[] } = {
    messages: [
      { id: '1', role: 'user', text: 'Again' },
      { id: '2', role: 'assistant', text: 'Old' },
      { id: '3', role: 'user', text: 'Again' },
      { id: '4', role: 'assistant', text: 'A😀' },
      { id: '5', role: 'user', text: 'Change' },
    ],
  };
  const restored = view.restore({
    history,
    activeUserId: '3',
    running: true,
    inflight: 'A😀B',
    corrections: [{ text: 'Change', offset: 3, rowId: '5' }],
  });
  expect(view.display(restored.messages, restored.stream).messages.map((row) => row.text)).toEqual([
    'Again',
    'Old',
    'Again',
    'A😀',
    'Change',
    'B',
  ]);
  const unsupported = new SendProjection().restore({
    history,
    activeUserId: undefined,
    running: true,
    inflight: 'A😀B',
    corrections: [{ text: 'Change', offset: 3, rowId: undefined }],
  });
  expect(unsupported.messages.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5']);
  expect(unsupported.stream).toBe('');
});

it('retains accepted follow-ups when the native snapshot cannot anchor the live span', () => {
  const view = new SendProjection();
  view.beginReply();
  const original: ChatMessage = { id: '1', role: 'user', text: 'Start' };
  view.begin({ id: 'local', renderKey: 'local', role: 'user', text: 'Change' }, [original], 'A');
  const messages = view.acknowledge(undefined, 'local');
  const restored = view.restore({
    history: { messages: [original] },
    activeUserId: undefined,
    running: true,
    inflight: 'AB',
    corrections: [{ text: 'Change', offset: 1, rowId: undefined }],
  });
  expect(view.display(restored.messages, restored.stream).messages.map((row) => row.text)).toEqual([
    'Start',
    'A',
    'Change',
    'B',
  ]);
  expect(messages).toContainEqual(expect.objectContaining({ id: 'local' }));
});

it('keeps un-covered native user rows after the restored live reply', () => {
  const view = new SendProjection();
  const restored = view.restore({
    history: {
      messages: [
        { id: '1', role: 'user', text: 'Start' },
        { id: '2', role: 'assistant', text: 'A' },
        { id: '3', role: 'user', text: 'Redirect' },
        { id: '4', role: 'user', text: 'Native deferred fallback' },
      ],
    },
    activeUserId: '1',
    running: true,
    inflight: 'AB',
    corrections: [{ text: 'Redirect', offset: 1, rowId: '3' }],
  });
  expect(view.display(restored.messages, restored.stream).messages.map((row) => row.text)).toEqual([
    'Start',
    'A',
    'Redirect',
    'B',
    'Native deferred fallback',
  ]);
});

it('retires live cuts after an offline completion and restores native deferred envelopes', () => {
  const view = new SendProjection();
  view.beginReply();
  view.begin({ id: 'local', renderKey: 'local', role: 'user', text: 'Change' }, [], 'A');
  view.acknowledge(undefined, 'local');
  const restored = view.restore({
    history: {
      messages: [
        { id: '1', role: 'user', text: 'Change' },
        { id: '2', role: 'assistant', text: 'Done' },
      ],
    },
    running: false,
    activeUserId: undefined,
    inflight: '',
    corrections: [],
  });
  expect(view.display(restored.messages, restored.stream).messages.map((row) => row.text)).toEqual([
    'Change',
    'Done',
  ]);
  expect(view.replying).toBe(false);
  const waiting = view.restore({
    history: { messages: [{ id: '3', role: 'user', text: 'Start' }] },
    running: true,
    activeUserId: '3',
    inflight: 'Working',
    corrections: [],
    deferred: [{ text: 'Accepted fallback', rowId: undefined }],
  });
  expect(view.display(waiting.messages, waiting.stream).messages.map((row) => row.text)).toEqual([
    'Start',
    'Working',
    'Accepted fallback',
  ]);
});

it('restores fresh deferred envelopes without an anchor and updates merged text only by native row id', () => {
  const view = new SendProjection();
  const restored = view.restore({
    history: { messages: [{ id: '4', role: 'user', text: 'Old queued text' }] },
    running: true,
    activeUserId: undefined,
    inflight: 'Work',
    corrections: [],
    deferred: [
      { rowId: '4', text: 'Old queued text\n\nMore accepted text' },
      { rowId: undefined, text: 'Another fallback' },
    ],
  });
  expect(view.display(restored.messages, restored.stream).messages.map((row) => row.text)).toEqual([
    'Work',
    'Old queued text\n\nMore accepted text',
    'Another fallback',
  ]);
});

it('removes only a proven undispatched optimistic row while preserving the prior conversation', () => {
  const view = new SendProjection();
  view.begin({ id: 'not-sent', renderKey: 'not-sent', role: 'user', text: 'retry me' }, [
    { id: 'old', role: 'assistant', text: 'existing' },
  ]);
  expect(view.cancelUnsent('not-sent').map((row) => row.id)).toEqual(['old']);
});
