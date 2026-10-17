# Voice chat feasibility

Voice chat can reuse Hermes speech services while keeping provider credentials on
the owner's server. This is a source review and implementation proposal; Pebble
Crew does not yet expose microphone capture or voice calls.

## What Hermes provides

Both supported snapshots (`29112bef` and `af0cd4df`) support a chained conversation:
speech recognition → the ordinary Hermes agent and tools → synthesized speech.
The newer snapshot explicitly selects this as its default voice-chat mode. See
the pinned [voice defaults](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/hermes_cli/config_defaults.py#L1214).

Hermes desktop has recording, transcription, speech playback and a continuing
conversation loop. Its server implements transcription and speech routes, but
these belong to the desktop dashboard. The Bot Mode API advertises
`audio_api: false` and `realtime_voice: false`. Pebble Crew must expose a narrow
plugin operation that calls the native speech functions under the selected
agent's profile. It cannot simply enable an existing Bot Mode audio endpoint.
See the pinned [audio router](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/hermes_cli/web_routers/audio.py)
and [API capabilities](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/gateway/platforms/api_server.py#L75).

Local speech recognition and local voices are possible when the owner's runtime
has their dependencies and model files. Hermes also supports cloud providers.
Its keyless Edge voice is remote; keyless does not mean offline. A missing speech
preference does not guarantee local processing. Show the resolved provider and
processing location before capture; never silently switch to a cloud fallback.
See native [transcription resolution](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tools/transcription_tools.py)
and [speech dispatch](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tools/tts_tool.py).

Do not proxy the desktop's voice-configuration response: its direct-client mode
can return long-lived provider keys. Call speech services on the owner's host
instead. This requires no vendor relay and no change to the owner's desktop
voice preference. See [direct voice configuration](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tools/voice_client_config.py).

## Recommended first implementation

1. Add a passive speech-readiness result: configured providers, local/remote
   classification and missing requirements. Installation and updates must not
   load models or trigger speech requests.
2. Add authenticated, bounded audio upload and job routes. Reuse native
   `transcribe_recording` and `text_to_speech_tool` under the original chat/profile.
   Keep audio out of generic RPC JSON and event lines. Jobs handle local model
   cold starts without widening the shared 45-second RPC timeout.
3. Add an explicit microphone action. Record a short utterance on the user's
   device, transcribe it on their server, and place editable text in the composer.
   Sending uses the existing Bot Chat, agent identity, tools and approvals.
4. Add optional spoken replies using the same owner's configured TTS. Provide
   Play/Stop, handle blocked autoplay, and stop playback on chat changes. Delete
   temporary audio on completion, cancellation and expiry. Do not retain audio
   history by default.
5. After this passes phone acceptance, add continuous listening, silence-based
   submission and interruption. Stopping playback and cancelling a Hermes action
   must remain separate operations.

Use a typed voice state machine with the conversation ID, recording ID and request
generation captured at start. Reject late results after navigation, logout or
cancellation. Temporary files and jobs belong to the authenticated owner/session.
Bound bytes, decoded duration, concurrency and processing deadlines independently.

Microphone access requires trusted HTTPS, an explicit permission action and a
self-only microphone policy. Detect supported recording formats at runtime,
including an MP4/AAC path for older iPhones. Safari 18.4 added WebM/Opus recording,
so assuming one format across Safari versions would be wrong. See
[W3C Media Capture](https://www.w3.org/TR/mediacapture-streams/),
[WebKit format detection](https://webkit.org/blog/11353/mediarecorder-api/), and
[Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/).

## Later options and acceptance

The newer snapshot also contains a full-duplex GPT-Live engine with delegation
to the selected Hermes agent. It uses a separate cloud audio service and is not
available in the legacy snapshot. Evaluate it later as an explicit cloud option;
it is unnecessary for the first voice feature.

Before release, test both native snapshots with disposable profiles and synthetic
recordings against local STT/TTS. Then test actual microphone permission, denied
permission, editing, cancellation, delayed results, reconnect, cleanup and playback
on desktop, Android, iPhone Safari and installed iOS PWA. Background/lock-screen
continuity, Bluetooth routing, latency and local speech availability on the
owner's host remain unverified. No audio runtime acceptance was performed for
this research.
