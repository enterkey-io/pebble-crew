# Pebble Crew design system — starter specification

**Superseded for new UI work.** The owner rejected the implemented direction.
Use [UI_SYSTEM_RESET.md](UI_SYSTEM_RESET.md) and its
[independent acceptance record](UI_RESET_REVIEW_CHECKLIST.md). The specification
below is historical; prior implementation labels do not establish usability.

Date: 2026-10-16. Status: proposed; not implemented or visually approved.
Read the [main-page audit](PEBBLE_CREW_UX_AUDIT.md) first. Its UX-01–UX-16 findings
are the evidence for this system. The [implementation plan](PEBBLE_CREW_UX_IMPLEMENTATION_PLAN.md)
defines delivery and verification. This specification supersedes earlier design
guidance where the latest owner requests differ, without changing native contracts.

## Product contract

Pebble Crew is a coherent, quiet interface over the owner's real Hermes profiles
and native Bot Chats. The default product is one self-installed plugin with a
same-origin web UI and local owner login. No vendor account, storage, relay,
remote fonts, or new infrastructure is required. Hermes can run wherever the
supported installation works; the UI is not specific to Olares. Future paid
Mac, Windows, and iOS clients can reuse the protocol, semantic tokens, state
models, and avatar rendering concepts; web DOM behavior is not a native-client API.

A click must either do the labeled thing or clearly show its real pending,
unsupported, or failed state. Keep copy short and operational. Do not add
marketing headings, filler guidance, fake actions, invented roles, fake usage
limits, upsells, connection promises, or success before authoritative evidence.
Keep valuable native content accessible even when its default presentation is
collapsed. Security and native compatibility are part of interaction design.

## Language and entity model

This is the recommended mapping to reconcile the owner's latest naming request
with current native semantics. Validate the small Crew → Start group chat flow
in review; no broad naming questionnaire or blocking confirmation loop is needed
for planning. Implementation must not silently change stored relationships.

| Product term | Meaning and behavior                                                                          | Compatible storage/native term                                 |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pebble       | A real enrolled Hermes profile with a canonical Bot Chat                                      | Workspace bot/profile identity                                 |
| Main Pebble  | The actual designated primary coordinating pebble; badge conveys designation, not extra trust | `orchestrator` retained internally                             |
| Crew         | A named organizational grouping of pebbles in the rail                                        | Existing `teams` and `team` fields                             |
| Group chat   | A real native shared conversation with explicit participants and its own history              | Native room                                                    |
| Role         | Owner/native-provided title and descriptive responsibilities                                  | Existing role metadata                                         |
| Reports to   | A real management/reporting relation, independent of crew membership                          | Existing manager relation                                      |
| Files        | Verified attachments and generated outputs associated with this conversation                  | Capability-backed file references, not arbitrary host browsing |
| Computer     | A supported native visual session for the selected profile                                    | Conditional native display capability                          |

Rail + opens exactly **New pebble** and **New crew**. New pebble first offers
**Create new** and **Add existing** with one factual line describing each.
New crew asks for a name and current members; Create crew organizes the rail
only. Crew headings contain member rows and a scoped action menu. A secondary
**Start group chat** action chooses 2–6 participants explicitly from current members
(the verified native limit; a Crew itself may be larger)
and shows the resulting native conversation under **Group chats**. It is offered
only after the real room-creation path is implemented and verified.

Existing rooms remain Group chats with stacked avatars and preserved IDs/history.
An optional crew-to-room association belongs in versioned owner-local metadata;
it does not rewrite the room or imply a live membership binding. Native frozen
room membership means editing a crew never retroactively edits an existing group
chat. The group-chat member list is authoritative, not inferred from its crew.
A changed crew can start a new group chat; never silently retire/recreate one.
Removing a crew removes only organization after the exact effect is evident;
it must not delete profiles, chats, memories, or reporting relations. Preserve
existing ungrouped placement and stable member order on migration.

Use Main Pebble in labels, accessible names, help, error text, tool descriptions,
skill and prompt prose. Keep RPC names, schema keys, compatibility fixtures,
migration fields, and historical quoted protocol identifiers unchanged unless
a separately versioned migration requires it. Never global-replace source keys.

