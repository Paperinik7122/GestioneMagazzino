// Service worker: l'app funziona offline. Il build sostituisce VERSIONE e FILE.
const VERSIONE = '54401f2f6f';
const FILE = ["./","./app.js","./css/app.css","./fonts/manrope-latin-400-normal.woff2","./fonts/manrope-latin-500-normal.woff2","./fonts/manrope-latin-600-normal.woff2","./fonts/manrope-latin-700-normal.woff2","./fonts/manrope-latin-800-normal.woff2","./icons/apple-touch-icon.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./manifest.webmanifest","./sql-wasm.js","./sql-wasm.wasm"];
const CACHE = `magazzino-${VERSIONE}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// L'app avvisa quando c'è una versione nuova: si attiva solo se l'utente accetta.
self.addEventListener('message', (e) => {
  if (e.data === 'attiva') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.includes('/api/')) return; // i dati veri arrivano sempre dal server, mai dalla cache
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    if (e.request.mode === 'navigate') return (await caches.match('./index.html')) ?? (await caches.match('./'));
    return fetch(e.request);
  })());
});
