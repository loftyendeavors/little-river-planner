'use strict';
/* N2, bought-in plants, with no browser: what a planting is started from (js/engine.js startedFrom), what a planting bought in needs
 * and does not (js/engine.js calcRaw, js/sowing.js), how Seeds counts it and the order sheet buys it (js/seedlib.js), and how two
 * devices' plans join it (js/merge.js, by shape).
 *   1. bought in: no sowing day, cells, trays, seed or mix, no room on a bench, no nursery work on Tasks; its plants and the plan's
 *      spare on plugs to buy; its days in the bed, its harvest and its yield as they are sown
 *   2. what says it: the planting's own word over its crop's; a planting's old record of its crop as bought in; bulbs, live trays
 *      and standing crops are not chosen
 *   3. Seeds: a variety bought in for one planting and sown for another is counted both ways, once each; stock in plants is its
 *   4. the order sheet: a shortfall rounded up to whole lots, under the grower the variety names, beside seed
 *   5. two devices: the planting's word is one value, kept beside a change made to the same planting on the other device
 * Every subject is found on the plan given: nothing here names a crop, a bed or a date of any plan.
 * usage: node bought_test.cjs <app-dir> <plan.json>
 */
const path = require('path'), fs = require('fs');
const [app, planFile] = process.argv.slice(2);
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
const tryCase = (name, run) => { try { const out = run(); check(name, out === true || (Array.isArray(out) && out[0] === true), Array.isArray(out) ? out[1] : out); } catch (e) { check(name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: f.detail })) }));
});
global.window = global;
const req = f => require(path.resolve(app, 'js', f));
const Lib = req('library.js'), E = req('engine.js'), IO = req('planio.js'), SL = req('seedlib.js'), W = req('week.js'), N = req('nursery.js'), M = req('merge.js'), F = req('forecast.js'), Rails = req('rails.js'), S = req('succession.js');
const Held = require('./bought_held.cjs');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const eng = E.create(plan, Lib), year = +plan.settings.year, spare = 1 + (+plan.settings.buffer || 0) / 100;
const D = d => (d === Infinity ? 'inf' : d && !Number.isNaN(+d) ? E.d2s(d) : String(d));
const put = (pl, q) => ({ ...pl, plantings: pl.plantings.map(x => (x.id === q.id ? q : x)) });
const said = c => c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed');
const sown = (e, p) => { const r = e.calc(p); return !!r && !!r.plannedSow && r.cells > 0 && r.trays > 0 && r.seeds > 0; };
const prop = (e, p) => e.benchItems().some(it => it.p.id === p.id && it.kind === 'prop');

// ── subjects, found by the engine's own figures ──
const live = p => { const r = eng.calc(p); return r && !p.established && !p.failed && !p.done && !p.liveTray && r.b.active !== false ? r : null; };
const own = plan.plantings.filter(p => p.startedFrom === 'plant' && live(p));
const plugs = own.find(p => { const v = eng.variety(p.varietyId); return v && v.buyLot > 0 && v.buyFrom; });
const twoWay = own.find(p => p.varietyId && plan.plantings.some(q => q !== p && q.varietyId === p.varietyId && live(q) && eng.startedFrom(q) === 'seed' && sown(eng, q)));
const byCrop = plan.plantings.find(p => !p.startedFrom && live(p) && said(eng.crop(p.cropId)) === 'plant' && eng.crop(p.cropId).method === 'TP' && eng.effective(p).gh > 0);   // raised in a nursery if it were sown
const seedTP = plan.plantings.find(p => !p.startedFrom && live(p) && said(eng.crop(p.cropId)) === 'seed' && sown(eng, p) && !eng.calc(p).tw && !p.growingDefaults);
const bulb = plan.plantings.find(p => live(p) && eng.calc(p).bulbs > 0);
const tray = plan.plantings.find(p => p.liveTray && eng.calc(p) && eng.calc(p).rack);
check('the plan has a planting bought in as plugs whose variety names its lot and grower, one whose variety is sown for another planting, a crop bought in as plants, a transplant sown from seed, a bulb crop and a live tray, for the check to work on',
  plugs && twoWay && byCrop && seedTP && bulb && tray, { plugs: !!plugs, twoWay: !!twoWay, byCrop: !!byCrop, seedTP: !!seedTP, bulb: !!bulb, tray: !!tray });
if (!(plugs && twoWay && byCrop && seedTP && bulb && tray)) { finished = true; process.exit(0); }

