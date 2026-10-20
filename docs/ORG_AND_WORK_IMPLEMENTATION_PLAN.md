# Organization and work implementation plan

Planning record, 2026-10-19. The owner authorized phase-one implementation in chat; phase one is implemented and locally verified. Later phases and deployment remain separate. Source inspected at Pebble Crew commit `f6aead9a506794dc1f0d1afcd5f51dd2f457599b`, with the existing unrelated working changes present. Those changes were not altered. Native source evidence is distinguished below from installed-owner capability.

## Recommended product scope

1. **Organization and operational reporting first.** Show each agent beneath its configured manager, with an editable card. Main Pebble is the special root. Other agents without a manager appear under **Unattached**, including whole branches beneath an unattached manager. Give agents current manager, direct reports and instructions through the existing native hook and discoverable workspace tool. No drag-and-drop requirement.
2. **Projects and tasks second.** A substantive project gets one dedicated native Kanban board. Standalone/small unfiled work uses the native default board, labeled **General tasks**. Initially do not group multiple projects on one board.
3. **Simple routines next.** Create and change routines through chat. The agent clarifies the steps and schedule, saves a native cron job and confirms its actual next run. The existing per-agent Routines view shows schedules, history and pause/resume controls; an org card links to that same view. There is no separate routine-builder form or routines board. The first scope is native cron doing the work directly.
4. **Durable delegation and recurring project tasks after proof.** Use native Kanban workers, claims, dependencies, review, events and scheduler integration. Do not add a second execution engine.

All authority and background work remain on the owner's Hermes host. Native records are preferred; the existing `HERMES_HOME`-local plugin store holds only integration metadata, policy, bindings and receipts. Web/macOS/iOS/Windows clients display, edit and cache that state. No required external service or vendor control plane is introduced.

## What exists and what must change

| Area                   | Verified present implementation                                                                                                         | Required work / limit                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization authority | `plugins/bot-web/workspace.py:27-59`: owner-root `bot-web/workspace.sqlite`, stable workspace identity and optimistic revision updates  | Version the forest contract, validate identity lifecycle and make migration/rollback explicit                                                |
| Reporting graph        | `workspace.py:205-218` requires one enrolled Main Pebble and every enrolled path to reach it                                            | Allow null managers and unattached branches; retain cycle and invalid-target rejection                                                       |
| Default relationships  | `workspace.py:158,367-372,386,410-411` assigns the root during discovery/initialize/enable or requires a manager at creation            | Remove implicit assignments in every entry path; a newly enabled agent stays unattached unless the owner selected a manager                  |
| Live context           | `identity.py:6-41`, `runtime.py:15-50,87-101,177`: session-bound caller lookup, hierarchy and role context before model calls           | Explicit direct reports, valid partial paths, unattached/invalid distinction and fresh policy; prove each background session kind            |
| Agent management       | `runtime.py:54-84,173-180` and `skills/manage-team/SKILL.md`: discover/describe and owner-reviewed proposals                            | Expose narrow reporting/instructions edits, retain exact actor/target/revision checks; implement the owner-approved scoped management policy |
| Existing profile UI    | `apps/web/src/ui/pebble-profile-fields.tsx:124-196`, `PebbleEditor.tsx`, `NewPebble.tsx`, `ExistingPebbleSetup.tsx`                     | Reuse `PebbleProfileFields`, `ReportingField`, `RoleDetails`; remove select fallback to root; add explicit No manager choice                 |
| Editing/recovery       | `packages/hermes-client/src/workspace-domain.ts` already accepts nullable manager and owns decoded edits/receipts                       | Extend the existing draft/conflict architecture to graph, work and routine editors; do not bypass it from components                         |
| Routines               | `operations.py:210-227`, `apps/web/src/chat/Inspector.tsx`: profile-scoped native list and pause/resume                                 | Validated preview/create/edit, save receipts, schedule preview and occurrence history; no create UI currently                                |
| Native projects/boards | Prior isolated proof created a folderless native Project, linked board and inherited triage task; retry produced one task and a comment | Does not prove cross-profile RPC, runtime identity, dispatch, notification or installed-owner support                                        |
| Compatibility          | `plugins/bot-web/compatibility.py`, `.github/workflows/check.yml:68,120` pin two enterkey-io Hermes builds                              | Add feature-level evidence for projects/boards/cron; current general compatibility fingerprint is not permission to assume new APIs work     |

