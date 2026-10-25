# Event stream and browser access

The protocol identifier remains `hermes-bot-web.v1`. Read `bridge_version` from
POST `/v1/connect` to identify implementation behavior. HTTP chunks are transport
details: a chunk can contain part of a UTF-8 character, part of a record, or many
records. Never assume one chunk equals one event.

## GET /v1/events

The media type is `application/x-ndjson`. Each nonempty UTF-8 line is one JSON
object; ignore empty lines. Buffer incomplete lines and incomplete UTF-8
characters across reads. Dispatch a record as soon as its line is complete.

| Integration version    | Record terminator                                 |
| ---------------------- | ------------------------------------------------- |
| 0.2.4 published source | JSON followed by LF (single newline)              |
| 0.4.0                  | JSON followed by LF (single newline)              |
| 0.4.1–0.7.9            | JSON followed by LF LF (compatibility blank line) |

The installed 0.2.4 probe was reported to observe blank separators. The tagged
0.2.4 source emits single newlines; that deployment difference has not been
independently reproduced. 0.4.1 emits a compatibility blank line so both styles
of reader work. A line-based NDJSON reader that skips blanks works across all
three versions. A reader splitting only on blank lines fails on 0.4.0. Future v1
releases retain the blank separator; a framing change requires an explicit
protocol migration.

The first record is `{"type":"bridge.ready"}`. Heartbeats use
`{"type":"bridge.heartbeat"}` approximately every 15 seconds, including when no
bot is selected. Native records are scoped to the authenticated connection's
open sessions. Browser inactivity checks use a 35-second deadline. A socket
staying open without records is insufficient. Proxies must flush headers and
records immediately and disable buffering.

Use exact allowed Origin, Authorization and X-Bot-Connection headers. Credentials
and lease IDs never belong in URLs or diagnostic reports. On EOF, discard a
partial line and replace only the event subscription on the same valid lease.
Replace a lease only after a lease-specific failure. Never replay mutations.

## Diagnostic cleanup and global revocation

Each probe closes its reader and DELETEs `/v1/connect` using **its own** Origin,
Authorization and X-Bot-Connection. This releases that lease without invalidating
other browsers. Never use global revocation to free slots.

Beginning with 0.4.1, operator-only POST `/v1/pairing/revoke` requires exactly
`{"all":true}`. Empty bodies, false, strings and numbers are rejected without
revoking anything. `hermes bot-web revoke` likewise refuses; deliberate legacy
global revocation requires `hermes bot-web revoke --all`. It clears all temporary
pairing grants and current connection leases. It does not revoke persistent
owner login sessions or already-issued owner tickets; manage those through the
owner account controls. Older releases accepted an empty body and had no CLI
safeguard.

## Workspace presentation in 0.5.0

`workspace.changed` is an authenticated, payload-free invalidation hint. It never
contains another session's events. Clients fetch `workspace.snapshot`, coalesce
concurrent reads, reconcile every five visible seconds as recovery, and refresh
on focus/reconnect and confirmed mutations. The bridge shares a four-second
watcher across connected browsers. No model/provider probe runs in roster reads.

Snapshot IDs identify profile incarnations, not reusable names. Read keys bind
that ID to its native canonical chat. Supported native reads use active-message
row IDs, and SQLite acknowledgments advance with MAX. Crew read keys include the
creation identity and native sequence. Only acknowledge history actually shown
in a visible conversation at the bottom. Missing timestamps/previews stay absent.

`agent.pin`, `agent.hide`, `presentation.order` and `presentation.read` have fixed
validated fields. `agent.delete` can execute only from an exact durable owner
request approved with the profile name. Default/lead profiles, managers with
direct reports, active sessions and live crew members are protected. Executing,
partial and uncertain deletion receipts cannot be approved again.
`requests.reconcile` observes the outcome; it never replays native deletion.

## Optional 0.6 capabilities

