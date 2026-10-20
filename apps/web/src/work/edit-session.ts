import type { WorkTaskDraft, WorkTask } from '@hermes-client/protocol';

export type WorkEdit = {
  baseline: WorkTaskDraft;
  draft: WorkTaskDraft;
  revision: string;
  conflict: boolean;
};
export function taskDraft(task: WorkTask): WorkTaskDraft {
  return { title: task.title, body: task.body, assignee: task.assignee, priority: task.priority };
}
const same = (a: WorkTaskDraft, b: WorkTaskDraft) => JSON.stringify(a) === JSON.stringify(b);
export function workDirty(edit: WorkEdit) {
  return !same(edit.baseline, edit.draft);
}
export function workSession(task: WorkTask): WorkEdit {
  const baseline = taskDraft(task);
  return { baseline, draft: baseline, revision: task.revision, conflict: false };
}
export type WorkEditEvent =
  | { type: 'change'; patch: Partial<WorkTaskDraft> }
  | { type: 'receive'; task: WorkTask }
  | { type: 'resolve'; task: WorkTask; useSaved: boolean };
export function workReducer(edit: WorkEdit, event: WorkEditEvent): WorkEdit {
  if (event.type === 'change') return { ...edit, draft: { ...edit.draft, ...event.patch } };
  if (event.type === 'resolve')
    return {
      ...workSession(event.task),
      draft: event.useSaved ? taskDraft(event.task) : edit.draft,
    };
  if (event.task.revision === edit.revision) return edit;
  if (!workDirty(edit)) return workSession(event.task);
  const incoming = taskDraft(event.task);
  if (same(incoming, edit.draft)) return workSession(event.task);
  if (same(incoming, edit.baseline)) return { ...edit, revision: event.task.revision };
  return { ...edit, conflict: !same(incoming, edit.baseline) && !same(incoming, edit.draft) };
}
