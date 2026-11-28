import type { SessionClient } from '@hermes-client/protocol';

export type AlertSupport = 'ready' | 'install' | 'unsupported';

/** iPhone and iPad allow alerts only from the Home Screen app. */
export function alertSupport(): AlertSupport {
  if (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
    return 'ready';
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
  const installed = window.matchMedia?.('(display-mode: standalone)').matches;
  return apple && !installed && /Safari/.test(navigator.userAgent) ? 'install' : 'unsupported';
}

function applicationKey(value: string) {
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function encoded(buffer: ArrayBuffer | null) {
  if (!buffer) throw new Error('Missing notification key');
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function registration() {
  return navigator.serviceWorker.ready;
}

/** Whether this device currently receives alerts. */
export async function alertsOn() {
  if (alertSupport() !== 'ready' || Notification.permission !== 'granted') return false;
  return Boolean(await (await registration()).pushManager.getSubscription());
}

export class AlertsBlocked extends Error {}

/** Must start from a tap: browsers only ask for permission during one. */
export async function turnOnAlerts(client: SessionClient) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new AlertsBlocked('Notifications are blocked');
  const config = (await client.invoke('push.config', {})) as { public_key?: unknown };
  if (typeof config.public_key !== 'string') throw new Error('Invalid notification key');
  const worker = await registration();
  // Always start fresh: an older sign-up may belong to a different server key.
  await (await worker.pushManager.getSubscription())?.unsubscribe();
  const subscription = await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationKey(config.public_key),
  });
  try {
    await client.invoke('push.subscribe', {
      endpoint: subscription.endpoint,
      p256dh: encoded(subscription.getKey('p256dh')),
      auth: encoded(subscription.getKey('auth')),
    });
  } catch (cause) {
    await subscription.unsubscribe().catch(() => undefined);
    throw cause;
  }
}

export async function turnOffAlerts(client: SessionClient) {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return;
  await client.invoke('push.unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
