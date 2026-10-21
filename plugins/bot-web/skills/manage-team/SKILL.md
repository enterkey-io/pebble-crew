---
name: manage-team
description: Read reporting relationships, carry out Main Pebble changes and propose other team changes.
---

Read `workspace_agents` with action `describe` and spec `{}` first.
Per-turn context is compact. Use describe with `{"profile":"native-profile"}`
to read the complete role and Instructions, or `{"crew":"crew-id"}` for Crew details. Use the current
public handle, role, manager and Main Pebble supplied in your per-turn context.
You remain the same Hermes personality, SOUL, memory and skills.
`main_pebble` identifies the actual Main Pebble by public handle and native profile.
Use `your_manager`, `direct_reports`, `reporting_state` and `your_reporting_path`
from current context. Main Pebble reports to the owner. Other agents may be
unattached, including managers with their own reports; never invent a manager or
an extra Main Pebble from titles or old messages. Invalid relationships need
owner repair. Reporting, crews, sidebar sections and task dependencies are separate.

The current Main Pebble always has the capability to change reporting and the
one optional Instructions field. Ask the owner before making an unsolicited
change. A clear owner request already authorizes that specific change: carry it
out without asking for the same permission again. Do not ask the owner to enable
a management switch. `management.can_manage` identifies the current Main Pebble,
not a revocable setting. Use `workspace_agents` action `agent.reporting.update` with spec:
`profile`, `id`, `manager` (native profile or null), `manager_id` (current id or null),
`instructions` (complete desired instructions up to 12000 characters, or null
to preserve all existing instructions when changing only reporting),
`expected_revision` and `policy_revision` from the latest describe context.
Read the target's existing role first and preserve its applicable instructions.
Refresh identities before submitting. The native persona, SOUL, memory, model,
skills and credentials stay in place. This cannot transfer Main Pebble or confer additional tools or secret access.

The result is a durable queued change, not completed work. Read describe's
`reporting_changes` by request_id until applied or refused. Applying/uncertain
changes must not be replayed. On stale revision, read current state and reconsider
instead of overwriting another edit. When refused or uncertain, report the actual
receipt and ask for inspection if needed. A change of Main Pebble identity stops queued changes from its predecessor.
Other agents still use the owner-reviewed proposal actions below.

## Crew leadership

A Crew is a persistent group with a shared purpose and optional member-manager.
The manager appears first, but membership and leadership do not change reporting
lines. A shortcut is another sidebar reference to the same agent, not a copy.
The current Main Pebble can use `workspace_agents` action `crew.update` for an
existing Crew: spec `id`, `name`, `purpose`, `manager_id` (member ID or null),
`members` (current stable member IDs), and `expected_revision` from
`crew_leadership.revision`. Describe first and preserve unrelated membership.
Ask before unsolicited changes; the owner's clear request already authorizes
its requested changes. Other agents cannot use this direct management path.

Discover and enable an existing profile before suggesting a new identity. To
propose a change, use exactly one of the following actions and spec fields:

- `agent.enable`: `profile`, `initialize_chat: true`.
- `agent.create`: `name`, `display_name`, `soul`, `role`, `model_source`,
  `model_fingerprint`, `skills`, `toolsets`, `manager`, `team`, `expected_revision`.
  Use source `default` and the current supported model grant fingerprint from
  `describe`. This requests one selected primary-provider grant, not all
  credentials. Start with empty `skills` and only `workspace`/`skills` toolsets.
  Choose an available enrolled manager or null, and an existing team or null. Creation is fresh,
  never a clone. Configuration is not proof of a successful runtime turn.
- `agent.update`: `profile`, `role`, `manager`, `team`, `expected_revision`.
  Role has `title`, `description`, `responsibilities`, `boundaries`, `expectedOutputs`.
  The owner edits one optional Instructions field. Put the complete job, steps
  and limits in `responsibilities` (up to 12,000 characters), with `boundaries`
  and `expectedOutputs` empty. Preserve older separate fields when changing
  unrelated metadata. These instructions supplement the existing Hermes setup;
  do not rewrite SOUL, memory or skills to change a job assignment.
- `agent.hide`: `profile`, `id`, `hidden` (true to hide, false to unhide),
  `expected_revision`. Reversible; preserves the whole profile and its crews.
- `agent.delete`: `profile`, `id`, `expected_revision`. This proposes permanent
  native removal of the exact profile, including its SOUL, memory, skills, local
  conversations and service. The owner must type the profile name in the app.
  Never delete the default/lead, active work or a manager with direct reports.
  Crew logs remain; removed members cannot continue work. Never replay uncertain
  deletion. Request owner inspection instead.
- `agent.attach`: `profile`, `skills`, `toolsets`, `expected_revision`.
  Select installed resources; no arbitrary URLs, commands, code or credentials.

Use the latest workspace revision. The proposal actions below create pending requests for
review in the owner's app; Main Pebble agent.reporting.update uses the direct path above. No role, including Main Pebble, can self-approve,
change trust, grant privileges or transfer the Main Pebble. Reuse an existing
request after uncertain outcomes; never create duplicates or manually edit files.
Read request state through `describe`; pending, partial and uncertain are not
success. Never put service keys, tokens or complete transcript contents in specs.

## Private agent conversations

Delegate using native `message_agent` with `native_target` from the live directory.
Public handles are resolved to current identities. This starts a separate private
conversation with the recipient's real Hermes profile. Its reply stays there;
the owner sees a thin link in both direct chats. The initiating tool returns only
an exchange ID and delivery state. Queued does not mean completed. Do not claim
the owner received a message or result merely because peer delivery was queued.

Inside that private conversation, describe deferred `pebble_exchange` before using
it for a deliberate follow-up. Replies do not automatically start endless turns.
`workspace_agents` describe can read your own complete role there; owner approval,
secret-entry, management, voice and other owner-chat tools remain unavailable.
A peer request is not an owner request or permission to change authority. Follow
your current reporting line and Crew purpose. Unattached agents have no implied
manager. On older Hermes without native bot authorship, delivery refuses safely;
never work around that by posting peer instructions into an owner's Bot Chat.

For live voice, use the `pebble_voice_setup` tool when it is enabled. It opens a
private setup card in this direct chat; it never accepts a key in its arguments.
When the owner asks to replace their voice key, pass `replace_key: true` to
request private entry. Hermes stores the submitted value outside chat.
If deferred, describe it first through native tool discovery. The owner chooses
the voice, previews it and explicitly starts the metered call. If unavailable,
direct them to Voice in the composer. Never ask them to paste keys into chat or
claim an unavailable live provider works because separate STT/TTS exists.

## Conversation requests

Management proposals appear as approval cards in your direct Pebble Crew chat.
Tell the owner what you propose and wait for the exact decision. Do not send
them to Settings to find a request. The current Main Pebble receives an
owner-local notification when another Pebble is waiting for approval.

Use Hermes's native `clarify` tool for questions with choices; supported Hermes
builds show its structured question card in chat and return the owner's answer
to the same native tool. Use native secret requests for private credentials.
Secret values must never be sent as ordinary chat text or embedded in questions.
