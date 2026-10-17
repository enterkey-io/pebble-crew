# Independent Pebble Crew installation

This is for the owner's installation agent. **The web app and Hermes are independent installations and may live on different hosts/networks.** Olares, if present, is only a host running Hermes. Never package or deploy an Olares application for this project.

Pebble Crew’s project domain is `pebblecrew.com`. `workspace-owner-preview.zip` is the web application with its owner-login service; `workspace-plugin-preview.zip` is its Hermes integration. The plain static web package is a technical preview, not the finished installed-owner deployment.

## Outcome to deliver

One installation agent handles deployment, persistent trust, routing and verification, then privately gives the owner the web URL and one-use setup code. First opening creates the administrator login and guides the owner through their detected primary existing agent's handle and animated/photo avatar. Normal visits, new devices, idle periods and service restarts use that login and automatic reconnection. No browser pairing code, pasted Hermes administrator token or second-agent diagnostic relay is part of this flow.

Keep conversations, SOUL, memory, service credentials and agent configuration on Hermes. The owner's app host stores only its own authentication, configuration and signing material. No vendor account, relay or content storage is required. The app server need not reach Hermes: the **owner's browser** must reach the app and the independent HTTPS bridge.

## 1. Inventory and choose the two deployment locations

Preserve an existing app host unless the owner wants to move it. Ask only for missing access or hosting preference; do not assume the app belongs beside Hermes. With no preference, offer the owner's own [Cloudflare Workers account](https://developers.cloudflare.com/workers/static-assets/) or a [DigitalOcean Droplet](https://docs.digitalocean.com/products/droplets/getting-started/quickstart/) / other Node host. These are ordinary reference links; no affiliate IDs are embedded.

For the web application choose one:

- Node 26 on a host with persistent private storage, outbound access for software updates, and an HTTPS reverse proxy. It uses one local SQLite file; no separate database service is needed. The application binds loopback. Reserve persistent state outside versioned release directories, with owner-only permissions.
- The owner's Cloudflare account with Workers static assets, D1 for owner authentication, and Worker secrets for signing/auth settings. The repository includes the adapter and versioned migration. Plain static Pages/assets alone do not provide owner authentication.

For Hermes, verify the actual interpreter, native source/build, persistent HERMES_HOME and intended profile. `hermes bot-web doctor` supports tested native revisions 29112bef… (0.21.0) and af0cd4df… (0.21.7); package metadata 0.0.0 is not itself a rejection. A different untested adapter surface requires maintainer revalidation. Do not downgrade, patch fingerprints or edit Hermes core.

Inspect existing services/ports before changing anything. An occupied bridge port may belong to an MCP socket. Choose a different free loopback port; never stop another service. Reuse an already configured bridge port, HTTPS URL, origin and tunnel on an update. The app port and Hermes bridge port are separate.

Before mutations, record versions, existing deployment/supervision, routes, file ownership and backup locations privately. Never include credentials, owner content or private endpoints in Git commits, issue reports, screenshots or public install records.

## 2. Obtain one immutable release

The candidate installed-owner release is `v0.3.0-preview.1`. Use its published artifacts only after that release exists; if absent, report that the candidate has not been published rather than substitute executable code from main.

