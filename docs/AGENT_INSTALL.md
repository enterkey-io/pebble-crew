# Install Pebble Crew

For the owner's Hermes installation agent: install the **combined plugin** on the
owner's Hermes host. It includes the web app, owner login and native Bot Mode
integration. Finish supervision and HTTPS verification, then give the owner **one
private setup link**. No address form, pairing conversation, placeholder agent or
second installation agent belongs in this flow.

Pebble Crew’s project domain is `pebblecrew.com`. Olares is simply one possible Hermes host;
there is no Olares app package. No vendor runtime service or account is required.
Conversations, memory, personality, service credentials, photos, login keys and
app configuration all stay on the owner's infrastructure.

## 1. Inventory before changing anything

Identify the actual Hermes interpreter, source revision, persistent root
HERMES_HOME, service account, primary agent, existing plugin, network route and
service manager. Do not use an incidental named profile or sticky CLI selection
as proof of the root installation or primary agent. Preserve profiles, SOUL,
memory, skills, channels, history, roles and photos. Never create a starter bot.

This preview supports native revisions `29112bef…` (0.21.0) and `af0cd4df…`
(0.21.7) on Linux/macOS. Package metadata 0.0.0 is not itself a rejection. An
untested native surface needs maintainer revalidation; do not downgrade Hermes,
edit core files or bypass fingerprints.

The host needs Node 22.13 or newer (Node 26 recommended), npm, the existing
Hermes Python environment and persistent owner-only storage. Browser assets are
prebuilt; no frontend build is needed. Resolve the plugin's declared Python
dependencies through the supported native dependency flow, or check and install
`bot-web/requirements.txt` in that same Hermes environment. Never replace the
environment or copy credentials to a separate gateway installation.

Inspect existing ports. Two distinct free loopback ports are needed: web and
internal integration. An occupied port can belong to MCP; never stop it. Reuse
saved ports and origins on updates. Keep old bridge settings and stores intact.

For an existing 0.2/0.3 API-only preview, plan a brief migration: record and back
up that integration's exact code, owned service and route configuration; avoid
interrupting active work. Stop only its identified bridge before replacing its
code and starting the combined native integration. Keep the old web app and all
unrelated services intact until the new route passes. If migration fails, restore
the old integration code/service and its preserved settings. Do not run two native
room drivers against the same home as an installation shortcut. Old temporary
browser grants are not migrated; the new app creates its owner login once.

The old `$HERMES_HOME/bot-web/connection.json` is intentionally retained unchanged
for rollback to the API-only service. Its old admin token is not used by the
combined service; that service reads its private settings from
`$HERMES_HOME/bot-web/web/install.json`. Keep the old file private (0600) with the
old service stopped. Do not copy its credential into the new settings or delete
it during install/update. After the owner accepts the migration and closes the
rollback window, it can be archived privately with the old service/code.

## 2. Establish the owner's HTTPS route

Choose one canonical HTTPS origin on owner-controlled infrastructure. Reuse an
appropriate reverse proxy, ingress or private tailnet route. Preserve its Host
header, pass WebSocket upgrades for `/v1/computer/stream` without changing
Origin/Host, disable response buffering, and allow streams longer than the 15-second
heartbeat interval. Only the web listener needs external routing: it forwards
`/v1/*` internally. Preserve all unrelated routes and keep the integration port
on loopback. Disable logging of bodies, Authorization headers, cookies, private
setup links and OAuth query parameters. Tailnet-only access requires the browsing device on the tailnet.

Do not depend on our machines, domains, accounts or tailnet. In Docker/Kubernetes,
inspect persistent deployment configuration, state volumes and startup/ingress
permissions. Installing files inside a running pod does not create a durable
service or network route. If deployment authority is missing, report that exact
requirement before promising a URL. A terminal or `nohup` process is not a finished
installation.

## 3. Obtain the immutable combined release

Candidate: `v0.7.8-preview.13`. If these assets are not published, stop and report
that the candidate is unavailable. Do not substitute main or an API-only package.

