'use strict';
/* N2, what it leaves as it was: a crop bought in only by the library's word (raspberry, blackberry: plantingMaterial 'plant') that
 * a planting has given weeks in the nursery, or a sowing day set by hand, is raised as before N2. Its sowing day, trays, hardening
 * off, room on a bench and nursery work on Tasks are the build before's, and Seeds counts it in plants as the build before did.
 * Neither a crop record in the plan nor a planting's own record of its crop is the grower's choice where it only repeats the
 * library's word: editing a crop's timing writes one. What is his choice: the planting's own Seed | Bought in, and a crop set to
 * bought-in plants where the library sows it (js/engine.js boughtInOf). Each case is read again after the plan is saved as a
 * backup and as the compact plan the app keeps, and must read the same.
 *   1. a planting's own record of its crop with nursery weeks, no crop record in the plan
 *   2. a crop record in the plan with nursery weeks, which repeats the library's word
 *   3. a sowing day set by hand on (1)
 *   4. (1), said bought in on the planting itself: bought in
 *   5. the library's crop with no nursery weeks: bought in, as N2 has it (nothing in the nursery to lose)
 *   6. a crop the library sows, set to bought-in plants in the plan, with nursery weeks: bought in (the grower's choice)
 * Every subject is found on the plan given: nothing here names a bed, a variety or a date of any plan but the year's.
 * usage: node bought_kept.cjs <app-dir> <plan.json> <dir of the build before's js>
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
const Lib = req('library.js'), E = req('engine.js'), IO = req('planio.js'), SL = req('seedlib.js'), W = req('week.js');
const old = f => require(path.resolve(OLD, f));
const E0 = old('engine.js'), SL0 = old('seedlib.js'), W0 = old('week.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core, year = +plan.settings.year;
const clone = x => JSON.parse(JSON.stringify(x));
const D = d => (d && !Number.isNaN(+d) ? E.d2s(d) : null);
const libCrop = id => (Lib.crops || []).find(c => c.id === id);
const said = c => (c && (c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed'))) || 'seed';
const crops = pl => pl.crops || [];

// ── subjects: a planting of a library crop bought in as plants, transplanted, in a soil bed; and a library crop sown from seed ──
const eng = E.create(plan, Lib);
const plain = p => { const r = eng.calc(p); return r && !p.established && !p.done && !p.liveTray && !p.startedFrom && !p.sowOn && !r.tw && !r.rack && !r.ct && r.b.active !== false ? r : null; };
const berry = plan.plantings.find(p => plain(p) && libCrop(p.cropId) && said(libCrop(p.cropId)) === 'plant' && libCrop(p.cropId).method === 'TP' && !(libCrop(p.cropId).gh > 0));
const sownCrop = (Lib.crops || []).find(c => c.method === 'TP' && said(c) === 'seed' && c.gh > 0 && !c.micro && plan.plantings.some(p => p.cropId === c.id && plain(p) && !p.growingDefaults) && !crops(plan).some(x => x.id === c.id));
const sownP = sownCrop && plan.plantings.find(p => p.cropId === sownCrop.id && plain(p) && !p.growingDefaults);
check('the plan has a planting of a library crop bought in as plants with no nursery weeks, and a library crop sown from seed', !!berry && !!sownP, { berry: !!berry, sown: !!sownP });
if (!berry || !sownP) { finished = true; process.exit(0); }

const day = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const withP = (pl, q) => ({ ...pl, plantings: pl.plantings.map(x => (x.id === q.id ? q : x)) });
const noRecord = (pl, id) => ({ ...pl, crops: crops(pl).filter(c => c.id !== id) });
const held = clone(berry.growingDefaults && berry.growingDefaults.crop ? berry.growingDefaults.crop : {});
const snap = { ...berry, date: day(4, 26), growingDefaults: { v: 1, cropId: berry.cropId, crop: { ...held, gh: { present: true, value: 4 } } } };
const cases = [
  ['its own record of its crop gives it 4 weeks in the nursery, no crop record in the plan', noRecord(withP(plan, snap), berry.cropId), snap, 'kept'],
  ['a crop record in the plan gives it 4 weeks in the nursery and repeats the library’s word', (() => { const q = { ...berry, date: day(4, 26) }; delete q.growingDefaults; return { ...withP(plan, q), crops: [...crops(plan).filter(c => c.id !== berry.cropId), { ...clone(crops(plan).find(c => c.id === berry.cropId) || {}), id: berry.cropId, gh: 4, plantingMaterial: 'plant' }] }; })(), null, 'kept'],
  ['a sowing day set by hand on it', noRecord(withP(plan, { ...snap, sowOn: day(3, 25) }), berry.cropId), { ...snap, sowOn: day(3, 25) }, 'kept'],
  ['the same, said bought in on the planting itself', noRecord(withP(plan, { ...snap, startedFrom: 'plant' }), berry.cropId), { ...snap, startedFrom: 'plant' }, 'bought'],
  ['the library’s crop, with no weeks in the nursery', plan, berry, 'bought'],
  ['a crop the library sows, set to bought-in plants in the plan', { ...plan, crops: [...crops(plan), { id: sownCrop.id, plantingMaterial: 'plant' }] }, sownP, 'bought']
].map(([what, pl, q, want]) => [what, pl, q || pl.plantings.find(x => x.id === berry.id), want]);

// what a planting needs in the nursery and on Seeds, as an engine reads it
const nursery = (e, w, p) => { const r = e.calc(e.planting(p.id) || p) || {}; return { sow: D(r.plannedSow), set: !!r.sowSet, cells: r.cells, trays: r.trays, seeds: r.seeds, harden: D(r.hardenStart || (e.hardenStart && e.hardenStart(r))), bench: e.benchItems().filter(it => it.p.id === p.id).map(it => it.kind).sort().join(','), tasks: w.steps(e, e.planting(p.id) || p).map(st => st.kind).filter(k => ['sow', 'potup', 'harden'].includes(k)).join(',') }; };
const seedsOf = (e, sl, p) => { const v = p.varietyId ? 'v:' + p.varietyId : 'c:' + p.cropId; return sl.required(e, { year }).rows.filter(r => r.key.startsWith(v + '|')).map(r => [r.unit, r.total, r.toSow]).sort().join(';'); };
const backup = pl => IO.split(JSON.parse(JSON.stringify(IO.join ? IO.join(pl, {}) : pl))).core;
const compact = pl => IO.unpack(JSON.parse(JSON.stringify(IO.pack(pl))));

for (const [what, pl, q, want] of cases) {
  for (const [form, read] of [['as given', x => x], ['saved as a backup', backup], ['saved as the compact plan', compact]]) {
    let p2;
    try { p2 = read(pl); } catch (e) { check(`${what}, ${form}: the plan reads back`, false, String(e).slice(0, 200)); continue; }
    const e = E.create(p2, Lib), r = e.calc(e.planting(q.id)), now = nursery(e, W, q);
    if (want === 'kept') {
      const e0 = E0.create(p2, Lib), was = nursery(e0, W0, q);
      check(`${what}, ${form}: sown as before N2, its sowing day, trays, hardening off, bench room and Tasks the build before's`, !!r && !r.boughtIn && !!now.sow && now.trays > 0 && JSON.stringify(now) === JSON.stringify(was) && !e.boughtInOf(e.planting(q.id)), { now, was });
      check(`${what}, ${form}: Seeds counts it in plants, as the build before did`, seedsOf(e, SL, q) === seedsOf(e0, SL0, q) && /^plants,/.test(seedsOf(e, SL, q)), [seedsOf(e, SL, q), seedsOf(e0, SL0, q)]);
    } else {
      check(`${what}, ${form}: bought in, with no sowing day, trays, bench room or nursery work on Tasks`, !!r && r.boughtIn === true && !now.sow && now.trays === 0 && !now.bench && !now.tasks && e.boughtInOf(e.planting(q.id)), now);
    }
  }
}
finished = true;
