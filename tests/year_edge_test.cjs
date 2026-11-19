'use strict';
/* The year's edge, with no browser: work, seed and stock across the turn of the year (js/seedlib.js seasonOf, onTasks, required;
 * js/week.js lines; js/forecast.js build).
 *   1. live trays across the New Year: a batch ready in the plan's first weeks and sown in December of the year before is the
 *      plan's season, counted once in Seeds and on Tasks; recorded with less seed than planned it counts the seed used
 *   2. stock carried in: a storage crop picked in December of the year before and still to sell in January is in January's
 *      forecast, apart, counted once in the week, month and season figures and the worth; and once across the two years
 *   3. a month inside the year (March to April): the same holds, on this build and on the build before: the fault was the year only
 *   4. a planting of the fall before for the plan's year (garlic): counted for the plan; once its day is past with nothing
 *      recorded, not counted as still to sow
 *   5. the plan's own end: a sowing late in the year for a January harvest is the next season's
 *   6. on the plan as given, nothing moves: Seeds, Tasks' other jobs and the forecast are the build before's
 * The cases are added to a copy of the plan here, never to the farm. Every subject is found on the plan given by the engine's own
 * figures: nothing here names a crop, a bed or a date of any plan.
 * usage: node year_edge_test.cjs <app-dir> <plan.json> <dir holding the previous build's js>
 */
