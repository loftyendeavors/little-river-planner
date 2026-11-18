'use strict';
/* Tasks, part 2, with no browser: a planting marked failed (plantings[].failed, js/engine.js failedOn, js/week.js fail), and the
 * refusal of a day recorded a year or more before its plan (js/seedlib.js yearAway).
 *   1. a planting marked failed: its harvest ends the day before, its bed is free from that day, what it gives falls in proportion,
 *      its open work leaves the lists and the seed count, what was recorded stays; nothing else in the plan moves
 *   2. two devices: the mark is taken whole, one record a planting; a copy of a planting does not carry it
 *   3. a day a year or more before the plan's is refused, for a sowing and for any other job; one just inside the year is taken
 *   4. with no mark anywhere, every planting is what it was in the build before
 * Every subject is found on the plan given: nothing here names a crop, a bed or a date of any plan.
 * usage: node failed_test.cjs <app-dir> <plan.json> [dir holding the previous build's js]
 */
const path = require('path'), fs = require('fs');
const [app, planFile, oldDir] = process.argv.slice(2);
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
const Lib = req('library.js'), E = req('engine.js'), IO = req('planio.js'), SL = req('seedlib.js'), W = req('week.js'), F = req('forecast.js'), M = req('merge.js'), Rails = req('rails.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const eng = E.create(plan, Lib), year = +plan.settings.year;
const D = d => (d === Infinity ? 'inf' : d && !Number.isNaN(+d) ? E.d2s(d) : String(d));
const put = (pl, q) => ({ ...pl, plantings: pl.plantings.map(x => (x.id === q.id ? q : x)) });
const worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);
const AT = `${year}-01-01T00:00:00.000Z`;
const ctx = { now: `${year}-12-31T12:00:00.000Z`, uid: (() => { let n = 0; return () => 'f-' + (++n); })(), today: `${year}-12-31`, year };

// subjects, found by the engine's own figures
const find = test => plan.plantings.find(p => { const r = eng.calc(p); return r && !p.established && !p.failed && test(p, r); });
const picking = find((p, r) => !r.rack && !r.tw && r.harvestDays > 20 && !r.c.micro && !r.ct && W.steps(eng, p).length >= 1);
const nursery = find((p, r) => r.plannedSow && r.field > E.addDays(r.plannedSow, 14) && r.harvestDays > 0 && SL.sowing(eng, p) && SL.sowing(eng, p).unit === 'seeds');
check('the plan has a planting picked for more than twenty days, and a transplant sown in seed, for the check to work on', picking && nursery);
if (!picking || !nursery) { finished = true; process.exit(0); }

// ── 1. a planting marked failed half way through its harvest ──
const r0 = eng.calc(picking), on = E.d2s(E.addDays(r0.first, Math.floor(r0.harvestDays / 2)));
const marked = W.fail(picking, on, AT), plan1 = put(plan, marked), eng1 = E.create(plan1, Lib), r1 = eng1.calc(marked);
check('the mark is the day and the moment, and nothing else changes on the planting', JSON.stringify(marked.failed) === JSON.stringify({ on, at: AT }) && JSON.stringify({ ...marked, failed: undefined }) === JSON.stringify({ ...picking, failed: undefined }));
check('its harvest ends the day before it failed', D(r1.last) === D(E.addDays(E.s2d(on), -1)) && D(r1.first) === D(r0.first), [D(r0.first), D(r0.last), D(r1.first), D(r1.last)]);
check('its bed is held to the day before, and is free from that day', D(eng1.occupancyThrough(marked, r1)) === D(E.addDays(E.s2d(on), -1)), [D(eng.occupancyThrough(picking, r0)), D(eng1.occupancyThrough(marked, r1))]);
check('on the day it failed it is no longer in its bed, and the day before it is',
  !eng1.cropsAt(picking.bedId, E.s2d(on)).some(x => x.planting.id === picking.id) && eng1.cropsAt(picking.bedId, E.addDays(E.s2d(on), -1)).some(x => x.planting.id === picking.id));
