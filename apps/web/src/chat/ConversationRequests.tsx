import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { TranscriptCard } from './presentation';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { useManagementRequests } from './useManagementRequests';
import { RequestReview } from './RequestReview';
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
  const {
    requests: listed,
    busy,
    issueFor,
    decide,
    checkStatus,
    refresh,
  } = useManagementRequests({ client, scope: workspace?.id, version });
  if (!client || !workspace || !profile) return [];
  const requests = listed.slice().reverse();
  const own = requests.filter((request) => request.actor === profile);
  const waiting =
    profile === workspace.orchestrator
      ? requests.filter(
          (request) =>
            request.actor !== 'owner' && request.actor !== profile && request.state === 'pending',
        )
      : [];
  return [
    ...own.map((request): TranscriptCard => ({
      id: 'request:' + request.id,
      createdAt: request.createdAt,
      content: (
        <RequestPosition id={request.id} focus={focusId === request.id}>
          <RequestReview
            request={request}
            compactResolved
            decisionIssue={issueFor(request)}
            onCheck={() => void checkStatus(request)}
            targetName={workspace.bots.find((bot) => bot.profile === request.spec.profile)?.name}
            busy={busy === request.id}
            onDecision={(approve, confirmation) => void decide(request, approve, confirmation)}
            onInspect={() => {
              void client
                .invoke('requests.reconcile', { id: request.id })
                .then(() => refresh())
                .catch(() => void checkStatus(request));
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