The handshake advertises `attachments` and `computer`. Clients must check these;
the protocol name remains `hermes-bot-web.v1`. NDJSON events still contain one
JSON object per LF line; blank lines remain ignorable and heartbeats are 15 s.

Integration 0.7.3 also advertises `reactions` for direct pebble
chats. See [message reactions](MESSAGE_REACTIONS.md) for the native operation,
event, profile enablement and next-turn feedback contract. No change to the
protocol identifier or event framing is required.

Preview.21 adds the optional `room_reactions` capability. Group and crew reactions
use `room.react` with a verified native `event_id`; `room.log` includes a
room-incarnation key, monotonic reaction revision and updates for previously
loaded events. Reactions remain on the owner's Hermes host. Direct chats keep
their native row-based reaction API. See [message reactions](MESSAGE_REACTIONS.md).

Attachments require an open connection-owned native `session_id`:

- `POST /v1/files/upload`, normal auth headers and RPC envelope `files.upload`
  with `session_id`, `name`, base64 `data`. It stages privately without a prompt.
  The dedicated body cap is 14 MiB + 4096; decoded files are at most 10 MiB.
- `chat.send` optionally includes `attachments` (1–5 opaque IDs, 25 MiB total)
  and an opaque `request_id`. That ID binds exact content and target. Accepted,
  uncertain and discarded receipts are durable; never automatically resend.
- `files.list`, `files.remove`, `files.reconcile`, `files.discard` use `/v1/rpc`.
  Reconciliation reads history without model execution. Discard is an explicit
  owner action for this conversation's pending inputs. It never revokes clients.
- `POST /v1/files/read`, normal auth/RPC envelope with `files.read`, `session_id`,
  `id`, returns binary octet-stream with attachment disposition and no-store.
  IDs are bound to owner principal, native incarnation and canonical chat.

Typed `crews.save` changes organizational metadata only, with revision CAS and
an operation receipt. Typed `room.create` creates a separate native Group chat
with an opaque room ID, name and 2–6 distinct managed profile names. Neither
operation grants tool access or sends a prompt; group membership is frozen by
these native revisions.

Computer uses typed profile-scoped `computer.status/start/stop/observe/control/
release/force_release`. Observe returns a 25-second, one-use ticket, never a
native socket/port, internal credential or reusable native display ticket. The
browser opens binary WebSocket `/v1/computer/stream?ticket=…`; the route requires
exact Host/Origin, consumes the ticket and remains bound to an active browser
lease and the same native profile incarnation. No cookie becomes bridge auth.
Public tickets and upgrade query strings must not be logged. The fixed private
transport redeems the native ticket in its minting process and keeps native RFB
filtering and leases authoritative. Deliberate close hands back; an abnormal
connection loss retains the human lease. At most four streams are active, with
one per connection/profile. Native revision, host and dependency checks determine
whether the optional Computer UI is offered.

The 0.6 Computer capability stays false by default until host acceptance passes.
The operator-only experimental opt-in is `HERMES_BOT_WEB_EXPERIMENTAL_COMPUTER=1`;
it does not bypass the native revision/host/lease checks.

## 0.7 organization and search

`workspace.snapshot` adds `organization` (revision, sections, crews) and `crew_chats`
(Crew identity → native room ID). `organization.get` returns that organization;
`organization.save` accepts `{organization:{sections,crews},expected_revision}` and
uses its own compare-and-swap revision. Every known enrolled identity has exactly
one placement. `organization.chat` accepts `{id,expected_revision,confirm_new}`;
it returns `ready` with an authoritative native room or `new_chat_required` when
membership changed. A deterministic room ID prevents an uncertain acknowledgement
from creating duplicate rooms. Native history is never rewritten by sidebar moves.

