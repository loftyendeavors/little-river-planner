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
// held to the build before, the plantings the frost cuts (E2c) are held at their last day, which it knows no other way (tests/frost_held.cjs)
const Held = require('./frost_held.cjs'), hold = plan => Held.held(E, Lib, plan, E0.create(plan, Lib)), now = plan => F.build(E.create(hold(plan), Lib)), nowUse = (plan, use) => F.build(E.create(hold(plan), Lib), { use });
// the build before may itself know of things (any build after the one that brought them in): what it is held to then differs
const KNEW = typeof E0.create(core, Lib).thingsOf === 'function';

// ── a plan nobody has touched ──
check('a plan with no second thing is forecast exactly as the build before forecast it: every row, every total, every day', differ(now(core), old).length === 0, differ(now(core), old).slice(0, 4));
check('and the same for what is grown to sell alone, and for what is kept for personal use alone', ['commercial', 'personal'].every(use => differ(nowUse(core, use), F0.build(E0.create(core, Lib), { use })).length === 0));
check('on it no crop has another thing, and no planting is given in parts', eng.crops().every(c => eng.thingsOf(c.id).length === 0) && core.plantings.every(p => eng.soldOf(p) === null));

// ── subjects, found on the plan: plantings that follow their crop's own line ──
const follows = (e, p) => { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null, v = e.variety(p.varietyId); return !!y && !y.own && y.set && y.units > 0 && !(r.rack && r.c.micro) && !(v && v.cropId === p.cropId && e.sellVRule(v.id).unit) && r.b.active !== false && r.g.active !== false; };
const info = new Map();
for (const p of core.plantings) {
  const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null, x = info.get(p.cropId) || { id: p.cropId, n: 0, envs: new Map(), own: 0, least: Infinity, soil: true };
  info.set(p.cropId, x);
  if (y && y.own && !(r.rack && r.c.micro)) x.own++;                       // carries a yield of its own: no thing reaches it
  if (!follows(eng, p)) continue;
  x.n++; x.envs.set(eng.envOf(r.b), (x.envs.get(eng.envOf(r.b)) || 0) + 1); x.least = Math.min(x.least, r.harvestDays); if (!eng.isSoilBed(r.b)) x.soil = false;
}
const usable = [...info.values()].filter(x => x.n > 0).filter(x => { const c = eng.crop(x.id), hc = eng.harvestFor(x.id); return c && !c.micro && !eng.isCoverCrop(c) && hc.price.value > 0 && base.rows.some(r => r.cropId === x.id && r.total > 0); });
const placed = usable.filter(x => x.envs.size >= 2 && eng.COUNTED.includes(eng.unitOf(eng.crop(x.id)))).sort((a, b) => b.n - a.n)[0];
// in soil beds, picked for ten days or more (so that harvest days of its own are fewer), with a planting that carries its own yield
const bedded = usable.filter(x => x.envs.size === 1 && x.n >= 2 && x.soil && x.least >= 10 && x.own >= 1 && eng.harvestFor(x.id).basis === 'ft' && (!placed || x.id !== placed.id)).sort((a, b) => b.n - a.n)[0];
const packed = usable.filter(x => x.n >= 1 && /^stems?$/.test(eng.unitOf(eng.crop(x.id))) && (!bedded || x.id !== bedded.id)).sort((a, b) => b.n - a.n)[0];
check('the farm has a subject for each kind: a counted crop in two places; a crop sown by the bed-foot in soil beds, picked for ten days or more, one of whose plantings carries a yield of its own; and a flower sold by the stem', !!placed && !!bedded && !!packed, { placed: placed && placed.id, bedded: bedded && bedded.id, packed: packed && packed.id });
const withThings = (cropId, things, more, plan) => ({ ...(plan || core), assumptions: { v: 1, crops: {}, varieties: {}, sell: { [cropId]: { things, ...(more || {}) } } } });
/** The farm with one planting of a crop that follows its line picked for half its days: its harvest is given an end. Made here; the farm as shipped has none cut short. */
const cutShort = (cropId, env) => {
  const p = core.plantings.find(q => { if (q.cropId !== cropId || !follows(eng, q)) return false; const r = eng.calc(q); return r.harvestDays >= 6 && r.harvestDays === r.expectedHarvestDays && !q.harvestEnd && (!env || eng.envOf(r.b) === env); });
  if (!p) return null;
  const r = eng.calc(p), end = E.d2s(E.addDays(r.first, Math.floor(r.harvestDays / 2) - 1));
  return { id: p.id, plan: { ...core, plantings: core.plantings.map(q => q.id === p.id ? { ...q, harvestEnd: end } : q) } };
};
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
    const cut = cutShort(id, place), ec = cut ? E.create(withThings(id, { 't-a': thing }, null, cut.plan), Lib) : null, pc = cut ? ec.planting(cut.id) : null, rc = cut ? ec.calc(pc) : null, yc = cut ? ec.yieldOf(pc, rc) : null, sc = cut ? ec.soldOf(pc, rc, yc) : null;
    check('a planting whose harvest is cut short gives the thing only the part of its harvest it has: picked for half its days, a total is halved',
      !!sc && rc.harvestDays < rc.expectedHarvestDays && sc.length === 1 && near(sc[0].units, yc.count * 0.8 * 0.5 * yc.mk * rc.harvestDays / rc.expectedHarvestDays) && sc[0].units < yc.count * 0.8 * 0.5 * yc.mk * 0.7, sc && { days: [rc.harvestDays, rc.expectedHarvestDays], units: sc[0].units });
    // a planting of a variety sold by a unit of its own is counted as that variety is sold, whole
    const withV = there.find(x => { const v = eng.variety(x.p.varietyId); return v && v.cropId === id; }), planV = withV ? { ...withThings(id, { 't-a': thing }) } : null;
    if (planV) planV.assumptions.sellV = { [withV.p.varietyId]: { unit: 'bunch' } };
    const ev = planV ? E.create(planV, Lib) : null;
    check('a planting of a variety sold by a unit of its own is not given in parts: it is counted as that variety is sold, whole', !!ev && core.plantings.filter(q => q.varietyId === withV.p.varietyId).every(q => ev.soldOf(q) === null) && ev.yieldOf(ev.planting(withV.p.id)).unit === 'bunch', withV ? withV.p.varietyId : 'no planting there has a variety');
    // read as one figure, for what compares a planting with itself
    const g = e.givenOf(there[0].p), plain = e.givenOf(away[0].p), panel = there[0].parts[0];
    check('read as one figure, a planting that feeds a thing gives the thing’s amount, unit and price, and one that does not gives what it always gave', near(g.units, panel.units) && g.unit === 'lb' && near(g.price, 6) && g.parts.length === 1 && plain.units === away[0].y.units && plain.unit === away[0].y.unit && !plain.parts, { g: [g.units, g.unit, g.price] });
    // the crop's own weekly amount where everything is sold as the thing
    const bedThere = core.beds.find(b => b.id === there[0].p.bedId), asked = SU.pace(e, { cropId: id, place: 'beds', bedIds: [bedThere.id], from: `${base.year}-07-15` }), elsewhere = SU.pace(e, { cropId: id, place: 'beds', bedIds: [away[0].p.bedId], from: `${base.year}-07-15` });
    check('“plan to a weekly amount” of the crop itself, in a place whose plantings are all sold as the thing, says so and names the thing; in another place it is worked out as before', typeof asked.error === 'string' && asked.error.includes('By weight') && /is sold as/.test(asked.error) && !elsewhere.error && elsewhere.unit === own, { asked: asked.error || asked.unit, elsewhere: elsewhere.error || elsewhere.unit });
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
    const e = E.create(withThings(id, { 't-b': thing }), Lib), m = F.build(e), list = partsOf(e, id).filter(x => x.r && follows(eng, x.p)), apart = partsOf(e, id).filter(x => x.y && x.y.own);
    check('a planting that carries a yield of its own is not shared out: it is the crop’s own line, whole', apart.length >= 1 && apart.every(x => x.parts === null), apart.length);
    check('complete, each bed gives the crop’s own line 70% of what it gave and the thing its yield on the other 30%, in its own unit',
      list.length >= 2 && list.every(x => x.parts && x.parts.length === 2 && x.parts[0].thing === null && near(x.parts[0].units, x.y.units * 0.7) && x.parts[0].unit === x.y.unit && x.parts[0].price === x.y.price
        && x.parts[1].thing === 't-b' && x.parts[1].unit === 'lb' && near(x.parts[1].units, x.y.count * 0.3 * 0.5 * x.y.mk * Math.min(1, x.r.harvestDays / Math.max(1, x.r.expectedHarvestDays)))), list.slice(0, 1).map(x => x.parts));
    const own = rowsOf(base, id).reduce((n, r) => n + r.plantings.filter(q => !follows(eng, q.p)).reduce((k, q) => k + q.inYear, 0), 0), firstNow = rowsOf(m, id).filter(r => !r.thing).reduce((n, r) => n + r.total, 0), firstWas = rowsOf(base, id).reduce((n, r) => n + r.total, 0);
    check('in the forecast the crop’s own row is 70% of what follows the line, with what does not follow it whole; no other crop’s row moves', near(firstNow, (firstWas - own) * 0.7 + own, 1e-7) && others(m, id).length === 0, { firstNow, firstWas, own });
    // a planting says which of the two it is grown for
    {
      const plan = withThings(id, { 't-b': thing }), pick = list[0].p.id, beside = list[1].p.id;
      const say = g => { const q = clone(plan); q.plantings.find(x => x.id === pick).gives = g; return E.create(q, Lib); };
      const read = (en, pid) => { const q = en.planting(pid), r = en.calc(q), y = en.yieldOf(q, r); return { r, y, parts: en.soldOf(q, r, y) }; };
      const first = read(say('first'), pick), only = read(say('t-b'), pick), stray = read(say('t-gone'), pick), nextTo = read(say('t-b'), beside);
      check('a planting said to be for the crop’s own line alone gives the whole of it, as if the thing had never been added', first.parts === null && near(first.y.units, list[0].y.units) && first.y.unit === list[0].y.unit);
      check('a planting said to be for the thing alone gives the thing on the whole of it, in its unit and at its price, and none of the crop’s own line', !!only.parts && only.parts.length === 1 && only.parts[0].thing === 't-b' && only.parts[0].unit === 'lb' && only.parts[0].price === 5 && near(only.parts[0].units, list[0].parts[1].units / 0.3), only.parts);
      check('the planting beside it, told nothing, still gives both by the crop’s shares', !!nextTo.parts && nextTo.parts.length === 2 && near(nextTo.parts[0].units, list[1].parts[0].units) && near(nextTo.parts[1].units, list[1].parts[1].units));
      check('a word that names no thing in force is read as nothing said', !!stray.parts && stray.parts.length === 2 && near(stray.parts[0].units, list[0].parts[0].units) && near(stray.parts[1].units, list[0].parts[1].units));
      check('saying it moves no date: the first and last picking are the ones the planting had', [first, only].every(x => +x.r.first === +list[0].r.first && +x.r.last === +list[0].r.last && x.r.harvestDays === list[0].r.harvestDays));
      const mo = F.build(say('t-b')), mf = F.build(say('first'));
      check('in the forecast only that crop’s rows move, either way', others(mo, id).length === 0 && others(mf, id).length === 0 && differ(mo, m).length > 0 && differ(mf, m).length > 0);
      const q = clone(plan); q.plantings.find(x => x.id === pick).gives = 't-b';
      check('the build before forecasts a plan that holds such a word as if it were not there; or, where it reads the word itself, exactly as this build does', [F0.build(E0.create(plan, Lib)), now(q)].some(x => differ(F0.build(E0.create(q, Lib)), x).length === 0));
    }
    // its own way of picking
    const weekly = E.create(withThings(id, { 't-b': { ...thing, pattern: 'weekly', yield: 0.1 } }), Lib), w = partsOf(weekly, id).filter(x => x.parts);
    check('picked gradually, its yield is a week’s picking: 30% of what the bed is counted by × the yield × the days it is picked ÷ 7', w.length > 0 && w.every(x => near(x.parts[1].units, x.y.count * 0.3 * 0.1 * x.r.harvestDays / 7 * x.y.mk) && x.parts[1].pattern === 'weekly'));
    const short = E.create(withThings(id, { 't-b': { ...thing, days: 5, pattern: 'once' } }), Lib), ms = F.build(short), rs = rowsOf(ms, id).find(r => r.thing === 't-b');
    check('with harvest days of its own it is picked from the planting’s first picking for that many days and never after its last; cleared, all of it is counted that first day',
      !!rs && rs.plantings.length > 0 && rs.plantings.every(q => +q.from === +q.r.first && q.to <= q.r.last && Math.round((q.to - q.from) / 864e5) + 1 === Math.min(5, q.r.harvestDays) && q.out[0] > 0 && Array.from(q.out).slice(1).every(v => v === 0)), rs && rs.plantings.slice(0, 1).map(q => [E.d2s(q.from), E.d2s(q.to)]));
    const ps = partsOf(short, id).filter(x => x.parts);
    check('harvest days of its own that the planting has in full leave its total whole: 30% of what the bed is counted by × the yield × the share sold, not that over the crop’s own days', ps.length >= 2 && ps.every(x => x.r.harvestDays >= 5 && near(x.parts[1].units, x.y.count * 0.3 * 0.5 * x.y.mk)), ps.slice(0, 1).map(x => [x.parts[1].units, x.y.count * 0.3 * 0.5 * x.y.mk]));
    const kept = E.create(withThings(id, { 't-b': thing }, { keep: 2 }), Lib), mk = F.build(kept), rk = rowsOf(mk, id).find(r => r.thing === 't-b'), fk = rowsOf(mk, id).find(r => !r.thing);
    check('a thing keeps as its crop keeps: with the crop kept two weeks, what is picked of the thing is there to sell over those two weeks too', !!rk && !!fk && rk.keeps === 2 && fk.keeps === 2 && rk.plantings.length > 0 && rk.plantings.every(q => q.keep === 2 && Array.from(q.avail).filter(v => v > 0).length > Array.from(q.out).filter(v => v > 0).length) && !Array.from(rk.days).every((v, i) => near(v, rk.picked[i])), rk && { keeps: rk.keeps });
    const all100 = E.create(withThings(id, { 't-b': { ...thing, share: 100 } }), Lib), m100 = F.build(all100);
    check('a crop’s own line that the other thing leaves nothing of is not told as a yield that works out to nothing', m100.unset.length === base.unset.length && rowsOf(m100, id).filter(r => !r.thing).every(r => r.unset === (rowsOf(base, id).find(o => o.key === r.key) || {}).unset) && rowsOf(m100, id).some(r => r.thing === 't-b' && r.total > 0), { unset: [m100.unset.length, base.unset.length] });
    const cut = cutShort(id), ec = cut ? E.create(withThings(id, { 't-b': thing }, null, cut.plan), Lib) : null, pc = cut ? ec.planting(cut.id) : null, rc = cut ? ec.calc(pc) : null, yc = cut ? ec.yieldOf(pc, rc) : null, sc = cut ? ec.soldOf(pc, rc, yc) : null;
    check('a bed whose harvest is cut short gives the thing its share of the part of its harvest it has, and no more', !!sc && rc.harvestDays < rc.expectedHarvestDays && near(sc[1].units, yc.count * 0.3 * 0.5 * yc.mk * rc.harvestDays / rc.expectedHarvestDays) && sc[1].units < yc.count * 0.3 * 0.5 * yc.mk * 0.7 && near(sc[0].units, yc.units * 0.7), sc && { days: [rc.harvestDays, rc.expectedHarvestDays] });
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
    const part = list[0].parts[1];
    check('what is packed says how: the crop’s own yield in the crop’s own unit, the share, and how many to one', !!part.packed && part.packed.of === own && part.packed.share === 40 && part.packed.way === 'holds' && part.packed.n === 10 && near(part.per, list[0].y.per), part.packed);
    // a crop that is no flower by its name, sold by the stem: its bouquets are listed where the crop is
    const plain = bedded.id, stems = E.create(withThings(plain, { 't-c': { ...thing, of: 'stem' } }, { unit: 'stem' }), Lib), mst = F.build(stems), rs2 = rowsOf(mst, plain);
    check('a thing’s row is listed with its crop: bouquets of a crop sold by the stem stand among the flowers with it, whatever the crop is called', rs2.some(r => r.thing === 't-c') && rs2.every(r => r.group === 'flower') && F.groupOf(stems.crop(plain), 'bouquet', null) === 'produce', rs2.map(r => [r.name, r.unit, r.group]));
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
    check('the build before forecasts such a plan as if the thing had not been added; or, where it knows things itself, exactly as this build does', differ(F0.build(E0.create(plan, Lib)), KNEW ? now(plan) : was).length === 0);
    const again = IO0.split(IO0.join(clone(plan), { v: 1, rest: {}, varieties: {} })).core, bare = clone(core); delete bare.assumptions;
    const carried = IO0.carry({ ...clone(plan), lrfNext: {} }, bare);
    check('and loses none of them: they are in the file it writes, and it carries them with the list onto a backup that has no list', JSON.stringify(again.assumptions) === JSON.stringify(plan.assumptions) && JSON.stringify(carried.plan.assumptions) === JSON.stringify(plan.assumptions));
    const here = IO.carry({ ...clone(plan), lrfNext: {} }, bare);
    check('this build carries them the same way, and names the list as carried', JSON.stringify(here.plan.assumptions) === JSON.stringify(plan.assumptions) && here.notes.some(n => /assumptions list/.test(n)), here.notes);
  }
}
finished = true;
