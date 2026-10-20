import { useEffect, useReducer, useState } from 'react';
import type { WorkTaskView } from '@hermes-client/protocol';
import { EditorSurface, TabbedEditor } from '../ui/EditorSurface';
import { MessageBody } from '../MessageBody';
import { workDirty, workReducer, workSession } from './edit-session';
import { statusNames } from './WorkArea';
import { Assignment } from './work-fields';
import { WorkDomain } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import type { SharedProps } from './work-types';
import { PageHeader, Notice } from '../ui/primitives';
import { Button } from '../components/ui/button';
import { Form } from '../components/ui/form';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { LoadingBar } from '../components/ui/loading-bar';

export function TaskEditor(props: SharedProps & { board: string; id: string }) {
  const [view, setView] = useState<WorkTaskView>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await new WorkDomain(props.client).task({
          workspaceId: props.catalog.workspaceId,
          board: props.board,
          id: props.id,
        });
        if (live) {
          setView(value);
          setError('');
        }
      } catch {
        if (live) setError('This task could not be loaded.');
      } finally {
        if (live) timer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [props.client, props.catalog.workspaceId, props.board, props.id, refresh]);
  if (!view)
    return (
      <EditorSurface
        className="entity-page"
        header={<PageHeader title="Task" onClose={props.onClose} />}
      >
        <LoadingBar active={!error} label="Loading task" />
        {error && (
          <Notice error>
            {error}
            <Button variant="quiet" onClick={() => setRefresh((n) => n + 1)}>
              Try again
            </Button>
          </Notice>
        )}
      </EditorSurface>
    );
  return <TaskForm {...props} view={view} onRefresh={() => setRefresh((n) => n + 1)} />;
}