This plan supersedes the **every chain reaches orchestrator / reject independent roots** rule in `docs/TEAMS_AND_ORCHESTRATOR_PLAN.md:49`, its universal reporting-path language, and equivalent automatic-manager/root-path instructions in `docs/ONBOARDING_AND_CONNECTIONS_PLAN.md`. It also supersedes any fallback suggestion to build a separate durable task coordinator. Update those documents together with implementation; do not silently apply the old rules to this plan. Other identity, privacy and native-persona rules remain applicable.

## Terminology and native ownership

| User term      | Meaning and native mapping                                                          | Agent guidance                                                                                           |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Organization   | Reporting forest of enrolled Pebbles; Main Pebble is a distinguished root           | Read current graph; names, titles and prior messages cannot establish management authority               |
| Project        | Named substantial outcome, represented by a native Project plus its dedicated board | Create/select the project before project work; never dump unrelated projects onto General tasks          |
| Board          | Native execution queue with its own board scope, database/workspaces and tasks      | Carry explicit board scope on every operation; do not change the global current-board pointer            |
| Task           | One actionable native Kanban work item, assignee, state, acceptance and result      | Claim/run/review using native semantics; queued is not complete                                          |
| Checklist      | Steps inside one task's description initially                                       | Do not convert checkboxes to dependency edges or claim native structured checklist support without proof |
| Routine        | Native cron definition owned by an agent                                            | Distinguish definition, scheduled occurrence, execution and delivered result                             |
| Crew / section | Group conversation / navigation organization                                        | Neither implies reporting, project membership, reviewer or dependencies                                  |

For humans, **each project gets its own board**. The project describes the purpose and instructions; its board organizes that project's tasks. A project is not a subsection of a shared board. Creating a project creates and links its board automatically. The separate **General tasks** board holds work without a project. Keep both native identifiers explicit in tools: native Project and Board are separate linked records even though the app presents one project destination.

### Navigation and global creation

Use **Chat | Tasks** as the main area switch beneath the sidebar's app name. Chat shows pebbles, crews and sections; Tasks shows General tasks and individual projects. Open **Org chart** from the avatar menu as a dedicated page. Switching areas preserves the conversation draft, reading position and selected project.

The **+** menu is global, with the same creation options in every area: New pebble, New crew, New project board, New task and New section. Context may prefill a visible, editable agent or project, but must not hide creation options. Creation does not force navigation away from the current work; the result can offer Open. There is no New routine action in this menu; owners create routines by chatting with an agent.

Routine schedules, history and pause/resume controls are accessed through the agent's Routines view and org card. Creation and edits happen in chat. There is no routine list, schedule editor or routine-management control in Tasks or project-board views. A routine-created task appears there as a task; the recurring definition, instructions and schedule remain with the agent.

Pinned source `hermes_cli/projects_db.py:23-48,158-175,220-257,273-295` stores Projects per active profile, with optional folders, primary path and `board_slug`. A folder or repository is not required. `board_slug` has no database uniqueness constraint. `hermes_cli/kanban_db_boards.py:72-115` stores board `project_id`, but explicitly does not validate it at that low level. The dashboard resolves it through the active Project database (`plugins/kanban/dashboard/plugin_api.py:1347-1360,1441-1452`). `tui_gateway/methods_projects.py:27-44` is explicitly profile-scoped. Therefore a bijection and cross-profile scope cannot be assumed from those fields.

**Recommended scope:** bind a workspace's project catalog to one explicit, stable owner profile identity, initially Main Pebble's profile. Store that binding separately from the mutable Main Pebble selection; root transfer must not move or lose projects. Block deletion of that catalog profile while it owns live project bindings; an owner-directed native-supported migration with verified references is required first. An externally missing catalog profile yields an unavailable catalog and repair action, never a new empty replacement. Represent references as `(installation_id, catalog_profile_identity, native_project_id)` and `(installation_id, board_slug)`, never bare project IDs. Prove explicit catalog-profile resolution while a different profile creates/executes a task. If the native adapter cannot do that on a supported version, gate Projects there pending a narrow adapter/upstream fix. Do not duplicate Projects in every profile or create a replacement project database.

