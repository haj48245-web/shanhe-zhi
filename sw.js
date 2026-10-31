/* 山河志离线缓存：首次在 Wi-Fi 打开后，文字、省级封面与全部配图可离线阅读。 */
importScripts('./assets/js/offline-manifest.js');
importScripts('./assets/js/image-manifest.js');

const CACHE = 'shanhe-zhi-v5';
const CORE = self.OFFLINE_CORE || [];
const IMAGES = self.OFFLINE_IMAGES || [];
const INDEX = new URL('index.html', self.registration.scope).href;

async function cacheCore() {
  const cache = await caches.open(CACHE);
  await Promise.all(CORE.map(async (path) => {
    try {
      const url = new URL(path, self.registration.scope).href;
      await cache.add(new Request(url, { cache: 'reload' }));
    } catch (e) { /* 单张封面失败不影响整体离线 */ }
  }));
}

async function cacheAllImages(source) {
  const cache = await caches.open(CACHE);
  let next = 0, done = 0;
  const total = IMAGES.length;
  const worker = async () => {
    while (next < total) {
      const i = next++;
      try {
        const url = new URL(IMAGES[i], self.registration.scope).href;
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) { /* 单张失败继续 */ }
      done++;
      if (done % 40 === 0 || done === total) {
        if (source) source.postMessage({ type: 'CACHE_PROGRESS', done: done, total: total });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  if (source) source.postMessage({ type: 'CACHE_DONE', all: true });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await cacheCore();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'CACHE_CORE') {
    event.waitUntil((async () => {
      await cacheCore();
      if (event.source) event.source.postMessage({ type: 'CACHE_DONE' });
    })());
  } else if (data.type === 'CACHE_ALL') {
    event.waitUntil(cacheAllImages(event.source));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(INDEX, fresh.clone());
        return fresh;
      } catch (e) {
        return (await caches.match(INDEX)) || Response.error();
      }
    })());
    return;
  }

  if (req.destination === 'image') {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(req);
    const network = fetch(req).then((fresh) => {
      if (fresh && fresh.ok) {
        caches.open(CACHE).then((cache) => cache.put(req, fresh.clone()));
      }
      return fresh;
    }).catch(() => hit);
    return hit || network;
  })());
});
