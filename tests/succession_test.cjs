'use strict';
// Planning ahead: a series of successions, and openings in the ground with the crops that fit them.
// The rule under test throughout: nothing these propose may land on ground that is held, or outside the season.
// usage: node succession_test.cjs <app-dir> <plan.json (backup or shipped)>
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const E = require(path.join(appDir, 'js/engine.js')), Lib = require(path.join(appDir, 'js/library.js')), IO = require(path.join(appDir, 'js/planio.js')), Rails = require(path.join(appDir, 'js/rails.js')),
  S = require(path.join(appDir, 'js/succession.js')), F = require(path.join(appDir, 'js/forecast.js'));
const results = [], fail = [];
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail).slice(0, 800) : ''}`); if (!ok) fail.push(name); };
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core, eng = E.create(core, Lib), year = +core.settings.year;
const near = (a, b) => Math.abs(a - b) < 1e-6, sum = (list, f) => list.reduce((n, x) => n + f(x), 0), iso = E.d2s;
let seed = 20261111; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) / 16777216; }, pick = list => list[Math.floor(rnd() * list.length)];
/** Add plantings to the plan and ask the guard rails and the season about every one of them. */
function verdict(base, added) {
  const plan = { ...base.plan, plantings: [...base.plan.plantings, ...added] }, after = E.create(plan, Lib);
  const refused = added.length ? Rails.refusal(base, after, added.map(p => p.id)) : null;
  const clashes = added.filter(p => { const r = after.calc(p); return !r || after.conflicts(p, r).length || after.overflow(p, r); });
  // the season, asked of the engine directly rather than of the module under test
  const season = added.map(p => { const r = after.calc(p), w = after.warnings(p, r).find(x => ['field', 'frost', 'closed', 'timing'].includes(x.k)), win = after.fieldPlantingWindow(r.b, r.field.getFullYear());
    return w ? w.t : win.from && r.field < win.from ? 'before the first field date' : win.to && r.field > win.to ? 'after the last field date' : null; }).filter(Boolean);
  return { ok: !refused && !clashes.length && !season.length, refused: refused && refused.kind, clashes: clashes.length, season: season.slice(0, 2), after };
}
const crop = name => eng.crops().find(c => c.name === name) || eng.crops().find(c => new RegExp(name, 'i').test(c.name));
const gardenIds = c => S.gardensFor(eng, c).map(x => x.garden.id);

// ── a series ──
const radish = crop('Radish'), lettuce = crop('Lettuce'), fieldGardens = S.gardensFor(eng, radish).filter(x => x.kind === 'bed' && x.garden.type === 'field').map(x => x.garden.id);
check('a crop is asked for, live trays are sent to their own view, and the dates must make sense',
  /crop/i.test(S.series(eng, {}).error) && /Live trays in the Nursery view/.test(S.series(eng, { cropId: eng.crops().find(c => c.micro).id, from: `${year}-05-01`, every: 7, count: 2, amount: 1, gardenIds: fieldGardens }).error)
  && /first date/i.test(S.series(eng, { cropId: radish.id, every: 7, count: 2, amount: 1, gardenIds: fieldGardens }).error)
  && /last date/i.test(S.series(eng, { cropId: radish.id, from: `${year}-06-01`, to: `${year}-05-01`, every: 7, amount: 1, gardenIds: fieldGardens }).error)
  && /at a time/.test(S.series(eng, { cropId: radish.id, from: `${year}-05-01`, every: 1, count: 500, amount: 1, gardenIds: fieldGardens }).error)
  && /garden/i.test(S.series(eng, { cropId: radish.id, from: `${year}-05-01`, every: 7, count: 2, amount: 1, gardenIds: [] }).error));

const a = S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'planting', from: `${year}-07-20`, count: 5, every: 10, unit: 'whole', amount: 1 });
check('five radish successions ten days apart are five waves on the days asked', !a.error && a.waves.length === 5 && a.waves.every((w, k) => iso(w.target) === iso(E.addDays(E.s2d(`${year}-07-20`), k * 10))), a.error || a.waves.map(w => [iso(w.target), w.placed.length, w.short]));
check('each placed planting goes in on its wave’s day and takes a whole bed', a.placed >= 3 && a.waves.every(w => w.placed.every(x => iso(x.r.field) === iso(w.target) && x.r.physicalLength >= x.r.cap - 1e-6)));
const va = verdict(eng, a.plantings);
check('nothing in the series lands on ground that is held, or outside the season', va.ok, va);
check('a wave that could not be placed says how much is missing and why', a.waves.every(w => w.short > 0 ? w.why.length >= 1 && w.why.every(x => x.why && x.spaces >= 1) : !w.why.length));
check('the series is new plantings with ids of their own, none recorded as done', new Set(a.plantings.map(p => p.id)).size === a.plantings.length && a.plantings.every(p => !eng.planting(p.id) && !p.done && p.cropId === radish.id));
check('the plan itself is untouched', eng.plan.plantings.length === core.plantings.length && a.plantings.every(p => !core.plantings.includes(p)));

const h = S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'harvest', from: `${year}-08-20`, to: `${year}-09-20`, every: 10, unit: 'whole', amount: 1 });
check('counted back from harvest, each planting is first ready on its target day', !h.error && h.waves.length === 4 && h.placed >= 2 && h.waves.every(w => w.placed.every(x => iso(x.r.first) === iso(w.target))) && verdict(eng, h.plantings).ok, h.error || h.waves.map(w => [iso(w.target), w.placed.map(x => iso(x.r.first))]));

const f = S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'planting', from: `${year}-08-01`, count: 3, every: 14, unit: 'ft', amount: 30 });
check('thirty feet a succession takes thirty feet, in one bed or several', !f.error && f.waves.every(w => w.short > 0 || near(sum(w.placed, x => x.r.physicalLength), 30)) && f.waves.some(w => !w.short) && verdict(eng, f.plantings).ok, f.error || f.waves.map(w => [w.placed.map(x => x.r.physicalLength), w.short]));

const two = S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'planting', from: `${year}-08-01`, count: 2, every: 14, unit: 'whole', amount: 2 });
check('two beds a succession are two different beds', !two.error && two.waves.every(w => w.placed.length <= 2 && new Set(w.placed.map(x => x.bed.id)).size === w.placed.length) && two.waves.some(w => w.placed.length === 2) && verdict(eng, two.plantings).ok);
check('the same request gives the same plan', JSON.stringify(S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'planting', from: `${year}-08-01`, count: 2, every: 14, unit: 'whole', amount: 2 }).plantings.map(p => [p.bedId, p.date, p.ft || 0])) === JSON.stringify(two.plantings.map(p => [p.bedId, p.date, p.ft || 0])));

// skipping what is already covered
const allCovered = S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'planting', from: `${year}-08-01`, count: 3, every: 14, unit: 'whole', amount: 1, skipCovered: true, covered: () => true });
const noneCovered = S.series(eng, { cropId: radish.id, gardenIds: fieldGardens, basis: 'planting', from: `${year}-08-01`, count: 3, every: 14, unit: 'whole', amount: 1, skipCovered: true, covered: () => false });
check('a wave is left out when the crop is already being picked then, and only then', allCovered.plantings.length === 0 && allCovered.skipped === 3 && allCovered.waves.every(w => w.skipped === 'covered' && !w.short) && noneCovered.skipped === 0 && noneCovered.plantings.length >= 2);

// modelled on a planting already in the plan: a tower cycle keeps its settings
const tower = core.plantings.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && x.r.tw).sort((x, y) => y.r.field - x.r.field)[0];
if (tower) {
  const tg = [tower.r.b.gardenId], start = E.addDays(tower.r.field, 60);
  const t = S.series(eng, { cropId: tower.p.cropId, sourceId: tower.p.id, gardenIds: tg, basis: 'planting', from: iso(start), count: 3, every: 7, unit: 'whole', amount: 2 });
  check('a series copied from a tower planting keeps its cycle, and each tower is taken whole', !t.error && t.plantings.length >= 2 && t.plantings.every(p => p.id !== tower.p.id && !p.done && JSON.stringify(p.towerCycle) === JSON.stringify(tower.p.towerCycle) && p.dtm === tower.p.dtm && p.hw === tower.p.hw && eng.isTower(eng.bedOf(p.bedId))) && verdict(eng, t.plantings).ok, t.error || t.waves.map(w => [iso(w.target), w.placed.length, w.why]));
  const models = S.models(eng, tower.p.cropId);
  check('the plantings a series can copy are the latest of each kind of space and variety', models.length >= 1 && models.every(m => m.p.cropId === tower.p.cropId) && new Set(models.map(m => m.r.kind + '|' + (m.p.varietyId || ''))).size === models.length);
} else check('the plan has a tower planting to copy', false);

// where nothing is free, nothing is placed
const busy = core.plantings.map(p => ({ p, r: eng.calc(p) })).find(x => x.r && x.r.kind === 'bed' && x.r.physicalLength >= x.r.cap - 1e-6 && x.r.c.id !== radish.id && E.dayDiff(x.r.last, x.r.field) > 40);
const none = S.series(eng, { cropId: radish.id, gardenIds: [busy.r.b.gardenId], basis: 'planting', from: iso(E.addDays(busy.r.field, 5)), count: 1, every: 7, unit: 'whole', amount: 400 });
check('asking for more beds than a garden has places what there is and reports the rest', !none.error && none.waves[0].short > 0 && none.waves[0].placed.length < 400 && none.waves[0].why.length >= 1 && verdict(eng, none.plantings).ok, none.waves[0].why);

// many requests at random: whatever is proposed must always be addable
let tried = 0, proposed = 0, bad = [];
const pool = S.candidates(eng, true);
for (let i = 0; i < 160; i++) {
  const c = pick(pool), gs = S.gardensFor(eng, c);
  if (!gs.length) continue;
  const chosen = gs.filter(() => rnd() < 0.4).map(x => x.garden.id), ids = chosen.length ? chosen : [pick(gs).garden.id];
  const from = E.addDays(new Date(year, 2, 1), Math.floor(rnd() * 230)), unit = rnd() < 0.35 ? 'ft' : 'whole';
  const res = S.series(eng, { cropId: c.id, gardenIds: ids, basis: rnd() < 0.5 ? 'harvest' : 'planting', from: iso(from), count: 1 + Math.floor(rnd() * 6), every: 5 + Math.floor(rnd() * 25), unit, amount: unit === 'ft' ? 10 + Math.floor(rnd() * 80) : 1 + Math.floor(rnd() * 3) });
  tried++;
  if (res.error) { bad.push({ crop: c.name, error: res.error }); continue; }
  proposed += res.plantings.length;
  const v = verdict(eng, res.plantings);
  if (!v.ok) bad.push({ crop: c.name, v: { refused: v.refused, clashes: v.clashes, season: v.season } });
}
check('160 series at random: every planting proposed can be added, and none is out of season', tried >= 120 && proposed > 150 && !bad.length, { tried, proposed, bad: bad.slice(0, 4) });

// ── openings ──
const open = S.openings(eng);
check('there are openings in this plan, each at least three weeks and eight feet', open.length > 20 && open.every(o => o.days >= 21 && o.length >= Math.min(8, o.cap) - 1e-6 && o.to >= o.from && E.dayDiff(o.to, o.from) + 1 === o.days), { n: open.length });
const crosses = (o, x) => x.rect && o.a0 < x.rect.a1 - 1e-6 && x.rect.a0 < o.a1 - 1e-6;
check('the ground of an opening is free on every day of it', open.every(o => !eng.holders(o.bed, o.from, o.to, null).some(x => crosses(o, x))));
check('an opening ends the day before the crop it comes before goes in', open.filter(o => o.before).length > 5 && open.filter(o => o.before).every(o => iso(E.addDays(o.to, 1)) === iso(eng.occupancyFrom(o.before.p, o.before.r))));
check('an opening that follows a crop starts once that crop and its turnover are done', open.filter(o => o.after).length > 5 && open.filter(o => o.after).every(o => eng.occupancyThrough(o.after.p, o.after.r) < o.from));
const fw = b => eng.fieldPlantingWindow(b, year);
check('open ground is not offered before the first field date, nor a house before it opens', open.every(o => { const w = fw(o.bed), g = eng.gWindow(o.garden, year); return (!w.from || o.from >= w.from) && (!g.open || o.from >= g.open) && (!g.close || o.to <= g.close); }));
const cold = S.unheatedStart(eng), heated = o => o.garden.type === 'greenhouse';
check('unheated ground is not offered before the plan’s own first planting in it; a heated house is', cold && open.filter(o => !heated(o)).every(o => o.from >= cold) && S.openings(eng, { unheatedFrom: null }).length >= open.length
  && S.openings(eng, { unheatedFrom: `${year}-03-01` }).filter(o => !heated(o)).every(o => o.from >= E.s2d(`${year}-03-01`)) && (open.filter(heated).length === 0 || open.filter(heated).some(o => o.from < cold)), { cold: cold && iso(cold), heatedOpen: open.filter(heated).length });
check('beds with nothing planned are left out unless asked for', open.every(o => o.planted) && S.openings(eng, { empty: true }).length >= open.length);
check('openings can be asked for one garden or one bed', S.openings(eng, { gardenIds: [open[0].garden.id] }).every(o => o.garden.id === open[0].garden.id) && S.openings(eng, { bedId: open[0].bed.id }).every(o => o.bed.id === open[0].bed.id) && S.openings(eng, { bedId: open[0].bed.id }).length >= 1);
check('a longer minimum leaves fewer openings', S.openings(eng, { minDays: 60 }).length < open.length && S.openings(eng, { minDays: 60 }).every(o => o.days >= 60));

// what fits
const model = F.build(eng), covered = (id, from, to) => { const rows = model.rows.filter(r => r.cropId === id); if (!rows.length) return 0; let n = 0, d = 0; for (let i = model.index(from); i <= model.index(to); i++) { d++; if (i >= 0 && i < model.days && rows.some(r => r.days[i] > 1e-9)) n++; } return d ? n / d : 0; };
let fitCount = 0, withFits = 0, badFits = [], lateChecked = 0;
for (const o of open) {
  const list = S.fits(eng, o, { covered });
  if (list.length) withFits++;
  for (const t of list) {
    fitCount++;
    const p = { ...t.p, id: 'fit-' + fitCount }, v = verdict(eng, [p]);
    const within = t.r.field >= o.from && eng.occupancyThrough(p, t.r) <= o.to && t.spare >= 0 && t.r.harvestDays > 0 && t.latest >= t.r.field;
    if (!v.ok || !within) { badFits.push({ bed: o.bed.bed, crop: t.crop.name, date: t.p.date, v: { refused: v.refused, clashes: v.clashes, season: v.season }, within }); continue; }
    if (iso(t.latest) !== t.p.date && lateChecked < 150) { lateChecked++; const late = S.tryCrop(eng, o, t.crop, { date: iso(t.latest), id: 'late-' + fitCount }); if (!late.ok || !verdict(eng, [late.p]).ok) badFits.push({ bed: o.bed.bed, crop: t.crop.name, latest: iso(t.latest), why: late.why }); }
  }
}
check('every crop offered for an opening can be planted there: in the ground it names, in season, done before the next crop', fitCount > 100 && withFits > 10 && !badFits.length, { fitCount, withFits, lateChecked, bad: badFits.slice(0, 4) });
const some = open.map(o => ({ o, list: S.fits(eng, o, { covered }) })).find(x => x.list.length >= 3);
check('crops the plan is not already picking then come first, and one that follows its own family comes last', some && some.list.every((t, i, all) => i === 0 || (all[i - 1].rotation ? 1 : 0) <= (t.rotation ? 1 : 0)), some && some.list.map(t => [t.crop.name, t.rotation, t.covered]));
const cand = S.candidates(eng, true), allCand = S.candidates(eng, false);
check('microgreens, perennials, cover crops and bulbs are not offered for an opening', allCand.length >= cand.length && allCand.every(c => !c.micro && !eng.isPerennial(c) && !eng.isCoverCrop(c) && c.material !== 'bulb'));
// a crop too long for the opening is refused, in words
const short = open.find(o => o.before && o.days < 45), long = allCand.slice().sort((x, y) => y.dtm - x.dtm)[0];
const refusal = short && S.tryCrop(eng, short, long);
check('a crop that needs longer than the opening is turned down, and told why', short && refusal && !refusal.ok && typeof refusal.why === 'string' && refusal.why.length > 10, refusal && refusal.why);
// asked for a day and a length
const roomy = open.map(o => ({ o, t: S.fits(eng, o, { covered })[0] })).find(x => x.t && x.t.spare >= 5 && x.o.length >= 20);
if (roomy) {
  const later = S.tryCrop(eng, roomy.o, roomy.t.crop, { date: iso(E.addDays(roomy.t.r.field, 3)), ft: 12, id: 'asked' });
  check('a chosen day and a chosen length are kept, inside the opening', later.ok && later.p.date === iso(E.addDays(roomy.t.r.field, 3)) && later.p.ft === 12 && near(later.r.physicalLength, 12) && verdict(eng, [later.p]).ok && S.tryCrop(eng, roomy.o, roomy.t.crop, { date: iso(E.addDays(roomy.o.from, -3)) }).ok === false, later.why);
} else check('there is an opening with room to choose a day', false);

// the benches
const room = S.benchRoom(eng);
check('bench room is what the benches hold less the fullest day of each week', room.cap === eng.heatedTraySpaces() && room.weeks.length >= 52 && room.weeks.every(w => w.free >= 0 && near(w.free, Math.max(0, room.cap - w.most))) && room.least && room.weeks.every(w => w.free >= room.least.free));

console.log(results.join('\n'));
console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, openings: open.length, withFits, fits: fitCount, random: { tried, proposed } }));
process.exit(fail.length ? 1 : 0);
