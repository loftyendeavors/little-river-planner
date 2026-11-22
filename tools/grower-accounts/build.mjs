import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

const address = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!address || !key) throw Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the account project.');
const url = new URL(address);
const local = ['localhost', '127.0.0.1'].includes(url.hostname);
if (url.username || url.password || url.origin !== address || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw Error('Use the HTTPS project origin.');
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw Error('Use a public sb_publishable_ key.');
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], outfile: 'dist/app.js', bundle: true, minify: true, format: 'esm',
  define: { ACCOUNT_URL: JSON.stringify(address), ACCOUNT_KEY: JSON.stringify(key) } });
await copyFile('style.css', 'dist/style.css');
await copyFile('../../fonts/instrument-sans-latin-standard-normal.woff2', 'dist/instrument.woff2');
await copyFile('../../fonts/LICENSES.txt', 'dist/FONT-LICENSES.txt');
await writeFile('dist/index.html', (await readFile('index.html', 'utf8')).replace('PROJECT_ORIGIN', url.origin));