- [Manifest](https://github.com/enterkey-io/pebble-crew/releases/download/v0.7.8-preview.13/workspace-manifest.json)
- [SHA256SUMS](https://github.com/enterkey-io/pebble-crew/releases/download/v0.7.8-preview.13/SHA256SUMS)
- [Complete plugin](https://github.com/enterkey-io/pebble-crew/releases/download/v0.7.8-preview.13/workspace-plugin-preview.zip)
- [Source](https://github.com/enterkey-io/pebble-crew/releases/download/v0.7.8-preview.13/workspace-source-preview.zip)

Verify size and SHA-256 against both manifest and checksum file. Reject absolute
archive paths, traversal, symlinks and entries escaping private staging. The
installable directory is `bot-web/`, including `web-runtime/`. The repository root
is development source, not a prebuilt plugin. Owners do not need to fork it.

Back up existing plugin code privately, then put the complete `bot-web/` directory
in the root Hermes home's plugins directory and enable it natively. Preserve
`$HERMES_HOME/bot-web/`: mutable state never comes from package files.

```sh
hermes plugins enable bot-web
hermes bot-web doctor
```

Inspect `hermes plugins enable --help` first. If this build offers `--yes-deps`,
pass it after reviewing the declared dependency plan; headless enabling otherwise
refuses dependency preparation. Older builds may require the explicit same-runtime
requirements installation and do not accept that flag. Resolve this within the
installation session; do not ask the owner to relay dependency errors.

## 4. Configure once and attach persistent supervision

Run as the Hermes service account with its verified root HERMES_HOME. Replace the
example origin and select the actual supervisor. Free ports are chosen unless
explicit `--web-port` and `--bridge-port` values are required by the deployment.

```sh
hermes bot-web install --origin https://workspace.example.com --supervisor systemd-user
hermes bot-web service
```

Use `--supervisor launchd` on macOS, or `--supervisor external` for Docker, s6,
Kubernetes or another existing host supervisor. Installation verifies prebuilt
files, installs locked production dependencies without lifecycle scripts, stages
an immutable release, and creates local login keys and internal trust. No token
or trust file is passed to the owner or entered into the browser.

Mutable state is `$HERMES_HOME/bot-web/web/`, separate from plugin code. Repeating
the same installation preserves the keys, account, ports and release. Do not run
the independent `setup`, `enroll` or `approve` commands for combined mode.

For systemd user services, enable lingering for the Hermes service account before
service activation so startup survives reboot without login. On macOS, launchd
starts after that account logs in; do not promise pre-login availability.

For an external supervisor, `service` returns `supervised: false` and generated
service files. Attach the exact foreground command/environment from
`$HERMES_HOME/bot-web/web/service/container-command.json` to the deployment's
persistent supervisor and state volume. Its local manager restarts both children
and the native subprocess. The outer supervisor must restart that manager too.
Files generated does not mean supervision completed.

Route the canonical HTTPS origin to `web_port` in private `install.json`. Keep
both listeners on loopback and supply the appropriate proxy/container network
route. Do not expose the integration port separately.

For a verified named primary, bind it before onboarding:

```sh
hermes bot-web primary EXISTING_PROFILE_NAME
```

Otherwise use root/default primary detection. Do not guess alphabetically,
clone an agent, rewrite SOUL, enroll every profile or send model messages. The
owner confirms their primary @ handle and avatar in the UI and adds others later.

## 5. Verify before giving the owner a link

```sh
hermes bot-web status
hermes bot-web verify --public
```

The real HTTPS route must report the owner service, native bridge, running active
release, immediate `bridge.ready` and a heartbeat as ready. Probes delete only
their own lease, never globally revoke browsers. They send no model prompts and
do not print histories or credentials.

For an owner-operated private certificate authority, `--ca-file /path/to/ca.pem`
adds that CA for verification while retaining certificate and hostname checks.
The owner's browser must trust the same authority. Never disable TLS verification
to label an installation ready.

Also verify unauthenticated requests cannot read bots/history or call APIs, an
unapproved Origin is denied, and first opening shows admin setup. Restart the
manager through its real supervisor and verify again. Check durable deployment
configuration for Docker/Kubernetes; a surviving background process is not proof.

```sh
hermes bot-web setup-link
```

This prints the path of a private mode-0600 `setup-link.txt`, not its secret.
Read it privately and give the complete link directly to the owner. The one-use
proof is a URL fragment removed immediately by the app and retained only in
memory; it is absent from request URLs, server logs and referrers. Treat it as a
temporary credential and keep it out of public reports.

The owner opens that link, creates an admin login, confirms their detected primary
agent's handle and animated/photo avatar, and enters its real Bot Chat. There is
no Hermes address or connection approval. Later visits use the plain app URL and
login. Do not claim the account for the owner or run paid-model tests without
their authorization.

## Updates and rollback

For an existing combined-plugin installation, obtain and verify the new combined ZIP as in step 3, back up
and replace only the installed plugin code (preserving all state). While native
work is idle, run `hermes bot-web sync-runtime --source-package --native-idle` before `hermes bot-web update`.
The new release's native process must start after the enrolled copies are
updated; copying files into a running process does not reload its tools.
Keep the existing origin, ports, owner login, agent
bindings and supervisor. Run `hermes bot-web verify --public` through the existing
HTTPS route; no new setup link, login creation or pairing is required. If the
new release is activated, also check `/version.json` through that app URL and
confirm its tag matches the release being installed. Do not report success from
the downloaded ZIP or plugin metadata alone. Ask the owner to reload or reopen
the app once to load the updated screens; preserve browser data and login.
If the
owner has not claimed the initial login, retrieve its still-valid private link
with `hermes bot-web setup-link` (use `--renew-setup` only if it expired).

`setup-link` returns `expires` (Unix epoch milliseconds) and `expires_in` (whole
remaining seconds). Its output contains the private file path, never the secret.

Event parsing and legacy access controls are specified in
[the wire protocol](https://github.com/enterkey-io/pebble-crew/blob/v0.7.8-preview.13/docs/WIRE_PROTOCOL.md).
Never use global revocation for diagnostic cleanup: use DELETE `/v1/connect`
with the probe's own lease. Global revocation now requires `hermes bot-web revoke
--all` or the operator-only HTTP body `{"all":true}`.

Verify the next combined release, back up and replace only installed plugin code,
and enable it natively. Running services keep using their immutable snapshot until
activation; preserve private state and native stores.

```sh
hermes bot-web runtime-status
hermes bot-web sync-runtime --source-package --native-idle
hermes bot-web update
hermes bot-web verify --public
```

The updater stages dependencies and compatibility checks before switching the
release. The manager adopts it without replacing keys or data. Failed readiness
restores the previous release. Explicit rollback is:

```sh
hermes bot-web rollback
hermes bot-web verify --public
```

This preview supports code updates with unchanged owner/workspace data schemas;
unsupported data migrations are refused. Keep previous snapshots and code backups
until verification passes. Do not restore native history/personality stores as
plugin rollback. Run `hermes bot-web sync-runtime --source-package --native-idle` before update activation to
update enrolled agents' runtime-only plugin copies; they receive no web bundle.
If copies were synchronized after activation, restart through the installation's
existing supervisor while native work is idle, then verify the public route
again. Do not leave already imported tool code running and call the update done.

If initial setup expires before account creation, run `hermes bot-web setup-link
--renew-setup` and privately deliver the new link. It refuses to replace a claimed
owner account. Never delete a claimed account or regenerate keys to repair an update.

### Mobile and PWA verification

The combined package includes the PWA manifest, original Pebble Crew icons and
public offline screen. Through the owner's existing HTTPS origin, verify
`/manifest.webmanifest` returns `application/manifest+json` and the 180, 192 and
512px PNG files under `/icons/` return `image/png`. Keep manifest, worker, icon
and offline routes on that same origin. No new host, account or permission is
needed. The service worker caches only public artwork and offline-screen files,
never owner pages, API responses, chats, uploads or credentials.

Existing installations keep their login and ordinary URL after this update.
Browser refresh loads the new app; installing it on a home screen is optional.
Do not claim physical-phone keyboard behavior was verified by fetching assets.

## Verify the 0.7 interface update

Do not recreate the owner login, repeat onboarding, add a placeholder, or enroll
extra profiles to test this update. Preserve the existing primary identity,
handles, appearances, teams, role cards, keys, ports and HTTPS route. Update the
main plugin and its enrolled runtime copies together; verify through the actual
owner URL. Give the owner that same plain URL after activation, with no setup or
pairing code. Ask them to reopen the page once to load the new web assets.

Verify native roster discovery, framing and 15-second heartbeats without sending
model prompts or deleting profiles. Hide/Unhide are reversible owner controls;
Delete is a separate owner-reviewed native lifecycle action. Do not delete an
agent as an installation test. Existing crews with fixed native membership must
be retired in Hermes before their members can be deleted. Partial or uncertain
native deletion is retained for inspection and is never automatically repeated.

The integration stores a small private `.pebble-crew-identity` witness in each
profile and an owned `pebble-crew` metadata namespace. These preserve identity on
rename and distinguish clones/recreated names. Do not copy these into new
profiles as a shortcut, strip them from an in-place update, or replace native
SOUL/history/configuration. Presentation preferences/read cursors are local
optional SQLite tables; no content or credentials go to Pebble Crew servers.

## Optional separate hosting

Independent Node/SQLite and Cloudflare Worker/D1 hosting remain available for an
owner who intentionally chooses that topology. Follow `docs/INDEPENDENT_INSTALL.md`
and its matching release. This is an advanced alternative, not a requirement for
the combined plugin.

## Interface and optional capabilities

The combined update includes the complete redesigned UI and matching integration.
Do not update only the static files when enabling Files/Computer. Direct-chat
files use a private owner-local staging/index store under the integration state;
no message bodies are stored in its send receipts. Group attachments and automatic
generated-output indexing remain unavailable. Preserve this store during updates.
The experimental Computer viewer is disabled by default pending Linux acceptance.
An operator testing it may explicitly set `HERMES_BOT_WEB_EXPERIMENTAL_COMPUTER=1`
in the bridge service environment. Do not enable it as part of ordinary install.
It uses native Bot Screen only on supported 0.21.7 Linux hosts with its
desktop packages configured. Do not install packages or request sudo as a side
effect of opening the app. Full Linux screen startup remains a host-specific
acceptance check; ordinary chat does not require it. Never expose a raw VNC port.

## 0.7 sidebar, search and appearance data

Update the complete plugin and prebuilt runtime together. The 0.7 web app requires
its matching integration; a static-only update is insufficient. Keep the existing
owner account, cookie keys, private state, login sessions, profiles, model settings,
ports and HTTPS route. Do not send model prompts as installation probes.

Organization is a separate owner-local presentation record: section and Crew
order, collapse state and membership. Existing role/team assignments initialize
it once; moving a sidebar item does not rewrite a profile's role or reporting.
Opening a Crew with 2–6 available pebbles creates or reuses its native Hermes room.
A changed membership explicitly asks for a new chat; the previous history remains
in Group chats. Removing a sidebar Crew does not delete native history.

Search runs on this Hermes host, including visible canonical Bot Chat history,
routine metadata and supported sent-file text. It does not open or resume sessions,
advance read cursors, run models or create a transcript index. Limits are shown in
the search UI. PDF/image/binary content is filename-only; unsupported generated
outputs and group attachments remain outside this feature. Preserve the owner-local
file store and presentation database during upgrades and rollback.

Ten shape options and twelve colors are now supported, along with owner photos.
Existing saved appearances are retained. Do not reset appearance or onboarding to
expose the new choices. Give the owner their same plain URL after public verification;
reloading once loads the new assets, with no pairing or new administrator setup.

## Live voice

The supported 0.21.7 build includes native OpenAI live conversation. The older
0.21.0 build does not. Do not configure or test a paid provider during installation
or upgrade. After login, the owner selects Voice in a Pebble's composer. Setup opens the same Voice tab used by Edit Pebble. Missing or rejected
credentials open a private field there; keys must never be pasted as messages.
The first opening asks for a key (or explicit reuse of a saved key), then voice and speed. The saved-key choice is remembered across entry points. Preview stays in that tab and speaks one named sample without microphone access or an interactive call. It sends locally generated silence to keep the Live timeline running, shows a thin waiting indicator until audio plays, and reports an error if no audio arrives. A rejected key immediately reopens private entry; no refresh is needed. Rate limits, credits, spending limits and quota have separate safe messages when identified by the provider. Saved keys are never returned to the browser. Voice and requested speed save in that Pebble's native profile; GPT-Live uses delivery instructions, so the speed is a target rather than an exact playback multiplier. Later openings start a compact call bar at the top of chat. Its settings button opens the Pebble's Voice tab. A stopped call with a transcript requests one text follow-up; previews never do. Calls and previews
start only on the owner's action. No Grok live provider is offered: this Hermes
build's separate xAI transcription/speech output is not a live conversation mode.

## Native chat commands

Typing `/` offers session-scoped Hermes completions for browser-supported commands. `/model <name>` executes Hermes's native command worker; it is never sent as a model prompt. Terminal-only, destructive lifecycle and unsupported command responses stay in Hermes. The removed Model editor tab only copied the primary model authorization; it was not a model picker.
