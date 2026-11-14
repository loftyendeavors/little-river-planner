'use strict';
// The assumptions list, checked on the real plan: who follows a number and who does not.
// usage: node assume_test.cjs <app-dir> <plan.json>
// (Written for 0.12, typed back for 0.22. With no starting point set, a number is still used as typed.)
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const E = require(path.join(appDir, 'js/engine.js')), Lib = require(path.join(appDir, 'js/library.js')), IO = require(path.join(appDir, 'js/planio.js'));
const { core, attic } = IO.split(JSON.parse(fs.readFileSync(planFile, 'utf8'))), base = E.create(core, Lib);
const results = [], fail = [];
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail) : ''}`); if (!ok) fail.push(name); };
const withList = a => E.create({ ...core, assumptions: a }, Lib);
const dtm = (eng, p) => eng.calc(eng.planting(p.id)).c.dtm;
const info = base.plan.plantings.map(p => { const r = base.calc(p); return r && { p, r, env: base.envOf(r.b), pinned: base.pinned(p), figure: !!(p.varietyId && (r.c.catalogTiming && r.c.catalogTiming.activeMode === 'catalog' || (base.variety(p.varietyId) || {}).dtm > 0)) }; }).filter(Boolean);

// The shared heated benches are every bench at once, not a place with conditions of its own.
const places = core.gardens.filter(g => !g.liveTrayPool);
check('every garden has one of the four growing conditions', places.every(g => base.ENVS.includes(base.envOf(core.beds.find(b => b.gardenId === g.id)))), [...new Set(places.map(g => base.envOf(core.beds.find(b => b.gardenId === g.id))))]);

// a crop number reaches the plantings with no variety figure and no pin, in that condition only
const plain = info.find(x => !x.pinned && !x.figure && x.env === 'field'), crop = plain.p.cropId;
let eng = withList({ v: 1, crops: { [crop]: { field: { dtm: 77 } } }, varieties: {} });
const sameCrop = info.filter(x => x.p.cropId === crop);
check('a crop number is used as typed by its plain plantings there', sameCrop.filter(x => x.env === 'field' && !x.pinned && !x.figure).every(x => dtm(eng, x.p) === 77), { crop, n: sameCrop.length });
check('a variety with its own figure keeps it', sameCrop.filter(x => x.figure && !x.pinned).every(x => dtm(eng, x.p) === x.r.c.dtm));
check('other growing conditions are untouched', sameCrop.filter(x => x.env !== 'field').every(x => dtm(eng, x.p) === x.r.c.dtm));
check('other crops are untouched', info.filter(x => x.p.cropId !== crop).every(x => dtm(eng, x.p) === x.r.c.dtm));

// a variety number beats the supplier's figure and the crop number
const withFigure = info.find(x => x.figure && !x.pinned && x.env === 'field'), vid = withFigure.p.varietyId;
eng = withList({ v: 1, crops: { [withFigure.p.cropId]: { field: { dtm: 90 } } }, varieties: { [vid]: { field: { dtm: 41 } } } });
check('a variety number beats the supplier figure and the crop number', info.filter(x => x.p.varietyId === vid && x.env === 'field' && !x.pinned).every(x => dtm(eng, x.p) === 41));
check('its sister varieties keep their own figures', info.filter(x => x.p.cropId === withFigure.p.cropId && x.p.varietyId !== vid && x.figure && !x.pinned).every(x => dtm(eng, x.p) === x.r.c.dtm));

// a pinned planting follows nothing
const pin = info.find(x => x.pinned);
eng = withList({ v: 1, crops: { [pin.p.cropId]: { [pin.env]: { dtm: 99 } } }, varieties: pin.p.varietyId ? { [pin.p.varietyId]: { [pin.env]: { dtm: 98 } } } : {} });
check('a planting with its own days follows nothing', info.filter(x => x.pinned).every(x => dtm(eng, x.p) === x.r.c.dtm), { pinned: info.filter(x => x.pinned).length });

// the list cell says what is in use
const t0 = base.timingFor(crop, null, 'field'), t1 = withList({ v: 1, crops: { [crop]: { field: { dtm: 77 } } } }).timingFor(crop, null, 'field');
check('a cell shows the default until a number is set, then the number', t0.mine === null && t0.fallback > 0 && t0.value === t0.fallback && t1.mine === 77 && t1.value === 77 && t1.fallback === t0.fallback, { t0, t1 });
const tv = base.timingFor(withFigure.p.cropId, vid, 'field');
check('a variety cell shows the supplier figure as its default', tv.source === 'supplier' && tv.printed > 0, tv);

// an empty list changes nothing, and the list travels with the plan
check('an empty list changes nothing', info.every(x => dtm(withList({ v: 1, crops: {}, varieties: {} }), x.p) === x.r.c.dtm));
const again = IO.split(IO.join({ ...core, assumptions: { v: 1, crops: { [crop]: { field: { dtm: 77 } } }, varieties: {} } }, attic)).core;
check('the list is saved and loaded with the plan', again.assumptions && again.assumptions.crops[crop].field.dtm === 77);

console.log(JSON.stringify({ passed: results.length - fail.length, checks: results.length, failed: fail, results, pinned: info.filter(x => x.pinned).length, plantings: info.length }, null, 1));
process.exitCode = fail.length ? 1 : 0;
