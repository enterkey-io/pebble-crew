import type { RequestReviewDraft } from './RequestReview';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RequestDomain,
  type WorkspaceRequest,
  type SessionClient,
  type ManagementReview,
  type RequestFault,
} from '@hermes-client/protocol';

type Receipt = Awaited<ReturnType<RequestDomain['decide']>>;
export type ManagementRequests = ReturnType<typeof useManagementRequests>;
export function useManagementRequests({
  client,
  scope,
  version,
}: {
  client: SessionClient | undefined;
  scope: string | undefined;
  version: number;
}) {
  const [batch, setBatch] = useState<{
    scope: string;
    requests: WorkspaceRequest[];
    faults: RequestFault[];
  }>();
  const observed = useRef(batch);
  observed.current = batch;
  const reviewDrafts = useRef(new Map<string, RequestReviewDraft>());
  const [, redraw] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [issues, setIssues] = useState<Record<string, string>>({});
  const current = useRef({ client, scope });
  current.current = { client, scope };
  const inflight = useRef(false),
    generation = useRef(0);
  const receipts = useRef(new Map<string, Receipt>());
  const [revision, setRevision] = useState(0);
  const key = (request: WorkspaceRequest) => `${scope}:${request.id}:${request.fingerprint}`;
  useEffect(() => {
    if (!client || !scope) return;
    const connection = client,
      workspaceId = scope;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function load() {
      const started = generation.current;
      try {
        const domain = new RequestDomain(connection),
          result = await domain.read();
        const previous = observed.current;
        if (previous?.scope === workspaceId)
          for (const row of previous.requests) {
            if (row.state !== 'pending' || result.requests.some((next) => next.id === row.id))
              continue;
            let exact: WorkspaceRequest | null = null;
            try {
              exact = await domain.get(row.id);
            } catch {
              /* One unreadable old row cannot suppress a healthy new decision. */
            }
            if (exact && exact.fingerprint === row.fingerprint) result.requests.push(exact);
            else
              result.faults.push({
                id: row.id,
                message: 'A known request could not be confirmed.',
              });
          }
        if (active && started === generation.current) {
          setLoadError(false);
          setBatch((previous) => {
            const next = new Map(result.requests.map((row) => [row.id, row]));
            // Omission from recent history or an incomplete read never revokes consent.
            if (previous?.scope === workspaceId)
              for (const row of previous.requests) if (!next.has(row.id)) next.set(row.id, row);
            return {
              scope: workspaceId,
              faults: result.faults,
              requests: [...next.values()].map((row) => {
                const receipt = receipts.current.get(`${workspaceId}:${row.id}:${row.fingerprint}`);
                return receipt && row.state === 'pending' && receipt.state !== 'pending'
                  ? { ...row, ...receipt }
                  : row;
              }),
            };
          });
        }
      } catch {
        if (active && started === generation.current) setLoadError(true);
      } finally {
        if (active) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, scope, version, revision]);
  function apply(request: WorkspaceRequest, receipt: Receipt) {
    const saved = receipts.current.get(key(request));
    if (receipt.state === 'pending' && saved && saved.state !== 'pending') return;
    receipts.current.set(key(request), receipt);
    setBatch((previous) =>
      previous && previous.scope === scope
        ? {
            ...previous,
            faults: previous.faults.filter((fault) => fault.id !== request.id),
            requests: previous.requests.map((row) =>
              row.id === request.id && row.fingerprint === request.fingerprint
                ? { ...row, ...receipt }
                : row,
            ),
          }
        : previous,
    );
  }
  function setIssue(request: WorkspaceRequest, message?: string) {
    setIssues((previous) => {
      const next = { ...previous };
      if (message) next[key(request)] = message;
      else delete next[key(request)];
      return next;
    });
  }
  async function checkStatus(request: WorkspaceRequest, manual = true) {
    if (!client || (manual && inflight.current)) return;
    const connection = client,
      workspaceId = scope,
      started = generation.current;
    if (manual) {
      inflight.current = true;
      setBusy(request.id);
    }
    try {
      const latest = await new RequestDomain(connection).get(request.id);
      if (
        started !== generation.current ||
        current.current.client !== connection ||
        current.current.scope !== workspaceId
      )
        return;
      if (!latest || latest.fingerprint !== request.fingerprint) {
        setIssue(
          request,
          'This request could not be confirmed. Retry the status check; do not create a duplicate.',
        );
      } else if (latest.state !== 'pending' || manual) {
        apply(request, latest);
        setIssue(request);
      }
    } catch {
      setIssue(request, 'The decision could not be confirmed. Check status before trying again.');
    } finally {
      if (manual) {
        inflight.current = false;
        setBusy(undefined);
      }
    }
  }
  async function decide(
    request: WorkspaceRequest,
    approve: boolean,
    confirmation?: string,
    review?: ManagementReview,
  ) {
    if (!client || inflight.current) return;
    const connection = client,
      workspaceId = scope;
    inflight.current = true;
    generation.current++;
    setBusy(request.id);
    setIssue(request);
    try {
      const receipt = await new RequestDomain(connection).decide(
        request,
        approve,
        confirmation,
        review,
      );
      if (current.current.client !== connection || current.current.scope !== workspaceId) return;
      apply(request, receipt);
      if (receipt.state === 'pending')
        setIssue(
          request,
          typeof receipt.result?.error === 'string'
            ? receipt.result.error
            : 'Review this request again.',
        );
      return receipt;
    } catch {
      setIssue(request, 'The decision could not be confirmed. Check status before trying again.');
      await checkStatus(request, false);
    } finally {
      inflight.current = false;
      setBusy(undefined);
      setRevision((n) => n + 1);
    }
  }
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  return {
    requests: batch && batch.scope === scope ? batch.requests : [],
    faults: batch && batch.scope === scope ? batch.faults : [],
    loading: Boolean(client && batch?.scope !== scope && !loadError),
    loadError,
    busy,
    issueFor: (request: WorkspaceRequest) =>
      issues[key(request)] ??
      (batch && batch.scope === scope && batch.faults.some((fault) => fault.id === request.id)
        ? 'This request could not be confirmed. Check status before approving.'
        : undefined),
    reviewDraftFor: (request: WorkspaceRequest) =>
      reviewDrafts.current.get(key(request)) ?? {
        confirmation: '',
        expanded: false,
        acceptedDigest: null,
      },
    setReviewDraft: (request: WorkspaceRequest, value: RequestReviewDraft) => {
      reviewDrafts.current.set(key(request), value);
      redraw((n) => n + 1);
    },
    decide,
    checkStatus,
    refresh,
  };
}
