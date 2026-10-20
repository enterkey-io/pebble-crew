# Pebble Crew: complete shadcn implementation plan

Status: verified planning proposal, 2026-10-17. The owner explicitly chose **the complete system using existing React** in the current planning conversation. That framework decision is approved; application implementation, publishing and owner deployment are not authorized by this document.

Rebuild the entire installed interface around the owned shadcn React system, preserving Pebble Crew's visual character and real Hermes behavior. Prepare every documented AI pattern as a reusable component with explicit states now, including patterns whose native operation is unavailable. Use those same components throughout login, onboarding, editors, navigation, settings, resources and conversation. A component being ready never establishes that a native action exists.

[SHADCN_COVERAGE.md](SHADCN_COVERAGE.md) is the authoritative catalog, capability and installed-screen ledger. This document owns sequencing, architecture, invariants and gates; it deliberately does not repeat the catalog enumeration.

## Verified baseline and corrected assumptions

Inspected checkout: `291fab771b803edce4a4b63061303eb181af0a96`, branch `codex/owner-ui-corrections`, package version `0.7.8-preview.4`. Planning inspection did not run acceptance models or change services. Existing unrelated marketing/brand files are outside this work.

| Finding                                                 | Evidence and consequence                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This is already React with real owned shadcn components | Root `package.json`: React 19.3.0, Tailwind 4.3.3, Motion 14.3.0; `apps/web/package.json`: radix-ui 1.8.1. Both `components.json` files use neutral, new-york and the existing aliases. This is a composition/system migration, not a first-time button installation.                                                           |
| One production style/entry graph exists                 | `apps/web/src/main.tsx`, `ui/theme.css`, `ui-lab/main.tsx`; the review entry imports the installed entry. Keep it that way. `theme.css` imports foundation/layout/product; do not introduce a parallel design theme.                                                                                                            |
| The current catalogs contain 21 unique AI patterns      | Official React and linked Vue AI indexes checked 2026-10-17. The preliminary 22-pattern claim and duplicate Reasoning entry are corrected in the coverage ledger.                                                                                                                                                               |
| React patterns have a Radix variant                     | Official [Radix Chat pattern](https://ui.shadcn.com/docs/ai-elements/radix/chat). Preserve the existing primitive family; the default Base UI example is not a migration instruction.                                                                                                                                           |
| Model selection has limited existing semantics          | `WorkspaceDomain.selectModel` calls `agent.model` with `source: 'default'`, fingerprint and revision. `plugins/bot-web/workspace.py` enforces this. It grants the primary profile's selected model; it is not an arbitrary model/provider catalog or effort selector.                                                           |
| There are distinct approval authorities                 | `operations.py` maps chat approval to native pending/respond with `once` or `deny`; room approval verifies member/task/request/execution generation. `RequestReview.tsx` handles separate workspace requests, including typed deletion confirmation and uncertain reconciliation. Preserve each authority under common visuals. |
| Generic structured questions are not established        | `native.py` accepts approval and bounded secret callbacks and rejects unsupported callbacks. Questionnaire UI can be ready, but a generic responder cannot be invented.                                                                                                                                                         |
| Current chat projection is limited                      | `conversation.ts` carries broad `source` records; `Transcript.tsx` groups tools and combines live text. Enrich decoding incrementally, retaining generic safe tool output. Do not infer rich structured facts from prose.                                                                                                       |
| Existing state owners encode repaired behavior          | `SendProjection` correlates native receipts and preserves displayed timestamps; `TranscriptFollow` owns viewport movement; profile/connection reducers own drafts/conflicts/generations. Retain these authorities.                                                                                                              |
| Upstream scroller is not a passive wrapper              | Its [documented Provider](https://ui.shadcn.com/docs/react/message-scroller) owns scroll state, initial positioning and follow behavior. Disabling `autoScroll` alone does not prove all writes stop. Resolve D1 below before integration.                                                                                      |
| Source verification is not runtime proof                | The existing feature map and CI describe acceptance. No new browser/native/provider/device passes are claimed by this planning task.                                                                                                                                                                                            |

The official [AI Elements overview](https://ui.shadcn.com/docs/ai-elements) describes owned compositions. Its AI SDK helpers and example backend are optional examples, not Pebble Crew's transport or runtime. Use neither an AI SDK conversation store nor auto-continuation logic that competes with Hermes.

## Product and privacy contract

- Quiet charcoal chrome; neutral focus/selection independently of earthy avatar colors. Preserve Snow, gray owner bubbles for Snow and otherwise selected-Pebble owner bubble colors with readable text. Keep system fonts, compact settings, concise labels, actual shape/swatch controls and no giant hover fills or filler instructions.
- Preserve every Add/Create/Import/Edit field: name, handle, title, description, responsibilities, reporting, shape/color/photo and applicable tool/connection choices. Main Pebble remains the authoritative root. Existing personas, model settings and canonical chats must survive; do not clone a persona or submit another introduction during installation/update.
- Preserve centered pinned avatars, attached Main Pebble star, title labels, far-edge menus, whole-row/tile/section drag and Alt+Arrow. Ungrouped Pebbles have no heading. Empty custom sections remain drop targets. Crews, organization sections and native group membership remain separate concepts; crew click opens chat and its menu opens settings.
- Preserve authorized global search across messages, Pebbles, crews, files and routines. Account photo opens the balanced account menu. Header name toggles details. Desktop details consumes real layout width; phone sheets have correct focus, safe-area and back behavior.
- Preserve send/live/final identity, authors, timestamps, reaction targeting and scroll intent. Keep visible gentle insertion, no empty tool bubbles, minimal truthful activity, stable completed controls and bare overlaid reactions with no background/border/shadow in any state. Reconnect retains navigation, fields and DOM; no transient red offline flash.
- Composer File/Photo uses the plus menu opening into the work area. Preserve input cursor, no phone zoom, aligned send/field centers, usable keyboard and safe areas. Owner bubbles remain approximately half-width on desktop and useful on phones.
- Preserve shape/photo avatar support, symmetric fluid gaze, up-right rest gaze, body movement, shared scheduler, offscreen behavior and reduced motion. Owner avatar is photo-only.
- Owner infrastructure owns credentials, profiles, history, memory, execution and stored artifacts. No new vendor account, telemetry/content relay, remote font service or external design/source upload. Keep accurate native voice/provider data disclosures. Never render returned executable content inside the authenticated application origin.
- Future Mac/Windows/iOS clients may share specifications, protocol/domain code and avatar math. This plan delivers the web client; it does not claim DOM controls become native widgets.

## Ownership and caller contract

Feature routes render typed facts and emit typed intentions. Network parsing happens once at the relevant domain boundary; components do not receive `BotBridgeClient`, raw `Record<string, unknown>` payloads or authorization decisions.

```tsx
// Proposed caller shape; sketches only, not implementation.
<ConversationScreen view={conversationView} onIntent={dispatchConversationIntent} />

<EditorSurface title="Edit Pebble" status={profileSession.status}>
  <PebbleProfileFields session={profileSession} />
  <RoleDetails session={profileSession} />
  <ReportingField session={profileSession} />
</EditorSurface>

<Confirmation request={pendingNativeRequest}
  onDecision={decision => dispatchConversationIntent({
    kind: 'decide-approval', request: pendingNativeRequest.target, decision,
  })} />
```

The last example carries a decoded chat or room target, including its generation when required; it cannot grant authorization. Workspace request review uses a separate intent and outcome type, despite sharing the composition.

| Existing or proposed path                                                                     | Responsibility and migration rule                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/ui/*`                                                                | Owned Radix registry primitives, accessible behavior, variants. Add missing catalog primitives here; audit imports/dependencies before copying.                                                                                     |
| `apps/web/src/ui/{theme,foundation,layout,product,tokens}.css`                                | Keep one import graph. Semantic values/focus in foundation/tokens; layout geometry in layout; remaining scoped product composition in product. Remove migrated overrides rather than append stronger selectors.                     |
| `apps/web/src/ui/primitives.tsx`                                                              | Retain useful product compositions over primitives. Migrate/remove duplicates; do not introduce another universal wrapper library.                                                                                                  |
| Proposed `apps/web/src/ui/EditorSurface.tsx`                                                  | Consistent editor header/tabs/body/action positioning only. Existing feature reducers continue to own form values and writes.                                                                                                       |
| `apps/web/src/ui/DetailsDock.tsx`, `chat/Drawer.tsx`, `ui/overlay-history.ts`                 | Desktop width, phone overlay and navigation/focus policy; no duplicate scroll or history controller.                                                                                                                                |
| Proposed `apps/web/src/components/ai-elements/*`                                              | One reusable composition per catalog pattern, with typed props. Can share Trace/Item helpers; no network or mutable transcript store.                                                                                               |
| Proposed `apps/web/src/components/ai-elements/states.ts`                                      | Presentation unions shared by patterns and specimens. Domain-neutral concepts only; no invented Hermes RPC schema. Split only if actual usage warrants it.                                                                          |
| Proposed `packages/hermes-client/src/conversation-domain.ts`                                  | Decode existing chat/history/events/approvals into bounded typed facts, and own typed chat commands over the existing bridge. Move callers from raw parsing in one completed slice; export through the existing package API.        |
| Proposed `apps/web/src/chat/presentation.ts`                                                  | Pure selection of pattern/data from decoded facts, capability availability and current live projection. Arrays and current identity scheme suffice; no speculative multi-map store.                                                 |
| Proposed `apps/web/src/chat/capability-ledger.ts`                                             | Derive read-only availability from verified bridge flags, native descriptors and profile/room scope. Do not persist a second capability truth.                                                                                      |
| Existing `conversation.ts`, `chat/Transcript.tsx`, `MessageBody.tsx`, generated media modules | Migrate rendering/decoding responsibility to the designated owners; preserve existing markdown/media provenance and safe download behavior. Delete only superseded functions after all callers move.                                |
| Existing `SendProjection`, `TranscriptFollow`, reaction reducer                               | Sole authorities for receipt aliasing/displayed timestamps, viewport motion, addressed reaction updates. Presentation reads their results.                                                                                          |
| Existing `WorkspaceDomain`, profile/tool/connection reducers                                  | Preserve baseline/draft/conflict/save-generation and confirmed/refused/uncertain outcome semantics. A transport replacement never resets an editor.                                                                                 |
| Existing `voice/*`, `avatar-lab/*`                                                            | Keep native voice, private secret, exact delegation receipts and avatar engine lifecycles. New compositions receive their safe typed state.                                                                                         |
| Proposed `apps/web/src/ui-lab/SystemWorkbench.tsx` and `catalog.ts`                           | Development-only route reached through production entry, using actual primitive/pattern modules and the same theme. Synthetic fixtures only, no live bridge/model calls. Existing `ui-lab/main.tsx` remains an import of `../main`. |
| Existing `plugins/bot-web/*`                                                                  | Native authorization, operation allowlists, profile scope, request validity, credential lifetime and optional contract extensions. Presentation changes do not bypass it.                                                           |

Minimal type sketch:

```ts
type Availability<T> =
  | { kind: 'available'; value: T }
  | { kind: 'read-only'; value: T; reason: string }
  | { kind: 'unavailable'; reason: 'unsupported' | 'unverified' };

type RunPresentation<T> =
  | { kind: 'pending'; summary: string }
  | { kind: 'streaming'; value: T }
  | { kind: 'complete'; value: T }
  | { kind: 'failed'; safeMessage: string; partial: T | null }
  | { kind: 'cancelled'; partial: T | null };

type ApprovalTarget =
  | { kind: 'chat'; sessionId: string; requestId: string }
  | {
      kind: 'room';
      roomId: string;
      memberId: string;
      taskId: string;
      generation: number;
      requestId: string;
    };

// Derive final identity types from existing authoritative decoders.
declare function projectConversation(input: PresentationInput): ConversationView;
declare function decodeConversationEvent(input: unknown): DecodedEventOutcome;
```

Use each pattern's smallest valid union, not every state for every control: a source citation has no meaningful cancellation, while a submitted approval needs expired/superseded/uncertain states in addition to answered states. The coverage ledger specifies each requirement. Tests and workbench must exercise applicable states now, not promise them for later.

History/native events, live send projection, reaction patches and editor drafts retain separate writers. Merge at read boundaries. Use native row/turn/incarnation identity, never equal text or timestamps to correlate. Repeated events and receipts are idempotent. Do not replay an uncertain native write; reconcile its outcome. Polling cannot replace the active transcript. Keep secrets outside these presentation/history types and browser persistence.

## Bounded technical discovery gates

These are implementation tasks with evidence gates, not missing owner decisions. The approved React choice is settled.

| ID  | Task and bounded decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence required before integration                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Inspect the exact selected Radix Message Scroller source/package. Determine all writes from initialization, anchor alignment, auto-follow and imperative APIs. Preferred result: owned catalog composition whose behavioral adapter uses `TranscriptFollow` as the only writer. If upstream cannot be made passive, adapt its owned visual parts and preserve the existing controller; record that divergence. Do not mount two controllers or silently replace the established scroll policy. | Source/pinned version notes plus real-frame send, first reply, streaming, restored history, resize/details width, manual scroll, delayed image and reduced-motion tests. A documented `autoScroll=false` prop alone is insufficient. |
| D2  | Inspect copied registry dependency graph and Radix variants. Choose pinned resolved versions compatible with current React/Vite/Tailwind; map Vue-only controls to React compositions. Keep the two registry configs consistent.                                                                                                                                                                                                                                                               | Registry provenance, reviewed generated diff, peer-dependency/build checks, no Base UI/React Aria mixture, duplicate theme, AI SDK backend or external service.                                                                      |
| D3  | Identify optional native structured payloads on isolated pinned Hermes sources. For each ledger row, distinguish existing bridge exposure, native-supported but unexposed, and no verified native contract. Never infer one feature from a similarly named tool.                                                                                                                                                                                                                               | A sanitized real fixture with identity/schema/lifecycle, exact operation/event source and supported-version matrix. Until then the shared component works in the workbench and stays inactive in live flows.                         |
| D4  | Determine structured-question response semantics if exposed by a supported native version. Existing generic callback support is absent in this bridge.                                                                                                                                                                                                                                                                                                                                         | Scoped request ID, allowed answer schema, expiry/generation/cancellation, native rejection and replay tests. Private secrets must retain their separate route. No generic web RPC responder.                                         |
| D5  | Evaluate typed tool-specific adapters for terminal/test/stack/plan/source/file outputs.                                                                                                                                                                                                                                                                                                                                                                                                        | Versioned known payload decoder and bounded output tests; arbitrary output retains the generic Tool view. No regex inference of test success, modified files, citations or reasoning.                                                |

An unknown native feature does not block completing its shared UI. A native extension is scoped separately: descriptor → boundary decoder → allowlisted operation/event mapping → isolated contract tests → browser integration. Add no new native storage or execution engine merely to satisfy a visual pattern.

## Implementation units and dependencies

The sequence is `U0 → U1 → U2 → U3 → U4–U7 → U8`. All patterns are prepared in U2 before feature migration proceeds. U4–U7 may be reviewed independently after their dependencies, but use separate branches/worktrees only if work is actually delegated later. No duration estimate is asserted.

### U0 — Freeze the execution baseline

Record source/build/registry revisions, complete the capability evidence references in the coverage ledger, and capture current installed desktop/phone routes through existing fixtures. Read current AGENTS and verification feature map. Record each old path that a slice will retire and any test coverage gaps. Do not modify owner installations.

Acceptance: all screen rows have a reachable flow and state owner; catalog sets are unique; unknown native support is explicit; existing unrelated files remain untouched. A version string alone does not establish deployed source freshness.

### U1 — Consolidate the foundation

Audit and add the full general component vocabulary using owned Radix primitives and documented semantic compositions for Vue-only entries. Build the workbench route from the actual production graph. Establish single token/focus/selection/spacing/type/icon/motion/overlay policy and common editor/detail surfaces. Complete D2; begin D1 with a minimal integrated conversation specimen.

Changes: `components/ui/*`, existing `ui/*`, registry config/lockfile only as needed, workbench and source guards. Remove duplicate primitive variants and migrated global overrides immediately. Keep the theme's actual foundation/layout/product ownership rather than replacing it with another directory.

Acceptance: every general catalog row has a ready component or documented semantic alias and an applicable specimen; unused product controls remain absent and unused heavy modules stay out of normal route bundles. Keyboard/focus/portal/disabled/error behavior works under the actual theme; phone target/zoom rules pass. `npm run check` and production `design-system.spec.ts` plus applicable menu/editor journeys pass, with settled captures inspected.

### U2 — Prepare the complete AI vocabulary

Build all 21 reusable compositions and pattern-specific state unions listed in the coverage ledger. Cover available and unavailable operation states, applicable pending/streaming/complete/failure/cancelled states, long content, keyboard behavior and responsive layout. Also prepare Questionnaire, attachments, media/code and the legacy dispositions recorded in the ledger. Use deterministic local specimen transitions; no AI SDK runtime or model calls.

Changes: `components/ai-elements/*`, workbench catalog/specimens, relevant shared primitive composition. Define public props before native adapters. Keep unavailable action callbacks structurally absent. Components must be usable beyond a one-off demo.

Acceptance: one catalog manifest drives workbench coverage and tests; there are exactly 21 unique AI entries, all with required states and a production-importable component. No component calls transport, persists credentials, owns history or enables an unsupported action. Inspect desktop/iPhone/Android specimens; readiness is UI readiness, not a claim of native support.

### U3 — Establish the native presentation boundary

Add the narrowly scoped conversation domain decoder/command interface and capability derivation. Start with existing chat/tool/public commentary/approval/file/reaction evidence. Retain stable receipt aliases and current arrays; migrate callers from raw native parsing and delete superseded decoding in the same unit. Carry conversation incarnation and room identities intact. Complete D1 and D3–D5 for any capability being enabled in this release; unverified optional adapters stay unconnected.

Acceptance: malformed/oversized/unknown payloads have safe outcomes; known native receipts preserve identity and timestamps; repeated/reordered receipts and reaction events do not duplicate rows. Stale room approval generations fail natively, and only once/deny are exposed. Workspace request reconciliation remains distinct. Run relevant domain/plugin tests and native synthetic fixtures for changed contracts. No `Row`/bridge client leaks into reusable pattern props.

### U4 — Migrate identity, onboarding, settings and connections

Migrate `OwnerShell`, startup, first run/workspace setup, `NewPebble`, `ExistingPebbleSetup`, `PebbleEditor`, account photo, workspace settings and connection detail/list. Reuse `PebbleProfileFields`, `RoleDetails`, `ReportingField` and all existing reducers. Retain actual primary detection, explicit native introductions, Main Pebble, model-grant scope and photo→shape→saved-photo behavior. Keep editor top and outer scroll fixed across tabs; do not reset fields on reconnect/discovery refresh.

Acceptance: startup/loading/replaced identity and error states; every field survives save/reopen; duplicate handles/reporting cycles are rejected before invalid writes; original SOUL/model sentinels remain intact; uncertain creation/save reconciles without duplicate agents; OAuth and API-key cases use different services; secrets stay transient; conflict keep/discard and guarded navigation work. Run startup, owner-ui, setup-continuity, profile-recovery, connections, connection-recovery and account-photo journeys on relevant desktop/phone configs, then native-owner and owner-worker where changed.

### U5 — Migrate navigation, organization and resource surfaces

Migrate `Rail`, `OrganizationRail`, search, `DetailsDock`, `Drawer`, `Inspector`, files/routines/computer and existing crew/membership settings. Preserve all existing storage and navigation semantics. Apply the common list/menu/detail vocabulary, real-width desktop geometry and phone sheets. Routines currently expose list/toggle; a date picker does not authorize adding a schedule editor. Computer controls preserve native supported state and observation/control lease ownership.

Acceptance: crew click opens its real chat; sections retain kind constraints and empty-state behavior; whole-row pointer and keyboard moves persist; menus align at edges with 44px phone targets; search opens authorized context/destination; no global scroll jumps; file provenance/download bounds and computer view-only/lease transitions survive reconnect. Use existing workspace/unsectioned/sidebar and resource journeys; add focused journeys for actual uncovered states identified in U0, not tests mirroring component internals.

### U6 — Migrate the complete conversation experience

Replace transcript/composer/activity/approvals/reactions and markdown/media presentation with prepared patterns. Integrate typed facts from U3; retain generic safe tool fallback. Preserve text draft, file/photo queue reconciliation, send/stop states, author labels and native approval distinction. Use explicit structured outputs only when evidence passes D3/D5. Preserve selected-Pebble colors, mobile geometry and exact reaction styling.

Acceptance: send/first reply/stream/stop/complete and denied/failed request sequences; reaction arrives mid-stream without transcript replacement; no duplicate final row or timestamp change; touch controls stay stable; delayed media and details resize retain reader position; scrolled-up readers are not pulled down. Run live-feedback, reactions, message-motion, interaction-feedback, setup-continuity, markdown and agent-media desktop/phone journeys and applicable native acceptance. Real-frame motion proof is separate from accelerated native lifecycle timers.

### U7 — Integrate voice, private prompts and delegation

Apply the same components to `VoiceChat`, `SecretCard`, native private setup and delegation links without replacing live-session state or `DelegationReceipts`. Use exact native row receipts to associate spoken completion; queued acknowledgement is not completed work. Preserve mute/end cleanup, denied microphone fallback, voice/pace settings and single-use expiring secret requests.

Acceptance: secrets never enter transcript/log/browser persistence; submit clears them; stale/expired/wrong-session prompts fail; exact delegation opens the actual conversation and unrelated replies are not spoken. Run shared voice browser journeys, native/plugin voice tests and isolated workspace fixture. Keep automated WebKit local-media limitations and physical provider/device acceptance explicitly separate.

### U8 — Remove competing paths and verify the release candidate

Remove only now-unused bespoke markup, duplicated pattern rendering, old CSS rules, raw migrated decoders and redundant controls. Retain semantic feature components, reducers, avatar engine and current viewport/receipt owners. Update the verification feature map and structural guards to enforce the new production imports, complete catalog/state coverage and native boundary. Do not weaken a guard simply to accept a competing path.

Acceptance: all installed screen rows use the same graph; no disconnected polished demo, inert live controls or duplicated state owner; all relevant checks below pass on the final source/package. Implementation delivery includes evidence paths, remaining unavailable native capabilities, reviewed screenshots and known platform limits. Creating a release, deploying or restarting an owner service requires the applicable later authorization; it is not part of this planning task.

## Verification and package gates

Use [.agents/skills/verify/SKILL.md](../.agents/skills/verify/SKILL.md) and its feature map as the maintained command recipe. Tests below are required future implementation work, not passes achieved by this document.

1. `npm run check` for each completed relevant unit and final source. This includes type/lint/UI contracts/format/unit/build checks. Run only focused additional tests justified by changed behavior until final integration.
2. Production browser journeys: `CI=1 npx playwright test --config playwright.chat.config.ts <relevant specs>` followed by `CI=1 npx playwright test --config playwright.mobile.config.ts <relevant specs>`. Run desktop/mobile sequentially; do not reuse another listener. They serve `apps/web/dist`, not a separate review app. Final integration runs both full suites.
3. Inspect settled desktop/iPhone/Android screenshots and actual motion evidence. Test touch targets, composer-center alignment, keyboard focus/escape/return, reduced motion, no input zoom, contained overflow and contrast on real composited surfaces. Automated screenshots alone are not visual inspection or owner acceptance.
4. `npm run test:owner-browser` with prepared isolated Hermes and local deterministic model whenever profile/avatar/setup/chat contracts change. Current CI pins `af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a`; legacy reaction/media coverage pins `29112bef099274229cadff79cdff7bf7b99c4b77`. Re-read CI pins at execution. Preserve this support matrix and add optional-feature compatibility fixtures rather than assume both versions expose new data.
5. Run relevant Python/plugin fixtures, `npm run test:avatars` for avatar changes and `npm run test:owner-worker` for account/worker persistence changes. Never run acceptance on owner homes or configured owner providers.
6. Build/package once for final archive checks, then keep that archive unchanged during tests. Follow `scripts/verify-release.mjs` and `scripts/test-installed-plugin.mjs` with explicit native paths. Verify install/update/partial-sync/runtime-status/historical Python rollback using required Git history including `b642ccef86511814223e9c4443fc48f639965b47`. Installation/update checks must make zero model turns and preserve personas. Disk-copy verification must not be relabeled as loaded runtime verification.
7. Record source revision, artifact digest, commands/results, screenshot/log paths and limitations. Physical Safari/provider calls and owner visual acceptance remain separate from fixture/emulator proof.

## Definition of complete

The full general vocabulary has a recorded reusable disposition; every AI pattern is implemented with exercised states; all installed screens are migrated; competing paths are removed; native actions are evidence-backed; prescribed production/native/package gates pass. Optional native capability gaps do not excuse missing component design, and component readiness does not excuse fake actions. The plan itself is complete once both documents are consistent and source-backed; executing it begins only with subsequent implementation authorization.
