import { Button } from '../components/ui/button';
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  Search,
  Plus,
  X,
  MoreHorizontal,
  Settings2,
  Network,
  Eye,
  EyeOff,
  LogOut,
  Inbox,
  PanelsTopLeft,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import type { WorkCatalog } from '@hermes-client/protocol';
import { AgentAvatar } from '../AgentAvatar';
import { Menu } from '../ui/primitives';
import type { MenuItem } from '../ui/primitives';
import { IconButton } from '../components/ui/icon-button';
import { Badge } from '../components/ui/badge';
import { OrganizationRail, OrganizationDialog } from '../ui/OrganizationRail';
import { NavigationItem } from '../ui/NavigationItem';
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription } from '../components/ui/item';
import {
  placePebble,
  placementOf,
  sectionAccepts,
  sectionChoiceLabel,
  readRailDrag,
} from '../ui/organization';
import type { Organization, OrganizationEditor } from '../ui/organization';
import type { WorkspaceSnapshot as WorkspaceState, WorkspaceBot } from '@hermes-client/protocol';
import type { BotBridgeClient } from '@hermes-client/protocol';
import type { Activity } from '../avatar-lab/engine';
import type { Row } from '../conversation';
import { PersonalAvatar } from '../OwnerPhoto';
export type ChatBot = {
  profile: string;
  name: string;
  description: string;
  canonical: boolean;
  id?: string;
  preview?: string;
  hidden?: boolean;
};
export function PebbleAvatar({
  bot,
  workspace,
  client,
  state,
  large,
}: {
  bot: ChatBot;
  workspace?: WorkspaceState | undefined;
  client: BotBridgeClient;
  state?: Activity | undefined;
  large?: boolean | undefined;
}) {
  const identity = workspace?.bots.find((b) => b.profile === bot.profile);
  return identity ? (
    <AgentAvatar
      id={identity.id}
      profile={bot.profile}
      client={client}
      look={identity.appearance}
      orchestrator={workspace?.orchestrator === bot.profile}
      state={state ?? 'ready'}
      large={large ?? false}
      revision={workspace?.revision}
    />
  ) : (
    <span className="avatar">{bot.name.slice(0, 1)}</span>
  );
}
export function CrewAvatar({
  room,
  workspace,
  client,
}: {
  room: Row;
  workspace?: WorkspaceState | undefined;
  client: BotBridgeClient;
}) {
  const members = Array.isArray(room.members) ? room.members : [];
  const profiles = members
    .map((m) =>
      typeof m === 'string' ? m : String(m.profile ?? m.profile_name ?? m.member_id ?? ''),
    )
    .map((p) => (p === 'hermes' ? 'default' : p));
  return (
    <span className="crew-stack" aria-label={`${members.length} members`}>
      {profiles.slice(0, 3).map((profile, i) => {
        const b = workspace?.bots.find((b) => b.profile === profile);
        return (
          <span key={`${profile}-${i}`} style={{ left: `${i * 9}px`, top: `${(i % 2) * 12}px` }}>
            {b ? (
              <AgentAvatar
                id={b.id}
                look={b.appearance}
                client={client}
                profile={profile}
                revision={workspace?.revision}
              />
            ) : (
              <span className="crew-member-placeholder">{i + 1}</span>
            )}
          </span>
        );
      })}
      {!members.length && <span className="crew-member-placeholder">#</span>}
      {members.length > 3 && <small>+{members.length - 3}</small>}
    </span>
  );
}

export function Rail({
  bots,
  rooms,
  workspace,
  client,
  selected,
  states,
  online,
  pinOrder,
  onOpen,
  onRoom,
  onAdd,
  onEdit,
  pendingPins,
  onSettings,
  onOrgChart,
  onPin,
  onVisibility,
  onDelete,
  onOrder,
  onLogout,
  owner,
  onClose,
  organization,
  crewChats,
  onOrganization,
  onCrew,
  onSearch,
  area,
  onArea,
  catalog,
  selectedBoard,
  onBoard,
  onNewProject,
  onNewTask,
}: {
  bots: ChatBot[];
  rooms: Row[];
  workspace?: WorkspaceState | undefined;
  client: BotBridgeClient;
  selected?: string | undefined;
  states: Record<string, Activity>;
  online: boolean;
  pinOrder: string[];
  onOpen: (b: ChatBot) => void;
  onRoom: (r: Row) => void;
  onAdd: () => void;
  onEdit: (profile: string) => void;
  pendingPins: Record<string, boolean>;
  onSettings: () => void;
  onOrgChart: () => void;
  onPin: (b: WorkspaceBot, pinned: boolean) => void;
  onVisibility: (b: WorkspaceBot, hidden: boolean) => void;
  onDelete: (b: WorkspaceBot) => void;
  onOrder: (ids: string[]) => void;
  onLogout: () => void;
  owner: boolean;
  onClose?: (() => void) | undefined;
  organization: Organization;
  crewChats: Record<string, string>;
  onOrganization: Dispatch<SetStateAction<Organization>>;
  onCrew: (id: string) => void;
  onSearch: () => void;
  area: 'chat' | 'tasks';
  onArea: (area: 'chat' | 'tasks') => void;
  catalog: WorkCatalog | undefined;
  selectedBoard: string;
  onBoard: (board: string) => void;
  onNewProject: () => void;
  onNewTask: () => void;
}) {
  const [hidden, setHidden] = useState(false),
    [editor, setEditor] = useState<OrganizationEditor | null>(null);
  const reduced = useReducedMotion();
  const identity = (bot: ChatBot) => workspace?.bots.find((b) => b.profile === bot.profile);
  const pinned = (bot: ChatBot) => {
    const b = identity(bot);
    return !!b?.pinned || (!b?.pin_configured && workspace?.orchestrator === bot.profile);
  };
  const all =
    hidden && workspace
      ? [
          ...bots,
          ...workspace.bots.filter(
            (b) => b.managed && b.hidden && !bots.some((p) => p.profile === b.profile),
          ),
        ]
      : bots;
  const pins = all
    .filter((b) => !b.hidden && pinned(b))
    .sort((a, b) => {
      const ai = pinOrder.indexOf(identity(a)?.id ?? ''),
        bi = pinOrder.indexOf(identity(b)?.id ?? '');
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  const byId = (id: string) => all.find((b) => identity(b)?.id === id);
  const face = (id: string, large = false) => {
    const bot = byId(id);
    return bot ? (
      <PebbleAvatar
        bot={bot}
        workspace={workspace}
        client={client}
        state={states[bot.profile]}
        large={large}
      />
    ) : null;
  };
  const pinIds = pins.map((b) => identity(b)!.id);
  const controls = (bot: ChatBot) => {
    const b = identity(bot);
    if (!b) return null;
    const current = placementOf(organization, b.id);
    const items: MenuItem[] = [
      {
        label: pinned(bot) ? 'Unpin' : 'Pin',
        action: () => onPin(b, !pinned(bot)),
        disabled: !!pendingPins[b.id] || !online,
      },
      { label: 'Edit pebble', action: () => onEdit(b.profile) },
      {
        label: 'Move to section',
        action: () => {},
        items: organization.sections
          .filter((s) => sectionAccepts(s.id, 'pebble'))
          .map((s) => ({
            label: sectionChoiceLabel(s),
            checked: current?.kind === 'section' && current.id === s.id,
            action: () =>
              onOrganization((org) => placePebble(org, b.id, { kind: 'section', id: s.id })),
          })),
      },
      {
        label: 'Move to crew',
        action: () => {},
        items: organization.crews.map((c) => ({
          label: c.name,
          checked: current?.kind === 'crew' && current.id === c.id,
          action: () => onOrganization((org) => placePebble(org, b.id, { kind: 'crew', id: c.id })),
        })),
      },
      {
        label: bot.hidden ? 'Unhide' : 'Hide',
        action: () => onVisibility(b, !bot.hidden),
        disabled: !online,
      },
    ];
    if (b.profile !== 'default' && workspace?.orchestrator !== b.profile)
      items.push({ label: 'Delete…', action: () => onDelete(b), danger: true, disabled: !online });
    return (
      <Menu
        placement="row-actions"
        className="pc-overflow"
        label={`Actions for ${bot.name}`}
        items={items}
      >
        <MoreHorizontal />
      </Menu>
    );
  };
  return (
    <>
      <div className="pc-rail-header rail-toolbar">
        <span className="pc-wordmark">Pebble Crew</span>
        <IconButton label="Search Pebble Crew" icon={Search} onClick={onSearch} />
        <Menu
          label="New"
          placement="toolbar"
          disabled={!online}
          items={[
            { label: 'New pebble', action: onAdd },
            { label: 'New crew', action: () => setEditor({ kind: 'new-crew' }) },
            ...(client.supportsProjects
              ? [
                  { label: 'New project board', action: onNewProject, disabled: !catalog },
                  { label: 'New task', action: onNewTask, disabled: !catalog },
                ]
              : []),
            { label: 'New section', action: () => setEditor({ kind: 'new-section' }) },
          ]}
        >
          <Plus />
        </Menu>
        {onClose && (
          <IconButton
            className="pc-nav-close"
            label="Close navigation"
            icon={X}
            onClick={onClose}
          />
        )}
      </div>
      {client.supportsProjects && (
        <ToggleGroup
          type="single"
          className="pc-area-switch"
          aria-label="App area"
          value={area}
          onValueChange={(value) => {
            if (value === 'chat' || value === 'tasks') onArea(value);
          }}
        >
          <ToggleGroupItem value="chat">Chat</ToggleGroupItem>
          <ToggleGroupItem value="tasks">Tasks</ToggleGroupItem>
        </ToggleGroup>
      )}
      <div className="pc-rail-scroll rail-scroll">
        {area === 'tasks' ? (
          <nav aria-label="Project boards" className="grid content-start gap-1">
            {catalog?.boards.map((board) => (
              <NavigationItem
                key={board.slug}
                className="min-h-12 px-3"
                title={board.name}
                media={
                  board.slug === 'default' ? (
                    <Inbox className="size-4 text-muted-foreground" />
                  ) : (
                    <PanelsTopLeft className="size-4 text-muted-foreground" />
                  )
                }
                aria-current={board.slug === selectedBoard ? 'page' : undefined}
                onClick={() => onBoard(board.slug)}
                action={
                  board.count > 0 ? <span className="text-xs">{board.count}</span> : undefined
                }
              />
            ))}
          </nav>
        ) : (
          <LayoutGroup id="native-rail">
            <nav aria-label="Pebbles">
              {!!pins.length && (
                <div className="pc-pins pinned-pebbles">
                  {pins.map((b) => (
                    <motion.div
                      layout="position"
                      layoutId={`pebble-${identity(b)!.id}`}
                      draggable
                      onDragStartCapture={(event) => {
                        event.dataTransfer.setData(
                          'application/x-pebble-crew-rail',
                          JSON.stringify({ kind: 'pebble', id: identity(b)!.id }),
                        );
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes('application/x-pebble-crew-rail'))
                          event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const item = readRailDrag(
                          event.dataTransfer.getData('application/x-pebble-crew-rail'),
                          organization,
                          all.flatMap((bot) => identity(bot)?.id ?? []),
                        );
                        if (item?.kind !== 'pebble') return;
                        const bot = byId(item.id);
                        if (!bot) return;
                        if (!pinned(bot)) onPin(identity(bot)!, true);
                        const ids = pinIds.filter((id) => id !== item.id),
                          position = ids.indexOf(identity(b)!.id);
                        ids.splice(position < 0 ? ids.length : position, 0, item.id);
                        onOrder(ids);
                      }}
                      onKeyDown={(event) => {
                        if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                          event.preventDefault();
                          const ids = [...pinIds],
                            index = ids.indexOf(identity(b)!.id),
                            next = index + (event.key === 'ArrowUp' ? -1 : 1);
                          if (next >= 0 && next < ids.length) {
                            [ids[index], ids[next]] = [ids[next]!, ids[index]!];
                            onOrder(ids);
                          }
                        }
                      }}
                      transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className={`pc-pin pinned-tile ${selected === b.profile ? 'is-selected' : ''}`}
                      key={identity(b)?.id ?? b.profile}
                    >
                      <div className="pc-pin-actions">{controls(b)}</div>
                      <Button
                        variant="ghost"
                        className="pc-pin-open hover:bg-transparent dark:hover:bg-transparent"
                        aria-label={`${b.name} ${identity(b)?.role.title ?? ''} Bot Chat`}
                        aria-current={selected === b.profile ? 'page' : undefined}
                        aria-disabled={!online}
                        onClick={() => {
                          if (online) onOpen(b);
                        }}
                      >
                        {face(identity(b)!.id, true)}
                        <strong>{b.name}</strong>{' '}
                        {pendingPins[identity(b)?.id ?? ''] && (
                          <span className="pin-saving sr-only" role="status">
                            Saving pin…
                          </span>
                        )}
                        {identity(b)?.role.title && (
                          <Badge className="pc-pin-title" variant="secondary" aria-hidden="true">
                            {identity(b)?.role.title}
                          </Badge>
                        )}
                        {identity(b)?.unread && (
                          <span className="unread-dot" aria-label="Unread messages" />
                        )}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
              <OrganizationRail
                org={organization}
                onChange={onOrganization}
                pebbles={all
                  .filter((b) => !b.hidden)
                  .flatMap((b) => {
                    const row = identity(b);
                    return row
                      ? [
                          {
                            id: row.id,
                            name: b.name,
                            title: row.role.title,
                            preview:
                              b.preview || row.preview || row.role.description || '@' + row.handle,
                            pinned: pinned(b),
                          },
                        ]
                      : [];
                  })}
                activeId={
                  all.find((b) => b.profile === selected)?.id ??
                  Object.entries(crewChats).find(([, roomId]) => roomId === selected)?.[0] ??
                  selected ??
                  ''
                }
                face={face}
                onOpenPebble={(id) => {
                  const b = byId(id);
                  if (b && online) onOpen(b);
                }}
                onOpenCrew={onCrew}
                onEditPebble={(id) => {
                  const b = byId(id);
                  if (b) onEdit(b.profile);
                }}
                onEditOrganization={setEditor}
                onPin={(id) => {
                  const b = byId(id),
                    row = b && identity(b);
                  if (b && row) onPin(row, !pinned(b));
                }}
                actions={(id) => {
                  const b = byId(id);
                  return b ? controls(b) : null;
                }}
                openLabel={(pebble) => `${pebble.name} ${pebble.title} ${pebble.preview} Bot Chat`}
              />
              {hidden &&
                all
                  .filter((b) => b.hidden)
                  .map((b) => (
                    <div className="pc-row" key={b.id}>
                      <Item size="xs" className="min-h-16 flex-nowrap gap-2.5">
                        <ItemMedia className="group-has-data-[slot=item-description]/item:self-center group-has-data-[slot=item-description]/item:translate-y-0">
                          {face(b.id!)}
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{b.name}</ItemTitle>
                          {pendingPins[identity(b)?.id ?? ''] && (
                            <span className="pin-saving sr-only" role="status">
                              Saving pin…
                            </span>
                          )}
                          <ItemDescription>Hidden</ItemDescription>
                        </ItemContent>
                      </Item>
                      {controls(b)}
                    </div>
                  ))}
            </nav>
            <nav className="pc-list" aria-label="Group chats">
              {rooms.length > 0 && <h2>Group chats</h2>}
              {rooms
                .filter((r) => !Object.values(crewChats).includes(String(r.room_id)))
                .map((r) => (
                  <NavigationItem
                    className="pc-crew"
                    key={String(r.room_id)}
                    disabled={!online}
                    onClick={() => onRoom(r)}
                    media={<CrewAvatar room={r} workspace={workspace} client={client} />}
                    title={String(r.name ?? 'Crew')}
                    description={String(r.preview ?? 'Group conversation')}
                  />
                ))}
            </nav>
            {!all.length && (
              <div className="rail-empty">
                <p>No pebbles yet.</p>
                <Button variant="quiet" onClick={onAdd}>
                  Add existing agents
                </Button>
              </div>
            )}
          </LayoutGroup>
        )}
      </div>
      <footer className="pc-rail-footer">
        <Menu
          label="Your account"
          placement="account"
          items={[
            { label: 'Org chart', icon: Network, action: onOrgChart },
            { label: 'Settings', icon: Settings2, action: onSettings },
            {
              label: hidden ? 'Hide hidden pebbles' : 'Show hidden pebbles',
              icon: hidden ? Eye : EyeOff,
              action: () => setHidden(!hidden),
            },
            { label: owner ? 'Sign out' : 'Disconnect', icon: LogOut, action: onLogout },
          ]}
        >
          <PersonalAvatar />
        </Menu>
        <span className="connection-status" data-online={online}>
          <i aria-hidden="true" />
          {online ? 'Hermes connected' : 'Reconnecting…'}
        </span>
      </footer>
      <OrganizationDialog
        editor={editor}
        org={organization}
        onChange={onOrganization}
        onClose={() => setEditor(null)}
      />
    </>
  );
}
