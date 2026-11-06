# Atmee video calls

Astra reviewed Atmee's public integration contract and the Pebble Crew voice and chat paths. The owner chose Atmee's character voice with Hermes delegation and asked that Hermes have context from every call.

## How a call works

- **Settings → Connections → Atmee** saves an API key through Hermes. Key validation is read-only. The key must allow sessions and character reads. It can be restricted to a single character or cover a roster.
- **Edit Pebble → Voice → Video** selects a conversational character owned by the account. Atmee supplies its face, voice, movement, and ordinary conversation. To test Aurora, create her V2 character in Atmee Studio and mirror her role, speaking style, and mannerisms in the persona and behavior controls. Use a reviewed description. Select that character for Aurora in Pebble Crew. OpenAI and ElevenLabs audio calls keep their existing settings.
- **Start video call** opens an inline video surface above the conversation. Mute, captions, and End are available in the call. Camera is opt-in. The mirrored self-view sits in the lower-right corner. It is rendered locally and never published to the room. Chat stays available for Hermes approvals and results.
- Optional **Call notes** carry standing preferences for that Pebble and character. After the room's audio or captions arrive, Pebble Crew sends those notes and up to one short excerpt per speaker from the last video call with that same character and conversation. These captions are fallible. Current facts come from Hermes.
- Atmee decides when to ask Hermes. The call instructions tell it to delegate questions about earlier chats or preferences, explicit memory changes, and requests to check facts or do work. The tool forwards the most recent completed caller utterance and accepts no free-form instruction, agent target, or authorization from Atmee. The original Hermes Bot Chat runs the turn with its existing profile, SOUL, memory, tools, and approvals.
- Both sides of the call are saved as captions on the owner host. The ending action records the call in chat and hands captured context to the original Hermes conversation, including when Atmee made no tool requests. Atmee captions can be incomplete. Raw audio and video are not recorded by Pebble Crew.

## Build and verify

1. Add owner-only key validation and character selection. Validate against the published OpenAPI, store the key in Hermes, and persist character IDs per Pebble. Never start a call during setup, install, update, or a connectivity check.
2. Join Atmee's Full-stack LiveKit room from the browser using an ephemeral ticket. Keep the key server-side. Cap the first version at five minutes. Cover audio permission, blocked playback, optional camera preview, and teardown. Use the shared application controls.
3. Correlate native Hermes turn receipts to the exact delegated user line. Return a short result within Atmee's tool wait window. If work continues, return a pending result and publish the later update to the call while it remains open. Hermes keeps the result in the original chat even after the video call ends.
4. Exercise settings, media, both-speaker captions, duplicate tool calls, long-running work and disconnects using synthetic vendor fixtures. In a disposable Hermes home, have Aurora remember a text fact, recall and correct it in video, then recall the corrected fact after reload and in the next call. The synthetic room exercises the actual native memory tool. Repeat the same scenario with a real V2 Aurora character on desktop and physical iOS to verify Atmee's tool choice, own-voice playback, timing and end-of-call context before release.

Atmee handles the microphone audio, its video and voice, the call notes and prior video excerpts, and the subset of Hermes replies it speaks. Pebble Crew keeps the full captured call context, SOUL, and memory files on the Hermes host. Atmee visitor memory stays off. Atmee chooses when to delegate and speaks late results in the character's words.

## Create Aurora through Atmee's API

In **Edit Pebble → Voice → Video → New character**, choose a portrait and voice style. The editor starts with the Pebble’s saved name, role, and descriptions. Review or edit the character description before submitting. Atmee receives that description and portrait, generates a voice for the selected style, and builds a private V2 character. A generated voice can use Atmee credits. The editor shows the saved build status after reopening. Select **Use character** when the build is ready.

In-app creation needs an account-wide key with `sessions`, `avatars:read`, `avatars:write`, and `generation:write`. A narrower call key still works for an avatar already selected.

Create a private V2 avatar from Aurora's approved portrait, voice sample, and short persona description. Atmee accepts these inputs in a manifest or a ZIP. The provisioning key needs account-wide `avatars:write`. Use a separate capped key bound to Aurora with `sessions` and `avatars:read` for Pebble Crew. Add it under **Settings → Connections → Atmee** once the character is ready. [Create an avatar](https://www.atmee.ai/docs/api/create-avatar) · [API keys](https://www.atmee.ai/docs/api/api-keys)

For the first phone test, request portrait `384 × 672` if the account offers it. Keep the full head and neck in the frame with some room around the hair. Atmee captures alternate takes from the same source portrait. To keep distinct outfits selectable, create separate characters such as **Aurora · Studio** and **Aurora · Casual**. Either can be selected for the same Pebble with an account-wide call key. They share Hermes memory and the canonical Bot Chat. Call notes and prior video excerpts stay scoped to the selected character. [Atmee portrait guide](https://www.atmee.ai/docs/guides/negative-examples)

Free includes API access and V1. The V2 Aurora test needs an account with access to V2. Confirm the plan and pricing before spending credits.

[Pricing](https://www.atmee.ai/pricing) · [Integration modes](https://www.atmee.ai/docs/api/choose-integration) · [OpenAPI](https://www.atmee.ai/docs/openapi.yaml) · [Room protocol](https://github.com/Atmanity/atmee-toolkit/blob/main/plugins/atmee/skills/build-avatar-app/references/room.md)
