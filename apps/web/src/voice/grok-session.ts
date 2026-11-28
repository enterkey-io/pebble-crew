import captureWorklet from './pcm-capture.js?url&no-inline';
import { record } from './decode';
import { VoiceStartError } from './errors';
import { setAudioSession } from './spoken-session';

const sampleRate = 24000;
const endpoint = 'wss://api.x.ai/v1/realtime';

type Handlers = {
  onStarted: () => void;
  onAudioLevel: (level: number) => void;
  onAutoplayBlocked: () => void;
  onTranscript: (fragment: { speaker: 'user' | 'assistant'; text: string; done?: boolean }) => void;
  /** Grok asked the Pebble for real work; answer with `answer(toolCallId, text)`. */
  onAsk: (toolCallId: string, request: string) => void;
  onClosed: (message: string) => void;
};

/** The briefing and short-lived token the bridge issues for one call. */
export type GrokTicket = {
  callId: string;
  token: string;
  model: string;
  voice: string;
  instructions: string;
  history: { role: 'user' | 'assistant'; text: string }[];
};

export function grokTicket(value: unknown): GrokTicket {
  const data = record(value);
  if (
    typeof data.call_id !== 'string' ||
    !/^[a-f0-9]{32}$/.test(data.call_id) ||
    typeof data.token !== 'string' ||
    !/^[\x21-\x7e]{16,4096}$/.test(data.token) ||
    typeof data.model !== 'string' ||
    !/^[a-z0-9.-]{1,64}$/.test(data.model) ||
    typeof data.voice !== 'string' ||
    !/^[a-z]{1,40}$/.test(data.voice) ||
    typeof data.instructions !== 'string' ||
    data.instructions.length > 60000 ||
    !Array.isArray(data.history)
  )
    throw new Error('Invalid Grok voice ticket');
  const history: GrokTicket['history'] = [];
  for (const item of data.history) {
    const turn = record(item);
    if ((turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string')
      history.push({ role: turn.role, text: turn.text.slice(0, 2000) });
  }
  return {
    callId: data.call_id,
    token: data.token,
    model: data.model,
    voice: data.voice,
    instructions: data.instructions,
    history,
  };
}

function askRequest(value: unknown) {
  try {
    const args = record(JSON.parse(typeof value === 'string' ? value : ''));
    return typeof args.request === 'string' ? args.request.trim().slice(0, 6000) : '';
  } catch {
    return '';
  }
}

const askPebble = {
  type: 'function',
  name: 'ask_pebble',
  description:
    'Ask the real Pebble (you, with all your tools, files and memory) to answer or do something. ' +
    'Use it for current facts, your work, tasks, messages, scheduling and any action. ' +
    'It returns the answer to share with the owner.',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'What the owner asked for, in their words.' },
    },
    required: ['request'],
  },
};

/** A live Grok Voice call. Grok talks; real work goes to the Pebble's Bot Chat. */
export class GrokSession {
  sessionId: string | null = null;
  private socket: WebSocket | undefined;
  private audio: AudioContext | undefined;
  private input: MediaStream | undefined;
  private capture: AudioWorkletNode | undefined;
  private microphone: MediaStreamAudioSourceNode | undefined;
  private nodes = new Set<AudioBufferSourceNode>();
  private next = 0;
  private started = false;
  private closed = false;
  private muted = false;

  constructor(
    private readonly handlers: Handlers,
    private readonly ticket: () => Promise<unknown>,
  ) {}

  get connected() {
    return this.started && !this.closed && this.socket?.readyState === WebSocket.OPEN;
  }

  get playing() {
    return this.nodes.size > 0;
  }

