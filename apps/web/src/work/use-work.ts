import { useCallback, useEffect, useState } from 'react';
import { WorkDomain } from '@hermes-client/protocol';
import type { BotBridgeClient, WorkCatalog } from '@hermes-client/protocol';

export function useWorkCatalog(
  client: BotBridgeClient | undefined,
  workspaceId: string | undefined,
) {
  const [catalog, setCatalog] = useState<WorkCatalog>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    if (!client?.supportsProjects || !workspaceId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await new WorkDomain(client).catalog();
        if (live && value.workspaceId === workspaceId) {
          setCatalog(value);
          setError('');
        }
      } catch {
        if (live) setError('Project boards could not be loaded.');
      } finally {
        if (live) timer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, workspaceId, refresh]);
  return { catalog: catalog?.workspaceId === workspaceId ? catalog : undefined, error, reload };
}
