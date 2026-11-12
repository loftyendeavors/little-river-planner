/* Little River Farm Planner — plan sync (Cloudflare Worker).
 *
 * Keeps one copy of the plan off the grower's computers, in an R2 bucket of his own, so that a second
 * computer or a phone can open it and a lost laptop does not take the plan with it. It needs:
 *
 *   an R2 bucket bound to this Worker under the variable name   PLAN
 *   a secret holding the passphrase, under the name             SYNC_KEY
 *
 * What it answers (everything but the first two needs a token from /login):
 *
 *   GET    /                 says whether it is set up
 *   POST   /login            { key }  ->  { token, exp }           the passphrase is checked here and nowhere else
 *   GET    /state            what the bucket holds: the plan's stamp, the photo files' stamps
 *   GET    /plan             the plan
 *   PUT    /plan             store the plan, only if the bucket still holds what the sender last saw
 *   GET    /file/<name>      the farm photo (map) or the small variety photos (thumbs)
 *   PUT    /file/<name>
 *   GET    /snaps            the snapshots kept here
 *   GET    /snap/<id>   PUT /snap/<id>   DELETE /snap/<id>
 *
 * Three rules:
 *   1. A write never lands on a plan the sender has not seen. Every PUT /plan names the stamp (etag) of the plan
 *      it replaces; if the bucket holds a different one, nothing is written and the sender is told what is there.
 *   2. Nothing is lost by a write. The plan as it stood at the end of each earlier day is kept (30 days), and a
 *      plan replaced on purpose over a different one is kept as a snapshot first.
 *   3. The passphrase is the only thing between the internet and the plan, so guesses are counted. Five tries in
 *      fifteen minutes, then /login is shut for fifteen minutes, then thirty, doubling to a day. The count is
 *      taken before the answer is given, one request at a time, so a burst of guesses gets no more tries than
 *      a slow one. A device that is already signed in is not affected: it carries a token, not the passphrase.
 *
 * Browsers are answered only from the planner's own address. The plan is never logged.
 */
const PLANNERS = ['https://loftyendeavors.github.io'];
const LIMITS = { plan: 8 * 1024 * 1024, file: 16 * 1024 * 1024, meta: 1800, days: 30, autos: 20, snaps: 300 };
const GUARD = { key: 'guard', tries: 5, window: 15 * 60, lock: 15 * 60, longest: 24 * 3600, forget: 24 * 3600 };
const TOKEN = { life: 180 * 24 * 3600, renew: 7 * 24 * 3600 };
const FILES = { map: true, thumbs: true };
const VERSION = 1;

