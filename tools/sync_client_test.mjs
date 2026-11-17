// The planner's sync client (js/sync.js) and the sync Worker's own code together, in Node: two or three "browsers" with
// made-up plans, a stand-in bucket, and no network.
// usage: node tools/sync_client_test.mjs [dir holding sync.js and merge.js] [dir holding the build before's sync.js]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/lrf-plan-sync.js';
import { fakeBucket } from './fake_r2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const DIR = path.resolve(process.argv[2] || path.join(here, '..', 'js'));
const Sync = require(path.join(DIR, 'sync.js')), Merge = require(path.join(DIR, 'merge.js'));
// the build before's client, where it is given: it stands for a page that was not reloaded after a release
const Before = process.argv[3] ? (() => { const g = globalThis.LRFSync; try { return require(path.resolve(process.argv[3], 'sync.js')); } catch (_) { return null; } finally { globalThis.LRFSync = g; } })() : null;
const KEY = 'correct horse battery', URL_ = 'https://sync.example', SITE = 'https://loftyendeavors.github.io';
// The report is printed as the process ends, whatever happens on the way: a line that throws is one failed line, not a silent stop.
process.on('exit', () => { console.log(results.join('\n')); console.log(results.filter(x => x.startsWith('ok')).length + ' of ' + results.length + ' passed'); });
process.on('uncaughtException', error => { results.push('FAIL the test ran to its end ' + JSON.stringify(String(error && error.stack || error).slice(0, 300))); process.exitCode = 1; process.exit(); });
const results = [], check = (name, ok, detail) => { results.push((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };

function world() {
  const f = fakeBucket(), w = { ...f, env: { PLAN: f.bucket, SYNC_KEY: KEY }, down: false, calls: [] };
  w.fetch = async (url, init = {}) => {
    w.calls.push(`${init.method || 'GET'} ${String(url).replace(URL_, '')}`);
    if (w.down) throw new TypeError('Failed to fetch');
    return worker.fetch(new Request(url, { method: init.method, body: init.body, headers: { origin: SITE, ...(init.headers || {}) } }), w.env);
  };
  w.text = async key => { const rec = w.store.get(key); if (!rec) return null; const meta = JSON.parse((rec.customMetadata && rec.customMetadata.m) || '{}'); return Sync.unpack(rec.bytes, meta.enc); };
  return w;
}
const fnv = text => { let x = 2166136261; for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619); return (x >>> 0).toString(36); };
/** A stand-in for the app in one browser. */
function browser(w, name, plan, Impl = Sync) {
  const b = { world: w, name, plan: plan || null, loads: 0, said: [], opened: [], gotPhotos: [], map: null, thumbs: null, held: false, saved: null, timers: [], openOk: true };
  const host = {
    mode: () => (b.held ? 'held' : b.plan ? 'plan' : 'sample'),
    key: () => fnv(JSON.stringify(b.plan)),
    payload: async () => { const p = b.plan; return { text: JSON.stringify(p), savedAt: new Date().toISOString(), key: fnv(JSON.stringify(p)), plantings: p.plantings.length, waiting: 0, year: 2027 }; },
    extrasKey: async () => fnv(JSON.stringify([b.map ? Array.from(b.map.bytes) : null, b.thumbs])),
    extras: async () => ({ map: b.map, thumbs: b.thumbs }),
    photos: async ({ image, thumbs }) => { b.gotPhotos.push({ image: !!image, thumbs: !!thumbs }); if (image) b.map = { bytes: image.bytes, mime: image.mime }; if (thumbs) b.thumbs = thumbs; },
    open: async (text, o) => { b.opened.push(o); if (!b.openOk) return false; b.plan = JSON.parse(text); b.loads++; if (o.image) b.map = { bytes: o.image.bytes, mime: o.image.mime }; if (o.thumbs) b.thumbs = o.thumbs; return true; },
    loads: () => b.loads, device: () => 'd-' + name, say: m => b.said.push(m)
  };
  const env = { supported: true, fetch: (...args) => w.fetch(...args), storage: { get: () => b.saved, set: v => { b.saved = v; } }, setTimeout: (fn, ms) => { const t = { fn, ms }; b.timers.push(t); return t; }, clearTimeout: t => { b.timers = b.timers.filter(x => x !== t); } };
  b.env = env;
  b.make = () => { b.sync = Impl.create(host, env); return b.sync; };
  /** Let the waiting timers fire (a send a few seconds after a change, a retry), but not a request's own time limit. */
  b.tick = async () => { for (let i = 0; i < 6; i++) { const due = b.timers.filter(t => t.ms < 400000 && t.ms !== Sync.timing.timeout); if (!due.length) break; b.timers = b.timers.filter(t => !due.includes(t)); for (const t of due) t.fn(); await b.sync.run('settle').catch(() => {}); } return b.sync.info(); };
  b.change = async edit => { b.plan = { ...b.plan, plantings: [...b.plan.plantings, { id: edit }] }; b.sync.touch(); return b.tick(); };
  b.host = host;
  b.make();
  return b;
}
/**
 * The same stand-in with the browser's own storage: the plan it holds and the count beside it. A save can be refused (`full`:
 * no room) or still be waiting when the plan is sent (`late`). `start` is the page opened again: it holds what storage holds.
 */
function stored(b, disk) {
  b.disk = disk || { plan: b.plan, n: 1 }; b.plan = b.disk.plan; b.full = false; b.late = false;
  b.host.stored = () => ({ n: b.disk.n, ok: b.disk.plan === b.plan });
  b.save = () => { if (b.full) return false; b.disk = { plan: b.plan, n: b.disk.n + 1 }; b.sync.saved(); return true; };
  b.edit = async (id, send = true) => { b.plan = { ...b.plan, plantings: [...b.plan.plantings, { id }] }; if (!b.late) b.save(); if (!send) return b.sync.info(); b.sync.touch(); return b.tick(); };
  b.start = () => { const next = browser(b.world, b.name); next.saved = b.saved; return stored(next, b.disk); };
  b.note = () => JSON.parse(b.saved || '{}');
  b.make();
  return b;
}
const planOf = (n, tag) => ({ gardens: [], beds: [], plantings: Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}`, crop: 'lettuce' })), settings: { year: 2027 } });
/** The same stand-in with a place for the plan kept to compare with (js/kept.js on a page): one record, which a full database refuses. */
function keeping(b) {
  b.keptRec = null; b.keptFull = false; b.keptPuts = 0;
  b.env.kept = {
    put: async r => {
      b.keptPuts++;
      // a database that never answers: sync's own time limit for it is what ends the wait (its timer is turned here, since no clock runs in this test)
      if (b.keptHangs) { setTimeout(() => { for (const t of b.timers.filter(x => x.ms === Sync.timing.kept)) t.fn(); }, 1); return new Promise(() => {}); }
      if (b.keptFull) throw new Error('The database is full.'); b.keptRec = { etag: r.etag, key: r.key, at: r.at, bytes: r.text.length, text: r.text }; return b.keptRec;
    },
    note: async () => (b.keptRec ? { etag: b.keptRec.etag, key: b.keptRec.key, at: b.keptRec.at, bytes: b.keptRec.bytes } : null),
    get: async () => { b.keptGets = (b.keptGets || 0) + 1; return b.keptHangs ? new Promise(() => {}) : b.keptRec ? { ...b.keptRec } : null; },
    clear: async () => { b.keptRec = null; return true; } };
  b.make();
  return b;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── what to do, from what each side holds ──
check('nothing in the cloud and a plan here: send it', Sync.decide({ base: null, cloud: null, dirty: true, sample: false }) === 'push-first');
check('nothing in the cloud and only the sample here: do nothing', Sync.decide({ base: null, cloud: null, dirty: false, sample: true }) === 'nothing');
check('a plan in the cloud and only the sample here: open it', Sync.decide({ base: null, cloud: 'e1', dirty: false, sample: true }) === 'pull');
check('a plan in each, never synced: ask', Sync.decide({ base: null, cloud: 'e1', dirty: true, sample: false }) === 'ask-first' && Sync.decide({ base: null, cloud: 'e1', dirty: false, sample: false }) === 'ask-first');
check('in step and unchanged: nothing to do', Sync.decide({ base: 'e1', cloud: 'e1', dirty: false, sample: false }) === 'in-step');
check('in step and changed here: send', Sync.decide({ base: 'e1', cloud: 'e1', dirty: true, sample: false }) === 'push');
check('changed there only: newer', Sync.decide({ base: 'e1', cloud: 'e2', dirty: false, sample: false }) === 'newer');
check('changed on both sides: a conflict, never a send', Sync.decide({ base: 'e1', cloud: 'e2', dirty: true, sample: false }) === 'conflict');
check('an address is https, with or without the prefix typed', Sync.address(' lrf-plan-sync.someone.workers.dev/ ') === 'https://lrf-plan-sync.someone.workers.dev' && Sync.address('http://lrf.example.dev') === '' && Sync.address('https://u:p@x.example.dev') === '' && Sync.address('nonsense') === '' && Sync.address('http://127.0.0.1:8791') === 'http://127.0.0.1:8791');
{ const big = JSON.stringify(planOf(4000, 'x')), p = await Sync.pack(big); check('a plan is packed for the trip and comes back exactly', p.enc === 'gzip' && p.bytes.length < big.length / 5 && (await Sync.unpack(p.bytes, p.enc)) === big, [p.enc, p.bytes.length, big.length]); }

// ── first computer, second computer ──
let w = world(), a = browser(w, 'laptop', planOf(5, 'a')), b = browser(w, 'second');
let info = await a.sync.connect(URL_, KEY, 'Work laptop');
check('the first computer connects and its plan is sent', info.status === 'in-step' && info.configured && same(JSON.parse(await w.text('plan')), a.plan), info);
check('the passphrase is not kept in the browser', !a.saved.includes(KEY) && /"token":"v1\./.test(a.saved) && JSON.parse(a.saved).url === URL_);
check('the cloud\'s plan says who saved it', JSON.parse(w.store.get('plan').customMetadata.m).label === 'Work laptop' && JSON.parse(w.store.get('plan').customMetadata.m).plantings === 5);
info = await b.sync.connect(URL_, KEY, 'Phone');
check('a browser with no plan connects and opens the cloud\'s', info.status === 'in-step' && same(b.plan, a.plan) && b.said.length === 1 && /opened from the cloud/.test(b.said[0]), [info.status, b.said]);
let puts = w.calls.filter(c => c === 'PUT /plan').length;
info = await b.sync.run('poll'); await a.sync.run('poll');
check('in step: a look at the cloud sends nothing', info.status === 'in-step' && w.calls.filter(c => c === 'PUT /plan').length === puts);

// ── a change travels ──
info = await a.change('a-new-1');
check('a change is sent a few seconds after it is made', info.status === 'in-step' && same(JSON.parse(await w.text('plan')), a.plan) && a.plan.plantings.length === 6);
info = await b.sync.run('poll');
check('the other device is offered the newer plan, and keeps its own until asked', info.status === 'newer' && info.offer && b.plan.plantings.length === 5 && info.cloud.meta.label === 'Work laptop', info);
b.sync.snooze(); check('"not now" puts the offer away', b.sync.info().status === 'newer' && !b.sync.info().offer);
check('opening it brings the plan over', (await b.sync.openCloud()) === true && same(b.plan, a.plan) && b.sync.info().status === 'in-step' && /Before opening/.test(b.opened[b.opened.length - 1].why));
await a.change('a-new-2');
const b2 = browser(w, 'second'); b2.saved = b.saved; b2.plan = b.plan; b2.make();
info = await b2.sync.start();
check('at start-up, a browser with nothing changed opens the newer plan by itself and says so', info.status === 'in-step' && same(b2.plan, a.plan) && /newer plan was opened/.test(b2.said[0] || ''), [info.status, b2.said]);
b = b2;

// ── both changed: nothing is overwritten ──
await a.change('a-new-3');
const cloudBefore = await w.text('plan');
info = await b.change('b-new-1');
check('a change on a device that is behind is not sent: the cloud is left as it is', info.status === 'conflict' && (await w.text('plan')) === cloudBefore && b.plan.plantings.some(p => p.id === 'b-new-1') && !info.first, info.status);
info = await b.change('b-new-2');
check('further changes there are kept here and still not sent', info.status === 'conflict' && (await w.text('plan')) === cloudBefore && b.timers.filter(t => t.ms === Sync.timing.push).length === 0);
info = await b.sync.run('poll');
check('and looking again does not send them either', info.status === 'conflict' && (await w.text('plan')) === cloudBefore);
const mineB = JSON.stringify(b.plan);
check('"keep this plan" writes it over the cloud\'s', (await b.sync.keepMine()) === true && (await w.text('plan')) === mineB && b.sync.info().status === 'in-step');
const autos = [...w.store.keys()].filter(k => k.startsWith('snap/auto-'));
check('and the cloud keeps the plan it replaced', autos.length === 1 && (await w.text(autos[0])) === cloudBefore);
info = await a.sync.run('focus');
check('the first computer, unchanged since, is offered that plan', info.status === 'newer' && a.plan.plantings.length === 8);
info = await a.change('a-new-4');
check('if it is changed before answering, that is a conflict, decided here without a send', info.status === 'conflict' && (await w.text('plan')) === mineB);
check('"open the cloud\'s plan" replaces the plan here', (await a.sync.openCloud()) === true && JSON.stringify(a.plan) === mineB && a.sync.info().status === 'in-step');
a.openOk = false; await b.change('b-new-3'); await a.sync.run('poll');
check('a plan that was not opened after all (he said no) leaves the offer standing', (await a.sync.openCloud()) === false && a.sync.info().status === 'newer' && JSON.stringify(a.plan) === mineB);
a.openOk = true; await a.sync.openCloud();

// ── a plan in each, never synced ──
{ const w2 = world(), x = browser(w2, 'x', planOf(3, 'x')), y = browser(w2, 'y', planOf(4, 'y'));
  await x.sync.connect(URL_, KEY, 'X'); const held = await w2.text('plan');
  const i2 = await y.sync.connect(URL_, KEY, 'Y');
  check('a browser with its own plan, connecting to a cloud that holds another, is asked and sends nothing', i2.status === 'conflict' && i2.first === true && (await w2.text('plan')) === held && y.plan.plantings.length === 4, i2.status);
  const z = browser(w2, 'z'); z.held = true; const i3 = await z.sync.connect(URL_, KEY, 'Z');
  check('a browser whose stored plan would not open neither sends nor opens by itself', i3.status === 'held' && z.plan === null && (await w2.text('plan')) === held);
  const e = world(), s = browser(e, 's'); const i4 = await s.sync.connect(URL_, KEY, 'S');
  check('the sample plan is never sent', i4.status === 'empty' && !e.store.has('plan'));
  s.plan = planOf(2, 's'); s.loads++; s.sync.touch(); const i5 = await s.tick();
  check('once a plan is loaded there, it is', i5.status === 'in-step' && e.store.has('plan'), i5.status);
}

// ── no connection ──
w.down = true;
info = await a.change('a-offline-1');
check('with no connection the change stays here and waits', info.status === 'waiting' && a.plan.plantings.some(p => p.id === 'a-offline-1') && !(await w.text('plan')).includes('a-offline-1'));
info = await a.change('a-offline-2'); check('more changes offline: still waiting, nothing lost', info.status === 'waiting' && a.plan.plantings.some(p => p.id === 'a-offline-2'));
w.down = false; info = await a.sync.run('online');
check('when the connection is back, the plan is sent', info.status === 'in-step' && (await w.text('plan')).includes('a-offline-2'));
w.down = true; info = await b.sync.run('poll'); check('a look with no connection changes nothing', info.status === 'waiting' && !JSON.stringify(b.plan).includes('a-offline'));
w.down = false; await b.sync.run('online'); await b.sync.openCloud();

// ── the passphrase ──
{ const w3 = world(), c = browser(w3, 'c', planOf(2, 'c'));
  let err = null; try { await c.sync.connect(URL_, 'not it', 'C'); } catch (e) { err = e; }
  check('a wrong passphrase is refused and says how many tries are left', err && err.kind === 'wrong' && /4 more tries/.test(err.message) && !c.sync.info().configured && c.saved === null, err && err.message);
  for (let i = 0; i < 5; i++) { try { await c.sync.connect(URL_, 'not it ' + i, 'C'); } catch (e) { err = e; } }
  check('after five the service is shut, and says until when', err.kind === 'locked' && /takes no passphrase until/.test(err.message), err.message);
  try { await c.sync.connect('ftp://x', KEY, 'C'); } catch (e) { err = e; } check('an address that is not one is refused before anything is sent', err.kind === 'address');
  try { await c.sync.connect(URL_, '', 'C'); } catch (e) { err = e; } check('an empty passphrase is not sent', err.kind === 'wrong' && !/tries/.test(err.message));
}
w.env.SYNC_KEY = 'a new passphrase';
info = await a.change('a-after-change');
check('when the passphrase is changed, the device is asked for it again and nothing is lost', info.status === 'signin' && !info.configured && info.url === URL_ && a.plan.plantings.some(p => p.id === 'a-after-change'), info);
check('and while it waits for it, changes are not thrown at the service', (await a.change('a-after-2')).status === 'signin');
info = await a.sync.connect(URL_, 'a new passphrase');
check('signing in again sends what was waiting, with no question', info.status === 'in-step' && (await w.text('plan')).includes('a-after-2') && info.label === 'Work laptop', info.status);
await b.sync.run('poll').catch(() => {}); await b.sync.connect(URL_, 'a new passphrase'); await b.sync.openCloud();

// ── photos ──
a.map = { bytes: new Uint8Array([255, 216, 255, 7, 7]), mime: 'image/jpeg' }; a.thumbs = JSON.stringify({ v1: 'data:image/jpeg;base64,AAAA' });
info = await a.sync.run('poll');
check('photos added here are sent beside the plan', info.status === 'in-step' && w.store.has('file/map') && w.store.has('file/thumbs') && w.store.get('file/map').customMetadata.type === 'image/jpeg');
puts = w.calls.filter(c => c.startsWith('PUT /file')).length; await a.sync.run('poll'); await a.change('a-photo-later');
check('and not sent again while they have not changed', w.calls.filter(c => c.startsWith('PUT /file')).length === puts);
await b.sync.run('poll'); await b.sync.openCloud();
check('a device that opens the plan gets the photos with it', b.map && b.map.bytes[3] === 7 && b.map.mime === 'image/jpeg' && b.thumbs === a.thumbs && !!b.opened[b.opened.length - 1].image.sha256);
a.thumbs = JSON.stringify({ v1: 'data:image/jpeg;base64,AAAA', v2: 'data:image/jpeg;base64,BBBB' }); await a.sync.run('poll');
info = await b.sync.run('poll');
check('photos added on one device reach the other without the plan being touched', info.status === 'in-step' && b.thumbs === a.thumbs && b.gotPhotos.length === 1 && b.gotPhotos[0].thumbs && !b.gotPhotos[0].image && b.loads === b.opened.length);
const fileCalls = w.calls.filter(c => c.includes('/file')).length; await b.sync.run('poll'); await a.sync.run('poll');
check('and then both sides are quiet', w.calls.filter(c => c.includes('/file')).length === fileCalls);

// ── a whole plan loaded over the open one ──
const beforeLoad = await w.text('plan'), autosBefore = [...w.store.keys()].filter(k => k.startsWith('snap/auto-')).length;
a.plan = planOf(3, 'loaded'); a.loads++; a.sync.touch(); info = await a.tick();
const autosAfter = [...w.store.keys()].filter(k => k.startsWith('snap/auto-')).sort();
check('when a whole plan is loaded over the open one, the cloud keeps the plan it had', info.status === 'in-step' && autosAfter.length === autosBefore + 1 && (await w.text(autosAfter[autosAfter.length - 1])) === beforeLoad);
await a.change('a-after-load'); check('an ordinary change after that keeps no extra copy', [...w.store.keys()].filter(k => k.startsWith('snap/auto-')).length === autosBefore + 1);

// ── changed while it was on its way ──
{ const w4 = world(), c = browser(w4, 'c', planOf(2, 'c')); await c.sync.connect(URL_, KEY, 'C');
  const real = w4.fetch; let once = true;
  w4.fetch = async (url, init) => { if (once && init && init.method === 'PUT' && String(url).endsWith('/plan')) { once = false; c.plan = { ...c.plan, plantings: [...c.plan.plantings, { id: 'during' }] }; } return real(url, init); };
  c.plan = { ...c.plan, plantings: [...c.plan.plantings, { id: 'before' }] }; c.sync.touch(); const i6 = await c.tick();
  check('a change made while the plan was on its way is sent after it', i6.status === 'in-step' && (await w4.text('plan')).includes('during'));
}
// ── the cloud emptied (the bucket was cleared) ──
{ const w5 = world(), c = browser(w5, 'c', planOf(2, 'c')); await c.sync.connect(URL_, KEY, 'C'); w5.store.delete('plan');
  const i7 = await c.change('after-wipe'); const i8 = await c.tick();
  check('if the cloud loses its plan, the one here is sent again', (i7.status === 'in-step' || i8.status === 'in-step') && (await w5.text('plan')).includes('after-wipe'), [i7.status, i8.status]);
}
// ── an address that is something else ──
{ const c = browser({ ...world(), fetch: async () => new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } }) }, 'c', planOf(1, 'c'));
  let err = null; try { await c.sync.connect(URL_, KEY, 'C'); } catch (e) { err = e; }
  check('an address that is not the sync service says so', err && err.kind === 'server' && /did not answer like/.test(err.message) && !c.sync.info().configured, err && err.message);
}
// ── snapshots in the cloud ──
await a.sync.putSnap('s-abc-123', { name: 'Before releasing pins', savedAt: '2026-11-12T10:00:00.000Z', plantings: 9 }, '{"plan":"as it was"}');
let listed = await b.sync.snaps();
check('a named snapshot sent from one device is listed on the other', listed.some(s => s.id === 's-abc-123' && s.kind === 'snap' && s.meta.name === 'Before releasing pins' && s.meta.label === 'Work laptop' && s.meta.plantings === 9), listed.map(s => s.id));
check('and can be fetched there', (await b.sync.getSnap('snap', 's-abc-123')) === '{"plan":"as it was"}');
check('the cloud\'s own kept plans are listed and can be fetched too', listed.some(s => s.meta.auto) && (await b.sync.getSnap('snap', listed.find(s => s.meta.auto).id)).includes('plantings'));
await b.sync.dropSnap('snap', 's-abc-123'); check('and deleted', !(await a.sync.snaps()).some(s => s.id === 's-abc-123'));

// ── the seed library's reader borrows the sign-in (since the service's version 2) ──
{
  const ls = b.sync.linkService(), fresh = browser(w, 'fresh');
  check('a signed-in device hands the reader the service\'s address, its token and the version the service said', !!ls && ls.base === b.sync.info().url && /^v1\./.test(ls.key) && ls.v === 3 && ls.key !== KEY, ls && { base: ls.base, v: ls.v });
  check('a device that is not connected hands it nothing', fresh.make().linkService() === null);
}
// ── a stored plan that is behind is never sent by itself ──
check('a plan that is behind is not “changed here”: in step with the cloud it is a question, never a send', Sync.decide({ base: 'e1', cloud: 'e1', dirty: true, sample: false, behind: true }) === 'conflict' && Sync.decide({ base: 'e1', cloud: 'e1', dirty: true, sample: false, behind: false }) === 'push');
check('behind changes nothing else: unchanged it is in step, with the cloud moved it is a question or an offer, with an empty cloud it is sent', Sync.decide({ base: 'e1', cloud: 'e1', dirty: false, sample: false, behind: true }) === 'in-step' && Sync.decide({ base: 'e1', cloud: 'e2', dirty: true, sample: false, behind: true }) === 'conflict'
  && Sync.decide({ base: 'e1', cloud: 'e2', dirty: false, sample: false, behind: true }) === 'newer' && Sync.decide({ base: 'e1', cloud: null, dirty: true, sample: false, behind: true }) === 'push-first');
check('a browser that cannot say what its storage holds keeps neither word of it', b.sync.info().status === 'in-step' && !('n' in JSON.parse(b.saved)) && !('stored' in JSON.parse(b.saved)), Object.keys(JSON.parse(b.saved)));
const sends = world_ => world_.calls.filter(c => c === 'PUT /plan').length;
{ // the save was refused (no room), the plan was sent all the same, and the page is opened again: storage holds the plan from before
  const w6 = world(), c = stored(browser(w6, 'c', planOf(3, 'c'))); await c.sync.connect(URL_, KEY, 'C');
  check('in step, the browser notes the count beside its stored plan, and that the plan sent is the one stored', c.note().n === c.disk.n && c.note().stored === true, c.note());
  c.full = true; const sent = await c.edit('never-stored');
  check('a plan whose save was refused is still sent, and the note says it is not the one stored', sent.status === 'in-step' && (await w6.text('plan')).includes('never-stored') && c.note().stored === false && !JSON.stringify(c.disk.plan).includes('never-stored'), [sent.status, c.note().stored]);
  const before = sends(w6), c2 = c.start(), i1 = await c2.sync.start(); await c2.tick();
  check('a refused save, then a new start: nothing is sent, and the page asks which plan to keep', sends(w6) === before && c2.sync.info().status === 'conflict' && i1.status === 'conflict' && !i1.first && (await w6.text('plan')).includes('never-stored'), [sends(w6) - before, i1.status]);
  const i2 = await c2.edit('made-while-asking'); await c2.sync.run('poll');
  check('a change made while it asks is kept here and not sent either', i2.status === 'conflict' && sends(w6) === before && (await w6.text('plan')).includes('never-stored') && !(await w6.text('plan')).includes('made-while-asking'), i2.status);
  check('“open the cloud’s plan” brings back what was sent', (await c2.sync.openCloud()) === true && c2.plan.plantings.some(x => x.id === 'never-stored') && c2.sync.info().status === 'in-step');
  c2.save(); const i3 = await c2.edit('after-the-choice');
  check('and after the choice a change is sent again', i3.status === 'in-step' && (await w6.text('plan')).includes('after-the-choice') && c2.note().stored === true);
}
{ // the stored plan's count is under the one noted: an older text was put back under it
  const w7 = world(), c = stored(browser(w7, 'c', planOf(3, 'c'))); await c.sync.connect(URL_, KEY, 'C');
  const older = c.disk; await c.edit('sent-and-stored'); await c.edit('sent-and-stored-too');
  check('each send notes the count as it stands', c.note().n === c.disk.n && c.disk.n === older.n + 2 && c.note().stored === true, [c.note().n, c.disk.n]);
  c.disk = { plan: { ...older.plan, plantings: [...older.plan.plantings, { id: 'written-without-looking' }] }, n: older.n + 1 };
  const before = sends(w7), c2 = c.start(), i1 = await c2.sync.start(); await c2.tick();
  check('a plan behind by its count, then a new start: nothing is sent, and the page asks which plan to keep', sends(w7) === before && i1.status === 'conflict' && c2.sync.info().status === 'conflict' && (await w7.text('plan')).includes('sent-and-stored-too'), [sends(w7) - before, i1.status]);
  check('“keep this plan” is still his to choose, and the cloud keeps the plan it replaces', (await c2.sync.keepMine()) === true && (await w7.text('plan')).includes('written-without-looking') && [...w7.store.keys()].some(k => k.startsWith('snap/auto-')) && c2.sync.info().status === 'in-step');
  // the count under the one noted, but the very plan that was noted: nothing is behind in it
  const w8 = world(), e = stored(browser(w8, 'e', planOf(3, 'e'))); await e.sync.connect(URL_, KEY, 'E'); await e.edit('one'); await e.edit('two');
  e.disk = { plan: e.disk.plan, n: 1 };
  const e2 = e.start(), i4 = await e2.sync.start(), i5 = await e2.edit('three');
  check('a lower count over the very plan that was noted is in step, and the next change is sent', i4.status === 'in-step' && i5.status === 'in-step' && (await w8.text('plan')).includes('three'), [i4.status, i5.status]);
}
{ // changed here and not behind: stored, and the page closed before it was sent
  const w9 = world(), c = stored(browser(w9, 'c', planOf(3, 'c'))); await c.sync.connect(URL_, KEY, 'C'); await c.edit('sent');
  await c.edit('stored-and-not-sent', false);
  const before = sends(w9), c2 = c.start(), i1 = await c2.sync.start();
  check('a plan changed here and not behind is sent at the next start', i1.status === 'in-step' && sends(w9) === before + 1 && (await w9.text('plan')).includes('stored-and-not-sent'), [i1.status, sends(w9) - before]);
  // sent while its save was still waiting: the note says "not stored" until the store has written, then says it is
  c2.late = true; await c2.edit('sent-before-it-was-stored');
  const early = c2.note().stored; c2.save();
  check('a plan sent before its save was written is noted as stored once it is', early === false && c2.note().stored === true && c2.note().n === c2.disk.n, [early, c2.note()]);
  c2.late = false; await c2.edit('a-later-change-stored-and-not-sent', false);
  const c3 = c2.start(), i2 = await c3.sync.start();
  check('and a later change stored there is sent at the next start: it is not behind', i2.status === 'in-step' && (await w9.text('plan')).includes('a-later-change-stored-and-not-sent'), i2.status);
  // the note of a page that kept neither word: not known is never behind
  await c3.edit('before-the-old-note'); await c3.edit('changed-under-an-old-note', false);
  const old = c3.note(); delete old.n; delete old.stored; c3.saved = JSON.stringify(old); c3.disk = { plan: c3.disk.plan, n: 0 };
  const c4 = c3.start(), i3 = await c4.sync.start();
  check('a note with neither word, and no count beside the plan: a changed plan is sent', i3.status === 'in-step' && (await w9.text('plan')).includes('changed-under-an-old-note') && c4.note().n === c4.disk.n, i3.status);
  // a window that only shows the plan
  const kept = c4.saved, calls = w9.calls.length; c4.held = true; c4.host.readOnly = () => true;
  c4.sync.rename('Another name'); const i6 = await c4.sync.run('poll'); c4.sync.touch(); await c4.tick();
  check('a window that only shows the plan sends nothing, asks the cloud nothing, and leaves the browser’s note as it was', i6.status === 'held' && c4.saved === kept && w9.calls.length === calls, [i6.status, w9.calls.length - calls]);
}

// ── the plan kept to compare with: the cloud's plan as it stood when this browser was last in step ──
{
  const wk = world(), d = keeping(browser(wk, 'desk', planOf(4, 'k'))), ph = keeping(browser(wk, 'phone'));
  const fetched = () => wk.calls.filter(c => c === 'GET /plan').length, baseOf = x => JSON.parse(x.saved).base, cloudText = () => wk.text('plan');
  let i = await d.sync.connect(URL_, KEY, 'Desk');
  check('the first send keeps the plan as the cloud now holds it, under the cloud\'s stamp', i.status === 'in-step' && i.kept === true && !!d.keptRec && d.keptRec.etag === baseOf(d) && d.keptRec.etag === wk.store.get('plan').etag && d.keptRec.text === (await cloudText()), [i.status, i.kept]);
  await ph.sync.connect(URL_, KEY, 'Phone');
  check('a browser that opens the cloud\'s plan keeps that text', !!ph.keptRec && ph.keptRec.etag === baseOf(ph) && ph.keptRec.text === (await cloudText()) && same(JSON.parse(ph.keptRec.text), ph.plan) && ph.sync.info().kept === true);
  await d.change('k-new');
  check('each send moves the kept plan with the stamp', d.keptRec.etag === baseOf(d) && d.keptRec.text === (await cloudText()) && JSON.parse(d.keptRec.text).plantings.length === 5 && d.sync.info().kept === true);
  let n = fetched(); await d.sync.run('poll'); await d.sync.run('poll');
  check('in step with a plan kept, a look at the cloud fetches no plan', fetched() === n && d.sync.info().status === 'in-step');
  await ph.sync.run('poll'); await ph.sync.openCloud();
  const started = ph.keptRec.text, startStamp = ph.keptRec.etag;
  await d.change('k-desk'); i = await ph.change('k-phone');
  const k = await ph.sync.keptPlan(), cloudNow = await cloudText();
  check('when both have changed nothing is sent, and the plan kept is still the one the two started from', i.status === 'conflict' && !!k && k.text === started && k.etag === startStamp && k.etag === baseOf(ph) && !cloudNow.includes('k-phone'), [i.status, !!k]);
  const joined = Merge.merge(JSON.parse(k.text), ph.plan, JSON.parse(cloudNow)), ids = joined.ok ? joined.plan.plantings.map(x => x.id) : [];
  check('from it the two plans can be joined: each device\'s change is there, once, and nothing else has moved', joined.ok && ids.filter(x => x === 'k-desk').length === 1 && ids.filter(x => x === 'k-phone').length === 1 && ids.length === JSON.parse(started).plantings.length + 2 && !joined.report.items.length, [joined.ok, joined.why, ids.length]);
  check('nothing joins them yet: the page still asks which plan to keep, and each plan is as it was', ph.sync.info().status === 'conflict' && (await cloudText()) === cloudNow && !ph.plan.plantings.some(x => x.id === 'k-desk'));
  await ph.sync.keepMine();
  check('"keep this plan" keeps what was sent', ph.sync.info().status === 'in-step' && ph.keptRec.etag === baseOf(ph) && ph.keptRec.text === (await cloudText()) && ph.keptRec.text.includes('k-phone'));
  // a browser that was in step before plans were kept, or whose database was emptied
  await d.sync.run('poll'); await d.sync.openCloud();
  const d2 = keeping(browser(wk, 'desk')); d2.saved = d.saved; d2.plan = d.plan; d2.make();
  n = fetched(); i = await d2.sync.start();
  check('a browser in step with no plan kept fetches the cloud\'s once, and keeps it', i.status === 'in-step' && i.kept === true && fetched() === n + 1 && !!d2.keptRec && d2.keptRec.etag === baseOf(d2) && d2.keptRec.text === (await cloudText()), [i.status, i.kept, fetched() - n]);
  await d2.sync.run('poll'); await d2.sync.run('poll');
  check('and does not fetch it again', fetched() === n + 1);
  { const again = keeping(browser(wk, 'desk')); again.saved = d2.saved; again.plan = d2.plan; again.keptRec = d2.keptRec; again.make();
    const g = fetched(), i2 = await again.sync.start(); await again.sync.run('poll');
    check('a page opened again with its plan kept under the right stamp fetches nothing', i2.status === 'in-step' && i2.kept === true && fetched() === g && again.keptPuts === 0, [i2.kept, fetched() - g, again.keptPuts]); }
  { // the one fetch fails (no connection for a moment): it is tried again at the next look, not left until the page is opened again
    const lost = keeping(browser(wk, 'desk')); lost.saved = d2.saved; lost.plan = d2.plan; lost.make();
    const real = wk.fetch; let failed = 0;
    wk.fetch = async (url, init = {}) => { if (!failed && String(url).endsWith('/plan') && (init.method || 'GET') === 'GET') { failed++; throw new TypeError('Failed to fetch'); } return real(url, init); };
    const i3 = await lost.sync.start(), i4 = await lost.sync.run('poll'); wk.fetch = real;
    check('a fetch of the plan to keep that fails is tried again at the next look', failed === 1 && i3.kept === false && i3.status === 'in-step' && i4.kept === true && !!lost.keptRec && lost.keptRec.etag === baseOf(lost), [failed, i3.status, i3.kept, i4.kept]); }
  { // the cloud moves between the look and the fetch: what comes back is not the plan this browser is in step with, and is not kept as if it were
    const late = keeping(browser(wk, 'desk')); late.saved = d2.saved; late.plan = d2.plan; late.make();
    const real = wk.fetch; let moved = false;
    wk.fetch = async (url, init = {}) => { if (!moved && String(url).endsWith('/plan') && (init.method || 'GET') === 'GET') { moved = true; await ph.sync.run('poll'); await ph.sync.openCloud(); await ph.change('k-moved-meanwhile'); } return real(url, init); };
    const i5 = await late.sync.start(); wk.fetch = real;
    check('a plan fetched after the cloud has moved is not kept under the older stamp', moved && i5.kept === false && late.keptRec === null && (await late.sync.keptPlan()) === null, [moved, i5.kept, late.keptRec && late.keptRec.etag]);
    await d2.sync.run('poll'); await d2.sync.openCloud(); }
  // the page ended between keeping the plan and noting the stamp: what is kept is under another stamp
  d2.keptRec = { ...d2.keptRec, etag: 'a-stamp-nobody-noted' };
  check('a plan kept under another stamp than the one this browser is in step with is not the plan to compare with', (await d2.sync.keptPlan()) === null);
  const d3 = keeping(browser(wk, 'desk')); d3.saved = d2.saved; d3.plan = d2.plan; d3.keptRec = d2.keptRec; d3.make();
  i = await d3.sync.start();
  check('at the next start it is replaced by the cloud\'s plan', i.kept === true && d3.keptRec.etag === baseOf(d3) && d3.keptRec.text === (await cloudText()) && !!(await d3.sync.keptPlan()));
  // the browser's database refuses the write
  n = fetched(); d3.keptFull = true; i = await d3.change('k-no-room');
  check('a kept plan that cannot be written stops nothing: the change is sent, and the page knows it has no plan to compare with, and why', i.status === 'in-step' && (await cloudText()).includes('k-no-room') && i.kept === false && /full/.test(i.keptNote) && d3.keptRec === null && (await d3.sync.keptPlan()) === null, [i.status, i.kept, i.keptNote]);
  await d3.sync.run('poll'); await d3.sync.run('poll'); await d3.sync.run('poll');
  check('and the cloud is not asked for the plan it could not keep: not at the next look, nor at any', fetched() === n && d3.sync.info().status === 'in-step', fetched() - n);
  { const d4 = keeping(browser(wk, 'desk')); d4.saved = d3.saved; d4.plan = d3.plan; d4.keptFull = true; d4.make();
    n = fetched(); await d4.sync.start(); await d4.sync.run('poll'); await d4.sync.run('poll');
    check('a page opened on a database that refuses fetches the plan once, not at every look', fetched() === n + 1 && d4.sync.info().kept === false, fetched() - n); }
  d3.keptFull = false; i = await d3.change('k-room-again');
  check('and the next send keeps it again', i.kept === true && d3.keptRec.text === (await cloudText()) && i.keptNote === '');
  // the browser's database never answers (it has happened as a page starts): the send is not left waiting for it
  { const wh = world(), h = keeping(browser(wh, 'hangs', planOf(3, 'h'))); h.keptHangs = true;
    const waited = work => Promise.race([work, new Promise(resolve => setTimeout(() => resolve({ status: 'still waiting for the database' }), 2500))]);   // so that a send left waiting fails this line by name, and the test goes on
    const first = await waited(h.sync.connect(URL_, KEY, 'H')), puts = h.keptPuts, second = await waited(h.change('h-after'));
    check('a database that never answers is waited for once, and the plan is sent and in step all the same', first.status === 'in-step' && first.kept === false && /did not answer/.test(first.keptNote) && second.status === 'in-step' && (await wh.text('plan')).includes('h-after'), [first.status, first.kept, first.keptNote, second.status]);
    const asked = await waited(h.sync.keptPlan());
    check('and it is not asked again while that page is open, for the kept plan either', puts === 1 && h.keptPuts === 1 && !h.timers.some(t => t.ms === Sync.timing.kept) && asked === null && !h.keptGets, [puts, h.keptPuts, asked, h.keptGets]); }
  // the note of being in step is written before the plan is kept: a page that ends between the two is in step, and fetches the plan at its next look
  { const wn = world(), e = keeping(browser(wn, 'ends', planOf(3, 'e'))), noted = [], put = e.env.kept.put;
    e.env.kept.put = async r => { noted.push(JSON.parse(e.saved).base || null); return put(r); };
    await e.sync.connect(URL_, KEY, 'E');
    check('the stamp is noted before the plan is kept under it, and the plan is kept once', noted.length === 1 && noted[0] !== null && noted[0] === wn.store.get('plan').etag && e.keptRec.etag === noted[0], noted); }
  // the plan here no longer comes from the kept plan: a whole plan was loaded over it, or it is behind what was noted
  check('with the plan here made from it, the kept plan is the plan to compare with', !!(await d3.sync.keptPlan()));
  d3.loads++; const afterLoad = await d3.sync.keptPlan(); d3.loads--;
  check('after a whole plan is loaded over the open one, the kept plan is not handed out as the plan it came from', afterLoad === null && !!(await d3.sync.keptPlan()));
  { // a whole plan loaded while the kept plan is being read: it is not handed out either
    const get = d3.env.kept.get; let release; d3.env.kept.get = () => new Promise(resolve => { release = () => resolve(get()); });
    const asked = d3.sync.keptPlan(); await new Promise(resolve => setTimeout(resolve, 1)); d3.loads++; release(); const got = await asked; d3.loads--; d3.env.kept.get = get;
    check('a whole plan loaded while the kept plan is being read: it is not handed out', got === null && !!(await d3.sync.keptPlan()), got && got.etag); }
  { const wb = world(), c = stored(keeping(browser(wb, 'c', planOf(3, 'c')))); await c.sync.connect(URL_, KEY, 'C'); await c.edit('sent-and-stored');
    c.disk = { plan: { ...c.disk.plan, plantings: c.disk.plan.plantings.slice(0, 2) }, n: c.disk.n - 1 };
    const c2 = c.start(); c2.env.kept = c.env.kept; c2.make(); const ib = await c2.sync.start();
    check('nor for a stored plan that is behind what was noted', ib.status === 'conflict' && !!c.keptRec && (await c2.sync.keptPlan()) === null, [ib.status, !!c.keptRec]); }
  { // a whole plan is loaded over the open one while the plan just sent is being kept: the next send still says it replaces a different plan
    const wl = world(), L = keeping(browser(wl, 'loads', planOf(3, 'l'))), put = L.env.kept.put; let bump = false;
    L.env.kept.put = async r => { if (bump) { bump = false; L.plan = planOf(2, 'backup'); L.loads++; } return put(r); };
    await L.sync.connect(URL_, KEY, 'L'); bump = true; await L.change('l-sent');
    L.sync.touch(); const il = await L.tick();
    check('a whole plan loaded while the sent plan was being kept is still sent as a plan that replaces another: the cloud keeps the one it replaces', il.status === 'in-step' && (await wl.text('plan')).includes('backup-0') && [...wl.store.keys()].some(k => k.startsWith('snap/auto-')), [il.status, [...wl.store.keys()]]); }
  // a window that only shows the plan leaves the kept plan alone, even when it is told to leave the cloud; leaving, in the window that holds the plan, forgets it
  const was = d3.keptRec; d3.held = true; d3.host.readOnly = () => true;
  await d3.sync.run('poll'); d3.sync.disconnect(); await new Promise(resolve => setTimeout(resolve, 5));
  check('a window that only shows the plan leaves the kept plan as it is', d3.keptRec === was && was !== null);
  d3.held = false; delete d3.host.readOnly; d3.saved = d2.saved; d3.make(); await d3.sync.start();
  d3.sync.disconnect(); await new Promise(resolve => setTimeout(resolve, 5));
  check('disconnecting forgets the kept plan', d3.keptRec === null && (await d3.sync.keptPlan()) === null);
}

// ── a page that was not reloaded after a release meets a plan a newer planner has written (the service's version 3) ──
for (const [Impl, which] of [[Sync, 'this build'], [Before, 'the build before']]) {
  const SENTENCE = 'This device is running an older planner. Reload the page.';
  if (!Impl) { check(`${which}: its client was found`, false, 'give the folder of the build before\'s scripts as the second argument'); continue; }
  const wo = world(), o = browser(wo, 'old', planOf(3, 'o'), Impl);
  await o.sync.connect(URL_, KEY, 'Old page');
  // a newer planner, on another device, writes the plan with its number
  const note = JSON.parse(o.saved), newer = JSON.stringify({ ...planOf(3, 'o'), plantings: [...planOf(3, 'o').plantings, { id: 'from-the-newer-planner' }] });
  const res = await wo.fetch(URL_ + '/plan', { method: 'PUT', body: newer, headers: { authorization: 'Bearer ' + note.token, 'x-lrf-base': note.base, 'x-lrf-meta': encodeURIComponent(JSON.stringify({ savedAt: new Date().toISOString(), device: 'd-newer', plantings: 4, m: 99, enc: 'none' })) } });
  o.plan = { ...o.plan, plantings: [...o.plan.plantings, { id: 'made-on-the-old-page' }] };
  const sendsBefore = wo.calls.length, info1 = await o.sync.run('change');   // the send a few seconds after a change, and what the page shows right after it
  check(`${which}, as an older page: its send is refused, the service's sentence is what it shows, and the cloud's plan is untouched`, res.status === 200 && info1.status === 'error' && info1.error === SENTENCE && (await wo.text('plan')) === newer && wo.calls.length > sendsBefore, [res.status, info1.status, info1.error]);
  check(`${which}, as an older page: it stays signed in, and keeps its own change`, /"token":"v1\./.test(o.saved) && o.sync.info().configured && o.plan.plantings.some(x => x.id === 'made-on-the-old-page'));
  const info2 = await o.sync.run('poll');
  const kept = await o.sync.keepMine(), info3 = o.sync.info();
  check(`${which}, as an older page: at its next look it asks which plan to keep, and "keep this plan" is refused the same way`, info2.status === 'conflict' && kept === false && info3.status === 'error' && info3.error === SENTENCE && (await wo.text('plan')) === newer && ![...wo.store.keys()].some(x => x.startsWith('snap/auto-')), [info2.status, kept, info3.status]);
  check(`${which}, as an older page: it can still open the cloud's plan`, (await o.sync.openCloud()) === true && o.plan.plantings.some(x => x.id === 'from-the-newer-planner') && o.sync.info().status === 'in-step');
}

// ── two devices that both changed the plan: joined, record by record (the switch, the order of taking in, the messages) ──
/** A device that can join: the merge's own code on the plan it holds, a plan kept first, a save that can be refused, a page that can be busy. */
function joining(b) {
  Object.assign(b, { befores: [], took: [], busy: false, saveFails: false, joins: 0 });
  b.host.idle = () => !b.busy;
  b.host.join = async (startText, theirsText) => {
    b.joins++;
    const r = Merge.joinTexts(startText, JSON.stringify(b.plan), theirsText);
    if (!r.ok) return { ok: false, why: r.why };
    b.befores.push(b.plan);                                              // the plan that was here is kept first
    if (b.saveFails) return { ok: false, stop: true, why: 'There is no room to save the joined plan.' };
    if (b.busyLate) return { ok: false, later: true };                    // a window was opened while the plans were being joined
    b.plan = JSON.parse(r.text); if (b.disk) b.disk = { plan: b.plan, n: b.disk.n + 1 };
    return { ok: true, same: r.same, key: b.host.key(), taken: r.taken, report: r.report };
  };
  b.host.taken = t => b.took.push(t);
  return b;
}
const ids = plan => plan.plantings.map(p => p.id);
const plus = (b, id) => { b.plan = { ...b.plan, plantings: [...b.plan.plantings, { id }] }; };   // a change made here, not yet sent
const putsOf = wx => wx.calls.filter(c => c === 'PUT /plan').length, noteOf = b => JSON.parse(b.saved || '{}'), metaOf = wx => JSON.parse(wx.store.get('plan').customMetadata.m);
async function pair(tag, joinA = true, joinB = true) {
  const wj = world(), ja = joining(keeping(browser(wj, tag + '-laptop', planOf(3, tag)))), jb = joining(keeping(browser(wj, tag + '-phone')));
  await ja.sync.connect(URL_, KEY, 'Laptop'); await jb.sync.connect(URL_, KEY, 'Phone');
  if (joinA) await ja.sync.setJoin(true); if (joinB) await jb.sync.setJoin(true);
  return { wj, ja, jb };
}
{
  const { wj, ja, jb } = await pair('j1');
  check('a device starts on "Ask me which plan to keep", and the switch is kept with what this browser remembers', browser(world(), 'fresh', planOf(1, 'f')).sync.info().join === false && ja.sync.info().join === true && noteOf(ja).join === true && ja.sync.info().canJoin === true, ja.sync.info());
  await ja.change('laptop-moved-a-bed');
  plus(jb, 'phone-ticked-a-sowing'); jb.sync.touch();
  let i = await jb.tick();
  const cloud = JSON.parse(await wj.text('plan')), merges = [...wj.store.keys()].filter(k => k.startsWith('snap/merge-'));
  check('both changed: the two plans are joined, the joined plan is open here and sent, and neither change is lost', i.status === 'in-step' && ['laptop-moved-a-bed', 'phone-ticked-a-sowing'].every(x => ids(jb.plan).includes(x) && ids(cloud).includes(x)) && jb.joins === 1, [i.status, ids(jb.plan), ids(cloud)]);
  check('the plan that was here is kept before anything is taken in, and what was taken in is said, with the device it came from', jb.befores.length === 1 && !ids(jb.befores[0]).includes('laptop-moved-a-bed') && jb.took.length === 1 && jb.took[0].from === 'Laptop' && jb.took[0].taken.added === 1 && jb.took[0].same === false, jb.took);
  check('the joined plan says it is one, and the cloud keeps the plan it replaced', metaOf(wj).merged === true && metaOf(wj).m === Sync.KNOWS && merges.length === 1 && ids(JSON.parse(await wj.text(merges[0]))).includes('laptop-moved-a-bed') && !ids(JSON.parse(await wj.text(merges[0]))).includes('phone-ticked-a-sowing'), [metaOf(wj), merges]);
  check('the plan to compare with is the joined plan the cloud now holds', jb.sync.info().kept === true && jb.keptRec.text === (await wj.text('plan')) && jb.keptRec.etag === noteOf(jb).base);
  const puts = putsOf(wj);
  i = await ja.sync.run('poll');
  check('the other device, unchanged, takes the joined plan in by itself: nothing is opened whole, and nothing is sent', i.status === 'in-step' && ids(ja.plan).includes('phone-ticked-a-sowing') && ja.opened.length === 0 && ja.took.length === 1 && ja.took[0].same === true && putsOf(wj) === puts, [i.status, ja.opened.length, putsOf(wj) - puts]);
  await ja.sync.run('poll'); await jb.sync.run('poll'); await ja.tick(); await jb.tick();
  check('after both hold the same joined plan, further looks send nothing and join nothing', putsOf(wj) === puts && ja.joins === 1 && jb.joins === 1, [putsOf(wj) - puts, ja.joins, jb.joins]);
  // not while the page is busy
  await ja.change('laptop-again'); jb.busy = true; plus(jb, 'phone-again'); jb.sync.touch();
  i = await jb.tick();
  check('while something is being dragged or a window is open, nothing is taken in: it waits', i.status === 'joining' && jb.joins === 1 && !ids(jb.plan).includes('laptop-again'), [i.status, jb.joins]);
  jb.busy = false; i = await jb.tick();
  check('and is taken in at the next pause', i.status === 'in-step' && ids(jb.plan).includes('laptop-again') && ids(JSON.parse(await wj.text('plan'))).includes('phone-again'), [i.status, ids(jb.plan)]);
  // the joined plan cannot be saved here
  await ja.sync.run('poll'); await ja.change('laptop-third');
  const baseWas = noteOf(jb).base, cloudWas = wj.store.get('plan').etag, tookWas = jb.took.length; jb.saveFails = true; plus(jb, 'phone-third'); jb.sync.touch();
  i = await jb.tick();
  check('a joined plan that cannot be saved here is not noted and not sent: nothing else happens', i.status === 'error' && noteOf(jb).base === baseWas && wj.store.get('plan').etag === cloudWas && !ids(jb.plan).includes('laptop-third') && jb.took.length === tookWas, [i.status, i.error]);
  jb.saveFails = false; i = await jb.sync.run('poll');
  check('and is joined at the next look, once it can be saved', i.status === 'in-step' && ids(jb.plan).includes('laptop-third') && ids(JSON.parse(await wj.text('plan'))).includes('phone-third'), i.status);
  // a page that ended after the joined plan was saved here and before it was noted: joined again, to the same plan
  await ja.sync.run('poll'); await ja.change('laptop-fourth');
  plus(jb, 'phone-fourth');
  const half = Merge.joinTexts(jb.keptRec.text, JSON.stringify(jb.plan), await wj.text('plan'));
  jb.plan = JSON.parse(half.text); jb.sync.touch();
  i = await jb.tick();
  const after = ids(JSON.parse(await wj.text('plan')));
  check('a joined plan saved here and not yet noted is joined again to the same plan: nothing twice, nothing lost', i.status === 'in-step' && after.length === new Set(after).size && ['laptop-fourth', 'phone-fourth'].every(x => after.includes(x)), after);
  // the cloud moves again while the joined plan is on its way
  await ja.sync.run('poll'); await ja.change('laptop-fifth');
  plus(jb, 'phone-fifth'); jb.sync.touch();
  const real = wj.fetch; let once = true;
  wj.fetch = async (url, init = {}) => { if (once && (init.method || 'GET') === 'PUT' && String(url).endsWith('/plan') && init.headers && /merged/.test(decodeURIComponent(init.headers['x-lrf-meta'] || ''))) { once = false; wj.fetch = real; await ja.change('laptop-sixth'); } return real(url, init); };
  i = await jb.sync.run('poll'); wj.fetch = real;
  check('the cloud moved again while the joined plan was on its way: nothing is asked, and the join is set to be made again', i.status === 'joining' && jb.timers.some(t => t.ms === 200), [i.status, jb.timers.map(t => t.ms)]);
  i = await jb.tick();
  const last = ids(JSON.parse(await wj.text('plan')));
  check('and joined once more, all three changes are kept', i.status === 'in-step' && ['laptop-fifth', 'laptop-sixth', 'phone-fifth'].every(x => last.includes(x) && ids(jb.plan).includes(x)), [i.status, last.slice(-4)]);
}
{ // the switch off: as before there was a join
  const { wj, ja, jb } = await pair('j2', true, false);
  await ja.change('laptop-1'); plus(jb, 'phone-1'); jb.sync.touch();
  const i = await jb.tick();
  check('on a device left on "Ask me", both changed is the question it always was: nothing joined, nothing sent', i.status === 'conflict' && jb.joins === 0 && !ids(JSON.parse(await wj.text('plan'))).includes('phone-1') && i.join === false);
  const j = await jb.sync.setJoin(true);
  check('turned on there, the plan that waited for the choice is joined at once', j.status === 'in-step' && jb.joins === 1 && ['laptop-1', 'phone-1'].every(x => ids(jb.plan).includes(x)), j.status);
  await jb.sync.setJoin(false); await ja.change('laptop-2'); plus(jb, 'phone-2'); jb.sync.touch();
  check('and turned off again, it asks again', (await jb.tick()).status === 'conflict' && jb.joins === 1 && noteOf(jb).join === undefined);
}
{ // no device joins: what is sent is what was sent before
  const { wj, ja, jb } = await pair('j3', false, false);
  await ja.change('laptop-1'); await jb.sync.run('poll'); await jb.sync.openCloud(); await jb.change('phone-1');
  const m = metaOf(wj);
  check('where no device is set to join, a plan carries no planner\'s number and no line, and a page of the build before can still send', m.m === undefined && m.line === undefined && m.merged === undefined, m);
}
{ // nothing to join from, and a whole plan
  const wj = world(), ja = joining(keeping(browser(wj, 'j4-laptop', planOf(3, 'j4')))), jb = joining(browser(wj, 'j4-phone'));
  await ja.sync.connect(URL_, KEY, 'Laptop'); await jb.sync.connect(URL_, KEY, 'Phone'); await ja.sync.setJoin(true); await jb.sync.setJoin(true);
  await ja.change('laptop-1'); plus(jb, 'phone-1'); jb.sync.touch();
  let i = await jb.tick();
  check('a device with no plan kept to compare with does not join: it asks, and says why', i.status === 'conflict' && jb.joins === 0 && /started from|no database|compare/.test(i.joinNote), [i.status, i.joinNote]);
  // a whole plan loaded on one device is never joined with the plan on another
  const { wj: w2, ja: a2, jb: b2 } = await pair('j5');
  a2.plan = planOf(4, 'restored'); a2.loads++; a2.sync.touch(); await a2.tick();
  const line = metaOf(w2).line;
  const fetched = () => w2.calls.filter(c => c === 'GET /plan').length, fetchedWas = fetched();
  plus(b2, 'phone-1'); b2.sync.touch(); i = await b2.tick();
  check('a whole plan loaded on another device starts a new line, and is never joined: the page asks, and does not even fetch it', typeof line === 'string' && line.length > 6 && i.status === 'conflict' && b2.joins === 0 && /whole plan/i.test(i.joinNote) && !ids(b2.plan).includes('restored-0') && fetched() === fetchedWas, [line, i.status, i.joinNote, fetched() - fetchedWas]);
  check('choosing the cloud\'s plan there takes its line, and the two devices join again from it', (await b2.sync.openCloud()) === true && noteOf(b2).line === line);
  await a2.change('laptop-after'); plus(b2, 'phone-after'); b2.sync.touch(); i = await b2.tick();
  check('and an ordinary send carries the line on', i.status === 'in-step' && b2.joins === 1 && metaOf(w2).line === line && ['laptop-after', 'phone-after'].every(x => ids(b2.plan).includes(x)), [i.status, metaOf(w2).line]);
}
{ // a send whose answer was lost is settled before any join
  const { wj, ja, jb } = await pair('j6');
  const real = wj.fetch; let lose = true;
  wj.fetch = async (url, init = {}) => { const out = await real(url, init); if (lose && (init.method || 'GET') === 'PUT' && String(url).endsWith('/plan')) { lose = false; throw new TypeError('Failed to fetch'); } return out; };
  plus(ja, 'sown-and-sent'); ja.sync.touch();
  let i = await ja.sync.run('change');
  check('a send lands and its answer is lost: this browser waits, still noting the plan before it', i.status === 'waiting' && ids(JSON.parse(await wj.text('plan'))).includes('sown-and-sent') && !!noteOf(ja).sent && noteOf(ja).base !== wj.store.get('plan').etag, [i.status, noteOf(ja).sent]);
  wj.fetch = real;
  ja.plan = { ...ja.plan, plantings: ja.plan.plantings.filter(p => p.id !== 'sown-and-sent') };   // and the sowing is undone here before the next look
  i = await ja.sync.run('retry');
  check('at the next look the cloud\'s plan is known as this browser\'s own send, not another device\'s: nothing is joined, and what was undone here since is sent as undone', i.status === 'in-step' && ja.joins === 0 && !ids(JSON.parse(await wj.text('plan'))).includes('sown-and-sent') && noteOf(ja).sent === undefined && ja.keptRec.text === (await wj.text('plan')), [i.status, ja.joins, ids(JSON.parse(await wj.text('plan')))]);
  // a send that never landed is forgotten
  wj.down = true; plus(ja, 'never-sent'); ja.sync.touch(); await ja.sync.run('change'); wj.down = false;
  await jb.change('phone-1');
  i = await ja.sync.run('retry');
  const landed = ids(JSON.parse(await wj.text('plan')));
  check('a send that never landed is not taken for the cloud\'s plan: the two are joined, and that send is forgotten', i.status === 'in-step' && ja.joins === 1 && ['never-sent', 'phone-1'].every(x => landed.includes(x)) && noteOf(ja).sent === undefined, [i.status, ja.joins, noteOf(ja).sent]);
}
{ // what the review of this build found
  const { wj, ja, jb } = await pair('j8', true, false);
  check('a device set to join says the planner\'s number at once, before any change is made: from then on a planner that knows nothing of lines cannot write', metaOf(wj).m === Sync.KNOWS && ja.sync.info().status === 'in-step', metaOf(wj));
  // a plan in the cloud that carries no number (sent by a page that knows nothing of lines, perhaps a whole plan loaded there) is never joined
  const whole = await Sync.pack(JSON.stringify(planOf(2, 'backup-from-an-old-page')));
  await wj.bucket.put('plan', whole.bytes, { customMetadata: { m: JSON.stringify({ savedAt: new Date().toISOString(), device: 'd-old', label: 'Old page', plantings: 2, enc: whole.enc }) } });
  plus(ja, 'made-here'); ja.sync.touch();
  let i = await ja.tick();
  check('a plan in the cloud that carries no planner\'s number is never joined, though neither it nor this browser names a line: the page asks', i.status === 'conflict' && ja.joins === 0 && /older planner/.test(i.joinNote) && !ids(ja.plan).includes('backup-from-an-old-page-0'), [i.status, ja.joins, i.joinNote]);
  // a whole plan loaded here while the cloud's plan is being fetched
  const { wj: w2, ja: a2, jb: b2 } = await pair('j9');
  await a2.change('laptop-1'); plus(b2, 'phone-1');
  let real = w2.fetch;
  w2.fetch = async (url, init = {}) => { const out = await real(url, init); if ((init.method || 'GET') === 'GET' && String(url).endsWith('/plan')) { w2.fetch = real; b2.plan = planOf(2, 'loaded-here'); b2.loads++; } return out; };
  i = await b2.sync.run('poll'); w2.fetch = real;
  check('a whole plan loaded here while the cloud\'s was being fetched is not joined with it', i.status === 'conflict' && b2.joins === 0 && /whole plan/i.test(i.joinNote), [i.status, b2.joins, i.joinNote]);
  // the page stopped being idle while the plans were joined; and a busy page does not ask the cloud again and again
  const { wj: w3, ja: a3, jb: b3 } = await pair('j10');
  await a3.change('laptop-1'); plus(b3, 'phone-1'); b3.busyLate = true;
  i = await b3.sync.run('poll');
  check('a window opened while the plans were being joined: nothing is noted or sent, and it waits for the next pause', i.status === 'joining' && !ids(JSON.parse(await w3.text('plan'))).includes('phone-1') && b3.timers.some(t => t.ms === Sync.timing.idle), [i.status, b3.timers.map(t => t.ms)]);
  b3.busy = true;
  const looks = () => w3.calls.filter(c => c === 'GET /state').length, looksWas = looks();
  for (let n = 0; n < 5; n++) { const due = b3.timers.filter(t => t.ms === Sync.timing.idle); b3.timers = b3.timers.filter(t => !due.includes(t)); for (const t of due) t.fn(); await new Promise(r => setTimeout(r, 5)); }
  check('while the page stays busy the cloud is not asked again: it waits, and looks once the page is idle', looks() === looksWas && b3.sync.info().status === 'joining' && b3.timers.some(t => t.ms === Sync.timing.idle), [looks() - looksWas, b3.sync.info().status]);
  b3.busy = false; b3.busyLate = false; i = await b3.tick();
  check('and then joins', i.status === 'in-step' && ['laptop-1', 'phone-1'].every(x => ids(b3.plan).includes(x)), i.status);
  // a joined plan whose send failed for want of a connection is still sent as a joined plan
  await a3.sync.run('poll'); await a3.change('laptop-2'); plus(b3, 'phone-2');
  const mergesWas = [...w3.store.keys()].filter(k => k.startsWith('snap/merge-')).length;
  real = w3.fetch;
  w3.fetch = async (url, init = {}) => { if ((init.method || 'GET') === 'PUT' && String(url).endsWith('/plan')) throw new TypeError('Failed to fetch'); return real(url, init); };
  i = await b3.sync.run('poll'); w3.fetch = real;
  const waited = i.status;
  i = await b3.sync.run('retry');
  const landed3 = ids(JSON.parse(await w3.text('plan')));
  check('a joined plan that could not be sent at once is sent as a joined plan when the connection is back: the cloud keeps the plan it replaces', waited === 'waiting' && i.status === 'in-step' && metaOf(w3).merged === true && [...w3.store.keys()].filter(k => k.startsWith('snap/merge-')).length === mergesWas + 1 && ['laptop-2', 'phone-2'].every(x => landed3.includes(x)), [waited, i.status, metaOf(w3).merged]);
}
if (Before) { // once a device joins, a page of the build before is told to reload; a page of this build that does not join is not
  const { wj, ja, jb } = await pair('j7', true, false);
  const old = browser(wj, 'j7-old', null, Before); await old.sync.connect(URL_, KEY, 'Old page');
  await ja.change('laptop-1');                                        // carries the planner's number
  const before = await wj.text('plan');
  let i = await old.change('old-1');
  check('once a device that joins has sent, a page of the build before is refused in the service\'s own sentence and stays signed in', i.status !== 'in-step' && (await wj.text('plan')) === before && old.sync.info().configured === true, [i.status, i.error]);
  plus(jb, 'phone-before-looking');                                    // it has not yet seen that the cloud's plan carries a number
  i = await jb.sync.run('change');
  check('a page of this build that had not yet seen the number is not told to reload: it looks again', i.status === 'checking' && !/older planner/.test(i.error || '') && jb.timers.some(t => t.ms === 50), [i.status, i.error]);
  i = await jb.tick();
  check('and asks as it would have', i.status === 'conflict', i.status);
  await jb.sync.openCloud();
  i = await jb.change('phone-1');
  check('a page of this build left on "Ask me" still sends: it says the planner\'s number once the cloud\'s plan carries one', i.status === 'in-step' && ids(JSON.parse(await wj.text('plan'))).includes('phone-1') && metaOf(wj).m === Sync.KNOWS, [i.status, i.error, metaOf(wj)]);
}

// ── leaving ──
a.sync.disconnect();
check('and after disconnecting the reader gets nothing', a.sync.linkService() === null);
check('disconnecting forgets the address and the sign-in here, and leaves the cloud alone', a.saved === null && a.sync.info().status === 'off' && w.store.has('plan'));
info = await a.change('after-leaving'); check('and nothing more is sent', info.status === 'off' && !(await w.text('plan')).includes('after-leaving'));

