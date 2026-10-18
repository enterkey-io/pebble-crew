import { useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { Activity } from './activity';
export type CheckpointValue =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'read-only'; label: string }
  | {
      kind: 'available';
      label: string;
      effect: string;
      state: 'ready' | 'pending' | 'complete' | 'failed' | 'uncertain';
      onRestore: () => void;
    };
export function Checkpoint({ value }: { value: CheckpointValue }) {
  const [open, setOpen] = useState(false);
  if (value.kind === 'unavailable')
    return <p className="text-xs text-muted-foreground">{value.reason}</p>;
  if (value.kind === 'read-only')
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <History className="size-3.5" />
        {value.label}
      </span>
    );
  return (
    <div className="grid gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="quiet"
            size="sm"
            disabled={
              value.state === 'pending' || value.state === 'uncertain' || value.state === 'complete'
            }
          >
            <History />
            {value.label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore checkpoint?</AlertDialogTitle>
            <AlertDialogDescription>{value.effect}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={value.onRestore}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {value.state !== 'ready' && (
        <Activity
          title={
            value.state === 'uncertain'
              ? 'Checking restore'
              : value.state === 'complete'
                ? 'Restored'
                : value.state === 'failed'
                  ? 'Restore failed'
                  : 'Restoring'
          }
          state={
            value.state === 'pending'
              ? 'running'
              : value.state === 'uncertain'
                ? 'unknown'
                : value.state
          }
        />
      )}
    </div>
  );
}
