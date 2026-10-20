import { describe, expect, it } from 'vitest';
import type { WorkTask } from '@hermes-client/protocol';
import { workDirty, workReducer, workSession } from './edit-session';

const task: WorkTask = {
  id: 'task-1',
  title: 'Check sources',
  body: 'Read the originals.',
  assignee: null,
  priority: 0,
  status: 'triage',
  projectId: 'project-1',
  result: null,
  revision: 'a'.repeat(64),
};
describe('work editor recovery', () => {
  it('keeps unsaved instructions when another client changes the task', () => {
    const edit = workReducer(workSession(task), {
      type: 'change',
      patch: { body: 'My unfinished instructions' },
    });
    const latest = { ...task, title: 'Native title', revision: 'b'.repeat(64) };
    const conflict = workReducer(edit, { type: 'receive', task: latest });
    expect(conflict.draft.body).toBe('My unfinished instructions');
    expect(conflict.conflict).toBe(true);
    const kept = workReducer(conflict, { type: 'resolve', task: latest, useSaved: false });
    expect(kept.revision).toBe(latest.revision);
    expect(workDirty(kept)).toBe(true);
    expect(kept.conflict).toBe(false);
  });
  it('updates the concurrency token on a status-only change without losing a draft', () => {
    const edit = workReducer(workSession(task), {
      type: 'change',
      patch: { body: 'My unfinished instructions' },
    });
    const updated = workReducer(edit, {
      type: 'receive',
      task: { ...task, status: 'blocked', revision: 'c'.repeat(64) },
    });
    expect(updated.revision).toBe('c'.repeat(64));
    expect(updated.draft.body).toBe('My unfinished instructions');
    expect(updated.conflict).toBe(false);
  });
  it('recognizes the saved draft when a receipt refresh arrives', () => {
    const edit = workReducer(workSession(task), {
      type: 'change',
      patch: { title: 'A saved title' },
    });
    const saved = workReducer(edit, {
      type: 'receive',
      task: { ...task, ...edit.draft, revision: 'd'.repeat(64) },
    });
    expect(workDirty(saved)).toBe(false);
    expect(saved.revision).toBe('d'.repeat(64));
  });
});
