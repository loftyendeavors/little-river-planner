/* Little River Farm Planner — offline copy of the app. Build 8fde2c4df15f (0.36). */
const CACHE = 'lrf-8fde2c4df15f';
const FILES = ["./","js/ahead.js","js/app.js","js/assume.js","js/audit.js","js/backupui.js","js/bench.js","js/drag.js","js/engine.js","js/farmdates.js","js/folder.js","js/forecast.js","js/guide.js","js/harvestview.js","js/library.js","js/main.js","js/map.js","js/mapedit.js","js/mapgeo.js","js/nursery.js","js/panels.js","js/planio.js","js/rails.js","js/reader.js","js/season.js","js/seedlib.js","js/seeds.js","js/series.js","js/snapshots.js","js/sowing.js","js/sowview.js","js/store.js","js/succession.js","js/sync.js","js/thumbs.js","js/timeline.js","js/trays.js","js/traysview.js","js/ui.js","js/week.js","js/zip.js","css/app.css","fonts/bricolage-grotesque-latin-standard-normal.woff2","fonts/instrument-sans-latin-standard-normal.woff2","fonts/jetbrains-mono-latin-wght-normal.woff2","css/fonts.css","js/pwa.js","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png"];
// Each file is asked for under this build's own address (?v=…) and past every cache. The host's network keeps a file for ten minutes
// after a deploy: asked for by its plain address in that time, a new worker could store the old page beside new scripts and keep that
// mixture until the next build. It is stored under its plain address, so the page finds it as before.
const fresh = file => fetch(new Request(file + '?v=8fde2c4df15f', { cache: 'no-store' })).then(response => { if (!response.ok) throw new Error(file + ': ' + response.status); return response; });
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => Promise.all(FILES.map(file => fresh(file).then(response => cache.put(new Request(file), response))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lrf-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(hit => hit || fetch(request).catch(() => request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
