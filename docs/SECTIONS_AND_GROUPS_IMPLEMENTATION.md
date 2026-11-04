# Sections and explicit group chats

Status: architecture reviewed; implementation and owner migration are pending.
This replaces the coupled Crew navigation contract in
[CREW_COORDINATION_IMPLEMENTATION.md](CREW_COORDINATION_IMPLEMENTATION.md).
It does not rename the Pebble Crew product.

## Product contract

- A section is a collapsible, named part of the sidebar. It can contain direct
  chat rows and group chat rows. Creating, moving, renaming, collapsing or
  removing a section changes presentation only.
- A group is a native Hermes conversation created by explicitly choosing its
  participants. Being in the same section, reporting line or project never adds
  a participant. Moving a pebble onto a group row does not join that group.
- An agent can participate in several groups and keep its independent direct
  chat. A group row opens its conversation; it does not expand a department
  member list. Members are visible in the group header/details.
- Preserve the existing large pins and independent normal-row shortcuts. Their
  shared chat, draft, unread state and identity do not become copies of an agent.
  Preserve existing permitted duplicate row references during conversion.
- No mandatory Crews, Groups or Pebbles heading. Unplaced conversations use the
  existing unnamed list; owner-created sections remain optional.
- Reporting, Main Pebble authority, instructions, routines and private peer
  exchanges remain independent. Section membership grants no agent authority and
  triggers no prompt or model execution.

For example, Marketing can contain many direct chats and a Launch discussion
with three explicitly selected participants. Moving another agent into Marketing
has no effect on that discussion.

## Grounding

The current browser types combine `sections` and `crews` in `ui/organization.ts`.
`OrganizationRail` calls `App.openCrew`, which invokes `organization.chat` in
`plugins/bot-web/organization.py`. That operation selects all Crew members and
creates or opens a deterministic native room. Saving a Crew alone does not run a
model, but using its chat action implicitly chooses the entire department.

Explicit groups already use `ConversationDomain.createGroup` and the native
`room.create`/`room.state` boundary. Native Hermes owns their roster, history and
execution. The current adapter creates groups with 2–6 verified local profiles;
its supported contract freezes membership. A changed participant set currently
requires a new conversation. Creation limits must not hide historical rooms with
different participant forms or counts.

The current `crew-chats` mapping stores only the latest association. It cannot be
a migration inventory. `rooms.list` supplies the complete native catalog and
reports incomplete bounded pagination. Read scopes and reaction scopes depend
on the exact original native room identity, timestamp and roster.

There are two organization writers: presentation-only `organization.save`, and
legacy `crews.save`, which writes native team metadata through `roles.update`.
Main's `crew.update` is another caller of presentation Crew semantics. All must
be reconciled; hiding New crew alone would leave the old behavior available.

Plans and board outcomes use `crew_ids`; `coordination.py` uses those memberships,
purposes and managers in agent context across text, voice, workers and exchanges.
Converting sidebar layout must not silently drop or reinterpret that meaning.

These are source findings, not a claim of new native acceptance. In particular,
the old organization subcase in `native_smoke.py` still assumes schema 1 and
requires replacement. The documented pinned native source directories were not
available during this review.

## Architecture and ownership

Keep three authorities, with no writable Group registry mirroring Hermes:

| Owner                | Stores or decides                                                                          | Cannot do                                                                |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Section layout       | Section labels/order/collapse and row placements referencing exact direct/group identities | Create/send to a room, change participants, reporting, goals or profiles |
| Native conversations | Group existence, name, frozen roster, history, events, approvals and execution             | Infer participants from section layout                                   |
| Work/reporting       | Explicit instructions, reporting and goal scope                                            | Infer authority or goal scope from where a row is placed                 |

The section writer receives presentation storage and read-only identity
resolution. It has no native-create, send, role, work or model capability. Keep
business transformations pure. UI dragging produces a placement edit keyed by a
row identity, not a membership mutation.

The conversation domain owns explicit creation and recovery. Resolve the chosen
stable agent IDs and current native incarnations at the boundary. Reserve one
operation ID, canonical payload and native room ID durably before native creation.
After a missing acknowledgement, inspect that same native room; verify the exact
requested participants before reporting success. Never generate a replacement ID
or send a model prompt to test creation. Automatic create replay remains disabled
until acceptance proves it safe on each supported build.

Layout edits use their own revision and atomic operation receipts. Check an
identical replay before revision CAS; reject reused operation IDs with changed
payloads. Stale edits retain their draft and return current state. Identity-based
reorder anchors that disappeared cause a conflict rather than an arbitrary move.
A room whose creation succeeded stays discoverable even if its placement fails.

