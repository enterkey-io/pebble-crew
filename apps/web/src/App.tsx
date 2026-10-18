import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { normalizeEndpoint, safeError } from '@hermes-client/core';
import { BotBridgeClient } from '@hermes-client/protocol';
import type { BridgeEvent } from '@hermes-client/protocol';
import { FirstRun } from './FirstRun';
import { lazy, Suspense } from 'react';
const NewPebble = lazy(() => import('./NewPebble').then((m) => ({ default: m.NewPebble })));
const WorkspaceSettings = lazy(() =>
  import('./WorkspaceSettings').then((m) => ({ default: m.WorkspaceSettings })),
);

import { useMedia, scrollToLatest } from './ui/motion';
import { nativeMessages as transcript, roomMessages, withSharedFiles } from './conversation';
import type { ChatMessage as Message } from './conversation';
import { RosterLoader } from './chat/roster';
import { useUploads } from './chat/uploads';
import type { SharedFile } from './chat/FilesPanel';
import { fileSize } from './chat/FilesPanel';
import { Rail, PebbleAvatar, CrewAvatar } from './chat/Rail';
import type { ChatBot as Bot } from './chat/Rail';
import { Transcript } from './chat/Transcript';
import { ComposerAction } from './chat/ComposerAction';
import { Inspector } from './chat/Inspector';
import { Icon } from './chat/Icon';
import { Drawer } from './chat/Drawer';
import { RequestReview } from './chat/RequestReview';
import { DetailsDock } from './ui/DetailsDock';
import { VoiceChat } from './voice/VoiceChat';
import type { VoiceChatHandle } from './voice/VoiceChat';
import { ChevronRight, File, Image, AudioLines } from 'lucide-react';
import { Menu } from './ui/primitives';
import { LoadingBar } from './components/ui/loading-bar';
import { organizationState } from './ui/organization';
import type { Organization, OrganizationState } from './ui/organization';
import type { SetStateAction } from 'react';
import { SearchOverlay } from './chat/SearchOverlay';
import { SendProjection } from './chat/send-projection';
import { TranscriptFollow } from './chat/viewport-motion';
import { toolActivity } from './chat/activity';
import { conversationLocation, rememberConversation } from './chat/conversation-location';
import { reactionReceipt } from './chat/reactions';
import { useOverlayHistory } from './ui/overlay-history';
import type { OwnerConnection } from './OwnerShell';
import { WorkspaceSetup } from './WorkspaceSetup';
import { StartupScreen } from './StartupScreen';

import { decodeWorkspaceSnapshot } from '@hermes-client/protocol';
import type { WorkspaceSnapshot as WorkspaceState, WorkspaceBot } from '@hermes-client/protocol';
import type { Activity } from './avatar-lab/engine';

