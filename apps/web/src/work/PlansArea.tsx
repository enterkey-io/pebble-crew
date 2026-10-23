import { useState } from 'react';
import { Target, Plus, Pencil } from 'lucide-react';
import type { PlanDraft, SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { LoadingBar } from '../components/ui/loading-bar';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '../components/ui/empty';
import type { Organization } from '../ui/organization';
import { WorkHeader } from './WorkHeader';
import { WorkReadError } from './WorkReadError';
import { usePlans, sameBoard } from './use-plans';
import { PlanEditor } from './PlanEditor';
export { BoardOutcome } from './BoardOutcome';
function blank(): PlanDraft {
  return {
    id: null,
    title: '',
    outcome: '',
    body: '',
    status: 'active',
    ownerId: null,
    parentId: null,
    crewIds: [],
    boards: [],
  };
}
export function PlansArea({
  client,
  workspace,
  organization,
  connected,
  onNavigate,
  onBoard,
}: {
  client: SessionClient;
  workspace: WorkspaceSnapshot;
  organization: Organization;
  connected: boolean;
  onNavigate: () => void;
  onBoard: (slug: string) => void;
}) {
  const resource = usePlans(client, workspace, connected);
  const [editing, setEditing] = useState<PlanDraft>();
  const data = resource.state.value;
  return (
    <section className="pc-work-area" aria-label="Plans">
      <WorkHeader title="Plans" onNavigate={onNavigate}>
        {!!data?.plans.length && (
          <Button onClick={() => setEditing(blank())} disabled={!data}>
            <Plus />
            New plan
          </Button>
        )}
      </WorkHeader>
      <LoadingBar active={resource.state.kind === 'pending'} label="Loading plans" />
      {resource.state.kind === 'failed' && (
        <WorkReadError
          subject="plans"
          error={resource.state.error}
          onRetry={resource.reload}
          onReconnect={resource.reload}
          retained={!!data}
        />
      )}
      <div className="grid min-h-0 content-start gap-4 overflow-y-auto p-4 md:p-6">
        {data && !data.plans.length && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Target />
              </EmptyMedia>
              <EmptyTitle>What are you working toward?</EmptyTitle>
              <EmptyDescription>Connect your goals to crews and project boards.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setEditing(blank())}>New plan</Button>
            </EmptyContent>
          </Empty>
        )}
        {data?.plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader className="flex flex-row items-start gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle>
                  <h2 className="break-words">{plan.title}</h2>
                </CardTitle>
                <CardDescription className="mt-2 whitespace-pre-wrap break-words">
                  {plan.outcome}
                </CardDescription>
              </div>
              <Badge variant="secondary">{plan.status}</Badge>
              <Button
                variant="quiet"
                size="icon-sm"
                aria-label={`Edit ${plan.title}`}
                onClick={() => setEditing(plan)}
              >
                <Pencil />
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {plan.parentId && (
                <p className="text-xs text-muted-foreground">
                  Part of{' '}
                  {data.plans.find((p) => p.id === plan.parentId)?.title ?? 'unavailable plan'}
                </p>
              )}
              {plan.ownerId && (
                <p className="text-sm">
                  {workspace.bots.find((bot) => bot.id === plan.ownerId)?.name ??
                    'Unavailable owner'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {plan.crewIds.map((id) => (
                  <Badge key={id} variant="secondary">
                    {organization.crews.find((crew) => crew.id === id)?.name ?? 'Unavailable crew'}
                  </Badge>
                ))}
                {plan.boards.map((ref) => {
                  const board = data.boards.find((board) => sameBoard(ref, board));
                  return (
                    <Button
                      key={ref.projectId}
                      variant="secondary"
                      size="sm"
                      disabled={!board}
                      onClick={() => onBoard(ref.slug)}
                    >
                      {board?.name ?? 'Unavailable board'}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && data && (
        <PlanEditor
          draft={editing}
          snapshot={data}
          workspace={workspace}
          organization={organization}
          client={client}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            resource.reload();
          }}
        />
      )}
    </section>
  );
}
