import { useEffect, useRef } from 'react';
import type { SessionClient } from '@hermes-client/protocol';

const HEARTBEAT_MS = 20_000;
const PENDING_MS = 120_000;
const RECHECK_MS = [300, 1000, 2500, 5000];
const profilePattern = /^[A-Za-z0-9_-]{1,64}$/;

/** The chat a tapped alert asks for (`#chat=<profile>`), removed from the address. */
export function consumeChatLink(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
) {
  if (!location.hash.startsWith('#chat=')) return '';
  const value = decodeURIComponent(location.hash.slice(6));
  history.replaceState(null, '', location.pathname + location.search);
  return profilePattern.test(value) ? value : '';
}

/** The chat of an alert tapped while the app was suspended, saved by the service worker. */
export async function takePendingChat(): Promise<string> {
  try {
    const cache = await caches.open('pebble-open-chat');
    const saved = await cache.match('/pending-chat');
    if (!saved) return '';
    await cache.delete('/pending-chat');
    const { profile, at } = (await saved.json()) as { profile?: unknown; at?: unknown };
    return typeof profile === 'string' &&
      profilePattern.test(profile) &&
      typeof at === 'number' &&
      Date.now() - at < PENDING_MS
      ? profile
      : '';
  } catch {
    return '';
  }
}

/** Tells the server while Pebble Crew is in view, so alerts wait until it is not,
 *  and opens the chat of an alert tapped while the app is already running. */
export function useMessageAlerts(
  client: SessionClient | undefined,
  onOpenChat: (profile: string) => void,
) {
  const openChat = useRef(onOpenChat);
  openChat.current = onOpenChat;
  useEffect(() => {
    if (!client) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const report = () => {
      const visible = document.visibilityState === 'visible';
      void client.invoke('push.presence', { visible }).catch(() => undefined);
      clearInterval(timer);
      timer = visible ? setInterval(report, HEARTBEAT_MS) : undefined;
    };
    report();
    document.addEventListener('visibilitychange', report);
    window.addEventListener('pagehide', report);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', report);
      window.removeEventListener('pagehide', report);
    };
  }, [client]);
  useEffect(() => {
    // iOS can show the app before the service worker has saved the tapped chat,
    // so look again for a few seconds after it comes into view.
    let checks: ReturnType<typeof setTimeout>[] = [];
    const look = () =>
      void takePendingChat().then((profile) => profile && openChat.current(profile));
    const pending = () => {
      checks.forEach(clearTimeout);
      checks = [];
      if (document.visibilityState !== 'visible') return;
      look();
      checks = RECHECK_MS.map((delay) => setTimeout(look, delay));
    };
    const message = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: unknown; profile?: unknown } | null;
      if (
        data?.type === 'pebble.open-chat' &&
        typeof data.profile === 'string' &&
        profilePattern.test(data.profile)
      ) {
        void takePendingChat();
        openChat.current(data.profile);
      }
    };
    pending();
    document.addEventListener('visibilitychange', pending);
    window.addEventListener('focus', pending);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', message);
      // Safari holds service worker messages until the page asks for them.
      if (typeof navigator.serviceWorker.startMessages === 'function')
        navigator.serviceWorker.startMessages();
    }
    return () => {
      checks.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', pending);
      window.removeEventListener('focus', pending);
      if ('serviceWorker' in navigator)
        navigator.serviceWorker.removeEventListener('message', message);
    };
  }, []);
}
