import { AttentionVisible } from './ConversationAttention';
import { Checkbox } from '../components/ui/checkbox';
import { RequestDomain, type SessionClient, type ManagementReview } from '@hermes-client/protocol';
import { ApprovalSurface } from '../components/ai-elements/confirmation';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Disclosure } from '../components/ui/disclosure';
import { useContext, useEffect, useState } from 'react';
import { Check, X, AlertCircle, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import type { Row } from '../conversation';
export type RequestReviewDraft = {
  confirmation: string;
  expanded: boolean;
  acceptedDigest: string | null;
};
export function RequestReview({
  request: r,
  busy,
  onDecision,
  onInspect,
  compactResolved = false,
  targetName,
  decisionIssue,
  onCheck,
  client,
  draft,
  onDraft,
}: {
  client?: SessionClient | undefined;
  draft?: RequestReviewDraft | undefined;
  onDraft?: ((value: RequestReviewDraft) => void) | undefined;
  request: Row;
  busy: boolean;
  onDecision: (approve: boolean, confirmation?: string, review?: ManagementReview) => void;
  onInspect: () => void;
  compactResolved?: boolean;
  targetName?: string | undefined;
  decisionIssue?: string | undefined;
  onCheck?: (() => void) | undefined;
}) {
  const [local, setLocal] = useState<RequestReviewDraft>({
    confirmation: '',
    expanded: false,
    acceptedDigest: null,
  });
  const { confirmation, expanded, acceptedDigest } = draft ?? local;
  function patch(value: Partial<typeof local>) {
    const next = { confirmation, expanded, acceptedDigest, ...value };
    if (onDraft) onDraft(next);
    else setLocal(next);
  }
  const setConfirmation = (confirmation: string) => patch({ confirmation });
  const setExpanded = (expanded: boolean) => patch({ expanded });
  const visible = useContext(AttentionVisible);
  const [review, setReview] = useState<ManagementReview>();
  const [reviewVersion, setReviewVersion] = useState(0);
  useEffect(() => {
    if (!visible || !client || r.state !== 'pending' || typeof r.id !== 'string') return;
    let active = true;
    setReview(undefined);
    void new RequestDomain(client)
      .review(r.id)
      .then((value) => {
        if (active) setReview(value);
      })
      .catch(() => {
        if (active)
          setReview({
            kind: 'blocked',
            reason: 'This request could not be checked. Retry review.',
          });
      });
    return () => {
      active = false;
    };
  }, [visible, client, r.id, r.state, decisionIssue, reviewVersion]);
  const spec = (r.spec ?? {}) as Row,
    result = (r.result ?? {}) as Row;
  const deleting = r.action === 'agent.delete';
  const target = targetName ?? String(spec.display_name ?? spec.profile ?? spec.name ?? 'Agent');
  const titles: Record<string, string> = {
    'agent.delete': 'Delete pebble',
    'agent.hide': spec.hidden ? 'Hide pebble' : 'Unhide pebble',
    'agent.create': 'Create pebble',
    'agent.enable': 'Add existing pebble',
    'agent.update': 'Update role',
    'agent.attach': 'Change tools and skills',
  };
  const fields = (
    <>
      <dl className="request-fields">
        {Object.entries(spec)
          .filter(
            ([key]) =>
              !['id', 'expected_revision', 'profile', 'soul', 'model_fingerprint'].includes(key),
          )
          .flatMap(([key, value]) => {
            const labels: Record<string, string> = {
              name: 'Handle',
              display_name: 'Name',
              model_source: 'Model authorization',
              manager: 'Reports to',
              team: 'Crew',
              toolsets: 'Tools',
              skills: 'Skills',
              role: 'Description',
              initialize_chat: 'Bot Chat',
              hidden: 'Hidden',
              responsibilities: 'Responsibilities',
              boundaries: 'Boundaries',
              expectedOutputs: 'Expected outputs',
              title: 'Title',
              description: 'Description',
            };
            const fields: [string, unknown][] =
              value && typeof value === 'object' && !Array.isArray(value)
                ? Object.entries(value as Row)
                : [[key, value]];
            return fields.map(([field, content]) => (
              <div key={`${key}:${field}`}>
                <dt>{labels[field] ?? field.replaceAll('_', ' ')}</dt>
                <dd>
                  {content == null
                    ? 'None'
                    : Array.isArray(content)
                      ? content.map(String).join(', ') || 'None'
                      : typeof content === 'boolean'
                        ? content
                          ? 'Yes'
                          : 'No'
                        : field === 'model_source' && content === 'default'
                          ? 'Primary profile’s selected model'
                          : String(content)}
                </dd>
              </div>
            ));
          })}
      </dl>
      {spec.soul != null && (
        <Disclosure title="Personality">
          <p className="preserve-whitespace">{String(spec.soul)}</p>
        </Disclosure>
      )}
    </>
  );
  const compactPending = compactResolved && r.state === 'pending';
  const details = (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <ApprovalSurface
        className={`request-card ${compactResolved ? 'gap-3 px-4 py-3.5 leading-normal' : ''} ${deleting ? 'destructive-request' : ''}`}
        title={titles[String(r.action)] ?? String(r.action)}
        description={
          <>
            <strong>{target}</strong>
            {r.state !== 'pending' && <> · {String(r.state)}</>}
            {compactResolved && r.state === 'pending' && (
              <span className="mt-1 line-clamp-2 break-words text-sm">
                {r.action === 'agent.attach'
                  ? [
                      ...(Array.isArray(spec.toolsets) ? spec.toolsets : []),
                      ...(Array.isArray(spec.skills) ? spec.skills : []),
                    ].join(', ')
                  : typeof spec.role === 'object' && spec.role
                    ? String((spec.role as Row).description ?? (spec.role as Row).title ?? '')
                    : typeof spec.description === 'string'
                      ? spec.description
                      : ''}
              </span>
            )}
          </>
        }
      >
        <div
          className={
            compactPending
              ? 'max-h-[24dvh] space-y-3 overflow-y-auto overscroll-contain'
              : 'contents'
          }
        >
          {deleting && (
            <p>
              Removes this Hermes profile, its personality files, memory, local conversations,
              skills and service. Crew history stays; this member can no longer work. This cannot be
              undone here.
            </p>
          )}
          {r.action === 'agent.hide' && (
            <p>
              {spec.hidden
                ? 'Removes it from the sidebar. Its profile, conversations and crew membership stay.'
                : 'Returns it to the sidebar.'}
            </p>
          )}
          {compactPending ? (
            <CollapsibleContent className="space-y-3">{fields}</CollapsibleContent>
          ) : (
            fields
          )}
          {r.state === 'unavailable' && (
            <p role="status">
              This request is no longer available. Ask the pebble for a new request.
            </p>
          )}
          {Boolean(result.reason || result.error) && (
            <p role="status">{String(result.reason ?? result.error)}</p>
          )}
          {client && r.state === 'pending' && review?.kind === 'ready' && review.legacy && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Older request. Review the current agent binding before approving.</p>
              <p className="break-all">
                Current manager: {review.manager ?? 'None'}
                {review.managerIdentity && (
                  <span className="block text-xs">Identity: {review.managerIdentity}</span>
                )}
              </p>
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={review.kind === 'ready' && acceptedDigest === review.digest}
                  onCheckedChange={(value) =>
                    patch({
                      acceptedDigest:
                        value === true && review.kind === 'ready' ? review.digest : null,
                    })
                  }
                />
                Use this current setup
              </Label>
            </div>
          )}
          {client && r.state === 'pending' && review?.kind === 'blocked' && (
            <div className="space-y-2 text-sm" role="status">
              <p>{review.reason}</p>
              <Button variant="quiet" onClick={() => setReviewVersion((n) => n + 1)}>
                Retry review
              </Button>
            </div>
          )}
          {decisionIssue && (
            <div className="space-y-2 text-sm text-muted-foreground" role="status">
              <p>{decisionIssue}</p>
              <Button variant="secondary" disabled={busy} onClick={onCheck}>
                Check status
              </Button>
            </div>
          )}
          {r.state === 'pending' && !decisionIssue && deleting && (
            <Label className="flex-col items-start">
              <span>
                Type <strong>{String(spec.profile)}</strong> to confirm
              </span>
              <Input
                aria-label="Confirm profile name"
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Label>
          )}
        </div>
        {r.state === 'pending' && !decisionIssue && (
          <>
            <div
              className={`request-actions ${compactPending ? 'flex flex-wrap items-center gap-2' : ''}`}
            >
              {compactPending && (
                <CollapsibleTrigger asChild>
                  <Button variant="quiet" size="sm" className="mr-auto px-0">
                    {expanded ? 'Read less' : 'Read more'}
                  </Button>
                </CollapsibleTrigger>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => onDecision(false)}
              >
                Deny
              </Button>
              <Button
                type="button"
                aria-label={deleting ? 'Delete permanently' : 'Approve exact request'}
                variant={deleting ? 'destructive' : 'default'}
                disabled={
                  busy ||
                  (client !== undefined &&
                    (review?.kind !== 'ready' ||
                      (review.legacy && acceptedDigest !== review.digest))) ||
                  (deleting && confirmation !== spec.profile)
                }
                onClick={() => onDecision(true, deleting ? confirmation : undefined, review)}
              >
                {deleting ? 'Delete permanently' : 'Approve'}
              </Button>
            </div>
          </>
        )}
        {['executing', 'uncertain', 'partial'].includes(String(r.state)) && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={deleting ? onInspect : onCheck}
          >
            Check outcome
          </Button>
        )}
      </ApprovalSurface>
    </Collapsible>
  );
  if (
    compactResolved &&
    ['completed', 'denied', 'failed', 'superseded', 'expired', 'unavailable'].includes(
      String(r.state),
    )
  ) {
    const state =
      r.state === 'completed'
        ? 'Approved'
        : r.state === 'denied'
          ? 'Denied'
          : r.state === 'superseded'
            ? 'Resolved'
            : r.state === 'expired' || r.state === 'unavailable'
              ? 'No longer active'
              : 'Failed';
    const Icon =
      r.state === 'completed' || r.state === 'superseded'
        ? Check
        : r.state === 'denied'
          ? X
          : AlertCircle;
    return (
      <Collapsible data-slot="approval-receipt" className="group/receipt min-w-0">
        <CollapsibleTrigger asChild>
          <Button
            variant="link"
            className="h-auto min-h-9 max-w-full justify-start gap-2 px-0 text-left text-xs text-muted-foreground whitespace-normal"
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {titles[String(r.action)] ?? 'Request'} · {target} · {state}
            </span>
            <ChevronRight
              className="size-3 shrink-0 transition-transform group-data-[state=open]/receipt:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        {['expired', 'unavailable'].includes(String(r.state)) && (
          <p role="status" className="pb-2 text-sm text-muted-foreground">
            This request is no longer available. Ask the pebble for a new request.
          </p>
        )}
        {r.state === 'failed' && (
          <div role="status" className="max-w-prose space-y-1 pb-2 text-sm text-muted-foreground">
            <p>
              {typeof result.error === 'string'
                ? result.error
                : 'This request could not be completed.'}
            </p>
            <p>Ask the pebble to review the cause and send a new request.</p>
          </div>
        )}
        <CollapsibleContent className="pt-2">{details}</CollapsibleContent>
      </Collapsible>
    );
  }
  return details;
}
