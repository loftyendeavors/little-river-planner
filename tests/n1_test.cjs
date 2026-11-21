'use strict';
/* N1, Starting and nursery: nothing moves with nothing typed, and each new figure moves only what it is typed for.
 *   1. The farm with nothing typed, worked out with this build's scripts and with the build before's, planting by planting: the
 *      sowing, potting-up, hardening-off and planting days; cells, trays, seed (counted and by weight), plants to buy, bulbs; the
 *      bench room each planting takes on every day it is on a bench; Seeds' order rows; Nursery's supplies and mix. No difference.
 *   2. The three figures N1 adds, each only where typed: a crop's own spare (crops[].spare), a variety's own seeds a cell
 *      (varieties[].spc), a cell of several seeds kept as one station (crops[].station). Each moves its own crop's (or variety's)
 *      cells or seed and nothing else, and no date.
 *   3. A plan holding them reads in the build before (it ignores them: its figures are its own without them), and comes back
 *      the same from a backup and from the compact plan.
 * Every subject is found on the plan given: a transplanted crop sown several seeds a cell, with varieties.
 * usage: node n1_test.cjs <app-dir> <plan.json> <dir of the build before's js>
 */
const path = require('path'), fs = require('fs');
const [app, planFile, OLD] = process.argv.slice(2);
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: f.detail })) }));
});
global.window = global;
const req = f => require(path.resolve(app, 'js', f));
const Lib = req('library.js'), Sow = req('sowing.js'); global.LRFSowing = Sow;
const E = req('engine.js'), IO = req('planio.js'), SL = req('seedlib.js'), N = req('nursery.js');
// the build before's scripts, each with the sowing rules it shipped with
const oldReq = f => { const file = path.resolve(OLD, f); delete require.cache[file]; return require(file); };
const Sow0 = oldReq('sowing.js'); global.LRFSowing = Sow0;
const E0 = oldReq('engine.js'), SL0 = oldReq('seedlib.js'), N0 = oldReq('nursery.js');
global.LRFSowing = Sow;
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core, year = +plan.settings.year;
const clone = x => JSON.parse(JSON.stringify(x));
const D = d => (d && !Number.isNaN(+d) ? E.d2s(d) : '');

/** What one planting needs in the nursery and on Seeds, as an engine reads it. */
function sig(e, p) {
  const r = e.calc(p);
  if (!r) return 'none';
  return [D(r.plannedSow), D(r.sow), D(e.potUpDate(r)), D(e.hardenStart(r)), D(r.field), r.cells, +(r.trays || 0).toFixed(9), r.seeds, +(r.seedG || 0).toFixed(6), r.buy || 0, r.bulbs || 0].join('|');
}
/** The bench room each planting takes, day by day, from the engine's own bench items. */
function bench(e) {
  const out = [];
  for (const it of e.benchItems()) {
    const days = [];
    for (let d = new Date(it.from); d < it.to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) { const u = it.kind === 'prop' ? e.propOf(it.r, d) : { kind: it.kind, eq: it.eq }; days.push(u ? `${u.kind}:${(+u.eq).toFixed(6)}` : '-'); }
    out.push(`${it.p.id}|${it.kind}|${D(it.from)}|${D(it.to)}|${days.join(',')}`);
  }
  return out.sort();
}
const orders = (e, sl) => sl.required(e, { year }).rows.map(r => [r.key, r.unit, +(+r.total).toFixed(6), +(+r.toSow).toFixed(6)].join('|')).sort();
const supplies = (e, n) => { const s = n.supplies(e, year, (e.plan.lrfNext || {}).supplies || null); return [...s.rows.map(r => [r.id, r.need, r.buy, r.mixCuFt == null ? '' : (+r.mixCuFt).toFixed(6)].join('|')), `mix|${(+s.mix.need).toFixed(6)}|${s.mix.bags}`].sort(); };
const differ = (a, b) => { const out = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push([a[i], b[i]]); return out; };