const isLocal = origin => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const allowedOrigin = origin => PLANNERS.includes(origin) || isLocal(origin);
const cors = origin => ({
  'access-control-allow-origin': origin && allowedOrigin(origin) ? origin : PLANNERS[0],
  'access-control-allow-headers': 'authorization, content-type, x-lrf-base, x-lrf-meta, x-lrf-replace, x-lrf-type',
  'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'access-control-expose-headers': 'x-lrf-etag, x-lrf-meta, x-lrf-token, x-lrf-type, retry-after',
  'access-control-max-age': '86400',
  'cache-control': 'no-store',
  vary: 'origin'
});
const json = (status, body, origin, extra) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin), ...(extra || {}) } });

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async text => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
/** Two strings compared by their digests, so the time taken says nothing about where they differ. */
async function same(a, b) {
  const [x, y] = await Promise.all([sha('a\n' + a), sha('a\n' + b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', await sha('lrf-plan-sync token v1\n' + env.SYNC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
const newToken = async (env, now) => { const exp = now + TOKEN.life; return { token: `v1.${exp}.${await sign(env, `v1.${exp}`)}`, exp }; };
/** @returns seconds left on a good token, or 0. A token is made from the passphrase: change the passphrase and every token stops working. */
async function tokenLeft(env, header, now) {
  const m = /^Bearer (v1)\.(\d{9,12})\.([A-Za-z0-9_-]{20,90})$/.exec(String(header || ''));
  if (!m || +m[2] <= now) return 0;
  return (await same(m[3], await sign(env, `v1.${m[2]}`))) ? +m[2] - now : 0;
}

// ── the count of wrong passphrases ──
// One small record in the bucket. Each try takes its turn by rewriting the record on condition that nobody else
// has rewritten it in between; a try that cannot take its turn is answered "locked", never "wrong".
const freshGuard = () => ({ n: 0, first: 0, until: 0, level: 0 });
/**
 * Store something only if what is there is still `etag`; with no etag, only if nothing is there. @returns the stored object, or null.
 * "Only if nothing is there" is asked for with the standard header. Should a bucket refuse that form, the write goes ahead
 * without it: that can only matter in the instant a name is first used, and never once the object exists.
 */
async function putIf(bucket, key, value, etag, options) {
  if (etag) return bucket.put(key, value, { ...options, onlyIf: { etagMatches: etag } });
  try { return await bucket.put(key, value, { ...options, onlyIf: new Headers({ 'if-none-match': '*' }) }); }
  catch (_) { return bucket.put(key, value, options); }
}
async function readGuard(bucket) {
  const obj = await bucket.get(GUARD.key);
  if (!obj) return { state: freshGuard(), etag: null };
  let state = null;
  try { state = JSON.parse(await obj.text()); } catch (_) { state = null; }
  const ok = state && [state.n, state.first, state.until, state.level].every(v => Number.isFinite(v) && v >= 0);
  return { state: ok ? state : freshGuard(), etag: obj.etag };
}
/** Take one try. @returns { go: true, left } or { go: false, until }. */
async function claim(bucket, now) {
  for (let turn = 0; turn < 8; turn++) {
    const { state, etag } = await readGuard(bucket);
    if (now < state.until) return { go: false, until: state.until };
    const next = { ...state };
    if (next.level && now - next.until > GUARD.forget) next.level = 0;
    if (now - next.first > GUARD.window) { next.n = 0; next.first = now; }
    next.n += 1;
    const over = next.n > GUARD.tries;
    if (over) { next.until = now + Math.min(GUARD.lock * 2 ** next.level, GUARD.longest); next.level += 1; next.n = 0; next.first = 0; }
    const put = await putIf(bucket, GUARD.key, JSON.stringify(next), etag, { httpMetadata: { contentType: 'application/json' } });
    if (!put) continue;   // someone else took a turn first: look again
    return over ? { go: false, until: next.until } : { go: true, left: GUARD.tries - next.n };
  }
  return { go: false, until: now + 30 };
}

// ── what is kept with each stored thing: who saved it, when, how big a plan ──
function readMeta(request) {
  const raw = request.headers.get('x-lrf-meta') || '';
  if (!raw) return {};
  if (raw.length > LIMITS.meta * 3) return null;
  let meta;
  try { meta = JSON.parse(decodeURIComponent(raw)); } catch (_) { return null; }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const out = {};
  for (const key of ['savedAt', 'device', 'label', 'name', 'enc', 'why']) if (typeof meta[key] === 'string') out[key] = meta[key].slice(0, 120);
  for (const key of ['plantings', 'waiting', 'year', 'bytes']) if (Number.isFinite(meta[key])) out[key] = meta[key];
  if (meta.auto === true) out.auto = true;
  return JSON.stringify(out).length > LIMITS.meta ? null : out;
}
const metaOf = obj => { try { return JSON.parse((obj && obj.customMetadata && obj.customMetadata.m) || '{}'); } catch (_) { return {}; } };
const stamp = obj => (obj ? { etag: obj.etag, size: obj.size, uploaded: obj.uploaded instanceof Date ? obj.uploaded.toISOString() : null, meta: metaOf(obj) } : null);
const dayOf = text => (/^\d{4}-\d{2}-\d{2}/.exec(String(text || '')) || [null])[0];
async function body(request, limit) {
  if (+(request.headers.get('content-length') || 0) > limit) return null;
  const bytes = await request.arrayBuffer();
  return bytes.byteLength > limit || !bytes.byteLength ? null : bytes;
}
async function copy(bucket, from, to, meta) {
  const obj = await bucket.get(from);
  if (!obj) return false;
  await bucket.put(to, await obj.arrayBuffer(), { customMetadata: { m: JSON.stringify(meta || metaOf(obj)) }, httpMetadata: { contentType: 'application/octet-stream' } });
  return true;
}
async function listAll(bucket, prefix) {
  const out = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const got = await bucket.list({ prefix, cursor, include: ['customMetadata'] });
    out.push(...got.objects);
    if (!got.truncated) break;
    cursor = got.cursor;
  }
  return out;
}
/** Keep the newest `keep` of a set of stored things; the rest go. */
async function prune(bucket, objects, keep) {
  const old = objects.slice().sort((a, b) => (a.key < b.key ? 1 : -1)).slice(keep).map(o => o.key);
  if (old.length) await bucket.delete(old.slice(0, 40));
}

async function putPlan(request, env, origin, now) {
  const base = request.headers.get('x-lrf-base') || '', replace = request.headers.get('x-lrf-replace') === '1', meta = readMeta(request);
  if (!base) return json(400, { error: 'Say which plan this one replaces (x-lrf-base).' }, origin);
  if (!meta || !dayOf(meta.savedAt)) return json(400, { error: 'The note sent with the plan could not be read.' }, origin);
  const bytes = await body(request, LIMITS.plan);
  if (!bytes) return json(413, { error: 'The plan is empty or larger than this service stores.' }, origin);
  const bucket = env.PLAN, there = await bucket.head('plan');
  if ((base === 'none') !== !there || (there && there.etag !== base)) return json(412, { error: 'changed', plan: stamp(there) }, origin);
  if (there) {
    const was = metaOf(there), wasDay = dayOf(was.savedAt), stampNow = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
    // a plan replaced on purpose over a different one is kept whole, whatever the day
    if (replace) { await copy(bucket, 'plan', `snap/auto-${stampNow}`, { ...was, name: 'The plan in the cloud before it was replaced', auto: true, at: new Date(now * 1000).toISOString() }); await prune(bucket, (await listAll(bucket, 'snap/auto-')), LIMITS.autos); }
    // the first save of a day: the plan as it was left on its last day goes into the daily copies
    if (wasDay && wasDay !== dayOf(meta.savedAt) && !(await bucket.head(`day/${wasDay}`))) { await copy(bucket, 'plan', `day/${wasDay}`, was); await prune(bucket, await listAll(bucket, 'day/'), LIMITS.days); }
  }
  const put = await putIf(bucket, 'plan', bytes, there ? there.etag : null, { customMetadata: { m: JSON.stringify({ ...meta, at: new Date(now * 1000).toISOString() }) }, httpMetadata: { contentType: 'application/octet-stream' } });
  if (!put) return json(412, { error: 'changed', plan: stamp(await bucket.head('plan')) }, origin);
  return json(200, { ok: true, plan: stamp(put) }, origin);
}
const send = (obj, origin, extra) => new Response(obj.body, { status: 200, headers: { 'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream', 'x-lrf-etag': obj.etag, 'x-lrf-meta': encodeURIComponent(JSON.stringify(metaOf(obj))), ...cors(origin), ...(extra || {}) } });

async function route(request, env, origin, url, now) {
  const bucket = env.PLAN, path = url.pathname.replace(/\/+$/, '') || '/', method = request.method;
  if (path === '/state' && method === 'GET') {
    const [plan, map, thumbs] = await Promise.all([bucket.head('plan'), bucket.head('file/map'), bucket.head('file/thumbs')]);
    return json(200, { v: VERSION, plan: stamp(plan), files: { map: map ? { etag: map.etag, size: map.size } : null, thumbs: thumbs ? { etag: thumbs.etag, size: thumbs.size } : null }, now: new Date(now * 1000).toISOString() }, origin);
  }
  if (path === '/plan' && method === 'GET') { const obj = await bucket.get('plan'); return obj ? send(obj, origin) : json(404, { error: 'No plan is stored here yet.' }, origin); }
  if (path === '/plan' && method === 'PUT') return putPlan(request, env, origin, now);
  let m = /^\/file\/([a-z]+)$/.exec(path);
  if (m && FILES[m[1]]) {
    if (method === 'GET') { const obj = await bucket.get('file/' + m[1]); return obj ? send(obj, origin, { 'x-lrf-type': (obj.customMetadata && obj.customMetadata.type) || '' }) : json(404, { error: 'Not stored here.' }, origin); }
    if (method === 'PUT') {
      const bytes = await body(request, LIMITS.file), type = String(request.headers.get('x-lrf-type') || '').slice(0, 60);
      if (!bytes) return json(413, { error: 'The file is empty or larger than this service stores.' }, origin);
      const put = await bucket.put('file/' + m[1], bytes, { customMetadata: { type }, httpMetadata: { contentType: 'application/octet-stream' } });
      return json(200, { ok: true, etag: put.etag }, origin);
    }
  }
  if (path === '/snaps' && method === 'GET') {
    const [snaps, days] = await Promise.all([listAll(bucket, 'snap/'), listAll(bucket, 'day/')]);
    const row = (o, kind) => ({ id: o.key.slice(o.key.indexOf('/') + 1), kind, size: o.size, uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : null, meta: metaOf(o) });
    return json(200, { snaps: [...snaps.map(o => row(o, 'snap')), ...days.map(o => row(o, 'day'))] }, origin);
  }
  m = /^\/(snap|day)\/([A-Za-z0-9-]{4,64})$/.exec(path);
  if (m) {
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') { const obj = await bucket.get(key); return obj ? send(obj, origin) : json(404, { error: 'That snapshot is not stored here.' }, origin); }
    if (method === 'DELETE') { await bucket.delete(key); return json(200, { ok: true }, origin); }
    if (method === 'PUT' && m[1] === 'snap' && !m[2].startsWith('auto-')) {
      const meta = readMeta(request), bytes = await body(request, LIMITS.plan);
      if (!meta || !meta.name) return json(400, { error: 'A snapshot needs a name.' }, origin);
      if (!bytes) return json(413, { error: 'The snapshot is empty or larger than this service stores.' }, origin);
      if (!(await bucket.head(key)) && (await listAll(bucket, 'snap/')).length >= LIMITS.snaps) return json(409, { error: `This service keeps ${LIMITS.snaps} snapshots. Delete some first.` }, origin);
      await bucket.put(key, bytes, { customMetadata: { m: JSON.stringify({ ...meta, at: new Date(now * 1000).toISOString() }) }, httpMetadata: { contentType: 'application/octet-stream' } });
      return json(200, { ok: true }, origin);
    }
  }
  return json(404, { error: 'Nothing is served at that address.' }, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '', url = new URL(request.url), now = Math.floor(Date.now() / 1000);
    const ready = !!(env && env.PLAN && typeof env.PLAN.get === 'function'), keyed = !!(env && typeof env.SYNC_KEY === 'string' && env.SYNC_KEY.length);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
      if (url.pathname === '/' && request.method === 'GET') return new Response(`Little River plan sync is running (version ${VERSION}).\nBucket bound as PLAN: ${ready ? 'yes' : 'NO'}\nPassphrase set as SYNC_KEY: ${keyed ? 'yes' : 'NO'}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', ...cors(origin) } });
      if (!allowedOrigin(origin)) return json(403, { error: 'This service answers the planner only.' }, origin);
      if (!ready || !keyed) return json(503, { error: !ready ? 'No bucket is bound to this Worker under the name PLAN.' : 'No passphrase is set on this Worker (the secret SYNC_KEY).' }, origin);
      if (url.pathname === '/login') {
        if (request.method !== 'POST') return json(405, { error: 'Use POST.' }, origin);
        let given = null;
        try { const sent = await request.json(); given = sent && typeof sent.key === 'string' ? sent.key : null; } catch (_) { given = null; }
        if (given == null || given.length > 400) return json(400, { error: 'Send the passphrase.' }, origin);
        const turn = await claim(env.PLAN, now);
        if (!turn.go) return json(429, { error: 'locked', until: new Date(turn.until * 1000).toISOString(), wait: Math.max(1, turn.until - now) }, origin, { 'retry-after': String(Math.max(1, turn.until - now)) });
        if (!(await same(given, env.SYNC_KEY))) return json(401, { error: 'wrong', left: turn.left }, origin);
        await env.PLAN.put(GUARD.key, JSON.stringify(freshGuard()), { httpMetadata: { contentType: 'application/json' } });
        return json(200, await newToken(env, now), origin);
      }
      const left = await tokenLeft(env, request.headers.get('authorization'), now);
      if (!left) return json(401, { error: 'signin' }, origin);
      const response = await route(request, env, origin, url, now);
      // a device in regular use never has to type the passphrase again: its token is renewed as it goes
      if (response.ok && left < TOKEN.life - TOKEN.renew) response.headers.set('x-lrf-token', (await newToken(env, now)).token);
      return response;
    } catch (error) {
      return json(500, { error: 'The sync service failed: ' + String((error && error.message) || error).slice(0, 200) }, origin);
    }
  }
};
