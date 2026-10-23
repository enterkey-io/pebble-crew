# Crew coordination, Plans and proactive help

Use `crew-coordination.spec.ts`, `plans-proactive.spec.ts` and
`message-motion.spec.ts` with `playwright.chat.config.ts`, then the same names
with `playwright.mobile.config.ts`. The phone wrappers exercise iPhone WebKit
and Android Chromium. Use the production bundle; block service workers in these
synthetic external-bridge journeys. Inspect their settled screenshots.

Crew coverage includes manager-first ordering, manager/purpose persistence,
reporting independence, shared portraits with five actual faces and one animated
foreground, and live private conversation history. Plans coverage includes
create/edit/link/reload, project goals, remote conflicts, unchanged-content stale
retries and exact receipt recovery. Proactive coverage includes unchecked
suggestions, edited schedules, no chat/model submission, unresolved saves across
reload and resuming a definitively unsaved setup. Returning to a settled chat
must retain both latest and manually scrolled positions without catch-up motion.

Run `scripts/fixture/work_model_smoke.py` with explicit pinned native sources and
their prepared isolated environments. Current Hermes uses Python3.14 locally;
legacy acceptance uses Python3.12, matching CI. Both use disposable homes and a
deterministic localhost model. Actual worker requests must carry goals and Crew
purpose; auxiliary session-title requests have a separate title-only protocol.
Verify native work tools, physical board binding, actual Bot Chat delivery and
model-free proactive setup. Only the separate synthetic execution step runs the
new cron job; never run it on an owner's home or during installation/update.

`test:owner-browser` includes the real three-Markdown-upload path. File cards and
caption must survive native completion and reload, with no expanded document
content in the owner's bubble. The local model separately asserts all three
contents reached it. Native persisted history is not rewritten.
