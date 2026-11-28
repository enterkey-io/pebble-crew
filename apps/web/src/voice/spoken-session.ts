import captureWorklet from './pcm-capture.js?url&no-inline';
import { record } from './decode';
import { VoiceStartError } from './errors';

const sampleRate = 24_000;
const endpoint = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// Turn-taking, in 40 ms capture frames (960 samples at 24 kHz).
export const turnTaking = {
  /** Level that counts as speech while nothing is playing. */
  speechLevel: 0.075,
  /** Consecutive voiced frames that start an utterance (120 ms). */
  startFrames: 3,
  /** While the Pebble is speaking its own audio leaks into the microphone, so
   *  interrupting needs clearly louder and longer speech (320 ms). */
  bargeLevel: 0.22,
  bargeFrames: 8,
  /** Silence that ends an utterance (1.5 s). Natural mid-sentence pauses are
   *  routinely longer than half a second. */
  endFrames: 38,
  /** Total voiced audio, onset included, needed before an utterance is sent
   *  (200 ms). A short "yes" or "no" must still count. */
  minSpeechFrames: 5,
  /** Hard cap on one utterance (45 s). */
  maxFrames: 1125,
  /** How long to wait for a transcript before dropping that one utterance. */
  transcriptTimeoutMs: 10_000,
} as const;

type AudioSessionType = 'auto' | 'playback' | 'play-and-record';

/** Safari's Audio Session API. Without it, iPhone mutes Web Audio under the
 *  silent switch and can route call audio to the quiet earpiece. */
export function setAudioSession(type: AudioSessionType) {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = type;
  } catch {
    // Unsupported browsers keep their default routing.
  }
}

type Handlers = {
  onStarted: () => void;
  onAudioLevel: (level: number) => void;
  onAutoplayBlocked: () => void;
  onClosed: (reason: string) => void;
  onUtterance: (utterance: { id: string; text: string; speechGeneration: number }) => void;
  onSpeechStart?: () => void;
  onPartial: (text: string) => void;
};