Native board APIs remain the mutation boundary: use an existing authenticated native RPC where suitable or a narrow owner-local adapter calling the same validated native service functions. Do not expose an unauthenticated dashboard or directly write its SQLite tables.

## Phase one: useful organization and operational reporting

### Forest semantics and migration

Use a nullable manager reference with stable bot identity and native incarnation validation. The existing profile-string wire field can remain for compatibility if the server resolves it to the exact current identity; new mutation requests should include target identity and expected manager identity so a deleted/recreated profile name cannot inherit an old reporting edge.

- Main Pebble remains singular and managerless, with “Reports to you.” It is never tagged Unattached.
- Any other enrolled agent may have no manager. Its subtree is valid and appears under Unattached; its descendants still have real managers and valid partial paths.
- Reject self-reporting, cycles anywhere in the forest, foreign/missing/deleted/replaced identities, unavailable or unenrolled manager selections. Detect invalid imported edges without inventing replacements.
- Hiding affects the chat sidebar only, not organization membership, identity or permission. The chart still shows the actual named enrolled agent card and all reporting links; an optional muted “Hidden from chats” status explains its sidebar visibility. Otherwise-valid hidden agents remain selectable as managers. Do not substitute an anonymous placeholder, silently detach them or maintain a second inconsistent organizational roster.
- Existing delete protection against managers with direct reports (`presentation.py:156-157`) stays. To delete, explicitly detach/reassign reports first. External deletion produces a repair-needed edge, not an automatic root assignment. Unavailable is distinct from deleted; retain identity evidence for recovery.
- Initialization, discover/sync, onboard, enable, create and root transfer must obey the same validator. Root transfer changes only explicitly previewed edges; no automatic adoption of unrelated branches.

Migration is transactional in the plugin store, versioned and idempotent. Back up the private store locally before a one-time migration. Preserve existing valid relationships, including historical root links: current data cannot reliably distinguish an intentionally chosen root from an old automatic default. Show existing links for owner review; never mass-detach on a guess. New enrollment defaults to null. Do not alter SOUL, memory, skills or provider configuration. If graph repair is needed, show the invalid edge and refuse dependent mutations until explicitly repaired; still allow the owner to read the rest of the graph.

Add an old-client compatibility gate: an older editor must not silently collapse null to Main Pebble. Reject incompatible graph writes with an actionable refresh/update response. Downgrade to a tree-only package must refuse incompatible forest state or restore the pre-migration snapshot explicitly; it must not discard post-migration edits. Multi-store role mirrors need persisted pending/applied/reconcile receipts because native metadata writes plus plugin revision updates are not one database transaction.

### Minimum operational contract

Extend `hierarchy_context` and `workspace_agents describe` with:

- verified caller identity and `workspace_revision`;
- `main_pebble`, `your_manager`, `direct_reports` (immediate only), own effective optional instructions;
- `reporting_state: main | attached | unattached | invalid` and a valid partial `reporting_path`, with explicit termination reason;
- permitted management actions and current policy revision.

The server derives these from current authoritative state. The pre-model hook refreshes them per turn; agent tools refresh before mutations. An unattached agent knows its direct reports and own instructions, and knows no immediate manager is configured. Main Pebble is discoverable as workspace coordinator without being fabricated into that agent's reporting path. Unknown native session identity yields no privileged context or mutation permission; never fall back to a process-wide profile, current CLI profile or chat title.

Phase one's operating behavior is modest but real: agents discover and explain their actual relationships, use current instructions, and Main Pebble can prepare or apply an authorized reporting/instructions change. Example: “Main Pebble, make sure Agent2 knows what you expect when they do a task” resolves Agent2 from the current directory, reads current instructions, proposes a concise change to the single Instructions field, records the exact diff and confirms its receipt. Agent2's next turn reads the saved revision. Do not wake Agent2 just to install metadata or pretend a live turn was retroactively updated. This phase does not promise durable task scheduling, autonomous follow-up, completion guarantees or recursive delegation.

### Main Pebble management

