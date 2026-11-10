// The page reader and the fetch service together, in Node, with the supplier sites stubbed out:
// reader (js/reader.js) -> its fetcher -> the Worker's own code -> a stub supplier.
// usage: node reader_test.mjs [path to reader.js]
import { createRequire } from 'node:module';
import worker from '../worker/lrf-variety-fetch.js';
const Reader = createRequire(import.meta.url)(process.argv[2] || '../js/reader.js');
const KEY = 'k'.repeat(24), env = { LRF_KEY: KEY }, BASE = 'https://fetch.example.workers.dev/';
const results = [], check = (name, ok, detail) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };

const product = (name, body, extra = '') => `<html><head><title>${name}</title><meta property="og:site_name" content="Johnny's Selected Seeds">${extra}
<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, sku: '2345', image: 'https://www.johnnyseeds.com/img/fennel.jpg', offers: { price: '6.50', priceCurrency: 'USD' } })}</script></head>
<body><main><h1>${name}</h1><dl><dt>Days To Maturity</dt><dd>Average number of days from seeding date to harvest, within a specific crop group. If a transplanted crop: average number of days from transplant date. Days to maturity for all flowers and herbs is calculated from seeding date.</dd><dt>Days To Maturity</dt><dd>60 days</dd><dt>Latin Name</dt><dd>Foeniculum vulgare</dd></dl>${body}<p>Packet: 200 seeds</p></main></body></html>`;
const html = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const supplierCalls = [];
const suppliers = {
  'https://www.johnnyseeds.com/': () => html('<html><title>Johnny\'s</title></html>'),
  'https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html': () => html(product('Dragon (F1) Fennel Seed', '<p>DAYS TO MATURITY: From date of direct seeding. TRANSPLANTING: Sow 3-4 weeks before planting out.</p>')),
  'https://johnnyseeds.com/old-dragon': () => new Response(null, { status: 301, headers: { location: 'https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html' } }),
  'https://www.johnnyseeds.com/gone.html': () => new Response('<html><title>Page not found</title></html>', { status: 404, headers: { 'content-type': 'text/html' } }),
  'https://www.johnnyseeds.com/blocked.html': () => new Response('<html>Access denied</html>', { status: 403, headers: { 'content-type': 'text/html' } }),
  'https://www.johnnyseeds.com/img/fennel.jpg': () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }),
  'https://berbeeus.com/api/items?url=joella&fieldset=details': () => new Response(JSON.stringify({ items: [{ urlcomponent: 'joella', itemid: 'TU1234', storedisplayname2: 'Joella', custitem_height: '18"', ispricevisible: false, storedetaileddescription: '<p>A double late tulip.</p>' }] }), { headers: { 'content-type': 'application/json; charset=utf-8' } })
};
const realFetch = globalThis.fetch;
// The Worker's outgoing requests reach the stub suppliers...
globalThis.fetch = async url => { supplierCalls.push(String(url)); const make = suppliers[String(url).replace(/\?utm_[^#]*$/, '')]; if (!make) throw new Error('unreachable'); return make(); };
// ...and the planner's requests to the service reach the Worker's own handler.
let serviceCalls = 0, origin = 'https://loftyendeavors.github.io', serviceEnv = env;
const toService = async (url, init = {}) => { serviceCalls++; if (!String(url).startsWith(BASE)) throw new TypeError('Failed to fetch'); return worker.fetch(new Request(url, { method: init.method || 'GET', headers: { ...(init.headers || {}), origin } }), serviceEnv); };
const service = { base: BASE.slice(0, -1), key: KEY }, options = { fetch: toService, now: () => new Date('2026-11-10T12:00:00Z') };
const fails = async run => { try { await run(); return null; } catch (e) { return e; } };

let r = await Reader.readLink('https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html?utm_source=x', service, options);
check('a supplier link is read through the service', r.name === 'Dragon (F1) Fennel Seed' && r.sku === '2345' && r.facts.maturity.min === 60 && r.facts.latin === 'Foeniculum vulgare' && r.facts.seedsPerPacket === 200 && r.prices[0].price === 6.5 && r.retrievedAt === '2026-11-10T12:00:00.000Z', { name: r.name, facts: r.facts, prices: r.prices });
check('tracking tags are dropped from the saved address', r.url === 'https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html', r.url);
check('the page\'s own sentence settles where the days start, where v7\'s reader could not', r.facts.maturityBasis === 'seed' && r.refined.includes('maturityBasis') && r.start.statement === 'From date of direct seeding.' && r.evidence.maturityBasis.value === 'From date of direct seeding.', { basis: r.facts.maturityBasis, start: r.start });
let s = r.start;
r = await Reader.readLink('https://johnnyseeds.com/old-dragon', service, options);
check('a link that redirects is saved under the address it ended at', r.url === 'https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html' && r.facts.maturity.min === 60, r.url);
let photo = await Reader.readImage(r.images[0].url, service, options);
check('the product photo comes through the service', photo.mime === 'image/jpeg' && photo.bytes.length === jpeg.length, { mime: photo.mime, n: photo.bytes && photo.bytes.length });
r = await Reader.readLink('https://berbeeus.com/joella', service, options);
check('a Berbee link is read from its public product data', r.name === 'Joella' && r.sku === 'TU1234' && r.extraction === 'Berbee public product data' && r.prices.length === 0, { name: r.name, sku: r.sku, extraction: r.extraction });

let e = await fails(() => Reader.readLink('https://www.johnnyseeds.com/gone.html', service, options));
check('a missing page says so', e instanceof Reader.LinkError && e.status === 404 && /HTTP 404/.test(e.message), e && e.message);
e = await fails(() => Reader.readLink('https://www.johnnyseeds.com/blocked.html', service, options));
check('a supplier that blocks the service points to pasting', e instanceof Reader.LinkError && /blocked the reader/.test(e.message), e && e.message);
const before = serviceCalls;
e = await fails(() => Reader.readLink('https://www.burpee.com/tomato.html', service, options));
check('a site the service does not read is refused before anything is sent', e instanceof Reader.LinkError && /burpee\.com is not one of the supplier sites/.test(e.message) && serviceCalls === before, e && e.message);
e = await fails(() => Reader.readLink('https://www.johnnyseeds.com/', { ...service, key: 'x'.repeat(24) }, options));
check('a wrong key is reported as a key problem', e instanceof Reader.LinkError && /refused the key/.test(e.message), e && e.message);
e = await fails(() => Reader.readLink('https://www.johnnyseeds.com/', { base: '', key: KEY }, options));
check('no service address points to Settings or pasting', e instanceof Reader.LinkError && /Set the fetch service address/.test(e.message), e && e.message);
e = await fails(() => Reader.readLink('https://www.johnnyseeds.com/', { base: 'https://nothing.example/', key: KEY }, options));
check('a service that does not answer says so', e instanceof Reader.LinkError && /did not answer/.test(e.message), e && e.message);
e = await fails(() => Reader.readLink('http://www.johnnyseeds.com/x', service, options));
check('only https supplier links are accepted', e instanceof Reader.LinkError, e && e.message);
check('the key never travels in the address', supplierCalls.every(u => !u.includes(KEY)), null);

let t = await Reader.testService(service, options);
check('test connection: all good', t.ok && t.stage === 'done' && /johnnyseeds\.com answered/.test(t.message), t);
t = await Reader.testService({ ...service, key: 'wrong-key-wrong-key-wrong' }, options);
check('test connection: wrong key', !t.ok && t.stage === 'key' && /refused the key/.test(t.message), t);
serviceEnv = {}; t = await Reader.testService(service, options); serviceEnv = env;
check('test connection: no key on the service', !t.ok && t.stage === 'key' && /no key has been set/.test(t.message), t);
t = await Reader.testService({ base: 'https://nothing.example', key: KEY }, options);
check('test connection: nothing at the address', !t.ok && t.stage === 'reach', t);
t = await Reader.testService({ base: 'not an address', key: KEY }, options);
check('test connection: not an address', !t.ok && t.stage === 'address', t);
t = await Reader.testService({ base: 'http://fetch.example.workers.dev', key: KEY }, options);
check('test connection: plain http is refused', !t.ok && t.stage === 'address', t);
origin = 'https://someone-else.example'; t = await Reader.testService(service, options); origin = 'https://loftyendeavors.github.io';
check('test connection: a copy of the planner the service does not know', !t.ok && t.stage === 'origin', t);
t = await Reader.testService(service, { ...options, probe: 'https://www.johnnyseeds.com/blocked.html' });
check('test connection: key accepted but the supplier turns the service away', !t.ok && t.stage === 'supplier' && /HTTP 403/.test(t.message), t);

// pasted pages need no service and no connection
globalThis.fetch = async () => { throw new Error('no network'); };
r = Reader.readPasted('Product ID: 2345\nDays To Maturity\n60 days\nLatin Name\nFoeniculum vulgare\nDAYS TO MATURITY: From direct seeding; subtract about 14 days if transplanting.\nPacket: 200 seeds', 'https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html', 'Dragon');
s = Reader.maturityStatement(r);
check('pasted page text is read with no connection', r.name === 'Dragon' && r.facts.seedsPerPacket === 200 && s.basis === 'seed' && /subtract about 14 days/.test(s.statement), { facts: r.facts, s });
check('a "subtract 14 days" sentence is not mistaken for the days to maturity', r.facts.maturity && r.facts.maturity.min === 60 && r.refined.includes('maturity') && !r.warnings.some(w => /Conflicting maturity/.test(w)), { maturity: r.facts.maturity, warnings: r.warnings });
r = Reader.readPasted(product('Dragon (F1) Fennel Seed', '<h3>DAYS TO MATURITY:</h3><p>From transplanting.</p>'), 'https://www.johnnyseeds.com/vegetables/fennel/dragon-f1-fennel-seed-2345.html', 'Dragon');
check('pasted page source (HTML) is read as the page itself', r.sku === '2345' && r.facts.maturityBasis === 'transplant' && r.prices.length >= 1, { sku: r.sku, basis: r.facts.maturityBasis });
s = Reader.maturityStatement({ url: 'https://www.johnnyseeds.com/vegetables/lettuce/x.html', sourceText: 'DAYS TO MATURITY: Head Lettuce: from transplant; Baby Leaf: from direct seeding. AVG. DIRECT SEEDING RATE: 1,000 seeds' });
check('a sentence that gives a rule per use is shown, not decided', s.basis === 'unspecified' && s.conditional && s.statement === 'Head Lettuce: from transplant; Baby Leaf: from direct seeding.', s);
s = Reader.maturityStatement({ url: 'https://www.johnnyseeds.com/flowers/zinnias/x.html', sourceText: 'Days To Maturity\nAverage number of days from seeding date to harvest, within a specific crop group. If a transplanted crop: average number of days from transplant date. Days to maturity for all flowers and herbs is calculated from seeding date.\n75-90 days' });
check('Johnny\'s flower pages fall back on its printed rule for flowers and herbs', s.basis === 'seed' && s.source === 'Supplier’s general rule', s);
s = Reader.maturityStatement({ url: 'https://www.johnnyseeds.com/vegetables/peppers/x.html', sourceText: 'Days To Maturity\nAverage number of days from seeding date to harvest, within a specific crop group. If a transplanted crop: average number of days from transplant date.\n60 days' });
check('the general note alone decides nothing for a vegetable', s.basis === 'unspecified' && !s.statement, s);
globalThis.fetch = realFetch;
console.log(results.join('\n')); console.log(results.filter(x => x.startsWith('ok')).length + ' of ' + results.length + ' passed');