## Information architecture and layout

Desktop: rail / conversation / optional details. Keep the present chat header,
adding a sliders icon with Show details / Hide details accessible name,
`aria-expanded`, and `aria-controls`. Details has a visible Close details button.
The user can close it at every viewport size. Opening it must not steal composer
focus on desktop; closing from inside returns focus to the trigger.

Start with a 340px rail (up to 380–400px on genuinely wide screens), a flexible
conversation with 720px reading measure and 760px composer measure, and a 304–336px
details panel. These are initial tokens, not absolute width requirements. Show
three columns only when the remaining conversation width is at least 480px;
prefer details overlay before compressing the message area below that. Use
container/available-space behavior rather than assuming device from user agent.

At tablet widths the details panel becomes a right modal drawer; at phone widths
the rail is a left navigation drawer and the conversation uses the available
width. Preserve current selection, draft and reading position across all changes.
Use 100dvh and safe-area insets; software keyboard must not cover Send/Stop. Do
not solve overflow by hiding essential content. Long code and true data tables
can scroll within labeled regions; ordinary text and forms reflow.

Rail order: compact title/search/+ row; centered pinned shelf; ungrouped pebbles
and crew headings/member rows; Group chats; single owner footer trigger. Keep
important connection failure state visible near the conversation/footer even
when the account menu is closed. Search applies consistently to both kinds of
conversation and produces a truthful combined empty state.

Details order: compact identity and attached Main Pebble star; name, real role,
handle if useful; Edit pebble; tabs **Routines**, **Files**, **Computer**. Routines
is a tab, not a section heading above the other tabs. Tab visibility is determined
by the selected entity's verified capabilities. Crew/group details show real
members and supported conversation content; do not invent shared routines or a
shared desktop. Idle Ready is absent. Working, needs approval, failed, unavailable,
and stale statuses appear only when they explain a meaningful current state.

Settings is a focused destination with a title, explicit navigation and a return
to the prior conversation. Retain real Account and supported Connections controls;
add preferences only as implemented, such as motion/panel choice. Pebble editing
is an entity editor from row/details actions. Requests get a dedicated review
view reachable from the persistent pending-review indicator and Settings if useful.
Creation and crew organization do not live in Settings.

## Foundation tokens

The installed theme is owned by `apps/web/src/ui/foundation.css`. Primary actions
use the approved neutral palette: dark `#ececeb` with `#1b1b1d` text; light
`#2e2c29` with `#faf9f6` text. The unapproved terracotta action theme has been
removed. Avatar colors are independent. Composer actions are circular neutral
icon buttons whose geometry and states belong to the Button primitive utilities.
The attachment button has a soft circular fill. The primary composer action is
Voice when empty, Send with text or files, and Stop during a run. Keep one stable
button position while its glyph changes. The composer edge stays faint in both
themes and does not brighten on focus. Sidebar role chips use the available row
width instead of an arbitrary percentage cap. Inline photos round the image
itself as well as its clickable frame.
Selection and focus remain neutral. Unread and review indicators use the owner's
requested blue (`--unread`, `#3b82f6`). Regular unread dots sit at the far-right
row edge; pinned dots occupy the avatar's lower-right badge position and replace
the Main star until read. Use a gentle halo pulse and a static dot under reduced
motion. Do not derive the interface theme from avatar colors.

The starter palette below is historical planning, not a second theme source.

Use semantic custom properties in one shared token file, consumed by chat,
settings, onboarding, login and management. Migrate existing values incrementally;
remove old overrides only after their consumers move. Initial palette derives
from the current charcoal theme. Every rendered pairing still needs contrast
measurement; these proposals are not a conformance claim.

