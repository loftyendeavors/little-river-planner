// Step 3b (preview 0.23): yield, units, prices, harvest patterns, storage and turnover on the list; the audit of the same
// figures kept on plantings; the seed order sheet.
// node step3b_test.cjs <app-dir> <plan.json: a v7 backup's or the shipped compact one> [dir of the 0.22 js, to prove the build moves nothing by itself]
const path = require('path'), fs = require('fs');
const [APP, PLAN, OLD] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, figures: global.FIG || {} })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 700)}`); if (!ok) fail.push(name); };
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L; require(path.join(APP, 'js/guide.js'));
const F = require(path.join(APP, 'js/forecast.js')), A = require(path.join(APP, 'js/audit.js')), SL = require(path.join(APP, 'js/seedlib.js'));
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const clone = x => JSON.parse(JSON.stringify(x)), FIG = global.FIG = {};
const eng = E.create(core, Lib);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const listed = extra => E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, ...extra } }, Lib);
const has = (p, k) => p[k] != null && p[k] !== '';
const worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);
const dates = (e, p) => { const r = e.calc(e.planting(p.id)); return r ? [+r.first, +r.last, +(r.sow || 0)].join('/') : ''; };
const units = (e, p) => { const q = e.planting(p.id), y = e.yieldOf(q, e.calc(q)); return y ? y.units : null; };

// ── the build itself moves nothing ──
if (OLD) {
  const E0 = require(path.join(OLD, 'engine.js')), F0 = require(path.join(OLD, 'forecast.js')), old = E0.create(core, Lib);
  const off = core.plantings.filter(p => { const a = old.calc(p), b = eng.calc(p); if (!a !== !b) return true; if (!a) return false; const ya = old.yieldOf(p, a), yb = eng.yieldOf(p, b);
    return +a.first !== +b.first || +a.last !== +b.last || +(a.sow || 0) !== +(b.sow || 0) || +old.occupancyThrough(p, a) !== +eng.occupancyThrough(p, b) || !ya !== !yb || (ya && (!near(ya.units, yb.units) || ya.unit !== yb.unit || ya.price !== yb.price || ya.set !== yb.set)); });
  check('with nothing set, every planting has the dates, the ground and the yield it had in 0.22', off.length === 0, off.slice(0, 3).map(p => p.id));
  const m0 = F0.build(old), m1 = F.build(eng), k0 = new Map(m0.rows.map(r => [r.key, r]));
  const rowsOff = m1.rows.filter(r => { const o = k0.get(r.key); return !o || !near(o.total, r.total) || !near(o.worth, r.worth) || o.unit !== r.unit || Array.from(r.days).some((v, i) => !near(v, o.days[i], 1e-9)); });
  check('with nothing set, the forecast is 0.22’s day for day, crop for crop', m0.rows.length === m1.rows.length && rowsOff.length === 0, rowsOff.slice(0, 3).map(r => r.key));
  check('with nothing kept, what is picked is what there is to sell', m1.keeps === false && m1.rows.every(r => Array.from(r.days).every((v, i) => near(v, r.picked[i], 1e-9)) && near(r.total, r.pickedTotal)));
}
check('a plan with no list has nothing set on any crop’s line', eng.crops().every(c => { const x = eng.sellRule(c.id); return x.unit == null && x.price == null && x.pattern == null && x.days == null && x.keep == null && x.share == null && x.turnover == null; }));

// ── a subject: a planting in a soil bed with no figures of its own, picked over several days ──
const plainOf = (e, test) => core.plantings.find(p => { if (p.liveTray || p.done || has(p, 'yield') || has(p, 'hw') || has(p, 'price') || has(p, 'turnover') || p.harvestMode || p.harvestEnd || p.established) return false; const r = e.calc(p), b = e.bedOf(p.bedId); if (!r || !b || !e.isSoilBed(b) || e.isStandingCrop(p, r)) return false; const y = e.yieldOf(p, r); return !!y && y.units > 0 && (!test || test(p, r, y)); });
const sub = plainOf(eng, (p, r) => r.harvestMode === 'window' && r.harvestDays >= 10 && r.harvestDays === r.expectedHarvestDays);
check('the plan has a bed planting with no figures of its own to test with', !!sub);
const crop = eng.crop(sub.cropId), r0 = eng.calc(sub), y0 = eng.yieldOf(sub, r0), env = eng.envOf(eng.bedOf(sub.bedId));
const mates = core.plantings.filter(p => p.cropId === sub.cropId), others = core.plantings.filter(p => p.cropId !== sub.cropId);
FIG.subject = { crop: crop.name, env, harvestDays: r0.harvestDays, per: y0.per, unit: y0.unit, price: y0.price };

// ── unit and price: the planting's own, the variety's line, the crop's line, the crop's record ──
{
  const e1 = listed({ sell: { [sub.cropId]: { unit: 'clamshell', price: 9.5 } } }), y1 = e1.yieldOf(e1.planting(sub.id));
  check('a crop’s line sets the unit and the price for a planting with none of its own', y1.unit === 'clamshell' && y1.price === 9.5 && near(y1.units, y0.units));
  check('the unit is a word and nothing more: the yield is not converted', near(y1.per, y0.per) && near(y1.count, y0.count));
  check('other crops are untouched by one crop’s line', others.every(p => { const a = eng.yieldOf(p), b = e1.yieldOf(e1.planting(p.id)); return !a === !b && (!a || (a.unit === b.unit && a.price === b.price && near(a.units, b.units))); }));
  const v = sub.varietyId && eng.variety(sub.varietyId);
  if (v) {
    const e2 = listed({ sell: { [sub.cropId]: { unit: 'clamshell', price: 9.5 } }, sellV: { [v.id]: { unit: 'pint', price: 4 } } }), y2 = e2.yieldOf(e2.planting(sub.id));
    check('a variety’s line beats the crop’s for unit and price', y2.unit === 'pint' && y2.price === 4);
    const sister = mates.find(p => p.varietyId !== v.id && !has(p, 'price') && !p.liveTray && e2.yieldOf(e2.planting(p.id)));
    check('and only for that variety', !sister || (e2.yieldOf(e2.planting(sister.id)).unit === 'clamshell' && e2.yieldOf(e2.planting(sister.id)).price === 9.5));
    const e3 = E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, sellV: { [v.id]: { price: 4 } } }, plantings: core.plantings.map(p => p.id === sub.id ? { ...p, price: 7 } : p) }, Lib);
    check('a planting’s own price beats every line', e3.yieldOf(e3.planting(sub.id)).price === 7);
    const m = F.build(e2), keys = m.rows.filter(r => r.cropId === sub.cropId).map(r => r.unit);
    check('a variety sold in another unit is forecast in a row of its own: units are never added together', keys.includes('pint') && (!sister || keys.includes('clamshell')));
  } else check('the subject has a variety to test variety lines with', false);
  check('nonsense on a line is ignored, not used', (() => { const x = listed({ sell: { [sub.cropId]: { unit: '  ', price: -3, pattern: 'sometimes', days: 0, keep: 'x', share: 140, turnover: -1 } } }).sellRule(sub.cropId); return Object.values(x).every(v => v == null); })());
  const legacy = E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, sell: { [sub.cropId]: { unit: 'clamshell', price: 9.5, days: 3, turnover: 0, share: 10 } } } }, Lib, { multipliers: true }), plainLegacy = E.create(core, Lib, { multipliers: true });
  check('the v7 parity mode ignores the lines altogether', dates(legacy, sub) === dates(plainLegacy, sub) && near(units(legacy, sub), units(plainLegacy, sub)) && legacy.yieldOf(legacy.planting(sub.id)).unit === plainLegacy.yieldOf(plainLegacy.planting(sub.id)).unit);
}

// ── yield from the list, by growing condition ──
{
  const typed = +(y0.per * 2 + 0.5).toFixed(3), e1 = listed({ crops: { [sub.cropId]: { [env]: { yield: typed } } } }), y1 = e1.yieldOf(e1.planting(sub.id));
  check('a yield on the crop’s line is used as typed, for that growing condition', y1.by === 'crop' && near(y1.per, typed) && near(y1.units, y0.units * typed / y0.per));
  check('it moves no date', core.plantings.every(p => dates(eng, p) === dates(e1, p)));
  const elsewhere = mates.filter(p => { const b = eng.bedOf(p.bedId); return b && eng.envOf(b) !== env && !p.liveTray; });
  check('a planting of the crop in another growing condition is untouched', elsewhere.every(p => near(units(eng, p), units(e1, p))), { n: elsewhere.length });
  const ownY = mates.filter(p => has(p, 'yield') && !p.liveTray);
  check('a planting with a yield of its own keeps it', ownY.every(p => near(units(eng, p), units(e1, p))));
  const e0 = listed({ crops: { [sub.cropId]: { [env]: { yield: 0 } } } });
  check('a yield of nothing is a figure too: nothing is forecast, and it counts as set', e0.yieldOf(e0.planting(sub.id)).units === 0 && e0.yieldOf(e0.planting(sub.id)).set === true);
  const both = listed({ crops: { [sub.cropId]: { [env]: { dtm: 33, yield: typed } } } });
  check('days and a yield sit in one cell without disturbing each other', both.timingFor(sub.cropId, null, env).mine === 33 && near(both.yieldOf(both.planting(sub.id)).per, typed));
  if (sub.varietyId) {
    const e2 = listed({ crops: { [sub.cropId]: { [env]: { yield: typed } } }, varieties: { [sub.varietyId]: { [env]: { yield: typed + 1 } } } }), y2 = e2.yieldOf(e2.planting(sub.id));
    check('a variety’s yield beats the crop’s', y2.by === 'variety' && near(y2.per, typed + 1));
  }
  const e3 = E.create({ ...core, assumptions: { v: 1, crops: { [sub.cropId]: { [env]: { yield: typed } } }, varieties: {} }, plantings: core.plantings.map(p => p.id === sub.id ? { ...p, yield: 77 } : p) }, Lib), y3 = e3.yieldOf(e3.planting(sub.id));
  check('a planting’s own yield beats the list', y3.by === 'own' && y3.own === true && near(y3.per, 77));
}

// ── the marketable share ──
{
  const e1 = listed({ sell: { [sub.cropId]: { share: 50 } } }), y1 = e1.yieldOf(e1.planting(sub.id));
  check('the sold share on a crop’s line replaces the crop’s own', y1.mk === 0.5 && near(y1.units, y0.units / y0.mk * 0.5));
}

// ── how the harvest comes in ──
const model0 = F.build(eng), rowOf = (m, id, unit) => m.rows.find(r => r.cropId === id && (!unit || r.unit === unit)), entry = (m, p) => rowOf(m, p.cropId).plantings.find(x => x.p.id === p.id);
{
  const x0 = entry(model0, sub);
  check('nothing set: a total, picked evenly over the harvest days', y0.pattern === 'spread' && near(x0.out[0], y0.units / r0.harvestDays) && Array.from(x0.out).every(v => near(v, x0.out[0])) && x0.out.length === r0.harvestDays);
  const h0 = eng.harvestFor(sub.cropId);
  check('the list shows a total and what it comes to a week, over the crop’s harvest days', h0.weekly === false && h0.nominal === r0.expectedHarvestDays && near(h0.cells[env].total, y0.per) && near(h0.cells[env].weekly, y0.per * 7 / h0.nominal));
  // weekly
  const wk = +(y0.per * 7 / h0.nominal).toFixed(6), e1 = listed({ sell: { [sub.cropId]: { pattern: 'weekly' } }, crops: { [sub.cropId]: { [env]: { yield: wk } } } }), y1 = e1.yieldOf(e1.planting(sub.id)), r1 = e1.calc(e1.planting(sub.id));
  check('each week: the figure is a week’s picking, for as many weeks as the harvest lasts', y1.pattern === 'weekly' && near(y1.perWeek, wk) && near(y1.units, y1.count * wk * y1.mk * r1.harvestDays / 7));
  check('a total turned into a weekly figure over the same days forecasts the same', near(y1.units, y0.units, 1e-4));
  const e1b = listed({ sell: { [sub.cropId]: { pattern: 'weekly', days: r0.harvestDays * 2 } }, crops: { [sub.cropId]: { [env]: { yield: wk } } } });
  check('picked each week for twice as long gives twice as much', near(units(e1b, sub), 2 * units(e1, sub), 1e-6));
  // a harvest cut short: the weeks it is really picked decide, not the days a total is spoken of over
  const cut = E.d2s(E.addDays(r0.first, 6)), short = E.create({ ...core, assumptions: { v: 1, crops: { [sub.cropId]: { [env]: { yield: wk } } }, varieties: {}, sell: { [sub.cropId]: { pattern: 'weekly' } } }, plantings: core.plantings.map(p => p.id === sub.id ? { ...p, harvestEnd: cut } : p) }, Lib), ys = short.yieldOf(short.planting(sub.id)), rs = short.calc(short.planting(sub.id));
  check('picked each week for one week only gives one week’s picking', rs.harvestDays === 7 && ys.nominal === h0.nominal && near(ys.units, ys.count * wk * ys.mk));
  const e1c = listed({ sell: { [sub.cropId]: { days: r0.harvestDays * 2 } } });
  check('a total picked over twice as many days is the same total', near(units(e1c, sub), y0.units) && e1c.calc(e1c.planting(sub.id)).harvestDays === r0.harvestDays * 2);
  const e1d = listed({ sell: { [sub.cropId]: { pattern: 'weekly' } } }), h1 = e1d.harvestFor(sub.cropId);
  check('each week with no figure typed: the crop’s own total, spoken of by the week', h1.weekly && near(h1.cells[env].fallback, y0.per * 7 / h0.nominal) && near(units(e1d, sub), y0.units, 1e-6));
  const ownP = E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, sell: { [sub.cropId]: { pattern: 'weekly' } } }, plantings: core.plantings.map(p => p.id === sub.id ? { ...p, yield: 5 } : p) }, Lib), yo = ownP.yieldOf(ownP.planting(sub.id));
  check('a planting’s own yield stays a total, whatever the crop’s pattern', yo.pattern === 'spread' && yo.perWeek == null && near(yo.per, 5) && near(yo.units, yo.count * 5 * yo.mk * yo.part));
  // once
  const e2 = listed({ sell: { [sub.cropId]: { pattern: 'once' } } }), m2 = F.build(e2), x2 = entry(m2, sub);
  check('all at once: the whole total the day the crop is ready', x2.pattern === 'once' && near(x2.out[0], y0.units) && Array.from(x2.out).slice(1).every(v => v === 0) && near(units(e2, sub), y0.units));
  check('all at once holds the ground as long as before', dates(e2, sub) === dates(eng, sub) && +e2.occupancyThrough(e2.planting(sub.id), e2.calc(e2.planting(sub.id))) === +eng.occupancyThrough(sub, r0));
  const row2 = rowOf(m2, sub.cropId), row0 = rowOf(model0, sub.cropId);
  check('the pattern changes when, not how much: the crop’s season total is the same', near(row2.total, row0.total, 1e-6) || row2.plantings.some(x => x.lo + x.out.length > m2.days));
}

// ── harvest days from the list ──
{
  const days = r0.harvestDays + 9, e1 = listed({ sell: { [sub.cropId]: { days } } }), r1 = e1.calc(e1.planting(sub.id));
  check('harvest days on a crop’s line move the last harvest, and nothing before it', +r1.first === +r0.first && r1.harvestDays === days && E.dayDiff(r1.last, r0.last) === 9 && r1.harvestMode === 'window');
  const kept = mates.filter(p => (has(p, 'hw') || p.harvestMode) && !p.liveTray);
  check('a planting with harvest days of its own keeps them', kept.every(p => dates(eng, p) === dates(e1, p)), { n: kept.length });
  check('no other crop moves', others.every(p => dates(eng, p) === dates(e1, p)));
  const season = core.plantings.find(p => { const r = eng.calc(p); return r && r.harvestMode === 'season' && !p.harvestMode && !has(p, 'hw') && !p.liveTray && !p.done && !p.harvestEnd; });
  if (season) {
    const e2 = listed({ sell: { [season.cropId]: { days: 30 } } }), r2 = e2.calc(e2.planting(season.id)), h2 = e2.harvestFor(season.cropId), h0 = eng.harvestFor(season.cropId);
    check('a crop picked to the end of the season can be given a number of days instead', r2.harvestMode === 'window' && r2.harvestDays <= 30 && h2.days.mine === 30 && h0.season === true && h0.days.fallback == null && h2.nominal === 30);
  }
  const cycles = core.plantings.filter(A.cycle);
  if (cycles.length) { const c = cycles[0], e3 = listed({ sell: { [c.cropId]: { days: 20, turnover: 5 } } }); check('a tower cycle keeps its one harvest day and no turnover, whatever the crop’s line says', cycles.filter(p => p.cropId === c.cropId).every(p => dates(eng, p) === dates(e3, p) && +eng.occupancyThrough(p, eng.calc(p)) === +e3.occupancyThrough(e3.planting(p.id), e3.calc(e3.planting(p.id))))); }
  const trays = core.plantings.filter(p => p.liveTray);
  if (trays.length) { const t = trays[0], e4 = listed({ sell: { [t.cropId]: { days: 9, turnover: 9, pattern: 'weekly', share: 10, unit: 'bag', keep: 3 } }, crops: { [t.cropId]: { field: { yield: 9 } } } }); const ya = eng.yieldOf(t), yb = e4.yieldOf(e4.planting(t.id));
    check('a live tray is a tray on the day it is due, whatever is typed on its crop’s line', dates(eng, t) === dates(e4, t) && near(ya.units, yb.units) && yb.unit === 'tray' && yb.keep === 0 && e4.harvestFor(t.cropId).micro === true); }
}

// ── turnover from the list ──
{
  const base = eng.turnoverFor(sub), e1 = listed({ sell: { [sub.cropId]: { turnover: base + 4 } } }), q = e1.planting(sub.id);
  check('turnover days on a crop’s line hold its ground that much longer', e1.turnoverFor(q) === base + 4 && E.dayDiff(e1.occupancyThrough(q, e1.calc(q)), eng.occupancyThrough(sub, r0)) === 4 && dates(e1, sub) === dates(eng, sub));
  const kept = mates.filter(p => has(p, 'turnover'));
  check('a planting with turnover days of its own keeps them', kept.every(p => e1.turnoverFor(e1.planting(p.id)) === eng.turnoverFor(p)));
  check('no other crop’s ground is held differently', others.every(p => e1.turnoverFor(e1.planting(p.id)) === eng.turnoverFor(p)));
  const e0 = listed({ sell: { [sub.cropId]: { turnover: 0 } } });
  check('no turnover at all can be said', e0.turnoverFor(e0.planting(sub.id)) === 0 && e0.harvestFor(sub.cropId).turnover.mine === 0);
  // on a plan with turnover-only double bookings, a shorter turnover on the crop that goes out first settles them
  const pairs0 = A.pairs(eng), byCrop = new Map();
  for (const k of pairs0) { const [a, b] = k.split('|').map(id => eng.planting(id)), ra = eng.calc(a), rb = eng.calc(b), [x, rx, y, ry] = ra.field <= rb.field ? [a, ra, b, rb] : [b, rb, a, ra]; if (ry.field > rx.last && !has(x, 'turnover')) byCrop.set(x.cropId, (byCrop.get(x.cropId) || 0) + 1); }
  FIG.turnoverOnly = [...byCrop].map(([id, n]) => [eng.crop(id).name, n]);
  if (byCrop.size) {
    const [cropId, n] = [...byCrop].sort((a, b) => b[1] - a[1])[0], e2 = listed({ sell: { [cropId]: { turnover: 0 } } }), pairs2 = A.pairs(e2), view = A.preview(core, Lib, [{ kind: 'assume', before: null, after: e2.plan.assumptions }], eng);
    check('a shorter turnover on one line settles the double bookings that were turnover only, and starts none', pairs2.size === pairs0.size - n && [...pairs2].every(k => pairs0.has(k)), { had: pairs0.size, has: pairs2.size, n });
    check('the preview counts what it settles', view.settled.length === n && view.fresh.length === 0 && view.harvest === 0);
  }
}

// ── a crop that keeps ──
{
  const e1 = listed({ sell: { [sub.cropId]: { pattern: 'once', keep: 4 } } }), m1 = F.build(e1), x1 = entry(m1, sub), row = rowOf(m1, sub.cropId);
  check('what keeps is counted as there to sell evenly over the weeks it keeps', x1.keep === 4 && x1.avail.length === r0.harvestDays - 1 + 28 && x1.out.length === x1.avail.length && Array.from(x1.avail).slice(0, 28).every(v => near(v, y0.units / 28)) && near(Array.from(x1.avail).reduce((a, b) => a + b, 0), y0.units));
  check('what is picked is still counted the day it is picked', near(x1.out[0], y0.units) && row.keeps === 4 && m1.keeps === true);
  const i = x1.lo;
  check('the two series say different things for the same crop', i < 0 || i >= m1.days || (row.picked[i] > row.days[i] && near(F.share(x1, i, i, true), y0.units) && near(F.share(x1, i, i + 27), y0.units)));
  const e2 = listed({ sell: { [sub.cropId]: { keep: 2 } } }), m2 = F.build(e2), row2 = rowOf(m2, sub.cropId), inYear = x => x.lo + x.avail.length <= m2.days && x.lo >= 0;
  check('nothing is lost or made by keeping: over a year both series add up to the same', !row2.plantings.every(inYear) || near(row2.total, row2.pickedTotal, 1e-6));
  check('each row’s total is the sum of its days, and its worth of its value', m2.rows.every(r => near(r.total, Array.from(r.days).reduce((a, b) => a + b, 0), 1e-6) && near(r.worth, Array.from(r.value).reduce((a, b) => a + b, 0), 1e-6) && near(r.pickedTotal, Array.from(r.picked).reduce((a, b) => a + b, 0), 1e-6)));
  check('worth follows what is sold, at the crop’s price', near(row2.worth, row2.total * y0.price, 1e-6) || row2.plantings.some(x => x.price !== y0.price));
}

// ── what the list shows ──
{
  const h = eng.harvestFor(sub.cropId), all = eng.crops().map(c => [c, eng.harvestFor(c.id)]);
  check('every crop has a row, with a figure or a plain “none” in each place', all.every(([c, x]) => x && ['unit', 'price', 'pattern', 'days', 'share', 'keep', 'turnover'].every(k => 'mine' in x[k] && 'fallback' in x[k]) && eng.ENVS.every(e => x.cells[e] && 'value' in x.cells[e])));
  check('a row with nothing set shows the crop’s own figures as defaults', h.unit.mine == null && h.unit.value === y0.unit && h.price.value === y0.price && h.pattern.value === 'spread' && h.share.value === Math.round(y0.mk * 100) && h.keep.value === 0 && h.turnover.value === eng.turnoverFor(sub));
  const placeholders = all.filter(([c, x]) => !c.micro && x.open.yield), unpriced = all.filter(([, x]) => x.open.price);
  check('a yield nobody has looked at is told apart: none at all, or “1 each”', placeholders.every(([c, x]) => { const y = c.yield; return y == null || y === '' || (+y === 1 && x.unit.fallback === 'each'); }) && all.filter(([c, x]) => !c.micro && !x.open.yield).every(([c]) => Number.isFinite(+c.yield)) && all.filter(([c, x]) => !c.micro && +c.yield === 1 && x.unit.fallback === 'each').every(([, x]) => x.open.yield) && placeholders.some(([c]) => +c.yield === 1));
  FIG.open = { yield: placeholders.filter(([c]) => core.plantings.some(p => p.cropId === c.id)).map(([c]) => c.name), price: unpriced.filter(([c]) => core.plantings.some(p => p.cropId === c.id)).map(([c]) => c.name) };
  const micro = all.find(([c]) => c.micro);
  if (micro) check('a tray crop’s row is fixed but for its price', micro[1].micro && micro[1].unit.value === 'tray' && micro[1].open.yield === false && eng.ENVS.every(e => micro[1].cells[e].mine == null));
  if (sub.varietyId) { const e1 = listed({ sell: { [sub.cropId]: { price: 3 } }, crops: { [sub.cropId]: { [env]: { yield: 2.5 } } } }), hv = e1.harvestFor(sub.cropId, sub.varietyId); check('a variety’s row falls back on the crop’s line', hv.price.mine == null && hv.price.fallback === 3 && hv.cells[env].mine == null && hv.cells[env].fallback === 2.5 && hv.cells[env].by === 'crop-mine'); }
}

// ── the audit: figures of this kind kept on plantings ──
const st = A.study(core, Lib), later = st.rows.filter(r => ['yield', 'window', 'turn', 'copy'].includes(r.kind)), sv = A.survey(eng, Lib);
const open = core.plantings.filter(p => !p.liveTray && !A.recorded(p));
const ownYield = open.filter(p => has(p, 'yield')), ownWindow = open.filter(p => (has(p, 'hw') || p.harvestMode) && !A.cycle(p)), ownTurn = open.filter(p => has(p, 'turnover') && !A.cycle(p));
FIG.audit = { yield: ownYield.length, window: ownWindow.length, turnover: ownTurn.length, cycles: sv.harvest.cycles, copy: sv.harvest.copy, rows: Object.fromEntries(['yield', 'window', 'turn', 'copy'].map(k => [k, later.filter(r => r.kind === k).length])) };
const idsOf = kind => later.filter(r => r.kind === kind).flatMap(r => r.ids);
check('every planting with a yield of its own is in exactly one yield row', idsOf('yield').length === ownYield.length && new Set(idsOf('yield')).size === ownYield.length && ownYield.every(p => idsOf('yield').includes(p.id)));
check('every planting with harvest days of its own is in exactly one row, tower cycles apart', idsOf('window').length === ownWindow.length && new Set(idsOf('window')).size === ownWindow.length);
check('every planting with turnover days of its own is in exactly one row, tower cycles apart', idsOf('turn').length === ownTurn.length && new Set(idsOf('turn')).size === ownTurn.length);
check('the summary counts the same plantings', sv.harvest.yield === ownYield.length && sv.harvest.window === ownWindow.length && sv.harvest.turnover === ownTurn.length);
check('no tray batch and no tower cycle’s harvest day or turnover is ever offered', later.filter(r => r.kind !== 'yield' && r.kind !== 'copy').every(r => r.ids.every(id => !A.cycle(eng.planting(id)))) && later.every(r => r.ids.every(id => !eng.planting(id).liveTray)));
check('a row that agrees is suggested to follow, one the list can take to be taken, the rest kept', later.every(r => r.choice === (r.agrees ? 'follow' : r.take ? 'take' : 'keep')));
const step = A.build(core, later, null), view = A.preview(core, Lib, step.ops, eng);
FIG.suggested = { plantings: step.plantings, taken: step.taken, kept: step.kept, harvest: view.harvest, yields: view.yields.length, ground: view.ground.length, fresh: view.fresh.length, worth: view.worth.map(Math.round) };
check('the suggested step moves no date, changes no yield, holds no ground differently and starts no double booking', view.harvest === 0 && view.sowing === 0 && view.yields.length === 0 && view.ground.length === 0 && view.fresh.length === 0 && view.settled.length === 0 && view.crops.length === 0 && near(view.worth[0], view.worth[1], 1e-9));
const after = A.apply(core, step.ops), e2 = E.create(after, Lib);
{
  const gone = new Set(later.filter(r => r.choice !== 'keep').flatMap(r => r.ids)), still = later.filter(r => r.choice === 'keep');
  const KEPT = { yield: ['yield'], window: ['hw', 'harvestMode'], turn: ['turnover'] };
  check('what it lets go no longer carries the figure', later.filter(r => r.choice !== 'keep').every(r => r.ids.every(id => { const p = e2.planting(id); return r.kind === 'yield' ? !has(p, 'yield') : r.kind === 'window' ? !has(p, 'hw') && !p.harvestMode : r.kind === 'turn' ? !has(p, 'turnover') : true; })));
  check('what it keeps is untouched', still.every(r => r.ids.every(id => r.kind === 'copy' || (KEPT[r.kind] || []).every(k => JSON.stringify(e2.planting(id)[k]) === JSON.stringify(eng.planting(id)[k])))));   // a planting can be kept in one row and let go in another: a kept row answers for its own figure
  check('a planting is counted once, however many of its figures are let go', step.plantings === gone.size && step.plantings <= open.length);
  check('nothing else about a planting changes', core.plantings.every(p => { const q = e2.planting(p.id), strip = x => { const y = { ...x }; for (const k of ['yield', 'hw', 'harvestMode', 'turnover', 'growingDefaults']) delete y[k]; return JSON.stringify(y); }; return strip(p) === strip(q); }));
  const st2 = A.study(after, Lib), later2 = st2.rows.filter(r => ['yield', 'window', 'turn'].includes(r.kind));
  check('afterwards only the kept rows are left to review', later2.flatMap(r => r.ids).every(id => still.some(r => r.ids.includes(id))) && later2.every(r => r.choice === 'keep'));
  const takes = later.filter(r => r.choice === 'take'), lines = after.assumptions || {};
  check('each figure the list took is on its line', takes.every(r => r.take.what === 'yield' ? near(lines[r.take.level === 'crop' ? 'crops' : 'varieties'][r.take.id][r.take.env].yield, r.take.typed) : lines.sell[r.take.id][r.take.what === 'window' ? 'days' : 'turnover'] === r.take.typed));
  check('the forecast after the step is the forecast before it', (() => { const a = F.build(eng), b = F.build(e2), kb = new Map(b.rows.map(r => [r.key, r])); return a.rows.length === b.rows.length && a.rows.every(r => kb.has(r.key) && near(r.total, kb.get(r.key).total) && near(r.worth, kb.get(r.key).worth)); })());
}
// "use the list's" where the list differs: the preview says what it does
{
  const differ = later.find(r => r.kind === 'yield' && !r.agrees);
  if (differ) {
    const s2 = A.build(core, later, Object.fromEntries(later.map(r => [r.key, r === differ ? 'follow' : 'keep']))), v2 = A.preview(core, Lib, s2.ops, eng);
    check('using the list’s yield where it differs changes those plantings’ yield, and the preview lists each', v2.yields.length === differ.ids.length && v2.yields.every(y => differ.ids.includes(y.id)) && v2.crops.some(c => c.cropId === differ.cropId) && v2.harvest === 0);
    check('and what that does to the season’s worth', !near(v2.worth[0], v2.worth[1]) || v2.yields.every(y => y.price[0] === 0));
  }
  const win = later.find(r => r.kind === 'window' && !r.agrees);
  if (win) { const s3 = A.build(core, later, Object.fromEntries(later.map(r => [r.key, r === win ? 'follow' : 'keep']))), v3 = A.preview(core, Lib, s3.ops, eng); check('using the list’s harvest days where they differ moves the last harvest, and the preview counts it', v3.harvest >= 1 && v3.moves.every(m => win.ids.includes(m.id) && m.first === 0 && m.last !== 0)); FIG.windowFollow = { rows: win.ids.length, moved: v3.harvest, fresh: v3.fresh.length }; }
  const keepAll = A.build(core, later, Object.fromEntries(later.map(r => [r.key, 'keep'])));
  check('keeping everything is no step at all', keepAll.ops.length === 0 && keepAll.plantings === 0);
}
// a line that already holds the grower's own figure is never written over
{
  const t = later.find(r => r.kind === 'yield' && r.take && r.take.level === 'crop');
  if (t) {
    const mine = { ...core, assumptions: { v: 1, crops: { [t.take.id]: { [t.take.env]: { dtm: 41, yield: t.take.typed + 3 } } }, varieties: {} } }, stM = A.study(mine, Lib), rowM = stM.rows.filter(r => r.kind === 'yield' && r.cropId === t.cropId && r.env === t.env && t.ids.some(id => r.ids.includes(id)));
    check('a crop line that already holds the grower’s yield is not taken over', rowM.length > 0 && rowM.every(r => !r.take || r.take.level !== 'crop'));
    const days = { ...core, assumptions: { v: 1, crops: { [t.take.id]: { [t.take.env]: { dtm: 41 } } }, varieties: {} } }, stD = A.study(days, Lib), rowD = stD.rows.find(r => r.kind === 'yield' && r.take && r.take.level === 'crop' && r.take.id === t.take.id && r.take.env === t.take.env);
    if (rowD) { const out = A.apply(days, A.build(days, [rowD], null).ops); check('a yield the list takes goes in beside the days already in that cell', out.assumptions.crops[t.take.id][t.take.env].dtm === 41 && near(out.assumptions.crops[t.take.id][t.take.env].yield, rowD.take.typed)); }
  }
}
// a crop's line is not taken where it would change another planting of the crop
{
  const big = +(y0.per * 3 + 1).toFixed(3), odd = { ...core, plantings: core.plantings.map(p => p.id === sub.id ? { ...p, yield: big } : p) }, stO = A.study(odd, Lib), rowO = stO.rows.find(r => r.kind === 'yield' && r.ids.includes(sub.id)), engO = E.create(odd, Lib);
  const sameEnv = odd.plantings.filter(p => p.cropId === sub.cropId && p.id !== sub.id && !p.liveTray && !has(p, 'yield') && engO.envOf(engO.bedOf(p.bedId)) === env);
  check('(the subject’s crop has other plantings in the same growing condition that follow the list)', sameEnv.length > 0);
  check('one planting’s own yield is not put on the crop’s line when others of the crop follow that line', !!rowO && !rowO.agrees && (!rowO.take || rowO.take.level === 'variety'), rowO && rowO.take);
  if (rowO && rowO.take) { const out = A.apply(odd, A.build(odd, [rowO], null).ops), e3 = E.create(out, Lib); check('and where the variety’s line takes it, every planting still yields what it did', odd.plantings.every(p => A.alike(A.figure(engO, p), A.figure(e3, e3.planting(p.id))))); }
  // days the list takes go in beside a yield already in that cell
  const dayRow = st.rows.find(r => r.kind === 'days' && r.take);
  if (dayRow) {
    const kind = dayRow.take.level === 'crop' ? 'crops' : 'varieties', withY = { ...core, assumptions: { v: 1, crops: {}, varieties: {}, [kind]: { [dayRow.take.id]: { [dayRow.take.env]: { yield: 3.5 } } } } }, stY = A.study(withY, Lib), rowY = stY.rows.find(r => r.key === dayRow.key);
    if (rowY && rowY.take) { const out = A.apply(withY, A.build(withY, [rowY], null).ops), cell = out.assumptions[kind][dayRow.take.id][dayRow.take.env]; check('days the list takes go in beside a yield already in that cell', cell.yield === 3.5 && cell.dtm === rowY.take.typed, cell); }
  }
}
// recorded work is never offered
{
  const p = ownYield[0] || ownWindow[0];
  if (p) {
    const rec = { ...core, plantings: core.plantings.map(x => x.id === p.id ? { ...x, done: { ...(x.done || {}), sow: '2027-03-01' } } : x) }, stR = A.study(rec, Lib);
    check('a planting with recorded work is not offered, and is counted as held', stR.rows.every(r => !r.ids.includes(p.id)) && stR.held >= 1 && A.survey(E.create(rec, Lib), Lib).harvest.recorded === 1);
  }
}
// the old planner's copies
{
  const copies = later.filter(r => r.kind === 'copy'), same = copies.find(r => r.same), differ = copies.filter(r => !r.same);
  if (same) {
    const s = A.build(core, [same], null), out = A.apply(core, s.ops), e3 = E.create(out, Lib);
    check('letting go copies that say what the crop says changes nothing', core.plantings.every(p => A.alike(A.figure(eng, p), A.figure(e3, e3.planting(p.id)))) && same.ids.every(id => same.fields[id].every(k => !(k in e3.planting(id).growingDefaults.crop))));
    check('and leaves the rest of the copy where it was', same.ids.every(id => { const a = eng.planting(id).growingDefaults.crop, b = e3.planting(id).growingDefaults.crop; return Object.keys(a).filter(k => !same.fields[id].includes(k)).every(k => JSON.stringify(a[k]) === JSON.stringify(b[k])); }));
  }
  check('a copy that differs is its own row, kept unless letting it go changes nothing', differ.every(r => r.field && A.COPY.includes(r.field) && r.choice === (r.agrees ? 'follow' : 'keep')));
  const real = differ.find(r => !r.agrees && r.field === 'price') || differ.find(r => !r.agrees);
  if (real) { const s = A.build(core, [real], { [real.key]: 'follow' }), v = A.preview(core, Lib, s.ops, eng); check('letting go a copy that matters says what it does before it does it', v.yields.length + v.harvest + v.ground.length > 0); FIG.copy = { field: real.field, was: real.value, now: real.now, plantings: real.ids.length, worth: v.worth.map(Math.round) }; }
  check('only values that bear on the harvest are offered: a bulb stays a bulb', copies.every(r => r.same ? Object.values(r.fields).every(list => list.every(k => A.COPY.includes(k))) : A.COPY.includes(r.field)) && !A.COPY.includes('material') && !A.COPY.includes('plantingMaterial') && !A.COPY.includes('gh'));
}
// the two halves of the review together
{
  const all = A.build(core, st.rows, null), vAll = A.preview(core, Lib, all.ops, eng);
  check('the whole suggested review (days and yields) still moves nothing', vAll.harvest === 0 && vAll.sowing === 0 && vAll.fresh.length === 0 && vAll.yields.length === 0 && near(vAll.worth[0], vAll.worth[1], 1e-9));
  FIG.whole = { plantings: all.plantings, taken: all.taken, kept: all.kept };
}

// ── the plan file: a list that holds only lines of this kind is still a list ──
{
  const mine = { ...clone(core), assumptions: { v: 1, crops: {}, varieties: {}, sell: { [sub.cropId]: { price: 9 } } }, lrfNext: { ...(core.lrfNext || {}) } };
  delete mine.lrfNext.sample;
  const carried = IO.carry(mine, clone(core));
  check('a list holding only a price is carried onto a newer backup', !!carried.plan.assumptions && carried.plan.assumptions.sell[sub.cropId].price === 9);
}

// ── the seed order sheet ──
{
  const need = SL.required(eng), stock = SL.stock(core.seedInventory);
  for (const r of need.rows) { const key = r.variety ? 'v:' + r.variety.id : 'c:' + (r.crop && r.crop.id), s = stock[key + '|' + SL.stockUnit(r.unit)] || { onHand: 0, onOrder: 0 }; r.onHand = s.onHand; r.onOrder = s.onOrder; r.short = Math.max(0, Math.ceil(r.toSow - s.onHand - s.onOrder)); }
  const coverFor = (amount, unit, v) => SL.toCover(amount, unit, v), sheet = SL.orderSheet(need.rows, coverFor), short = need.rows.filter(r => r.short > 0);
  FIG.order = { lines: sheet.lines, suppliers: sheet.groups.length, cost: Math.round(sheet.cost), unpriced: sheet.unpriced, loose: sheet.loose.length };
  check('every variety that is short is on the sheet once, and nothing that is not', sheet.lines === short.filter(r => r.variety).length && sheet.loose.length === short.filter(r => !r.variety).length && new Set(sheet.groups.flatMap(g => g.lines.map(l => l.key))).size === sheet.lines);
  check('a supplier is one group however its name is written', new Set(sheet.groups.map(g => g.key)).size === sheet.groups.length && sheet.groups.every(g => g.lines.every(l => (SL.supplierOf(l.variety) ? SL.supplierKey(SL.supplierOf(l.variety)) : '') === g.key)));
  check('each line is what covers its shortfall in that supplier’s sizes', sheet.groups.every(g => g.lines.every(l => l.amount === l.short && (!l.sized || (l.buy >= l.amount && l.text)))));
  check('a supplier’s cost is the sum of its priced lines, and the total the sum of those', sheet.groups.every(g => near(g.cost, g.lines.reduce((n, l) => n + (l.cost || 0), 0)) && g.unpriced === g.lines.filter(l => l.cost == null).length) && near(sheet.cost, sheet.groups.reduce((n, g) => n + g.cost, 0)));
  const first = sheet.groups.flatMap(g => g.lines).find(l => l.sized && l.cost != null);
  if (first) {
    const more = SL.orderSheet(need.rows, coverFor, { [first.key]: first.buy * 3 + 1 }), line = more.groups.flatMap(g => g.lines).find(l => l.key === first.key);
    check('an amount typed on a line is what that line covers', line.amount === first.buy * 3 + 1 && line.set === true && line.buy >= line.amount && line.cost > first.cost && more.lines === sheet.lines);
    const none = SL.orderSheet(need.rows, coverFor, { [first.key]: 0 });
    check('an amount of nothing takes the line off the sheet', none.lines === sheet.lines - 1);
  }
  const spare = need.rows.find(r => r.variety && !(r.short > 0) && r.unit === 'seeds');
  if (spare) { const top = SL.orderSheet(need.rows, coverFor, { [spare.key]: 25 }); check('a variety that is not short can be added for a top-up', top.lines === sheet.lines + 1 && top.groups.flatMap(g => g.lines).find(l => l.key === spare.key).amount === 25); }
  const text = SL.orderText(sheet, { farm: 'A farm', year: 2027, date: 'Nov 12, 2026', notes: ['A note.'] }), csv = SL.orderCsv(sheet);
  check('the text names every supplier and every line, and ends with the total and the notes', sheet.groups.every(g => text.includes(g.name)) && sheet.groups.flatMap(g => g.lines).every(l => text.includes(l.variety.name)) && text.includes('Total: ' + SL.money(sheet.cost)) && text.trim().endsWith('A note.'));
  check('the spreadsheet has a row for every line', csv.split('\r\n').length === 1 + sheet.lines + sheet.loose.length && csv.startsWith('Supplier,Crop,Variety'));
  const empty = SL.orderSheet(need.rows.map(r => ({ ...r, short: 0 })), coverFor);
  check('with nothing short the sheet is empty and says so', empty.lines === 0 && empty.groups.length === 0 && SL.orderText(empty, {}).includes('Nothing is short.'));
}

finished = true;
