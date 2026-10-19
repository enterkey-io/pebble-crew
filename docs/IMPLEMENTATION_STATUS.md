# Installed-owner implementation status

**0.7.8-preview.15 candidate:** voice uses one persistent owner-wide reference to
Hermes's saved credential, with a separate voice choice for each pebble. Existing
explicit approvals are reused. Completed key-replacement requests do not replay
when switching editor tabs. Keys remain in native Hermes storage.

Role editing uses one optional Instructions field for the job, steps and limits.
Existing role text carries over. Title and Description stay in Profile, and
Hermes personality and memory files remain intact. Chat photos open in a
borderless viewer with wheel, keyboard, pinch and drag controls.

Source, desktop, phone and isolated native checks passed. The release gate tests
the final archive before publication. Publishing does not upgrade an owner's
Hermes installation.

**0.7.8-preview.14 candidate:** voice selection groups
native choices under Female, Male and Other (unclassified/custom voices). The
unreliable speed control is removed from preview and live settings. Explicit
settings saves remove the app's old delivery hint while preserving owner
instructions; session creation ignores that hint without rewriting configuration.
Source, desktop/phone and isolated native checks passed locally. Release-package
verification and publication are separate from upgrading the owner's installation.

**0.7.8-preview.5 candidate:** the shared shadcn React foundation now covers the
complete general catalog and all 21 AI patterns. Settings, Add/Edit, connections,
navigation, transcript, composer, Markdown, approvals, private prompts and voice
use that graph. Native profile reducers, receipt identities and the existing
scroll controller remain the state owners. Optional native features without
verified contracts stay inactive. See [execution decisions and verification](SHADCN_EXECUTION.md).

**17 October 0.7.8-preview.4 candidate:** owner bubbles follow the selected
Pebble's palette; Snow retains neutral gray and existing `white` identities.
Native hierarchy context and introductions identify the same Main Pebble by
handle and full reporting path. The voice integration reuses Hermes's pinned
GPT-Live session builder, credentials, WebRTC protocol and native prompt surface.
It adds private inline setup, saved voice/requested speed, output-only preview, call controls
and receipt-matched final results. Native 0.21.0 keeps text chat and reports voice
unsupported; Grok live is not offered under the native-support requirement.

Keys stay in the owner's native credential storage and out of the transcript.
Live audio and bounded recent chat context go to the explicitly selected OpenAI
provider. Install/update checks never use provider calls or owner models. Local
acceptance uses disposable native homes, a deterministic model and a local WebRTC
peer. Physical-phone/provider access and owner-host deployment are separate checks.

**17 October 0.7.8-preview.3:** unsectioned pebbles are a flat list below pins,
without a default heading or collapse control. Custom sections are optional;
None returns a pebble to the plain list. Owner account photos can be uploaded,
changed or removed through the account menu and Account settings. The photo-only
control uses an account icon when empty and saves a bounded PNG in the owner's
existing Node/SQLite or Worker/D1 login store, separate from Hermes profiles.
No new owner setup or database migration is required.

**17 October 0.7.8-preview.2:** pinned tiles center the avatar in their upper third,
with the name and a two-line role label below. The corner action menu no longer
pushes the avatar downward. Incremental fixes use preview suffixes within 0.7.8.
The same update adds authenticated native agent images/file downloads in direct
Bot Chats, Markdown/code/table formatting and selected-conversation restoration
on reload. [Media limits](AGENT_MEDIA.md) and
[voice feasibility](VOICE_FEASIBILITY.md) describe the supported boundary and
proposed next work. Voice capture and Crew/room generated attachments remain open.

**17 October 0.7.8 candidate:** initial opening uses one quiet progress view until
the native conversation is restored. Reconnection keeps the existing app mounted.
Actual activity labels settle in their reserved lane, send/stop glyphs crossfade
inside one action target, and the existing Radix tooltips share cold/warm timing.
Long owner messages use more of the phone width. See the
[implementation plan](INTERACTION_POLISH_PLAN.md) and
[React Bits assessment](REACT_BITS_REVIEW.md); no React Bits source or dependency
is included. Crew semantics and agent-exchange overlays remain separate work.