// ── 1. bought in ──
for (const [what, p] of [['a planting that says it is bought in', plugs], ['a planting of a crop bought in as plants', byCrop]]) {
  const r = eng.calc(p);
  check(`${what}: no sowing day, cells, trays, seed or mix`, eng.startedFrom(p) === 'plant' && r.boughtIn === true && !r.sow && !r.plannedSow && r.cells === 0 && r.trays === 0 && r.seeds === 0 && r.seedG === 0 && !r.sowing, { sow: D(r.sow), cells: r.cells, trays: r.trays, seeds: r.seeds });
  check(`${what}: the plants its bed takes, and the plan's spare on plugs, to buy`, r.buy === Math.ceil(r.plants * spare - 1e-9) && r.buy >= r.plants, [r.plants, r.buy, spare]);
  check(`${what}: no room on a bench and no nursery work on Tasks, only its planting`, !prop(eng, p) && W.steps(eng, p).every(st => !['sow', 'potup', 'harden'].includes(st.kind)) && W.steps(eng, p).some(st => st.kind === 'field'), W.steps(eng, p).map(st => st.kind));
  const s = SL.sowing(eng, p);
  check(`${what}: recorded as planted, in plants, what it is bought for`, s && s.kind === 'field' && s.unit === 'plants' && s.stockUnit === 'plants' && s.amount === r.buy, s && [s.kind, s.unit, s.amount]);
}
tryCase('bought in or sown, a planting has the same days in the bed, harvest, ground and yield; only its sowing differs', () => {
  const asSeed = { ...plugs, startedFrom: 'seed' }, e = E.create(put(plan, asSeed), Lib), a = eng.calc(plugs), b = e.calc(asSeed), ya = eng.yieldOf(plugs, a), yb = e.yieldOf(asSeed, b);
  const same = [a.field, a.first, a.last, eng.occupancyThrough(plugs, a)].map(D).join() === [b.field, b.first, b.last, e.occupancyThrough(asSeed, b)].map(D).join() && a.plants === b.plants && Math.abs(ya.units - yb.units) < 1e-9 && ya.price === yb.price;
  return [same && sown(e, asSeed) && prop(e, asSeed) && !a.plannedSow, { bought: [a.field, a.first, a.last].map(D), sown: [b.field, b.first, b.last, b.plannedSow].map(D) }];
});
tryCase('a planting bought in takes its trays and mix off the Nursery, and nothing else there moves', () => {
  const asSeed = { ...plugs, startedFrom: 'seed' }, e = E.create(put(plan, asSeed), Lib), without = E.create({ ...plan, plantings: plan.plantings.filter(p => p.id !== plugs.id) }, Lib);
  const trays = x => { const s = N.supplies(x, year, null); return s.rows ? s.rows.reduce((n, row) => n + (row.need || 0), 0) : JSON.stringify(s).length; };
  const tr = x => { const out = []; for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) { const u = x.traysOn(d); out.push([u.carriers, u.live, ...u.plug.map(t => t.id + ':' + t.n)].join(',')); } return out.join('|'); };
  return [tr(eng) === tr(without) && tr(e) !== tr(eng) && JSON.stringify(N.supplies(eng, year, null)) === JSON.stringify(N.supplies(without, year, null)), { same: tr(eng) === tr(without), sownDiffers: tr(e) !== tr(eng), trays: trays(eng) }];
});
tryCase('its sowing is gone from the forecast of nothing: the season\'s worth is what it is sown', () => {
  const asSeed = { ...plugs, startedFrom: 'seed' }, a = F.build(eng).rows.reduce((n, r) => n + r.worth, 0), b = F.build(E.create(put(plan, asSeed), Lib)).rows.reduce((n, r) => n + r.worth, 0);
  return [Math.abs(a - b) < 1e-6, [a, b]];
});

