# Voice and private prompts

Run the actual production bundle with the shared `test/chat-workspace/voice.spec.ts`
journeys. The mobile runner imports the same journeys.

- Private setup: field is masked, submission clears it, no value in messages or
  browser persistence, voice/pace survive saving, key-change entry starts empty.
- Palette: selected-Pebble owner bubbles, dark text, neutral Snow exception.
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
