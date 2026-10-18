import { Button } from '../ui/button';
import { Activity } from './activity';
import type { Availability, RunState } from './states';
export type QueueItem = {
  readonly id: string;
  readonly title: string;
  readonly state: 'queued' | 'active' | 'complete' | 'failed' | 'cancelled';
  readonly cancel?: Availability<() => void>;
};
const states = {
  queued: 'pending',
  active: 'running',
  complete: 'complete',
  failed: 'failed',
  cancelled: 'cancelled',
} satisfies Record<QueueItem['state'], RunState>;
export function Queue({ items }: { items: readonly QueueItem[] }) {
  return items.length ? (
    <ol className="grid gap-3">
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center justify-between gap-2">
          <Activity title={item.title} state={states[item.state]} />
          {item.cancel?.kind === 'available' && (
            <Button variant="quiet" size="sm" onClick={item.cancel.action}>
              Cancel
            </Button>
          )}
        </li>
      ))}
    </ol>
  ) : (
    <p className="text-sm text-muted-foreground">Queue is empty</p>
  );
}
