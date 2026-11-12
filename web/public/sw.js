// TechPlug POS service worker: lets the app open and work with no internet.
// Pages: network first (so a new version is picked up when online), falling back to the saved copy.
// Built files (/assets/*, hashed names): saved once and reused. Fonts and icons: saved copy, refreshed in the background.
const CACHE = 'techplug-pos-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('techplug-pos-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// The page sends the files it loaded before the worker took over, so the very first visit is saved too.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'cache-urls') e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls.map((u) => c.add(u).catch(() => {})))));
});

async function trimAssets(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/assets/'));
  for (const r of keys.slice(0, Math.max(0, keys.length - 40))) await cache.delete(r);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!same && !font) return; // database and other services: always live

  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 4000);
          const res = await fetch(req, { signal: ctl.signal });
          clearTimeout(t);
          if (res.ok) cache.put('/', res.clone());
          return res;
        } catch {
          return (await cache.match('/')) || (await cache.match(req)) || new Response('Offline — open the app once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })(),
    );
    return;
  }

  if (same && url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) { await cache.put(req, res.clone()); trimAssets(cache); }
        return res;
      }),
    );
    return;
  }

  // icons, manifest, fonts: answer from the saved copy at once, refresh it in the background
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }),
  );
});
