// The planner's sync client (js/sync.js) and the sync Worker's own code together, in Node: two or three "browsers" with
// made-up plans, a stand-in bucket, and no network. usage: node tools/sync_client_test.mjs [dir holding sync.js]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/lrf-plan-sync.js';
import { fakeBucket } from './fake_r2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const Sync = require(path.resolve(process.argv[2] || path.join(here, '..', 'js'), 'sync.js'));
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
function browser(w, name, plan) {
  const b = { name, plan: plan || null, loads: 0, said: [], opened: [], gotPhotos: [], map: null, thumbs: null, held: false, saved: null, timers: [], openOk: true };
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
  b.make = () => { b.sync = Sync.create(host, env); return b.sync; };
  /** Let the waiting timers fire (a send a few seconds after a change, a retry), but not a request's own time limit. */
  b.tick = async () => { for (let i = 0; i < 6; i++) { const due = b.timers.filter(t => t.ms < 400000 && t.ms !== Sync.timing.timeout); if (!due.length) break; b.timers = b.timers.filter(t => !due.includes(t)); for (const t of due) t.fn(); await b.sync.run('settle').catch(() => {}); } return b.sync.info(); };
  b.change = async edit => { b.plan = { ...b.plan, plantings: [...b.plan.plantings, { id: edit }] }; b.sync.touch(); return b.tick(); };
  b.make();
  return b;
}
const planOf = (n, tag) => ({ plantings: Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}`, crop: 'lettuce' })), settings: { year: 2027 } });
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
  check('a signed-in device hands the reader the service\'s address, its token and the version the service said', !!ls && ls.base === b.sync.info().url && /^v1\./.test(ls.key) && ls.v === 2 && ls.key !== KEY, ls && { base: ls.base, v: ls.v });
  check('a device that is not connected hands it nothing', fresh.make().linkService() === null);
}
// ── leaving ──
a.sync.disconnect();
check('and after disconnecting the reader gets nothing', a.sync.linkService() === null);
check('disconnecting forgets the address and the sign-in here, and leaves the cloud alone', a.saved === null && a.sync.info().status === 'off' && w.store.has('plan'));
info = await a.change('after-leaving'); check('and nothing more is sent', info.status === 'off' && !(await w.text('plan')).includes('after-leaving'));

