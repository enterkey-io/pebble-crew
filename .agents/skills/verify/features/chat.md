# Chat

## Sub-features

Sending, native receipt correlation, streaming activity, stable completion timestamps, user/agent reactions, reconnecting without losing drafts and scroll intent.

## How to get to it (user POV)

Choose a pebble or Crew from the rail. Type into Message. Use the message reaction control, or return from the background while a conversation is open.

## Driving it with Playwright

Run `CI=1 npx playwright test --config playwright.chat.config.ts live-feedback.spec.ts reactions.spec.ts setup-continuity.spec.ts message-motion.spec.ts`. For touch geometry and stable completion controls, run the relevant keyboard/reaction specs with `playwright.mobile.config.ts`. Verify the addressed message, stable DOM/timestamp and draft, not just the presence of response text. Inspect normal, selected and hovered emoji styling and the settled phone screenshots.

`interaction-feedback.spec.ts` samples activity settlement and send/stop glyph
frames, real label changes, cancellation, held gestures and reduced motion.
`startup.spec.ts` holds authentication, connection and native opening separately
to reject transient empty-picker screens, then checks unavailable defaults and
post-mount resize following. Both run through the mobile wrappers as well.

Use native-owner and `scripts/fixture/reactions_smoke.py` for native reaction schema discovery and model receipt behavior. The latter needs an isolated prepared Hermes checkout. CI covers both supported reaction builds.

## Gotchas

Browser fixture hooks interrupt a real browser response stream, but simulate the external native service. Do not claim native model/tool discovery from those checks. Message-motion checks sample real frames, not just settled geometry; reduced motion and manual scrolling have separate cases. Geometry assertions need an explicit rounding tolerance; a successful rerun does not repair a flaky assertion.
