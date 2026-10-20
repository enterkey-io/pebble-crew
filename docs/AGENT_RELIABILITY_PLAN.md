# Make Pebble Crew safer for agent contributions

Audit date: 17 October 2026. Source baseline: `c5a9268`. The audit observations below describe that baseline. The implementation is in the 0.7.7 preview candidate; verification is recorded in [the bug register](BUGS_AND_IMPROVEMENTS.md) and release evidence.

The recurring failures have several causes. A separate review implementation hid production differences. Forms shared their controls but kept separate state and save logic. Changing a transport client could reset an editor. Operation routing and response shapes were repeated across languages. Earlier checks established narrower behavior than the release descriptions implied.

Keep the production UI, theme, Radix components, avatar engine, native identity checks and receipt-based chat projection. Improve the ownership of editing state, protocol contracts and release verification. A new visual redesign would not fix the demonstrated failures.

## What the audit established

Three current gaps were reproduced without owner data or model calls.

| Finding                                               | Experiment and result                                                                                                                                                                                                                     | Limit                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Connections loses unsaved tool access on reconnection | In the production web build, check a custom tool, break the response stream, wait for a new lease. The checkbox clears and Save becomes disabled.                                                                                         | The external bridge boundary was simulated. This is not an owner-host reproduction.                                       |
| Workspace parsing trusts invalid nested data          | The real `workspaceState` accepts missing identity fields, string appearance/role and a numeric manager.                                                                                                                                  | This does not show that Hermes emits malformed data.                                                                      |
| Detailed photos take an undersized request route      | A valid synthetic 512px PNG produces a roughly 1 MiB profile request. The actual client/proxy return 413 for `agent.onboard` and `bots.profile.update`; `bots.appearance.update` reaches the synthetic upstream through the larger route. | The probe does not test native photo persistence. Python also excludes the full-profile operations from the larger route. |

The current UI checker rejects the actual historical source at `ac4a881` and `47e50a3`. Its diagnostics identify the separate review entry/theme and missing shared controls. A synthetic JSX comment containing a removed control's name still satisfies the text check. That demonstrates the text check's limit; it does not bypass the browser tests.

The baseline passed `npm run check`, including 95 unit tests. That green result coexists with the reproduced gaps. A separate CI rerun failed a comparison of `359.99999237060547 >= 360`, so one geometry check also needs an explicit subpixel tolerance. Repeated reruns are not independent product failures.

The owner's public version metadata now reports `0.7.6-preview.1`. Version metadata does not prove loaded profile-runtime code or every deployed asset matches it.

## Repeated correction classes and the right enforcement

Counts below are conservative corrective episodes. Agent-authored bug registers and worklogs repeat the original reports and are not independent corroboration.

| Class                                  | Historical anchors                             | Keep or change                                                                                                                         |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Review and installed UI differ         | `38f959b`, `a18988b`/`ac4a881`, then `c33115d` | Keep the production-entry import and one theme. Retain the real historical negative control.                                           |
| Profile controls disappear             | `c33115d`, `f6f664d`                           | Keep shared fields. Centralize full draft and save semantics so required fields cannot disappear from one workflow.                    |
| Replies, timestamps and controls jump  | `a18988b`, `ff3189e`, `23c0add`, `7a52c94`     | Keep SendProjection and native receipt identity. Test event order and whole-row geometry. Do not replace the transcript on a reaction. |
| Connections is repeatedly rebuilt      | `38f959b`, `ff3189e`, `47e50a3`                | Keep separate overview/discovery/details and realistic OAuth/key variants. Separate remote refresh from local edits.                   |
| Phone checks miss real controls        | `ff3189e`, `23c0add`, `47e50a3`, `f6f664d`     | Measure the actual buttons and composer centers. Preserve phone screenshots and distinguish emulation from physical-device proof.      |
| Recovery navigates or resets forms     | `f6f664d`, plus this Connections reproduction  | Give each editor a lifetime based on native identity, independent of the lease. Test every editing route.                              |
| Model guidance exceeds available tools | `6636f6f`, corrected `ba3955c`                 | Keep native enabled-definition and deferred-schema discovery acceptance on both supported builds.                                      |
| Reaction decoration persists           | `6636f6f` through `47e50a3`                    | Treat this as one continuing refinement lineage. Keep normal/selected/hover computed-style checks and verify the installed version.    |

## Chosen architecture

Two independent candidates compared feature-owned editing sessions with an application-wide state machine and with tests-only patches. Both preferred feature ownership. The independent cross-judge selected the smaller candidate B as the base. Adopt A's explicit edit identity, field conflict rules, photo intent and loaded-runtime uncertainty.

Reject the global state-machine rewrite. It would move proven chat, organization and native lifecycle behavior to solve bounded failures. Reject a universal cross-language schema framework for now. A route catalog and complete boundary decoders address the observed coordination failures with less new machinery.

### Editing state has one owner

Connections gets a pure edit reducer owned by its active editing screen. Its target contains the existing native identity plus service name. Replacing `BotBridgeClient` can refresh remote data, but cannot initialize or discard a draft.

