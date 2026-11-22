'use strict';
// A run of successions (E4, #90 section 9, #102): LRFSuccession.planRun, the solver, on the made-up farm, without a browser.
// A sowing of a run is one whole bed. Planned by beds, it comes every so many days; planned to an amount a week, the spacing is
// found, and the size of a sowing never changes. The last sowing's overshoot is planted and said. A frost date stops no sowing
// (it is placed and marked); field dates, closed houses and room still stop one, and what has no bed is said with the gardens that
// have room. A yield nobody has checked plans no amount. The solver changes nothing in the plan it is given.
// Every subject is found on the farm; nothing here names a crop, a bed or a garden of it.
// usage: node run_test.cjs <app-dir> <plan.json (backup or shipped)>
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 4).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail).slice(0, 900) : ''}`); if (!ok) fail.push(name); };
const tryCase = (name, run) => { try { const out = run(); check(name, out === true || (Array.isArray(out) && out[0] === true), Array.isArray(out) ? out[1] : out); } catch (e) { check(name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };
const req = f => require(path.join(appDir, 'js', f));
const E = req('engine.js'), Lib = req('library.js'), IO = req('planio.js'), Rails = req('rails.js'), S = req('succession.js'), F = req('forecast.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core, eng = E.create(core, Lib), year = +core.settings.year;
const iso = d => (d ? E.d2s(d) : null), EPS = 1e-6;
const before = JSON.stringify(core);

/** The run's plantings added to the plan, and the guard rails and the season asked about each, of the engine directly. */
function verdict(added) {
  const plan = { ...core, plantings: [...core.plantings, ...added] }, after = E.create(plan, Lib);
  const refused = added.length ? Rails.refusal(eng, after, added.map(p => p.id)) : null;
  const clashes = added.filter(p => { const r = after.calc(p); return !r || after.conflicts(p, r).length || after.overflow(p, r); });
  const season = added.map(p => { const r = after.calc(p), early = after.fieldFrostOnly(p, r), w = after.warnings(p, r).find(x => ['field', 'closed', 'timing'].includes(x.k) && !(x.k === 'field' && x.t === early)), win = after.fieldPlantingWindow(r.b, r.field.getFullYear());
    return w ? w.t : win.from && r.field < win.from ? 'before the first field date' : null; }).filter(Boolean);
  const whole = added.filter(p => { const r = after.calc(p); return !(r.tw || r.physicalLength >= r.cap - EPS) || p.bedLayout || p.ft != null; });
  const frost = added.map(p => { const r = after.calc(p), w = after.warnings(p, r).find(x => x.k === 'frost'); return w ? w.t : after.fieldFrostOnly(p, r) || null; });
  return { ok: !refused && !clashes.length && !season.length && !whole.length, refused: refused && refused.kind, clashes: clashes.length, season: season.slice(0, 2), whole: whole.length, frost, after };
}
const fieldBeds = c => S.gardensFor(eng, c).filter(g => g.kind === 'bed' && g.garden.type === 'field').map(g => g.garden.id);
const base = F.build(eng, { year, use: 'commercial' }), supplied = new Set(base.rows.map(r => r.cropId));
/** A crop to plan by: grown in field beds, with a yield someone has set, of which the plan already gives nothing (so every week is the run's own). */
const pool = S.candidates(eng, false).filter(c => fieldBeds(c).length >= 2 && !supplied.has(c.id) && !(eng.harvestFor(c.id).open || {}).yield && c.harvestMode !== 'season');

// ── a run refused, in words ──
const anyCrop = pool[0], gs = anyCrop ? fieldBeds(anyCrop) : [];
check('the farm has a crop with a checked yield the plan does not grow yet, in field beds', !!anyCrop, pool.length);
const askBeds = (change = {}) => ({ cropId: anyCrop.id, by: 'beds', every: 14, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-07-15`, gardenIds: gs.slice(0, 1), then: gs.slice(1), ...change });
tryCase('a run asks for a crop, sensible dates and spacing, one whole bed a sowing, and only the spacing to reach an amount', () => {
  const micro = eng.crops().find(c => c.micro), errs = [
    S.planRun(eng, { ...askBeds(), cropId: 'no-such-crop' }), S.planRun(eng, { ...askBeds(), cropId: micro.id }), S.planRun(eng, askBeds({ from: '' })), S.planRun(eng, askBeds({ to: `${year}-05-01` })),
    S.planRun(eng, askBeds({ every: 0 })), S.planRun(eng, askBeds({ every: 1, to: `${year}-12-31`, from: `${year}-01-01` })), S.planRun(eng, askBeds({ wholeBeds: false })), S.planRun(eng, askBeds({ by: 'amount', want: 10, reach: 'size' })),
    S.planRun(eng, askBeds({ by: 'amount', want: 0 })), S.planRun(eng, askBeds({ gardenIds: [], then: [] })), S.planRun(eng, askBeds({ by: 'weekly' }))];
  return [errs.every(r => typeof r.error === 'string' && r.error.length > 8 && !r.sowings) && /Live trays/.test(errs[1].error) && /whole bed/.test(errs[6].error) && /spacing/.test(errs[7].error) && /up to 60/.test(errs[5].error), errs.map(r => r.error)];
});

