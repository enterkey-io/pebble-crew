# Candidate: extend the owner-local work domain

## Problem

Pebble Crew already has the right native work/catalog authority and retry ledger. The missing layer is durable intent above boards, a current coordination projection across all conversation paths, and optional scheduled work whose creation cannot duplicate after a crash. Keep goals in the owner plugin alongside its existing work receipts; native Hermes continues to own projects, boards, tasks, cron execution and Bot Chat. Do not split these additions into a new planning service or rewrite existing Crew management.

Grounded against `work.py`/`work_store.py`, `runtime.py`, `exchanges.py`, `live_voice.py`, `connections_native.py`, and `apps/web/src/work/WorkArea.tsx` in the active worktree. In particular, `WorkService.invoke` currently resolves native catalog identity before dispatch; `runtime.compact_context` can remove every Crew; exchange context independently truncates purpose; voice builds its own native instructions; worker guidance currently contains only reporting instructions. These are concrete integration seams.

## Usage (caller's view)

Owner: open Tasks, choose Plans above the board list, create “Launch the customer portal”, describe its outcome, optionally assign a responsible Pebble and parent goal, then link the actual project boards and contributing Crews. Board settings acquire an Outcome field distinct from native project Instructions. Saving a goal does not enqueue tasks. Click a linked board to inspect its real native task history. Main can maintain the same records in ordinary owner chat using `workspace_work`; teammates read them without gaining Main permissions.

After initial setup, or from an explicit “Set up proactive help” settings entry, the owner asks for suggestions. Fresh discovered and allowed capabilities produce a short deterministic list. The owner selects concrete routines and reviews editable time/day and prompt, plus the displayed Hermes timezone and destination. A final “Enable selected routines” creates native jobs; no job runs during this flow. The completion view links back to Main chat for future routine changes. No routine editor or New routine item is added to Tasks/global +.

```ts
// Plans uses the same domain/transport and recovery idioms as native work.
const plans = await new WorkDomain(client).plans({ workspaceId });
const receipt = await domain.saveGoal({
  workspaceId,
  operationId,
  expectedRevision: plans.revision,
  goal: {
    id: null,
    title,
    outcome,
    body,
    status: 'active',
    ownerId,
    parentId: null,
    boardRefs: selectedBoards,
    crewIds: selectedCrews,
  },
});
// Reconnect resumes a receipt check with the same ID/spec; never generates a new ID.
await domain.receipt({ workspaceId, operationId });

const suggestions = await domain.proactiveSuggestions({ workspaceId });
await domain.enableRoutine({
  workspaceId,
  operationId,
  proposalId: selected.id,
  evidence: suggestions.evidence,
  prompt: editedPrompt,
  schedule: { cron: '0 8 * * 1-5', expectedHermesTimezone },
  expectedMainId: suggestions.main.id,
});
```

```python
# Each surface resolves identity/scope through its current native verifier first.
projection = coordination_context(store, VerifiedScope.direct(profile, session_id))
# A room is selected by verified native room mapping, never by a model argument.
projection = coordination_context(store, VerifiedScope.room(profile, native_room))
# Private policy is still owned by Exchanges; its verified scope drives relevance.
projection = coordination_context(store, VerifiedScope.exchange(profile, exchange_id))
```

## Shape

### Records and persistence

Add a small Plans section to `WorkStore`'s existing SQLite database. Use additive `CREATE TABLE IF NOT EXISTS` migration, no migration writes to native project descriptions, personas or owner credentials:

```text
plans_meta(workspace PRIMARY KEY, revision INTEGER NOT NULL)
goals(workspace, id UUID, title, outcome, body, status,
      owner_id NULL, parent_id NULL, updated_at, PRIMARY KEY(workspace,id))
goal_boards(workspace, goal_id, catalog_identity, project_id, board_slug,
            PRIMARY KEY(workspace,goal_id,catalog_identity,project_id,board_slug))
goal_crews(workspace, goal_id, crew_id, PRIMARY KEY(workspace,goal_id,crew_id))
board_outcomes(workspace, catalog_identity, project_id, board_slug, outcome,
               crew_ids_json, PRIMARY KEY(workspace,catalog_identity,project_id,board_slug))
```

Goal status is `active | paused | completed | archived`; archive preserves history and child references. Owner is a nullable stable Pebble ID, not a profile name. Crew contribution is not the goal owner or reporting line. A board reference includes catalog identity plus project ID and slug; never relink silently by display name/slug alone. Resolve board links against the current native catalog on reads and return `available | missing | conflicting` so a deleted or externally remapped board remains visible for repair. Deleted owners/Crews render unavailable references; save validates newly chosen references and does not transfer ownership by profile name. Keep maximum title/outcome/body sizes explicit at the boundary (e.g. 120/2000/12000); outcomes, not all body text, are injected into per-turn context.