The current Main Pebble can manage reporting lines and agent Instructions. This is
always available to that verified identity; there is no owner-facing enable switch.
The Main Pebble asks before changes it proposes independently. A clear owner
request already authorizes its requested change and must not trigger another
permission question. This conversational rule is supplied in current per-turn
context and the management skill. It is not an extra approval token or UI gate.

The server still validates actor and target identities, reporting cycles and
workspace/context revisions at execution. A Main Pebble transfer fences queued
changes from its predecessor. Other agents propose changes for owner review.
Identity deletion, tools, secrets, model access and Main Pebble transfer retain
separate protections. Future routine-management permissions are outside this
reporting implementation.

Changes retain pending/applied/conflict/uncertain receipts. Read an applied receipt
before claiming a change succeeded. Older persisted `management_enabled` metadata
is normalized to true for rollback compatibility and is never an authorization
condition in the current implementation.

### UI and phase-one exit gate

Use actual production React routes and the current shadcn/Radix primitives, theme, avatars and AI Elements chat infrastructure. Only enrolled Pebbles appear in the reporting chart; discovering a Hermes profile does not enroll it. Existing `organization.get/save` and organization reducers concern sidebar sections/crews, so add an explicitly named reporting graph projection/domain rather than overloading those APIs. Render a connected organization chart with fixed-size shared cards and explicit parent-to-report SVG connectors. Pan/zoom, Fit chart and Center Main Pebble controls support desktop and phones. The initial phone view keeps the Main Pebble readable; fitting the entire forest is an explicit action. Keyboard focus brings offscreen cards into view at a readable scale. Selection/focus remains neutral and avatar colors keep their existing renderer. Opening a card reuses the existing editor, reporting selector and single optional Instructions field. Preserve legacy instruction fields unless explicitly editing them; retain the existing conversion helpers rather than inventing multiple job-description inputs.

Exit only when forest tests, all Add/Edit paths, two-client conflicts and production desktop/iPhone/Android screenshots pass. Native synthetic turns must prove current context and an instruction update with deferred discovery enabled, catalog listings disabled and a saved tool selection on both supported builds. Preserve existing personas and exact native identity. This is **medium** work: the rendering is small, but changing reporting semantics and migration touches many boundaries.

## Phase two: native projects and tasks

Depends on phase-one identity contract. First perform a non-model capability spike in isolated homes on both pinned builds. Extend the existing native proof to RPC/service boundaries, not just database helpers.

1. Add typed project/board/task reference decoders and owner-local operations for list/get/create/update/comment. Reuse `WorkspaceDomain` patterns for drafts and conflict handling. Store only bindings, intent IDs and reconciliation receipts in the plugin store; native task status, comments, claims and runs remain authoritative.
2. Make **New project board** an idempotent workflow: reserve operation ID and catalog scope; create native Project without requiring folders; create a unique dedicated board linked to it; set/read back the native Project's `board_slug`; publish success only after both directions agree. Persist partial steps for safe retry/reconciliation. Do not delete a partly created board if an external actor already added tasks.
3. Enforce one active project per board and one board per project for Pebble-created projects under an owner-local uniqueness lock/binding constraint. Native external writes can bypass this integration rule: detect ambiguous/mismatched links and ask for repair, not silently reinterpret or merge. Imported boards/projects stay readable with explicit mapping status. No automatic split of existing mixed boards.
4. Task creation always carries explicit board/project scope. Dedicated-board tasks inherit its project; reject conflicting overrides. General tasks rejects a substantive project assignment and directs the user/agent to create/select a dedicated project. Use deterministic native idempotency keys for retries. Never trust ambient current-board selection.
5. Start new work in native triage/non-executing state. Show acceptance instructions, assignee, native status and result. No worker turn on save, install, status or capability checks. Execution controls arrive only when dispatch proof in phase four passes.
6. Use task descriptions for checklists. Native parent links are prerequisites: all required parents must complete before a child becomes ready. They are not project membership, “epic contains subtask,” or reporting hierarchy. Do not create a support task gated behind the blocked task it must unblock. Cross-board dependencies are not supported by this first scope; represent references only.

