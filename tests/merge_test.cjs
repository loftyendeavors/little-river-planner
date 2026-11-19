'use strict';
// Two copies of one plan joined, record by record (js/merge.js), without a browser.
// Every edit below is made with the planner's own functions (the week's record and take back, the seed library's lots), on
// the made-up farm, by one of two made-up devices: "mine" (this device) and "theirs" (the one that reached the cloud first).
//   1. the rules, one case each: by shape, the exceptions, a recording as one unit, seed on hand
//   2. the five tests a joined plan must pass, each fed a plan that breaks it
//   3. the farm holds no list of records that the merge does not know how to join
//   4. some 500 pairs of made-up runs of edits, held to six properties
// usage: node merge_test.cjs <app-dir> <plan.json: a backup's> <inventory.json>      env LRF_PAIRS=40 for fewer pairs (the deliberate faults use it)
const path = require('path'), fs = require('fs');
const [APP, PLAN, STOCK] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 4).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 900)}`); if (!ok) fail.push(name); };
/** A case that throws is one failed line, by its name, and the rest still run. */
const tryCase = (name, run) => { try { const out = run(); check(name, out === true || (Array.isArray(out) && out[0] === true), Array.isArray(out) ? out[1] : out); } catch (e) { check(name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L; require(path.join(APP, 'js/guide.js'));
const F = require(path.join(APP, 'js/forecast.js')), SL = require(path.join(APP, 'js/seedlib.js')), W = require(path.join(APP, 'js/week.js'));
const M = require(path.join(APP, 'js/merge.js')), TR = require(path.join(APP, 'js/trays.js'));
const clone = x => JSON.parse(JSON.stringify(x));
const split = IO.split(JSON.parse(fs.readFileSync(PLAN, 'utf8')));
const FARM = Object.freeze({ ...split.core, seedInventory: JSON.parse(fs.readFileSync(STOCK, 'utf8')) });

// ── the two devices, and the edits they make ──
/** A device: its own clock and its own ids, so that nothing two devices make is alike by chance and every run is the same run. */
function device(name, hour) {
  let n = 0, tick = 0;
  return { name, uid: () => `${name}-${(++n).toString(36).padStart(4, '0')}`, now: () => new Date(Date.UTC(2027, 2, 1, hour, 0, tick++)).toISOString() };
}
const ctxOf = dev => ({ now: dev.now(), uid: dev.uid, year: 2027, name: '', today: '2027-12-31' });
const eng = plan => E.create(plan, Lib);
const planting = (plan, id) => plan.plantings.find(p => p.id === id);
const putPlanting = (plan, p) => ({ ...plan, plantings: plan.plantings.map(q => (q.id === p.id ? p : q)) });
const lot = (plan, id) => plan.seedInventory.lots.find(l => l.id === id);
const setP = (plan, id, change) => { const p = { ...planting(plan, id) }; for (const [k, v] of Object.entries(change)) { if (v === undefined) delete p[k]; else p[k] = v; } return putPlanting(plan, p); };
/** Record a job as the Tasks page does: the planting and the seed on hand change in one step. */
function record(plan, id, kind, date, dev, input = {}) {
  const r = W.record(eng(plan), plan.seedInventory, planting(plan, id), kind, { date, ...input }, ctxOf(dev));
  return { ...putPlanting(plan, r.planting), ...(r.inventory ? { seedInventory: r.inventory } : {}) };
}
function takeBack(plan, id, kind, dev) {
  const r = W.takeBack(eng(plan), plan.seedInventory, planting(plan, id), kind, ctxOf(dev));
  return { ...putPlanting(plan, r.planting), ...(r.inventory ? { seedInventory: r.inventory } : {}) };
}
const countLot = (plan, id, q, dev) => ({ ...plan, seedInventory: SL.updateLot(plan.seedInventory, id, { quantity: q }, 'count', ctxOf(dev)) || plan.seedInventory });
const addLot = (plan, key, q, dev) => ({ ...plan, seedInventory: SL.addLot(plan.seedInventory, { key, unit: 'seeds', quantity: q, status: 'usable' }, ctxOf(dev)) });
const draws = (plan, lotId) => plan.plantings.reduce((n, p) => n + ((p.workflow && p.workflow.seedUse) || []).reduce((m, u) => m + (u.lotId === lotId ? u.quantity : 0), 0), 0);
const loose = (plan, id) => ((planting(plan, id).workflow || {}).seedUse || []).filter(u => u.lotId == null).reduce((n, u) => n + u.quantity, 0);
const items = (r, kind) => r.report.items.filter(x => x.kind === kind);

// ── subjects, found on the farm and named nowhere ──
const e0 = eng(FARM);
const sowable = FARM.plantings.map(p => ({ p, s: SL.sowing(e0, p) })).filter(x => x.s && x.s.kind === 'sow' && !x.p.liveTray && x.s.stockUnit === 'seeds' && x.s.estimate > 0)
  .map(x => ({ id: x.p.id, key: x.s.key, need: x.s.estimate, planned: E.d2s(x.s.planned), lots: SL.lotsFor(FARM.seedInventory, x.s.key).filter(l => l.unit === 'seeds' && l.life === 'usable' && l.usable === true && Number(l.quantity) > 0) }))
  .filter(x => x.lots.length === 1 && x.planned.slice(0, 4) === '2027');
const byKey = new Map();
for (const x of sowable) byKey.set(x.key, [...(byKey.get(x.key) || []), x]);
// two sowings of one variety whose one lot covers both; and two whose lot covers either alone and not both
const ample = [...byKey.values()].find(v => v.length >= 3 && v[0].lots[0].quantity >= v[0].need + v[1].need + v[2].need);
const tight = [...byKey.values()].find(v => v.length >= 2 && v !== ample && v[0].lots[0].quantity >= Math.max(v[0].need, v[1].need) && v[0].lots[0].quantity < v[0].need + v[1].need);
check('the farm has three sowings of one variety that one lot covers, and two of another that its lot covers one at a time', !!ample && !!tight, { ample: !!ample, tight: !!tight });
if (!ample || !tight) { finished = true; process.exit(1); }
const [A1, A2, A3] = ample, [T1, T2] = tight, LOT = ample[0].lots[0].id, HELD = ample[0].lots[0].quantity, SMALL = tight[0].lots[0].id, SMALLQ = tight[0].lots[0].quantity;
const plain = FARM.plantings.filter(p => !p.liveTray && !p.bedLayout && !sowable.some(x => x.id === p.id)).slice(0, 6).map(p => p.id);
const [X1, X2] = plain;
const BED = FARM.beds.find(b => b.px), GARDEN = FARM.gardens.find(g => g.bedOrder && Array.isArray(g.bedOrder.ids)), TRAYS = FARM.liveTrayPlans.find(t => t.rows && t.rows.length >= 2);
const mine = () => device('mine', 9), theirs = () => device('theirs', 14);
const DAY = A1.planned;
const ok = r => r && r.ok === true;
const same = M.same;

// ───────────────────────────── 1. the rules ─────────────────────────────
// by shape
tryCase('a side that changed nothing changes nothing: the other side\'s plan comes back, the very one', () => {
  const t = setP(FARM, X1, { note: 'theirs' }), m = setP(FARM, X2, { note: 'mine' });
  const a = M.merge(FARM, FARM, t), b = M.merge(FARM, m, FARM), c = M.merge(FARM, FARM, FARM);
  return [ok(a) && a.plan === t && ok(b) && b.plan === m && ok(c) && c.plan === FARM && !a.report.items.length && !b.report.items.length, [a.ok, b.ok, c.ok]];
});
tryCase('the three plans given are never changed', () => {
  const s = clone(FARM), m = record(setP(clone(FARM), X1, { note: 'mine' }), A1.id, 'sow', DAY, mine()), t = record(setP(clone(FARM), X1, { note: 'theirs' }), A1.id, 'sow', DAY, theirs());
  const before = [s, m, t].map(x => JSON.stringify(x));
  M.merge(s, m, t);
  return [s, m, t].every((x, i) => JSON.stringify(x) === before[i]);
});
tryCase('different records changed on each side: both kept', () => {
  const r = M.merge(FARM, setP(FARM, X1, { note: 'mine' }), setP(FARM, X2, { note: 'theirs' }));
  return [ok(r) && planting(r.plan, X1).note === 'mine' && planting(r.plan, X2).note === 'theirs' && !r.report.items.length && r.plan.plantings.length === FARM.plantings.length, r.report];
});
tryCase('one record changed in different boxes: both kept', () => {
  const r = M.merge(FARM, setP(FARM, X1, { note: 'mine' }), setP(FARM, X1, { price: 7.25 }));
  return [ok(r) && planting(r.plan, X1).note === 'mine' && planting(r.plan, X1).price === 7.25 && !r.report.items.length, r.report];
});
tryCase('the same box changed to different values: the cloud\'s stands, and this device\'s value is in the report', () => {
  const r = M.merge(FARM, setP(FARM, X1, { note: 'mine' }), setP(FARM, X1, { note: 'theirs' })), said = items(r, 'same-box');
  return [ok(r) && planting(r.plan, X1).note === 'theirs' && said.length === 1 && said[0].mine === 'mine' && said[0].theirs === 'theirs' && said[0].path.join('.') === `plantings.#${X1}.note`, r.report];
});
tryCase('the same box changed to the same value: nothing to report', () => {
  const r = M.merge(FARM, setP(FARM, X1, { note: 'alike', price: 3 }), setP(FARM, X1, { note: 'alike' }));
  return [ok(r) && planting(r.plan, X1).note === 'alike' && planting(r.plan, X1).price === 3 && !r.report.items.length, r.report];
});
tryCase('a box emptied on one side and another filled on the other: both', () => {
  const s = setP(FARM, X1, { note: 'was here' }), r = M.merge(s, setP(s, X1, { note: undefined }), setP(s, X1, { price: 4 }));
  return [ok(r) && !('note' in planting(r.plan, X1)) && planting(r.plan, X1).price === 4 && !r.report.items.length, planting(r.plan || s, X1)];
});
tryCase('taken out on one side, untouched on the other: it goes', () => {
  const gone = { ...FARM, plantings: FARM.plantings.filter(p => p.id !== X1) };
  const a = M.merge(FARM, gone, setP(FARM, X2, { note: 't' })), b = M.merge(FARM, setP(FARM, X2, { note: 'm' }), gone);
  return [ok(a) && ok(b) && !planting(a.plan, X1) && !planting(b.plan, X1) && !a.report.items.length && !b.report.items.length, [a.report, b.report]];
});
tryCase('taken out on one side, changed on the other: it stays, as changed, and the report says so (both ways)', () => {
  const gone = { ...FARM, plantings: FARM.plantings.filter(p => p.id !== X1) }, changed = setP(FARM, X1, { note: 'still wanted' });
  const a = M.merge(FARM, gone, changed), b = M.merge(FARM, changed, gone);
  return [ok(a) && ok(b) && planting(a.plan, X1).note === 'still wanted' && planting(b.plan, X1).note === 'still wanted' && items(a, 'kept')[0].removedBy === 'mine' && items(b, 'kept')[0].removedBy === 'theirs' && items(a, 'kept')[0].id === X1, [a.report, b.report]];
});
tryCase('a record added on each side: both kept, the cloud\'s order first, then what this device added', () => {
  const add = (plan, id) => ({ ...plan, plantings: [...plan.plantings, { ...planting(FARM, X1), id }] });
  const r = M.merge(FARM, add(add(FARM, 'new-mine-1'), 'new-mine-2'), add(FARM, 'new-theirs'));
  return [ok(r) && r.plan.plantings.slice(-3).map(p => p.id).join() === 'new-theirs,new-mine-1,new-mine-2' && r.plan.plantings.length === FARM.plantings.length + 3, r.plan && r.plan.plantings.slice(-3).map(p => p.id)];
});
tryCase('a thing taken whole is never half from each side: a bed\'s place on the map', () => {
  const bed = (plan, px) => ({ ...plan, beds: plan.beds.map(b => (b.id === BED.id ? { ...b, px: { ...b.px, ...px } } : b)) });
  const both = M.merge(FARM, bed(FARM, { x: 11 }), bed(FARM, { rot: 45 })), one = M.merge(FARM, bed(FARM, { x: 11 }), setP(FARM, X1, { note: 't' }));
  const px = both.plan.beds.find(b => b.id === BED.id).px;
  return [ok(both) && px.rot === 45 && px.x === BED.px.x && items(both, 'same-box').length === 1 && ok(one) && one.plan.beds.find(b => b.id === BED.id).px.x === 11 && !one.report.items.length, [px, both.report]];
});
tryCase('a bed changed in different boxes, its place among them: both kept', () => {
  const r = M.merge(FARM, { ...FARM, beds: FARM.beds.map(b => (b.id === BED.id ? { ...b, px: { ...b.px, x: 11 } } : b)) }, { ...FARM, beds: FARM.beds.map(b => (b.id === BED.id ? { ...b, note: 'wet end' } : b)) });
  const b = r.plan.beds.find(x => x.id === BED.id);
  return [ok(r) && b.px.x === 11 && b.note === 'wet end' && !r.report.items.length, b];
});
tryCase('a stamp: the later one, and nothing is said', () => {
  const stamp = (plan, at, note) => ({ ...plan, seedInventory: { ...plan.seedInventory, lots: plan.seedInventory.lots.map(l => (l.id === LOT ? { ...l, updatedAt: at, ...(note ? { note } : {}) } : l)) } });
  const r = M.merge(FARM, stamp(FARM, '2027-03-02T10:00:00.000Z', 'Mine'), stamp(FARM, '2027-03-01T10:00:00.000Z'));
  const l = lot(r.plan, LOT);
  return [ok(r) && l.updatedAt === '2027-03-02T10:00:00.000Z' && l.note === 'Mine' && !r.report.items.length, [l.updatedAt, r.report]];
});
// things whose parts are read together: taken whole, or their keys joined as one value
const trayPlan = (plan, change) => ({ ...plan, liveTrayPlans: plan.liveTrayPlans.map(t => (t.id === TRAYS.id ? change(t) : t)) });
const rowPrice = (i, price) => t => ({ ...t, rows: t.rows.map((x, j) => (j === i ? { ...x, price } : x)) });
tryCase('a live-tray demand plan is taken whole: two rows changed one on each device, the cloud\'s plan stands and this device\'s is reported', () => {
  const r = M.merge(FARM, trayPlan(FARM, rowPrice(0, 91)), trayPlan(FARM, rowPrice(1, 92))), rows = r.plan.liveTrayPlans.find(x => x.id === TRAYS.id).rows;
  const one = M.merge(FARM, trayPlan(FARM, rowPrice(0, 91)), setP(FARM, X1, { note: 't' }));
  return [ok(r) && rows[0].price === TRAYS.rows[0].price && rows[1].price === 92 && items(r, 'same-box').length === 1 && items(r, 'same-box')[0].path[0] === 'liveTrayPlans'
    && ok(one) && one.plan.liveTrayPlans.find(x => x.id === TRAYS.id).rows[0].price === 91 && !one.report.items.length, [rows.slice(0, 2), r.report.items.map(x => x.kind)]];
});
tryCase('the weekly batches follow the demand plan that stands: this device\'s new batch goes, one it took out comes back, one it changed is the cloud\'s; a batch sown here stays', () => {
  const batches = FARM.plantings.filter(p => p.liveTray && p.liveTray.planId === TRAYS.id && !p.done);
  if (batches.length < 4) return [false, 'the farm has too few open batches of one demand plan: ' + batches.length];
  const [gone, changed, sown, quiet] = batches;
  let m = trayPlan(FARM, rowPrice(0, 91));
  m = { ...m, plantings: [...m.plantings.filter(p => p.id !== gone.id).map(p => (p.id === changed.id ? { ...p, trays: (p.trays || 0) + 5 } : p.id === sown.id ? { ...p, done: { sow: '2027-03-03' }, workflow: { history: [{ action: 'complete', kind: 'sow', date: '2027-03-03', at: '2027-03-03T09:00:00.000Z', note: '' }] } } : p)),
    { ...quiet, id: 'mine-new-batch', liveTray: { ...quiet.liveTray, key: quiet.liveTray.rowId + ':2027-12-27', week: '2027-12-27' } },
    { ...quiet, id: 'mine-sown-batch', liveTray: { ...quiet.liveTray, key: quiet.liveTray.rowId + ':2027-12-20', week: '2027-12-20' }, done: { sow: '2027-03-04' }, workflow: { history: [{ action: 'complete', kind: 'sow', date: '2027-03-04', at: '2027-03-04T09:00:00.000Z', note: '' }] } }] };
  const t = trayPlan(FARM, rowPrice(1, 92)), r = M.merge(FARM, m, t), at = id => r.ok && r.plan.plantings.find(p => p.id === id), told = items(r, 'tray-batches')[0];
  const twice = r.ok ? M.merge(t, r.plan, t) : null;   // and joined again, as this device, against the cloud's: nothing more moves
  return [ok(r) && !at('mine-new-batch') && !!at('mine-sown-batch') && !!at(gone.id) && at(changed.id).trays === changed.trays && at(sown.id).done && at(sown.id).done.sow === '2027-03-03'
    && !!told && same(told.dropped, ['mine-new-batch']) && same(told.back, [gone.id]) && same(told.reset, [changed.id]) && told.whose === 'theirs' && ok(twice) && !!twice.plan.plantings.find(p => p.id === sown.id).done, [r.ok ? r.report.items : r.why]];
});
tryCase('a demand plan taken out on one device and changed on the other stays, as changed, with all of that device\'s batches: none is left out, either way round', () => {
  const batches = FARM.plantings.filter(p => p.liveTray && p.liveTray.planId === TRAYS.id), n = batches.length;
  const without = { ...FARM, liveTrayPlans: FARM.liveTrayPlans.filter(t => t.id !== TRAYS.id), plantings: FARM.plantings.filter(p => !(p.liveTray && p.liveTray.planId === TRAYS.id)) };
  const changed = trayPlan(FARM, rowPrice(0, 91)), count = r => r.ok && r.plan.plantings.filter(p => p.liveTray && p.liveTray.planId === TRAYS.id).length;
  const a = M.merge(FARM, without, changed), b = M.merge(FARM, changed, without);
  return [n > 3 && ok(a) && count(a) === n && ok(b) && count(b) === n && a.plan.liveTrayPlans.some(t => t.id === TRAYS.id) && b.plan.liveTrayPlans.some(t => t.id === TRAYS.id) && items(b, 'tray-batches')[0].whose === 'mine' && items(a, 'tray-batches')[0].back.length === n, [n, count(a), count(b), a.ok ? '' : a.why, b.ok ? '' : b.why]];
});
tryCase('a batch this device took off its demand plan while the cloud\'s version of that plan stands is the cloud\'s batch again, once: no id twice', () => {
  const b1 = FARM.plantings.find(p => p.liveTray && p.liveTray.planId === TRAYS.id && !p.done);
  const m = trayPlan(FARM, rowPrice(0, 91)), off = { ...m, plantings: m.plantings.map(p => { if (p.id !== b1.id) return p; const q = { ...p }; delete q.liveTray; return q; }) };
  const r = M.merge(FARM, off, trayPlan(FARM, rowPrice(1, 92))), got = r.ok ? r.plan.plantings.filter(p => p.id === b1.id) : [];
  return [ok(r) && got.length === 1 && same(got[0].liveTray, b1.liveTray) && same(items(r, 'tray-batches')[0].reset, [b1.id]), r.ok ? got : r.why];
});
tryCase('keys read together are one value on a planting that waits to be placed too, in the plan and in what a file keeps of it', () => {
  const wait = (plan, change) => { const w = [{ id: 'w1', cropId: 'c', date: '2027-05-01', yield: 10, yieldBasis: 'plant', wait: { s: 's1', k: 1, of: 2, every: 7 }, ...change }]; return { ...plan, lrfNext: { ...(plan.lrfNext || {}), waiting: w }, lrfNextKeep: { v: 1, savedAt: '2027-03-01T08:00:00.000Z', device: 'd', keep: { waiting: w } } }; };
  const s = wait(FARM, {}), r = M.merge(s, wait(s, { yield: 20 }), wait(s, { yieldBasis: 'container' })), a = r.ok && r.plan.lrfNext.waiting[0], b = r.ok && r.plan.lrfNextKeep.keep.waiting[0];
  return [ok(r) && a.yield === 10 && a.yieldBasis === 'container' && b.yield === 10 && b.yieldBasis === 'container' && items(r, 'same-box').length === 2, [a, b, r.report]];
});
// One demand row and one delivery week is one batch (found by Codex on #64): made with the planner's own functions, the demand
// plan by Trays.apply as the Trays page does, the sowing by the week's record as Tasks does. A new batch is made under an id worked
// from its demand plan and its week (js/trays.js), so two devices that widen one demand plan alike make one record for the week. A
// page from before that made the same record under an id of its own (`older`): the merge settles such twins (settleTwins).
const TWIN = (() => {
  const row = { id: 'row-twin', name: 'Twin Shoots', days: 14, price: 18, spring: 3, summer: 3, fall: 3 };
  const demand = through => ({ v: 1, year: 2027, name: 'Twin demand', customerId: '', from: '2027-05-03', through, summer: '2027-07-01', fall: '2027-09-16', rows: [row] });
  const apply = (farm, input, dev) => TR.apply(farm, input, { uid: dev.uid, now: dev.now(), crop: id => eng(farm).crop(id), keepRecorded: true }).plan;
  const start = apply(FARM, demand('2027-05-03'), device('first', 8)), id = start.liveTrayPlans.find(t => t.name === 'Twin demand').id;
  const to = (farm, through, dev) => apply(farm, { ...farm.liveTrayPlans.find(t => t.id === id), through }, dev);
  const widen = (farm, dev) => to(farm, '2027-05-10', dev);
  /** A page from before this build widening the same way: the same records, each new batch under an id of the device's own. */
  const older = (farm, dev) => { const had = new Set(farm.plantings.map(p => p.id)), made = widen(farm, dev); return { ...made, plantings: made.plantings.map(p => (had.has(p.id) || !p.liveTray ? p : { ...p, id: dev.uid() })) }; };
  const batches = plan => plan.plantings.filter(p => p.liveTray && p.liveTray.planId === id), week = (plan, w) => batches(plan).filter(p => p.liveTray.week === w);
  const sow = (plan, dev, day, input = {}) => record(plan, week(plan, '2027-05-10')[0].id, 'sow', day, dev, input);
  // what Harvest shows for the crop: its trays in a week (May 10 unless said), and in the season
  const harvest = (plan, w = '2027-05-10') => { const en = eng(plan), r = F.build(en).rows.find(x => x.cropId === batches(plan)[0].cropId), at = Math.round(E.dayDiff(E.s2d(w), new Date(2027, 0, 1))); let n = 0; for (let d = at; d < at + 7; d++) n += r.days[d] || 0; return [n, r.total]; };
  const open = plan => week(plan, '2027-05-10').filter(p => { const sw = SL.sowing(eng(plan), p); return sw && !(p.done || {}).sow; }).length;
  return { start, id, apply, to, widen, older, batches, week, sow, harvest, open, join: (s, m, t) => M.merge(s, m, t, { order: SL.DONE_ORDER }) };
})();
tryCase('two devices that widen one demand plan alike make one record for the new week, under one id worked from the plan and the week; the phone sows it; joined either way round there is that one batch of three trays, sown, Harvest shows three, and no twins to settle; and a second round, a change on each device, joins the same way', () => {
  const X = TWIN, phone = X.sow(X.widen(X.start, mine()), mine(), '2027-04-26'), laptop = X.widen(X.start, theirs()), W = X.week(laptop, '2027-05-10')[0];
  const made = !!W && X.week(phone, '2027-05-10').length === 1 && X.week(phone, '2027-05-10')[0].id === W.id && !/^(mine|theirs|first)-/.test(W.id) && same(X.harvest(phone), [3, 6]) && same(X.harvest(laptop), [3, 6]);
  const out = [];
  for (const [me, cloud, name] of [[phone, laptop, 'the phone joins'], [laptop, phone, 'the laptop joins']]) {
    const r = X.join(X.start, me, cloud);
    if (!ok(r)) { out.push([name, r.why]); continue; }
    const w = X.week(r.plan, '2027-05-10');
    const good = w.length === 1 && w[0].id === W.id && w[0].trays === 3 && (w[0].done || {}).sow === '2027-04-26' && w[0].workflow.history.filter(h => h.kind === 'sow' && h.action === 'complete').length === 1
      && X.open(r.plan) === 0 && same(X.harvest(r.plan), [3, 6]) && X.batches(r.plan).length === 2 && !r.report.items.length;
    // the joined plan goes to the cloud; the other device takes it in from the plan it sent, having changed a planting of its own since; the first, changed too, takes that in; and once more round
    const one = j => ok(j) && X.week(j.plan, '2027-05-10').length === 1 && (X.week(j.plan, '2027-05-10')[0].done || {}).sow === '2027-04-26' && same(X.harvest(j.plan), [3, 6]) && X.open(j.plan) === 0;
    const other = X.join(cloud, setP(cloud, X1, { note: 'the other device, since' }), r.plan), back = other.ok ? X.join(r.plan, setP(r.plan, X2, { note: 'the first, since' }), other.plan) : other, again = back.ok ? X.join(other.plan, setP(other.plan, X1, { note: 'and round' }), back.plan) : back;
    const steady = [other, back, again].every(one) && planting(again.plan, X2).note === 'the first, since' && planting(again.plan, X1).note === 'and round';
    // a second round on the plan both now hold: each device widens it a week more, to May 17, and the phone notes the sown batch
    const held = again.ok ? again.plan : r.plan, phone2 = setP(X.to(held, '2027-05-17', mine()), W.id, { note: 'sown on the phone' }), laptop2 = X.to(held, '2027-05-17', theirs());
    const second = X.join(held, phone2, laptop2), w17 = second.ok ? X.week(second.plan, '2027-05-17') : [];
    const round = ok(second) && w17.length === 1 && w17[0].id === X.week(laptop2, '2027-05-17')[0].id && X.week(second.plan, '2027-05-10').length === 1 && planting(second.plan, W.id).note === 'sown on the phone'
      && (planting(second.plan, W.id).done || {}).sow === '2027-04-26' && same(X.harvest(second.plan, '2027-05-17'), [3, 9]) && X.batches(second.plan).length === 3 && !second.report.items.length;
    if (!good || !steady || !round) out.push([name, good, steady, round, w.map(p => [p.id, p.trays, p.done]), X.harvest(r.plan), r.report.items.map(x => x.kind), second.ok ? [w17.map(p => p.id), second.report.items.map(x => x.kind)] : second.why]);
  }
  return [made && out.length === 0, [made, W && W.id, out]];
});
tryCase('the laptop changed that batch before it took the phone\'s sown one in: still one record, sown, and the laptop\'s change joined as on any planting: its note kept; a sowing day set by hand there not applied over the sowing, and said', () => {
  const X = TWIN, phone = X.sow(X.widen(X.start, mine()), mine(), '2027-04-26'), laptop = X.widen(X.start, theirs()), r = X.join(X.start, phone, laptop);
  if (!ok(r)) return [false, r.why];
  const W = X.week(phone, '2027-05-10')[0].id, out = [];
  for (const [change, want] of [[{ note: 'a note on the batch' }, j => planting(j.plan, W).note === 'a note on the batch' && !j.report.items.length],
    [{ sowOn: '2027-04-28' }, j => planting(j.plan, W).sowOn === undefined && items(j, 'move-not-applied').length === 1 && items(j, 'move-not-applied')[0].id === W]]) {
    const j = X.join(laptop, setP(laptop, W, change), r.plan), w = j.ok ? X.week(j.plan, '2027-05-10') : [];
    const good = ok(j) && w.length === 1 && w[0].id === W && w[0].done.sow === '2027-04-26' && same(X.harvest(j.plan), [3, 6]) && X.open(j.plan) === 0 && want(j);
    // and the phone, taking that in with a change of its own, has the one batch too
    const back = good ? X.join(r.plan, setP(r.plan, X1, { note: 'the phone, since' }), j.plan) : j;
    if (!good || !(ok(back) && X.week(back.plan, '2027-05-10').length === 1 && same(X.harvest(back.plan), [3, 6]))) out.push([change, j.ok ? [w.map(p => [p.id, p.trays, p.done, p.sowOn, p.note]), X.harvest(j.plan), j.report.items.map(x => [x.kind, x.id])] : j.why]);
  }
  return [out.length === 0, out];
});
tryCase('where the sowing draws seed: the batch is sown once and the seed comes off its lot once, joined either way round and round again', () => {
  const X = TWIN, key = SL.sowing(eng(X.start), X.batches(X.start)[0]).key, stocked = addLot(X.start, key, 500, device('stock', 7)), id = stocked.seedInventory.lots[stocked.seedInventory.lots.length - 1].id;
  const sown = (plan, dev) => record(plan, X.week(plan, '2027-05-10')[0].id, 'sow', '2027-04-26', dev, { quantity: 60 });
  const phone = sown(X.widen(stocked, mine()), mine()), laptop = X.widen(stocked, theirs()), drew = lot(phone, id).quantity === 440 && X.week(phone, '2027-05-10')[0].workflow.seedUse.length === 1, out = [];
  for (const [me, cloud, name] of [[phone, laptop, 'the phone joins'], [laptop, phone, 'the laptop joins']]) {
    const r = X.join(stocked, me, cloud), other = r.ok ? X.join(cloud, setP(cloud, X1, { note: 'since' }), r.plan) : r;
    const fine = j => ok(j) && lot(j.plan, id).quantity === 440 && X.week(j.plan, '2027-05-10').length === 1 && X.week(j.plan, '2027-05-10')[0].workflow.seedUse.length === 1 && j.plan.plantings.reduce((n, p) => n + ((p.workflow || {}).seedUse || []).filter(u => u.lotId === id || (u.lots || []).some(l => l.id === id)).length, 0) <= 1;
    if (!fine(r) || !fine(other)) out.push([name, r.ok ? [lot(r.plan, id).quantity, X.week(r.plan, '2027-05-10').map(p => (p.workflow || {}).seedUse)] : r.why]);
  }
  return [drew && out.length === 0, [drew, out]];
});
tryCase('the same when neither device has sown it: one batch, the one record both made, and nothing is said, not even of the demand plan each stamped at its own moment', () => {
  const X = TWIN, a = X.widen(X.start, mine()), b = X.widen(X.start, theirs()), r = X.join(X.start, a, b), w = r.ok ? X.week(r.plan, '2027-05-10') : [];
  return [ok(r) && w.length === 1 && w[0].id === X.week(a, '2027-05-10')[0].id && w[0].id === X.week(b, '2027-05-10')[0].id && same(X.harvest(r.plan), [3, 6]) && !r.report.items.length, r.ok ? [w.map(p => p.id), r.report.items] : r.why];
});
tryCase('both devices sowed that one batch: one record; the cloud\'s sowing stands and this device\'s goes whole, its seed with it, said as recorded twice; the lot gives the seed once, either way round', () => {
  const X = TWIN, key = SL.sowing(eng(X.start), X.batches(X.start)[0]).key, stocked = addLot(X.start, key, 500, device('stock', 7)), id = stocked.seedInventory.lots[stocked.seedInventory.lots.length - 1].id;
  const phone = X.sow(X.widen(stocked, mine()), mine(), '2027-04-26', { quantity: 60 }), laptop = X.sow(X.widen(stocked, theirs()), theirs(), '2027-04-27', { quantity: 60 }), out = [];
  for (const [me, cloud, name, day] of [[phone, laptop, 'the phone joins', '2027-04-27'], [laptop, phone, 'the laptop joins', '2027-04-26']]) {
    const r = X.join(stocked, me, cloud), w = r.ok ? X.week(r.plan, '2027-05-10') : [], told = r.ok ? items(r, 'recorded-twice') : [];
    const fine = ok(r) && w.length === 1 && w[0].done.sow === day && told.length === 1 && told[0].id === w[0].id && lot(r.plan, id).quantity === 440 && w[0].workflow.seedUse.length === 1
      && w[0].workflow.history.filter(h => h.kind === 'sow' && h.action === 'complete').length === 1 && !items(r, 'tray-batch-twice').length;
    if (!fine) out.push([name, r.ok ? [w.map(p => [p.id, p.done, (p.workflow || {}).seedUse]), lot(r.plan, id).quantity, r.report.items.map(x => x.kind)] : r.why]);
  }
  return [out.length === 0, out];
});
// the same week made by a page from before this build on the laptop: twins, settled by settleTwins
tryCase('one demand row and one week is one batch, when one device runs an older page: the laptop made its batch under an id of its own and the phone sowed its own; joined either way round there is one batch of three trays, the sown one, and Harvest shows three', () => {
  const X = TWIN, phone = X.sow(X.widen(X.start, mine()), mine(), '2027-04-26'), laptop = X.older(X.start, theirs());
  const made = X.week(phone, '2027-05-10')[0].id !== X.week(laptop, '2027-05-10')[0].id && same(X.harvest(phone), [3, 6]) && same(X.harvest(laptop), [3, 6]);
  const out = [];
  for (const [me, cloud, name] of [[phone, laptop, 'the phone joins'], [laptop, phone, 'the laptop joins']]) {
    const r = X.join(X.start, me, cloud);
    if (!ok(r)) { out.push([name, r.why]); continue; }
    const w = X.week(r.plan, '2027-05-10'), told = items(r, 'tray-batch-twice');
    const good = w.length === 1 && w[0].trays === 3 && (w[0].done || {}).sow === '2027-04-26' && w[0].id === X.week(phone, '2027-05-10')[0].id && w[0].workflow.history.filter(h => h.kind === 'sow' && h.action === 'complete').length === 1
      && X.open(r.plan) === 0 && same(X.harvest(r.plan), [3, 6]) && told.length === 1 && told[0].conflict === false && same(told[0].dropped, [X.week(laptop, '2027-05-10')[0].id]) && X.batches(r.plan).length === 2;
    const one = j => ok(j) && X.week(j.plan, '2027-05-10').length === 1 && (X.week(j.plan, '2027-05-10')[0].done || {}).sow === '2027-04-26' && same(X.harvest(j.plan), [3, 6]) && X.open(j.plan) === 0;
    const other = X.join(cloud, setP(cloud, X1, { note: 'the other device, since' }), r.plan), back = other.ok ? X.join(r.plan, setP(r.plan, X2, { note: 'the first, since' }), other.plan) : other;
    if (!good || ![other, back].every(one)) out.push([name, good, w.map(p => [p.id, p.trays, p.done]), X.harvest(r.plan), r.report.items.map(x => x.kind)]);
  }
  return [made && out.length === 0, [made, out]];
});
tryCase('the laptop changed its own unsown batch of that week, made by an older page, before it took the phone\'s sown one in: still one batch, the sown one, three trays in Harvest, and the laptop\'s batch is named as dropped (the reviewing agent, on #64)', () => {
  const X = TWIN, phone = X.sow(X.widen(X.start, mine()), mine(), '2027-04-26'), laptop = X.older(X.start, theirs()), r = X.join(X.start, phone, laptop);
  if (!ok(r)) return [false, r.why];
  const A = X.week(phone, '2027-05-10')[0].id, B = X.week(laptop, '2027-05-10')[0].id, out = [];
  for (const change of [{ note: 'a note on the batch that was never sown' }, { trays: 4 }, { sowOn: '2027-04-28' }]) {
    const j = X.join(laptop, setP(laptop, B, change), r.plan), w = j.ok ? X.week(j.plan, '2027-05-10') : [], told = j.ok ? items(j, 'tray-batch-twice') : [];
    const good = ok(j) && w.length === 1 && w[0].id === A && w[0].trays === 3 && w[0].done.sow === '2027-04-26' && same(X.harvest(j.plan), [3, 6]) && X.open(j.plan) === 0
      && told.length === 1 && told[0].conflict === false && same(told[0].dropped, [B]) && same(told[0].kept, [A]) && !j.report.items.some(x => x.kind === 'kept' && x.id === B);
    const back = good ? X.join(r.plan, setP(r.plan, X1, { note: 'the phone, since' }), j.plan) : j;
    if (!good || !(ok(back) && X.week(back.plan, '2027-05-10').length === 1 && same(X.harvest(back.plan), [3, 6]))) out.push([change, j.ok ? [w.map(p => [p.id, p.trays, p.done]), X.harvest(j.plan), j.report.items.map(x => [x.kind, x.dropped])] : j.why]);
  }
  return [out.length === 0, out];
});
tryCase('neither sown, one device on an older page: one batch, the cloud\'s', () => {
  const X = TWIN, a = X.widen(X.start, mine()), b = X.older(X.start, theirs()), r = X.join(X.start, a, b), w = r.ok ? X.week(r.plan, '2027-05-10') : [];
  return [ok(r) && w.length === 1 && w[0].id === X.week(b, '2027-05-10')[0].id && same(X.harvest(r.plan), [3, 6]) && items(r, 'tray-batch-twice').length === 1, r.ok ? [w.map(p => p.id), r.report.items] : r.why];
});
tryCase('both devices sowed their own batch of that row and week, one on an older page: both records stay, with their days, and the report says the two conflict', () => {
  const X = TWIN, phone = X.sow(X.widen(X.start, mine()), mine(), '2027-04-26'), laptop = X.sow(X.older(X.start, theirs()), theirs(), '2027-04-27');
  const r = X.join(X.start, phone, laptop), w = r.ok ? X.week(r.plan, '2027-05-10') : [], told = items(r, 'tray-batch-twice')[0];
  return [ok(r) && w.length === 2 && same(w.map(p => p.done.sow).sort(), ['2027-04-26', '2027-04-27']) && !!told && told.conflict === true && told.dropped.length === 0 && told.kept.length === 2, r.ok ? [w.map(p => [p.id, p.done]), told] : r.why];
});
tryCase('a sown batch taken off its demand plan stays a plain planting under its id: the phone sowed the week, set its trays to 2 and deleted the plan, the laptop changed the plan; joined, the plan stays beside the plain batch, and when the plan is next saved (its name only) that planting is the week\'s batch again, as recorded: one batch, 2 trays that week in Harvest and 5 in the season, before the save and after, and no id twice (Codex\'s Zoom Out, on #80)', () => {
  const X = TWIN, start = X.widen(X.start, device('first', 8)), W = X.week(start, '2027-05-10')[0].id, plan = start.liveTrayPlans.find(t => t.id === X.id);
  const phone = TR.remove(setP(X.sow(start, mine(), '2027-04-26'), W, { trays: 2 }), X.id, {}, { keepRecorded: true }), laptop = X.apply(start, { ...plan, rows: plan.rows.map(r => ({ ...r, price: 19 })) }, theirs());
  const r = X.join(start, phone, laptop);
  if (!ok(r)) return [false, r.why];
  const was = planting(r.plan, W), stays = r.plan.liveTrayPlans.some(t => t.id === X.id) && !!was && !was.liveTray && (was.done || {}).sow === '2027-04-26' && was.trays === 2 && X.week(r.plan, '2027-05-10').length === 0 && same(X.harvest(r.plan), [2, 5]);
  // the plan saved once more on the joined plan, its name only, as the Trays page saves it
  const saved = TR.apply(r.plan, { ...r.plan.liveTrayPlans.find(t => t.id === X.id), name: 'Twin demand, again' }, { uid: device('again', 10).uid, now: '2027-03-02T08:00:00.000Z', crop: id => eng(r.plan).crop(id), keepRecorded: true });
  const again = saved.plan, ids = again.plantings.map(p => p.id), w = X.week(again, '2027-05-10'), after = planting(again, W);
  const good = stays && ids.length === new Set(ids).size && w.length === 1 && w[0].id === W && same({ ...after, liveTray: undefined }, { ...was, liveTray: undefined }) && after.liveTray.planId === X.id && after.liveTray.week === '2027-05-10'
    && same(X.harvest(again), [2, 5]) && saved.kept === 1 && !again.plantings.some(p => String(p.id).startsWith(W + '~'));
  // and the other device takes that in, with a change of its own
  const j = good ? X.join(r.plan, setP(r.plan, X1, { note: 'since' }), again) : null, jIds = j && j.ok ? j.plan.plantings.map(p => p.id) : [];
  return [good && ok(j) && jIds.length === new Set(jIds).size && X.week(j.plan, '2027-05-10').length === 1 && (planting(j.plan, W).done || {}).sow === '2027-04-26' && same(X.harvest(j.plan), [2, 5]),
    [stays, was && [!!was.liveTray, was.done, was.trays], X.harvest(r.plan), w.map(p => [p.id, p.trays, p.done]), X.harvest(again), saved.kept, r.report.items.map(x => x.kind), j && (j.ok ? '' : j.why)]];
});
tryCase('a planting put by hand under a week\'s worked id: the week\'s own batch, made plain, is made that week\'s batch again, under its id; any other planting under it keeps it, untouched, recorded or not, and the week takes the next free id: no id twice either way', () => {
  const X = TWIN, scratch = X.widen(X.start, device('scratch', 8)), made0 = X.week(scratch, '2027-05-10')[0], W = made0.id, other = FARM.plantings.find(p => p.liveTray && p.liveTray.planId === TRAYS.id && !p.done);
  const { liveTray, ...bare } = made0, field = planting(record(FARM, A1.id, 'sow', DAY, device('field', 7)), A1.id), out = [];
  for (const [holder, name] of [[bare, 'the week\'s batch, plain, nothing recorded'], [{ ...other, id: W }, 'a batch of another plan'], [{ ...field, id: W }, 'a recorded planting of another crop and bed']]) {
    const odd = { ...X.start, plantings: [...X.start.plantings, holder] }, made = X.widen(odd, mine()), ids = made.plantings.map(p => p.id), w = X.week(made, '2027-05-10'), held = planting(made, W);
    const good = ids.length === new Set(ids).size && w.length === 1 && (holder === bare ? w[0].id === W && held.liveTray.planId === X.id
      : w[0].id !== W && w[0].id.startsWith(W) && same(held, holder));
    if (!good) out.push([name, w.map(p => p.id), held && held.liveTray, ids.length - new Set(ids).size]);
  }
  return [!!other && !!field && out.length === 0, out];
});
tryCase('a batch marked failed, its plan then deleted and the mark taken off is a plain planting with nothing recorded on it under its worked id: when the other device\'s change brings the plan back and the plan is saved, that planting is the week\'s batch again, under its id, and the week holds it once (the reviewing agent, on #80)', () => {
  const X = TWIN, start = X.widen(X.start, device('first', 8)), WK = X.week(start, '2027-05-10')[0].id, plan = start.liveTrayPlans.find(t => t.id === X.id);
  const failed = putPlanting(start, W.fail(planting(start, WK), '2027-04-28', '2027-04-28T10:00:00Z'));
  const removed = TR.remove(failed, X.id, {}, { keepRecorded: true }), off = putPlanting(removed, W.fail(planting(removed, WK), null)), p = planting(off, WK);
  const plainNone = !!p && !p.liveTray && !TR.locked(off, p, {});
  const laptop = X.apply(start, { ...plan, rows: plan.rows.map(r => ({ ...r, price: 19 })) }, theirs()), r = X.join(start, off, laptop);
  if (!ok(r)) return [false, r.why];
  const s = X.apply(r.plan, { ...r.plan.liveTrayPlans.find(t => t.id === X.id), name: 'renamed' }, device('again', 10)), w = X.week(s, '2027-05-10'), ids = s.plantings.map(x => x.id);
  return [plainNone && w.length === 1 && w[0].id === WK && same(X.harvest(s), [3, 6]) && ids.length === new Set(ids).size, [plainNone, w.map(x => x.id), X.harvest(s), X.harvest(r.plan)]];
});
tryCase('a batch tied to a demand plan is not removed by hand: it stays (LRFTrays.removable, under the Delete key and the card\'s Remove), a plain planting is removed; so a sown batch is never made again unsown under its id: the plan renamed on one device, a note on the other, joined either way round, one batch, sown, 60 seeds off a lot of 500 once (the reviewing agent, on #80)', () => {
  const X = TWIN, key = SL.sowing(eng(X.start), X.batches(X.start)[0]).key, stocked = addLot(X.start, key, 500, device('stock', 7)), lotId = stocked.seedInventory.lots[stocked.seedInventory.lots.length - 1].id;
  const wide = X.widen(stocked, device('first', 8)), WK = X.week(wide, '2027-05-10')[0].id, sown = X.sow(wide, device('first', 8), '2027-04-26', { quantity: 60 });
  // device A asks to remove the sown batch and a plain planting, as removePlantings does, then renames the demand plan; B notes another planting
  const asked = TR.removable(sown, [WK, X2]), gone = new Set(asked.ids), removed = { ...sown, plantings: sown.plantings.filter(p => !gone.has(p.id)) };
  const A = X.apply(removed, { ...removed.liveTrayPlans.find(t => t.id === X.id), name: 'Twin demand, renamed' }, mine()), B = setP(sown, X1, { note: 'B since' }), out = [];
  for (const [me, cloud, name] of [[A, B, 'A joins'], [B, A, 'B joins']]) {
    const r = X.join(sown, me, cloud), w = r.ok ? X.week(r.plan, '2027-05-10') : [];
    if (!(ok(r) && w.length === 1 && w[0].id === WK && (w[0].done || {}).sow === '2027-04-26' && lot(r.plan, lotId).quantity === 440 && !planting(r.plan, X2) && !r.report.items.length)) out.push([name, r.ok ? [w.map(p => [p.id === WK, (p.done || {}).sow]), lot(r.plan, lotId).quantity, r.report.items.map(x => x.kind)] : r.why]);
  }
  return [same(asked.ids, [X2]) && asked.kept.length === 1 && asked.kept[0].id === WK && out.length === 0, [asked.ids, asked.kept.map(p => p.id), out]];
});
tryCase('on a plan whose heated greenhouse benches have ids of their own (made before this build, as in a grower\'s plan), two devices that widen one demand plan alike still make one record on those benches, and no second garden or bed; the phone sows it; joined either way round, one batch of three trays, sown', () => {
  const pool = FARM.gardens.find(g => g.liveTrayPool === true), bench = FARM.beds.find(b => b.liveTrayPool === true), G = '0f5c2a7e-91d4-4b3a-8e6f-2c4d1b7a9e30', B = '6b1e8d42-3c7f-4a95-b0d2-9f4e7a1c5d86';
  const old = { ...FARM, gardens: FARM.gardens.map(g => (g.id === pool.id ? { ...g, id: G } : g)), beds: FARM.beds.map(b => (b.id === bench.id ? { ...b, id: B, gardenId: G } : b)), plantings: FARM.plantings.map(p => (p.bedId === bench.id ? { ...p, bedId: B } : p)) };
  const row = { id: 'row-old', name: 'Twin Shoots', days: 14, price: 18, spring: 3, summer: 3, fall: 3 }, demand = through => ({ v: 1, year: 2027, name: 'Old benches', customerId: '', from: '2027-05-03', through, summer: '2027-07-01', fall: '2027-09-16', rows: [row] });
  const start = TWIN.apply(old, demand('2027-05-03'), device('first', 8)), id = start.liveTrayPlans.find(t => t.name === 'Old benches').id, plan = start.liveTrayPlans.find(t => t.id === id);
  const week = p => p.plantings.filter(x => x.liveTray && x.liveTray.planId === id && x.liveTray.week === '2027-05-10');
  const phoneW = TWIN.apply(start, { ...plan, through: '2027-05-10' }, mine()), phone = record(phoneW, week(phoneW)[0].id, 'sow', '2027-04-26', mine()), laptop = TWIN.apply(start, { ...plan, through: '2027-05-10' }, theirs()), out = [];
  for (const [me, cloud, name] of [[phone, laptop, 'the phone joins'], [laptop, phone, 'the laptop joins']]) {
    const r = TWIN.join(start, me, cloud), w = r.ok ? week(r.plan) : [];
    if (!(ok(r) && w.length === 1 && w[0].id === week(laptop)[0].id && w[0].bedId === B && w[0].trays === 3 && (w[0].done || {}).sow === '2027-04-26' && r.plan.gardens.filter(g => g.liveTrayPool === true).length === 1 && r.plan.beds.filter(b => b.liveTrayPool === true).length === 1 && !r.report.items.length)) out.push([name, r.ok ? [w.map(p => [p.id, p.bedId, p.trays, p.done]), r.report.items.map(x => x.kind)] : r.why]);
  }
  return [week(phone)[0].id === week(laptop)[0].id && out.length === 0, out];
});
tryCase('a sown batch made under a free id after its worked one (that one held, in a file edited by hand, by another plan\'s batch) and taken off its plan is found again the same way: when the plan comes back and is saved, it is the week\'s batch again, and no id after it is made (Codex\'s second Zoom Out, on #80)', () => {
  const X = TWIN, W = X.week(X.widen(X.start, device('scratch', 8)), '2027-05-10')[0].id, other = FARM.plantings.find(p => p.liveTray && p.liveTray.planId === TRAYS.id && !p.done);
  const odd = { ...X.start, plantings: [...X.start.plantings, { ...other, id: W }] }, start = X.widen(odd, device('first', 8)), W2 = X.week(start, '2027-05-10')[0].id, plan = start.liveTrayPlans.find(t => t.id === X.id);
  const phone = TR.remove(X.sow(start, mine(), '2027-04-26'), X.id, {}, { keepRecorded: true }), laptop = X.apply(start, { ...plan, rows: plan.rows.map(r => ({ ...r, price: 19 })) }, theirs()), r = X.join(start, phone, laptop);
  if (!ok(r)) return [false, r.why];
  const out = [];
  // as joined; and again with the worked id held by a plain planting of that week with nothing recorded on it (also only by a hand edit): the sown one is taken first
  const { done: _d, workflow: _w, ...blank } = planting(r.plan, W2), cases = [[r.plan, 'as joined'], [{ ...r.plan, plantings: r.plan.plantings.map(p => (p.id === W ? { ...blank, id: W } : p)) }, 'the worked id held by a plain planting of the week with nothing recorded']];
  for (const [joined, name] of cases) {
    const again = TR.apply(joined, { ...joined.liveTrayPlans.find(t => t.id === X.id), name: 'Twin demand, again' }, { uid: device('again', 10).uid, now: '2027-03-02T08:00:00.000Z', crop: id => eng(joined).crop(id), keepRecorded: true }).plan;
    const w = X.week(again, '2027-05-10'), ids = again.plantings.map(p => p.id);
    if (!(w.length === 1 && w[0].id === W2 && (w[0].done || {}).sow === '2027-04-26' && ids.length === new Set(ids).size && !ids.includes(W + '~3'))) out.push([name, w.map(p => [p.id, p.done]), ids.filter(id => String(id).startsWith(W))]);
  }
  return [W2 === W + '~2' && !planting(r.plan, W2).liveTray && out.length === 0, [W2, out]];
});
tryCase('a batch\'s id is worked from its demand plan and its key so that no two give one: a plan "a" with a row "b:c" on one device and a plan "a:b" with a row "c" on the other each keep a batch of their own when joined', () => {
  const dev = id => ({ uid: () => id, now: '2027-03-01T08:00:00.000Z' }), row = (id, n) => ({ id, name: 'Twin Shoots', days: 14, price: 18, spring: n, summer: n, fall: n });
  const make = (name, id, rowId, n) => TR.apply(FARM, { ...TR.draft(2027), from: '2027-05-03', through: '2027-05-03', name, rows: [row(rowId, n)] }, { ...dev(id), crop: x => eng(FARM).crop(x), keepRecorded: true }).plan;
  const a = make('Plan a', 'a', 'b:c', 1), b = make('Plan a:b', 'a:b', 'c', 2), mineOf = (p, id) => p.plantings.filter(x => x.liveTray && x.liveTray.planId === id);
  const r = M.merge(FARM, a, b), ofA = r.ok ? mineOf(r.plan, 'a') : [], ofB = r.ok ? mineOf(r.plan, 'a:b') : [];
  return [mineOf(a, 'a')[0].id !== mineOf(b, 'a:b')[0].id && ok(r) && ofA.length === 1 && ofB.length === 1 && ofA[0].trays === 1 && ofB[0].trays === 2 && !items(r, 'same-box').length, [mineOf(a, 'a').map(p => p.id), mineOf(b, 'a:b').map(p => p.id), r.ok ? r.report.items.map(x => x.kind) : r.why]];
});
tryCase('a demand plan saved on this build keeps every batch it had under its id, and changes nothing else; only a new week is made, under an id that is no device\'s own', () => {
  const t = FARM.liveTrayPlans.find(x => x.id === TRAYS.id), d = mine(), after = TR.apply(FARM, { ...t, through: TR.add(t.through, 7) }, { uid: d.uid, now: d.now(), crop: id => eng(FARM).crop(id), keepRecorded: true }).plan;
  const byId = new Map(after.plantings.map(p => [p.id, p])), had = new Set(FARM.plantings.map(p => p.id)), added = after.plantings.filter(p => !had.has(p.id));
  const kept = FARM.plantings.every(p => same(byId.get(p.id), p)) && after.plantings.length === FARM.plantings.length + added.length;
  return [kept && added.length > 0 && added.every(p => p.liveTray && p.liveTray.planId === TRAYS.id && p.liveTray.week > t.through.slice(0, 10) && !/^mine-/.test(p.id)), [kept, added.map(p => [p.id, p.liveTray && p.liveTray.week])]];
});
tryCase('undo after a join, as the planner takes a step out of records another device changed since: both devices widened the demand plan alike, each stamping it at its own moment; the step taken back on either device, the demand plan goes back with its batch', () => {
  const X = TWIN, out = [];
  for (const [first, second, name] of [[mine, theirs, 'the later stamp is the other device\'s'], [theirs, mine, 'the later stamp is this device\'s']]) {
    // this device's step, as saveTrays commits it: the list of demand plans before and after, and the batch it made (js/app.js, undoWay)
    const a = X.widen(X.start, first()), b = X.widen(X.start, second()), r = X.join(X.start, a, b);
    if (!ok(r)) { out.push([name, r.why]); continue; }
    const W = X.week(a, '2027-05-10')[0], plans = M.joinOne('liveTrayPlans', a.liveTrayPlans, X.start.liveTrayPlans, r.plan.liveTrayPlans);
    // the batch is as the step left it, so undo takes it out as made; the demand plan comes back as it was before the step
    if (!(same(planting(r.plan, W.id), W) && same(plans.value, X.start.liveTrayPlans) && !plans.items.length)) out.push([name, same(planting(r.plan, W.id), W), plans.value.map(t => t.through), plans.items.map(x => x.kind)]);
  }
  return [out.length === 0, out];
});
tryCase('a demand plan one device changed and changed back, only its stamp moved, while the other widened it: the widening stands with its batch, and nothing is said, either way round', () => {
  const X = TWIN, t = X.start.liveTrayPlans.find(x => x.id === X.id), d = mine(), there = X.apply(X.start, { ...t, rows: t.rows.map(r => ({ ...r, price: 19 })) }, d);
  const back = X.apply(there, { ...there.liveTrayPlans.find(x => x.id === X.id), rows: t.rows }, d), wide = X.widen(X.start, theirs()), bare = p => { const { updatedAt, ...rest } = p.liveTrayPlans.find(x => x.id === X.id); return rest; };
  const moved = same(bare(back), bare(X.start)) && back.liveTrayPlans.find(x => x.id === X.id).updatedAt !== t.updatedAt && same(X.batches(back), X.batches(X.start)), out = [];
  for (const [me, cloud, name] of [[back, wide, 'this device changed it back'], [wide, back, 'the cloud changed it back']]) {
    const r = X.join(X.start, me, cloud), p = r.ok && r.plan.liveTrayPlans.find(x => x.id === X.id);
    if (!(ok(r) && p.through === '2027-05-10' && X.week(r.plan, '2027-05-10').length === 1 && same(X.harvest(r.plan), [3, 6]) && !r.report.items.length)) out.push([name, r.ok ? [p.through, r.report.items.map(x => x.kind)] : r.why]);
  }
  return [moved && out.length === 0, [moved, out]];
});
// What a demand plan makes besides its batches: the heated greenhouse benches and a crop for a row that names one the plan does not hold.
const BARE = (() => { const pool = new Set(FARM.gardens.filter(g => g.liveTrayPool === true).map(g => g.id)); return { ...FARM, gardens: FARM.gardens.filter(g => !pool.has(g.id)), beds: FARM.beds.filter(b => b.liveTrayPool !== true), plantings: FARM.plantings.filter(p => !p.liveTray), liveTrayPlans: [] }; })();
const fresh = (name, rows) => ({ ...TR.draft(2027), from: '2027-05-03', name, rows });
const NEWCROP = rowId => ({ id: rowId, name: 'Pea tendrils', days: 12, price: 20, spring: 2, summer: 2, fall: 0 });
const tendrils = p => (p.crops || []).filter(c => TR.norm(c.name) === 'peatendrils');
tryCase('two devices that each start a demand plan on a farm with no heated greenhouse benches make one garden and one bed for them: joined, one of each, every batch of both plans on that bed, and saving again makes no other', () => {
  const a = TWIN.apply(BARE, fresh('Phone demand', [{ id: 'row-a', name: 'Borage', days: 12, price: 20, spring: 2, summer: 0, fall: 0 }]), mine());
  const b = TWIN.apply(BARE, fresh('Laptop demand', [{ id: 'row-b', name: 'Twin Shoots', days: 14, price: 18, spring: 1, summer: 0, fall: 0 }]), theirs()), r = M.merge(BARE, a, b);
  if (!ok(r)) return [false, r.why];
  const gardens = r.plan.gardens.filter(g => g.liveTrayPool === true), beds = r.plan.beds.filter(x => x.liveTrayPool === true), trays = r.plan.plantings.filter(p => p.liveTray);
  let again = null;
  try { again = TWIN.apply(r.plan, r.plan.liveTrayPlans[0], device('again', 10)); } catch (e) { again = String(e.message); }
  const good = gardens.length === 1 && beds.length === 1 && beds[0].gardenId === gardens[0].id && trays.length > 0 && trays.every(p => p.bedId === beds[0].id) && new Set(trays.map(p => p.liveTray.planId)).size === 2
    && typeof again === 'object' && again.gardens.filter(g => g.liveTrayPool === true).length === 1 && again.beds.filter(x => x.liveTrayPool === true).length === 1;
  return [good, [gardens.map(g => g.id), beds.map(x => [x.id, x.gardenId]), typeof again === 'string' ? again : '']];
});
tryCase('a demand plan is made by the grower, not worked out: two devices that each start one keep two, each with all its batches, and nothing of either is dropped or joined half from each', () => {
  const a = TWIN.apply(FARM, fresh('Weekly', [{ id: 'row-a', name: 'Borage', days: 12, price: 20, spring: 2, summer: 0, fall: 0 }]), mine());
  const b = TWIN.apply(FARM, fresh('Weekly', [{ id: 'row-b', name: 'Twin Shoots', days: 14, price: 18, spring: 1, summer: 0, fall: 0 }]), theirs()), r = M.merge(FARM, a, b);
  const own = (p, id) => p.plantings.filter(x => x.liveTray && x.liveTray.planId === id), A = a.liveTrayPlans.find(t => t.name === 'Weekly'), B = b.liveTrayPlans.find(t => t.name === 'Weekly');
  return [A.id !== B.id && ok(r) && r.plan.liveTrayPlans.filter(t => t.name === 'Weekly').length === 2 && own(r.plan, A.id).length === own(a, A.id).length && own(r.plan, B.id).length === own(b, B.id).length && !r.report.items.length,
    r.ok ? [r.plan.liveTrayPlans.map(t => t.name), r.report.items.map(x => x.kind)] : r.why];
});
tryCase('a crop that a demand row adds, added on two devices, is one crop: two new demand plans that each name it, or one plan that each device gave the same new crop, leave one crop of that name, which the rows name, and none of the planner\'s own', () => {
  const a = TWIN.apply(FARM, fresh('Phone demand', [NEWCROP('row-a')]), mine()), b = TWIN.apply(FARM, fresh('Laptop demand', [NEWCROP('row-b')]), theirs()), r = M.merge(FARM, a, b);
  const one = r.ok && tendrils(r.plan), two = ok(r) && tendrils(a).length === 1 && one.length === 1 && r.plan.liveTrayPlans.filter(t => t.rows.some(x => x.cropId === one[0].id)).length === 2 && !Lib.crops.some(c => c.id === one[0].id) && !r.report.items.length;
  // one plan, the same new crop row added on each device (the rows differ by id): the cloud's demand plan stands, and there is still one crop
  const add = (dev, rowId) => { const t = FARM.liveTrayPlans.find(x => x.id === TRAYS.id); return TWIN.apply(FARM, { ...t, rows: [...t.rows, NEWCROP(rowId)] }, dev); };
  const s = M.merge(FARM, add(mine(), 'row-m'), add(theirs(), 'row-t')), single = ok(s) && tendrils(s.plan).length === 1 && s.plan.liveTrayPlans.find(t => t.id === TRAYS.id).rows.some(x => x.cropId === tendrils(s.plan)[0].id);
  return [two && single, [r.ok ? one.map(c => c.id) : r.why, s.ok ? tendrils(s.plan).map(c => c.id) : s.why]];
});
tryCase('a crop row that names a crop the plan holds under another name now is a crop of its own, under the next free id; the renamed crop is left as it is', () => {
  const a = TWIN.apply(FARM, fresh('Phone demand', [NEWCROP('row-a')]), mine()), c = tendrils(a)[0];
  const renamed = { ...a, crops: a.crops.map(x => (x.id === c.id ? { ...x, name: 'Micro · Pea tips' } : x)) }, b = TWIN.apply(renamed, fresh('Another', [NEWCROP('row-c')]), device('again', 10));
  const ids = b.crops.map(x => x.id), made = tendrils(b), kept = b.crops.find(x => x.id === c.id);
  return [ids.length === new Set(ids).size && made.length === 1 && made[0].id !== c.id && made[0].id.startsWith(c.id) && !!kept && kept.name === 'Micro · Pea tips', [ids.filter(x => x.startsWith(c.id)), made.map(x => x.id)]];
});
tryCase('a job put off is taken whole, whatever the job: a from, a to and its own day never come half from each device', () => {
  const put = (plan, kind, delay) => { const p = planting(plan, X1); return putPlanting(plan, { ...p, tasks: { ...(p.tasks || {}), delay: { ...((p.tasks || {}).delay || {}), [kind]: delay } } }); };
  const s = put(FARM, 'sow', { from: '2027-06-01', to: '2027-06-03', own: '2027-06-01' });
  const r = M.merge(s, put(s, 'sow', { from: '2027-06-02', to: '2027-06-04', own: '2027-06-02' }), put(s, 'sow', { from: '2027-06-01', to: '2027-06-05', own: '2027-06-01' }));
  const other = M.merge(s, put(s, 'field', { from: '2027-07-01', to: '2027-07-04', own: '2027-07-01' }), put(s, 'sow', { from: '2027-06-01', to: '2027-06-05', own: '2027-06-01' }));
  const d = r.ok && planting(r.plan, X1).tasks.delay, o = other.ok && planting(other.plan, X1).tasks.delay;
  return [ok(r) && same(d.sow, { from: '2027-06-01', to: '2027-06-05', own: '2027-06-01' }) && items(r, 'same-box').length === 1 && ok(other) && o.sow.to === '2027-06-05' && o.field.to === '2027-07-04' && !other.report.items.length, [d, o]];
});
tryCase('keys of one record that are read together are one value: a nursery space\'s from and to, while its name is still joined beside them', () => {
  const SPACE = (FARM.nursery && FARM.nursery.spaces || [])[0];
  if (!SPACE) return [false, 'the farm has no nursery space'];
  const sp = (plan, change) => ({ ...plan, nursery: { ...plan.nursery, spaces: plan.nursery.spaces.map(x => (x.id === SPACE.id ? { ...x, ...change } : x)) } });
  const s = sp(FARM, { from: '01-01', to: '03-01' });
  const r = M.merge(s, sp(s, { from: '02-01', name: 'Mine' }), sp(s, { to: '04-01' })), x = r.ok && r.plan.nursery.spaces.find(y => y.id === SPACE.id);
  const one = M.merge(s, sp(s, { from: '02-01' }), sp(s, { holds: 7 })), y = one.ok && one.plan.nursery.spaces.find(z => z.id === SPACE.id);
  return [ok(r) && x.from === '01-01' && x.to === '04-01' && x.name === 'Mine' && items(r, 'same-box').length === 1 && same(items(r, 'same-box')[0].mine, { from: '02-01', to: '03-01' })
    && ok(one) && y.from === '02-01' && y.to === '03-01' && y.holds === 7 && !one.report.items.length, [x, r.report, y]];
});
tryCase('a yield is one value with its basis: on a crop and on a planting, the basis from one device never meets the yield from the other', () => {
  const CROP = FARM.crops[0];
  const crop = (plan, change) => ({ ...plan, crops: plan.crops.map(c => (c.id === CROP.id ? { ...c, ...change } : c)) });
  const s = setP(crop(FARM, { yield: 2, yBasis: 'plant' }), X1, { yield: 2, yieldBasis: 'plant' });
  const r = M.merge(s, setP(crop(s, { yBasis: 'ft', note: 'mine' }), X1, { yieldBasis: 'container' }), setP(crop(s, { yield: 9 }), X1, { yield: 9 }));
  const c = r.ok && r.plan.crops.find(x => x.id === CROP.id), p = r.ok && planting(r.plan, X1);
  return [ok(r) && c.yield === 9 && c.yBasis === 'plant' && c.note === 'mine' && p.yield === 9 && p.yieldBasis === 'plant' && items(r, 'same-box').length === 2, [c && [c.yield, c.yBasis], p && [p.yield, p.yieldBasis], r.report]];
});
tryCase('a crop\'s selling line is taken whole: a unit from one device never meets a price from the other; two crops\' lines are still joined', () => {
  const sell = (plan, id, line) => ({ ...plan, assumptions: { ...(plan.assumptions || {}), sell: { ...((plan.assumptions || {}).sell || {}), [id]: line } } });
  const s = sell(sell(FARM, 'crop.a', { unit: 'lb', price: 4 }), 'crop-b', { unit: 'lb', price: 3 });
  const r = M.merge(s, sell(s, 'crop.a', { unit: 'bunch', price: 4 }), sell(s, 'crop.a', { unit: 'lb', price: 5 })), a = r.ok && r.plan.assumptions.sell['crop.a'];
  const two = M.merge(s, sell(s, 'crop.a', { unit: 'bunch', price: 2 }), sell(s, 'crop-b', { unit: 'lb', price: 6 }));
  return [ok(r) && same(a, { unit: 'lb', price: 5 }) && items(r, 'same-box').length === 1 && ok(two) && two.plan.assumptions.sell['crop.a'].unit === 'bunch' && two.plan.assumptions.sell['crop-b'].price === 6 && !two.report.items.length, [a, r.report]];
});
tryCase('where a crop\'s days start and how many days less are two boxes: each device\'s stands', () => {
  const st = (plan, line) => ({ ...plan, assumptions: { ...(plan.assumptions || {}), starts: { ...((plan.assumptions || {}).starts || {}), 'crop-b': line } } });
  const s = st(FARM, { from: 'transplant', less: 14 }), r = M.merge(s, st(s, { from: 'sowing', less: 14 }), st(s, { from: 'transplant', less: 10 }));
  return [ok(r) && same(r.plan.assumptions.starts['crop-b'], { from: 'sowing', less: 10 }) && !r.report.items.length, r.ok ? r.plan.assumptions.starts['crop-b'] : r.why];
});
tryCase('what the planner noted of an edit is taken whole, in the plan and in what a file keeps of it; a variety\'s photo is one file with its type', () => {
  const V = FARM.varieties[0];
  const fact = (plan, f) => ({ ...plan, lrfNext: { ...(plan.lrfNext || {}), facts: { varieties: { [V.id]: f } } }, lrfNextKeep: { v: 1, savedAt: '2027-03-01T08:00:00.000Z', device: 'd', keep: { facts: { varieties: { [V.id]: f } } } },
    varieties: plan.varieties.map(v => (v.id === V.id ? { ...v, photo: f.photo } : v)) });
  const s = fact(FARM, { name: V.name, set: { dtm: 60 }, was: { dtm: 55 }, photo: { sha256: 'aa', mime: 'image/jpeg' } });
  const m = fact(s, { name: V.name, set: { dtm: 62 }, was: { dtm: 55 }, photo: { sha256: 'bb', mime: 'image/jpeg' } }), t = fact(s, { name: V.name, set: { dtm: 60, germ: 80 }, was: { dtm: 55, germ: 85 }, photo: { sha256: 'aa', mime: 'image/png' } });
  const r = M.merge(s, m, t), f = r.ok && r.plan.lrfNext.facts.varieties[V.id], k = r.ok && r.plan.lrfNextKeep.keep.facts.varieties[V.id], ph = r.ok && r.plan.varieties.find(v => v.id === V.id).photo;
  return [ok(r) && same(f.set, { dtm: 60, germ: 80 }) && same(f.was, { dtm: 55, germ: 85 }) && same(k, f) && same(ph, { sha256: 'aa', mime: 'image/png' }) && items(r, 'same-box').length === 3, [f, k, ph, r.report.items.map(x => x.path.join('.'))]];
});
tryCase('what a device notes for itself about the plan it holds is never reported: when it was loaded and from where, whether it has the farm photo', () => {
  const own = (plan, at, from, sha) => ({ ...plan, lrfNext: { ...(plan.lrfNext || {}), importedAt: at, from, attic: 'cloud', mapImage: { mime: 'image/jpeg', sha256: sha } } });
  const s = own(FARM, '2027-03-01T08:00:00.000Z', 'a.zip', 'aa'), r = M.merge(s, setP(own(s, '2027-03-02T08:00:00.000Z', 'the cloud', 'bb'), X1, { note: 'mine' }), setP(own(s, '2027-03-03T08:00:00.000Z', 'b.zip', 'cc'), X2, { note: 'theirs' }));
  return [ok(r) && !r.report.items.length && planting(r.plan, X1).note === 'mine' && planting(r.plan, X2).note === 'theirs' && r.plan.lrfNext.mapImage.sha256 === 'cc', r.report];
});
tryCase('three plans as files hold them: with nothing of its own to add, this device gets the cloud\'s very text; what was taken in is counted', () => {
  const file = (plan, at, dev) => JSON.stringify({ ...plan, lrfNext: { ...(plan.lrfNext || {}), importedAt: at }, lrfNextKeep: { v: 1, savedAt: at, device: dev, keep: {} } });
  const t = record(setP(FARM, X2, { note: 'theirs' }), A1.id, 'sow', DAY, theirs()), tText = file(t, '2027-03-03T08:00:00.000Z', 'd-theirs');
  const quiet = M.joinTexts(file(FARM, '2027-03-01T08:00:00.000Z', 'd-mine'), file(FARM, '2027-03-04T08:00:00.000Z', 'd-mine'), tText, { order: SL.DONE_ORDER });
  const busy = M.joinTexts(file(FARM, '2027-03-01T08:00:00.000Z', 'd-mine'), file(setP(FARM, X1, { note: 'mine' }), '2027-03-02T08:00:00.000Z', 'd-mine'), tText, { order: SL.DONE_ORDER });
  const bad = M.joinTexts('{', tText, tText);
  return [ok(quiet) && quiet.same === true && quiet.text === tText && quiet.taken.recorded.sow === 1 && quiet.taken.changed === 1 && quiet.taken.lists.includes('seedInventory') && quiet.taken.any
    && ok(busy) && busy.same === false && JSON.parse(busy.text).plantings.find(p => p.id === X1).note === 'mine' && busy.taken.recorded.sow === 1 && bad.ok === false, [quiet.same, quiet.taken, busy.same, busy.taken, bad.why]];
});
tryCase('a list of plain values is one value: an order of beds changed on both sides is the cloud\'s, and reported', () => {
  const order = (plan, ids) => ({ ...plan, gardens: plan.gardens.map(g => (g.id === GARDEN.id ? { ...g, bedOrder: { ...g.bedOrder, ids } } : g)) });
  const ids = GARDEN.bedOrder.ids, a = ids.slice().reverse(), b = [...ids.slice(1), ids[0]];
  const r = M.merge(FARM, order(FARM, a), order(FARM, b));
  return [ok(r) && M.same(r.plan.gardens.find(g => g.id === GARDEN.id).bedOrder.ids, b) && items(r, 'same-box').length === 1, r.report.items.length];
});
tryCase('a list of objects that have no ids, and no rule of its own, is one value', () => {
  const s = { ...FARM, loose: [{ a: 1 }, { a: 2 }] }, r = M.merge(s, { ...s, loose: [{ a: 1 }, { a: 2 }, { a: 3 }] }, { ...s, loose: [{ a: 9 }, { a: 2 }] });
  return [ok(r) && M.same(r.plan.loose, [{ a: 9 }, { a: 2 }]) && items(r, 'same-box').length === 1, r.plan && r.plan.loose];
});
tryCase('the farm\'s settings are joined key by key', () => {
  const set = (plan, change) => ({ ...plan, settings: { ...plan.settings, ...change } });
  const r = M.merge(FARM, set(FARM, { germ: 80 }), set(FARM, { buffer: 15, turnover: 9 }));
  return [ok(r) && r.plan.settings.germ === 80 && r.plan.settings.buffer === 15 && r.plan.settings.turnover === 9 && r.plan.settings.frostLast === FARM.settings.frostLast && !r.report.items.length, r.plan && r.plan.settings];
});
// a planting's place and its day
tryCase('a planting\'s place is one value: moved to another bed here and shifted along its bed there, the cloud\'s place stands whole', () => {
  const other = FARM.beds.find(b => b.id !== planting(FARM, X1).bedId).id;
  const r = M.merge(FARM, setP(FARM, X1, { bedId: other }), setP(FARM, X1, { startFt: 5, ft: 10 })), p = planting(r.plan, X1), said = items(r, 'same-box');
  return [ok(r) && p.bedId === planting(FARM, X1).bedId && p.startFt === 5 && p.ft === 10 && said.length === 1 && said[0].mine.bedId === other, [p.bedId, said]];
});
tryCase('a planting moved to another bed here and to another day there: both, since place and day are two things', () => {
  const other = FARM.beds.find(b => b.id !== planting(FARM, X1).bedId).id;
  const r = M.merge(FARM, setP(FARM, X1, { bedId: other }), setP(FARM, X1, { date: '2027-06-06' })), p = planting(r.plan, X1);
  return [ok(r) && p.bedId === other && p.date === '2027-06-06' && !r.report.items.length, [p.bedId, p.date, r.report]];
});
// a planting that waits to be placed
tryCase('a planting put on a bed on one side and changed as it waited on the other is on its bed once, and the report says so', () => {
  const w = { ...planting(FARM, X1), id: 'waits-1' }; delete w.bedId;
  const s = { ...FARM, lrfNext: { ...(FARM.lrfNext || {}), waiting: [w] } };
  const placed = { ...s, plantings: [...s.plantings, { ...w, bedId: planting(FARM, X1).bedId }], lrfNext: { ...s.lrfNext, waiting: [] } }, edited = { ...s, lrfNext: { ...s.lrfNext, waiting: [{ ...w, date: '2027-07-07' }] } };
  const a = M.merge(s, placed, edited), b = M.merge(s, edited, placed);
  return [ok(a) && ok(b) && [a, b].every(r => r.plan.plantings.filter(p => p.id === 'waits-1').length === 1 && !r.plan.lrfNext.waiting.length && items(r, 'placed-and-waiting').length === 1), [a.why, b.why, a.report, b.report]];
});

