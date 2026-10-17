import type { BrowserContext, Page } from '@playwright/test';
import type { OrganizationState } from '../../apps/web/src/ui/organization';
import type { WorkspaceSnapshot as WorkspaceState } from '@hermes-client/protocol';
export const names = [
  'Arlo',
  'Mica',
  'Rowan',
  'Sage',
  'Ember',
  'Cleo',
  'Lumen',
  'Indigo',
  'Fern',
  'Quinn',
  'Sol',
  'Wren',
];
export function fixtureState(): WorkspaceState {
  return {
    id: 'synthetic-owner',
    revision: 1,
    initialized: true,
    orchestrator: 'arlo',
    teams: [
      { id: 'operations', name: 'Operations' },
      { id: 'research', name: 'Research' },
    ],
    bots: names.map((name, i) => ({
      id: `identity-${i}`,
      profile: name.toLowerCase(),
      name,
      handle: name.toLowerCase(),
      description: '',
      managed: true,
      enrolled: true,
      canonical: true,
      manager: i ? 'arlo' : null,
      team: i > 5 ? 'research' : i > 1 ? 'operations' : null,
      appearance: {
        kind: 'shape',
        shape: (['pebble', 'beacon', 'petal', 'kite', 'arch'] as const)[i % 5]!,
        color: ['white', 'sky', 'iris', 'rose', 'clay', 'lagoon', 'citron'][i % 7]!,
      },
      role: {
        title: ['Team lead', 'Executive assistant', 'Operations', 'Researcher'][i % 4]!,
        description: '',
        responsibilities: '',
        boundaries: '',
        expectedOutputs: '',
      },
      pinned: i < 2,
      pin_configured: true,
      preview: [
        'The research brief is ready for your review.',
        'I found three useful sources.',
        'The weekly report is ready.',
      ][i % 3]!,
      cursor: 28,
      read_key: `read-${i}`,
      unread: i === 4,
    })),
  };
}
export const history = Array.from({ length: 28 }, (_, i) => ({
  row_id: i + 1,
  role: i % 4 === 3 ? 'user' : 'assistant',
  timestamp: 1700000000 + i * 600,
  text:
    i % 4 === 3
      ? 'Please prepare a short overview.'
      : i === 26
        ? '## Research update\n\nThe draft is ready. Here are the next steps:\n\n- Review the sources\n- Pick the priorities\n- Share your notes\n\n```js\nconst ready = true;\n```'
        : 'Here is the latest update on the project. The source material is organized and ready to review. We can work through the remaining decisions together.',
}));
export async function installFixture(
  context: BrowserContext,
  options: {
    reactions?: boolean;
    messages?: (Record<string, unknown> & { row_id: number })[];
  } = {},
) {
  const messages = options.messages ?? history;
  await context.route(new RegExp('^http://127\\.0\\.0\\.1:(8093|8095|8097)/$'), async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:;",
      },
    });
  });
  let state = fixtureState();
  state.bots.push({
    ...structuredClone(state.bots[1]!),
    id: 'existing-id',
    profile: 'existing-example',
    appearance: { kind: 'shape', shape: 'pebble', color: 'iris' },
    name: 'Existing Example',
    handle: 'existing-example',
    managed: false,
    enrolled: false,
    canonical: false,
    pinned: false,
    pin_configured: true,
    description: 'Existing personality',
    role: { title: '', description: '', responsibilities: '', boundaries: '', expectedOutputs: '' },
  });
  let organization: OrganizationState = {
    revision: 0,
    sections: [
      {
        id: 'pebbles',
        name: 'Pebbles',
        collapsed: false,
        items: state.bots.map((b) => ({ kind: 'pebble', id: b.id })),
      },
      { id: 'crews', name: 'Crews', collapsed: false, items: [] },
    ],
    crews: [],
  };
  let prefs = { revision: 0, pin_order: ['identity-0', 'identity-1'] };
  let requests: Record<string, unknown>[] = [];
  let loseCreationReply = false;
  let routines = [
    {
      job_id: 'routine-1',
      name: 'Weekly research brief',
      schedule: 'Every Monday at 9:00 AM',
      enabled: true,
    },
  ];
  let leaseCounter = 0;
  let uploadCounter = 0;
  const uploaded = new Map<
    string,
    {
      id: string;
      name: string;
      size: number;
      kind: string;
      state: string;
      data: string;
      session: string;
    }
  >();
  const photos = new Map<string, string>();
  const reactions = new Map<number, { emoji: string; author: string }[]>();
  const leases = new Map<string, Set<string>>();
  const read = new Map<string, number>();
  let approvals: Record<string, unknown>[] = [];
  await context.addInitScript(() => {
    const original = window.fetch;
    const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
    Object.assign(window, {
      __chatEvent: (event: unknown) => {
        for (const stream of streams)
          stream.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n\n'));
      },
      __breakStream: () => {
        for (const stream of streams) stream.close();
        streams.clear();
      },
    });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v1/events')) {
        let controller: ReadableStreamDefaultController<Uint8Array>;
        let timer: ReturnType<typeof setInterval>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            streams.add(c);
            c.enqueue(new TextEncoder().encode('{"type":"bridge.ready"}\n\n'));
            timer = setInterval(
              () => c.enqueue(new TextEncoder().encode('{"type":"bridge.heartbeat"}\n\n')),
              1000,
            );
          },
          cancel() {
            clearInterval(timer);
            streams.delete(controller);
          },
        });
        init?.signal?.addEventListener('abort', () => {
          clearInterval(timer);
          streams.delete(controller);
          try {
            controller.close();
          } catch {
            /* already ended */
          }
        });
        return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return original(input, init);
    };
  });
  const crewRooms: Record<string, unknown>[] = [];
  const crewChats: Record<string, string> = {};
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const value =
      path === '/api/instance/status'
        ? { setupRequired: false }
        : path === '/api/hermes/ticket'
          ? { ticket: 'f'.repeat(43), bridgeUrl: 'https://hermes.fixture.invalid' }
          : { user: { id: 'owner' } };
    await route.fulfill({ json: value });
  });
  await context.route('https://hermes.fixture.invalid/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/connect') {
      const connection = String(++leaseCounter).padStart(43, 'c');
      leases.set(connection, new Set());
      await route.fulfill({
        json: {
          protocol: 'hermes-bot-web.v1',
          connection,
          capabilities: {
            workspace: true,
            existing_agents: true,
            attachments: true,
            reactions: options.reactions !== false,
          },
        },
      });
      return;
    }
    if (path === '/v1/renew') {
      await route.fulfill({ json: { renewed: true } });
      return;
    }
    const { operation, params } = route.request().postDataJSON();
    const lease = leases.get(route.request().headers()['x-bot-connection'] ?? '');
    if (
      (operation.startsWith('chat.') || operation.startsWith('files.')) &&
      !lease?.has(params.session_id)
    ) {
      await route.fulfill({ status: 400, json: { code: 'INVALID_PARAMETERS' } });
      return;
    }
    if (operation === 'bot.open') lease?.add(`session-${params.profile}`);
    let result: unknown = {};
    if (operation === 'workspace.snapshot') {
      const liveIds = state.bots.filter((b) => b.managed).map((b) => b.id),
        assigned = new Set(
          organization.sections
            .flatMap((s) => s.items.filter((i) => i.kind === 'pebble').map((i) => i.id))
            .concat(organization.crews.flatMap((c) => c.members)),
        );
      organization.sections = organization.sections.map((s) => ({
        ...s,
        items: s.items.filter((i) => i.kind === 'crew' || liveIds.includes(i.id)),
      }));
      organization.sections[0]!.items.push(
        ...liveIds.filter((id) => !assigned.has(id)).map((id) => ({ kind: 'pebble' as const, id })),
      );
      result = {
        workspace: state,
        bots: state.bots.filter((b) => b.managed && !b.hidden),
        rooms: [
          ...crewRooms,
          {
            room_id: 'crew-1',
            name: 'Research crew',
            members: state.bots
              .slice(0, 4)
              .map((b) => ({ profile: b.profile, member_id: b.profile })),
            created_at: 1700000000,
            cursor: 2,
            read_key: 'crew-read',
          },
        ],
        preferences: prefs,
        organization,
        crew_chats: crewChats,
      };
    }
    if (operation === 'organization.get') result = organization;
    if (operation === 'organization.save') {
      organization = { ...params.organization, revision: organization.revision + 1 };
      result = organization;
    }
    if (operation === 'organization.chat') {
      const crew = organization.crews.find((c) => c.id === params.id);
      if (!crew || params.expected_revision !== organization.revision || crew.members.length < 2) {
        await route.fulfill({ status: 400, json: { code: 'STALE_REVISION' } });
        return;
      }
      let room = crewRooms.find((r) => r.room_id === crewChats[crew.id]);
      if (!room) {
        room = {
          room_id: 'native-' + crew.id,
          name: crew.name,
          created_at: 1700000010,
          members: crew.members.map((id) => {
            const b = state.bots.find((b) => b.id === id)!;
            return { profile: b.profile, member_id: b.profile };
          }),
        };
        crewRooms.push(room);
        crewChats[crew.id] = String(room.room_id);
      }
      result = { state: 'ready', room };
    }
    if (operation === 'search.query') {
      const kind = params.query.toLowerCase().includes('weekly') ? 'routine' : 'message';
      result = {
        hits: [
          {
            id: 'hit-arlo',
            kind,
            title: kind === 'routine' ? 'Weekly research brief' : 'Arlo · message',
            snippet: 'Saved synthetic search result',
            profile: 'arlo',
            item_id: kind === 'routine' ? 'routine-1' : '91',
            bot_id: state.bots[0]!.id,
          },
        ],
        coverage: 'Synthetic native search fixture',
      };
    }
    if (operation === 'search.context')
      result = {
        title: params.kind === 'routine' ? 'Weekly research brief' : 'Arlo · message',
        text:
          params.kind === 'routine'
            ? 'Every Monday at 9:00 AM'
            : 'Synthetic older sequoia message, outside the loaded history.',
      };
    if (operation === 'connections.list' || operation === 'services.catalog')
      result = { servers: [] };
    if (operation === 'models.describe')
      result = {
        supported: true,
        fingerprint: 'synthetic-model-grant',
        provider: 'Local fixture',
        model: 'fixture-model',
        source: 'default',
        auth_kind: 'api_key',
      };
    if (operation === 'agent.capabilities')
      result = {
        skills: [{ name: 'example-skill', enabled: true }],
        toolsets: [
          { name: 'workspace', label: 'Workspace', enabled: true },
          { name: 'browser', label: 'Browser', enabled: false },
        ],
      };
    if (operation === 'agent.attach') result = { state: 'completed', runtime: 'refresh_required' };
    if (operation === 'agents.list')
      result = {
        agents: [...state.bots],
      };
    if (operation === 'agent.enable') {
      if (!state.bots.some((b) => b.profile === params.profile)) {
        const template = state.bots[1]!;
        state.bots.push({
          ...structuredClone(template),
          id: 'existing-id',
          profile: params.profile,
          name: 'Existing example',
          handle: params.profile,
          pinned: false,
          manager: 'arlo',
          team: null,
        });
        state.revision++;
      }
      result = { managed: true, canonical: true };
    }
    if (operation === 'bots.appearance.get') result = { data: photos.get(params.profile) ?? null };
    if (operation === 'bots.profile.update' || operation === 'agent.onboard') {
      if (params.photo) photos.set(params.profile, params.photo);
      const bot = state.bots.find((b) => b.profile === params.profile && b.id === params.id);
      if (!bot || params.expected_revision !== state.revision) {
        await route.fulfill({ status: 400, json: { code: 'STALE_REVISION' } });
        return;
      }
      Object.assign(
        bot,
        {
          name: params.name,
          handle: params.handle,
          appearance: params.appearance,
          role: { ...bot.role, ...params.role },
          ...('manager' in params ? { manager: params.manager } : {}),
        },
        operation === 'agent.onboard'
          ? { managed: true, enrolled: true, canonical: true, hidden: false }
          : {},
      );
      state.revision++;
      result = { state: 'completed', profile: params.profile };
    }
    if (operation === 'agent.welcome') result = { state: 'accepted', submitted: true };
    if (operation === 'bots.update_handle') {
      state.bots.find((b) => b.profile === params.profile)!.handle = params.handle;
      state.revision++;
    }
    if (operation === 'roles.update') {
      Object.assign(
        state.bots.find((b) => b.profile === params.profile)!,
        { role: params.role, manager: params.manager, team: params.team },
      );
      state.revision++;
      result = {
        revision: state.revision,
        bots: Object.fromEntries(state.bots.map((bot) => [bot.profile, bot])),
      };
    }
    if (operation === 'bots.appearance.update') {
      state.bots.find((b) => b.profile === params.profile)!.appearance = params.appearance;
      state.revision++;
    }
    if (operation === 'crews.save') {
      state.teams = state.teams.filter((t) => t.id !== params.id);
      if (!params.remove) state.teams.push({ id: params.id, name: params.name });
      state.bots.forEach((b) => {
        if (params.members.includes(b.profile) && !params.remove) b.team = params.id;
        else if (b.team === params.id) b.team = null;
      });
      state.revision++;
      result = { state: 'completed' };
    }
    if (operation === 'files.upload') {
      const id = String(++uploadCounter).padStart(43, 'f');
      const file = {
        id,
        name: params.name,
        size: Buffer.from(params.data, 'base64').length,
        kind: 'file',
        state: 'staged',
        data: params.data,
        session: params.session_id,
      };
      uploaded.set(id, file);
      result = file;
    }
    if (operation === 'files.list')
      result = {
        files: [...uploaded.values()].filter(
          (f) => f.session === params.session_id && f.state === 'sent',
        ),
      };
    if (operation === 'files.remove') {
      uploaded.delete(params.id);
      result = { removed: true };
    }
    if (operation === 'files.reconcile') result = { state: 'clear' };
    if (operation === 'files.read') {
      const file = uploaded.get(params.id)!;
      await route.fulfill({
        body: Buffer.from(file.data, 'base64'),
        headers: { 'content-type': 'application/octet-stream' },
      });
      return;
    }
    if (operation === 'chat.send') {
      for (const id of params.attachments ?? []) {
        const file = uploaded.get(id)!;
        file.state = 'sent';
      }
      result = { state: 'accepted' };
    }
    if (operation === 'workspace.describe') result = state;
    if (operation === 'requests.list') result = { requests };
    if (operation === 'presentation.read') {
      read.set(params.key, Math.max(read.get(params.key) ?? 0, params.cursor));
      const bot = state.bots.find((b) => b.read_key === params.key);
      if (bot) bot.unread = false;
    }
    if (operation === 'bot.open')
      result = {
        session_id: `session-${params.profile}`,
        messages: messages.map((m) => ({
          ...m,
          display_metadata: { reactions: reactions.get(m.row_id) ?? [] },
        })),
        running: false,
      };
    if (operation === 'chat.history')
      result = {
        messages: messages.map((m) => ({
          ...m,
          display_metadata: { reactions: reactions.get(m.row_id) ?? [] },
        })),
      };
    if (operation === 'chat.react') {
      const previous = reactions.get(params.row_id) ?? [];
      const next = previous.filter((r) => r.author !== 'user');
      if (params.emoji && previous.find((r) => r.author === 'user')?.emoji !== params.emoji)
        next.push({ emoji: params.emoji, author: 'user' });
      reactions.set(params.row_id, next);
      result = { row_id: params.row_id, reactions: next };
    }
    if (operation === 'chat.approvals') result = { approvals };
    if (operation === 'chat.approve')
      approvals = approvals.filter((a) => a.request_id !== params.request_id);
    if (operation === 'routines.list') result = { jobs: routines };
    if (operation === 'routines.set_enabled') {
      routines = routines.map((r) => ({ ...r, enabled: params.enabled }));
      result = { success: true };
    }
    if (operation === 'agent.pin')
      state.bots.find((b) => b.id === params.id)!.pinned = params.pinned;
    if (operation === 'agent.hide')
      state.bots.find((b) => b.id === params.id)!.hidden = params.hidden;
    if (operation === 'presentation.order')
      prefs = { revision: prefs.revision + 1, pin_order: params.ids };
    if (operation === 'room.log')
      result = {
        events:
          params.since_seq === 0
            ? [
                {
                  seq: 1,
                  event_id: 'room-m1',
                  kind: 'message.member',
                  actor: { id: 'arlo', profile: 'arlo' },
                  created_at: 1700000000,
                  payload: { text: 'I can coordinate this discussion.' },
                },
                {
                  seq: 2,
                  event_id: 'room-m2',
                  kind: 'message.member',
                  actor: { id: 'mica', profile: 'mica' },
                  created_at: 1700000100,
                  payload: { text: 'I have the notes ready.' },
                },
              ]
            : [],
        cursor: 2,
        has_more: false,
      };
    if (operation === 'room.state')
      result = { driver_status: { working: false, pending_actions: [] } };
    if (operation === 'agent.propose') {
      requests = [
        {
          id: 'delete-request',
          action: params.action,
          spec: params.spec,
          fingerprint: 'exact-spec',
          actor: 'owner',
          state: 'pending',
        },
      ];
      result = { request_id: 'delete-request', state: 'pending' };
    }
    if (operation === 'requests.approve') {
      const request = requests[0]!;
      const spec = request.spec as { id: string };
      if (request.action === 'agent.create') {
        const value = request.spec as Record<string, unknown>;
        state.bots.push({
          ...structuredClone(state.bots[1]!),
          id: 'created-' + String(value.name),
          profile: String(value.name),
          handle: String(value.name),
          name: String(value.display_name),
          pinned: false,
          team: null,
          role: {
            title: '',
            description: String(value.role),
            responsibilities: '',
            boundaries: '',
            expectedOutputs: '',
          },
        });
        state.revision++;
      } else state.bots = state.bots.filter((b) => b.id !== spec.id);
      request.state = 'completed';
      result = {
        state: 'completed',
        ...(request.action === 'agent.create'
          ? {
              result: {
                profile: (request.spec as Record<string, unknown>).name,
                id: 'created-' + String((request.spec as Record<string, unknown>).name),
                created: true,
              },
            }
          : {}),
      };
      Object.assign(request, result);
      if (loseCreationReply && request.action === 'agent.create') {
        loseCreationReply = false;
        await route.abort('failed');
        return;
      }
    }
    if (operation === 'requests.deny') requests[0]!.state = 'denied';
    await route.fulfill({ json: { result } });
  });
  return {
    loseNextCreationReply() {
      loseCreationReply = true;
    },
    setApprovals(value: Record<string, unknown>[]) {
      approvals = value;
    },
    get state() {
      return state;
    },
    set state(value: WorkspaceState) {
      state = value;
    },
    hide(profile: string) {
      state.bots.find((b) => b.profile === profile)!.hidden = true;
    },
    replace(profile: string) {
      const old = state.bots.find((b) => b.profile === profile)!;
      state.bots = state.bots.map((b) =>
        b === old
          ? {
              ...old,
              id: old.id + '-new',
              handle: profile + '-new',
              read_key: old.read_key + '-new',
            }
          : b,
      );
    },
    remove(profile: string) {
      state.bots = state.bots.filter((b) => b.profile !== profile);
    },
  };
}
export async function emit(
  page: Page,
  type: string,
  payload: Record<string, unknown> = {},
  profile = 'arlo',
) {
  await page.evaluate(
    ({ type, payload, profile }) =>
      (window as unknown as { __chatEvent: (e: unknown) => void }).__chatEvent({
        type,
        payload,
        session_id: `session-${profile}`,
      }),
    { type, payload, profile },
  );
}
