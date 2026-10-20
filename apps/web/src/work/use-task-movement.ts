import { useState } from 'react';
import { WorkDomain } from '@hermes-client/protocol';
import type { BotBridgeClient, WorkTask, WorkMoveStatus } from '@hermes-client/protocol';
import { safeError } from '@hermes-client/core';
import { moveIntent } from './move-intent';

export function useTaskMovement({
  client,
  workspaceId,
  board,
  onChanged,
}: {
  client: BotBridgeClient;
  workspaceId: string;
  board: string;
  onChanged: (task: WorkTask) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState<{ operationId: string; taskId: string }>();
  const domain = new WorkDomain(client);
  async function read(taskId: string) {
    onChanged((await domain.task({ workspaceId, board, id: taskId })).task);
  }
  async function move(task: WorkTask, status: WorkMoveStatus) {
    if (busy || uncertain || status === task.status) return;
    setBusy(true);
    setError('');
    let operationId: string | undefined;
    try {
      // A move does not overwrite task text. Refresh that text's revision while
      // preserving the position and assignee the owner actually acted on.
      const latest = (await domain.task({ workspaceId, board, id: task.id })).task;
      const intent = moveIntent(task, latest, status);
      if (intent === 'already') {
        onChanged(latest);
        return;
      }
      if (intent === 'changed') {
        onChanged(latest);
        setError('This task moved or was reassigned in Hermes. Review its current position.');
        return;
      }
      operationId = crypto.randomUUID();
      const receipt = await domain.moveTask({
        workspaceId,
        board,
        id: task.id,
        expectedRevision: latest.revision,
        operationId,
        status,
      });
      if (receipt.kind === 'pending') setUncertain({ operationId, taskId: task.id });
      else await read(task.id);
    } catch (cause) {
      const failure = safeError(cause);
      if (failure.code === 'STALE_REVISION') {
        setError('This task changed in Hermes. Review its current position and try again.');
        await read(task.id);
      } else if (failure.code === 'INVALID_PARAMETERS') {
        setError('Hermes could not move this task. Check its dependencies and current state.');
      } else if (['UPDATE_REQUIRED', 'REQUIRES_SETUP'].includes(failure.code)) {
        setError(failure.message);
      } else if (operationId) setUncertain({ operationId, taskId: task.id });
      else setError('The task could not be loaded. Try again when Hermes is connected.');
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!uncertain || busy) return;
    setBusy(true);
    try {
      const receipt = await domain.receipt({ workspaceId, operationId: uncertain.operationId });
      if (receipt.kind !== 'pending') {
        await read(uncertain.taskId);
        setUncertain(undefined);
      } else setError('The move is still unconfirmed. Check Hermes before trying again.');
    } catch {
      setError('The move could not be checked.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, uncertain, move, check };
}
