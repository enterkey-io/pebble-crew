import { useEffect, useRef, useState } from 'react';
import { RequestDomain, type WorkspaceRequest, type SessionClient } from '@hermes-client/protocol';

export function useManagementRequests({
  client,
  scope,
  version,
}: {
  client: SessionClient | undefined;
  scope: string | undefined;
  version: number;
}) {
  const workspaceId = scope;
  const [batch, setBatch] = useState<{
    workspaceId: string;
    requests: WorkspaceRequest[];
  }>();
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [issues, setIssues] = useState<Record<string, string>>({});
  const currentScope = useRef({ client, scope });
  currentScope.current = { client, scope };
  const inflight = useRef(false);
  const generation = useRef(0);
  const receipts = useRef(new Map<string, Awaited<ReturnType<RequestDomain['decide']>>>());
  const key = (request: WorkspaceRequest) => `${workspaceId}:${request.id}:${request.fingerprint}`;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!client || !workspaceId) return;
    const scope = { workspaceId };
    const connection = client;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const started = generation.current;
      try {
        const result = await new RequestDomain(connection).list();
        if (active && started === generation.current) {
          setLoadError(false);
          setBatch({
            ...scope,
            requests: result.map((row) => {
              const receipt = receipts.current.get(
                `${scope.workspaceId}:${row.id}:${row.fingerprint}`,
              );
              return receipt && row.state === 'pending' && receipt.state !== 'pending'
                ? { ...row, ...receipt }
                : row;
            }),
          });
        }
      } catch {
        if (active && started === generation.current) setLoadError(true);
        /* Transport restoration retains the existing cards. */
      } finally {
        if (active) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, workspaceId, version, revision]);
  const connection = client;
  function apply(request: WorkspaceRequest, receipt: Awaited<ReturnType<RequestDomain['decide']>>) {
    const saved = receipts.current.get(key(request));
    if (receipt.state === 'pending' && saved && saved.state !== 'pending') return;
    receipts.current.set(key(request), receipt);
    setBatch((current) =>
      current && current.workspaceId === workspaceId
        ? {
            ...current,
            requests: current.requests.map((row) =>
              row.id === request.id && row.fingerprint === request.fingerprint
                ? { ...row, ...receipt }
                : row,
            ),
          }
        : current,
    );
  }
  function setIssue(request: WorkspaceRequest, message?: string) {
    setIssues((current) => {
      const next = { ...current };
      if (message) next[key(request)] = message;
      else delete next[key(request)];
      return next;
    });
  }
  async function checkStatus(request: WorkspaceRequest, manual = true) {
    if (!connection || (manual && inflight.current)) return;
    const started = generation.current;
    if (manual) {
      inflight.current = true;
      setBusy(request.id);
    }
    const current = () =>
      started === generation.current &&
      currentScope.current.client === connection &&
      currentScope.current.scope === workspaceId;
    try {
      const latest = (await new RequestDomain(connection).list()).find(
        (row) => row.id === request.id && row.fingerprint === request.fingerprint,
      );
      if (!current()) return;
      if (!latest)
        setIssue(request, 'This request is no longer active. Ask the pebble for a new request.');
      else if (latest.state !== 'pending' || manual) {
        apply(request, latest);
        setIssue(request);
      }
    } catch {
      if (current())
        setIssue(request, 'The decision could not be confirmed. Check status before trying again.');
    } finally {
      if (manual) {
        inflight.current = false;
        setBusy(undefined);
      }
    }
  }
  async function decide(request: WorkspaceRequest, approve: boolean, confirmation?: string) {
    if (!connection || inflight.current) return;
    inflight.current = true;
    generation.current++;
    setBusy(request.id);
    setIssue(request);
    try {
      const receipt = await new RequestDomain(connection).decide(request, approve, confirmation);
      apply(request, receipt);
      return receipt;
    } catch {
      setIssue(request, 'The decision could not be confirmed. Check status before trying again.');
      await checkStatus(request, false);
    } finally {
      inflight.current = false;
      setBusy(undefined);
      setRevision((current) => current + 1);
    }
  }
  return {
    requests: batch?.workspaceId === workspaceId ? (batch?.requests ?? []) : [],
    loading: Boolean(client && batch?.workspaceId !== workspaceId && !loadError),
    loadError,
    busy,
    issueFor: (request: WorkspaceRequest) => issues[key(request)],
    decide,
    checkStatus,
    refresh: () => setRevision((n) => n + 1),
  };
}
