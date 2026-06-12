// Cache-first service worker voor statische assets.
// Verhoog CACHE_NAAM bij elke deploy zodat clients de nieuwe versie ophalen.

const CACHE_NAAM = 'toetsweekdrill-v1';

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

  // Navigaties: netwerk eerst zodat updates binnenkomen, offline terugvallen op cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Statische assets: cache-first, daarna netwerk (en in cache zetten)
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(antwoord => {
      const kopie = antwoord.clone();
      caches.open(CACHE_NAAM).then(cache => cache.put(e.request, kopie));
      return antwoord;
    })),
  );
});
