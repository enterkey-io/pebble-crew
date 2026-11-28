import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/** Runs the real service worker with a fake browser around it. */
function worker(
  windows: { url: string; focus: () => unknown; postMessage: (m: unknown) => void }[],
) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const saved: Record<string, string> = {};
  const scope = {
    location: { origin: 'https://crew.example.test' },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      (handlers[type] = handler),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => opened.push(url) },
    caches: {
      open: async () => ({
        put: async (key: string, response: Response) => (saved[key] = await response.text()),
      }),
    },
    URL,
    Response,
  };
  runInNewContext(readFileSync('apps/web/public/service-worker.js', 'utf8'), {
    globalThis: scope,
    URL,
    Response,
  });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> | undefined;
    handlers[type]!({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
    await work;
  };
  return { dispatch, shown, opened, saved };
}

describe('message alerts in the service worker', () => {
  it('shows the Pebble and its reply', async () => {
    const { dispatch, shown } = worker([]);
    await dispatch('push', {
      data: {
        json: () => ({
          title: 'Arlo',
          body: 'Three tasks are open.',
          profile: 'arlo',
          tag: 'arlo',
        }),
      },
    });
    expect(shown).toEqual([
      {
        title: 'Arlo',
        options: {
          body: 'Three tasks are open.',
          tag: 'arlo',
          icon: '/icons/pebble-192.png',
          badge: '/icons/pebble-192.png',
          data: { profile: 'arlo' },
        },
      },
    ]);
    await dispatch('push', {
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
    });
    expect(shown[1]).toMatchObject({ title: 'Pebble Crew', options: { body: 'New message' } });
  });

  it('a tap opens that chat in a new window, or in the open app', async () => {
    const closed = { opened: [] as string[] };
    const fresh = worker([]);
    await fresh.dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { profile: 'mica' } },
    });
    expect(fresh.opened).toEqual(['/#chat=mica']);
    const focus = vi.fn(),
      postMessage = vi.fn();
    const running = worker([{ url: 'https://crew.example.test/', focus, postMessage }]);
    await running.dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { profile: 'rowan' } },
    });
    expect(postMessage).toHaveBeenCalledWith({ type: 'pebble.open-chat', profile: 'rowan' });
    // Kept for an iPhone app that was suspended and misses the message.
    expect(JSON.parse(running.saved['/pending-chat']!)).toMatchObject({ profile: 'rowan' });
    expect(focus).toHaveBeenCalled();
    expect(running.opened).toEqual(closed.opened);
    const unsafe = worker([]);
    await unsafe.dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { profile: '../x?y' } },
    });
    expect(unsafe.opened).toEqual(['/']);
    expect(unsafe.saved).toEqual({});
  });
});
