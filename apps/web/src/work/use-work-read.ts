import { useRecoveryRevision } from '../connection/recovery-context';
import { useCallback, useEffect, useState } from 'react';
import { safeError } from '@hermes-client/core';
import type { ClientError, ErrorCode } from '@hermes-client/core';

export type WorkReadState<T> =
  | { kind: 'pending'; value: T | undefined }
  | { kind: 'ready'; value: T }
  | { kind: 'failed'; value: T | undefined; error: ClientError };

const temporary = new Set<ErrorCode>([
  'DISCONNECTED',
  'REQUEST_FAILED',
  'REQUEST_TIMEOUT',
  'RPC_FAILED',
]);

// Only catalog/board reads use this recovery loop. Mutations keep their receipt protocol.
export function useWorkRead<T>({
  scope,
  read,
  connected,
  recovery,
}: {
  scope: string | undefined;
  read: () => Promise<T>;
  connected: boolean;
  recovery?: number;
}) {
  const revision = useRecoveryRevision();
  const recovered = recovery ?? revision;
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    scope: string | undefined;
    read: () => Promise<T>;
    refresh: number;
    state: WorkReadState<T>;
  }>({ scope, read, refresh, state: { kind: 'pending', value: undefined } });
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    if (!scope || !connected) return;
    if (
      snapshot.scope === scope &&
      snapshot.read === read &&
      snapshot.refresh === refresh &&
      snapshot.state.kind === 'failed' &&
      snapshot.state.error.code === 'INVALID_RESPONSE'
    )
      return;
    let active = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const publish = (next: (value: T | undefined) => WorkReadState<T>) => {
      if (active)
        setSnapshot((previous) => ({
          scope,
          read,
          refresh,
          state: next(previous.scope === scope ? previous.state.value : undefined),
        }));
    };
    async function load() {
      let delay = 5000;
      try {
        const value = await read();
        if (!active) return;
        failures = 0;
        publish(() => ({ kind: 'ready', value }));
      } catch (cause) {
        if (!active) return;
        const error = safeError(cause);
        failures++;
        if (temporary.has(error.code) && failures === 1) {
          publish((value) => ({ kind: 'pending', value }));
          delay = 750;
        } else publish((value) => ({ kind: 'failed', value, error }));
        if (!temporary.has(error.code)) return;
      }
      if (active) timer = setTimeout(() => void load(), delay);
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scope, read, connected, refresh, recovered]);
  const updateValue = useCallback(
    (update: (value: T) => T) => {
      setSnapshot((current) =>
        current.scope === scope && current.read === read && current.state.value !== undefined
          ? { ...current, state: { kind: 'ready', value: update(current.state.value) } }
          : current,
      );
    },
    [scope, read],
  );
  const state: WorkReadState<T> =
    connected && snapshot.scope === scope && snapshot.read === read && snapshot.refresh === refresh
      ? snapshot.state
      : { kind: 'pending', value: snapshot.scope === scope ? snapshot.state.value : undefined };
  return { state, reload, updateValue };
}