const y0 = eng.yieldOf(picking, r0), y1 = eng1.yieldOf(marked, r1);
check('what it gives falls in proportion to the harvest days lost', Math.abs(y1.units - y0.units * r1.harvestDays / r0.harvestDays) < 1e-6 * Math.max(1, y0.units) || (y0.pattern === 'weekly' && Math.abs(y1.units - y0.units * r1.harvestDays / r0.harvestDays) < 1e-6 * Math.max(1, y0.units)), [y0.units, y1.units, r0.harvestDays, r1.harvestDays]);
const w0 = worth(eng), w1 = worth(eng1);
check('the season\'s worth falls, and by no more than the planting was worth', w1 < w0 && w0 - w1 <= y0.units * y0.price + 1e-6, [w0, w1]);
let moved = [];
for (const x of plan.plantings) {
  if (x.id === picking.id) continue;
  const a = eng.calc(x), b = eng1.calc(eng1.planting(x.id));
  if (!a !== !b || (a && [a.sow, a.field, a.first, a.last, eng.occupancyThrough(x, a)].map(D).join() !== [b.sow, b.field, b.first, b.last, eng1.occupancyThrough(x, b)].map(D).join())) moved.push(x.id);
}
check('no other planting moves', moved.length === 0, moved.slice(0, 5));
check('its work still to do leaves the list, and what was recorded stays', W.steps(eng1, marked).every(st => st.done));
check('the engine says it is marked failed', r1.failed === on && eng1.warnings(marked, r1).some(w => w.k === 'outcome'));

