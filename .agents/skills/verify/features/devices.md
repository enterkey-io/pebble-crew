# Native devices

Use the actual combined plugin and owner login. Devices is an owner Settings tab;
Requests is absent. Decisions stay inline in the originating chat, with missing
or hidden authors reviewable by the Main Pebble.

- `test/chat-workspace/device-settings.spec.ts`: local QR, explicit phone and Mac
  instructions, copied-link fallback, fixed dialog header, Connecting, confirmation,
  independent revocation and expired-code recovery. Its mobile import exercises
  iPhone WebKit and Android Chromium. Inspect light/dark settled screenshots.
- `test/chat-workspace/requests.spec.ts`: unavailable-agent review stays inline,
  approval fields fit phones, exact deletion is confirmed and the receipt compacts.
- `packages/owner-service/src/devices.test.ts`: real owner auth and SQLite,
  single-use races, retry after lost redemption, expiry, restart and revocation.
- `packages/owner-service/src/device-proxy.test.ts`: real HTTP proxy refuses to
  confirm failed/malformed handshakes and closes a revoked device's event stream.
- `scripts/test-installed-plugin.mjs`: final archive, real disposable Hermes,
  cookie-free device redemption and handshake, grant preservation across update,
  restart and rollback, then rejection of the revoked device and issued ticket.

Run `npm run check`, the focused production desktop/phone specs, native-owner and
unchanged final installed-package gates. These checks do not prove physical camera
scanning or the native application's separate UI. Never use owner credentials or
send installation/update model prompts. The installation gate's existing synthetic
chat uses only the deterministic localhost model in its disposable acceptance home.