// ── 1. nothing typed: every figure is the build before's ──
const now = E.create(plan, Lib), was = E0.create(plan, Lib);
const plantings = plan.plantings.filter(p => now.calc(p));
check('the plan has plantings sown in trays, potted up, in towers, live trays and bought in', plantings.some(p => now.calc(p).sowing) && plantings.some(p => now.calc(p).c.prop === 'potup') && plantings.some(p => now.calc(p).tw) && plantings.some(p => now.calc(p).rack) && plantings.some(p => now.calc(p).boughtIn), null);
const moved = plantings.filter(p => sig(now, p) !== sig(was, p));
check(`nothing typed: every planting's sowing, potting-up, hardening and planting days, cells, trays, seed, plants and bulbs are the build before's (${plantings.length} plantings)`, plantings.length > 600 && !moved.length, moved.slice(0, 3).map(p => [p.id, sig(was, p), sig(now, p)]));
const b1 = bench(now), b0 = bench(was);
check(`nothing typed: the bench room of every planting, day by day, is the build before's (${b1.length} spans)`, b1.length > 100 && !differ(b0, b1).length, differ(b0, b1).slice(0, 2));
const o1 = orders(now, SL), o0 = orders(was, SL0);
check(`nothing typed: Seeds' order rows are the build before's (${o1.length} rows)`, o1.length > 50 && !differ(o0, o1).length, differ(o0, o1).slice(0, 3));
const s1 = supplies(now, N), s0 = supplies(was, N0);
check(`nothing typed: Nursery's supplies and mix are the build before's (${s1.length} rows)`, s1.length > 4 && !differ(s0, s1).length, differ(s0, s1).slice(0, 3));

// ── 1b. the same on plans with figures typed in their old homes, and with the farm's own figures absent or zero ──
// The made-up farm has nothing typed on its crops' nursery figures, so a build that stopped reading one would pass part 1. These
// plans type them: crops (germination, tray, seeds a cell, nursery weeks, potting up, pot size, pots a carrier, days in rockwool),
// varieties (germination, nursery days that differ in the field and under cover), the farm's germination and spare, Supplies'
// pots a carrier; then the farm with no germination or spare set at all; then a spare of 0.
const D2 = d => (d && !Number.isNaN(+d) ? E.d2s(d) : '');
function full(e, sl, n) {
  const rows = [];
  for (const p of e.plan.plantings) { const r = e.calc(p); rows.push(p.id + '|' + (!r ? 'none' : JSON.stringify([D2(r.plannedSow), D2(r.sow), D2(e.potUpDate(r)), D2(e.hardenStart(r)), D2(r.field), r.cells, r.trays, r.seeds, r.seedG, r.buy, r.bulbs, r.plants, r.sowing ? [r.sowing.cells, r.sowing.seeds, r.sowing.trays, r.sowing.potUpCells, r.sowing.expectedPlants, r.sowing.buffer, r.sowing.germination] : null]))); }
  const req = sl.required(e, { year }), date = (k, v) => (v instanceof Date ? D2(v) : v);
  return { rows, bench: bench(e), orders: req.rows.map(r => JSON.stringify(r, date)).sort(), supplies: JSON.stringify(n.supplies(e, year, (e.plan.lrfNext || {}).supplies || null), date) };
}
{
  const used = new Set(plan.plantings.map(p => p.cropId)), libTP = Lib.crops.filter(c => c.method === 'TP' && !c.micro && used.has(c.id) && c.gh > 0).map(c => c.id);
  const typed = clone(plan), own = (id, o) => { const r = (typed.crops = typed.crops || []).find(c => c.id === id); if (r) Object.assign(r, o); else typed.crops.push({ id, ...o }); };
  const figs = [{ germ: 70, tray: 128, spc: 4, gh: 5 }, { prop: 'potup', potUpWk: 3, potSize: 4, perCarrier: 15 }, { germ: 92, gh: 3.5, rockwoolDays: 18 }, { gh: 8, spc: 3 }, { tray: 50, spc: 2 }];
  libTP.slice(0, figs.length).forEach((id, i) => own(id, figs[i]));
  typed.settings = { ...typed.settings, germ: 80, buffer: 15 };
  typed.varieties.forEach((v, i) => { if (i % 3) return; v.germ = 75 + (i % 20); v.gh = 4.5; v.environmentDefaults = { v: 1, field: { gh: 4.5 }, greenhouse: { gh: 6 } }; });
  typed.lrfNext = { ...(typed.lrfNext || {}), supplies: { pockets: 15 } };
  const bare = clone(plan); delete bare.settings.germ; delete bare.settings.buffer;
  const zero = clone(plan); zero.settings.buffer = 0;
  for (const [name, pl] of [['figures typed in their old homes', typed], ['no farm germination or spare set', bare], ['a farm spare of 0', zero]]) {
    const a = full(E0.create(pl, Lib), SL0, N0), b = full(E.create(pl, Lib), SL, N);
    const bad = ['rows', 'bench', 'orders'].map(k => [k, differ(a[k], b[k])]).filter(x => x[1].length);
    if (a.supplies !== b.supplies) bad.push(['supplies', 1]);
    check(`${name}: every planting's days, cells, trays, seed, plants to buy, its sowing, its bench room day by day, Seeds' orders and Nursery's supplies are the build before's (${a.rows.length} plantings, ${a.bench.length} bench spans)`,
      libTP.length >= figs.length && a.rows.length > 600 && !bad.length, bad.map(x => [x[0], Array.isArray(x[1]) ? x[1].slice(0, 2) : x[1]]));
  }
}

