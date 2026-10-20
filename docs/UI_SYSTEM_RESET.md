# Pebble Crew UI system reset

Date: 2026-10-16. Baseline inspected: `38f959b`. Status: implementation contract, **not visual approval or completed implementation**. This supersedes conflicting presentation recommendations in the starter design system and previous UX implementation plan. Native identity, security, history, approvals and transport contracts remain authoritative.

## Work and evidence

- [x] Ground: inspect the actual React, CSS, native operation boundary and supplied reference.
- [x] Sketch: compare three complete foundation candidates in this single architect review.
- [x] Decide: select concrete components, ownership and interaction contracts.
- [ ] Implement: parent engineer builds the staged slices below.
- [ ] Review/scrap: independent reviewer drives the finished build; revise a failing foundation before extending it.

Delivery states must remain separate:

| State       | Evidence required                                                                             | What it does not establish                                              |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Designed    | This contract plus element/state inventory and explicit decisions                             | Working UI or validated native behavior                                 |
| Prototyped  | Running isolated reference imports the actual shared components; synthetic data is identified | Production route migration, native search or owner-instance correctness |
| Implemented | Production consumers use the new components/state owners; old competing paths removed         | Visual/interaction acceptance                                           |
| Verified    | Independent finished-build review with viewport/state evidence plus relevant automated checks | Untested installations or unsupported native capabilities               |

Since 0.7.1, `ui-lab.html` imports the installed app entry. Separate reference screens were removed after they diverged from the product. Review and acceptance must exercise the actual routes and theme.

The architect/how/why grounding workflow was performed inline as requested: no further agents. The reference image was inspected locally, never uploaded. It supplies evidence for density, three clear regions, quiet surfaces and compact controls, not permission to copy its private content or every detail. Repository design documents are historical intent. Statements such as “completed” in them do not establish that the user experience passed review. This review did not access a private owner instance. Runtime observations, when available, belong in the companion checklist with build identity and evidence paths.

Baseline rendered evidence inspected locally: `artifacts/ui-reset/baseline/{chat,search,settings,new-pebble}.png`, captured by the parent from the actual production React bundle with a synthetic API fixture at localhost8093. These confirm the expanded search field changing rail content geometry, pinned menu/face overlap, front-facing flat avatars, heavy Settings form enclosure and inspector pill tabs with stacked separator lines. `geometry.json` shows the first pinned avatar rectangle x79.67–155.67/y84–162 and action rectangle x125.5–165.5/y74–114: overlap is approximately30×30px. This is evidence of that fixture, not verification of owner installation. The New pebble capture shows the choice screen, **not** the Add existing list; that list still needs direct rendered review. No baseline motion duration was measured from these still images.

### What the application actually is

`package.json` currently pins React/React DOM 19.3.0 and Vite 8.3.4. The inspected baseline has no shadcn component installation, Radix, Base UI, Tailwind or Motion dependency. React owns the view; bespoke CSS owns presentation; handwritten code owns menu collision, keyboard navigation, focus containment and animation.

`main.tsx` imports `style.css`, `chat/chat.css`, then `ui/design.css`. Each declares overlapping global/button/input/layout rules. `design.css` is approximately 1,500 lines and contains both shared primitives and page patches. Later rules win only when specificity permits; changing a token does not remove earlier geometry. `App.tsx` owns connection/session lifecycle, native events, selected entity, drafts, optimistic messages, scroll behavior, uploads and shell visibility in one component. A new local visual state can therefore interact with a transport update without an explicit contract.

Current runtime path: owner session → capability-bound client → roster/workspace and selected native chat → native history/events → `conversation.ts` projection → `Transcript`. Owner-local mutations preserve native authority. Keep this direction. Presentation should consume normalized records and capabilities, never infer authorization from whether a control is visible.

### User reports traced to source

