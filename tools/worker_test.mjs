// The fetch service, exercised in Node with the supplier sites stubbed out.
import worker from '../worker/lrf-variety-fetch.js';
const KEY = 'k'.repeat(24), env = { LRF_KEY: KEY, LRF_SITES: 'example-seeds.com' }, base = 'https://w.example/';
const results = [], check = (name, ok, detail) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };
const calls = [];
const pages = {
  'https://www.johnnyseeds.com/a': () => new Response('<html>Gatsbi 52 days</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  'https://johnnyseeds.com/moved': () => new Response(null, { status: 301, headers: { location: 'https://www.johnnyseeds.com/a' } }),
  'https://johnnyseeds.com/away': () => new Response(null, { status: 302, headers: { location: 'https://evil.example.org/x' } }),
  'https://johnnyseeds.com/loop': () => new Response(null, { status: 302, headers: { location: 'https://johnnyseeds.com/loop' } }),
  'https://johnnyseeds.com/pdf': () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
  'https://johnnyseeds.com/big': () => new Response(new Uint8Array(3 * 1024 * 1024 + 10), { headers: { 'content-type': 'text/html' } }),
  'https://cdn.shop.example.net/p.jpg': () => new Response(new Uint8Array(1200), { headers: { 'content-type': 'image/jpeg' } }),
  'https://example-seeds.com/x': () => new Response('<html>extra site</html>', { headers: { 'content-type': 'text/html' } })
};
globalThis.fetch = async (url, init) => { calls.push(String(url)); const make = pages[String(url)]; if (!make) throw new Error('unreachable'); return make(); };
const ask = (path, { key = KEY, origin = 'https://loftyendeavors.github.io', method = 'GET', e = env } = {}) => worker.fetch(new Request(base + path, { method, headers: { ...(key ? { 'x-lrf-key': key } : {}), ...(origin ? { origin } : {}) } }), e);
const q = u => 'fetch?url=' + encodeURIComponent(u);

let r = await ask(''); check('says it is running and that a key is set', r.status === 200 && /Key set: yes/.test(await r.text()));
r = await ask('', { e: {} }); check('says so when no key is set', /Key set: NO/.test(await r.text()));
r = await ask(q('https://www.johnnyseeds.com/a'), { e: {} }); check('fetches nothing until a key is set', r.status === 503);
r = await ask(q('https://www.johnnyseeds.com/a'), { key: '' }); check('refuses a request with no key', r.status === 401);
r = await ask(q('https://www.johnnyseeds.com/a'), { key: 'x'.repeat(24) }); check('refuses a wrong key', r.status === 401);
r = await ask(q('https://www.johnnyseeds.com/a'), { origin: 'https://someone-else.example' }); check('refuses another website', r.status === 403);
r = await ask(q('https://www.johnnyseeds.com/a')); const text = await r.text();
check('returns a supplier page to the planner', r.status === 200 && text.includes('Gatsbi') && r.headers.get('x-lrf-final-url') === 'https://www.johnnyseeds.com/a' && r.headers.get('access-control-allow-origin') === 'https://loftyendeavors.github.io', { status: r.status, text });
r = await ask(q('https://johnnyseeds.com/moved')); check('follows a redirect that stays on a supplier site', r.status === 200 && r.headers.get('x-lrf-final-url') === 'https://www.johnnyseeds.com/a');
r = await ask(q('https://johnnyseeds.com/away')); check('will not follow a redirect to another site', r.status === 403 && !calls.includes('https://evil.example.org/x'), r.status);
r = await ask(q('https://johnnyseeds.com/loop')); check('gives up on a redirect loop', r.status === 502);
r = await ask(q('https://evil.example.org/x')); check('refuses a site that is not a supplier', r.status === 403);
for (const bad of ['http://johnnyseeds.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://johnnyseeds.com:8443/a', 'https://user:pw@johnnyseeds.com/a', 'notaurl', 'https://johnnyseeds.com.evil.example.org/a']) { r = await ask(q(bad)); check('refuses ' + bad, r.status === 400 || r.status === 403, r.status); }
r = await ask(q('https://johnnyseeds.com/pdf')); check('refuses something that is not a page', r.status === 415);
r = await ask(q('https://johnnyseeds.com/big')); check('refuses a page over 3 MB', r.status === 413);
r = await ask(q('https://cdn.shop.example.net/p.jpg') + '&kind=image'); check('fetches a product photo from an image host', r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && (await r.arrayBuffer()).byteLength === 1200);
r = await ask(q('https://www.johnnyseeds.com/a') + '&kind=image'); check('a page is not accepted as a photo', r.status === 415);
r = await ask(q('https://example-seeds.com/x')); check('fetches from a site added in LRF_SITES', r.status === 200);
r = await ask(q('https://www.johnnyseeds.com/a'), { method: 'OPTIONS', key: '' }); check('answers the browser\'s preflight', r.status === 204 && /x-lrf-key/.test(r.headers.get('access-control-allow-headers')));
r = await ask(q('https://www.johnnyseeds.com/a'), { method: 'POST' }); check('refuses anything but GET', r.status === 405);
r = await ask(q('https://www.johnnyseeds.com/a'), { origin: 'http://127.0.0.1:8123' }); check('answers a local copy of the planner, with the key', r.status === 200);
console.log(results.join('\n')); console.log(results.filter(x => x.startsWith('ok')).length + ' of ' + results.length + ' passed');
