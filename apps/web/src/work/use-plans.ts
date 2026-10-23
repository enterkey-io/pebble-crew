import { useCallback } from 'react';
import { PlansDomain } from '@hermes-client/protocol';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { useWorkRead } from './use-work-read';
export const sameBoard = (
  a: { catalogId: string; projectId: string; slug: string },
  b: { catalogId: string; projectId: string; slug: string },
) => a.catalogId === b.catalogId && a.projectId === b.projectId && a.slug === b.slug;
export function usePlans(client: SessionClient, workspace: WorkspaceSnapshot, connected: boolean) {
  const read = useCallback(
    () => new PlansDomain(client).read(workspace.id),
    [client, workspace.id],
  );
  return useWorkRead({ scope: workspace.id, read, connected });
}