| Report                                    | Source observation                                                                                                                                                                                                                                                            | Required correction                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings remains poor                     | `WorkspaceSettings.tsx` composes raw select/buttons with `FormSection`; `style.css` styles `.settings-panel`, while `design.css` adds `.entity-page`, nested cards, broad form rules and last-child primary-action rules. There is no shared field/row/button variant system. | Rebuild Settings from the actual shared components; flat settings sections, one form width, explicit actions. Delete competing selectors as each consumer moves.                                                         |
| Add existing remains poor                 | `AgentPicker.tsx` has its own heading/search/list/footer and raw controls. Both legacy and new CSS target `.agent-picker`/`.agent-option`; the picker lives inside a transcript layout.                                                                                       | A bounded selection dialog with fixed header/footer and one scrolling list; native enrollment behavior retained.                                                                                                         |
| Row overflow sits over text               | `.pebble-menu` is absolutely positioned; `.pebble-open` only reserves 32px although trigger width is 40px. Parent button padding and row rules compete.                                                                                                                       | A real action column, no absolute positioning; trigger and label never share a grid cell.                                                                                                                                |
| Pinned overflow sits on avatar            | `.pinned-tile .pebble-menu` is top/right over the entire tile; avatar and menu have no distinct reserved areas.                                                                                                                                                               | Dedicated action strip separate from avatar region.                                                                                                                                                                      |
| Search enlarges rail and misses content   | `Rail.tsx` conditionally inserts `.chat-search` after the toolbar and filters name/handle/role only. It does not search messages/files/routines.                                                                                                                              | Search becomes a global overlay with explicit result kinds and coverage, independent of rail height.                                                                                                                     |
| Send jerks; time appears later            | `App.send` appends `{role,text,files}` without ID/time, then history replaces messages. `Transcript` uses `pending-${index}` until a native ID arrives and conditionally inserts timestamp/date divider. `App` hard-sets scrollTop when messages/stream change.               | Stable local presentation identity, immediate local submission time, permanent metadata slot, authoritative reconciliation and one viewport owner. The reported ~3s delay is user evidence, not a measured latency here. |
| Copy is text near time                    | `Transcript` always renders `CopyMessage` inside `.message-meta`.                                                                                                                                                                                                             | Dedicated icon action with tooltip; time occupies its own reserved metadata position.                                                                                                                                    |
| Attach should be + → File/Photo           | `App` renders an attachment icon directly opening one hidden file input.                                                                                                                                                                                                      | Shared menu with explicit File and Photo choices, existing upload adapter retained.                                                                                                                                      |
| Details tabs oversized/pill/dividers      | Bespoke Tabs inherits global button height/radius/padding; `.ui-tabs` adds background selection and border-bottom; inspector patches add another size.                                                                                                                        | Explicit compact underline variant, equal tab slots, no container divider.                                                                                                                                               |
| Too many section lines                    | Rail footer/header, tabs, disclosures, nested cards and role/routine regions independently add boundaries.                                                                                                                                                                    | Surface and spacing establish hierarchy; retain only major region boundary, field borders and meaningful destructive separation.                                                                                         |
| Details closes out of sync                | `App` separates `details` from timeout-driven `detailsPresent`; `.has-details` immediately changes grid columns while absolute panel exits for 180ms.                                                                                                                         | One reserved-width animation owns main/panel geometry until exit completion.                                                                                                                                             |
| Avatar still flat, weak/asymmetric travel | `renderer.ts` moves one `face` group by ±6/±5; eye width remains identical; ready pose offsets are only 3.4/-2.8. Pointer normalization uses avatar bounds even when listener root is a much wider row.                                                                       | Explicit yaw/pitch projection, near/far eye scaling and whole-body response; normalize against interaction bounds so both directions are reachable.                                                                      |

The common failure is split ownership: three stylesheets define one control, two booleans define panel presence/geometry, pending and native records define one message, and a pointer surface is different from its normalization surface. A new color sheet cannot fix these relationships.

Secondary update paths matter during migration. `App.handleEvent` clears the streaming text on `message.complete` before awaiting history refresh, so a final-response presentation slot must bridge that interval instead of disappearing. The roster refresh runs every5s with failure backoff and on focus/visibility; it can refresh native history and replace pin order. Group chats independently poll every2s, paginate through the native cursor and retain only1,000 events in browser memory. Those are distinct authoritative update paths, not a global search index. `pinPebble` already serializes revision-bound mutations and displays local intents until roster reconciliation; preserve that authority and rollback model while replacing FLIP. `observedHistory` and `acknowledgeRead` deliberately require covered native history, visible document and following-latest state; a new search index or animation must not bypass them. These source observations establish migration constraints, not measured UI timing.

## Foundation decision

| Candidate                                             | What it solves                                                                                                              | Costs/limits                                                                                                                                          | Decision                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Retain bespoke primitives + disciplined CSS           | Small immediate dependency footprint; all appearance editable.                                                              | We still own focus containment, collision, portal stacking, roving keys, typeahead and exit interaction. Existing failures recur at these boundaries. | Reject as the foundation. Keep domain components and avatar engine, not hand-built interaction primitives. |
| Actual shadcn/ui Radix components + Tailwind + Motion | Repository-owned component source, semantic theme/variants, proven primitive focus/menu behavior, current Vite integration. | Generated components require ownership and adaptation. Default styling is not the product design. Motion does not decide layout or scrolling policy.  | **Choose.** One installed direction for this reset.                                                        |
| shadcn/Base UI + Tailwind + Motion                    | Viable unstyled accessible React foundation with composable positioning and interactions.                                   | Also needs a complete migration and product design. Combining it with Radix increases composition/state conventions without a demonstrated need here. | Viable alternative, not installed alongside Radix. No claim that it is technically inferior.               |

Use the **actual Radix registry source** from shadcn in `apps/web/src/components/ui/`, not locally invented controls described as “shadcn-style.” Install the dependencies required by those generated files, `motion` and `lucide-react`; configure Tailwind through the existing Vite builds. Record exact resolved versions in the lockfile and `components.json`, plus registry provenance. No framework swap, Next.js conversion or remote font/CDN. Inspect generated diffs; do not replace existing build configs wholesale with scaffold examples. Verify React 19 compatibility against resolved peer dependencies and the production build, not a generic compatibility claim.

