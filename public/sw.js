// Minimal service worker, present only so browsers recognize the dashboard as
// an installable PWA (Chrome/Edge require a registered service worker with a
// fetch handler for the install prompt). It deliberately does no caching: this
// app's whole point is live data, so serving a cached response would show
// stale metrics without any indication they're stale. Every request just goes
// straight to the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
