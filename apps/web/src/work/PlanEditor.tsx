import { EditorSurface } from '../ui/EditorSurface';
import { useEffect, useRef, useState } from 'react';
import { PlansDomain } from '@hermes-client/protocol';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { Form } from '../components/ui/form';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Notice } from '../ui/primitives';
import { DiscardChanges } from '../ui/DiscardChanges';
import type { Organization } from '../ui/organization';
import { CrewChoices } from './CrewChoices';
import { session, receive, resolve, planFields, descendants } from './plan-session';
import { planStatuses } from '@hermes-client/protocol';
import type { PlanDraft, PlansSnapshot } from '@hermes-client/protocol';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { sameBoard } from './use-plans';
export function PlanEditor({
  draft: initial,
  snapshot,
  workspace,
  organization,
  client,
  onClose,
  onSaved,
}: {
  draft: PlanDraft;
  snapshot: PlansSnapshot;
  workspace: WorkspaceSnapshot;
  organization: Organization;
  client: SessionClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState(() => session(initial, snapshot.revision));
  const draft = edit.draft,
    revision = edit.revision;
  const incoming = initial.id ? snapshot.plans.find((plan) => plan.id === initial.id) : initial;
  useEffect(() => {
    if (incoming) setEdit((old) => receive(old, incoming, snapshot.revision, planFields));
  }, [incoming, snapshot.revision]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const intent = useRef({ payload: '', id: '' });
  const [uncertain, setUncertain] = useState(false);
  const patch = (value: Partial<PlanDraft>) =>
    setEdit((old) => ({ ...old, draft: { ...old.draft, ...value } }));
  const close = () =>
    JSON.stringify(draft) === JSON.stringify(edit.baseline) ? onClose() : setDiscard(true);
  async function save() {
    if (busy || uncertain || edit.conflicts.length) return;
    const payload = JSON.stringify({ revision, draft });
    if (intent.current.payload !== payload) intent.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await new PlansDomain(client).save(workspace.id, revision, intent.current.id, draft);
      onSaved();
    } catch (cause) {
      const error = safeError(cause);
      if (
        !['INVALID_PARAMETERS', 'STALE_REVISION', 'REQUIRES_SETUP', 'UPDATE_REQUIRED'].includes(
          error.code,
        )
      )
        setUncertain(true);
      setError(
        error.code === 'STALE_REVISION'
          ? 'Plans changed elsewhere. Review the latest version before saving.'
          : error.message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkSave() {
    setBusy(true);
    try {
      if (await new PlansDomain(client).receipt(workspace.id, intent.current.id)) onSaved();
      else {
        setUncertain(false);
        setError('The plan was not saved. You can save it again.');
      }
    } catch (cause) {
      setError(safeError(cause).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <DialogContent size="editor">
          <Form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <EditorSurface
              className="p-6"
              header={
                <DialogHeader>
                  <DialogTitle>{initial.id ? 'Edit plan' : 'New plan'}</DialogTitle>
                </DialogHeader>
              }
              footer={
                <DialogFooter>
                  <Button type="button" variant="quiet" onClick={close} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      uncertain ||
                      !!edit.conflicts.length ||
                      !draft.title.trim() ||
                      !draft.outcome.trim()
                    }
                  >
                    {busy ? 'Saving…' : 'Save plan'}
                  </Button>
                </DialogFooter>
              }
            >
              <div className="grid min-w-0 gap-5">
                <fieldset className="grid min-w-0 gap-5" disabled={busy || uncertain}>
                  <div className="grid gap-2">
                    <Label htmlFor="plan-name">Name</Label>
                    <Input
                      id="plan-name"
                      value={draft.title}
                      maxLength={120}
                      onChange={(event) => patch({ title: event.target.value })}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="plan-goal">Goal</Label>
                    <Textarea
                      id="plan-goal"
                      value={draft.outcome}
                      maxLength={2000}
                      onChange={(event) => patch({ outcome: event.target.value })}
                      placeholder="What should this plan achieve?"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="plan-details">Details</Label>
                    <Textarea
                      id="plan-details"
                      value={draft.body}
                      maxLength={12000}
                      onChange={(event) => patch({ body: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="plan-owner">Owner</Label>
                      <Select
                        value={draft.ownerId ?? 'none'}
                        onValueChange={(value) =>
                          patch({ ownerId: value === 'none' ? null : value })
                        }
                      >
                        <SelectTrigger id="plan-owner">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {draft.ownerId &&
                            !workspace.bots.some(
                              (bot) => bot.id === draft.ownerId && bot.enrolled && bot.available,
                            ) && <SelectItem value={draft.ownerId}>Unavailable owner</SelectItem>}
                          {workspace.bots
                            .filter((bot) => bot.enrolled && bot.available)
                            .map((bot) => (
                              <SelectItem key={bot.id} value={bot.id}>
                                {bot.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="plan-status">Status</Label>
                      <Select
                        value={draft.status}
                        onValueChange={(value) => {
                          const status = planStatuses.find((v) => v === value);
                          if (status) patch({ status });
                        }}
                      >
                        <SelectTrigger id="plan-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {planStatuses.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status[0]?.toUpperCase()}
                              {status.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="plan-parent">Parent plan</Label>
                    <Select
                      value={draft.parentId ?? 'none'}
                      onValueChange={(value) =>
                        patch({ parentId: value === 'none' ? null : value })
                      }
                    >
                      <SelectTrigger id="plan-parent">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {draft.parentId &&
                          !snapshot.plans.some((plan) => plan.id === draft.parentId) && (
                            <SelectItem value={draft.parentId}>Unavailable parent</SelectItem>
                          )}
                        {snapshot.plans
                          .filter(
                            (plan) =>
                              !descendants(snapshot.plans, draft.id).has(plan.id) &&
                              (plan.status !== 'archived' || plan.id === draft.parentId),
                          )
                          .map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {plan.title}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <CrewChoices
                    organization={organization}
                    value={draft.crewIds}
                    onChange={(crewIds) => patch({ crewIds })}
                  />
                  <fieldset className="grid gap-3">
                    <legend className="mb-3 text-sm font-medium">Project boards</legend>
                    {snapshot.boards.map((board) => (
                      <Label key={board.projectId} className="flex items-center gap-3 font-normal">
                        <Checkbox
                          checked={draft.boards.some((ref) => sameBoard(ref, board))}
                          onCheckedChange={() =>
                            patch({
                              boards: draft.boards.some((ref) => sameBoard(ref, board))
                                ? draft.boards.filter((ref) => !sameBoard(ref, board))
                                : [
                                    ...draft.boards,
                                    {
                                      catalogId: board.catalogId,
                                      projectId: board.projectId,
                                      slug: board.slug,
                                    },
                                  ],
                            })
                          }
                        />
                        {board.name}
                      </Label>
                    ))}
                    {draft.boards
                      .filter((ref) => !snapshot.boards.some((board) => sameBoard(ref, board)))
                      .map((ref) => (
                        <Label key={ref.slug} className="flex items-center gap-3 font-normal">
                          <Checkbox
                            checked
                            onCheckedChange={() =>
                              patch({
                                boards: draft.boards.filter((board) => !sameBoard(board, ref)),
                              })
                            }
                          />
                          Unavailable board: {ref.slug}
                        </Label>
                      ))}
                  </fieldset>
                </fieldset>
                {error && <Notice>{error}</Notice>}
                {uncertain && (
                  <Notice>
                    Save not confirmed.
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => void checkSave()}
                    >
                      Check save
                    </Button>
                  </Notice>
                )}
                {!!edit.conflicts.length && (
                  <Notice>
                    <p>This plan changed elsewhere. Review the saved values:</p>
                    <dl className="my-3 grid gap-2 text-sm">
                      {edit.conflicts.map((key) => (
                        <div key={key}>
                          <dt className="font-medium">
                            {
                              {
                                title: 'Name',
                                outcome: 'Goal',
                                body: 'Details',
                                status: 'Status',
                                ownerId: 'Owner',
                                parentId: 'Parent plan',
                                crewIds: 'Crews',
                                boards: 'Project boards',
                                id: 'Plan',
                              }[key]
                            }
                          </dt>
                          <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                            {typeof edit.baseline[key] === 'string'
                              ? edit.baseline[key]
                              : JSON.stringify(edit.baseline[key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setEdit((old) => resolve(old, true));
                          setError('');
                        }}
                      >
                        Use saved changes
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setEdit((old) => resolve(old, false));
                          setError('');
                        }}
                      >
                        Keep my changes
                      </Button>
                    </div>
                  </Notice>
                )}
              </div>
            </EditorSurface>
          </Form>
        </DialogContent>
      </Dialog>
      <DiscardChanges open={discard} onOpenChange={setDiscard} onDiscard={onClose} />
    </>
  );
}
