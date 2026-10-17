import { afterEach, expect, it, vi } from 'vitest';
import { TranscriptFollow } from './viewport-motion';

afterEach(() => vi.unstubAllGlobals());
it('finishes on a browser that truncates scroll writes instead of scheduling frames forever', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0,
    position = 100;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const node = {
    get scrollTop() {
      return position;
    },
    set scrollTop(value: number) {
      position = Math.trunc(value);
    },
    scrollHeight: 604,
    clientHeight: 500,
  };
  const follower = new TranscriptFollow(node as HTMLElement);
  follower.follow();
  for (let i = 1; i <= 12 && frames.size; i++) {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    callback(i * 8);
  }
  expect(position).toBe(104);
  expect(follower.active).toBe(false);
  expect(frames.size).toBe(0);
});