function TaskForm({
  view,
  onRefresh,
  client,
  catalog,
  workspace,
  onDirtyChange,
  onNavigate,
  onClose,
  onSaved,
}: SharedProps & { view: WorkTaskView; onRefresh: () => void }) {
  const [edit, dispatch] = useReducer(workReducer, view.task, workSession);
  const [tab, setTab] = useState('details');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [comment, setComment] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<
    | { kind: 'task'; operationId: string }
    | { kind: 'comment'; operationId: string; submitted: string }
  >();
  const dirty = workDirty(edit) || !!comment;
  useEffect(() => {
    dispatch({ type: 'receive', task: view.task });
  }, [view.task]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const domain = new WorkDomain(client);
  const close = () => onNavigate(onClose);
  async function save(commentOnly = false) {
    if (busy || unconfirmed || (!commentOnly && edit.conflict)) return;
    setBusy(true);
    setError('');
    const operationId = crypto.randomUUID();
    const submittedComment = comment;
    const pending = commentOnly
      ? { kind: 'comment' as const, operationId, submitted: submittedComment }
      : { kind: 'task' as const, operationId };
    try {
      const base = {
        workspaceId: catalog.workspaceId,
        board: view.board.slug,
        id: view.task.id,
        operationId,
      };
      const receipt = commentOnly
        ? await domain.comment({ ...base, body: comment })
        : await domain.updateTask({ ...base, expectedRevision: edit.revision, draft: edit.draft });
      if (receipt.kind === 'pending') {
        setUnconfirmed(pending);
        return;
      }
      onSaved();
      if (commentOnly) {
        setComment((current) => (current === submittedComment ? '' : current));
        onRefresh();
      } else if (!comment) {
        onDirtyChange(false);
        onClose();
      } else onRefresh();
    } catch (e) {
      const failure = safeError(e);
      setError(failure.message);
      if (failure.code === 'STALE_REVISION') onRefresh();
      else if (!['INVALID_PARAMETERS', 'REQUIRES_SETUP', 'UPDATE_REQUIRED'].includes(failure.code))
        setUnconfirmed(pending);
    } finally {
      setBusy(false);
    }
  }
  return (
    <TabbedEditor
      className="entity-page"
      aria-label="Task"
      header={
        <PageHeader
          title="Task"
          subtitle={`${view.board.name} · ${statusNames[view.task.status]}`}
          onClose={close}
        />
      }
      tabs={[
        { id: 'details', label: 'Details' },
        { id: 'activity', label: 'Activity' },
      ]}
      value={tab}
      onChange={(tab) => {
        if (!busy) setTab(tab);
      }}
    >
      <div className="grid gap-5">
        <LoadingBar active={busy} label="Saving task" />
        {error && <Notice error>{error}</Notice>}
        {unconfirmed && (
          <Notice>
            The save could not be confirmed. Your edits are kept here.
            <Button
              variant="quiet"
              onClick={() => {
                void domain
                  .receipt({
                    workspaceId: catalog.workspaceId,
                    operationId: unconfirmed.operationId,
                  })
                  .then((receipt) => {
                    if (receipt.kind !== 'pending') {
                      onSaved();
                      if (unconfirmed.kind === 'comment') {
                        setComment((current) => (current === unconfirmed.submitted ? '' : current));
                        setUnconfirmed(undefined);
                        onRefresh();
                      } else if (!comment) {
                        onDirtyChange(false);
                        onClose();
                      } else {
                        setUnconfirmed(undefined);
                        onRefresh();
                      }
                    } else if (receipt.state === 'absent') setUnconfirmed(undefined);
                    else onRefresh();
                  })
                  .catch(() => setError('The save still could not be confirmed.'));
              }}
            >
              Check save
            </Button>
          </Notice>
        )}
        {edit.conflict && (
          <Notice>
            This task changed in Hermes.
            <Button
              variant="quiet"
              onClick={() => dispatch({ type: 'resolve', task: view.task, useSaved: true })}
            >
              Use latest
            </Button>
            <Button
              variant="quiet"
              onClick={() => dispatch({ type: 'resolve', task: view.task, useSaved: false })}
            >
              Keep my edits
            </Button>
          </Notice>
        )}
        {tab === 'details' ? (
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset
              className="grid gap-5"
              disabled={
                busy ||
                !catalog.capabilities.editDetails ||
                !['general', 'linked'].includes(view.board.mapping)
              }
            >
              <Label layout="stacked">
                Title
                <Input
                  required
                  maxLength={500}
                  value={edit.draft.title}
                  onChange={(event) =>
                    dispatch({ type: 'change', patch: { title: event.target.value } })
                  }
                />
              </Label>
              <Assignment
                value={edit.draft}
                allowAssignment={view.task.status === 'triage'}
                workspace={workspace}
                onChange={(patch) => dispatch({ type: 'change', patch })}
              />
              <Label layout="stacked">
                Instructions
                <Textarea
                  sizing="fixed"
                  className="min-h-48"
                  maxLength={32000}
                  value={edit.draft.body}
                  onChange={(event) =>
                    dispatch({ type: 'change', patch: { body: event.target.value } })
                  }
                />
              </Label>
            </fieldset>
            {view.task.result && (
              <section aria-label="Task result" className="grid gap-3">
                <h2 className="text-sm font-medium">Result</h2>
                <MessageBody text={view.task.result} />
              </section>
            )}
            {!!view.dependencies.length && (
              <section aria-label="Related tasks" className="grid gap-2">
                <h2 className="text-sm font-medium">Related tasks</h2>
                {view.dependencies.map((task) => (
                  <p key={task.id} className="text-sm text-muted-foreground">
                    {task.title} · {statusNames[task.status]}
                  </p>
                ))}
              </section>
            )}
            {!catalog.capabilities.editDetails && (
              <p className="text-sm text-muted-foreground">
                This Hermes version supports viewing and creating tasks. Update Hermes to edit their
                details.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={
                  busy ||
                  !!unconfirmed ||
                  edit.conflict ||
                  !catalog.capabilities.editDetails ||
                  !['general', 'linked'].includes(view.board.mapping)
                }
              >
                Save
              </Button>
            </div>
          </Form>
        ) : (
          <div className="grid gap-6">
            {view.comments.map((comment) => (
              <article key={comment.id} className="grid gap-2">
                <span className="text-xs text-muted-foreground">
                  {comment.author === 'owner' ? 'You' : comment.author}
                </span>
                <MessageBody text={comment.body} />
              </article>
            ))}
            {!view.comments.length && (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                void save(true);
              }}
            >
              <Label layout="stacked">
                Comment
                <Textarea
                  sizing="fixed"
                  required
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </Label>
              <div className="flex justify-end">
                <Button
                  disabled={
                    busy ||
                    !!unconfirmed ||
                    !comment.trim() ||
                    !['general', 'linked'].includes(view.board.mapping)
                  }
                >
                  Post comment
                </Button>
              </div>
            </Form>
          </div>
        )}
      </div>
    </TabbedEditor>
  );
}
