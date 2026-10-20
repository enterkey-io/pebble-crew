import type { WorkTaskDraft, WorkReceipt, WorkspaceSnapshot } from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Notice } from '../ui/primitives';

export function Assignment({
  value,
  onChange,
  workspace,
  allowAssignment = true,
}: {
  value: WorkTaskDraft;
  onChange: (patch: Partial<WorkTaskDraft>) => void;
  workspace: WorkspaceSnapshot;
  allowAssignment?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Label layout="stacked">
        Assigned to
        <Select
          disabled={!allowAssignment}
          value={value.assignee ?? 'none'}
          onValueChange={(value) => onChange({ assignee: value === 'none' ? null : value })}
        >
          <SelectTrigger aria-label="Assigned to">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {value.assignee &&
              !workspace.bots.some(
                (b) => b.profile === value.assignee && b.enrolled && b.available !== false,
              ) && (
                <SelectItem disabled value={value.assignee}>
                  {value.assignee} (unavailable)
                </SelectItem>
              )}
            {workspace.bots
              .filter((b) => b.enrolled && b.available !== false)
              .map((bot) => (
                <SelectItem key={bot.id} value={bot.profile}>
                  {bot.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Label>
      <Label layout="stacked">
        Priority
        <Select
          value={String(value.priority)}
          onValueChange={(v) => onChange({ priority: Number(v) })}
        >
          <SelectTrigger aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="-1">Low</SelectItem>
            <SelectItem value="0">Normal</SelectItem>
            <SelectItem value="1">High</SelectItem>
            <SelectItem value="2">Urgent</SelectItem>
            {![-1, 0, 1, 2].includes(value.priority) && (
              <SelectItem value={String(value.priority)}>Priority {value.priority}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Label>
    </div>
  );
}

export function ReceiptCheck({
  receipt,
  checking,
  onCheck,
  onResume,
  onOpen,
  onClose,
}: {
  receipt: WorkReceipt;
  checking: boolean;
  onCheck: () => void;
  onResume: (() => void) | undefined;
  onOpen: (board: string) => void;
  onClose: () => void;
}) {
  if (receipt.kind !== 'pending')
    return (
      <div className="grid gap-4" role="status">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onOpen(receipt.board)}>View Board</Button>
        </div>
      </div>
    );
  return (
    <Notice>
      The save is not yet confirmed.
      <Button variant="quiet" disabled={checking} onClick={onCheck}>
        Check save
      </Button>
      {onResume && (
        <Button variant="quiet" disabled={checking} onClick={onResume}>
          Resume save
        </Button>
      )}
    </Notice>
  );
}