Discoverable agent guidance must expose project lookup/create/select and explicit board references before task creation. A policy hook at the actual enabled native create-tool boundary should reject a project/board mismatch where integration policy applies; prove the hook can resolve the worker's pinned board without broadening its scope. Tool descriptions and the operating skill repeat the one-project rule. Guidance alone cannot prevent a user with unrestricted shell/DB access from bypassing policy; do not claim otherwise.

Exit: create two unrelated projects and verify separate boards/workspaces, folderless operation, explicit cross-profile scope, deduplicated retries and recovery after each partial creation step. A second client or native CLI change must become visible without losing an unsaved draft. Complexity **medium to high**, dominated by profile/board scoping and partial native writes.

## Phase three: simple native routines

Can follow phase one independently of phase two if limited to direct cron work. Keep **Routines** as a per-agent inspector tab; the org card links there. It shows existing schedules, next runs and history, with pause/resume controls. Create and edit actions lead to the relevant agent chat while preserving unsent drafts. Do not build a separate routine form, a Tasks destination for routine definitions or a Kanban-style routines board.

Conversational flow: the owner describes the recurring work to an agent. Ask only for missing steps, timing or destination; resolve the effective timezone explicitly when ambiguous. Validate the schedule against native Hermes and provide a concise summary with the next run. The owner's request or Main Pebble's saved management scope authorizes the appropriate operation; when an exact approval is still required, use the existing inline confirmation component in chat rather than a separate builder. Confirm creation only from the native receipt. Saving paused is available when requested, not a mandatory extra step. Editing preserves the routine's native identity and unknown native options unless explicitly changed.

Proposed adapter contract: `routines.preview`, `routines.create`, `routines.update`, `routines.get_runs`, existing list/set_enabled, plus actually discoverable agent tools using the same validated service. Preview is pure validation and schedule calculation, never an execution. After authorization, either create enabled atomically through a proven native path or stage paused and enable within the same receipt/reconciliation workflow. Staging must not require another owner interaction. Read back native state before confirming success, retain partial/uncertain outcomes for reconciliation and do not duplicate jobs on retry. A requested paused save stays paused. Routine instructions are bounded data, not an arbitrary script-execution API. Main Pebble may create, enable, edit and pause routines within its saved `routines.manage` scope without another approval for each change. Immediate Run now stays separate. Other agents' tools must respect their actual native/profile authorization; model prose cannot claim the Main Pebble grant.

Pinned cron source has native paused creation (`cron/jobs.py:create_job`, around line 1813), profile-scoped concurrency registration (`cron/scheduler.py`, around lines 560-640,818-847), configured-zone schedule computation (`jobs.py:1178-1238`), and missed-run classification (`jobs.py:940-964`). These are source findings, not tested guarantees for the owner's installed scheduler. Capability proof must establish selected profile scope, reliable creation receipts and either safe atomic enabled creation or paused staging followed by enable under the same authorization. The optional Save paused path must prove native paused creation. If the required safe creation path is unavailable, creation stays unavailable on that build until a narrow native adapter exists.

Required scheduler proof before enabling the feature:

- Daily wall-clock versus fixed-duration intervals; configured IANA timezone; spring gap and autumn repeated hour; timezone changes after creation. Derive previews from the same native calculation as scheduling. Do not promise custom per-job zones if native configuration is profile-scoped.
- A run longer than its interval, concurrent gateway ticks, stale process recovery, host sleep/restart and multiple missed occurrences. Display the proven native catch-up/skip behavior; do not layer a browser timer or promise one run for every missed occurrence.
- Selected profile model/skills, caller identity, secret scope and output destination with every client closed. An acknowledgement of enqueue/delivery is not a completed task.
- Durable routine definition, distinct run identity/status/output and failure history. Pause disables future occurrences; it must not be described as cancelling an already active run unless native behavior proves that.

Initially **the cron agent does the work directly**. Results appear in native cron history and the verified destination. Linking a direct routine to a project for navigation does not also create a runnable task. Phase four can add “Create a project task each time” as an exclusive execution mode: a fixed plugin-owned no-model native cron producer creates one Kanban task per durable scheduled-occurrence key, and only Kanban runs the agent. Prove the native schedule/occurrence identifier and retry semantics first; if no stable occurrence key exists, defer this mode. Do not use a cron model turn to dispatch a second model turn for the same work.

