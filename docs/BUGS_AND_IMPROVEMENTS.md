# Pebble Crew bugs and improvements

Track owner reports here through implementation, verification and release. A
published fix is separate from updating and verifying the owner's installation.
New reports receive a stable ID; later work updates the existing entry.

## 0.7.7 reliability and message motion

See the [implementation plan](AGENT_RELIABILITY_PLAN.md) for the retained baseline
and verification limits. These changes require updating the installed plugin;
local acceptance is separate from the owner's deployment.

| ID     | Finding                                                           | Evidence and next step                                                                                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-064 | Connections loses unsaved tool access after transport restoration | Feature-owned edit reducer retains tool choices and transient key text across a new lease; divergent saved policies require an explicit decision. Desktop/iPhone/Android recovery tests exercise the production screens.                                                                                  |
| PC-065 | Detailed photos fail full-profile Add/Edit requests               | One inert catalog supplies client, Node proxy and Python operation routing/body limits. All four photo-bearing operations use `/v1/avatar`, with bounded legacy RPC compatibility. Native owner acceptance saves a detailed 512px image above 64 KiB, switches to a shape, then restores the saved photo. |
| PC-066 | Workspace boundary accepts malformed nested data as typed state   | Complete network decoding precedes UI replacement. Retained malformed snapshots are rejected; valid native Unicode lengths and optional/null fields remain supported. No malformed owner-host response has been observed.                                                                                 |
| PC-067 | New messages pop into view and move the conversation in one frame | New bubbles enter once under stable receipt keys; one viewport follower eases toward growing content. Real-frame desktop/phone checks cover user and first reply insertion, manual scroll and reduced motion. Existing completion/reaction checks retain DOM, timestamp and control placement.            |

Add, import and Edit share profile ownership and conflict rules. Delayed older
snapshots cannot replace newer edits. Tools retain unsaved choices on reconnect;
uncertain writes require review rather than automatic replay. AST checks require
real screen composition and supported profile-domain imports.

Runtime status is owner-local disk evidence; loaded native code remains unknown.
Synchronization records private per-profile receipts/backups, supports native
managed profiles with no prior integration copy, and preserves a failed/partial
result. Final-package acceptance includes changed tool definitions and historical
Python-runtime rollback, with current packaged web assets. Update checks do not
run models or edit personas.

## 0.7.6 setup and return-to-app corrections

| ID     | Report                                                             | Repair and verification                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-059 | “Introduce them in chat” is unclear                                | The option reads “Send me a welcome message.” The pebble sends a first message through its native model only when selected; this is separate from enrollment.                                                                                               |
| PC-060 | Add lacks reporting and detailed role fields                       | Shared reporting and role controls appear in existing-agent setup, new creation and Edit. Full-role saves preserve the native identity and validate the reporting graph before writes. Native acceptance reopens the saved manager and all detailed fields. |
| PC-061 | Switching away closes setup and makes chat appear to refresh       | Recovery restores transport without navigating away from the active dialog or clearing visible messages. Desktop and phone tests retain draft identity, role and reporting through background/focus and a broken stream.                                    |
| PC-062 | Sidebar is cramped and New/Close too close                         | Wider responsive rail/sheet, separated header controls and 44px phone targets. Browser checks measure width and spacing and capture both phone layouts.                                                                                                     |
| PC-063 | Returning produces a false, poorly formatted red disconnect banner | Automatic owner recovery stays in the connection indicator. Real operation errors remain separate and wrap inside an inset notice. Browser checks hold a reconnect open, assert no red banner and retain the same message element.                          |

PC-057's standalone reaction fix is retained. An installed version and an open
browser can lag a published release; update instructions now require checking
the served version and reopening the browser once, without clearing login or data.

## 0.7.5 review corrections

| ID     | Report                                          | Repair and verification                                                                                                                                                                            |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-057 | Reactions still have a border/background        | Standalone emoji overlaps the bubble's lower-left edge. Desktop and phone checks assert no border, background or shadow, including selected/hover states. The invisible touch area remains usable. |
| PC-058 | Sidebar pebble menus sit too far left on mobile | The real Radix trigger fills its 44px action column. Phone checks measure row/tile edge alignment, viewport collision bounds and focus return for regular and pinned pebbles.                      |

Astra high reviewed the production desktop, iPhone and Android screenshots and
Connections state handling. Its draft-preservation, stale-sign-in-status and
scroll-context findings were repaired and reviewed again. CI retains synthetic
UI screenshots on successful and failed runs for subsequent review. This does
not establish owner acceptance or testing on a physical phone.

