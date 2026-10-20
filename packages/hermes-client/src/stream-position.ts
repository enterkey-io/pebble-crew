import { record } from './json';

export type StreamPosition = {
  readonly epoch: string;
  readonly turn: number;
  readonly offset: number;
};
export function decodeStreamPosition(value: unknown): StreamPosition | undefined {
  const data =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? record(value)
      : undefined;
  return data &&
    typeof data.epoch === 'string' &&
    data.epoch.length <= 128 &&
    typeof data.turn === 'number' &&
    Number.isSafeInteger(data.turn) &&
    data.turn >= 0 &&
    typeof data.offset === 'number' &&
    Number.isSafeInteger(data.offset) &&
    data.offset >= 0
    ? { epoch: data.epoch, turn: data.turn, offset: data.offset }
    : undefined;
}

/** The snapshot length and event end offset share Python's Unicode code points. */
export class StreamHandoff {
  private position: StreamPosition | undefined;
  private running = false;
  restore(position: StreamPosition | undefined, running: boolean) {
    this.position = position;
    this.running = running;
  }
  accept(kind: string, value: unknown, text = ''): { accepted: boolean; text: string } {
    if (!['message.start', 'message.delta', 'message.complete'].includes(kind))
      return { accepted: true, text };
    const next = decodeStreamPosition(value);
    if (!next) return { accepted: true, text };
    const previous = this.position;
    if (previous && (next.epoch !== previous.epoch || next.turn < previous.turn))
      return { accepted: false, text: '' };
    const same = previous && next.turn === previous.turn;
    if (kind === 'message.start') {
      if (same) return { accepted: false, text: '' };
      this.running = true;
    } else if (kind === 'message.delta' && same) {
      const remaining = next.offset - previous.offset;
      if (remaining <= 0) return { accepted: false, text: '' };
      text = Array.from(text).slice(-remaining).join('');
    } else if (kind === 'message.complete') {
      if (same && !this.running) return { accepted: false, text: '' };
      this.running = false;
    }
    this.position = next;
    return { accepted: true, text };
  }
}