| Token                      | Starter value | Use                                                        |
| -------------------------- | ------------- | ---------------------------------------------------------- |
| `surface.canvas`           | `#080909`     | Conversation and app canvas                                |
| `surface.rail`             | `#121313`     | Navigation                                                 |
| `surface.panel`            | `#0C0D0D`     | Details                                                    |
| `surface.raised`           | `#252626`     | Message/card/field surfaces                                |
| `surface.hover`            | `#303333`     | Discoverable interactive hover                             |
| `surface.selected`         | `#383B3B`     | Persistent selected item; also non-color cue               |
| `surface.overlay`          | `#222424`     | Menu/dialog                                                |
| `border.subtle`            | `#343838`     | Nonessential separators                                    |
| `border.control`           | `#777F7F`     | Essential field/control boundary on canvas/raised surfaces |
| `border.controlOnSelected` | `#979F9F`     | Essential control edge on selected surface                 |
| `text.primary`             | `#F4F5F5`     | Body, labels, selected navigation                          |
| `text.secondary`           | `#B2B8B8`     | Supporting content, metadata                               |
| `text.muted`               | `#979F9F`     | Optional metadata; never substitute for disabled state     |
| `text.onAccent`            | `#151717`     | On light primary button                                    |
| `action.primary`           | `--primary`   | Primary submit/send                                        |
| `focus.ring`               | `#D1E8FF`     | 2px outline with 2–3px offset                              |
| `status.error`             | `#FFABA4`     | Error icon/text + explicit wording                         |
| `status.warning`           | `#F1CE82`     | Pending approval/uncertain outcome                         |
| `status.success`           | `#A8D0B8`     | Confirmed outcome only                                     |
| `status.unread`            | `--unread`    | Unread dot + accessible textual state                      |

Decorative separators may be subtle; meaningful control edges/focus/non-text
indicators need at least 3:1 against adjacent colors. Normal text targets 4.5:1;
large text 3:1. Check placeholder, chip, selected+hover, error and forced-colors
states. Static sRGB calculation finds `text.muted` on `surface.selected` is
about 4.19:1 and `border.control` on that surface is about 2.76:1: do not use
those pairs. Selected rows use `text.primary`/`text.secondary`; controls on selected
surfaces use `border.controlOnSelected`. These calculated pairings do not replace
rendered contrast checks. Do not apply opacity to entire interactive rows to express hidden/stale
state if it makes their readable labels fail.

Typography: existing system sans stack; no font download. Body and form values
16px/24px; rail names 15px/20px at weight 600; secondary 13px/18px; role chips
12px/18px; metadata 12px/16px; page title 22px/28px; section title 16px/22px.
Use rem-based scale, permit text enlargement, and avoid fixed-height text clipping.
Use mono only for actual code/paths/IDs in technical detail. Give dates accessible
full values; don't reconstruct missing native times from browser receipt.

Spacing: 4, 8, 12, 16, 24, 32px. Control padding 8–12px; form group spacing 24px;
page gutter 24px desktop/16px phone. Radii: 8px chips/small controls, 12px fields/
rows, 16px cards/menus, 20px dialogs, 24px composer; circular icon buttons where
appropriate. Bubbles can retain 20px radius without forcing every surface into
a pill. Shadows are reserved for overlays; borders explain ordinary grouping.

Targets: default controls at least 40px, preferably 44px in touch contexts; menu
rows 40px minimum, coarse-pointer 44px. Glyphs 18–20px. When a compact 32px visual
control is justified, enlarge its nonoverlapping hit area and verify target
spacing; use 44px for header/composer controls where possible. Tooltips supplement
labels, never replace accessible names or touch access.

Layer policy: base content 0, sticky local header 10, floating Latest control 20,
popover 100, modal backdrop/dialog 200/210, modal-owned popover 220, status toast 300. Portal placement must respect the active dialog's focus/inert boundary;
layer numbers alone do not solve focus or clipping.

## Component contracts

