// ============================================================
// sw.js - KCode's Service Worker.
//
// Strategy: cache the app shell (HTML/CSS/JS/logo) on install so
// the editor's OWN code always works offline after the first
// visit. Everything else (Monaco/Codicons/JSZip/fonts from CDNs)
// is cached opportunistically the first time it's fetched, then
// served from cache on later offline loads - this is a nice side
// effect: even without manually downloading Monaco locally (see
// assets/vendor/monaco-editor/README.md), once it's loaded once
// while online, the Service Worker keeps a copy for next time.
//
// IMPORTANT: bump CACHE_NAME on every release so returning users
// actually get the new version instead of a stale cached one.
// ============================================================

const CACHE_NAME = 'kcode-cache-v0.9.1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/style-additions.css',
  './css/themes.css',
  './css/mobile.css',
  './js/app.js',
  './js/state.js',
  './js/db.js',
  './js/editor.js',
  './js/explorer.js',
  './js/search.js',
  './js/search-worker.js',
  './js/declaration-scanner.js',
  './js/intellisense.js',
  './js/icons.js',
  './js/themes.js',
  './js/fs-utils.js',
  './js/file-ops.js',
  './js/context-menu.js',
  './js/dialogs.js',
  './js/notifications.js',
  './js/file-watcher.js',
  './js/project-io.js',
  './js/quick-open.js',
  './assets/logo/logo.svg',
  './assets/logo/logo-192.png',
  './assets/logo/logo-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] Could not fully precache the app shell:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes/uploads

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // offline and not cached: nothing more we can do

      // Serve from cache immediately if we have it (fast + reliable
      // offline); otherwise wait on the network and cache the result
      // for next time.
      return cached || networkFetch;
    })
  );
});