`search.query` accepts `{query}` (1–200 characters) and returns at most 100 typed
hits plus a human-readable coverage/limit summary. Message/file/routine hits include
stable `bot_id`, `profile` and `item_id`; room-message hits carry the native room
identity and event ID. `search.context` revalidates the target and returns the exact
visible saved text, without marking its chat read. Profile targets use
`{profile,bot_id,kind,item_id,query}`; room targets use
`{kind:"room-message",room_id,created_at,item_id}`. Search never accepts filesystem
paths from the browser. Owners can then explicitly open that conversation or its
Files/Routines tab. Message previews do not pretend that an older result is loaded
into the current paginated transcript.

The complete 0.7 app and integration are released together. All records retain the
existing v1 framing, Origin/authentication and owner isolation requirements.

## 0.7.1 profile setup and introductions

`bots.profile.update` and `agent.onboard` require `profile`, its incarnation-bound
`id`, `expected_revision`, `name`, `handle`, `appearance`, `photo`, and `role`.
`role` contains `title` and `description`. Advanced role fields remain intact.
Since 0.7.6, the full five-field role is also accepted, adding `responsibilities`,
`boundaries` and `expectedOutputs`. An optional `manager` selects the enrolled
profile this pebble reports to; omitting it preserves the saved relationship.
Reporting must reach the Main Pebble without a cycle. Validation occurs before
enrollment or native metadata/asset writes. Partial two-field clients still
preserve the advanced fields.
`photo` is null or a supported raster data URL that the bridge decodes and
reencodes. The existing native profile is never cloned or renamed.

`agent.onboard` also enables the integration through Hermes's plugin controls and
initializes the existing profile's canonical Bot Chat. It does not submit a model
prompt. The browser then opens that chat and, unless the owner opted out, calls
`agent.welcome` with `profile` and `id`.

`agent.welcome` submits one native hidden user seed. The visible response is the
agent's own reply. Its per-incarnation status is durable: `submitting`, `accepted`
or `uncertain`. Later requests do not replay the prompt, including after a lost
response. `workspace.welcome` retains the primary-agent entry point.

Built-in organization IDs `pebbles` and `crews` have fixed names and item types.
Custom sections accept either type. Reconciliation repairs older misplaced items
without deleting profiles, crews or memberships. Empty built-in headings are a
browser presentation rule.

Event framing remains one JSON object per LF-terminated line. This release does
not change the stream framing or heartbeat interval.

## Live voice and private prompts (0.7.8-preview.4)

The existing RPC route adds `voice.status`, `voice.preferences`,
`voice.credential`, `voice.session` and `voice.submit`, plus `secrets.pending` and
`secrets.respond`. All require a session opened by the same authenticated
connection. Native profile identity is rechecked; clients never choose profile
paths or provider URLs. `live_voice` and `secrets` capabilities are advertised
separately. The older pinned Hermes build has no native live mode.

`voice.credential` accepts only a voice key for the opened Pebble. It uses native
credential storage, returns a nonsecret save receipt, and does not validate paid
provider access. `voice.session` accepts an SDP offer and a boolean `preview`. It
returns only the negotiated session/SDP answer. Audio travels over the native
WebRTC protocol directly to the provider, outside RPC and the events stream.

`voice.submit` carries bounded text/context to normal native `prompt.submit`
with `surface=voice-live` and `queued=true`; it never sets `voice_turn` or invokes
whole-session interruption. A saved `user_row_id` must match a completion before
a final result is read aloud. Unattributed queued results stay in chat.

`secret.changed` announces that native private prompts changed; its event has no
secret value. `secrets.pending` returns only request ID, prompt and field label
for the authorized session. `secrets.respond` answers an existing native request
once, with the value confined to the response path. The native callback owns
the save verdict; `submitted=true` alone is not proof of storage or provider
validation. Requests expire and are removed on native cancellation/disconnection.
`voice.setup` asks the current chat to open its private voice setup controls.
Neither event is persisted as a chat message.

## Live document presentation

