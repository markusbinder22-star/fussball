// Service Worker: speichert alle Spieldateien, damit das Spiel auch offline startet.
// Bei jeder neuen Version die Nummer erhöhen, dann holen sich Handys die neuen Dateien.
const CACHE = 'bolzplatz-v1';
const FILES = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './js/main.js', './js/game.js', './js/world.js', './js/input.js', './js/audio.js',
  './vendor/three.module.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Erst Netz (damit Updates sofort ankommen), bei Offline aus dem Speicher
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
