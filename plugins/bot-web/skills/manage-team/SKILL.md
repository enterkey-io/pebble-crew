---
name: manage-team
description: Read workspace identity and propose native agent changes for owner approval.
---

Read `workspace_agents` with action `describe` and spec `{}` first. Use the current
public handle, role, manager and Main Pebble supplied in your per-turn context.
You remain the same Hermes personality, SOUL, memory and skills.
`main_pebble` identifies the actual Main Pebble by public handle and native profile.
Use `your_manager`, `direct_reports`, `reporting_state` and `your_reporting_path`
from current context. Main Pebble reports to the owner. Other agents may be
unattached, including managers with their own reports; never invent a manager or
an extra Main Pebble from titles or old messages. Invalid relationships need
owner repair. Reporting, crews, sidebar sections and task dependencies are separate.

When `management.can_manage` is true, the verified Main Pebble can directly change
reporting and the one optional Instructions field, without owner approval for each
change. Use `workspace_agents` action `agent.reporting.update` with spec:
`profile`, `id`, `manager` (native profile or null), `manager_id` (current id or null),
`instructions` (complete desired instructions up to 12000 characters, or null
to preserve all existing instructions when changing only reporting),
`expected_revision` and `policy_revision` from the latest describe context.
Read the target's existing role first and preserve its applicable instructions.
Refresh identities before submitting. The native persona, SOUL, memory, model,
skills and credentials stay in place. This cannot change the management grant,
transfer Main Pebble or confer additional tools or secret access.

The result is a durable queued change, not completed work. Read describe's
`reporting_changes` by request_id until applied or refused. Applying/uncertain
changes must not be replayed. On stale revision, read current state and reconsider
instead of overwriting another edit. When refused or uncertain, report the actual
receipt and ask for inspection if needed. A revoked grant stops queued changes.
Other agents still use the owner-reviewed proposal actions below.

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
review in the owner's app; authorized agent.reporting.update uses the direct path above. No role, including Main Pebble, can self-approve,
change trust, grant privileges or transfer the Main Pebble. Reuse an existing
request after uncertain outcomes; never create duplicates or manually edit files.
Read request state through `describe`; pending, partial and uncertain are not
success. Never put service keys, tokens or complete transcript contents in specs.

Delegate using native `message_agent` with `native_target` from the live directory.
The integration also resolves configured public handles. Report to your configured immediate
manager. An unattached branch has no implied link to Main Pebble. A queue acknowledgement is not completion:
wait for a substantive result before starting dependent work. Do not invent task
scheduler guarantees or bypass owner approvals.

For live voice, use the `pebble_voice_setup` tool when it is enabled. It opens a
private setup card in this direct chat; it never accepts a key in its arguments.
When the owner asks to replace their voice key, pass `replace_key: true` to
request private entry. Hermes stores the submitted value outside chat.
If deferred, describe it first through native tool discovery. The owner chooses
the voice, previews it and explicitly starts the metered call. If unavailable,
direct them to Voice in the composer. Never ask them to paste keys into chat or
claim an unavailable live provider works because separate STT/TTS exists.
