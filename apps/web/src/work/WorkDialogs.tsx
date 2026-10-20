import type { SharedProps, WorkDialogTarget } from './work-types';
import { WorkCreator } from './WorkCreator';
import { TaskEditor } from './TaskEditor';
export type { WorkDialogTarget } from './work-types';

export function WorkDialog({ target, ...props }: SharedProps & { target: WorkDialogTarget }) {
  if (target.kind === 'task') return <TaskEditor {...props} board={target.board} id={target.id} />;
  return <WorkCreator {...props} target={target} />;
}