| Component                                           | Required contract and variants                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button / IconButton                                 | primary, secondary, quiet, destructive; default/hover/pressed/focus/disabled/pending; stable width while pending; actual action name; type=button except submit                                                  |
| OverflowTrigger                                     | Transparent idle and hover background; three-dot glyph with contrast/opacity feedback, immediate focus ring and expanded state; same adequate target as IconButton; surfaced menu remains separate               |
| Menu / Popover                                      | one open target, anchor rect, viewport padding 8px, flip/shift/max-height; keyboard open, first/last and arrow/Home/End navigation for true menus; Escape/outside dismiss; restore valid trigger; touch and zoom |
| Dialog / Drawer                                     | labeled title and close; initial focus by task; full focus containment; background inert; Escape/back according to dirty/destructive state; nested-overlay ownership; valid focus fallback after target removal  |
| Tabs                                                | local panels with tablist/tab/tabpanel, roving tab focus, selected state; arrow/Home/End; lazy content; no focus loss when capability changes; do not use tabs for unrelated page navigation                     |
| Field                                               | persistent label, optional one-line hint, value, required indicator, inline error via describedby/invalid; text/password/search/select/textarea; explicit read-only versus disabled                              |
| Checkbox / Radio / Switch                           | use native input where possible; visible label; checked and mixed state; switch only for an immediately applied reversible boolean with truthful pending/error                                                   |
| FormSection / FormActions                           | heading, scoped dirty state, actionable error, Save/Cancel, progress and confirmed result; long forms remain scrollable with reachable actions                                                                   |
| SearchableList / SelectionList                      | count where useful, stable identity, empty/loading/error distinction, selection separated from row action; no grid/listbox roles unless implementing their full keyboard model                                   |
| DataTable                                           | real caption, column headers/scope, row identity, aria-sort for sort controls; selectable rows use labeled checkboxes; explicit pagination if needed; scroll/reflow strategy, no icon-only cell meaning          |
| Status / Notice / InlineError                       | pending/success/error/stale/uncertain with text and optional icon; live announcements only for changes; local errors near action; durable failures not hidden in transient toast                                 |
| EmptyState                                          | short title and one useful actual action; no decorative tutorial, fake content, or indistinguishable loading state                                                                                               |
| Avatar / AvatarStack                                | row 42–44px, pin 72–76px, details 80–88px visual bounds; explicit variants; shared scheduler; photo parity; decorative avatar when adjacent name suffices                                                        |
| RoleChip / MainPebbleBadge                          | genuine metadata; full title available in details/accessibility; star attached to visible shape/photo bounds across all shapes and scales; explicit accessible Main Pebble designation                           |
| PebbleRow / PinnedTile / CrewHeading / GroupChatRow | common identity and selection state; stable keys; title chip beside ordinary row name; preview only from actual content; unread text; row action sibling, not nested button                                      |
| Message / ActivityGroup / ApprovalCard              | semantic content kind, safe Markdown, real authors/times, copy only meaningful content; activity expandable; approval/error never buried; retain durable identity                                                |
| Composer / AttachmentChip                           | text cursor and field focus, growth cap, IME-safe Enter, Send/Stop; attachments only after native/upload gates; per-file progress/cancel/remove/error and explicit send readiness                                |
| RoutineRow / FileRow / ComputerViewer               | real scope, capability and loading state; actual mutation/result; file provenance and safe download; lazy display stream with explicit observer/control semantics                                                |

Use normal semantic lists with real buttons for the rail; avoid elaborate tree
widgets unless hierarchical keyboard interaction is actually implemented. The three-dot overflow trigger is an explicit visual exception: no hover fill;
other buttons and row actions use the normal hover surface. Settings
and editor sections should reuse these primitives rather than copy their styles.
Tables are an extrapolated pattern for file/connection/request data, not a reason
to replace every list with a table or invent data columns. Small identity/routine
collections remain lists; multiattribute scan/compare tasks may use tables.

## Interaction specifications

### Timeline and tool activity

Project native rows into typed visible items: message, activity group, approval,
error, attachment/output, and unsupported substantive detail. Retain source row
IDs, author, actual timestamp, tool-call linkage, turn identity where provided,
and native sidecars before rendering. Pure whitespace without other meaningful
content produces no message article or timestamp-only metadata.

Group contiguous tool activity only within the same verified turn/author scope.
A user message, meaningful assistant reply, approval, error, explicit turn end,
or uncertain boundary ends a group. Missing linkage permits a conservative
contiguous activity group labeled Activity, never fabricated causality or result.
Default shows concise supported summary such as “3 tool calls”; expand for real
operation names/status and safe bounded content. Do not fabricate “Read 3 files”
from three tool names, expose secrets, or render private reasoning as assistant
prose. Use native visibility policy for sidecars; unclassified details get a
conservative affordance pending schema verification. Tool outputs remain
available when meaningful, with truncation/expand for large text.

