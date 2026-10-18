# Shared UI implementation

Candidate: `0.7.8-preview.5`. Baseline: `291fab771b803edce4a4b63061303eb181af0a96`.
This implements the [Astra plan](SHADCN_IMPLEMENTATION_PLAN.md) in the existing
React application. It does not migrate to Vue or add a hosted application service.

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

Final clean-checkout, workbench, phone, native and exact-package results are
recorded after the immutable candidate completes those gates. Browser fixtures
establish exercised UI behavior. Disposable native acceptance establishes the
exercised Hermes contracts, not owner-host ingress or visual acceptance. Local
WebRTC does not establish paid-provider timing or physical-phone media behavior.