## Owner corrections after 0.7.0

### Mobile, activity and Connections — 0.7.2 candidate

| ID     | Report                                                                   | Repair and verification                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-052 | Focusing the phone composer zooms and breaks the layout                  | Shared mobile field sizes are at least 16px. The chat follows the visual viewport during keyboard resize/pan, preserves pinch zoom and drafts, and stays above safe-area insets. Add WebKit/iPhone and Chromium/Android checks to CI. Physical iOS keyboard acceptance remains separate from emulation. |
| PC-053 | Activity always says Thinking; replies and timestamps jump on completion | Render actual native status and readable tool activity. Stream through the same message component, reserve the footer from the first chunk, and retain bubble identity using Hermes' final row receipt. Keep optimistic send time when a native receipt temporarily omits it.                           |
| PC-054 | Move menus are blank when no destinations exist                          | Shared menus show a disabled None item at 50% opacity; native placement menus use the same empty state.                                                                                                                                                                                                 |
| PC-055 | Connections is poorly formatted                                          | 0.7.5 replaces expanded service cards with a compact overview, focused service details and a separate searchable catalog. Realistic OAuth/API-key cases cover failed saves, sign-in refresh, unsaved tool edits, guarded navigation and fixed mobile headers.                                           |
| PC-056 | Installable PWA and pebble app icon                                      | Package manifest, Apple touch icon, maskable icon and original SVG/PNG artwork. Serve correct MIME types from the owner app. Cache only public offline artwork; verify installation metadata and offline recovery without caching owner data.                                                           |

The owner rejected the 0.7.0 experience. Its earlier review did not establish
visual acceptance. The reference and installed screens had different compositions
and CSS entry graphs. The review entry now imports the actual app entry, and
`check:ui` rejects the old arrangement. It also rejects the historical global
purple focus rule and duplicated profile forms. This check was run against
`ac4a881` and failed on those actual mistakes.

| ID     | Report                                              | Repair and acceptance                                                                                                                                                                                                         |
| ------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-039 | Empty Pebbles and Crews headings                    | Omit empty built-in sections. Retain custom sections as drop targets. Browser checks cover a single pinned pebble.                                                                                                            |
| PC-040 | Handles, reorder menus and incorrect section types  | Drag whole rows, tiles and section headers. Reserve Crews for crews and Pebbles for pebbles in both domains. Built-in names are fixed. Existing misplaced entries migrate to the correct section without deleting identities. |
| PC-041 | Composer menu opens over navigation                 | Open above the + trigger, aligned toward the conversation. Browser checks measure placement.                                                                                                                                  |
| PC-042 | Uneven account menu and missing icons               | Shared menu rows use consistent padding and Lucide icons.                                                                                                                                                                     |
| PC-043 | Expanded header arrow jumps                         | Only the closed details control nudges its right-facing chevron. The expanded down-facing chevron stays still.                                                                                                                |
| PC-044 | Files flashes loading text                          | Delayed two-pixel loading bar, fixed space and reduced-motion state.                                                                                                                                                          |
| PC-045 | Missing connected dot                               | Restore a muted green dot with the connection label.                                                                                                                                                                          |
| PC-046 | Search spacing and purple focus                     | Inset search field, neutral selection/focus tokens and no product-level global focus override.                                                                                                                                |
| PC-047 | New and existing pebble setup skips profile choices | Shared name, handle, avatar, title and description form. Compact searchable agent picker opens individual setup. Owner creation uses the exact visible proposal once.                                                         |
| PC-048 | Added pebble does not introduce itself              | Default checked introduction uses native `prompt.submit` with a hidden seed in the canonical Bot Chat. Durable per-incarnation status prevents replay after reconnect or an uncertain outcome.                                |
| PC-049 | Imported stock photo and disappearing choices       | New profiles default to animated Iris. Explicit saved photos remain. Shape and color choices stay visible in both modes. Refresh saved photo data after profile saves.                                                        |
| PC-050 | Cannot rename a pebble                              | Save the display name through native metadata with identity and revision checks. Keep the native profile, SOUL and personality intact.                                                                                        |

PC-051 remains open: a fresh custom-provider profile on the older 0.21.0 source
returned `Unknown provider` after the existing model-grant adapter ran. Existing
agent enrollment and introductions pass on that source. Fresh creation and its
introduction are verified on 0.21.7; the older grant path needs separate repair.

