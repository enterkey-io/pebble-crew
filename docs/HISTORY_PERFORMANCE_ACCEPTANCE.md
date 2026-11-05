# Recent-first history acceptance

The next plugin release raises the bounded native stdio and RPC JSON response
ceiling from 4 MiB to 32 MiB. That is a transport ceiling, not the normal page
size. Startup resumes the native interactive session without sending its full
transcript, binds the browser before capturing a stream-positioned snapshot, and
returns up to 60 recent native rows. The display page targets 2 MiB; a single
larger supported row is returned whole rather than silently truncated.

Earlier messages are requested with a conversation-bound durable-row cursor.
New messages cannot shift that boundary as an offset would. Native ordering,
compaction visibility and inactive-row rules remain authoritative. Hidden rows
retain identity/coverage without transferring private model scaffolding. Tools
retain durable row identities too. Recovery fetches just enough earlier pages to
bridge a missed gap, then retains already loaded rows and local presentation
identities. Paging preserves the visible reader anchor and unsent draft.
Approvals and other pending input are independent of the transcript window.

A fresh open and a reload with a saved login each transfer one recent history
copy. Reconnect uses the snapshot/event barrier, not another startup history
transfer. The Inspector, routines, Library and computer content wait until the
panel is opened. Loaded offscreen message layout/paint uses browser content
visibility only after measuring real heights; estimated heights were rejected
because they shifted the reader during prepend. Generated media keeps its
existing visibility-based loading and cleanup.

## Supported native versions

The newer pinned Hermes has a paged display API. The older pinned build lacks
lineage paging and ignores the resume omission flag. Its named plugin adapter
therefore compacts the normal resume result before stdio serialization and slices
the native ancestor/deduplication projection before transport. This older path
can still read the complete display lineage inside the owner's Hermes process;
it never sends that complete payload to the phone. No native handler is replaced
and no stored message, persona or model context is rewritten.

Attachment receipt reconciliation and live-voice context/receipt lookup can walk
bounded pages on demand. A recent display window must not make an older accepted
upload appear unsent or make voice read the wrong response.

## Repeatable checks

Run the production build and relevant recovery suites with the maintained
[verification skill](../.agents/skills/verify/SKILL.md).

- `test/plugin/test_transport_frames.py` exercises an actual 8 MiB stdio pipe using
  the configured native reader. Client tests accept an 8 MiB RPC response and
  reject a response advertised above 32 MiB.
- `scripts/fixture/history_smoke.py` creates a disposable native home, seeds 420
  rows whose full display JSON exceeds the former 4 MiB limit, opens 60 recent
  rows, appends a new row during paging and verifies seven pages reproduce all
  original row IDs exactly once. The initial response is about 756 kB for that
  fixture. Both supported native revisions pass without a model turn.
- `history-window.spec.ts` exercises the actual production bundle on desktop,
  iPhone WebKit and Android Chromium: one startup copy, deferred panels, older
  pages, read failure/retry without losing a pending approval, paging during a
  live reply, recovery of a missed gap without moving/remounting the reader, and
  a reload retaining the draft.
- Existing production recovery, approval, transcript-motion, media, attachment
  and native-owner journeys remain release gates. Final archive acceptance runs
  against the exact packaged bytes before publication.

## Physical-phone benchmark gate

**Pending. Browser emulation is not a physical-phone benchmark.** No phone could
be driven from this session; Apple CoreDevice discovery failed to initialize.
Do not claim an improvement in iPhone heat, phone memory, cold/warm timing or INP
from the browser checks or the payload counts above.

Use a disposable owner-local installation with the same synthetic native history
for both builds. Do not upload owner transcripts, credentials or profiles. The
baseline must include the 32 MiB transport repair on both sides so a failed old
4 MiB read is not counted as a fast/slow load. For each actual phone, record its
model, OS/browser/PWA mode, network route and release/package hashes.

Run at least five alternating baseline/candidate pairs with the same dataset,
network, display settings and starting thermal state:

1. Cold load: start a fresh browser process with empty **synthetic test-site**
   caches and a saved synthetic login; time navigation to the recent conversation
   painted and usable composer. Never clear the owner's installed app data.
2. Warm load: reload the synthetic app with its HTTP cache and login retained;
   measure the same endpoints. Also measure background/resume separately, without
   treating a retained page as a full navigation.
3. Record response bytes and counts for open/snapshot/history, rendered rows,
   failures, long tasks, typing delay during a streamed reply, and return to a
   scrolled-up reader. Observe memory and thermal behavior using the actual
   platform tools; do not substitute desktop heap figures.
4. Verify identical row IDs/content and request state, older-history access,
   continued streaming and stable scroll position. Count failed loads/retries.

Keep individual runs locally, then report median and range for each condition
and phone. Profile a separate unreported run to identify the limiter. Publish
no phone speedup claim until the physical runs are available.