// ── 2. what says it ──
tryCase('a planting\'s own word stands over its crop\'s: a planting of a crop bought in as plants that says seed is sown', () => {
  const q = { ...byCrop, startedFrom: 'seed' }, e = E.create(put(plan, q), Lib), r = e.calc(q), s = SL.sowing(e, q);
  return [e.startedFrom(q) === 'seed' && !r.boughtIn && !!r.plannedSow && r.trays > 0 && s.unit === 'seeds' && s.kind === 'sow', { from: e.startedFrom(q), sow: D(r.plannedSow), unit: s.unit }];
});
tryCase('a transplant sown from seed that says it is bought in is bought in, and says nothing more', () => {
  const q = { ...seedTP, startedFrom: 'plant' }, e = E.create(put(plan, q), Lib), r = e.calc(q), r0 = eng.calc(seedTP);
  return [r.boughtIn === true && !r.plannedSow && r.trays === 0 && D(r.field) === D(r0.field) && D(r.first) === D(r0.first) && eng.startedFrom(seedTP) === 'seed' && !eng.calc(seedTP).boughtIn, [D(r0.plannedSow), D(r.plannedSow)]];
});
tryCase('a planting made while its crop was set to bought-in plants keeps that, through its own record of the crop; its own word stands over that too', () => {
  const marked = { ...seedTP, growingDefaults: { v: 1, cropId: seedTP.cropId, crop: { plantingMaterial: { present: true, value: 'plant' } } } };
  const e1 = E.create(put(plan, marked), Lib), back = { ...marked, startedFrom: 'seed' }, e2 = E.create(put(plan, back), Lib);
  return [e1.startedFrom(marked) === 'plant' && e1.calc(marked).boughtIn === true && e2.startedFrom(back) === 'seed' && sown(e2, back), [e1.startedFrom(marked), e2.startedFrom(back)]];
});
tryCase('bulbs are counted as before, exactly, with no spare, whatever a planting says', () => {
  const q = { ...bulb, startedFrom: 'plant' }, e = E.create(put(plan, q), Lib), r0 = eng.calc(bulb), r = e.calc(q), s = SL.sowing(e, q);
  return [eng.startedFrom(bulb) === 'bulb' && e.startedFrom(q) === 'bulb' && !r.boughtIn && r.bulbs === r0.bulbs && r.bulbs === Math.ceil(r.plants) && s.amount === r0.bulbs && s.unit === SL.sowing(eng, bulb).unit, [r0.bulbs, r.bulbs, s.amount]];
});
tryCase('a live tray is always sown, and a standing crop needs nothing, whatever a planting says', () => {
  const q = { ...tray, startedFrom: 'plant' }, e = E.create(put(plan, q), Lib), r = e.calc(q), r0 = eng.calc(tray);
  const sq = { ...seedTP, established: true, startedFrom: 'plant' }, se = E.create(put(plan, sq), Lib), rs = se.calc(sq);
  return [e.startedFrom(q) === 'seed' && !r.boughtIn && r.seedG === r0.seedG && r.seeds === r0.seeds && !!rs && !rs.boughtIn && !(rs.buy > 0) && rs.seeds === 0 && rs.trays === 0, [r0.seeds, r.seeds, rs && rs.buy]];
});
tryCase('a sowing recorded before a crop was bought in stays on record: the planting reads as sown, its sowing on Tasks, and it can be taken back', () => {
  const ctx = { now: `${year}-12-31T12:00:00.000Z`, uid: (() => { let n = 0; return () => 'r-' + (++n); })(), year, name: '', today: `${year}-12-31` };
  const asSeed = { ...byCrop, startedFrom: 'seed' }, e0 = E.create(put(plan, asSeed), Lib), s0 = SL.sowing(e0, asSeed);
  const rec = SL.recordSowing(e0, plan.seedInventory || SL.emptyInventory(), asSeed, { date: E.d2s(s0.planned) }, ctx), q = { ...rec.planting }; delete q.startedFrom;
  const e = E.create({ ...put(plan, q), seedInventory: rec.inventory || plan.seedInventory }, Lib), r = e.calc(q), st = W.steps(e, q);
  const back = SL.takeBackSowing(e, rec.inventory || plan.seedInventory, q, ctx);
  return [e.startedFrom(q) === 'seed' && !r.boughtIn && !!r.plannedSow && st.some(x => x.kind === 'sow' && x.done) && prop(e, q) && !!back && !(back.planting.done && back.planting.done.sow), { from: e.startedFrom(q), steps: st.map(x => x.kind + (x.done ? '✓' : '')) }];
});
tryCase('two devices: one says bought in, the other records the sowing: joined, the recorded sowing stands', () => {
  const ctx = { now: `${year}-12-31T12:00:00.000Z`, uid: (() => { let n = 0; return () => 'm-' + (++n); })(), year, name: '', today: `${year}-12-31` }, s0 = SL.sowing(eng, seedTP);
  const rec = SL.recordSowing(eng, plan.seedInventory || SL.emptyInventory(), seedTP, { date: E.d2s(s0.planned) }, ctx);
  const mine = put(plan, { ...seedTP, startedFrom: 'plant' }), theirs = { ...put(plan, rec.planting), seedInventory: rec.inventory || plan.seedInventory }, r = M.merge(plan, mine, theirs), p = r.plan.plantings.find(x => x.id === seedTP.id), e = E.create(r.plan, Lib);
  return [p.startedFrom === 'plant' && !!(p.done && p.done.sow) && e.startedFrom(p) === 'seed' && !e.calc(p).boughtIn && !!e.calc(p).plannedSow, { from: p.startedFrom, said: e.startedFrom(p) }];
});
tryCase('a copy of a planting bought in is a later succession: it follows its crop; a move keeps the planting\'s word', () => {
  const r0 = eng.calc(plugs), at = { bedId: plugs.bedId, date: E.addDays(r0.field, 120) }, copy = Rails.propose(eng, { plantingId: plugs.id, copy: true }, at), move = Rails.propose(eng, { plantingId: plugs.id }, at);
  return [!!copy.p && copy.p.startedFrom === undefined && !!move.p && move.p.startedFrom === 'plant', { copy: copy.p && copy.p.startedFrom, move: move.p && move.p.startedFrom }];
});
check('a series modelled on a planting bought in drops its word, as it drops what was recorded', S.RECORD_FIELDS ? S.RECORD_FIELDS.includes('startedFrom') : /'startedFrom'\]/.test(fs.readFileSync(path.resolve(app, 'js', 'succession.js'), 'utf8')));
tryCase('marking one planting bought in changes no other planting\'s days, and another\'s cells, seed or trays only where it shared a sowing batch with it', () => {
  const e = E.create(put(plan, { ...seedTP, startedFrom: 'plant' }), Lib), batch = (eng.calc(seedTP).sowing || {}).batchId, group = ((eng.calc(seedTP).sowing || {}).trayGroup || {}).id;
  const off = plan.plantings.filter(p => p.id !== seedTP.id).filter(p => { const a = eng.calc(p), b = e.calc(e.planting(p.id)); if (!a !== !b) return true; if (!a) return false;
    if ([a.sow, a.field, a.first, a.last].map(D).join() !== [b.sow, b.field, b.first, b.last].map(D).join()) return true;
    const same = a.cells === b.cells && a.seeds === b.seeds && Math.abs(a.trays - b.trays) < 1e-9, mate = (a.sowing && (a.sowing.batchId === batch || (a.sowing.trayGroup && a.sowing.trayGroup.id === group)));
    return !same && !mate; });
  return [off.length === 0, off.slice(0, 5).map(p => p.id)];
});
check('a value other than seed or bought in is not read', (() => { const q = { ...seedTP, startedFrom: 'bulb' }; return E.create(put(plan, q), Lib).startedFrom(q) === 'seed'; })());

