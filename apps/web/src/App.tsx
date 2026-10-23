import { ProactiveSetup } from './proactive/ProactiveSetup';
import { PlansArea, BoardOutcome } from './work/PlansArea';
import type { AttentionNavigation } from './chat/ConversationAttention';
import { useSecretCards } from './chat/SecretCards';
import { ConversationAttention } from './chat/ConversationAttention';
import { useManagementRequests } from './chat/useManagementRequests';
import type { TranscriptCard } from './chat/presentation';
import type { SessionClient } from '@hermes-client/protocol';
import { usePageTitle } from './ui/page-title';
import { DiscardChanges } from './ui/DiscardChanges';
import { useComposerSize } from './chat/use-composer-size';
import { CommandSuggestions } from './chat/CommandSuggestions';
import { MentionSuggestions, useMentionSuggestions } from './chat/MentionSuggestions';
import type { CommandSuggestionsHandle } from './chat/CommandSuggestions';
import { reconcileNativeApprovals, type NativeApprovalReview } from './chat/native-approvals';
import { Confirmation } from './components/ai-elements/confirmation';
import { Tool } from './components/ai-elements/tool';
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
} from './components/ui/attachment';
import { PromptInputFrame, PromptInputField } from './components/ai-elements/prompt-input';
import { conversationCapabilities } from './chat/capability-ledger';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { safeError } from '@hermes-client/core';
import {
  ConversationDomain,
  decodeApprovals,
  decodeRoomReactions,
  approvalKey,
  StreamHandoff,
} from '@hermes-client/protocol';
import type { BridgeEvent, ConversationApproval, HistoryCoverage } from '@hermes-client/protocol';
import { FirstRun } from './FirstRun';
import { lazy, Suspense } from 'react';
const NewPebble = lazy(() => import('./NewPebble').then((m) => ({ default: m.NewPebble })));
const WorkspaceSettings = lazy(() =>
  import('./WorkspaceSettings').then((m) => ({ default: m.WorkspaceSettings })),
);