The reducer stores an accepted baseline, local choices, latest remote value, pending submission and conflict state. Clean fields adopt refreshes. Changed fields retain their local value. A divergent remote change requires explicit conflict resolution. Confirming a save clears only the submitted edit generation, preserving later typing. Failed refreshes and uncertain saves keep the draft. Discard, deliberate guarded navigation and sign-out remain distinct actions.

API-key drafts stay in transient memory. Do not put them in localStorage, logs or persisted drafts. Authentication loss clears owner-scoped secrets. Lease restoration does not masquerade as authentication loss.

Use the same ownership pattern for Profile, Role and Tools editing after Connections proves it. Share a typed full profile draft and merge rules, not a configurable form framework. Existing, unenrolled and approved-created targets retain their different native approval workflows.

### The client boundary owns protocol knowledge

Add domain operations beside the client transport. The migrated UI receives a narrow typed port, rather than operation strings, route choices or `unknown` results. Parse network results completely before constructing domain objects. Invalid refreshes leave the prior valid UI snapshot intact.

Validate required identity, role, appearance, references and bounded optional fields. Capture positive synthetic-native snapshots from both supported builds before tightening the parser. Ignore permitted additive fields. Do not fabricate missing identity or reject legitimate documented omissions.

Illustrative caller usage and proposed contracts follow. These are sketches, not implemented APIs.

```ts
const edit = createConnectionEditor(target, api);
edit.changePolicy(nextPolicy);
edit.receiveRemote(await api.permissions(target));
await edit.save();

const snapshot = await api.describeWorkspace();
await api.onboardExisting({ target, expectedRevision, fields });
await api.updateRoleAssignment({ target, expectedRevision, role, manager, team });
```

```ts
type PhotoEdit = { kind: 'preserve' } | { kind: 'replace'; image: ValidatedPhoto };
type EditField<T> =
  | { kind: 'clean'; value: T }
  | { kind: 'changed'; base: T; value: T }
  | { kind: 'conflict'; base: T; value: T; incoming: T };
type WriteOutcome<T> =
  | { kind: 'confirmed'; value: T }
  | { kind: 'refused'; reason: Refusal }
  | { kind: 'uncertain'; evidence: MutationEvidence };
```

Do not add photo deletion as part of this work. Choosing a shape preserves the saved photo. Keep the existing native `profile`/`id` incarnation meaning and the current manager-reference meaning. Branding types must not silently change stored identifiers.

Preserve the existing role assignment's `team` metadata as well as full role and reporting fields. It is separate from native Crew chat membership. The current full-profile wire operations do not accept `team`; keep the explicit role-assignment command until a deliberately versioned contract changes that. Do not blindly add a field to a strict existing request.

### One inert catalog owns route classification

A small versioned JSON catalog owns operation name, accepted route class and byte limit. The client, fixed loopback proxy and Python boundary consume or derive their routing metadata from it. Python retains explicit handlers, authorization, expected-revision checks, native identity and lease membership.

Inventory all supported handlers and callers before defining the catalog. The photo-bearing operations already identified are `workspace.initialize`, `bots.appearance.update`, `agent.onboard` and `bots.profile.update`. This is a seed inventory to verify, not an asserted exhaustive list.

Keep ordinary RPC bounded at 65,536 bytes and avatar JSON at 3,000,000 bytes. Generate/check routing parity, including operation completeness and valid body classes. Unknown operations remain denied. Do not raise every RPC limit or make the proxy accept arbitrary routes.

Retain currently supported small requests on their existing route during the compatible transition. Add the larger route for full-profile photo saves across all three layers together. Version or capability-gate stricter route exclusivity before rejecting an older supported client. This audit does not authorize an undocumented wire break.

### Keep release evidence honest

Host releases are immutable, but enrolled profile runtime copies update separately. An on-disk checksum does not establish what a running native process loaded. Add authenticated owner-local status for active host digest, packaged runtime digest, enrolled-copy digests and loaded-runtime evidence, with `unknown` where unavailable. Public version metadata must not reveal the profile inventory.

Test an update that changes a real runtime/tool marker, not only a comment in `version.py`. Exercise partial sync, failed activation, update and rollback. Define tested host/runtime compatibility sets before refusing a combination. Preserve private backups and require explicit safe restart conditions where copying code does not reload it.

Do not build a distributed activation system or symlink loader without a disposable native prototype. Two separate `BotOperations` instances are also observed, but a resulting race remains unproven. Test their interaction before treating consolidation as a correctness repair.

## Implementation sequence

Seven units can be reviewed and verified independently. Calendar estimates would be guesses before the native compatibility work.