export class SpokenSession {
  sessionId: string | null = null;
  private audio?: AudioContext;
  private input?: MediaStream;
  private microphone?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private socket?: WebSocket;
  private closed = false;
  private started = false;
  private muted = false;
  private talking = false;
  private voiced = 0;
  private quiet = 0;
  private segmentLength = 0;
  private speechFrames = 0;
  private speechGeneration = 0;
  private committing: { id: string } | undefined;
  /** Words ElevenLabs has finalized that have not been sent yet. */
  private heard: string[] = [];
  /** The latest unfinished transcript, used if a commit is refused. */
  private partial = '';
  private commitTimer?: ReturnType<typeof setTimeout>;
  private playback: AbortController | undefined;
  private nodes = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly handlers: Handlers,
    private readonly ticket: () => Promise<unknown>,
  ) {}

  get connected() {
    return this.started && !this.closed && this.socket?.readyState === WebSocket.OPEN;
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
    let data;
    try {
      data = record(await this.ticket());
      if (
        typeof data.call_id !== 'string' ||
        !/^[a-f0-9]{32}$/.test(data.call_id) ||
        typeof data.token !== 'string' ||
        !/^[A-Za-z0-9_.~-]{12,4096}$/.test(data.token)
      )
        throw new Error('Invalid voice ticket');
    } catch (cause) {
      throw new VoiceStartError('provider', cause);
    }
    this.sessionId = data.call_id;
    if (this.closed) return;
    const params = new URLSearchParams({
      token: data.token,
      model_id: 'scribe_v2_realtime',
      audio_format: 'pcm_24000',
      commit_strategy: 'manual',
    });
    const socket = new WebSocket(endpoint + '?' + params);
    this.socket = socket;
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.closed || typeof event.data !== 'string' || event.data.length > 64000) return;
      try {
        this.receive(record(JSON.parse(event.data)));
      } catch {
        this.fail('ElevenLabs returned an invalid transcript.');
      }
    });
    socket.addEventListener('error', () =>
      this.fail('Could not connect to ElevenLabs speech recognition.'),
    );
    socket.addEventListener('close', () => this.fail('Speech recognition disconnected.'));
  }

  private receive(data: Record<string, unknown>) {
    switch (data.message_type) {
      case 'session_started':
        if (this.started) return;
        this.started = true;
        this.handlers.onStarted();
        if (this.audio?.state !== 'running') this.handlers.onAutoplayBlocked();
        break;
      case 'partial_transcript':
        if (typeof data.text !== 'string') break;
        this.partial = data.text.slice(0, 6000);
        if (!this.muted) this.handlers.onPartial(this.partial);
        break;
      case 'committed_transcript': {
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        this.partial = '';
        // ElevenLabs can finalize words on its own. Keep them for the next turn the
        // owner finishes rather than losing the start of a sentence. While the
        // Pebble is speaking and the owner is not, those words are its own echo.
        const echo = !this.committing && !this.talking && this.nodes.size > 0;
        if (text && !echo) this.heard.push(text);
        if (this.committing) this.finish(this.committing);
        break;
      }
      case 'commit_throttled':
      case 'insufficient_audio_activity':
        // A refused commit must not lose what was already heard.
        if (this.committing) this.finish(this.committing, true);
        break;
      case 'warning':
        break;
      case 'unaccepted_terms':
        this.fail('Accept the Scribe terms in ElevenLabs, then try the call again.');
        break;
      case 'auth_error':
      case 'quota_exceeded':
      case 'rate_limited':
      case 'input_error':
      case 'transcriber_error':
      case 'error':
        this.fail('ElevenLabs speech recognition stopped. Check your key and usage.');
        break;
    }
  }

  private onCapture(value: unknown) {
    if (
      !this.connected ||
      this.muted ||
      !value ||
      typeof value !== 'object' ||
      !('pcm' in value) ||
      !(value.pcm instanceof ArrayBuffer) ||
      !('level' in value) ||
      typeof value.level !== 'number'
    )
      return;
    const socket = this.socket;
    // About 20 s of audio. A phone on a weak connection can briefly fall well
    // behind; only a stalled connection should end the session.
    if (!socket || socket.bufferedAmount > 1_400_000) {
      this.fail('The microphone stream fell behind.');
      return;
    }
    const playing = this.nodes.size > 0;
    const voiced = value.level > turnTaking.speechLevel;
    const onset = playing ? value.level > turnTaking.bargeLevel : voiced;
    this.voiced = onset ? this.voiced + 1 : 0;
    if (
      !this.talking &&
      this.voiced >= (playing ? turnTaking.bargeFrames : turnTaking.startFrames)
    ) {
      this.talking = true;
      this.quiet = 0;
      this.segmentLength = 0;
      // The onset frames were speech too.
      this.speechFrames = this.voiced - 1;
      if (playing) this.stopPlayback();
      this.handlers.onSpeechStart?.();
    }
    this.quiet = voiced ? 0 : this.quiet + 1;
    if (this.talking) {
      this.segmentLength += 1;
      if (voiced) this.speechFrames += 1;
    }
    const ended =
      this.talking &&
      (this.quiet >= turnTaking.endFrames || this.segmentLength >= turnTaking.maxFrames);
    // A blip (door, cough, echo) ends without a commit; its audio is never sent as a turn.
    if (ended && this.speechFrames < turnTaking.minSpeechFrames) {
      this.talking = false;
      this.segmentLength = 0;
      this.speechFrames = 0;
    }
    const commit = ended && this.talking && !this.committing;
    if (commit) {
      this.talking = false;
      this.segmentLength = 0;
      this.speechFrames = 0;
      const utterance = { id: crypto.randomUUID() };
      this.committing = utterance;
      // Drop only this utterance if the transcript never arrives; keep the call.
      this.commitTimer = setTimeout(() => {
        if (this.committing === utterance) this.finish(utterance, true);
      }, turnTaking.transcriptTimeoutMs);
    }
    if (this.talking) this.handlers.onAudioLevel(value.level);
    else if (commit) this.handlers.onAudioLevel(0);
    this.sendChunk(socket, value.pcm, commit);
  }

  private sendChunk(socket: WebSocket, pcm: ArrayBuffer, commit: boolean) {
    const bytes = new Uint8Array(pcm);
    socket.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: btoa(String.fromCharCode(...bytes)),
        sample_rate: sampleRate,
        ...(commit ? { commit: true } : {}),
      }),
    );
  }

  /** Sends everything heard as one utterance. With `partial`, an unfinished
   *  transcript stands in for a commit ElevenLabs refused or never answered. */
  private finish(utterance: { id: string }, partial = false) {
    if (this.committing === utterance) {
      this.committing = undefined;
      clearTimeout(this.commitTimer);
    }
    if (partial && this.partial.trim()) this.heard.push(this.partial.trim());
    this.partial = '';
    this.handlers.onPartial('');
    const text = this.heard.join(' ').trim().slice(0, 6000);
    this.heard = [];
    // Only real words supersede an earlier reply. Noise, a cough or the
    // Pebble's own echo produces no transcript and must not silence it.
    if (text)
      this.handlers.onUtterance({ ...utterance, text, speechGeneration: ++this.speechGeneration });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    for (const track of this.input?.getAudioTracks() ?? []) track.enabled = !muted;
    if (muted) this.handlers.onAudioLevel(0);
  }

  async resumeAudio() {
    await this.audio?.resume();
  }

  canSpeak(speechGeneration: number) {
    return !this.closed && !this.talking && this.speechGeneration === speechGeneration;
  }

  async speak(
    speechGeneration: number,
    stream: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  ) {
    const audio = this.audio;
    // Hold a ready reply while the owner is mid-sentence instead of discarding it.
    // If what they are saying becomes a new utterance, that supersedes it below.
    const holdUntil = Date.now() + 60_000;
    while (this.talking && !this.closed && Date.now() < holdUntil)
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if (!audio || !this.canSpeak(speechGeneration)) return;
    this.stopPlayback();
    const playback = new AbortController();
    this.playback = playback;
    let next = audio.currentTime + 0.07;
    let trailing: number | undefined;
    let played = false;
    try {
      for await (const part of stream(playback.signal)) {
        if (playback.signal.aborted) return;
        // Keep the amount of audio scheduled ahead small so a long answer cannot fill memory.
        while (next - audio.currentTime > 1.5 && !playback.signal.aborted)
          await new Promise<void>((resolve) => setTimeout(resolve, 60));
        if (playback.signal.aborted) return;
        const bytes = new Uint8Array(part.length + (trailing === undefined ? 0 : 1));
        if (trailing !== undefined) bytes[0] = trailing;
        bytes.set(part, trailing === undefined ? 0 : 1);
        trailing = bytes.length % 2 ? bytes.at(-1) : undefined;
        const samples = Math.floor(bytes.length / 2);
        if (!samples) continue;
        const pcm = new DataView(bytes.buffer);
        const buffer = audio.createBuffer(1, samples, sampleRate);
        const channel = buffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples; i++) {
          const level = pcm.getInt16(i * 2, true) / 32768;
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
        next = Math.max(next, audio.currentTime + 0.02);
        source.start(next);
        next += buffer.duration;
        played = true;
        this.handlers.onAudioLevel(Math.min(1, Math.sqrt(sum / samples) * 4));
      }
      if (!played || trailing !== undefined) throw new Error('Incomplete speech audio');
    } catch (cause) {
      if (!playback.signal.aborted) {
        this.stopPlayback();
        throw cause;
      }
    }
  }

  private stopPlayback() {
    this.playback?.abort();
    this.playback = undefined;
    for (const node of this.nodes) {
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
    this.handlers.onAudioLevel(0);
  }

  private fail(message: string) {
    if (this.closed) return;
    this.close();
    this.handlers.onClosed(message);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.commitTimer);
    this.stopPlayback();
    this.socket?.close();
    this.input?.getTracks().forEach((track) => track.stop());
    this.capture?.disconnect();
    this.microphone?.disconnect();
    void this.audio?.close().catch(() => undefined);
    setAudioSession('auto');
  }
}