**16 October 0.7.0 update:** the actual app now uses the independently reviewed
shadcn/Radix foundation across chat, Settings, Add/Edit pebble, account, requests
and connections. The update includes integrated details motion, persistent custom
sidebar organization/native Crew chats, owner-local search, immediate message
metadata/receipt correlation, expanded avatar choices and the owner's narrower
message/darker reply treatment. See the current [review](UI_RESET_REVIEW_CHECKLIST.md),
[work log](UI_RESET_WORKLOG.md) and [release notes](releases/0.7.0-preview.1.md).
The records below describe preceding implementations; their passing checks did
not establish the visual quality accepted by the owner. Native Computer startup,
all-device performance and owner-host acceptance remain separate checks.

**16 October 0.6.0 update:** the owner authorized inline implementation of the
[design system](PEBBLE_CREW_DESIGN_SYSTEM.md) and [UX plan](PEBBLE_CREW_UX_IMPLEMENTATION_PLAN.md).
Settings, New/Edit pebble, Crews, account/connection/request flows and chat now
share production components and tokens. All PC-008–PC-023 have implementation
and automated coverage recorded in [the backlog](BUGS_AND_IMPROVEMENTS.md) and
[verification report](compatibility/preview-0.6.0-local.json). Native files are
implemented for direct chats. The optional Computer transport is tested against
real native ticket/RFB/control code with a synthetic framebuffer; full Linux
Xvnc startup/device testing remains open. Generated-output indexing and group
attachments are deferred. No formal accessibility certification is claimed.

The default distribution is one installable plugin, with optional independent
hosting. Publishing an update does not upgrade an owner's remote Hermes host.
The following section records the preceding 0.5.0 baseline; the 0.6.0 changes
and limits above supersede its UI details.

Implemented and exercised locally:

- The conversation UI follows the reviewed three-pane hierarchy: pinned pebbles,
  compact sectioned rows, role chips/native previews, crew avatar stacks,
  bounded message bubbles/native timestamps/authors, compact composer and the
  selected identity/routines panel. Accessible tablet/phone drawers support
  focus containment, Escape, browser Back and restoration. No unsupported
  attachment/voice/Library/Computer controls are offered.
- Live authoritative roster reconciliation covers local changes, model proposals,
  outside native metadata/profile changes, two browsers and missed events.
  Native read clocks use active message row IDs; read cursors only advance.
  Profile incarnation witnesses survive rename and distinguish clones/reused
  names. Old sessions, drafts, handles and approvals cannot bind to replacements.
- Native pins/order, Hide/Unhide, scoped routine pause/resume and exact owner-
  reviewed deletion. Native deletion protects the default/lead, direct reports,
  active sessions and live crews. Hermes 0.21.7 can report files removed with
  identity settlement pending; that remains a partial receipt, never a false
  success or automatic destructive retry. Inspection never repeats deletion.
- New presentation/read-cursor tables are optional schema-1 additions. Code
  rollback preserves them, owner login and unrelated native state. See
  [update guidance](UPDATES.md) and [local evidence](compatibility/preview-0.5.0-local.json).

- Pebble Crew branding and maintained repository references. Primary-agent
  detection returns the existing native display name, and onboarding explicitly
  identifies the existing Hermes agent whose handle and avatar are being edited.
- Concise owner login and primary-agent setup with no provisional product
  branding. Animated iris avatar by default, shape thumbnails and circular
  color swatches, selected-preview matching, and an empty photo-upload state.
  Existing native photos remain available; a stock image no longer selects
  photo mode during onboarding. Browser checks include that regression,
  animation, mobile fit, photo round trips and saved appearance.
- Documented event framing, blank-line compatibility for existing probes,
  bounded operator readers accepting either separator, explicit `revoke --all`
  / `{"all":true}` safeguards, setup-link remaining lifetime and legacy rollback
  configuration retention. Legacy guides are marked with their version scope.
- Combined installable archive containing prebuilt web UI, Node/SQLite login and
  the native Python integration. Positive checksum inventory, locked production
  dependencies with lifecycle scripts disabled, immutable release snapshots and
  persistent owner keys outside replaceable code.
- One public origin with a narrow, bounded loopback proxy; browser login cookies
  are not forwarded to Hermes. A private first-use link removes its fragment
  immediately and opens admin setup without code/address entry or pairing.
- Foreground supervision with child/native recovery, stable launcher, generated
  systemd-user/launchd/container definitions, code-only update activation and
  readiness rollback. Unsupported data migrations are refused. Actual deployment
  supervision, Linux boot and container replacement still need owner-host proof.
- Real archive/CLI/browser acceptance from ordinary profiles with zero managed
  bots, plus native Bot Mode replies, independent service/native/manager crashes,
  draft/login/history preservation, installed updates, rollback and deliberate
  bad-release activation. Disposable local fixtures do not certify remote routes.

