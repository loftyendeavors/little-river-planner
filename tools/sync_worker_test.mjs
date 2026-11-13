// The plan sync service, exercised in Node against a stand-in bucket (tools/fake_r2.mjs).
import worker from '../worker/lrf-plan-sync.js';
import { fakeBucket } from './fake_r2.mjs';

const KEY = 'correct horse battery', SITE = 'https://loftyendeavors.github.io', base = 'https://sync.example/';
// The report is printed as the process ends, whatever happens on the way: a line that throws is one failed line, not a silent stop.
process.on('exit', () => { console.log(results.join('\n')); console.log(results.filter(x => x.startsWith('ok')).length + ' of ' + results.length + ' passed'); });
process.on('uncaughtException', error => { results.push('FAIL the test ran to its end ' + JSON.stringify(String(error && error.stack || error).slice(0, 300))); process.exitCode = 1; process.exit(); });
const results = [], check = (name, ok, detail) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };
let clock = Date.UTC(2026, 10, 12, 14, 0, 0);
Date.now = () => clock;
const later = seconds => { clock += seconds * 1000; };

const make = options => { const f = fakeBucket(options); return { ...f, env: { PLAN: f.bucket, SYNC_KEY: KEY } }; };
const metaHeader = meta => encodeURIComponent(JSON.stringify(meta));
function ask(w, path, { method = 'GET', token, origin = SITE, body, headers = {}, e } = {}) {
  const h = { ...(origin ? { origin } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers };
  return worker.fetch(new Request(base + path, { method, headers: h, body }), e || w.env);
}
const login = async (w, key = KEY) => { const r = await ask(w, 'login', { method: 'POST', body: JSON.stringify({ key }) }); return { status: r.status, ...(await r.json()) }; };
const putPlan = (w, token, text, baseEtag, meta = {}, extra = {}) => ask(w, 'plan', { method: 'PUT', token, body: text, headers: { 'x-lrf-base': baseEtag, 'x-lrf-meta': metaHeader({ savedAt: new Date(clock).toISOString(), device: 'd-one', plantings: 625, ...meta }), ...extra } });

// ── set-up and who is answered ──
let w = make();
let r = await ask(w, '', { origin: '' }); let text = await r.text();
check('says it is running, the bucket is bound and a passphrase is set', r.status === 200 && /PLAN: yes/.test(text) && /SYNC_KEY: yes/.test(text), text);
r = await ask(w, '', { origin: '', e: {} }); text = await r.text();
check('says so when neither is set', /PLAN: NO/.test(text) && /SYNC_KEY: NO/.test(text));
check('never shows the passphrase', !text.includes(KEY) && !(await (await ask(w, '', { origin: '' })).text()).includes(KEY));
r = await ask(w, 'state', { e: { SYNC_KEY: KEY } }); check('does nothing until a bucket is bound', r.status === 503);
r = await ask(w, 'state', { e: { PLAN: w.bucket } }); check('does nothing until a passphrase is set', r.status === 503);
r = await ask(w, 'state', { origin: 'https://someone-else.example' }); check('refuses another website', r.status === 403);
r = await ask(w, 'state', { origin: '' }); check('refuses a request that names no website', r.status === 403);
r = await ask(w, 'plan', { method: 'OPTIONS' }); check('answers the browser\'s preflight', r.status === 204 && /x-lrf-base/.test(r.headers.get('access-control-allow-headers')) && /PUT/.test(r.headers.get('access-control-allow-methods')) && r.headers.get('access-control-allow-origin') === SITE);
r = await ask(w, 'state'); check('refuses a request with no token', r.status === 401 && (await r.json()).error === 'signin');
r = await ask(w, 'state', { token: KEY }); check('the passphrase itself is not a token', r.status === 401);

// ── signing in ──
let me = await login(w);
check('the right passphrase gives a token', me.status === 200 && /^v1\.\d+\./.test(me.token) && me.exp > clock / 1000 + 170 * 86400, me);
check('the token does not contain the passphrase', !me.token.includes(KEY) && !me.token.includes(btoa(KEY)));
r = await ask(w, 'state', { token: me.token }); let state = await r.json();
check('a token opens the service; nothing is stored yet', r.status === 200 && state.plan === null && state.files.map === null, state);
r = await ask(w, 'state', { token: me.token.slice(0, -3) + 'abc' }); check('a token that has been altered is refused', r.status === 401);
r = await ask(w, 'state', { token: me.token.replace(/\.(\d+)\./, (m, e) => `.${+e + 86400}.`) }); check('a token with its date moved is refused', r.status === 401);
r = await ask(w, 'state', { token: me.token, e: { PLAN: w.bucket, SYNC_KEY: KEY + '!' } }); check('changing the passphrase ends every token', r.status === 401);
r = await ask(w, 'state', { token: me.token, origin: 'http://127.0.0.1:8123' }); check('a local copy of the planner is answered, with a token', r.status === 200);
r = await ask(w, 'login', { method: 'GET' }); check('signing in is by POST only', r.status === 405);
{ const f = make(); r = await ask(f, 'login', { method: 'POST', body: 'not json' }); check('a sign-in with no passphrase is refused, and is not counted as a try', r.status === 400 && !f.store.has('guard')); }

// ── the plan: stored only over the plan the sender last saw ──
r = await ask(w, 'plan', { token: me.token }); check('no plan yet', r.status === 404);
r = await putPlan(w, me.token, 'PLAN ONE', 'none'); let one = await r.json();
check('the first plan is stored', r.status === 200 && one.plan.etag && one.plan.meta.plantings === 625 && one.plan.meta.device === 'd-one', one);
r = await ask(w, 'plan', { token: me.token }); text = await r.text();
check('and comes back as sent, with its stamp and note', r.status === 200 && text === 'PLAN ONE' && r.headers.get('x-lrf-etag') === one.plan.etag && JSON.parse(decodeURIComponent(r.headers.get('x-lrf-meta'))).plantings === 625);
r = await putPlan(w, me.token, 'PLAN FROM A STRANGER', 'none'); let no = await r.json();
check('a "first" plan does not land on a plan already there', r.status === 412 && no.error === 'changed' && no.plan.etag === one.plan.etag && (await (await ask(w, 'plan', { token: me.token })).text()) === 'PLAN ONE', no);
r = await putPlan(w, me.token, 'PLAN TWO', one.plan.etag); let two = await r.json();
check('a plan that names the one it replaces is stored', r.status === 200 && two.plan.etag !== one.plan.etag);
r = await putPlan(w, me.token, 'PLAN FROM THE OTHER COMPUTER', one.plan.etag, { device: 'd-two' }); no = await r.json();
check('a second device cannot write over a plan it has not seen', r.status === 412 && no.plan.etag === two.plan.etag && no.plan.meta.device === 'd-one' && (await (await ask(w, 'plan', { token: me.token })).text()) === 'PLAN TWO', no);
r = await ask(w, 'plan', { method: 'PUT', token: me.token, body: 'X', headers: { 'x-lrf-meta': metaHeader({ savedAt: '2026-11-12T10:00:00Z' }) } }); check('a plan that does not say what it replaces is refused', r.status === 400);
r = await ask(w, 'plan', { method: 'PUT', token: me.token, body: 'X', headers: { 'x-lrf-base': two.plan.etag, 'x-lrf-meta': '%7Bnot json' } }); check('a plan with an unreadable note is refused', r.status === 400);
r = await ask(w, 'plan', { method: 'PUT', token: me.token, body: '', headers: { 'x-lrf-base': two.plan.etag, 'x-lrf-meta': metaHeader({ savedAt: '2026-11-12T10:00:00Z' }) } }); check('an empty plan is refused', r.status === 413 && (await (await ask(w, 'plan', { token: me.token })).text()) === 'PLAN TWO');
r = await ask(w, 'plan', { method: 'PUT', token: me.token, body: new Uint8Array(8 * 1024 * 1024 + 1), headers: { 'x-lrf-base': two.plan.etag, 'x-lrf-meta': metaHeader({ savedAt: '2026-11-12T10:00:00Z' }) } }); check('a plan over 8 MB is refused', r.status === 413);
r = await putPlan(w, null, 'PLAN FROM NOBODY', two.plan.etag); check('nothing is stored without a token', r.status === 401 && (await (await ask(w, 'plan', { token: me.token })).text()) === 'PLAN TWO');
{ // two writers at the same moment, both naming the same plan, both having looked before either writes: one lands, the other is told
  const head = w.bucket.head;
  w.bucket.head = async key => { const found = await head(key); await new Promise(resolve => setTimeout(resolve, 25)); return found; };
  const [a, b] = await Promise.all([putPlan(w, me.token, 'RACE A', two.plan.etag), putPlan(w, me.token, 'RACE B', two.plan.etag)]);
  w.bucket.head = head;
  const held = await (await ask(w, 'plan', { token: me.token })).text();
  check('of two writes at once over the same plan, exactly one lands', [a.status, b.status].sort().join() === '200,412' && held === (a.status === 200 ? 'RACE A' : 'RACE B'), [a.status, b.status, held]);
}
state = await (await ask(w, 'state', { token: me.token })).json();
const bin = new Uint8Array(70000).map((_, i) => (i * 31) % 256);
r = await putPlan(w, me.token, bin, state.plan.etag, { enc: 'gzip' }); const three = await r.json();
r = await ask(w, 'plan', { token: me.token }); const back = new Uint8Array(await r.arrayBuffer());
check('bytes come back exactly (a packed plan is not text)', back.length === bin.length && back.every((v, i) => v === bin[i]) && JSON.parse(decodeURIComponent(r.headers.get('x-lrf-meta'))).enc === 'gzip');

// ── nothing is lost by a write ──
check('no daily copy while the day has not changed', ![...w.store.keys()].some(k => k.startsWith('day/')));
later(86400);
r = await putPlan(w, me.token, 'NEXT DAY', three.plan.etag); let four = await r.json();
const dayCopy = () => (w.store.get('day/2026-11-12') || { bytes: new Uint8Array(0) }).bytes;
check('the first save of a new day keeps the plan as it was left the day before', r.status === 200 && w.store.has('day/2026-11-12') && dayCopy().length === bin.length && dayCopy().every((v, i) => v === bin[i]));
r = await putPlan(w, me.token, 'NEXT DAY, LATER', four.plan.etag); four = await r.json();
check('later saves that day leave the daily copy alone', dayCopy().length === bin.length && [...w.store.keys()].filter(k => k.startsWith('day/')).length === 1);
r = await putPlan(w, me.token, 'MINE, KEPT ON PURPOSE', four.plan.etag, { device: 'd-two' }, { 'x-lrf-replace': '1' }); let five = await r.json();
const autos = [...w.store.keys()].filter(k => k.startsWith('snap/auto-'));
check('a plan replaced on purpose is kept as a snapshot first', r.status === 200 && autos.length === 1 && w.store.has(autos[0]) && new TextDecoder().decode(w.store.get(autos[0]).bytes) === 'NEXT DAY, LATER' && JSON.parse(w.store.get(autos[0]).customMetadata.m).auto === true, autos.length);
r = await putPlan(w, me.token, 'FORCED BLIND', four.plan.etag, {}, { 'x-lrf-replace': '1' });
check('"replace" still has to name the plan it replaces', r.status === 412 && (await (await ask(w, 'plan', { token: me.token })).text()) === 'MINE, KEPT ON PURPOSE');
for (let i = 0; i < 33; i++) { later(86400); r = await putPlan(w, me.token, 'DAY ' + i, five.plan.etag); five = await r.json(); }
const days = [...w.store.keys()].filter(k => k.startsWith('day/')).sort();
check('thirty daily copies are kept, the newest ones', days.length === 30 && days[29] === 'day/2026-12-15' && !days.includes('day/2026-11-12'), [days.length, days[0], days[29]]);
for (let i = 0; i < 23; i++) { later(60); r = await putPlan(w, me.token, 'REPLACED ' + i, five.plan.etag, {}, { 'x-lrf-replace': '1' }); five = await r.json(); }
check('twenty of the automatic snapshots are kept', [...w.store.keys()].filter(k => k.startsWith('snap/auto-')).length === 20);

// ── photos ──
r = await ask(w, 'file/map', { method: 'PUT', token: me.token, body: new Uint8Array([255, 216, 255, 1, 2, 3]), headers: { 'x-lrf-type': 'image/jpeg' } }); const mapPut = await r.json();
r = await ask(w, 'file/map', { token: me.token });
check('the farm photo is stored and comes back with its type', mapPut.ok && r.status === 200 && r.headers.get('x-lrf-type') === 'image/jpeg' && new Uint8Array(await r.arrayBuffer())[1] === 216 && r.headers.get('x-lrf-etag') === mapPut.etag);
r = await ask(w, 'file/thumbs', { method: 'PUT', token: me.token, body: '{"a":"data:image/jpeg;base64,xx"}' });
state = await (await ask(w, 'state', { token: me.token })).json();
check('the state names both photo files', r.status === 200 && state.files.map.etag === mapPut.etag && state.files.thumbs.size === 33, state.files);
r = await ask(w, 'file/passwords', { method: 'PUT', token: me.token, body: 'x' }); check('no other file name is accepted', r.status === 404);
r = await ask(w, 'file/..%2Fplan', { token: me.token }); check('nor a path out of the folder', r.status === 404);

// ── snapshots ──
r = await ask(w, 'snap/s-abc123', { method: 'PUT', token: me.token, body: 'SNAPSHOT ONE', headers: { 'x-lrf-meta': metaHeader({ name: 'Before releasing pins — “été”', savedAt: '2026-11-12T10:00:00Z', plantings: 625 }) } });
check('a named snapshot is stored', r.status === 200);
r = await ask(w, 'snap/s-noname', { method: 'PUT', token: me.token, body: 'X', headers: { 'x-lrf-meta': metaHeader({ savedAt: '2026-11-12T10:00:00Z' }) } }); check('a snapshot needs a name', r.status === 400);
r = await ask(w, 'snap/auto-mine', { method: 'PUT', token: me.token, body: 'X', headers: { 'x-lrf-meta': metaHeader({ name: 'x' }) } }); check('the service\'s own snapshots cannot be written from outside', r.status === 404);
r = await ask(w, 'snaps', { token: me.token }); const listed = (await r.json()).snaps;
const mine = listed.find(s => s.id === 's-abc123');
check('the list names every snapshot and daily copy, with its note', listed.filter(s => s.kind === 'day').length === 30 && listed.filter(s => s.kind === 'snap').length === 21 && mine && mine.meta.name === 'Before releasing pins — “été”' && mine.meta.plantings === 625 && mine.size === 12, [listed.length, mine]);
r = await ask(w, 'snap/s-abc123', { token: me.token }); check('a snapshot comes back as sent', (await r.text()) === 'SNAPSHOT ONE');
r = await ask(w, 'day/2026-12-15', { token: me.token }); check('a daily copy can be fetched', r.status === 200);
r = await ask(w, 'snap/s-abc123', { method: 'DELETE', token: me.token }); r = await ask(w, 'snap/s-abc123', { token: me.token }); check('a snapshot can be deleted', r.status === 404);
r = await ask(w, 'snap/a.b%2Fplan', { token: me.token }); const odd = await ask(w, 'snap/plan/x', { token: me.token }); check('a snapshot id is letters, digits and dashes only', r.status === 404 && odd.status === 404);
r = await ask(w, 'guard', { token: me.token }); check('the count of wrong passphrases cannot be read from outside', r.status === 404);
{ // the list is read in pages
  const p = make({ pageSize: 7 }), t = (await login(p)).token;
  for (let i = 0; i < 25; i++) await ask(p, 'snap/s-' + String(i).padStart(4, '0'), { method: 'PUT', token: t, body: 'S', headers: { 'x-lrf-meta': metaHeader({ name: 'n' + i }) } });
  check('a long list of snapshots is read to the end', (await (await ask(p, 'snaps', { token: t })).json()).snaps.length === 25);
}

// ── wrong passphrases are counted ──
for (const wildcard of [true, false, 'throws']) {
  const tag = wildcard === true ? '' : wildcard === 'throws' ? ' (bucket that refuses "only if absent")' : ' (bucket that ignores "only if absent")';
  clock = Date.UTC(2027, 0, 5, 9, 0, 0);
  const g = make({ wildcard });
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(await login(g, 'guess ' + i));
  check('five wrong passphrases are each told they are wrong' + tag, tries.every(t => t.status === 401 && t.error === 'wrong') && tries[0].left === 4 && tries[4].left === 0, tries);
  let t = await login(g, 'guess 6');
  check('the sixth is locked out, not told' + tag, t.status === 429 && t.error === 'locked' && t.wait === 900, t);
  t = await login(g);
  check('while locked, the right passphrase is refused too (so a guess learns nothing)' + tag, t.status === 429, t);
  later(899); t = await login(g); check('still locked a second before the quarter hour' + tag, t.status === 429);
  later(2); t = await login(g); check('after the quarter hour the right passphrase works' + tag, t.status === 200 && !!t.token, t);
  for (let i = 0; i < 5; i++) await login(g, 'again ' + i);
  t = await login(g, 'again 6'); check('a right passphrase clears the count: the next lock is a quarter hour again' + tag, t.status === 429 && t.wait === 900, t);
  later(901);
  for (let i = 0; i < 5; i++) await login(g, 'third ' + i);
  t = await login(g, 'third 6'); check('without one, the second lock is half an hour' + tag, t.status === 429 && t.wait === 1800, t);
  later(1801); for (let i = 0; i < 6; i++) t = await login(g, 'fourth ' + i);
  check('and the third an hour' + tag, t.status === 429 && t.wait === 3600, t);
  let longest = 0;
  for (let round = 0; round < 8; round++) { later(longest + 3601); for (let i = 0; i < 6; i++) t = await login(g, 'more ' + round + i); longest = Math.max(longest, t.wait); later(t.wait); }
  check('locks grow to a day and no longer' + tag, longest === 86400, longest);
  later(86400 * 2 + 5); for (let i = 0; i < 6; i++) t = await login(g, 'later ' + i);
  check('after a quiet day the count starts over' + tag, t.status === 429 && t.wait === 900, t);
  // a burst: many guesses at the same instant get no more tries than a slow guesser
  clock = Date.UTC(2027, 2, 1, 9, 0, 0);
  const b = make({ wildcard }); await login(b);   // the owner has signed in once, as he will have
  const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => login(b, i === 37 ? KEY : 'burst ' + i)));
  const told = burst.filter(x => x.status === 401).length, got = burst.filter(x => x.status === 200).length, shut = burst.filter(x => x.status === 429).length;
  check('sixty guesses at once: at most five are answered' + tag, told + got <= 5 && shut >= 55 && told + got + shut === 60, { told, got, shut });
  if (wildcard === true) { const f = make(); const first = await Promise.all(Array.from({ length: 60 }, (_, i) => login(f, 'first ' + i))); check('the same on a bucket nobody has signed in to yet', first.filter(x => x.status === 401).length <= 5, first.filter(x => x.status === 401).length); }
  const tok = (await login(make())).token;   // (a token from another service with the same passphrase is the same token: made from the passphrase and the date alone)
  r = await ask(b, 'state', { token: tok }); check('a device already signed in is not locked out with the guessers' + tag, r.status === 200);
}
{ // spaced-out wrong tries do not add up
  clock = Date.UTC(2027, 3, 1, 9, 0, 0);
  const s = make(); let t;
  for (let i = 0; i < 12; i++) { t = await login(s, 'slow ' + i); later(16 * 60); }
  check('a wrong passphrase now and then never locks (his own typing mistakes)', t.status === 401, t);
}
{ // the token is renewed in use
  clock = Date.UTC(2027, 4, 1, 9, 0, 0);
  const s = make(), t = (await login(s)).token;
  r = await ask(s, 'state', { token: t }); const fresh = r.headers.get('x-lrf-token');
  later(8 * 86400); r = await ask(s, 'state', { token: t }); const renewed = r.headers.get('x-lrf-token');
  later(170 * 86400); const stillOld = (await ask(s, 'state', { token: t })).status, withNew = (await ask(s, 'state', { token: renewed })).status;
  later(11 * 86400); const expired = (await ask(s, 'state', { token: t })).status;
  check('a token in use is renewed after a week, and the old one ends at 180 days', fresh === null && /^v1\./.test(renewed || '') && stillOld === 200 && withNew === 200 && expired === 401, { fresh, renewed: !!renewed, stillOld, withNew, expired });
}
{ // a failure inside is reported, not thrown
  const broken = { PLAN: { get: async () => { throw new Error('bucket offline'); }, head: async () => { throw new Error('bucket offline'); } }, SYNC_KEY: KEY };
  const t = (await login(make())).token;
  r = await ask(null, 'state', { token: t, e: broken }); const said = await r.json();
  check('trouble with the bucket is answered as an error the planner can show', r.status === 500 && /bucket offline/.test(said.error) && r.headers.get('access-control-allow-origin') === SITE, said);
}
{ // a bucket that refuses the "only if nothing is there" form: the first plan is still stored, and still guarded afterwards
  const s = make({ wildcard: 'throws' }), t = (await login(s)).token;
  r = await putPlan(s, t, 'FIRST', 'none'); const first = await r.json();
  const again = await putPlan(s, t, 'SECOND FIRST', 'none'), stale = await putPlan(s, t, 'STALE', 'not-the-etag'), next = await putPlan(s, t, 'NEXT', first.plan && first.plan.etag);
  check('on such a bucket the first plan is stored, and every later write is still conditional', r.status === 200 && again.status === 412 && stale.status === 412 && next.status === 200 && (await (await ask(s, 'plan', { token: t })).text()) === 'NEXT', [r.status, again.status, stale.status, next.status]);
}