Verification and release status belong in [UI_RESET_WORKLOG.md](UI_RESET_WORKLOG.md).
The owner's installed host and visual acceptance remain separate from local tests.

## UI foundation reset — latest 16 October reports

### 0.7 production implementation

Historical claim from the 0.7.0 release: the reference shared a foundation with
the app. The later owner report showed that this did not establish matching screens. The independent production review and its limits are recorded
in [UI_RESET_REVIEW_CHECKLIST.md](UI_RESET_REVIEW_CHECKLIST.md). A release is separate
from upgrading the owner's remote host and receiving owner acceptance.

| ID     | Report                                      | 0.7 implementation and verification                                                                                                                                                            |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-025 | Overflow overlaps names or avatars          | Dedicated row column and pin action strip; actual browser menu/pin and rollback checks.                                                                                                        |
| PC-026 | Search breaks rail and only filters names   | Owner-local overlay searches native visible history, routines and bounded sent-file text; exact-result preview with identity revalidation. Native read-only probes on both supported sources.  |
| PC-027 | Sent message jumps/remounts                 | Immediate local entry/time, native receipt correlation and stable render key. Completion-before-receipt race has behavioral coverage.                                                          |
| PC-028 | Timestamp appears late/floats               | Reserved metadata lane and immediate submission time. Native confirmed timestamps retained.                                                                                                    |
| PC-029 | Copy word clutters metadata                 | Separate accessible Copy icon.                                                                                                                                                                 |
| PC-030 | Controls lack a shared foundation           | Actual shadcn/Radix controls, shared layout/theme, Lucide and Motion across Settings, Add/Edit, account, requests and connections. Old overlapping CSS removed.                                |
| PC-031 | Details needs integrated persistent layout  | One animated width reserves the panel and conversation boundary; phone view integrated; anchor/bottom following and focus independently checked. Header hover stays transparent, arrow nudges. |
| PC-032 | Editor jumps between tabs                   | Fixed frame/header/footer, bounded scrolling body; 320px create form and nested dirty confirmation rechecked.                                                                                  |
| PC-033 | Crew click opens settings                   | Opens/reuses a native room; settings in overflow. Both pinned Hermes versions pass real native creation/reuse tests.                                                                           |
| PC-034 | Custom sections and rearrangement           | Independent persisted organization revision, collapsible/reorderable sections, crews, move menus and desktop drag. Profile roles/reporting stay separate.                                      |
| PC-035 | White menu borders and loud scrollbars      | Shared dark borderless popups; muted thin scrollbars.                                                                                                                                          |
| PC-036 | Minimal Thinking/Working                    | Native event mapping to one shimmer label, stable lane, reduced-motion alternative; browser state checks.                                                                                      |
| PC-037 | Add more avatar choices                     | Cairn, Seed, Dune, Flint, Drift; Umber, Moss, Ocean, Heather, Sienna. Native persistence and browser photo/shape checks; static pose atlas.                                                    |
| PC-038 | Owner messages too wide; replies too bright | Owner bubble maximum50%; pebble fill#202022. Verified in actual app and independent review.                                                                                                    |

PC-024's shared renderer rests up/right and uses equal face-relative pointer gain,
near/far eye perspective, easing and body motion. Automated and captured-pose checks
do not establish all-device animation performance. The full matrix remains in the
[review checklist](UI_RESET_REVIEW_CHECKLIST.md); no formal accessibility or platform
certification is claimed. Owner visual acceptance after installation remains open.

## Historical 16 October 2026 — implementation in the rejected 0.6.0 candidate

The owner authorized inline implementation after the Astra-high audit and plan.
The shared system now covers the production screens. Automated validation is
recorded in [the release evidence](compatibility/preview-0.6.0-local.json); the
owner's installed host still needs the combined-package update and review.

See the [UX audit](PEBBLE_CREW_UX_AUDIT.md),
[starter design system](PEBBLE_CREW_DESIGN_SYSTEM.md),
[implementation sequence](PEBBLE_CREW_UX_IMPLEMENTATION_PLAN.md), and
[native feature findings](PEBBLE_CREW_NATIVE_CAPABILITIES.md).
UX IDs map to the detailed evidence and acceptance criteria in those documents.

