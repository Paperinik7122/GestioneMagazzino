// Service worker: l'app funziona offline. Il build sostituisce VERSIONE e FILE.
const VERSIONE = '__VERSIONE__';
const FILE = __FILE__;
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
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    if (e.request.mode === 'navigate') return (await caches.match('./index.html')) ?? (await caches.match('./'));
    return fetch(e.request);
  })());
});
