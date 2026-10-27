/* Service Worker — Puls im Blick (27.10.2026, nach Vorbild Thailand-App)
   - App-Seite: Netz zuerst (immer neueste Fassung), nach 4 s oder bei Fehler die gespeicherte.
     Gespeichert wird nur eine Antwort mit Status 200 — in einem festen Seiten-Speicher (puls-app-page).
   - Eigene Dateien (Symbole, Manifest): Speicher zuerst, Versionsspeicher (bei jeder Änderung VERSION hochzählen).
   - Die Messwerte liegen NICHT hier, sondern im Browser-Speicher der Seite (localStorage).
   - Aufräumen nur von eigenen Speichern (Präfix puls-app-), nichts von anderen Apps derselben Adresse. */
const PREFIX = 'puls-app-';
const VERSION = PREFIX + 'static-v1';
const PAGE_CACHE = PREFIX + 'page';
const KEEP = [VERSION, PAGE_CACHE];
const STATIC = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const stat = await caches.open(VERSION);
    for (const url of STATIC) {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res.status === 200) await stat.put(url, res);
    }
    const page = await fetch(new Request('./', { cache: 'reload' }));
    if (page.status === 200) {
      const pc = await caches.open(PAGE_CACHE);
      await pc.put('./', page.clone());
      await pc.put('./index.html', page);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && !KEEP.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirstPage(event) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await Promise.race([fetch(event.request, { cache: 'reload' }), timeout(4000)]);
    if (response && response.status === 200) {
      // beide Kopien VOR dem ersten await erzeugen (sonst kann die Antwort schon verbraucht sein)
      const copy1 = response.clone();
      const copy2 = response.clone();
      event.waitUntil((async () => {
        try {
          await cache.put('./', copy1);
          await cache.put('./index.html', copy2);
        } catch (e) { /* Speicher voll o. ä.: alte Fassung bleibt */ }
      })());
      return response;
    }
    throw new Error('HTTP ' + (response && response.status));
  } catch (e) {
    return (await cache.match('./')) || (await cache.match('./index.html')) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App-Seite selbst
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(event));
    return;
  }
  // Eigene Dateien: Speicher zuerst
  event.respondWith((async () => {
    const stat = await caches.open(VERSION);
    const hit = await stat.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.status === 200) await stat.put(req, res.clone());
    return res;
  })());
});
