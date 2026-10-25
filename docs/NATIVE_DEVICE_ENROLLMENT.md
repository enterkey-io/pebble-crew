# Native device enrollment

The combined Pebble Crew plugin supplies **Settings → Devices → Add a device**.
The Mac and phone clients connect to that owner's existing HTTPS origin. No vendor
credential service, discovery service or second owner login participates.

## Owner flow

1. Sign in to the installed web app and open Devices.
2. Create a single-use connection invitation, valid for five minutes.
3. On the phone, scan the QR code inside Pebble Crew. On the same Mac, open the
   desktop handoff; the copied-link fallback explains where to paste it.
4. Redemption removes the QR/link controls and shows Connecting. A valid native
   Hermes handshake confirms the device, closes the dialog and adds its row.
5. Revoke access to an individual device from its row.

An expired code offers a new code. A failed or malformed bridge response does not
confirm enrollment. Issuing an API ticket alone does not confirm a connection.

## Owner-hosted protocol

Authenticated owner routes are `/api/devices`, `/api/devices/invitation`,
`/api/devices/invitation/status` and `/api/devices/revoke`. Origin checks and the
existing owner session protect them.

The HTTPS QR link holds its invitation in a URL fragment. The `pebblecrew://`
desktop link carries the same fragment plus the exact owner origin. Both are
private bearer invitations; do not log them or load a third-party QR service.
The web app generates the QR locally.

The native client generates its own random 256-bit credential and device UUID,
then posts them with the invitation and device name to `/api/devices/redeem`.
An atomic database transaction consumes the invitation. Repeating the identical
redemption safely recovers a lost response; another device cannot reuse it.

`/api/devices/ticket` exchanges the device credential for a signed five-minute
bridge ticket. Only credential hashes are retained in the private owner database.
The native app retains its credential in Keychain. Tickets carry the device ID
and use the existing owner issuer, origin and installation audience.

Every device-authenticated request through the fixed combined proxy verifies the
signature and current grant. A successful `/v1/connect` response must contain the
expected protocol and connection lease before enrollment is marked connected.
Revoking a grant rejects its outstanding tickets and closes established HTTP
streams within the two-second grant check interval. Other devices and the owner's
browser session remain independent. Native clients do not receive owner cookies.

State survives service restarts and updates in the existing private owner database.
The standalone split-host owner service does not issue device invitations; this
release requires the combined plugin's fixed owner proxy.

## Verification

`devices.test.ts` exercises real SQLite transactions, owner authentication, origin
checks, competing redemptions, expiry, restart, confirmation and independent
revocation. `device-proxy.test.ts` exercises real loopback HTTP servers, failed and
malformed handshakes and revocation of an open stream.

Production browser journeys cover QR, fallback instructions, Connecting, the device
list and revocation on desktop, iPhone WebKit and Android Chromium. Final archive
acceptance redeems an invitation against a real disposable Hermes installation,
connects through the packaged proxy, then checks grant persistence and revocation
after update/restart/rollback. It adds no model prompts to the upgrade steps.

These checks do not prove physical camera scanning or the owner's installed native
app UI. Those require the native app's separate acceptance and owner testing.
