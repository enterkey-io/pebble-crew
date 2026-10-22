import { useCallback } from 'react';
import { ClientError } from '@hermes-client/core';
import { WorkDomain } from '@hermes-client/protocol';
import type { SessionClient } from '@hermes-client/protocol';
import { useWorkRead } from './use-work-read';

export function useWorkCatalog(
  client: SessionClient | undefined,
  workspaceId: string | undefined,
  connected: boolean,
  recovery = 0,
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
    recovery,
    connected: connected && !!client?.supportsProjects,
  });
  return { catalog: result.state.value, state: result.state, reload: result.reload };
}