`document.open` is an additive live event in v0.7.8-preview.16. It is delivered
only to browsers that opened the emitting native direct Bot Chat. Its payload
contains `request_id` (UUID), `expires_at` (epoch milliseconds), `name`, `format`
(`markdown` or `text`) and UTF-8 `text` (at most 256 KiB). It contains no server
path or credential. Clients ignore expired, repeated and other-conversation
requests. Historical message replay does not open documents. An ordinary saved
Markdown file link remains the way to reopen a closed document.

The enabled `pebble_open_document` native tool explicitly shares an output file
from the caller’s generated output directory. Dispatch identity, live UI session,
canonical Bot Chat lineage and profile home must agree. Private paths, remote
URLs, symlinks, hard links, binary data and oversized documents are refused.
Viewer rendering uses the shared Markdown components with raw HTML disabled and
remote images represented as links. It neither executes content nor fetches
remote images. This is a read-only preview; the file remains on Hermes.

## Conversation cards (0.7.8-preview.21)

The additive `questions` capability advertises the supported native clarify
transport. `questions.pending` is scoped to an opened `session_id`; it returns
bounded requests containing `id`, `questions` (`qid`, `question`, optional
`choices`, `multi_select`) and locked `answers`. `questions.respond` requires
that session, request `id`, `question_id` and an `answer` (string, string array
for multiple choice, or null to skip). Receipts are `answered` or `expired`.
The current adapter uses native `clarify.lock`; the older adapter uses native
`clarify.respond`. Hermes must have its built-in clarify tool enabled for an
agent to request one. The integration does not silently grant toolsets.

`questions.changed` carries only session-scoped invalidation. No answer is sent
in that event. Reopening and answering require the same native profile identity
and an authorized session. Native tool approvals retain their existing exact
request, command and owner-decision path; moving the UI into chat does not grant
agents authority to approve them.

`requests.changed` invalidates management-request metadata for authenticated
browsers. Cards are read through the existing `requests.list` operation, and
approve/deny preserve the intent fingerprint and deletion confirmation. The
Main Pebble's chat links to the originating agent's request card. Owner-local
delivery receipts notify the current Main once about another agent's pending
management or native tool approval. Unknown delivery outcomes are not replayed.
Private request specifications and credentials are excluded from the notification.

### Request chronology (0.7.8-preview.22)

`requests.list` additionally returns `created`, the request’s original Unix time
in seconds. New records retain subsecond precision; existing integer timestamps
remain valid. Decisions do not change this time. Results are newest first, with
insertion order breaking timestamp ties. Older servers may omit `created`; clients
then anchor a newly observed card between the current native messages. Resolved
management requests remain available as expandable transcript records.

## Busy Bot Chat sends (0.7.8-preview.21)

`chat.send` continues to invoke native `prompt.submit` without a `queued` override.
Native `status` receipts distinguish `streaming`, `redirected`, `steered` and
`queued`; only an actual `user_row_id` addresses a persisted user row. Attachment
`state` receipts remain separate. A lost or unrecognized receipt is uncertain and
must not be retried automatically.

`bot.open` includes native `inflight.corrections` and `correction_offsets`. Offsets
count Unicode code points. Optional `active_user_row_id` and `correction_row_ids`
are read from the current native turn's structural cursor; they never derive from
searching for matching text. Without a proven anchor, stored history remains
authoritative. These fields do not correlate a browser request with a native row.

`stream_position` on bot snapshots and session events contains an owner-local
gateway `epoch`, monotonic `turn` and cumulative raw delta `offset` (Unicode code
points). A running snapshot's offset covers its complete native inflight text;
queued event deltas trim that covered prefix. Turn start/completion frames are
fenced by the same lifetime and turn. Positions are presentation watermarks, not
native row identities or delivery receipts. They retain no text on our systems.
`deferred_prompts` carries accepted native fallback envelopes with text and an
optional actual `row_id`, so restoration preserves them without a queue UI.

`media.read` returns `video/mp4` only for a recognized ISO base media file-type
box. The authenticated canonical-row and reference checks, chunk verification,
and 10 MiB limit remain unchanged. Unknown content stays download-only. Browser
codec support determines playback; MP4 is a container, not a codec guarantee.

