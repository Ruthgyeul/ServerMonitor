// Service worker for the installable app. Live data (the SSE stream and every
// /api/ route) always goes to the network. The page shell and its static
// assets are network-first with a cache fallback, so an installed app opened
// offline still loads; it then shows the last snapshot the dashboard saved
// (localStorage) under its offline banner and reconnects when it can.

const CACHE = 'sm-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function cacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return (
    request.mode === 'navigate' ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/')
  );
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (!cacheable(request)) return; // default network handling

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/')))
      .then(response => response || Response.error())
  );
});
