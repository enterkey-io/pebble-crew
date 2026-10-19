// Copyright (c) 2025 Nous Research. MIT. See UPSTREAM.md.
import { record } from './decode';
import { VoiceStartError } from './errors';
/**
 * GPT-Live voice chat: the full-duplex voice frontend that DELEGATES to Hermes.
 *
 * `voice.voice_chat_mode: gpt-live` swaps the chained mic → STT → turn → TTS
 * loop for one OpenAI voice model (`gpt-live-1`) that listens and speaks at
 * the same time over WebRTC and has no tools of its own. Whenever the user
 * asks for real work it emits `session.delegation.created`; the desktop turns
 * that into an ordinary Hermes turn on the open session and streams the reply
 * back with `session.commentary.append`, which the voice paraphrases aloud.
 * Hermes keeps every capability — model choice, tools, memory, approvals.
 *
 * This module owns the transport only: session creation via the gateway
 * (the OpenAI key never reaches the renderer), the RTCPeerConnection, the
 * `oai-events` data channel, transcript accumulation and the command
 * surface the conversation hook drives. Vendor contract:
 * https://developers.openai.com/api/docs/guides/live-delegation
 */

export interface LiveTranscriptFragment {
  speaker: 'assistant' | 'user';
  text: string;
  startMs: number;
  endMs: number;
}

export interface VoiceLiveHandlers {
  /** GPT-Live asked the backend (Hermes) for help. `context` is the recent
   *  transcript window, newest last — the delegation itself carries no text. */
  onStarted?: () => void;
  onAudioLevel?: (level: number) => void;
  onAutoplayBlocked?: () => void;
  onDelegation: (delegationId: string, context: LiveTranscriptFragment[]) => void;
  /** Vendor-side error. `fatal` when the session is gone. */
  onError: (message: string, fatal: boolean) => void;
  /** `session.closed` arrived (or the transport dropped without it). */
  onClosed: (reason: string, usageSeconds: null | number) => void;
  /** Transcript deltas, for captions / live UI. */
  onTranscript?: (fragment: LiveTranscriptFragment) => void;
  /** Assistant audio output level hint: the remote track is speaking. */
  onSpeakingChange?: (speaking: boolean) => void;
}

const CLOSE_TIMEOUT_MS = 15_000;
const ICE_GATHER_TIMEOUT_MS = 10_000;
// Vendor cap: 500 tokens per append. ~4 chars/token, keep headroom.
const APPEND_CHAR_LIMIT = 1_400;
// How much conversation the backend receives per delegation.
const CONTEXT_WINDOW_MS = 5 * 60_000;
const CONTEXT_MAX_FRAGMENTS = 80;

/** Split a reply into append-sized chunks on sentence boundaries. */
export function chunkForCommentary(text: string, limit = APPEND_CHAR_LIMIT): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();

  if (!clean) {
    return [];
  }

  if (clean.length <= limit) {
    return [clean];
  }

  const chunks: string[] = [];
  let current = '';

  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      for (let index = 0; index < sentence.length; index += limit) {
        chunks.push(sentence.slice(index, index + limit));
      }

      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length > limit) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function waitForIceGathering(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      connection.removeEventListener('icegatheringstatechange', onState);
      // Trickle is fine: the vendor answers with the candidates it has.
      resolve();
    }, ICE_GATHER_TIMEOUT_MS);

    function onState() {
      if (connection.iceGatheringState !== 'complete') {
        return;
      }

      window.clearTimeout(timeout);
      connection.removeEventListener('icegatheringstatechange', onState);
      resolve();
    }

    connection.addEventListener('icegatheringstatechange', onState);
    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed') {
        window.clearTimeout(timeout);
        reject(new Error('WebRTC connection failed'));
      }
    });
  });
}

export class VoiceLiveSession {
  readonly audio: HTMLAudioElement;
  private readonly handlers: VoiceLiveHandlers;
  private peer: null | RTCPeerConnection = null;
  private events: null | RTCDataChannel = null;
  private microphone: null | MediaStream = null;
  private previewInput: null | MediaStream = null;
  private previewSource: null | ConstantSourceNode = null;
  private closeTimer: null | number = null;
  private finalized = false;
  private closing = false;
  private started = false;
  private eventCounter = 0;
  private transcript: LiveTranscriptFragment[] = [];
  private speakingProbe: null | number = null;
  private inputAnalyser: null | AnalyserNode = null;
  private outputAnalyser: null | AnalyserNode = null;
  private audioContext: null | AudioContext = null;
  private lastSpeaking = false;
  sessionId: null | string = null;
  constructor(
    handlers: VoiceLiveHandlers,
    private readonly exchange: (
      sdp: string,
      preview: boolean,
    ) => Promise<{ session: { id: string }; transport: { sdp: string } }>,
  ) {
    this.handlers = handlers;
    this.audio = new Audio();
    this.audio.autoplay = true;
  }

