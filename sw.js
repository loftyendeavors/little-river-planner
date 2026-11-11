/* Little River Farm Planner — offline copy of the app. Build dc5c00396c03 (0.16). */
const CACHE = 'lrf-dc5c00396c03';
const FILES = ["./","js/aheadview.js","js/app.js","js/assume.js","js/bench.js","js/drag.js","js/engine.js","js/folder.js","js/forecast.js","js/guide.js","js/harvestview.js","js/library.js","js/main.js","js/map.js","js/panels.js","js/planio.js","js/rails.js","js/reader.js","js/season.js","js/seedlib.js","js/seeds.js","js/sowing.js","js/sowview.js","js/store.js","js/succession.js","js/thumbs.js","js/timeline.js","js/trays.js","js/traysview.js","js/ui.js","js/zip.js","css/app.css","fonts/bricolage-grotesque-latin-standard-normal.woff2","fonts/instrument-sans-latin-standard-normal.woff2","fonts/jetbrains-mono-latin-wght-normal.woff2","css/fonts.css","js/pwa.js","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png"];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lrf-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(hit => hit || fetch(request).catch(() => request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
