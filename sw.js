const CACHE = 'london-v1';
const SHELL = [
  './', 'style.css', 'csv.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', e =>
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

// ponytail: every GET is cached, including each map tile viewed, with no eviction.
// Fine for a week-long trip; add a tile cap if the cache ever gets big.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req);
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    });
    // Data (the page's own fetch of the CSV): network first, saved copy when offline.
    if (req.destination === '') return fresh.catch(() => cached || Response.error());
    // App shell, Leaflet, tiles: saved copy at once, refreshed in the background for next time.
    if (!cached) return fresh;
    e.waitUntil(fresh.catch(() => {}));
    return cached;
  }));
});
