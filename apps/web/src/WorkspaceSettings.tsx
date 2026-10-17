import { LoadingBar } from './components/ui/loading-bar';
import { Button } from './components/ui/button';
import { safeError } from '@hermes-client/core';
import { useEffect, useRef, useState } from 'react';
import type { BotBridgeClient } from '@hermes-client/protocol';
import { decodeWorkspaceSnapshot } from '@hermes-client/protocol';
import type { WorkspaceSnapshot as WorkspaceState, WorkspaceBot } from '@hermes-client/protocol';
import { OwnerAccount } from './OwnerAccount';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import { RequestReview } from './chat/RequestReview';
import { PebbleEditor } from './PebbleEditor';
import { PageHeader, Notice, Tabs } from './ui/primitives';
type Row = Record<string, unknown>;
export function WorkspaceSettings({
  client,
  state,
  onChange,
  onClose,
  owner = false,
  initialTab = 'account',
  initialProfile,
  onDirtyChange,
  onNavigate,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onNavigate: (action: () => void) => void;
  owner?: boolean;
  initialTab?: 'agents' | 'requests' | 'connections' | 'account';
  initialProfile?: string | undefined;
  client: BotBridgeClient;
  state: WorkspaceState;
  onChange: (s: WorkspaceState) => void;
  onClose: () => void;
}) {
  const originalEditor = useRef<WorkspaceBot | undefined>(
    state.bots.find((b) => b.profile === initialProfile),
  );
  const [tab, setTab] = useState(
    initialTab === 'agents'
      ? 'agents'
      : !owner && initialTab === 'account'
        ? 'connections'
        : initialTab,
  );
  const [profile, setProfile] = useState(
    initialProfile ?? state.orchestrator ?? state.bots[0]?.profile ?? '',
  );
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<Row[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setError('');
    setNotice('');
    if (tab === 'requests') {
      setLoading(true);
      const load = async () => {
        try {
          const data = (await client.invoke('requests.list', {})) as { requests: Row[] };
          if (live) {
            setRequests(data.requests);
            setLoading(false);
          }
        } catch {
          if (live) {
            setError('Requests could not be loaded.');
            setLoading(false);
          }
        } finally {
          if (live) timer = setTimeout(() => void load(), 5000);
        }
      };
      void load();
    } else setLoading(false);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, tab, profile, refresh]);
  async function decide(r: Row, approve: boolean, confirmation?: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = (await client.invoke(approve ? 'requests.approve' : 'requests.deny', {
        id: r.id,
        fingerprint: r.fingerprint,
        ...(confirmation == null ? {} : { confirmation }),
      })) as Row;
      onChange(decodeWorkspaceSnapshot(await client.invoke('workspace.describe', {})));
      setNotice(
        result.state === 'completed'
          ? 'Change completed.'
          : result.state === 'denied'
            ? 'Request denied.'
            : `Request ${String(result.state)}. Review its outcome before retrying.`,
      );
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  if (tab === 'agents') {
    const current = state.bots.find((b) => b.profile === profile);
    const retired =
      !current || current.available === false || current.id !== originalEditor.current?.id;
    if (!retired) originalEditor.current = current;
    const bot = originalEditor.current;
    return bot ? (
      <PebbleEditor
        retired={retired}
        key={bot.id}
        client={client}
        bot={bot}
        state={state}
        onChange={onChange}
        onClose={onClose}
        onDirtyChange={onDirtyChange}
      />
    ) : (
      <section className="entity-page">
        <PageHeader title="Pebble unavailable" onClose={onClose} />
        <Notice>This pebble is no longer available.</Notice>
      </section>
    );
  }
  const connectionBots = state.bots.filter((b) => b.enrolled && b.available !== false);
  const connectionProfile = connectionBots.some((b) => b.profile === profile)
    ? profile
    : (connectionBots[0]?.profile ?? '');
  return (
    <section className="settings-panel entity-page" aria-label="Settings">
      <PageHeader title="Settings" onClose={() => onNavigate(onClose)} />
      <Tabs
        tabs={[
          ...(owner ? [{ id: 'account', label: 'Account' }] : []),
          { id: 'connections', label: 'Connections' },
          { id: 'requests', label: 'Requests' },
        ]}
        value={tab}
        onChange={(id) => onNavigate(() => setTab(id as typeof tab))}
      >
        {error && (
          <Notice error>
            {error}{' '}
            <Button
              variant="ghost"
              className="text-button"
              onClick={() => setRefresh((x) => x + 1)}
            >
              Try again
            </Button>
          </Notice>
        )}
        {notice && <Notice>{notice}</Notice>}
        <LoadingBar active={loading} label="Loading Settings" />
        {tab === 'account' && owner && <OwnerAccount />}
        {tab === 'requests' && !loading && (
          <>
            {!requests.length && !error && (
              <div className="ui-empty">
                <h2>No requests</h2>
                <p>Changes proposed by your pebbles appear here.</p>
              </div>
            )}
            {requests.map((r) => (
              <RequestReview
                key={String(r.id)}
                request={r}
                busy={busy}
                onDecision={(a, c) => void decide(r, a, c)}
                onInspect={() => {
                  void client
                    .invoke('requests.reconcile', { id: r.id })
                    .then((value) => setNotice(String((value as Row).message)))
                    .catch((e) => setError(safeError(e).message));
                }}
              />
            ))}
          </>
        )}
        {tab === 'connections' &&
          (connectionProfile ? (
            <ConnectionsPanel
              key={connectionProfile}
              client={client}
              bots={connectionBots}
              profile={connectionProfile}
              revision={state.revision}
              onProfile={setProfile}
              onNavigate={onNavigate}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            <p className="connections-empty">No pebbles available</p>
          ))}
      </Tabs>
    </section>
  );
}