// a transplant lost in the nursery: sown, then failed before it went out
tryCase('a transplant sown and lost in the nursery: its sowing stays recorded, nothing after it is listed, it holds no ground and gives nothing', () => {
  const s = SL.sowing(eng, nursery), sowDay = E.d2s(s.planned), rec = W.record(eng, plan.seedInventory || SL.emptyInventory(), nursery, s.kind, { date: sowDay, follow: false }, ctx);
  const lost = E.d2s(E.addDays(s.planned, 7)), q = W.fail(rec.planting, lost, AT), pl = { ...put(plan, q), seedInventory: rec.inventory || plan.seedInventory }, e = E.create(pl, Lib), r = e.calc(q);
  const steps = W.steps(e, q), held = e.occupancyThrough(q, r);
  return [steps.length === 1 && steps[0].kind === 'sow' && steps[0].done === sowDay && r.harvestDays === 0 && held < r.field && !e.conflicts(q, r).length && !(e.yieldOf(q, r).units > 0), { steps: steps.map(x => x.kind), harvestDays: r.harvestDays, held: D(held), field: D(r.field) }];
});
tryCase('a planting marked failed before it was sown needs no seed, and has no sowing on the list', () => {
  const s0 = SL.sowing(eng, nursery), q = W.fail(nursery, E.d2s(s0.planned), AT), e = E.create(put(plan, q), Lib), s = SL.sowing(e, q);
  const key = s0.key + '|' + s0.unit, before = SL.required(eng).rows.find(x => x.key === key), after = SL.required(E.create(put(plan, q), Lib)).rows.find(x => x.key === key);
  return [s.failed && s.estimate === 0 && W.steps(e, q).length === 0 && after.toSow === before.toSow - (eng.calc(nursery).seeds || 0) && after.waiting === before.waiting - 1, { estimate: s.estimate, before: before.toSow, after: after.toSow }];
});
tryCase('a failed planting cannot be ticked: recording its work is refused, and nothing changes', () => {
  const q = W.fail(nursery, E.d2s(eng.calc(nursery).start), AT), e = E.create(put(plan, q), Lib);
  let why = null;
  try { W.record(e, plan.seedInventory || SL.emptyInventory(), q, 'sow', { date: E.d2s(eng.calc(nursery).start) }, ctx); } catch (err) { why = err.message; }
  return [!!why, why];
});
tryCase('a mark with no day, or a day that is no day, is read as no mark: nothing about the planting changes', () => {
  const ok = [{}, { on: 'soon' }, { on: `${year}-02-30` }, { at: AT }].every(f => { const q = { ...picking, failed: f }, e = E.create(put(plan, q), Lib), a = e.calc(q); return !a.failed && D(a.last) === D(r0.last) && D(e.occupancyThrough(q, a)) === D(eng.occupancyThrough(picking, r0)) && W.steps(e, q).length === W.steps(eng, picking).length; });
  return ok;
});
tryCase('a standing crop marked failed is no longer in its bed from that day, and was the day before', () => {
  const st = plan.plantings.find(p => { const r = eng.calc(p); return r && eng.isStandingCrop(p, r) && !p.failed; });
  if (!st) return [false, 'the farm has no standing crop'];
  const r = eng.calc(st), from = eng.occupancyFrom(st, r), day = E.d2s(E.addDays(from, 30)), q = W.fail(st, day, AT), e = E.create(put(plan, q), Lib);
  const at = d => e.cropsAt(st.bedId, d).some(x => x.planting.id === st.id), before = d => eng.cropsAt(st.bedId, d).some(x => x.planting.id === st.id);
  return [before(E.s2d(day)) && !at(E.s2d(day)) && at(E.addDays(E.s2d(day), -1)) && !at(E.addDays(E.s2d(day), 60)), { day, was: before(E.s2d(day)) }];
});
tryCase('a sheltered container marked failed leaves the nursery bench that day (crates counted on benches)', () => {
  const pl = { ...plan, lrfNext: { ...(plan.lrfNext || {}), crates: 'bench' } }, e0 = E.create(pl, Lib);
  const c = pl.plantings.find(p => { const r = e0.calc(p); return r && r.ct && r.out && r.out > E.addDays(r.field, 20) && e0.benchItems().some(i => i.kind === 'crate' && i.p.id === p.id); });
  if (!c) return [false, 'the farm has no sheltered container on the benches'];
  const r = e0.calc(c), lost = E.addDays(r.field, 5), q = W.fail(c, E.d2s(lost), AT), e1 = E.create(put(pl, q), Lib), day = E.addDays(r.field, 10);
  const mine = (e, d) => e.benchDay(d).items.filter(i => i.p.id === c.id).length, before = e0.benchDay(day).total, after = e1.benchDay(day).total;
  return [mine(e0, day) === 1 && mine(e1, day) === 0 && mine(e1, E.addDays(lost, -1)) === 1 && after < before, { before, after }];
});
tryCase('a planting of a perennial stand marked failed no longer starts the stand: what is left of it holds from its own year', () => {
  const st = plan.plantings.find(p => { const r = eng.calc(p); return r && eng.isStandingCrop(p, r) && !p.failed; });
  if (!st) return [false, 'the farm has no standing crop'];
  const p1 = { ...st, standId: 'stand-check' }, p2 = { ...st, id: st.id + '-next', standId: 'stand-check', established: true, date: String(+st.date.slice(0, 4) + 1) + st.date.slice(4) };
  const pl = { ...plan, plantings: [...plan.plantings.map(x => (x.id === st.id ? p1 : x)), p2] }, e0 = E.create(pl, Lib), r1 = e0.calc(p1), on2 = E.d2s(E.addDays(e0.occupancyFrom(p1, r1), 30));
  const q = W.fail(p1, on2, AT), e1 = E.create(put(pl, q), Lib), later = E.addDays(E.s2d(on2), 20), b = e1.bedOf(st.bedId);
  const heldBefore = e0.holders(e0.bedOf(st.bedId), later, later, null).some(o => o.p.id === p2.id), heldAfter = e1.holders(b, later, later, null).some(o => o.p.id === p2.id);
  return [heldBefore && !heldAfter && E.d2s(e1.occupancyFrom(e1.planting(p2.id), e1.calc(e1.planting(p2.id)))) > on2, { heldBefore, heldAfter }];
});
tryCase('the mark taken off gives back the planting as it was, byte for byte', () => JSON.stringify(W.fail(W.fail(picking, on, AT), null)) === JSON.stringify(picking));
tryCase('a day that is not a calendar day is refused', () => { try { W.fail(picking, `${year}-02-30`, AT); return false; } catch (_) { return true; } });

