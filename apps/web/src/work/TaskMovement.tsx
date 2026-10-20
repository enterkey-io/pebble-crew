import type { WorkStatus } from '@hermes-client/protocol';
import { workMoveStatuses } from '@hermes-client/protocol';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Notice } from '../ui/primitives';
import { statusNames } from './WorkArea';
import type { useTaskMovement } from './use-task-movement';

export function TaskMovement({
  status,
  movement,
  needsSave = false,
  disabled = false,
}: {
  status: WorkStatus;
  needsSave?: boolean;
  disabled?: boolean;
  movement: ReturnType<typeof useTaskMovement> & {
    choose: (status: (typeof workMoveStatuses)[number]) => void;
  };
}) {
  return (
    <div className="grid gap-3">
      <Label layout="stacked">
        <span className="flex items-center gap-2">
          Status{' '}
          {needsSave && (
            <span className="text-xs font-normal text-muted-foreground">Save edits first</span>
          )}
        </span>
        <Select
          value={status}
          disabled={disabled || needsSave || movement.busy || !!movement.uncertain}
          onValueChange={(value) => {
            const selected = workMoveStatuses.find((status) => status === value);
            if (selected) movement.choose(selected);
          }}
        >
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!workMoveStatuses.some((s) => s === status) && (
              <SelectItem value={status} disabled>
                {statusNames[status]}
              </SelectItem>
            )}
            {workMoveStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {statusNames[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      {movement.error && <Notice error>{movement.error}</Notice>}
      {movement.uncertain && (
        <Notice>
          The move is not yet confirmed.{' '}
          <Button variant="quiet" onClick={() => void movement.check()}>
            Check move
          </Button>
        </Notice>
      )}
    </div>
  );
}
