# Project boards and tasks

Use the production Chat | Tasks switch. Global New offers New project board and
New task in either area; routines stay with agents. A native Project has one
linked native board. General tasks is for small unfiled work.

Run work.spec.ts with playwright.chat.config.ts and playwright.mobile.config.ts.
The journeys create separate boards, assign Triage tasks, edit instructions,
render Markdown comments, preserve chat drafts and task conflicts across
transport restoration, and reconcile lost responses/partial creates without
creating another record. Geometry checks require readable non-overlapping
columns on both phones. Inspect settled desktop, iPhone and Android captures.

Run npm run test:owner-browser for real owner login, project/task creation,
editing, comments and persistence after reload against the native bridge.

Run scripts/fixture/projects_smoke.py with each pinned prepared Python/native
source. It checks actual RPC/native services, stable cross-profile catalog
scope, stale writes, idempotency, each partial-create boundary, native create
middleware and the worker database fence. It runs no models or workers.

Run scripts/fixture/work_model_smoke.py on both native builds for actual deferred
workspace_work schema discovery with saved tool selection and catalog listing
disabled. A deterministic loopback model creates a project and its triage task,
then observes native readback. No worker starts and the persona is unchanged.

Safe native task-detail edits are available on 0.21.7, and read-only on 0.21.0.
Unlinked/conflicting imported boards remain readable until their native mapping
is repaired. A bound catalog profile cannot be deleted without migration.

See docs/PROJECT_BOARDS.md for the public behavior and phase boundaries.
