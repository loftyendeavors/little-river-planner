'use strict';
// Planning ahead: openings in the ground with the crops that fit them. (A series of successions went with 0.84: a run of
// successions, LRFSuccession.planRun, is held by run_test.cjs, the random runs and the frost among it.)
// The rule under test throughout: nothing these propose may land on ground that is held, or outside the season. A frost date
// is not the season's edge (#100): what the frost touches is proposed, and carries the engine's own frost note.
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
  // the season, asked of the engine directly rather than of the module under test: a field day the last spring frost alone sets is the frost's
  const season = added.map(p => { const r = after.calc(p), early = after.fieldFrostOnly(p, r), w = after.warnings(p, r).find(x => ['field', 'closed', 'timing'].includes(x.k) && !(x.k === 'field' && x.t === early)), win = after.fieldPlantingWindow(r.b, r.field.getFullYear());
    return w ? w.t : win.from && r.field < win.from ? 'before the first field date' : win.to && r.field > win.to ? 'after the last field date' : null; }).filter(Boolean);
  // what a frost date does to each, by the engine: its frost warning, or that frost-only field day
  const frost = added.map(p => { const r = after.calc(p), w = after.warnings(p, r).find(x => x.k === 'frost'); return w ? w.t : after.fieldFrostOnly(p, r) || null; });
  return { ok: !refused && !clashes.length && !season.length, refused: refused && refused.kind, clashes: clashes.length, season: season.slice(0, 2), frost, after };
}
const crop = name => eng.crops().find(c => c.name === name) || eng.crops().find(c => new RegExp(name, 'i').test(c.name));
const gardenIds = c => S.gardensFor(eng, c).map(x => x.garden.id);

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
let fitCount = 0, withFits = 0, badFits = [], lateChecked = 0, frostFits = 0, badOrder = [];
for (const o of open) {
  const list = S.fits(eng, o, { covered });
  if (list.length) withFits++;
  // a crop the frost cuts comes after every crop that fits whole
  if (list.some((t, i) => i && list[i - 1].frost && !t.frost)) badOrder.push({ bed: o.bed.bed, list: list.map(t => [t.crop.name, !!t.frost]) });
  for (const t of list) {
    fitCount++;
    const p = { ...t.p, id: 'fit-' + fitCount }, v = verdict(eng, [p]);
    if (t.frost) frostFits++;
    if ((t.frost || null) !== v.frost[0]) { badFits.push({ bed: o.bed.bed, crop: t.crop.name, frost: [t.frost, v.frost[0]] }); continue; }
    const within = t.r.field >= o.from && eng.occupancyThrough(p, t.r) <= o.to && t.spare >= 0 && t.r.harvestDays > 0 && t.latest >= t.r.field;
    if (!v.ok || !within) { badFits.push({ bed: o.bed.bed, crop: t.crop.name, date: t.p.date, v: { refused: v.refused, clashes: v.clashes, season: v.season }, within }); continue; }
    if (iso(t.latest) !== t.p.date && (lateChecked < 150 || t.crop.frostTender)) { lateChecked++; const late = S.tryCrop(eng, o, t.crop, { date: iso(t.latest), id: 'late-' + fitCount }); if (!late.ok || late.frost || !verdict(eng, [late.p]).ok) badFits.push({ bed: o.bed.bed, crop: t.crop.name, latest: iso(t.latest), why: late.why }); }
  }
}
check('every crop offered for an opening can be planted there: in the ground it names, in season, done before the next crop', fitCount > 100 && withFits > 10 && !badFits.length, { fitCount, withFits, lateChecked, bad: badFits.slice(0, 4) });
check('crops the first frost cuts are offered, with the engine’s frost note, after every crop that fits whole; the last day offered is clear of the frost', frostFits >= 10 && !badOrder.length && !badFits.some(x => x.frost || x.latest), { frostFits, order: badOrder.slice(0, 2) });
// "where could it go": the openings a crop fits are those of an opening's own test, each with that test's frost note
const roomOf = crop('Basil') && S.room(eng, crop('Basil').id), roomBad = roomOf ? roomOf.openings.filter(x => { const t = S.tryCrop(eng, x.opening, crop('Basil')); return !t.ok || (t.frost || null) !== x.frost; }) : [null];
check('where a crop could go lists the openings its own test passes, those the frost cuts with the note', !!roomOf && roomOf.openings.filter(x => x.frost).length >= 2 && !roomBad.length, roomOf && { n: roomOf.openings.length, frost: roomOf.openings.filter(x => x.frost).length, bad: roomBad.length });
// the frost leaves nothing: not offered on the crop's own first day, allowed on a day asked for, and said outright
const zeroEnd = o => o.to;   // the ground is free for it: only the frost is short
const zero = (() => { for (const o of open) for (const c of S.candidates(eng, true)) { if (!S.suits(eng, c, o.bed)) continue; const t = S.tryCrop(eng, o, c); if (!t.ok && t.r && t.r.frostCut && !(t.r.harvestDays > 0)) { const fit = eng.fit(t.p); if (fit.ok && fit.through <= zeroEnd(o)) return { o, c, t }; } } return null; })();
const zeroAsked = zero && S.tryCrop(eng, zero.o, zero.c, { date: zero.t.p.date, id: 'zero-asked' }), zeroV = zeroAsked && verdict(eng, [zeroAsked.p]);
check('a crop the frost leaves nothing to pick is not offered, and on a day typed for it is allowed, saying nothing is picked', !!zero && !S.fits(eng, zero.o, { covered }).some(t => t.crop.id === zero.c.id) && zero.t.why === zeroV.frost[0]
  && zeroAsked.ok && /nothing is picked/.test(zeroAsked.frost) && zeroAsked.frost === zeroV.frost[0] && zeroV.ok, zero ? { crop: zero.c.name, why: zero.t.why, asked: zeroAsked.ok, askedWhy: zeroAsked.why, frost: zeroAsked.frost } : 'no subject');
