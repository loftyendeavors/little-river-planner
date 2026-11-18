'use strict';
// The variety swap (js/swap.js), worked out without a browser: one variety put in the place of another across the plantings that
// used it. Each planting keeps its sowing day; the harvest moves by the difference in days; already sown plantings and unticked
// ones are untouched; plantings with days of their own are left out unless ticked, and keep their days; the figures it shows are
// the engine's on the plan after the step; nothing is changed by looking.
// Every subject is found on the plan given: nothing here names a crop, a variety, a bed or a number of any plan.
// usage: node swap_test.cjs <app-dir> <plan.json (backup or shipped)>
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const req = f => require(path.join(appDir, 'js', f));
const E = req('engine.js'), Lib = req('library.js'), IO = req('planio.js'), F = req('forecast.js'), SL = req('seedlib.js'), W = req('swap.js');
const results = [], fail = [];
let finished = false;
process.on('exit', () => { console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, finished })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail).slice(0, 800) : ''}`); if (!ok) fail.push(name); };
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core, eng = E.create(core, Lib);
const iso = d => (E.validDate(d) ? E.d2s(d) : null), sowDay = r => (r ? r.sow || r.field : null), worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);
const apply = (plan, ops) => { const by = new Map(ops.map(o => [o.before.id, o.after])); return { ...plan, plantings: plan.plantings.map(p => by.get(p.id) || p) }; };
const text = JSON.stringify(core);

// ── the subject: a variety in the plan, with plantings the swap takes and plantings with days of their own, and another variety of
// its crop whose days move the harvest of what the swap takes ──
let pick = null;
for (const from of core.varieties.filter(v => !v.deleted && v.active !== false)) {
  for (const to of W.choices(eng, from.id)) {
    const view = W.preview(eng, from.id, to.id);
    if (view.error || view.ticked < 2 || !view.rows.some(r => r.state === 'own-days') || !view.rows.some(r => r.ticked && r.shift)) continue;
    pick = { from, to, view }; break;
  }
  if (pick) break;
}
check('the plan has a variety with plantings the swap takes and plantings with days of their own, and another of its crop with other days, for the check to work on', !!pick);
if (!pick) process.exit(1);
const { from, to, view } = pick;
check('looking changes nothing: the plan is the same, record for record, after the swap is worked out', JSON.stringify(core) === text);
check('only the crop’s other live varieties are offered, and the variety itself is not', W.choices(eng, from.id).every(v => v.cropId === from.cropId && v.id !== from.id && !v.deleted && v.active !== false) && W.choices(eng, from.id).length === eng.varietiesOf(from.cropId).length - 1);
check('another crop’s variety, or the variety itself, cannot take its place', !!W.preview(eng, from.id, from.id).error && !!W.preview(eng, from.id, core.varieties.find(v => v.cropId !== from.cropId && !v.deleted).id).error);
const bare = W.preview(eng, from.id, null);
check('with nothing picked every planting of the variety is listed, and nothing would be written', !bare.ops && bare.rows.length === core.plantings.filter(p => p.varietyId === from.id && eng.calc(p)).length);
check('by default the plantings with days of their own are unticked, and every other planting the swap can take is ticked', view.rows.every(r => r.ticked === (r.state === 'swap')));

// ── the step, applied as the planner applies it ──
const after = E.create(apply(core, view.ops), Lib), ids = new Set(view.ops.map(o => o.before.id));
check('the step holds one change for each ticked planting, and nothing else', view.ops.length === view.ticked && view.ops.every(o => o.before.varietyId === from.id && o.after.varietyId === to.id && o.after.id === o.before.id));
check('a swapped planting changes only its variety: every other key is as it was', view.ops.every(o => { const a = { ...o.before }, b = { ...o.after }; delete a.varietyId; delete b.varietyId; delete a.variety; return JSON.stringify(a) === JSON.stringify(b); }), view.ops.map(o => o.before.id));
check('every sowing day stays, the stored day byte for byte and the day worked out', view.ops.every(o => o.after.date === o.before.date && iso(sowDay(after.calc(o.after))) === iso(sowDay(eng.calc(o.before)))));
const moved = view.rows.filter(r => r.ticked);
check('the harvest of each swapped planting moves by what the sheet says, on the plan after the step', moved.every(r => { const q = after.planting(r.id), r1 = after.calc(q), r0 = eng.calc(eng.planting(r.id)); return E.dayDiff(r1.first, r0.first) === r.shift && iso(r1.first) === iso(r.firstNow) && iso(r1.last) === iso(r.lastNow); }));
check('and by the difference in the two varieties’ days in the bed, the day it goes in being the same', moved.every(r => { const q = after.planting(r.id), p = eng.planting(r.id), r1 = after.calc(q), r0 = eng.calc(p); return iso(r1.field) === iso(r0.field) && r.shift === E.dayDiff(r1.first, r1.field) - E.dayDiff(r0.first, r0.field) && r.shift === after.effective(q).dtm - eng.effective(p).dtm; }), moved.map(r => r.shift));
check('every planting the step does not name is the very same record', after.plan.plantings.every((p, i) => ids.has(p.id) || p === core.plantings[i]));
check('the season’s worth the sheet gives is the engine’s, before and after', Math.abs(view.worth[0] - worth(eng)) < 1e-6 && Math.abs(view.worth[1] - worth(after)) < 1e-6);
// prices differ by variety: with a price of its own on the new variety, the season's worth moves, and by what the engine says
const priced = { ...core, assumptions: { v: 1, crops: {}, varieties: {}, ...(core.assumptions || {}), sellV: { ...((core.assumptions || {}).sellV || {}), [to.id]: { price: 99 } } } };
const engP = E.create(priced, Lib), pv = W.preview(engP, from.id, to.id), afterP = E.create(apply(priced, pv.ops), Lib);
check('where the new variety has a price of its own, the season’s worth the sheet gives moves, and is the engine’s after the step', pv.worth[1] - pv.worth[0] > 1 && Math.abs(pv.worth[0] - worth(engP)) < 1e-6 && Math.abs(pv.worth[1] - worth(afterP)) < 1e-6, pv.worth);
const need = (e, v) => SL.required(e).rows.filter(r => r.variety && r.variety.id === v.id).reduce((n, r) => n + (r.unit === view.seed.unit ? r.toSow : 0), 0);
check('the seed it gives is what the plan needs of each variety after the step', view.seed.toNow === need(after, to) && view.seed.toWas === need(eng, to) && view.seed.fromNow === need(after, from) && view.seed.fromWas === need(eng, from), view.seed);
const lots = { [`v:${to.id}|${SL.stockUnit(view.seed.unit)}`]: { onHand: 7, onOrder: 3 } }, withStock = W.preview(eng, from.id, to.id, { stock: lots });
check('seed on hand and on order is taken from the stock it is given, and what is short is what is left', withStock.seed.onHand === 7 && withStock.seed.onOrder === 3 && withStock.seed.short === Math.max(0, Math.ceil(withStock.seed.toNow - 10)));
// ── overlaps: a pair whose moved harvest runs into the next planting in the bed ──
let ov = null;
for (const f of core.varieties.filter(v => !v.deleted && v.active !== false)) { for (const t of W.choices(eng, f.id)) { const v = W.preview(eng, f.id, t.id); if (!v.error && v.overlaps.length) { ov = v; break; } } if (ov) break; }
check('the plan has a swap whose moved harvest runs into another planting, for the check to work on', !!ov);
if (ov) {
  const ovAfter = E.create(apply(core, ov.ops), Lib), ovIds = new Set(ov.ops.map(o => o.before.id));
  check('each overlap it names is ground booked twice after the step that was not before', ov.overlaps.every(o => { const q = ovAfter.planting(o.id), a = ovAfter.conflicts(q, ovAfter.calc(q)).some(x => x.p && x.p.id === o.other), b = eng.conflicts(eng.planting(o.id), eng.calc(eng.planting(o.id))).some(x => x.p && x.p.id === o.other); return a && !b; }));
  const pairs = e => { const s = new Set(); for (const p of e.plan.plantings) { if (!ovIds.has(p.id)) continue; const r = e.calc(p); for (const o of r ? e.conflicts(p, r) : []) if (o.p) s.add([p.id, o.p.id].sort().join('|')); } return s; };
  const was = pairs(eng), now = pairs(ovAfter);
  check('and every new overlap of a swapped planting is named, once', [...now].filter(k => !was.has(k)).length === ov.overlaps.length, { now: now.size, was: was.size, named: ov.overlaps.length });
  // two swapped plantings that run into each other: the pair is named once
  let both = null;
  for (const f of core.varieties.filter(v => !v.deleted && v.active !== false)) { for (const t of W.choices(eng, f.id)) { const v0 = W.preview(eng, f.id, t.id), v = W.preview(eng, f.id, t.id, { ticked: v0.rows.map(r => r.id) }); if (!v.error && v.overlaps.some(o => o.otherSwapped)) { both = v; break; } } if (both) break; }
  const bothKeys = both ? both.overlaps.map(o => [o.id, o.other].sort().join('|')) : [];
  check('where two swapped plantings run into each other, the pair is named once', !!both && new Set(bothKeys).size === bothKeys.length);
  check('the planting is placed anyway: the step still takes it, and the planting it runs into stays where it was', ov.overlaps.every(o => ovIds.has(o.id) && (o.otherSwapped || ovAfter.planting(o.other) === eng.planting(o.other))));
}

// ── unticked ──
const off = moved[0].id, less = W.preview(eng, from.id, to.id, { ticked: moved.map(r => r.id).filter(id => id !== off) });
check('an unticked planting is left out of the step, and the count and the figures follow', !less.ops.some(o => o.before.id === off) && less.ticked === view.ticked - 1 && less.rows.find(r => r.id === off).ticked === false
  && Math.abs(less.worth[1] - worth(E.create(apply(core, less.ops), Lib))) < 1e-6);
const none = W.preview(eng, from.id, to.id, { ticked: [] });
check('with nothing ticked there is no step and nothing moves', none.ops.length === 0 && none.ticked === 0 && Math.abs(none.worth[1] - none.worth[0]) < 1e-9);

// ── days of its own ──
const own = view.rows.find(r => r.state === 'own-days'), withOwn = W.preview(eng, from.id, to.id, { ticked: [...moved.map(r => r.id), own.id] }), ownOp = withOwn.ops.find(o => o.before.id === own.id);
const afterOwn = E.create(apply(core, withOwn.ops), Lib);
check('a planting with days of its own can be ticked: it takes the new variety and keeps its days and its harvest', !!ownOp && ownOp.after.dtm === ownOp.before.dtm && iso(afterOwn.calc(afterOwn.planting(own.id)).first) === iso(eng.calc(eng.planting(own.id)).first) && withOwn.rows.find(r => r.id === own.id).shift === 0);

// ── already sown ──
const sownId = moved[moved.length - 1].id, sownPlan = { ...core, plantings: core.plantings.map(p => p.id === sownId ? { ...p, done: { sow: E.d2s(sowDay(eng.calc(p))), field: E.d2s(E.addDays(sowDay(eng.calc(p)), 20)) } } : p) };
const engSown = E.create(sownPlan, Lib), sv = W.preview(engSown, from.id, to.id, { ticked: view.rows.map(r => r.id) });
check('a planting with its sowing recorded is left as it is, even when asked for, and is said to be', !sv.ops.some(o => o.before.id === sownId) && sv.rows.find(r => r.id === sownId).state === 'sown' && !sv.rows.find(r => r.id === sownId).ticked && sv.ops.length === view.ticked + view.rows.filter(r => r.state === 'own-days').length - 1);

// work that puts no seed in (the bed amended) does not stop a swap, and the record of it is kept
const amendId = moved[0].id, amendPlan = { ...core, plantings: core.plantings.map(p => p.id === amendId ? { ...p, done: { amend: E.d2s(E.addDays(sowDay(eng.calc(p)), -3)) } } : p) };
const av = W.preview(E.create(amendPlan, Lib), from.id, to.id), aop = av.ops.find(o => o.before.id === amendId);
check('a planting whose bed was amended, with no seed in yet, is still taken, and keeps that record', av.rows.find(r => r.id === amendId).state === 'swap' && !!aop && JSON.stringify(aop.after.done) === JSON.stringify(aop.before.done));
check('the day a sown planting is said to be sown is the first day recorded, its sowing', sv.rows.find(r => r.id === sownId).done === sownPlan.plantings.find(p => p.id === sownId).done.sow);

// ── nursery weeks that differ: the day in the bed moves so that the sowing day holds ──
const tp = moved.map(r => eng.planting(r.id)).find(p => eng.calc(p).sow);
if (tp) {
  const weeks = Math.round(E.dayDiff(eng.calc(tp).field, eng.calc(tp).sow) / 7) + 2;
  const longer = { ...core, varieties: core.varieties.map(v => v.id === to.id ? { ...v, environmentDefaults: { v: 1, field: { gh: weeks }, greenhouse: { gh: weeks } } } : v) };
  const engL = E.create(longer, Lib), lv = W.preview(engL, from.id, to.id, { ticked: [tp.id] }), op = lv.ops[0], afterL = E.create(apply(longer, lv.ops), Lib), r0 = engL.calc(tp), r1 = op && afterL.calc(afterL.planting(tp.id));
  const gh = E.dayDiff(r1 && r1.field, r1 && r1.sow);
  check('where the new variety’s nursery weeks are longer, the day it goes in moves by the difference and the sowing day stays', !!op && gh === weeks * 7 && iso(r1.sow) === iso(r0.sow) && op.after.date === E.d2s(E.addDays(E.s2d(tp.date), gh - E.dayDiff(r0.field, r0.sow))) && lv.rows[0] && lv.rows.find(r => r.id === tp.id).outMoved === gh - E.dayDiff(r0.field, r0.sow), { op: op && [op.before.date, op.after.date], gh, was: E.dayDiff(r0.field, r0.sow) });
} else check('where the new variety’s nursery weeks are longer, the day it goes in moves by the difference and the sowing day stays', false, 'no transplanted planting among those swapped');

// a nursery of none: a transplant that becomes a planting set out on its sowing day is still taken, on its sowing day
if (tp) {
  const none = { ...core, varieties: core.varieties.map(v => v.id === to.id ? { ...v, environmentDefaults: { v: 1, field: { gh: 0 }, greenhouse: { gh: 0 } } } : v) };
  const engN = E.create(none, Lib), nv = W.preview(engN, from.id, to.id, { ticked: [tp.id] }), op = nv.ops[0], afterN = E.create(apply(none, nv.ops), Lib), r0 = engN.calc(tp), r1 = op && afterN.calc(afterN.planting(tp.id));
  check('where the new variety has no nursery weeks, the planting is still taken, and goes in on its old sowing day', !!op && nv.rows.find(r => r.id === tp.id).state === 'swap' && iso(sowDay(r1)) === iso(sowDay(r0)) && op.after.date === iso(r0.sow), { op: op && [op.before.date, op.after.date], sow: iso(r0.sow), state: nv.rows.find(r => r.id === tp.id).state });
} else check('where the new variety has no nursery weeks, the planting is still taken, and goes in on its old sowing day', false, 'no transplanted planting among those swapped');
// what the sheet says of the harvests: a harvest that starts on the same day and ends on another is a move, and is said
const said = W.harvestSaid([{ ticked: true, shift: 0, endShift: 5 }, { ticked: true, shift: 3, endShift: 3 }, { ticked: false, shift: 9, endShift: 9 }, { ticked: true, shift: 0, endShift: 0 }]);
check('a harvest whose end alone moves is counted as a move and said, and an unticked one is not', said.moves === 2 && /in 1, harvest 3 days later/.test(said.said) && /ends on another/.test(said.said) && W.harvestSaid([{ ticked: true, shift: 0, endShift: 0 }]).said === 'no harvest moves', said);
check('the same question gives the same answer', JSON.stringify(W.preview(eng, from.id, to.id).ops) === JSON.stringify(view.ops));
check('nothing above changed the plan', JSON.stringify(core) === text);
finished = true;
