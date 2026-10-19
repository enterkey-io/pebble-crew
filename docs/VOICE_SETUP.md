# Voice setup in chat

## 0.7.8-preview.15 implementation

The owner approves a saved voice key once for this Hermes installation. The
integration keeps a reference to its native credential source and a private
approval fingerprint, never a second copy of the key. Reopening settings, changing
pebbles and restarting the bridge retain that choice. Each pebble's voice stays
in its own native configuration. A changed key or endpoint requires approval
again; a missing source returns to private setup.

Replacing the shared key writes only Hermes's dedicated `VOICE_TOOLS_OPENAI_KEY`
slot in the default profile through its native secure-save lifecycle. Other
profiles' credentials and reasoning-provider keys remain intact. The value never
appears in chat, model context, browser storage or the app's metadata store.

## Earlier research

Research and proposed product flow, 17 October 2026. This extends the
[live integration plan](VOICE_IMPLEMENTATION_PLAN.md). No credential, provider
call, microphone or owner configuration was used during this research.

## First use

Tapping Call must offer setup when voice is unavailable, rather than sending the
owner to a terminal or a second agent.

1. Show the supported voice provider choices. Reuse an already configured
   credential when it resolves for the selected Pebble. Explain provider audio
   processing and separate usage charges before connecting. Unsupported
   providers must not appear as working choices.
2. If a credential is missing, the agent can request a private credential card
   in the conversation. The card names the service, links to its official key
   page, and contains a password field and Save action. It is application UI,
   not a Markdown form or a request to paste a key into chat.
3. Save through Hermes's native credential lifecycle and show the saved or failed
   result. The agent receives status, never the entered value. Do not claim that
   saving proves provider access; verify access through the explicit setup/test
   action. Keep setup open if the key is invalid or the provider account cannot
   use voice.
4. Show voices as compact choices with a Play control. Select a voice and any
   supported delivery preferences, then offer Start call. Keep those choices
   available in the Pebble's voice settings afterward.

Give the agent a setup skill that explains these UI actions and their receipts.
It must request a recognized credential purpose, wait for the owner to submit or
skip, and continue from the receipt. The application should open the setup card
deterministically from Call; successful first use must not depend on the model
guessing how to start onboarding. Neither path may accept keys as model tool
arguments or ordinary chat messages.

## Reuse native credential capture

The inspected Hermes build already has the required distinction between private
entry and model-visible results:

- [`secret_cb` in agent_callbacks.py](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tui_gateway/agent_callbacks.py#L228)
  issues a session-owned `secret` request and calls `save_env_value_secure` with
  the answer. Its result contains storage status rather than the secret.
- [Skill setup](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tools/skills_tool_setup.py)
  can collect required credentials through that callback.
- [The credential lifecycle](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/hermes_cli/credential_lifecycle.py#L164)
  handles saving, replacement and existing credential references.

Our [native adapter](../plugins/bot-web/native.py) currently rejects `secret`
requests. Add a narrowly typed credential-request adapter and matching card.
Bind each request to its authenticated owner, session, profile incarnation,
provider purpose, expiry and one-use native request ID. Validate the purpose
against a server-owned credential catalogue. Do not expose a general native
server-request responder or an arbitrary environment-variable writer.

The input goes directly to the authenticated owner bridge, not through a model
request. Exclude it from transcripts, message events, logs, browser persistence,
diagnostics and request-body tracing. Clear the field after submission. Other
tabs may see completion status, not a replayable value. Expiry, Skip and profile
retirement close the request safely. Verify that the native skill callback is
discoverable and wired on the actual interactive session.

Reuse credentials within their established scope. Resolve the effective native
key slot before saving so an old inline key cannot silently shadow a new value.
Do not overwrite the reasoning provider or copy credentials between profiles
without the owner's choice. Verify the saved result without returning the key.

Hermes's default provider storage uses local credential/config files, not a
universal encrypted vault. Filesystem permissions vary by deployment, including
managed and container installs. It also supports configured external secret
sources such as [1Password and Bitwarden](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/agent/secret_sources/__init__.py).
Use the configured source where supported and report read-only sources honestly;
do not promise that all sources accept writes. Never label an ordinary local
credential file encrypted. This UI prevents disclosure through the conversation;
it does not remove the privileges of tools already authorized on the host.

## Voice choices, preview and delivery

Store a Pebble's selection in its scoped native voice configuration where that
provider is supported. Save only the changed voice fields and preserve the
reasoning model and unrelated settings. Derive the UI from provider capabilities
rather than showing controls that do nothing.

For OpenAI Live, select from supported voices and create a new session when
changing voice. Pace and tone can be expressed through the voice instructions.
The reviewed documentation does not establish a numeric speed or pitch setting
for this Live mode. Do not copy an unrelated TTS or Realtime speed field into it.
See [voice options](https://developers.openai.com/api/docs/guides/live-conversations#voice-options)
and [speaking style](https://developers.openai.com/api/docs/guides/live-prompting#personality).

Each Play action should preview the chosen provider's actual voice with the same
short sample. It must not open the microphone, submit a Hermes turn or include
private chat history. Use supported samples or a bounded output-only provider
request. Explain metered preview use, stop the prior preview before starting
another, and close provider resources after completion. Do not preview a
different TTS voice and imply it is the selected Live voice. There is no assumed
universal preview endpoint or permission to bundle third-party recordings.

## Optional Grok live provider

The inspected Hermes build supports xAI transcription and speech synthesis. Its
built-in full-duplex live implementation is OpenAI-specific. Grok live calls need
an additional provider adapter, not a URL/key substitution in that code.

xAI documents a WebSocket speech-to-speech protocol with function calls. A
proposed adapter could send substantive requests to the selected canonical
Hermes Bot Chat and return its results. This is technically feasible from the
interfaces, not implemented or tested in Pebble Crew. Reuse xAI's browser example
where appropriate rather than writing a speech model or another agent runtime.
See [xAI live voice](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech).

The owner server can issue [short-lived browser credentials](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens)
while retaining the permanent xAI key. Audio can then connect directly to xAI.
Its token is provider access, not permission to invoke arbitrary Hermes methods.

Grok's live protocol documents a speed multiplier of 0.7 to 1.5 and a shared
voice roster with TTS. Its [voice list and samples](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech)
can support the picker. Grok still requires its own transport/event and
Hermes-delegation mapping; this research does not add it to the implemented
provider list or claim a measured speed advantage.

## Verification additions

Test native secret capture through the real web bridge in an isolated home using
synthetic keys. Prove profile routing, metadata-only receipts, no value in model
inputs/transcripts/events/logs, Skip/expiry, read-only storage failure, replacement
and reconnect without draft loss. Prove a successful save is not a false claim of
provider validation. Do not use a real owner credential or make a provider call
in install/update checks.

For the picker, test persistence, capability-based controls, output-only preview,
single active preview, denied/failed playback, cancellation and switching voices
with the correct session lifecycle. Test real calls separately when the owner
chooses and configures the provider. The owner subsequently authorized the native implementation. Provider/account and physical-device acceptance remain separate.