| Unit                                         | Change and deletion                                                                                                                                                                                                                                      | Acceptance before completion                                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Preserve counterexamples                  | Turn the Connections reproduction into a failing user-contract regression test. Retain malformed snapshot and large-photo fixtures. Keep historical guard comparisons. Fix only the rounding-sensitive assertion, with a known misaligned negative case. | Baseline fails for the predicted contract mismatch, rather than a test setup exception. Existing positive controls pass.                                                                                                                                   |
| 2. Connection edit ownership                 | Add the reducer and migrate ConnectionDetail. Delete fetch/auth effects that overwrite drafts. Keep the current UI.                                                                                                                                      | Unsaved tool/key edits survive reconnect, failed refresh and background return. Remote policy conflict is explicit. Confirmed/uncertain saves and discard behave distinctly. Run desktop/phone flows and inspect screenshots.                              |
| 3. Complete workspace decoding               | Move snapshot decoding to the client domain boundary. Migrate every reader and delete the shallow whole-object cast.                                                                                                                                     | Invalid nested fixtures reject before replacing valid state. Real synthetic-native outputs from both supported builds parse. No new native-data defaults.                                                                                                  |
| 4. Route catalog and photo repair            | Migrate client, Node proxy and Python route metadata together. Remove hand-maintained route lists for migrated operations. Preserve supported wire paths.                                                                                                | Detailed photos reach the actual local native handler and persist through Add/Edit and photo → shape → saved photo. Limits, auth, unsupported routes and malformed images still reject. Run native-owner acceptance.                                       |
| 5. Shared profile edit semantics             | Consolidate identity/avatar/role/reporting draft and conversion logic across Add existing, New and Edit. Retain explicit creation approval and role-assignment/team commands. Delete replaced converters/merge logic.                                    | Save/reopen all fields on every route, preserve native identity and SOUL, reject reporting cycles, preserve drafts through reconnect and external edits. Run native-owner and both reaction-discovery build gates.                                         |
| 6. Enforce supported module paths            | Stop migrated UI code from importing raw dispatch or private decoders. Use exports/types and lint import boundaries. Replace control-name substring checks with actual shared composition/AST checks plus rendered persistence tests.                    | Commenting out a control cannot pass. A new raw UI call/import fails with the supported API named. Internal refactors preserve user-path checks. Retain historical theme/entry negatives.                                                                  |
| 7. Verify the package and runtime transition | Add meaningful installed-package acceptance to release CI, runtime compatibility/status receipts and a guarded release command. Keep owner-host update separate from publishing.                                                                         | The exact archive updates/rolls back two distinguishable runtime generations in synthetic homes. Partial failure cannot report success. Login, personas, credentials, history and identities remain unchanged. Install/update checks run zero model turns. |

For every unit, run `npm run check`, relevant production browser flows and settled desktop/phone inspection. Use the native-owner gate for profile, avatar, setup or chat contracts. Retain SendProjection, stable timestamps, same-row completion, native reaction discovery, exact approval receipts and no automatic mutation replay throughout.

Further chat restructuring is conditional on a concrete failed event-order case. Existing receipt/projection modules already own useful invariants. Expand those behavior tests rather than replacing chat state because App.tsx is large.

## Verification added during this audit

The repository now has a discoverable project [verify skill](../.agents/skills/verify/SKILL.md) and [feature map](../.agents/skills/verify/features/README.md). It reuses the production browser and native runners. It does not create another app or a new copy of the UI.

Its exact existing-agent recovery journey passed once on desktop Chromium and once each on iPhone WebKit and Android Chromium. The settled screenshots were inspected. Test-created servers stopped and evidence remained. This proves that recipe, not every mapped feature or physical mobile keyboard behavior.

The independent final review found a missing fresh-host prerequisite in the skill. Browser installation commands now match CI. The exercised machine already had npm dependencies and browser binaries, so fresh-host provisioning remains untested.

The original sanitized baseline is in [the audit evidence](audits/2026-10-17-agent-reliability.json). `node scripts/audit-agent-guards.mjs` and `node scripts/audit-photo-routing.mjs` now assert the repaired behavior: malformed snapshots and comment-only controls are rejected, historical broken sources fail, and all four detailed-photo operations reach the bounded avatar route. The route probe uses synthetic loopback listeners. These checks complement native acceptance; they do not establish owner deployment or visual acceptance.

## Source coverage and remaining limits

Original project feedback and two matching non-subagent project sessions were checked. Git history, the bug register, worklog, source and workflow definitions were inspected. GitHub searches returned zero PRs, issues, PR review comments and issue comments. There was no separate GitHub review discussion to learn from.

Teams returned no project matches. Pages and Drive returned no directly relevant documents; unrelated results were not opened. Linear remained unavailable after an authentication retry. No Slack, infrastructure-observability, exception-tracker or product-analytics connector was available. These are coverage limits, not evidence that those records do not exist.

The installed pstack model sheet still has its routing hook off, as recorded in the earlier installation conversation. This audit invokes the workflows explicitly and does not change global configuration. The project verify skill is independently discoverable.

PC-051 remains open for fresh custom-provider profile creation on the older Hermes build. The legacy reaction CI job is not full legacy profile-creation acceptance. Owner-host supervision/restart behavior, physical phones and complete native photo persistence were not re-certified by this audit.

The plan's cross-judge flagged missing role/team preservation, route-inventory completeness, backwards compatibility and loaded-runtime uncertainty. The implementation retains separate role/team writes, a complete routing inventory, legacy small-request routes and explicit loaded-runtime uncertainty. Independent code review additionally found and repaired legacy copying, Unicode length, delayed snapshot and transient profile-refresh defects. The owner's installed service is not changed by these local gates.