// ── 3. Seeds ──
const need = SL.required(eng, { today: `${year - 1}-11-19` });
tryCase('a variety bought in for one planting and sown for another is counted both ways, once each: its plants and its seed', () => {
  const v = eng.variety(twoWay.varietyId), rows = need.rows.filter(r => r.variety && r.variety.id === v.id), plants = rows.find(r => r.unit === 'plants'), seeds = rows.find(r => r.unit === 'seeds');
  const mine = plan.plantings.filter(p => p.varietyId === v.id && live(p)), bought = mine.filter(p => eng.startedFrom(p) === 'plant'), sowing = mine.filter(p => eng.startedFrom(p) === 'seed');
  const buy = bought.reduce((n, p) => n + eng.calc(p).buy, 0), seed = sowing.reduce((n, p) => n + SL.sowing(eng, p).amount, 0);
  return [rows.length === 2 && plants && seeds && plants.plantings === bought.length && seeds.plantings === sowing.length && plants.toSow === buy && Math.abs(seeds.toSow - seed) < 1e-9, rows.map(r => [r.unit, r.plantings, r.toSow])];
});
tryCase('what a plan counts in plants is the plants bought in with their spare, and every planting is counted in one row', () => {
  const rows = need.rows.filter(r => r.unit === 'plants'), counted = need.rows.reduce((n, r) => n + r.plantings, 0);
  const bought = plan.plantings.filter(p => { const r = eng.calc(p); return r && r.boughtIn && r.b.active !== false && SL.onTasks(eng, p, year, r); });
  return [rows.reduce((n, r) => n + r.planned, 0) === bought.reduce((n, p) => n + eng.calc(p).buy, 0) && rows.reduce((n, r) => n + r.plantings, 0) === bought.length && counted === plan.plantings.filter(p => { const r = eng.calc(p); return r && r.b.active !== false && SL.onTasks(eng, p, year, r); }).length, [rows.length, bought.length]];
});
tryCase('plants on hand and on order count for the plants row; seed of the same variety for its seed row', () => {
  const v = eng.variety(twoWay.varietyId), ctx = { now: `${year - 1}-11-19T12:00:00.000Z`, uid: (() => { let n = 0; return () => 'b-' + (++n); })(), year, name: v.name };
  let inv = SL.addLot(plan.seedInventory || SL.emptyInventory(), { key: 'v:' + v.id, unit: 'plants', quantity: 30, status: 'ordered' }, ctx);
  inv = SL.addLot(inv, { key: 'v:' + v.id, unit: 'seeds', quantity: 100, status: 'usable' }, ctx);
  const st = SL.stock(inv), before = SL.stock(plan.seedInventory || SL.emptyInventory()), g = (s, u) => s['v:' + v.id + '|' + u] || { onHand: 0, onOrder: 0 };
  const received = SL.stock(SL.receiveLot(inv, inv.lots.find(l => l.unit === 'plants' && l.status === 'ordered' && l.key === 'v:' + v.id).id, ctx));
  const units = new Map([['v:' + v.id, ['seeds', 'plants']]]), odd = SL.unlisted(inv, plan, units).filter(u => u.variety && u.variety.id === v.id);
  return [g(st, 'plants').onOrder - g(before, 'plants').onOrder === 30 && g(st, 'seeds').onHand - g(before, 'seeds').onHand === 100 && g(received, 'plants').onHand - g(before, 'plants').onHand === 30 && odd.length === 0, [g(st, 'plants'), g(received, 'plants'), odd.length]];
});

