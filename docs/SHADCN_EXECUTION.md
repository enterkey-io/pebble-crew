# Shared UI implementation

Current correction: `0.7.8-preview.6`. Original candidate: `0.7.8-preview.5`.
Baseline: `291fab771b803edce4a4b63061303eb181af0a96`.
This implements the [Astra plan](SHADCN_IMPLEMENTATION_PLAN.md) in the existing
React application. It does not migrate to Vue or add a hosted application service.

## Chat migration correction

The preview.5 completion claim was too broad. Its transcript used inner shared
wrappers while legacy product CSS retained bubble geometry, timestamps and
floating actions. Passing import and behavior checks did not establish replacement
of that layout. The owner identified the incomplete migration after installation.

Preview.6 renders the complete shared composition documented in the official
[Message pattern](https://ui.shadcn.com/docs/ai-elements/radix/message): an owner
Bubble, unboxed agent Markdown and MessageFooter actions. Old desktop/phone
bubble geometry, metadata/action overrides and unused bubble tokens are deleted.
Typography, Code Block and Table now own Markdown presentation. Native receipt
identity, reactions, selected-Pebble colors and TranscriptFollow are retained.
An installed geometry journey and a negative legacy-CSS control cover the previous
gap. Phone screenshot review also caught a desktop tooltip remaining over the
conversation after touch-menu focus returned. Shared Tooltip suppresses hover
surfaces on coarse pointers; a phone test fails on the former build in both engines
and passes on the correction. Accessible button labels and desktop focus tooltips
remain available.

Runtime source: `e871609`. Evidence is retained under
`.audit/standard-transcript/`. A clean tracked-source checkout passed
`npm run check` (160 unit tests, types, lint, contracts, format and production
builds). The complete desktop suite passed 72 journeys; the complete phone suite
passed 89 with seven existing skips. After the touch-tooltip correction, another
21 desktop and 36 phone journeys passed, with six desktop-only cases skipped.
All nine AI catalog journeys passed across desktop, iPhone and Android. The actual
native owner flow passed against disposable Hermes and a deterministic local model.
Settled desktop, iPhone and Android conversation, Markdown and reaction screenshots
were inspected. These checks establish exercised behavior, not owner visual acceptance.
Exact-package acceptance and publication are tracked separately on the progress board.
The original verification record below describes preview.5.

## Decisions

- **D1, scrolling:** `@shadcn/react` 0.3.1's Message Scroller writes scroll position
  during initialization, anchoring, resizing and imperative calls. Its
  `autoScroll=false` setting alone cannot establish passive behavior. The installed
  Chat/ChatViewport composition therefore uses native passive anatomy and retains
  `TranscriptFollow` as its sole automatic movement owner. The upstream scroller
  remains available in the isolated catalog specimen. Stable receipt keys,
  `SendProjection`, manual reading intent and reduced motion remain intact.
- **D2, source graph:** official shadcn CLI 4.22.0 and the Radix Nova registry
  supply the expanded owned sources. The original customized primitives were
  preserved. React compositions cover Vue catalog equivalents; no Base UI,
  second theme, next-themes store or AI SDK runtime was introduced. Dependencies
  are pinned. See [provenance](UI_COMPONENT_PROVENANCE.md).
  The registry CLI was removed after import; its CSS utilities are owned beside
  the components. This removes the unneeded glob dependency chain affected by
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  instead of downgrading the design system or applying a forced dependency fix.
- **D3–D5, native authority:** `ConversationDomain` decodes existing native rows,
  reactions, public commentary, shared files and exact approval targets. Unknown
  structured outputs retain bounded generic Tool rendering. Reusable AI elements
  receive presentation facts and callbacks, never a bridge or native source row.
  Room member/task/request/execution generations survive approval round trips.
  Workspace change requests remain separate from runtime tool approvals.

## Coverage and limits

The executable catalog owns 73 general entries and 21 AI patterns. Exhaustive
typed specimen records, state/action/accessibility browser journeys and generated
coverage tables prevent a separate polished demo from drifting away from the app.
The workbench uses the production entry/theme, runs no native requests, and is
excluded from normal releases unless explicitly enabled at build time.

All installed feature surfaces retain their existing reducers and authorities.
Profile fields, reporting, role details and saved photos remain shared across
new, existing and edit flows. Reconnect preserves editor drafts and navigation.
Secret input clears before awaiting a receipt and stays out of transcript and
browser persistence. Voice keeps the existing native session and exact delegation
receipts; queued acknowledgement is never treated as completed work.

Prepared components do not claim optional native support. Checkpoint restore,
context metrics, generic questions, structured plans, citation provenance,
structured terminal/test/stack outputs and general agent-to-agent transcript
links need verified native contracts before activation. Existing voice delegation
matching remains supported. Model UI exposes only the already-authorized primary
model grant. Native live voice remains OpenAI on the newer supported Hermes pin;
the older pin keeps text and reports voice unsupported. Grok is not offered under
the owner's requirement to use native Hermes support.

## Verification record

Task logs and screenshots are retained under `.audit/shadcn-implementation/` and
`test-results/`. The live progress board is owner-local tooling with an SSE stream;
it holds task status only and is not part of the plugin runtime.

Runtime source verified: `e6937b37110f1c393c8be6ddeeb2ebbec3f94223`. Later delivery
changes add CI, source-archive verification files and this evidence record; they
do not change application runtime code. The tested combined archive SHA256 is
`0c5620467188c189e1758013d70a506dfae4b870c9c50838e1b3775f1559354e`.

| Gate                                          | Result                                                                                                                                      | Local evidence                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Fresh pinned install and full `npm run check` | Pass; 160 unit tests, types, worker types, lint, contracts, format and production builds                                                    | `clean-install-final.log`, `clean-check-final.log`                          |
| Dependency audit                              | Zero reported advisories after removing the unused registry CLI                                                                             | `clean-install-final.log`                                                   |
| Full normal-release desktop journeys          | 71 passed                                                                                                                                   | `desktop-candidate.log`, `evidence/candidate-desktop/`                      |
| Full normal-release iPhone/Android journeys   | 87 passed; seven documented inapplicable cases skipped                                                                                      | `mobile-candidate.log`, `evidence/candidate-phones/`                        |
| Complete component and AI state workbench     | 18 passed across desktop, iPhone and Android                                                                                                | `workbench-final.log`; final owned-utility run in `workbench-owned-css.log` |
| Structural counterexamples                    | Current source accepted; seven broken system compositions rejected; existing profile/history guard audit passed                             | `system-guard-audit.log`, `profile-guard-audit.json`                        |
| Release/workbench separation                  | Normal build accepted; actual workbench build rejected as a release                                                                         | `check-release-ui.mjs`, `release-ui-negative.log`                           |
| Native owner browser                          | Passed first use, profile/avatar persistence, real Bot Mode reply, idle/reconnect and login                                                 | `native-owner.log`, `test-results/owner/`                                   |
| Plugin contracts                              | 285 passed                                                                                                                                  | `plugin-tests.log`                                                          |
| Both pinned native revisions                  | Workspace, hierarchy, reactions and media passed; live voice/secret/session receipts passed on modern, correctly unsupported on legacy      | `native-{workspace,reactions,media}-{modern,legacy}.log`                    |
| Exact combined archive                        | All 31 installation and 22 browser checks passed, including crash recovery, update, partial sync, historical rollback and failed activation | `package-acceptance.log`, `evidence/installed-package-acceptance.json`      |

Settled desktop/iPhone/Android screenshots were opened and reviewed. Browser
fixtures establish exercised UI behavior. Disposable native acceptance establishes
the exercised Hermes contracts, not owner-host ingress or visual acceptance. The
six mobile desktop-only skips and one local WebKit peer-media skip are explicit;
iPhone voice setup and permission-failure flows still run. Local WebRTC does not
establish paid-provider timing or physical-phone media behavior. GitHub CI is
configured for these gates; this record describes local execution, not remote CI
results or deployment of the owner's installation.