// a recording is one unit
tryCase('what the merge reads in the seed log is what the planner writes there: a sowing\'s draw, and its return', () => {
  const d = mine(), sown = record(FARM, A1.id, 'sow', DAY, d), back = takeBack(sown, A1.id, 'sow', d), log = back.seedInventory.adjustments.slice(-2);
  const batch = planting(sown, A1.id).workflow.seedUse[0].batchId;
  return [log[0].kind === 'use' && log[0].reason.startsWith(`Reviewed sowing ${batch}: `) && log[1].kind === 'count' && log[1].reason.startsWith(`Sowing ${batch} taken back: `) && lot(back, LOT).quantity === HELD, log.map(e => [e.kind, e.reason])];
});
tryCase('a sowing ticked here while the cloud\'s plan changed elsewhere: sown, and the seed is off its lot', () => {
  const r = M.merge(FARM, record(FARM, A1.id, 'sow', DAY, mine()), setP(FARM, X1, { note: 't' })), p = planting(r.plan, A1.id);
  return [ok(r) && p.done.sow === DAY && p.workflow.history.length === 1 && draws(r.plan, LOT) === A1.need && lot(r.plan, LOT).quantity === HELD - A1.need && planting(r.plan, X1).note === 't' && !r.report.items.length, [p.done, lot(r.plan, LOT).quantity, r.report]];
});
tryCase('two sowings of one variety, one ticked on each device: both sown, and both amounts are off the one lot', () => {
  const r = M.merge(FARM, record(FARM, A1.id, 'sow', DAY, mine()), record(FARM, A2.id, 'sow', DAY, theirs()));
  const log = r.plan.seedInventory.adjustments.filter(e => e.lotId === LOT && e.kind === 'use');
  return [ok(r) && planting(r.plan, A1.id).done.sow === DAY && planting(r.plan, A2.id).done.sow === DAY && lot(r.plan, LOT).quantity === HELD - A1.need - A2.need && log.length === 2 && !r.report.items.length, [lot(r.plan, LOT).quantity, HELD, A1.need, A2.need, r.report]];
});
tryCase('one sowing ticked on both devices draws seed once: the cloud\'s stands whole, this device\'s is dropped whole, and the report says so', () => {
  const m = record(FARM, A1.id, 'sow', DAY, mine()), t = record(FARM, A1.id, 'sow', E.d2s(E.addDays(E.s2d(DAY), -1)), theirs());
  const r = M.merge(FARM, m, t), p = planting(r.plan, A1.id), said = items(r, 'recorded-twice');
  const batches = new Set(p.workflow.seedUse.map(u => u.batchId)), theirBatch = planting(t, A1.id).workflow.seedUse[0].batchId;
  return [ok(r) && p.done.sow === planting(t, A1.id).done.sow && p.workflow.history.length === 1 && batches.size === 1 && batches.has(theirBatch) && draws(r.plan, LOT) === A1.need && lot(r.plan, LOT).quantity === HELD - A1.need
    && said.length === 1 && said[0].id === A1.id && said[0].job === 'sow' && said[0].mine === DAY, [p.done, [...batches], lot(r.plan, LOT).quantity, r.report]];
});
tryCase('and the same on the same day: still once', () => {
  const r = M.merge(FARM, record(FARM, A1.id, 'sow', DAY, mine()), record(FARM, A1.id, 'sow', DAY, theirs()));
  return [ok(r) && lot(r.plan, LOT).quantity === HELD - A1.need && draws(r.plan, LOT) === A1.need && planting(r.plan, A1.id).workflow.history.length === 1 && items(r, 'recorded-twice').length === 1, [lot(r.plan, LOT).quantity, r.report]];
});
tryCase('a send whose answer was lost: the cloud holds this device\'s own sowing already, and it is counted once', () => {
  const sent = record(FARM, A1.id, 'sow', DAY, mine()), m = setP(sent, X1, { note: 'made after the send' });
  const r = M.merge(FARM, m, sent), again = M.merge(FARM, sent, sent);
  return [ok(r) && lot(r.plan, LOT).quantity === HELD - A1.need && draws(r.plan, LOT) === A1.need && planting(r.plan, A1.id).workflow.history.length === 1 && planting(r.plan, X1).note === 'made after the send' && !r.report.items.length && again.plan === sent, [lot(r.plan, LOT).quantity, r.report]];
});
tryCase('the same count of a lot seen twice is one count, and a second count made after it is kept', () => {
  const d = mine(), sent = countLot(FARM, LOT, HELD - 7, d), m = countLot(sent, LOT, HELD - 9, d);
  const r = M.merge(FARM, m, { ...sent, settings: { ...sent.settings, buffer: 12 } });
  return [ok(r) && lot(r.plan, LOT).quantity === HELD - 9 && r.plan.settings.buffer === 12 && !r.report.items.length, [lot(r.plan, LOT).quantity, r.report]];
});
tryCase('more drawn on two devices than a lot holds: it stops at zero, the rest is seed used without a counted lot, nothing is asked and the report says so', () => {
  const r = M.merge(FARM, record(FARM, T1.id, 'sow', T1.planned, mine()), record(FARM, T2.id, 'sow', T2.planned, theirs())), short = T1.need + T2.need - SMALLQ, said = items(r, 'seed-short');
  return [ok(r) && lot(r.plan, SMALL).quantity === 0 && draws(r.plan, SMALL) === SMALLQ && loose(r.plan, T1.id) === short && loose(r.plan, T2.id) === 0 && said.length === 1 && said[0].id === SMALL && said[0].short === short
    && planting(r.plan, T1.id).workflow.seedUse.reduce((n, u) => n + u.quantity, 0) === T1.need, [lot(r.plan, SMALL).quantity, draws(r.plan, SMALL), loose(r.plan, T1.id), short, r.why, r.report]];
});
tryCase('a sowing taken back here while the cloud\'s plan changed elsewhere: its seed is back on the lot, once', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6));
  const r = M.merge(s, takeBack(s, A1.id, 'sow', mine()), record(s, A2.id, 'sow', DAY, theirs()));
  return [ok(r) && !planting(r.plan, A1.id).done && !planting(r.plan, A1.id).workflow.seedUse && lot(r.plan, LOT).quantity === HELD - A2.need && draws(r.plan, LOT) === A2.need && !r.report.items.length, [lot(r.plan, LOT).quantity, r.report]];
});
tryCase('a sowing taken back on both devices: its seed goes back once, not twice', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6));
  const r = M.merge(s, takeBack(s, A1.id, 'sow', mine()), takeBack(s, A1.id, 'sow', theirs()));
  return [ok(r) && !planting(r.plan, A1.id).done && lot(r.plan, LOT).quantity === HELD && draws(r.plan, LOT) === 0, [lot(r.plan, LOT).quantity, HELD, r.why, r.report]];
});
tryCase('taken back here, taken back and sown again there: the cloud\'s sowing stands, and the lot is short by one sowing', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6)), d = theirs();
  const t = record(takeBack(s, A1.id, 'sow', d), A1.id, 'sow', DAY, d), r = M.merge(s, takeBack(s, A1.id, 'sow', mine()), t), p = planting(r.plan, A1.id);
  return [ok(r) && p.done.sow === DAY && new Set(p.workflow.seedUse.map(u => u.batchId)).size === 1 && lot(r.plan, LOT).quantity === HELD - A1.need && items(r, 'recorded-twice').length === 1, [p.done, lot(r.plan, LOT).quantity, r.why, r.report]];
});
tryCase('a sowing recorded here on a planting the other device moved: the recorded bed and day stand, and the move is reported, not applied', () => {
  const other = FARM.beds.find(b => b.id !== planting(FARM, A1.id).bedId).id, moved = setP(FARM, A1.id, { bedId: other, date: '2027-08-08' });
  const a = M.merge(FARM, record(FARM, A1.id, 'sow', DAY, mine()), moved), b = M.merge(FARM, moved, record(FARM, A1.id, 'sow', DAY, theirs()));
  const fine = (r, whose) => { const p = planting(r.plan, A1.id), said = items(r, 'move-not-applied'); return ok(r) && p.done.sow === DAY && p.bedId === planting(FARM, A1.id).bedId && p.date === planting(FARM, A1.id).date && said.length === 2 && said.every(x => x.whose === whose && x.id === A1.id) && lot(r.plan, LOT).quantity === HELD - A1.need; };
  return [fine(a, 'theirs') && fine(b, 'mine'), [a.why, b.why, a.report, b.report]];
});
tryCase('a sowing recorded late pushes its planting out; the other device\'s own change of day is reported, and the pushed day stands', () => {
  const late = E.d2s(E.addDays(E.s2d(DAY), 9)), m = record(FARM, A1.id, 'sow', late, mine()), pushed = planting(m, A1.id).date;
  const r = M.merge(FARM, m, setP(FARM, A1.id, { date: E.d2s(E.addDays(E.s2d(planting(FARM, A1.id).date), 2)), note: 'kept' })), p = planting(r.plan, A1.id);
  return [pushed !== planting(FARM, A1.id).date && ok(r) && p.date === pushed && p.done.sow === late && p.note === 'kept' && items(r, 'move-not-applied').length === 1, [pushed, p.date, r.report]];
});
tryCase('a job that draws no seed, recorded on both devices on different days: the cloud\'s day, one line of history, reported', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6)), d1 = E.d2s(E.addDays(E.s2d(DAY), 20)), d2 = E.d2s(E.addDays(E.s2d(DAY), 22));
  const r = M.merge(s, record(s, A1.id, 'harden', d1, mine(), { follow: false }), record(s, A1.id, 'harden', d2, theirs(), { follow: false })), p = planting(r.plan, A1.id);
  return [ok(r) && p.done.harden === d2 && p.done.sow === DAY && p.workflow.history.filter(x => x.kind === 'harden').length === 1 && items(r, 'recorded-twice').length === 1 && lot(r.plan, LOT).quantity === HELD - A1.need, [p.done, r.report]];
});
// a planting that is potted up and hardened off, found on the farm: its sowing recorded, then one of the two jobs on each device
const POT = FARM.plantings.find(p => { const k = W.steps(e0, p).map(st => st.kind); return k.includes('sow') && k.includes('potup') && k.includes('harden'); });
const potted = () => {
  const day = kind => W.steps(e0, POT).find(st => st.kind === kind).planned, s = record(FARM, POT.id, 'sow', E.d2s(day('sow')), device('before', 6));
  const late = E.d2s(E.addDays(day('harden'), 5)), pot = E.d2s(day('potup'));
  return { s, late, pot, hardened: record(s, POT.id, 'harden', late, mine()), pottedUp: record(s, POT.id, 'potup', pot, theirs()) };
};
tryCase('two different jobs, one on each device, and one of them pushed the planting out: both stand, and the pushed day is kept whichever device reached the cloud first', () => {
  const { s, late, pot, hardened, pottedUp } = potted(), pushed = planting(hardened, POT.id).date;
  const a = M.merge(s, hardened, pottedUp), b = M.merge(s, pottedUp, hardened);
  const fine = r => { const p = planting(r.plan, POT.id), line = p.workflow.history.find(x => x.kind === 'harden'); return ok(r) && p.date === pushed && line.follow.to === pushed && p.done.harden === late && p.done.potup === pot && !!p.done.sow && !r.report.items.length; };
  return [pushed !== planting(s, POT.id).date && planting(pottedUp, POT.id).date === planting(s, POT.id).date && fine(a) && fine(b), [pushed, a.why, b.why, a.plan && planting(a.plan, POT.id).date, b.plan && planting(b.plan, POT.id).date, a.report, b.report]];
});
tryCase('two different jobs, one on each device, and each device also changed the day: the cloud\'s day stands, and this device\'s is reported', () => {
  const { s, late, pot, hardened, pottedUp } = potted(), r = M.merge(s, hardened, setP(pottedUp, POT.id, { date: '2027-09-09' })), p = planting(r.plan, POT.id), said = items(r, 'move-not-applied');
  return [ok(r) && p.date === '2027-09-09' && p.done.harden === late && p.done.potup === pot && said.length === 1 && said[0].whose === 'mine' && said[0].what === 'day', [p.date, r.report]];
});
tryCase('two different jobs of one planting, one recorded on each device: both stand', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6)), d1 = E.d2s(E.addDays(E.s2d(DAY), 20));
  const r = M.merge(s, setP(s, A1.id, { note: 'm' }), record(s, A1.id, 'harden', d1, theirs(), { follow: false })), p = planting(r.plan, A1.id);
  return [ok(r) && p.done.harden === d1 && p.done.sow === DAY && p.note === 'm' && p.workflow.history.length === 2 && !r.report.items.length, [p.done, r.report]];
});
// what a second reader found (the pull request says who): each of these gave a wrong plan and reported nothing
tryCase('a send whose answer was lost, and that sowing then taken back here: it is not sown, and its seed is back on the lot', () => {
  const d = mine(), sent = record(FARM, A1.id, 'sow', DAY, d), m = takeBack(sent, A1.id, 'sow', d);
  const a = M.merge(FARM, m, sent), b = M.merge(FARM, m, setP(sent, X1, { note: 't' }));
  const fine = r => ok(r) && !planting(r.plan, A1.id).done && !planting(r.plan, A1.id).workflow.seedUse && planting(r.plan, A1.id).workflow.history.length === 2 && lot(r.plan, LOT).quantity === HELD && !r.report.items.length;
  return [fine(a) && fine(b) && planting(b.plan, X1).note === 't', [a.why, b.why, a.plan && lot(a.plan, LOT).quantity, a.report]];
});
tryCase('recorded and taken back here, recorded there: the cloud\'s sowing stands, and taking it back afterwards gives its seed back', () => {
  const d = mine(), m = takeBack(record(FARM, A1.id, 'sow', DAY, d), A1.id, 'sow', d), t = record(FARM, A1.id, 'sow', DAY, theirs());
  const r = M.merge(FARM, m, t), p = planting(r.plan, A1.id), last = p.workflow.history[p.workflow.history.length - 1];
  const after = takeBack(r.plan, A1.id, 'sow', device('later', 20));
  return [ok(r) && p.done.sow === DAY && last.action === 'complete' && last.sowingReview.batchId === p.workflow.seedUse[0].batchId && lot(r.plan, LOT).quantity === HELD - A1.need && !r.report.items.length
    && lot(after, LOT).quantity === HELD && !planting(after, A1.id).workflow.seedUse, [r.why, p.workflow.history.map(x => x.action), lot(after, LOT).quantity]];
});
tryCase('a sown planting taken out of the plan, on either device, keeps its seed used: the lot is as one device would have it', () => {
  const S = record(FARM, A1.id, 'sow', DAY, device('before', 6)), rm = (plan, id) => ({ ...plan, plantings: plan.plantings.filter(x => x.id !== id) }), d = mine();
  const rows = [[rm(S, A1.id), setP(S, X1, { note: 't' }), HELD - A1.need], [setP(S, X1, { note: 'm' }), rm(S, A1.id), HELD - A1.need],
    [rm(S, A1.id), record(S, A2.id, 'sow', DAY, theirs()), HELD - A1.need - A2.need], [rm(record(S, A2.id, 'sow', DAY, d), A2.id), setP(S, X1, { note: 't' }), HELD - A1.need - A2.need]];
  const got = rows.map(([m, t]) => M.merge(S, m, t));
  return [got.every((r, i) => ok(r) && lot(r.plan, LOT).quantity === rows[i][2] && !r.report.items.length), got.map(r => r.why || lot(r.plan, LOT).quantity)];
});
tryCase('a sowing taken back here on a planting the other device also changed: its lines and its seed are off the planting, and the change is kept', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6)), r = M.merge(s, takeBack(s, A1.id, 'sow', mine()), setP(s, A1.id, { note: 'theirs' })), p = planting(r.plan, A1.id);
  return [ok(r) && !p.done && !p.workflow.seedUse && p.workflow.history.map(x => x.action).join() === 'complete,clear-work' && p.note === 'theirs' && lot(r.plan, LOT).quantity === HELD && !r.report.items.length, [r.why, p.done, p.workflow, lot(r.plan || s, LOT).quantity]];
});
tryCase('two jobs, one on each device, in an order the planner refuses (sown after it was planted out): the cloud\'s stands, this device\'s is dropped with its seed, and the report says so', () => {
  const later = E.d2s(E.addDays(E.s2d(DAY), 20)), sooner = E.d2s(E.addDays(E.s2d(DAY), 5));
  const m = record(FARM, A1.id, 'sow', later, mine(), { follow: false }), t = record(FARM, A1.id, 'field', sooner, theirs(), { follow: false });
  const r = M.merge(FARM, m, t, { order: SL.DONE_ORDER }), p = planting(r.plan, A1.id), said = items(r, 'recorded-twice'), free = M.merge(FARM, m, t);
  let refused = false; try { record(t, A1.id, 'sow', later, mine(), { follow: false }); } catch (_) { refused = true; }
  return [refused && ok(r) && p.done.field === sooner && !p.done.sow && !p.workflow.seedUse && p.workflow.history.length === 1 && lot(r.plan, LOT).quantity === HELD && said.length === 1 && said[0].job === 'sow' && said[0].against === 'field' && said[0].mine === later
    && ok(free) && planting(free.plan, A1.id).done.sow === later, [refused, r.why, p.done, r.report]];
});
// what a third reader found (the pull request says who)
tryCase('a late sowing sent, its answer lost, then taken back here: the day it had pushed goes back with it', () => {
  const late = E.d2s(E.addDays(E.s2d(DAY), 9)), d = mine(), sent = record(FARM, A1.id, 'sow', late, d), here = takeBack(sent, A1.id, 'sow', d), r = M.merge(FARM, here, sent);
  return [planting(sent, A1.id).date !== planting(FARM, A1.id).date && ok(r) && !planting(r.plan, A1.id).done && planting(r.plan, A1.id).date === planting(here, A1.id).date && lot(r.plan, LOT).quantity === HELD, [r.why, planting(r.plan || here, A1.id).date, planting(here, A1.id).date, r.report]];
});
tryCase('a sowing sent, its answer lost, then the planting moved here: the move stands, with nothing to report', () => {
  const d = mine(), sent = record(FARM, A1.id, 'sow', DAY, d), other = FARM.beds.find(b => b.id !== planting(FARM, A1.id).bedId).id, here = setP(sent, A1.id, { bedId: other, date: '2027-07-07' });
  const r = M.merge(FARM, here, sent), p = planting(r.plan, A1.id);
  return [ok(r) && p.bedId === other && p.date === '2027-07-07' && p.done.sow === DAY && lot(r.plan, LOT).quantity === HELD - A1.need && !r.report.items.length, [r.why, p && [p.bedId, p.date], r.report]];
});
tryCase('a late sowing sent, its answer lost, then the day moved here: the day set here stands, though the sowing had pushed it', () => {
  const late = E.d2s(E.addDays(E.s2d(DAY), 9)), d = mine(), sent = record(FARM, A1.id, 'sow', late, d), here = setP(sent, A1.id, { date: '2027-07-07' });
  const r = M.merge(FARM, here, sent), p = planting(r.plan, A1.id);
  return [planting(sent, A1.id).date !== planting(FARM, A1.id).date && ok(r) && p.date === '2027-07-07' && p.done.sow === late && !r.report.items.length, [r.why, p && p.date, r.report]];
});
tryCase('two shared recordings that each pushed the planting out: the day after the last of them is the base, so a day changed on both sides is reported', () => {
  const day = kind => W.steps(e0, POT).find(st => st.kind === kind).planned, d = mine();
  const sown = record(FARM, POT.id, 'sow', E.d2s(E.addDays(day('sow'), 5)), d), first = planting(sown, POT.id).date;
  const hard = record(sown, POT.id, 'harden', E.d2s(E.addDays(W.steps(eng(sown), planting(sown, POT.id)).find(st => st.kind === 'harden').planned, 6)), d), last = planting(hard, POT.id).date;
  const r = M.merge(FARM, setP(hard, POT.id, { date: '2027-12-01' }), setP(hard, POT.id, { date: first })), p = planting(r.plan, POT.id), said = items(r, 'same-box').concat(items(r, 'move-not-applied'));
  return [first !== planting(FARM, POT.id).date && last !== first && ok(r) && p.date === first && said.length === 1, [first, last, r.why, p && p.date, r.report]];
});
tryCase('a sowing that pushed the planting long before, the planting since moved and shared, then moved here and its note changed there: the move stands', () => {
  const late = E.d2s(E.addDays(E.s2d(DAY), 9)), s = setP(record(FARM, A1.id, 'sow', late, device('before', 6)), A1.id, { date: '2027-08-08' });
  const r = M.merge(s, setP(s, A1.id, { date: '2027-12-01' }), setP(s, A1.id, { note: 't' })), p = planting(r.plan, A1.id);
  return [ok(r) && p.date === '2027-12-01' && p.note === 't' && !r.report.items.length, [r.why, p && p.date, r.report]];
});
tryCase('two jobs given back to the cloud\'s side one after the other: the joined jobs are in an order the planner accepts, and a later job can still be recorded', () => {
  const sow = E.d2s(E.addDays(E.s2d(DAY), 0)), hard = E.d2s(E.addDays(E.s2d(DAY), 15)), d0 = device('before', 6), s = record(record(FARM, A1.id, 'sow', sow, d0, { follow: false }), A1.id, 'harden', hard, d0, { follow: false });
  const d = mine(), m = record(record(takeBack(takeBack(s, A1.id, 'harden', d), A1.id, 'sow', d), A1.id, 'sow', E.d2s(E.addDays(E.s2d(DAY), 17)), d, { follow: false }), A1.id, 'harden', E.d2s(E.addDays(E.s2d(DAY), 25)), d, { follow: false });
  const t = record(s, A1.id, 'field', E.d2s(E.addDays(E.s2d(DAY), 20)), theirs(), { follow: false });
  const r = M.merge(s, m, t, { order: SL.DONE_ORDER }), p = planting(r.plan, A1.id), inOrder = SL.DONE_ORDER.every(([a, b]) => !p.done[a] || !p.done[b] || p.done[a] <= p.done[b]);
  let later = true; try { takeBack(r.plan, A1.id, 'field', device('later', 20)); } catch (_) { later = false; }
  return [ok(r) && inOrder && later && items(r, 'recorded-twice').length >= 2, [r.why, p && p.done, r.report]];
});
tryCase('a joined plan whose push was refused can be joined again, as this device\'s plan, with the plan it started from', () => {
  const m = record(FARM, A1.id, 'sow', DAY, mine()), t = record(FARM, A1.id, 'sow', DAY, theirs()), j = M.merge(FARM, m, t), t2 = setP(t, X1, { note: 'moved again' });
  const again = M.merge(FARM, j.plan, t2), fromCloud = M.merge(t, j.plan, t2);
  return [ok(j) && ok(again) && ok(fromCloud) && lot(again.plan, LOT).quantity === HELD - A1.need && planting(again.plan, X1).note === 'moved again', [j.why, again.why, fromCloud.why]];
});
tryCase('a joined plan in which a lot ran short can be joined again by either device', () => {
  const m = record(FARM, T1.id, 'sow', T1.planned, mine()), t = record(FARM, T2.id, 'sow', T2.planned, theirs()), j = M.merge(FARM, m, t);
  const t2 = countLot(t, SMALL, Math.max(0, lot(t, SMALL).quantity - 1), device('theirs2', 16)), m2 = setP(j.plan, X1, { note: 'm' });
  const a = M.merge(t, t2, j.plan), b = M.merge(j.plan, m2, setP(j.plan, X2, { note: 't' }));
  return [ok(j) && items(j, 'seed-short').length === 1 && ok(a) && ok(b) && lot(b.plan, SMALL).quantity === 0, [j.why, a.why, b.why]];
});
tryCase('sown here and then taken out of the plan, sown there: the planting is kept, sown once, and the report says this device\'s sowing still drew seed', () => {
  const d = mine(), m = { ...record(FARM, A1.id, 'sow', DAY, d), plantings: record(FARM, A1.id, 'sow', DAY, d).plantings }, mr = { ...m, plantings: m.plantings.filter(p => p.id !== A1.id) };
  const t = record(FARM, A1.id, 'sow', DAY, theirs()), r = M.merge(FARM, mr, t), said = items(r, 'sowing-of-removed-planting');
  return [ok(r) && planting(r.plan, A1.id).done.sow === DAY && said.length === 1 && said[0].whose === 'mine' && said[0].planting.includes(A1.id) && items(r, 'kept').length === 1, [r.why, r.report]];
});
tryCase('a sowing taken back here and the planting then taken out, the planting\'s note changed there: joined, the planting kept with the cloud\'s sowing and its seed', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6)), m = takeBack(s, A1.id, 'sow', mine()), mr = { ...m, plantings: m.plantings.filter(p => p.id !== A1.id) };
  const r = M.merge(s, mr, setP(s, A1.id, { note: 't' }));
  return [ok(r) && planting(r.plan, A1.id).note === 't' && planting(r.plan, A1.id).done.sow === DAY && lot(r.plan, LOT).quantity === HELD - A1.need && items(r, 'kept').length === 1, [r.why, r.report]];
});
tryCase('a plan whose plantings are not all records with ids, each id once, is not joined: nothing of this device is lost under one line of the report', () => {
  const m = setP(FARM, X2, { note: 'mine' }), noted = setP(FARM, X1, { note: 't' });
  const a = M.merge(FARM, m, { ...noted, plantings: [...noted.plantings, null] }), b = M.merge(FARM, m, { ...noted, plantings: [...noted.plantings, noted.plantings[0]] }), c = M.merge(FARM, m, { gardens: [], beds: [], plantings: [null] });
  return [[a, b, c].every(r => r.ok === false && /^The plan in the cloud has plantings .* each id once/.test(r.why) && !r.plan), [a.why, b.why, c.why]];
});
tryCase('waiting at the start, put on a bed on one device and taken off the list on the other: it is on its bed, and the report says so (both ways)', () => {
  const w = { ...planting(FARM, X1), id: 'waits-3' }; delete w.bedId;
  const s = { ...FARM, lrfNext: { ...(FARM.lrfNext || {}), waiting: [w] } };
  const placed = { ...s, plantings: [...s.plantings, { ...w, bedId: planting(FARM, X1).bedId }], lrfNext: { ...s.lrfNext, waiting: [] } }, dropped = { ...s, lrfNext: { ...s.lrfNext, waiting: [] } };
  const a = M.merge(s, placed, setP(dropped, X2, { note: 't' })), b = M.merge(s, setP(dropped, X2, { note: 'm' }), placed);
  const fine = (r, by) => ok(r) && r.plan.plantings.filter(p => p.id === 'waits-3').length === 1 && !r.plan.lrfNext.waiting.length && items(r, 'kept').length === 1 && items(r, 'kept')[0].id === 'waits-3' && items(r, 'kept')[0].removedBy === by;
  return [fine(a, 'theirs') && fine(b, 'mine'), [a.why, b.why, a.report, b.report]];
});
tryCase('a sowing day set by hand goes with the planting\'s day: the sowing day changed on one device and the day on the other, the cloud\'s two stand together and this device\'s is reported', () => {
  const s = setP(FARM, X1, { sowOn: '2027-03-03' }), r = M.merge(s, setP(s, X1, { sowOn: '2027-03-05' }), setP(s, X1, { date: '2027-06-06' })), p = planting(r.plan, X1);
  return [ok(r) && p.date === '2027-06-06' && p.sowOn === '2027-03-03' && items(r, 'same-box').length === 1, [p.date, p.sowOn, r.report]];
});
tryCase('a planting whose record of work cannot be read is joined by shape, and nothing stops', () => {
  const s = setP(FARM, X1, { done: 'not a record' }), r = M.merge(s, setP(s, X1, { note: 'm' }), setP(s, X1, { price: 3 })), p = planting(r.plan, X1);
  return [ok(r) && p.done === 'not a record' && p.note === 'm' && p.price === 3, [r.why, p]];
});
tryCase('a key of any name is a key like any other', () => {
  const odd = JSON.parse('{"__proto__": {"a": 1}}'), r = M.merge(FARM, { ...FARM, settings: { ...FARM.settings, ...odd, germ: 80 } }, { ...FARM, settings: { ...FARM.settings, buffer: 15 } });
  return [ok(r) && Object.prototype.hasOwnProperty.call(r.plan.settings, '__proto__') && r.plan.settings.germ === 80 && r.plan.settings.buffer === 15 && JSON.stringify(r.plan.settings).includes('"__proto__":{"a":1}'), r.why];
});
// seed on hand
tryCase('a lot counted by hand here and drawn on by a sowing there: both are applied', () => {
  const r = M.merge(FARM, countLot(FARM, LOT, HELD - 20, mine()), record(FARM, A1.id, 'sow', DAY, theirs()));
  return [ok(r) && lot(r.plan, LOT).quantity === HELD - 20 - A1.need && !r.report.items.length, [lot(r.plan, LOT).quantity, r.report]];
});
tryCase('a lot counted by hand on both devices: the cloud\'s count stands, and this device\'s is in the report', () => {
  const r = M.merge(FARM, countLot(FARM, LOT, HELD - 20, mine()), countLot(FARM, LOT, HELD - 5, theirs())), said = items(r, 'same-box');
  return [ok(r) && lot(r.plan, LOT).quantity === HELD - 5 && said.length === 1 && said[0].mine === HELD - 20 && said[0].theirs === HELD - 5 && said[0].path.join('.') === `seedInventory.lots.#${LOT}.quantity`, [lot(r.plan, LOT).quantity, r.report]];
});
tryCase('a count undone here (its line is gone from the log) is undone in the joined plan', () => {
  const s = countLot(FARM, LOT, HELD - 20, device('before', 6)), undone = { ...s, seedInventory: FARM.seedInventory };
  const r = M.merge(s, undone, record(s, A1.id, 'sow', DAY, theirs()));
  return [ok(r) && lot(r.plan, LOT).quantity === HELD - A1.need && r.plan.seedInventory.adjustments.filter(e => e.lotId === LOT && e.kind === 'count').length === 0, [lot(r.plan, LOT).quantity, r.why]];
});
tryCase('a lot added on each device, and this device\'s counted again after it was added: both are there, each with its own count and its lines in the log', () => {
  const d = mine(), made = addLot(FARM, A1.key, 120, d), m = countLot(made, made.seedInventory.lots[made.seedInventory.lots.length - 1].id, 111, d);
  const r = M.merge(FARM, m, addLot(FARM, A1.key, 222, theirs())), added = r.plan.seedInventory.lots.slice(FARM.seedInventory.lots.length);
  return [ok(r) && added.map(l => l.quantity).join() === '222,111' && r.plan.seedInventory.adjustments.length === FARM.seedInventory.adjustments.length + 3 && lot(r.plan, LOT).quantity === HELD, added.map(l => l.quantity)];
});
tryCase('seed on hand here that its own log does not account for: nothing is joined, and the answer says why', () => {
  const m = { ...setP(FARM, X1, { note: 'm' }), seedInventory: { ...FARM.seedInventory, lots: FARM.seedInventory.lots.map(l => (l.id === LOT ? { ...l, quantity: l.quantity - 3 } : l)) } };
  const r = M.merge(FARM, m, record(FARM, A1.id, 'sow', DAY, theirs()));
  return [r.ok === false && /record of changes/.test(r.why) && !r.plan, r.why];
});
tryCase('a plan with recorded work, joined with itself, is unchanged to the letter', () => {
  const d = mine(), s = record(record(FARM, A1.id, 'sow', DAY, d), T1.id, 'sow', T1.planned, d), a = clone(s), b = clone(s);
  const r = M.merge(s, a, b);
  return [ok(r) && JSON.stringify(r.plan) === JSON.stringify(s) && !r.report.items.length, r.why];
});
tryCase('a plan as a file holds it is joined as the working plan is: the same plantings, the same seed, what waits to be placed', () => {
  const file = (plan, waiting) => { const out = IO.join(plan, split.attic); out.lrfNextKeep = { v: 1, savedAt: '2027-03-01T0' + waiting.length + ':00:00.000Z', device: 'd-' + waiting.length, keep: { trayStart: 'monday', ...(waiting.length ? { waiting } : {}) } }; return out; };
  const w = { ...planting(FARM, X1), id: 'waits-2' }; delete w.bedId;
  const m = record(FARM, A1.id, 'sow', DAY, mine()), t = record(setP(FARM, X1, { note: 't' }), A2.id, 'sow', DAY, theirs());
  const core = M.merge(FARM, m, t), start = file(FARM, []), here = file(m, []), there = file(t, [w]);
  start.lrfNextKeep.device = 'd-start'; here.lrfNextKeep.device = 'd-here'; here.lrfNextKeep.savedAt = '2027-03-01T00:30:00.000Z';
  const r = M.merge(start, here, there);
  return [ok(core) && ok(r) && M.same(r.plan.plantings, core.plan.plantings) && M.same(r.plan.seedInventory, core.plan.seedInventory) && r.plan.lrfNextKeep.keep.waiting.length === 1 && r.plan.lrfNextKeep.savedAt === '2027-03-01T01:00:00.000Z'
    && r.plan.lrfNextKeep.device === 'd-1' && !r.report.items.length && !!IO.split(r.plan).core, [r.why, r.report]];
});
tryCase('and in a file too, a planting put on a bed on one side and changed as it waited on the other is on its bed once', () => {
  const w = { ...planting(FARM, X1), id: 'waits-4' }; delete w.bedId;
  const file = (plan, waiting) => ({ ...IO.join(plan, split.attic), lrfNextKeep: { v: 1, savedAt: '2027-03-01T00:00:00.000Z', device: 'd', keep: { trayStart: 'monday', waiting } } });
  const r = M.merge(file(FARM, [w]), file({ ...FARM, plantings: [...FARM.plantings, { ...w, bedId: planting(FARM, X1).bedId }] }, []), file(FARM, [{ ...w, date: '2027-07-07' }]));
  return [ok(r) && r.plan.plantings.filter(p => p.id === 'waits-4').length === 1 && !r.plan.lrfNextKeep.keep.waiting.length && items(r, 'placed-and-waiting').length === 1, [r.why, r.report]];
});
tryCase('a list inside a record that already had an id twice is one value, and does not stop the join', () => {
  const rows = (plan, list) => ({ ...plan, liveTrayPlans: plan.liveTrayPlans.map(tp => (tp.id === TRAYS.id ? { ...tp, rows: list(tp.rows) } : tp)) });
  const s = rows(FARM, l => [...l, l[0]]), r = M.merge(s, rows(s, l => l.map((x, i) => (i === 1 ? { ...x, price: 91 } : x))), rows(s, l => l.map((x, i) => (i === 2 ? { ...x, price: 92 } : x)))), got = r.plan && r.plan.liveTrayPlans.find(tp => tp.id === TRAYS.id).rows;
  return [ok(r) && got[2].price === 92 && got[1].price !== 91 && items(r, 'same-box').length === 1, [r.why, r.report.items.length]];
});
tryCase('records this device added inside a thing taken whole go with it when the cloud\'s stands, and the report says the thing was changed on both sides', () => {
  const space = FARM.nursery.spaces[0].id, lay = (plan, benchLayout) => ({ ...plan, nursery: { ...plan.nursery, spaces: plan.nursery.spaces.map(x => (x.id === space ? { ...x, benchLayout } : x)) } });
  const s = lay(FARM, { rows: [{ id: 'r1', n: 1 }] }), r = M.merge(s, lay(s, { rows: [{ id: 'r1', n: 1 }, { id: 'r2', n: 2 }] }), lay(s, { rows: [{ id: 'r1', n: 5 }] }));
  return [ok(r) && M.same(r.plan.nursery.spaces.find(x => x.id === space).benchLayout, { rows: [{ id: 'r1', n: 5 }] }) && items(r, 'same-box').length === 1, [r.why, r.report]];
});
tryCase('a joined plan that fails one of the five tests is not handed back: the answer is no, and why', () => {
  const r = M.merge(FARM, { ...FARM, settings: { ...FARM.settings, germ: NaN } }, setP(FARM, X1, { note: 't' }));
  return [r.ok === false && !('plan' in r) && /read back/.test(r.why), [r.ok, r.why]];
});
tryCase('something that is not a plan is not joined', () => {
  const a = M.merge(FARM, { ...FARM, plantings: null }, FARM), b = M.merge(null, FARM, FARM), c = M.merge(FARM, setP(FARM, X1, { note: 1 }), 'a plan');
  return [a.ok === false && b.ok === false && c.ok === false && [a, b, c].every(r => typeof r.why === 'string' && r.why.length > 10), [a.why, b.why, c.why]];
});

