Live voice transport derives from `apps/desktop/src/lib/voice-live.ts` in
[Hermes af0cd4df](https://github.com/NousResearch/hermes-agent/tree/af0cd4df34c73e41bcfcfa46c4081d1d83bdc81a).
The delegation protocol follows its `use-voice-live-conversation.ts` hook.

Adaptations: owner-session bridge exchange, validated unknown payloads, output-only
preview, immediate local audio/microphone stop, stale-start protection and explicit
autoplay recovery. Native delegations are serialized and matched by saved row
receipt; a spoken correction never invokes the generic session interrupt.

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