const path = require('path'), fs = require('fs');
const [app, planFile, oldDir] = process.argv.slice(2);
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: f.detail })) }));
});
global.window = global;
const req = f => require(path.resolve(app, 'js', f)), old = f => require(path.resolve(oldDir, f));
const Lib = req('library.js'), E = req('engine.js'), IO = req('planio.js'), SL = req('seedlib.js'), F = req('forecast.js'), T = req('trays.js'), W = req('week.js');
const E0 = old('engine.js'), SL0 = old('seedlib.js'), F0 = old('forecast.js'), W0 = old('week.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const given = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const year = +given.settings.year, Y = String(year), Y0 = String(year - 1);
const copy = x => JSON.parse(JSON.stringify(x)), near = (a, b, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
const add = (iso, n) => E.d2s(E.addDays(E.s2d(iso), n)), iso = d => (d && E.validDate(d) ? E.d2s(d) : null);
const withYear = (pl, y) => ({ ...pl, settings: { ...pl.settings, year: y } });
const need = (lib, e, key, today) => { const row = lib.required(e, { today }).rows.find(r => r.key === key); return row ? { toSow: row.toSow, total: row.total, waiting: row.waiting, plantings: row.plantings } : { toSow: 0, total: 0, waiting: 0, plantings: 0 }; };
const keyOf = (e, p) => { const s = SL.sowing(e, p); return s ? s.key + '|' + s.unit : null; };
const monthOf = (m, cropId, k, part) => { const a = m.index(new Date(m.year, k, 1)), z = m.index(new Date(m.year, k + 1, 0)); return m.rows.filter(r => r.cropId === cropId).reduce((n, r) => n + F.sum(part === 'carried' ? r.carried : part === 'own' ? r.days.map((v, i) => v - r.carried[i]) : r.days, a, z), 0); };
const worthOf = m => m.rows.reduce((n, r) => n + r.worth, 0);

// ── the subjects, found on the plan by the engine's own figures ──
const eng = E.create(given, Lib);
const demand = (given.liveTrayPlans || []).find(d => d.rows && d.rows.some(r => r.cropId));
const microId = demand && demand.rows.find(r => r.cropId).cropId;
const crops = [...new Set(given.plantings.map(p => p.cropId))].map(id => eng.crop(id)).filter(Boolean);
const keeper = crops.find(c => !c.micro && !c.frostTender && !eng.isPerennial(c) && c.method === 'TP' && +c.gh >= 1 && c.material !== 'bulb' && +c.dtm >= 45 && +c.dtm <= 120);
const late = crops.find(c => !c.micro && !c.frostTender && !eng.isPerennial(c) && c.method === 'DS' && c.material !== 'bulb' && +c.dtm >= 32 && +c.dtm <= 90 && c.id !== (keeper && keeper.id));
const fall = Lib.crops.find(c => c.method === 'DS' && !c.frostTender && !c.micro && +c.dtm >= 180 && c.material !== 'bulb');
// covered ground (no frost there) with nothing in it before a day, and ground with nothing in it at all
const firstIn = b => given.plantings.filter(p => p.bedId === b.id).map(p => p.date).sort()[0] || '9999-12-31';
const lastIn = b => given.plantings.filter(p => p.bedId === b.id).map(p => { const r = eng.calc(p); return r ? iso(eng.occupancyThrough(p, r)) || '9999-12-31' : '0000'; }).sort().pop() || '0000-01-01';
const soil = b => { const g = eng.gardenOf(b); return !!g && g.active !== false && b.active !== false && !eng.isRack(b) && !eng.isTower(b) && !eng.isCt(b) && !b.liveTrayPool; };
const covered = given.beds.filter(b => soil(b) && eng.gardenOf(b).frost === false).sort((a, b) => firstIn(b).localeCompare(firstIn(a)));
const empties = given.beds.filter(b => soil(b) && firstIn(b) === '9999-12-31'), empty = empties[0];
const lateBed = given.beds.filter(b => soil(b) && eng.gardenOf(b).frost === false).find(b => lastIn(b) < `${Y}-11-01`);
check('the plan has a live-tray demand with a crop, a hardy transplanted crop, a hardy crop sown in place, covered ground free in the early months, empty ground, and a crop of the library planted in the fall, for the check to work on',
  demand && microId && keeper && late && covered.length >= 2 && firstIn(covered[1]) >= `${Y}-05-01` && empties.length >= 2 && lateBed && fall, { demand: !!demand, keeper: keeper && keeper.id, late: late && late.id, covered: covered.length, empty: !!empty, lateBed: !!lateBed, fall: fall && fall.id });
if (!(demand && microId && keeper && late && covered.length >= 2 && empties.length >= 2 && lateBed && fall)) { finished = true; process.exit(0); }

// ── the copy: the cases added ──
let n = 0; const uid = () => 'ye-' + (++n);
const base = copy(given);
const micro = base.crops.find(c => c.id === microId);
micro.seedG = 12; micro.liveSow = { how: 'open' };                              // a weight of seed a tray, so that its seed is counted
base.assumptions = base.assumptions || {};
base.assumptions.sell = { ...(base.assumptions.sell || {}), [keeper.id]: { ...((base.assumptions.sell || {})[keeper.id] || {}), keep: 3, pattern: 'once', days: 1 } };   // picked once, kept 3 weeks
const ctxT = { uid, now: `${Y0}-11-18T12:00:00.000Z`, crop: id => base.crops.find(c => c.id === id) };
const ready = T.mondayOnOrAfter(`${Y}-01-08`), april = T.mondayOnOrAfter(`${Y}-04-08`);
const tray = (from, days, trays, id) => ({ v: 1, year, name: 'Year edge ' + id, customerId: '', from, through: from, summer: `${Y}-07-01`, fall: `${Y}-09-16`, rows: [{ id, name: 'Edge ' + id, cropId: microId, days, price: 30, spring: trays, summer: 0, fall: 0 }] });
let plan = T.apply(base, tray(ready, 21, 3, 'winter'), ctxT).plan;
plan = T.apply(plan, tray(april, 14, 2, 'spring'), { ...ctxT, crop: id => plan.crops.find(c => c.id === id) }).plan;
const at = (first, c) => add(first, -(+c.dtm));                                // a planting's own day, for a first harvest on a day
const dec = { id: 'ye-dec', bedId: covered[0].id, cropId: keeper.id, date: at(`${Y0}-12-21`, keeper), ft: 10 };
const mar = { id: 'ye-mar', bedId: covered[1].id, cropId: keeper.id, date: at(`${Y}-03-25`, keeper), ft: 10 };
const garlic = { id: 'ye-fall', bedId: empty.id, cropId: fall.id, date: `${Y0}-10-15`, ft: 20 };
const end = { id: 'ye-end', bedId: lateBed.id, cropId: late.id, date: `${Y}-12-10`, ft: 10 };
// a transplant planted out late in the year before and picked at the start of the plan's year: its sowing and its planting out are
// both in the year before, and its stock is all sold in the year (so nothing of it is carried in)
const winter = { id: 'ye-winter', bedId: empties[1].id, cropId: keeper.id, date: at(`${Y}-02-01`, keeper), ft: 10 };
// planted out in the plan's first days, sown in the nursery in the year before: listed and counted by 0.69 already
const jan = { id: 'ye-jan', bedId: covered[0].id, cropId: keeper.id, date: `${Y}-01-05`, ft: 10 };
plan.plantings.push(dec, mar, garlic, end, winter, jan);
const eng0 = E.create(base, Lib), eng1 = E.create(plan, Lib), old0 = E0.create(base, Lib), old1 = E0.create(plan, Lib);
const batch = plan.plantings.find(p => p.liveTray && p.liveTray.ready === ready), spring = plan.plantings.find(p => p.liveTray && p.liveTray.ready === april);
const rb = eng1.calc(batch), rs = eng1.calc(spring);
check('the case: a tray batch ready in the plan\'s first weeks is sown in December of the year before, and one ready in April is sown in March',
  rb && batch.date.slice(0, 4) === Y0 && iso(rb.first) === ready && rs && spring.date.slice(5, 7) === '03' && iso(rs.first) === april, [batch && batch.date, iso(rb && rb.first), spring && spring.date]);

// ── 1. live trays across the New Year ──
const before = `${Y0}-11-18`, after = `${Y}-01-05`;
{
  const key = keyOf(eng1, batch), s = SL.sowing(eng1, batch);
  check('the batch is the plan\'s season: the year it is ready in', SL.seasonOf(eng1, batch) === year && SL.seasonOf(eng1, spring) === year);
  const a = need(SL, eng0, key, before), b = need(SL, eng1, key, before), o = need(SL0, old1, key, before), oa = need(SL0, old0, key, before);
  const springAmount = SL.sowing(eng1, spring).amount;
  check('Seeds counts its seed for the plan, once: still to sow before its day, with the April batch beside it', s && s.amount > 0 && near(b.toSow - a.toSow, s.amount + springAmount) && b.waiting - a.waiting === 2, [a, b, s && s.amount, springAmount]);
  check('the build before left it out of Seeds: it counted the April batch only', near(o.toSow - oa.toSow, springAmount), [oa, o]);
  const back = need(SL, E.create(withYear(plan, year - 1), Lib), key, before), backBase = need(SL, E.create(withYear(base, year - 1), Lib), key, before);
  check('the year before counts none of it: across the two seasons its seed is counted once', near(back.toSow, backBase.toSow) && near(back.total, backBase.total), [back, backBase]);
  check('it is on Tasks for the plan\'s year, on the day it is sown (and for the year before\'s plan, the year that work is done in)', SL.onTasks(eng1, batch, year) && iso(s.planned) === batch.date && SL.onTasks(eng1, batch, year - 1) && SL.onTasks(eng1, spring, year));
  // recorded as sown, with less seed than planned: the seed used is what counts for the plan, and nothing of it is still to sow
  const used = Math.round(s.amount * 5 / 6 * 1e6) / 1e6, inv = plan.seedInventory || SL.emptyInventory();
  const rec = SL.recordSowing(eng1, inv, batch, { date: batch.date, quantity: used }, { now: `${Y0}-12-21T15:00:00.000Z`, uid, year, name: '', today: batch.date });
  const sownPlan = { ...plan, plantings: plan.plantings.map(p => (p.id === batch.id ? rec.planting : p)) }, c = need(SL, E.create(sownPlan, Lib), key, before);
  check('recorded as sown with less seed than planned: the plan counts the seed used, and none of it is still to sow', near(c.total - a.total, used + springAmount) && near(c.toSow - a.toSow, springAmount) && near(rec.quantity, used), [a, c, used]);
  // its day past and nothing recorded: counted for the plan, not as still to sow
  const d = need(SL, eng1, key, after), out = SL.required(eng1, { today: after }).outside;
  check('its day past with nothing recorded: counted for the plan, not as still to sow, and said as earlier', near(d.toSow - need(SL, eng0, key, after).toSow, springAmount) && near(d.total - need(SL, eng0, key, after).total, s.amount + springAmount) && out.earlier >= 1, [d, out]);
}

// ── 2. stock carried in ──
{
  const rd = eng1.calc(dec), yd = eng1.yieldOf(dec, rd), price = yd.price, m0 = F.build(eng0), m1 = F.build(eng1), o1 = F0.build(old1);
  check('the case: the storage crop is picked once in December of the year before, and kept three weeks', iso(rd.first) === `${Y0}-12-21` && iso(rd.last) === `${Y0}-12-21` && yd.units > 0 && yd.keep === 3 && yd.pattern === 'once', [iso(rd.first), iso(rd.last), yd]);
  const keepDays = 21, inJan = yd.units * (keepDays - 11) / keepDays;         // to sell Dec 21 to Jan 10: ten of its 21 days are in January
  check('January\'s forecast has the stock carried in, on its own: picked before Jan 1 and still to sell', near(monthOf(m1, keeper.id, 0, 'carried'), inJan, 1e-9) && near(monthOf(m1, keeper.id, 0) - monthOf(m0, keeper.id, 0), inJan, 1e-9), [monthOf(m1, keeper.id, 0, 'carried'), inJan]);
  check('January\'s own harvest of the crop is what it was without the stock', near(monthOf(m1, keeper.id, 0, 'own'), monthOf(m0, keeper.id, 0), 1e-9), [monthOf(m1, keeper.id, 0, 'own'), monthOf(m0, keeper.id, 0)]);
  check('the build before left it out of January', near(monthOf(o1, keeper.id, 0), monthOf(m0, keeper.id, 0), 1e-9), [monthOf(o1, keeper.id, 0), monthOf(m0, keeper.id, 0)]);
  const weeks = m => F.periods(m, 'week').reduce((t, c) => t + m.rows.reduce((u, r) => u + F.sum(r.value, c.i0, c.i1), 0), 0), months = m => F.periods(m, 'month').reduce((t, c) => t + m.rows.reduce((u, r) => u + F.sum(r.value, c.i0, c.i1), 0), 0);
  const mNo = F.build(E.create({ ...plan, plantings: plan.plantings.filter(p => p.id !== dec.id) }, Lib));
  check('counted once: the season\'s worth rises by the stock\'s worth, and the weeks and the months add up to it', near(worthOf(m1) - worthOf(mNo), inJan * price) && near(weeks(m1), worthOf(m1)) && near(months(m1), worthOf(m1)), [worthOf(mNo), worthOf(m1), inJan * price, weeks(m1), months(m1)]);
  const row = m1.rows.find(r => r.cropId === keeper.id && !r.thing), bm = F.byMonth(eng1, keeper.id).rows.find(r => r.key === row.key);
  check('the crop\'s row carries it once: its total and worth hold the carried part, and what it sells in January by month is the two together',
    row && near(row.carriedTotal, inJan) && near(row.carriedWorth, inJan * price) && bm && near(bm.sold[0], monthOf(m1, keeper.id, 0)) && m1.carried.crops.includes(row.name) && near(m1.carried.worth, inJan * price), [row && row.carriedTotal, bm && bm.sold[0], m1.carried]);
  const x = row.plantings.find(q => q.p.id === dec.id), wk = F.periods(m1, 'week', 0, 6)[0];
  check('a figure\'s plantings split the same way: of one week, what was carried in and the rest come to the whole', x && near(F.share(x, wk.i0, wk.i1, false, 'carried') + F.share(x, wk.i0, wk.i1, false, 'own'), F.share(x, wk.i0, wk.i1, false)) && near(F.share(x, wk.i0, wk.i1, false, 'own'), 0) && F.share(x, wk.i0, wk.i1, true, 'carried') === 0, x ? [F.share(x, wk.i0, wk.i1, false, 'carried'), F.share(x, wk.i0, wk.i1, false)] : null);
  const listed = F.available(m1, wk.i0, wk.i1).filter(a => a.row.cropId === keeper.id && !a.row.thing);
  check('the list to send names the crop once, with what there is: the carried stock and the rest together', listed.length === 1 && near(listed[0].qty, F.sum(row.days, wk.i0, wk.i1)), listed.map(a => a.qty));
  const prior = F.build(E.create(withYear(plan, year - 1), Lib)), priorBase = F.build(E.create(withYear(base, year - 1), Lib));
  const inDec = monthOf(prior, keeper.id, 11) - monthOf(priorBase, keeper.id, 11);
  check('across the two years each pound is counted once: December of the year before has the rest, and the after-Dec-31 figure there is this year\'s carried in',
    near(inDec + inJan, yd.units) && near(prior.after.worth - priorBase.after.worth, inJan * price), [inDec, inJan, yd.units, prior.after.worth - priorBase.after.worth]);
}

// ── 3. a month inside the year: the same, on this build and on the build before ──
{
  const key = keyOf(eng1, spring), s = SL.sowing(eng1, spring);
  const n0 = need(SL, eng0, key, before), n1 = need(SL, eng1, key, before), o0 = need(SL0, old0, key, before), o1 = need(SL0, old1, key, before);
  // the build before counts the April batch; the December one it does not (case 1), so its difference is the April batch alone
  check('inside the year: a batch sown in March for April is counted once in Seeds, on this build and on the build before', near(o1.toSow - o0.toSow, s.amount) && near(n1.toSow - n0.toSow - SL.sowing(eng1, batch).amount, s.amount), [n0, n1, o0, o1]);
  const noMar = { ...plan, plantings: plan.plantings.filter(p => p.id !== mar.id) };
  const rm = eng1.calc(mar), ym = eng1.yieldOf(mar, rm), m0 = F.build(E.create(noMar, Lib)), m1 = F.build(eng1), om0 = F0.build(E0.create(noMar, Lib)), om1 = F0.build(old1);
  const marApr = (m, z) => monthOf(m, keeper.id, 2) + monthOf(m, keeper.id, 3) - (monthOf(z, keeper.id, 2) + monthOf(z, keeper.id, 3));
  check('inside the year: stock picked in March is to sell in March and April, once, on this build and on the build before', iso(rm.first).slice(5, 7) === '03' && near(marApr(m1, m0), ym.units) && near(marApr(om1, om0), ym.units) && near(monthOf(m1, keeper.id, 3), monthOf(om1, keeper.id, 3)), [marApr(m1, m0), marApr(om1, om0), ym.units]);
  check('inside the year nothing is carried in: that is stock from before the plan\'s year only', near(monthOf(m1, keeper.id, 3, 'carried'), 0) && near(monthOf(m1, keeper.id, 2, 'carried'), 0));
}

// ── 3b. a planting dated in the plan's year whose sowing falls in the year before: listed and counted as before, late or not ──
{
  const key = keyOf(eng1, jan), s = SL.sowing(eng1, jan), without = E.create({ ...plan, plantings: plan.plantings.filter(p => p.id !== jan.id) }, Lib);
  check('the case: planted in the plan\'s year, sown in the nursery in the year before', jan.date.slice(0, 4) === Y && iso(s.planned).slice(0, 4) === Y0 && iso(s.planned) < after, [jan.date, iso(s.planned)]);
  check('its seed is still to sow once its day is past with nothing recorded: what is dated in the plan\'s year is not folded as earlier work', near(need(SL, eng1, key, after).toSow - need(SL, without, key, after).toSow, s.amount) && SL.onTasks(eng1, jan, year), [need(SL, eng1, key, after), need(SL, without, key, after), s.amount]);
}

// ── 3c. a transplant planted out late in the year before, for the plan's year ──
{
  const rw = eng1.calc(winter), mine = l => l.members.some(m => m.p.id === winter.id);
  check('the case: sown and planted out in the year before, first picked in the plan\'s year', winter.date.slice(0, 4) === Y0 && iso(rw.first).slice(0, 4) === Y && iso(rw.plannedSow || rw.field).slice(0, 4) === Y0, [winter.date, iso(rw.first)]);
  const now = W.lines(eng1, plan, year).filter(mine), before0 = W0.lines(old1, plan, year).filter(mine);
  check('Tasks\' other jobs list its planting out, on its own day in the year before; the build before did not', now.some(l => l.section === 'plant' && l.date === winter.date) && before0.length === 0, [now.map(l => l.section + ' ' + l.date), before0.length]);
  const m1 = F.build(eng1), x = m1.rows.flatMap(r => r.plantings).find(q => q.p.id === winter.id), at0 = x ? x.lo : 0;
  check('all of its stock is sold in the plan\'s year: nothing of it is carried in, and every week of it is its own',
    x && x.carried === 0 && near(F.share(x, at0, at0 + 6, false, 'own'), F.share(x, at0, at0 + 6, false)) && F.share(x, at0, at0 + 6, false, 'carried') === 0 && F.share(x, at0, at0 + 6, false) > 0, x ? [x.carried, F.share(x, at0, at0 + 6, false, 'carried')] : null);
}

// ── 4. planted in the fall of the year before, for the plan's year ──
{
  const rg = eng1.calc(garlic), key = keyOf(eng1, garlic);
  check('the case: planted in the fall of the year before, first picked in the plan\'s year', rg && iso(rg.first).slice(0, 4) === Y && garlic.date.slice(0, 4) === Y0, [iso(rg && rg.first)]);
  check('it is the plan\'s season, and on Tasks for it', SL.seasonOf(eng1, garlic) === year && SL.onTasks(eng1, garlic, year));
  const early = need(SL, eng1, key, `${Y0}-09-01`), past = need(SL, eng1, key, before), o = SL0.required(old1).rows.find(r => r.key === key), out = SL.required(eng1, { today: before }).outside;
  check('Seeds counts it for the plan: still to plant before its day, and not once the day is past with nothing recorded', early.toSow > 0 && near(early.toSow, early.total) && past.toSow === 0 && near(past.total, early.total) && past.plantings === 1 && out.earlier >= 1, [early, past, out]);
  check('the build before had no row for it', !o || o.plantings === 0);
  // its planting is on Tasks' other jobs when it is a transplant; here it is sown in place, which is the sowing list's
  check('Tasks\' other jobs list the work of the plan\'s season and of the plan\'s year, and the build before\'s list is all in it', (() => { const a = new Set(W.lines(eng1, plan, year).flatMap(l => l.members.map(m => l.key + '|' + m.p.id))); return W0.lines(old1, plan, year).every(l => l.members.every(m => a.has(l.key + '|' + m.p.id))) && W.lines(eng1, plan, year).some(l => l.members.some(m => m.p.id === mar.id)); })());
}

// ── 5. the plan's own end of year ──
{
  const re = eng1.calc(end), key = keyOf(eng1, end);
  check('the case: sown late in the plan\'s year, first picked in the next', re && iso(re.first).slice(0, 4) === String(year + 1), [iso(re && re.first)]);
  const here = SL.required(eng1, { today: before }), there = E.create(withYear(plan, year + 1), Lib), thereBase = E.create(withYear(base, year + 1), Lib);
  check('it is the next season: Seeds for the plan\'s year leaves it out and says so, and the next year counts it', SL.seasonOf(eng1, end) === year + 1 && !here.rows.some(r => r.key === key && r.plantings > need(SL, eng0, key, before).plantings) && here.outside.later >= 1
    && need(SL, there, key, before).plantings - need(SL, thereBase, key, before).plantings === 1, [here.outside, need(SL, there, key, before)]);
  check('its work is on Tasks for the plan\'s year, where it is done, and for the next, whose season it is', SL.onTasks(eng1, end, year) && SL.onTasks(eng1, end, year + 1));
  const m1 = F.build(eng1);
  check('the forecast has nothing of it in the plan\'s year, and the next year\'s has its harvest', !m1.rows.some(r => r.plantings.some(x => x.p.id === end.id)) && F.build(there).rows.some(r => r.plantings.some(x => x.p.id === end.id)));
}

// ── 6. on the plan as given, nothing moves ──
{
  const o = E0.create(given, Lib);
  const rowsOf = (lib, e) => lib.required(e, { today: before }).rows.map(r => [r.key, r.unit, r.plantings, r.waiting, r.established, r.total, r.toSow, r.trays, r.first ? iso(r.first) : ''].join('|')).join('\n');
  check('Seeds on the plan as given are the build before\'s, row for row', rowsOf(SL, eng) === rowsOf(SL0, o));
  const linesOf = (w, e) => w.lines(e, given, year).map(l => [l.key, l.state, l.members.map(m => m.p.id).join(',')].join('|')).join('\n');
  check('Tasks\' other jobs on the plan as given are the build before\'s', linesOf(W, eng) === linesOf(W0, o));
  check('on the plan as given every planting is on Tasks and counted in Seeds exactly as the build before chose them (dated in the plan\'s year)', given.plantings.every(p => !eng.calc(p) || SL.onTasks(eng, p, year) === (String(p.date).slice(0, 4) === Y)));
  const m = F.build(eng), mo = F0.build(o), same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  check('the forecast on the plan as given is the build before\'s, day for day, crop by crop', m.rows.length === mo.rows.length && m.rows.every((r, k) => r.key === mo.rows[k].key && same(r.days, mo.rows[k].days) && same(r.value, mo.rows[k].value) && same(r.picked, mo.rows[k].picked) && r.total === mo.rows[k].total && r.worth === mo.rows[k].worth));
  check('nothing on the plan as given is carried in', m.carried.total === 0 && m.rows.every(r => r.carriedTotal === 0));
  let w = 0; for (const r of m.rows) for (const x of r.plantings) for (let k = 0; k < x.avail.length; k++) if (x.lo + k >= m.days) w += x.avail[k] * (x.price || 0);
  check('what is to sell after Dec 31 is said, and is in no figure of the season', near(m.after.worth, w) && near(worthOf(m), worthOf(mo)), [m.after, w]);
}
finished = true;
