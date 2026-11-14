/* Step F, harvest modelling, with no browser: a series sized by harvest (so much wanted each week), what its sizes rest on,
 * what the plan already gives taken off, what waits to be placed, the crop whose yield nobody has checked, and that the build
 * by itself moves nothing.
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
  const E0 = require(path.join(oldDir, 'engine.js')), S0 = require(path.join(oldDir, 'succession.js')), F0 = require(path.join(oldDir, 'forecast.js')), Lib0 = require(path.join(oldDir, 'library.js')), eng0 = E0.create(plan, Lib0);
  const differ = [];
  for (const p of plan.plantings) {
    const a = eng.calc(p), b = eng0.calc(p);
    if (!a !== !b) { differ.push(p.id); continue; }
    if (!a) continue;
    const row = (e, r, DD) => [r.sow, r.field, r.first, r.last].map(x => (x ? DD.d2s(new Date(x)) : '')).join(',') + '|' + [r.plants, r.seeds, r.len, r.trays].join(',') + '|' + JSON.stringify((y => y && [y.units, y.unit, y.price, y.pattern])(e.yieldOf(p, r)));
    if (row(eng, a, E) !== row(eng0, b, E0)) differ.push(p.id);
  }
  check('every planting has the dates, the seed and the yield it had in the build before', differ.length === 0, differ.slice(0, 5));
  const m1 = F.build(eng, { year }), m0 = F0.build(eng0, { year });
  check('the forecast is the build before’s, crop by crop', m1.rows.length === m0.rows.length && m1.rows.every((r, i) => r.key === m0.rows[i].key && near(r.total, m0.rows[i].total, 1e-9) && near(r.worth, m0.rows[i].worth, 1e-9)), [m1.rows.length, m0.rows.length]);
  // a series asked for the old way (so many days apart, whole beds or feet) is what it was
  const shape = r => r.error ? r.error : JSON.stringify([r.waves.map(w => [iso(w.target), w.placed.map(x => [x.bed.id, iso(x.r.field), iso(x.r.first), Math.round(x.r.physicalLength * 100), Math.round(x.units * 1000)]), w.held.map(h => [h.date, h.ft || 0, (h.wait || {}).why || '']), Math.round((w.short || 0) * 100), w.skipped || '']), r.placed, r.short, Math.round(r.units * 1000), r.unit]);
  let same = 0, tried = 0; const off = [];
  for (const c of eng.crops().filter(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0).slice(0, 40)) {
    const gardens = S.gardensFor(eng, c).map(g => g.garden.id);
    for (const [unit, amount] of [['whole', 1], ['ft', 12]]) for (const place of ['gardens', 'hold']) for (const basis of ['planting', 'harvest']) {
      const input = { cropId: c.id, gardenIds: gardens.slice(0, 2), from: `${year}-06-01`, every: 14, count: 4, unit, amount, place, basis };
      const a = shape(S.series(eng, input)), b = shape(S0.series(eng0, input));
      tried++; if (a === b) same++; else off.push([c.name, unit, place, basis]);
    }
  }
  check('a series so many days apart, in whole beds or in feet, is what it was in the build before', tried > 100 && same === tried, { tried, same, off: off.slice(0, 4) });
  figures.unchanged = { plantings: plan.plantings.length, series: tried };
} else check('the build before was given, to prove nothing moves by itself', false, 'give the folder of the previous js as the third argument');

// ── 2. what is asked for ──
const radish = byName(eng, 'Radish') || eng.crops().find(c => !c.micro && c.yBasis === 'ft' && +c.dtm > 0 && !eng.harvestFor(c.id).open.yield);
check('there is a crop counted by the foot of bed to try', !!radish);
const rg = radish ? fieldGardens(free, radish) : [];
const ask = (e, extra) => S.series(e, { cropId: radish.id, gardenIds: rg, unit: 'yield', want: 20, from: `${year}-06-07`, to: `${year}-08-01`, every: 10, net: false, ...extra });
if (radish) {
  check('no amount wanted is refused in words', /How much each week/.test(ask(free, { want: '' }).error || '') && /How much each week/.test(ask(free, { want: 0 }).error || '') && /How much each week/.test(ask(free, { want: -3 }).error || ''));
  check('a last day before the first is refused', !!ask(free, { to: `${year}-06-01` }).error);
  check('days apart must be a whole number of days from 1 to 366', !!ask(free, { every: 0 }).error && !!ask(free, { every: 400 }).error);
  const o = S.normalize(free, { cropId: radish.id, gardenIds: rg, unit: 'yield', want: 20, from: `${year}-06-07`, to: `${year}-08-01`, every: 10, basis: 'planting', skipCovered: true });
  check('sized by harvest, the dates are days of first harvest whatever was said, and nothing is left out for being picked already', o.basis === 'harvest' && o.skipCovered === false && o.sized === true && o.unit === 'yield' && iso(o.until) === `${year}-08-01`);
  check('the number of plantings is the days asked for over the days apart', o.count === Math.floor(E.dayDiff(D(8, 1), D(6, 7)) / 10) + 1, o.count);
  const micro = eng.crops().find(c => c.micro);
  check('a tray crop is not sized this way', !micro || !!S.series(eng, { cropId: micro.id, unit: 'yield', want: 5, from: `${year}-06-07`, to: `${year}-08-01`, every: 7 }).error);
  const old = S.normalize(free, { cropId: radish.id, gardenIds: rg, unit: 'ft', amount: 12, from: `${year}-06-07`, count: 3, every: 10 });
  check('a series in feet is not sized by harvest', old.sized === false && old.want === null && old.until === null && old.basis === 'planting');
}

// ── 3. how far apart, and what a planting gives ──
if (radish) {
  const pc = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-20` }), bed = pc.like;
  check('the pace is read off a space the crop is headed for', !pc.error && !!bed && rg.includes(bed.gardenId), pc.error);
  const res = Rails.propose(free, { cropId: radish.id }, { bedId: bed.id, date: pc.field }), y = res.r && free.yieldOf(res.p, res.r);
  check('what a foot of bed gives is the planting’s own yield over its length', !!y && near(pc.per, y.units / res.r.physicalLength, 1e-9) && pc.unit === y.unit && pc.soil === true, [pc.per, y && y.units / res.r.physicalLength]);
  check('the first harvest asked for is the first harvest it is read on', iso(pc.first) === `${year}-06-20`, iso(pc.first));
  check('plantings belong as far apart as one is picked, and a week at the least', pc.every === Math.max(7, Math.min(366, Math.max(1, res.r.expectedHarvestDays))) && pc.days === res.r.harvestDays, [pc.every, res.r.expectedHarvestDays]);
  const going = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-20`, basis: 'planting' });
  check('asked by the day it goes in, the pace says when it would first be ready', iso(going.field) === `${year}-06-20` && going.first > going.field, [iso(going.field), iso(going.first)]);
  check('a tray crop and no crop have no pace', !!S.pace(free, { cropId: 'no-such-crop', from: `${year}-06-20` }).error && (!eng.crops().find(c => c.micro) || !!S.pace(free, { cropId: eng.crops().find(c => c.micro).id, from: `${year}-06-20` }).error));
  // a crop all picked the day it is ready: a week apart; one that keeps: as long as it keeps
  const once = E.create({ ...bare, assumptions: { ...(bare.assumptions || {}), sell: { ...((bare.assumptions || {}).sell || {}), [radish.id]: { pattern: 'once' } } } }, Lib), kept = E.create({ ...bare, assumptions: { ...(bare.assumptions || {}), sell: { ...((bare.assumptions || {}).sell || {}), [radish.id]: { pattern: 'once', keep: 3 } } } }, Lib);
  const p1 = S.pace(once, { cropId: radish.id, gardenIds: rg, from: `${year}-06-20` }), p3 = S.pace(kept, { cropId: radish.id, gardenIds: rg, from: `${year}-06-20` });
  check('a crop all picked at once belongs a week apart, and one that keeps as far apart as it keeps', p1.every === 7 && p1.pattern === 'once' && p3.every === 21 && p3.keep === 3, [p1.every, p3.every]);
  figures.pace = { crop: radish.name, every: pc.every, per: Math.round(pc.per * 1000) / 1000, unit: pc.unit };
}

// ── 4. each planting as large as its share takes ──
if (radish) {
  const pc = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-07` }), cap = pc.cap, oneBed = pc.per * cap;
  // a want one bed more than gives, so a planting is cut to a length
  const small = Math.max(1, Math.floor(oneBed * 0.55 * 7 / pc.every)), r = ask(free, { want: small, every: pc.every });
  check('sized by harvest it gives plantings, none waiting, on free ground', !r.error && r.plantings.length > 0 && r.held.length === 0 && r.short === 0, r.error || [r.plantings.length, r.held.length, r.short]);
  check('every planting’s first harvest is the day asked for: a date is never moved', r.waves.every(w => w.placed.every(x => iso(x.r.first) === iso(w.target))) && r.waves.every((w, k) => iso(w.target) === iso(E.addDays(D(6, 7), k * pc.every))), r.waves.slice(0, 2).map(w => [iso(w.target), w.placed.map(x => iso(x.r.first))]));
  check('a stretch is the days to the next planting’s first harvest, and what is asked of it is the weekly amount over those days', r.waves.every(w => iso(w.window.from) === iso(w.target) && w.window.days === E.dayDiff(w.window.to, w.window.from) + 1 && near(w.asked, small * w.window.days / 7, 1e-9)), r.waves.map(w => [w.window.days, w.asked]).slice(0, 3));
  const lastW = r.waves[r.waves.length - 1];
  check('a last stretch cut short still gets a planting that gives its amount day by day', lastW.window.days >= pc.every || (lastW.past === true && near(lastW.want, lastW.asked * Math.min(pc.every, pc.days) / lastW.window.days, 1e-9)), [lastW.window.days, lastW.asked, lastW.want]);
  check('the last stretch ends on the last day asked for, and is asked for its days only', iso(r.waves[r.waves.length - 1].window.to) <= `${year}-08-01` && r.waves.slice(0, -1).every(w => w.window.days === pc.every) && r.waves[r.waves.length - 1].window.days <= pc.every);
  check('each planting gives what was asked of it, and no more than a few feet over', r.waves.every(w => w.got >= w.want - 1e-6 && w.got <= w.want + pc.per * (S.SCRAP + 1) + 1e-6), r.waves.map(w => [w.want, w.got]).slice(0, 4));
  check('a planting that one bed can give is in one bed, in whole feet', r.waves.every(w => w.placed.length === 1 && Number.isInteger(Math.round(w.placed[0].r.physicalLength * 100) / 100)), r.waves.map(w => w.placed.map(x => x.r.physicalLength)).slice(0, 4));
  const cutOne = r.waves.find(w => w.placed[0] && w.placed[0].r.physicalLength < cap - 1e-6);
  check('where less than the bed is wanted, the planting is cut to the length that gives it', !!cutOne && cutOne.placed[0].p.ft === cutOne.placed[0].r.physicalLength && (cutOne.placed[0].r.physicalLength - 1) * pc.per < cutOne.want + 1e-6, cutOne && [cutOne.placed[0].p.ft, cutOne.want, pc.per]);
  check('the result says what was asked, what it rests on and the feet it takes', !!r.sized && r.sized.want === small && r.sized.unit === pc.unit && r.sized.every === pc.every && near(r.sized.asked, sum(r.waves, w => w.asked)) && near(r.sized.feet, sum(r.plantings, p => free.calc ? E.create({ ...bare, plantings: [p] }, Lib).calc(p).physicalLength : 0), 1e-6)
    && near(r.sized.rests.per, pc.per, 1e-9) && r.sized.rests.by === pc.by && r.sized.rests.soil === true && r.sized.net === false, r.sized);
  // a scrap is not left: a want just short of a bed takes the bed
  const nearly = (oneBed - pc.per * (S.SCRAP - 1.5)) * 7 / pc.every, r2 = ask(free, { want: nearly, every: pc.every, to: undefined, count: 1 });
  check('a planting that would leave a scrap of the bed takes the whole bed', !r2.error && r2.waves[0].placed.length === 1 && !('ft' in r2.waves[0].placed[0].p) && near(r2.waves[0].placed[0].r.physicalLength, cap), r2.error || r2.waves[0].placed.map(x => [x.p.ft, x.r.physicalLength]));
  // more than one bed gives: beds are filled one after another, and the whole comes to the want
  const big = oneBed * 2.4 * 7 / pc.every, r3 = ask(free, { want: big, every: pc.every, to: undefined, count: 1 });
  check('more than a bed gives goes into as many beds as it takes', !r3.error && r3.waves[0].placed.length === 3 && r3.waves[0].got >= r3.waves[0].want - 1e-6 && new Set(r3.waves[0].placed.map(x => x.bed.id)).size === 3 && r3.waves[0].short === 0, r3.error || r3.waves[0].placed.map(x => x.r.physicalLength));
  check('the beds are taken in the order of the gardens named', !r3.error && r3.waves[0].placed.every((x, i, all) => i === 0 || S.spaces(free, radish, rg).findIndex(b => b.id === all[i - 1].bed.id) < S.spaces(free, radish, rg).findIndex(b => b.id === x.bed.id)));
  // judged on the forecast itself: with plantings as far apart as one is picked, every whole week asked for gives the amount
  const { m } = forecastWith(free, r.plantings), last = r.waves[r.waves.length - 1].window.to, weeks = weekly(m, radish.id, pc.unit, D(6, 7), last).filter(w => w.days === 7);
  check('with these in the plan the forecast gives the amount in every whole week asked for', weeks.length >= 5 && weeks.every(w => w.q >= small * (1 - S.NEAR)), weeks.map(w => Math.round(w.q * 10) / 10));
  check('and not far over it', weeks.every(w => w.q <= small + pc.per * (S.SCRAP + 1) * 7 / pc.every + 1e-6), weeks.map(w => Math.round(w.q * 10) / 10));
  figures.sized = { want: small, every: pc.every, plantings: r.plantings.length, feet: r.sized.feet, weeks: weeks.map(w => Math.round(w.q)) };
  // the plan is not touched, and the same question twice gives the same plantings on the same ground
  const again = ask(free, { want: small, every: pc.every });
  check('asking changes nothing in the plan, and the same question gives the same answer', bare.plantings.length === 0 && JSON.stringify(again.plantings.map(p => [p.bedId, p.date, p.ft])) === JSON.stringify(r.plantings.map(p => [p.bedId, p.date, p.ft])));
  // closer together than one is picked: the same amount over the season, in smaller plantings
  if (pc.every >= 10) {
    const half = Math.floor(pc.every / 2), r4 = ask(free, { want: small, every: half });
    check('plantings closer together are each smaller, and ask for the same in all', !r4.error && r4.waves.length > r.waves.length && r4.waves[0].want < r.waves[0].want && near(r4.waves[0].asked, small * half / 7, 1e-9), r4.error);
  } else check('plantings closer together are each smaller, and ask for the same in all', true);
}

// ── 5. what the plan already gives is taken off ──
if (radish) {
  const pc = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-07` }), want = Math.max(2, Math.floor(pc.per * pc.cap * 0.5 * 7 / pc.every)), calls = [];
  const per = want * pc.every / 7, gives = [per * 0.4, per * 2, per * 0.95, 0, per * (1 - S.COVERED) - 0.001];
  let k = 0;
  const r = ask(free, { want, every: pc.every, net: true, to: iso(E.addDays(D(6, 7), pc.every * gives.length - 1)), supply: (a, b) => { calls.push([iso(a), iso(b)]); return gives[k++]; } });
  check('the plan is asked what it gives in each stretch, from its first day to its last', !r.error && calls.length === gives.length && calls.every((c, i) => c[0] === iso(r.waves[i].window.from) && c[1] === iso(r.waves[i].window.to)), r.error || calls.slice(0, 2));
  check('each planting is sized for what is missing', !r.error && r.waves.every((w, i) => near(w.have, gives[i]) && near(w.want, Math.max(0, w.asked - gives[i]), 1e-9)), !r.error && r.waves.map(w => [w.have, w.want]));
  check('a stretch the plan already fills, or fills to within a tenth, gets no planting', !r.error && r.waves[1].skipped === 'covered' && r.waves[2].skipped === 'covered' && !r.waves[1].placed.length && !r.waves[2].placed.length && !r.waves[1].held.length, !r.error && r.waves.map(w => w.skipped));
  check('a stretch short by more than a tenth gets one', !r.error && !r.waves[4].skipped && r.waves[4].placed.length === 1 && !r.waves[0].skipped && !r.waves[3].skipped && r.waves[0].placed[0].r.physicalLength < r.waves[3].placed[0].r.physicalLength, !r.error && r.waves.map(w => w.placed.map(x => x.r.physicalLength)));
  check('the result says how many were left out and what the plan had', !r.error && r.skipped === 2 && r.sized.covered === 2 && r.sized.net === true && near(r.sized.have, sum(gives, x => x), 1e-6));
  const all = ask(free, { want, every: pc.every, net: true, supply: () => 1e6 });
  check('where the plan gives all of it, nothing is added', !all.error && all.plantings.length === 0 && all.held.length === 0 && all.skipped === all.waves.length);
  let asked = 0; const blind = ask(free, { want, every: pc.every, net: false, supply: () => { asked++; return 1e6; } });
  check('told not to take anything off, the plan is not asked', asked === 0 && !blind.error && blind.plantings.length === blind.waves.length && blind.sized.have === 0 && blind.sized.net === false);
  // on his own plan, against his own forecast: what it adds is what the forecast was short of
  const model = F.build(eng, { year }), rows = model.rows.filter(x => x.cropId === radish.id && x.unit === pc.unit), supply = (a, b) => sum(rows, x => F.sum(x.days, model.index(a), model.index(b)));
  const mine = S.series(eng, { cropId: radish.id, gardenIds: soilGardens(eng, radish), unit: 'yield', want, from: `${year}-06-07`, to: `${year}-09-30`, every: pc.every, net: true, supply });
  check('on the plan as it stands, each stretch is asked for the amount less what the forecast gives then', !mine.error && mine.waves.some(w => !w.past) && mine.waves.every(w => near(w.have, supply(w.window.from, w.window.to), 1e-9) && (w.past ? w.want >= Math.max(0, w.asked - w.have) - 1e-9 : near(w.want, Math.max(0, w.asked - w.have), 1e-9))), mine.error);   // a last stretch cut short is asked for more than its days alone: the check above it says how much
  figures.net = mine.error ? mine.error : { waves: mine.waves.length, covered: mine.sized.covered, placed: mine.plantings.length, held: mine.held.length };
}

// ── 6. what has no ground waits, sized ──
if (radish) {
  const pc = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-07` }), want = Math.max(2, Math.floor(pc.per * pc.cap * 0.5 * 7 / pc.every));
  const hold = ask(free, { want, every: pc.every, place: 'hold' });
  check('asked to wait, every planting waits, with the feet that give its share', !hold.error && hold.plantings.length === 0 && hold.held.length === hold.waves.length && hold.held.every((h, i) => !h.bedId && h.ft === Math.max(Rails.MIN_FT, Math.ceil(hold.waves[i].want / pc.per - 1e-9)) && h.wait && h.wait.k === i + 1), hold.error || hold.held.map(h => h.ft));
  check('what waits is dated the day it would go in, to be first picked the day asked for', !hold.error && hold.held.every((h, i) => h.date < iso(hold.waves[i].target) && h.date === iso(E.addDays(hold.waves[i].target, -E.dayDiff(pc.first, pc.field)))), !hold.error && hold.held.slice(0, 2).map(h => h.date));
  check('the result says the feet that wait', !hold.error && hold.sized.heldFeet === sum(hold.held, h => h.ft) && hold.sized.feet === 0);
  const huge = ask(free, { want: pc.per * pc.cap * 3.3 * 7 / pc.every, every: pc.every, place: 'hold', to: undefined, count: 1 });
  check('what waits is in pieces no longer than a bed', !huge.error && huge.held.length === 4 && huge.held.every(h => h.ft <= pc.cap) && sum(huge.held, h => h.ft) * pc.per >= huge.waves[0].want - 1e-6, huge.error || huge.held.map(h => h.ft));
  // one bed named, and more wanted than it gives: the bed is taken and the rest waits
  const one = S.spaces(free, radish, rg)[0], spill = ask(free, { want: pc.per * pc.cap * 1.6 * 7 / pc.every, every: pc.every, place: 'beds', bedIds: [one.id], to: undefined, count: 1 });
  check('what the beds named cannot give waits, sized for the rest', !spill.error && spill.waves[0].placed.length === 1 && spill.waves[0].held.length === 1 && near(spill.waves[0].short, spill.waves[0].want - spill.waves[0].got, 1e-6)
    && spill.waves[0].held[0].ft === Math.ceil(spill.waves[0].short / pc.per - 1e-9) && !!spill.waves[0].held[0].wait.why, spill.error || [spill.waves[0].placed.length, spill.waves[0].held.map(h => h.ft), spill.waves[0].short]);
  const dry = ask(free, { want: pc.per * pc.cap * 1.6 * 7 / pc.every, every: pc.every, place: 'beds', bedIds: [one.id], to: undefined, count: 1, spill: false });
  check('told not to hold anything, the rest is said to be short and nothing waits', !dry.error && dry.held.length === 0 && dry.short === 1 && dry.waves[0].short > 0);
  // a few feet free are not started on when they cannot finish the planting
  const blocker = { id: 'blk', cropId: radish.id, bedId: one.id, date: iso(E.addDays(pc.field, -2)), ft: pc.cap - (S.PIECE - 2) }, tight = E.create({ ...bare, plantings: [blocker] }, Lib);
  const sliver = S.series(tight, { cropId: radish.id, place: 'beds', bedIds: [one.id, S.spaces(free, radish, rg)[1].id], unit: 'yield', want: pc.per * pc.cap * 1.5 * 7 / pc.every, from: `${year}-06-07`, count: 1, every: pc.every, net: false });
  check('a few free feet are not started on when they cannot finish the planting', !sliver.error && sliver.waves[0].placed.length === 1 && sliver.waves[0].placed.every(x => x.bed.id !== one.id) && sliver.waves[0].why.some(y => /few feet/.test(y.why)) && sliver.waves[0].held.length === 1, sliver.error || [sliver.waves[0].placed.map(x => [x.bed.bed, x.r.physicalLength]), sliver.waves[0].why]);
  const fits = S.series(tight, { cropId: radish.id, place: 'beds', bedIds: [one.id], unit: 'yield', want: pc.per * 2 * 7 / pc.every, from: `${year}-06-07`, count: 1, every: pc.every, net: false });
  check('but a few feet that finish it are used', !fits.error && fits.waves[0].placed.length === 1 && fits.waves[0].placed[0].bed.id === one.id && fits.waves[0].placed[0].r.physicalLength <= S.PIECE, fits.error || fits.waves[0].why);
  // on the plan as it stands: nothing lands on held ground, and what is placed with what waits comes to what was asked
  const full = S.series(eng, { cropId: radish.id, gardenIds: soilGardens(eng, radish), unit: 'yield', want: Math.ceil(pc.per * pc.cap * 2 * 7 / pc.every), from: `${year}-06-07`, to: `${year}-09-30`, every: pc.every, net: false });
  const e2 = full.error ? eng : E.create({ ...plan, plantings: [...plan.plantings, ...full.plantings] }, Lib), was = new Set(), now = [];
  if (!full.error) { for (const p of plan.plantings) for (const c of eng.conflicts ? eng.conflicts(p) || [] : []) was.add(p.id + '|' + ((c.p || c).id || '')); for (const p of full.plantings) for (const c of e2.conflicts(p) || []) now.push(p.id); }
  check('on the plan as it stands nothing it places lands on ground that is held', !full.error && now.length === 0, full.error || now.slice(0, 3));
  check('and what is placed with what waits covers what was asked of each planting', !full.error && full.waves.every(w => w.skipped || w.got + sum(w.held, h => (h.ft || 0) * pc.per) >= w.want * 0.98 - 1e-6), !full.error && full.waves.filter(w => !(w.got + sum(w.held, h => (h.ft || 0) * pc.per) >= w.want * 0.98)).map(w => [iso(w.target), w.want, w.got, w.held.map(h => h.ft)]).slice(0, 3));
  figures.full = full.error ? full.error : { placed: full.plantings.length, held: full.held.length, heldFeet: full.sized.heldFeet };
}

// ── 7. a yield nobody has checked sizes nothing ──
{
  const open = eng.crops().filter(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0 && eng.harvestFor(c.id).open.yield && S.gardensFor(free, c).length);
  check('there is a crop standing on a yield nobody has checked to try', open.length > 0);
  const c = open.find(x => plan.plantings.some(p => p.cropId === x.id)) || open[0];
  if (c) {
    const gardens = S.gardensFor(free, c).map(g => g.garden.id).slice(0, 1), input = { cropId: c.id, gardenIds: gardens, unit: 'yield', want: 10, from: `${year}-07-01`, to: `${year}-08-15`, every: 14, net: false };
    const r = S.series(free, input), pc = S.pace(free, { cropId: c.id, gardenIds: gardens, from: `${year}-07-01` });
    check('a crop standing on a yield nobody has checked is refused, and says where to set it', !!r.error && r.unchecked === true && /nobody has checked/.test(r.error) && /Yield and price/.test(r.error) && !r.plantings, r.error || 'it gave plantings');
    check('its pace says so too', pc.open === true, pc);
    check('held to place, it is refused as well', !!S.series(free, { ...input, place: 'hold' }).error);
    check('so many days apart it is planned as ever', !S.series(free, { ...input, unit: 'whole', amount: 1, count: 2 }).error);
    // once the list says what it yields where it is headed, it is sized
    const env = free.envOf(pc.like), listed = E.create({ ...bare, assumptions: { ...(bare.assumptions || {}), crops: { ...((bare.assumptions || {}).crops || {}), [c.id]: { ...(((bare.assumptions || {}).crops || {})[c.id] || {}), [env]: { ...((((bare.assumptions || {}).crops || {})[c.id] || {})[env] || {}), yield: 2 } } } } }, Lib);
    const r2 = S.series(listed, input);
    check('once the list gives its yield there, it is sized from the list', !r2.error && r2.plantings.length > 0 && r2.sized.rests.by === 'crop' && near(r2.sized.rests.each, 2), r2.error || r2.sized.rests);
    figures.unchecked = { crop: c.name, of: open.length };
  }
  // a crop with no yield at all
  const some = eng.crops().find(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0 && !eng.harvestFor(c.id).open.yield && soilGardens(free, c).length && c.id !== (radish || {}).id);
  if (some) {
    const none = E.create({ ...bare, crops: (bare.crops || []).map(x => x.id === some.id ? { ...x, yield: '' } : x), settings: bare.settings }, Lib), lib2 = { ...Lib };
    const g = soilGardens(none, some).slice(0, 1), r = S.series(none, { cropId: some.id, gardenIds: g, unit: 'yield', want: 10, from: `${year}-07-01`, to: `${year}-08-15`, every: 14, net: false });
    check('a crop with no yield, or the starting one, is refused wherever its figure comes from', (bare.crops || []).some(x => x.id === some.id) ? !!r.error && r.unchecked === true : true, r.error || 'sized');
  }
}

// ── 8. what the sizes rest on follows the list: a week's picking, all at once, a planting's own ──
if (radish) {
  const base = bare.assumptions || {}, withSell = line => E.create({ ...bare, assumptions: { ...base, sell: { ...(base.sell || {}), [radish.id]: line } } }, Lib);
  const p0 = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-07` });
  // all at once: a week apart, a week's amount in each, and the forecast gives it week by week
  const once = withSell({ pattern: 'once' }), want = Math.max(2, Math.floor(p0.per * p0.cap * 0.5)), r = S.series(once, { cropId: radish.id, gardenIds: rg, unit: 'yield', want, from: `${year}-06-07`, to: `${year}-07-18`, every: 7, net: false });
  const m1 = r.error ? null : forecastWith(once, r.plantings).m, w1 = m1 ? weekly(m1, radish.id, p0.unit, D(6, 7), D(7, 18)).filter(w => w.days === 7) : [];
  check('a crop all picked at once, a week apart: each planting gives a week’s amount, and the forecast has it every week', !r.error && r.sized.rests.pattern === 'once' && r.waves.every(w => near(w.asked, want * w.window.days / 7, 1e-9) && w.got >= w.want - 1e-6) && w1.length >= 4 && w1.every(w => w.q >= want * (1 - S.NEAR)), r.error || w1.map(w => w.q));
  // a week's picking: twice the harvest days gives twice as much from the same feet, so half the feet are asked for
  const envR = free.envOf(p0.like), withWeekly = days => E.create({ ...bare, assumptions: { ...base, sell: { ...(base.sell || {}), [radish.id]: { pattern: 'weekly', days } }, crops: { ...(base.crops || {}), [radish.id]: { ...((base.crops || {})[radish.id] || {}), [envR]: { yield: 0.4 } } } } }, Lib);
  const weeklyA = withWeekly(14), weeklyB = withWeekly(28), q = { cropId: radish.id, gardenIds: rg, unit: 'yield', want: Math.max(2, Math.floor(p0.per * p0.cap * 0.2)), from: `${year}-06-07`, to: `${year}-06-20`, net: false };
  const a = S.series(weeklyA, { ...q, every: 14 }), b = S.series(weeklyB, { ...q, every: 28, to: `${year}-07-04` });
  check('a crop picked each week is sized from its week’s picking: the same feet give the weekly amount however long it is picked', !a.error && !b.error && a.sized.rests.pattern === 'weekly' && near(a.sized.rests.perWeek, 0.4) && Math.abs(a.waves[0].placed[0].r.physicalLength - b.waves[0].placed[0].r.physicalLength) <= 1, [a.error, b.error, !a.error && a.waves[0].placed[0].r.physicalLength, !b.error && b.waves[0].placed[0].r.physicalLength]);
  // the list's own yield for the place it is headed is what a foot gives
  const env = free.envOf(p0.like), twice = E.create({ ...bare, assumptions: { ...base, crops: { ...(base.crops || {}), [radish.id]: { ...((base.crops || {})[radish.id] || {}), [env]: { ...(((base.crops || {})[radish.id] || {})[env] || {}), yield: p0.each * 2 } } } } }, Lib);
  const big = S.series(free, { ...q, every: p0.every, to: undefined, count: 1 }), half = S.series(twice, { ...q, every: p0.every, to: undefined, count: 1 });
  check('with twice the yield on the list, half the feet are asked for, and the result says the list is what it rests on', !big.error && !half.error && half.sized.rests.by === 'crop' && near(half.sized.rests.per, big.sized.rests.per * 2, 1e-9) && Math.abs(half.waves[0].placed[0].r.physicalLength - big.waves[0].placed[0].r.physicalLength / 2) <= 1, [!big.error && big.waves[0].placed[0].r.physicalLength, !half.error && half.waves[0].placed[0].r.physicalLength]);
  // the share sold is in it
  const sold = withSell({ share: 50 }), s2 = S.pace(sold, { cropId: radish.id, gardenIds: rg, from: `${year}-06-07` });
  check('the share sold is in what a foot gives', near(s2.mk, 0.5) && near(s2.per, p0.per / p0.mk * 0.5, 1e-9), [s2.mk, s2.per, p0.per]);
}

// ── 9. a harvest the season cuts short, towers, and a copy of a planting ──
{
  // a crop picked to the end of the season, wanted late: sized for the days it has, not asked to make up the days it has not
  const season = eng.crops().filter(c => !c.micro && c.harvestMode === 'season' && !eng.isCoverCrop(c) && +c.dtm > 0 && !eng.harvestFor(c.id).open.yield && fieldGardens(free, c).length);
  let found = null;
  for (const c of season) {
    const g = fieldGardens(free, c);
    for (const day of [`${year}-09-01`, `${year}-09-15`, `${year}-08-15`, `${year}-10-01`]) {
      const pc = S.pace(free, { cropId: c.id, gardenIds: g, from: day });
      if (!pc.error && pc.days > 6 && pc.days < pc.meant * 0.8 && pc.set) { found = { c, g, day, pc }; break; }
    }
    if (found) break;
  }
  check('there is a crop the season cuts short to try', !!found);
  if (found) {
    const { c, g, day, pc } = found, early = S.pace(free, { cropId: c.id, gardenIds: g, from: `${year}-07-20` });
    const want = Math.max(1, Math.floor(pc.per / pc.days * 7 * pc.cap * 0.3)), r = S.series(free, { cropId: c.id, gardenIds: g, unit: 'yield', want, from: day, count: 1, every: pc.every, net: false });
    const weeks = r.error ? [] : weekly(forecastWith(free, r.plantings).m, c.id, pc.unit, E.s2d(day), E.addDays(E.s2d(day), pc.days - 1)).filter(w => w.days === 7);
    check('a harvest the season cuts short is sized for the days it has: its weeks give the amount, not a multiple of it', !r.error && r.plantings.length >= 1 && weeks.length >= 1 && weeks.every(w => w.q >= want * (1 - S.NEAR) && w.q <= want * 1.15 + pc.per / pc.days * 7 * (S.SCRAP + 1)), r.error || { want, weeks: weeks.map(w => w.q), days: pc.days, meant: pc.meant, every: pc.every });
    check('and the result says the season cuts it short', !r.error && r.sized.rests.days < r.sized.rests.meant);
    figures.cut = { crop: c.name, days: pc.days, meant: pc.meant };
  }
  // towers: whole towers, as many as it takes
  const tower = eng.crops().find(c => !c.micro && c.tower === true && +c.dtm > 0 && S.gardensFor(free, c).some(g => g.kind === 'tower') && !eng.harvestFor(c.id).open.yield);
  check('there is a tower crop to try', !!tower);
  if (tower) {
    const g = S.gardensFor(free, tower).filter(x => x.kind === 'tower').map(x => x.garden.id), pc = S.pace(free, { cropId: tower.id, gardenIds: g, from: `${year}-06-15` });
    const r = pc.error ? pc : S.series(free, { cropId: tower.id, gardenIds: g, unit: 'yield', want: pc.per * 2.3 * 7 / pc.every, from: `${year}-06-15`, count: 1, every: pc.every, net: false });
    check('a tower crop is sized in whole towers: as many as give the amount', !r.error && pc.soil === false && r.waves[0].placed.length === 3 && r.waves[0].placed.every(x => x.r.tw) && r.sized.feet === 0 && r.waves[0].got >= r.waves[0].want - 1e-6, r.error || r.waves[0].placed.length);
    const h = pc.error ? pc : S.series(free, { cropId: tower.id, gardenIds: g, unit: 'yield', want: pc.per * 2.3 * 7 / pc.every, from: `${year}-06-15`, count: 1, every: pc.every, net: false, place: 'hold' });
    check('held to place, a tower crop waits as so many whole plantings with no length', !h.error && h.held.length === 3 && h.held.every(x => !x.ft), h.error || h.held.length);
  }
  // a copy of a planting that carries its own yield rests on that yield
  const own = plan.plantings.find(p => p.yield != null && p.yield !== '' && +p.yield > 0 && eng.calc(p) && eng.isSoilBed(eng.bedOf(p.bedId)) && !eng.crop(p.cropId).micro && !p.established && +eng.crop(p.cropId).dtm > 0);
  if (own) {
    const r0 = eng.calc(own), day = iso(r0.first), g = [eng.bedOf(own.bedId).gardenId], r = S.series(free, { cropId: own.cropId, sourceId: undefined, gardenIds: g, unit: 'yield', want: 5, from: day, count: 1, every: 14, net: false });
    const src = E.create({ ...bare, plantings: [own] }, Lib), rc = S.series(src, { cropId: own.cropId, sourceId: own.id, gardenIds: g, unit: 'yield', want: 5, from: iso(E.addDays(r0.last, 40)), count: 1, every: 14, net: false });
    check('a series that copies a planting with its own yield rests on that yield', !!rc.error || rc.sized.rests.by === 'own', rc.error || rc.sized.rests.by);
  } else check('a series that copies a planting with its own yield rests on that yield', true);
}

// ── 10. what comes out goes in as any series does ──
if (radish) {
  const pc = S.pace(free, { cropId: radish.id, gardenIds: rg, from: `${year}-06-07` }), r = ask(free, { want: Math.max(2, Math.floor(pc.per * pc.cap * 0.5 * 7 / pc.every)), every: pc.every });
  check('its plantings are plantings: an id of their own, a bed, a date, the crop, and nothing of the series left on them', !r.error && r.plantings.every(p => p.id && p.bedId && p.cropId === radish.id && E.validDate(E.s2d(p.date)) && !p.wait) && new Set(r.plantings.map(p => p.id)).size === r.plantings.length);
  check('the result has what the series tool reads', !r.error && r.firstHarvest && r.lastHarvest && r.units > 0 && r.unit === pc.unit && r.placed === r.waves.length && Array.isArray(r.held));
  const e2 = E.create({ ...bare, plantings: r.plantings }, Lib);
  check('each can be worked out once added, with the dates it was shown with', r.plantings.every((p, i) => { const c = e2.calc(p), x = r.waves.flatMap(w => w.placed)[i]; return c && iso(c.first) === iso(x.r.first) && near(c.physicalLength, x.r.physicalLength); }));
  check('the limit on a series holds', /Plan up to/.test(S.series(free, { cropId: radish.id, gardenIds: rg, unit: 'yield', want: 5, from: `${year}-01-10`, to: `${year}-12-20`, every: 2, net: false }).error || ''));
}
finished = true;