Live and restored history share one projector. When final rows replace a stream,
retain stable identity so the reply doesn't duplicate or jump. Read cursors track
native history coverage and actual foreground exposure, not visible array length.
Do not mark unseen collapsed native items read merely because a grouping filter
changed the number of rendered rows.

### Pins, selection, and row movement

Center the pinned shelf, including incomplete rows. Keep saved order; centering
must not reorder. On Pin/Unpin: show pending immediately (target under 100ms on
supported baseline hardware), disable duplicate same-target intent, and apply a
reversible provisional presentation if identity/revision are available. Pending
is not Saved. On confirmation replace the provisional record with authoritative
state; on failure restore prior placement and show Retry; on uncertain response
reconcile before any retry. External newer revisions win.

Animate stable pebble identity using FLIP/shared layout: measure once before
state change and once after, animate transform/opacity, then remove temporary
styles. Keep only one semantic row/tile; any animation clone is aria-hidden,
inert, pointer-events:none. Return focus to the equivalent action or selected
row after reparenting. Cancel movement cleanly on user scroll, resize, filter,
newer intent, reduced motion, or identity deletion.

### Forms and management

New pebble: Create new asks only for the fields required by the actual native
creation contract; optional role/personality/model/tools are grouped logically.
Show the exact proposal and owner review once where required. Add existing shows
existing native profiles with name/avatar, actual enrollment status and selection;
one action Add selected. A short scope line is enough; detailed explanations
belong in Help. Creation success means the native profile/canonical state is
confirmed; partial/uncertain states offer Check outcome, not duplicate creation.

Edit pebble: identity heading and two levels of detail: primary Handle/Avatar/Role,
then expandable Responsibilities/Reporting/Tools & skills/Model access. A coherent
visual form need not pretend separate native operations are atomic. Track dirty
sections independently; Save changes can submit supported operations in a defined
order and report per-section results. Preserve unsaved fields after each result
and external refresh. Alternatively retain clearly scoped Save actions while
keeping one consistent form layout. Choose based on actual mutation contracts.
No whole-editor remount to refresh one field.

Show validation at the field and a compact summary only for multiple errors;
focus the first failing field after submit. Preserve typed values on failure and
reconcile revisions before retrying. Do not autosave sensitive permissions or
silently overwrite concurrent owner changes. Leaving a dirty form offers Save /
Discard / Keep editing only when real unsaved changes exist. Reversible pin/menu
settings actions do not need a confirmation loop. Native destructive/permission
review remains explicit, target-bound, and incapable of model self-approval.

Request review presents human labels and before/after values, exact identity,
meaningful effect and confirmed outcome. Keep necessary technical detail in a
collapsed section. Do not replace exact target verification with vague copy or
hide destructive consequences. Account forms retain password autocomplete,
validation and real session revocation behavior.

### Details, account, and capabilities

Desktop details opening resizes the layout while preserving the top visible
message ID/offset or bottom-follow intent; reanchor after wrapping changes.
Avoid continuously reflowing the transcript during the panel animation: apply
final layout once, measure/restore the anchor, and animate a panel transform or
short visual overlay rather than every text line. Verify the chosen technique
under streaming instead of assuming compositor-only panel motion guarantees
cheap layout. Overlay drawer opening transfers focus appropriately and traps it; desktop
nonmodal details does not trap focus or inert chat. Close returns focus when it
would otherwise disappear. Persist panel preference per local device if chosen;
no new server preference is needed merely to close a panel.

Owner menu opens upward where space permits and otherwise shifts/flips. Show
actual owner name/initial if available, Settings, Show hidden (checked), and
Sign out (or Disconnect for a supported non-owner mode). Sign out invokes the
existing auth behavior; no multi-account, subscription, usage, support destination,
or mobile-app action until implemented. Hidden pebbles retain clear status and
Unhide. Connection failure is not hidden behind the owner avatar.

Files is a view of conversation-associated inputs/outputs with filename, type,
size if known, source/message link and available download. Missing, expired,
permission-denied, unsupported, empty and loading differ. No arbitrary path
browser and no claim that every native Markdown path is safely downloadable.
Attachments may upload only to the owner-local origin, scoped to immutable
identity/conversation; inspect [native capabilities](PEBBLE_CREW_NATIVE_CAPABILITIES.md)
for protocol/body/timeout constraints. Publish limits from actual capability
metadata; this design does not invent a fixed upload limit.