The read projection joins the layout to all enrolled direct identities and native
rooms. Preserve unavailable references rather than rebinding them to replacement
profiles. Partial inventory must never prune layout or masquerade as an empty
installation. Block migration activation on incomplete inventory; do not filter
history by present-day group creation constraints.

Keep native room IDs, creation timestamps, frozen rosters, events, read cursors,
reactions and history unchanged. No transcript copies, reconstructed rooms or
new conversation scheduler are introduced. Existing direct/group transcript and
private peer-exchange mechanisms retain their current owners.

Keep large pins under their existing metadata owner; the section rewrite must
not introduce a second pin writer. Independent normal-row shortcuts have placement
identities so moving or removing a reference does not delete its conversation.

## Existing-data decisions

The owner is being asked whether existing Crew lists should become sections,
with all existing conversations retained as separate groups, or remain unchanged
until reorganized. No corresponding owner migration has been activated.

A second decision covers existing Crew manager, purpose and goal rules: retain
those coordination rules independently, or retire their active behavior while
retaining historical records. Section conversion alone does not answer this.
No hidden department semantics or permanent new management screen is inferred.

Prepare an owner-local, read-only migration preview from exact source bytes and
revisions, all native rooms, latest associations as provenance only, existing pins,
row shortcuts and goal references. Preview reference-placement conflicts without
dropping copies. Crews without a room must not acquire one during migration.

Retain exact source backups and a manifest. Verify source revisions before an
atomic layout/compatibility-state activation. Do not pretend changes across
separate databases are atomic. Defer any new goal-audience representation to the
accepted goal policy; preserve existing IDs/semantics until then.

Retire create-on-Crew-open, membership-changing drag operations, legacy native
team saves and stale tool instructions together in the activated protocol. Old
clients and queued retired writes receive an upgrade-required refusal before
mutation. Existing reporting authority and cycle protections remain active.
Generalize the schema-2-specific install downgrade guard to all persisted
contracts. An old coupled binary is not a safe rollback after new-format writes;
never restore native history or a stale task database to roll back presentation.

## Implementation sequence and acceptance

1. **Read model:** exact conversation references, complete native inventory and
   pure section/row projection. Prove direct reachability, overlapping groups,
   historical rooms, unavailable identities, partial inventory and preserved pins.
2. **Separated mutations:** presentation-only section operations and explicit
   group creation/recovery receipts. Exercise two-tab conflicts, operation replay,
   lost acknowledgements and crashes. Section tests use mutation tripwires proving
   no native/profile/model calls.
3. **Production UI:** replace New crew with New group/New section, remove department
   expansion and auto-chat actions, and allow both row kinds in optional sections.
   Preserve selection, drafts, unread state, menus, drag/keyboard moves and mobile
   full-page navigation. Use the existing shared shadcn components and tokens.
4. **Migration and agent tools:** implement the selected existing-data policy,
   current Main checks, retired queued-write refusals, compatibility negotiation,
   model-free upgrade/rollback checks and corrected executable native fixtures.
5. **Verification:** `npm run check`, production desktop/iPhone/Android journeys and
   inspected settled screenshots; native owner acceptance against both pinned
   builds in disposable homes using the deterministic local model. Verify real
   room creation/delivery plus unchanged history/read/reaction scopes. Native
   acceptance may run models only in those synthetic homes; install/update checks
   remain model-free. Public release and owner upgrade are later steps.

Each unit must end with source, contract, test and progress-board status in
agreement. None of these implementation/acceptance phases is marked complete by
this design document.

## Review decision

Two independently grounded candidates were compared: strict domain separation
(Astra) and a conversation-first facade (Sol). Both converge on native room
ownership and presentation-only references. An independent Luna cross-review
scored A 26/30 and B 25/30; the scores organize the review, not product validation.

Use A's separate section/conversation ownership and explicit shortcut identities.
Graft B's incomplete-inventory handling, strict uncertainty classification,
receipt hashing/anchor conflicts and no automatic native-create replay without
supported-build proof. Do not add B's unnecessary one-row-per-conversation rule,
a broad pass-through facade, a forced heading or a permanent Legacy screen.
Defer A's proposed new goal-audience API to the owner's coordination decision.

No implementation deviations yet. A proposal that reintroduces a roster in
section state, a create fallback on open, or section-derived goal scope invalidates
this design and must be reconsidered rather than patched around.