## Crew presentation and private agent exchanges

The optional `exchanges` capability advertises authenticated owner-local reads:
`exchange.references` takes a stable enrolled agent `identity`; `exchange.read`
takes the returned exchange `id`. Neither accepts author names, native session
IDs, credentials or delivery commands. References include the same exchange ID,
peer identity, visible message count, state and creation time in both direct
chats. The viewer includes authenticated participant IDs and visible messages,
not internal model traces. The optional `exchange_events` capability enables
`exchanges.changed` notifications on the existing authenticated event stream.
They carry only the type, never private messages or native session IDs. Clients
re-read references and the open viewer on this signal and after reconnection;
older bridges retain the polling fallback. Updating a reference preserves its ID
and creation time, so its message count changes in place in history. Wire framing
is unchanged.

Current Hermes supports native bot authorship and separate profile sessions.
Legacy Hermes without that primitive returns unsupported rather than delivering
peer content into a canonical owner chat. Native tool middleware authenticates
the initiating session, turn and call. The tool result in the owner's transcript
contains only an ID and state. Historical prose is never reclassified as a peer
message. Only structurally confirmed tool receipts collapse into exchange links.

Presentation schema 2 separates a standalone sidebar reference (a shortcut) from
Crew membership. Crews and standalone rows can share the unnamed root or custom
sections. Pin metadata still selects large avatar tiles. `managerId` must be a
Crew member or null; its derived display position is first. A Crew manager never
implicitly changes native reporting. The original schema-1 presentation is
retained for recovery; older saves and unsafe downgrades refuse rather than
silently removing shortcuts.

## Connection recovery in 0.7.9

The optional `connection_recovery: 1` handshake capability adds these contracts:

- `GET /v1/status` uses ordinary Origin, bearer and lease headers. Its bounded
  model-free probe returns `{native: "responsive" | "unavailable" | "unconfirmed",
age_ms: number}`. This is dispatcher evidence, separate from stream heartbeats.
- `chat.snapshot` takes an already-bound `session_id` and returns the same display
  snapshot as `bot.open`, without resume, tool enablement or provisioning. `bot.open`
  binds the session filter before its snapshot. A lost conversation binding returns
  `CONVERSATION_CHANGED`; reopen that target without replacing a valid lease.
- `LEASE_GONE` explicitly identifies an absent or idle lease. Generic validation
  errors never identify lease loss. `CAPACITY` returns HTTP 429 with `Retry-After`
  when eight valid leases are in use. `NATIVE_UNAVAILABLE` can reject a request
  before native dispatch. These codes are allowlisted and contain no private text.
- A new authenticated event stream replaces the previous subscription on that
  lease. Old stream cleanup cannot close the replacement. Unrelated native events
  are filtered before bounded queue admission. Permitted global events are redacted.
- Renewal extends authority monotonically for the same authenticated principal.
  It does not replace the lease or reset another browser's access.

Operation `effect` metadata in the canonical catalog distinguishes read, bind and
write. It fences late reads; it does not authorize automatic replay of writes.
The protocol name, blank-line-compatible NDJSON framing and 15-second heartbeat
cadence remain unchanged. Older clients can continue using existing operations.
See [browser recovery ownership](CONNECTION_RECOVERY.md) for scheduling and
mutation certainty.

## Creation authorization and outcomes in 0.7.10

`models.describe` keeps the existing fingerprint contract and adds an optional
`reason: {code,message} | null`. `auth_kind: native_oauth` identifies a native
Codex login reference on supported Hermes 0.21.7. Grant checks observe local
auth files without selecting, refreshing or importing credentials. Grants copy
no OAuth tokens, pools or auth files. The fingerprint covers native account and
route membership plus configured selection strategy; token rotation, cooldowns
and request counters do not change it. Hermes 0.21.0 returns
`NATIVE_UPGRADE_REQUIRED` for this path. API-key/custom grants remain separate.

