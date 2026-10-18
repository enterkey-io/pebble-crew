# Pebble Crew

A self-hosted interface to **actual Hermes Bot Mode**, distributed as one
installable plugin. It includes the web app, local administrator login and native
integration, served through one owner-controlled address. All state stays on the
owner's infrastructure; no vendor account, content store or relay is required.

The combined-plugin candidate is **0.7.8-preview.1** (integration 0.7.8). This is a
development preview, not production certification. A version in source does not
mean its release is published or an owner's host was upgraded. See
[implementation status](docs/IMPLEMENTATION_STATUS.md).

## Installation and first use

Give your Hermes agent the [installation guide](docs/AGENT_INSTALL.md). They install
the combined package on your existing Hermes host, configure persistent startup
and an HTTPS route, verify it, and give you one private setup link. There is no
address entry, pairing code or second-agent handoff. Olares is simply one possible
Hermes host. Independent web hosting remains an optional advanced deployment.

First opening creates the owner administrator login. Onboarding detects the
primary existing Hermes profile, offers an editable public @ handle and an
animated shape/color or photo avatar, and opens its native Bot Chat. The optional
welcome is a real request to that existing personality. It does not manufacture a
placeholder, clone SOUL or merge other channels' histories.

Refreshes, idle time, service restarts and new devices use owner login and automatic
reconnection. Browser tickets are short-lived; signing out prevents new tickets,
and existing tickets expire within five minutes. Owner authentication/configuration
is stored on the owner's host; transcripts, agent memory and service credentials
stay on Hermes. A public-to-private topology still requires browser reachability,
valid TLS and any local-network permission.

## Workspace features

Existing-agent discovery/enrollment, native canonical chats, streaming, approvals,
Stop, existing crews and bot-owned routine controls. A sectioned rail with pins, native previews and read state, crew participants, per-conversation drafts and scroll positions, and integrated details panels and responsive navigation. Native Hide/Unhide and owner-reviewed Delete update the roster automatically, including changes made outside the app. Crews and editable roles/reporting,
one starred Main Pebble, public-handle routing and saved appearances. A real
`workspace_agents` plugin tool and bundled skill submit exact management proposals
for owner review; models cannot self-approve or grant privileges.

New agent creation uses a fresh native profile/persona and an explicit selected
primary API-key/custom-provider grant, with minimal reviewed toolsets. Unsupported
model authorization stays unavailable/partial rather than copying all credentials.
Connections reuse native inventory/catalog, supported setup/authentication, native
OAuth/PKCE and individual tool selection. Configuration and successful discovery
are distinct from activation in an already-running agent.

The shared avatar renderer uses original vector shapes and one visibility-aware
scheduler. Ten original shapes, twelve colors (including Snow) and user photos are supported. Photos are normalized locally and
independently validated/re-encoded before native Hermes asset storage. The isolated
`/avatar-lab.html` remains available for motion/performance experiments without any
Hermes or model requests. See the [avatar plan](docs/AVATAR_SYSTEM_PLAN.md).

Direct pebble chats support private file pick/paste/drop and authenticated downloads in Files. On supported Linux Hermes hosts, the experimental native Computer viewer (disabled by default pending host acceptance) uses one-use tickets and native watch/control leases. It shares the host security boundary; it is not an isolated computer per pebble.

Owner-local search covers visible native Bot Chat history, routines and supported
sent-file text with explicit limits. Custom sections/Crews persist independently
of profile roles; a Crew opens or reuses a real native room.

## Interface work and owner reports

The [interface implementation plan](docs/PEBBLE_CREW_UI_PLAN.md) records the
Astra review and the completed conversation/UI implementation. The [bug and improvement list](docs/BUGS_AND_IMPROVEMENTS.md) tracks owner reports, acceptance criteria and release status.

## Development

Use Node 26 and npm 11.12.1:

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

`npm run build` builds the web/client and Node owner service. `npm run build:owner`
can build the owner service alone. `npm run typecheck:worker` checks the separately
generated Workers environment types. `npm run serve` is the **legacy static
technical preview**, which retains temporary pairing and does not provide owner
login. Use the combined-plugin installation guide for an installed application.

`npm run package` creates a combined plugin plus optional independent owner-app,
static-preview, API-only integration and source archives plus manifest/checksums in ignored `artifacts/packages`. Runtime secrets,
private state, temporary fixtures and development artifacts are excluded. The plugin installer installs
Node runtime dependencies from its pinned lock. Full source
includes the Cloudflare adapter and migrations.

Tests include TypeScript/auth unit checks, Python boundary/workspace tests, a local
Workerd/D1 auth acceptance test, avatar browser tests and an installed-owner browser
flow against real pinned Hermes gateways with synthetic local models. The owner
browser test covers idle keepalive, ticket renewal, network interruption, gateway
restart, draft preservation, metadata editing and ordinary login. Native fixtures
cover same-persona enrollment, actual management-tool calls, distinct new-agent
creation, public-handle DMs, MCP discovery and native OAuth/PKCE. These use disposable
homes and no personal provider credentials; they are not claims about a user's
actual model or every cloud/VPN topology.

The compatibility gate remains closed for full production launch until installed
real topology, one-agent installation, supervision, update/rollback and the
remaining plan exit gates are evidenced. Supported source surfaces are pinned;
package version labels alone cannot authorize an untested adapter. No core Hermes
handler is patched or replaced.

Source: [enterkey-io/pebble-crew](https://github.com/enterkey-io/pebble-crew).
Native Mac/Windows/iOS clients are later applications using the same owner-side
contracts; their frameworks have not been selected. Project website: [pebblecrew.com](https://pebblecrew.com).

Live voice uses Hermes’s native OpenAI GPT-Live mode on the supported 0.21.7
build. The owner can enter a key privately in chat, choose a voice and pace,
preview without a microphone, then start a continuous call. Keys remain in native
Hermes storage; audio and bounded chat context go to OpenAI. Native agent tools,
reasoning models, approvals and canonical Bot Chat remain authoritative. See
[voice setup and verification limits](docs/VOICE_IMPLEMENTATION_PLAN.md).
