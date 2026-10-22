import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TranscriptCard } from './presentation';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { RequestDomain, type WorkspaceRequest } from '@hermes-client/protocol';
import { RequestReview } from './RequestReview';
import { Notice } from '../ui/primitives';
import { ApprovalSurface } from '../components/ai-elements/confirmation';
import { Button } from '../components/ui/button';

function RequestPosition({
  id,
  focus,
  children,
}: {
  id: string;
  focus: boolean;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    container.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    container.current?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [focus]);
  return (
    <div ref={container} data-request-id={id}>
      {children}
    </div>
  );
}

export function useConversationRequests({
  client,
  profile,
  workspace,
  version,
  onOpen,
  focusId,
}: {
  client: SessionClient | undefined;
  profile: string | undefined;
  workspace: WorkspaceSnapshot | undefined;
  version: number;
  onOpen: (profile: string, requestId: string) => void;
  focusId?: string | undefined;
}): TranscriptCard[] {
  const workspaceId = workspace?.id;
  const [batch, setBatch] = useState<{
    workspaceId: string;
    profile: string;
    requests: WorkspaceRequest[];
  }>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<{ id: string; message: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!client || !profile || !workspaceId) return;
    const scope = { profile, workspaceId };
    const connection = client;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await new RequestDomain(connection).list();
        if (active) setBatch({ ...scope, requests: result });
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
  }, [client, profile, workspaceId, version, revision]);
  if (!client || !workspace || !profile) return [];
  const requests =
    batch && batch.workspaceId === workspaceId && batch.profile === profile
      ? batch.requests.slice().reverse()
      : [];
  const own = requests.filter((request) => request.actor === profile);
  const waiting =
    profile === workspace.orchestrator
      ? requests.filter(
          (request) =>
            request.actor !== 'owner' && request.actor !== profile && request.state === 'pending',
        )
      : [];
  const connection = client;
  async function decide(request: WorkspaceRequest, approve: boolean, confirmation?: string) {
    if (busy) return;
    setBusy(request.id);
    setError(undefined);
    try {
      const state = await new RequestDomain(connection).decide(request, approve, confirmation);
      setBatch((current) =>
        current && current.workspaceId === workspaceId && current.profile === profile
          ? {
              ...current,
              requests: current.requests.map((row) =>
                row.id === request.id ? { ...row, state } : row,
              ),
            }
          : current,
      );
      setRevision((current) => current + 1);
    } catch {
      setError({
        id: request.id,
        message: 'This decision could not be confirmed. Check the request before trying again.',
      });
    } finally {
      setBusy(undefined);
    }
  }
  return [
    ...own.map((request): TranscriptCard => ({
      id: 'request:' + request.id,
      createdAt: request.createdAt,
      content: (
        <RequestPosition id={request.id} focus={focusId === request.id}>
          {error?.id === request.id && <Notice error>{error.message}</Notice>}
          <RequestReview
            request={request}
            compactResolved
            targetName={workspace.bots.find((bot) => bot.profile === request.spec.profile)?.name}
            busy={busy === request.id}
            onDecision={(approve, confirmation) => void decide(request, approve, confirmation)}
            onInspect={() => {
              void client
                .invoke('requests.reconcile', { id: request.id })
                .then(() => setRevision((n) => n + 1))
                .catch(() =>
                  setError({ id: request.id, message: 'The outcome could not be confirmed.' }),
                );
            }}
          />
        </RequestPosition>
      ),
    })),
    ...waiting.flatMap((request): TranscriptCard[] => {
      const agent = workspace.bots.find((bot) => bot.profile === request.actor);
      if (!agent) return [];
      return [
        {
          id: 'waiting:' + request.id,
          createdAt: request.createdAt,
          content: (
            <ApprovalSurface
              title={`${agent.name} is waiting for you`}
              description="An approval is needed in their conversation."
            >
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => onOpen(agent.profile, request.id)}>
                  View request
                </Button>
              </div>
            </ApprovalSurface>
          ),
        },
      ];
    }),
  ];
}
