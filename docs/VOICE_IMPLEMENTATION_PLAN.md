# Integrate the existing Hermes GPT-Live call

Planning baseline: 2026-10-17; Pebble Crew `4b511af6ae6c681a214eb67731266dc36947da46`; Hermes `af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a` (0.21.7). Implementation follows this baseline; the candidate scope and remaining acceptance limits are recorded below. [Assessment and pinned sources](VOICE_FEASIBILITY.md).

First use includes [in-chat setup, private credential capture and voice selection](VOICE_SETUP.md).
Reuse Hermes's native secret-request mechanism. A missing key must open guided
setup, not end at an error. The same document records Grok live voice as an
optional additional adapter; it is not included in Hermes's inspected live code.

## 1. Reuse boundary and compatibility

Port the existing live implementation, preserving its transport/protocol behavior. Do not port the chained STT/TTS hook, add speech workers, build VAD/worklets, introduce PCM/WSS media transport, or modify Hermes core. Browser audio connects directly to the configured OpenAI live provider; the owner plugin performs only authenticated setup and native delegation.

| Existing Hermes source                        | Reuse                                                                                                                       | Minimal adaptation                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `tools/voice_live.py`                         | Status, credential/voice/model resolution, session builder and SDP exchange                                                 | Authorized selected-profile scope and ephemeral Pebble identity in session configuration                                          |
| `hermes_cli/web_routers/audio.py` live routes | Setup validation and config-only executor pattern                                                                           | Pebble principal/session authorization instead of exposing dashboard routes                                                       |
| `apps/desktop/src/lib/voice-live.ts`          | `VoiceLiveSession`, WebRTC/data channel, transcript window, `toLiveHistory`, commentary chunking, think/speak/instruct/mute | Replace `hermesApi`/desktop owner scope with injected Pebble setup callback; harden immediate teardown/playback failure reporting |
| `hooks/use-voice-live-conversation.ts`        | `delegationPrompt`, stop-word handling, start epochs, reply cursor, progress feeding                                        | Replace stores/i18n/composer scope; bind canonical session and correct busy/result ownership                                      |
| Existing live hook/transport tests            | Owner routing, transcript conversion, history bounds, chunking, errors                                                      | Translate fixtures into this repository’s test runner and add Pebble-specific boundaries                                          |

Use the actual **live** hook, not `use-voice-conversation.ts`, whose chained behavior is different. Copy only small required helpers such as speech-text normalization and stop-word recognition; do not import the desktop application/store graph.

Inspect notices for every copied file/dependency. The inspected root LICENSE is MIT, copyright 2025 Nous Research. Preserve that text and record source revision/path and local adaptations in `apps/web/src/voice/UPSTREAM.md` with the accompanying notice. This is provenance handling, not a broader legal conclusion.

Extend [compatibility.py](../plugins/bot-web/compatibility.py) with a separately checked live capability covering these native functions. Initially enable only the verified af0 adapter. On 0.21.0 or an unknown implementation, normal Pebble chat remains supported but Call reports unsupported. Do not build a backward replacement or infer compatibility from a version string alone.

## 2. Narrow owner-side setup

Add `plugins/bot-web/live_voice.py` and fixed `voice.status` / `voice.session` operations to [protocol-catalog.json](../plugins/bot-web/protocol-catalog.json), [operations.py](../plugins/bot-web/operations.py) and [server.py](../plugins/bot-web/server.py). The request names an already opened `session_id`; resolve profile and incarnation from the server’s existing mappings. Verify principal, connection session grant and canonical incarnation before setup, after the provider response, and before delegation. Session setup never accepts provider URLs, API keys or arbitrary profile paths. The separate private credential operation accepts only the selected profile’s voice-key value and uses the native credential lifecycle.

Call native `resolve_gpt_live_status()` for non-secret configured status. Distinguish supported, configured and provider-start-failed: `available` only establishes that a key resolves. Require the owner’s explicit live-mode/provider choice; do not change configuration because a key happens to exist. Setup/start can incur provider use and happens only from Call, never installation, doctor or update.

Reuse `build_session_config`, native key resolution and the existing SDP exchange. The current `create_webrtc_session(sdp, history)` has no configuration-transform parameter. Therefore retain a small plugin-local adaptation of that exchange to accept the already-built, bounded configuration; do not monkeypatch native globals or duplicate provider discovery. Preserve SDP bytes including trailing CRLF, native timeout and client delegation. Validate bounded SDP/history inputs and return only the provider session identifier and SDP answer. Sanitize provider errors; do not log keys, SDP or conversation text.

