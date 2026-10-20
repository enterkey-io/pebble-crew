import type { WorkTask, WorkStatus } from '@hermes-client/protocol';

const executing = new Set(['todo', 'ready', 'running']);

export function moveIntent(before: WorkTask, latest: WorkTask, target: WorkStatus) {
  if (latest.status === target) return 'already';
  if (before.assignee !== latest.assignee) return 'changed';
  if (before.status === latest.status) return 'move';
  // Native queue promotion is progress on the same assignment. It must neither
  // prevent an owner pausing it nor turn a second queue gesture into a restart.
  if (executing.has(before.status) && executing.has(latest.status)) {
    if (target === 'todo' || target === 'ready') return 'already';
    if (target === 'blocked' || target === 'triage') return 'move';
  }
  return 'changed';
}