  async start() {
    setAudioSession('play-and-record');
    try {
      this.audio = new AudioContext({ sampleRate });
      void this.audio.resume().catch(() => this.handlers.onAutoplayBlocked());
    } catch (cause) {
      throw new VoiceStartError('transport', cause);
    }
    let input;
    try {
      input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (cause) {
      throw new VoiceStartError('microphone', cause);
    }
    if (this.closed) {
      input.getTracks().forEach((track) => track.stop());
      return;
    }
    this.input = input;
    const audio = this.audio;
    if (audio.sampleRate !== sampleRate)
      throw new VoiceStartError('transport', new Error('Unsupported microphone sample rate'));
    let ticket: GrokTicket;
    try {
      ticket = grokTicket(await this.ticket());
    } catch (cause) {
      throw new VoiceStartError('provider', cause);
    }
    this.sessionId = ticket.callId;
    if (this.closed) return;
    try {
      await audio.audioWorklet.addModule(captureWorklet);
      if (this.closed) return;
      this.capture = new AudioWorkletNode(audio, 'pebble-pcm-capture');
      this.microphone = audio.createMediaStreamSource(input);
      this.microphone.connect(this.capture);
      this.capture.connect(audio.destination);
      this.capture.port.onmessage = (event: MessageEvent<unknown>) => this.onCapture(event.data);
    } catch (cause) {
      throw new VoiceStartError('transport', cause);
    }
    // Browsers cannot send an Authorization header; xAI takes the token as a subprotocol.
    const socket = new WebSocket(`${endpoint}?model=${encodeURIComponent(ticket.model)}`, [
      `xai-client-secret.${ticket.token}`,
    ]);
    this.socket = socket;
    socket.addEventListener('open', () => this.configure(ticket));
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.closed || typeof event.data !== 'string' || event.data.length > 4_000_000) return;
      try {
        this.receive(record(JSON.parse(event.data)));
      } catch {
        this.fail('Grok returned an invalid message.');
      }
    });
    socket.addEventListener('error', () => this.fail('Could not connect to Grok Voice.'));
    socket.addEventListener('close', () => this.fail('Grok Voice disconnected.'));
  }

  private configure(ticket: GrokTicket) {
    const recent = ticket.history
      .map((turn) => `${turn.role === 'user' ? 'Owner' : 'You'}: ${turn.text}`)
      .join('\n');
    this.send({
      type: 'session.update',
      session: {
        instructions: recent
          ? `${ticket.instructions}\n\nYour most recent text chat with the owner, oldest first:\n${recent}`
          : ticket.instructions,
        voice: ticket.voice,
        turn_detection: { type: 'server_vad' },
        audio: {
          input: { format: { type: 'audio/pcm', rate: sampleRate } },
          output: { format: { type: 'audio/pcm', rate: sampleRate } },
        },
        tools: [askPebble],
      },
    });
  }

  private receive(data: Record<string, unknown>) {
    switch (data.type) {
      case 'session.updated':
        if (this.started) return;
        this.started = true;
        this.handlers.onStarted();
        if (this.audio?.state !== 'running') this.handlers.onAutoplayBlocked();
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (typeof data.delta === 'string') this.play(data.delta);
        break;
      case 'response.output_audio_transcript.delta':
        if (typeof data.delta === 'string')
          this.handlers.onTranscript({ speaker: 'assistant', text: data.delta });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof data.transcript === 'string' && data.transcript.trim())
          this.handlers.onTranscript({
            speaker: 'user',
            text: data.transcript.slice(0, 6000),
            done: true,
          });
        break;
      case 'input_audio_buffer.speech_started':
        // The owner is talking: stop Grok's audio right away.
        this.stopPlayback();
        break;
      case 'response.function_call_arguments.done': {
        if (data.name !== 'ask_pebble' || typeof data.call_id !== 'string') break;
        const request = askRequest(data.arguments);
        if (request) this.handlers.onAsk(data.call_id, request);
        else this.answer(data.call_id, 'No request was given. Ask the owner what they need.');
        break;
      }
      case 'error': {
        const error = data.error && typeof data.error === 'object' ? record(data.error) : {};
        // Before the session starts, any error means the call cannot begin.
        if (!this.started)
          this.fail(
            typeof error.message === 'string' && /auth|token|key/i.test(error.message)
              ? 'xAI refused the voice session. Check your xAI key.'
              : 'Grok Voice could not start this call.',
          );
        break;
      }
      default:
        break;
    }
  }

  /** Returns the Pebble's answer to Grok, which says it aloud. */
  answer(toolCallId: string, text: string) {
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: toolCallId, output: text.slice(0, 12000) },
    });
    this.send({ type: 'response.create' });
  }

  private onCapture(value: unknown) {
    if (
      !this.connected ||
      this.muted ||
      !value ||
      typeof value !== 'object' ||
      !('pcm' in value) ||
      !(value.pcm instanceof ArrayBuffer)
    )
      return;
    const socket = this.socket!;
    if (socket.bufferedAmount > 1_400_000) {
      this.fail('The microphone stream fell behind.');
      return;
    }
    if ('level' in value && typeof value.level === 'number' && !this.playing)
      this.handlers.onAudioLevel(value.level);
    const bytes = new Uint8Array(value.pcm);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    this.send({ type: 'input_audio_buffer.append', audio: btoa(binary) });
  }

  private play(delta: string) {
    const audio = this.audio;
    if (!audio || delta.length > 2_000_000) return;
    const raw = atob(delta);
    const samples = Math.floor(raw.length / 2);
    if (!samples) return;
    const buffer = audio.createBuffer(1, samples, sampleRate);
    const channel = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      let value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      if (value >= 0x8000) value -= 0x10000;
      const level = value / 32768;
      channel[i] = level;
      sum += level * level;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.onended = () => {
      this.nodes.delete(source);
      source.disconnect();
      if (!this.nodes.size) this.handlers.onAudioLevel(0);
    };
    this.nodes.add(source);
    this.next = Math.max(this.next, audio.currentTime + 0.05);
    source.start(this.next);
    this.next += buffer.duration;
    this.handlers.onAudioLevel(Math.min(1, Math.sqrt(sum / samples) * 4));
  }

  private stopPlayback() {
    for (const node of this.nodes) {
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
    this.next = 0;
    this.handlers.onAudioLevel(0);
  }

  private send(value: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    for (const track of this.input?.getAudioTracks() ?? []) track.enabled = !muted;
    if (muted) this.handlers.onAudioLevel(0);
  }

  async resumeAudio() {
    await this.audio?.resume();
  }

  private fail(message: string) {
    if (this.closed) return;
    this.close();
    this.handlers.onClosed(message);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopPlayback();
    this.socket?.close();
    this.input?.getTracks().forEach((track) => track.stop());
    this.capture?.disconnect();
    this.microphone?.disconnect();
    void this.audio?.close().catch(() => undefined);
    setAudioSession('auto');
  }
}
