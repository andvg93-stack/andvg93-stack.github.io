const CACHE_NAME = 'cafe-2035-huila-v5';
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const atSite = (path) => `${BASE_PATH}${path}`;
const ESSENTIAL = [
  '/',
  '/?basemap=local',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/data/huila-municipios.geojson',
  '/data/huila-areas-protegidas.geojson',
  '/data/huila-cauces-osm.geojson',
  '/data/cafe-frontier.geojson',
  '/data/frontier-surface.json',
  '/data/simulation-snapshots.json',
  '/data/model-manifest.json',
].map(atSite);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ESSENTIAL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(atSite('/?basemap=local'), copy));
          return response;
        })
        .catch(() => caches.match(atSite('/?basemap=local'))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
