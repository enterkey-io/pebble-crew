import { ArrowRight, Check, CirclePlay, MessageSquare, Pencil, Plus } from 'lucide-react';
import type { WorkTaskView, WorkspaceSnapshot } from '@hermes-client/protocol';
import { Item, ItemContent, ItemMedia, ItemTitle } from '../components/ui/item';
import { MessageBody } from '../MessageBody';
import { statusNames } from './WorkArea';

const names: Record<string, string> = {
  created: 'Created task',
  assigned: 'Changed assignee',
  edited: 'Edited task',
  reprioritized: 'Changed priority',
  claimed: 'Started work',
  completed: 'Completed task',
  blocked: 'Blocked task',
  unblocked: 'Unblocked task',
  archived: 'Archived task',
  review_requested: 'Requested review',
  reopened: 'Reopened task',
  status: 'Changed status',
};
function eventLabel(event: WorkTaskView['events'][number]) {
  const status = Object.entries(statusNames).find(([id]) => id === event.status)?.[1];
  return event.kind === 'status' && status
    ? `Moved to ${status}`
    : (names[event.kind] ?? event.kind.replaceAll('_', ' '));
}

export function TaskActivity({
  view,
  workspace,
}: {
  view: WorkTaskView;
  workspace: WorkspaceSnapshot;
}) {
  const author = (value: string | null) =>
    value === 'owner'
      ? 'You'
      : ['dashboard', 'hermes-system', 'system'].includes(value ?? '')
        ? 'Hermes'
        : (workspace.bots.find((bot) => bot.profile === value || `@${bot.handle}` === value)
            ?.name ??
          value ??
          'Hermes');
  const rows = [
    ...view.comments.map((comment) => ({
      key: `comment-${comment.id}`,
      at: comment.createdAt,
      actor: author(comment.author),
      label: 'Comment',
      body: comment.body,
      icon: MessageSquare,
      mentions: view.mentions.filter((m) => m.commentId === comment.id),
    })),
    ...view.events
      .filter((event) => event.kind !== 'commented')
      .map((event) => ({
        key: `event-${event.id}`,
        at: event.createdAt,
        actor: author(event.actor),
        label: eventLabel(event),
        body: event.summary,
        icon:
          event.kind === 'created'
            ? Plus
            : event.kind === 'completed'
              ? Check
              : event.kind === 'claimed'
                ? CirclePlay
                : event.kind === 'edited'
                  ? Pencil
                  : ArrowRight,
        mentions: [],
      })),
    ...view.runs
      .filter((run) => run.endedAt && run.summary)
      .map((run) => ({
        key: `run-${run.id}`,
        at: run.endedAt ?? run.startedAt,
        actor: author(run.profile),
        label: 'Worker report',
        body: run.summary,
        icon: Check,
        mentions: [],
      })),
  ].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  return rows.length ? (
    <div role="list" aria-label="Task history" className="grid gap-4">
      {rows.map((row) => (
        <Item key={row.key} role="listitem" className="items-start px-0">
          <ItemMedia className="text-muted-foreground">
            <row.icon className="size-4" aria-hidden="true" />
          </ItemMedia>
          <ItemContent className="min-w-0 gap-2">
            <ItemTitle className="flex w-full flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
              <span>
                {row.actor} · {row.label}
              </span>
              <time
                dateTime={new Date(row.at * 1000).toISOString()}
                className="font-normal text-muted-foreground"
              >
                {new Intl.DateTimeFormat(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(row.at * 1000)}
              </time>
            </ItemTitle>
            {row.body && <MessageBody text={row.body} />}
            {row.mentions.map((mention) => (
              <span key={mention.id} className="text-xs text-muted-foreground">
                @
                {workspace.bots.find((bot) => bot.profile === mention.profile)?.handle ??
                  mention.profile}{' '}
                ·{' '}
                {mention.state === 'sent'
                  ? 'Notified'
                  : mention.state === 'pending' || mention.state === 'sending'
                    ? 'Notification queued'
                    : 'Delivery unconfirmed'}
              </span>
            ))}
          </ItemContent>
        </Item>
      ))}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">No activity yet.</p>
  );
}
