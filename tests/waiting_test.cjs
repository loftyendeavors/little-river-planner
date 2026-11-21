'use strict';
// Step 2b: plantings with no bed yet ("To place"). The series that made them went with 0.84; they are made here as it made them.
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
// a frost date is not the season's edge (#100): a field day set by the last spring frost alone is the frost's, and the frost is a note
const frostOf = (e, p, r) => { const w = e.warnings(p, r).find(x => x.k === 'frost'); return w ? w.t : e.fieldFrostOnly(p, r) || null; };
const season = (e, p, r) => { const early = e.fieldFrostOnly(p, r), w = e.warnings(p, r).find(x => ['field', 'closed', 'timing'].includes(x.k) && !(x.k === 'field' && x.t === early)), win = e.fieldPlantingWindow(r.b, r.field.getFullYear()); return w ? w.t : win.from && r.field < win.from ? 'before the first field date' : win.to && r.field > win.to ? 'after the last field date' : null; };
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

// ── plantings that wait: as a series asked to wait left them before 0.84 (a plan may still hold them), and as To place keeps them ──
// The series tool that made them is gone (0.84: successions are planned on their own page, and what has no bed is said, not held).
// They are made here as that tool wrote them, so that everything said of a waiting planting is still held.
let made = 0;
const waitFor = (c, from, n, every, extra = {}) => { const s = `s-${++made}`; return Array.from({ length: n }, (_, k) => ({ id: `${s}-${k + 1}`, cropId: c.id, date: iso(E.addDays(E.s2d(from), k * every)), wait: { s, k: k + 1, of: n, every, gardens: fieldGardens }, ...extra })); };
const hold = { held: waitFor(radish, base.from, 5, 10) }, holdFt = { held: waitFor(radish, base.from, 3, 10, { ft: 12 }) }, crowd = { waves: [{ held: waitFor(radish, `${year}-07-20`, 6, 0) }] };
check('the plantings made to wait are read as waiting plantings, each on its own day with no bed', S.waiting({ lrfNext: { waiting: hold.held } }).length === 5 && hold.held.every((w, k) => w.date === iso(E.addDays(E.s2d(base.from), k * 10)) && !w.bedId));

// ── rule 1: a waiting planting counts toward nothing ──
const mixed = [...hold.held, ...holdFt.held, ...crowd.waves[0].held.slice(0, 6)];
for (const c of [tomato, lettuce, crop('Basil'), crop('Dahlia'), crop('Kale')].filter(Boolean)) mixed.push(...waitFor(c, `${year}-05-10`, 3, 14));
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
check('none is counted as grown in a garden', JSON.stringify(S.gardensFor(e2, radish).map(g => g.planted)) === JSON.stringify(S.gardensFor(eng, radish).map(g => g.planted)));
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
// a frost date does not keep a bed off the list: a basil waiting on a late summer day is offered every free bed in season, marked where the frost cuts it
const lateBasil = crop('Basil') && { id: 'w-frost', cropId: crop('Basil').id, date: `${year}-08-10`, wait: {} }, frostHomes = lateBasil ? S.homes(eng, lateBasil) : [];
const frostFree = lateBasil ? eng.plan.beds.filter(b => S.suits(eng, crop('Basil'), b)).map(b => ({ b, res: S.landing(eng, lateBasil, { bedId: b.id }, { quick: true }) })).filter(x => x.res.state === 'ok' && x.res.r && !season(eng, x.res.p, x.res.r) && (x.res.r.harvestDays > 0 || x.res.r.frostCut)) : [];
check('a waiting planting the frost touches is offered every bed free for it, each marked with the engine’s frost note', frostFree.length >= 3 && frostHomes.length === frostFree.length && frostHomes.filter(h => h.frost).length >= 3
  && frostHomes.every(h => (h.frost || null) === frostOf(eng, h.p, h.r)), [frostFree.length, frostHomes.length, frostHomes.filter(h => h.frost).length]);
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

// ── keeping the list: files, the folder, a newer backup ──
const joined = IO.join(withList, { v: 1, rest: {}, varieties: {} });
check('the downloaded file has the plan’s plantings and nothing of the waiting list in them', joined.plantings.length === core.plantings.length && !joined.lrfNext && !JSON.stringify(joined.plantings).includes(mixed[0].id));
const parts = Store.toParts(withList, {}), back = Store.fromParts(parts.parts, parts.buckets);
check('the browser’s own copy keeps the list through a save and a load', JSON.stringify(S.waiting(back)) === JSON.stringify(mixed) && back.plantings.length === core.plantings.length);
const carried = IO.carry(withList, JSON.parse(JSON.stringify(core)));
check('a newer backup loaded over the plan does not lose what was waiting, and says so', JSON.stringify(carried.keep.waiting) === JSON.stringify(mixed) && carried.notes.some(n => /waiting|to place|not placed/i.test(n)), carried.notes);
check('with nothing waiting there is nothing to carry or to say', !IO.carry(core, JSON.parse(JSON.stringify(core))).keep.waiting && !IO.carry(core, JSON.parse(JSON.stringify(core))).notes.some(n => /waiting|to place|not placed/i.test(n)));

finish();
