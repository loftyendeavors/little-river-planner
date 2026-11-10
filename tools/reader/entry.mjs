/* Little River Farm Planner — the variety page reader, for the browser.
 *
 * variety-link.mjs beside this file is v7's reader, unchanged. It was written to run on v7's own
 * server, where it fetched supplier pages itself. A web page may not do that, so here it is handed
 * a fetcher that asks the grower's fetch service (worker/lrf-variety-fetch.js) for the page instead.
 * Reading pasted page text or HTML needs no service and no connection.
 *
 * tools/build_reader.cjs bundles this file and its parser into js/reader.js.
 */
import { parseProductHTML, readProductLink, readPastedProduct, fetchPublic, canonical, publicURL, LinkError, LINK_LIMITS } from './variety-link.mjs';

/** The supplier sites the fetch service is set up with. More can be added on the service (LRF_SITES). */
const SITES = ['johnnyseeds.com', 'berbeeus.com', 'harrisseeds.com', 'fedcoseeds.com', 'tradewindsfruit.com', 'pepperjoe.com', 'awhaley.com',
  'paramountseeds.com', 'highmowingseeds.com', 'starkbros.com', 'trueleafmarket.com', 'territorialseed.com', 'osborneseed.com', 'ruppseeds.com', 'sandiaseed.com'];
const onList = host => { host = String(host || '').toLowerCase(); return SITES.some(site => host === site || host.endsWith('.' + site)); };

/** The service's address as a URL ending in "/", or null. https only, except a local copy for testing. */
function serviceBase(value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch (_) { return null; }
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  u.search = ''; u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}
const SERVICE_WORDS = {
  401: 'The fetch service refused the key. Check the key in Settings.',
  503: 'The fetch service has no key set yet. Add the secret LRF_KEY to the Worker.'
};
/** One request to the service. Resolves to the Response; throws LinkError for anything the service itself refuses. */
async function ask(service, target, { image = false, signal, fetchImpl } = {}) {
  const base = serviceBase(service && service.base), key = String((service && service.key) || '').trim();
  if (!base) throw new LinkError('Set the fetch service address in Settings, or paste the page instead.', 400);
  if (!key) throw new LinkError('Set the fetch service key in Settings, or paste the page instead.', 400);
  const address = new URL('fetch', base);
  address.searchParams.set('url', target);
  if (image) address.searchParams.set('kind', 'image');
  let response;
  try { response = await (fetchImpl || globalThis.fetch.bind(globalThis))(address.href, { method: 'GET', headers: { 'x-lrf-key': key }, credentials: 'omit', cache: 'no-store', signal }); }
  catch (error) {
    if (signal && signal.aborted) throw error;
    throw new LinkError('The fetch service did not answer. Check its address in Settings and that you are online, or paste the page instead.', 502);
  }
  // A page from a supplier, whatever its status, carries the address it was finally read from. Anything else is the service speaking.
  if (response.headers.get('x-lrf-final-url') || response.ok) return response;
  let said = '';
  try { said = String((await response.json()).error || ''); } catch (_) { /* not the service's own wording */ }
  throw new LinkError(SERVICE_WORDS[response.status] || said || `The fetch service answered with an error (HTTP ${response.status}).`, response.status === 404 ? 404 : 422);
}
/**
 * A stand-in for fetch that v7's reader can use. The service follows redirects itself and reports where it ended up;
 * that is passed on as one redirect so the reader records the page's real address.
 */
function viaService(service, fetchImpl) {
  const held = new Map();
  return async function fetcher(href, init = {}) {
    if (held.has(href)) { const kept = held.get(href); held.delete(href); return kept; }
    const image = /^image\//.test(String((init.headers && init.headers.accept) || ''));
    const response = await ask(service, href, { image, signal: init.signal, fetchImpl });
    let final = '';
    try { final = publicURL(response.headers.get('x-lrf-final-url') || href).href; } catch (_) { final = ''; }
    if (!final || final === href) return response;
    held.set(final, response);
    return new Response(null, { status: 302, headers: { location: final } });
  };
}
/**
 * The supplier's own sentence saying where its days to maturity are counted from, and what it settles.
 *
 * v7's reader decides the starting point from every "Days to maturity" value on the page together. Johnny's prints a
 * general note under that label on every product ("...from seeding date... If a transplanted crop: ...from transplant
 * date"), which names both, so the reader reports "unspecified" unless the page's own sentence is exactly "From
 * transplanting." This reads the page's own sentence instead and leaves the general note out.
 *   { basis: 'seed' | 'transplant' | 'unspecified', statement, source, conditional }
 */
