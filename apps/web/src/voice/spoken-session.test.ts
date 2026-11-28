import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpokenSession, turnTaking } from './spoken-session';

type Sent = { commit?: boolean };

function harness() {
  const sent: Sent[] = [];
  const words: string[] = [];
  const utterances: { text: string; speechGeneration: number }[] = [];
  const closed: string[] = [];
  const session = new SpokenSession(
    {
      onStarted: () => undefined,
      onAudioLevel: () => undefined,
      onAutoplayBlocked: () => undefined,
      onClosed: (reason) => closed.push(reason),
      onUtterance: (utterance) => utterances.push(utterance),
      onPartial: (text) => words.push(text),
    },
    async () => ({}),
  );
  const internal = session as unknown as {
    started: boolean;
    socket: unknown;
    nodes: Set<unknown>;
    onCapture: (value: unknown) => void;
    receive: (data: Record<string, unknown>) => void;
  };
  internal.started = true;
  internal.socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (data: string) => sent.push(JSON.parse(data) as Sent),
    close: () => undefined,
  };
  const frames = (level: number, count: number) => {
    for (let i = 0; i < count; i++) internal.onCapture({ pcm: new ArrayBuffer(1920), level });
  };
  const commits = () => sent.filter((item) => item.commit).length;
  const transcript = (text: string) =>
    internal.receive({ message_type: 'committed_transcript', text });
  const partial = (text: string) => internal.receive({ message_type: 'partial_transcript', text });
  return { session, internal, frames, commits, transcript, partial, utterances, closed, words };
}

const ms = (value: number) => Math.round(value / 40);

afterEach(() => vi.useRealTimers());

describe('spoken call turn-taking', () => {
  it('sends what was heard when ElevenLabs refuses or never answers a commit', () => {
    vi.useFakeTimers();
    const call = harness();
    call.frames(0.3, ms(1000));
    call.internal.receive({ message_type: 'partial_transcript', text: 'Book the table' });
    call.frames(0, ms(1600));
    call.internal.receive({ message_type: 'insufficient_audio_activity' });
    expect(call.utterances.map((item) => item.text)).toEqual(['Book the table']);
    call.frames(0.3, ms(1000));
    call.internal.receive({ message_type: 'partial_transcript', text: 'for eight' });
    call.frames(0, ms(1600));
    vi.advanceTimersByTime(turnTaking.transcriptTimeoutMs);
    expect(call.utterances.map((item) => item.text)).toEqual(['Book the table', 'for eight']);
    expect(call.closed).toEqual([]);
  });

  it('keeps words ElevenLabs finalizes without a requested commit', () => {
    const call = harness();
    call.frames(0.3, ms(800));
    call.transcript('So are you like');
    call.frames(0.3, ms(800));
    call.frames(0, ms(1600));
    call.transcript('an ElevenLabs version of Aurora?');
    expect(call.utterances.map((item) => item.text)).toEqual([
      'So are you like an ElevenLabs version of Aurora?',
    ]);
    // Words finalized on their own while the owner is silent wait for the next turn.
    call.transcript('Hello?');
    expect(call.utterances).toHaveLength(1);
    call.frames(0.3, ms(600));
    call.frames(0, ms(1600));
    call.transcript('Are you there?');
    expect(call.utterances.at(-1)?.text).toBe('Hello? Are you there?');
  });

  it('counts a short yes as a turn', () => {
    const call = harness();
    call.frames(0.3, 5);
    call.frames(0, ms(1600));
    expect(call.commits()).toBe(1);
  });

  it('keeps listening through a normal mid-sentence pause', () => {
    const call = harness();
    call.frames(0.3, ms(1200));
    call.frames(0, ms(900));
    call.frames(0.3, ms(800));
    expect(call.commits()).toBe(0);
    call.frames(0, ms(1600));
    expect(call.commits()).toBe(1);
  });

  it('never sends a short blip as a turn', () => {
    const call = harness();
    call.frames(0.3, 4);
    call.frames(0, ms(2000));
    expect(call.commits()).toBe(0);
  });

  it('keeps a pending reply when noise produces no words', () => {
    const call = harness();
    call.frames(0.3, ms(1000));
    call.frames(0, ms(1600));
    call.transcript('What is on my calendar?');
    const [first] = call.utterances;
    expect(call.session.canSpeak(first!.speechGeneration)).toBe(true);
    // A cough or chair scrape while the Pebble is thinking.
    call.frames(0.4, 10);
    call.frames(0, ms(1600));
    call.transcript('');
    expect(call.session.canSpeak(first!.speechGeneration)).toBe(true);
  });

  it('lets a new spoken request supersede an older reply', () => {
    const call = harness();
    call.frames(0.3, ms(1000));
    call.frames(0, ms(1600));
    call.transcript('First question');
    call.frames(0.3, ms(1000));
    call.frames(0, ms(1600));
    call.transcript('Actually, second question');
    const [first, second] = call.utterances;
    expect(call.session.canSpeak(first!.speechGeneration)).toBe(false);
    expect(call.session.canSpeak(second!.speechGeneration)).toBe(true);
  });

  it('does not interrupt its own speech on echo-level audio', () => {
    const call = harness();
    const node = { stop: vi.fn(), disconnect: vi.fn() };
    call.internal.nodes.add(node);
    call.frames(0.15, ms(2000));
    expect(node.stop).not.toHaveBeenCalled();
    call.frames(turnTaking.bargeLevel + 0.1, turnTaking.bargeFrames);
    expect(node.stop).toHaveBeenCalled();
  });

  it('drops only the utterance when a transcript never arrives', () => {
    vi.useFakeTimers();
    const call = harness();
    call.frames(0.3, ms(1000));
    call.frames(0, ms(1600));
    vi.advanceTimersByTime(turnTaking.transcriptTimeoutMs + 1);
    expect(call.closed).toEqual([]);
    call.frames(0.3, ms(1000));
    call.frames(0, ms(1600));
    expect(call.commits()).toBe(2);
  });
});