For personality, replace only the generic identity/style paragraph in the built configuration with the selected Pebble’s name and concise existing role/style context. Preserve upstream delegation/interruption rules and owner-configured extra instructions. `live_instructions()` appends extras, so simply calling it with a name is insufficient. Keep this request-local; no SOUL/config writes, wholesale memory dump or profile-global mutation. Relevant history uses existing `toLiveHistory` limits; private memory questions delegate to native Hermes.

Follow native `_run_config_scoped` using both profile-home and secret context in an executor. Provider setup must not hold the global skills/profile lock or block native stdio dispatch. Keep current stdio limits unchanged. The fixed native extension seam is available if session validation needs an in-process helper; it must register a named operation, never replace native handlers. No media travels through it.

Existing combined hosting proxies these bounded HTTP operations. Independent Node/Worker hosting uses its existing owner-auth ticket/direct bridge arrangement. No new WebSocket proxy or media service is necessary. Permit one active setup/call binding per canonical chat; duplicate start IDs reuse the pending/result state, and uncertain provider creation is not automatically retried. Expire bindings on logout/disconnect/retirement.

## 3. Adapt the browser call

Create `apps/web/src/voice/live-session.ts` and `VoiceChat.tsx` from the pinned transport/protocol and selected hook helpers. Use the existing authenticated client with voice response decoding in `apps/web/src/voice/decode.ts`.

The proposed adaptation surface is deliberately small:

```ts
type LiveSetup = (input: {
  sdp: string;
  history: LiveHistoryMessage[];
}) => Promise<{ sessionId: string; answerSdp: string }>;
type SubmitDelegation = (input: {
  delegationId: string;
  text: string;
  voiceContext: string;
}) => Promise<DelegationReceipt>; // accepted, queued, refused or uncertain
```

The closures capture the opened canonical Bot Chat; UI selection cannot retarget them. Retain upstream microphone constraints, peer/data-channel creation, context limits, commentary splitting and mute messages. `track.enabled=false` prevents captured audio content from leaving while muted; keep provider mute signaling too. On End, disable/stop tracks and silence output immediately while retaining the existing bounded graceful session-close cleanup. Upstream waits up to 15 seconds for close, so copying it verbatim is insufficient for immediate local privacy. Surface `audio.play()` rejection instead of silently claiming playback; offer a user-gesture retry.

## 4. Connect delegations to the actual Pebble

Expose a fixed `voice.submit` operation that validates the call/session binding and forwards the upstream payload to normal native `prompt.submit`:

```python
{"session_id": sid, "text": text,
 "surface": "voice-live", "voice_context": bounded_context,
 "queued": True}
```

Reuse `surface` and `voice_context`: inspected native code applies the live conversation note without changing the system persona. Omit `voice_turn`; `prompt_turn.py` uses that separate boolean for `auxiliary.voice_chat`. Omit global speech-interrupted flags. The real selected reasoning model, tools, memory and approval behavior remain native.

Adapt the hook’s busy branch explicitly. It currently calls `onInterrupt`, replaces the active delegation and consumes the latest pending response. Do not connect this callback to `chat.stop`. Let the provider handle spoken barge-in; native work can continue. Retain new corrections in a small bounded pending-delegation list, tell the live session through its existing `think`/`instruct` methods that work continues, and dispatch when the prior native turn settles. Use native `queued=True` to handle a busy race without broad cancellation. Do not invent a new execution engine.

Maintain explicit `delegationId → submission/native receipt → response` association. Deduplicate repeated delegation IDs. Only feed a response belonging to that submission into `speak`; pre-existing typed work and another device’s output must never be mistaken for it. A queued native result may lack a row receipt: keep association pending until native receipt/events establish it; if attribution is unresolved, report that state and suppress ambiguous output rather than guessing by text or the latest reply. Preserve corrections; do not silently overwrite them on a second delegation. Test this race specifically.

Use current native `message.start/delta/complete`, tool events and approvals to implement the hook’s pending-response/progress callbacks. Feed verified tool status into `think`, display pending approvals in the existing [RequestReview](../apps/web/src/chat/RequestReview.tsx), and retain once/deny actions. Spoken yes is not approval. End ends media, not accepted work; explicit Stop task keeps its existing meaning.