`agent.create.role` accepts the same five-field Role as update. Historical text
normalizes to the description field when a new proposal is stored. Stored
request fingerprints are never rewritten. Full roles are mirrored before native
Bot Chat setup, with fresh persona and explicit capability restrictions.

Creation records a stage before native dispatch. A pre-dispatch rejection is
`failed`; a confirmed profile with incomplete setup is `partial`; a missing
creation receipt is `uncertain`. These attempts are never replayed automatically.
Incomplete creation profiles stay unenrolled across refreshes. Explicit owner
enrollment of a repaired existing profile supersedes its incomplete request,
retains its previous result and records the current stable identity. This does
not claim a successful provider/model turn.

`requests.approve` returns the saved `state` and `result` together. Clients apply
both and fence earlier pending reads. A lost response requires a read-only
status check before another decision. One request’s decision must not clear
another request’s uncertainty. This concerns management requests; native tool
approval response semantics are unchanged.

## Pending-input queue and native media catalog (0.7.11-preview.1)

This supersedes the pending-card placement described in earlier version sections.
Pending approvals, structured questions and secret prompts occupy the conversation's
input area in a stable, compact queue. Message drafts remain mounted while blocked.
Terminal or inactive requests leave small transcript receipts. Native tool/question/
secret receipts live in the signed-in app session; management receipts use the
owner-local journal. Successful complete native snapshots may mark omitted native
requests inactive; transport errors must retain known pending forms.

`requests.list` accepts `view: "pending" | "recent"` and nullable `cursor`. Each
page returns at most 25 rows with `generation`, `next` and `restart`. Drain pending
pages independently of completed history. If the journal generation changes during
a scan, restart the entire scan; never interpret an incomplete scan as revocation.
An unreadable row returns its ID, actor, state and `unreadable: true`, without
suppressing healthy siblings. `requests.get` reads the exact original request ID.

`requests.review` returns `kind: "ready" | "blocked" | "outcome"`. Ready includes
a review `digest`, `legacy`, `current_context`, `manager` and `manager_identity`.
The client sends the displayed digest on approval. Legacy creation requests require
explicit acceptance of the displayed current identity; the original ID, spec and
intent fingerprint do not change. Creation review may survive unrelated workspace
edits, while checking actor, target availability, model authorization and manager
identity. Other management actions keep their conservative revision guard.
Unknown native outcomes are observed, never automatically executed again.
For v1 callers only, an unchanged captured proposal can still approve without a
new digest; legacy or rebased creation cannot use that compatibility path.

`media.list` accepts an opened `session_id` and nullable opaque `cursor`, returning
`files` and `next`. Metadata contains saved message `row_id`, reference digest,
filename and size; it contains no private path or file bytes. Each page examines
at most 25 native history rows, so a page may be empty and still have `next`.
The cursor binds the native profile, database and canonical compression lineage;
changed history requires a fresh scan. Existing `media.read` independently
revalidates every actual file read. Remote links, user/private message references
and unsafe paths are excluded. `files.list` remains the separate owner-upload
catalog; failure of one Library source does not discard the other.

### Live snapshot row provenance (0.7.14)

`bot.open` and `chat.snapshot` may include `live_assistant_row_ids`, an array of
persisted native assistant row IDs proven to belong to the current live turn.
`active_user_row_id` alone does not authorize discarding later stored replies.
Clients preserve other canonical history rows in native order. Older servers
without this additive field cannot establish that overlap. Archived display
lineage is excluded when validating current-turn and deferred owner row IDs.

### Native tool approval scopes (0.7.14)

`chat.approvals` returns native `choices` for each pending request. `chat.approve`
accepts `once`, `session`, `always` or `deny` only when currently permitted for
that exact request; native smart-denial and session/permanent restrictions take
precedence. The native policy engine owns scope and pattern persistence.
`room.approve` remains limited to `once` or `deny` on the supported Hermes builds.
These scopes do not apply to `requests.approve` agent-management proposals.
