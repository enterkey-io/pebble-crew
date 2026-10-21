import { useCallback } from 'react';
import { ClientError } from '@hermes-client/core';
import { WorkDomain } from '@hermes-client/protocol';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { useWorkRead } from './use-work-read';

export function useWorkCatalog(
  client: BotBridgeClient | undefined,
  workspaceId: string | undefined,
  connected: boolean,
) {
  const read = useCallback(async () => {
    if (!client || !workspaceId) throw new ClientError('DISCONNECTED');
    const value = await new WorkDomain(client).catalog();
    if (value.workspaceId !== workspaceId) throw new ClientError('INVALID_RESPONSE');
    return value;
  }, [client, workspaceId]);
  const result = useWorkRead({
    scope: workspaceId,
    read,
    connected: connected && !!client?.supportsProjects,
  });
  return { catalog: result.state.value, state: result.state, reload: result.reload };
}