import { useMedia, scrollToLatest } from './ui/motion';
import { roomMessages, withSharedFiles } from './conversation';
import type { ChatMessage as Message } from './conversation';
import { RosterLoader } from './chat/roster';
import { useUploads } from './chat/uploads';
import type { SharedFile } from './chat/FilesPanel';
import { fileSize } from './chat/FilesPanel';
import { Rail, PebbleAvatar, CrewAvatar } from './chat/Rail';
import type { ChatBot as Bot } from './chat/Rail';
import { useAgentExchanges } from './chat/AgentExchanges';
import { Transcript } from './chat/Transcript';
import { Chat, ChatViewport } from './components/ai-elements/chat';
import { ComposerAction } from './chat/ComposerAction';
import { Inspector } from './chat/Inspector';
import { Icon } from './chat/Icon';
import { Drawer } from './chat/Drawer';
import { RequestReview } from './chat/RequestReview';
import { DetailsDock } from './ui/DetailsDock';
import { VoiceChat } from './voice/VoiceChat';
import type { VoiceChatHandle } from './voice/VoiceChat';
import type { VoiceSettingsRequest } from './voice/decode';
import { File, Image, Inbox, Menu as MenuIcon, RefreshCw, X, Terminal } from 'lucide-react';
import { Button } from './components/ui/button';
import { IconButton } from './components/ui/icon-button';
import { Alert, AlertDescription, AlertAction } from './components/ui/alert';
import { ConversationIdentity } from './ui/ConversationIdentity';
import { WorkspacePanels } from './ui/WorkspacePanels';
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
import { ConversationDrafts } from './chat/drafts';
import { reactionReceipt, RoomReactionProjection } from './chat/reactions';
import { useOverlayHistory } from './ui/overlay-history';
import type { OwnerConnection } from './OwnerShell';
import { WorkspaceSetup } from './WorkspaceSetup';
import { StartupScreen } from './StartupScreen';
import { OwnerSession } from './connection/session';
import { ConnectionRecovery } from './connection/recovery-context';
import { ConversationFeed } from './connection/conversation-feed';
import type { SessionTicket } from './connection/session';
import { OrgChart } from './OrgChart';
import { RequestDomain } from '@hermes-client/protocol';
import { useConversationRequests } from './chat/ConversationRequests';
import { useQuestionCards } from './chat/QuestionCards';
import { useWorkCatalog } from './work/use-work';
import { WorkReadError } from './work/WorkReadError';
import { WorkHeader } from './work/WorkHeader';
import { WorkArea } from './work/WorkArea';
import { WorkDialog } from './work/WorkDialogs';
import type { WorkDialogTarget } from './work/WorkDialogs';
import { DocumentActions, DocumentReader, useDocumentReader } from './documents/DocumentReader';
import { decodeDocumentRequest } from '@hermes-client/protocol';

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
  const commandSuggestions = useRef<CommandSuggestionsHandle>(null);
  const [commandResult, setCommandResult] = useState<{
    sessionId: string;
    command: string;
    output: string;
  }>();
  const voicePanel = useRef<VoiceChatHandle>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceBarTarget, setVoiceBarTarget] = useState<HTMLDivElement | null>(null);
  const [agentSettingsTab, setAgentSettingsTab] = useState<'identity' | 'voice'>('identity');
  const [voiceSettingsRequest, setVoiceSettingsRequest] = useState<VoiceSettingsRequest>();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [settings, setSettings] = useState(false);
  const [proactiveOpen, setProactiveOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const [area, setArea] = useState<'chat' | 'tasks'>('chat');
  const [workBoard, setWorkBoard] = useState('default');
  const [workDialog, setWorkDialog] = useState<WorkDialogTarget>();
  const [workRevision, setWorkRevision] = useState(0);
  const [settingsTab, setSettingsTab] = useState<
    'agents' | 'requests' | 'account' | 'connections' | 'general'
  >('general');
  const [agentStates, setAgentStates] = useState<Record<string, Activity>>({});
  const sessionProfiles = useRef(new Map<string, string>());
  const session = useRef<OwnerSession | undefined>(undefined);
  const conversationFeed = useRef<ConversationFeed | undefined>(undefined);
  const retryConnection = () => session.current?.retry();
  const mutationEpoch = useRef(0);
  const initialOpenRecovery = useRef<number | undefined>(undefined);
  const selectionEpoch = useRef(-1);
  const [recovery, setRecovery] = useState({ resources: 0, lease: 0 });
  const [connectionAvailable, setConnectionAvailable] = useState(false);
  const [chatBound, setChatBound] = useState(false);
  const autoOpened = useRef(false);
  const restoreProfile = useRef('');
  const restoreRoom = useRef('');
  const welcomeProfile = useRef('');
  const disposed = useRef(false);
  const [client, setClient] = useState<SessionClient>();
  const current = useRef<SessionClient | undefined>(undefined);
  const selected = useRef<Selection | undefined>(undefined);
  const selectionConnection = useRef<SessionClient | undefined>(undefined);
  const selectGeneration = useRef(0);
  const streamHandoff = useRef(new StreamHandoff());
  const openingChat = useRef<{ generation: number; events: BridgeEvent[] } | undefined>(undefined);
  const historyGeneration = useRef(0);
  const [bots, setBots] = useState<Bot[]>([]);
  const [rooms, setRooms] = useState<Row[]>([]);
  const [crewChats, setCrewChats] = useState<Record<string, string>>({});
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const crewChatsRef = useRef(crewChats);
  crewChatsRef.current = crewChats;
  const roomReactions = useRef(new RoomReactionProjection());
  const [selection, setSelection] = useState<Selection>();
  const [starting, setStarting] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const sendProjection = useRef(new SendProjection());
  const runEpoch = useRef(0);
  const [routines, setRoutines] = useState<Row[]>([]);
  const [approvals, setApprovals] = useState<NativeApprovalReview[]>([]);
  const approvalHistory = useRef(new Map<string, NativeApprovalReview[]>());
  function observeApprovals(scope: string, pending: ConversationApproval[]) {
    const rows = reconcileNativeApprovals(approvalHistory.current.get(scope) ?? [], pending);
    approvalHistory.current.set(scope, rows);
    setApprovals(rows);
  }
  const approvalRead = useRef(0);
  async function refreshApprovals(connection: SessionClient, target: Selection) {
    if (target.kind !== 'bot') return;
    const started = ++approvalRead.current;
    const pending = await new ConversationDomain(connection).approvals(target.sessionId);
    if (
      started === approvalRead.current &&
      current.current === connection &&
      selected.current === target
    )
      observeApprovals(target.sessionId, pending);
  }
  const approvalFlights = useRef(new Set<string>());
  const [approvalSubmitting, setApprovalSubmitting] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const draftEdits = useRef(0);
  const attachmentDraft = useRef<{ conversation: string; edit: number } | undefined>(undefined);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const [stream, setStream] = useState('');
  const [activity, setActivity] = useState('Ready');
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const sendFlight = useRef<symbol | null>(null);
  const [switching, setSwitching] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [streamState, setStreamState] = useState<'opening' | 'live' | 'lost'>('opening');
  const work = useWorkCatalog(
    client,
    workspace?.initialized ? workspace.id : undefined,
    connectionAvailable,
    recovery.resources,
  );
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
  const organizationFlight = useRef<SessionClient | undefined>(undefined);
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
            organization: { schema: 2, sections: next.sections, crews: next.crews },
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
    if (!current.current || !connectionAvailable) return;
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
      setError('Choose 2–6 pebbles in Crew settings to open this chat.');
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
  const agentExchanges = useAgentExchanges(
    client,
    selection?.kind === 'bot'
      ? workspace?.bots.find((b) => b.profile === selection.bot.profile)?.id
      : undefined,
    (profile) => {
      const bot = bots.find((b) => b.profile === profile);
      return bot && client ? (
        <PebbleAvatar bot={bot} workspace={workspace} client={client} mainBadge={false} />
      ) : null;
    },
  );
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
  const [review, setReview] = useState<import('@hermes-client/protocol').WorkspaceRequest>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [cardsVersion, setCardsVersion] = useState(0);
  const attentionNavigations = useRef(new Map<string, AttentionNavigation>());
  const [requestFocus, setRequestFocus] = useState<string>();
  const management = useManagementRequests({
    client: workspace ? client : undefined,
    scope: workspace?.id,
    version: cardsVersion,
  });
  const requestCount = management.requests.filter((request) => request.state === 'pending').length;
  const secretCards = useSecretCards({
    client: client?.supportsSecrets ? client : undefined,
    sessionId: selection?.kind === 'bot' ? selection.sessionId : undefined,
    version: cardsVersion,
    scope: workspace?.id,
  });
  const requestCards = useConversationRequests({
    client,
    profile: selection?.kind === 'bot' ? selection.bot.profile : undefined,
    workspace,
    management,
    onOpen(profile, requestId) {
      const bot = bots.find((bot) => bot.profile === profile);
      if (bot) {
        setRequestFocus(requestId);
        void open(bot);
      } else {
        setSettingsTab('requests');
        setSettings(true);
      }
    },
  });
  const questionCards = useQuestionCards({
    client: client?.supportsQuestions ? client : undefined,
    scope: workspace?.id,
    sessionId: selection?.kind === 'bot' ? selection.sessionId : undefined,
    version: cardsVersion,
  });
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
  const drafts = useRef(new ConversationDrafts());
  drafts.current.bind(workspace?.id);
  const [mentionCaret, setMentionCaret] = useState(0);
  const mentionSuggestions = useMentionSuggestions({
    value: draft,
    caret: mentionCaret,
    input: composer,
    bots:
      selection?.kind === 'room'
        ? (workspace?.bots.filter((bot) =>
            rows(selection.room.members).some((member) => member.profile === bot.profile),
          ) ?? [])
        : [],
    onChoose(value, position) {
      draftEdits.current++;
      setDraft(value);
      setMentionCaret(position);
      if (selected.current) drafts.current.set(draftKey(selected.current), value);
    },
  });
  const [showLatest, setShowLatest] = useState(false);
  const displayedRead = useRef<{ key: string; cursor: number } | undefined>(undefined);
  const acknowledgedRead = useRef(new Map<string, number>());
  function observedHistory(target: Selection, coverage: HistoryCoverage) {
    if (target.kind !== 'bot') return;
    const bot = workspaceRef.current?.bots.find((b) => b.id === target.bot.id);
    // Only acknowledge a native roster cursor covered by the loaded history.
    // A later background snapshot cannot mark unseen messages as read.
    if (
      bot?.read_key &&
      typeof bot.cursor === 'number' &&
      (bot.cursor_type === 'row' ? coverage.maxRow : coverage.count) >= bot.cursor
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
      settings ||
      orgOpen
    )
      return;
    if ((acknowledgedRead.current.get(seen.key) ?? -1) >= seen.cursor) return;
    const connection = current.current;
    acknowledgedRead.current.set(seen.key, seen.cursor);
    void connection
      .invoke('presentation.read', seen)
      .then(() => {
        if (current.current === connection)
          void loadRoster(connection, true).catch(() => undefined);
      })
      .catch(() => acknowledgedRead.current.delete(seen.key));
  }
  useEffect(() => {
    acknowledgeRead();
  }, [messages, workspace, settings, pickingAgents, orgOpen]);
  const draftKey = (target: Selection) =>
    target.kind === 'bot'
      ? `bot:${target.bot.id ?? target.bot.profile}`
      : `room:${text(target.room.room_id)}`;
  const attentionKey = workspace?.id + ':' + (selection ? draftKey(selection) : '');
  let attentionNavigation = attentionNavigations.current.get(attentionKey);
  if (!attentionNavigation) {
    attentionNavigation = { selection: undefined, order: new Map() };
    attentionNavigations.current.set(attentionKey, attentionNavigation);
  }

  const attachmentInput = useRef<HTMLInputElement>(null);
  const fileSession =
    client && selection?.kind === 'bot' && selectionConnection.current === client
      ? selection.sessionId
      : undefined;
  const documentReader = useDocumentReader(selection ? draftKey(selection) : '');
  const showDocument = useRef(documentReader.show);
  showDocument.current = (value) => {
    captureDetailsAnchor();
    documentReader.show(value);
  };
  const documentRequests = useRef(new Set<string>());
  const uploads = useUploads(client, selection ? draftKey(selection) : '', fileSession);
  const [attachmentUncertain, setAttachmentUncertain] = useState(false);
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]),
    [filesVersion, setFilesVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setSharedFiles([]);
    if (client?.supportsAttachments && fileSession)
      void new ConversationDomain(client)
        .files(fileSession)
        .then((files) => {
          if (live) setSharedFiles(files);
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, fileSession, filesVersion]);
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
          if (
            attachmentDraft.current?.conversation === draftKey(selection) &&
            attachmentDraft.current.edit === draftEdits.current
          ) {
            setDraft('');
            drafts.current.delete(draftKey(selection));
          }
        }
        attachmentDraft.current = undefined;
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
    session.current?.close();
    conversationFeed.current?.close();
    session.current = undefined;
    setConnectionAvailable(false);
    setChatBound(false);
    organizationQueue.current = [];
    organizationPending.current = Promise.resolve(true);
    setWorkspace(undefined);
    setAgentStates({});
    sessionProfiles.current.clear();
    setSettings(false);
    selectGeneration.current++;
    current.current = undefined;
    selected.current = undefined;
    selectionConnection.current = undefined;
    setClient(undefined);
    approvalHistory.current.clear();
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
    setSwitching(false);
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
    if (ownerRef.current) void startConnection((signal) => ownerRef.current!.ticket(signal));
    return () => {
      disposed.current = true;
      session.current?.close();
      conversationFeed.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!client || !connectionAvailable || busy || autoOpened.current || !workspace?.initialized)
      return;
    if (initialOpenRecovery.current === recovery.resources) return;
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
      if (result === 'recovering') {
        autoOpened.current = false;
        restoreProfile.current = bot.profile;
        initialOpenRecovery.current = recovery.resources;
      }
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
  }, [client, connectionAvailable, busy, workspace, bots, rooms, starting, recovery.resources]);
  useLayoutEffect(() => {
    const pane = transcriptPane.current;
    if (!pane || pickingAgents) return;
    if (transcriptFollow.current?.node !== pane) {
      transcriptFollow.current?.dispose();
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
  useEffect(() => {
    const pause = () => transcriptFollow.current?.pause();
    const resume = () => {
      if (document.visibilityState === 'visible')
        transcriptFollow.current?.resume(followLatest.current);
    };
    const visibility = () => (document.visibilityState === 'hidden' ? pause() : resume());
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
      transcriptFollow.current?.dispose();
    };
  }, []);
  useComposerSize(
    composer,
    draft,
    selection ? draftKey(selection) : '',
    !pickingAgents && !starting && (!settings || settingsTab === 'agents'),
  );

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
  function captureDetailsAnchor() {
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
  }
  function toggleDetails(value: boolean) {
    detailsAnchor.current = undefined;
    captureDetailsAnchor();
    localStorage.setItem('pebblecrew.details', value ? 'open' : 'closed');
    setDetails(value);
    if (!value)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('.chat-title')?.focus({ preventScroll: true }),
      );
  }
  useOverlayHistory(
    details && !documentReader.state && phone && !settings && !pickingAgents && !searchOpen,
    () => {
      toggleDetails(false);
      return true;
    },
  );
  useOverlayHistory(
    !!documentReader.state && phone && !settings && !pickingAgents && !searchOpen,
    () => {
      documentReader.close();
      return true;
    },
  );
  useEffect(() => {
    if (!details || documentReader.state) return;
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
  }, [details, phone, documentReader.state]);
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
    if (settings || orgOpen || !pane || !target) return;
    const saved = scrollPositions.current.get(draftKey(target));
    if (saved) {
      followLatest.current = saved.follow;
      pane.scrollTop = saved.follow ? pane.scrollHeight : saved.top;
      document.querySelector<HTMLElement>('.chat-title')?.focus({ preventScroll: true });
    }
  }, [settings, orgOpen]);
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

  async function refreshHistory(connection: SessionClient, target: Selection, complete = false) {
    if (target.kind !== 'bot' || selectionConnection.current !== connection) return;
    // Native history can already contain a partial turn. Keep it out of the
    // committed transcript while its streamed presentation is still visible.
    if (sendProjection.current.replying && !complete) return;
    const terminalEpoch = runEpoch.current;
    const generation = ++historyGeneration.current;
    const data = await new ConversationDomain(connection).history(target.sessionId);
    if (current.current === connection && selected.current === target) {
      if (
        generation === historyGeneration.current &&
        terminalEpoch === runEpoch.current &&
        (!sendProjection.current.replying || complete)
      ) {
        observedHistory(target, data.coverage);
        setMessages(sendProjection.current.project(data.messages, complete));
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
    if (!connection || !target || !connectionAvailable) return;
    if (!(target.kind === 'bot' ? connection.supportsReactions : connection.supportsRoomReactions))
      return;
    try {
      const domain = new ConversationDomain(connection);
      let result: Awaited<ReturnType<ConversationDomain['react']>>;
      if (target.kind === 'bot') result = await domain.react(target.sessionId, Number(id), emoji);
      else {
        const receipt = await domain.reactRoom(text(target.room.room_id), id, emoji);
        if (current.current !== connection || selected.current !== target) return;
        roomReactions.current.accept(receipt.state);
        result = receipt;
      }
      if (current.current !== connection || selected.current !== target) return;
      setMessages((old) =>
        old.map((m) => (m.id === result.id ? { ...m, reactions: result.reactions } : m)),
      );
    } catch (error) {
      fail(error);
    }
  }

  async function receive(connection: SessionClient, event: BridgeEvent) {
    if (current.current !== connection) return;
    voicePanel.current?.event(event);
    if (event.type === 'exchanges.changed') {
      agentExchanges.refresh();
      return;
    }
    if (event.type === 'questions.changed' || event.type === 'secret.changed') {
      setCardsVersion((version) => version + 1);
      return;
    }
    if (event.type === 'workspace.changed' || event.type === 'requests.changed') {
      setCardsVersion((version) => version + 1);
      await loadRoster(connection, true);
      return;
    }
    if (event.type === 'tool.complete' || event.type === 'message.complete')
      void loadRoster(connection).catch((error) => {
        if (current.current === connection) fail(error);
      });
    if (event.type === 'message.complete') agentExchanges.refresh();
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
    if (
      openingChat.current &&
      event.session_id &&
      /^(message\.|tool\.|status\.|error$)/.test(event.type)
    ) {
      if (openingChat.current.events.length < 4096) openingChat.current.events.push(event);
      else if (openingChat.current.events.length === 4096)
        openingChat.current.events.push({ type: 'bridge.resync' });
      return;
    }
    if (!target || target.kind !== 'bot' || event.session_id !== target.sessionId) return;
    if (event.type === 'document.open') {
      try {
        const request = decodeDocumentRequest(event.payload);
        if (!documentRequests.current.has(request.requestId)) {
          documentRequests.current.add(request.requestId);
          if (documentRequests.current.size > 100)
            documentRequests.current.delete(documentRequests.current.values().next().value!);
          showDocument.current(request);
        }
      } catch {
        /* Invalid or expired live requests never change navigation. */
      }
      return;
    }
    const payload = event.payload ?? {};
    const handoff = streamHandoff.current.accept(
      event.type,
      event.stream_position,
      text(payload.text),
    );
    if (!handoff.accepted) return;
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
      const delta = handoff.text;
      setStream((old) => old + delta);
      if (delta.trim()) setActivity('');
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
      await refreshApprovals(connection, target);
    }
    if (event.type === 'error') setError('Hermes reported an error. Refresh before retrying.');
  }

  async function loadRoster(connection: SessionClient, invalidate = false) {
    return rosterLoader.current.load(
      connection,
      async (isCurrent) => {
        if (connection.supportsWorkspace) {
          const data = object(await connection.invoke('workspace.snapshot', {}));
          if (current.current !== connection || !isCurrent()) return;
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
            setSwitching(false);
            setBusy(false);
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
        } else {
          const roster = object(await connection.invoke('bots.list', {}));
          const nativeRooms = object(await connection.invoke('rooms.list', {}));
          if (current.current !== connection || !isCurrent()) return;
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
    if (!client || !connectionAvailable) return;
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
  }, [client, connectionAvailable]);
  function rememberScroll() {
    if (orgOpen) return;
    const target = selected.current,
      pane = transcriptPane.current;
    if (target && pane)
      scrollPositions.current.set(draftKey(target), {
        top: pane.scrollTop,
        follow: followLatest.current,
      });
  }

  async function connect(endpoint: string, token: string) {
    await startConnection(async () => ({ bridgeUrl: endpoint, ticket: token }));
  }
  async function startConnection(ticket: (signal: AbortSignal) => Promise<SessionTicket>) {
    session.current?.close();
    conversationFeed.current?.close();
    setBusy(true);
    setError('');
    setStreamState('opening');
    setChatBound(false);
    organizationQueue.current = [];
    organizationPending.current = Promise.resolve(true);
    autoOpened.current = false;
    initialOpenRecovery.current = undefined;
    const owned = new OwnerSession({ ticket, localDev: import.meta.env.DEV });
    const connection = owned.client;
    session.current = owned;
    current.current = connection;
    const feed = new ConversationFeed({
      client: connection,
      target: () => {
        const target = selected.current;
        return target?.kind === 'bot'
          ? {
              profile: target.bot.profile,
              sessionId: target.sessionId,
              identity: target,
              generation: selectGeneration.current,
              mutation: mutationEpoch.current,
              bound: selectionEpoch.current === owned.bindingEpoch,
              pending: !!sendFlight.current || !!openingChat.current,
            }
          : undefined;
      },
      receive: (event) => receive(connection, event),
      apply: (snapshot, identity) => {
        const target = selected.current;
        if (current.current !== connection || target !== identity || target.kind !== 'bot') return;
        if (target.sessionId !== snapshot.sessionId) {
          target.sessionId = snapshot.sessionId;
          const rebound = { ...target };
          selected.current = rebound;
          setSelection(rebound);
        }
        selectionConnection.current = connection;
        selectionEpoch.current = owned.bindingEpoch;
        const restored = sendProjection.current.restore(snapshot);
        streamHandoff.current.restore(snapshot.streamPosition, snapshot.running);
        observedHistory(target, snapshot.history.coverage);
        setMessages(restored.messages);
        setStream(restored.stream);
        setRunning(snapshot.running);
        if (!snapshot.running) setStopping(false);
        setChatBound(true);
      },
    });
    conversationFeed.current = feed;
    owned.registerResource(async (leaseChanged, revision) => {
      if (current.current !== connection || disposed.current) return true;
      if (leaseChanged && selectionEpoch.current !== owned.bindingEpoch) setChatBound(false);
      await loadRoster(connection, true);
      const settled = await feed.recover(leaseChanged, revision);
      const target = selected.current;
      if (settled && target?.kind === 'bot') {
        if (selectionEpoch.current === owned.bindingEpoch) setChatBound(true);
        await refreshApprovals(connection, target);
      }
      if (current.current === connection) {
        setCardsVersion((version) => version + 1);
        agentExchanges.refresh();
      }
      return settled;
    });
    let usable = false;
    owned.subscribe((notice) => {
      if (current.current !== connection || disposed.current) return;
      if (notice.kind === 'event') {
        void feed.event(notice.event).catch(() => owned.retry());
      } else if (notice.kind === 'recovery') {
        setRecovery((value) => ({
          resources: value.resources + 1,
          lease: value.lease + (notice.leaseChanged ? 1 : 0),
        }));
      } else if (notice.kind === 'status') {
        const status = notice.status;
        const available = status.kind === 'available';
        if (available && selectionEpoch.current !== owned.bindingEpoch) setChatBound(false);
        setConnectionAvailable(available);
        setStreamState(
          available && status.updates === 'live'
            ? 'live'
            : status.kind === 'starting'
              ? 'opening'
              : 'lost',
        );
        if (available) {
          if (!usable) setError('');
          usable = true;
          setClient(connection);
          setBusy(false);
        } else if (!usable && status.kind === 'unavailable') {
          setBusy(false);
          setError(
            status.reason === 'capacity'
              ? 'Close an unused Pebble Crew tab, then try again.'
              : 'Hermes is not responding yet. Retrying automatically.',
          );
        }
      }
    });
    owned.start();
  }

  async function open(
    bot: Bot,
    { restore = false }: { restore?: boolean } = {},
  ): Promise<'opened' | 'unavailable' | 'recovering' | 'superseded'> {
    if (!client || !connectionAvailable || !bot.canonical) return 'unavailable';
    rememberScroll();
    const generation = ++selectGeneration.current;
    setSwitching(!restore);
    setError('');
    setBusy(true);
    if (!restore) {
      setOrgOpen(false);
      setNav(false);
      setPickingAgents(false);
    }
    try {
      openingChat.current = { generation, events: [] };
      const data = await new ConversationDomain(client).open(bot.profile);
      if (generation !== selectGeneration.current || current.current !== client)
        return 'superseded';
      const target: Selection = { kind: 'bot', bot, sessionId: data.sessionId };
      if (!restore || !selected.current) setDraft(drafts.current.get(draftKey(target)) ?? '');
      if (!restore) {
        displayedRead.current = undefined;
        sendProjection.current = new SendProjection();
        setApprovals([]);
        setRoutines([]);
        followLatest.current = true;
        setShowLatest(false);
      }
      setRemovedDraft('');
      setStopping(false);
      sessionProfiles.current.set(target.sessionId, bot.profile);
      setAgentStates((old) => ({
        ...old,
        [bot.profile]: data.running === true ? 'working' : 'ready',
      }));
      selected.current = target;
      selectionConnection.current = client;
      selectionEpoch.current = session.current?.bindingEpoch ?? -1;
      setSelection(target);
      setSwitching(false);
      const id = workspace?.bots.find((entry) => entry.profile === bot.profile)?.id;
      if (workspace && id) rememberConversation(workspace.id, { kind: 'bot', id });
      setBlocked(false);
      setChatBound(true);
      observedHistory(target, data.history.coverage);
      const restored = sendProjection.current.restore(data);
      streamHandoff.current.restore(data.streamPosition, data.running);
      setMessages(restored.messages);
      setRunning(data.running);
      setStream(restored.stream);
      const buffered =
        openingChat.current?.generation === generation ? openingChat.current.events : [];
      openingChat.current = undefined;
      for (const event of buffered) await receive(client, event);
      setActivity(data.running === true ? 'Working' : 'Ready');
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
      const ownedRoutines = object(await client.invoke('routines.list', { profile: bot.profile }));
      if (current.current !== client || selected.current !== target) return 'superseded';
      setRoutines(rows(ownedRoutines.jobs ?? []));
      await refreshApprovals(client, target);
      // The first open also authorizes this browser's event subscription for
      // the session. Snapshot once more after that authorization; positions
      // merge events that race the response, even under continuous streaming.
      if (current.current !== client || selected.current !== target) return 'superseded';
      openingChat.current = { generation, events: [] };
      const snapshotRevision = session.current?.recoveryVersion ?? -1;
      const snapshot = await (client.supportsConnectionRecovery
        ? new ConversationDomain(client).snapshot(target.sessionId)
        : new ConversationDomain(client).open(bot.profile));
      if (current.current !== client || selected.current !== target) return 'superseded';
      const final = sendProjection.current.restore(snapshot);
      streamHandoff.current.restore(snapshot.streamPosition, snapshot.running);
      observedHistory(target, snapshot.history.coverage);
      setMessages(final.messages);
      setRunning(snapshot.running);
      setStream(final.stream);
      const remaining = openingChat.current.events;
      openingChat.current = undefined;
      for (const event of remaining) await receive(client, event);
      conversationFeed.current?.cover(target, snapshotRevision);
      return current.current === client && selected.current === target ? 'opened' : 'superseded';
    } catch (error) {
      if (generation === selectGeneration.current && current.current === client) {
        if (
          restore &&
          ownerRef.current &&
          [
            'DISCONNECTED',
            'LEASE_GONE',
            'NATIVE_UNAVAILABLE',
            'CONVERSATION_CHANGED',
            'RPC_FAILED',
            'REQUEST_FAILED',
            'REQUEST_TIMEOUT',
            'UNAUTHORIZED',
          ].includes(safeError(error).code)
        ) {
          session.current?.retry(2000);
          return 'recovering';
        }
        fail(error);
        return 'unavailable';
      }
      return 'superseded';
    } finally {
      if (openingChat.current?.generation === generation) openingChat.current = undefined;
      if (generation === selectGeneration.current) {
        focusOnReady.current = matchMedia('(pointer: fine)').matches;
        setBusy(false);
        setSwitching(false);
      }
    }
  }

  function openRoom(room: Row, { restore = false }: { restore?: boolean } = {}) {
    rememberScroll();
    if (!restore) {
      setOrgOpen(false);
      setPickingAgents(false);
    }
    selectGeneration.current++;
    setSwitching(false);
    const target: Selection = { kind: 'room', room };
    if (!restore || !selected.current) setDraft(drafts.current.get(draftKey(target)) ?? '');
    selected.current = target;
    selectionConnection.current = client;
    setSelection(target);
    if (workspace) rememberConversation(workspace.id, { kind: 'room', id: text(room.room_id) });
    if (restore) setBlocked(false);
    if (!restore) {
      roomReactions.current = new RoomReactionProjection();
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
    setActivity('');
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
          if (client!.supportsRoomReactions)
            roomReactions.current.accept(decodeRoomReactions(data));
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
        observeApprovals(
          'room:' + text(selection?.kind === 'room' ? selection.room.room_id : ''),
          decodeApprovals(
            actions.filter((action) => action.kind === 'approval'),
            {
              kind: 'room',
              roomId: text(selection?.kind === 'room' ? selection.room.room_id : ''),
            },
          ),
        );
        const groupLabel = Object.values(crewChatsRef.current).includes(
          text(selection?.kind === 'room' ? selection.room.room_id : ''),
        )
          ? 'Crew'
          : 'Group chat';
        setActivity(
          driver.blocked === true
            ? `${groupLabel} needs attention`
            : driver.working === true
              ? `${groupLabel} members are working`
              : '',
        );
        setMessages(
          sendProjection.current.project(
            roomReactions.current.project(roomMessages([...events.values()])),
          ),
        );
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
            ![
              'DISCONNECTED',
              'LEASE_GONE',
              'CONVERSATION_CHANGED',
              'RPC_FAILED',
              'REQUEST_FAILED',
              'REQUEST_TIMEOUT',
              'UNAUTHORIZED',
            ].includes(safeError(error).code)
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

  async function send(commandOverride?: string) {
    if (
      !client ||
      !selection ||
      (!draft.trim() && !uploads.files.length) ||
      !uploads.ready ||
      busy ||
      sendFlight.current ||
      actionBlocked
    )
      return;
    mutationEpoch.current++;
    const connection = client;
    const target = selection;
    const generation = selectGeneration.current;
    const edit = draftEdits.current;
    const owns = () =>
      current.current === connection &&
      selected.current === target &&
      generation === selectGeneration.current;
    if (target.kind === 'bot' && (commandOverride ?? draft).startsWith('/')) {
      if (uploads.files.length) {
        setError('Send files separately from commands.');
        return;
      }
      setBusy(true);
      const commandFlight = Symbol('command');
      sendFlight.current = commandFlight;
      setError('');
      const command = commandOverride ?? draft;
      try {
        const output = await new ConversationDomain(client).command(target.sessionId, command);
        if (owns()) {
          setCommandResult({ sessionId: target.sessionId, command, output });
          followLatest.current = true;
          setShowLatest(false);
          if (edit === draftEdits.current) {
            setDraft('');
            drafts.current.delete(draftKey(target));
          }
        }
      } catch (cause) {
        if (owns()) fail(cause);
      } finally {
        if (sendFlight.current === commandFlight) sendFlight.current = null;
        if (owns()) setBusy(false);
      }
      return;
    }
    const flight = Symbol('send');
    sendFlight.current = flight;
    setBusy(true);
    setError('');
    const message = draft;
    const fileIds = uploads.files.flatMap((f) => (f.id ? [f.id] : []));
    followLatest.current = true;
    setShowLatest(false);
    const pendingId = `pending-${crypto.randomUUID()}`;
    const roomEventId = crypto.randomUUID();
    const pendingMessage: Message & { id: string; renderKey: string } = {
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
    setMessages(
      sendProjection.current.begin(
        pendingMessage,
        messages,
        running && target.kind === 'bot' ? stream : undefined,
      ),
    );
    setDraft('');
    drafts.current.delete(draftKey(target));
    if (target.kind === 'bot') {
      setRunning(true);
      setActivity('Working');
    }
    try {
      if (selection.kind === 'bot') {
        const [firstFile, ...restFiles] = fileIds;
        const result = await new ConversationDomain(client).send({
          sessionId: selection.sessionId,
          text: message,
          ...(firstFile
            ? { attachments: { ids: [firstFile, ...restFiles], requestId: crypto.randomUUID() } }
            : {}),
        });
        if (owns())
          setMessages(
            sendProjection.current.acknowledge(
              result.userRowId,
              pendingId,
              result.disposition === 'queued',
            ),
          );
        if (!result.accepted) throw new Error('Send outcome uncertain');
      } else {
        const receipt = await new ConversationDomain(client).sendRoom({
          roomId: text(selection.room.room_id),
          eventId: roomEventId,
          text: message,
        });
        if (owns()) setMessages(sendProjection.current.acknowledge(receipt, pendingId));
      }
      if (owns()) {
        uploads.sent(draftKey(target), fileIds);
        if (fileIds.length) setFilesVersion((v) => v + 1);
      }
    } catch (cause) {
      const unsent = safeError(cause).delivery === 'not-dispatched';
      if (owns()) {
        if (unsent) {
          setMessages(sendProjection.current.cancelUnsent(pendingId));
          setRunning(running);
        } else setBlocked(true);
        if (edit === draftEdits.current) {
          setDraft(message);
          drafts.current.set(draftKey(target), message);
        }
      }
      if (owns() && fileIds.length && !unsent) {
        attachmentDraft.current = { conversation: draftKey(target), edit };
        setAttachmentUncertain(true);
      }
      if (owns())
        setError(
          unsent
            ? 'Your message wasn’t sent. Try again.'
            : 'Your message may not have been sent. Reopen this chat to check.',
        );
    } finally {
      if (sendFlight.current === flight) sendFlight.current = null;
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
      await new ConversationDomain(client).stop(
        selection.kind === 'bot'
          ? { kind: 'chat', sessionId: selection.sessionId }
          : { kind: 'room', roomId: text(selection.room.room_id) },
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
  function settleApproval(approval: ConversationApproval, state: NativeApprovalReview['state']) {
    const scope =
      approval.target.kind === 'chat'
        ? approval.target.sessionId
        : 'room:' + approval.target.roomId;
    const rows = (approvalHistory.current.get(scope) ?? []).map((row) =>
      approvalKey(row.target) === approvalKey(approval.target) ? { ...row, state } : row,
    );
    approvalHistory.current.set(scope, rows);
    setApprovals(rows);
  }
  async function approve(approval: NativeApprovalReview, choice: 'once' | 'deny') {
    if (!client || !selection || blocked || approval.state !== 'pending') return;
    const requestKey = approvalKey(approval.target);
    if (approvalFlights.current.has(requestKey)) return;
    approvalFlights.current.add(requestKey);
    approvalRead.current++;
    setApprovalSubmitting((old) => ({ ...old, [requestKey]: true }));
    const connection = client,
      target = selection;
    try {
      const receipt = await new ConversationDomain(client).decide(approval.target, choice);
      if (current.current === connection && selected.current === target)
        settleApproval(
          approval,
          receipt === 'expired' ? 'inactive' : choice === 'once' ? 'approved' : 'denied',
        );
    } catch {
      if (current.current === connection && selected.current === target) {
        settleApproval(approval, 'uncertain');
        await refreshApprovals(connection, target).catch(() => undefined);
      }
    } finally {
      approvalFlights.current.delete(requestKey);
      setApprovalSubmitting((old) => {
        const next = { ...old };
        delete next[requestKey];
        return next;
      });
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
      if (typeof result.request_id === 'string')
        setReview((await new RequestDomain(client).get(result.request_id)) ?? undefined);
      management.refresh();
    } catch (e) {
      fail(e);
    }
  }
  async function decideReview(
    approve: boolean,
    confirmation?: string,
    context?: import('@hermes-client/protocol').ManagementReview,
  ) {
    if (!client || !review || typeof review.id !== 'string') return;
    setReviewBusy(true);
    try {
      const domain = new RequestDomain(client),
        request = await domain.get(review.id);
      if (!request) return;
      await management.decide(request, approve, confirmation, context);
      setReview((await domain.get(request.id)) ?? review);
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
  const capabilities = conversationCapabilities(client, selection?.kind ?? 'none');
  const voiceAction =
    !running &&
    !draft.trim() &&
    !uploads.files.length &&
    selection?.kind === 'bot' &&
    capabilities.voice;
  const detailsContent = client && (
    <Inspector
      bot={selection?.kind === 'bot' ? selection.bot : undefined}
      room={selection?.kind === 'room' ? selection.room : undefined}
      workspace={workspace}
      client={client}
      routines={routines}
      target={detailsTarget}
      sessionId={fileSession}
      filesVersion={filesVersion}
      pending={routinePending}
      onToggle={(r) => void toggleRoutine(r)}
      onClose={() => toggleDetails(false)}
      onEdit={() => {
        setAgentSettingsTab('identity');
        setEditProfile(selection?.kind === 'bot' ? selection.bot.profile : undefined);
        setSettingsTab('agents');
        setSettings(true);
      }}
    />
  );

  const title =
    selection?.kind === 'bot'
      ? (bots.find((b) => b.id === selection.bot.id && b.profile === selection.bot.profile)?.name ??
        selection.bot.name)
      : selection?.kind === 'room'
        ? text(
            rooms.find((room) => room.room_id === selection.room.room_id)?.name ??
              selection.room.name,
          )
        : 'Chats';
  usePageTitle(
    settings || pickingAgents || workDialog
      ? undefined
      : !client
        ? owner
          ? ''
          : 'Connect Hermes'
        : workspace && !workspace.initialized
          ? 'Set up Main Pebble'
          : orgOpen
            ? 'Org chart'
            : area === 'tasks'
              ? workBoard === '$plans'
                ? 'Plans'
                : (work.catalog?.boards.find((board) => board.slug === workBoard)?.name ?? 'Tasks')
              : title,
  );

  if (!client)
    return owner ? (
      <StartupScreen
        onSignOut={() => void owner.logout()}
        error={error}
        onRetry={retryConnection}
      />
    ) : (
      <FirstRun onConnect={connect} />
    );

  if (client.supportsWorkspace && workspace && !workspace.initialized)
    return (
      <main className="onboarding-shell">
        <header>
          {owner && (
            <Button
              variant="secondary"
              onClick={() => {
                disconnect();
                void owner.logout();
              }}
            >
              Sign out
            </Button>
          )}
        </header>
        <WorkspaceSetup
          client={client}
          onComplete={(state, profile, welcome) => {
            setWorkspace(state);
            setProactiveOpen(true);
            restoreProfile.current = profile;
            welcomeProfile.current = welcome ? profile : '';
            autoOpened.current = false;
            void loadRoster(client).catch(fail);
          }}
        />
      </main>
    );

  if (starting && client.supportsWorkspace)
    return (
      <StartupScreen
        onSignOut={owner ? () => void owner.logout() : undefined}
        error={error}
        onRetry={owner ? retryConnection : disconnect}
      />
    );

  const rail = (
    <Rail
      area={area}
      catalog={work.catalog}
      selectedBoard={workBoard}
      onArea={(area) =>
        navigate(() => {
          setArea(area);
          setOrgOpen(false);
          setSettings(false);
          setNav(false);
        })
      }
      onBoard={(board) =>
        navigate(() => {
          setWorkBoard(board);
          setArea('tasks');
          setOrgOpen(false);
          setSettings(false);
          setNav(false);
        })
      }
      onNewProject={() =>
        navigate(() => {
          setWorkDialog({ kind: 'new-project' });
          setNav(false);
        })
      }
      onNewTask={() =>
        navigate(() => {
          setWorkDialog({
            kind: 'new-task',
            board: workBoard === '$plans' ? 'default' : workBoard,
          });
          setNav(false);
        })
      }
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
      onCrew={(id) =>
        navigate(() => {
          setArea('chat');
          void openCrew(id);
        })
      }
      onSearch={() => setSearchOpen(true)}
      onClose={nav ? closeNav : undefined}
      onEdit={(profile) =>
        navigate(() => {
          setAgentSettingsTab('identity');
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
      online={connectionAvailable}
      pinOrder={pinOrder}
      onOpen={(bot) =>
        navigate(() => {
          setOrgOpen(false);
          setArea('chat');
          setSettings(false);
          if (bot.canonical) void open(bot);
          else setPickingAgents(true);
        })
      }
      onRoom={(room) =>
        navigate(() => {
          setOrgOpen(false);
          setArea('chat');
          setSettings(false);
          openRoom(room);
          void loadRoster(client, true).catch(fail);
        })
      }
      onAdd={() =>
        navigate(() => {
          setPickingAgents(true);
          setNav(false);
          setSettings(false);
        })
      }
      onOrgChart={() =>
        navigate(() => {
          setOrgOpen(true);
          setSettings(false);
          setNav(false);
          setPickingAgents(false);
        })
      }
      onSettings={() =>
        navigate(() => {
          setOrgOpen(false);
          setSettingsTab('general');
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
        management={management}
        onProactive={
          work.catalog?.capabilities.proactive ? () => setProactiveOpen(true) : undefined
        }
        onNavigate={navigate}
        key={`${settingsTab}:${editProfile ?? ''}`}
        onDirtyChange={onDirtyChange}
        closeOnSave={orgOpen}
        initialTab={settingsTab}
        initialAgentTab={agentSettingsTab}
        callActive={voiceActive}
        voiceRequest={agentSettingsTab === 'voice' ? voiceSettingsRequest : undefined}
        onVoiceReady={(profile) => {
          if (awaitingInput) return;
          if (selected.current?.kind !== 'bot' || selected.current.bot.profile !== profile) return;
          setSettings(false);
          requestAnimationFrame(() => voicePanel.current?.open());
        }}
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
  const transcript = sendProjection.current.display(messages, stream);
  const nativeCards: TranscriptCard[] = approvals.map((approval) => ({
    id: 'native-approval:' + approvalKey(approval.target),
    needsInput: approval.state === 'pending',
    content: (
      <Confirmation
        title="Approval needed"
        description={approval.description}
        compact
        value={
          approvalSubmitting[approvalKey(approval.target)]
            ? { kind: 'submitting', message: 'Sending decision' }
            : approval.state === 'pending'
              ? {
                  kind: 'pending',
                  disabled: blocked,
                  onDecision: (choice) => void approve(approval, choice),
                }
              : {
                  kind: approval.state === 'inactive' ? 'expired' : approval.state,
                  message:
                    approval.state === 'approved'
                      ? 'Tool action approved'
                      : approval.state === 'denied'
                        ? 'Tool action denied'
                        : approval.state === 'inactive'
                          ? 'Approval no longer pending in Hermes. Ask the pebble for a new request if needed.'
                          : 'Decision unconfirmed. Check with the pebble before requesting it again.',
                }
        }
      />
    ),
  }));
  const attentionItems = [...requestCards, ...questionCards, ...nativeCards, ...secretCards].filter(
    (card) => card.needsInput,
  );
  const awaitingInput = attentionItems.length > 0;
  const actionBlocked =
    blocked || !connectionAvailable || (selection?.kind === 'bot' && !chatBound) || awaitingInput;
  const hasMessage = !!draft.trim() || uploads.files.length > 0;
  return (
    <ConnectionRecovery.Provider value={recovery}>
      <DocumentActions.Provider
        value={(source) => {
          captureDetailsAnchor();
          documentReader.open(source);
        }}
      >
        <main
          data-live-updates={streamState}
          className={`pc-shell workspace ${settings && settingsTab !== 'agents' ? 'editing' : ''} ${(details || documentReader.state) && area === 'chat' && phone && !settings && !orgOpen ? 'phone-details' : ''}`}
        >
          {nav && (
            <Drawer title="navigation" onClose={closeNav}>
              {rail}
            </Drawer>
          )}
          {proactiveOpen && workspace && work.catalog?.capabilities.proactive && (
            <ProactiveSetup
              client={client}
              workspaceId={workspace.id}
              onClose={() => setProactiveOpen(false)}
            />
          )}
          <WorkspacePanels navigation={rail} phone={phone}>
            <Chat
              aria-busy={starting || switching}
              state={
                starting
                  ? 'loading'
                  : streamState === 'live'
                    ? switching
                      ? 'loading'
                      : selection
                        ? 'ready'
                        : 'empty'
                    : 'restoring'
              }
              reader={showLatest ? 'manual' : 'follow'}
              className="pc-main conversation overflow-clip"
              aria-label="Conversation"
              inert={
                !!(details || documentReader.state) &&
                area === 'chat' &&
                phone &&
                !settings &&
                !orgOpen
              }
            >
              {orgOpen && workspace && (
                <OrgChart
                  client={client}
                  state={workspace}
                  onEdit={(profile) =>
                    navigate(() => {
                      setAgentSettingsTab('identity');
                      setEditProfile(profile);
                      setSettingsTab('agents');
                      setSettings(true);
                    })
                  }
                  onClose={() => setOrgOpen(false)}
                  onNavigate={() => setNav(true)}
                />
              )}
              {area === 'tasks' &&
                !orgOpen &&
                !(settings && settingsTab !== 'agents') &&
                workspace &&
                (work.catalog ? (
                  workBoard === '$plans' && work.catalog.capabilities.plans ? (
                    <PlansArea
                      client={client}
                      workspace={workspace}
                      organization={organization}
                      connected={connectionAvailable}
                      onNavigate={() => setNav(true)}
                      onBoard={setWorkBoard}
                    />
                  ) : (
                    <WorkArea
                      key={work.catalog.workspaceId + '/' + workBoard}
                      client={client}
                      workspace={workspace}
                      catalog={work.catalog}
                      board={workBoard}
                      goal={
                        work.catalog.capabilities.plans ? (
                          <BoardOutcome
                            client={client}
                            workspace={workspace}
                            organization={organization}
                            connected={connectionAvailable}
                            board={workBoard}
                          />
                        ) : undefined
                      }
                      refresh={workRevision}
                      connected={connectionAvailable}
                      onReconnect={owner ? retryConnection : disconnect}
                      onNavigate={() => setNav(true)}
                      onTask={(id) => setWorkDialog({ kind: 'task', board: workBoard, id })}
                      onCreate={() => setWorkDialog({ kind: 'new-task', board: workBoard })}
                      onEditProject={() => setWorkDialog({ kind: 'project', board: workBoard })}
                    />
                  )
                ) : (
                  <section className="pc-work-area" aria-label="Tasks">
                    <WorkHeader title="Tasks" onNavigate={() => setNav(true)} />
                    <LoadingBar
                      active={work.state.kind === 'pending'}
                      label="Loading project boards"
                    />
                    {work.state.kind === 'failed' && (
                      <WorkReadError
                        error={work.state.error}
                        subject="project boards"
                        onRetry={work.reload}
                        onReconnect={owner ? retryConnection : disconnect}
                      />
                    )}
                  </section>
                ))}
              <div
                style={{
                  display:
                    orgOpen || (area === 'tasks' && !(settings && settingsTab !== 'agents'))
                      ? 'none'
                      : 'contents',
                }}
                inert={orgOpen || (area === 'tasks' && !settings)}
              >
                {settings && settingsTab !== 'agents' && workspace ? (
                  settingsContent
                ) : (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
                      <LoadingBar active={switching} label="Opening conversation" />
                    </div>
                    <header className="pc-chat-header chat-header">
                      <IconButton
                        quiet
                        className="md:hidden"
                        label="Toggle navigation"
                        icon={MenuIcon}
                        onClick={() => setNav(true)}
                      />
                      <ConversationIdentity
                        title={title}
                        description={
                          selection?.kind === 'bot'
                            ? workspace?.bots.find((b) => b.profile === selection.bot.profile)?.role
                                .title ||
                              `@${workspace?.bots.find((b) => b.profile === selection.bot.profile)?.handle ?? selection.bot.profile}`
                            : undefined
                        }
                        expanded={details}
                        disabled={!selection}
                        onClick={() => toggleDetails(!details)}
                        media={
                          selection?.kind === 'bot' ? (
                            <PebbleAvatar
                              bot={selection.bot}
                              workspace={workspace}
                              client={client}
                              state={agentStates[selection.bot.profile]}
                            />
                          ) : selection?.kind === 'room' ? (
                            <CrewAvatar
                              room={selection.room}
                              workspace={workspace}
                              client={client}
                            />
                          ) : undefined
                        }
                      />
                      <div className="header-actions">
                        {requestCount > 0 && (
                          <IconButton
                            quiet
                            className="request-indicator"
                            label={`${requestCount} ${requestCount === 1 ? 'request' : 'requests'} to review`}
                            icon={Inbox}
                            onClick={() => {
                              void Promise.resolve(management.requests)
                                .then((requests) => {
                                  const request = requests.find(
                                    (request) =>
                                      request.state === 'pending' &&
                                      bots.some((bot) => bot.profile === request.actor),
                                  );
                                  const bot = bots.find((bot) => bot.profile === request?.actor);
                                  if (request && bot) {
                                    setRequestFocus(request.id);
                                    setArea('chat');
                                    void open(bot);
                                  } else {
                                    setSettingsTab('requests');
                                    setSettings(true);
                                  }
                                })
                                .catch(fail);
                            }}
                          />
                        )}
                        {selection?.kind === 'bot' && (
                          <IconButton
                            quiet
                            label="Refresh"
                            icon={RefreshCw}
                            onClick={() => void refreshHistory(client, selection).catch(fail)}
                          />
                        )}
                      </div>
                    </header>
                    <div
                      ref={setVoiceBarTarget}
                      className="shrink-0"
                      data-slot="voice-call-position"
                    />
                    {error && (
                      <Alert variant="destructive" className="banner mx-4 mb-2 w-auto shrink-0">
                        <AlertDescription>
                          <p>{error}</p>
                          {attachmentUncertain && (
                            <span className="attachment-recovery">
                              <Button
                                variant="secondary"
                                onClick={() => void checkAttachmentSend()}
                              >
                                Check send outcome
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => void checkAttachmentSend(true)}
                              >
                                Discard pending files
                              </Button>
                            </span>
                          )}
                          {streamState === 'lost' && (
                            <Button variant="secondary" onClick={() => session.current?.retry()}>
                              {owner ? 'Try reconnecting now' : 'Disconnect and reconnect'}
                            </Button>
                          )}
                        </AlertDescription>
                        <AlertAction>
                          <IconButton
                            quiet
                            label="Dismiss error"
                            icon={X}
                            onClick={() => setError('')}
                          />
                        </AlertAction>
                      </Alert>
                    )}
                    <ChatViewport
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
                          ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(
                            event.key,
                          )
                        )
                          transcriptFollow.current?.cancel();
                      }}
                      onScroll={(event) => {
                        if (pickingAgents || orgOpen) return;
                        const pane = event.currentTarget;
                        if (transcriptFollow.current?.ownsScroll || scrollAnimating.current) return;
                        transcriptFollow.current?.cancel();
                        followLatest.current =
                          pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96;
                        setShowLatest(!followLatest.current);
                        rememberScroll();
                        acknowledgeRead();
                      }}
                    >
                      <Transcript
                        suppressedTools={agentExchanges.suppressedTools}
                        cards={[
                          ...agentExchanges.cards,
                          ...nativeCards.filter((card) => !card.needsInput),
                          ...questionCards.filter((card) => !card.needsInput),
                          ...secretCards.filter((card) => !card.needsInput),
                          ...requestCards.filter((card) => !card.needsInput),
                        ]}
                        footer={
                          <>
                            {commandResult &&
                              selection?.kind === 'bot' &&
                              commandResult.sessionId === selection.sessionId && (
                                <div
                                  role="region"
                                  aria-label={`${commandResult.command} result`}
                                  className="my-3 min-w-0 max-w-full"
                                >
                                  <Tool
                                    id="slash-command"
                                    icon={Terminal}
                                    name={commandResult.command}
                                    state="complete"
                                    output={commandResult.output}
                                    defaultOpen
                                  />
                                </div>
                              )}
                            {selection?.kind === 'bot' &&
                            (capabilities.voice || capabilities.secrets) ? (
                              <VoiceChat
                                key={selection.sessionId}
                                ref={voicePanel}
                                client={client}
                                sessionId={selection.sessionId}
                                running={running}
                                inputBlocked={awaitingInput}
                                onActiveChange={setVoiceActive}
                                barTarget={voiceBarTarget}
                                agentName={selection.bot.name}
                                avatar={
                                  <PebbleAvatar
                                    bot={selection.bot}
                                    workspace={workspace}
                                    client={client}
                                    state={agentStates[selection.bot.profile]}
                                  />
                                }
                                onOpenSettings={(request) =>
                                  navigate(() => {
                                    setVoiceSettingsRequest(request);
                                    setAgentSettingsTab('voice');
                                    setEditProfile(selection.bot.profile);
                                    setSettingsTab('agents');
                                    setSettings(true);
                                  })
                                }
                                onAccepted={(message) =>
                                  setMessages((previous) =>
                                    previous.some((item) => item.id === message.id)
                                      ? previous
                                      : [...previous, message],
                                  )
                                }
                              />
                            ) : undefined}
                          </>
                        }
                        ownerColor={
                          selection?.kind === 'bot'
                            ? workspace?.bots.find((b) => b.profile === selection.bot.profile)
                                ?.appearance.color
                            : undefined
                        }
                        client={client}
                        sessionId={selection?.kind === 'bot' ? selection.sessionId : undefined}
                        conversationKey={selection ? draftKey(selection) : ''}
                        onReact={
                          capabilities.reactions && connectionAvailable ? reactToMessage : undefined
                        }
                        messages={withSharedFiles(transcript.messages, sharedFiles)}
                        liveIds={transcript.liveIds}
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
                        authorAvatar={(name) => {
                          const bot = workspace?.bots.find(
                            (b) =>
                              b.profile === name ||
                              b.handle === name.replace('@', '') ||
                              (name === 'hermes' && b.profile === 'default'),
                          );
                          return (
                            bot && (
                              <PebbleAvatar
                                bot={bot}
                                workspace={workspace}
                                client={client}
                                mainBadge={false}
                              />
                            )
                          );
                        }}
                      >
                        {!selection && !switching && (
                          <div className="welcome">
                            <h2>
                              {streamState !== 'live' ? 'Connecting…' : 'Choose a conversation'}
                            </h2>
                            {streamState === 'live' && !bots.length && (
                              <Button variant="secondary" onClick={() => setPickingAgents(true)}>
                                Add existing agents
                              </Button>
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
                            <Button
                              variant="secondary"
                              onClick={() => void navigator.clipboard.writeText(removedDraft)}
                            >
                              Copy draft
                            </Button>
                            <Button variant="secondary" onClick={() => setRemovedDraft('')}>
                              Dismiss
                            </Button>
                          </section>
                        )}
                      </Transcript>
                      {agentExchanges.viewer}
                    </ChatViewport>
                    {!pickingAgents && (
                      <div className="relative shrink-0">
                        {showLatest && (
                          <Button
                            variant="secondary"
                            className="jump-latest"
                            onClick={jumpToLatest}
                          >
                            ↓ Latest messages
                          </Button>
                        )}
                        {awaitingInput && (
                          <div className="pc-composer-wrap composer-wrap">
                            <ConversationAttention
                              key={selection ? draftKey(selection) : ''}
                              navigation={attentionNavigation}
                              items={attentionItems}
                              focusId={requestFocus}
                            />
                          </div>
                        )}
                        <div
                          hidden={awaitingInput}
                          inert={awaitingInput}
                          style={awaitingInput ? { display: 'none' } : undefined}
                          className="pc-composer-wrap composer-wrap"
                          onDragOver={(e) => {
                            if (selection?.kind === 'bot' && client.supportsAttachments)
                              e.preventDefault();
                          }}
                          onDrop={(e) => {
                            if (
                              !actionBlocked &&
                              selection?.kind === 'bot' &&
                              client.supportsAttachments
                            ) {
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
                            <ul className="attachment-chips pc-composer-width">
                              {uploads.files.map((file) => (
                                <Attachment
                                  asChild
                                  key={file.key}
                                  size="sm"
                                  className="flex-nowrap"
                                  state={file.status === 'ready' ? 'done' : file.status}
                                >
                                  <li data-status={file.status}>
                                    <AttachmentMedia>
                                      <Icon name="file" />
                                    </AttachmentMedia>
                                    <AttachmentContent>
                                      <AttachmentTitle>{file.name}</AttachmentTitle>
                                      <AttachmentDescription>
                                        {file.status === 'error' ? file.error : fileSize(file.size)}
                                      </AttachmentDescription>
                                    </AttachmentContent>
                                    {file.status === 'uploading' && (
                                      <span className="sr-only" role="status">
                                        Uploading {file.name}
                                      </span>
                                    )}
                                    <AttachmentActions>
                                      {file.status === 'error' && (
                                        <AttachmentAction
                                          variant="quiet"
                                          aria-label={`Retry ${file.name}`}
                                          onClick={() => uploads.retry(file)}
                                        >
                                          <Icon name="refresh" />
                                        </AttachmentAction>
                                      )}
                                      <AttachmentAction
                                        variant="quiet"
                                        aria-label={`Remove ${file.name}`}
                                        disabled={busy}
                                        onClick={() => uploads.remove(file)}
                                      >
                                        <Icon name="close" />
                                      </AttachmentAction>
                                    </AttachmentActions>
                                  </li>
                                </Attachment>
                              ))}
                            </ul>
                          )}

                          {selection?.kind === 'bot' && (
                            <CommandSuggestions
                              ref={commandSuggestions}
                              client={client}
                              enabled={!actionBlocked && !busy}
                              sessionId={selection.sessionId}
                              text={draft}
                              onChoose={(text, execute) => {
                                draftEdits.current++;
                                setDraft(text);
                                drafts.current.set(draftKey(selection), text);
                                composer.current?.focus();
                                if (execute) void send(text);
                              }}
                            />
                          )}
                          <MentionSuggestions
                            suggestions={mentionSuggestions}
                            className="pc-composer-width mb-2"
                          />
                          <PromptInputFrame
                            className="pc-composer pc-composer-row pc-composer-width"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void send();
                            }}
                            onClick={(e) => {
                              if (e.target === e.currentTarget) composer.current?.focus();
                            }}
                          >
                            {capabilities.attachments && selection?.kind === 'bot' && (
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
                                  disabled={busy || actionBlocked || uploads.files.length >= 5}
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
                            <PromptInputField
                              sizing="fixed"
                              ref={composer}
                              rows={1}
                              aria-label="Message"
                              placeholder={selection ? `Message ${title}` : 'Choose a conversation'}
                              value={draft}
                              {...mentionSuggestions.inputProps}
                              disabled={!selection}
                              readOnly={switching}
                              maxLength={16000}
                              onPaste={(e) => {
                                if (
                                  !blocked &&
                                  !busy &&
                                  client.supportsAttachments &&
                                  selection?.kind === 'bot' &&
                                  e.clipboardData.files.length
                                ) {
                                  e.preventDefault();
                                  uploads.add([...e.clipboardData.files]);
                                }
                              }}
                              onChange={(e) => {
                                draftEdits.current++;
                                setDraft(e.target.value);
                                setMentionCaret(e.target.selectionStart);
                                if (selected.current)
                                  drafts.current.set(draftKey(selected.current), e.target.value);
                              }}
                              onSelect={(e) => setMentionCaret(e.currentTarget.selectionStart)}
                              onKeyDown={(e) => {
                                if (!e.nativeEvent.isComposing && mentionSuggestions.key(e.key)) {
                                  e.preventDefault();
                                  return;
                                }
                                if (
                                  !e.nativeEvent.isComposing &&
                                  commandSuggestions.current?.key(e.key)
                                ) {
                                  e.preventDefault();
                                  return;
                                }
                                if (
                                  e.key === 'Enter' &&
                                  !e.shiftKey &&
                                  !e.nativeEvent.isComposing
                                ) {
                                  e.preventDefault();
                                  void send();
                                }
                              }}
                            />
                            <ComposerAction
                              mode={
                                running && !hasMessage
                                  ? stopping
                                    ? 'stopping'
                                    : 'stop'
                                  : voiceAction
                                    ? 'voice'
                                    : 'send'
                              }
                              disabled={
                                running && !hasMessage
                                  ? stopping || actionBlocked
                                  : !selection ||
                                    (!voiceAction && !draft.trim() && !uploads.files.length) ||
                                    !uploads.ready ||
                                    busy ||
                                    actionBlocked
                              }
                              onStop={() => void stop()}
                              onVoice={() => voicePanel.current?.open()}
                              separateStop={running && hasMessage}
                              stopDisabled={stopping || actionBlocked}
                              stopping={stopping}
                            />
                          </PromptInputFrame>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Chat>
            <DetailsDock
              open={
                !orgOpen &&
                area === 'chat' &&
                !!(documentReader.state || details) &&
                (!settings || settingsTab === 'agents')
              }
              document={!!documentReader.state}
              onFrame={restoreDetailsAnchor}
            >
              <div
                id="pebble-details"
                className="pc-details details-panel"
                style={documentReader.state ? { display: 'none' } : undefined}
                inert={!!documentReader.state}
              >
                {detailsContent}
              </div>
              {documentReader.state && (
                <DocumentReader
                  state={documentReader.state}
                  onClose={documentReader.close}
                  onRetry={documentReader.open}
                />
              )}
            </DetailsDock>
          </WorkspacePanels>
          {workDialog && work.catalog && workspace && (
            <Drawer
              title={
                workDialog.kind === 'task' || workDialog.kind === 'new-task'
                  ? 'Task'
                  : 'Project board'
              }
              variant="dialog"
              sizing="content"
              restoreFocus={() =>
                document.querySelector<HTMLElement>(
                  workDialog.kind === 'task'
                    ? `[data-task-id="${CSS.escape(workDialog.id)}"] button`
                    : '.pc-work-header [data-create-task]',
                ) ?? document.querySelector<HTMLElement>('.pc-rail-header [aria-label="New"]')
              }
              onBeforeClose={() => {
                if (!dirtyEditor.current) return true;
                pendingNavigation.current = () => setWorkDialog(undefined);
                setConfirmNavigation(true);
                return false;
              }}
              onClose={() => setWorkDialog(undefined)}
            >
              <WorkDialog
                key={
                  workDialog.kind +
                  ('board' in workDialog ? workDialog.board : '') +
                  ('id' in workDialog ? workDialog.id : '')
                }
                target={workDialog}
                visibleBoard={area === 'tasks' ? workBoard : undefined}
                client={client}
                workspace={workspace}
                catalog={work.catalog}
                onDirtyChange={onDirtyChange}
                onNavigate={navigate}
                onClose={() => setWorkDialog(undefined)}
                onSaved={() => {
                  work.reload();
                  setWorkRevision((n) => n + 1);
                }}
                onOpenBoard={(board) => {
                  setWorkBoard(board);
                  setArea('tasks');
                  setOrgOpen(false);
                  setSettings(false);
                  setWorkDialog(undefined);
                  setNav(false);
                }}
              />
            </Drawer>
          )}
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
                  connected={connectionAvailable}
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
                  setOrgOpen(false);
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
                setOrgOpen(false);
                setSettings(false);
                openRoom(room);
              })
            }
          />
          {confirmCrew && (
            <Drawer
              title="Updated crew"
              variant="dialog"
              sizing="content"
              onClose={() => setConfirmCrew(undefined)}
            >
              <h2>Start a chat with this crew?</h2>
              <p>Membership changed. Your previous chat will stay in Group chats.</p>
              <div className="form-actions">
                <Button variant="secondary" onClick={() => setConfirmCrew(undefined)}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={() => void openCrew(confirmCrew, true)}>
                  Start new chat
                </Button>
              </div>
            </Drawer>
          )}
          <DiscardChanges
            open={confirmNavigation}
            onOpenChange={setConfirmNavigation}
            onDiscard={() => {
              dirtyEditor.current = false;
              setConfirmNavigation(false);
              pendingNavigation.current?.();
              pendingNavigation.current = undefined;
            }}
          />
          {review && (
            <Drawer title="Review deletion" onClose={closeReview}>
              <RequestReview
                client={client}
                draft={management.reviewDraftFor(review)}
                onDraft={(value) => management.setReviewDraft(review, value)}
                request={review}
                busy={reviewBusy}
                onDecision={(a, c, context) => void decideReview(a, c, context)}
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
      </DocumentActions.Provider>
    </ConnectionRecovery.Provider>
  );
}