// ── by beds: one whole bed every so many days ──
const pick = (() => { for (const c of pool) { const g = fieldBeds(c); const r = S.planRun(eng, { cropId: c.id, by: 'beds', every: 14, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-07-27`, gardenIds: g.slice(0, 1), then: g.slice(1) }); if (!r.error && r.sowings.length >= 4 && !r.unplaced.length) return { c, g, r }; } return null; })();
check('the farm has a crop a run of five sowings every two weeks from June places whole', !!pick);
const B = pick && pick.r, C = pick && pick.c, G = pick ? pick.g : [];
tryCase('by beds, planting dates: each sowing goes into its bed on its number\'s day, every 14 days, one whole bed each', () => {
  const v = verdict(B.sowings.map(x => x.p));
  return [B.every === 14 && B.count === 5 && B.sowings.every((x, i) => x.n === i + 1 && iso(x.plant) === iso(E.addDays(E.s2d(`${year}-06-01`), i * 14)) && iso(x.target) === iso(x.plant) && x.p.date === iso(x.plant)) && v.ok, { v: { ...v, after: undefined }, dates: B.sowings.map(x => iso(x.plant)) }];
});
tryCase('each trial planting carries its run: the run\'s id, its number in it and the spacing, and is a new planting nothing has been recorded on', () => {
  const ids = new Set(B.sowings.map(x => x.p.id));
  return [ids.size === B.sowings.length && B.sowings.every(x => x.p.run && x.p.run.id === B.run.id && x.p.run.n === x.n && x.p.run.gap === 14 && Object.keys(x.p.run).sort().join() === 'gap,id,n' && !eng.planting(x.p.id) && !x.p.done && !x.p.workflow && x.p.cropId === C.id), B.sowings.map(x => x.p.run)];
});
tryCase('the record of the run is what the plan keeps: its description, with its spacing and its own id', () => {
  const r = B.run;
  return [typeof r.id === 'string' && r.id.length > 4 && r.cropId === C.id && r.by === 'beds' && r.every === 14 && r.datesFor === 'planting' && r.from === `${year}-06-01` && r.to === `${year}-07-27` && r.reach === 'spacing' && r.wholeBeds === true && Array.isArray(r.gardenIds) && Array.isArray(r.bedIds) && Array.isArray(r.then) && !('want' in r), r];
});
tryCase('a run given an id keeps it, and the same run asked twice is the same run, sowing for sowing', () => {
  const ask = { ...askBeds({ cropId: C.id, gardenIds: G.slice(0, 1), then: G.slice(1), to: `${year}-07-27` }), id: 'run-same' }, a = S.planRun(eng, ask), b = S.planRun(eng, ask);
  const key = r => JSON.stringify(r.sowings.map(x => [x.n, x.bed.id, iso(x.sow), iso(x.plant), iso(x.firstPick), iso(x.lastPick), x.units, x.frost, x.p.run, x.p.date])) + JSON.stringify([r.run, r.weeks.map(w => [w.key, w.have, w.run]), r.totals, r.overshoot && r.overshoot.days, r.unplaced.length]);
  return [a.run.id === 'run-same' && key(a) === key(b), [a.run.id, b.run.id]];
});
tryCase('a bed\'s yield is the engine\'s own (yieldOf on that planting), and the totals are their sums: sowings, whole beds, feet', () => {
  const after = E.create({ ...core, plantings: [...core.plantings, ...B.sowings.map(x => x.p)] }, Lib);
  const ys = B.sowings.map(x => { const r = after.calc(x.p), y = after.yieldOf(x.p, r); return y ? y.units : 0; }), feet = B.sowings.reduce((n, x) => n + after.calc(x.p).physicalLength, 0);
  return [B.sowings.every((x, i) => Math.abs(x.units - ys[i]) < EPS && x.units > 0) && Math.abs(B.totals.units - ys.reduce((a, b) => a + b, 0)) < EPS && B.totals.sowings === B.sowings.length && B.totals.beds === new Set(B.sowings.map(x => x.bed.id)).size && Math.abs(B.totals.feet - feet) < EPS && B.totals.unit === eng.unitOf(C), { units: B.sowings.map(x => x.units), ys, totals: B.totals }];
});
tryCase('the weeks are read off the forecast itself: the plan with the run, less the plan without it', () => {
  const after = F.build(E.create({ ...core, plantings: [...core.plantings, ...B.sowings.map(x => x.p)] }, Lib), { year, use: 'commercial' });
  const rows = m => m.rows.filter(r => r.cropId === C.id && r.unit === B.totals.unit && !r.thing);
  const w = B.weeks.find(x => x.run > 0), i0 = Math.max(base.index(w.start), base.index(B.picking.from)), i1 = Math.min(base.index(E.addDays(w.start, 6)), base.index(B.picking.to));
  const got = rows(after).reduce((n, r) => n + F.sum(r.days, i0, i1), 0) - rows(base).reduce((n, r) => n + F.sum(r.days, i0, i1), 0);
  return [!!w && Math.abs(got - w.run) < 1e-6 && B.weeks.every(x => x.wanted === null && x.short === false) && B.short.length === 0, { got, run: w && w.run }];
});
tryCase('by beds, picking dates: each sowing is dated back from its picking day by the crop\'s own days in its bed', () => {
  const r = S.planRun(eng, { cropId: C.id, by: 'beds', every: 10, datesFor: 'picking', from: `${year}-08-01`, to: `${year}-09-10`, gardenIds: G.slice(0, 1), then: G.slice(1) });
  const v = verdict(r.sowings.map(x => x.p));
  return [!r.error && r.sowings.length >= 3 && r.sowings.every(x => iso(x.firstPick) === iso(x.target) && iso(x.target) === iso(E.addDays(E.s2d(`${year}-08-01`), (x.n - 1) * 10)) && x.plant < x.firstPick) && v.ok, r.error || r.sowings.map(x => [x.n, iso(x.target), iso(x.plant), iso(x.firstPick)])];
});
tryCase('the beds named are taken in their order, before any garden', () => {
  const alone = b => S.planRun(eng, { cropId: C.id, by: 'beds', every: 30, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-06-01`, bedIds: [b.id] }).sowings.length === 1;
  const free = (core.beds || []).filter(b => S.suits(eng, C, b) && G.includes(b.gardenId) && alone(b)).slice(0, 2);
  if (free.length < 2) return [false, 'fewer than two beds free on the day'];
  const ask = list => S.planRun(eng, { cropId: C.id, by: 'beds', every: 30, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-06-01`, bedIds: list.map(b => b.id), gardenIds: G });
  const a = ask(free), b = ask(free.slice().reverse());
  return [!a.error && !b.error && a.sowings[0].bed.id === free[0].id && b.sowings[0].bed.id === free[1].id && a.where.every(w => !w.then), [a.error, b.error]];
});

// ── the overshoot of the last sowing, planted and said ──
tryCase('the last sowing picked past the last day asked is planted, and said in days; one that ends inside it says nothing', () => {
  const ask = { cropId: C.id, by: 'beds', every: 10, datesFor: 'picking', from: `${year}-08-01`, gardenIds: G.slice(0, 1), then: G.slice(1) };
  const r = S.planRun(eng, { ...ask, to: `${year}-08-21` }), last = r.sowings[r.sowings.length - 1];
  const inside = last && S.planRun(eng, { ...ask, every: 90, to: iso(r.sowings[0].lastPick) }), beds = S.planRun(eng, { ...ask, datesFor: 'planting', to: `${year}-08-21` });
  return [!r.error && last.n === r.count && !!r.overshoot && r.overshoot.days === E.dayDiff(last.lastPick, E.s2d(`${year}-08-21`)) && r.overshoot.days > 0 && iso(r.overshoot.lastPick) === iso(last.lastPick) && iso(r.overshoot.end) === `${year}-08-21`
    && inside && !inside.error && inside.sowings.length === 1 && inside.overshoot === null && beds.overshoot === null, r.error || { over: r.overshoot, inside: inside && inside.overshoot }];
});

// ── by amount: the spacing changes, never the size ──
/** A crop and its gardens where a run to an amount a week places every sowing, the spacing it was found at more than a few days. */
const amountPick = (() => {
  for (const c of pool) {
    const g = fieldBeds(c), probe = S.planRun(eng, { cropId: c.id, by: 'beds', every: 30, datesFor: 'picking', from: `${year}-07-15`, to: `${year}-07-15`, gardenIds: g });
    if (probe.error || !probe.sowings.length) continue;
    const bed = probe.sowings[0].units, ask = { cropId: c.id, by: 'amount', want: Math.max(1, Math.round(bed * 7 / 12)), datesFor: 'picking', from: `${year}-07-15`, to: `${year}-09-15`, gardenIds: g };
    const r = S.planRun(eng, ask);
    if (!r.error && r.sowings.length >= 3 && !r.unplaced.length && r.every >= 5) return { c, g, ask, r };
  }
  return null;
})();
check('the farm has a crop a run to an amount a week places whole, in its field gardens', !!amountPick);
const A = amountPick && amountPick.r;
tryCase('to an amount: the spacing found gives at least the amount on average over the weeks asked, and one day wider would not', () => {
  const need = A.weeks.reduce((n, w) => n + w.need, 0), run = A.weeks.reduce((n, w) => n + w.run, 0), wider = S.planRun(eng, { ...amountPick.ask, by: 'beds', every: A.every + 1 });
  const widerRun = wider.weeks.reduce((n, w) => n + w.run, 0);
  return [run >= need - EPS && A.average.run >= A.average.wanted - EPS && widerRun < need - EPS && A.run.every === A.every && A.run.by === 'amount' && A.run.want === amountPick.ask.want && A.run.margin === 0,
    { every: A.every, run, need, widerRun, average: A.average }];
});
tryCase('to an amount: every sowing is one whole bed, the same number of days apart, and the weeks that come up short are named', () => {
  const v = verdict(A.sowings.map(x => x.p)), short = A.weeks.filter(w => w.total < w.wanted * (1 - S.NEAR));
  return [v.ok && A.sowings.every((x, i) => x.p.run.gap === A.every && iso(x.target) === iso(E.addDays(E.s2d(amountPick.ask.from), i * A.every))) && A.short.length === short.length && A.short.length >= 1 && A.short.every(w => w.short && short.some(s => s.key === w.key)),
    { v: { ...v, after: undefined }, short: A.short.map(w => [w.key, w.total, w.wanted]) }];
});
tryCase('to an amount with a margin: more is wanted, so the sowings come closer, never larger', () => {
  const m = S.planRun(eng, { ...amountPick.ask, margin: 50 }), size = r => r.sowings.map(x => x.r.physicalLength).sort().join();
  return [!m.error && m.every < A.every && Math.abs(m.average.wanted - amountPick.ask.want * 1.5) < EPS && m.sowings.every(x => x.r.physicalLength >= x.r.cap - EPS) && m.run.margin === 50, m.error || { every: m.every, was: A.every }];
});
tryCase('to an amount, what the plan already gives is said beside the run and never taken off: a crop the plan gives plenty of still gets sowings of its own, and the weeks are judged on the run\'s own', () => {
  // the first crop the plan already gives, that a run of its own finds whole beds for in its field gardens
  let r = null;
  for (const grown of base.rows.filter(x => x.total > 0 && !x.thing && eng.crop(x.cropId) && !eng.crop(x.cropId).micro && !(eng.harvestFor(x.cropId).open || {}).yield && fieldBeds(eng.crop(x.cropId)).length && eng.crop(x.cropId).harvestMode !== 'season')) {
    const s = F.season(base, [grown]), a = base.date(s.i0), z = base.date(Math.min(s.i1, s.i0 + 27));
    const t = S.planRun(eng, { cropId: grown.cropId, by: 'amount', want: 1, datesFor: 'picking', from: iso(a), to: iso(z), gardenIds: fieldBeds(eng.crop(grown.cropId)) });
    if (!t.error && t.sowings.length && t.weeks.some(w => w.have > w.wanted)) { r = t; break; }
  }
  if (!r) return [false, 'no crop the plan gives that a run finds a bed for'];
  return [!r.error && r.sowings.length >= 1 && r.weeks.some(w => w.have > w.wanted) && r.weeks.every(w => w.need === w.wanted && w.short === (w.run < w.wanted * (1 - S.NEAR)) && Math.abs(w.total - w.have - w.run) < EPS) && r.average.have > 0,
    r.error || { n: r.sowings.length, weeks: r.weeks.slice(0, 3).map(w => [w.have, w.run, w.need, w.short]) }];
});
tryCase('to an amount, planting dates: the weeks asked run from the first picking of a bed planted on the first day to that of one planted on the last', () => {
  const ask = { ...amountPick.ask, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-07-15` }, r = S.planRun(eng, ask);
  const first = r.sowings[0];
  return [!r.error && r.sowings.length >= 2 && iso(first.plant) === `${year}-06-01` && iso(r.picking.from) === iso(first.firstPick) && r.picking.to > r.picking.from && r.weeks.length >= 1 && r.weeks[0].start <= r.picking.from, r.error || { from: iso(r.picking.from), to: iso(r.picking.to), first: first && iso(first.firstPick) }];
});
tryCase('a crop standing on a yield nobody has checked plans no amount, as a series does; planned by beds it still plants', () => {
  const open = eng.crops().find(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0 && (eng.harvestFor(c.id).open || {}).yield && fieldBeds(c).length);
  if (!open) return [false, 'the farm has no crop on a yield nobody has checked'];
  const r = S.planRun(eng, { cropId: open.id, by: 'amount', want: 10, datesFor: 'picking', from: `${year}-07-15`, to: `${year}-08-15`, gardenIds: fieldBeds(open) });
  const b = S.planRun(eng, { cropId: open.id, by: 'beds', every: 14, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-06-30`, gardenIds: fieldBeds(open) });
  return [r.unchecked === true && /nobody has checked/.test(r.error) && !b.error && !!b.rests && b.rests.open === true, [r.error, b.error]];
});

// ── what stops a sowing, and what does not ──
tryCase('a frost date stops no sowing: what it touches is placed, marked with the engine\'s own note, and counted', () => {
  for (const c of S.candidates(eng, false).filter(x => x.frostTender && fieldBeds(x).length)) {
    const r = S.planRun(eng, { cropId: c.id, by: 'beds', every: 10, datesFor: 'planting', from: `${year}-07-15`, to: `${year}-09-20`, gardenIds: fieldBeds(c) });
    if (r.error || !r.sowings.some(x => x.frost)) continue;
    const v = verdict(r.sowings.map(x => x.p)), marks = r.sowings.map(x => x.frost || null);
    return [v.ok && JSON.stringify(marks) === JSON.stringify(v.frost) && r.totals.frost === marks.filter(Boolean).length && !r.unplaced.some(u => u.why.some(w => /frost/i.test(w.why))), { crop: c.name, marks: marks.filter(Boolean).length, v: { ...v, after: undefined } }];
  }
  return [false, 'no frost-tender crop has a sowing the frost touches'];
});
tryCase('field dates still stop a sowing: nothing goes into open ground before the farm\'s first field date, and the season says why', () => {
  const r = S.planRun(eng, { cropId: C.id, by: 'beds', every: 14, datesFor: 'planting', from: `${year}-01-10`, to: `${year}-06-10`, gardenIds: G });
  const win = eng.fieldPlantingWindow(eng.bedOf(r.sowings.length ? r.sowings[0].p.bedId : core.beds.find(b => b.gardenId === G[0]).id), year);
  const early = r.unplaced.filter(u => u.target < win.from);
  return [!r.error && early.length >= 2 && early.every(u => u.why.length && !/^Held by/.test(u.why[0].why)) && r.sowings.every(x => x.plant >= win.from) && verdict(r.sowings.map(x => x.p)).ok, r.error || { early: early.map(u => [iso(u.target), u.why]), first: win.from && iso(win.from) }];
});
tryCase('a closed house still stops a sowing (a house of the farm given an opening day, on a copy of the plan)', () => {
  const ask = (c, id) => ({ cropId: c.id, by: 'beds', every: 7, datesFor: 'planting', from: `${year}-02-03`, to: `${year}-02-24`, gardenIds: [id] });
  let c = null, house = null, open = null;
  for (const x of S.candidates(eng, true)) { for (const g of (core.gardens || []).filter(g => g.type !== 'field' && g.active !== false && !(g.open || g.close))) { const r = S.planRun(eng, ask(x, g.id)); if ((r.sowings || []).length >= 2) { c = x; house = g; open = r; break; } } if (c) break; }
  if (!house) return [false, 'the farm has no house with room in February'];
  const shut = E.create({ ...core, gardens: core.gardens.map(g => (g.id === house.id ? { ...g, open: '03-15' } : g)) }, Lib), r = S.planRun(shut, ask(c, house.id));
  const was = new Set(open.sowings.map(x => x.n));
  return [!r.error && r.sowings.length === 0 && r.unplaced.filter(u => was.has(u.n)).every(u => u.why.some(w => w.why.includes(house.name) && /opens/.test(w.why))), r.error || r.unplaced.map(u => u.why)];
});
tryCase('room still stops a sowing: one with no free bed is said, with why, and with the gardens outside the run that have a bed free for it', () => {
  // a garden of one bed, asked for two sowings a day apart: the first takes the bed, the second finds it held
  const one = (core.beds || []).filter(b => G.includes(b.gardenId) && S.suits(eng, C, b)).find(b => S.planRun(eng, { cropId: C.id, by: 'beds', every: 1, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-06-01`, bedIds: [b.id] }).sowings.length);
  const r = S.planRun(eng, { cropId: C.id, by: 'beds', every: 1, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-06-02`, bedIds: [one.id] }), u = r.unplaced[0];
  const roomOk = u && u.room.length >= 1 && u.room.every(x => x.beds >= 1 && S.planRun(eng, { cropId: C.id, by: 'beds', every: 1, datesFor: 'planting', from: iso(u.target), to: iso(u.target), gardenIds: [x.garden.id] }).sowings.length === 1);
  return [!r.error && r.sowings.length === 1 && r.unplaced.length === 1 && u.n === 2 && /Held by/.test(u.why[0].why) && roomOk && r.count === 2, r.error || u];
});
tryCase('what has no bed is never moved to another date: each sowing placed is on its number\'s day, and each unplaced keeps its own', () => {
  const r = S.planRun(eng, { cropId: C.id, by: 'beds', every: 3, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-07-30`, gardenIds: G.slice(0, 1) });
  const days = [...r.sowings.map(x => [x.n, x.plant]), ...r.unplaced.map(u => [u.n, u.target])];
  return [!r.error && r.unplaced.length >= 1 && days.length === r.count && days.every(([n, d]) => iso(d) === iso(E.addDays(E.s2d(`${year}-06-01`), (n - 1) * 3))), r.error || days.length];
});
tryCase('the gardens to use if the first run out of room are used only then', () => {
  const g1 = B.sowings[0].bed.gardenId, rest = G.filter(id => id !== g1);
  const r = S.planRun(eng, { cropId: C.id, by: 'beds', every: 3, datesFor: 'planting', from: `${year}-06-01`, to: `${year}-07-30`, gardenIds: [g1], then: rest });
  const firsts = (core.beds || []).filter(b => b.gardenId === g1 && S.suits(eng, C, b)), thenOnes = r.sowings.filter(x => x.then);
  // a sowing that went to a garden named under "then" did so on a day every bed of the first garden was taken
  const work = { ...core, plantings: [...core.plantings] };
  let bad = 0;
  for (const x of r.sowings) { if (x.then) { const e2 = E.create(work, Lib); if (firsts.some(b => { const one = S.planRun(e2, { cropId: C.id, by: 'beds', every: 1, datesFor: 'planting', from: iso(x.plant), to: iso(x.plant), bedIds: [b.id] }); return one.sowings.length; })) bad++; } work.plantings.push(x.p); }
  return [!r.error && thenOnes.length >= 1 && r.sowings.some(x => !x.then) && bad === 0 && r.where.some(w => w.then && w.used >= 1), r.error || { then: thenOnes.length, bad }];
});

tryCase('a sowing the frost leaves nothing to pick is still placed, marked, and said to pick nothing', () => {
  for (const c of S.candidates(eng, false).filter(x => x.frostTender && fieldBeds(x).length)) {
    const gs = fieldBeds(c), r = S.planRun(eng, { cropId: c.id, by: 'beds', every: 7, datesFor: 'planting', from: `${year}-09-01`, to: `${year}-10-20`, gardenIds: gs.slice(0, 1), then: gs.slice(1) });
    const none = r.error ? [] : r.sowings.filter(x => !(x.r.harvestDays > 0));
    if (!none.length) continue;
    const v = verdict(r.sowings.map(x => x.p));
    return [v.ok && none.every(x => x.frost && x.units === 0) && !r.unplaced.some(u => u.why.some(w => /ready before the season ends/.test(w.why))), { crop: c.name, none: none.length }];
  }
  return [false, 'no frost-tender crop has a sowing in the fall that the frost leaves nothing to pick'];
});

// ── a copy of a planting of a run is in no run ──
tryCase('a copy of a planting of a run is in no run: copied onto a bed, it is a planting of its own', () => {
  const p0 = B.sowings[0].p, e2 = E.create({ ...core, plantings: [...core.plantings, p0] }, Lib);
  const copy = Rails.propose(e2, { plantingId: p0.id, copy: true }, { bedId: p0.bedId, date: E.addDays(E.s2d(p0.date), 120) }, {});
  return [!!copy.p && copy.p.id !== p0.id && !('run' in copy.p), { copy: copy.p && copy.p.run }];
});

// ── many runs at random: whatever is proposed can always be added (moved here from the series checks of succession_test.cjs) ──
tryCase('60 runs at random, by beds and to an amount, picking and planting dates: every sowing proposed can be added, whole, in season; the frost marks and stops none', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const crops = S.candidates(eng, false).filter(c => fieldBeds(c).length && !(eng.harvestFor(c.id).open || {}).yield);
  let tried = 0, proposed = 0, frost = 0, refused = 0;
  const bad = [];
  for (let k = 0; k < 60; k++) {
    const c = crops[Math.floor(rnd() * crops.length)], gs = fieldBeds(c), from = E.addDays(new Date(year, 3, 1), Math.floor(rnd() * 170)), to = E.addDays(from, 14 + Math.floor(rnd() * 70)), amount = rnd() < 0.5;
    const r = S.planRun(eng, { cropId: c.id, by: amount ? 'amount' : 'beds', ...(amount ? { want: 1 + Math.floor(rnd() * 60) } : { every: 5 + Math.floor(rnd() * 20) }), datesFor: rnd() < 0.5 ? 'picking' : 'planting', from: iso(from), to: iso(to), gardenIds: gs.slice(0, 1), then: gs.slice(1, 3) });
    if (r.error) { refused++; continue; }
    tried++; proposed += r.sowings.length; frost += r.sowings.filter(x => x.frost).length;
    const v = verdict(r.sowings.map(x => x.p));
    if (!v.ok || r.sowings.some((x, i) => v.frost[i] !== (x.frost || null)) || r.totals.frost !== r.sowings.filter(x => x.frost).length) bad.push([c.name, v.refused, v.clashes, v.season, v.whole]);
  }
  return [tried >= 40 && proposed >= 80 && !bad.length, { tried, proposed, frost, refused, bad: bad.slice(0, 3) }];
});

