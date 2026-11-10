'use strict';
// Packs the planner into one self-contained .html: styles, scripts, typefaces, the farm's
// plan and its map photo. It opens from disk with no connection and keeps its plan in the browser.
// usage: node build_offline.cjs <app-dir> <fontsource-dir> <out.html> <label>
const fs = require('node:fs'), path = require('node:path');
const [appDir, fontDir, outFile, label = 'offline'] = process.argv.slice(2);
const read = f => fs.readFileSync(path.join(appDir, f), 'utf8');
const b64 = f => fs.readFileSync(f).toString('base64');
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const inScript = text => text.replace(/<\/(script)/gi, '<\\/$1').split(LS).join('\\u2028').split(PS).join('\\u2029');

let html = read('index.html');
const face = (family, file, weight, stretch) => `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${weight};${stretch ? `font-stretch:${stretch};` : ''}src:url(data:font/woff2;base64,${b64(path.join(fontDir, file))}) format("woff2");}`;
const fonts = [
  face('Bricolage Grotesque', 'bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2', '200 800', '75% 100%'),
  face('Instrument Sans', 'instrument-sans/files/instrument-sans-latin-standard-normal.woff2', '400 700', '75% 100%'),
  face('JetBrains Mono', 'jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', '100 800', '')
].join('\n');

const before = html;
html = html.replace(/^<link rel="preconnect"[^\n]*\n/gm, '').replace(/^<link href="https:\/\/fonts\.googleapis\.com[^\n]*\n/m, '');
html = html.replace('<link rel="stylesheet" href="css/app.css">', () => `<meta name="lrf-build" content="${label}">\n<style>\n${fonts}\n</style>\n<style>\n${read('css/app.css')}\n</style>`);

const info = JSON.parse(read('data/plan-info.json')), image = fs.readFileSync(path.join(appDir, info.mapImage.src));
const bundled = { info: { ...info, mapImage: { ...info.mapImage, src: `data:image/jpeg;base64,${image.toString('base64')}` } }, plan: JSON.parse(read('data/plan.json')) };
if (info.thumbs && fs.existsSync(path.join(appDir, info.thumbs))) bundled.thumbs = JSON.parse(read(info.thumbs));   // variety photos, small
if (info.inventory && fs.existsSync(path.join(appDir, info.inventory))) bundled.inventory = JSON.parse(read(info.inventory));   // seed lots
let scripts = 0;
html = html.replace(/<script src="(js\/[\w.-]+)"><\/script>/g, (_, src) => {
  const first = scripts++ === 0 ? `<script>window.LRF_BUNDLED = ${inScript(JSON.stringify(bundled))};</script>\n` : '';
  return `${first}<script>/* ${src} */\n${inScript(read(src))}\n</script>`;
});
if (html === before || scripts < 10 || /<script src=|<link [^>]*href="(css|https:)/.test(html)) throw new Error('the page was not fully inlined');
html = html.replace('<!DOCTYPE html>', () => `<!DOCTYPE html>\n<!-- Little River Farm Planner — ${label}. One file: open it in a browser, no connection needed. The plan is kept in that browser; use Backup to save a copy. -->`);
fs.writeFileSync(outFile, html);
console.log(JSON.stringify({ out: outFile, bytes: html.length, scripts, fonts: fonts.length, image: image.length }));
