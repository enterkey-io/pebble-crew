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