One Plans revision covers the small shared graph, including links and board outcomes. Validate expected revision, acyclic parents, workspace ownership and currently enrolled stable IDs under existing WorkStore lock, then commit state and completed receipt in one SQLite transaction. An operation UUID is reserved with its canonical full payload and actor. Same UUID+payload returns its receipt; same UUID+different payload fails. No goal mutation calls native dispatcher. Native task completion never automatically marks a goal complete.

### Public contract and module map

Extend the existing WorkDomain and `bot_web.work` operation family, rather than adding a second browser transport:

```ts
type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
type BoardRef = { catalogIdentity: string; projectId: string; slug: string };
type PlansSnapshot = {
  workspaceId: string;
  revision: string;
  goals: Goal[];
  boardOutcomes: BoardOutcome[];
};
// Domain decodes all wire responses; React never imports storage/wire schemas.
class WorkDomain {
  plans(input: { workspaceId: string }): Promise<PlansSnapshot>;
  saveGoal(input: GoalSave): Promise<WorkReceipt>;
  saveBoardOutcome(input: BoardOutcomeSave): Promise<WorkReceipt>;
  proactiveSuggestions(input: { workspaceId: string }): Promise<RoutineSuggestions>;
  enableRoutine(input: RoutineSelection): Promise<WorkReceipt>;
}
```

- `work_store.py` owns SQL and atomic Plans writes; existing `intents` owns operation receipts.
- `work.py` owns dispatch, current actor checks and native board resolution. Add `work.plans`, `work.goal.save`, `work.board.outcome.save`, `work.proactive.suggestions`, `work.proactive.enable`. Keep full mutation validation in one internal Plans operation handler if `work.py` would become unwieldy; callers must not compose validate/write/link themselves.
- `coordination.py` owns the complete authoritative coordination projection and budget/relevance rules. It reads existing organization/work owners; it does not write or maintain a cache.
- `proactive.py` owns capability matching and native-cron creation/reconciliation, including the operation state machine. Native cron calls remain internal, not surfaced as caller-controlled stages.
- Existing hermes-client WorkDomain gains decoding/types; `PlansArea.tsx` and `GoalEditor.tsx` use current work reads/recovery/dialog primitives. A small `ProactiveSetup.tsx` is reused by first-run completion and settings.

Before native catalog resolution, classify Plans read-only/local operations in `WorkService.invoke`. Plans can still display saved records and unavailable board links if the native catalog profile is missing; native board-affecting saves require a valid catalog. Do not let a new goal read fail just because an unrelated board is unavailable. Preserve the existing stable catalog owner across Main transfers.

Owner RPC is authorized by the existing owner transport. A model mutation requires a currently verified ordinary owner conversation and actor ID equal to current Main under the workspace state check. The existing work tool excludes worker/private sessions; retain that exclusion for mutations. Other enrolled agents can read Plans context. Main status grants no proactive opt-in: only the reviewed owner RPC selects these onboarding suggestions. Existing ordinary cron chat behavior remains unchanged. No switches or new owner-approval queue are needed for Main goal maintenance; unsolicited changes follow current ask-first guidance.

### One context projection

```python
@dataclass(frozen=True)
class VerifiedScope:
    # Construct only through adapters using existing verified native sources.
    profile: str
    kind: Literal['direct', 'room', 'exchange', 'voice', 'worker']
    crew_id: str | None
    board_ref: BoardRef | None
    task_id: str | None

def coordination_context(store, scope: VerifiedScope, *, budget: int) -> str:
    """Current identities, relevant whole Crew purposes, goals and board outcome.
    Read-only; never grants management, changes SOUL, or selects ambient board.
    """
    raise NotImplementedError
```

Budget the final hook output, not just an intermediate dictionary: reserve space for surface security/delivery guidance and native feature guidance, then serialize coordination into the remaining <=10000-character hook envelope. Mandatory order: identity/Main/immediate manager and surface authority; current verified Crew including its **full** <=2000-character purpose and manager; worker's verified board outcome and linked active goals; relevant owned/contributed goals; optional Crew summaries/directory/activity. Remove optional directory entries before relevant context. Include IDs and an explicit omitted-count/read-details cue when optional records exceed the remaining budget. Do not truncate a purpose mid-string or silently drop the current room's Crew. If multiple relevant Crews cannot fit, include whole purposes as budget permits plus exact omitted IDs; direct sessions have no invented current Crew. Bound verbose goal bodies to explicit reads, not silent arbitrary cuts.

