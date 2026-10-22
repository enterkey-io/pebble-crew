# Pebble Crew architecture

October 15, 2026. The owner installs one combined plugin on their existing Hermes
host. It serves the web app, owner login and native Bot Mode API through one
owner-controlled HTTPS origin. Independent hosting remains optional. The former
preview architecture is [historical](ARCHITECTURE_0_2_HISTORY.md).

Browser transport and recovery ownership are detailed in [connection recovery](CONNECTION_RECOVERY.md).

## Requests and authentication

The browser opens one address. Prebuilt browser assets and Better Auth run in
Node with local SQLite. `/v1/` requests pass through a fixed loopback proxy to the
Python integration. It accepts only protocol routes/methods, streams immediately,
bounds bodies and strips cookies and forwarding headers. It cannot proxy arbitrary
URLs or expose arbitrary Hermes APIs.

First-use ownership uses a private one-time link. The browser removes its fragment
before rendering and keeps its proof only in memory. The owner creates the single
administrator; public signup is disabled. Login cookies are HttpOnly, Secure and
SameSite Strict. Short-lived signed browser tickets authorize the native API.
Installation generates persistent signing material and local verification trust
automatically. Combined mode does not use pairing.

The Python API enforces native operation permissions, exact owner approvals and
ticket expiry. The proxy does not turn owner cookies into operator credentials.
The operator credential stays in a private installation file for diagnostics.

## Native execution and identity

Hermes owns profiles, SOUL, memory, model/service credentials, canonical Bot Chats,
rooms, routines, tools and approvals. One persistent native stdio subprocess
serves the integration. Compatibility checks run before startup. No core handler
is patched or replaced.

Onboarding detects the existing primary agent, confirms its public handle and
animated/photo appearance, and reuses or initializes its native Bot Chat. It creates
no placeholder. Other profiles are added in the UI. Role cards, teams and reviewed
management proposals use the existing private workspace store; they do not replace
personality files.

## Installation and service lifecycle

The replaceable plugin includes installation code and a prebuilt `web-runtime/`
with an explicit checksum inventory. Installation stages an immutable snapshot
under `$HERMES_HOME/bot-web/web/releases/`. Runtime-only copies in other agent
profiles exclude that web bundle.

Private state outside snapshots holds owner SQLite, login/signing keys, installed
settings, active/previous release pointers and service receipts. A stable launcher
resolves the active release. Its foreground manager restarts the Node and Python
children with bounded backoff, cleans their process groups and adopts a changed
release. Children detect loss of their manager. An OS/container supervisor must
own that manager.

Systemd-user and launchd definitions can be generated and activated when available.
Containers receive a foreground command/environment contract for their persistent
supervisor. Files generated does not mean supervision completed. macOS LaunchAgents
start at account login; systemd-user boot availability requires lingering.

Updates stage dependencies and check schema compatibility before activation.
Readiness failure restores the previous release. This preview refuses unsupported
data migrations. Keys and native history/personality stores are preserved.

## Network and privacy

Both listeners bind loopback. The installer configures durable HTTPS ingress,
reverse proxy or a private tailnet route to the web listener, preserving Host and
unbuffered streams. A plugin cannot grant itself host/Kubernetes permissions.
Production cannot depend on our machines, domains, tailnet or accounts.

State stays on owner-controlled storage. Conversations and service credentials
remain in Hermes; the web service streams content without storing transcripts.
No vendor relay, login, telemetry service or credential vault is required. The
owner's configured model providers and connections still process their requests.

Optional independent Node/SQLite and Cloudflare Worker/D1 deployments retain the
same browser/native protocol. Future Mac/Windows/iOS clients can use this owner-side
endpoint without selecting a native framework now.

## Acceptance

The [installation contract](INSTALLATION_CONTRACT.md) and broader feature plans
remain binding. Disposable local tests contribute evidence; launch also needs
independent supervision, trusted real routes, host/container restart acceptance,
supported migrations and remaining Bot Mode gates. A preview is not production
certification.
