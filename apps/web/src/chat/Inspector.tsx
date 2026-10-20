import { Item, ItemContent, ItemTitle, ItemDescription } from '../components/ui/item';
import { useEffect, useState } from 'react';
import { Tabs } from '../ui/primitives';
import { Pencil, X } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';
import { LoadingBar } from '../components/ui/loading-bar';
import { Switch } from '../components/ui/switch';
import { FilesPanel } from './FilesPanel';
import { ComputerPanel } from './ComputerPanel';
import type { ReactNode } from 'react';
import type { ChatBot } from './Rail';
import { PebbleAvatar, CrewAvatar } from './Rail';
import type { WorkspaceSnapshot as WorkspaceState } from '@hermes-client/protocol';
import type { BotBridgeClient } from '@hermes-client/protocol';
import type { Row } from '../conversation';
export function Inspector({
  bot,
  room,
  workspace,
  client,
  routines,
  children,
  pending,
  onToggle,
  onEdit,
  onClose,
  sessionId,
  filesVersion,
  target,
}: {
  bot?: ChatBot | undefined;
  room?: Row | undefined;
  workspace?: WorkspaceState | undefined;
  client: BotBridgeClient;
  routines: Row[];
  children: ReactNode;
  pending: string;
  onToggle: (r: Row) => void;
  onEdit: () => void;
  onClose: () => void;
  sessionId?: string | undefined;
  filesVersion: number;
  target?: { tab: 'files' | 'routines'; id: string } | undefined;
}) {
  const [tab, setTab] = useState('routines'),
    [computer, setComputer] = useState(false);
  useEffect(() => {
    let live = true;
    setComputer(false);
    setTab((current) => (current === 'computer' ? 'routines' : current));
    if (client.supportsComputer && bot)
      void client
        .invoke('computer.status', { profile: bot.profile })
        .then((v) => {
          if (live) setComputer((v as { supported?: boolean }).supported === true);
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, bot?.profile]);
  useEffect(() => {
    if (target) setTab(target.tab);
  }, [target, bot?.profile]);
  useEffect(() => {
    if (target?.tab === 'routines' && tab === 'routines')
      document
        .querySelector<HTMLElement>(`[data-routine-id="${CSS.escape(target.id)}"]`)
        ?.scrollIntoView({
          block: 'center',
          behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
        });
  }, [target, tab, routines]);
  const identity = workspace?.bots.find((b) => b.profile === bot?.profile);
  return (
    <>
      <header>
        {identity && (
          <IconButton
            className="pc-details-edit"
            label={`Edit ${identity.name}`}
            icon={Pencil}
            onClick={onEdit}
          />
        )}
        <IconButton className="details-close" label="Close details" icon={X} onClick={onClose} />
      </header>
      <div className="pc-details-identity identity-summary">
        {bot ? (
          <PebbleAvatar bot={bot} workspace={workspace} client={client} large />
        ) : room ? (
          <CrewAvatar room={room} workspace={workspace} client={client} />
        ) : null}
        <h2>{bot?.name ?? String(room?.name ?? 'Details')}</h2>
        {identity?.role.title && <p>{identity.role.title}</p>}
        {identity && <span className="handle">@{identity.handle}</span>}
      </div>
      <div className="inspector-body">
        {children}
        {bot && (
          <>
            <Tabs
              tabs={[
                { id: 'routines', label: 'Routines' },
                { id: 'files', label: 'Files' },
                ...(computer ? [{ id: 'computer', label: 'Computer' }] : []),
              ]}
              value={tab}
              onChange={setTab}
            >
              {tab === 'computer' ? (
                <ComputerPanel client={client} profile={bot.profile} name={bot.name} />
              ) : tab === 'files' ? (
                client.supportsAttachments ? (
                  sessionId ? (
                    <FilesPanel
                      client={client}
                      sessionId={sessionId}
                      version={filesVersion}
                      focusId={target?.tab === 'files' ? target.id : undefined}
                    />
                  ) : (
                    <LoadingBar active label="Loading files" />
                  )
                ) : (
                  <p className="empty-note">Files aren’t available on this connection.</p>
                )
              ) : (
                <div className="routine-list">
                  {routines.map((r) => {
                    const id = String(r.id ?? r.job_id ?? '');
                    const enabled =
                      r.enabled !== false && r.paused !== true && r.state !== 'paused';
                    return (
                      <Item
                        className="pc-routine routine flex-nowrap px-0"
                        key={id}
                        data-routine-id={id}
                      >
                        <ItemContent>
                          <ItemTitle>{String(r.name ?? 'Routine')}</ItemTitle>
                          <ItemDescription className="text-xs">
                            {String(r.schedule_display ?? r.schedule ?? '')}
                          </ItemDescription>
                        </ItemContent>
                        <Switch
                          checked={enabled}
                          aria-label={`${enabled ? 'Pause' : 'Resume'} ${String(r.name ?? 'routine')}`}
                          disabled={!!pending}
                          onCheckedChange={() => onToggle(r)}
                        />
                      </Item>
                    );
                  })}
                  {!routines.length && <p className="empty-note">No routines yet.</p>}
                </div>
              )}
            </Tabs>
          </>
        )}
        {identity?.role.description && (
          <section className="role-description">
            <h3>About</h3>
            <p>{identity.role.description}</p>
          </section>
        )}
        {room && Array.isArray(room.members) && (
          <section className="role-description">
            <h3>Members</h3>
            {room.members.map((member, i) => {
              const m =
                typeof member === 'string'
                  ? member
                  : String(member.profile ?? member.profile_name ?? member.member_id ?? '');
              const b = workspace?.bots.find(
                (b) => b.profile === m || (m === 'hermes' && b.profile === 'default'),
              );
              return <p key={i}>{b?.name ?? m}</p>;
            })}
          </section>
        )}
      </div>
    </>
  );
}
