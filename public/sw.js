/* Lingbao MK75 Driver service worker: makes the app installable and usable offline.
 * Pages: network-first (new deploys arrive quickly), falling back to the cached copy offline.
 * Hashed build assets (assets/): precached at install, then cache-first (their names change on every deploy).
 *   Tabs are loaded on demand, so precaching is what lets a tab never opened online still open offline.
 * Everything else (manual screenshots, icons, manifest): network-first, since their names never change.
 *
 * The build (src/build/swPrecache.ts) replaces the two lines below with the build id and asset list, so this file
 * changes on every deploy: the browser installs the new worker and the app shows its update notice. One cache per
 * build; the old one is deleted when the new worker takes over (after "Reload" or once every tab is closed). */
const BUILD = 'dev';
const ASSETS = [];
const CACHE = 'mk75-' + BUILD;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  // If any file fails, installation fails and the current worker keeps serving the build that works.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL, ...ASSETS])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  if (!new URL(req.url).pathname.includes('/assets/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