// ── 4. the order sheet ──
tryCase('a shortfall of plants is rounded up to whole lots of what the variety is sold in', () => {
  const v = eng.variety(plugs.varietyId), lot = v.buyLot, out = [1, lot - 1, lot, lot + 1, 3 * lot + 2].map(n => SL.toCover(n, 'plants', v));
  return [out.every((c, i) => c && c.how === 'lots' && c.total % lot === 0 && c.total >= [1, lot - 1, lot, lot + 1, 3 * lot + 2][i] && c.total - lot < [1, lot - 1, lot, lot + 1, 3 * lot + 2][i] && c.text === `${c.total / lot} × ${lot} plants`) && SL.toCover(10, 'bulbs', { buyLot: 25 }).text === '1 × 25 bulbs', out.map(c => c && c.text)];
});
check('with no lot on file nothing is rounded: the sheet asks for the shortfall itself', SL.toCover(91, 'plants', { name: 'x' }) === null && SL.toCover(91, 'plants', { buyLot: 0 }) === null && SL.toCover(91, 'plants', { buyLot: 2.5 }) === null);
tryCase('the order sheet lists plants beside seed: under the grower the variety names, and a crop\'s own plants under its supplier', () => {
  const rows = need.rows.map(r => ({ ...r, short: r.toSow })), sheet = SL.orderSheet(rows, (a, u, v) => SL.toCover(a, u, v)), lines = sheet.groups.flatMap(g => g.lines.map(l => ({ g, l })));
  const pv = eng.variety(plugs.varietyId), mine = lines.find(x => x.l.variety.id === pv.id && x.l.unit === 'plants'), seedOf = lines.find(x => x.l.unit === 'seeds');
  const tw = eng.variety(twoWay.varietyId), twPlants = lines.find(x => x.l.variety.id === tw.id && x.l.unit === 'plants'), twSeeds = lines.find(x => x.l.variety.id === tw.id && x.l.unit === 'seeds');
  const cv = byCrop.varietyId && eng.variety(byCrop.varietyId), crop = cv && lines.find(x => x.l.variety.id === cv.id && x.l.unit === 'plants');
  return [!!mine && mine.g.name === pv.buyFrom && mine.l.sku === '' && (!pv.sku || !seedOf || lines.some(x => x.l.unit === 'seeds' && x.l.sku)) && mine.l.sized && mine.l.buy % pv.buyLot === 0 && mine.l.buy >= mine.l.amount && /plants$/.test(mine.l.text) && !!seedOf
    && (!twPlants || tw.buyFrom || twPlants.g.key === '') && (!twSeeds || twSeeds.g.name === SL.supplierOf(tw) || !SL.supplierOf(tw))
    && (!crop || crop.g.name === (cv.buyFrom || SL.supplierOf(cv) || 'No supplier named')), { mine: mine && [mine.g.name, mine.l.buy, mine.l.text], tw: twPlants && twPlants.g.name, crop: crop && crop.g.name }];
});
tryCase('a variety that names a grower for its plants still has its seed listed under its seed house', () => {
  const tw = eng.variety(twoWay.varietyId), pl = { ...plan, varieties: plan.varieties.map(x => (x.id === tw.id ? { ...x, buyFrom: 'A plug grower' } : x)) }, e = E.create(pl, Lib);
  const rows = SL.required(e, { today: `${year - 1}-11-19` }).rows.map(r => ({ ...r, short: r.toSow })), sheet = SL.orderSheet(rows, (a, u, v) => SL.toCover(a, u, v));
  const of = unit => sheet.groups.find(g => g.lines.some(l => l.variety.id === tw.id && l.unit === unit));
  return [of('plants') && of('plants').name === 'A plug grower' && of('seeds') && of('seeds').name !== 'A plug grower' && (of('seeds').key === '' || of('seeds').name === SL.supplierOf(tw) || SL.supplierKey(of('seeds').name) === SL.supplierKey(SL.supplierOf(tw))), [of('plants') && of('plants').name, of('seeds') && of('seeds').name]];
});
check('the plan that ships with the page keeps who a variety\'s plants are bought from and the lot they are sold in', (() => { const v = eng.variety(plugs.varietyId), back = IO.unpack(IO.pack(plan)).varieties.find(x => x.id === v.id); return !!back && back.buyLot === v.buyLot && back.buyFrom === v.buyFrom; })());
tryCase('the order sheet as text and as a spreadsheet says the lots', () => {
  const rows = need.rows.map(r => ({ ...r, short: r.toSow })), sheet = SL.orderSheet(rows, (a, u, v) => SL.toCover(a, u, v)), pv = eng.variety(plugs.varietyId), text = SL.orderText(sheet, { farm: 'Farm', year }), csv = SL.orderCsv(sheet);
  return [new RegExp(`${pv.buyFrom}`).test(text) && / × \d+ plants/.test(text) && /plants,.*× \d+ plants/.test(csv), text.split('\n').filter(l => / plants/.test(l)).slice(0, 3)];
});

