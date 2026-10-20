# Chat

## Sub-features

Sending, native receipt correlation, streaming activity, stable completion timestamps, user/agent reactions, reconnecting without losing drafts and scroll intent.

## How to get to it (user POV)

Choose a pebble or Crew from the rail. Type into Message. Use the message reaction control, or return from the background while a conversation is open.

## Driving it with Playwright

Run `CI=1 npx playwright test --config playwright.chat.config.ts live-feedback.spec.ts reactions.spec.ts setup-continuity.spec.ts message-motion.spec.ts`. For touch geometry and stable completion controls, run the relevant keyboard/reaction specs with `playwright.mobile.config.ts`. Verify the addressed message, stable DOM/timestamp and draft, not just the presence of response text. Inspect normal, selected and hovered emoji styling and the settled phone screenshots.

`interaction-feedback.spec.ts` samples activity settlement and send/stop glyph
frames, real label changes, cancellation, held gestures and reduced motion.
It also checks that visible reply text replaces the activity label while later
tool work remains visible. `connection-recovery.spec.ts` holds a replacement
handshake to verify stable composer controls, typography, focus and draft editing,
with sending blocked until recovery. Both run through their phone wrappers.
`startup.spec.ts` holds authentication, connection and native opening separately
to reject transient empty-picker screens, then checks unavailable defaults,
selected pebble/room restoration, replaced identities and post-mount resize
following. Both run through the mobile wrappers as well.

`agent-media.spec.ts` verifies lazy native-style image/file reads, downloads,
reconnect/reaction stability, reload, local retries and no automatic remote image
requests. `markdown.spec.ts` checks code indentation/copy/overflow, semantic lists,
quotes and tables with readable column headings and contained horizontal scroll.
Run both through `playwright.chat.config.ts` and `playwright.mobile.config.ts`, then
inspect settled screenshots. Images above the restored latest-message viewport
load when scrolled into view; approach the stable image frame before asserting
decoded pixels.

`image-viewer.spec.ts` opens an original chat photo in the shared borderless
dialog, exercises wheel/keyboard zoom, pan, fit, backdrop/Escape/Back dismissal
and draft/image preservation through reconnect. Its phone wrapper additionally
checks touch pinch/pan, resized viewports and reduced motion. Inspect settled
desktop, iPhone and Android captures. Touch-event checks do not prove physical
device gestures; mobile WebKit does not expose a mouse-wheel driver.

`scripts/fixture/media_smoke.py` verifies actual native assistant provenance and
bounded reads in isolated default/named profiles on both supported Hermes builds,
including database replacement between chunks. It asserts zero model turns.
The native-owner browser journey additionally displays an actual generated image,
downloads a multi-chunk CSV, and restores that selected conversation after reload.

Use native-owner and `scripts/fixture/reactions_smoke.py` for native reaction schema discovery and model receipt behavior. The latter needs an isolated prepared Hermes checkout. CI covers both supported reaction builds.

`unread.spec.ts` checks blue pulsing row-edge indicators and the pinned avatar's
lower-right badge, replacement/restoration of the Main star, read receipts and
reduced motion in both themes. It runs on desktop, iPhone and Android. Geometry
reads for animated drawers must compare elements in the same frame or wait for
the settled relation; separate bounding-box reads can sample different frames.

`conversation-cards.spec.ts` checks native approvals in the transcript, Main
notifications linking to the exact originating request, fingerprint preservation
and native structured question answers. `scripts/fixture/conversation_cards_smoke.py`
exercises real clarify and approval tools plus one Main notification per request
on both pinned builds, using disposable homes and a deterministic loopback model.
The older build requires its native clarify toolset enabled in the synthetic CLI
configuration. Do not confuse a missing toolset with a transport failure, and do
not change an owner's tool configuration as part of acceptance.

## Gotchas

Browser fixture hooks interrupt a real browser response stream, but simulate the external native service. Do not claim native model/tool discovery from those checks. Message-motion checks sample real frames, not just settled geometry; reduced motion and manual scrolling have separate cases. Geometry assertions need an explicit rounding tolerance; a successful rerun does not repair a flaky assertion.

The native journey switches to reduced motion after its avatar check, before
accelerating lifecycle timers. Playwright's accelerated performance/timer clock
and the browser's Web Animations timeline diverge; advancing four minutes can
schedule a normal exit animation four minutes ahead. Keep motion proof in the
real-frame production journeys instead of interpreting that clock mismatch as
a native completion failure.

Document reader: `documents.spec.ts` runs on desktop and both phone projects.
Open a generated Markdown link with View; verify headings/table/code, plain text,
retry, draft retention and no remote image request. Agent live requests open only
once, expire and do not reopen after reconnection. The native owner journey asks
the deterministic local model to discover and invoke `pebble_open_document`,
checks the mobile reader, then reopens the saved link on desktop.
