'use strict';
// Builds the installable site for a static host (GitHub Pages): the app's code and typefaces only.
// No plan and no farm photo are included: the site is public, and each browser loads its own backup.
// usage: node build_site.cjs <app-dir> <fontsource-dir> <out-dir> <label>
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [appDir, fontDir, outDir, label = 'site'] = process.argv.slice(2);
const read = f => fs.readFileSync(path.join(appDir, f), 'utf8');
const put = (f, data) => { const to = path.join(outDir, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, data); return f; };
const files = [];

// The app folder must hold every script this site already serves. One that is missing means the app folder was put together before
// another piece of work added that script to the repo: building from it would take that work off the site without a word. Stop instead.
const serving = fs.existsSync(path.join(outDir, 'js')) ? fs.readdirSync(path.join(outDir, 'js')).filter(f => f.endsWith('.js') && f !== 'pwa.js') : [];
const lacking = serving.filter(f => !fs.existsSync(path.join(appDir, 'js', f)));
if (lacking.length && !process.argv.includes('--drop')) {
  throw new Error(`The app folder has no ${lacking.join(', ')}, which this site serves. It was probably put together before ${lacking.length === 1 ? 'that script was' : 'those scripts were'} added: `
    + 'copy js/ and css/app.css from this repo into the app folder, put your own changes back on top of them, and build again. (To take a script off the site on purpose, add --drop.)');
}
for (const dir of ['css', 'js', 'fonts']) fs.rmSync(path.join(outDir, dir), { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(appDir, 'js')).filter(f => f.endsWith('.js')).sort()) files.push(put(`js/${f}`, read(`js/${f}`)));
files.push(put('css/app.css', read('css/app.css')));

const FONTS = [
  ['Bricolage Grotesque', 'bricolage-grotesque', 'bricolage-grotesque-latin-standard-normal.woff2', '200 800', '75% 100%'],
  ['Instrument Sans', 'instrument-sans', 'instrument-sans-latin-standard-normal.woff2', '400 700', '75% 100%'],
  ['JetBrains Mono', 'jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2', '100 800', '']
];
let fontCss = '/* Typefaces served from this site so the planner looks the same with no connection. SIL Open Font License 1.1; see fonts/LICENSES.txt. */\n';
let licences = '';
for (const [family, pkg, file, weight, stretch] of FONTS) {
  files.push(put(`fonts/${file}`, fs.readFileSync(path.join(fontDir, pkg, 'files', file))));
  fontCss += `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${weight};${stretch ? `font-stretch:${stretch};` : ''}src:url(../fonts/${file}) format("woff2");}\n`;
  licences += `===== ${family} (from the npm package @fontsource-variable/${pkg}) =====\n${fs.readFileSync(path.join(fontDir, pkg, 'LICENSE'), 'utf8')}\n\n`;
}
put('fonts/LICENSES.txt', licences);
files.push(put('css/fonts.css', fontCss));

files.push(put('js/pwa.js', `/* Little River Farm Planner — keeps a copy of the app in the browser so it opens with no connection. */
(function () {
  'use strict';
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
  // A copy already in charge of this page means a later change of copy is an update: say so, and let the grower choose when to reload.
  let hadCopy = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadCopy) { hadCopy = true; return; }
    if (window.LRFUI) window.LRFUI.toast('A newer version of the planner is ready.', { label: 'Reload', run: () => location.reload() });
    const note = document.getElementById('buildNote');
    if (note && !note.dataset.newer) { note.dataset.newer = '1'; note.prepend('A newer version is ready: reload the page to use it. '); }
  });
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').then(reg => { setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000); }).catch(() => { /* the app still works online */ }); });
})();
`));

let html = read('index.html');
const before = html;
html = html.replace(/^<link rel="preconnect"[^\n]*\n/gm, '').replace(/^<link href="https:\/\/fonts\.googleapis\.com[^\n]*\n/m, '');
html = html.replace('<link rel="stylesheet" href="css/app.css">', `<meta name="lrf-build" content="${label}">\n<meta name="theme-color" content="#13241c">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/icon-192.png">\n<link rel="stylesheet" href="css/fonts.css">\n<link rel="stylesheet" href="css/app.css">`);
html = html.replace('<script src="js/main.js"></script>', '<script src="js/main.js"></script>\n<script src="js/pwa.js"></script>');
if (html === before || /fonts\.g(oogleapis|static)/.test(html) || !html.includes('js/pwa.js')) throw new Error('index.html was not prepared');
files.push(put('index.html', html));

files.push(put('manifest.webmanifest', JSON.stringify({
  name: 'Little River Farm Planner', short_name: 'Farm Planner', description: 'Crop planning on a map of the farm. The plan stays in this browser.',
  start_url: './', scope: './', display: 'standalone', background_color: '#e6ece8', theme_color: '#13241c',
  icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
}, null, 2) + '\n'));
for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) { if (!fs.existsSync(path.join(outDir, icon))) throw new Error(`missing ${icon}: make the icons first`); files.push(icon); }
put('.nojekyll', '');

// 'fresh-2' is the revision of the worker below: changing how it fetches must also give every browser a new copy.
const version = crypto.createHash('sha256').update('fresh-2\n' + files.map(f => f + ':' + crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, f))).digest('hex')).join('\n')).digest('hex').slice(0, 12);
put('sw.js', `/* Little River Farm Planner — offline copy of the app. Build ${version} (${label}). */
const CACHE = 'lrf-${version}';
const FILES = ${JSON.stringify(['./', ...files])};
// Each file is asked for under this build's own address (?v=…) and past every cache. The host's network keeps a file for ten minutes
// after a deploy: asked for by its plain address in that time, a new worker could store the old page beside new scripts and keep that
// mixture until the next build. It is stored under its plain address, so the page finds it as before.
const fresh = file => fetch(new Request(file + '?v=${version}', { cache: 'no-store' })).then(response => { if (!response.ok) throw new Error(file + ': ' + response.status); return response; });
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => Promise.all(FILES.map(file => fresh(file).then(response => cache.put(new Request(file), response))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lrf-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(hit => hit || fetch(request).catch(() => request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
`);
console.log(JSON.stringify({ out: outDir, files: files.length, version }));