// ── 2. two devices ──
tryCase('two devices that mark one planting failed on different days: one mark, taken whole (the cloud\'s), and the other reported', () => {
  const a = put(plan, W.fail(picking, on, `${year}-03-01T10:00:00.000Z`)), b = put(plan, W.fail(picking, E.d2s(E.addDays(E.s2d(on), 3)), `${year}-03-01T11:00:00.000Z`));
  const r = M.merge(plan, a, b), p = r.plan.plantings.find(x => x.id === picking.id);
  return [r.ok !== false && JSON.stringify(p.failed) === JSON.stringify(b.plantings.find(x => x.id === picking.id).failed) && r.report.items.length >= 1, { failed: p.failed, items: r.report.items.map(x => x.kind) }];
});
tryCase('both devices re-mark a planting already marked, one to another day and one to the same day: one device\'s mark whole, never the day of one with the moment of the other', () => {
  const was = put(plan, W.fail(picking, on, `${year}-02-01T10:00:00.000Z`)), other = E.d2s(E.addDays(E.s2d(on), 5));
  const mine = put(was, W.fail(picking, other, `${year}-03-01T10:00:00.000Z`)), theirs = put(was, W.fail(picking, on, `${year}-03-02T10:00:00.000Z`));
  const r = M.merge(was, mine, theirs), got = r.plan.plantings.find(x => x.id === picking.id).failed, sides = [mine, theirs].map(pl => JSON.stringify(pl.plantings.find(x => x.id === picking.id).failed));
  return [sides.includes(JSON.stringify(got)), { got, sides }];
});
tryCase('a planting marked failed on one device and changed in another box on the other: both kept', () => {
  const a = put(plan, W.fail(picking, on, AT)), b = put(plan, { ...picking, note: 'theirs' }), r = M.merge(plan, a, b), p = r.plan.plantings.find(x => x.id === picking.id);
  return [p.failed && p.failed.on === on && p.note === 'theirs', { failed: p.failed, note: p.note }];
});
{
  // one device marks the transplant failed, the other records work on it: before the mark's day both stand, after it the cloud's
  const inv = plan.seedInventory || SL.emptyInventory(), sowSt = W.steps(eng, nursery).find(y => y.kind === 'sow'), D = E.addDays(sowSt.planned, 5);
  const marked = put(plan, W.fail(nursery, E.d2s(D), AT));
  const worked = day => put(plan, W.record(eng, inv, nursery, 'sow', { date: E.d2s(day), follow: false }, ctx).planting);
  const of = r => r.plan.plantings.find(x => x.id === nursery.id), said = r => r.report.items.filter(x => x.kind === 'failed-before-work');
  tryCase('marked failed here, and sown on the other device after that day: the other device\'s sowing stands, the mark goes, and it is reported', () => {
    const r = M.merge(plan, marked, worked(E.addDays(D, 3))), p = of(r);
    return [!p.failed && p.done && p.done.sow === E.d2s(E.addDays(D, 3)) && said(r).length === 1 && said(r)[0].whose === 'mine', { failed: p.failed, done: p.done, said: said(r) }];
  });
  tryCase('marked failed on the other device, and sown here after that day: the mark stands, the sowing here goes, and it is reported', () => {
    const r = M.merge(plan, worked(E.addDays(D, 3)), marked), p = of(r);
    return [p.failed && p.failed.on === E.d2s(D) && !(p.done && p.done.sow) && said(r).length === 1 && said(r)[0].whose === 'theirs', { failed: p.failed, done: p.done, said: said(r) }];
  });
  tryCase('marked failed on one device, and sown on the other before that day: both stand, and nothing is reported', () => {
    const a = M.merge(plan, marked, worked(E.addDays(D, -2))), b = M.merge(plan, worked(E.addDays(D, -2)), marked);
    return [[a, b].every(r => of(r).failed && of(r).failed.on === E.d2s(D) && of(r).done && of(r).done.sow === E.d2s(E.addDays(D, -2)) && !said(r).length), [a, b].map(r => ({ failed: of(r).failed, done: of(r).done }))];
  });
}
tryCase('the mark taken off on one device, and left on the other: taken off', () => {
  const was = put(plan, W.fail(picking, on, AT)), a = put(was, W.fail(was.plantings.find(x => x.id === picking.id), null)), r = M.merge(was, a, was);
  return [!r.plan.plantings.find(x => x.id === picking.id).failed, r.plan.plantings.find(x => x.id === picking.id).failed];
});
tryCase('a copy of a planting marked failed (a drag with copy) starts clean, while the planting itself keeps the mark when moved', () => {
  const q = W.fail(picking, on, AT), e = E.create(put(plan, q), Lib), at = { bedId: q.bedId, date: E.addDays(E.s2d(q.date), 21) };
  const copy = Rails.propose(e, { plantingId: q.id, copy: true }, at), move = Rails.propose(e, { plantingId: q.id }, at);
  return [copy.p && !('failed' in copy.p) && copy.p.id !== q.id && move.p && JSON.stringify(move.p.failed) === JSON.stringify(q.failed), [copy.state, copy.p && copy.p.failed, move.state]];
});
tryCase('the mark survives the plan being packed and read back', () => {
  const q = W.fail(picking, on, AT), back = IO.unpack(IO.pack(put(plan, q))).plantings.find(x => x.id === q.id);
  return [back && JSON.stringify(back.failed) === JSON.stringify(q.failed), back && back.failed];
});

