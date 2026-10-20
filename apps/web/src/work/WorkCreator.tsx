import { useEffect, useState } from 'react';
import type { WorkTaskDraft, WorkReceipt } from '@hermes-client/protocol';
import type { WorkDialogTarget } from './work-types';
import { EditorSurface } from '../ui/EditorSurface';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Assignment, ReceiptCheck } from './work-fields';
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

export function WorkCreator({
  target,
  client,
  catalog,
  workspace,
  onClose,
  onSaved,
  onOpenBoard,
  onDirtyChange,
  onNavigate,
}: SharedProps & { target: Exclude<WorkDialogTarget, { kind: 'task' }> }) {
  const project =
    target.kind === 'project' ? catalog.boards.find((b) => b.slug === target.board) : undefined;
  const [projectDraft, setProjectDraft] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
  });
  const [projectBaseline, setProjectBaseline] = useState(projectDraft);
  const [revision, setRevision] = useState(project?.revision ?? '');
  const [task, setTask] = useState<WorkTaskDraft>({
    title: '',
    body: '',
    assignee: null,
    priority: 0,
  });
  const [board, setBoard] = useState(target.kind === 'new-task' ? target.board : 'default');
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [receipt, setReceipt] = useState<WorkReceipt>();
  const [operationId, setOperationId] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty =
    receipt?.kind !== 'project' &&
    receipt?.kind !== 'task' &&
    (target.kind === 'new-task'
      ? !!(task.title || task.body || task.assignee || task.priority)
      : JSON.stringify(projectDraft) !== JSON.stringify(projectBaseline));
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!project || project.revision === revision) return;
    if (dirty) setConflict(true);
    else {
      const value = { name: project.name, description: project.description };
      setProjectDraft(value);
      setProjectBaseline(value);
      setRevision(project.revision);
    }
  }, [project, revision, dirty]);
  const close = () => onNavigate(onClose);
  const title =
    target.kind === 'new-project'
      ? 'New project board'
      : target.kind === 'project'
        ? 'Project board'
        : 'New task';
  const domain = new WorkDomain(client);
  async function save(resume = false) {
    if (pending || conflict || (receipt?.kind === 'pending' && !resume)) return;
    setPending(true);
    setError('');
    const id = resume ? operationId : crypto.randomUUID();
    setOperationId(id);
    try {
      const base = { workspaceId: catalog.workspaceId, operationId: id };
      const result =
        target.kind === 'new-task'
          ? await domain.createTask({ ...base, board, draft: task })
          : target.kind === 'project' && project?.projectId
            ? await domain.updateProject({
                ...base,
                projectId: project.projectId,
                expectedRevision: revision,
                ...projectDraft,
              })
            : await domain.createProject({ ...base, ...projectDraft });
      setReceipt(result);
      onSaved();
      if (result.kind !== 'pending') {
        onDirtyChange(false);
        if (target.kind === 'project') onClose();
      }
    } catch (e) {
      const failure = safeError(e);
      setError(failure.message);
      if (failure.code === 'STALE_REVISION') setConflict(true);
      else if (!['INVALID_PARAMETERS', 'REQUIRES_SETUP', 'UPDATE_REQUIRED'].includes(failure.code))
        setReceipt({ kind: 'pending', id, state: 'uncertain' });
    } finally {
      setPending(false);
    }
  }
  async function check() {
    setPending(true);
    try {
      const value = await domain.receipt({ workspaceId: catalog.workspaceId, operationId });
      if (value.kind === 'pending' && value.state === 'absent') {
        setReceipt(undefined);
        setError('The change was not received. You can save it again.');
      } else {
        setReceipt(value);
        if (value.kind !== 'pending') {
          onSaved();
          onDirtyChange(false);
          if (target.kind === 'project') onClose();
        }
      }
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <EditorSurface
      className="entity-page"
      bodyClassName="gap-4"
      aria-label={title}
      header={<PageHeader title={title} onClose={close} />}
    >
      <LoadingBar active={pending} label="Saving" />
      {error && <Notice error>{error}</Notice>}
      {conflict && project && (
        <Notice>
          This project changed in Hermes.
          <Button
            variant="quiet"
            onClick={() => {
              const value = { name: project.name, description: project.description };
              setProjectBaseline(value);
              setProjectDraft(value);
              setRevision(project.revision);
              setConflict(false);
            }}
          >
            Use latest
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setProjectBaseline({ name: project.name, description: project.description });
              setRevision(project.revision);
              setConflict(false);
            }}
          >
            Keep my edits
          </Button>
        </Notice>
      )}
      {receipt && (
        <ReceiptCheck
          receipt={receipt}
          checking={pending}
          onCheck={() => void check()}
          onResume={target.kind === 'project' ? undefined : () => void save(true)}
          onOpen={onOpenBoard}
          onClose={onClose}
        />
      )}
      {(!receipt || receipt.kind === 'pending') && (
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={pending || receipt?.kind === 'pending'} className="grid gap-5">
            {target.kind === 'new-task' ? (
              <>
                <Label layout="stacked">
                  Title
                  <Input
                    required
                    maxLength={500}
                    value={task.title}
                    onChange={(event) => setTask({ ...task, title: event.target.value })}
                  />
                </Label>
                <Label layout="stacked">
                  Project board
                  <Select value={board} onValueChange={setBoard}>
                    <SelectTrigger aria-label="Project board">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.boards
                        .filter((b) => ['general', 'linked'].includes(b.mapping))
                        .map((b) => (
                          <SelectItem key={b.slug} value={b.slug}>
                            {b.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Label>
                <Assignment
                  value={task}
                  workspace={workspace}
                  onChange={(patch) => setTask({ ...task, ...patch })}
                />
                <Label layout="stacked">
                  Instructions
                  <Textarea
                    sizing="fixed"
                    className="min-h-40"
                    maxLength={32000}
                    value={task.body}
                    onChange={(event) => setTask({ ...task, body: event.target.value })}
                  />
                </Label>
              </>
            ) : (
              <>
                <Label layout="stacked">
                  Name
                  <Input
                    required
                    maxLength={120}
                    value={projectDraft.name}
                    onChange={(event) =>
                      setProjectDraft({ ...projectDraft, name: event.target.value })
                    }
                  />
                </Label>
                <Label layout="stacked">
                  Instructions
                  <Textarea
                    sizing="fixed"
                    className="min-h-48"
                    maxLength={12000}
                    value={projectDraft.description}
                    onChange={(event) =>
                      setProjectDraft({ ...projectDraft, description: event.target.value })
                    }
                  />
                </Label>
              </>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button disabled={pending || conflict || receipt?.kind === 'pending'}>
              {target.kind === 'project'
                ? 'Save'
                : target.kind === 'new-task'
                  ? 'Create task'
                  : 'Create project board'}
            </Button>
          </div>
        </Form>
      )}
    </EditorSurface>
  );
}