// ── 5. two devices ──
tryCase('two devices: one says a planting is bought in, the other moves it a day; both are kept, and it is bought in on its new day', () => {
  const mine = put(plan, { ...seedTP, startedFrom: 'plant' }), theirs = put(plan, { ...seedTP, date: E.d2s(E.addDays(E.s2d(seedTP.date), 1)) }), r = M.merge(plan, mine, theirs), p = r.plan.plantings.find(x => x.id === seedTP.id);
  const e = E.create(r.plan, Lib);
  return [p.startedFrom === 'plant' && p.date === theirs.plantings.find(x => x.id === seedTP.id).date && e.calc(p).boughtIn === true, { from: p.startedFrom, date: p.date }];
});
tryCase('two devices: one says seed, the other bought in, for the same planting: one of the two stands, whole', () => {
  const a = put(plan, { ...byCrop, startedFrom: 'seed' }), b = put(plan, { ...byCrop, startedFrom: 'plant' }), r = M.merge(plan, a, b), p = r.plan.plantings.find(x => x.id === byCrop.id);
  return [['seed', 'plant'].includes(p.startedFrom), p.startedFrom];
});
tryCase('two devices: a variety\'s lot on one and its grower on the other are both kept', () => {
  const v = eng.variety(seedTP.varietyId) || plan.varieties.find(x => !x.deleted), at = l => ({ ...plan, varieties: plan.varieties.map(x => (x.id === v.id ? { ...x, ...l } : x)) });
  const r = M.merge(plan, at({ buyLot: 72 }), at({ buyFrom: 'A grower' })), got = r.plan.varieties.find(x => x.id === v.id);
  return [got.buyLot === 72 && got.buyFrom === 'A grower', [got.buyLot, got.buyFrom]];
});

// ── the comparisons with the build before leave out what N2 changes, and only that ──
tryCase('the plantings left out of the comparisons with the build before are exactly those bought in', () => {
  const ids = new Set(Held.bought(eng, plan)), want = plan.plantings.filter(p => { const r = eng.calc(p); return r && r.boughtIn; }).map(p => p.id);
  const held = Held.held(E, Lib, plan, { startedFrom: undefined }), kept = Held.held(E, Lib, plan, eng);
  return [ids.size === want.length && want.every(id => ids.has(id)) && held.plantings.length === plan.plantings.length - ids.size && kept === plan, [ids.size, want.length]];
});
finished = true;