The official [shadcn Vite instructions](https://ui.shadcn.com/docs/installation/vite) support adding components to an existing app and integrating Tailwind. [Radix Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu) exposes portal, alignment, collision and keyboard behavior. [Base UI](https://base-ui.com/react/overview/about) is a credible unstyled accessible alternative. [Motion presence](https://motion.dev/docs/react-animate-presence) retains exiting elements; [Motion layout](https://motion.dev/docs/react-layout-animations) offers transform-based layout animation. Those mechanisms still require the geometry and state policies below. Sources checked 2026-10-16.

### Theme and ownership

One root theme provider owns semantic tokens for the entire product including owner login, onboarding and portals. Portals mount into a themed overlay root; there must be no light unthemed popup in the dark app. Source theme values live in one stylesheet, mapped to shadcn tokens. Feature code consumes roles, not hex values. Component dimensions live in component variants, never global `button`, `label`, `form`, `header` selectors.

Target dark surfaces: canvas `#0c0d0e`, rail `#141516`, inset `#181a1c`, elevated `#202224`, hover `#292c2f`, selected `#303438`; foreground `#f3f4f5`, secondary `#b2b7bc`, muted `#90979e`, border `#303438`, focus `#a9cdf5`. Primary actions use the neutral light/dark theme in `ui/foundation.css`; the unapproved terracotta accent has been reverted. Error/success colors are semantic and accompanied by text/icon. Confirm contrast on actual composited surfaces; these values are a starting implementation target, not a measured conformance claim.

System font stack only. UI base 14px/20; message body 15px/23; title 20px/28 weight600; section 14px/20 weight600; metadata 12px/16. Weight400 body, 500 controls, 600 identity. No 10px copy. Space scale 4/8/12/16/20/24/32/40. Radius 6 small controls, 8 fields/buttons, 10 menus, 12 dialogs/panels, 18 composer, 16 message bubbles. A pill is reserved for compact status/chips, never a generic tab or section. One icon family: Lucide, stroke1.75, 18px standard, 16px metadata, 20px toolbar. No text ellipsis as a menu icon.

Z layers: content0, sticky10, desktop panel20, popover40, modal overlay60/content61, nested confirmation80/content81, tooltip100. Radix controls stacking within the active modal; page code must not invent z-index220 patches. Portaled menus inside dialogs must remain within the focus ownership expected by Radix; test nested select/menu behavior.

### Cross-platform boundary

Keep semantic token names and values, component states, geometry rules, motion timing/reduced-motion intent, identity and reconciliation contracts, and pure avatar projection math portable for future Mac, Windows and iOS clients. The current web theme is the token implementation; preserve a platform-neutral token schema and documented units so later adapters can generate native color, spacing and typography resources without redefining meaning. Avatar projection takes numeric pose/shape inputs and returns numeric geometry; it must not depend on React, DOM, SVG nodes or Motion. The web renderer and scheduler adapt that result to SVG; another renderer may consume the same mathematics and test vectors.

shadcn/Radix components, CSS/Tailwind and Motion are **web DOM implementations**. Their React controls, portals, focus handling, pixel layout and animations are not reusable SwiftUI or other native UI code. Future native clients should implement the shared behavior and visual intent using their platform’s accessibility, keyboard, touch, safe-area and lifecycle conventions; web pixel values are reference geometry, not a requirement to ignore native scaling. A desktop web container can reuse the web UI, but that is a separate product decision. Do not select all future app frameworks now or promise native code reuse that this foundation does not provide.

## Geometry and composition

At ≥1400px: 304px rail / flexible conversation / 0–320px docked details. At1024–1399: 280px rail / flexible conversation / 0–288px docked details. At768–1023: navigation moves to a left sheet, while conversation and288px details remain adjacent. **Details never becomes a modal overlay.** Below768: the details region expands to the viewport width and the conversation contracts to0; it is an integrated details view with a Close action, not a modal focus trap. Preserve the open preference across conversation changes. On phone the contracted main region is inert; closing restores focus to the title after the layout commit. The sole header toggle is the pebble/crew name and title, with an understated directional chevron; no duplicate settings button. Shell height100dvh and min-height0 at every nested flex/grid scroll boundary.

Header64px fixed; rail toolbar64px fixed; footer56px minimum plus safe area. Transcript and rail list scroll independently. Composer stays in the conversation layout below transcript, never a viewport-wide fixed overlay. Conversation gutters24px desktop,16px tablet,12px phone; composer follows same content max width. Search opening cannot change any rail/header rectangle.

Rail row grid: 44px avatar / minmax(0,1fr) text /32px actions, gap10, horizontal padding8, min-height68. Two text lines: 14px name+optional compact role, 13px preview. Role truncates before name; selected background quiet, no large card border. Fine-pointer actions32×32; coarse44×44 with the action column expanded to44. The action region is a sibling of the navigation button, never nested interactive content. Accessible name says “Actions for {name}.”

Pinned tiles:112px wide, at least128px high; top action strip32px, avatar region56px, name20px, optional role18px. Content and action regions never overlap; Main Pebble badge belongs to avatar bottom-right and does not become an action. Two tiles fit the304px rail with16px outer gutters and12px gap. Additional pins wrap; they do not enlarge toolbar. Avoid motion that scales the face between row and tile sizes.

Settings: normal main-page content, max760px,24px side padding. Header “Settings”; Account / Connections / Requests use underline tabs. Section headings precede flat field stacks with24px between sections; no bordered card wrapping every form. Fields max520px; service rows full width, icon/name/brief status/action on one line when possible. Pebble selector appears once above connection content. Save is an explicit primary variant; never inferred from last-child. A destructive subsection has a single separator and explicit consequence, not repeated warnings. Existing dirty drafts, scope selection and pending requests survive roster refresh.

Add existing: Dialog title “Add existing pebbles”, one short supporting line only if needed. Desktop width560px, max-height min(680px,85dvh), header/search/footer fixed, results the sole scroll region. Search height40. Result row64px: checkbox18 + avatar36 + name/secondary text, disabled “Added” state distinct from selection. Footer shows selected count and Cancel / Add N pebbles; preserve selections across filtering. Loading/empty/error occupy the list region, not a replacement screen. Partial enrollment retains per-profile outcomes and offers refresh before repeat; no new native profile is created by this flow.

## Owner refinement: organization, editor and activity

These requirements supersede the earlier modal-tablet details and row-width
pointer-gain proposals. They are implemented in the isolated reference; real
native routes remain a separate migration.

- Sections are owner-created rail organization: create from +, rename, collapse,
  reorder and move pebbles/crews through menus or desktop drag. Provide keyboard
  menu equivalents to every drag operation. Store order/collapse separately
  from profile identity and chat history.
- Clicking a Crew opens its conversation. Crew settings belongs in its
  three-dot menu. In production, bind the Crew to a native group-conversation
  identity; preserve the distinction between organization metadata and native
  room membership/permissions. Do not simulate a crew by broadcasting individual
  prompts. Changes to actual native membership must show their real outcome.
- Pebbles can be reordered or moved between sections and Crews. The reference
  models one rail placement per unpinned pebble; pins retain their underlying
  placement. Before native migration, define how rail placement and actual
  conversation membership map, so rearranging a section cannot silently grant
  access or erase native participation/history.
- Editor height is fixed within the viewport (desktop600px maximum); header,
  tabs and footer stay stationary. The selected tab body owns scrolling.
- Shared popup sources explicitly use dark surface, no border and no default
  outline; the prior layer override lost to Tailwind's border utility. Retain
  focus indication on selectable items. Use thin, muted, transparent-track
  scrollbars throughout; keep them operable and honor forced colors.
- Activity occupies one stable line with plain Thinking or Working text and a
  slow recurring text shimmer. No dots, icon cluster or per-tool empty bubbles.
  Reduced motion uses static text. One polite live region announces state
  changes, not animation frames. In native routes derive these states from
  actual run events; keep pending tool/approval details available separately.
- Keep the product title unchanged while runtime portability is investigated.

## Element / variant / state inventory

All controls share hover, focus-visible, pressed, disabled and pending states. Focus ring2px with2px offset; disabled uses readable text and removes action, never opacity as the only explanation. Touch targets44px minimum; fine-pointer compact32px controls have at least24px actual target. Pending operations preserve control width. Native capability unavailable is distinct from loading.

| Element                  | Variants and dimensions                                                        | Interaction/state contract                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button                   | primary, secondary, ghost, danger; sm32/default40/coarse44; padding12/16       | Explicit variant; no positional selectors. Pending spinner replaces leading icon, label remains.                                                                         |
| IconButton               | ghost/outline/danger;32/40/44; icon18                                          | Accessible name required; tooltip for unclear icon; expanded/pressed exposed.                                                                                            |
| Field                    | input/select40, textarea min96; label14; gap6; hint/error13                    | Label bound by ID; description/error IDs; invalid state; secret reveal explicit; Enter behavior belongs to form.                                                         |
| Select/combobox          | shadcn Radix Select; searchable picker only for long lists                     | Trigger same field style; popup viewport bounded; full keyboard/typeahead; selected ID retained on refresh.                                                              |
| Checkbox/radio           | 18px visual,44px row hit area                                                  | shadcn primitives; no click-on-label state hacks; mixed selection only where meaningful.                                                                                 |
| Switch                   | 36×20 visual inside44px hit row                                                | shadcn Switch; per-routine pending, rollback or uncertain state; label names routine, not only On/Off.                                                                   |
| Dropdown menu            | min200/max280; padding4; item36 fine/44 coarse; gap6 to anchor                 | Radix Portal + side bottom + align end + collisionPadding8; composer side top/align start. Arrow keys/Home/End/typeahead/Escape; selection closes unless a real submenu. |
| Tooltip                  | max240,12px/16;8px padding                                                     | 500ms hover, immediate focus; Escape dismiss; never required to know enabled/disabled reason.                                                                            |
| Dialog/AlertDialog       | small440/standard560/large720;24px padding                                     | Radix semantics/focus; title required; scroll body only; explicit destructive action; unsaved-change guard before dismissal.                                             |
| Sheet                    | left navigation/right details                                                  | Radix Dialog semantics; shared motion/presence; Back closes top overlay; focus restored to live trigger/fallback.                                                        |
| Tabs                     | underline36px visual, equal flex slots in inspector; content width in Settings | Radix Tabs roving keys; no pill/background/bottom rule;2px active underline; panel begins16px below. Touch target44.                                                     |
| Search                   | Dialog + Command, width640, max75dvh                                           | Input48, results52–72; explicit type and context; query generation cancellation; coverage text; never filters rail.                                                      |
| List/row                 | rail68, picker64, routine/file56 min                                           | Grid columns reserve actions; long text truncates in summaries, wraps in details; selected/focused/pending distinct.                                                     |
| Badge/chip               | status20, attachment32 min                                                     | Text/icon communicates state; no ornamental borders on every role. Remove attachment has own named action.                                                               |
| Transcript message       | body15/23, padding12/16, radius16, gap16                                       | Stable render key, immediate timestamp lane20, grouped date label24 only on true day boundary, native source retained.                                                   |
| Message actions          | Copy icon16 in32px target outside bubble aligned under end                     | Hover/focus reveal without layout change; always reachable on touch; copied check for1.5s; failure actionable.                                                           |
| Composer                 | min56; textarea max160; +/send40; padding8                                     | Enter sends, Shift+Enter newline, IME composition never sends; exact capability and upload state gates send.                                                             |
| Attachment menu          | Plus → File / Photo with matching icons                                        | File uses current generic file policy; Photo accepts supported image types; no forced camera; cancellation leaves draft unchanged.                                       |
| Attachment/file row      | name, size/status, remove or download; thumbnail40 only images                 | Uploading/ready/error/uncertain, retry/removal; bind to draft+session incarnation; preserve server ceilings.                                                             |
| Empty/loading/error      | compact row/panel variants                                                     | One sentence + one useful action; skeleton matches geometry; no endless spinner without result/error transition.                                                         |
| Notice/toast             | inline for blocking/field errors; toast for nonblocking confirmation           | No success before acknowledgement; error remains until resolved; polite live status, alert only when attention required.                                                 |
| Disclosure/activity      | compact text+chevron, expanded content inset12                                 | Native tool content preserved; no fake thought chain; use shadcn Collapsible; open state stable through stream updates.                                                  |
| Editor                   | shared Field/Select/Tabs/Section/Actions                                       | Name/handle/role/appearance/reporting/Crew controlled drafts; revision conflict explicit; no server refresh overwrite.                                                   |
| Approval/request         | structured summary + expandable precise details + explicit actions             | Native request ID/fingerprint retained; approval scope/consequence visible; model cannot approve itself.                                                                 |
| Connection/account/setup | same controls and spacing as Settings                                          | Preserve login/setup proof/auth scope; no dependency on vendor relay or remote assets.                                                                                   |
| Computer                 | capability-gated panel with status/open/stop controls                          | Do not imply live desktop availability from a tab; existing native transport/lease authority retained.                                                                   |
| Markdown/code/table      | existing safe renderer; code horizontally scrollable                           | Copy code is icon action; content cannot widen shell; links/downloads retain safe handling.                                                                              |

## Motion and viewport ownership

Install `motion`; root `MotionConfig reducedMotion="user"`. This supplies a shared mechanism, not a promise that all transitions are now good. Product motion has four tokens: feedback120ms, overlay160ms, shell240ms, reorder220ms; easing cubic-bezier(.22,1,.36,1), no bounce. Avatar has its own time-based projection scheduler. Do not animate `all` or run CSS and Motion on the same property.

### Desktop details: one physical width

`ConversationShell` owns a single Motion value `detailsWidth`, target0 or the responsive panel width (288/320px; full viewport below768px). Layout is grid columns `railWidth minmax(0,1fr) detailsWidth`; the details child has fixed320px width inside an overflow-clipped reserved column, positioned at that column's x0 with **no additional translation**. For viewport widthV and reserved widthW, column left isV−W, already equal to the main right edge. Animate width over240ms from the current interpolated value. Keep the child mounted until width reaches0; no timeout separate from animation completion. Opening during close reverses from current width. A focused descendant is moved to the toggle before it becomes inert; the closing panel is inert while still visibly exiting. Main/header/composer geometry uses the same grid, never an independent width animation. Do not scale text with generic `layout` on the whole conversation.

Accepted implementation correction during prototype review: the initial sketch added child translation `panelWidth−detailsWidth`, which double-counted movement and hid the child during part of entry. The parent implementer identified the error; the architect accepted the correction above. Framewise invariant: `panel.left === main.right`, `main.right + reservedWidth === viewportWidth`, child width constant320 and opacity1. This replaces the initial formula; do not retain both alternatives.

Animating one bounded shell dimension is deliberately chosen over transform-only panel decoration: text reflows while real available space changes. Measure frame cost with long messages; if unacceptable, redesign the shell using a measured FLIP strategy with explicit text correction, not an overlay masquerading as layout. The acceptance criterion is coordinated physical geometry.

### Transcript anchoring and send

`useTranscriptViewport` is the sole scroll writer. State is either `{kind:'following'}` or `{kind:'reading', renderKey, offsetPx}`. Scroll within96px of bottom means following; upward wheel/touch/keyboard cancels programmatic scroll immediately. While reading, capture first visible message+offset before history prepend, shell resize, composer height change and font/media resize; restore against current geometry each animation frame/ResizeObserver batch. While following, maintain bottom during growth with at most one write per frame. Do not run browser smooth scrolling plus a manual animation loop. Native read cursors advance only through the existing validated visible-history path, never from search, cached results or programmatic selection.

On send, construct `{renderKey:localUUID, submittedAt:Date.now(), delivery:'sending'}` synchronously; clear/move draft to a recoverable pending record immediately after validation, rather than waiting for network completion to shrink composer. Append one message with its metadata lane already present. Animate only this newly submitted bubble opacity0→1/y8→0 over160ms. Do not animate all existing messages or later native reconciliation. If the user was reading, explicit send may move to latest using one interruptible180ms viewport transition; stream growth then follows normally.

Native acknowledgement adds native ID and authoritative time to the same presentation record; `renderKey` never changes. Keep local time in the same lane if server time is absent, labeled accessibly as submitted time; do not invent a server timestamp. If authoritative date differs, update the date grouping atomically while preserving viewport anchor. Never pair repeated identical messages by text alone. Prefer echoed request/event ID; otherwise use the existing exact session/generation send reconciliation boundary with a single outstanding send and observed native evidence. If that evidence cannot prove identity, retain an explicit uncertain record and offer inspect/reconcile, not a blind retry or invented success. If native transport cannot correlate normal text sends, that is a prerequisite to robust reconciliation, not a CSS problem.

Streaming occupies one stable response slot keyed by run identity; deltas append text without repeating entry motion or animating height on every token. Final native record replaces content in that same slot. User can scroll up without being pulled down; a compact latest button appears with unseen count only when accurately known. Send error preserves draft/files, distinguishes definite rejection from uncertain outcome, and prevents unsafe replay. Connection/session generation changes cancel only view work and never route a late result into a different chat.

### Other motion

- Menus: opacity + translateY ±4px over120ms, transform origin from Radix placement; collision changes remain anchored. No zoom splash.
- Dialog: opacity + y8 over160ms; backdrop opacity0→.55. Sheet: translate from its edge200ms. Exits retain focus/scroll lock until completion; browser Back uses the same guarded close path.
- Pin/unpin: authoritative identity has one render location; Motion layout position/reorder220ms for siblings, a temporary shared avatar presentation may travel but must not duplicate focusable buttons or alter owner identity. Failed persistence restores source ordering and announces error. Keyboard Move earlier/later remains available.
- Tab change: content opacity120ms only; no panel-height animation or moving underline across unrelated pages. Route/editor entry similarly subtle.
- Reduced motion: widths and positions change synchronously as one layout commit; no translation/scale/idle gaze/pin travel. Focus and anchor preservation still apply; optional opacity ≤80ms. MotionConfig alone does not control the avatar or manual scroll, so those read the same preference.

## Avatar projection contract

Keep the shared `AvatarScheduler`, shape paths and owner-provided colors/photos. Replace flat `gazeX/gazeY` face translation with a pure `projectFace({yaw,pitch,blink,expression})` result. This is stylized2.5D projection of the existing pebble, not a new face design or WebGL dependency.

Interaction root is the hovered/focused row, tile or explicit avatar preview. Cache the avatar rectangle on entry and invalidate through ResizeObserver/scroll. Equal distances from the avatar center must give equal turns: `u=clamp(dx/max(12,avatarWidth/2),-1,1)` and `v=clamp(dy/max(12,avatarHeight/2),-1,1)`. Root edges gate attention but do not set the gain. The earlier normalization against each side's remaining row width made rightward motion weak on left-aligned avatars; this is superseded. Desired yaw is32°*u and pitch22°*v; positive yaw looks screen-right, positive pitch looks down. Saturate symmetrically at the limits. Rest is yaw+18°, pitch−12°, with small idle variation. Verify symmetry using equal face-relative pointer offsets, not only the distant row edges.

In100×108 SVG coordinates, center(50,49), face plane z=24, eyes at x=−10.5/+10.5,y=0, focal distance180. Rotate a point by yaw: `x1=x*cosθ+z*sinθ`, `z1=−x*sinθ+z*cosθ`; pitch: `y2=y*cosφ+z1*sinφ`, `z2=−y*sinφ+z1*cosφ`; project `s=180/(180−z2)`, `screen=(50+x1*s,49+y2*s)`. Positive yaw makes the left eye nearer using this convention; derive near/far from z2 instead of assigning by screen side. Clamp face center to the shape's safe region, not each eye independently; keep projected eye gap≥8 SVG units and both eyes inside the body silhouette at extrema.

Eye capsule base width7,height17. Perspective scale applies to each eye; add art-directed depth contrast: nearer eye height factor `1+0.14*abs(sinθ)`, farther `1−0.22*abs(sinθ)` and farther width factor `1−0.18*abs(sinθ)`. Both shorten with pitch by `max(.72,cosφ)`; tilt capsules by `−.55*θ + .5*φ` degrees and apply blink as the final height multiplier. This stronger tilt (about−15.9° at rest) replaces the initial nearly vertical capsule prescription after the first visual review. Verify these parameters across each shape; do not treat formulas as visual approval. At |yaw|32°, target near/far height ratio≥1.15; at pitch22°, visible shortening≥7%. At rest ratio≥1.05 is the intended legibility target.

Body response: translate x by `2.5*sinθ`, y by `1.5*sinφ`, roll by `−4*sinθ` degrees, horizontal scale `1−.04*abs(sinθ)`, vertical scale `1−.03*abs(sinφ)`. Face and body stay visibly coherent; body moves less than face. Use the actual displayed pose as transition start on interruption. Time smoothing: `a=1−exp(−dt/85ms)` for pointer,120ms returning to rest; clamp dt at50ms after suspension. Smooth yaw/pitch first, derive eyes/body from that pose. Never ease each eye independently into inconsistent geometry.

Captured-pose evidence: independent review of `artifacts/ui-reset/reference/avatar-projection-atlas.png` found correct directional changes and visible near/far perspective across five shapes at rest/eight directions, with no visible crossing or clipping in the captured open-eye poses. Beacon up-left was a blink frame and needs an open-eye clearance check. This supports the reference projection direction, not all sizes, animated interpolation or performance; the companion checklist records that boundary.

Performance: one pointer listener per active interaction surface; pointer events update target only, no React renders; geometry read at most once per frame after invalidation; no read/write alternation per eye. Active avatar60fps, visible idle max24fps, crowded idle15fps; offscreen/document-hidden parked; photos static. Preserve one scheduler across mounts. Test100 mounted/20 visible, and1 active. Target p95 scheduler work<4ms on the recorded review machine, no monotonic observer/listener growth over50 open/close cycles. Record hardware and sampling method; do not call this measured until observed. Reduced motion uses static rest pose and status indicators, with no pointer travel.

## Global search: honest coverage and authority

The inspected bridge exposes names/roster, per-session `chat.history`, `routines.list` and session file metadata. No global full-text search operation was found in `plugins/bot-web/operations.py`, `server.py` or attachments. Search cannot honestly promise all private files, all historical messages or arbitrary host content from this frontend alone.

Required product outcome is **real global search across all authorized profiles and native chat histories, system entities, routines and supported files**. If the current bridge lacks this capability, backend work is in scope; broadening a name filter is not completion. The staged approach below permits a bounded prototype before integration, not reducing that outcome. Any file content that cannot be safely or meaningfully indexed must be clearly excluded by type/coverage; “all files” never means unrestricted owner-host filesystem search.

Phase1, included in the first functional slice but explicitly incomplete: overlay searches currently loaded authorized data for Pebbles, Crews, Group chats, loaded message text, loaded routine name/schedule and loaded file names. Explicit footer: “Searches loaded items. Older chats and file contents aren’t included.” Show coverage per kind when incomplete; query matches only actually indexed fields. A result for a file name is not a file-content hit. Query stays in memory; no telemetry or third-party service. Default empty query shows recent navigation targets and current entities, never fabricated search matches. Use case-folded token AND matching with exact-name then prefix then body match; plain highlighted snippets, never unsafe HTML. At most50 rows per page; preserve deterministic ordering and stable result IDs.

Phase2, required to complete the user's global-search request: owner-local authenticated `search.query` service with bounded indexing or native search where capability verified. Inventory exact authorized sessions without `bot.open` side effects. Server rechecks owner, profile/session incarnation and file association at query and result-open; native content remains native, any derivative index stays on that owner's host with documented rebuild/deletion. No search in secrets, credentials, approval payload secrets, arbitrary paths, tool private analysis or inaccessible profiles. Historical completeness must come from a proven traversal/cursor contract. If native API cannot enumerate/read without opening or marking read, implement a read-only owner-local integration boundary or report the exact remaining blocker; do not silently scan or call the search requirement complete.

Proposed boundary (not a claim the backend supports it): `query({text,kinds,cursor?,limit:50}, signal) -> {hits,nextCursor,coverage,revision}`. Cursor is opaque, bound to query/scope/permission revision, expires and restarts if those change. Search paging cursor is unrelated to native read/event cursors. Coverage is a discriminated result per kind: complete / partial with reason / unavailable. Reject empty or >256-character remote queries; debounce180ms, cancel previous request, reject late query-generation results; show loading after150ms to avoid flicker. Errors preserve query and prior results with stale indicator.

Selection boundary: `onSelect(hit)` closes overlay, routes to the exact live entity, then loads authorized history around native message ID and focuses/highlights it; this navigation may update read state only through normal visible-history logic. If a result is stale/removed/revoked, show “This item is no longer available” without navigating to a similarly named entity. Files open/download through existing authorized file adapter; routines open the selected pebble's details with its routine row revealed. Searching never mutates drafts, opens native sessions implicitly, enrolls agents, changes read markers or starts jobs.

File indexing is bounded to files already associated with authorized conversations. Start with verified text formats and supported text extraction; retain filename-only coverage for binary/unsupported types. Bound bytes, extraction time, concurrency and index size; reject symlink/path escape and executable processing. Search results state the matched field. Deletion, revoked access or changed profile incarnation invalidates cached hits and index entries. Indexing a file must not send it to a model/provider. These are integration requirements to prove against the actual native store, not permission to invent a second canonical history database.

Concrete backend sketch: `plugins/bot-web/search.py` owns query parsing, coverage and a rebuildable owner-local SQLite FTS5 derivative index; `search_sources.py` owns the verified read-only native enumeration/page adapters and permitted file extraction. Keep these separate from browser-owned sessions: current `operations.py` rejects `chat.history` unless `bot.open` first registered that session, so reusing that path to crawl every profile is specifically disallowed. Before indexing, prove an authorized native history enumeration/read surface without UI-open/read side effects. If a native adapter is absent, implement it against supported native contracts and compatibility gates, rather than directly guessing native DB layouts.

Index keys include principal, native profile identity/incarnation, canonical session or room ID, source kind and native row/file/routine ID; content hash/revision supports idempotent upsert and deletion. Native IDs remain the navigation authority. Never store credentials, raw authorization headers or secret connection fields in the index. Server queries intersect candidate hits with currently authorized identities before emitting snippets or counts. Use bound SQL parameters and an escaped literal-token FTS query by default; raw user FTS operators are not silently exposed. Pagination is stable within an index revision, with server-side ranked keyset cursor and explicit restart on scope/revision change. Result responses include current coverage and last-indexed time; a lagging index cannot claim complete current coverage.

Initial conservative worker bounds to validate: two concurrent sources,200 native records/page, up to1MiB extracted text/file and5s extraction deadline, one indexing batch capped at250ms CPU before yielding. Text/PDF extraction must use existing safely supported tooling or decline content indexing. Cancellation and shutdown are checkpointed; no operation advances native read markers. A connection/profile invalidation immediately removes its query visibility, with derivative cleanup afterwards. Exact native page size and available cursor semantics are integration findings to record, not constants to impose on an incompatible native API. Native message snapshots and index body copies must never be used to repair or overwrite native history.

Do not defer all richer search while labeling a names-only filter “global search.” Deliver Phase1 honestly as a milestone, and complete Phase2 as native integration with its own executable coverage/permission gate. A synthetic prototype may illustrate cross-profile hits only when visibly labeled synthetic and recorded as unimplemented backend behavior.

## Module and state contracts

Caller-oriented shape:

```tsx
<ConversationShell rail={<Rail onSearch={search.open} />} details={details}>
  <ChatHeader onToggleDetails={details.toggle} />
  <Transcript items={conversation.timeline} viewport={viewport} />
  <Composer draft={conversation.draft} attachments={uploads} onSend={conversation.send} />
</ConversationShell>
<SearchDialog controller={search} onSelect={navigateToSearchHit} />
```

Names illustrate responsibility, not permission to add pass-through wrappers for every prop. Derive native IDs/records from existing validated domain types rather than exporting new wire-shaped `Record<string,unknown>` bags.

| Module                          | Owns                                                                                     | Must not own                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `components/ui/*`               | Actual shadcn/Radix component source, semantic variants, accessibility defaults          | RPC, selected chat, roster, native permission decisions        |
| `ui/theme.css`, `ui/motion.ts`  | Tokens and shared transitions/reduced-motion policy                                      | Page-specific geometry patches                                 |
| `chat/ConversationShell.tsx`    | Breakpoints, reserved details width, layout presence                                     | Chat history/connection state                                  |
| `ui/OverlayProvider.tsx`        | Active overlay route, Back coordination, close guards/focus fallback                     | Reimplement Radix focus trap or menu collision                 |
| `chat/Rail.tsx`                 | Render roster/order and explicit action slots                                            | Local search input, authoritative pin writes, custom FLIP loop |
| `chat/useTranscriptViewport.ts` | Follow/reading anchor, scroll cancellation/restoration                                   | Native read coverage claims                                    |
| `chat/presentation.ts`          | Stable render identity, delivery state, timestamp display, native reconciliation mapping | Transport replay, permissions or invented native IDs           |
| `chat/Composer.tsx`             | Draft input, attachment menu, IME/keyboard interaction                                   | Upload wire protocol or server file limits                     |
| `search/controller.ts`          | Query generation, scope/coverage and result selection lifecycle                          | Global fetch-all side effects or read cursors                  |
| `search/local-index.ts`         | In-memory searchable projections of already authorized loaded items                      | Persistent copies of owner content or secrets                  |
| `avatar-lab/engine.ts`          | Pure projection/math/activity pose                                                       | DOM reads, timers, React state                                 |
| `avatar-lab/renderer.ts`        | SVG writes, cached geometry, shared bounded scheduler                                    | Business status inference                                      |
| Existing client/native boundary | Identity/generation/auth/history/approval/native mutation outcomes                       | Product CSS and animation                                      |

State sketches:

```ts
type Delivery =
  | { kind: 'sending'; requestId: RequestId; submittedAt: number }
  | { kind: 'confirmed'; nativeId: NativeMessageId; timestamp: number | null }
  | { kind: 'rejected'; reason: string }
  | { kind: 'uncertain'; requestId: RequestId; reason: string };
type PresentedMessage = {
  renderKey: RenderKey; // Created once; acknowledgement does not replace it.
  conversation: ConversationIdentity; // Includes native incarnation/generation.
  submittedAt: number | null;
  delivery: Delivery;
  content: NormalizedMessageContent;
};
type SearchHit =
  | { kind: 'pebble'; id: PebbleId; label: string }
  | { kind: 'crew'; id: CrewId; label: string }
  | { kind: 'group-chat'; id: RoomId; label: string }
  | { kind: 'message'; conversation: ConversationIdentity; id: NativeMessageId; snippet: string }
  | { kind: 'file'; conversation: ConversationIdentity; id: FileId; name: string }
  | { kind: 'routine'; pebble: PebbleId; id: RoutineId; label: string };
```

Brands are constructed/validated at domain boundaries. Do not cast arbitrary server strings into trusted identity types. Local pending content without native ID is not a navigable historical search hit.

## Executable staged implementation

1. **Foundation and proof surface.** Install actual shadcn Radix source, dependencies, Tailwind Vite integration, Lucide, Motion; configure one theme and a development-only component/state page using production components and synthetic data. Include all variants, long labels, focus/disabled/pending/error. Run typecheck/build. Evidence must identify package versions and real component imports. Keep existing install/owner/native package topology.
2. **One vertical slice.** Render the real shell/rail, details, transcript and composer with synthetic bridge fixture. Include two pins, twelve rows across two Crews, one native Group chat, long names, one running response, older history, routines/files, slow send. Implement shared menus/tabs, details geometry, viewport owner, message identity/time and File/Photo menu together. Add Search Phase1 overlay. Capture open/close at0/60/120/180/240ms plus rapid reversal; record send before/after acknowledgement. Do not extend cosmetic treatment to every page until these mechanics pass independent review.
3. **Settings and Add existing.** Move real routes to shared primitives and geometry, then editors/new pebble/new Crew, connections/account/setup/request review. Preserve all dirty/capability/error/native mutation branches. Fixture slow/empty/large-list/partial-enrollment states. Delete replaced primitive and page styles in the same unit.
4. **Avatar.** Implement pure projection + scheduler binding changes behind existing AgentAvatar interface. Use an in-app synthetic grid of all shapes, rest/left/right/up/down and size44/56/88. Verify extremes and transitions visually and numerically. Do not approve from a screenshot of one pose.
5. **Search integration expansion.** Implement owner-local search capability only after proving enumeration, ACL and native cursor boundaries. Add contract/permission tests and bounded runtime evidence. Until then the Phase1 coverage notice remains. No placeholder “everything” results.
6. **Delete and verify.** Remove old Menu/Tabs implementations from `ui/primitives.tsx`, replace Drawer internals with the common Radix shell, remove Rail FLIP, eliminate detailsPresent timeout, retire copied chat/Icon icons. Extract remaining page styling to scoped files/components. Delete duplicate `.icon-button`, `.ui-tabs`, `.pebble-menu`, `.agent-picker`, `.settings-panel`, `.details-panel`, `.message-meta`, global form/button and their late patches from all three old sheets after the last consumer migrates. `main.tsx` has one theme entry plus scoped feature styles; no “reset-v2.css” appended at the end.
7. **Independent acceptance.** Reviewer who did not implement drives the actual production build using the companion checklist, desktop/tablet/phone and keyboard/reduced motion/slow/error cases. Automated tests are necessary checks; neither a passing test count nor a generated design canvas is a visual verdict. Record remaining gaps plainly. No publish/install change is implied by this design review.

Baseline checks: `npm run typecheck`, relevant Vitest for conversation/avatar projections, Playwright fixture behavior, production build, targeted keyboard/axe inspection. Add tests for invariant behavior (stable DOM key/time lane, no duplicate send, no cursor changes from search, coordinated panel/main geometry), not snapshots that merely reproduce CSS constants. Re-run native/security/install smoke tests when shared adapters/build packaging change. Keep before/after evidence local and synthetic.

Scrap trigger: if two slices need independent geometry flags, per-page control patches or caller knowledge of popup internals, stop extending the abstraction. Re-ground ownership and remove the workaround rather than adding another override.