- Maintained Better Auth username/password login; one administrator, one-use
  installation proof, atomic bootstrap, no public signup/reset, database sessions
  and rate limits, secure HttpOnly/SameSite cookies, no auth telemetry.
- Equivalent Node/SQLite and Cloudflare Worker/D1 owner services. App configuration,
  login and signing keys belong to the owner's host. In combined mode the web
  listener forwards streams to its fixed loopback integration without storing
  transcripts. Independent hosting retains direct browser-to-Hermes transport.
  No vendor account, content database or relay.
- Operator-enrolled Ed25519 public-key trust on Hermes, five-minute browser tickets,
  authenticated lease renewal and independent stream expiry. Ordinary login can
  obtain new tickets after restart; pairing is disabled for an enrolled issuer.
- Native primary detection, owner confirmation of public handle and animated/photo
  appearance, canonical Bot Chat enrollment without a model call, optional real
  at-most-once welcome request. No placeholder agent or SOUL rewrite.
- Private Hermes-side identity/team/role/reporting store; stable IDs, retired handle
  reservation, one orchestrator, reporting-cycle rejection and native metadata CAS
  merge. Team section names are mirrored without replacing unrelated metadata.
- Real `workspace_agents` model tool, bundled `bot-web:manage-team` skill, native
  session-store caller binding and per-turn role/identity context. Exact proposals
  wait for owner review. No model self-approval or privilege changes.
- Native profile creation with distinct SOUL and credential/channel mirroring disabled.
  An exact approved grant selects only the primary API-key/custom model provider,
  never the whole .env or an authentication pool. Model setup and selected tools
  complete before canonical chat initialization. Synthetic new-agent model turns
  pass on both supported builds; unsupported model authorization stays partial.
- Installed toolset/skill selection with native empty-list safeguards; native
  connection catalog, API-key cards, native dashboard OAuth with fixed callback
  and PKCE, non-destructive tests and explicit per-MCP-tool permissions. Real
  loopback MCP/authorization fixtures pass on both supported builds. Saved changes
  do not claim runtime readiness merely from configuration.
- Shared low-cost avatar renderer in onboarding, Settings and roster; white palette,
  local photo preparation, independent server raster decoding/re-encoding and native
  profile asset storage. The combined listener forwards photo uploads without
  storing them; photos are never sent to a vendor service.

Still required before the full plan is complete:

- OAuth/credential-pool model grants, resumable repair of partially created agents
  beyond an explicit model-access repair, and bounded standing management grants.
- Runtime activation proof and credential replacement/rollback tests for connections,
  plus native setup of service packages absent from Hermes. Catalog entries do not
  promise installation of arbitrary commands or vendor account services.
- Task dependency/result coordination beyond native messaging and role context;
  the broader public-handle restart matrix and active-job behavior. Native DM
  and local room handoffs with changed handles pass on both supported builds.
- Complete installation/migration/update/supervision acceptance on independently
  installed owner infrastructure, including Linux boot, real container replacement,
  trusted HTTPS ingress and migration from the old API-only preview. The developer's old static preview is not evidence
  of a finished owner installation.

The earlier plans remain the requirements. Implemented subsets above do not waive
remaining exit gates. Local fixture results use only disposable homes and a mock
model; they do not establish behavior of an owner's actual model or services.

Local owner-browser acceptance additionally verifies secure session cookies, idle
heartbeats beyond an accelerated lease, ticket renewal, offline recovery and a real
native gateway restart with an unsent draft and zero replayed sends, photo/shape
switching with saved-photo reuse, team/role edits, password change and ordinary
logout/login. Local Workerd/D1 verifies the same auth library and restart persistence.
The owner package installs and starts separately from the development checkout.
These results are development evidence, not an installed-owner launch pass.

Machine-readable local evidence: [owner-instance-local.json](compatibility/owner-instance-local.json).

Combined package evidence: [installed-plugin-local.json](compatibility/installed-plugin-local.json).
Both supported source builds pass 33 local installation/browser checks each,
including an interrupted first installation. Each runs one synthetic inference;
metadata probes are separate. The tested combined archive is identified by SHA-256.

The experimental Computer viewer remains disabled by default while Linux
acceptance is open. Explicit operator-only test opt-in is
`HERMES_BOT_WEB_EXPERIMENTAL_COMPUTER=1`; native revision/host checks still apply.
