# Connections

## Sub-features

Settings navigation, personal account photo, service discovery, OAuth completion, API-key receipts, tool discovery, unsaved access policy and guarded navigation.

## How to get to it (user POV)

Open Your account, Settings, Connections. Choose a service to view its details. Add connection opens discovery. Tool access reveals the native or custom policy.

Your account → Your photo opens the photo-only editor; the same controls appear in Settings → Account. The empty state is an account icon, never an animated pebble.

## Driving it with Playwright

Run `CI=1 npx playwright test --config playwright.chat.config.ts connections.spec.ts connection-recovery.spec.ts`. Run `CI=1 npx playwright test --config playwright.mobile.config.ts connections.spec.ts connection-recovery.spec.ts` for iPhone WebKit and Android Chromium. The existing fixture uses separate OAuth and API-key services. Check affirmative save receipts, cancellation, focus return and unsaved-policy preservation through discovery and guarded navigation.

Run `account-photo.spec.ts` in both production browser configurations for photo-only controls, local validation, failure retention, reload/removal and reconnect draft continuity. `npm run test:owner-worker` verifies the real workerd/D1 encoder with independent browser pixel decoding and restart persistence. `npm run test:owner-browser` exercises the real Node route and persisted owner image across reload and login. Neither uses owner data or external image services.

## Gotchas

Recovery tests replace the transport lease while a custom tool and key text are unsaved. A divergent remote policy must offer an explicit keep/discard decision. Key text stays transient. Ordinary Add-flow survival is not proof of Connections policy ownership; run these specific journeys.
