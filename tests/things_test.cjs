// More than one thing sold from a crop: the arithmetic, without a browser.
// A plan nobody has touched is forecast as the build before forecast it, whole; a thing that is not complete counts for nothing;
// each of the three kinds gives what its figures say, planting by planting; and the build before, given a plan that holds
// things, forecasts the crop as if they were not there and loses none of them.
// node things_test.cjs <app-dir> <plan.json: a backup's or the shipped compact one> <dir of the build before's js>
const path = require('path'), fs = require('fs');
const [APP, PLAN, OLD] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 700)}`); if (!ok) fail.push(name); };
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L; require(path.join(APP, 'js/guide.js'));
const F = require(path.join(APP, 'js/forecast.js')), SU = require(path.join(APP, 'js/succession.js'));
const E0 = require(path.join(OLD, 'engine.js')), F0 = require(path.join(OLD, 'forecast.js')), IO0 = require(path.join(OLD, 'planio.js'));
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const clone = x => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const worth = m => m.rows.reduce((n, r) => n + r.worth, 0);
/** Two forecasts are the same: every row, its name and unit, its totals, and every day of what is picked, sold and worth. */
const differ = (a, b) => {
  const out = [];
  if (a.rows.length !== b.rows.length) out.push(`rows ${a.rows.length} and ${b.rows.length}`);
  if (a.counted !== b.counted || a.unset.length !== b.unset.length || a.personal !== b.personal || a.keeps !== b.keeps) out.push('counted, unset, personal or keeps');
  const byKey = new Map(b.rows.map(r => [r.key, r]));
  for (const r of a.rows) {
    const o = byKey.get(r.key);
    if (!o) { out.push('no row ' + r.key); continue; }
    if (r.name !== o.name || r.unit !== o.unit || r.group !== o.group || r.total !== o.total || r.worth !== o.worth || r.pickedTotal !== o.pickedTotal || r.plantings.length !== o.plantings.length || r.unset !== o.unset) out.push('totals of ' + r.key);
    for (const k of ['days', 'picked', 'value']) if (!Array.from(r[k]).every((v, i) => v === o[k][i])) out.push(`${k} of ${r.key}`);
    if (r.varieties.length !== o.varieties.length || !r.varieties.every((v, i) => v.id === o.varieties[i].id && v.total === o.varieties[i].total)) out.push('varieties of ' + r.key);
  }
  return out;
};
const eng = E.create(core, Lib), base = F.build(eng), old = F0.build(E0.create(core, Lib));

// ── a plan nobody has touched ──
check('a plan with no second thing is forecast exactly as the build before forecast it: every row, every total, every day', differ(base, old).length === 0, differ(base, old).slice(0, 4));
check('and the same for what is grown to sell alone, and for what is kept for the house alone', ['commercial', 'personal'].every(use => differ(F.build(eng, { use }), F0.build(E0.create(core, Lib), { use })).length === 0));
check('on it no crop has another thing, and no planting is given in parts', eng.crops().every(c => eng.thingsOf(c.id).length === 0) && core.plantings.every(p => eng.soldOf(p) === null));

// ── subjects, found on the plan: plantings that follow their crop's own line ──
const follows = (e, p) => { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null, v = e.variety(p.varietyId); return !!y && !y.own && y.set && y.units > 0 && !(r.rack && r.c.micro) && !(v && v.cropId === p.cropId && e.sellVRule(v.id).unit) && r.b.active !== false && r.g.active !== false; };
const info = new Map();
for (const p of core.plantings) {
  if (!follows(eng, p)) continue;
  const r = eng.calc(p), x = info.get(p.cropId) || { id: p.cropId, n: 0, envs: new Map() };
  x.n++; x.envs.set(eng.envOf(r.b), (x.envs.get(eng.envOf(r.b)) || 0) + 1); info.set(p.cropId, x);
}
const usable = [...info.values()].filter(x => { const c = eng.crop(x.id), hc = eng.harvestFor(x.id); return c && !c.micro && !eng.isCoverCrop(c) && hc.price.value > 0 && base.rows.some(r => r.cropId === x.id && r.total > 0); });
const placed = usable.filter(x => x.envs.size >= 2 && eng.COUNTED.includes(eng.unitOf(eng.crop(x.id)))).sort((a, b) => b.n - a.n)[0];
const bedded = usable.filter(x => x.envs.size === 1 && x.n >= 2 && eng.harvestFor(x.id).basis === 'ft' && (!placed || x.id !== placed.id)).sort((a, b) => b.n - a.n)[0];
const packed = usable.filter(x => x.n >= 1 && /^stems?$/.test(eng.unitOf(eng.crop(x.id))) && (!bedded || x.id !== bedded.id)).sort((a, b) => b.n - a.n)[0];
check('the farm has a subject for each kind: a counted crop in two places, a crop sown by the bed-foot in one, and a flower sold by the stem', !!placed && !!bedded && !!packed, { placed: placed && placed.id, bedded: bedded && bedded.id, packed: packed && packed.id });
const withThings = (cropId, things, more) => ({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, sell: { [cropId]: { things, ...(more || {}) } } } });
const partsOf = (e, cropId) => core.plantings.filter(p => p.cropId === cropId).map(p => { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null; return { p, r, y, parts: r ? e.soldOf(p, r, y) : null }; });
const rowsOf = (m, cropId) => m.rows.filter(r => r.cropId === cropId);
const others = (m, cropId) => differ({ ...m, rows: m.rows.filter(r => r.cropId !== cropId) }, { ...base, rows: base.rows.filter(r => r.cropId !== cropId) });

if (placed && bedded && packed) {
  // ── a different thing from one place ──
  {
    const id = placed.id, place = [...placed.envs.entries()].sort((a, b) => a[1] - b[1])[0][0], own = eng.unitOf(eng.crop(id));
    const thing = { id: 't-a', n: 1, name: 'By weight', from: 'place', place, unit: 'lb', price: 6, yield: 0.8, counted: own, weighs: 0.5 };
    const open = E.create(withThings(id, { 't-a': { ...thing, weighs: undefined } }), Lib), t0 = open.thingsOf(id)[0];
    check('a thing sold by weight from a counted crop waits on what one weighs, and until then counts for nothing: the forecast is the untouched one', t0.counts === false && t0.waits.join() === 'weighs' && differ(F.build(open), base).length === 0 && core.plantings.every(p => open.soldOf(p) === null), { waits: t0.waits });
    const e = E.create(withThings(id, { 't-a': thing }), Lib), m = F.build(e), list = partsOf(e, id);
    const there = list.filter(x => x.r && e.envOf(x.r.b) === place && follows(eng, x.p)), away = list.filter(x => x.r && e.envOf(x.r.b) !== place);
    check('complete, every planting in that place that follows the crop’s line is sold as the thing alone: what it is counted by × the yield × what one weighs × the share sold × the part of its harvest it has',
      there.length > 0 && there.every(x => x.parts && x.parts.length === 1 && x.parts[0].thing === 't-a' && x.parts[0].unit === 'lb' && x.parts[0].price === 6 && near(x.parts[0].units, x.y.count * 0.8 * 0.5 * x.y.mk * Math.min(1, x.r.harvestDays / Math.max(1, x.r.expectedHarvestDays)))), there.slice(0, 2).map(x => x.parts));
    check('a planting of the crop in another place is its own line, whole, and so is one that carries a yield of its own', away.length > 0 && away.every(x => x.parts === null) && list.filter(x => x.y && x.y.own).every(x => x.parts === null));
    const row = rowsOf(m, id).find(r => r.thing === 't-a'), first = rowsOf(m, id).filter(r => !r.thing);
    check('the forecast has a row for the thing, in its unit, named for the crop and the thing; the crop’s own row no longer holds those plantings; no other crop’s row moves',
      !!row && row.unit === 'lb' && row.sold === 'By weight' && row.name.endsWith(' · By weight') && row.key === `${id}|lb|t-a` && near(row.total, row.plantings.reduce((n, q) => n + q.inYear, 0)) && first.every(r => r.plantings.every(q => !there.some(x => x.p.id === q.p.id))) && others(m, id).length === 0, { row: row && row.key, others: others(m, id).slice(0, 3) });
    check('worth is the sum over things: each at its own price', near(worth(m), worth(base) - there.reduce((n, x) => n + rowsOf(base, id).reduce((k, r) => k + r.plantings.filter(q => q.p.id === x.p.id).reduce((j, q) => j + q.inYear * q.price, 0), 0), 0) + row.worth, 1e-7) && near(row.worth, row.total * 6));
    const two = E.create(withThings(id, { 't-a': thing, 't-b': { ...thing, id: 't-b', n: 2, name: 'Again' } }), Lib).thingsOf(id);
    check('two things cannot be sold from one place: the one added first stands, the other does not count and says why', two[0].counts === true && two[1].counts === false && two[1].why === 'taken');
  }
  // ── two things out of one bed ──
  {
    const id = bedded.id, thing = { id: 't-b', n: 1, name: 'Small ones', from: 'bed', unit: 'lb', price: 5, yield: 0.5, share: 30 };
    for (const lack of ['price', 'share', 'yield']) {
      const e = E.create(withThings(id, { 't-b': { ...thing, [lack]: undefined } }), Lib), t = e.thingsOf(id)[0];
      check(`with no ${lack} it does not count, and the crop is forecast exactly as before it was added`, t.counts === false && t.waits.join() === lack && differ(F.build(e), base).length === 0);
    }
    const e = E.create(withThings(id, { 't-b': thing }), Lib), m = F.build(e), list = partsOf(e, id).filter(x => x.r && follows(eng, x.p));
    check('complete, each bed gives the crop’s own line 70% of what it gave and the thing its yield on the other 30%, in its own unit',
      list.length >= 2 && list.every(x => x.parts && x.parts.length === 2 && x.parts[0].thing === null && near(x.parts[0].units, x.y.units * 0.7) && x.parts[0].unit === x.y.unit && x.parts[0].price === x.y.price
        && x.parts[1].thing === 't-b' && x.parts[1].unit === 'lb' && near(x.parts[1].units, x.y.count * 0.3 * 0.5 * x.y.mk * Math.min(1, x.r.harvestDays / Math.max(1, x.r.expectedHarvestDays)))), list.slice(0, 1).map(x => x.parts));
    const own = rowsOf(base, id).reduce((n, r) => n + r.plantings.filter(q => !follows(eng, q.p)).reduce((k, q) => k + q.inYear, 0), 0), firstNow = rowsOf(m, id).filter(r => !r.thing).reduce((n, r) => n + r.total, 0), firstWas = rowsOf(base, id).reduce((n, r) => n + r.total, 0);
    check('in the forecast the crop’s own row is 70% of what follows the line, with what does not follow it whole; no other crop’s row moves', near(firstNow, (firstWas - own) * 0.7 + own, 1e-7) && others(m, id).length === 0, { firstNow, firstWas, own });
    // its own way of picking
    const weekly = E.create(withThings(id, { 't-b': { ...thing, pattern: 'weekly', yield: 0.1 } }), Lib), w = partsOf(weekly, id).filter(x => x.parts);
    check('picked gradually, its yield is a week’s picking: 30% of what the bed is counted by × the yield × the days it is picked ÷ 7', w.length > 0 && w.every(x => near(x.parts[1].units, x.y.count * 0.3 * 0.1 * x.r.harvestDays / 7 * x.y.mk) && x.parts[1].pattern === 'weekly'));
    const short = E.create(withThings(id, { 't-b': { ...thing, days: 5, pattern: 'once' } }), Lib), ms = F.build(short), rs = rowsOf(ms, id).find(r => r.thing === 't-b');
    check('with harvest days of its own it is picked from the planting’s first picking for that many days and never after its last; cleared, all of it is counted that first day',
      !!rs && rs.plantings.length > 0 && rs.plantings.every(q => +q.from === +q.r.first && q.to <= q.r.last && Math.round((q.to - q.from) / 864e5) + 1 === Math.min(5, q.r.harvestDays) && q.out[0] > 0 && Array.from(q.out).slice(1).every(v => v === 0)), rs && rs.plantings.slice(0, 1).map(q => [E.d2s(q.from), E.d2s(q.to)]));
    check('a thing moves no date: every planting has the sowing, planting and picking days it had', core.plantings.every(p => { const a = eng.calc(p), b = short.calc(p); return !a === !b && (!a || (+a.first === +b.first && +a.last === +b.last && +(a.sow || 0) === +(b.sow || 0) && +a.field === +b.field && +eng.occupancyThrough(p, a) === +short.occupancyThrough(p, b))); }));
    const over = E.create(withThings(id, { 't-b': { ...thing, share: 70 }, 't-c': { ...thing, id: 't-c', n: 2, name: 'More', share: 40 } }), Lib).thingsOf(id);
    check('shares of each bed that come to more than 100 are not both counted: the one added first stands, the other says why', over[0].counts === true && over[1].counts === false && over[1].why === 'over');
  }
  // ── one harvest, packed two ways ──
  {
    const id = packed.id, own = eng.unitOf(eng.crop(id)), thing = { id: 't-c', n: 1, name: 'Bouquets', from: 'harvest', unit: 'bouquet', price: 12, share: 40, holds: 10, of: own };
    const open = E.create(withThings(id, { 't-c': { ...thing, holds: undefined, of: undefined } }), Lib);
    check('a thing packed from the harvest waits on what one of it holds, and until then counts for nothing', open.thingsOf(id)[0].waits.join() === 'holds' && differ(F.build(open), base).length === 0);
    const e = E.create(withThings(id, { 't-c': thing }), Lib), m = F.build(e), list = partsOf(e, id).filter(x => x.r && follows(eng, x.p));
    check('complete, each planting gives the thing 40% of its harvest ÷ what one holds, and the crop’s own line the other 60%, on the same days',
      list.length > 0 && list.every(x => x.parts && x.parts.length === 2 && near(x.parts[0].units, x.y.units * 0.6) && x.parts[1].thing === 't-c' && x.parts[1].unit === 'bouquet' && near(x.parts[1].units, x.y.units * 0.4 / 10) && x.parts[1].pattern === x.y.pattern && !x.parts[1].first), list.slice(0, 1).map(x => x.parts));
    const row = rowsOf(m, id).find(r => r.thing === 't-c'), first = rowsOf(m, id).find(r => !r.thing && r.unit === own);
    check('the forecast’s two rows are picked on the same days, and the thing’s is in its own unit and at its own price', !!row && !!first && row.plantings.length > 0 && row.plantings.every(q => { const o = first.plantings.find(k => k.p.id === q.p.id); return !!o && o.lo === q.lo && o.out.length === q.out.length && o.pattern === q.pattern; }) && near(row.worth, row.total * 12) && row.unit === 'bouquet' && others(m, id).length === 0);
    check('a bouquet is not a stem: it adds nothing to the count of stems, and a crop that sells two things is one crop', F.inStems(row) === false && F.inStems(first) === true && F.cropCount(m.rows) === F.cropCount(base.rows) && F.cropCount(base.rows) === base.rows.length
      && near(F.glance(m, 0, m.days - 1).stems, m.rows.filter(r => r.group === 'flower' && !r.thing).reduce((n, r) => n + F.sum(r.days, 0, m.days - 1), 0)));
    const stale = E.create(withThings(id, { 't-c': thing }, { unit: 'bunch' }), Lib), ts = stale.thingsOf(id)[0];
    check('a figure typed while the crop was sold by another unit is not read as one for this unit: the thing waits on it again', ts.counts === false && ts.waits.join() === 'holds');
    const byWeight = E.create(withThings(id, { 't-c': { ...thing, unit: 'lb', holds: undefined, weighs: 0.05 } }), Lib), bw = partsOf(byWeight, id).filter(x => x.parts);
    check('packed by weight from something counted, the figure is what one weighs: 40% of the harvest × that weight', byWeight.thingsOf(id)[0].way === 'weighs' && bw.length > 0 && bw.every(x => near(x.parts[1].units, x.y.units * 0.4 * 0.05)));
    // sized to a weekly amount of one thing
    const bed = SU.spaces(e, e.crop(id), SU.gardensFor(e, e.crop(id)).map(g => g.garden.id))[0], pace = bed ? SU.pace(e, { cropId: id, gardenIds: [bed.gardenId], from: `${base.year}-07-15`, thing: 't-c' }) : { error: 'no space' }, paceOwn = bed ? SU.pace(e, { cropId: id, gardenIds: [bed.gardenId], from: `${base.year}-07-15` }) : { error: 'no space' };
    check('“plan to a weekly amount” reads what a planting gives of the thing asked for, in that thing’s unit', !pace.error && !paceOwn.error && pace.unit === 'bouquet' && paceOwn.unit === own && pace.by === 'thing' && near(pace.per, paceOwn.per / 0.6 * 0.4 / 10, 1e-6), { pace: pace.error || [pace.unit, pace.per], own: paceOwn.error || [paceOwn.unit, paceOwn.per] });
  }
  // ── the build before, given a plan that holds things ──
  {
    const id = bedded.id, plan = withThings(id, { 't-b': { id: 't-b', n: 1, name: 'Small ones', from: 'bed', unit: 'lb', price: 5, yield: 0.5, share: 30 } }, { price: 4 }), was = F0.build(E0.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, sell: { [id]: { price: 4 } } } }, Lib));
    check('the build before forecasts such a plan as if the thing had not been added', differ(F0.build(E0.create(plan, Lib)), was).length === 0);
    const again = IO0.split(IO0.join(clone(plan), { v: 1, rest: {}, varieties: {} })).core, bare = clone(core); delete bare.assumptions;
    const carried = IO0.carry({ ...clone(plan), lrfNext: {} }, bare);
    check('and loses none of them: they are in the file it writes, and it carries them with the list onto a backup that has no list', JSON.stringify(again.assumptions) === JSON.stringify(plan.assumptions) && JSON.stringify(carried.plan.assumptions) === JSON.stringify(plan.assumptions));
    const here = IO.carry({ ...clone(plan), lrfNext: {} }, bare);
    check('this build carries them the same way, and names the list as carried', JSON.stringify(here.plan.assumptions) === JSON.stringify(plan.assumptions) && here.notes.some(n => /assumptions list/.test(n)), here.notes);
  }
}
finished = true;
