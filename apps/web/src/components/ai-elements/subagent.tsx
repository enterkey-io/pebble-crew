import { ArrowUpRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Activity } from './activity';
import type { Availability, RunState } from './states';
export function Subagent({
  name,
  state,
  conversation,
}: {
  name: string;
  state: 'requested' | 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  conversation: Availability<() => void>;
}) {
  const status: RunState = state === 'requested' || state === 'queued' ? 'pending' : state;
  return (
    <div className="grid gap-2">
      <Activity title={name} state={status} />
      {conversation.kind === 'available' && (
        <Button variant="quiet" size="sm" className="w-fit px-0" onClick={conversation.action}>
          Message with {name}
          <ArrowUpRight />
        </Button>
      )}
    </div>
  );
}