// ── 3. a day a year or more before the plan's own ──
tryCase('a sowing recorded a year or more before its planned day is refused, and one just inside the year is taken', () => {
  const s = SL.sowing(eng, nursery), far = E.d2s(E.addDays(s.planned, -SL.YEAR_DAYS)), near = E.d2s(E.addDays(s.planned, 1 - SL.YEAR_DAYS));
  let why = null;
  try { SL.recordSowing(eng, plan.seedInventory || SL.emptyInventory(), nursery, { date: far }, ctx); } catch (e) { why = e.message; }
  const ok = SL.recordSowing(eng, plan.seedInventory || SL.emptyInventory(), nursery, { date: near }, ctx);
  return [!!why && /year/.test(why) && ok.planting.done[s.kind] === near, why];
});
tryCase('any other job recorded a year or more before its day is refused', () => {
  const p = plan.plantings.find(x => { const st = eng.calc(x) && W.steps(eng, x).find(y => !y.seed && !y.done); return !!st; }), st = W.steps(eng, p).find(y => !y.seed && !y.done);
  let why = null;
  try { W.record(eng, plan.seedInventory || SL.emptyInventory(), p, st.kind, { date: E.d2s(E.addDays(st.planned, -SL.YEAR_DAYS - 3)) }, ctx); } catch (e) { why = e.message; }
  return [!!why && /year/.test(why), why];
});