// One garden can contain more than one kind of space. Two differently sized groups and a manual bench
// make a partial opening observable without changing any of the farm's own plantings.
{
  const example = core.plantings.find(p => eng.isTower(eng.bedOf(p.bedId)) && p.towerCycle && +p.towerCycle.days > 0 && eng.crop(p.cropId).tower);
  const micro = eng.crops().find(c => c.micro);
  const crop = eng.crop(example.cropId), garden = { id: 'run-space-test', name: 'Test house', type: 'greenhouse' };
  const next = { ...garden, id: 'run-space-next', name: 'Second house' };
  const space = (id, type, spec, g = garden) => ({ id, bed: id, gardenId: g.id, active: true, type, ...spec });
  const tower = space('first-tower', '42 Site', { l: 2, w: 2 }), second = space('second-tower', '42 Site', { l: 2, w: 2 }, next);
  const group = space('group', 'CT', { count: 5 }), bench = space('rack', 'Bench', { trays: 5 }), bed = space('ground', 'Bed', { l: 20, w: 3 });
  const old = String(year - 1) + '-03-01', first = String(year) + '-06-01';
  const model = { ...example, id: 'tower-model', bedId: tower.id, date: old, towerUsedSites: 12 };
  const block = { id: 'container-model', date: old, bedId: group.id, cropId: crop.id, ft: 3, perC: 2 };
  const trays = { id: 'bench-model', date: old, bedId: bench.id, cropId: micro.id, trays: 3 };
  const plan = { ...core, gardens: [garden, next], beds: [tower, second, group, bench, bed],
    plantings: [model, block, trays], lrfNext: { ...core.lrfNext, waiting: [], runs: [] } };
  const env = E.create(plan, Lib);
  const input = { cropId: crop.id, by: 'beds', every: 1, datesFor: 'planting', from: first, to: String(year) + '-06-02', gardenIds: [garden.id] };
  const towerInput = { ...input, kind: 'tower', varietyId: model.varietyId, then: [next.id] };
  const towers = S.planRun(env, towerInput), blocks = S.planRun(env, { ...input, kind: 'containers' });
  const manual = { ...input, kind: 'bench', cropId: micro.id, sourceId: trays.id }, benches = S.planRun(env, manual);
  tryCase('a mixed garden offers its beds, towers and groups separately; each run uses only its own kind', () => {
    const choices = S.runGardens(env, crop).filter(r => r.garden.id === garden.id);
    const soils = S.planRun(env, input);
    return choices.length === 3 && choices.every(r => r.spaces === 1) && new Set(choices.map(r => r.kind)).size === 3 &&
      soils.sowings.length === 1 && soils.sowings[0].bed.id === bed.id && !('kind' in soils.run);
  });
  tryCase('a tower run follows its model cycle, uses every site of each tower, and falls back only to another tower', () =>
    towers.sowings.length === 2 && towers.run.kind === 'tower' && towers.run.sourceId === model.id &&
    towers.sowings.every(s => s.r.plants === 42 && JSON.stringify(s.p.towerCycle) === JSON.stringify(model.towerCycle)) &&
    towers.sowings[0].bed.id === tower.id && towers.sowings[1].bed.id === second.id && towers.sowings[1].then);
  tryCase('a container run keeps the whole model block and its plants per container, reports the short opening and never splits it', () =>
    blocks.sowings.length === 1 && blocks.run.sourceId === block.id && blocks.sowings[0].r.physicalLength === 3 &&
    blocks.sowings[0].r.plants === 6 && blocks.unplaced.length === 1 && !blocks.unplaced[0].room.length);
  tryCase('a container crop with no model asks for the whole group', () => {
    const empty = E.create({ ...plan, plantings: [] }, Lib);
    const proposed = S.planRun(empty, { ...input, kind: 'containers' });
    return proposed.sowings.length === 1 && !proposed.run.sourceId && proposed.sowings[0].r.physicalLength === group.count;
  });
  tryCase('a bench run copies exactly its manual trays and cannot bypass weekly live-tray demand', () =>
    benches.sowings.length === 1 && benches.sowings[0].p.trays === 3 && benches.run.sourceId === trays.id &&
    benches.unplaced.length === 1 && !!S.planRun(env, { ...manual, sourceId: undefined }).error &&
    /weekly demand/i.test(S.planRun(env, { ...manual, by: 'amount', want: 9 }).error));
  tryCase('a container amount is sized from the model block in the forecast', () => {
    const ask = { ...input, kind: 'containers', by: 'amount', want: 2, datesFor: 'planting', to: String(year) + '-06-15' };
    const result = S.planRun(env, ask);
    return !result.error && result.run.sourceId === block.id && result.sowings.length > 0 &&
      result.sowings.every(q => q.r.physicalLength === 3 && q.units === env.yieldOf(q.p, q.r).units);
  });
}

// ── nothing changes ──
check('the solver changes nothing in the plan it is given', JSON.stringify(core) === before && JSON.stringify(eng.plan) === before);
check('a plan with no run has no runs, and a run\'s plantings are read by its id', S.runs(core).length === 0 && S.runs({ lrfNext: { runs: [B.run, { nothing: 1 }] } }).length === 1 && S.runPlantings({ plantings: B.sowings.map(x => x.p).reverse() }, B.run.id).map(p => p.run.n).join() === B.sowings.map(x => x.n).join());
finished = true;