Computer is optional. The af0 native Linux display is profile-scoped but shares
the gateway user's files/network; it is not OS isolation. The older supported
pin lacks the same display handlers. Even af0 requires dependencies and enabled
capability, and this plugin currently lacks the transport. Hide an unsupported
Computer tab; show setup/unavailable status only when supported and actionable.
Do not silently install packages or start a display on panel mount. The viewer
must identify the profile, connection state, observation/control mode and who
holds control; support explicit takeover/release, reconnect, expiry and teardown.
Screen-reader access to controls and state is required; the streamed desktop's
own accessibility must be assessed separately and cannot be guaranteed by tabs.

## Motion system

Motion explains change and preserves orientation. No gratuitous pulses, spinning
idle indicators, or perpetual new animation loops. Retain the approved avatar
scheduler, visibility pause, and reduced-motion behavior.

| Interaction                 | Starter duration and curve         | Required behavior                                                                                                     |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Hover/pressed/focus surface | 100–120ms ease-out                 | Focus ring appears immediately; no scale jump on text; overflow trigger changes glyph contrast, never background fill |
| Menu                        | 120–160ms ease-out                 | Opacity plus at most 4px translation; hit/focus target available immediately                                          |
| Details/drawer              | 180–220ms cubic-bezier(.2,.8,.2,1) | Gentle enter/exit, no overshoot; preserve scroll/focus; avoid animating every descendant                              |
| Pin/reorder                 | 200–240ms same curve               | Transform/opacity only; stable identity, rollback uses same contract                                                  |
| Latest messages             | 180–280ms bounded easing           | Explicit user request only; cancel on wheel/touch/keyboard; settle at latest despite streaming                        |
| Selection/status            | 100–160ms color/opacity            | Text changes immediately; no invented success or motion-only meaning                                                  |
| Loading                     | Static label initially             | Optional bounded progress only when measured; no fake percentage                                                      |

Reduced motion: immediate state and scroll changes, no travel/scale/reorder
animation, minimal or no opacity transitions, meaningful status text retained.
Respect system preference live; any optional user override must be a real setting.
Avoid smooth scrolling globally: history restoration, reconciliation and anchor
repair must remain stable. Long scroll distance does not extend animation into
seconds; animate only the bounded explicit Latest action. If streaming adds
content during it, settle once at the latest valid bottom and preserve user
cancellation. Keep the button until motion settles or immediately replace it with
a stable accessible focus target; do not drop focus when the button disappears.

## Accessibility and performance acceptance

Target WCAG 2.2 AA behaviors, verified in rendered flows rather than claimed from
source. Test keyboard-only creation/edit/send/Stop/pin/menu/details/review/sign-out;
VoiceOver/Safari and NVDA/Firefox or Chrome; 320px width, 200% text zoom and 400%
reflow; high contrast/forced colors; reduced motion; touch and software keyboard.
Ensure names, roles, states, error associations, contrast, focus order/visibility,
targets and overflow. Announce concise turn completion, failure, unread arrival,
and mutation result once; do not reannounce the entire streaming transcript.

Use real render and CPU traces with representative long history, large roster,
code blocks and optional viewer. No per-row timers, no repeated whole-roster
layout measurement, no unnecessary avatar remounts. Virtualization is conditional
on measured need and must preserve accessibility and scroll anchoring. Lazy-load
viewer/file preview code; opening Settings must not start screen streams or fetch
all files. UI motion should add no recurring backend calls. Existing avatar and
roster budgets remain regression gates; measure on baseline and constrained
hardware before setting a new performance guarantee.

Accessibility references: [WAI-ARIA menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/),
[WCAG 2.2 target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
and [animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
The WCAG 2.2 AA target-size criterion starts at 24 CSS pixels with specified
exceptions/spacing rules; this product deliberately targets larger controls.
Animation from interactions is AAA; reduced motion is an explicit product
requirement here, not a claim that this particular criterion is AA.
