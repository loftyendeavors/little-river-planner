/* Little River Farm Planner — variety page fetcher (Cloudflare Worker).
 *
 * A web page may not read another website's pages, so the planner asks this small service to
 * fetch a seed supplier's product page for it. That is all it does:
 *
 *   GET /fetch?url=<supplier page>            returns that page
 *   GET /fetch?url=<picture>&kind=image       returns a product photo
 *   GET /                                     says whether it is set up
 *
 * It keeps nothing, and never sees the plan. To stop it being used as an open relay:
 *   - every request must carry the key set on this Worker as the secret LRF_KEY;
 *   - pages are fetched only from the supplier sites listed below (add more, comma separated,
 *     in a variable named LRF_SITES);
 *   - browsers are answered only from the planner's own address.
 */
const SITES = ['johnnyseeds.com', 'berbeeus.com', 'harrisseeds.com', 'fedcoseeds.com', 'tradewindsfruit.com', 'pepperjoe.com', 'awhaley.com',
  'paramountseeds.com', 'highmowingseeds.com', 'starkbros.com', 'trueleafmarket.com', 'territorialseed.com', 'osborneseed.com', 'ruppseeds.com', 'sandiaseed.com'];
const PLANNERS = ['https://loftyendeavors.github.io'];
const LIMITS = { page: 3 * 1024 * 1024, image: 8 * 1024 * 1024, redirects: 4, timeout: 20000 };

const isLocal = origin => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const allowedOrigin = origin => !origin || PLANNERS.includes(origin) || isLocal(origin);
const cors = origin => ({
  'access-control-allow-origin': origin && allowedOrigin(origin) ? origin : PLANNERS[0],
  'access-control-allow-headers': 'x-lrf-key, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-expose-headers': 'x-lrf-final-url, content-type',
  'access-control-max-age': '86400',
  vary: 'origin'
});
const say = (status, message, origin) => new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } });

function sameKey(given, key) {
  if (typeof given !== 'string' || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}
function siteList(env) {
  const extra = String((env && env.LRF_SITES) || '').split(',').map(s => s.trim().toLowerCase().replace(/^www\./, '')).filter(s => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s));
  return [...SITES, ...extra];
}
/** A public https address, or null. No bare IP addresses, no local names, no odd ports. */
function publicURL(value) {
  let u;
  try { u = new URL(value); } catch (_) { return null; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  return u;
}
const onList = (u, sites) => sites.some(site => u.hostname.toLowerCase() === site || u.hostname.toLowerCase().endsWith('.' + site));

async function relay(target, kind, sites) {
  const image = kind === 'image', limit = image ? LIMITS.image : LIMITS.page, stop = new AbortController(), timer = setTimeout(() => stop.abort(), LIMITS.timeout);
  try {
    let u = target, response = null;
    for (let hop = 0; hop <= LIMITS.redirects; hop++) {
      if (!image && !onList(u, sites)) return { status: 403, error: `${u.hostname} is not one of the supplier sites this service fetches from.` };
      response = await fetch(u.href, { redirect: 'manual', signal: stop.signal, headers: { accept: image ? 'image/avif,image/webp,image/*' : 'text/html,application/xhtml+xml,application/json;q=0.9', 'accept-language': 'en-US,en;q=0.8', 'user-agent': 'Mozilla/5.0 (compatible; LittleRiverFarmPlanner/1.0; variety lookup at a grower\'s request)' } });
      if (response.status < 300 || response.status >= 400) break;
      const next = publicURL(new URL(response.headers.get('location') || '', u).href);
      if (!next) return { status: 502, error: 'The supplier page redirected somewhere this service will not follow.' };
      u = next; response = null;
    }
    if (!response) return { status: 502, error: 'The supplier page redirected too many times.' };
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (image ? !type.startsWith('image/') : !/(text\/html|application\/xhtml|application\/json|text\/plain)/.test(type)) return { status: 415, error: `The address returned ${type || 'an unknown kind of file'}, not a ${image ? 'picture' : 'page'}.` };
    if (+response.headers.get('content-length') > limit) return { status: 413, error: 'That is larger than this service will fetch.' };
    const body = await response.arrayBuffer();
    if (body.byteLength > limit) return { status: 413, error: 'That is larger than this service will fetch.' };
    return { status: response.status, body, type, final: u.href };
  } catch (error) {
    return { status: 504, error: error && error.name === 'AbortError' ? 'The supplier site took too long to answer.' : 'The supplier site could not be reached.' };
  } finally { clearTimeout(timer); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('origin') || '', key = env && typeof env.LRF_KEY === 'string' ? env.LRF_KEY.trim() : '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return say(405, 'Only GET is supported.', origin);
    if (url.pathname === '/') return new Response(`Little River variety fetch is running. Key set: ${key.length >= 16 ? 'yes' : 'NO — add the secret LRF_KEY before it will fetch anything'}.\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (url.pathname !== '/fetch') return say(404, 'Nothing here.', origin);
    if (key.length < 16) return say(503, 'This service has no key yet. Add the secret LRF_KEY to the Worker.', origin);
    if (!allowedOrigin(origin)) return say(403, 'This service only answers the planner.', origin);
    if (!sameKey(request.headers.get('x-lrf-key') || '', key)) return say(401, 'The key is missing or wrong.', origin);
    const target = publicURL(url.searchParams.get('url') || '');
    if (!target) return say(400, 'Give a full https address of a supplier page.', origin);
    const result = await relay(target, url.searchParams.get('kind') === 'image' ? 'image' : 'page', siteList(env));
    if (result.error) return say(result.status, result.error, origin);
    return new Response(result.body, { status: result.status, headers: { 'content-type': result.type, 'x-lrf-final-url': result.final, 'cache-control': 'no-store', ...cors(origin) } });
  }
};
