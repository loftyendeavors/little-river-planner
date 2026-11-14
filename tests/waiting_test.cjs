'use strict';
// Step 2b: plantings with no bed yet (the series tool's "to place" list), and the series that makes them.
// The rules under test:
//   1. a planting with no bed counts toward NOTHING: seeds required, sowing batches, bench load, trays in use, the forecast,
//      "to settle", what stands in a bed on a date. The same plan with and without a waiting list gives the same figures.
//   2. a date is never moved to make a planting fit: what has no ground waits on the day it was asked for.
//   3. whatever is proposed for a waiting planting (a bed, a way to share one) passes the guard rails; the "where it could go" list is in season.
// usage: node waiting_test.cjs <app-dir> <plan.json (backup or shipped)>
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const E = require(path.join(appDir, 'js/engine.js')), Lib = require(path.join(appDir, 'js/library.js')), IO = require(path.join(appDir, 'js/planio.js')), Rails = require(path.join(appDir, 'js/rails.js')),
  S = require(path.join(appDir, 'js/succession.js')), F = require(path.join(appDir, 'js/forecast.js')), SL = require(path.join(appDir, 'js/seedlib.js')), Store = require(path.join(appDir, 'js/store.js'));
const results = [], fail = [];
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail).slice(0, 900) : ''}`); if (!ok) fail.push(name); };
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core, eng = E.create(core, Lib), year = +core.settings.year;
const iso = E.d2s, near = (a, b) => Math.abs(a - b) < 1e-6;
let seed = 20261112; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) / 16777216; }, pick = list => list[Math.floor(rnd() * list.length)];
const crop = name => eng.crops().find(c => c.name === name) || eng.crops().find(c => new RegExp(name, 'i').test(c.name));
const season = (e, p, r) => { const w = e.warnings(p, r).find(x => ['field', 'frost', 'closed', 'timing'].includes(x.k)), win = e.fieldPlantingWindow(r.b, r.field.getFullYear()); return w ? w.t : win.from && r.field < win.from ? 'before the first field date' : win.to && r.field > win.to ? 'after the last field date' : null; };
/**
 * Apply edits to the plan and ask the guard rails about every planting they touch. A planting that is added must be clear of everything;
 * one that was already in the plan may keep an overlap it had (this plan has some "to settle"), which the rails allow but never let grow.
 */
function after(base, ops) {
  const plan = { ...base.plan, plantings: base.plan.plantings.map(q => { const op = ops.find(x => x.before && x.before.id === q.id); return op ? op.after : q; }).filter(Boolean).concat(ops.filter(x => !x.before).map(x => x.after)) };
  const next = E.create(plan, Lib), ids = ops.filter(x => x.after).map(x => x.after.id), refused = Rails.refusal(base, next, ids);
  const clashes = ops.filter(x => !x.before).map(x => x.after.id).filter(id => { const p = next.planting(id), r = next.calc(p); return !r || next.conflicts(p, r).length || next.overflow(p, r); });
  return { ok: !refused && !clashes.length, refused: refused && refused.kind, clashes: clashes.length, next };
}

function finish() {
  console.log(results.join('\n'));
  const size = f => { try { return f(); } catch (_) { return 0; } };   // what was not reached yet
  console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, waiting: size(() => mixed.length), sharable: size(() => sharable.length), offers: size(() => offers) }));
  process.exit(fail.length ? 1 : 0);
}
// a fault that breaks something should fail the line that names it, not stop the test: whatever is thrown after that is reported and the run ends in order
process.on('uncaughtException', error => { check('the test ran to its end', false, String(error && error.stack || error).slice(0, 300)); finish(); });
const radish = crop('Radish'), lettuce = crop('Lettuce'), tomato = crop('Tomato');
const fieldGardens = S.gardensFor(eng, radish).filter(x => x.kind === 'bed' && x.garden.type === 'field').map(x => x.garden.id);
const base = { cropId: radish.id, basis: 'planting', from: `${year}-07-20`, count: 5, every: 10, unit: 'whole', amount: 1 };

// ── a series with no beds ──
const hold = S.series(eng, { ...base, place: 'hold' });
check('a series asked to wait places nothing and holds one planting for each succession', !hold.error && hold.plantings.length === 0 && hold.held.length === 5 && hold.waves.every(w => w.held.length === 1 && !w.placed.length), hold.error || hold.waves.map(w => [w.placed.length, w.held.length]));
check('each waits on the day it was asked for, with no bed', hold.held.every((w, k) => w.date === iso(E.addDays(E.s2d(base.from), k * 10)) && !w.bedId && w.cropId === radish.id));
check('each has an id of its own and says which succession it is', new Set(hold.held.map(w => w.id)).size === 5 && hold.held.every((w, k) => w.wait && w.wait.k === k + 1 && w.wait.of === 5 && w.wait.every === 10 && w.wait.s === hold.held[0].wait.s) && hold.held.every(w => !eng.planting(w.id)));
check('no garden need be named for plantings that wait', !S.series(eng, { ...base, place: 'hold', gardenIds: [] }).error && /garden/i.test(S.series(eng, { ...base, gardenIds: [] }).error) && /bed/i.test(S.series(eng, { ...base, place: 'beds', bedIds: [] }).error));
const holdTwo = S.series(eng, { ...base, place: 'hold', amount: 2, count: 3 }), holdFt = S.series(eng, { ...base, place: 'hold', unit: 'ft', amount: 12, count: 3 });
check('two beds a succession wait as two plantings; twelve feet a succession as one that asks for twelve feet', holdTwo.held.length === 6 && holdTwo.waves.every(w => w.held.length === 2) && holdFt.held.length === 3 && holdFt.held.every(w => w.ft === 12), [holdTwo.held.length, holdFt.held.map(w => w.ft)]);
check('the plan is untouched by any of it', eng.plan.plantings.length === core.plantings.length && !(core.lrfNext && core.lrfNext.waiting));
const copyOf = eng.plan.plantings.find(p => p.cropId === lettuce.id && eng.isTower(eng.bedOf(p.bedId)) && eng.calc(p));
if (copyOf) {
  const c = S.series(eng, { cropId: lettuce.id, sourceId: copyOf.id, place: 'hold', basis: 'planting', from: `${year}-08-01`, count: 2, every: 7, unit: 'whole', amount: 1 });
  check('a series copied from a planting carries its settings and none of its place or its records', !c.error && c.held.length === 2 && c.held.every(w => !w.bedId && !w.done && !w.ft && !w.startFt && !w.bedLayout && !w.sowOn && !w.workflow && (copyOf.varietyId ? w.varietyId === copyOf.varietyId : true) && JSON.stringify(w.towerCycle || null) === JSON.stringify(copyOf.towerCycle || null)), c.error || c.held[0]);
} else check('a series copied from a planting carries its settings and none of its place or its records', false, 'no tower lettuce in this plan');

const part = eng.plan.plantings.find(p => { const r = eng.calc(p); return r && eng.isSoilBed(r.b) && +p.ft > 0 && !p.bedLayout && !p.liveTray && !eng.standKey(p) && !(eng.crop(p.cropId) || {}).micro; });
if (part) {
  const c = S.series(eng, { cropId: part.cropId, sourceId: part.id, place: 'hold', basis: 'planting', from: `${year}-06-01`, count: 2, every: 14, unit: 'whole', amount: 1 });
  check('copied from a planting that takes part of a bed, what waits does not carry that length: it takes a whole bed unless feet are asked for', !c.error && c.held.length === 2 && c.held.every(w => !('ft' in w) && !('startFt' in w)), c.error || [part.ft, c.held[0]]);
} else check('copied from a planting that takes part of a bed, what waits does not carry that length: it takes a whole bed unless feet are asked for', false, 'no part-bed planting in this plan');

// ── a series sent to gardens: what has no ground waits; dates are never moved ──
const crowd = S.series(eng, { ...base, gardenIds: fieldGardens, amount: 60, count: 2, every: 14 });
const placedBy = w => w.placed.length, target = k => iso(E.addDays(E.s2d(base.from), k * 14));
check('asked for more beds than the gardens have free, the rest wait: placed and waiting add up to what was asked', !crowd.error && crowd.waves.every(w => placedBy(w) + w.held.length === 60 && w.held.length > 0 && placedBy(w) > 0), crowd.error || crowd.waves.map(w => [placedBy(w), w.held.length, w.short]));
check('what waits keeps the day it was asked for, and says what stood in its way', crowd.waves.every((w, k) => w.held.every(x => x.date === target(k) && x.wait.why && x.wait.gardens.length)) && crowd.waves.every((w, k) => w.placed.every(x => iso(x.r.field) === target(k))), crowd.waves.map(w => w.held[0] && [w.held[0].date, w.held[0].wait.why]));
const noSpill = S.series(eng, { ...base, gardenIds: fieldGardens, amount: 60, count: 2, every: 14, spill: false });
check('told not to hold the rest, it holds nothing and places the same', noSpill.held.length === 0 && noSpill.plantings.length === crowd.plantings.length && noSpill.short === 2);
const ft = S.series(eng, { ...base, gardenIds: fieldGardens.slice(0, 1), unit: 'ft', amount: 1900, count: 1 });
check('feet that find no ground wait as one planting of the feet still missing', !ft.error && ft.waves[0].held.length === 1 && near(ft.waves[0].held[0].ft + ft.waves[0].placed.reduce((n, x) => n + x.r.physicalLength, 0), 1900), ft.error || [ft.waves[0].held.length, ft.waves[0].short]);
check('what is placed still lands only on free ground, in season', after(eng, crowd.plantings.map(p => ({ before: null, after: p }))).ok && crowd.plantings.every(p => { const e2 = after(eng, [{ before: null, after: p }]).next, q = e2.planting(p.id); return !season(e2, q, e2.calc(q)); }));

// ── a series sent to named beds ──
const freeBeds = S.homes(eng, hold.held[0]).filter(h => eng.isSoilBed(h.bed)).map(h => h.bed);
const named = [freeBeds[freeBeds.length - 1], freeBeds[0], freeBeds[3]].filter(Boolean).map(b => b.id);
const inBeds = S.series(eng, { ...base, place: 'beds', bedIds: named, count: 4, every: 21 });
check('sent to named beds, it uses those beds and no others', !inBeds.error && inBeds.plantings.length > 0 && inBeds.plantings.every(p => named.includes(p.bedId)) && inBeds.held.every(w => JSON.stringify(w.wait.beds) === JSON.stringify(named)), inBeds.error || inBeds.plantings.map(p => p.bedId));
check('it takes them in the order given', inBeds.waves.filter(w => w.placed.length).every(w => { const firstFree = named.find(id => { const t = S.series(eng, { ...base, place: 'beds', bedIds: [id], count: 1, from: iso(w.target) }); return t.plantings.length; }); return !firstFree || w.k > 0 || w.placed[0].bed.id === firstFree; }));

// ── counted back from harvest with no bed ──
const hv = S.series(eng, { ...base, place: 'hold', basis: 'harvest', from: `${year}-08-20`, count: 3, gardenIds: fieldGardens });
const like = S.spaces(eng, radish, fieldGardens)[0];
check('counted back from harvest with no bed, the day is read off a space like the ones it is headed for', !hv.error && hv.held.length === 3 && hv.held.every((w, k) => { const r = eng.evaluate({ ...S.bare(w), bedId: like.id }); return r && iso(r.first) === iso(E.addDays(E.s2d(`${year}-08-20`), k * 10)); }), hv.error || hv.held.map(w => w.date));
const covered = S.series(eng, { ...base, place: 'hold', skipCovered: true, covered: () => true }), uncovered = S.series(eng, { ...base, place: 'hold', skipCovered: true, covered: () => false });
check('one left out because the crop is already being picked is not held either', covered.held.length === 0 && covered.skipped === 5 && uncovered.held.length === 5 && uncovered.skipped === 0);

// ── rule 1: a waiting planting counts toward nothing ──
const mixed = [...hold.held, ...holdFt.held, ...crowd.waves[0].held.slice(0, 6)];
for (const c of [tomato, lettuce, crop('Basil'), crop('Dahlia'), crop('Kale')].filter(Boolean)) { const s = S.series(eng, { cropId: c.id, place: 'hold', basis: 'planting', from: `${year}-05-10`, count: 3, every: 14, unit: 'whole', amount: 1 }); if (!s.error) mixed.push(...s.held); }
const withList = { ...core, lrfNext: { ...(core.lrfNext || {}), waiting: mixed } }, e2 = E.create(withList, Lib);
check('the list is read back as it was written, and nothing malformed is taken for a waiting planting', S.waiting(withList).length === mixed.length && S.waiting(core).length === 0
  && S.waiting({ lrfNext: { waiting: [null, 3, {}, { id: 'x' }, { id: 'x', cropId: radish.id }, { id: 'x', cropId: radish.id, date: 'soon' }, { id: 'x', cropId: radish.id, date: `${year}-05-01`, bedId: 'b' }, { id: 'y', cropId: radish.id, date: `${year}-05-01` }] } }).length === 1 && S.waiting({ lrfNext: { waiting: 'no' } }).length === 0);
check('at least five crops wait, some transplanted, so the comparison has something to miss', new Set(mixed.map(w => w.cropId)).size >= 5 && mixed.some(w => (eng.crop(w.cropId) || {}).method === 'TP') && mixed.length >= 20, [mixed.length, new Set(mixed.map(w => w.cropId)).size]);
const need = e => JSON.stringify(SL.required(e)), batches = e => JSON.stringify(e.sowingBatches().map(b => [b.id || b.batchId, b.seeds, b.cells, b.trays, b.memberIds]));
check('seeds required are the same with the list as without', need(e2) === need(eng));
check('sowing batches are the same', batches(e2) === batches(eng) && e2.sowingBatches().length > 0);
let benchSame = true, traysSame = true, groundSame = true;
for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) {
  if (!near(e2.benchDay(d).total, eng.benchDay(d).total)) benchSame = false;
  if (d.getDate() % 5 === 0) {
    if (JSON.stringify(e2.traysOn(d)) !== JSON.stringify(eng.traysOn(d))) traysSame = false;
    for (const b of core.beds) if (e2.cropsAt(b.id, d).length !== eng.cropsAt(b.id, d).length) groundSame = false;
  }
}
check('bench load is the same on every day of the year', benchSame);
check('trays in use are the same', traysSame);
check('what stands in every space is the same on every date tried', groundSame);
const fc = e => { const m = F.build(e, { year }); return JSON.stringify([m.counted, m.rows.map(r => [r.cropId, r.varietyId || '', Math.round(F.sum(r.days, 0, m.days - 1) * 1000)])]); };
check('the harvest forecast is the same', fc(e2) === fc(eng));
check('"to settle" is the same', Rails.cleanup(e2).count === Rails.cleanup(eng).count);
check('no waiting planting is among the plan’s plantings, or known to the engine by its id', mixed.every(w => !e2.planting(w.id) && !withList.plantings.some(p => p.id === w.id)) && withList.plantings.length === core.plantings.length);
check('none is offered as a model for a new series, nor counted as grown in a garden', JSON.stringify(S.models(e2, radish.id).map(m => m.p.id)) === JSON.stringify(S.models(eng, radish.id).map(m => m.p.id)) && JSON.stringify(S.gardensFor(e2, radish).map(g => g.planted)) === JSON.stringify(S.gardensFor(eng, radish).map(g => g.planted)));
check('openings are the same', JSON.stringify(S.openings(e2).map(o => o.id)) === JSON.stringify(S.openings(eng).map(o => o.id)));
// the comparison has teeth: the same plantings put on beds do change the figures
const landed = []; let work = eng;
for (const w of mixed.filter(w => !w.ft).slice(0, 12)) { const h = S.homes(work, w)[0]; if (!h) continue; landed.push(h.p); work = E.create({ ...core, plantings: [...core.plantings, ...landed] }, Lib); }
check('placed on beds, the same plantings do change seeds required and the forecast (so the comparison above can fail)', landed.length >= 6 && need(work) !== need(eng) && fc(work) !== fc(eng), landed.length);

// ── where a waiting planting lands ──
const w0 = hold.held[2], home = S.homes(eng, w0);
check('there are beds a waiting radish could go into, each free for all of its days and in season', home.length > 0 && home.every(h => h.p.date === w0.date && h.p.bedId === h.bed.id && !h.p.wait && !season(eng, h.p, h.r)) && after(eng, [{ before: null, after: home[0].p }]).ok, home.length);
const free = home.find(h => eng.isSoilBed(h.bed)), land = S.landing(eng, w0, { bedId: free.bed.id });
check('on a free bed it takes the whole bed, on its own date, and keeps its id', land.state === 'ok' && land.p.id === w0.id && land.p.date === w0.date && !land.p.ft && !land.p.wait && near(land.r.physicalLength, land.r.cap) && iso(land.r.field) === w0.date, [land.state, land.why]);
const wFt = { ...w0, id: 'w-ft', ft: 9 }, landFt = S.landing(eng, wFt, { bedId: free.bed.id }), landAim = S.landing(eng, wFt, { bedId: free.bed.id, along: eng.capOf(free.bed) - 2 });
check('one that asks for nine feet takes nine feet of a free bed, where it is aimed', landFt.state === 'ok' && near(landFt.r.physicalLength, 9) && landAim.state === 'ok' && near(landAim.r.physicalLength, 9) && near((landAim.p.startFt || 0) + 9, eng.capOf(free.bed)) && after(eng, [{ before: null, after: landAim.p }]).ok, [landFt.state, landFt.p && landFt.p.ft, landAim.p && landAim.p.startFt]);
const home2 = S.homes(eng, { ...w0, wait: { ...w0.wait, gardens: [home[home.length - 1].bed.gardenId] } });
check('the gardens it was headed for come first in the list of where it could go', home2.length === home.length && home2[0].bed.gardenId === home[home.length - 1].bed.gardenId && home2[0].wanted && home2.filter(h => h.wanted).every(h => h.bed.gardenId === home2[0].bed.gardenId));
// out of season: a tomato dated the first of March has no open ground to go to, though the ground itself is free
const early = { id: 'w-early', cropId: tomato.id, date: `${year}-03-01`, wait: {} }, earlyHomes = S.homes(eng, early);
const freeThen = eng.plan.beds.filter(b => eng.isSoilBed(b) && S.suits(eng, tomato, b) && S.landing(eng, early, { bedId: b.id }).state === 'ok');
const frosty = freeThen.filter(b => { const res = S.landing(eng, early, { bedId: b.id }); return season(eng, res.p, res.r); });
check('the list of where it could go leaves out ground that is free but out of season then', frosty.length >= 5 && earlyHomes.every(h => !frosty.some(b => b.id === h.bed.id)) && earlyHomes.every(h => !season(eng, h.p, h.r)), [freeThen.length, frosty.length, earlyHomes.length]);
const ab = S.about(eng, w0);
check('before it has a bed its days can still be shown, read off a space like the ones it is headed for', !!ab && iso(ab.r.field) === w0.date && ab.r.first > ab.r.field && !eng.planting(ab.p.id));
check('a record that is not a waiting planting lands nowhere', S.landing(eng, { ...w0, bedId: free.bed.id }, { bedId: free.bed.id }).state === 'blocked' && S.landing(eng, w0, { bedId: 'no-such-bed' }).state === 'blocked' && S.homes(eng, { id: 'q' }).length === 0 && S.about(eng, { id: 'q' }) === null);
const tower = eng.plan.beds.find(b => eng.isTower(b)), pool = eng.plan.beds.find(b => eng.isPool(b));
check('the guard rails’ own refusals still hold: radish does not go in a tower’s place by default nor on the tray benches', (!tower || ['ok', 'blocked'].includes(S.landing(eng, w0, { bedId: tower.id }).state)) && (!pool || S.landing(eng, w0, { bedId: pool.id }).state === 'blocked'));

// ── sharing a bed that is held ──
// a soil bed with one crop in the ground on some day, and a waiting planting dated inside that crop's days
const sharable = [];
for (const b of eng.plan.beds.filter(b => eng.isSoilBed(b) && b.active !== false)) {
  for (const p of eng.plantingsIn(b.id)) {
    const r = eng.calc(p); if (!r || eng.standKey(p)) continue;
    const mid = E.addDays(r.field, Math.max(1, Math.floor(E.dayDiff(r.first, r.field) / 2))), w = { id: 'w-share-' + sharable.length, cropId: radish.id, date: iso(mid), wait: {} };
    const res = S.landing(eng, w, { bedId: b.id });
    if (res.state === 'split') sharable.push({ w, bed: b, res, holder: p });
  }
}
check('a waiting planting dropped where one crop holds the ground is offered ways to share the bed', sharable.length >= 10 && sharable.every(x => x.res.ways.length >= 1 && x.res.holder && x.res.holder.p.id === x.holder.id), sharable.length);
check('both ways are met somewhere in this plan: by length and by rows', sharable.some(x => x.res.ways.some(y => y.id === 'length')) && sharable.some(x => x.res.ways.some(y => y.id === 'rows')), [sharable.filter(x => x.res.ways.some(y => y.id === 'length')).length, sharable.filter(x => x.res.ways.some(y => y.id === 'rows')).length]);
let tried = 0, bad = [];
for (const x of sharable.slice(0, 40)) for (const way of x.res.ways) for (const n of new Set([way.min, way.def, way.max])) {
  const made = way.make(n); tried++;
  if (!made) { if (n === way.def) bad.push(['default refused', way.id, n]); continue; }
  const v = after(eng, made.ops), hp = v.next.planting(x.holder.id), hr = v.next.calc(hp), np = v.next.planting(x.w.id), nr = v.next.calc(np);
  if (!v.ok) bad.push(['refused', way.id, n, v.refused, v.clashes]);
  else if (np.date !== x.w.date || np.wait) bad.push(['date moved', way.id, n]);
  else if (hp.date !== x.holder.date) bad.push(['holder moved', way.id]);
  else if (way.id === 'length' && !(near(nr.physicalLength, made.takes) && Math.abs(made.takes - n) <= 0.51 && hr.physicalLength < eng.calc(x.holder).physicalLength)) bad.push(['length', n, nr.physicalLength, hr.physicalLength]);
  else if (way.id === 'rows' && !(v.next.footprint(np, nr).rows.count === n && v.next.footprint(hp, hr).rows.count === made.keeps)) bad.push(['rows', n]);
  else if (made.ops.length !== 2 || made.ops[0].before !== x.holder) bad.push(['ops', way.id]);
}
check(`every way to share (${tried} tried: fewest, default and most) passes the guard rails, moves no date, and gives each crop what it says`, tried >= 30 && !bad.length, bad.slice(0, 5));
const wide = sharable.filter(x => x.res.ways.some(y => y.id === 'rows' && y.max >= 2));
check('a crop that holds three rows or more can give up any number of them short of all', wide.length >= 1 && wide.slice(0, 12).every(x => { const way = x.res.ways.find(y => y.id === 'rows'); return [1, way.max].every(n => { const made = way.make(n), v = made && after(eng, made.ops); return !!made && v.ok && v.next.footprint(v.next.planting(x.w.id), v.next.calc(v.next.planting(x.w.id))).rows.count === n && made.keeps === way.max + 1 - n; }); }), wide.length);
check('a number outside what can be given up makes nothing', sharable.every(x => x.res.ways.every(y => y.make(0) === null && y.make(y.max + 1) === null && y.make('x') === null)));
const twoHeld = eng.plan.beds.filter(b => eng.isSoilBed(b)).map(b => { const list = eng.plantingsIn(b.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r); for (const a of list) for (const c of list) { if (a === c) continue; const lo = new Date(Math.max(+eng.occupancyFrom(a.p, a.r), +eng.occupancyFrom(c.p, c.r))), hi = Math.min(+eng.occupancyThrough(a.p, a.r), +eng.occupancyThrough(c.p, c.r)); if (+lo + 20 * 864e5 < hi) return { bed: b, on: E.addDays(lo, 2) }; } return null; }).filter(Boolean);
check('where two crops hold the ground at once there is no way to share offered', twoHeld.every(x => { const res = S.landing(eng, { id: 'w2', cropId: radish.id, date: iso(x.on), wait: {} }, { bedId: x.bed.id }); return !res.ways || res.state === 'partial'; }), twoHeld.length);
check('a quick look over the farm says where sharing is possible without working the ways out', sharable.slice(0, 20).every(x => { const q = S.landing(eng, x.w, { bedId: x.bed.id }, { quick: true }); return q.state === 'split' && !q.ways && q.holder; }));

// ── random: whatever is offered can be added ──
const soilBeds = eng.plan.beds.filter(b => b.active !== false && !eng.isPool(b)), crops = S.candidates(eng, true);
let offers = 0, wrong = [];
for (let i = 0; i < 400; i++) {
  const c = pick(crops), date = iso(E.addDays(new Date(year, 2, 1), Math.floor(rnd() * 230))), w = { id: 'w-r' + i, cropId: c.id, date, wait: {} }, bed = pick(soilBeds);
  if (rnd() < 0.3) w.ft = 4 + Math.floor(rnd() * 12);
  const res = S.landing(eng, w, { bedId: bed.id, along: rnd() < 0.5 ? rnd() * eng.capOf(bed) : undefined });
  if (res.state === 'ok' || res.state === 'partial') { offers++; const v = after(eng, [{ before: null, after: res.p }]); if (!v.ok || res.p.date !== date || res.p.wait || (res.state === 'ok' && w.ft && eng.isSoilBed(bed) && !res.p.bedLayout && res.r.physicalLength > w.ft + 1e-6)) wrong.push([c.name, bed.bed, date, res.state, v.refused, v.clashes, res.r.physicalLength, w.ft]); }
  for (const way of res.ways || []) { offers++; const made = way.make(way.def); if (!made || !after(eng, made.ops).ok) wrong.push(['way', way.id, c.name, bed.bed, date]); }
}
check(`${offers} random landings and ways to share: every one can be added, on its own date`, offers >= 80 && !wrong.length, wrong.slice(0, 4));

// ── where on the farm could this crop go, and when ──
const rm = S.room(eng, radish.id), rmLate = S.room(eng, radish.id, { from: `${year}-08-01` });
check('"where could radish go" lists openings its whole cycle fits, soonest first', rm.openings.length >= 5 && rm.openings.every((x, i) => i === 0 || x.opening.from >= rm.openings[i - 1].opening.from) && rm.openings.every(x => S.tryCrop(eng, x.opening, radish).ok && x.opening.planted), rm.openings.length);
check('and, apart from them, the beds with nothing planned all year, by garden', rm.empty.every(g => g.beds.length > 0 && g.beds.every(b => b.gardenId === g.garden.id && !eng.plantingsIn(b.id).some(p => eng.calc(p)))) && !rm.openings.some(x => !x.opening.planted));
check('asked from August it lists no opening that has closed by then', rmLate.openings.length > 0 && rmLate.openings.length < rm.openings.length && rmLate.openings.every(x => x.opening.to >= E.s2d(`${year}-08-01`)));
check('a crop that is not in the library has no room listed', S.room(eng, 'no-such-crop').openings.length === 0);

// ── keeping the list: files, the folder, a newer v7 backup ──
const joined = IO.join(withList, { v: 1, rest: {}, varieties: {} });
check('the file v7 reads has the plan’s plantings and nothing of the waiting list in them', joined.plantings.length === core.plantings.length && !joined.lrfNext && !JSON.stringify(joined.plantings).includes(mixed[0].id));
const parts = Store.toParts(withList, {}), back = Store.fromParts(parts.parts, parts.buckets);
check('the browser’s own copy keeps the list through a save and a load', JSON.stringify(S.waiting(back)) === JSON.stringify(mixed) && back.plantings.length === core.plantings.length);
const carried = IO.carry(withList, JSON.parse(JSON.stringify(core)));
check('a newer v7 backup loaded over the plan does not lose what was waiting, and says so', JSON.stringify(carried.keep.waiting) === JSON.stringify(mixed) && carried.notes.some(n => /waiting|to place|not placed/i.test(n)), carried.notes);
check('with nothing waiting there is nothing to carry or to say', !IO.carry(core, JSON.parse(JSON.stringify(core))).keep.waiting && !IO.carry(core, JSON.parse(JSON.stringify(core))).notes.some(n => /waiting|to place|not placed/i.test(n)));

finish();