Canonical history contains delegated user requests and native answers. Reuse bounded spoken `voice_context` for social exchanges/clarifications and interrupted speech, as upstream does. Do not fabricate assistant rows for paraphrased audio or claim every spoken word is native history. Keep live captions distinct. Existing [SendProjection](../apps/web/src/chat/send-projection.ts) supports one optimistic text row: voice must not overwrite it; use canonical native history for delegated message display.

## 5. UI, failures and reconnect

Wire [App.tsx](../apps/web/src/App.tsx) to a minimal `CallControls.tsx`: selected Pebble, status, Mute, End and optional captions. Start follows a user gesture. Show OpenAI audio/context processing before first use; credentials stay owner-side. End the call when its selected chat changes, logout occurs or the profile is retired. Keep text drafts intact.

Update [production headers](../apps/web/public/_headers) and actual owner-host headers to allow same-origin microphone and the chosen provider’s required connections/media. Retain other restrictions; verify real responses rather than assuming `_headers` controls every host.

Retain upstream start epochs and cleanup. On bridge loss, suspend delegation and mute/close the provider session; on provider/peer loss, close locally and show Resume. Reconcile canonical history first; resume starts a new provider session only on user action and never blindly replays an uncertain native submission. Rate-limit setup and bound pending IDs. Report permission, autoplay, provider quota and unsupported-version failures clearly. Background/lock behavior follows browser lifecycle; do not promise telephone-style background calls.

## 6. Verify the adaptation and release

Run translated upstream tests plus native synthetic tests for two differently configured Pebbles, selected-model preservation with a distinct auxiliary voice model, scoped credentials, persona configuration, canonical history, pending approvals, queued corrections, duplicate events and unrelated typed turns. Verify exact SDP preservation, start/end races, autoplay rejection, mute, provider failure and zero microphone tracks after End. Fixtures establish integration behavior, not a successful provider call.

When explicitly authorized and configured, make practical calls through the installed app on desktop and physical iPhone/Android, including interruption during a tool, correction, mute/end, permission denial, network loss and foreground/PWA lifecycle. This verifies reuse in Pebble; it is not a new acoustic-algorithm benchmark or provider-selection study.

Run `npm run check`, production desktop/phone browser flows, inspect settled screenshots, and run `npm run test:owner-browser` with the compatible isolated native checkout and deterministic local test model. Use the [verification recipe](../.agents/skills/verify/SKILL.md) and exact installed-archive checks. Install/update must never create a provider call, run/download speech models or change owner personas. Rollback removes live UI/routes and closes sessions while preserving native conversations. Record the upstream revision and adaptations so later updates can be reviewed as a small diff.

## Candidate implementation and deliberate limits

The implementation uses `live_voice.py`, `VoiceChat.tsx`, `SecretCard.tsx`,
`live-session.ts` and `delegations.ts`. Fixed `voice.*` and `secrets.*` operations
require an opened session on the authenticated connection. Native secret requests
are one-use, session-bound and expire; browser responses are submitted to the
existing native callback. That callback owns the save result. Direct voice setup
verifies the native file save separately and never claims provider validation.

The first release speaks final native results after matching both saved row
receipts. It suppresses ambiguous queued results rather than speaking a guessed
latest answer. General tool events cannot establish a run's ownership, so they
remain in chat; only confirmed submission progress is passed to the voice layer.
Speech interruption does not invoke whole-session cancellation. New delegations
wait in a bounded, deduplicated queue. Native approvals remain on screen.

The settings panel uses native voice presets and instruction-based Slower,
Natural and Faster choices. It does not invent a numeric speed API. Previews
use a short, output-only live session and never request microphone permission or
submit a Hermes prompt. No custom Grok adapter is included because the owner
conditioned it on native live support, absent in this inspected Hermes build.

Local browser/native checks establish integration behavior. They do not establish
paid-account eligibility, acoustic quality, telephone-style background operation
or physical iPhone/Android performance. Those require the owner's configured
provider and explicit real-device acceptance.

The standalone [local-peer probe](../scripts/fixture/webrtc_probe.mjs) connected
Chromium but automated WebKit produced zero candidates without app code. The
full local WebRTC case therefore records an explicit WebKit skip, while the
iPhone setup/card/color and permission-failure journeys remain exercised. This
is not proof that real Safari calls pass or fail; real-device media acceptance
remains outstanding. The [Playwright media-testing issue](https://github.com/microsoft/playwright/issues/2973)
is background context, not a substitute for this local observation.
