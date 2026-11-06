import captureWorklet from './pcm-capture.js?url&no-inline';
import type { LiveTranscriptFragment, VoiceLiveHandlers } from './live-session';
import { record } from './decode';
import { VoiceStartError } from './errors';

const endpoint = 'wss://api.elevenlabs.io/v1/convai/realtime';
const sampleRate = 24_000;
const string = (value: unknown) => (typeof value === 'string' ? value : '');
type Playback = {
  node: AudioBufferSourceNode;
  item: string;
  index: number;
  start: number;
  offset: number;
};

export function elevenSessionAnswer(value: unknown) {
  const data = record(value);
  const session = record(data.session);
  if (
    data.provider !== 'elevenlabs' ||
    typeof session.id !== 'string' ||
    typeof data.client_secret !== 'string' ||
    !/^[A-Za-z0-9_.~-]{12,4096}$/.test(data.client_secret)
  )
    throw new Error('Invalid ElevenLabs session response');
  return { id: session.id, secret: data.client_secret };
}

export class ElevenRealtimeSession {
  sessionId: string | null = null;
  private socket?: WebSocket;
  private audio?: AudioContext;
  private input?: MediaStream;
  private capture?: AudioWorkletNode;
  private microphone?: MediaStreamAudioSourceNode;
  private playback = new Set<Playback>();
  private received = new Map<string, number>();
  private interrupted = new Set<string>();
  private tools = new Map<string, 'pending' | 'done'>();
  private captions: LiveTranscriptFragment[] = [];
  private nextAudio = 0;
  private started = false;
  private ended = false;
  private preview = false;
  private userSpeaking = false;
  private muted = false;
  private responding = false;
  private resultReady = false;

  constructor(
    private readonly handlers: VoiceLiveHandlers,
    private readonly exchange: (preview: boolean) => Promise<{ id: string; secret: string }>,
  ) {}