// ── a potting-up planting that failed before it was potted takes no pots ──
tryCase('a planting to be potted up that fails before its pot-up day takes no pots or potting mix; one that fails after takes them', () => {
  const N = req('nursery.js');
  const p = plan.plantings.find(x => { const r = eng.calc(x); if (!r || x.established || x.failed || r.tw || !r.sow || r.c.prop !== 'potup' || String(x.date).slice(0, 4) !== String(year)) return false; const pd = eng.potUpDate(r); return pd && pd > E.addDays(r.sow, 2) && r.field > E.addDays(pd, 2); });
  if (!p) return [false, 'no planting to be potted up on the plan'];
  const r = eng.calc(p), pd = eng.potUpDate(r), pots = e => N.supplies(e, year, null).rows.filter(x => /^pot-/.test(x.id)).reduce((n, x) => n + x.need, 0);
  const at = on => { const e = E.create(put(plan, W.fail(p, E.d2s(on), AT)), Lib); return pots(e); };
  const p0 = pots(eng), before = at(E.addDays(pd, -1)), after = at(E.addDays(pd, 1));
  return [before < p0 && after === p0, { p: p.id, pots: p0, failedBefore: before, failedAfter: after }];
});

tryCase('a crate planting that fails in the nursery before it goes into its crate fills no crate; one that fails in its crate frees it that day', () => {
  const N = req('nursery.js');
  const p = plan.plantings.find(x => { const r = eng.calc(x); return r && !x.established && !x.failed && r.ct && r.len > 0 && r.sow && r.field > E.addDays(r.sow, 2) && String(x.date).slice(0, 4) === String(year) && eng.ctOf(r.b) && eng.ctOf(r.b).shape !== 'round' && r.out && r.out > E.addDays(r.field, 4); });
  if (!p) return [false, 'no crate planting started in the nursery on the plan'];
  const r = eng.calc(p), id = 'crate-' + (eng.ctOf(r.b).id || 'crate'), filled = e => { const x = N.supplies(e, year, null).rows.find(y => y.id === id); return x ? x.fills : 0; };
  const at = on => E.create(put(plan, W.fail(p, E.d2s(on), AT)), Lib);
  const f0 = filled(eng), early = filled(at(E.addDays(r.field, -1))), late = filled(at(E.addDays(r.field, 2)));
  return [early === f0 - r.len && late === f0, { p: p.id, filled: f0, failedBefore: early, failedIn: late, len: r.len }];
});
tryCase('a planting marked failed before it was sown takes no share of the trays it would have shared', () => {
  const find2 = plan.plantings.find(x => { const r = eng.calc(x), s = r && r.sowing; return s && s.trayGroup && s.trayGroup.parts.length >= 2 && !x.failed && !(x.done && (x.done.sow || x.done.field)) && r.plannedSow; });
  if (!find2) return [false, 'no shared tray on the plan'];
  const r = eng.calc(find2), g = r.sowing.trayGroup, mates = plan.plantings.filter(x => { const q = eng.calc(x); return x !== find2 && q && q.sowing && q.sowing.trayGroup && q.sowing.trayGroup.id === g.id; });
  const e1 = E.create(put(plan, W.fail(find2, E.d2s(r.plannedSow), AT)), Lib), trays = (e, list) => list.reduce((n, x) => { const q = e.calc(e.planting(x.id)); return n + (q && q.sowing ? q.sowing.trays || 0 : 0); }, 0);
  const named = mates.some(x => { const s = e1.calc(e1.planting(x.id)).sowing; return (s.memberIds || []).includes(find2.id) || (s.trayGroup && s.trayGroup.parts.some(pt => pt.first === find2.id)); });
  const t0 = trays(eng, mates.concat([find2])), t1 = trays(e1, mates);
  return [!named && t1 <= t0 && (e1.calc(e1.planting(find2.id)).sowing || {}).trayGroup == null, { p: find2.id, group: g.id, mates: mates.length, trays: [t0, t1], named }];
});