Reuse projection in `runtime.live_context` and remove its independent Crew truncation; runtime resolves native room **before** composing context. Replace duplicate exchange Crew/hierarchy construction while retaining exchange-specific no-owner-authority and delivery policy. Add verified profile/scope to voice `create_session` from its existing owner-authenticated call path and append current projection only for actual calls, not preview. Voice delegates remain independently verified at execution; stale voice context never authorizes writes. Extend worker hook using verified native task/profile/board metadata, not env strings alone or the ambient default board; inability to resolve scope yields a concise unavailable notice while keeping worker reporting instructions. All surfaces share projection behavior but keep their surface security rules.

### Native proactive setup and interruption semantics

Suggestions are pure templates matched to fresh native `mcp.servers.test` discovered names/schemas intersected with saved enabled tools in the **current Main profile**. Configured server names, credentials, and connection presence are insufficient. Use a short initial template catalog, e.g. daily agenda from actual calendar read capability and inbox digest from actual mail read capability. Unknown connectors produce no guessed recommendation. Read-only templates summarize to the existing Bot Chat; no template sends mail, changes calendar, or grants tools. Return the exact prompt, required tool IDs, schedule, timezone, destination and capability fingerprint. The server re-discovers/revalidates at save; fingerprints bind schema and saved permissions, not volatile test timestamps.

The common native cron API uses the profile-configured IANA timezone and has no per-job timezone parameter. Display the fresh Hermes timezone, allow time/day edits, and bind expectedHermesTimezone to the reviewed selection. Reject a changed profile timezone at save; never change global timezone or invent per-job support. Validate prompt/schedule and current Main stable ID/incarnation at save. Use one operation UUID per selected routine so partial batch completion is explicit. Batch UI invokes a complete one-routine operation repeatedly; it never coordinates native creation stages.

```text
reserved -> submitting -> completed
                       -> uncertain -> completed (reconciliation only)
reserved -> rejected (definite validation failure, no native call)
```

Under the existing process-shared lock, persist `submitting` BEFORE crossing into native create. Bind intended Main stable identity/incarnation, canonical schedule/prompt/delivery and deterministic marker `pebble-proactive:<workspace>:<operationUUID>` in the intent. Include marker in a native persisted origin field if supported, otherwise a stable machine-readable prompt suffix; do not assume unsupported native metadata. Call `cron.jobs.create_job` once in the verified Main profile. `deliver=bot-chat` has the documented native full inbound-turn semantics; UI calls it “Post to Main’s chat” and acceptance verifies actual delivery. Never call run-now or provider/model validation.

After create, read the exact returned ID and verify every material field before completed. On retry of submitting/uncertain, list native jobs including disabled and match the marker: exactly one matching full spec permits readback/completion; changed, duplicate or missing matches stay uncertain. **Never recreate automatically after an uncertain native call, even if list presently finds nothing.** The narrow crash window before actual native call costs a manual recovery, accepted to prevent duplicates. Completed receipt may show the current native job disabled/missing without recreating it. Main transfer never creates another copy or transfers an existing job automatically; receipt records its original verified owner. A pre-creation identity change rejects. Out-of-band changes after creation are shown honestly, not overwritten.

## Synthesis decision

Candidate proposes the existing WorkStore/WorkDomain as the base; parent arena fills the final selection. Preserve this small shape unless another candidate demonstrates a concrete invariant it cannot enforce.

## Tradeoffs accepted

- We accept one Plans graph revision and occasional edit conflicts in exchange for an atomic, easily understood owner/Main write boundary. Browser drafts survive stale responses and reconnect.
- We accept owner-plugin metadata alongside native Hermes work in exchange for native-compatible goals today, with no fragile encoding in native descriptions.
- We accept manual resolution of truly uncertain cron creation in exchange for an enforceable no-duplicate guarantee without upstream idempotency support.
- We accept a small capability-template catalog in exchange for recommendations whose tools are actually available and whose permission requirements are testable.

## Alternatives considered

**Separate `plans.sqlite` + `PlansService` + Plans RPC.** It can hide graph persistence well, but board linkage and routine receipts would require callers to coordinate two catalogs, two revisions and two recovery domains. This exposes native identity and retry policy through a larger public interface. Existing work.sqlite already owns the exact stable catalog mapping and receipts; a separate store adds no owner/security boundary.

**Encode goals as native projects/tasks or project-description JSON.** This hides persistence behind Hermes but exposes parsing/versioning, graph identity and “is this a strategic goal or an executable task?” to every native/web/model caller. It pollutes project instructions or task queues and makes external native edits destructive to metadata. Native projects have no goal fields, so a sidecar is the smaller honest interface.

Screened against red flags: one transport and write owner; no hand-synced context policy per surface; no public load/validate/save dance; no copied native task store; no global context cache; no ad hoc new locks beyond the already shared mutable ledger.

## Implementation reconciliation

Implementation uses the accepted bounded JSON graph described in the synthesis below; all state remains owner-local. Parent should update this artifact's accepted contracts if native API inspection changes marker placement/timezone support; those must be resolved before exposing the review UI.