| ID     | UX ID | Report / required result                                                                                                                                          | Status                                                                                                                                                                  |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-008 | UX-01 | Empty/tool-only chat bubbles: project meaningful messages and expandable turn activity without losing real replies, files, approvals or native cursor scope.      | Implemented: lossless source rows, grouped tool activity, final sidecars; browser and unit coverage.                                                                    |
| PC-009 | UX-02 | Pinned menu leaves the viewport: accessible, collision-aware overlay at every rail/viewport edge.                                                                 | Implemented: portaled collision-aware menu, keyboard/Escape/focus and phone coverage.                                                                                   |
| PC-010 | UX-03 | Settings needs the same design system and scoped, understandable forms as chat.                                                                                   | Implemented: Account/Connections/Requests use shared forms, tabs, loading/error states.                                                                                 |
| PC-011 | UX-04 | Rename organizational Teams to Crews; create/manage from sidebar +, alongside New pebble. Preserve distinct native group chats and reporting relationships.       | Implemented: sidebar New crew and per-Crew editor; typed native Group chat creation stays separate.                                                                     |
| PC-012 | UX-05 | Redesign Add/Edit pebble; distinguish adding an existing native agent from creating a new one, preserve edits and make save outcomes clear.                       | Implemented: existing/fresh paths, reviewed native creation, scoped forms, draft/conflict/retired-identity protection.                                                  |
| PC-013 | UX-06 | Audit main-page usability/accessibility first, then establish tokens, components and states covering every app surface.                                           | Implemented: shared tokens, menu, tabs, form sections, notices, dialog/drawer and all screen migration.                                                                 |
| PC-014 | UX-07 | Keep three-dot triggers transparent with no hover background; provide readable glyph/focus feedback and reliable touch discovery.                                 | Implemented: transparent always-discoverable overflow triggers; glyph/focus feedback without hover fill.                                                                |
| PC-015 | UX-08 | Pin responds promptly, indicates pending/confirmed state honestly, and animates the same identity into/out of the shelf with reconciliation and rollback.         | Implemented: immediate pending pin intent, identity-preserving animation, authoritative commit or rollback.                                                             |
| PC-016 | UX-09 | Center pinned pebbles, including incomplete rows, without changing saved order.                                                                                   | Implemented: centered incomplete pin rows, stable saved order.                                                                                                          |
| PC-017 | UX-10 | Show genuine role/title beside ordinary sidebar names; preserve readable long titles and missing-data behavior.                                                   | Implemented: actual role chip, truncated long labels, no invented role for missing data.                                                                                |
| PC-018 | UX-11 | Use Main Pebble throughout user-facing and model-facing prose; preserve compatible internal IDs and actual permissions.                                           | Implemented: Main Pebble in product/model prose; compatible persisted identifiers retained.                                                                             |
| PC-019 | UX-12 | Toggle/close details at every size with a sliders icon, attached avatar star, no idle Ready text, and Routines/Files/Computer tabs backed by actual capabilities. | Implemented: optional details, attached star, Routines/Files tabs; Computer native transport probe passed; viewer disabled by default pending Linux desktop acceptance. |
| PC-020 | UX-13 | Replace exposed footer actions with the owner's avatar menu for Settings, Show hidden and Sign out.                                                               | Implemented: owner avatar menu contains Settings, Show hidden, Sign out.                                                                                                |
| PC-021 | UX-14 | Cohesive motion: fast visible Latest messages scroll, gentle hover/panel/selection/reorder transitions, cancellable and reduced-motion equivalents.               | Implemented: 240 ms Latest motion, cancellation, hover/panel/reorder feedback and reduced motion.                                                                       |
| PC-022 | UX-15 | Correct composer cursor/focus behavior and add real file pick/paste/drop, upload, send and history/Files support on owner infrastructure.                         | Implemented: caret/focus, private pick/paste/drop, real native file send and Files download. Direct chats only; generated-output indexing deferred.                     |
| PC-023 | UX-16 | Complete keyboard, screen-reader, focus, target-size, contrast, zoom/reflow, async-state and small-screen acceptance across all flows.                            | Automated keyboard, contrast, focus, phone, reflow/resize, async and browser Back coverage passed. Manual assistive-technology/device review remains.                   |

Product terms are **Main Pebble** and **Crews**. Stable internal
`orchestrator`/`teams` fields remain compatible. Existing native identities,
canonical histories and reporting are preserved. A published candidate and an
owner-host update are separate checkpoints.

## Additional avatar feedback — 16 October 2026

