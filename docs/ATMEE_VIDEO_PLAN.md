# Atmee video calls

Astra reviewed Atmee's public integration contract and the Pebble Crew voice and chat paths. The owner chose Atmee's character voice with Hermes delegation and asked that Hermes have context from every call.

## How a call works

- **Settings → Connections → Atmee** saves an API key through Hermes. Key validation is read-only. The key must allow sessions and character reads. It can be restricted to a single character or cover a roster.
- **Edit Pebble → Voice → Video** selects a conversational character owned by the account. The selected character supplies the face and voice. OpenAI and ElevenLabs audio calls keep their existing settings.
- **Start video call** opens an inline video surface above the conversation. Mute, captions, and End are available in the call. Camera is opt-in. The mirrored self-view sits in the lower-right corner. It is rendered locally and never published to the room. Chat stays available for Hermes approvals and results.
- Atmee handles conversation and decides when to ask Hermes. Its tool asks Pebble Crew to forward the most recent completed owner utterance. The tool accepts no free-form instruction, agent target, or authorization from Atmee. The original Hermes Bot Chat runs the turn with its existing profile, SOUL, memory, tools, and approvals.
- Both sides of the call are saved as captions on the owner host. The ending action records the call in chat and hands captured context to the original Hermes conversation, including when Atmee made no tool requests. Atmee captions can be incomplete. Raw audio and video are not recorded by Pebble Crew.

## Build and verify

1. Add owner-only key validation and character selection. Validate against the published OpenAPI, store the key in Hermes, and persist character IDs per Pebble. Never start a call during setup, install, update, or a connectivity check.
2. Join Atmee's Full-stack LiveKit room from the browser using an ephemeral ticket. Keep the key server-side. Cap the first version at five minutes. Cover audio permission, blocked playback, optional camera preview, and teardown. Use the shared application controls.
3. Correlate native Hermes turn receipts to the exact delegated user line. Return a short result within Atmee's tool wait window. If work continues, return a pending result and publish the later update to the call while it remains open. Hermes keeps the result in the original chat even after the video call ends.
4. Exercise settings, media, both-speaker captions, duplicate tool calls, long-running work and disconnects using synthetic vendor fixtures. Run the native path against a disposable Hermes home. Then use a real Atmee key and a test character on desktop and physical iOS to verify the vendor room, own-voice playback, timing and end-of-call context before release.

Atmee handles the microphone audio, its video/voice, and the subset of Hermes replies it speaks. Pebble Crew does not enable Atmee visitor memory or send SOUL or memory files to the provider. Full-stack lets Atmee choose when to delegate, and its late-result events are spoken in the character's words. These are vendor boundaries of the chosen integration.

Free includes API access and V1. V2 normally requires Growth or an invitation. Start with a ready V1 character on a capped key. Confirm the account's plan and pricing before spending credits.

[Pricing](https://www.atmee.ai/pricing) · [Integration modes](https://www.atmee.ai/docs/api/choose-integration) · [OpenAPI](https://www.atmee.ai/docs/openapi.yaml) · [Room protocol](https://github.com/Atmanity/atmee-toolkit/blob/main/plugins/atmee/skills/build-avatar-app/references/room.md)
