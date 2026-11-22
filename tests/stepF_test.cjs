/* Step F, with no browser: that the build by itself moves nothing. Every planting's dates, seed, yield and price, the forecast
 * crop by crop and day by day, and the bench room day by day, against the build before. (The series sized by harvest this test
 * also held went with the series tool in 0.84; a run of successions to an amount a week is held by run_test.cjs.)
 * usage: node stepF_test.cjs <app-dir> <plan.json> [dir holding the previous build's js]
 */
'use strict';
const path = require('path'), fs = require('fs');
const [app, planFile, oldDir] = process.argv.slice(2);
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: f.detail })), figures }));
});
const figures = {};
const req = (dir, f) => require(path.join(dir, f));
const Lib = req(app, 'js/library.js'), E = req(app, 'js/engine.js'), IO = req(app, 'js/planio.js'), S = req(app, 'js/succession.js'), F = req(app, 'js/forecast.js'), Rails = req(app, 'js/rails.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const eng = E.create(plan, Lib), year = +plan.settings.year;
const iso = d => E.d2s(d), near = (a, b, e = 1e-6) => Math.abs(a - b) <= e, sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const byName = (e, name) => e.crops().find(c => c.name === name);
// the same farm with nothing planted: ground enough for whatever is asked, so a size can be told from a want of room
const bare = { ...plan, plantings: [], lrfNext: { ...(plan.lrfNext || {}), waiting: [] } }, free = E.create(bare, Lib);
const soilGardens = (e, crop) => S.gardensFor(e, crop).filter(g => g.kind === 'bed').map(g => g.garden.id);
const fieldGardens = (e, crop) => soilGardens(e, crop).filter(id => { const b = e.plan.beds.find(x => x.gardenId === id && S.suits(e, crop, x)); return b && e.envOf(b) === 'field'; });
const forecastWith = (e, plantings) => { const e2 = E.create({ ...e.plan, plantings: [...e.plan.plantings, ...plantings] }, Lib); return { e2, m: F.build(e2, { year }) }; };
const weekly = (m, cropId, unit, a, b) => F.periods(m, 'week', m.index(a), m.index(b)).map(c => ({ c, days: Math.min(c.i1, m.index(b)) - Math.max(c.i0, m.index(a)) + 1, q: sum(m.rows.filter(r => r.cropId === cropId && r.unit === unit), r => F.sum(r.days, Math.max(c.i0, m.index(a)), Math.min(c.i1, m.index(b)))) }));
const D = (m, d) => new Date(year, m - 1, d);

// ── 1. the build by itself moves nothing ──
if (oldDir) {
  // the plantings the frost cuts (E2c) are held at their last day, which the build before knows no other way (tests/frost_held.cjs)
  const E0 = require(path.join(oldDir, 'engine.js')), S0 = require(path.join(oldDir, 'succession.js')), F0 = require(path.join(oldDir, 'forecast.js')), Lib0 = require(path.join(oldDir, 'library.js'));
  // and the plantings bought in (N2) are left out on both sides: the build before sows them (tests/bought_held.cjs)
  const base = require('./bought_held.cjs').held(E, Lib, plan, E0.create(plan, Lib0)), eng0 = E0.create(base, Lib0);
  const now = E.create(require('./frost_held.cjs').held(E, Lib, base, eng0), Lib);
  const differ = [];
  for (const p of base.plantings) {
    const q = now.planting(p.id), a = now.calc(q), b = eng0.calc(p);
    if (!a !== !b) { differ.push(p.id); continue; }
    if (!a) continue;
    const row = (e, x, r, DD) => [r.sow, r.field, r.first, r.last].map(v => (v ? DD.d2s(new Date(v)) : '')).join(',') + '|' + [r.plants, r.seeds, r.len, r.trays].join(',') + '|' + JSON.stringify((y => y && [y.units, y.unit, y.price, y.pattern])(e.yieldOf(x, r)));
    if (row(now, q, a, E) !== row(eng0, p, b, E0)) differ.push(p.id);
  }
  check('every planting has the dates, the seed and the yield it had in the build before', differ.length === 0, differ.slice(0, 5));
  const m1 = F.build(now, { year }), m0 = F0.build(eng0, { year });
  check('the forecast is the build before’s, crop by crop', m1.rows.length === m0.rows.length && m1.rows.every((r, i) => r.key === m0.rows[i].key && near(r.total, m0.rows[i].total, 1e-9) && near(r.worth, m0.rows[i].worth, 1e-9)), [m1.rows.length, m0.rows.length]);
  // the forecast day by day, and the bench room day by day (E4: the finish line's "no figure of the farm's plantings moves")
  const dayOff = m1.rows.length !== m0.rows.length ? ['rows'] : m1.rows.filter((r, i) => r.days.length !== m0.rows[i].days.length || r.days.some((v, k) => !near(v, m0.rows[i].days[k], 1e-9))).map(r => r.key);
  check('the forecast is the build before’s day by day, crop by crop', !dayOff.length, dayOff.slice(0, 5));
  const benchOff = [];
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) { const a = now.benchDay(d), b = eng0.benchDay(d); if (!near(a.total, b.total, 1e-9)) benchOff.push(iso(d)); }
  check('the bench room is the build before’s, day by day', !benchOff.length, benchOff.slice(0, 5));
  figures.unchanged = { plantings: base.plantings.length, rows: m1.rows.length, days: m1.rows.reduce((n, r) => n + r.days.length, 0) };
} else check('the build before was given, to prove nothing moves by itself', false, 'give the folder of the previous js as the third argument');

finished = true;
