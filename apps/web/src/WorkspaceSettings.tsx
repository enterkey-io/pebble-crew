import { usePageTitle } from './ui/page-title';
import { TabbedEditor } from './ui/EditorSurface';
import { useRef, useState } from 'react';
import type { SessionClient } from '@hermes-client/protocol';
import type { WorkspaceSnapshot as WorkspaceState, WorkspaceBot } from '@hermes-client/protocol';
import { OwnerAccount } from './OwnerAccount';
import { GeneralSettings } from './GeneralSettings';
import { DeviceSettings } from './DeviceSettings';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import { PebbleEditor } from './PebbleEditor';
import { PageHeader, Notice } from './ui/primitives';
export type SettingsTab = 'agents' | 'connections' | 'account' | 'general' | 'devices';
export function WorkspaceSettings({
  client,
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
  onProactive,
}: {
  onProactive?: (() => void) | undefined;
  initialAgentTab?: 'identity' | 'voice';
  callActive?: boolean;
  voiceRequest?: import('./voice/decode').VoiceSettingsRequest | undefined;
  onVoiceReady?: ((profile: string) => void) | undefined;
  onDirtyChange: (dirty: boolean) => void;
  closeOnSave?: boolean;
  onNavigate: (action: () => void) => void;
  owner?: boolean;
  initialTab?: SettingsTab;
  initialProfile?: string | undefined;
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
      : !owner && (initialTab === 'account' || initialTab === 'devices')
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
          devices: 'Devices',
        }[tab],
  );
  const [profile, setProfile] = useState(
    initialProfile ?? state.orchestrator ?? state.bots[0]?.profile ?? '',
  );
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
        ...(owner
          ? [
              { id: 'account', label: 'Account' },
              { id: 'devices', label: 'Devices' },
            ]
          : []),
        { id: 'connections', label: 'Connections' },
      ]}
      value={tab}
      onChange={(id) => {
        if (id === 'general' || id === 'account' || id === 'devices' || id === 'connections')
          onNavigate(() => setTab(id));
      }}
    >
      {tab === 'general' && <GeneralSettings onProactive={onProactive} />}
      {tab === 'account' && owner && <OwnerAccount />}
      {tab === 'devices' && owner && <DeviceSettings />}
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
