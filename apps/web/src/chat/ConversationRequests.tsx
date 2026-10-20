import { useEffect, useRef, useState } from 'react';
import type { BotBridgeClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { RequestDomain, type WorkspaceRequest } from '@hermes-client/protocol';
import { RequestReview } from './RequestReview';
import { Notice } from '../ui/primitives';
import { ApprovalSurface } from '../components/ai-elements/confirmation';
import { Button } from '../components/ui/button';

export function ConversationRequests({
  client,
  profile,
  workspace,
  version,
  onOpen,
  focusId,
}: {
  client: BotBridgeClient;
  profile: string;
  workspace: WorkspaceSnapshot;
  version: number;
  onOpen: (profile: string, requestId: string) => void;
  focusId?: string | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const focused = useRef<string | undefined>(undefined);
  const [requests, setRequests] = useState<WorkspaceRequest[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!focusId || focused.current === focusId) return;
    const card = container.current?.querySelector<HTMLElement>(
      `[data-request-id="${CSS.escape(focusId)}"]`,
    );
    if (!card) return;
    focused.current = focusId;
    card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    card.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [focusId, requests]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await new RequestDomain(client).list();
        if (active) setRequests(result);
      } catch {
        /* Transport restoration retains the existing cards. */
      } finally {
        if (active) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, profile, version, revision]);
  const own = requests.filter((request) => request.actor === profile);
  const waiting =
    profile === workspace.orchestrator
      ? requests.filter(
          (request) =>
            request.actor !== 'owner' && request.actor !== profile && request.state === 'pending',
        )
      : [];
  async function decide(request: WorkspaceRequest, approve: boolean, confirmation?: string) {
    if (busy) return;
    setBusy(request.id);
    setError('');
    try {
      const state = await new RequestDomain(client).decide(request, approve, confirmation);
      setRequests((current) =>
        current.map((row) => (row.id === request.id ? { ...row, state } : row)),
      );
      setRevision((current) => current + 1);
    } catch {
      setError('This decision could not be confirmed. Check the request before trying again.');
    } finally {
      setBusy(undefined);
    }
  }
  if (!own.length && !waiting.length && !error) return null;
  return (
    <div ref={container} className="grid gap-4">
      {error && <Notice error>{error}</Notice>}
      {own.map((request) => (
        <div key={request.id} data-request-id={request.id}>
          <RequestReview
            request={request}
            busy={busy === request.id}
            onDecision={(approve, confirmation) => void decide(request, approve, confirmation)}
            onInspect={() => {
              void client
                .invoke('requests.reconcile', { id: request.id })
                .then(() => setRevision((n) => n + 1))
                .catch(() => setError('The outcome could not be confirmed.'));
            }}
          />
        </div>
      ))}
      {waiting.map((request) => {
        const agent = workspace.bots.find((bot) => bot.profile === request.actor);
        if (!agent) return null;
        return (
          <ApprovalSurface
            key={request.id}
            title={`${agent.name} is waiting for you`}
            description="An approval is needed in their conversation."
          >
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => onOpen(agent.profile, request.id)}>
                View request
              </Button>
            </div>
          </ApprovalSurface>
        );
      })}
    </div>
  );
}
