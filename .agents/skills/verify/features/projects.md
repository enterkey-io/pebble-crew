# Project boards and tasks

Use the production Chat | Tasks switch. Global New offers New project board and
New task in either area; routines stay with agents. A native Project has one
linked native board. General tasks is for small unfiled work.

Run work.spec.ts with playwright.chat.config.ts and playwright.mobile.config.ts.
The journeys create separate boards, assign Triage tasks, edit task details,
render Markdown comments, preserve chat drafts and task conflicts across
transport restoration, and reconcile lost responses/partial creates without
creating another record. Geometry checks require readable non-overlapping
columns on both phones. Light/dark controls, content-sized dialogs, untouched
Cancel, compact destructive confirmation, movement through status/menu/drag and
comment handle completion are covered. Initial-status creation, grab cursors, inset drop indicators,
responsive navigation and native event/run history are covered in both themes. Inspect settled desktop, iPhone and Android captures.

Run npm run test:owner-browser for real owner login, project/task creation,
editing, comments and persistence after reload against the native bridge.

Run scripts/fixture/projects_smoke.py with each pinned prepared Python/native
source. It checks actual RPC/native services, stable cross-profile catalog
scope, stale writes, idempotency, each partial-create boundary, native create
middleware and the worker database fence. It also exercises native To do promotion, dispatcher claims with a substituted
spawn boundary, completion, stale moves and mention recovery. No model or real
worker process is started by this service-only check.

Run scripts/fixture/work_model_smoke.py on both native builds for actual deferred
workspace_work schema discovery with saved tool selection and catalog listing
disabled. A deterministic loopback model creates a project and its triage task,
then observes native readback. A task comment then wakes the canonical Bot Chat
exactly once and confirms its delivery receipt. A real dispatcher-owned worker
then comments and completes a greeting task through native tools, its events and
run summary reach the task detail, and its outcome reaches the existing Bot Chat
once. The persona is unchanged; only the loopback provider is used.

Safe native task-detail edits are available on 0.21.7, and read-only on 0.21.0.
Unlinked/conflicting imported boards remain readable until their native mapping
is repaired. A bound catalog profile cannot be deleted without migration.

See docs/PROJECT_BOARDS.md for the public behavior and phase boundaries.

`chart-task-polish.spec.ts` checks circular neutral composer actions, padded task
insertion targets, persistent same-column order, a bounded Activity scroll owner
with a fixed header and reachable Post comment, and useful focus after creating
a task. Its phone wrapper covers both engines. The real native projects smoke
asserts that presentation reordering survives reads without changing priority,
native history, task revision or runs.

`work-loading.spec.ts` injects catalog/board failures into the production UI. It
checks automatic recovery without an error flash, kit recovery screens in both
themes, retention of loaded task elements after a failed refresh, wrong-workspace
catalog rejection without repeated reads, and navigation during a catalog failure.
Its phone wrapper runs the same cases on iPhone and Android. Reconnection pauses
board reads and keeps the loaded board mounted until the new connection is live.

An expired board authorization uses the existing owner login to reconnect. Count
new POST leases separately from the old lease's DELETE cleanup when checking it.
