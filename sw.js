// Service worker: netwerk-eerst voor de app-code zodat nieuwe deploys meteen
// binnenkomen; offline valt alles terug op de cache.
// Verhoog CACHE_NAAM bij grote wijzigingen om oude caches op te ruimen.

const CACHE_NAAM = 'toetsweekdrill-v3';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAAM).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(namen => Promise.all(namen.filter(n => n !== CACHE_NAAM).map(n => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // AI-calls altijd naar het netwerk

  // Netwerk-eerst: haal de nieuwste versie op, ververs de cache, en val bij
  // netwerkproblemen terug op de cache (offline-gedrag blijft behouden).
  // Navigaties vallen terug op de gecachte index.html.
  e.respondWith(
    fetch(e.request)
      .then(antwoord => {
        const kopie = antwoord.clone();
        caches.open(CACHE_NAAM).then(cache => cache.put(e.request, kopie));
        return antwoord;
      })
      .catch(() => caches.match(e.request).then(hit =>
        hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined),
      )),
  );
});
