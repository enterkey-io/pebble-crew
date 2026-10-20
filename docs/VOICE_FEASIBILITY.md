# Reusing Hermes live voice in Pebble Crew

Reviewed 2026-10-17 against Pebble Crew `4b511af6ae6c681a214eb67731266dc36947da46` and Hermes `af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a` (0.21.7).

## Conclusion

**Adapt Hermes’s existing GPT-Live conversation into Pebble Crew.** Hermes already implements the continuous WebRTC call, microphone and speaker handling, transcript accumulation, delegation to its agent, streamed spoken results, mute and close. Pebble needs integration with its selected Bot Chat, authentication and UI—not another speech pipeline or an architecture-selection experiment.

The result is one Call action, continuous conversation, automatic turns and interruptions, Mute and End. OpenAI handles live media; substantive work stays with the selected Pebble’s real Hermes model, persona, memory, tools and approvals. Spoken wording may paraphrase native results.

## What is reused

- [Native voice setup](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/tools/voice_live.py) resolves configured credentials/model/voice, builds client-delegation configuration and exchanges an SDP offer server-side. The [audio routes](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/hermes_cli/web_routers/audio.py#L175) show profile-scoped use.
- [VoiceLiveSession](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/apps/desktop/src/lib/voice-live.ts) owns WebRTC, the data channel, transcript/context limits, commentary/thinking commands and media lifecycle.
- [The live conversation hook](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/apps/desktop/src/app/chat/composer/hooks/use-voice-live-conversation.ts) already converts delegations into Hermes requests and feeds results/progress back. Its owner-routing tests cover selecting the Bot’s connection/profile.

## Necessary adaptations

Bind setup and delegations to [Pebble’s authorized canonical Bot Chat](../plugins/bot-web/operations.py), replacing desktop imports/callbacks. Reuse `surface="voice-live"` and `voice_context`: they supply the existing model-input conversation note. Omit the separate `voice_turn` flag, which selects the auxiliary voice model. The upstream [composer](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/apps/desktop/src/app/chat/composer/hooks/use-composer-voice.ts#L186) already makes this distinction.

Customize the ephemeral voice identity/style for the selected Pebble. The native instructions helper appends to a generic “Hermes” persona; it does not replace it. A small plugin-local session-config adaptation must replace that identity paragraph while retaining delegation rules and configured instructions, without changing SOUL or profile settings.

Adapt the hook’s automatic whole-session interrupt and “latest response” assumptions. Spoken interruption must not cancel unrelated native work or speak another turn’s result. Keep corrections pending while busy, associate results with their delegation, and report ongoing work truthfully. Existing native approvals remain authoritative.

## Prerequisites and evidence limits

The owner must explicitly select/configure the OpenAI live provider and have account access. Keys remain on owner infrastructure; live audio and supplied conversation context go to that provider. No Pebble Crew relay/store is needed. Source comments do not establish current prices or account eligibility.

The inspected 0.21.0 build lacks this built-in mode: mark live voice unsupported there. Treat the verified 0.21.7 revision as the initial compatibility target, not proof that every later version works.

The initial research made no provider calls. Implementation acceptance now exercises disposable native profiles, synthetic keys, a local deterministic model and a local WebRTC peer; it does not use owner data or paid providers. Tests should verify this integration, including real browser/phone use when authorized; they need not reinvent or benchmark Hermes’s speech system. Preserve the inspected upstream [MIT notice](https://github.com/enterkey-io/hermes-agent/blob/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a/LICENSE) with reused code. [Implementation steps](VOICE_IMPLEMENTATION_PLAN.md) follow.