## Open questions and risks

- Does each pinned native cron build persist origin as expected and expose the configured IANA timezone consistently? Resolve by source and synthetic API tests; use that profile timezone only.
- Can the worker hook resolve a complete current workspace/catalog identity on both supported native builds? A synthetic worker test must prove this before claiming context coverage.
- Can optional-context packing leave all mandatory surface guidance and a maximum-length current Crew purpose intact under the final native hook cap? Measure the actual returned string with maximum-size fixtures.

## Next implementation step

Implement additive Plans tables and atomic goal/board-outcome operations with identity, cycle, CAS and receipt tests, then wire the common projection before building the Plans and proactive setup screens.

## Verification contract

Python tests: empty migration; repeated initialization; owner/Main edit race; identical/different UUID payload; cyclic parents; stale/deleted owner; Main transfer preserves catalog and goals; linked native board deletion/remap; no native dispatch for goal writes. Context tests cover direct/room/private/voice/worker, long directory and full 2000-character current Crew purpose, relevant goals/outcome, omitted IDs, no authority escalation. Cron tests inject crashes before/after create, readback timeout, disabled discovered job, marker duplicates/mismatch, Main change, capability revocation, schedule/timezone drift; assert native create count <=1 per operation and zero model/run calls during setup/install/update.

Run `npm run check`, production browser Plans create/edit/archive/link navigation, board outcome persistence, reconnect/unsaved conflict, proactive no-capability/selection/revalidation/partial completion/uncertain recovery on desktop/iPhone/Android. Inspect settled screenshots with existing shadcn neutral theme. Native acceptance in isolated homes against both pinned Hermes builds: read goal/Crew context in real owner and worker sessions; actual task result appears in existing Bot Chat; create and read back one local-model cron job, then separately trigger its scheduled acceptance execution and verify the actual Bot Chat result. Keep scheduled execution entirely out of install/update smoke tests. No owner personas, real credentials or installed owner home are modified.

## Accepted synthesis, 23 October 2026

Use the Astra candidate as the base. Independent cross-review scored it 23/25
and the Sol alternative 21/25. Retain Sol's focused coordination/context modules
and reusable setup panel. Root implements the changes inline.

The bounded Plans graph uses one JSON aggregate in a new table in work.sqlite,
with one revision, rather than seven link tables. At most 100 Plans are allowed;
all callers read the graph together. This keeps graph/link writes and their
receipts atomic without unused indexes or joins. Board references still contain
catalog identity, native project identity and slug. Native tasks are never copied.
Proactive receipts reuse the existing intents table and process-shared lock.

A board's Outcome is edited through a focused shared editor, separate from its
native description save, avoiding a misleading atomic save across two stores.
The same owner-local Plans domain supplies that editor and Main's work tool.

Grounding and design artifacts are retained locally under
/private/tmp/pebble-cgp-design. Public feature behavior does not depend on them.

## Completed implementation and evidence

The common coordination projection now feeds ordinary Bot Chat, Crew rooms,
private peer exchanges, actual voice calls and native dispatched workers. Full
own-Crew purpose/manager is retained; member and contributor lists are bounded,
scoped project goals are prioritized, and omitted detail has an authenticated
read-only tool path. Crew managers sort first and have a subtle flag indicator;
Crew membership never changes reporting lines.

Plans sit above project boards in Tasks. Shared shadcn fields and EditorSurface
provide retained drafts, reviewed conflicts, fixed headers/footers and receipt
recovery. A focused Project goal editor writes only owner-local metadata.

Optional first-use/General setup discovers actual enabled and permitted native
MCP read capabilities and presents unchecked routine suggestions. It initializes
Hermes's optional SDK before entering its profile-secret scope. No SDK is
installed by this flow. Revalidation binds the current Main incarnation, native
schemas/permissions and timezone. Unknown native creation is never replayed, even
with a different UUID or Main transfer. Completed native creates verify their
exact returned job ID; interrupted calls reconcile a unique marker/spec only.
Outstanding receipts remain visible after reload. Existing routines stay native.

Synthetic native acceptance passed on revisions 29112bef and af0cd4df with their
matching isolated environments. It discovers deferred work tools, creates native
projects/tasks and local Plans, dispatches a real worker carrying current goals,
and verifies actual result delivery into the existing Bot Chat. Separate cron
execution verifies an opt-in brief reaches that chat. Discovery/setup invokes no
model or external tool; deliberate execution uses only the localhost model.
No owner installation, credential, persona or service is used for these checks.

Related reports PC-134/135/136 add stable focus restoration, authenticated upload
presentation (without changing model input/history), and a shared bounded Crew
portrait with up to five actual faces and one animated foreground avatar.
