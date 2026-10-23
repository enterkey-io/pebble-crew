import { usePageTitle } from './ui/page-title';
import { TabbedEditor } from './ui/EditorSurface';
import { LoadingBar } from './components/ui/loading-bar';
import { Button } from './components/ui/button';
import { safeError } from '@hermes-client/core';
import { useEffect, useRef, useState } from 'react';
import type { ManagementRequests } from './chat/useManagementRequests';
import type { SessionClient, WorkspaceRequest } from '@hermes-client/protocol';
import { decodeWorkspaceSnapshot } from '@hermes-client/protocol';
import type { WorkspaceSnapshot as WorkspaceState, WorkspaceBot } from '@hermes-client/protocol';
import { OwnerAccount } from './OwnerAccount';
import { GeneralSettings } from './GeneralSettings';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import { RequestReview } from './chat/RequestReview';
import { PebbleEditor } from './PebbleEditor';
import { PageHeader, Notice } from './ui/primitives';
type Row = Record<string, unknown>;
export function WorkspaceSettings({
  client,
  management,
  state,
  onChange,
  onClose,
  owner = false,
  initialTab = 'general',
  initialProfile,
  onDirtyChange,
  closeOnSave = false,
  onNavigate,
  initialAgentTab,
  callActive = false,
  voiceRequest,
  onVoiceReady,
}: {
  initialAgentTab?: 'identity' | 'voice';
  callActive?: boolean;
  voiceRequest?: import('./voice/decode').VoiceSettingsRequest | undefined;
  onVoiceReady?: ((profile: string) => void) | undefined;
  onDirtyChange: (dirty: boolean) => void;
  closeOnSave?: boolean;
  onNavigate: (action: () => void) => void;
  owner?: boolean;
  initialTab?: 'agents' | 'requests' | 'connections' | 'account' | 'general';
  initialProfile?: string | undefined;
  management: ManagementRequests;
  client: SessionClient;
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
  usePageTitle(
    tab === 'agents'
      ? undefined
      : {
          general: 'General settings',
          account: 'Account settings',
          connections: 'Connections',
          requests: 'Requests',
        }[tab],
  );
  const [profile, setProfile] = useState(
    initialProfile ?? state.orchestrator ?? state.bots[0]?.profile ?? '',
  );
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const { requests, busy, issueFor, checkStatus, loading } = management;
  useEffect(() => {
    setError('');
    setNotice('');
  }, [tab, profile]);
  async function decide(
    r: WorkspaceRequest,
    approve: boolean,
    confirmation?: string,
    context?: import('@hermes-client/protocol').ManagementReview,
  ) {
    setError('');
    setNotice('');
    const result = await management.decide(r, approve, confirmation, context);
    if (!result) return;
    setNotice(
      result.state === 'completed'
        ? 'Change completed.'
        : result.state === 'denied'
          ? 'Request denied.'
          : '',
    );
    try {
      onChange(decodeWorkspaceSnapshot(await client.invoke('workspace.describe', {})));
    } catch {
      /* The saved decision remains authoritative while the roster recovers. */
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
        initialTab={initialAgentTab ?? 'identity'}
        callActive={callActive}
        voiceRequest={voiceRequest}
        onVoiceReady={onVoiceReady ? () => onVoiceReady(bot.profile) : undefined}
        key={bot.id}
        client={client}
        bot={bot}
        state={state}
        onChange={onChange}
        onClose={onClose}
        onDirtyChange={onDirtyChange}
        closeOnSave={closeOnSave}
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
    <TabbedEditor
      className="settings-panel entity-page"
      aria-label="Settings"
      header={<PageHeader title="Settings" onClose={() => onNavigate(onClose)} />}
      tabs={[
        { id: 'general', label: 'General' },
        ...(owner ? [{ id: 'account', label: 'Account' }] : []),
        { id: 'connections', label: 'Connections' },
        { id: 'requests', label: 'Requests' },
      ]}
      value={tab}
      onChange={(id) => onNavigate(() => setTab(id as typeof tab))}
    >
      {(error || management.loadError) && (
        <Notice error>
          {error || 'Requests could not be loaded.'}{' '}
          <Button variant="ghost" className="text-button" onClick={management.refresh}>
            Try again
          </Button>
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {!!management.faults.length && (
        <Notice>
          Some requests could not be read.{' '}
          <Button variant="quiet" onClick={management.refresh}>
            Try again
          </Button>
        </Notice>
      )}
      <LoadingBar active={loading} label="Loading Settings" />
      {tab === 'general' && <GeneralSettings />}
      {tab === 'account' && owner && <OwnerAccount />}
      {tab === 'requests' && !loading && (
        <>
          {!requests.length && !error && !management.loadError && !management.faults.length && (
            <div className="ui-empty">
              <h2>No requests</h2>
              <p>Changes proposed by your pebbles appear here.</p>
            </div>
          )}
          <div className="request-list">
            {requests.map((r) => (
              <RequestReview
                key={String(r.id)}
                client={client}
                draft={management.reviewDraftFor(r)}
                onDraft={(value) => management.setReviewDraft(r, value)}
                request={r}
                busy={busy === r.id}
                decisionIssue={issueFor(r)}
                onCheck={() => void checkStatus(r)}
                onDecision={(a, c, context) => void decide(r, a, c, context)}
                onInspect={() => {
                  void client
                    .invoke('requests.reconcile', { id: r.id })
                    .then((value) => setNotice(String((value as Row).message)))
                    .catch((e) => setError(safeError(e).message));
                }}
              />
            ))}
          </div>
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
    </TabbedEditor>
  );
}
