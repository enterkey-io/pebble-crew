const cacheName = 'pebble-crew-public-v3';
const publicPaths = [
  '/offline.html',
  '/offline.css',
  '/icons/pebble-180.png',
  '/icons/pebble-192.png',
  '/icons/pebble-512.png',
];

globalThis.addEventListener('install', (event) => {
  event.waitUntil(
    globalThis.caches
      .open(cacheName)
      .then((cache) => cache.addAll(publicPaths))
      .then(() => globalThis.skipWaiting()),
  );
});
globalThis.addEventListener('activate', (event) => {
  event.waitUntil(
    globalThis.caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('pebble-crew-public-') && key !== cacheName)
            .map((key) => globalThis.caches.delete(key)),
        ),
      )
      .then(() => globalThis.clients.claim()),
  );
});
globalThis.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== globalThis.location.origin || url.search) return;
  if (publicPaths.includes(url.pathname)) {
    event.respondWith(
      globalThis.caches.match(request).then((cached) => cached ?? globalThis.fetch(request)),
    );
  } else if (request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname)) {
    // Owner pages, API responses, chats, files and credentials are never cached.
    event.respondWith(
      globalThis.fetch(request).catch(() => globalThis.caches.match('/offline.html')),
    );
  }
});

// Message alerts. The server sends only while no Pebble Crew window is in view.
globalThis.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title = typeof message.title === 'string' && message.title ? message.title : 'Pebble Crew';
  const body = typeof message.body === 'string' ? message.body : 'New message';
  const profile = typeof message.profile === 'string' ? message.profile : '';
  event.waitUntil(
    globalThis.registration.showNotification(title.slice(0, 80), {
      body: body.slice(0, 240),
      tag: typeof message.tag === 'string' ? message.tag : 'pebble',
      icon: '/icons/pebble-192.png',
      badge: '/icons/pebble-192.png',
      data: { profile },
    }),
  );
});
globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const profile = event.notification.data?.profile;
  const target = /^[A-Za-z0-9_-]{1,64}$/.test(profile ?? '')
    ? `/#chat=${encodeURIComponent(profile)}`
    : '/';
  // A suspended iPhone app can miss the message below; it reads this when it returns.
  const remember =
    target === '/'
      ? Promise.resolve()
      : globalThis.caches
          .open('pebble-open-chat')
          .then((cache) =>
            cache.put('/pending-chat', new Response(JSON.stringify({ profile, at: Date.now() }))),
          )
          .catch(() => undefined);
  event.waitUntil(
    remember
      .then(() => globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((windows) => {
        const open = windows.filter(
          (client) => new URL(client.url).origin === globalThis.location.origin,
        );
        if (open.length) {
          if (target !== '/')
            for (const client of open) client.postMessage({ type: 'pebble.open-chat', profile });
          return open[0].focus();
        }
        return globalThis.clients.openWindow(target);
      }),
  );
});
