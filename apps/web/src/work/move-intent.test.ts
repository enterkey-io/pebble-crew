import { it, expect } from 'vitest';
import type { WorkTask } from '@hermes-client/protocol';
import { moveIntent } from './move-intent';

const task: WorkTask = {
  id: 'one',
  title: 'Read sources',
  body: '',
  status: 'todo',
  assignee: 'aurora',
  priority: 0,
  projectId: null,
  result: null,
  revision: 'first',
};

it('rebases a move over text changes without overwriting the native text', () => {
  expect(moveIntent(task, { ...task, body: 'Native edit', revision: 'second' }, 'blocked')).toBe(
    'move',
  );
});
it('accepts a pause across native queue promotion without requeueing a running worker', () => {
  expect(moveIntent(task, { ...task, status: 'running' }, 'blocked')).toBe('move');
  expect(moveIntent(task, { ...task, status: 'running' }, 'ready')).toBe('already');
});
it('does not reopen completed work or act on a replacement assignee', () => {
  expect(moveIntent(task, { ...task, status: 'done' }, 'ready')).toBe('changed');
  expect(moveIntent(task, { ...task, assignee: 'mica' }, 'blocked')).toBe('changed');
});
