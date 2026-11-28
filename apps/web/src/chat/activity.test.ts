import { expect, it } from 'vitest';
import { WorkProgress } from './activity';
it('keeps a meaningful action after completion instead of resetting to Thinking', () => {
  const progress = new WorkProgress();
  expect(progress.begin()).toBe('Thinking');
  expect(progress.toolStarted('1', 'read_file', {})).toBe('Reading project files');
  expect(progress.toolCompleted('1', 'read_file')).toBe('Reviewing the files');
  expect(progress.toolStarted('2', 'web_search', {})).toBe('Searching the web');
  expect(progress.toolCompleted('2', 'web_search')).toBe('Reviewing the search results');
});
it('keeps the agent’s public caption across tool calls and clears it when the reply starts', () => {
  const progress = new WorkProgress();
  progress.bind('alpha', true);
  expect(progress.status('progress', 'Checking available Claude models')).toBe(
    'Checking available Claude models',
  );
  expect(progress.toolStarted('p', 'pebble_progress', {})).toBe('Checking available Claude models');
  expect(progress.toolCompleted('p', 'pebble_progress')).toBe('Checking available Claude models');
  expect(progress.toolStarted('t', 'terminal', { command: 'private command' })).toBe(
    'Checking available Claude models',
  );
  expect(progress.toolCompleted('t', 'terminal')).toBe('Checking available Claude models');
  expect(progress.status('reasoning', 'PRIVATE_REASONING')).toBe(
    'Checking available Claude models',
  );
  expect(progress.reply()).toBe('');
  expect(progress.bind('beta', true)).toBe('Thinking');
});
it('tracks overlapping tools without exposing their arguments or inventing a subject', () => {
  const progress = new WorkProgress();
  progress.begin();
  progress.toolStarted('a', 'read_file', {});
  progress.toolStarted('b', 'web_search', {});
  expect(progress.toolCompleted('a', 'read_file')).toBe('Searching the web');
  expect(progress.toolStarted('c', 'unknown_private_name', { secret: 'PRIVATE' })).toBe(
    'Working on your request',
  );
  expect(
    progress.toolStarted('d', 'tool_call', {
      name: 'workspace_work',
      arguments: { operation: 'work.board', params: { board: 'fixture-project' } },
    }),
  ).toBe('Checking project progress');
});