const GENERAL_NOTE = /average number of days from seeding date to harvest/i;
const FLOWERS_AND_HERBS = /days to maturity for all flowers and herbs is calculated from seeding date/i;
const FROM_SEED = /\bfrom\s+(?:the\s+)?(?:date\s+of\s+)?(?:direct[- ])?(?:seed(?:ing)?|sowing)\b|\bafter\s+(?:sowing|seeding)\b/i;
const FROM_TRANSPLANT = /\bfrom\s+(?:the\s+)?(?:date\s+of\s+)?(?:[\w/-]+\s+){0,4}?transplant(?:s|ing)?\b|\bafter\s+transplanting\b/i;
function maturityStatement(data) {
  const none = { basis: 'unspecified', statement: '', source: '', conditional: false };
  if (!data) return none;
  const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
  const candidates = [];
  // 1. the growing-information heading, as text: "DAYS TO MATURITY: From date of direct seeding. TRANSPLANTING: ..."
  for (const m of String(data.sourceText || '').matchAll(/\bDAYS TO MATURITY:?[ \t]*\n?([^\n]+)/g)) candidates.push(m[1]);
  // 2. the same label among the page's label-and-value pairs, leaving out bare day counts and the general note
  for (const pair of data.specifications || []) if (/^days? to maturity:?$/i.test(tidy(pair.label)) && /[a-z]{4}/i.test(pair.value) && !GENERAL_NOTE.test(pair.value)) candidates.push(pair.value);
  // 3. a plain sentence such as "55 days from transplant"
  for (const m of String(data.sourceText || '').matchAll(/\b\d{2,3}(?:\s*[-–]\s*\d{2,3})?\s+days\s+(?:from|after)\s+[^.\n]{3,60}/gi)) if (!GENERAL_NOTE.test(m[0])) candidates.push(m[0]);
  const read = raw => {
    // stop at the next heading in capitals ("TRANSPLANTING:", "PELLETED SEED:")
    const statement = tidy(tidy(raw).split(/\s+(?=[A-Z][A-Z .,/&'()-]{3,40}:)/)[0]).slice(0, 320);
    if (!statement || GENERAL_NOTE.test(statement)) return null;
    const clauses = statement.split(/[.;]\s+/).map(tidy).filter(Boolean);
    const sides = clauses.map(c => ({ seed: FROM_SEED.test(c), transplant: FROM_TRANSPLANT.test(c), adjusts: /\b(?:subtract|add|deduct|allow)\b/i.test(c) }));
    const first = sides[0];
    if (!first || (!first.seed && !first.transplant)) return null;
    // "Head Lettuce: from transplant; Baby Leaf: from direct seeding" gives a rule per use, not one answer
    const alternative = sides.slice(1).some(s => !s.adjusts && (s.seed || s.transplant) && (s.seed !== first.seed || s.transplant !== first.transplant));
    if ((first.seed && first.transplant) || alternative) return { basis: 'unspecified', statement, source: 'Supplier page', conditional: true };
    return { basis: first.seed ? 'seed' : 'transplant', statement, source: 'Supplier page', conditional: false };
  };
  const found = candidates.map(read).filter(Boolean);
  const settled = [...new Set(found.filter(f => !f.conditional).map(f => f.basis))];
  if (settled.length === 1 && !found.some(f => f.conditional)) return found.find(f => !f.conditional);
  if (found.length) return { basis: 'unspecified', statement: [...new Set(found.map(f => f.statement))].join(' / ').slice(0, 480), source: 'Supplier page', conditional: true };
  // 4. Johnny's general rule for its flower and herb pages, when the page says nothing of its own
  let host = '', where = '';
  try { const u = new URL(data.url); host = u.hostname; where = u.pathname; } catch (_) { /* no address */ }
  const rule = String(data.sourceText || '').match(FLOWERS_AND_HERBS);
  if (rule && /(^|\.)johnnyseeds\.com$/i.test(host) && /^\/(flowers|herbs)\//i.test(where)) return { basis: 'seed', statement: tidy(rule[0]) + '.', source: 'Supplier’s general rule', conditional: false };
  return none;
}

/**
 * Two corrections to what v7's reader returns, each recorded in `refined` so the review screen can say so.
 *  - Days: the reader treats every value under "Days to maturity" as a day count. A sentence there such as
 *    "From direct seeding; subtract about 14 days if transplanting" then reads as 14 days, conflicts with the
 *    real figure, and the reader gives up. Here a value that is nothing but a day count wins over sentences.
 *  - Starting point: taken from the page's own sentence when the reader could not settle it (see maturityStatement).
 */
function refine(data) {
  if (!data || !data.facts) return data;
  const refined = [], tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
  if (!data.facts.maturity) {
    const bare = [];
    for (const pair of data.specifications || []) {
      if (!/^(?:days? to maturity|maturation days|maturity days|maturity(?: \(days\))?|dtm):?$/i.test(tidy(pair.label))) continue;
      const m = tidy(pair.value).match(/^(\d{1,3})(?:\s*(?:[-–—]|to)\s*(\d{1,3}))?\s*days?$/i);
      if (m && +m[1] > 0 && +(m[2] || m[1]) >= +m[1]) bare.push({ min: +m[1], max: +(m[2] || m[1]), printed: tidy(pair.value), pair });
    }
    // Pasted page text has no pairs for a quick-facts box: the label is on one line and the figure a few lines below it.
    const lines = String(data.sourceText || '').split('\n').map(tidy);
    for (let i = 0; i < lines.length; i++) {
      if (!/^(?:days? to maturity|maturation days|maturity days):?$/i.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
        // skip the repeated label, the supplier's general note and its close mark; the next line is the figure
        if (lines[j].toLowerCase() === lines[i].toLowerCase() || GENERAL_NOTE.test(lines[j]) || /^[×x✕]?$/i.test(lines[j])) continue;
        const m = lines[j].length < 80 && lines[j].match(/^(\d{1,3})(?:\s*(?:[-–—]|to)\s*(\d{1,3}))?(?!\d)/);
        if (m && +m[1] > 0 && +(m[2] || m[1]) >= +m[1]) bare.push({ min: +m[1], max: +(m[2] || m[1]), printed: lines[j], pair: { label: lines[i], value: lines[j] } });
        break;
      }
    }
    const distinct = [...new Map(bare.map(b => [b.min + ':' + b.max, b])).values()];
    if (distinct.length === 1) {
      const { pair, ...range } = distinct[0];
      data.facts.maturity = range; data.evidence = { ...(data.evidence || {}), maturity: pair };
      data.warnings = (data.warnings || []).filter(w => !/^Conflicting maturity values|^Maturity was not reliably found/.test(w));
      refined.push('maturity');
    }
  }
  // "60 baby; 90 full size": the reader keeps the first figure. Say so, and offer the others.
  const printed = tidy(data.evidence && data.evidence.maturity && data.evidence.maturity.value);
  const stages = [...printed.matchAll(/(\d{1,3})(?:\s*(?:[-–—]|to)\s*(\d{1,3}))?\s*(?:days?\s*)?(?:for\s+|to\s+)?([a-z][a-z -]{2,24}?)(?=\s*(?:[;,/]|$))/gi)].map(m => ({ min: +m[1], max: +(m[2] || m[1]), stage: tidy(m[3]).toLowerCase() })).filter(x => x.min > 0 && x.max >= x.min && !/^days?$/.test(x.stage));
  if (data.facts.maturity && stages.length > 1 && printed.length < 90) {
    data.stages = stages;
    data.warnings = [...(data.warnings || []), `The supplier prints more than one figure (${printed}). The first is filled in; choose the one for the stage you harvest.`];
  }
  const start = maturityStatement(data);
  data.start = start;
  if ((data.facts.maturityBasis || 'unspecified') === 'unspecified' && start.basis !== 'unspecified') {
    data.facts.maturityBasis = start.basis; data.evidence = { ...(data.evidence || {}), maturityBasis: { label: start.source, value: start.statement } };
    data.warnings = (data.warnings || []).filter(w => !/^The maturity starting point is not unambiguous/.test(w));
    refined.push('maturityBasis');
  }
  data.refined = refined;
  return data;
}

const noLookup = async () => {};   // the service decides which sites it will fetch from; the browser cannot look addresses up

/** Read one supplier product page through the fetch service. */
function readLink(url, service, options = {}) {
  const u = publicURL(url);
  if (!onList(u.hostname) && !(service && service.anySite)) throw new LinkError(`${u.hostname.replace(/^www\./, '')} is not one of the supplier sites the fetch service reads. Paste the page instead, or add the site to the service (LRF_SITES).`, 400);
  return readProductLink(u.href, { fetcher: viaService(service, options.fetch), resolver: noLookup, now: options.now }).then(refine);
}
/** Read page text or page source pasted by the grower. No service, no connection. */
const readPasted = (value, url, name, now) => refine(readPastedProduct(value, url, name, now));
/** Fetch one product photo through the fetch service: { url, mime, bytes }. */
const readImage = (url, service, options = {}) => fetchPublic(url, { image: true, fetcher: viaService(service, options.fetch), resolver: noLookup });

/**
 * Fetch one product photo through the fetch service as a Blob, in whatever picture format the supplier sends.
 * The planner only makes a small thumbnail from it, so the browser's own decoder decides what is readable.
 */
async function fetchImage(url, service, options = {}) {
  const u = publicURL(url), response = await ask(service, u.href, { image: true, fetchImpl: options.fetch });
  if (!response.ok) throw new LinkError(`The photo could not be fetched (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!/^image\//.test(blob.type) || blob.size > LINK_LIMITS.image) throw new LinkError('That address did not return a picture the planner can use.');
  return blob;
}

/**
 * Find out whether the service is there, takes the key, and can reach a supplier.
 * Never throws: { ok, stage: 'address'|'reach'|'key'|'origin'|'supplier'|'done', message }.
 */
async function testService(service, options = {}) {
  const base = serviceBase(service && service.base), key = String((service && service.key) || '').trim(), fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
  if (!base) return { ok: false, stage: 'address', message: 'That is not a complete https address.' };
  if (!key) return { ok: false, stage: 'key', message: 'Enter the key that is set on the service.' };
  let response;
  // An empty request: the service checks the key before it looks at what was asked for.
  try { response = await fetchImpl(new URL('fetch?url=', base).href, { method: 'GET', headers: { 'x-lrf-key': key }, credentials: 'omit', cache: 'no-store' }); }
  catch (_) { return { ok: false, stage: 'reach', message: 'No answer from that address. Check the address and that you are online. A service that does not recognise this copy of the planner also looks like this.' }; }
  if (response.status === 401) return { ok: false, stage: 'key', message: 'The service is there, but it refused the key.' };
  if (response.status === 503) return { ok: false, stage: 'key', message: 'The service is there, but no key has been set on it yet (the secret LRF_KEY).' };
  if (response.status === 403) return { ok: false, stage: 'origin', message: 'The service is there, but it only answers the planner at its own web address, not this copy. Pasting a page still works here.' };
  if (response.status !== 400) return { ok: false, stage: 'reach', message: `Something answered at that address, but not the fetch service (HTTP ${response.status}).` };
  const probe = options.probe || 'https://www.johnnyseeds.com/';
  try {
    const page = await ask(service, probe, { fetchImpl });
    if (page.ok) return { ok: true, stage: 'done', message: `Connected. The key is accepted and ${new URL(probe).hostname.replace(/^www\./, '')} answered.` };
    return { ok: false, stage: 'supplier', message: `The key is accepted, but ${new URL(probe).hostname.replace(/^www\./, '')} turned the service away (HTTP ${page.status}). Links from that supplier may not read; pasting a page still works.` };
  } catch (error) {
    return { ok: false, stage: 'supplier', message: `The key is accepted, but a supplier page could not be fetched: ${error && error.message ? error.message : 'no answer'}` };
  }
}

export default { LinkError, LINK_LIMITS, SITES, onList, serviceBase, parseProductHTML, readPastedProduct, readProductLink, fetchPublic, canonical, publicURL, maturityStatement, refine, readLink, readPasted, readImage, fetchImage, testService, viaService };
