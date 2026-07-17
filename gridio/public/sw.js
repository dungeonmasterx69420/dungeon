// GRIDIO service worker
// Strategy: network-first for everything, so live picks and scores are never
// stale. Successful same-origin responses are copied into a cache that only
// serves as an offline fallback for the app shell. /api is never intercepted.
// Bump CACHE (and the ?v= query here and in the HTML) whenever the shell changes.
const CACHE = 'gridio-v2';
const SHELL = [
  '/',
  '/leaderboard.html',
  '/login.html',
  '/css/gridio.css?v=2',
  '/js/api.js?v=2',
  '/js/app.js?v=2',
  '/js/leaderboard.js?v=2',
  '/img/gridio.svg',
  '/img/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((m) => m || (req.mode === 'navigate' ? caches.match('/') : Response.error()))
      )
  );
});
