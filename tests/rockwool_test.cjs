'use strict';
// Rockwool for the towers: crops sown the same day share sheets, and every sheet rides in one open 10 × 20 tray.
// usage: node rockwool_test.cjs <app-dir> <plan.json (backup or shipped)>
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const E = require(path.join(appDir, 'js/engine.js')), Lib = require(path.join(appDir, 'js/library.js')), IO = require(path.join(appDir, 'js/planio.js'));
const results = [], fail = [];
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && (!ok || process.env.VERBOSE) ? ' ' + JSON.stringify(detail).slice(0, 700) : ''}`); if (!ok) fail.push(name); };
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const near = (a, b) => Math.abs(a - b) < 1e-9, sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const base = E.create(core, Lib);
const towers = core.plantings.map(p => ({ p, r: base.calc(p) })).filter(x => x.r && x.r.tw && x.r.sowing && !(x.p.done && x.p.done.sow));
const crops = [...new Set(towers.map(x => x.r.c.id))];
check('the plan raises more than one crop for the towers', crops.length >= 2, crops);

// As the plan stands
const lotsOf = eng => [...new Set(eng.plan.plantings.map(p => { const r = eng.calc(p); return r && r.sowing && r.sowing.trayGroup; }).filter(g => g && g.medium === 'rockwool'))];
const before = lotsOf(base);
check('every rockwool lot holds whole sheets, and one open tray under each', before.every(g => Number.isInteger(g.trays) && g.trays === Math.ceil(g.cells / g.tray.cells) && g.carriers === g.trays));

// Move one crop's tower sowing onto the day another crop is sown: the two share sheets.
const a = towers.find(x => x.r.c.id === crops[0]), day = E.d2s(a.r.sow);
const b = towers.find(x => x.r.c.id !== a.r.c.id && E.d2s(x.r.sow) !== day);
const shift = E.dayDiff(a.r.sow, b.r.sow), moved = { ...b.p, date: E.d2s(E.addDays(E.s2d(b.p.date), shift)) };
const plan2 = { ...core, plantings: core.plantings.map(p => p.id === b.p.id ? moved : p) }, eng = E.create(plan2, Lib);
const ra = eng.calc(plan2.plantings.find(p => p.id === a.p.id)), rb = eng.calc(moved);
check('the moved sowing now falls on the same day', E.d2s(rb.sow) === day && E.d2s(ra.sow) === day, { a: E.d2s(ra.sow), b: E.d2s(rb.sow) });
const g = ra.sowing.trayGroup;
check('two crops sown the same day are one lot of rockwool', !!g && g === rb.sowing.trayGroup && g.medium === 'rockwool' && g.crops === 2, g && { crops: g.crops, medium: g.medium, cells: g.cells, trays: g.trays });
const members = plan2.plantings.map(p => eng.calc(p)).filter(r => r && r.sowing && r.sowing.trayGroup === g);
check('the lot holds the cells of all its sowings in whole sheets', g && g.cells === sum(members, r => r.sowing.cells) && g.trays === Math.ceil(g.cells / g.tray.cells) && near(sum(members, r => r.sowing.trays), g.trays), g && { cells: g.cells, members: members.length, trays: g.trays });
check('sharing takes no more sheets than sowing each crop alone', g && g.trays <= g.apart, g && { together: g.trays, apart: g.apart });
check('they need not leave for the towers on the same day', new Set(members.map(r => E.d2s(r.field))).size >= 1 && members.every(r => E.d2s(r.sow) === day));
check('seeds and cells are what each sowing had on its own', near(ra.seeds, a.r.seeds) && ra.cells === a.r.cells && rb.cells === b.r.cells && near(rb.seeds, b.r.seeds), { a: [ra.cells, a.r.cells], b: [rb.cells, b.r.cells] });
check('one open 10 × 20 tray under every sheet', g && g.carriers === g.trays);
// on the bench: each sheet takes one tray space, and the trays in use are counted whole
const mid = E.addDays(E.s2d(day), 3), use = eng.traysOn(mid), bench = eng.benchDay(mid);
const woolLots = new Map();
for (const it of bench.items) if (it.kind === 'rockwool') { const key = it.r.sowing.trayGroup || it.r.sowing.batchId; woolLots.set(key, (woolLots.get(key) || 0) + it.n); }
const expect = [...woolLots.values()].reduce((n, x) => n + Math.ceil(x - 1e-9), 0);
check('open trays in use that day are the sheets on the bench, counted whole', use.carriers === expect && use.carriers >= g.trays && near(bench.rockwool, sum([...woolLots.values()], x => x)), { carriers: use.carriers, expect, bench: bench.rockwool });
check('trays in use lists plug trays by kind and never a fraction', use.plug.every(x => Number.isInteger(x.n) && x.n > 0 && x.name) && Number.isInteger(use.carriers) && use.flats === use.carriers + use.live, use.plug.slice(0, 3));
// counted in the engine's compatibility mode, crops never share
const apart = E.create({ ...plan2, lrfNext: { ...(plan2.lrfNext || {}), trays: 'variety' } }, Lib);
check('counted in the compatibility mode, nothing shares', lotsOf(apart).length === 0 && apart.shareTrays === false);
// a plug tray is still shared only by varieties of one crop
const plugLots = [...new Set(eng.plan.plantings.map(p => { const r = eng.calc(p); return r && r.sowing && r.sowing.trayGroup; }).filter(x => x && x.medium !== 'rockwool'))];
check('plug trays are still shared only by varieties of one crop', plugLots.length > 0 && plugLots.every(x => x.crops === 1 && x.carriers === 0), { lots: plugLots.length });
console.log(results.join('\n'));
console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, lotsAsPlanned: before.length, mixedLot: g ? { cells: g.cells, sheets: g.trays, apart: g.apart } : null }));
process.exit(fail.length ? 1 : 0);
