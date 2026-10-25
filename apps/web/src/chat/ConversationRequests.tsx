import type { TranscriptCard } from './presentation';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import type { ManagementRequests } from './useManagementRequests';
import { RequestReview } from './RequestReview';
import { ApprovalSurface } from '../components/ai-elements/confirmation';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription, AlertAction } from '../components/ui/alert';

export function useConversationRequests({
  client,
  profile,
  workspace,
  management,
  onOpen,
}: {
  client: SessionClient | undefined;
  profile: string | undefined;
  workspace: WorkspaceSnapshot | undefined;
  management: ManagementRequests;
  onOpen: (profile: string, requestId: string) => void;
}): TranscriptCard[] {
  if (!client || !workspace || !profile) return [];
  const requests = management.requests
    .slice()
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const available = new Set<string | null>(
    workspace.bots
      .filter((bot) => bot.managed && !bot.hidden && !bot.deleted && bot.available !== false)
      .map((bot) => bot.profile),
  );
  const own = requests.filter(
    (request) =>
      request.actor === profile ||
      (profile === workspace.orchestrator &&
        (request.actor === 'owner' || !available.has(request.actor))),
  );
  const waiting =
    profile === workspace.orchestrator
      ? requests.filter(
          (request) =>
            request.actor !== 'owner' &&
            request.actor !== profile &&
            request.state === 'pending' &&
            available.has(request.actor),
        )
      : [];
  return [
    ...own.map((request): TranscriptCard => {
      return {
        id: 'request:' + request.id,
        needsInput: request.state === 'pending',
        createdAt: request.createdAt,
        content: (
          <div data-request-id={request.id}>
            <RequestReview
              client={client}
              request={request}
              compactResolved
              draft={management.reviewDraftFor(request)}
              onDraft={(value) => management.setReviewDraft(request, value)}
              decisionIssue={management.issueFor(request)}
              onCheck={() => void management.checkStatus(request)}
              targetName={workspace.bots.find((bot) => bot.profile === request.spec.profile)?.name}
              busy={management.busy === request.id}
              onDecision={(approve, confirmation, review) =>
                void management.decide(request, approve, confirmation, review)
              }
              onInspect={() => {
                void client
                  .invoke('requests.reconcile', { id: request.id })
                  .then(management.refresh)
                  .catch(() => void management.checkStatus(request));
              }}
            />
          </div>
        ),
      };
    }),
    ...waiting.map((request): TranscriptCard => {
      const agent = workspace.bots.find((bot) => bot.profile === request.actor);
      return {
        id: 'waiting:' + request.id,
        needsInput: true,
        createdAt: request.createdAt,
        content: (
          <ApprovalSurface
            title={`${agent?.name ?? 'A pebble'} is waiting for you`}
            description="Review their request."
          >
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => onOpen(agent?.profile ?? '', request.id)}>
                View request
              </Button>
            </div>
          </ApprovalSurface>
        ),
      };
    }),
    ...(management.faults.length
      ? [
          {
            id: 'request-read-issue',
            needsInput: true,
            content: (
              <ApprovalSurface
                title="Requests need checking"
                description="A request could not be read. Other requests are still available."
              >
                <Button variant="secondary" onClick={management.refresh}>
                  Try again
                </Button>
              </ApprovalSurface>
            ),
          },
        ]
      : []),
  ];
}

export function RequestDiscoveryStatus({ management }: { management: ManagementRequests }) {
  if (management.discovery !== 'unavailable') return null;
  return (
    <Alert
      role="status"
      aria-label="Request updates"
      className="pc-composer-width border-0 bg-transparent text-muted-foreground shadow-none"
    >
      <AlertDescription className="flex min-h-8 items-center pointer-coarse:min-h-11">
        Request updates are delayed.
      </AlertDescription>
      <AlertAction>
        <Button variant="quiet" size="sm" onClick={management.refresh}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
