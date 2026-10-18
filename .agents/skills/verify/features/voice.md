# Voice and private prompts

Run the actual production bundle with the shared `test/chat-workspace/voice.spec.ts`
journeys. The mobile runner imports the same journeys.

- Private setup: field is masked, submission clears it, no value in messages or
  browser persistence, voice/numeric speed survive saving. Key replacement is requested by the agent, starts empty and never appears as a voice-settings action.
- Palette: selected-Pebble owner bubbles, dark text, neutral Snow exception.
- First use: shared private ApprovalSurface before voice choices; explicit reuse of a saved key, then voice/speed. Saved setup starts a call directly on the next opening. Voice lives in the Pebble editor; no read-only Model tab.
- Call bar: Pebble avatar at the top, real audio-amplitude bars, settings, transcript toggle, mute and stop. End stops local tracks immediately and requests one text follow-up only for a real call with a transcript; previews never do.
- Failures: Preview never requests or blames the microphone. Safe provider codes preserve key/access/limit/network distinctions without returning vendor bodies.
- Local WebRTC: output-only preview never requests microphone; live delegation
  matches native row receipts; unrelated replies are not spoken; mute and End
  stop the synthetic microphone. No paid provider or physical capture is used.
- Denied microphone: no provider setup, intact draft and usable text composer.

Capture and inspect settled desktop/iPhone/Android screenshots. The full card and
Submit must fit the viewport before capture. Do not substitute a mocked review UI.

The local media case has an explicit automated-WebKit skip.
`node scripts/fixture/webrtc_probe.mjs` independently tests local peers without
app code; this installation produced zero WebKit candidates while Chromium
connected. The iPhone UI and permission-failure journeys remain exercised. This
is not evidence that physical Safari/provider calls pass or fail. Real media
acceptance requires the owner's configured provider and explicit real-device use.

`test/plugin/test_live_voice.py` covers connection/session isolation, changed
profile rejection, single-use/expired prompts and normal-model voice submission.
Run the actual native workspace fixture with explicit isolated paths:

```sh
PYTHONPATH="$HERMES_NATIVE_ROOT" "$HERMES_NATIVE_PYTHON" scripts/fixture/workspace_smoke.py
```

It uses disposable profiles and a deterministic loopback model/signaling service.
On the newer pin it verifies native credential/preferences scope, exact SDP, the
selected normal model despite a distinct auxiliary voice model, canonical saved
row receipts and Main Pebble context. The older pin must keep text functionality
and report live voice unsupported. Install/update never runs owner models or
paid provider checks. End closes media; accepted agent work remains in chat.

`test/chat-workspace/commands.spec.ts` and its phone import cover native slash suggestions, keyboard selection and command execution without a model prompt. The native workspace fixture exercises completion and model switching against both pins with a localhost model.
