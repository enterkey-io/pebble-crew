import { expect, it } from 'vitest';
import { StreamHandoff } from './stream-position';

it('merges the snapshot and continuous Unicode deltas without losing or duplicating text', () => {
  const handoff = new StreamHandoff();
  const position = (offset: number, turn = 1) => ({ epoch: 'test', turn, offset });
  handoff.restore(position(4), true);
  expect(handoff.accept('message.start', position(0)).accepted).toBe(false);
  expect(handoff.accept('message.delta', position(2), 'A😀').accepted).toBe(false);
  expect(handoff.accept('message.delta', position(6), 'BCD😀').text).toBe('D😀');
  expect(handoff.accept('message.delta', position(7), 'E').text).toBe('E');
  expect(handoff.accept('message.complete', position(7)).accepted).toBe(true);
  expect(handoff.accept('message.complete', position(7)).accepted).toBe(false);
  expect(handoff.accept('message.start', position(0, 2)).accepted).toBe(true);
  expect(handoff.accept('message.delta', position(7), 'stale').accepted).toBe(false);
});