// ───────────────────────────── 2. the five tests ─────────────────────────────
{
  const m = record(setP(FARM, X1, { note: 'mine' }), A1.id, 'sow', DAY, mine()), t = record(FARM, A2.id, 'sow', DAY, theirs()), good = M.merge(FARM, m, t);
  const v = (plan, report = good.report) => M.verify(FARM, m, t, plan, report);
  check('the joined plan of the two passes the five tests', ok(good) && v(good.plan) === '', good.why);
  check('1. a joined plan that does not open as a plan fails', /no beds/.test(v({ ...good.plan, beds: undefined })) && /read back/.test(v({ ...good.plan, settings: { ...good.plan.settings, germ: NaN } })), v({ ...good.plan, beds: undefined }));
  check('1. so does one whose plantings are not all records with ids, each id once', /each id once/.test(v({ ...good.plan, plantings: [...good.plan.plantings, good.plan.plantings[0]] })) && /each id once/.test(v({ ...good.plan, plantings: [...good.plan.plantings, null] })), v({ ...good.plan, plantings: [...good.plan.plantings, null] }));
  const rowTwice = { ...good.plan, liveTrayPlans: good.plan.liveTrayPlans.map(tp => (tp.id === TRAYS.id ? { ...tp, rows: [...tp.rows, tp.rows[0]] } : tp)) };
  check('2. an id there twice in a list inside a record fails', /twice/.test(v(rowTwice)), v(rowTwice));
  check('3. a record one side changed that is missing fails', /not in the joined plan/.test(v({ ...good.plan, plantings: good.plan.plantings.filter(p => p.id !== X1) })));
  const undone = putPlanting(good.plan, { ...planting(good.plan, A2.id), done: undefined });
  check('4. a day of recorded work that is missing fails', /Work recorded/.test(v(JSON.parse(JSON.stringify(undone)))), v(JSON.parse(JSON.stringify(undone))));
  const mineGone = putPlanting(good.plan, { ...planting(good.plan, A1.id), done: undefined });
  check('4. and so does one this device recorded', /Work recorded/.test(v(JSON.parse(JSON.stringify(mineGone)))), v(JSON.parse(JSON.stringify(mineGone))));
  const off = { ...good.plan, seedInventory: { ...good.plan.seedInventory, lots: good.plan.seedInventory.lots.map(l => (l.id === LOT ? { ...l, quantity: l.quantity + A1.need } : l)) } };
  check('5. seed that does not add up fails: one sowing\'s seed left on the lot', /does not add up/.test(v(off)), v(off));
  const p = planting(good.plan, A1.id), twice = putPlanting(good.plan, { ...p, workflow: { ...p.workflow, seedUse: [...p.workflow.seedUse, { ...p.workflow.seedUse[0], batchId: 'another', lotId: null }] } });
  check('5. a planting that draws seed for two sowings fails', /more than one sowing/.test(v(twice)), v(twice));
  const below = { ...good.plan, seedInventory: { ...good.plan.seedInventory, lots: good.plan.seedInventory.lots.map(l => (l.id === LOT ? { ...l, quantity: -1 } : l)) } };
  check('5. a lot below zero fails', /below zero/.test(v(below)), v(below));
  const over = M.merge(FARM, record(FARM, T1.id, 'sow', T1.planned, mine()), record(FARM, T2.id, 'sow', T2.planned, theirs())), tight2 = { ...over.plan, plantings: over.plan.plantings.map(p => (p.id === T1.id ? planting(record(FARM, T1.id, 'sow', T1.planned, mine()), T1.id) : p)) };
  check('5. a lot drawn below zero that the report does not name fails', ok(over) && /does not say so/.test(M.verify(FARM, record(FARM, T1.id, 'sow', T1.planned, mine()), record(FARM, T2.id, 'sow', T2.planned, theirs()), tight2, { items: [] })), M.verify(FARM, record(FARM, T1.id, 'sow', T1.planned, mine()), record(FARM, T2.id, 'sow', T2.planned, theirs()), tight2, { items: [] }));
  const s5 = record(FARM, A1.id, 'sow', DAY, device('before', 6)), m5 = takeBack(s5, A1.id, 'sow', mine()), t5 = setP(s5, A1.id, { note: 't' }), j5 = M.merge(s5, m5, t5);
  const left = putPlanting(j5.plan, { ...planting(j5.plan, A1.id), workflow: { ...planting(j5.plan, A1.id).workflow, seedUse: planting(s5, A1.id).workflow.seedUse } });
  const logOff = { ...good.plan, seedInventory: { ...good.plan.seedInventory, adjustments: good.plan.seedInventory.adjustments.filter(e => !/^Reviewed sowing theirs/.test(e.reason || '')) } };
  check('5. a joined log that the lots do not follow fails', /does not follow the joined record/.test(v(logOff)) || /not in the joined plan/.test(v(logOff)), v(logOff));
  const logOnly = { ...good.plan, seedInventory: { ...good.plan.seedInventory, adjustments: [...good.plan.seedInventory.adjustments, { id: 'seed_adjustment_extra', lotId: LOT, kind: 'count', reason: '', before: { quantity: 0 }, after: { quantity: 5 } }] } };
  check('5. and so does a line in the joined log that no lot follows', /does not follow the joined record/.test(v(logOnly)), v(logOnly));
  check('5. seed lines left on a planting whose sowing was taken back, with the seed back on the lot, fail: the lots are worked a second way, from the lines', ok(j5) && M.verify(s5, m5, t5, j5.plan, j5.report) === '' && /does not add up/.test(M.verify(s5, m5, t5, left, j5.report)), M.verify(s5, m5, t5, left, j5.report));
}

