# Crew organization and private agent exchanges

Status: implemented and locally verified; preparing preview.23 for publication.

## Product contract

- Pin retains the existing large avatar shelf and saved pin order.
- Shortcut is a normal full-size reference to an existing pebble, independent of its Crew membership. It shares conversation, avatar and unread state. Removing it removes only the reference.
- Crew members use compact indented rows. A selected member is Crew manager, appears first and has a subtle slate pennant. The Main Pebble keeps its distinct star.
- Crews are movable blocks in the unnamed root or custom sections. There is no mandatory Crews heading. Custom sections remain optional.
- The current Main Pebble can manage existing Crew purpose, membership and manager through workspace_agents crew.update, with current revision and stable member IDs. Unsolicited changes require asking first; a clear owner request authorizes the change.
- Manager selection, membership and presentation never rewrite reporting lines, SOUL or persona files. Current Crew purpose, manager and reporting relationships enter native turn context.
- A peer conversation has one shared ID and chronological link in both direct chats. Its overlay shows authenticated participants and visible messages only, with live counts. The direct chat and draft remain mounted.

## Architecture decision

Astra and Sol reviewed the source and alternatives independently; a native-source reviewer judged both. The retained sections/crews aggregate is the smaller migration. Pin metadata remains unchanged; a schema-2 save separates standalone placement from Crew membership. The original schema-1 value is retained atomically. Old saves and code downgrades that cannot preserve shortcuts refuse before changing active data.

Canonical Bot Chat projection was rejected: filtering bubbles cannot separate native model context or concurrent human input. Native hosted-room delivery was rejected because the public send path is human-authored, not a supported agent-origin transport. A timeless pair conversation was rejected because later work would accumulate under an old timeline reference. Returning peer bodies into the initiating canonical tool result was rejected for the same context-isolation reason.

The implementation uses one hidden native session per participant per initiating exchange, without copying canonical history. Native session.create/title creates the durable hidden session; Hermes chat -Q --resume executes it with that profile's actual model, skills and persona. The supported delivery_env helper selects target-profile secrets and supplies HERMES_TURN_AUTHOR. HERMES_QUIET_TURN_REPORT_FILE provides a native final-response receipt. No native handler or author object is patched or forged.

An owner-local exchanges.sqlite stores verified stable identities, native incarnations/session bindings, delivery intents, visible messages and references. workspace.sqlite remains presentation/coordination metadata. Tool-execution middleware authenticates native session/turn/tool-call provenance and returns only an ID/status receipt to the owner session. pebble_exchange supports deliberate follow-ups from an already bound exchange. Owner-only management, approvals, secrets, reactions, documents and voice tools refuse private-session callers, including verified compression continuations. Current hierarchy and Crew context are composed without owner capabilities.

A request can yield a peer final reply and one sender receipt turn. Receipt replies do not automatically wake the other participant. The exchange has an eight-turn budget; admission is bounded across the owner host. Ambiguous launch/restart states become uncertain and are reconciled only from native final reports, never automatically submitted again. A lock prevents two bridge workers from admitting the same work.

## Runtime activation

The peer boundary changes the runtime contract to workspace-runtime-v3. Host-first activation is required before copying v3 runtimes; old copies are accepted only for model-free migration. Bot open/send on the new app refuses a mismatched disk copy. Disk verification remains explicitly distinct from loaded code: stop native work, activate, sync-runtime --native-idle, then restart services/profile processes. Installation/update checks never infer loaded code from copied files or run a model.

## Compatibility and privacy

Hermes 0.21.7 has a supported native bot-author primitive. The older supported 0.21.0 build lacks it, so peer delivery refuses safely there; the rest of the interface remains supported. No installation, update or compatibility probe runs a model. Native acceptance runs only in disposable homes against a deterministic loopback model.

The memory acceptance sink verifies that bot-author metadata reaches an honoring provider and is not classified as a human turn. This does not promise that an arbitrary third-party memory provider honors native authorship correctly.

No historical conversation is rewritten or reclassified by matching message text. Existing polluted rows cannot be safely attributed from prose alone. No data, transcript, secret or design source is sent to Pebble Crew infrastructure.

## Verification

Run npm run check, Python plugin tests, production desktop/iPhone/Android Crew and exchange journeys, and inspect their settled screenshots. Run scripts/fixture/exchange_smoke.py in both pinned native environments: current executes real separate sessions and deferred continuation tools; legacy proves refusal without canonical peer delivery. The current test also uses a supported synthetic memory-provider plugin to observe native bot authors and a separate human control turn. Native owner-browser and workspace acceptance remain required.

Plans, overarching goals and Wiki remain separate work; this implementation does not add unreviewed goal/Wiki data models.

## Contextual page titles

The selected conversation and project board name appear before an em dash and
Pebble Crew. Settings tabs, the org chart, Pebble profile/role/tools/voice editors,
new-agent and task flows, admin setup and sign-in use their visible page names.
Titles restore when editors close and follow saved agent or board renames.

## Completed local verification

- `npm run check`: types, UI contracts, lint, formatting, 227 unit checks and production bundles passed.
- Python plugin suite: 360 passed, including schema migration, scoped runtime admission and default-profile distribution rollback.
- Production desktop journeys: 26 passed.
- Production phone journeys: 30 passed across iPhone WebKit and Android Chromium; four desktop-only drag cases skipped.
- Real native owner browser journeys: seven passed, including owner setup/login titles, persistence, reconnection and chat/media behavior.
- Current native exchange acceptance passed with separate sessions, preserved personas, native bot authors and canonical peer-content absence. Legacy acceptance refused safely without peer delivery.
- The exact combined package passed installation, current-host activation from preview.15, runtime synchronization, crash recovery, rollback and failed-activation recovery. Install/update stages ran no additional model turns.

Settled light/dark desktop and phone screenshots were inspected. Machine-readable
results, screenshots, command output and the exact archive digest are retained in
`.audit/crew-coordination/verification/report.json` and its adjacent evidence files.
These are synthetic homes and emulated phones, not an owner visual acceptance or
an all-device performance claim. The owner installation and public releases are
unchanged. Preview.23 gives this implementation a new release identity. The final committed
archive must be verified unchanged before publication.
