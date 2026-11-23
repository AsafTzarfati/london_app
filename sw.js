const CACHE = 'london-v6';
const SHELL = ['./', 'style.css', 'csv.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));

self.addEventListener('activate', e =>
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('london-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  // Only our files and the published sheet. Google Maps must not be stored (terms of service).
  const url = new URL(req.url);
  if (url.origin !== location.origin && url.hostname !== 'docs.google.com') return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req);
    // no-cache: GitHub Pages files sit in the HTTP cache for 10 minutes and would refill us with the old version
    const fresh = (url.origin === location.origin ? fetch(req.url, { cache: 'no-cache' }) : fetch(req)).then(res => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    });
    // Data (the page's own fetch of the CSV): network first, saved copy when offline.
    if (req.destination === '') return fresh.catch(() => cached || Response.error());
    // App shell: saved copy at once, refreshed in the background for next time.
    if (!cached) return fresh;
    e.waitUntil(fresh.catch(() => {}));
    return cached;
  }));
});
