# Message reactions

Direct pebble chats use Hermes's native message reactions. The app shows both
owner and agent reactions, with one reaction per author per message. Picking a
different emoji replaces your reaction; picking the same emoji or clicking your
reaction removes it. Touch devices expose the reaction button without hover.

Opening a managed Bot Chat enables `display.message_reactions` in that profile
through a fixed, profile-scoped native helper. Unrelated settings, SOUL, memory
and model configuration are preserved. This does not send a model prompt.
The enrolled integration provides `pebble_react`, a session-verified wrapper
around Hermes's `react_to_message_tool`. Agents can react to the current or an
earlier message, and native `message.reaction` events update the open transcript.
No desktop-wide toolset or arbitrary native RPC is exposed.

Owner reactions are persisted on Hermes's message rows. Hermes includes unseen
owner reactions in the agent's next user turn, once. Adding a reaction does not
start an additional model turn. Reloading the app reads the same native history.
Direct-chat reactions use no separate reaction database or hosted reaction service.

Hermes's group API has no reaction operation. Crew and ad hoc group reactions
therefore use an owner-local overlay in Pebble Crew's Hermes workspace database.
Targets are verified against the live native room and its immutable message
events. Reactions never alter native transcripts or copy their text into the
overlay. Each pebble has its own reaction identity; removed/replaced rooms do
not inherit them. Group participants receive current reaction feedback in their
next native turn. Reacting alone does not run a model.

Agents receive selective per-turn guidance: a fitting reaction can acknowledge a
message without a redundant written reply. Native silence markers are suppressed
in the displayed stream and history; native stored rows remain intact. User
message reactions align at the lower-right edge; agent message reactions align
at the lower-left. Both are transparent, borderless and clear of message text.

## Wire contract

Integration 0.7.3's `POST /v1/connect` advertises `capabilities.reactions: true` on the updated
integration. Older integrations omit the capability and get no reaction action.
The protocol identifier and NDJSON framing are unchanged.

`chat.react` accepts exactly `session_id`, a positive integer `row_id`, and
`emoji` (a bounded Unicode emoji sequence or `null` to clear). The connection
must already have opened that managed chat. Author is always `user`; callers
cannot impersonate the agent. Native session lineage and profile-incarnation
checks prevent cross-conversation or retired-profile writes.

The result is `{row_id, reactions}` from `message.react`. Both owner changes
and native agent changes emit `message.reaction`. Message history carries the
durable list in `display_metadata.reactions`. Internal `seen` bookkeeping is not
part of the rendered state. Uncertain mutation outcomes are never replayed.

Integration preview.21 adds `capabilities.room_reactions`. `room.react` accepts
exactly `room_id`, `event_id`, and `emoji`. Its receipt includes `event_id`,
`reactions`, `room_key` and monotonic `revision`. `room.log` adds `room_key`,
`reaction_revision` and `reaction_updates`, including empty lists for removals.
Older polls cannot replace a newer receipt. Agent `pebble_react` uses the current
verified native group session; `message_event_id` targets a group message and
omitting targets selects the latest user message. Direct chats still use
`message_row_id`. Neither allows choosing another caller or room.

## Updates and verification

This feature needs the updated web bundle and integration together. Use the
normal combined-package update and `hermes bot-web sync-runtime` step in
[the agent installation guide](AGENT_INSTALL.md) so enrolled profiles receive
the new tool. Opening their chat enables native feedback automatically.

Production browser checks cover picking, replacing, removing, persistence,
agent events, keyboard accessibility and phone bounds. Native owner acceptance
uses a disposable Hermes home and a local model to call the agent reaction tool,
render its event, submit owner feedback, verify that feedback reached the model,
and confirm persistence/removal after reload. These checks do not use an owner's
installation, credentials or personas.

Run `scripts/fixture/reactions_smoke.py` with each pinned Hermes interpreter and
source import path for the focused native round trip. The `native-owner` CI job
also runs it after browser acceptance.
