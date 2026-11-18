// E2c: the first fall frost in open ground, and a last picking of his own for each place. The arithmetic, without a browser.
// node frost_test.cjs <app-dir> <plan.json>
//
// In open ground the first fall frost ends a frost-tender crop's harvest where its days would run past it, and what is not
// picked is lost: 40 of 90 harvest days lost is 40/90 of the yield (his, Nov 15). Hardy crops and anything under cover are
// untouched; a last day of the planting's own stands over the frost (his, Nov 18); a crop cleared in one day loses nothing to a
// frost after the day it is ready. A crop picked to the season's end may be given a last picking of its own for each place
// (assumptions.sell[crop].until), which stands for the season's end there. Every subject is found on the plan given.
const path = require('path'), fs = require('fs');
const [APP, PLAN] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 700)}`); if (!ok) fail.push(name); };
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L; require(path.join(APP, 'js/guide.js'));
const F = require(path.join(APP, 'js/forecast.js')), Held = require('./frost_held.cjs');
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const eng = E.create(core, Lib), year = +core.settings.year, iso = d => E.d2s(d);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const worth = e => F.build(e, { year }).rows.reduce((n, r) => n + r.worth, 0);
const list = core.assumptions || { v: 1, crops: {}, varieties: {} };
/** The plan with a crop's line changed (and every other line as it is). */
const withSell = (cropId, rule) => E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, ...list, sell: { ...(list.sell || {}), [cropId]: { ...((list.sell || {})[cropId] || {}), ...rule } } } }, Lib);
const withPlanting = (id, change) => E.create({ ...core, plantings: core.plantings.map(p => p.id === id ? { ...p, ...change } : p) }, Lib);
const withFrost = md => E.create({ ...core, settings: { ...core.settings, frostFirst: md } }, Lib);
const frostIn = (e, r) => E.addDays(e.frostDates(r.field.getFullYear()).first, Number(r.g.frostOffset) || 0);
const all = core.plantings.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && x.r.b.active !== false && x.r.g.active !== false);
const units = (e, p) => { const q = e.planting(p.id), y = e.yieldOf(q, e.calc(q)); return y ? y.units : 0; };

// ── 1. which plantings the frost cuts, on the plan as it is ──
const held = E.create(Held.held(E, Lib, core, null), Lib);
const cut = all.filter(x => x.r.frostCut);
check('the plan has plantings the frost cuts, picked over days, one of them first ready before the frost and one after', cut.some(x => x.r.harvestDays > 0) && cut.some(x => x.r.harvestDays === 0), cut.map(x => x.p.id));
check('every one is a frost-tender crop in open ground, with no last day of its own, whose days ran past the frost', cut.every(x => x.r.c.frostTender && eng.openGround(x.r.g) && !x.p.harvestEnd && x.r.frostCut.planned > x.r.frostCut.day));
check('its last picking is the frost day, and its harvest days are those up to it', cut.every(x => +x.r.last === +frostIn(eng, x.r) && +x.r.frostCut.day === +frostIn(eng, x.r) && x.r.harvestDays === Math.max(0, E.dayDiff(x.r.last, x.r.first) + 1)), cut.slice(0, 3).map(x => [x.p.id, iso(x.r.last), x.r.harvestDays]));
check('held at the last day it was to be picked, by a day of its own, it is picked to that day as before', cut.every(x => { const q = held.planting(x.p.id), h = held.calc(q); return !h.frostCut && +h.last === +x.r.frostCut.planned && h.harvestDays === x.r.frostCut.plannedDays; }));
check('it loses yield in proportion to the days lost: what it gives is what it gave held, times the days left over the days it was to be picked', cut.every(x => near(units(eng, x.p), units(held, x.p) * x.r.harvestDays / x.r.frostCut.plannedDays)), cut.map(x => [x.p.id, units(eng, x.p), units(held, x.p), x.r.harvestDays, x.r.frostCut.plannedDays]));
const ripeAfter = cut.find(x => x.r.harvestDays === 0);
check('one first ready after the frost is not picked at all, and is not in the forecast', !!ripeAfter && units(eng, ripeAfter.p) === 0 && !F.build(eng, { year }).rows.some(r => r.plantings.some(q => q.p.id === ripeAfter.p.id)));
const ground = x => +eng.occupancyThrough(x.p, x.r);
check('the ground it holds is given back from the frost, with its turnover after it', cut.every(x => { const q = held.planting(x.p.id); return ground(x) === +E.addDays(x.r.last, eng.turnoverFor(x.p)) && ground(x) < +held.occupancyThrough(q, held.calc(q)); }));
check('one note for one cause: a planting ready after the frost is not told also that its harvest period ended', cut.filter(x => !x.r.harvestDays).every(x => !eng.warnings(x.p, x.r).some(w => w.k === 'timing')));
check('it says so in its own words, quietly, among its planting notes', cut.every(x => eng.warnings(x.p, x.r).some(w => w.k === 'frost' && w.t.includes(`first frost (${iso(x.r.frostCut.day)})`) && (x.r.harvestDays ? w.t.includes(`${x.r.harvestDays} of ${x.r.frostCut.plannedDays} days`) : /nothing is picked/.test(w.t)))), cut.map(x => eng.warnings(x.p, x.r).map(w => w.t)));
check('nothing else is cut: every other planting is the plan held, day for day and yield for yield', all.filter(x => !x.r.frostCut).every(x => { const q = held.planting(x.p.id), h = held.calc(q); return +h.first === +x.r.first && +h.last === +x.r.last && near(units(held, x.p), units(eng, x.p)); }));
const m = F.build(eng, { year }), mh = F.build(held, { year }), lost = cut.reduce((n, x) => n + (units(held, x.p) - units(eng, x.p)) * eng.yieldOf(x.p, x.r).price, 0);
check('the season’s worth falls by what the cut plantings lose, and by nothing else', near(worth(held) - worth(eng), lost, 1e-6) && lost > 0, [worth(held), worth(eng), lost]);

// what the rule names, read from the plan itself and not from the engine's reckoning of the cut: a frost-tender crop in a garden
// that is open to frost and is a field (or of the outdoor kind), with no last day of its own and no clear or failure recorded,
// whose days, picked for a set number of them, would run past the frost. A crate or tower that stands under shelter is left to
// section 2, and a crop picked to the season's end has its own section (5).
{
  const fdOf = g => E.addDays(E.s2d(`${year}-${core.settings.frostFirst}`), Number(g.frostOffset) || 0);
  const open = g => !!g && !!g.frost && (g.growingEnvironment && g.growingEnvironment.v === 1 ? g.growingEnvironment.kind === 'outdoor' : g.type === 'field' || g.type === 'towers');
  const expect = x => { const p = x.p, r = x.r, c = eng.crop(p.cropId), g = (core.gardens || []).find(k => k.id === (eng.bedOf(p.bedId) || {}).gardenId);
    if (!c || !c.frostTender || !open(g) || p.harvestEnd || (p.done && p.done.flip) || (p.workflow && p.workflow.outcome === 'failed') || r.harvestMode !== 'window') return false;
    return E.addDays(r.first, r.c.hw - 1) > fdOf(g); };
  const plain = all.filter(x => !(eng.bedOf(x.p.bedId) || {}).shelter && x.r.harvestMode === 'window');
  const want = plain.filter(expect).map(x => x.p.id).sort(), got = plain.filter(x => x.r.frostCut).map(x => x.p.id).sort();
  check('the plantings cut are those the rule names, read from the plan itself: no more, no fewer', JSON.stringify(want) === JSON.stringify(got) && all.filter(x => x.r.harvestMode === 'season' && x.r.frostCut).length === 0, { want, got });
}

// ── 2. what it leaves alone ──
const under = all.find(x => x.r.c.frostTender && !eng.openGround(x.r.g) && x.r.g.frost && x.r.harvestMode === 'window' && x.r.last > frostIn(eng, x.r));
check('under cover with frost days of its own (a tunnel), a frost-tender crop picked past its frost is not cut', !!under && !under.r.frostCut && +under.r.last === +E.addDays(under.r.first, under.r.c.hw - 1), under && under.p.id);
const heated = all.find(x => x.r.c.frostTender && !x.r.g.frost && x.r.last > E.addDays(eng.frostDates(year).first, 0));
check('in a heated house a frost-tender crop is picked past the first frost as before', !!heated && !heated.r.frostCut, heated && heated.p.id);
const hardy = all.find(x => !x.r.c.frostTender && eng.openGround(x.r.g) && x.r.last > frostIn(eng, x.r));
check('a hardy crop in open ground is picked past the frost as before', !!hardy && !hardy.r.frostCut, hardy && hardy.p.id);
const subject = cut.find(x => x.r.harvestDays > 0);
{
  const day = iso(subject.r.frostCut.planned), e1 = withPlanting(subject.p.id, { harvestEnd: day }), q = e1.planting(subject.p.id), r1 = e1.calc(q);
  check('a last day of the planting’s own past the frost stands: it is picked to it in full', !r1.frostCut && iso(r1.last) === day && near(units(e1, subject.p), units(held, subject.p)));
  check('and is still marked quietly as running past the first frost', e1.warnings(q, r1).some(w => w.k === 'frost' && /runs past the first frost/.test(w.t)));
}

// work recorded says what happened: a clear or a failure recorded after the frost stands, and nothing is cut
{
  const late = iso(E.addDays(subject.r.frostCut.day, 4)), e1 = withPlanting(subject.p.id, { done: { ...(subject.p.done || {}), flip: late } }), r1 = e1.calc(e1.planting(subject.p.id));
  check('a clear recorded after the frost stands: picked to the day recorded, and nothing cut', !r1.frostCut && iso(r1.last) === late && !e1.warnings(e1.planting(subject.p.id), r1).some(w => /ends its harvest/.test(w.t)), [iso(r1.last), !!r1.frostCut]);
  const e2 = withPlanting(subject.p.id, { workflow: { outcome: 'failed', failureDate: late } }), r2 = e2.calc(e2.planting(subject.p.id));
  check('a failure recorded after the frost stands too: the harvest ends on it, and nothing is cut', !r2.frostCut && iso(r2.last) === late);
}
// a crate or tower that stands under shelter until after the frost is under cover when it comes
{
  const crate = cut.find(x => x.r.harvestDays > 0 && eng.isCt(x.r.b)) || null, shelter = { gardenId: 'nursery' };
  check('the plan has a crate the frost cuts, to put under shelter', !!crate, cut.map(x => x.p.id));
  if (crate) {
    const e1 = withPlanting(crate.p.id, { shelter, out: iso(E.addDays(crate.r.frostCut.day, 10)) }), r1 = e1.calc(e1.planting(crate.p.id));
    check('under shelter until after the frost, it is under cover when the frost comes: nothing is cut', !r1.frostCut && +r1.last === +crate.r.frostCut.planned, [iso(r1.last), !!r1.frostCut]);
    const e2 = withPlanting(crate.p.id, { shelter, out: iso(E.addDays(crate.r.field, 1)) }), r2 = e2.calc(e2.planting(crate.p.id));
    check('moved out before the frost, it is in open ground when it comes, and is cut', !!r2.frostCut && +r2.last === +crate.r.frostCut.day);
  }
}

// ── 3. how it is picked ──
{
  const id = subject.p.cropId, plain = units(eng, subject.p);
  const weekly = withSell(id, { pattern: 'weekly' }), wq = weekly.planting(subject.p.id), wr = weekly.calc(wq), wheld = E.create(Held.held(E, Lib, weekly.plan, null), Lib);
  check('picked gradually, a week’s figure, it is cut the same: what is picked to the frost and no more', wr.frostCut && near(units(weekly, subject.p), units(wheld, subject.p) * wr.harvestDays / wr.frostCut.plannedDays), [units(weekly, subject.p), units(wheld, subject.p)]);
  const once = withSell(id, { pattern: 'once' }), oq = once.planting(subject.p.id), or = once.calc(oq), oheld = E.create(Held.held(E, Lib, once.plan, null), Lib);
  check('cleared in one day, ready before the frost, it loses nothing: the frost ends only the days its ground is held', or.frostCut && or.harvestDays > 0 && near(units(once, subject.p), units(oheld, subject.p)) && units(once, subject.p) > plain, [units(once, subject.p), units(oheld, subject.p)]);
  check('and its note says it is cleared before the frost', once.warnings(oq, or).some(w => w.k === 'frost' && /Cleared before the first frost/.test(w.t)));
  const after = cut.find(x => x.r.harvestDays === 0), onceAfter = withSell(after.p.cropId, { pattern: 'once' });
  check('cleared in one day and ready after the frost, it gives nothing', units(onceAfter, after.p) === 0);
}

// ── 4. the frost date moves the cut ──
{
  const fd = subject.r.frostCut.day, later = E.addDays(subject.r.frostCut.planned, 3), e1 = withFrost(iso(later).slice(5)), q1 = e1.planting(subject.p.id), r1 = e1.calc(q1);
  check('a first frost after the last day it was to be picked cuts nothing of it', !r1.frostCut && +r1.last === +subject.r.frostCut.planned);
  const sooner = E.addDays(fd, -2), e2 = withFrost(iso(sooner).slice(5)), q2 = e2.planting(subject.p.id), r2 = e2.calc(q2);
  check('a frost two days sooner cuts it two days sooner, and the yield with it', r2.frostCut && +r2.last === +sooner && r2.harvestDays === subject.r.harvestDays - 2 && near(units(e2, subject.p), units(held, subject.p) * r2.harvestDays / r2.frostCut.plannedDays));
}

// ── 5. a last picking of his own for each place ──
const seasonal = all.find(x => x.r.harvestMode === 'season' && x.r.c.frostTender && eng.openGround(x.r.g) && x.r.harvestDays > 20 && !x.p.harvestEnd && !x.p.harvestMode && !(x.p.hw > 0));
check('the plan has a frost-tender crop picked to the season’s end in open ground, ending on the frost', !!seasonal && +seasonal.r.last === +frostIn(eng, seasonal.r) && !seasonal.r.frostCut, seasonal && seasonal.p.id);
{
  const id = seasonal.p.cropId, env = eng.envOf(seasonal.r.b), fd = frostIn(eng, seasonal.r), before = E.addDays(fd, -10), past = E.addDays(fd, 14);
  const mates = all.filter(x => x.p.cropId === id), others = all.filter(x => x.p.cropId !== id);
  const e1 = withSell(id, { until: { [env]: iso(before).slice(5) } }), r1 = e1.calc(e1.planting(seasonal.p.id));
  check('a date before the frost ends its harvest there, as the season’s end: nothing is cut', +r1.last === +before && !r1.frostCut && +r1.automaticEnd === +before);
  check('the same total is spread over fewer days: no yield is lost to a date of his own', near(units(e1, seasonal.p), units(eng, seasonal.p)) || r1.harvestDays < (seasonal.r.c.yieldDays || 0), [units(e1, seasonal.p), units(eng, seasonal.p)]);
  check('every planting of the crop in that place follows it; other crops are as they were', mates.filter(x => eng.envOf(x.r.b) === env && !x.p.harvestEnd).every(x => { const r = e1.calc(e1.planting(x.p.id)); return r.harvestMode !== 'season' || +r.last === Math.min(+before, +x.r.last) || r.last < before; }) && others.every(x => +e1.calc(e1.planting(x.p.id)).last === +x.r.last));
  const e2 = withSell(id, { until: { [env]: iso(past).slice(5) } }), r2 = e2.calc(e2.planting(seasonal.p.id));
  check('a date past the frost, in open ground, is cut short by the frost: picked to the frost, and the yield with it', r2.frostCut && +r2.last === +fd && +r2.frostCut.planned === +past && r2.harvestDays < r2.frostCut.plannedDays);
  check('what it loses is the days after the frost, over the days to his date', near(units(e2, seasonal.p) / units(E.create(Held.held(E, Lib, e2.plan, null), Lib), seasonal.p), r2.harvestDays / r2.frostCut.plannedDays));
  const elsewhere = all.find(x => x.p.cropId === id && eng.envOf(x.r.b) !== env && x.r.harvestMode === 'season');
  check('a place he did not name keeps the season’s end there', !elsewhere || +e1.calc(e1.planting(elsewhere.p.id)).last === +elsewhere.r.last);
  const listed = withSell(id, { days: 30, until: { [env]: iso(before).slice(5) } }), r3 = listed.calc(listed.planting(seasonal.p.id));
  check('picked for a set number of days, the crop has no season’s end, and the date is not read', r3.harvestMode === 'window' && +r3.automaticEnd === +E.addDays(r3.first, 29));
  const cleared = withSell(id, { pattern: 'once', until: { [env]: iso(before).slice(5) } }), r6 = cleared.calc(cleared.planting(seasonal.p.id));
  check('cleared in one day, the crop has no last picking, and the date is not read', +r6.last === +seasonal.r.last);
  // a planting that carries a harvest window of its own, even to the season's end, does not take the line's date (as it keeps its own days)
  const line = withSell(id, { until: { [env]: iso(before).slice(5) } }).plan.assumptions, ownOf = change => E.create({ ...withPlanting(seasonal.p.id, change).plan, assumptions: line }, Lib);
  const own = ownOf({ hw: 25 }), r4 = own.calc(own.planting(seasonal.p.id)), owns = ownOf({ harvestMode: 'season' }), r5 = owns.calc(owns.planting(seasonal.p.id));
  check('a planting with a harvest window of its own does not follow the line’s date: its own days, or its own season’s end', r4.harvestMode === 'window' && +r4.automaticEnd === +E.addDays(r4.first, 24) && r5.harvestMode === 'season' && +r5.last === +seasonal.r.last);
  const bad = withSell(id, { until: { [env]: '13-40', nowhere: '10-01' } });
  check('a date that is no month and day, or a place that is none, is not read', +bad.calc(bad.planting(seasonal.p.id)).last === +seasonal.r.last && bad.sellRule(id).until === null);
  check('the line holds the dates it was given, place by place', e1.sellRule(id).until[env] === iso(before).slice(5) && e1.harvestFor(id).until[env] === iso(before).slice(5) && Object.keys(e1.harvestFor(id).until).length === 1);
}
{
  const cover = all.find(x => x.r.harvestMode === 'season' && x.r.c.frostTender && !eng.openGround(x.r.g) && x.r.g.frost);
  const house = all.find(x => x.r.harvestMode === 'season' && x.r.c.frostTender && !x.r.g.frost && eng.envOf(x.r.b) === 'heated');
  const subjectOf = cover || house, env = subjectOf && eng.envOf(subjectOf.r.b);
  check('the plan has a frost-tender crop picked to the season’s end under cover', !!subjectOf, null);
  const date = E.addDays(subjectOf.r.last, subjectOf.r.last.getMonth() === 11 ? -20 : 10), e1 = withSell(subjectOf.p.cropId, { until: { [env]: iso(date).slice(5) } }), r1 = e1.calc(e1.planting(subjectOf.p.id));
  check('under cover a date of his own stands as the season’s end, before or after the frost, and nothing is cut', +r1.last === +date && !r1.frostCut);
}

// ── 6. where the season ends in a place with no date of his own ──
{
  const id = seasonal.p.cropId, f = eng.seasonEndOf(id, 'field', year), t = eng.seasonEndOf(id, 'tunnel', year), h = eng.seasonEndOf(id, 'heated', year);
  check('in the field the season ends on the first frost, which cuts short a date past it', !!f && f.by === 'frost' && +f.date === +eng.frostDates(year).first && +f.frost === +f.date);
  check('in a tunnel it ends on the frost and the days the tunnel keeps it off, and no date of his is cut there', !t || (t.by === 'cover' && t.frost === null && t.date > eng.frostDates(year).first));
  check('in a heated house it ends with the year', !!h && h.by === 'year' && iso(h.date) === `${year}-12-31` && h.frost === null);
  const hardyCrop = eng.crops().find(c => !c.frostTender && !c.micro && c.harvestMode === 'season') || eng.crops().find(c => !c.frostTender && !c.micro);
  check('for a hardy crop the field’s season ends with the year, and nothing is cut by the frost', eng.seasonEndOf(hardyCrop.id, 'field', year).by !== 'frost' && eng.seasonEndOf(hardyCrop.id, 'field', year).frost === null);
}

// ── 7. the forecast kept for an engine follows every one of these ──
{
  const id = seasonal.p.cropId, env = eng.envOf(seasonal.r.b), base = F.kept(eng, { year });
  check('the forecast kept for an engine is the one built for it, and is kept', F.isKept(eng, { year }) && F.kept(eng, { year }) === base && worth(eng) === base.rows.reduce((n, r) => n + r.worth, 0));
  const steps = [['a last picking of his own', withSell(id, { until: { [env]: iso(E.addDays(seasonal.r.last, -10)).slice(5) } })], ['the first fall frost moved', withFrost(iso(E.addDays(eng.frostDates(year).first, -7)).slice(5))],
    ['a planting’s own last day past the frost', withPlanting(subject.p.id, { harvestEnd: iso(subject.r.frostCut.planned) })], ['a crop cleared in one day', withSell(subject.p.cropId, { pattern: 'once' })]];
  // what a forecast says, row by row: how much in all, the first and last day anything is there to sell, and each planting's days
  const said = x => x.rows.map(r => { const d = Array.from(r.days), a = d.findIndex(v => v > 1e-9), z = d.length - 1 - [...d].reverse().findIndex(v => v > 1e-9); return `${r.key}:${r.total.toFixed(6)}:${a}:${z}:${r.plantings.map(q => q.p0 + '-' + q.p1).join(',')}`; }).join('|');
  for (const [what, e] of steps) {
    const fresh = F.isKept(e, { year }) === false, k = F.kept(e, { year });
    check(`after ${what}, nothing is kept for the new plan's engine until it is asked for, and then it is that plan's`, fresh && k !== base && F.kept(e, { year }) === k, what);
    check(`after ${what}, the forecast kept is the one built for that plan, and not the plan before's`, said(k) === said(F.build(e, { year })) && said(k) !== said(base), what);
  }
}
finished = true;
