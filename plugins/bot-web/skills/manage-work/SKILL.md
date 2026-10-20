---
name: manage-work
description: Organize native Hermes projects and tasks with explicit board scope.
---

# Projects and tasks

Use `workspace_work` from your direct Pebble Crew chat. If Hermes defers it,
load its actual schema with `tool_describe(names=["workspace_work"])`, then call
it through `tool_call`. Do not claim a tool is missing before native discovery.

Call with `{ "operation": "work.describe", "params": {} }` first. Read the
workspace ID, board slugs, mapping and capabilities. Names, crews and reporting
relationships do not establish a task's project or assignee.

Each substantive project gets its own **project board**. **General tasks**
(`default`) is for unfiled work. Never put unrelated projects on one board,
change Hermes's global current-board pointer, or invent a project database.
Native Projects and boards are separate records; Pebble Crew links them.

Every mutation carries the exact `workspace_id` and a new UUID `operation_id`.
Reuse that same operation ID and unchanged payload after an interrupted request.
`work.receipt` takes those two fields. `completed` confirms the saved native
record; `uncertain` requires inspection, and must not be replayed as a new save.

| Operation             | Additional params                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `work.project.create` | `name`, `description` (string; may be empty)                                                                                          |
| `work.project.update` | `project_id`, `expected_revision` from its board, `name`, `description`                                                               |
| `work.task.create`    | `board`, `title`, `body` (Markdown/checklist), `assignee` (profile or null), `priority` (integer; low -1, normal 0, high 1, urgent 2), optional `status` (defaults to `triage`) |
| `work.task.update`    | Same task fields plus `id` and task `expected_revision`; requires `capabilities.edit_details`                                         |
| `work.task.comment`   | `board`, `id`, `body`; `@handle` notifies enrolled pebbles                                                                            |
| `work.task.move`      | `board`, `id`, `expected_revision`, `status` (`triage`, `todo`, `ready`, `blocked`, `done`, `archived`)                               |

Reads omit `operation_id`: `work.board` takes `workspace_id` and `board`;
`work.task` additionally takes the native task `id`. Always carry the board
reference even when another board happens to be active in Hermes.

New tasks default to **Triage**. Creating a task with explicit **To do**/`todo` or `ready` status, or moving an assigned task there, queues it for Hermes’s native dispatcher. Dependencies,
profile concurrency and native execution policy still apply. **In progress** is
owned by the dispatcher, not a status you set manually. A comment containing an
enrolled `@handle` wakes that pebble’s existing Bot Chat to read the comment; it
does not reassign or restart the task. Task reads include native events, worker runs, comments and mention delivery state. Read this history before claiming a task completed. Leave concise native `kanban_comment` progress, blocker and verified-result updates while doing a task. Include the actual deliverable in the native completion summary/result. A worker’s final CLI reply alone is not a message to the owner. Outcomes from work queued through Pebble Crew are delivered to the assignee’s existing Bot Chat; do not claim delivery before it is confirmed. Give the task a concrete deliverable and acceptance instructions. Read
back its native ID and project before confirming success. A saved task is not
completed work. Execution and review remain governed by Hermes's native Kanban
tools; dispatcher workers use their existing task-scoped tools.

Use checklists inside task Markdown. Native parent links mean **prerequisites**,
not project membership or reporting lines. Cross-board references are plain
references; do not create cross-board dependency edges. Routine definitions and
schedules stay with the agent; they are not a project board or Tasks setting.

If project links conflict, show the existing board and ask for repair. Never
silently merge projects, adopt an ambiguous catalog or delete a partial board.
