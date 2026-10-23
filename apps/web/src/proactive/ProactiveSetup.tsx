import { EditorSurface } from '../ui/EditorSurface';
import { useWorkRead } from '../work/use-work-read';
import { useCallback, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { ProactiveDomain } from '@hermes-client/protocol';
import type { RoutineDraft, SessionClient } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { LoadingBar } from '../components/ui/loading-bar';
import { Notice } from '../ui/primitives';

type Suggestions = Awaited<ReturnType<ProactiveDomain['suggest']>>;
type Receipt =
  { kind: 'saved' } | { kind: 'uncertain'; id: string } | { kind: 'failed'; message: string };
export function ProactiveSetup({
  client,
  workspaceId,
  onClose,
}: {
  client: SessionClient;
  workspaceId: string;
  onClose: () => void;
}) {
  const readStatus = useCallback(
    () => new ProactiveDomain(client).status(workspaceId),
    [client, workspaceId],
  );
  const resource = useWorkRead({ scope: workspaceId, read: readStatus, connected: true });
  const status = resource.state.value;
  const [suggestions, setSuggestions] = useState<Suggestions>();
  const [drafts, setDrafts] = useState<RoutineDraft[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const intents = useRef(new Map<string, { payload: string; id: string }>());
  async function discover() {
    setBusy(true);
    setError('');
    try {
      const value = await new ProactiveDomain(client).suggest(workspaceId);
      setSuggestions(value);
      setDrafts((old) =>
        value.suggestions.map((suggestion) => {
          const prior = old.find((draft) => draft.id === suggestion.id);
          return prior
            ? { ...suggestion, prompt: prior.prompt, time: prior.time, days: prior.days }
            : suggestion;
        }),
      );
      setSelected((old) =>
        old.filter((id) => value.suggestions.some((suggestion) => suggestion.id === id)),
      );
      resource.reload();
    } catch (cause) {
      setError(safeError(cause).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(id: string, value: Partial<RoutineDraft>) {
    setDrafts((drafts) =>
      drafts.map((draft) => (draft.id === id ? { ...draft, ...value } : draft)),
    );
  }
  async function enable() {
    if (!suggestions) return;
    setBusy(true);
    setError('');
    let allSaved = true;
    try {
      for (const draft of drafts.filter((draft) => selected.includes(draft.id))) {
        if (receipts[draft.id]?.kind === 'saved') continue;
        const payload = JSON.stringify({ proposal: suggestions.id, draft });
        let intent = intents.current.get(draft.id);
        if (!intent || intent.payload !== payload) {
          intent = { payload, id: crypto.randomUUID() };
          intents.current.set(draft.id, intent);
        }
        try {
          const result = await new ProactiveDomain(client).enable(
            workspaceId,
            suggestions.id,
            suggestions.timezone,
            intent.id,
            draft,
          );
          const receipt: Receipt =
            result.kind === 'completed' ? { kind: 'saved' } : { kind: 'uncertain', id: intent.id };
          setReceipts((old) => ({ ...old, [draft.id]: receipt }));
          if (result.kind === 'completed' && !result.enabled) {
            setError(
              'The routine was saved but is paused in Hermes. Ask your Main Pebble to review it.',
            );
            allSaved = false;
          }
          if (receipt.kind !== 'saved') {
            allSaved = false;
            break;
          }
        } catch (cause) {
          allSaved = false;
          // An interrupted response cannot establish whether native cron persisted.
          const issue = safeError(cause);
          setReceipts((old) => ({
            ...old,
            [draft.id]:
              issue.code === 'INVALID_PARAMETERS' || issue.code === 'STALE_REVISION'
                ? { kind: 'failed', message: issue.message }
                : { kind: 'uncertain', id: intent.id },
          }));
          break;
        }
      }
      if (allSaved) onClose();
    } finally {
      setBusy(false);
    }
  }
  async function check(id: string, operationId: string) {
    setBusy(true);
    try {
      const result = await new ProactiveDomain(client).receipt(workspaceId, operationId);
      if (result.kind === 'completed') setReceipts((old) => ({ ...old, [id]: { kind: 'saved' } }));
      else if (result.kind === 'not-saved') {
        setReceipts((old) =>
          Object.fromEntries(
            Object.entries(old).filter(
              ([, receipt]) => receipt.kind !== 'uncertain' || receipt.id !== operationId,
            ),
          ),
        );
        for (const [key, intent] of intents.current)
          if (intent.id === operationId) intents.current.delete(key);
        setError('This routine was not saved. Refresh suggestions to try again.');
      }
      resource.reload();
    } catch (cause) {
      setError(safeError(cause).message);
    } finally {
      setBusy(false);
    }
  }
  const dismiss = () => {
    void new ProactiveDomain(client).skip(workspaceId).catch(() => undefined);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) dismiss();
      }}
    >
      <DialogContent size="editor">
        <EditorSurface
          className="p-6"
          header={
            <DialogHeader>
              <DialogTitle>Proactive help</DialogTitle>
              <DialogDescription>
                Choose what {suggestions?.mainName ?? status?.mainName ?? 'your Main Pebble'} should
                check for you.
              </DialogDescription>
            </DialogHeader>
          }
          footer={
            <DialogFooter>
              <Button variant="quiet" onClick={dismiss} disabled={busy}>
                Not now
              </Button>
              {suggestions && drafts.length > 0 && (
                <Button
                  onClick={() => void enable()}
                  disabled={
                    busy ||
                    !selected.length ||
                    selected.some(
                      (id) =>
                        receipts[id]?.kind === 'uncertain' ||
                        !drafts.find((draft) => draft.id === id)?.prompt.trim() ||
                        !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(
                          drafts.find((draft) => draft.id === id)?.time ?? '',
                        ),
                    )
                  }
                >
                  Enable selected
                </Button>
              )}
            </DialogFooter>
          }
        >
          <div className="grid min-w-0 gap-4">
            <LoadingBar
              active={busy || resource.state.kind === 'pending'}
              label="Checking routine setup"
            />
            {resource.state.kind === 'failed' && (
              <Notice>
                {resource.state.error.message}
                <Button variant="quiet" onClick={resource.reload}>
                  Try again
                </Button>
              </Notice>
            )}
            {status?.routines
              .filter((routine) => routine.state !== 'completed')
              .map((routine) => (
                <Notice key={routine.id}>
                  {routine.name}: save not confirmed.
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void check(routine.id, routine.id)}
                  >
                    Check save
                  </Button>
                </Notice>
              ))}
            {!suggestions && (
              <div className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  Suggestions use your connected tools. Nothing runs until you choose a schedule.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void discover()}
                  disabled={busy || !status}
                >
                  Find suggestions
                </Button>
              </div>
            )}
            {suggestions && (
              <div className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  Times use {suggestions.timezone}. Results appear in {suggestions.mainName}’s chat.
                </p>
                <Button variant="quiet" disabled={busy} onClick={() => void discover()}>
                  <RefreshCw />
                  Refresh suggestions
                </Button>
                {!drafts.length && (
                  <p className="text-sm">
                    No new routines suggested from your available tools. You can ask your Main
                    Pebble for a routine anytime.
                  </p>
                )}
                {drafts.map((draft) => {
                  const receipt = receipts[draft.id];
                  const frozen = busy || receipt?.kind === 'saved' || receipt?.kind === 'uncertain';
                  return (
                    <Card key={draft.id}>
                      <CardHeader>
                        <Label className="flex items-center gap-3">
                          <Checkbox
                            checked={selected.includes(draft.id)}
                            disabled={frozen}
                            onCheckedChange={(checked) =>
                              setSelected((old) =>
                                checked ? [...old, draft.id] : old.filter((id) => id !== draft.id),
                              )
                            }
                          />
                          {draft.name}
                          {receipt?.kind === 'saved' && (
                            <Check className="ml-auto size-4" aria-label="Saved" />
                          )}
                        </Label>
                      </CardHeader>
                      {selected.includes(draft.id) && (
                        <CardContent className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor={`routine-${draft.id}-prompt`}>Instructions</Label>
                            <Textarea
                              id={`routine-${draft.id}-prompt`}
                              value={draft.prompt}
                              maxLength={6000}
                              disabled={frozen}
                              onChange={(event) => edit(draft.id, { prompt: event.target.value })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                              <Label htmlFor={`routine-${draft.id}-time`}>Time</Label>
                              <Input
                                type="time"
                                id={`routine-${draft.id}-time`}
                                value={draft.time}
                                disabled={frozen}
                                onChange={(event) => edit(draft.id, { time: event.target.value })}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor={`routine-${draft.id}-days`}>Repeat</Label>
                              <Select
                                value={draft.days}
                                disabled={frozen}
                                onValueChange={(days) => {
                                  if (days === 'daily' || days === 'weekdays' || days === 'weekly')
                                    edit(draft.id, { days });
                                }}
                              >
                                <SelectTrigger id={`routine-${draft.id}-days`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="weekdays">Weekdays</SelectItem>
                                  <SelectItem value="daily">Daily</SelectItem>
                                  <SelectItem value="weekly">Mondays</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {receipt?.kind === 'uncertain' && (
                            <Notice>
                              This save hasn’t been confirmed. Don’t create it again.
                              <Button
                                variant="quiet"
                                disabled={busy}
                                onClick={() => void check(draft.id, receipt.id)}
                              >
                                <RefreshCw />
                                Check save
                              </Button>
                            </Notice>
                          )}
                          {receipt?.kind === 'failed' && <Notice>{receipt.message}</Notice>}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
            {error && <Notice>{error}</Notice>}
          </div>
        </EditorSurface>
      </DialogContent>
    </Dialog>
  );
}
