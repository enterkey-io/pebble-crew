import { describe, expect, it, vi } from 'vitest';
import { LiveText } from './live-text';

function fixture() {
  let id = 0;
  const callbacks = new Map<number, (time: number) => void>();
  const text = new LiveText({
    request: (callback) => {
      callbacks.set(++id, callback);
      return id;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  });
  return {
    text,
    pending: () => callbacks.size,
    frame: (time: number) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      current.forEach((callback) => callback(time));
    },
  };
}

describe('live reply text', () => {
  it('keeps all received text immediately available but bounds visible updates to 30 frames per second', () => {
    const h = fixture();
    const update = vi.fn();
    h.text.subscribe(update);
    for (let i = 0; i < 100; i++) h.text.set((old) => old + 'x');
    expect(h.text.get()).toBe('x'.repeat(100));
    expect(h.pending()).toBe(1);
    h.frame(0);
    expect(update).toHaveBeenCalledTimes(1);
    h.text.set((old) => old + 'y');
    h.frame(16);
    expect(update).toHaveBeenCalledTimes(1);
    h.text.set((old) => old + 'z');
    h.frame(34);
    expect(update).toHaveBeenCalledTimes(2);
    expect(h.text.get()).toBe('x'.repeat(100) + 'yz');
  });
  it('replaces pending text without replaying old tokens and cancels work without a mounted reader', () => {
    const h = fixture();
    const update = vi.fn();
    h.text.set('before mount');
    expect(h.pending()).toBe(0);
    const unsubscribe = h.text.subscribe(update);
    h.text.set('old reply');
    h.text.set('');
    h.text.set('new reply');
    h.frame(0);
    expect(h.text.get()).toBe('new reply');
    expect(update).toHaveBeenCalledTimes(1);
    h.text.set('queued');
    unsubscribe();
    h.frame(100);
    expect(update).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBe(0);
  });
  it('releases scheduled work and can be subscribed again after lifecycle cleanup', () => {
    const h = fixture();
    const update = vi.fn();
    h.text.subscribe(update);
    h.text.set('pending');
    h.text.dispose();
    h.frame(100);
    expect(update).not.toHaveBeenCalled();
    h.text.subscribe(update);
    h.text.set('resumed');
    h.frame(110);
    expect(update).toHaveBeenCalledOnce();
  });
});
