#!/usr/bin/env node
/* The app folder's code, made from this repository: the scripts, the stylesheet and the page as they stand before
 * tools/build_site.cjs turns them into the site. The site is that tool's output; this is its inverse for the three things
 * it changes in index.html (the typefaces' address, the installable app's lines, js/pwa.js).
 *
 *   node tools/app_folder.cjs <this repository> <app folder to write>
 *
 * It writes js/ (without pwa.js), css/app.css and index.html. It writes no data: a plan, its photos and the seed lists
 * are not in this repository and are put into <app folder>/data by hand. Running tools/build_site.cjs on the result gives
 * this repository's own index.html back, line for line.
 */
const fs = require('fs'), path = require('path');
const [REPO, OUT] = process.argv.slice(2);
if (!REPO || !OUT) { console.error('usage: node tools/app_folder.cjs <repository> <app folder>'); process.exit(2); }
const FONTS = ['<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,500..800&family=Instrument+Sans:wdth,wght@85..100,400..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">'];
const SITE_ONLY = [/^<meta name="lrf-build" content="[^"]*">$/, /^<meta name="theme-color" content="[^"]*">$/, /^<link rel="manifest" href="manifest\.webmanifest">$/, /^<link rel="apple-touch-icon" href="[^"]*">$/, /^<link rel="stylesheet" href="css\/fonts\.css">$/, /^<script src="js\/pwa\.js"><\/script>$/];
const lines = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8').split('\n');
const kept = lines.filter(line => !SITE_ONLY.some(re => re.test(line)));
if (lines.length - kept.length !== SITE_ONLY.length) { console.error(`index.html: expected ${SITE_ONLY.length} lines that only the site has, found ${lines.length - kept.length}`); process.exit(1); }
const at = kept.findIndex(line => line.startsWith('<title>'));
if (at < 0) { console.error('index.html: no <title> line to put the typefaces after'); process.exit(1); }
kept.splice(at + 1, 0, ...FONTS);
fs.mkdirSync(path.join(OUT, 'js'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'css'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), kept.join('\n'));
const scripts = fs.readdirSync(path.join(REPO, 'js')).filter(f => f.endsWith('.js') && f !== 'pwa.js');
for (const f of scripts) fs.copyFileSync(path.join(REPO, 'js', f), path.join(OUT, 'js', f));
fs.copyFileSync(path.join(REPO, 'css/app.css'), path.join(OUT, 'css/app.css'));
console.log(JSON.stringify({ out: OUT, scripts: scripts.length, page: 'index.html', styles: 'css/app.css' }));
