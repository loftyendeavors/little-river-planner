'use strict';
// Two copies of one plan joined, record by record (js/merge.js), without a browser.
// Every edit below is made with the planner's own functions (the week's record and take back, the seed library's lots), on
// the made-up farm, by one of two made-up devices: "mine" (this device) and "theirs" (the one that reached the cloud first).
//   1. the rules, one case each: by shape, the exceptions, a recording as one unit, seed on hand
//   2. the five tests a joined plan must pass, each fed a plan that breaks it
//   3. the farm holds no list of records that the merge does not know how to join
//   4. some 500 pairs of made-up runs of edits, held to six properties
// usage: node merge_test.cjs <app-dir> <plan.json: a backup's> <inventory.json>
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
const M = require(path.join(APP, 'js/merge.js'));
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
  const stamp = (plan, at, name) => ({ ...plan, liveTrayPlans: plan.liveTrayPlans.map(t => (t.id === TRAYS.id ? { ...t, updatedAt: at, ...(name ? { name } : {}) } : t)) });
  const r = M.merge(FARM, stamp(FARM, '2027-03-02T10:00:00.000Z', 'Mine'), stamp(FARM, '2027-03-01T10:00:00.000Z'));
  const t = r.plan.liveTrayPlans.find(x => x.id === TRAYS.id);
  return [ok(r) && t.updatedAt === '2027-03-02T10:00:00.000Z' && t.name === 'Mine' && !r.report.items.length, [t.updatedAt, r.report]];
});
tryCase('records inside a record are joined record by record too: two rows of one tray plan', () => {
  const row = (plan, i, price) => ({ ...plan, liveTrayPlans: plan.liveTrayPlans.map(t => (t.id === TRAYS.id ? { ...t, rows: t.rows.map((x, j) => (j === i ? { ...x, price } : x)) } : t)) });
  const r = M.merge(FARM, row(FARM, 0, 91), row(FARM, 1, 92)), rows = r.plan.liveTrayPlans.find(x => x.id === TRAYS.id).rows;
  return [ok(r) && rows[0].price === 91 && rows[1].price === 92 && !r.report.items.length, rows.slice(0, 2)];
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
tryCase('two different jobs of one planting, one recorded on each device: both stand', () => {
  const s = record(FARM, A1.id, 'sow', DAY, device('before', 6)), d1 = E.d2s(E.addDays(E.s2d(DAY), 20));
  const r = M.merge(s, setP(s, A1.id, { note: 'm' }), record(s, A1.id, 'harden', d1, theirs(), { follow: false })), p = planting(r.plan, A1.id);
  return [ok(r) && p.done.harden === d1 && p.done.sow === DAY && p.note === 'm' && p.workflow.history.length === 2 && !r.report.items.length, [p.done, r.report]];
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
tryCase('a lot added on each device: both are there, each with its own count and its line in the log', () => {
  const r = M.merge(FARM, addLot(FARM, A1.key, 111, mine()), addLot(FARM, A1.key, 222, theirs())), added = r.plan.seedInventory.lots.slice(FARM.seedInventory.lots.length);
  return [ok(r) && added.map(l => l.quantity).join() === '222,111' && r.plan.seedInventory.adjustments.length === FARM.seedInventory.adjustments.length + 2 && lot(r.plan, LOT).quantity === HELD, added.map(l => l.quantity)];
});
tryCase('seed on hand here that its own log does not account for: nothing is joined, and the answer says why', () => {
  const m = { ...setP(FARM, X1, { note: 'm' }), seedInventory: { ...FARM.seedInventory, lots: FARM.seedInventory.lots.map(l => (l.id === LOT ? { ...l, quantity: l.quantity - 3 } : l)) } };
  const r = M.merge(FARM, m, record(FARM, A1.id, 'sow', DAY, theirs()));
  return [r.ok === false && /record of changes/.test(r.why) && !r.plan, r.why];
});
tryCase('a plan with recorded work, joined with itself, is unchanged to the letter', () => {
  const s = record(record(FARM, A1.id, 'sow', DAY, mine()), T1.id, 'sow', T1.planned, mine()), a = clone(s), b = clone(s);
  const r = M.merge(s, a, b);
  return [ok(r) && JSON.stringify(r.plan) === JSON.stringify(s) && !r.report.items.length, r.why];
});
tryCase('a plan as a file holds it is joined as the working plan is: the same plantings, the same seed, what waits to be placed', () => {
  const file = (plan, waiting) => { const out = IO.join(plan, split.attic); out.lrfNextKeep = { v: 1, savedAt: '2027-03-01T0' + waiting.length + ':00:00.000Z', device: 'd-' + waiting.length, keep: { trayStart: 'monday', ...(waiting.length ? { waiting } : {}) } }; return out; };
  const w = { ...planting(FARM, X1), id: 'waits-2' }; delete w.bedId;
  const m = record(FARM, A1.id, 'sow', DAY, mine()), t = record(setP(FARM, X1, { note: 't' }), A2.id, 'sow', DAY, theirs());
  const core = M.merge(FARM, m, t), r = M.merge(file(FARM, []), file(m, []), file(t, [w]));
  return [ok(core) && ok(r) && M.same(r.plan.plantings, core.plan.plantings) && M.same(r.plan.seedInventory, core.plan.seedInventory) && r.plan.lrfNextKeep.keep.waiting.length === 1 && r.plan.lrfNextKeep.savedAt === '2027-03-01T01:00:00.000Z' && !r.report.items.length && !!IO.split(r.plan).core, [r.why, r.report]];
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
  check('2. an id there twice fails', /twice/.test(v({ ...good.plan, plantings: [...good.plan.plantings, good.plan.plantings[0]] })), v({ ...good.plan, plantings: [...good.plan.plantings, good.plan.plantings[0]] }));
  check('3. a record one side changed that is missing fails', /not in the joined plan/.test(v({ ...good.plan, plantings: good.plan.plantings.filter(p => p.id !== X1) })));
  const undone = putPlanting(good.plan, { ...planting(good.plan, A2.id), done: undefined });
  check('4. a day of recorded work that is missing fails', /Work recorded/.test(v(JSON.parse(JSON.stringify(undone)))), v(JSON.parse(JSON.stringify(undone))));
  const off = { ...good.plan, seedInventory: { ...good.plan.seedInventory, lots: good.plan.seedInventory.lots.map(l => (l.id === LOT ? { ...l, quantity: l.quantity + A1.need } : l)) } };
  check('5. seed that does not add up fails: one sowing\'s seed left on the lot', /does not add up/.test(v(off)), v(off));
  const p = planting(good.plan, A1.id), twice = putPlanting(good.plan, { ...p, workflow: { ...p.workflow, seedUse: [...p.workflow.seedUse, { ...p.workflow.seedUse[0], batchId: 'another', lotId: null }] } });
  check('5. a planting that draws seed for two sowings fails', /more than one sowing/.test(v(twice)), v(twice));
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
  const of = list => { const from = near ? list.slice(0, 3) : list; return from[Math.floor(rand() * from.length)]; }, n = Math.floor(rand() * 13), shift = Math.floor(rand() * 9) - 4;
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
  const x = of(POOL), on = '2027-03-0' + (1 + Math.floor(rand() * 8)); return { keys: ['p:' + x.id], run: plan => putPlanting(plan, W.skip(planting(plan, x.id), 'sow', on)) };
}
/** Run a list of edits on a plan as one device. An edit that cannot be made there (already sown, already gone) is left out. */
function runAll(plan, edits, dev) { const made = []; for (const e of edits) { try { const next = e.run(plan, dev); if (next && !M.same(next, plan)) { plan = next; made.push(e); } } catch (_) { /* not possible on this plan */ } } return { plan, made }; }
/** A plan with its lists of records in the order of their ids: two plans that hold the same records in another order are alike. */
const sorted = v => (Array.isArray(v) ? (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && x.id != null) ? v.map(sorted).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)) : v.map(sorted)) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map(k => [k, sorted(v[k])])) : v);
const alike = (a, b) => M.same(sorted(a), sorted(b));
{
  const rand = rng(20261116), bad = { untouched: [], refused: [], opens: [], both: [], out: [], order: [], settles: [], seed: [], days: [] };
  let apart = 0, together = 0, reported = 0, opened = 0;
  const PAIRS = 500;
  for (let i = 0; i < PAIRS; i++) {
    const near = i % 2 === 1;   // every other pair draws its subjects from a few, so that the two runs meet
    const editsA = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, near)), editsB = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, near));
    const a = runAll(START, editsA, device('mine' + i, 9)), b = runAll(START, editsB, device('theirs' + i, 14));
    if (!a.made.length || !b.made.length) continue;
    const r = M.merge(START, a.plan, b.plan);
    // a side that changed nothing changes nothing
    if (M.merge(START, START, b.plan).plan !== b.plan || M.merge(START, a.plan, START).plan !== a.plan) bad.untouched.push(i);
    if (!r.ok) { bad.refused.push([i, r.why]); continue; }
    if (r.report.items.length) reported++;
    // the joined plan opens, and on some of them the forecast is run
    try { const en = eng(r.plan); if (i % 10 === 0) { if (IO.split(IO.join(r.plan, split.attic)).core.plantings.length !== r.plan.plantings.length) throw new Error('lost plantings'); F.build(en); opened++; } } catch (e) { bad.opens.push([i, String(e.message)]); }
    // every lot at zero or more; no planting draws for two sowings; every day the cloud's side recorded is there
    if (r.plan.seedInventory.lots.some(l => !(l.quantity >= 0)) || r.plan.plantings.some(p => new Set(((p.workflow || {}).seedUse || []).map(u => u.batchId)).size > 1)) bad.seed.push(i);
    if (b.plan.plantings.some(p => p.done && Object.entries(p.done).some(([k, d]) => { const s = planting(START, p.id), j = planting(r.plan, p.id); return !(s && s.done && s.done[k] === d) && !(j && j.done && j.done[k] === d); }))) bad.days.push(i);
    // once both devices hold the joined plan, another look joins nothing
    if (M.merge(b.plan, b.plan, r.plan).plan !== r.plan || M.merge(r.plan, r.plan, r.plan).plan !== r.plan) bad.settles.push(i);
    const touchedA = new Set(a.made.flatMap(e => e.keys)), common = b.made.flatMap(e => e.keys).some(k => touchedA.has(k));
    if (common) { together++; continue; }
    apart++;
    // the two runs touch nothing in common: the joined plan is what one device would hold had it made both runs, and nothing is reported
    const one = runAll(a.plan, editsB, device('theirs' + i, 14));   // the same device making the same tries, so that its ids and its clock are the same
    if (one.made.length !== b.made.length || !one.made.every((e, k) => e === b.made[k]) || !alike(r.plan, one.plan) || r.report.items.length) bad.both.push(i);
    // the other way round it is the same plan
    const back = M.merge(START, b.plan, a.plan);
    if (!back.ok || !alike(back.plan, r.plan)) bad.order.push(i);
    // taking this device's run out again leaves the other's alone: the plan is the cloud's
    const out = M.merge(a.plan, START, r.plan);
    if (!out.ok || !alike(out.plan, b.plan)) bad.out.push([i, out.why]);
  }
  check(`${PAIRS} pairs of runs: enough of them touch nothing in common, enough touch the same thing, and enough have something to report`, apart >= 100 && together >= 100 && reported >= 50 && opened >= 30, { apart, together, reported, opened });
  check('a side that changed nothing changes nothing', bad.untouched.length === 0, bad.untouched.slice(0, 5));
  check('no pair is refused: every one is joined and passes the five tests', bad.refused.length === 0, bad.refused.slice(0, 3));
  check('every joined plan opens; one in ten goes into a file and comes back, and its forecast runs', bad.opens.length === 0, bad.opens.slice(0, 3));
  check('two runs that touch nothing in common: the joined plan is the plan one device would hold after both, with nothing to report', bad.both.length === 0, bad.both.slice(0, 5));
  check('and it is the same plan whichever of the two reached the cloud first', bad.order.length === 0, bad.order.slice(0, 5));
  check('taking one run out of the joined plan leaves the other run, whole', bad.out.length === 0, bad.out.slice(0, 3));
  check('no lot is below zero and no planting draws seed for two sowings', bad.seed.length === 0, bad.seed.slice(0, 5));
  check('every day of work the cloud\'s side recorded is in the joined plan', bad.days.length === 0, bad.days.slice(0, 5));
  check('once both devices hold the joined plan, another look joins nothing', bad.settles.length === 0, bad.settles.slice(0, 5));
}
finished = true;
