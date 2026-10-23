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
import { Target } from 'lucide-react';
import { session, receive, resolve } from './plan-session';
import { usePlans, sameBoard } from './use-plans';
export function BoardOutcome({
  client,
  workspace,
  organization,
  connected,
  board,
}: {
  client: SessionClient;
  workspace: WorkspaceSnapshot;
  organization: Organization;
  connected: boolean;
  board: string;
}) {
  const resource = usePlans(client, workspace, connected);
  const [open, setOpen] = useState(false);
  const data = resource.state.value;
  const ref = data?.boards.find((ref) => ref.slug === board);
  if (!data || !ref) return null;
  const current = data.boardOutcomes.find((value) => sameBoard(value.board, ref));
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Target />
        Goal
      </Button>
      {open && (
        <OutcomeEditor
          key={board}
          initial={current?.outcome ?? ''}
          initialCrews={current?.crewIds ?? []}
          revision={data.revision}
          organization={organization}
          check={(id) => new PlansDomain(client).receipt(workspace.id, id)}
          onClose={() => setOpen(false)}
          save={async (text, crews, id, revision) => {
            await new PlansDomain(client).saveOutcome(workspace.id, revision, id, ref, text, crews);
            setOpen(false);
            resource.reload();
          }}
        />
      )}
    </>
  );
}
function OutcomeEditor({
  initial,
  initialCrews,
  revision,
  organization,
  save,
  check,
  onClose,
}: {
  initial: string;
  initialCrews: string[];
  revision: number;
  organization: Organization;
  check: (id: string) => Promise<boolean>;
  save: (outcome: string, crewIds: string[], id: string, revision: number) => Promise<void>;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState(() =>
    session({ outcome: initial, crews: initialCrews }, revision),
  );
  useEffect(
    () =>
      setEdit((old) =>
        receive(old, { outcome: initial, crews: initialCrews }, revision, ['outcome', 'crews']),
      ),
    [initial, initialCrews, revision],
  );
  const { outcome, crews } = edit.draft;
  const setOutcome = (outcome: string) =>
    setEdit((old) => ({ ...old, draft: { ...old.draft, outcome } }));
  const setCrews = (crews: string[]) =>
    setEdit((old) => ({ ...old, draft: { ...old.draft, crews } }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const intent = useRef({ payload: '', id: '' });
  const [uncertain, setUncertain] = useState(false);
  const close = () =>
    JSON.stringify(edit.draft) !== JSON.stringify(edit.baseline) ? setDiscard(true) : onClose();
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project goal</DialogTitle>
          </DialogHeader>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              const payload = JSON.stringify({ outcome, crews, revision: edit.revision });
              if (intent.current.payload !== payload)
                intent.current = { payload, id: crypto.randomUUID() };
              setBusy(true);
              setError('');
              void save(outcome, crews, intent.current.id, edit.revision)
                .catch((cause) => {
                  const failure = safeError(cause);
                  setError(failure.message);
                  if (
                    ![
                      'INVALID_PARAMETERS',
                      'STALE_REVISION',
                      'REQUIRES_SETUP',
                      'UPDATE_REQUIRED',
                    ].includes(failure.code)
                  )
                    setUncertain(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="project-outcome">Goal</Label>
              <Textarea
                id="project-outcome"
                value={outcome}
                disabled={busy || uncertain}
                onChange={(event) => setOutcome(event.target.value)}
                maxLength={2000}
                placeholder="What should this project achieve?"
                required
              />
            </div>
            <CrewChoices
              organization={organization}
              value={crews}
              onChange={setCrews}
              disabled={busy || uncertain}
            />
            {error && <Notice>{error}</Notice>}
            {uncertain && (
              <Notice>
                Save not confirmed.
                <Button
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void check(intent.current.id)
                      .then((saved) => {
                        if (saved) onClose();
                        else {
                          setUncertain(false);
                          setError('The goal was not saved. You can save it again.');
                        }
                      })
                      .catch((cause) => setError(safeError(cause).message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Check save
                </Button>
              </Notice>
            )}
            {!!edit.conflicts.length && (
              <Notice>
                <p>This project goal changed elsewhere.</p>
                <p className="my-2 whitespace-pre-wrap break-words">{edit.baseline.outcome}</p>
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
              </Notice>
            )}
            <DialogFooter>
              <Button type="button" variant="quiet" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || uncertain || !!edit.conflicts.length || !outcome.trim()}
              >
                {busy ? 'Saving…' : 'Save goal'}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
      <DiscardChanges open={discard} onOpenChange={setDiscard} onDiscard={onClose} />
    </>
  );
}