tryCase('what a job recorded on the day a planting failed used stays counted: its tray and mix, its pots, its crate', () => {
  const N = req('nursery.js'), inv = plan.seedInventory || SL.emptyInventory(), out = {};
  const sum = (e, test) => N.supplies(e, year, null).rows.filter(x => test(x.id)).reduce((n, x) => n + (x.fills || 0), 0);
  const same = (p, kind, test) => {   // recorded on its own day, then that day marked failed, against recorded alone
    const st = W.steps(eng, p).find(y => y.kind === kind && !y.done); if (!st) return null;
    const day = E.d2s(st.planned), done = W.record(eng, inv, p, kind, { date: day, follow: false }, ctx).planting;
    const a = sum(E.create(put(plan, done), Lib), test), b = sum(E.create(put(plan, W.fail(done, day, AT)), Lib), test);
    return { p: p.id, day, recorded: a, failedThatDay: b, ok: a > 0 && a === b };
  };
  const sown = find((p, r) => r.sow && r.cells && !r.tw && !r.ct && r.c.prop !== 'pot' && r.c.prop !== 'potup' && String(p.date).slice(0, 4) === String(year) && W.steps(eng, p).some(y => y.kind === 'sow'));
  const potted = find((p, r) => r.c.prop === 'potup' && !r.tw && String(p.date).slice(0, 4) === String(year) && W.steps(eng, p).some(y => y.kind === 'potup'));
  const crated = find((p, r) => r.ct && r.len > 0 && r.sow && r.field > r.sow && String(p.date).slice(0, 4) === String(year) && eng.ctOf(r.b) && eng.ctOf(r.b).shape !== 'round' && W.steps(eng, p).some(y => y.kind === 'field'));
  out.tray = sown && same(sown, 'sow', id => /^tray-|^rockwool|^sheet/.test(id));
  out.pots = potted && same(potted, 'potup', id => /^pot-/.test(id));
  out.crate = crated && same(crated, 'field', id => /^crate-/.test(id));
  return [!!(out.tray && out.tray.ok && out.pots && out.pots.ok && out.crate && out.crate.ok), out];
});

tryCase('a planting marked failed is left as it is by a variety swap, and a live-tray batch marked failed is kept when its plan is made again', () => {
  global.LRFSeedLib = SL; global.LRFEngine = E;
  const Sw = req('swap.js'), T = req('trays.js');
  const p = find((q, r) => q.varietyId && Sw.choices(eng, q.varietyId).length > 0);
  if (!p) return [false, 'no variety with another to swap to'];
  const e1 = E.create(put(plan, W.fail(p, E.d2s(eng.calc(p).start || eng.calc(p).field), AT)), Lib), to = Sw.choices(e1, p.varietyId)[0].id;
  const row = (Sw.preview(e1, p.varietyId, to).rows || []).find(x => x.id === p.id || (x.p && x.p.id === p.id) || x.plantingId === p.id) || null;
  const bare = { ...p, done: {}, workflow: undefined, failed: { on: `${year}-05-01`, at: AT } };
  return [!!row && row.state === 'failed' && T.locked(plan, bare, null) === true, { p: p.id, state: row && row.state, locked: T.locked(plan, bare, null) }];
});

// ── 4. with no mark, nothing moved ──
if (oldDir) {
  // the first fall frost's cut (E2c) is held, as in the other build-before comparisons (frost_held.cjs): what is compared is the mark
  const E0 = require(path.join(oldDir, 'engine.js')), e0 = E0.create(plan, Lib), now = E.create(require('./frost_held.cjs').held(E, Lib, plan, e0), Lib);
  let differ = [];
  for (const p0 of plan.plantings) {
    const p = now.planting(p0.id) || p0, a = now.calc(p), b = e0.calc(p0);
    if (!a !== !b) { differ.push(p.id); continue; }
    if (!a) continue;
    if ([a.sow, a.field, a.first, a.last, a.harvestDays, now.occupancyThrough(p, a), (now.yieldOf(p, a) || {}).units].map(D).join() !== [b.sow, b.field, b.first, b.last, b.harvestDays, e0.occupancyThrough(p0, b), (e0.yieldOf(p0, b) || {}).units].map(D).join()) differ.push(p.id);
  }
  check('with no planting marked failed, every planting has the dates, the ground and the yield it had in the build before', differ.length === 0, differ.slice(0, 5));
}
finished = true;