| ID     | Report                                                                                                                                                                    | Status                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-024 | Rest looking up/right, wake and follow the pointer over rows/details/settings, restore fluid eye/body motion from the demo, and avoid a permanent frozen completion pose. | Implemented in the shared app/lab renderer: seeded idle breathing/gaze, local eased hover/focus, one scheduler, visible-instance budgets, static reduced motion, completion → rest. Unit, app and dense-roster browser checks cover the change. |

## Implemented in 0.5.0

| ID     | Report                                                                                             | Required result                                                                                                                                                                                                                                                                                                                    | Status                                                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-001 | A pebble removed or hidden by the orchestrator remains in the sidebar until the page is refreshed. | Reconcile the roster automatically after changes from the app, management tools or another Hermes process. Remove stale rows and pins, reconcile an affected selection safely, preserve unrelated drafts and recover missed changes after reconnect. The owner never needs to refresh manually.                                    | Implemented: shared snapshot/watch hints, five-second visible reconciliation, coalesced immediate mutation refresh, selection/draft recovery. Owner host update not performed.                                                            |
| PC-002 | The orchestrator needs to delete an agent, separately from hiding it.                              | Expose a real native deletion proposal through the management tool and owner review. Identify the exact existing profile and explain the native data consequences. Hiding must preserve the profile; deletion must use supported native deletion rather than just removing sidebar metadata. Both update the roster automatically. | Implemented: native lifecycle adapter, exact owner approval/typed name, incarnation guards and durable outcomes. Live crew membership is blocked until the crew is retired in Hermes.                                                     |
| PC-003 | The main interface needs the hierarchy and polish of the supplied dark Grok Bot reference.         | Larger pinned pebbles, compact sectioned rows with role chips and truthful previews, crew avatar stacks, readable conversation bubbles and time grouping, a compact expanding composer, and selected-agent details. Preserve real native chat, approvals, Stop, reconnect, drafts and avatar performance.                          | Implemented: production rail, transcript, inspector, drawers and shared tokens. Pins/order, native previews, scoped read cursors, routine controls, drafts and reading position. See the [implementation record](PEBBLE_CREW_UI_PLAN.md). |
| PC-007 | Hiding a pebble needs a clear, reversible operation that the app honors.                           | Support native hidden metadata, Show hidden and Unhide without changing personality, history, tools, routines or crew membership. Distinguish Hide from disabling Bot Mode and deleting the native profile.                                                                                                                        | Implemented: native hidden metadata, Show hidden, Unhide and owner-reviewed model proposals; native profile/personality/history remain intact.                                                                                            |

PC-001 verification must cover an unselected and selected pebble, a pinned
pebble, an externally initiated change, a missed event during disconnect, and
changes on a second browser. An action completed by the app or its management
tool should reconcile immediately after confirmation. The target for external changes is six seconds on a visible healthy client,
with an authoritative refresh after reconnect. Do not repeatedly query model
access to refresh the roster.

PC-002 must distinguish hiding, disabling Bot Mode and deleting the native
profile. A model cannot approve its own destructive proposal. Target identity,
owner approval, active work, orchestration/reporting links, native room
membership, canonical history and profile assets need explicit handling before
the operation is offered. Uncertain results require reconciliation; do not
automatically replay deletion. No owner's agents have been deleted by this work.

## Earlier implemented reports

| ID     | Report                                                                                                                | Implementation                                                                                                                                                                           | Deployment status                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| PC-004 | “Set up your agent” does not say whether the agent is existing or new, or which agent it is.                          | 0.4.2 source displays the detected native name, such as “Customize Aurora,” and explicitly identifies the existing primary Hermes agent. The form edits its handle and avatar.           | Published in 0.4.2 and verified locally; the owner's running installation has not been upgraded by this work. |
| PC-005 | Product naming was undecided and placeholder branding was used.                                                       | The owner chose Pebble Crew and pebblecrew.com. Repository renamed to enterkey-io/pebble-crew; maintained branding and links updated. Existing repository/setup/download links verified. | Repository rename complete; app branding is part of 0.4.2.                                                    |
| PC-006 | Excess setup text and oversized textual shape/color controls; the primary avatar could open as a static native image. | Published 0.4.1 uses concise forms, an animated iris default, shape thumbnails, color swatches, a matching preview and a neutral photo-upload state.                                     | Published and tested locally; updating an owner's installed copy remains an installer action.                 |

The 0.5.0 release is a development preview. No remote owner installation has been
updated by this work. Local evidence is recorded in
[the 0.5.0 verification report](compatibility/preview-0.5.0-local.json).
