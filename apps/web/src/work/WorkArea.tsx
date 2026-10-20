import { useEffect, useState } from 'react';
import { Flag, Menu as MenuIcon, MoreHorizontal } from 'lucide-react';
import { WorkDomain } from '@hermes-client/protocol';
import type {
  BotBridgeClient,
  WorkspaceSnapshot,
  WorkBoardView,
  WorkCatalog,
  WorkStatus,
} from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { IconButton } from '../components/ui/icon-button';
import { LoadingBar } from '../components/ui/loading-bar';
import { Notice } from '../ui/primitives';

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
}: {
  client: BotBridgeClient;
  workspace: WorkspaceSnapshot;
  catalog: WorkCatalog;
  board: string;
  onTask: (id: string) => void;
  onCreate: () => void;
  onEditProject: () => void;
  onNavigate: () => void;
  refresh: number;
}) {
  const [view, setView] = useState<WorkBoardView>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await new WorkDomain(client).board({
          workspaceId: catalog.workspaceId,
          board,
        });
        if (live) {
          setView(value);
          setError('');
        }
      } catch {
        if (live) setError('This board could not be loaded.');
      } finally {
        if (live) timer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, catalog.workspaceId, board, retry, refresh]);
  const current =
    view?.board.slug === board && view.workspaceId === catalog.workspaceId ? view : undefined;
  const summary = catalog.boards.find((b) => b.slug === board);
  return (
    <section className="pc-work-area" aria-label="Tasks">
      <header className="pc-work-header">
        <IconButton
          quiet
          className="mobile-nav"
          label="Toggle navigation"
          icon={MenuIcon}
          onClick={onNavigate}
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{summary?.name ?? 'Tasks'}</h1>
          {summary?.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{summary.description}</p>
          )}
        </div>
        {summary?.mapping === 'linked' && (
          <IconButton
            quiet
            label="Project board settings"
            icon={MoreHorizontal}
            onClick={onEditProject}
          />
        )}
        <Button
          onClick={onCreate}
          disabled={!summary || !['general', 'linked'].includes(summary.mapping)}
        >
          New task
        </Button>
      </header>
      <LoadingBar active={!current && !error} label="Loading project board" />
      {!current && error && (
        <Notice error>
          {error}{' '}
          <Button variant="quiet" onClick={() => setRetry((n) => n + 1)}>
            Try again
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
            >
              <header className="flex items-center gap-2 px-1 pb-3">
                <h2 className="text-sm font-medium">{statusNames[column.status]}</h2>
                <Badge variant="secondary" className="bg-transparent text-xs text-muted-foreground">
                  {column.tasks.length}
                </Badge>
              </header>
              <div className="grid content-start gap-3">
                {column.tasks.map((task) => {
                  const assignee = workspace.bots.find((b) => b.profile === task.assignee);
                  return (
                    <Card asChild key={task.id} className="gap-0 py-0 shadow-none">
                      <Button
                        variant="ghost"
                        className="h-auto min-h-24 w-full flex-col items-start gap-3 whitespace-normal rounded-xl p-4 text-left"
                        aria-label={`Open task ${task.title}`}
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
                    </Card>
                  );
                })}
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