// ── supplier pages for the seed library (version 2) ──
{
  const s = make(), t = (await login(s)).token, real = globalThis.fetch, asked = [];
  globalThis.fetch = async href => { asked.push(href); if (/redirect/.test(href)) return new Response(null, { status: 302, headers: { location: 'https://somewhere-else.example/x' } }); if (/photo/.test(href)) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); return new Response('<html>Seed page</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }); };
  const page = 'https://www.johnnyseeds.com/vegetables/x.html', q = u => 'fetch?url=' + encodeURIComponent(u);
  r = await ask(s, q(page)); check('a supplier page is not read for a device that is not signed in', r.status === 401 && asked.length === 0, r.status);
  r = await ask(s, q(page), { token: t }); text = await r.text();
  check('signed in, a supplier page is fetched and handed back with its address', r.status === 200 && text.includes('Seed page') && r.headers.get('x-lrf-final-url') === page && r.headers.get('access-control-allow-origin') === SITE && /x-lrf-final-url/.test(r.headers.get('access-control-expose-headers')), [r.status, text.slice(0, 80)]);
  r = await ask(s, q(page), { headers: { 'x-lrf-key': t } }); check('the token is taken in the reader\'s own header too', r.status === 200, r.status);
  r = await ask(s, q(page), { headers: { 'x-lrf-key': KEY } }); check('the passphrase is not taken there', r.status === 401, r.status);
  r = await ask(s, 'state', { headers: { 'x-lrf-key': t } }); check('and that header opens nothing but the reader', r.status === 401, r.status);
  const n = asked.length;
  r = await ask(s, q('https://example.com/page'), { token: t }); check('a site that is not a supplier is refused and never fetched', r.status === 403 && asked.length === n, [r.status, asked.length - n]);
  r = await ask(s, q('http://johnnyseeds.com/x'), { token: t }); check('only https is fetched', r.status === 400 && asked.length === n, r.status);
  r = await ask(s, q('https://127.0.0.1/x'), { token: t }); check('a bare address is not fetched', r.status === 400 && asked.length === n, r.status);
  r = await ask(s, 'fetch', { token: t }); check('no address is an error the planner can show', r.status === 400 && /https address/.test((await r.json()).error));
  r = await ask(s, q('https://johnnyseeds.com/redirect'), { token: t }); check('a redirect to a site off the list is not followed', r.status === 403 && asked.length === n + 1, [r.status, asked.length - n]);
  r = await ask(s, 'fetch?kind=image&url=' + encodeURIComponent('https://cdn.example.net/photo.jpg'), { token: t }); check('a product photo is fetched as a picture', r.status === 200 && r.headers.get('content-type') === 'image/jpeg', r.status);
  r = await ask(s, q('https://johnnyseeds.com/photo.jpg'), { token: t }); check('a picture is not handed back as a page', r.status === 415, r.status);
  r = await ask(s, q('https://extra-seeds.example/p'), { token: t, e: { ...s.env, LRF_SITES: 'extra-seeds.example' } }); check('a site added in LRF_SITES is fetched', r.status === 200, r.status);
  r = await ask(s, q(page), { token: t, method: 'POST' }); check('nothing is posted through it', r.status >= 400, r.status);
  r = await ask(s, q(page), { token: t, origin: 'https://someone-else.example' }); check('another website cannot use it', r.status === 403);
  r = await ask(s, 'state', { token: t }); check('the service says it is version 2', (await r.json()).v === 2);
  r = await ask(s, 'fetch', { method: 'OPTIONS' }); check('the preflight allows the reader\'s header', /x-lrf-key/.test(r.headers.get('access-control-allow-headers')));
  check('nothing fetched is kept in the bucket', ![...(s.store ? s.store.keys() : [])].some(k => /fetch|johnny/.test(k)));
  globalThis.fetch = real;
}