  get connected() {
    return this.started && !this.ended && this.socket?.readyState === WebSocket.OPEN;
  }
  get playing() {
    return this.audio?.state === 'running' && this.playback.size > 0;
  }
  async resumeAudio() {
    await this.audio?.resume();
  }
  contextWindow() {
    const floor = performance.now() - 5 * 60_000;
    return this.captions.filter((entry) => entry.endMs >= floor);
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted && this.userSpeaking) this.handlers.onAudioLevel?.(0);
    for (const track of this.input?.getAudioTracks() ?? []) track.enabled = !muted;
  }
  private send(message: Record<string, unknown>) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 256_000) {
      this.finish('connection_lost');
      return;
    }
    this.socket.send(JSON.stringify(message));
  }
  async start(preview: boolean) {
    this.preview = preview;
    let audio;
    try {
      audio = new AudioContext({ sampleRate });
      this.audio = audio;
      void audio.resume().catch(() => this.handlers.onAutoplayBlocked?.());
    } catch (cause) {
      throw new VoiceStartError('transport', cause);
    }
    if (!preview) {
      let input;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('', 'NotSupportedError');
        input = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (cause) {
        throw new VoiceStartError('microphone', cause);
      }
      if (this.ended) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      this.input = input;
      try {
        await audio.audioWorklet.addModule(captureWorklet);
        if (this.ended) return;
        this.capture = new AudioWorkletNode(audio, 'pebble-pcm-capture');
        this.microphone = audio.createMediaStreamSource(input);
        this.microphone.connect(this.capture);
        this.capture.connect(audio.destination);
        this.capture.port.onmessage = (event: MessageEvent<unknown>) => {
          const packet = event.data;
          if (
            !this.connected ||
            !packet ||
            typeof packet !== 'object' ||
            !('pcm' in packet) ||
            !(packet.pcm instanceof ArrayBuffer)
          )
            return;
          if (
            this.userSpeaking &&
            !this.muted &&
            'level' in packet &&
            typeof packet.level === 'number'
          )
            this.handlers.onAudioLevel?.(packet.level);
          const bytes = new Uint8Array(packet.pcm);
          this.send({
            type: 'input_audio_buffer.append',
            audio: btoa(String.fromCharCode(...bytes)),
          });
        };
      } catch (cause) {
        throw new VoiceStartError('transport', cause);
      }
    }
    let ticket;
    try {
      ticket = await this.exchange(preview);
    } catch (cause) {
      throw new VoiceStartError('provider', cause);
    }
    if (this.ended) return;
    this.sessionId = ticket.id;
    const socket = new WebSocket(endpoint, [
      'realtime',
      `openai-insecure-api-key.${ticket.secret}`,
    ]);
    this.socket = socket;
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!this.ended && typeof event.data === 'string' && event.data.length <= 256_000)
        this.receive(event.data);
    });
    socket.addEventListener('close', () => this.finish('connection_lost'));
    socket.addEventListener('error', () => this.finish('connection_lost'));
  }
  private receive(raw: string) {
    let event: Record<string, unknown>;
    try {
      event = record(JSON.parse(raw));
    } catch {
      return;
    }
    switch (event.type) {
      case 'session.created':
        if (this.started) return;
        this.started = true;
        if (!this.preview && this.audio?.state !== 'running') this.handlers.onAutoplayBlocked?.();
        this.handlers.onStarted?.();
        return;
      case 'session.closed':
        this.finish('provider_closed');
        return;
      case 'response.created':
        this.responding = true;
        return;
      case 'response.done':
        this.responding = false;
        this.resumeResponse();
        return;
      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true;
        this.interrupt();
        return;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false;
        this.resultReady = false;
        if (!this.playback.size) this.handlers.onAudioLevel?.(0);
        return;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        this.play(
          string(event.item_id),
          typeof event.content_index === 'number' ? event.content_index : 0,
          string(event.delta),
        );
        return;
      case 'conversation.item.input_audio_transcription.completed':
        this.transcript('user', `${string(event.transcript).trim()} `);
        return;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.transcript('assistant', string(event.delta));
        return;
      case 'response.function_call_arguments.done':
        this.delegate(event);
        return;
      case 'response.output_item.done': {
        const item = event.item;
        if (item && typeof item === 'object' && 'type' in item && item.type === 'function_call')
          this.delegate(record(item));
        return;
      }
      case 'error': {
        const error = event.error;
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'response_cancel_not_active'
        )
          return;
        this.handlers.onError('ElevenLabs could not continue this call.', true);
      }
    }
  }
  private transcript(speaker: LiveTranscriptFragment['speaker'], text: string) {
    if (!text.trim()) return;
    const now = performance.now();
    const fragment = { speaker, text: text.slice(0, 4000), startMs: now, endMs: now };
    const last = this.captions.at(-1);
    if (last?.speaker === speaker && speaker === 'assistant')
      this.captions[this.captions.length - 1] = {
        ...last,
        endMs: now,
        text: (last.text + fragment.text).slice(-4000),
      };
    else this.captions = [...this.captions.slice(-39), fragment];
    this.handlers.onTranscript?.(fragment);
  }
  private delegate(event: Record<string, unknown>) {
    const id = string(event.call_id);
    if (this.preview || event.name !== 'ask_pebble' || !id || id.length > 128 || this.tools.has(id))
      return;
    if (this.tools.size >= 128) {
      this.finish('call_limit');
      return;
    }
    let text = '';
    const args = string(event.arguments);
    if (args.length <= 8000) {
      try {
        text = string(record(JSON.parse(args)).request)
          .trim()
          .slice(0, 6000);
      } catch {
        /* refuse malformed tool input */
      }
    }
    this.tools.set(id, 'pending');
    if (text) this.handlers.onDelegation(id, this.contextWindow(), text);
    else this.speak(id, 'The request was incomplete. Please ask again.');
  }
  think(_delegation: string | null, _text: string) {
    // Standard Realtime has no GPT-Live progress commentary event.
  }
  speak(delegation: string | null, text: string) {
    if (delegation === null) {
      if (this.preview)
        this.send({
          type: 'response.create',
          response: { instructions: `Read this sample once, exactly as written: ${text}` },
        });
      return;
    }
    if (this.tools.get(delegation) !== 'pending') return;
    this.tools.set(delegation, 'done');
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: delegation, output: text.slice(0, 6000) },
    });
    this.resultReady = true;
    this.resumeResponse();
  }
  private resumeResponse() {
    if (this.resultReady && !this.userSpeaking && !this.responding) {
      this.resultReady = false;
      this.responding = true;
      this.send({ type: 'response.create' });
    }
  }
  private play(item: string, index: number, base64: string) {
    const audio = this.audio;
    if (!audio || !base64 || this.interrupted.has(item) || this.userSpeaking) return;
    let bytes: string;
    try {
      bytes = atob(base64);
    } catch {
      return;
    }
    if (bytes.length < 2 || bytes.length % 2 !== 0) return;
    if (this.nextAudio - audio.currentTime > 30) {
      this.finish('playback_limit');
      return;
    }
    const buffer = audio.createBuffer(1, bytes.length / 2, sampleRate);
    const samples = buffer.getChannelData(0);
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      const pcm = bytes.charCodeAt(2 * i) | (bytes.charCodeAt(2 * i + 1) << 8);
      const sample = ((pcm << 16) >> 16) / 32768;
      samples[i] = sample;
      energy += sample * sample;
    }
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(audio.destination);
    const start = Math.max(audio.currentTime + 0.015, this.nextAudio);
    const offset = this.received.get(item) ?? 0;
    this.received.set(item, offset + buffer.duration);
    this.nextAudio = start + buffer.duration;
    const playback = { node, item, index, start, offset };
    this.playback.add(playback);
    node.onended = () => {
      this.playback.delete(playback);
      node.disconnect();
      if (!this.playback.size) {
        this.handlers.onAudioLevel?.(0);
        this.handlers.onSpeakingChange?.(false);
      }
    };
    node.start(start);
    if (audio.state !== 'running') this.handlers.onAutoplayBlocked?.();
    this.handlers.onAudioLevel?.(Math.min(1, Math.sqrt(energy / samples.length) * 5));
    this.handlers.onSpeakingChange?.(true);
  }
  private interrupt() {
    const audio = this.audio;
    if (!audio || !this.playback.size) return;
    const current =
      [...this.playback].findLast((entry) => entry.start <= audio.currentTime) ??
      this.playback.values().next().value;
    for (const entry of this.playback) {
      this.interrupted.add(entry.item);
      entry.node.stop();
    }
    this.playback.clear();
    this.nextAudio = audio.currentTime;
    this.handlers.onAudioLevel?.(0);
    this.handlers.onSpeakingChange?.(false);
    if (current?.item)
      this.send({
        type: 'conversation.item.truncate',
        item_id: current.item,
        content_index: current.index,
        audio_end_ms: Math.round(
          (current.offset + Math.max(0, audio.currentTime - current.start)) * 1000,
        ),
      });
  }
  close() {
    this.finish('close_requested');
  }
  private finish(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.input?.getTracks().forEach((track) => track.stop());
    this.capture?.disconnect();
    this.capture?.port.close();
    this.microphone?.disconnect();
    this.socket?.close();
    void this.audio?.close().catch(() => undefined);
    this.playback.clear();
    this.handlers.onClosed(reason, null);
  }
}
