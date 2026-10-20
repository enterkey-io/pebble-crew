# Project boards

Use **Chat | Tasks** to switch areas. Chat drafts and reading positions stay in
place. The global **+** menu can create a task or **New project board** in either
area. General tasks is for small, unfiled work; each substantive project gets
its own project board.

A project board links one native Hermes Project to one native Kanban board.
There is no Pebble Crew task database or execution service. Tasks, comments,
statuses, results and runs stay in Hermes. The plugin keeps only a stable catalog
identity, save/recovery receipts and mention-delivery cursors on that same host.

New tasks enter **Triage**. Creating or editing details does not start work.
Drag a card to **To do**, use its **Move to** menu, or change Status in the task
editor to queue it. Assigned tasks run through Hermes’s native dispatcher,
respecting dependencies, profile limits and execution policy. Unassigned tasks
wait for an assignee. In progress is set by Hermes when a worker claims the task.

Comments offer `@handle` completion. Posting a mention notifies that enrolled
Pebble in its existing Bot Chat, including the task reference and comment.
This does not reassign the task. Activity shows queued, delivered or unconfirmed
notifications; an uncertain delivery is not silently repeated.
Routines stay with their agents and are created through chat.

## Editing and recovery

Open a task card to edit its title, details, assignee and priority, or use
Activity to add a formatted comment. You can reassign queued or paused work;
active work must be paused first. Task details support Markdown and checklists.

Confirmed saves close the task editor. A change made by another client or in
Hermes appears without losing an unsaved draft; choose which edits to retain
before saving. A missing response is not treated as a failed write: Check save
looks up its receipt, and Resume save reuses the same identity for interrupted
creation. Unconfirmed comments are inspected rather than automatically appended
again.

Imported boards remain readable. Unlinked or conflicting project links must be
repaired in Hermes before editing through Pebble Crew; existing work is never
silently split or merged. The catalog stays with its original native profile
when Main Pebble changes. That profile cannot be deleted through Pebble Crew
until its catalog has been explicitly migrated.

## Hermes compatibility

Both supported builds (0.21.0 / 29112bef and 0.21.7 / af0cd4df) support project
boards, Triage task creation, reading and comments. Safe task-detail editing is
available on 0.21.7. The older build lacks the native edit helper, so those fields
are read-only there. Capability checks do not run models.

Agents discover `workspace_work` and its bundled `bot-web:manage-work` skill.
The tool requires explicit workspace and board references and stable operation
IDs for retries. Native `kanban_create` calls also validate project scope while
preserving the worker's physical native database fence. This does not restrict
an owner's unrestricted shell or direct database access.

## Verification

- `npm run check`
- Production desktop: `playwright.chat.config.ts` with `work.spec.ts`
- Production phones: `playwright.mobile.config.ts` with `work.spec.ts`
- Native owner UI: `npm run test:owner-browser`
- Native services: `scripts/fixture/projects_smoke.py` on both pinned builds
- Native deferred agent tool: `scripts/fixture/work_model_smoke.py` on both builds

Native acceptance uses disposable homes and a deterministic loopback model.
Install, update and status checks do not run models or workers. Native queue
acceptance substitutes the worker spawn boundary while exercising real claims
and completion. Mention acceptance uses an actual isolated Bot Chat and local
model; no owner infrastructure or provider credentials are used.
