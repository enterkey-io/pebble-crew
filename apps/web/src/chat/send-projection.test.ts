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
  view.acknowledge(5);
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
  expect(view.acknowledge(11).map((m) => m.renderKey ?? m.id)).toEqual(['pending-a', '12']);
  expect(view.project([{ id: '11', role: 'user', text: 'Again' }])[0]?.renderKey).toBe('pending-a');
});
it('does not conflate another browser sending the same text and releases legacy pending only on authoritative completion', () => {
  const view = new SendProjection();
  view.begin({ id: 'pending-b', renderKey: 'pending-b', role: 'user', text: 'Same' }, []);
  view.project([
    { id: '1', role: 'user', text: 'Same' },
    { id: '2', role: 'user', text: 'Same' },
  ]);
  expect(view.acknowledge('2').map((m) => m.renderKey ?? m.id)).toEqual(['1', 'pending-b']);
  const legacy = new SendProjection();
  legacy.begin({ id: 'pending-old', renderKey: 'pending-old', role: 'user', text: 'Same' }, []);
  legacy.acknowledge(undefined);
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
  expect(view.acknowledge(1).map((m) => m.renderKey ?? m.id)).toEqual(['pending-fast', '2']);
});