type Row = Record<string, unknown>;
type Selection = { kind: 'bot'; bot: Bot; sessionId: string } | { kind: 'room'; room: Row };

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid data');
  return value as Row;
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid data');
  return value.map(object);
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function App({ owner }: { owner?: OwnerConnection }) {
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const voicePanel = useRef<VoiceChatHandle>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'agents' | 'requests' | 'account' | 'connections'>(
    'account',
  );
  const [agentStates, setAgentStates] = useState<Record<string, Activity>>({});
  const sessionProfiles = useRef(new Map<string, string>());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const renewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempt = useRef(0);
  const connectGeneration = useRef(0);
  const autoOpened = useRef(false);
  const restoreProfile = useRef('');
  const restoreRoom = useRef('');
  const welcomeProfile = useRef('');
  const disposed = useRef(false);
  const [client, setClient] = useState<BotBridgeClient>();
  const current = useRef<BotBridgeClient | undefined>(undefined);
  const selected = useRef<Selection | undefined>(undefined);
  const selectionConnection = useRef<BotBridgeClient | undefined>(undefined);
  const selectGeneration = useRef(0);
  const eventVersion = useRef(0);
  const historyGeneration = useRef(0);
  const [bots, setBots] = useState<Bot[]>([]);
  const [rooms, setRooms] = useState<Row[]>([]);
  const [crewChats, setCrewChats] = useState<Record<string, string>>({});
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const [selection, setSelection] = useState<Selection>();
  const [starting, setStarting] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const sendProjection = useRef(new SendProjection());
  const runEpoch = useRef(0);
  const [routines, setRoutines] = useState<Row[]>([]);
  const [approvals, setApprovals] = useState<Row[]>([]);
  const [draft, setDraft] = useState('');
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const [stream, setStream] = useState('');
  const [activity, setActivity] = useState('Ready');
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [streamState, setStreamState] = useState<'opening' | 'live' | 'lost'>('opening');
  const [error, setError] = useState('');
  const [nav, setNav] = useState(false);
  const phone = useMedia('(max-width: 767px)');
  const [details, setDetails] = useState(
    () => localStorage.getItem('pebblecrew.details') === 'open',
  );
  const [editProfile, setEditProfile] = useState<string>();
  const dirtyEditor = useRef(false),
    pendingNavigation = useRef<(() => void) | undefined>(undefined);
  const [confirmNavigation, setConfirmNavigation] = useState(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyEditor.current = dirty;
  }, []);
  function navigate(action: () => void) {
    rememberScroll();
    if (dirtyEditor.current) {
      pendingNavigation.current = action;
      setConfirmNavigation(true);
      return false;
    }
    action();
    return true;
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmCrew, setConfirmCrew] = useState<string>();
  const [organization, setOrganization] = useState<OrganizationState>({
    revision: 0,
    sections: [
      { id: 'pebbles', name: 'Pebbles', collapsed: false, items: [] },
      { id: 'crews', name: 'Crews', collapsed: false, items: [] },
    ],
    crews: [],
  });
  const organizationBase = useRef(organization);
  const organizationQueue = useRef<((current: Organization) => Organization)[]>([]);
  const organizationFlight = useRef<BotBridgeClient | undefined>(undefined);
  const organizationPending = useRef<Promise<boolean>>(Promise.resolve(true));
  async function pumpOrganization() {
    if (!current.current || organizationFlight.current === current.current) return false;
    const connection = current.current;
    organizationFlight.current = connection;
    try {
      while (organizationQueue.current.length && current.current === connection) {
        const change = organizationQueue.current[0]!,
          base = organizationBase.current;
        const next = change(base);
        const result = organizationState(
          await connection.invoke('organization.save', {
            organization: { sections: next.sections, crews: next.crews },
            expected_revision: base.revision,
          }),
        );
        if (current.current !== connection) return false;
        organizationQueue.current.shift();
        organizationBase.current = result;
        setOrganization({
          ...organizationQueue.current.reduce<Organization>((v, f) => f(v), result),
          revision: result.revision,
        });
      }
      return current.current === connection;
    } catch (error) {
      if (current.current === connection) {
        organizationQueue.current = [];
        try {
          const actual = organizationState(await connection.invoke('organization.get', {}));
          if (current.current === connection) {
            organizationBase.current = actual;
            setOrganization(actual);
          }
        } catch {
          setOrganization(organizationBase.current);
        }
        fail(error);
      }
      return false;
    } finally {
      if (organizationFlight.current === connection) organizationFlight.current = undefined;
    }
  }
  function changeOrganization(change: SetStateAction<Organization>) {
    if (!current.current || streamState !== 'live') return;
    organizationQueue.current.push(typeof change === 'function' ? change : () => change);
    setOrganization((v) => ({
      ...organizationQueue.current.reduce<Organization>(
        (value, f) => f(value),
        organizationBase.current,
      ),
      revision: v.revision,
    }));
    if (organizationFlight.current !== current.current)
      organizationPending.current = pumpOrganization();
  }
  async function openCrew(id: string, confirm = false) {
    const crew = organization.crews.find((c) => c.id === id);
    if (!crew || crew.members.length < 2 || crew.members.length > 6) {
      setError('A crew chat needs 2–6 pebbles. Move pebbles into the crew from their menus.');
      return;
    }
    const connection = current.current;
    if (!connection) return;
    try {
      if (!(await organizationPending.current) || current.current !== connection) return;
      const result = object(
        await connection.invoke('organization.chat', {
          id,
          expected_revision: organizationBase.current.revision,
          confirm_new: confirm,
        }),
      );
      if (current.current !== connection) return;
      if (result.state === 'new_chat_required') {
        setConfirmCrew(id);
        return;
      }
      if (result.state !== 'ready') throw new Error('Crew chat could not be confirmed');
      setConfirmCrew(undefined);
      setSettings(false);
      openRoom(object(result.room));
      void loadRoster(connection, true).catch(fail);
    } catch (e) {
      fail(e);
    }
  }
  const [pinIntents, setPinIntents] = useState<Record<string, boolean>>({});
  const pendingPinIds = useRef(new Set<string>());
  const mutationQueue = useRef(Promise.resolve());
  const scrollAnimation = useRef<(() => void) | undefined>(undefined);
  const scrollAnimating = useRef(false);
  const transcriptFollow = useRef<TranscriptFollow | undefined>(undefined);
  const transcriptContext = useRef('');
  const detailsAnchor = useRef<{ id: string; offset: number } | undefined>(undefined);

  const [routinePending, setRoutinePending] = useState('');
  const [detailsTarget, setDetailsTarget] = useState<{ tab: 'files' | 'routines'; id: string }>();
  const [stopping, setStopping] = useState(false);
  const [pinOrder, setPinOrder] = useState<string[]>([]);
  const preferencesRevision = useRef(0);
  const [review, setReview] = useState<Row>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [removedDraft, setRemovedDraft] = useState('');
  const rosterLoader = useRef(new RosterLoader());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const scrollPositions = useRef(new Map<string, { top: number; follow: boolean }>());
  const closeNav = useCallback(() => setNav(false), []);
  const closeReview = useCallback(() => setReview(undefined), []);
  const [pickingAgents, setPickingAgents] = useState(false);
  const transcriptPane = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const focusOnReady = useRef(false);
  const drafts = useRef(new Map<string, string>());
  const [showLatest, setShowLatest] = useState(false);
  const displayedRead = useRef<{ key: string; cursor: number } | undefined>(undefined);
  const acknowledgedRead = useRef(new Map<string, number>());
  function observedHistory(target: Selection, native: unknown) {
    if (target.kind !== 'bot' || !Array.isArray(native)) return;
    const bot = workspaceRef.current?.bots.find((b) => b.id === target.bot.id);
    // Only acknowledge a native roster cursor covered by the loaded history.
    // A later background snapshot cannot mark unseen messages as read.
    if (
      bot?.read_key &&
      typeof bot.cursor === 'number' &&
      (bot.cursor_type === 'row'
        ? Math.max(0, ...native.map((m) => Number(m?.row_id) || 0))
        : native.length) >= bot.cursor
    )
      displayedRead.current = { key: bot.read_key, cursor: bot.cursor };
  }
  function acknowledgeRead() {
    const seen = displayedRead.current;
    if (
      !seen ||
      !current.current ||
      document.visibilityState !== 'visible' ||
      !followLatest.current ||
      pickingAgents ||
      settings
    )
      return;
    if ((acknowledgedRead.current.get(seen.key) ?? -1) >= seen.cursor) return;
    const connection = current.current;
    acknowledgedRead.current.set(seen.key, seen.cursor);
    void connection
      .invoke('presentation.read', seen)
      .catch(() => acknowledgedRead.current.delete(seen.key));
  }
  useEffect(() => {
    acknowledgeRead();
  }, [messages, workspace, settings, pickingAgents]);
  const draftKey = (target: Selection) =>
    target.kind === 'bot'
      ? `bot:${target.bot.id ?? target.bot.profile}`
      : `room:${text(target.room.room_id)}`;

  const attachmentInput = useRef<HTMLInputElement>(null);
  const uploads = useUploads(
    client,
    selection ? draftKey(selection) : '',
    selection?.kind === 'bot' ? selection.sessionId : undefined,
  );
  const [attachmentUncertain, setAttachmentUncertain] = useState(false);
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]),
    [filesVersion, setFilesVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setSharedFiles([]);
    if (client?.supportsAttachments && selection?.kind === 'bot')
      void client
        .invoke('files.list', { session_id: selection.sessionId })
        .then((v) => {
          if (live && Array.isArray((v as { files: SharedFile[] }).files))
            setSharedFiles((v as { files: SharedFile[] }).files);
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, selection, filesVersion]);
  async function checkAttachmentSend(discard = false) {
    if (!client || selection?.kind !== 'bot') return;
    const target = selection,
      connection = client;
    try {
      const value = (await client.invoke(discard ? 'files.discard' : 'files.reconcile', {
        session_id: selection.sessionId,
      })) as { state: string; ids?: string[] };
      await refreshHistory(connection, target);
      if (current.current !== connection || selected.current !== target) return;
      if (value.state !== 'uncertain') {
        setBlocked(false);
        setAttachmentUncertain(false);
        setError('');
        if (value.state === 'accepted') {
          uploads.sent(draftKey(selection), value.ids ?? []);
          setDraft('');
          drafts.current.delete(draftKey(selection));
        }
      } else
        setError(
          'The send is still unconfirmed. Review the conversation before discarding pending files.',
        );
    } catch (e) {
      fail(e);
    }
  }
  function fail(error: unknown) {
    setError(safeError(error).message);
  }
  function disconnect() {
    connectGeneration.current++;
    clearTimeout(reconnectTimer.current);
    clearTimeout(renewTimer.current);
    organizationQueue.current = [];
    organizationPending.current = Promise.resolve(true);
    setWorkspace(undefined);
    setAgentStates({});
    sessionProfiles.current.clear();
    setSettings(false);
    selectGeneration.current++;
    current.current?.disconnect();
    current.current = undefined;
    selected.current = undefined;
    selectionConnection.current = undefined;
    setClient(undefined);
    setSelection(undefined);
    setBots([]);
    setRooms([]);
    sendProjection.current = new SendProjection();
    setMessages([]);
    setRoutines([]);
    setApprovals([]);
    setStream('');
    setDraft('');
    setRunning(false);
    setBusy(false);
    setBlocked(false);
    setStreamState('opening');
    setError('');
    displayedRead.current = undefined;
    acknowledgedRead.current.clear();
    scrollPositions.current.clear();
    setRemovedDraft('');
    setReview(undefined);
    setPickingAgents(false);
    drafts.current.clear();
    focusOnReady.current = false;
    followLatest.current = true;
    setShowLatest(false);
  }
  useEffect(() => {
    disposed.current = false;
    if (ownerRef.current) void connectOwner();
    const recover = () => {
      if (ownerRef.current) scheduleReconnect();
    };
    window.addEventListener('online', recover);
    window.addEventListener('offline', recover);
    return () => {
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', recover);
      disposed.current = true;
      connectGeneration.current++;
      clearTimeout(reconnectTimer.current);
      clearTimeout(renewTimer.current);
      current.current?.disconnect();
    };
  }, []);
  async function connectOwner() {
    const generation = ++connectGeneration.current;
    try {
      const credential = await ownerRef.current!.ticket();
      if (disposed.current || generation !== connectGeneration.current) return;
      await connect(credential.bridgeUrl, credential.ticket);
      if (disposed.current || generation !== connectGeneration.current) return;
      reconnectAttempt.current = 0;
      scheduleRenew();
    } catch {
      if (!disposed.current && generation === connectGeneration.current) scheduleReconnect();
    }
  }
  function scheduleRenew() {
    clearTimeout(renewTimer.current);
    renewTimer.current = setTimeout(async () => {
      const connection = current.current;
      if (!connection || !ownerRef.current || disposed.current) return;
      try {
        const next = await ownerRef.current.ticket();
        if (current.current !== connection) return;
        await connection.renew(next.ticket);
        scheduleRenew();
      } catch {
        if (current.current === connection) scheduleReconnect();
      }
    }, 240000);
  }
  function scheduleReconnect() {
    if (!ownerRef.current || disposed.current) return;
    connectGeneration.current++;
    clearTimeout(renewTimer.current);
    clearTimeout(reconnectTimer.current);
    setBlocked(true);
    setStreamState('lost');
    setActivity('Reconnecting to Hermes…');
    const target = selected.current;
    if (target) {
      restoreProfile.current = target.kind === 'bot' ? target.bot.profile : '';
      restoreRoom.current = target.kind === 'room' ? text(target.room.room_id) : '';
      drafts.current.set(draftKey(target), currentDraft.current);
    }
    const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt.current++, 5));
    reconnectTimer.current = setTimeout(() => {
      if (disposed.current) return;
      current.current?.disconnect();
      current.current = undefined;
      autoOpened.current = false;
      void connectOwner();
    }, delay);
  }
  useEffect(() => {
    if (!client || streamState !== 'live' || busy || autoOpened.current || !workspace?.initialized)
      return;
    const location = starting ? conversationLocation(workspace.id) : undefined;
    const roomId = restoreRoom.current || (location?.kind === 'room' ? location.id : '');
    if (roomId) {
      const room = rooms.find((r) => text(r.room_id) === roomId);
      restoreRoom.current = '';
      if (room) {
        autoOpened.current = true;
        openRoom(room, { restore: true });
        return;
      }
    }
    const savedBot =
      location?.kind === 'bot' ? workspace.bots.find((bot) => bot.id === location.id) : undefined;
    const savedProfile =
      savedBot && bots.some((bot) => bot.profile === savedBot.profile)
        ? savedBot.profile
        : undefined;
    const profile = restoreProfile.current || savedProfile || workspace.orchestrator;
    const bot = bots.find((b) => b.profile === profile);
    if (!bot?.canonical) {
      setStarting(false);
      return;
    }
    autoOpened.current = true;
    restoreProfile.current = '';
    void open(bot, { restore: true }).then(async (result) => {
      if (current.current !== client) return;
      if (result === 'opened' || result === 'unavailable') setStarting(false);
      if (result === 'opened' && welcomeProfile.current === bot.profile) {
        welcomeProfile.current = '';
        try {
          await client.invoke('workspace.welcome', { profile: bot.profile });
          await loadRoster(client);
        } catch {
          setError(
            'Your agent’s welcome could not be confirmed. Check the chat before asking again.',
          );
        }
      }
    });
  }, [client, streamState, busy, workspace, bots, rooms, starting]);
  useLayoutEffect(() => {
    const pane = transcriptPane.current;
    if (!pane || pickingAgents) return;
    if (transcriptFollow.current?.node !== pane) {
      transcriptFollow.current?.cancel();
      transcriptFollow.current = new TranscriptFollow(pane);
      transcriptContext.current = '';
    }
    const key = selection ? draftKey(selection) : '';
    const opening = key !== transcriptContext.current;
    transcriptContext.current = key;
    if (followLatest.current && !scrollAnimating.current) {
      if (opening) transcriptFollow.current.snap();
      else transcriptFollow.current.follow();
    }
  }, [messages, stream, pickingAgents, running, selection, settings, starting]);
  useLayoutEffect(() => {
    const pane = transcriptPane.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current && !pickingAgents && !scrollAnimating.current)
        transcriptFollow.current?.follow();
    });
    observer.observe(pane);
    const content = pane.querySelector('.pc-messages');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [client, selection, pickingAgents, settings, starting]);
  useLayoutEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 170)}px`;
  }, [draft, selection, pickingAgents, starting]);
  useLayoutEffect(() => {
    if (
      focusOnReady.current &&
      !busy &&
      !blocked &&
      !pickingAgents &&
      composer.current &&
      !composer.current.disabled
    ) {
      focusOnReady.current = false;
      composer.current.focus();
    }
  }, [busy, blocked, pickingAgents, selection, starting]);
  function toggleDetails(value: boolean) {
    detailsAnchor.current = undefined;
    const pane = transcriptPane.current;
    if (pane && !followLatest.current) {
      const top = pane.getBoundingClientRect().top;
      const message = [...pane.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        (n) => n.getBoundingClientRect().bottom > top,
      );
      if (message)
        detailsAnchor.current = {
          id: message.dataset.messageId!,
          offset: message.getBoundingClientRect().top - top,
        };
    }
    localStorage.setItem('pebblecrew.details', value ? 'open' : 'closed');
    setDetails(value);
    if (!value)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.chat-title')?.focus({ preventScroll: true }),
      );
  }
  useOverlayHistory(details && phone && !settings && !pickingAgents && !searchOpen, () => {
    toggleDetails(false);
    return true;
  });
  useEffect(() => {
    if (!details) return;
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !document.querySelector('[role="dialog"][data-state="open"]')
      ) {
        e.preventDefault();
        toggleDetails(false);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [details, phone]);
  const restoreDetailsAnchor = useCallback(() => {
    const pane = transcriptPane.current,
      anchor = detailsAnchor.current;
    if (pane && followLatest.current) {
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    if (pane && anchor) {
      const node = pane.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`);
      if (node)
        pane.scrollTop +=
          node.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset;
    }
  }, []);
  useLayoutEffect(() => {
    const pane = transcriptPane.current,
      target = selected.current;
    if (settings || !pane || !target) return;
    const saved = scrollPositions.current.get(draftKey(target));
    if (saved) {
      followLatest.current = saved.follow;
      pane.scrollTop = saved.follow ? pane.scrollHeight : saved.top;
      document.querySelector<HTMLElement>('.chat-title')?.focus({ preventScroll: true });
    }
  }, [settings]);
  useEffect(
    () => () => {
      scrollAnimation.current?.();
      transcriptFollow.current?.cancel();
    },
    [],
  );
  function jumpToLatest() {
    const pane = transcriptPane.current;
    if (!pane) return;
    scrollAnimation.current?.();
    transcriptFollow.current?.cancel();
    scrollAnimating.current = true;
    scrollAnimation.current = scrollToLatest(
      pane,
      () => {
        scrollAnimating.current = false;
        followLatest.current = true;
        setShowLatest(false);
        acknowledgeRead();
        composer.current?.focus({ preventScroll: true });
      },
      () => {
        scrollAnimating.current = false;
      },
    );
  }

  async function refreshHistory(connection: BotBridgeClient, target: Selection, complete = false) {
    if (target.kind !== 'bot' || selectionConnection.current !== connection) return;
    // Native history can already contain a partial turn. Keep it out of the
    // committed transcript while its streamed presentation is still visible.
    if (sendProjection.current.replying && !complete) return;
    const terminalEpoch = runEpoch.current;
    const generation = ++historyGeneration.current;
    const data = object(await connection.invoke('chat.history', { session_id: target.sessionId }));
    if (current.current === connection && selected.current === target) {
      if (
        generation === historyGeneration.current &&
        terminalEpoch === runEpoch.current &&
        (!sendProjection.current.replying || complete)
      ) {
        observedHistory(target, data.messages);
        setMessages(sendProjection.current.project(transcript(data.messages), complete));
        if (complete) {
          setStream('');
          setRunning(false);
          setStopping(false);
        }
      }
    }
    const saved = scrollPositions.current.get(draftKey(target));
    if (saved && !saved.follow) {
      followLatest.current = false;
      setShowLatest(true);
      requestAnimationFrame(() => {
        if (transcriptPane.current) transcriptPane.current.scrollTop = saved.top;
      });
    }
  }

  async function reactToMessage(id: string, emoji: string | null) {
    const connection = current.current,
      target = selected.current;
    if (!connection?.supportsReactions || target?.kind !== 'bot' || streamState !== 'live') return;
    try {
      const result = reactionReceipt(
        await connection.invoke('chat.react', {
          session_id: target.sessionId,
          row_id: Number(id),
          emoji,
        }),
      );
      if (current.current !== connection || selected.current !== target) return;
      setMessages((old) =>
        old.map((m) => (m.id === result.id ? { ...m, reactions: result.reactions } : m)),
      );
    } catch (error) {
      fail(error);
    }
  }

  async function receive(connection: BotBridgeClient, event: BridgeEvent) {
    if (current.current !== connection) return;
    voicePanel.current?.event(event);
    if (event.type === 'workspace.changed') {
      await loadRoster(connection, true);
      return;
    }
    if (event.type === 'tool.complete' || event.type === 'message.complete')
      void loadRoster(connection).catch((error) => {
        if (current.current === connection) fail(error);
      });
    if (event.type === 'bridge.ready') {
      setStreamState('live');
      setBlocked(selected.current?.kind === 'bot' && selectionConnection.current !== connection);
      setActivity('Ready');
      return;
    }
    const profile = sessionProfiles.current.get(event.session_id ?? '');
    if (profile) {
      const state: Activity | undefined =
        event.type === 'approval.request'
          ? 'attention'
          : event.type === 'message.start' || event.type === 'tool.complete'
            ? 'thinking'
            : event.type === 'tool.start'
              ? 'working'
              : event.type === 'message.complete'
                ? event.payload?.status === 'error'
                  ? 'attention'
                  : 'done'
                : undefined;
      if (state) setAgentStates((old) => ({ ...old, [profile]: state }));
    }
    const target = selected.current;
    if (event.type === 'bridge.resync') {
      setBlocked(true);
      setStreamState('lost');
      setActivity('Live updates disconnected');
      if (ownerRef.current) scheduleReconnect();
      else setError('Live updates were interrupted. Reopen the connection.');
      return;
    }
    if (!target || target.kind !== 'bot' || event.session_id !== target.sessionId) return;
    eventVersion.current++;
    const payload = event.payload ?? {};
    if (event.type === 'message.reaction') {
      const result = reactionReceipt(payload);
      setMessages((old) =>
        old.map((m) => (m.id === result.id ? { ...m, reactions: result.reactions } : m)),
      );
    }
    if (event.type === 'message.start') {
      runEpoch.current++;
      sendProjection.current.beginReply();
      setRunning(true);
      setStream('');
      setActivity('Thinking');
    }
    if (event.type === 'message.delta') {
      setStream((old) => old + text(payload.text));
      setActivity('Writing');
    }
    if (event.type === 'message.complete') {
      const persisted = payload.persisted_turn;
      if (persisted && typeof persisted === 'object' && 'final_assistant_row_id' in persisted)
        sendProjection.current.completeReply(persisted.final_assistant_row_id);
      setActivity(payload.status === 'error' ? 'Turn failed' : 'Finishing');
      if (payload.status === 'error')
        setError('Hermes reported a failed turn. Refresh to inspect its history.');
      await refreshHistory(connection, target, true);
    }
    if (event.type === 'tool.start') setActivity(toolActivity(text(payload.name)));
    if (event.type === 'tool.complete') setActivity('Thinking');
    if (event.type === 'status.update')
      setActivity(text(payload.text).trim().slice(0, 140) || 'Working');
    if (event.type === 'approval.request') {
      const data = object(
        await connection.invoke('chat.approvals', { session_id: target.sessionId }),
      );
      if (selected.current === target) setApprovals(rows(data.approvals));
    }
    if (event.type === 'error') setError('Hermes reported an error. Refresh before retrying.');
  }

  async function loadRoster(connection: BotBridgeClient, invalidate = false) {
    return rosterLoader.current.load(
      connection,
      async () => {
        if (connection.supportsWorkspace) {
          const data = object(await connection.invoke('workspace.snapshot', {}));
          if (current.current !== connection) return;
          const state = decodeWorkspaceSnapshot(data.workspace);
          if (
            workspaceRef.current?.id === state.id &&
            state.revision < workspaceRef.current.revision
          )
            return;
          const org = organizationState(data.organization);
          if (
            organizationFlight.current !== connection &&
            (workspaceRef.current?.id !== state.id ||
              org.revision >= organizationBase.current.revision)
          ) {
            organizationBase.current = org;
            setOrganization({
              ...organizationQueue.current.reduce<Organization>((v, f) => f(v), org),
              revision: org.revision,
            });
          }
          setWorkspace(state);
          workspaceRef.current = state;
          setBots(state.bots.filter((b) => b.managed && !b.hidden));
          setCrewChats(
            Object.fromEntries(
              Object.entries(object(data.crew_chats)).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ),
          );
          const loadedRooms = rows(data.rooms);
          setRooms(loadedRooms);
          const prefs = object(data.preferences);
          setPinOrder(Array.isArray(prefs.pin_order) ? prefs.pin_order.map(String) : []);
          preferencesRevision.current = Number(prefs.revision) || 0;
          const target = selected.current;
          const surviving =
            target?.kind === 'bot'
              ? state.bots.find((b) => b.id === target.bot.id && b.managed && !b.hidden)
              : undefined;
          const roomSurviving =
            target?.kind === 'room'
              ? loadedRooms.some((r) => r.room_id === target.room.room_id)
              : true;
          if (
            target &&
            ((target.kind === 'bot' && !surviving) || (target.kind === 'room' && !roomSurviving))
          ) {
            selectGeneration.current++;
            selected.current = undefined;
            setSelection(undefined);
            setRemovedDraft(currentDraft.current);
            setDraft('');
            sendProjection.current = new SendProjection();
            setMessages([]);
            setStream('');
            setRunning(false);
            setStopping(false);
            setApprovals([]);
            setRoutines([]);
            setError('This conversation is no longer in your sidebar.');
            autoOpened.current = true;
            restoreProfile.current = '';
            restoreRoom.current = '';
          }
          if (surviving && target?.kind === 'bot' && target.bot.profile !== surviving.profile) {
            // Reopen a proven native rename, retaining this incarnation's draft.
            restoreProfile.current = surviving.profile;
            autoOpened.current = false;
          }
          if (
            surviving &&
            target?.kind === 'bot' &&
            surviving.read_key &&
            displayedRead.current?.key === surviving.read_key &&
            typeof surviving.cursor === 'number' &&
            surviving.cursor > displayedRead.current.cursor
          ) {
            await refreshHistory(connection, target);
          }
          const req = object(await connection.invoke('requests.list', {}));
          if (current.current === connection)
            setRequestCount(rows(req.requests).filter((r) => r.state === 'pending').length);
        } else {
          const roster = object(await connection.invoke('bots.list', {}));
          const nativeRooms = object(await connection.invoke('rooms.list', {}));
          if (current.current !== connection) return;
          setBots(
            rows(roster.bots).map((b) => ({
              profile: text(b.profile),
              name: text(b.name),
              description: text(b.description),
              canonical: b.canonical === true,
            })),
          );
          setRooms(rows(nativeRooms.rooms));
        }
      },
      invalidate,
    );
  }
  useEffect(() => {
    if (!client || streamState !== 'live') return;
    let gone = false,
      timer: ReturnType<typeof setTimeout>,
      failures = 0;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          await loadRoster(client);
          failures = 0;
        } catch {
          failures = Math.min(failures + 1, 3);
        }
      }
      if (!gone) timer = setTimeout(() => void tick(), 5000 * 2 ** failures);
    };
    const focus = () => {
      if (document.visibilityState === 'visible') void loadRoster(client).catch(() => undefined);
    };
    timer = setTimeout(() => void tick(), 5000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      gone = true;
      clearTimeout(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [client, streamState]);
  function rememberScroll() {
    const target = selected.current,
      pane = transcriptPane.current;
    if (target && pane)
      scrollPositions.current.set(draftKey(target), {
        top: pane.scrollTop,
        follow: followLatest.current,
      });
  }

  async function connect(endpoint: string, token: string) {
    setBusy(true);
    setError('');
    setStreamState('opening');
    setActivity('Connecting live updates…');
    setBlocked(true);
    let connection: BotBridgeClient | undefined;
    try {
      connection = new BotBridgeClient(normalizeEndpoint(endpoint, import.meta.env.DEV), token);
      organizationQueue.current = [];
      organizationPending.current = Promise.resolve(true);
      current.current = connection;
      autoOpened.current = false;
      await connection.connect();
      await loadRoster(connection);
      if (current.current !== connection) return;
      setClient(connection);
      const established = connection;
      void connection
        .events((event) => {
          void receive(established, event).catch((error) => {
            if (current.current === established) fail(error);
          });
        })
        .catch(() => {
          if (current.current === established) {
            setBlocked(true);
            setStreamState('lost');
            setActivity('Live updates disconnected');
            if (ownerRef.current) {
              scheduleReconnect();
              return;
            }
            setError(
              'Live updates were interrupted. This older preview connection needs to be reopened. The owner-login update adds automatic recovery.',
            );
          }
        });
    } catch (error) {
      connection?.disconnect();
      if (current.current === connection) current.current = undefined;
      if (!ownerRef.current) fail(error);
      throw safeError(error);
    } finally {
      setBusy(false);
    }
  }

  async function open(
    bot: Bot,
    { restore = false }: { restore?: boolean } = {},
  ): Promise<'opened' | 'unavailable' | 'recovering' | 'superseded'> {
    if (!client || streamState !== 'live' || !bot.canonical) return 'unavailable';
    rememberScroll();
    const generation = ++selectGeneration.current;
    if (!restore) {
      selected.current = undefined;
      setSelection(undefined);
      displayedRead.current = undefined;
      sendProjection.current = new SendProjection();
      setMessages([]);
      setStream('');
      setRunning(false);
      setActivity('Ready');
      setApprovals([]);
      setRoutines([]);
    }
    setError('');
    setAttachmentUncertain(false);
    if (!restore) setBlocked(false);
    setBusy(true);
    if (!restore) {
      setNav(false);
      setPickingAgents(false);
    }
    if (!restore) {
      followLatest.current = true;
      setShowLatest(false);
      setDraft(drafts.current.get(`bot:${bot.id ?? bot.profile}`) ?? '');
    }
    setRemovedDraft('');
    setStopping(false);
    try {
      const data = object(await client.invoke('bot.open', { profile: bot.profile }));
      if (generation !== selectGeneration.current || current.current !== client)
        return 'superseded';
      const target: Selection = { kind: 'bot', bot, sessionId: text(data.session_id) };
      sessionProfiles.current.set(target.sessionId, bot.profile);
      setAgentStates((old) => ({
        ...old,
        [bot.profile]: data.running === true ? 'working' : 'ready',
      }));
      selected.current = target;
      selectionConnection.current = client;
      setSelection(target);
      const id = workspace?.bots.find((entry) => entry.profile === bot.profile)?.id;
      if (workspace && id) rememberConversation(workspace.id, { kind: 'bot', id });
      setBlocked(false);
      observedHistory(target, data.messages);
      setMessages(sendProjection.current.project(transcript(data.messages)));
      const saved = scrollPositions.current.get(draftKey(target));
      if (saved && !saved.follow) {
        followLatest.current = false;
        setShowLatest(true);
        requestAnimationFrame(() => {
          if (transcriptPane.current) transcriptPane.current.scrollTop = saved.top;
        });
      }
      setAttachmentUncertain(false);
      if (client.supportsAttachments) {
        const receipt = (await client.invoke('files.reconcile', {
          session_id: target.sessionId,
        })) as { state: string };
        if (current.current !== client || selected.current !== target) return 'superseded';
        if (receipt.state === 'uncertain') {
          setAttachmentUncertain(true);
          setBlocked(true);
          setError(
            'An earlier file send has not been confirmed. Check its outcome before sending again.',
          );
        }
      }
      const inflight = data.inflight ? object(data.inflight) : {};
      setRunning(data.running === true);
      setStream(text(inflight.assistant));
      setActivity(data.running === true ? 'Working' : 'Ready');
      const ownedRoutines = object(await client.invoke('routines.list', { profile: bot.profile }));
      if (current.current !== client || selected.current !== target) return 'superseded';
      setRoutines(rows(ownedRoutines.jobs ?? []));
      const pending = object(
        await client.invoke('chat.approvals', { session_id: target.sessionId }),
      );
      if (selected.current === target) setApprovals(rows(pending.approvals));
      // Reconcile the open/routine-fetch interval against a fresh native snapshot.
      const version = eventVersion.current;
      const snapshot = object(await client.invoke('bot.open', { profile: bot.profile }));
      if (
        current.current === client &&
        selected.current === target &&
        version === eventVersion.current
      ) {
        observedHistory(target, snapshot.messages);
        setMessages(sendProjection.current.project(transcript(snapshot.messages)));
        setRunning(snapshot.running === true);
        setStream(snapshot.inflight ? text(object(snapshot.inflight).assistant) : '');
      }
      return current.current === client && selected.current === target ? 'opened' : 'superseded';
    } catch (error) {
      if (generation === selectGeneration.current && current.current === client) {
        if (
          restore &&
          ownerRef.current &&
          ['DISCONNECTED', 'REQUEST_FAILED', 'REQUEST_TIMEOUT', 'UNAUTHORIZED'].includes(
            safeError(error).code,
          )
        ) {
          scheduleReconnect();
          return 'recovering';
        }
        fail(error);
        return 'unavailable';
      }
      return 'superseded';
    } finally {
      if (generation === selectGeneration.current) {
        focusOnReady.current = matchMedia('(pointer: fine)').matches;
        setBusy(false);
      }
    }
  }

  function openRoom(room: Row, { restore = false }: { restore?: boolean } = {}) {
    rememberScroll();
    if (!restore) setPickingAgents(false);
    selectGeneration.current++;
    const target: Selection = { kind: 'room', room };
    selected.current = target;
    selectionConnection.current = client;
    setSelection(target);
    if (workspace) rememberConversation(workspace.id, { kind: 'room', id: text(room.room_id) });
    if (restore) setBlocked(false);
    if (!restore) {
      setDraft(drafts.current.get(draftKey(target)) ?? '');
      followLatest.current = true;
      setShowLatest(false);
      displayedRead.current = undefined;
      sendProjection.current = new SendProjection();
      setMessages([]);
      setStream('');
      setApprovals([]);
      setRoutines([]);
    }
    setRunning(false);
    setBusy(false);
    setActivity('Native room driver');
    setAttachmentUncertain(false);
    setError('');
    if (!restore) setNav(false);
  }
  useEffect(() => {
    if (!client || selection?.kind !== 'room') return;
    let disposed = false;
    let cursor = 0;
    const events = new Map<number, Row>();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        let more = true;
        let pages = 0;
        while (more && pages++ < 100 && !disposed) {
          const data = object(
            await client!.invoke('room.log', {
              room_id: text(selection!.kind === 'room' ? selection!.room.room_id : ''),
              since_seq: cursor,
            }),
          );
          if (disposed) return;
          for (const row of rows(data.events ?? [])) {
            if (typeof row.seq !== 'number') throw new Error('Invalid room sequence');
            events.set(row.seq, row);
          }
          if (typeof data.cursor !== 'number' || data.cursor < cursor)
            throw new Error('Invalid cursor');
          if (data.has_more === true && data.cursor === cursor) throw new Error('Room log stalled');
          cursor = data.cursor;
          more = data.has_more === true;
        }
        // Bound browser memory while continuing from the native monotonic cursor.
        while (events.size > 1000) events.delete(events.keys().next().value!);
        const state = object(
          await client!.invoke('room.state', {
            room_id: text(selection!.kind === 'room' ? selection!.room.room_id : ''),
          }),
        );
        if (disposed) return;
        const driver = object(state.driver_status ?? {});
        const actions = rows(driver.pending_actions ?? []);
        setApprovals(actions.filter((action) => action.kind === 'approval'));
        setActivity(
          driver.blocked === true
            ? 'Room recovery needed · Inspect in Hermes'
            : driver.working === true
              ? 'Room members are working'
              : 'Native room driver ready',
        );
        setMessages(sendProjection.current.project(roomMessages([...events.values()])));
        setStarting(false);
        const room = roomsRef.current.find(
          (r) => r.room_id === (selection?.kind === 'room' ? selection.room.room_id : ''),
        );
        if (
          room &&
          typeof room.read_key === 'string' &&
          typeof room.cursor === 'number' &&
          cursor >= room.cursor
        )
          displayedRead.current = { key: room.read_key, cursor: room.cursor };
        setRunning(driver.working === true);
        if (driver.working !== true) setStopping(false);
      } catch (error) {
        if (!disposed) {
          fail(error);
          if (
            !['DISCONNECTED', 'REQUEST_FAILED', 'REQUEST_TIMEOUT', 'UNAUTHORIZED'].includes(
              safeError(error).code,
            )
          )
            setStarting(false);
        }
      }
      if (!disposed)
        timer = setTimeout(() => {
          void poll();
        }, 2000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [client, selection]);

  async function send() {
    if (
      !client ||
      !selection ||
      (!draft.trim() && !uploads.files.length) ||
      !uploads.ready ||
      busy ||
      running ||
      blocked
    )
      return;
    const connection = client;
    const target = selection;
    const generation = selectGeneration.current;
    const owns = () =>
      current.current === connection &&
      selected.current === target &&
      generation === selectGeneration.current;
    setBusy(true);
    setError('');
    const message = draft;
    const fileIds = uploads.files.flatMap((f) => (f.id ? [f.id] : []));
    followLatest.current = true;
    setShowLatest(false);
    const pendingId = `pending-${crypto.randomUUID()}`;
    const roomEventId = crypto.randomUUID();
    const pendingMessage = {
      id: pendingId,
      renderKey: pendingId,
      timestamp: new Date().toISOString(),
      role: 'user',
      text: message,
      ...(fileIds.length
        ? {
            files: uploads.files
              .filter((f) => f.id)
              .map((f) => ({ id: f.id!, name: f.name, size: f.size })),
          }
        : {}),
    };
    setMessages(sendProjection.current.begin(pendingMessage, messages));
    setDraft('');
    if (target.kind === 'bot') {
      setRunning(true);
      setActivity('Working');
    }
    try {
      if (selection.kind === 'bot') {
        const result = (await client.invoke('chat.send', {
          session_id: selection.sessionId,
          text: message,
          ...(fileIds.length ? { attachments: fileIds, request_id: crypto.randomUUID() } : {}),
        })) as Row;
        if (owns()) setMessages(sendProjection.current.acknowledge(result.user_row_id));
        if (fileIds.length && result.state !== 'accepted')
          throw new Error('Attachment outcome uncertain');
      } else {
        await client.invoke('room.send', {
          room_id: text(selection.room.room_id),
          event_id: roomEventId,
          text: message,
        });
        if (owns()) setMessages(sendProjection.current.acknowledge(roomEventId));
      }
      if (owns()) {
        drafts.current.delete(draftKey(target));
        uploads.sent(draftKey(target), fileIds);
        if (fileIds.length) setFilesVersion((v) => v + 1);
        setDraft('');
      }
    } catch {
      if (owns()) {
        setBlocked(true);
        setDraft(message);
      }
      if (owns() && fileIds.length) setAttachmentUncertain(true);
      if (owns()) setError('Your message may not have been sent. Reopen this chat to check.');
    } finally {
      if (generation === selectGeneration.current && current.current === connection) {
        focusOnReady.current = true;
        setBusy(false);
      }
    }
  }
  async function stop() {
    if (!client || !selection) return;
    const connection = client,
      target = selection;
    if (stopping) return;
    setStopping(true);
    try {
      await client.invoke(
        selection.kind === 'bot' ? 'chat.stop' : 'room.stop',
        selection.kind === 'bot'
          ? { session_id: selection.sessionId }
          : { room_id: text(selection.room.room_id) },
      );
      if (current.current === connection && selected.current === target)
        setActivity('Stop requested');
    } catch (error) {
      if (current.current === connection && selected.current === target) {
        setStopping(false);
        fail(error);
      }
    }
  }
  async function approve(approval: Row, choice: string) {
    if (!client || !selection || blocked) return;
    const requestId = text(approval.request_id);
    const connection = client,
      target = selection;
    try {
      if (target.kind === 'bot') {
        await client.invoke('chat.approve', {
          session_id: target.sessionId,
          request_id: requestId,
          choice,
        });
      } else
        await client.invoke('room.approve', {
          room_id: text(target.room.room_id),
          member_id: text(approval.member_id),
          task_id: text(approval.task_id),
          execution_generation: approval.execution_generation,
          request_id: requestId,
          choice,
        });
      if (current.current === connection && selected.current === target)
        setApprovals((old) => old.filter((a) => a.request_id !== requestId));
    } catch (error) {
      if (current.current === connection && selected.current === target) fail(error);
    }
  }

  async function pinPebble(bot: WorkspaceBot, pinned: boolean) {
    if (!client || pendingPinIds.current.has(bot.id)) return;
    pendingPinIds.current.add(bot.id);
    setPinIntents((old) => ({ ...old, [bot.id]: pinned }));
    const connection = client;
    const task = mutationQueue.current.then(async () => {
      try {
        await connection.invoke('agent.pin', {
          profile: bot.profile,
          id: bot.id,
          pinned,
          expected_revision: workspaceRef.current!.revision,
        });
        await loadRoster(connection, true);
      } catch (e) {
        if (current.current === connection) {
          fail(e);
          await loadRoster(connection, true).catch(() => undefined);
        }
      } finally {
        pendingPinIds.current.delete(bot.id);
        setPinIntents((old) => {
          const next = { ...old };
          delete next[bot.id];
          return next;
        });
      }
    });
    mutationQueue.current = task.catch(() => undefined);
    await task;
  }
  async function presentationAction(operation: string, params: Row) {
    if (!client) return;
    try {
      await client.invoke(operation, params);
      await loadRoster(client, true);
    } catch (e) {
      fail(e);
    }
  }
  async function visibility(bot: WorkspaceBot, hidden: boolean) {
    await presentationAction('agent.hide', {
      profile: bot.profile,
      id: bot.id,
      expected_revision: workspace!.revision,
      hidden,
    });
  }
  async function proposeDelete(bot: WorkspaceBot) {
    if (!client || !workspace) return;
    try {
      const result = object(
        await client.invoke('agent.propose', {
          action: 'agent.delete',
          spec: { profile: bot.profile, id: bot.id, expected_revision: workspace.revision },
        }),
      );
      const list = object(await client.invoke('requests.list', {}));
      setReview(rows(list.requests).find((r) => r.id === result.request_id));
    } catch (e) {
      fail(e);
    }
  }
  async function decideReview(approve: boolean, confirmation?: string) {
    if (!client || !review) return;
    setReviewBusy(true);
    try {
      await client.invoke(approve ? 'requests.approve' : 'requests.deny', {
        id: review.id,
        fingerprint: review.fingerprint,
        ...(confirmation == null ? {} : { confirmation }),
      });
      const list = object(await client.invoke('requests.list', {}));
      setReview(rows(list.requests).find((r) => r.id === review.id));
      await loadRoster(client, true);
    } catch (e) {
      fail(e);
    } finally {
      setReviewBusy(false);
    }
  }
  async function toggleRoutine(r: Row) {
    if (!client || selection?.kind !== 'bot' || routinePending) return;
    const target = selection,
      id = text(r.job_id) || text(r.id);
    setRoutinePending(id);
    try {
      await client.invoke('routines.set_enabled', {
        profile: target.bot.profile,
        job_id: id,
        enabled: r.enabled === false || r.paused === true || r.state === 'paused',
      });
      const data = object(await client.invoke('routines.list', { profile: target.bot.profile }));
      if (selected.current === target) setRoutines(rows(data.jobs ?? []));
    } catch (e) {
      fail(e);
    } finally {
      setRoutinePending('');
    }
  }
  const detailsContent = client && (
    <Inspector
      bot={selection?.kind === 'bot' ? selection.bot : undefined}
      room={selection?.kind === 'room' ? selection.room : undefined}
      workspace={workspace}
      client={client}
      routines={routines}
      target={detailsTarget}
      sessionId={selection?.kind === 'bot' ? selection.sessionId : undefined}
      filesVersion={filesVersion}
      pending={routinePending}
      onToggle={(r) => void toggleRoutine(r)}
      onClose={() => toggleDetails(false)}
      onEdit={() => {
        setEditProfile(selection?.kind === 'bot' ? selection.bot.profile : undefined);
        setSettingsTab('agents');
        setSettings(true);
      }}
    >
      {approvals.map((approval) => (
        <section className="approval" key={text(approval.request_id)}>
          <h3>Approval needed</h3>
          <p>
            {text(approval.command) ||
              text(approval.description) ||
              (approval.approval ? text(object(approval.approval).command) : '') ||
              'Hermes requested permission.'}
          </p>
          <div>
            <button disabled={blocked} onClick={() => void approve(approval, 'deny')}>
              Deny
            </button>
            <button disabled={blocked} onClick={() => void approve(approval, 'once')}>
              Allow once
            </button>
          </div>
        </section>
      ))}
    </Inspector>
  );

  if (!client)
    return owner ? (
      <StartupScreen
        onSignOut={() => void owner.logout()}
        error={error}
        onRetry={scheduleReconnect}
      />
    ) : (
      <FirstRun onConnect={connect} />
    );

  if (client.supportsWorkspace && workspace && !workspace.initialized)
    return (
      <main className="onboarding-shell">
        <header>
          {owner && (
            <button
              onClick={() => {
                disconnect();
                void owner.logout();
              }}
            >
              Sign out
            </button>
          )}
        </header>
        <WorkspaceSetup
          client={client}
          onComplete={(state, profile, welcome) => {
            setWorkspace(state);
            restoreProfile.current = profile;
            welcomeProfile.current = welcome ? profile : '';
            autoOpened.current = false;
            void loadRoster(client).catch(fail);
          }}
        />
      </main>
    );

  const title =
    selection?.kind === 'bot'
      ? (bots.find((b) => b.id === selection.bot.id && b.profile === selection.bot.profile)?.name ??
        selection.bot.name)
      : selection?.kind === 'room'
        ? text(selection.room.name)
        : 'Chats';
  if (starting && client.supportsWorkspace)
    return (
      <StartupScreen
        onSignOut={owner ? () => void owner.logout() : undefined}
        error={error}
        onRetry={owner ? scheduleReconnect : disconnect}
      />
    );

  const rail = (
    <Rail
      bots={bots}
      rooms={rooms}
      workspace={
        workspace
          ? {
              ...workspace,
              bots: workspace.bots.map((b) =>
                Object.hasOwn(pinIntents, b.id)
                  ? { ...b, pinned: pinIntents[b.id]!, pin_configured: true }
                  : b,
              ),
            }
          : undefined
      }
      client={client}
      pendingPins={Object.fromEntries(Object.keys(pinIntents).map((id) => [id, true]))}
      organization={organization}
      crewChats={crewChats}
      onOrganization={changeOrganization}
      onCrew={(id) => navigate(() => void openCrew(id))}
      onSearch={() => setSearchOpen(true)}
      onClose={nav ? closeNav : undefined}
      onEdit={(profile) =>
        navigate(() => {
          setEditProfile(profile);
          setSettingsTab('agents');
          setSettings(true);
          setPickingAgents(false);
          setNav(false);
        })
      }
      selected={
        selection?.kind === 'bot'
          ? selection.bot.profile
          : selection?.kind === 'room'
            ? text(selection.room.room_id)
            : undefined
      }
      states={agentStates}
      online={streamState === 'live'}
      pinOrder={pinOrder}
      onOpen={(bot) =>
        navigate(() => {
          setSettings(false);
          if (bot.canonical) void open(bot);
          else setPickingAgents(true);
        })
      }
      onRoom={(room) =>
        navigate(() => {
          setSettings(false);
          openRoom(room);
        })
      }
      onAdd={() =>
        navigate(() => {
          setPickingAgents(true);
          setNav(false);
          setSettings(false);
        })
      }
      onSettings={() =>
        navigate(() => {
          setSettingsTab(owner ? 'account' : 'connections');
          setSettings(true);
          setPickingAgents(false);
          setNav(false);
        })
      }
      onPin={(bot, pinned) => void pinPebble(bot, pinned)}
      onVisibility={(bot, hidden) => void visibility(bot, hidden)}
      onDelete={(bot) => void proposeDelete(bot)}
      onOrder={(ids) =>
        void presentationAction('presentation.order', {
          ids,
          expected_revision: preferencesRevision.current,
        })
      }
      owner={!!owner}
      onLogout={() => {
        disconnect();
        if (owner) void owner.logout();
      }}
    />
  );
  const settingsContent = workspace ? (
    <Suspense fallback={<LoadingBar active label="Loading Settings" />}>
      <WorkspaceSettings
        onNavigate={navigate}
        key={`${settingsTab}:${editProfile ?? ''}`}
        onDirtyChange={onDirtyChange}
        initialTab={settingsTab}
        initialProfile={
          settingsTab === 'agents'
            ? editProfile
            : selection?.kind === 'bot'
              ? selection.bot.profile
              : undefined
        }
        client={client}
        owner={!!owner}
        state={workspace}
        onChange={(state) => {
          if (
            workspaceRef.current?.id === state.id &&
            state.revision < workspaceRef.current.revision
          )
            return;
          workspaceRef.current = state;
          setWorkspace(state);
          void loadRoster(client, true).catch(fail);
        }}
        onClose={() => setSettings(false)}
      />
    </Suspense>
  ) : null;
  return (
    <main
      className={`pc-shell workspace ${settings && settingsTab !== 'agents' ? 'editing' : ''} ${details && phone && !settings ? 'phone-details' : ''}`}
    >
      <aside className="pc-rail sidebar" aria-label="Pebbles and crews">
        {rail}
      </aside>
      {nav && (
        <Drawer title="navigation" onClose={closeNav}>
          {rail}
        </Drawer>
      )}
      <section
        className="pc-main conversation"
        aria-label="Conversation"
        inert={details && phone && !settings}
      >
        {settings && settingsTab !== 'agents' && workspace ? (
          settingsContent
        ) : (
          <>
            <header className="pc-chat-header chat-header">
              <button
                className="icon-button mobile-nav"
                aria-label="Toggle navigation"
                onClick={() => setNav(true)}
              >
                <Icon name="menu" />
              </button>
              <button
                type="button"
                className="pc-chat-identity chat-title"
                aria-labelledby="chat-heading chat-role chat-details-action"
                aria-expanded={details}
                aria-controls="pebble-details"
                disabled={!selection}
                onClick={() => toggleDetails(!details)}
              >
                {selection?.kind === 'bot' && (
                  <PebbleAvatar
                    bot={selection.bot}
                    workspace={workspace}
                    client={client}
                    state={agentStates[selection.bot.profile]}
                  />
                )}
                {selection?.kind === 'room' && (
                  <CrewAvatar room={selection.room} workspace={workspace} client={client} />
                )}
                <div>
                  <h1 id="chat-heading">{title}</h1>{' '}
                  <span id="chat-details-action" className="sr-only">
                    {details ? 'Hide details' : 'Show details'}
                  </span>{' '}
                  {selection?.kind === 'bot' && (
                    <p id="chat-role">
                      {workspace?.bots.find((b) => b.profile === selection.bot.profile)?.role
                        .title ||
                        `@${workspace?.bots.find((b) => b.profile === selection.bot.profile)?.handle ?? selection.bot.profile}`}
                    </p>
                  )}
                </div>
                <ChevronRight
                  className={`pc-details-chevron ${details ? 'is-open' : ''}`}
                  aria-hidden
                />
              </button>
              <div className="header-actions">
                {requestCount > 0 && (
                  <button
                    className="request-count"
                    onClick={() => {
                      setSettingsTab('requests');
                      setSettings(true);
                    }}
                  >
                    {requestCount} to review
                  </button>
                )}
                {selection?.kind === 'bot' && (
                  <button
                    className="icon-button"
                    aria-label="Refresh"
                    title="Refresh conversation"
                    onClick={() => void refreshHistory(client, selection).catch(fail)}
                  >
                    <Icon name="refresh" />
                  </button>
                )}
              </div>
            </header>
            {error && (
              <div className="error banner" role="alert">
                <div className="banner-body">
                  <p>{error}</p>
                  {attachmentUncertain && (
                    <span className="attachment-recovery">
                      <button onClick={() => void checkAttachmentSend()}>Check send outcome</button>
                      <button onClick={() => void checkAttachmentSend(true)}>
                        Discard pending files
                      </button>
                    </span>
                  )}
                  {streamState === 'lost' && (
                    <button onClick={owner ? scheduleReconnect : disconnect}>
                      {owner ? 'Try reconnecting now' : 'Disconnect and reconnect'}
                    </button>
                  )}
                </div>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError('')}
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            <div
              ref={transcriptPane}
              className={`pc-transcript transcript ${pickingAgents ? 'choosing-agents' : ''}`}
              role={pickingAgents ? undefined : 'log'}
              aria-live={pickingAgents ? undefined : 'off'}
              onWheel={() => {
                detailsAnchor.current = undefined;
                transcriptFollow.current?.cancel();
              }}
              onTouchStart={() => {
                detailsAnchor.current = undefined;
              }}
              onTouchMove={() => transcriptFollow.current?.cancel()}
              onKeyDown={(event) => {
                if (
                  ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
                )
                  transcriptFollow.current?.cancel();
              }}
              onScroll={(event) => {
                if (pickingAgents) return;
                const pane = event.currentTarget;
                if (transcriptFollow.current?.ownsScroll || scrollAnimating.current) return;
                transcriptFollow.current?.cancel();
                followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96;
                setShowLatest(!followLatest.current);
                rememberScroll();
                acknowledgeRead();
              }}
            >
              <Transcript
                footer={
                  selection?.kind === 'bot' &&
                  (client.supportsLiveVoice || client.supportsSecrets) ? (
                    <VoiceChat
                      key={selection.sessionId}
                      ref={voicePanel}
                      client={client}
                      sessionId={selection.sessionId}
                      running={running}
                      onAccepted={(message) =>
                        setMessages((previous) =>
                          previous.some((item) => item.id === message.id)
                            ? previous
                            : [...previous, message],
                        )
                      }
                    />
                  ) : undefined
                }
                ownerColor={
                  selection?.kind === 'bot'
                    ? workspace?.bots.find((b) => b.profile === selection.bot.profile)?.appearance
                        .color
                    : undefined
                }
                client={client}
                sessionId={selection?.kind === 'bot' ? selection.sessionId : undefined}
                conversationKey={selection ? draftKey(selection) : ''}
                onReact={
                  client.supportsReactions && streamState === 'live' ? reactToMessage : undefined
                }
                messages={withSharedFiles(messages, sharedFiles)}
                onDownloadFile={(file) => {
                  if (selection?.kind !== 'bot') return;
                  void client
                    .downloadFile(selection.sessionId, file.id)
                    .then((blob) => {
                      const url = URL.createObjectURL(blob),
                        a = document.createElement('a');
                      a.href = url;
                      a.download = file.name;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                    .catch(fail);
                }}
                title={title}
                crew={selection?.kind === 'room'}
                stream={stream}
                reply={sendProjection.current.reply}
                running={running}
                activity={running && stopping ? 'Stopping' : activity}
                authorName={(name) =>
                  workspace?.bots.find(
                    (b) =>
                      b.profile === name ||
                      b.handle === name.replace('@', '') ||
                      (name === 'hermes' && b.profile === 'default'),
                  )?.name ?? name
                }
              >
                {!selection && (
                  <div className="welcome">
                    <h2>{streamState !== 'live' ? 'Connecting…' : 'Choose a conversation'}</h2>
                    {streamState === 'live' && !bots.length && (
                      <button onClick={() => setPickingAgents(true)}>Add existing agents</button>
                    )}
                  </div>
                )}
                {selection && !messages.length && !stream && !running && (
                  <span className="empty-chat" aria-hidden="true" />
                )}
                {removedDraft && (
                  <section className="recovered-draft">
                    <h3>Unsent draft</h3>
                    <p className="preserve-whitespace">{removedDraft}</p>
                    <button onClick={() => void navigator.clipboard.writeText(removedDraft)}>
                      Copy draft
                    </button>
                    <button onClick={() => setRemovedDraft('')}>Dismiss</button>
                  </section>
                )}
              </Transcript>
            </div>
            {!pickingAgents && (
              <>
                {showLatest && (
                  <button className="jump-latest" onClick={jumpToLatest}>
                    ↓ Latest messages
                  </button>
                )}
                {approvals.length > 0 && (
                  <button className="approval-nudge" onClick={() => setDetails(true)}>
                    Approval needed · Review
                  </button>
                )}
                <div
                  className="pc-composer-wrap composer-wrap"
                  onDragOver={(e) => {
                    if (selection?.kind === 'bot' && client.supportsAttachments) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (selection?.kind === 'bot' && client.supportsAttachments) {
                      e.preventDefault();
                      uploads.add([...e.dataTransfer.files]);
                    }
                  }}
                >
                  {uploads.error && (
                    <p className="upload-error" role="alert">
                      {uploads.error}
                    </p>
                  )}
                  {!!uploads.files.length && (
                    <ul className="attachment-chips">
                      {uploads.files.map((file) => (
                        <li key={file.key} data-status={file.status}>
                          <Icon name="file" />
                          <span>
                            <strong>{file.name}</strong>
                            <small>
                              {file.status === 'uploading'
                                ? 'Uploading…'
                                : file.status === 'error'
                                  ? file.error
                                  : fileSize(file.size)}
                            </small>
                          </span>
                          {file.status === 'error' && (
                            <button
                              type="button"
                              aria-label={`Retry ${file.name}`}
                              onClick={() => uploads.retry(file)}
                            >
                              <Icon name="refresh" />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            disabled={busy}
                            onClick={() => uploads.remove(file)}
                          >
                            <Icon name="close" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    className="pc-composer pc-composer-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                    onClick={(e) => {
                      if (e.target === e.currentTarget) composer.current?.focus();
                    }}
                  >
                    {client.supportsAttachments && selection?.kind === 'bot' && (
                      <>
                        <input
                          ref={attachmentInput}
                          type="file"
                          className="sr-only"
                          tabIndex={-1}
                          aria-label="Choose attachments"
                          multiple
                          onChange={(e) => {
                            uploads.add([...(e.target.files ?? [])]);
                            e.target.value = '';
                          }}
                        />
                        <Menu
                          label="Add attachment"
                          placement="composer"
                          disabled={busy || blocked || uploads.files.length >= 5}
                          items={[
                            {
                              label: 'File',
                              icon: File,
                              action: () => {
                                if (attachmentInput.current) {
                                  attachmentInput.current.accept = '';
                                  attachmentInput.current.click();
                                }
                              },
                            },
                            {
                              label: 'Photo',
                              icon: Image,
                              action: () => {
                                if (attachmentInput.current) {
                                  attachmentInput.current.accept =
                                    'image/png,image/jpeg,image/webp';
                                  attachmentInput.current.click();
                                }
                              },
                            },
                          ]}
                        >
                          <Icon name="plus" />
                        </Menu>
                      </>
                    )}
                    <textarea
                      ref={composer}
                      rows={1}
                      aria-label="Message"
                      placeholder={selection ? `Message ${title}` : 'Choose a conversation'}
                      value={draft}
                      disabled={!selection || busy || blocked}
                      maxLength={16000}
                      onPaste={(e) => {
                        if (
                          client.supportsAttachments &&
                          selection?.kind === 'bot' &&
                          e.clipboardData.files.length
                        ) {
                          e.preventDefault();
                          uploads.add([...e.clipboardData.files]);
                        }
                      }}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        if (selected.current)
                          drafts.current.set(draftKey(selected.current), e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    {selection?.kind === 'bot' && client.supportsLiveVoice && (
                      <button
                        type="button"
                        className="icon-button pc-call-button"
                        aria-label="Voice chat"
                        disabled={blocked}
                        onClick={() => {
                          voicePanel.current?.open();
                          followLatest.current = true;
                          requestAnimationFrame(jumpToLatest);
                        }}
                      >
                        <AudioLines size={20} />
                      </button>
                    )}
                    <ComposerAction
                      mode={running ? (stopping ? 'stopping' : 'stop') : 'send'}
                      disabled={
                        running
                          ? stopping || blocked
                          : !selection ||
                            (!draft.trim() && !uploads.files.length) ||
                            !uploads.ready ||
                            busy ||
                            blocked
                      }
                      onStop={() => void stop()}
                    />
                  </form>
                </div>
              </>
            )}
          </>
        )}
      </section>
      <DetailsDock
        open={details && (!settings || settingsTab === 'agents')}
        onFrame={restoreDetailsAnchor}
      >
        <div id="pebble-details" className="pc-details details-panel">
          {detailsContent}
        </div>
      </DetailsDock>
      {settings && settingsTab === 'agents' && (
        <Drawer
          title="Edit pebble"
          variant="dialog"
          onBeforeClose={() => {
            if (!dirtyEditor.current) return true;
            pendingNavigation.current = () => setSettings(false);
            setConfirmNavigation(true);
            return false;
          }}
          onClose={() => setSettings(false)}
        >
          {settingsContent}
        </Drawer>
      )}
      {pickingAgents && (
        <Drawer
          title="New pebble"
          variant="dialog"
          onBeforeClose={() => {
            if (!dirtyEditor.current) return true;
            pendingNavigation.current = () => setPickingAgents(false);
            setConfirmNavigation(true);
            return false;
          }}
          onClose={() => setPickingAgents(false)}
        >
          <Suspense fallback={<LoadingBar active label="Loading pebble setup" />}>
            <NewPebble
              client={client}
              state={workspace!}
              onDirtyChange={onDirtyChange}
              connected={streamState === 'live'}
              onClose={() => navigate(() => setPickingAgents(false))}
              onDone={async (profile, introduce) => {
                await loadRoster(client, true);
                if (current.current === client) {
                  setPickingAgents(false);
                  if (profile) {
                    const bot = workspaceRef.current?.bots.find((b) => b.profile === profile);
                    if (bot) {
                      await open(bot);
                      if (introduce) {
                        try {
                          await client.invoke('agent.welcome', {
                            profile: bot.profile,
                            id: bot.id,
                          });
                        } catch {
                          setError(
                            'Your agent’s introduction could not be confirmed. Check this chat before requesting another.',
                          );
                        }
                      }
                    }
                  }
                }
              }}
            />
          </Suspense>
        </Drawer>
      )}
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        client={client}
        onBot={(profile, detail) => {
          const bot = bots.find((b) => b.profile === profile);
          if (bot)
            navigate(() => {
              setSettings(false);
              void open(bot).then(() => {
                if (
                  detail &&
                  selected.current?.kind === 'bot' &&
                  selected.current.bot.profile === profile
                ) {
                  setDetailsTarget(detail);
                  toggleDetails(true);
                }
              });
            });
        }}
        onRoom={(room) =>
          navigate(() => {
            setSettings(false);
            openRoom(room);
          })
        }
      />
      {confirmCrew && (
        <Drawer title="Updated crew" variant="dialog" onClose={() => setConfirmCrew(undefined)}>
          <h2>Start a chat with this crew?</h2>
          <p>Membership changed. Your previous chat will stay in Group chats.</p>
          <div className="form-actions">
            <button onClick={() => setConfirmCrew(undefined)}>Cancel</button>
            <button onClick={() => void openCrew(confirmCrew, true)}>Start new chat</button>
          </div>
        </Drawer>
      )}
      {confirmNavigation && (
        <Drawer
          title="Unsaved changes"
          variant="dialog"
          onClose={() => setConfirmNavigation(false)}
        >
          <h2>Discard unsaved changes?</h2>
          <div className="form-actions">
            <button data-autofocus onClick={() => setConfirmNavigation(false)}>
              Keep editing
            </button>
            <button
              className="danger-text"
              onClick={() => {
                dirtyEditor.current = false;
                setConfirmNavigation(false);
                pendingNavigation.current?.();
                pendingNavigation.current = undefined;
              }}
            >
              Discard changes
            </button>
          </div>
        </Drawer>
      )}
      {review && (
        <Drawer title="Review deletion" onClose={closeReview}>
          <RequestReview
            request={review}
            busy={reviewBusy}
            onDecision={(a, c) => void decideReview(a, c)}
            onInspect={() =>
              void client
                .invoke('requests.reconcile', { id: review.id })
                .then((r) => setError(text(object(r).message)))
                .catch(fail)
            }
          />
        </Drawer>
      )}
    </main>
  );
}