// a day typed before the last spring frost: allowed with its note; a day before the crop's own field date still stops
// (on this farm warm-season planting starts after the last frost, so the same plan is read with a last frost two weeks past that start)
const fw0 = eng.firstFieldDate(eng.crops().find(c => c.frostTender && eng.fieldSeasonFor(c) === 'warm') || {}, open.find(o => o.garden.type === 'field').bed, year), late2 = fw0 && E.d2s(E.addDays(fw0, 14)).slice(5);
const engS = late2 ? E.create({ ...core, settings: { ...core.settings, frostLast: late2 } }, Lib) : eng, openS = S.openings(engS, { empty: true });
const spring = (() => { for (const o of openS) for (const c of S.candidates(engS, false)) { if (!c.frostTender || !S.suits(engS, c, o.bed)) continue; const first = engS.firstFieldDate(c, o.bed, year), bare = engS.firstFieldDate(c, o.bed, year, {}, false); const d = bare && bare > o.from ? bare : o.from; if (first && first > d && d <= o.to) { const t = S.tryCrop(engS, o, c, { date: iso(d), id: 'spring' }); if (t.r && t.spare >= 0 && t.r.harvestDays > 0) return { o, c, t }; } } return null; })();
const springV = spring && verdict(engS, [spring.t.p]);
check('a frost-tender crop on a day typed before the last-frost planning date is allowed, with the engine’s frost note', !!spring && spring.t.ok && !!spring.t.frost && spring.t.frost === springV.frost[0] && springV.ok, spring ? { crop: spring.c.name, at: spring.t.p.date, ok: spring.t.ok, why: spring.t.why, frost: spring.t.frost } : { frostLast: late2 });
const cool = (() => { for (const o of open) for (const c of S.candidates(eng, false)) { if (!S.suits(eng, c, o.bed) || o.garden.type !== 'field') continue; const bare = eng.firstFieldDate(c, o.bed, year, {}, false); if (bare && bare > o.from) { const t = S.tryCrop(eng, o, c, { date: iso(o.from), id: 'cold' }); if (t.r) return { o, c, t }; } } return null; })();
check('a day typed before the crop’s own field date, the frost aside, still stops it, in the engine’s words', !!cool && !cool.t.ok && /field planting starts/.test(cool.t.why), cool ? { crop: cool.c.name, why: cool.t.why } : 'no subject');
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
console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, openings: open.length, withFits, fits: fitCount }));
process.exit(fail.length ? 1 : 0);
