import { motion } from 'motion/react';
import { useTaskMovement } from './use-task-movement';
import { workMoveStatuses } from '@hermes-client/protocol';
import { Menu } from '../ui/primitives';
import { useCallback, useRef, useState } from 'react';
import { Flag, MoreHorizontal } from 'lucide-react';
import { WorkDomain } from '@hermes-client/protocol';
import type {
  SessionClient,
  WorkspaceSnapshot,
  WorkCatalog,
  WorkStatus,
} from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { IconButton } from '../components/ui/icon-button';
import { LoadingBar } from '../components/ui/loading-bar';
import { Notice } from '../ui/primitives';
import { useWorkRead } from './use-work-read';
import { WorkReadError } from './WorkReadError';
import { WorkHeader } from './WorkHeader';

export const statusNames: Record<WorkStatus, string> = {
  triage: 'Triage',
  todo: 'To do',
  scheduled: 'Scheduled',
  ready: 'Ready',
  running: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
};

export function WorkArea({
  client,
  workspace,
  catalog,
  board,
  onTask,
  onCreate,
  onEditProject,
  onNavigate,
  refresh,
  connected,
  onReconnect,
}: {
  client: SessionClient;
  workspace: WorkspaceSnapshot;
  catalog: WorkCatalog;
  board: string;
  onTask: (id: string) => void;
  onCreate: () => void;
  onEditProject: () => void;
  onNavigate: () => void;
  refresh: number;
  connected: boolean;
  onReconnect: () => void;
}) {
  const read = useCallback(
    () => new WorkDomain(client).board({ workspaceId: catalog.workspaceId, board }),
    [client, catalog.workspaceId, board, refresh],
  );
  const resource = useWorkRead({ scope: catalog.workspaceId + '/' + board, read, connected });
  const dragged = useRef<string | undefined>(undefined);
  const [over, setOver] = useState<{ status: WorkStatus; beforeId: string | null }>();
  const movement = useTaskMovement({
    client,
    workspaceId: catalog.workspaceId,
    board,
    onChanged: (task, beforeId) => {
      resource.updateValue((current) => ({
        ...current,
        columns: current.columns.map((column) => {
          const tasks = column.tasks.filter((row) => row.id !== task.id);
          if (column.status === task.status) {
            const position = beforeId ? tasks.findIndex((row) => row.id === beforeId) : -1;
            tasks.splice(position < 0 ? tasks.length : position, 0, task);
          }
          return { ...column, tasks };
        }),
      }));
      resource.reload();
    },
  });
  const current = resource.state.value;
  const summary = catalog.boards.find((b) => b.slug === board);
  return (
    <section className="pc-work-area" aria-label="Tasks">
      <WorkHeader
        title={summary?.name ?? 'Tasks'}
        description={summary?.description}
        onNavigate={onNavigate}
      >
        {summary?.mapping === 'linked' && (
          <IconButton
            quiet
            label="Project board settings"
            icon={MoreHorizontal}
            onClick={onEditProject}
          />
        )}
        <Button
          data-create-task
          onClick={onCreate}
          disabled={!summary || !['general', 'linked'].includes(summary.mapping)}
        >
          New task
        </Button>
      </WorkHeader>
      <LoadingBar active={resource.state.kind === 'pending'} label="Loading project board" />
      {resource.state.kind === 'failed' && (
        <WorkReadError
          error={resource.state.error}
          subject="this board"
          retained={!!current}
          onRetry={resource.reload}
          onReconnect={onReconnect}
        />
      )}
      {movement.error && <Notice error>{movement.error}</Notice>}
      {movement.uncertain && (
        <Notice>
          The move is not yet confirmed.{' '}
          <Button variant="quiet" onClick={() => void movement.check()}>
            Check move
          </Button>
        </Notice>
      )}
      {summary?.mapping === 'conflict' && (
        <Notice>
          This board has conflicting project links in Hermes. You can view its tasks while those
          links are repaired.
        </Notice>
      )}
      {summary?.mapping === 'unlinked' && (
        <Notice>
          This Hermes board has no linked project. Link its project in Hermes before editing tasks
          here.
        </Notice>
      )}
      {!!catalog.unlinkedProjects.length && (
        <Notice>
          {catalog.unlinkedProjects.length === 1
            ? 'A Hermes project has'
            : `${catalog.unlinkedProjects.length} Hermes projects have`}{' '}
          no confirmed board link. Link them in Hermes to show them here.
        </Notice>
      )}
      {current && (
        <div className="pc-work-columns" tabIndex={0} aria-label="Task columns">
          {current.columns.map((column) => (
            <section
              key={column.status}
              className="pc-work-column"
              aria-label={statusNames[column.status]}
              data-drag-over={over?.status === column.status || undefined}
              onDragOver={(event) => {
                if (
                  dragged.current &&
                  (workMoveStatuses.some((status) => status === column.status) ||
                    column.tasks.some((task) => task.id === dragged.current))
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const rows = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]'),
                  ].filter((row) => row.dataset.taskId !== dragged.current);
                  const before = rows.find(
                    (row) =>
                      event.clientY <
                      row.getBoundingClientRect().y + row.getBoundingClientRect().height / 2,
                  );
                  const beforeId = before?.dataset.taskId ?? null;
                  setOver((current) =>
                    current?.status === column.status && current.beforeId === beforeId
                      ? current
                      : { status: column.status, beforeId },
                  );
                }
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget instanceof Node ? event.relatedTarget : null,
                  )
                )
                  setOver(undefined);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const task = current.columns
                  .flatMap((c) => c.tasks)
                  .find((t) => t.id === dragged.current);
                if (task && over?.status === column.status)
                  void movement.move(task, column.status, over.beforeId);
                dragged.current = undefined;
                setOver(undefined);
              }}
            >
              <header className="flex items-center gap-2 px-1 pb-3">
                <h2 className="text-sm font-medium">{statusNames[column.status]}</h2>
                <Badge variant="secondary" className="bg-transparent text-xs text-muted-foreground">
                  {column.tasks.length}
                </Badge>
              </header>
              <div className="relative grid content-start gap-3">
                {column.tasks.map((task, index) => {
                  const assignee = workspace.bots.find((b) => b.profile === task.assignee);
                  return (
                    <motion.div
                      key={task.id}
                      className="relative"
                      layout
                      transition={{ duration: 0.18 }}
                    >
                      {over?.status === column.status && over.beforeId === task.id && (
                        <span data-slot="task-drop-marker" aria-hidden="true" />
                      )}
                      <Card
                        className="pc-task-card relative gap-0 py-0 shadow-none"
                        data-task-id={task.id}
                        draggable={!movement.busy && !movement.uncertain}
                        onDragStart={(event) => {
                          dragged.current = task.id;
                          event.dataTransfer.setData('text/plain', task.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          dragged.current = undefined;
                          setOver(undefined);
                        }}
                      >
                        <Button
                          variant="ghost"
                          className="h-auto min-h-24 w-full cursor-grab active:cursor-grabbing flex-col items-start gap-3 whitespace-normal rounded-xl p-4 pr-12 text-left"
                          aria-label={`Open task ${task.title}`}
                          onKeyDown={(event) => {
                            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key))
                              return;
                            event.preventDefault();
                            const next =
                              event.key === 'ArrowUp'
                                ? column.tasks[index - 1]
                                : column.tasks[index + 2];
                            if (
                              (event.key === 'ArrowUp' && index > 0) ||
                              (event.key === 'ArrowDown' && index < column.tasks.length - 1)
                            )
                              void movement.move(task, task.status, next?.id ?? null);
                          }}
                          onClick={() => onTask(task.id)}
                        >
                          <span className="break-words text-sm font-medium">{task.title}</span>
                          <span className="flex w-full items-center gap-2 text-xs font-normal text-muted-foreground">
                            <span className="min-w-0 flex-1 truncate">
                              {assignee?.name ?? task.assignee ?? 'Unassigned'}
                            </span>
                            {task.priority !== 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Flag className="size-3" />
                                {task.priority >= 2 ? 'Urgent' : task.priority > 0 ? 'High' : 'Low'}
                              </span>
                            )}
                          </span>
                        </Button>
                        <div className="absolute right-1 top-1">
                          <Menu
                            label={`Task actions for ${task.title}`}
                            placement="row-actions"
                            disabled={movement.busy || !!movement.uncertain}
                            items={[
                              {
                                label: 'Move to',
                                action: () => {},
                                items: workMoveStatuses
                                  .filter((status) => status !== task.status)
                                  .map((status) => ({
                                    label: statusNames[status],
                                    action: () => {
                                      void movement.move(task, status);
                                    },
                                  })),
                              },
                            ]}
                          />
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
                {over?.status === column.status && over.beforeId === null && (
                  <div className="relative h-0" aria-hidden="true">
                    <span data-slot="task-drop-marker" />
                  </div>
                )}
                {!column.tasks.length && (
                  <p className="px-1 py-4 text-xs text-muted-foreground/60">No tasks</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