Exit: conversational creation and edits, no separate builder, actual deferred tool discovery, saved Main Pebble authority, any required inline approval, optional paused save, interruption/retry during staging or enable, pause/resume, two-client conflict, next-run preview, real synthetic schedule execution, offline delivery and restart checks. Complexity **medium** for the conversational integration, **high** for scheduler and profile proof. Do not ship unsupported scheduling promises based on chat claims alone.

## Phase four: delegation, review and recurring project work

Use the native dispatcher and supported worker lanes. A narrow Pebble adapter maps owner-local policy to native tasks, not to a second task lifecycle. Verify task claims, run ownership, stale-run rejection and recovery on each supported build before exposing **Start** or an agent create-and-start grant.

Extend the existing manage-team skill or add a discoverable manage-work skill with these concrete steps:

1. Refresh caller, current manager/direct reports, permissions and task/board identity. Read the task and comments; choose General tasks or the matching dedicated project board.
2. Record a clear deliverable and acceptance before delegation. Pick a capable assignee explicitly; org manager, task assignee and reviewer are independent references. Optional review defaults may suggest a manager but cannot grant permissions or self-approve.
3. Claim via native tools and preserve run ID/ownership. Break independent work into separate tasks; add only genuine prerequisite edges. Never mark work done solely because it was queued, a message was sent, or a commit exists.
4. Persist useful progress, blocker, result and artifact references in native task comments/attachments. Request native review where required; a reviewer can request changes. Only the native accepted transition records completion.
5. Report a concise outcome to the current immediate manager, or the owner-facing inbox when unattached. Refresh identity before sending; if a manager changed since start, retain original assignment provenance but route according to current validated policy. Escalate blockers once per meaningful state change, not on every poll.

Native event/notification facilities should carry completions, blockers and review requests. Prove manager wakeups reach the actual Bot Chat while clients are closed, survive restart, and do not cause acknowledgement loops. Use native event IDs for deduplication and integration receipts when needed; retain observable failed/pending delivery. Do not advertise exactly-once notification or exactly-once external side effects. If native notification support is insufficient, show a durable pending report to the owner and defer automatic wakeups; do not conceal a new scheduler inside the client.

Exit: two named profiles complete a synthetic task/review cycle using only a deterministic local model; reporting context and real tool discovery are correct in Kanban and cron sessions; restart, stale worker and duplicate delivery cases pass. Complexity **high**. Budgets, company governance, payroll, broad approval systems and enterprise project management are excluded.

## Verification and release matrix

Follow `.agents/skills/verify/SKILL.md`; update its feature map when implementation lands. Each phase is independently releasable only after its own gates. No phase implies the next one works.

| Boundary             | Required cases                                                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph/domain         | Main root; isolated agent; unattached manager with reports; null transitions; self/cycle; missing/foreign/recreated/hidden identity; root transfer; invalid import; old-client write and rollback                                                  |
| Profile UI           | All New/Add existing/Edit paths preserve name/photo/shape/role/instructions/reporting; no implicit root; reconnect retains drafts; production desktop/iPhone/Android settled screenshots inspected                                                 |
| Concurrency          | Two clients edit the same agent/project/routine; stale revision cannot overwrite; native external edit is detected; retry shares operation ID; uncertain receipt is reconciled before another mutation                                             |
| Runtime identity     | Direct Bot Chat, crew, cron and Kanban sessions; no/ambiguous/spoofed session fails closed; rename/incarnation changes; per-turn instructions refresh; deferred schema discoverable with catalog listing disabled                                  |
| Native work          | Both pinned builds; separate boards; folderless Project; catalog scope; idempotent create; partial writes; review/claim/run ownership; stale run cannot complete current work                                                                      |
| Routine execution    | Pure preview; one-action authorized create/enable; optional paused save; staged-operation retry; timezone/DST, overlap, missed-run/restart, secret/profile isolation, history and offline delivery                                                 |
| Installation/release | `npm run check`; relevant sequential production browser runners; `npm run test:owner-browser` for profile/chat contracts; exact packaged `scripts/test-installed-plugin.mjs`; rollback fixtures and unchanged archive `scripts/verify-release.mjs` |
| Owner boundary       | Read-only installed-capability/status reporting, loaded-runtime state distinguished from disk copy; zero owner model calls or persona mutations during install/update/status; synthetic homes/local model for acceptance                           |

