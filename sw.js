/* BCHESS_BUILD_VERSION: 2026-11-07-supabase */
const CACHE_NAME = 'b-chess-shell-v10-supabase';
const APP_SHELL = [
  './', './index.html', './style.css', './ux.css', './ux.js', './config.js', './supabase-compat.js', './script.js', './features.js', './features.css', './books_data.js', './pwa.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './pieces/wb.png', './pieces/bp.png', './pieces/wk.png', './pieces/wq.png',
  './pieces/wp.png', './pieces/bn.png', './pieces/wn.png', './pieces/wr.png',
  './pieces/bb.png', './pieces/bk.png', './pieces/bq.png', './pieces/br.png'
];
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// Pages, scripts and styles: network first, so a new deployment shows up on the next load
// without closing/reopening the app. Images: cache first. Offline: cached copy.
function isShellCode(url, request) {
  return request.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const saveCopy = response => {
    if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  };
  if (isShellCode(url, request)) {
    event.respondWith(fetch(request, { cache: 'no-cache' }).then(saveCopy).catch(() =>
      caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then(cached => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(saveCopy).catch(() => caches.match('./index.html'))));
});

// Challenge notifications: tapping opens the app on the challenge (Accept / Decline act directly).
self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {};
  event.notification.close();
  if (data.type !== 'bchess-challenge' || !data.code) return;
  const action = event.action === 'accept' || event.action === 'decline' ? event.action : null;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const client = list.find(c => new URL(c.url).origin === self.location.origin);
    if (client) {
      client.postMessage({ type: 'bchess-challenge', code: data.code, action });
      return client.focus ? client.focus() : undefined;
    }
    const scope = self.registration.scope;
    return self.clients.openWindow(scope + '?challenge=' + encodeURIComponent(data.code) + (action ? '&challengeAction=' + action : ''));
  }));
});