- [Manifest](https://github.com/enterkey-io/pebble-crew/releases/download/v0.3.0-preview.1/workspace-manifest.json)
- [SHA256SUMS](https://github.com/enterkey-io/pebble-crew/releases/download/v0.3.0-preview.1/SHA256SUMS)
- [Owner web application](https://github.com/enterkey-io/pebble-crew/releases/download/v0.3.0-preview.1/workspace-owner-preview.zip)
- [Hermes integration](https://github.com/enterkey-io/pebble-crew/releases/download/v0.3.0-preview.1/workspace-plugin-preview.zip)
- [Full source](https://github.com/enterkey-io/pebble-crew/releases/download/v0.3.0-preview.1/workspace-source-preview.zip)

Verify each downloaded archive against both manifest and checksum file. Before extracting, reject absolute paths, traversal, symlinks and entries escaping the destination. Use private staging directories. Keep app authentication state and Hermes stores outside staging/code directories.

Routine installations do **not** need a fork. Use immutable upstream releases or a checkout at the published tag. A fork is for intentional code customization and carries responsibility for merging/security updates.

## 3. Install the web application on the chosen app host

For Node, extract the owner package into a versioned release directory, run `npm ci --omit=dev --ignore-scripts` there, and initialize once. Replace the example values with the owner's actual canonical origins and persistent state path:

```sh
node apps/owner-node/dist/main.mjs init --origin https://workspace.example.com --bridge https://hermes-bridge.example.com --state /var/lib/workspace-owner
node apps/owner-node/dist/main.mjs serve --state /var/lib/workspace-owner --port 8081
```

Initialization writes private settings, SQLite state, `trust.json` (public verification material) and `setup-code.txt` (one-use owner proof). It prints file locations, not secrets. Do not rerun init over an existing installation or rotate its keys during an update. Put HTTPS in front of loopback 8081, preserving the configured Host. The runtime serves both web assets and `/api/*`; do not route the APIs to an old static server.

Use a real supervisor and verify automatic restart. `deploy/owner.service.example` illustrates a Node service; adapt user, Node executable, working directory and state path. macOS launchd, Docker/s6 or Kubernetes supervision are also valid when their persistent-volume and startup behavior are verified. Do not leave an unsupervised terminal/background process as the finished installation.

For Cloudflare, use the full source release, run `npm ci --ignore-scripts`, `npm run build`, and `npm run build:owner`. Generate private owner settings using the same init command with the intended Cloudflare/custom-domain origin and bridge origin. Run `node scripts/provision-worker.mjs PRIVATE_STATE_DIRECTORY` to prepare private bootstrap SQL. Create D1 in the owner's account and a private Wrangler configuration based on `apps/owner-worker/wrangler.jsonc`, replacing its placeholder database ID and resolving main/assets/migration paths to the checkout. Apply its D1 migrations, then the bootstrap SQL, to that database. Put the contents of private `settings.json` into the Worker's `OWNER_SETTINGS` secret; never into public vars or the repository. Deploy the Worker with its assets. The owner setup code stays outside D1 and is delivered privately.

Check current Wrangler command syntax through its help/docs. Keep `nodejs_compat`, the configured compatibility date and the `/api/*` plus `/.well-known/hermes-workspace.json` Worker-first routes. Generate types after configuration changes. The example disables request observability/metrics; do not enable content/query/credential logging. The adapter has been exercised in local Workerd/D1; certify the owner's actual cloud route before handoff.

## 4. Install and enroll the Hermes integration

Use the **same Python interpreter/environment Hermes runs**. Install `bot-web/requirements.txt` there after checking its dependency resolution against that Hermes runtime. Replace only the integration code, with a private rollback backup; connection.json, trust, workspace.sqlite, native profiles, SOUL, skills, history, assets and credentials are separate persistent data and must be preserved.

Place `bot-web` in the intended root installation's plugins directory and enable it using the native Hermes plugin command. On an initial configuration, use:

```sh
hermes plugins enable bot-web
hermes bot-web doctor
hermes bot-web setup --bridge-url https://hermes-bridge.example.com --app-origin https://workspace.example.com --port FREE_LOOPBACK_PORT
```

`FREE_LOOPBACK_PORT` is an installer-chosen verified free port, not something the human must figure out. Skip setup on an existing configured bridge. Read and preserve its private configuration instead.

Obtain the app's public verification document from its validated HTTPS origin at `/.well-known/hermes-workspace.json`, or privately transfer the app host's generated `trust.json`. Verify that issuer/origin is exactly the owner's intended app and that audience/key matches that installation. Enroll it **operator-side on Hermes**:

```sh
hermes bot-web enroll --trust-file /private/staging/trust.json
```

Only the public verification key is transferred to Hermes. Never copy the app signing private key or auth secret to the browser or Hermes, and never put the Hermes admin credential into the app server or browser. Pairing endpoints are disabled after owner trust is active. Logout/revocation stops new tickets immediately; existing tickets have a maximum five-minute lifetime, with server-side stream expiry.

Confirm the primary existing profile from persisted binding or trustworthy installation/channel configuration. For a conventional root installation, the native unique default/root profile is the baseline. A sticky CLI active profile, alphabetical roster order or a service launched under an arbitrary named profile is not proof. If the actual primary is a verified named profile, bind it explicitly before starting onboarding:

```sh
hermes bot-web primary EXISTING_PROFILE_NAME
```

Do not create a placeholder or ask the owner to select their primary from an empty workspace. Do not clone existing agents or rewrite SOUL. The owner confirms the primary handle/avatar in onboarding; other existing profiles are added later through the app. Canonical Bot Chats are reused or initialized without a model prompt. A deliberately retired Bot Chat needs explicit owner confirmation; do not resurrect it silently.

## 5. Make the bridge reachable and supervise it

Run `hermes bot-web serve` under the verified root HERMES_HOME and the intended supervisor. It binds only loopback. Put the owner's HTTPS reverse proxy, Cloudflare Tunnel or private VPN route in front of it, forwarding the configured Host. Preserve streaming: flush response headers and NDJSON immediately, disable buffering, and allow long-lived responses. Keep admin/health probes private and do not log Authorization, callbacks, query values or request bodies.

For a pod with no tailnet interface, a supervised owner-controlled SSH tunnel plus an HTTPS tailnet entry on another owner machine is valid. Treat it as an explicit connection route, not app/bridge colocation. Verify restart of both tunnel and bridge. Never replace unrelated HTTPS/Tailscale routes, stop another service or assume a conversation-scoped background job survives a pod reboot.

For a preview-to-owner update, preserve existing configuration/ports/routes, enroll trust, and run `hermes bot-web sync-runtime --source-package --native-idle` to update this integration's enrolled profile copies with private backups. Wait until active native work is idle before maintenance/restarting the bridge. Do not interrupt active jobs just to finish an update. Never use global `revoke` for probe cleanup; it invalidates other browser grants. Probes release only their own connection lease.

## 6. Verify the complete route before handoff

Run `hermes bot-web doctor`, then `hermes bot-web probe` through the configured actual HTTPS front door. Probe verifies immediate stream readiness, a heartbeat, matching app verification key, and its own lease cleanup, without model calls or profile changes. Separately verify:

- The app URL responds over normal valid HTTPS, the owner API reports setup/sign-in state, and the public verification document contains no private key.
- Exact app Origin passes preflight; an unapproved Origin and unauthenticated bridge API request are denied. A bare bridge URL is an API endpoint, not the web app, and being denied there is expected.
- Root HERMES_HOME/profile is correct; the existing profile roster is visible. No bots, personalities, model calls or service credentials are fabricated for verification.
- App login state/signing keys and plugin trust persist through supervised restarts. Browser reachability is verified from the owner's device/network; app-server-to-Hermes reachability is not a requirement.
- Bridge, tunnel/proxy and app each have verified startup/supervision. Persist the install/update/rollback record privately, including paths, versions and service definitions.

Return only the owner web URL, private one-use setup code and a short readiness summary to the owner. They create their administrator login, confirm their primary agent's handle/avatar and start its chat. The optional welcome is a real request to that agent/model and is submitted at most once. The owner should not relay browser codes or troubleshoot ports, CORS or streams.

## Updates, rollback and recovery

Update from a new immutable upstream release, not a fork/pull of private state. Back up owner auth/settings and plugin workspace/trust separately with private permissions. Stage and verify new code/dependencies in a new release directory, run its checks, wait for idle native work, switch the active code and restart only the required supervised services. Preserve signing keys, cookies/session database, issuer/audience, bridge config, workspace identities and all native data. Verify the actual route again. Reverting code does not mean reverting unrelated owner conversations or credentials.

For Node login recovery, the host operator runs the owner's bundled command `recover --state PRIVATE_STATE_DIRECTORY`. It revokes local sessions and creates a fresh one-use setup proof; it is not a public reset endpoint. Old already-issued bridge tickets expire within five minutes. Keep the same installation/signing binding during login recovery. Cloudflare recovery likewise requires the owner's account access and a reviewed D1 transaction plus newly delivered proof; never offer an unauthenticated public reset link.

Creation/connection operations distinguish pending, configured, partial and runtime readiness. On an uncertain native mutation, inspect its saved request/receipt and native state; never repeat profile creation under a different name as a repair. New agent creation currently supports an explicit single primary API-key/custom-provider grant; OAuth/credential-pool model sharing and uninstalled local service packages require their own verified native setup. Do not broaden credential copying to make a preview look ready.
