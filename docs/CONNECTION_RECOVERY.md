# Browser connection ownership

The web app keeps one `OwnerSession` for its signed-in lifetime. A broken event
stream does not mean Hermes or an in-flight message is disconnected. The session
separates browser authority, the bridge lease, native responsiveness and event
freshness. Feature components use its stable `SessionClient` port.

## Responsibilities

| Owner                             | Responsibility                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `connection/session.ts`           | Ticket renewal, lease replacement, subscription retries, health checks, browser wakeups and recovery deadlines |
| `connection/conversation-feed.ts` | One recovery read, target and mutation fences, buffering across a snapshot and conversation rebinding          |
| Existing chat projection          | Native message receipts, streamed offsets, displayed timestamps, optimistic rows and uncertain sends           |
| Feature reducers                  | Editor baselines, unsaved fields, conflicts, navigation and submission generations                             |
| Hermes plugin                     | Independent leases, bounded scoped subscriptions, model-free native health, binding and read-only snapshots    |
| Existing service manager          | Native and web process supervision                                                                             |

`check:ui` rejects importing the wire client outside `OwnerSession` in production
web code. The feature port omits transport lifecycle methods. The former App
renewal/reconnect timers and screen-level client replacement have been removed.
The temporary stream retry implementation is not retained beside this controller.

## Recovery rules

- An event EOF, idle timeout, malformed frame or stream-only server error retries
  that subscription. Requests and the lease remain usable. Retries use capped
  jittered backoff, which resets after sustained heartbeats rather than a handshake.
- Temporary ticket failures keep valid authority until its deadline. Renewal is
  single-flight per wire client. The wire commits a new bearer only after the
  bridge accepts it. Ticket acquisition has a ten-second deadline and receives
  cancellation on session disposal. Opaque paired grants do not use JWT renewal.
- `LEASE_GONE` replaces a lease. A generic validation response does not. On an
  older bridge, a known-valid read-only probe must also reject the lease before
  replacement. Capacity responses preserve other tabs and honor `Retry-After`.
- Replacement retires the old wire. Queued work cannot dispatch on it. An already
  dispatched mutation can finish within its original timeout. Its receipt remains
  meaningful. Late reads from the old lease cannot replace current state.
- Native health failure preserves the page and drafts. A responsive health probe
  clears that gate before reading resources again. An overloaded or unanswered
  native probe can report `unconfirmed`; an event heartbeat alone does not prove
  the native dispatcher is responsive.
- Browser focus, visibility and network events request a check. They are not proof
  of availability. Page unload releases only that tab's lease. Persisted browser
  pages recover on return.
- The owner login shell handles an expired login by returning to sign-in. It does
  not convert cookie authority into operator access.

Sending never automatically retries a mutation. A failure before dispatch restores
its draft and removes only that unsent optimistic row. An ambiguous failure after
dispatch retains the existing conversation-level uncertainty guard.

## Snapshots and events

A bind registers its native session in the lease's subscription filter before
capturing the first snapshot. Ordinary stream recovery uses `chat.snapshot` on
that existing binding. It does not resume a profile, enable a tool, provision
runtime files or send a prompt.

The feed buffers conversation events while a recovery read is pending. Its buffer
is bounded at 4096 events. Target selection, a new mutation, overflow or an
unversioned reaction crossing the read prevents that snapshot from being accepted.
The session retries the read. A superseded recovery pass cannot advertise `live`.
When a native restart changes the session ID, new-session events remain buffered
until the returned binding is installed. A changed binding affects that feed and
uses `CONVERSATION_CHANGED`; it does not invalidate the whole browser lease.

The explicit initial user open still uses the existing App open/projection path.
It records the recovery revision covered by its snapshot, so the controller does
not read or redraw it again without a newer gap. A temporary initial bind failure
retains that intent and retries through the session scheduler.
The new feed owns transport recovery, deferring while that open or a send is
pending. This limits the rewrite to recovery while preserving the tested chat
receipt and viewport behavior. Feature recovery revisions refresh authoritative
baselines without changing client identity or clearing unsaved edits.

## Plugin guarantees

Each tab owns a lease. Another tab cannot reclaim it because its stream recently
closed. Reclamation requires idle or expired authority and no in-flight work.
Authenticated ticket expiry only advances for the same principal; a delayed old
bearer cannot shorten a renewed lease.

A subscription has an identity. Replacement wakes the old generator, and the old
cleanup cannot clear its successor. The plugin admits bound-session events and
redacted global invalidations before its 256-entry queue. Unrelated sessions cannot
fill that queue. Real overflow still requests resynchronization.

`GET /v1/status` coalesces a bounded model-free native dispatcher probe and returns
`responsive`, `unavailable` or `unconfirmed` with its age. These methods are plugin
extensions on both supported Hermes revisions. They require no upstream patch.
The combined plugin's fixed loopback proxy and independent Node/Worker hosting
remain supported. No application-owned central service or owner-data store is
introduced.

## Diagnostics and verification

The session retains at most 64 in-memory diagnostic records containing local time,
stage, allowlisted code, retry count and an ephemeral epoch. It clears them on
session disposal. Records contain no tokens, endpoint URLs, profile/session names
or chat content. This is an internal diagnostic API, not remote telemetry.

The regression gates cover real ASGI cross-tab lease use, old-ticket ordering,
queue admission, stream replacement, health and capacity. Browser journeys cover
stream-only failure, ticket failure, pending sends, missed replies, conversation
switching, editor conflict recovery and board authentication recovery. Unit tests
exercise snapshot barriers, late reads and dispatch certainty. A real Node proxy
test checks immediate NDJSON bytes and continued requests after stream closure.

`connection_smoke.py` checks native health, read-only snapshots and native restart
rebinding on both pinned Hermes builds with zero model turns. Native owner browser
and packaged installation acceptance exercise the production app and final
archive in disposable homes. The deterministic local acceptance model is used
only for scenarios that need an actual chat turn.

These gates prove the exercised paths. They do not identify the original owner's
network trigger or establish performance on every ingress or physical device.