  get connected(): boolean {
    return this.started && !this.closing && this.events?.readyState === 'open';
  }

  private nextEventId(prefix: string): string {
    this.eventCounter += 1;

    return `${prefix}_${this.eventCounter}`;
  }

  private send(event: Record<string, unknown>): boolean {
    if (!this.events || this.events.readyState !== 'open') {
      return false;
    }

    this.events.send(JSON.stringify(event));

    return true;
  }

  /** Recent conversation, oldest first, bounded by time and count. */
  contextWindow(): LiveTranscriptFragment[] {
    const last = this.transcript.at(-1);

    if (!last) {
      return [];
    }

    const floor = last.endMs - CONTEXT_WINDOW_MS;

    return this.transcript
      .filter((fragment) => fragment.endMs >= floor)
      .slice(-CONTEXT_MAX_FRAGMENTS);
  }

  async start(preview = false): Promise<void> {
    if (this.peer) {
      throw new Error('GPT-Live session already started');
    }

    if (typeof RTCPeerConnection === 'undefined') throw new VoiceStartError('transport', null);
    const connection = new RTCPeerConnection();
    if (preview || this.handlers.onAudioLevel || this.handlers.onSpeakingChange) {
      try {
        this.audioContext = new AudioContext();
        if (!preview) void this.audioContext.resume().catch(() => undefined);
      } catch (cause) {
        if (preview) throw new VoiceStartError('transport', cause);
        // Audio still plays when a browser has no level analyser.
      }
    }
    this.peer = connection;

    connection.addEventListener('track', (event) => {
      if (this.closing || this.finalized) {
        event.track.stop();
        return;
      }
      const stream = new MediaStream([event.track]);
      this.audio.srcObject = stream;
      void this.audio.play().catch(() => this.handlers.onAutoplayBlocked?.());
      this.armAudioProbe(stream, 'output');
    });
    connection.addEventListener('connectionstatechange', () => {
      if (
        connection.connectionState === 'failed' ||
        connection.connectionState === 'disconnected'
      ) {
        this.finish('connection_lost', null);
      }
    });

    if (preview) {
      const context = this.audioContext;
      if (!context) throw new VoiceStartError('transport', null);
      const destination = context.createMediaStreamDestination();
      this.previewSource = context.createConstantSource();
      this.previewSource.offset.value = 0;
      this.previewSource.connect(destination);
      this.previewSource.start();
      this.previewInput = destination.stream;
      // Live advances its timeline on input audio, even when nobody speaks.
      // Generate silence locally; preview never captures the microphone.
      for (const track of this.previewInput.getAudioTracks())
        connection.addTrack(track, this.previewInput);
      await context.resume();
      if (this.finalized) return;
    } else {
      try {
        this.microphone = await navigator.mediaDevices.getUserMedia({
          audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        });
      } catch (cause) {
        throw new VoiceStartError('microphone', cause);
      }
      if (this.finalized) {
        this.microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      this.armAudioProbe(this.microphone, 'input');
      for (const track of this.microphone.getAudioTracks())
        connection.addTrack(track, this.microphone);
    }

    // Register the data channel before the offer so its m-line is negotiated.
    const events = connection.createDataChannel('oai-events');
    this.events = events;
    events.addEventListener('message', ({ data }) => this.handleEvent(String(data)));
    events.addEventListener('close', () => {
      if (!this.finalized) {
        this.finish('connection_lost', null);
      }
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await waitForIceGathering(connection);

    const sdp = connection.localDescription?.sdp;

    if (!sdp) {
      throw new Error('Missing local SDP offer');
    }

    if (this.finalized) return;
    let response;
    try {
      response = await this.exchange(sdp, preview);
    } catch (cause) {
      throw new VoiceStartError('provider', cause);
    }
    if (this.finalized) return;

    this.sessionId = response.session?.id ?? null;
    try {
      await connection.setRemoteDescription({ sdp: response.transport.sdp, type: 'answer' });
    } catch (cause) {
      throw new VoiceStartError('transport', cause);
    }
  }

  private armAudioProbe(stream: MediaStream, direction: 'input' | 'output'): void {
    const context = this.audioContext;
    if (!context) return;
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      if (direction === 'input') this.inputAnalyser = analyser;
      else this.outputAnalyser = analyser;
      if (this.speakingProbe) return;
      const buffer = new Uint8Array(256);
      const level = (node: AnalyserNode | null) => {
        if (!node) return 0;
        node.getByteTimeDomainData(buffer);
        let energy = 0;
        for (const sample of buffer) energy += ((sample - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(energy / buffer.length) * 5);
      };
      this.speakingProbe = window.setInterval(() => {
        const input = this.microphone?.getAudioTracks().some((track) => track.enabled)
          ? level(this.inputAnalyser)
          : 0;
        const output = level(this.outputAnalyser);
        this.handlers.onAudioLevel?.(Math.max(input, output));
        const speaking = output > 0.03;
        if (speaking !== this.lastSpeaking) {
          this.lastSpeaking = speaking;
          this.handlers.onSpeakingChange?.(speaking);
        }
      }, 50);
    } catch {
      // A level indicator is optional; audio transport remains usable.
    }
  }

  private handleEvent(raw: string): void {
    if (raw.length > 256_000) return;
    let event: Record<string, unknown>;

    try {
      event = record(JSON.parse(raw));
    } catch {
      return;
    }

    const nested = (value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value) ? record(value) : {};
    const number = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const string = (value: unknown) => (typeof value === 'string' ? value : '');
    if (this.closing && event.type !== 'session.closed') return;
    switch (event.type) {
      case 'session.started':
        this.started = true;
        this.handlers.onStarted?.();
        this.sessionId = string(nested(event.session).id) || this.sessionId;

        return;

      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta': {
        const fragment: LiveTranscriptFragment = {
          endMs: number(event.end_ms),
          speaker: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
          startMs: number(event.start_ms),
          text: string(event.delta),
        };

        this.transcript.push(fragment);

        if (this.transcript.length > 2_000) {
          this.transcript.splice(0, this.transcript.length - 1_500);
        }

        this.handlers.onTranscript?.(fragment);

        return;
      }

      case 'session.delegation.created': {
        const id = string(nested(event.delegation).id);

        if (id) {
          this.handlers.onDelegation(id, this.contextWindow());
        }

        return;
      }

      case 'error': {
        const code = string(nested(event.error).code);

        // Late appends after our own close are expected noise.
        if (code === 'context_injection_incomplete') {
          return;
        }

        this.handlers.onError(string(nested(event.error).message) || 'Live voice error', false);

        return;
      }

      case 'session.closed':
        this.finish(string(event.reason) || 'closed', number(nested(event.usage).seconds) || null);

        return;

      default:
        return;
    }
  }

  /** Quiet progress for the live model ("Hermes is running the tests…"). */
  think(delegationId: null | string, content: string): void {
    const text = content.replace(/\s+/g, ' ').trim().slice(0, APPEND_CHAR_LIMIT);

    if (text) {
      this.send({
        content: text,
        delegation_id: delegationId,
        event_id: this.nextEventId('think'),
        type: 'session.thinking.append',
      });
    }
  }

  /** A result the voice should say aloud (paraphrased). */
  speak(delegationId: null | string, content: string): void {
    for (const chunk of chunkForCommentary(content)) {
      this.send({
        content: chunk,
        delegation_id: delegationId,
        event_id: this.nextEventId('say'),
        type: 'session.commentary.append',
      });
    }
  }

  setMuted(muted: boolean): void {
    for (const track of this.microphone?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }

    this.send({
      event_id: this.nextEventId(muted ? 'mute' : 'unmute'),
      type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute',
    });
  }

  private stopInput(): void {
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.previewInput?.getTracks().forEach((track) => track.stop());
    this.previewSource?.stop();
    this.previewSource?.disconnect();
    this.previewSource = null;
    this.previewInput = null;
  }

  /** Graceful close: ask for `session.closed`, tear down after it (or a timeout). */
  close(): void {
    if (this.finalized || this.closing) {
      return;
    }

    this.closing = true;
    this.stopInput();
    this.audio.pause();
    this.audio.srcObject = null;
    if (!this.send({ type: 'session.close' })) {
      this.finish('close_requested', null);

      return;
    }

    this.closeTimer = window.setTimeout(
      () => this.finish('close_requested', null),
      CLOSE_TIMEOUT_MS,
    );
  }

  private finish(reason: string, usageSeconds: null | number): void {
    if (this.finalized) {
      return;
    }

    this.finalized = true;

    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    if (this.speakingProbe) {
      window.clearInterval(this.speakingProbe);
      this.speakingProbe = null;
    }

    this.inputAnalyser?.disconnect();
    this.outputAnalyser?.disconnect();
    this.handlers.onAudioLevel?.(0);
    void this.audioContext?.close().catch(() => undefined);
    this.stopInput();
    this.events?.close();
    this.peer?.close();
    this.audio.srcObject = null;
    this.audio.pause();
    this.handlers.onClosed(reason, usageSeconds);
  }
}
