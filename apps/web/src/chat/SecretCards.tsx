import { useEffect, useRef, useState } from 'react';
import { RequestDomain, type SessionClient } from '@hermes-client/protocol';
import { SecretCard } from '../components/ai-elements/secret-card';
import type { TranscriptCard } from './presentation';

type SecretRequest = Awaited<ReturnType<RequestDomain['secrets']>>[number];
export function useSecretCards({
  client,
  sessionId,
  version,
  scope,
}: {
  client: SessionClient | undefined;
  sessionId: string | undefined;
  version: number;
  scope: string | undefined;
}): TranscriptCard[] {
  const [, setBatch] = useState<{
    scope: string | undefined;
    session: string;
    requests: SecretRequest[];
  }>();
  const [refresh, setRefresh] = useState(0);
  const snapshots = useRef(new Map<string, SecretRequest[]>());
  const outcomes = useRef(new Map<string, 'submitted' | 'inactive' | 'uncertain'>());
  const drafts = useRef(new Map<string, string>());
  const owner = useRef(scope);
  if (owner.current !== scope) {
    owner.current = scope;
    drafts.current.clear();
    snapshots.current.clear();
    outcomes.current.clear();
  }
  useEffect(() => {
    if (!client || !sessionId) return;
    const connection = client,
      session = sessionId;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const requests = await new RequestDomain(connection).secrets(session);
        if (active)
          setBatch(() => {
            const saved = snapshots.current.get(scope + ':' + session) ?? [];
            const missing = saved.filter((row) => !requests.some((next) => next.id === row.id));
            for (const row of missing)
              if (!outcomes.current.has(scope + ':' + session + ':' + row.id))
                outcomes.current.set(scope + ':' + session + ':' + row.id, 'inactive');
            const merged = [...requests, ...missing];
            snapshots.current.set(scope + ':' + session, merged);
            return { scope, session, requests: merged };
          });
      } catch {
        /* Retain known forms through transport restoration. */
      } finally {
        if (active) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, scope, sessionId, version, refresh]);
  if (!client || !sessionId) return [];
  return (snapshots.current.get(scope + ':' + sessionId) ?? []).map((request) => {
    const key = scope + ':' + sessionId + ':' + request.id,
      outcome = outcomes.current.get(key);
    async function respond(value: string) {
      if (!client || !sessionId) return;
      drafts.current.delete(key);
      try {
        await new RequestDomain(client).secret(sessionId, request.id, value);
        outcomes.current.set(key, 'submitted');
      } catch {
        outcomes.current.set(key, 'uncertain');
      }
      setRefresh((n) => n + 1);
    }
    return {
      id: 'secret:' + key,
      needsInput: !outcome,
      content: outcome ? (
        <p data-slot="approval-receipt" className="px-4 py-2 text-xs text-muted-foreground">
          {outcome === 'submitted'
            ? 'Secret submitted · value kept out of chat'
            : outcome === 'inactive'
              ? 'Secret request no longer pending'
              : 'Secret submission unconfirmed · check with the pebble before sending it again'}
        </p>
      ) : (
        <SecretCard
          title="Secret requested"
          label={request.label}
          description={request.prompt}
          initialValue={drafts.current.get(key) ?? ''}
          onValueChange={(value) => {
            if (value) drafts.current.set(key, value);
            else drafts.current.delete(key);
          }}
          onSubmit={respond}
          onSkip={() => void respond('')}
        />
      ),
    };
  });
}