// ── 2. each new figure moves only where it is typed ──
// (one with no tower plantings: rockwool sheets are shared between crops sown the same day, so a tower crop's cells move others' share of a sheet)
const scallion = now.crops().find(c => c.method === 'TP' && +c.spc > 1 && !c.micro && now.varietiesOf(c.id).length > 1 && plantings.filter(p => p.cropId === c.id && now.calc(p).sowing).length > 1 && !plantings.some(p => p.cropId === c.id && now.calc(p).tw));
check('the plan has a transplanted crop sown several seeds a cell, with varieties and sowings', !!scallion, null);
if (!scallion) { finished = true; process.exit(0); }
const withCrop = change => { const p2 = clone(plan), own = (p2.crops || []).find(c => c.id === scallion.id); if (own) Object.assign(own, change); else (p2.crops = p2.crops || []).push({ id: scallion.id, ...change }); return p2; };
const only = (e2, mine, fields) => {
  const wrong = [], mineMoved = [];
  for (const p of plantings) {
    const a = now.calc(p), b = e2.calc(e2.planting(p.id)), A = sig(now, p).split('|'), B = sig(e2, e2.planting(p.id)).split('|');
    if (!mine(p, a)) { if (A.join('|') !== B.join('|')) wrong.push([p.id, A.join('|'), B.join('|')]); continue; }
    if (A.slice(0, 5).join('|') !== B.slice(0, 5).join('|')) wrong.push([p.id, 'a date moved']);
    if (fields.some(i => A[i] !== B[i])) mineMoved.push(p.id);
    void b;
  }
  return { wrong, mineMoved };
};
// spare: more cells for its own sowings, nothing else
{
  const e2 = E.create(withCrop({ spare: 40 }), Lib), r = only(e2, (p, a) => p.cropId === scallion.id && !!a.sowing, [5, 7]);
  check(`a crop's own spare (${scallion.name}, 40%) moves its cells and seed, no date, and nothing of any other crop`, r.mineMoved.length > 0 && !r.wrong.length, r.wrong.slice(0, 3));
}
// spare on plants bought in: more plants to buy, for that crop only
{
  const bought = plantings.find(p => now.calc(p).boughtIn && now.calc(p).buy > 0), id = bought && bought.cropId;
  const p2 = clone(plan), own = id && (p2.crops || []).find(c => c.id === id);
  if (own) own.spare = 40; else if (id) (p2.crops = p2.crops || []).push({ id, spare: 40 });
  const e2 = E.create(p2, Lib), more = id ? plantings.filter(p => p.cropId === id && now.calc(p).boughtIn).every(p => e2.calc(e2.planting(p.id)).buy > now.calc(p).buy) : false;
  const rest = plantings.filter(p => p.cropId !== id).every(p => sig(e2, e2.planting(p.id)) === sig(now, p));
  check('a crop bought in with its own spare (40%) buys more plants, and nothing of any other crop moves', !!bought && more && rest, id);
}
// station: no cells over for germination; seed is the cells times the seeds a cell
{
  const e2 = E.create(withCrop({ station: true }), Lib), r = only(e2, (p, a) => p.cropId === scallion.id && !!a.sowing, [5, 7]);
  const p = plantings.find(q => q.cropId === scallion.id && now.calc(q).sowing && now.calc(q).sowing.cells > 50), s = e2.calc(e2.planting(p.id)).sowing;
  check(`one station a cell (${scallion.name}) sows the buffered plants in whole rows, no cells over for germination, and moves nothing else`, r.mineMoved.length > 0 && !r.wrong.length && s.station === true && s.minimumCells === s.bufferedPlants && s.cells < now.calc(p).sowing.cells,
    { wrong: r.wrong.slice(0, 3), s: s && [s.minimumCells, s.bufferedPlants, s.cells, now.calc(p).sowing.cells] });
  const e3 = E.create(withCrop({ station: true, spc: 1 }), Lib), r3 = only(e3, (q, a) => q.cropId === scallion.id && !!a.sowing, [5, 6, 7]);
  check('one station a cell does nothing where a cell holds one seed', !(e3.calc(e3.planting(p.id)).sowing || {}).station && r3.wrong.every(w => w[1] !== 'a date moved'), null);
}
// a variety's seeds a cell: that variety's seed only
{
  const v = now.varietiesOf(scallion.id).find(x => plantings.some(p => p.varietyId === x.id && now.calc(p).sowing));
  const p2 = clone(plan), rec = p2.varieties.find(x => x.id === v.id); rec.spc = 6;
  // (its sowings now stand in trays of their own: the crop's other varieties sown the same day keep their cells and seed, and their
  // share of the trays they shared is worked out again, which is said on the card before the figure is taken)
  const e2 = E.create(p2, Lib), r0 = only(e2, p => p.varietyId === v.id, [7]);
  const r = { mineMoved: r0.mineMoved, wrong: r0.wrong.filter(w => { const q = plan.plantings.find(x => x.id === w[0]); if (!q || q.cropId !== scallion.id || w[1] === 'a date moved') return true; const A = w[1].split('|'), B = w[2].split('|'); return A.some((x, i) => i !== 6 && x !== B[i]); }) };
  const cellsSame = plantings.filter(p => p.varietyId === v.id).every(p => now.calc(p).cells === e2.calc(e2.planting(p.id)).cells);
  check(`a variety's own seeds a cell (${v.name}, 6) moves its own seed only: no cell, no date, nothing of another variety`, r.mineMoved.length > 0 && !r.wrong.length && cellsSame, r.wrong.slice(0, 3));
}
// ── 3. the build before reads such a plan, and it comes back the same from a file ──
{
  const typed = withCrop({ spare: 40, station: true }), v = now.varietiesOf(scallion.id)[0];
  typed.varieties.find(x => x.id === v.id).spc = 6;
  typed.assumptions = { ...(typed.assumptions || { v: 1, crops: {}, varieties: {} }), nursery: { [scallion.id]: { looked: year } } };
  let e0;
  try { e0 = E0.create(typed, Lib); } catch (error) { e0 = null; }
  const same = !!e0 && plantings.every(p => sig(e0, e0.planting(p.id)) === sig(was, p));
  check('the build before reads a plan holding the new figures, and works it out as it would without them', same, null);
  const back = IO.split(JSON.parse(JSON.stringify(IO.join ? IO.join(typed, {}) : typed))).core, packed = IO.unpack(JSON.parse(JSON.stringify(IO.pack(typed))));
  for (const [form, pl] of [['a backup', back], ['the compact plan', packed]]) {
    const c = (pl.crops || []).find(x => x.id === scallion.id) || {}, vv = (pl.varieties || []).find(x => x.id === v.id) || {};
    check(`the new figures come back from ${form}: a crop's spare and station, a variety's seeds a cell, the tick`, c.spare === 40 && c.station === true && vv.spc === 6 && ((pl.assumptions || {}).nursery || {})[scallion.id] && pl.assumptions.nursery[scallion.id].looked === year, { c: [c.spare, c.station], v: vv.spc });
  }
}
// ── 3b. a replacement backup with no list keeps the ticks and the figures typed here (planio.js carry) ──
{
  const id = scallion.id, v = now.varietiesOf(id)[0], prev = clone(plan), bare = clone(plan);
  delete bare.assumptions; delete prev.assumptions;
  prev.assumptions = { v: 1, crops: {}, varieties: {}, nursery: { [id]: { looked: year } } };
  // a crop's spare and a variety's seeds a cell typed here: noted beside the plan as the app notes every such change (IO.note)
  const cBefore = (prev.crops || []).find(c => c.id === id) || null, cAfter = { ...(cBefore || { id }), spare: 25 }, vAfter = { ...v, spc: 5 };
  let facts = IO.note(null, 'crops', cBefore, cAfter, !cBefore && Lib.crops.some(c => c.id === id));
  facts = IO.note(facts, 'varieties', v, vAfter, false);
  prev.crops = [...(prev.crops || []).filter(c => c.id !== id), cAfter]; prev.varieties = prev.varieties.map(x => x.id === v.id ? vAfter : x);
  prev.lrfNext = { ...(prev.lrfNext || {}), facts };
  const out = IO.carry(prev, bare), pl = out.plan, c2 = (pl.crops || []).find(c => c.id === id) || {}, v2 = (pl.varieties || []).find(x => x.id === v.id) || {};
  check('a backup with no list, loaded over a plan whose list holds only Starting and nursery ticks, keeps the ticks', ((pl.assumptions || {}).nursery || {})[id] && pl.assumptions.nursery[id].looked === year, (pl.assumptions || null));
  check('it keeps the crop\'s spare and the variety\'s seeds a cell typed here, as every change to a crop or variety is kept', c2.spare === 25 && v2.spc === 5, { spare: c2.spare, spc: v2.spc });
}
// ── 5. Started as is one choice: two devices that choose differently are joined to one of the two, never half of each ──
{
  const M = req('merge.js'), id = scallion.id, start = clone(plan), mine = clone(plan), theirs = clone(plan);
  const set = (pl, o) => { const r = (pl.crops = pl.crops || []).find(c => c.id === id); if (r) Object.assign(r, o); else pl.crops.push({ id, ...o }); };
  set(start, { method: 'TP', plantingMaterial: 'seed' }); set(mine, { method: 'TP', plantingMaterial: 'seed', prop: 'pot' }); set(theirs, { method: 'DS', plantingMaterial: 'seed' });
  const out = M.merge(start, mine, theirs), c = out.ok ? (out.plan.crops || []).find(x => x.id === id) : null;
  const way = c && [c.method, c.prop || null, c.plantingMaterial].join('|'), ok = ['TP|pot|seed', 'DS||seed'].includes(way);
  check('two devices choosing Started as differently (Pot here, Direct there) are joined to one of the two choices whole', ok, way);
}
finished = true;
