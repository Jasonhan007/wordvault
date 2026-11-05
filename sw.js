/* Word · 离线缓存
   缓存 App 外壳（HTML/CSS/JS/图标）；词库 600KB，改为首次使用时按需缓存。
   改动静态文件后把 CACHE 版本号 +1 即可让旧缓存失效。 */
const CACHE = 'Word-v11';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=11',
  './js/store.js?v=11',
  './js/app.js?v=11',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