Record exact Pebble SHA/package, native source SHA, test result and screenshot paths. A package version or on-disk runtime hash alone does not prove loaded native behavior. Production deployment and physical-device performance require their own later verification and authorization; this planning pass does not establish them.

## Evidence, confidence and bounded decisions

The local `.audit/org-research/native-proof.json` records a prior disposable test at native revision `af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a`: folderless Project, board binding, inherited triage task, deduplicated retry, persisted comment, zero workers/models. This pass read it; it did not rerun it. The four downloaded pinned project/board/API source files matched hashes in `.audit/org-research/source-evidence.json`. Temporary source files were research-only and removed after planning.

The supported pins are the repository's **enterkey-io/hermes-agent** revisions `af0cd4df...` (reported 0.21.7) and `29112bef...` (reported 0.21.0), not an assertion that every NousResearch/upstream installation has the same behavior. The additional cron source inspection above was on the newer pin only. Feature-specific behavior on the older pin and actual owner installation remains a proof gate.

Primary references read on 2026-10-19:

- [Current Hermes Kanban reference](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban): native boards, dependency direction, workers and task tools. Evolving documentation is guidance, not installed-capability proof.
- [Current native cron reference](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron): native recurring jobs, direct and no-agent modes, execution/output concepts.
- [Worker lanes](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-worker-lanes): consult alongside the exact supported dispatcher implementation before promising worker behavior.
- [Pinned native Project implementation](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/hermes_cli/projects_db.py), [Project RPC](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tui_gateway/methods_projects.py), [board metadata](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/hermes_cli/kanban_db_boards.py), [native dashboard service](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/plugins/kanban/dashboard/plugin_api.py).
- [Pinned cron jobs](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/cron/jobs.py), [scheduler](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/cron/scheduler.py).
- [Paperclip operating skill](https://github.com/paperclipai/paperclip/blob/master/skills/paperclip/SKILL.md): useful reference for explicit assignment, durable progress and escalation. Adapt these mechanics to Hermes; do not import Paperclip APIs, heartbeat execution or company/governance architecture. Beads is not a second task store for this plan.

The owner has answered the immediate policy question: **Main Pebble may directly manage existing agents’ reporting lines, job Instructions and routine schedules.** No immediate owner decision remains. Reporting management follows the always-available Main Pebble policy above, with separate protection for identity deletion, tools, secrets and Main Pebble transfer. Routine scheduling remains a separate later phase. This answer authorizes the planning requirement, not implementation. Other decisions are explicit: named enrolled agents remain visible in the org chart regardless of sidebar hiding; stable catalog profile; each project gets its own board; Chat/Tasks navigation with Org chart in the avatar menu; a global creation menu; routine creation and edits through chat under the later routine-management contract; and no background execution feature before its native proof gate.

## Phase-one implementation record

Implemented locally: Org chart in the account menu; named hidden-agent cards;
unattached manager subtrees; shared Profile/Role editing; current manager and
direct-report context; and identity-scoped Main Pebble reporting/Instructions
management with ask-first conversational guidance. Chat drafts and reading positions survive the chart, including
phone navigation back to a crew conversation. Receipts update without reloading.

The owner-local reporting migration preserves old relationships and creates a
private backup. New enrollment stays unattached until assigned. Writes use stable
agent identities and current workspace/policy revisions. Old browser graph writes
are refused before native mutation. A historical tree-only runtime downgrade is
refused before activation; compatible rollback remains supported.

Verification passed: production check with 172 unit tests, 307 plugin checks,
10 desktop and 6 phone journeys, both pinned native builds, the native owner
browser, and the unchanged exact-package release verifier. Tests use disposable
homes and deterministic local models. Settled desktop, iPhone, Android and native
owner screenshots were inspected. Evidence: `.audit/org-phase1/evidence/proof.json`.
No owner host was changed and no release was published. Later project-board,
routine and delegation phases remain unimplemented. Document viewing (PC-084)
is recorded separately as the next feature request.