// ───────────────────────────── 3. lists the merge does not know ─────────────────────────────
{
  const d = mine(), worked = record(record(FARM, A1.id, 'sow', DAY, d), T1.id, 'sow', T1.planned, d), file = IO.join(worked, split.attic);
  const odd = M.unkeyed(file).filter(x => !(x.pattern in M.NO_IDS) || x.why === 'repeated');
  check('on the farm, with work recorded, every list of records has ids, none twice, but those the merge has a rule for', odd.length === 0 && M.unkeyed(file).length === Object.keys(M.NO_IDS).length, M.unkeyed(file));
  const found = M.unkeyed({ ...file, extras: [{ name: 'no id' }], more: [{ id: 'a' }, { id: 'a' }] }).map(x => x.pattern + ':' + x.why).sort().join();
  check('and a list added without ids, or with one twice, would be found', found.includes('extras:no-id') && found.includes('more:repeated'), found);
}

// ───────────────────────────── 4. pairs of runs of edits ─────────────────────────────
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// the plan the pairs start from has work recorded already, so that taking back has a subject
const START = (() => { const d = device('start', 5); let plan = FARM; for (const x of [A3, ...sowable.filter(y => ![A1, A2, A3, T1, T2].includes(y)).slice(0, 5)]) plan = record(plan, x.id, 'sow', x.planned, d); return plan; })();
const recorded = START.plantings.filter(p => p.done && p.done.sow).map(p => p.id);
const POOL = [A1, A2, T1, T2, ...sowable.filter(y => ![A1, A2, A3, T1, T2].includes(y) && !recorded.includes(y.id)).slice(0, 10)];
const LOTS = [...new Set([...POOL, ...sowable.filter(x => recorded.includes(x.id))].map(x => x.lots[0].id))];
const keyOfLot = new Map(START.seedInventory.lots.map(l => [l.id, l.key])), keyOfPlanting = new Map(sowable.map(x => [x.id, x.key]));
/** One edit, chosen by chance: (plan, device) -> plan, with what it touches, so that two runs that touch nothing in common can be told. */
function pick(rand, near) {
  const of = list => { const from = near ? list.slice(0, 3) : list; return from[Math.floor(rand() * from.length)]; }, n = Math.floor(rand() * 15), shift = Math.floor(rand() * 9) - 4;
  // a sowing draws what the plan works out with the farm's germination and spare, so it has those two settings in common with a run that changes them
  if (n === 0 || n === 1) { const x = of(POOL); return { keys: ['p:' + x.id, 'k:' + x.key, 's:germ', 's:buffer'], run: (plan, d) => record(plan, x.id, 'sow', E.d2s(E.addDays(E.s2d(x.planned), Math.max(0, shift))), d) }; }
  if (n === 2) { const id = of(recorded); return { keys: ['p:' + id, 'k:' + keyOfPlanting.get(id)], run: (plan, d) => takeBack(plan, id, 'sow', d) }; }
  if (n === 3) { const id = of([...POOL.map(x => x.id), ...plain]); return { keys: ['p:' + id], run: plan => setP(plan, id, { date: E.d2s(E.addDays(E.s2d(planting(plan, id).date), shift || 3)) }) }; }
  if (n === 4) { const id = of([...POOL.map(x => x.id), ...plain]), bed = of(FARM.beds).id; return { keys: ['p:' + id], run: plan => setP(plan, id, { bedId: bed, startFt: 2 }) }; }
  if (n === 5) { const id = of([...POOL.map(x => x.id), ...plain, ...recorded]), note = 'note ' + Math.floor(rand() * 1000); return { keys: ['p:' + id], run: plan => setP(plan, id, { note }) }; }
  if (n === 6) { const id = of(plain); return { keys: ['p:' + id], run: plan => { if (!planting(plan, id)) throw new Error('gone'); return { ...plan, plantings: plan.plantings.filter(p => p.id !== id) }; } }; }
  if (n === 7) { const from = of(plain); return { keys: [], run: (plan, d) => ({ ...plan, plantings: [...plan.plantings, { ...planting(FARM, from), id: 'new-' + d.uid() }] }) }; }
  if (n === 8) { const id = of(LOTS), by = 1 + Math.floor(rand() * 5); return { keys: ['k:' + keyOfLot.get(id)], run: (plan, d) => countLot(plan, id, Math.max(0, lot(plan, id).quantity - by), d) }; }
  if (n === 9) { const x = of(POOL), q = 10 + Math.floor(rand() * 90); return { keys: ['k:' + x.key], run: (plan, d) => addLot(plan, x.key, q, d) }; }
  if (n === 10) { const bed = of(FARM.beds.filter(b => b.px)).id, dx = 1 + Math.floor(rand() * 20); return { keys: ['b:' + bed], run: plan => ({ ...plan, beds: plan.beds.map(b => (b.id === bed ? { ...b, px: { ...b.px, x: b.px.x + dx } } : b)) }) }; }
  if (n === 11) { const key = of(['germ', 'buffer', 'turnover', 'trayCost']), by = 1 + Math.floor(rand() * 3); return { keys: ['s:' + key], run: plan => ({ ...plan, settings: { ...plan.settings, [key]: plan.settings[key] + by } }) }; }
  if (n === 12) { const x = of(POOL), on = '2027-03-0' + (1 + Math.floor(rand() * 8)); return { keys: ['p:' + x.id], run: plan => putPlanting(plan, W.skip(planting(plan, x.id), 'sow', on)) }; }
  // a sowing recorded and taken back in one run; a planting, sown or not, taken out of the plan (its seed stays used)
  if (n === 13) { const x = of(POOL); return { keys: ['p:' + x.id, 'k:' + x.key, 's:germ', 's:buffer'], run: (plan, d) => takeBack(record(plan, x.id, 'sow', x.planned, d), x.id, 'sow', d) }; }
  const id = of([...recorded, ...POOL.map(x => x.id)]); return { keys: ['p:' + id], run: plan => { if (!planting(plan, id)) throw new Error('gone'); return { ...plan, plantings: plan.plantings.filter(p => p.id !== id) }; } };
}
/** Run a list of edits on a plan as one device. An edit that cannot be made there (already sown, already gone) is left out. */
function runAll(plan, edits, dev) { const made = []; for (const e of edits) { try { const next = e.run(plan, dev); if (next && !M.same(next, plan)) { plan = next; made.push(e); } } catch (_) { /* not possible on this plan */ } } return { plan, made }; }
/** A plan with its lists of records in the order of their ids: two plans that hold the same records in another order are alike. */
const sorted = v => (Array.isArray(v) ? (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && x.id != null) ? v.map(sorted).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)) : v.map(sorted)) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map(k => [k, sorted(v[k])])) : v);
const alike = (a, b) => M.same(sorted(a), sorted(b));
{
  const rand = rng(20261116), bad = { untouched: [], refused: [], opens: [], both: [], out: [], order: [], settles: [], seed: [], days: [], back: [], seen: [], round: [] };
  const JOIN = { order: SL.DONE_ORDER };
  let apart = 0, together = 0, reported = 0, opened = 0;
  const PAIRS = Math.max(20, Math.floor(+process.env.LRF_PAIRS) || 500);
  for (let i = 0; i < PAIRS; i++) {
    const near = i % 2 === 1;   // every other pair draws its subjects from a few, so that the two runs meet
    const editsA = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, near)), editsB = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, near));
    const a = runAll(START, editsA, device('mine' + i, 9)), b = runAll(START, editsB, device('theirs' + i, 14));
    if (!a.made.length || !b.made.length) continue;
    const r = M.merge(START, a.plan, b.plan, JOIN);
    // A device that had seen all the cloud holds and went on from it (a send whose answer was lost). The plan the two started from is
    // then older than both, so a box changed twice reads as changed on both sides, and that is reported. But seed and recorded work
    // have ids to go by: every lot, and every planting's recorded days and seed lines, are that device's own, and no sowing is dropped.
    if (i % 2 === 0) { const on = runAll(b.plan, editsA, device('mine' + i, 9));
      if (on.made.length) {
        const j = M.merge(START, on.plan, b.plan, JOIN), work = p => [p.done || null, ((p.workflow || {}).seedUse || []).map(u => [u.batchId, u.lotId, u.quantity]).sort()];
        if (!j.ok || j.report.items.some(x => x.kind === 'recorded-twice' || x.kind === 'seed-short') || on.plan.seedInventory.lots.some(l => lot(j.plan, l.id).quantity !== l.quantity)
          || on.plan.plantings.some(p => planting(j.plan, p.id) && !M.same(work(planting(j.plan, p.id)), work(p)))) bad.seen.push([i, j.why || j.report.items.map(x => x.kind).join()]);
      } }
    // a side that changed nothing changes nothing
    if (M.merge(START, START, b.plan).plan !== b.plan || M.merge(START, a.plan, START).plan !== a.plan) bad.untouched.push(i);
    if (!r.ok) { bad.refused.push([i, r.why]); continue; }
    if (r.report.items.length) reported++;
    // the joined plan opens, and on some of them the forecast is run
    try { if (i % 10 === 0) { const en = eng(r.plan); if (IO.split(IO.join(r.plan, split.attic)).core.plantings.length !== r.plan.plantings.length) throw new Error('lost plantings'); F.build(en); opened++; } } catch (e) { bad.opens.push([i, String(e.message)]); }
    // every lot at zero or more; no planting draws for two sowings; every day the cloud's side recorded is there
    if (r.plan.seedInventory.lots.some(l => !(l.quantity >= 0)) || r.plan.plantings.some(p => new Set(((p.workflow || {}).seedUse || []).map(u => u.batchId)).size > 1)) bad.seed.push(i);
    if (b.plan.plantings.some(p => p.done && Object.entries(p.done).some(([k, d]) => { const s = planting(START, p.id), j = planting(r.plan, p.id); return !(s && s.done && s.done[k] === d) && !(j && j.done && j.done[k] === d); }))) bad.days.push(i);
    // every sowing in the joined plan can be taken back as on one device, and its seed goes back to the lots its lines name
    for (const p of i % 2 === 1 ? r.plan.plantings.filter(q => q.done && q.done.sow && keyOfPlanting.has(q.id)).slice(0, 2) : []) {
      try {
        const back = takeBack(r.plan, p.id, 'sow', device('later' + i, 20)), drew = new Map();
        for (const u of (p.workflow.seedUse || [])) if (u.lotId) drew.set(u.lotId, (drew.get(u.lotId) || 0) + u.quantity);
        if (planting(back, p.id).done || (planting(back, p.id).workflow.seedUse || []).length || [...drew].some(([lotId, q]) => lot(back, lotId).quantity !== lot(r.plan, lotId).quantity + q)) bad.back.push([i, p.id]);
      } catch (e) { bad.back.push([i, p.id, String(e.message)]); }
    }
    // a second round: the other device takes the joined plan, each makes one more run, and they are joined again
    if (i % 5 === 0) {
      const a2 = runAll(r.plan, [pick(rand, near)], device('mine2' + i, 10)), b2 = runAll(r.plan, [pick(rand, near)], device('theirs2' + i, 15));
      if (a2.made.length && b2.made.length) { const j = M.merge(r.plan, a2.plan, b2.plan, JOIN); if (!j.ok || j.plan.seedInventory.lots.some(l => !(l.quantity >= 0)) || j.plan.plantings.some(p => new Set(((p.workflow || {}).seedUse || []).map(u => u.batchId)).size > 1)) bad.round.push([i, j.why]); }
    }
    // once both devices hold the joined plan, another look joins nothing
    if (M.merge(b.plan, b.plan, r.plan).plan !== r.plan || M.merge(r.plan, r.plan, r.plan).plan !== r.plan) bad.settles.push(i);
    const touchedA = new Set(a.made.flatMap(e => e.keys)), common = b.made.flatMap(e => e.keys).some(k => touchedA.has(k));
    if (common) { together++; continue; }
    apart++;
    // the two runs touch nothing in common: the joined plan is what one device would hold had it made both runs, and nothing is reported
    const one = runAll(a.plan, editsB, device('theirs' + i, 14));   // the same device making the same tries, so that its ids and its clock are the same
    if (one.made.length !== b.made.length || !one.made.every((e, k) => e === b.made[k]) || !alike(r.plan, one.plan) || r.report.items.length) bad.both.push(i);
    // the other way round it is the same plan
    const swapped = M.merge(START, b.plan, a.plan, JOIN);
    if (!swapped.ok || !alike(swapped.plan, r.plan)) bad.order.push(i);
    // taking this device's run out again leaves the other's alone: the plan is the cloud's
    const out = M.merge(a.plan, START, r.plan, JOIN);
    if (!out.ok || !alike(out.plan, b.plan)) bad.out.push([i, out.why]);
  }
  check(`pairs of runs (${PAIRS} unless fewer were asked for): enough of them touch nothing in common, enough touch the same thing, and enough have something to report`, apart >= PAIRS * 0.2 && together >= PAIRS * 0.2 && reported >= PAIRS * 0.04 && opened >= PAIRS * 0.06, { apart, together, reported, opened });
  check('a side that changed nothing changes nothing', bad.untouched.length === 0, bad.untouched.slice(0, 5));
  check('no pair is refused: every one is joined and passes the five tests', bad.refused.length === 0, bad.refused.slice(0, 3));
  check('one joined plan in ten is opened by the engine, goes into a file and comes back, and its forecast runs', bad.opens.length === 0, bad.opens.slice(0, 3));
  check('two runs that touch nothing in common: the joined plan is the plan one device would hold after both, with nothing to report', bad.both.length === 0, bad.both.slice(0, 5));
  check('and it is the same plan whichever of the two reached the cloud first', bad.order.length === 0, bad.order.slice(0, 5));
  check('taking one run out of the joined plan leaves the other run, whole', bad.out.length === 0, bad.out.slice(0, 3));
  check('no lot is below zero and no planting draws seed for two sowings', bad.seed.length === 0, bad.seed.slice(0, 5));
  check('every day of work the cloud\'s side recorded is in the joined plan', bad.days.length === 0, bad.days.slice(0, 5));
  check('once both devices hold the joined plan, another look joins nothing', bad.settles.length === 0, bad.settles.slice(0, 5));
  check('(every other pair) a device that had seen all the cloud holds and went on from it: every lot, every recorded day and every seed line is that device\'s own, and no sowing is dropped', bad.seen.length === 0, bad.seen.slice(0, 3));
  check('(every other pair) every sowing in a joined plan can be taken back as on one device, and its seed goes back to the lots its lines name', bad.back.length === 0, bad.back.slice(0, 3));
  check('a second round of runs on the joined plan joins too', bad.round.length === 0, bad.round.slice(0, 3));
}
finished = true;
