'use strict';
/* E2c part 2, with no browser: something a crop sells first picked before the crop's own days to harvest (baby carrots, pulled
 * before the big ones are cleared), and a cane stand by its age (js/engine.js aheadOf, soldOf, standAge, yieldOf, warnings;
 * js/forecast.js build).
 *   1. on the plan as given, and on a copy with a thing added and its "days before" empty, nothing moves: every planting's dates,
 *      ground, yield and the forecast day by day are the build before's
 *   2. days before typed: the thing is first picked that many days before the planting's first picking, its own days count from
 *      there, never before the planting is in its bed nor after its last picking; On demand and Clear keep their total, Gradually
 *      picks the more weeks; no date of any planting moves; one given to the crop alone is not touched; the forecast row starts
 *      that many days earlier; it is said among the planting's notes
 *   3. a stand's year typed: a young stand gives the published share, or his, of the list's yield, by the year it is picked in;
 *      an empty year, a year from two before, a planting with a yield of its own, a crop that is not perennial: as before; a stand
 *      that gives nothing yet is not "no yield set"; no date moves; the season's worth falls by what is lost; said among its notes
 *   4. what the plan holds is read as it must be: a share out of 0 to 100 is no share, a thing packed from the harvest has no days before
 * The cases are added to copies of the plan here, never to the farm. Every subject is found on the plan given by the engine's own
 * figures: nothing here names a crop, a bed or a date of any plan.
 * usage: node early_young_test.cjs <app-dir> <plan.json> <dir holding the previous build's js>
 */
const path = require('path'), fs = require('fs');
const [app, planFile, oldDir] = process.argv.slice(2);
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: JSON.stringify(f.detail === undefined ? null : f.detail).slice(0, 700) })) }));
});
global.window = global;
const req = f => require(path.resolve(app, 'js', f)), old = f => require(path.resolve(oldDir, f));
const Lib = req('library.js'), E = req('engine.js'), IO = req('planio.js'), F = req('forecast.js');
const E0 = old('engine.js'), F0 = old('forecast.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const given = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const year = +given.settings.year;
const copy = x => JSON.parse(JSON.stringify(x)), near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
const iso = d => (d && E.validDate(d) ? E.d2s(d) : null), days = (a, b) => Math.round(E.dayDiff(a, b));
const worthOf = m => m.rows.reduce((n, r) => n + r.worth, 0);
const lines = (e, m) => (e.plan.plantings || []).map(p => { const r = e.calc(p); if (!r) return p.id; const y = e.yieldOf(p, r); return [p.id, iso(r.field), iso(r.first), iso(r.last), r.harvestDays, String(+e.occupancyThrough(p, r)), y ? y.units.toFixed(9) : '', y ? y.unit : ''].join('|'); });
const rowsOf = m => m.rows.map(r => [r.key, r.total.toFixed(9), r.worth.toFixed(9), Array.from(r.days, v => v.toFixed(9)).join(',')].join('|'));
const diff = (a, b) => a.filter((x, i) => x !== b[i]).slice(0, 4);
const withSell = (plan, cropId, line) => { const p = copy(plan); p.assumptions = p.assumptions || { v: 1, crops: {}, varieties: {} }; p.assumptions.sell = { ...(p.assumptions.sell || {}), [cropId]: { ...((p.assumptions.sell || {})[cropId] || {}), ...line } }; return p; };
const withPlanting = (plan, id, change) => { const p = copy(plan); p.plantings = p.plantings.map(q => q.id === id ? { ...q, ...change } : q); return p; };

// ── 1. the plan as given: nothing moves ──
{
  const e = E.create(given, Lib), e0 = E0.create(given, Lib);
  const a = lines(e, null), b = lines(e0, null), m = rowsOf(F.build(e, { year })), m0 = rowsOf(F0.build(e0, { year }));
  check('on the plan as given every planting’s dates, ground and yield are the build before’s', a.length > 100 && a.join('\n') === b.join('\n'), diff(a, b));
  check('and the forecast, row by row and day by day', m.length > 10 && m.join('\n') === m0.join('\n'), diff(m, m0));
  check('no planting of the plan carries a year planted, and no crop line a share for a young stand or a thing a day before', !(given.plantings || []).some(p => 'plantedIn' in p) && !Object.values((given.assumptions || {}).sell || {}).some(l => 'young' in l || Object.values(l.things || {}).some(t => 'before' in t)));
}

// the subject for days before: the crop with most plantings in beds that follow its line and are picked over days, each with room
// to be picked a few days before its first picking; a thing out of each bed is added to it on a copy
const e1 = E.create(given, Lib);
const follows = (e, p) => { const r = e.calc(p), y = r ? e.yieldOf(p, r) : null, b = r && r.b; return !!y && !y.own && y.set && y.units > 0 && !!b && e.isSoilBed(b) && !e.isRack(b) && r.harvestDays >= 3 && days(r.first, r.field) >= 12 && !p.gives && !p.yield; };
const byCrop = new Map();
for (const p of given.plantings) if (follows(e1, p)) byCrop.set(p.cropId, [...(byCrop.get(p.cropId) || []), p]);
const [C, beds] = [...byCrop.entries()].filter(([id]) => !e1.isPerennial(e1.crop(id))).sort((a, b) => b[1].length - a[1].length)[0] || [null, []];
check('the plan has a crop of three plantings at least in beds, following its line and picked over days, with room before its first picking', !!C && beds.length >= 3, [C, beds.length]);
const room = Math.min(...beds.map(p => days(e1.calc(p).first, e1.calc(p).field))) - 1, N = Math.max(2, Math.min(10, room - 1));
const T = 't-early', P0 = beds[0].id, P1 = beds[1].id;
const thing = (extra = {}) => ({ id: T, n: 1, name: 'Early ones', from: 'bed', unit: 'bunch', price: 3, pattern: 'spread', share: 30, yield: 0.5, ...extra });
const plan = (extra = {}, change = {}) => withPlanting(withSell(given, C, { things: { [T]: thing(extra) } }), P0, { gives: T, ...change });
const partOf = (e, id) => { const p = e.planting(id), r = e.calc(p); return { r, parts: e.soldOf(p, r) || [], y: e.yieldOf(p, r) }; };
const mine = x => x.parts.find(q => q.thing === T);

{
  const pl = plan(), e = E.create(pl, Lib), e0 = E0.create(pl, Lib);
  const a = lines(e), b = lines(e0), m = rowsOf(F.build(e, { year })), m0 = rowsOf(F0.build(e0, { year }));
  check('with a thing out of each bed added and its days before empty, every planting and the forecast are the build before’s', a.join('\n') === b.join('\n') && m.join('\n') === m0.join('\n'), [diff(a, b), diff(m, m0)]);
  const x = partOf(e, P0);
  check('and the thing is picked with its crop, from the planting’s own first picking', !!mine(x) && +mine(x).first === +x.r.first && !mine(x).ahead, mine(x) && iso(mine(x).first));
}

// ── 2. days before ──
{
  const base = E.create(plan({ days: 5 }), Lib), typed = E.create(plan({ days: 5, before: N }), Lib);
  const a = partOf(base, P0), b = partOf(typed, P0), qa = mine(a), qb = mine(b);
  check('typed, the thing is first picked that many days before the planting’s first picking, and the part says how many', !!qb && qb.ahead === N && days(b.r.first, qb.first) === N, qb && [iso(qb.first), iso(b.r.first), qb.ahead]);
  check('its own days count from there: picked for 5 days it ends on the 5th of them', !!qb && days(qb.last, qb.first) === 4, qb && [iso(qb.first), iso(qb.last)]);
  check('On demand keeps its total: the same bunches, spread over days that start earlier', !!qa && !!qb && near(qa.units, qb.units), [qa && qa.units, qb && qb.units]);
  check('no date of any planting moves: its bed, first and last picking and turnover are as they were', lines(base).map(l => l.split('|').slice(0, 6).join('|')).join('\n') === lines(typed).map(l => l.split('|').slice(0, 6).join('|')).join('\n'));
  const both = partOf(typed, P1), q1 = mine(both), own1 = both.parts.find(q => !q.thing);
  check('a planting grown for both by the crop’s shares picks its share of the thing early too, and the crop’s own share on its days', !!q1 && q1.ahead === N && !!own1 && +(own1.first || both.r.first) === +both.r.first, q1 && [iso(q1.first), iso(both.r.first)]);
  const firstOnly = E.create(withPlanting(plan({ days: 5, before: N }), P1, { gives: 'first' }), Lib), f1 = partOf(firstOnly, P1);
  check('a planting grown for the crop alone is not touched', !f1.parts.length || !f1.parts.some(q => q.ahead), f1.parts.map(q => q.thing));
  const m0 = F.build(base, { year }), m1 = F.build(typed, { year }), r0 = m0.rows.find(r => r.thing === T), r1 = m1.rows.find(r => r.thing === T);
  const at = (m, row, id) => row.plantings.find(q => q.p.id === id);
  const moved = r0 && r1 ? r1.plantings.map(q => ({ q, o: at(m0, r0, q.p.id) })) : [];
  check('in the forecast the thing’s row starts that many days earlier for each of its plantings', moved.length >= 3 && moved.every(({ q, o }) => !!o && q.lo === o.lo - Math.min(N, days(q.r.first, q.r.field) - 1) && q.ahead === Math.min(N, days(q.r.first, q.r.field) - 1)), moved.slice(0, 3).map(({ q, o }) => [q.p.id, o && o.lo, q.lo, q.ahead]));
  check('each picked for as many days as before keeps its amount; one whose own days were cut short by its planting’s last picking gains the days it now has, and no more', moved.every(({ q, o }) => { const t5 = Math.min(5, q.r.harvestDays + q.ahead), t0 = Math.min(5, q.r.harvestDays); return near(q.units, o.units * t5 / t0); }), moved.filter(({ q, o }) => !near(q.units, o.units)).slice(0, 3).map(({ q, o }) => [q.p.id, o.units, q.units, q.r.harvestDays]));
  check('the season’s worth moves by what the thing’s plantings give more, at its price, and by nothing else', near(worthOf(m1) - worthOf(m0), moved.reduce((n, { q, o }) => n + (q.inYear - o.inYear) * q.price, 0), 1e-9) && m1.rows.filter(r => r.thing !== T).every(r => { const o = m0.rows.find(x => x.key === r.key); return !!o && near(o.worth, r.worth, 1e-12); }), [worthOf(m0), worthOf(m1)]);
  // the screens' "picking": inside the days of what it is grown for, from the day before typed, and not after its own last day
  const pk = (e, id, d) => e.pickingOn(e.planting(id), null, d);
  check('a planting grown only for the thing is picking from its own first day to its own last, and not the day after, though its crop’s days run on', pk(typed, P0, qb.first) && pk(typed, P0, qb.last) && !pk(typed, P0, E.addDays(qb.last, 1)) && E.addDays(qb.last, 1) <= b.r.last && !pk(typed, P0, E.addDays(qb.first, -1)), [iso(qb.first), iso(qb.last), iso(b.r.last)]);
  {
    const sample = [0, 60, 120, 180, 240, 300].map(k => E.addDays(new Date(year, 0, 1), k)), e0 = E.create(given, Lib);
    check('with the boxes empty, “picking” is the planting’s own harvest days, as before, for every planting and day', given.plantings.every(p => { const r = e0.calc(p); return !r || sample.every(d => e0.pickingOn(p, r, d) === e0.pickedOn(r, d)); }));
  }
  // the windows: grown for the thing alone, or for both with the thing at 100% of the bed (the base part gets nothing): the same; and
  // a gap between the thing picked early and the crop's own line stays a gap (Codex on #83)
  {
    const w = e => e.pickWindows(e.planting(P0)).map(([x, y]) => iso(x) + '..' + iso(y)).join(' '), alone = typed;
    const all = E.create(withPlanting(withSell(given, C, { things: { [T]: thing({ days: 5, before: N, share: 100 }) } }), P0, {}), Lib);
    check('a planting grown for the thing alone, and one grown for both by shares with the thing at 100% of the bed, are picked in the same window', w(alone) === w(all) && w(alone) === `${iso(qb.first)}..${iso(qb.last)}`, [w(alone), w(all)]);
    const gap = E.create(withPlanting(withSell(given, C, { things: { [T]: thing({ days: 2, before: N }) } }), P0, {}), Lib), xg = partOf(gap, P0), qg = mine(xg), wg = gap.pickWindows(gap.planting(P0));
    check('grown for both by shares, the thing picked two days from N days early and the crop from its own first picking: two windows, and no picking in the gap', N > 2 && wg.length === 2 && +wg[0][0] === +qg.first && +wg[0][1] === +qg.last && +wg[1][0] === +xg.r.first && !gap.pickingOn(gap.planting(P0), null, E.addDays(qg.last, 1)), wg.map(([x, y]) => [iso(x), iso(y)]));
    const e0 = E.create(given, Lib), e00 = E0.create(given, Lib);
    check('with the boxes empty every planting’s window is its own harvest days, as the build before has them', given.plantings.every(p => { const r = e0.calc(p), r0 = e00.calc(p); if (!r) return true; const ww = e0.pickWindows(p, r); return r.harvestDays > 0 ? ww.length === 1 && +ww[0][0] === +r0.first && +ww[0][1] === +r0.last : ww.length === 0; }));
  }
  const notes = typed.warnings(typed.planting(P0)).filter(w => w.k === 'pick');
  check('the planting’s notes say when it is first picked, and how many days before its days to harvest', notes.length === 1 && notes[0].t.includes(iso(qb.first)) && notes[0].t.includes(`${N} days before`) && notes[0].t.includes(iso(b.r.first)), notes);
  check('and say nothing where no days before are typed', !base.warnings(base.planting(P0)).some(w => w.k === 'pick'));

  const wk0 = E.create(plan({ pattern: 'weekly', yield: 0.7 }), Lib), wk1 = E.create(plan({ pattern: 'weekly', yield: 0.7, before: N }), Lib), w0 = mine(partOf(wk0, P0)), w1x = partOf(wk1, P0), w1 = mine(w1x);
  check('Gradually with no days of its own picks the more weeks: a week’s picking × (its days + the days before) ÷ 7, to the planting’s last picking', !!w0 && !!w1 && near(w1.units / w0.units, (w1x.r.harvestDays + N) / w1x.r.harvestDays) && +w1.last === +w1x.r.last, [w0 && w0.units, w1 && w1.units, w1x.r.harvestDays]);
  const cl0 = E.create(plan({ pattern: 'once' }), Lib), cl1 = E.create(plan({ pattern: 'once', before: N }), Lib), c0 = mine(partOf(cl0, P0)), c1 = mine(partOf(cl1, P0));
  const mc = F.build(cl1, { year }).rows.find(r => r.thing === T), atc = mc && mc.plantings.find(q => q.p.id === P0);
  check('Clear: all of it on its own first day, that many days before the crop’s, the same total', !!c0 && !!c1 && near(c0.units, c1.units) && days(c0.first, c1.first) === N && !!atc && atc.out[0] > 0 && Array.from(atc.out).slice(1).every(v => v === 0), [c0 && iso(c0.first), c1 && iso(c1.first)]);
  const big = E.create(plan({ before: 3650 }), Lib), xb = partOf(big, P0), qbig = mine(xb);
  check('never before the planting is in its bed: the day after at the earliest', !!qbig && days(qbig.first, xb.r.field) === 1, qbig && [iso(qbig.first), iso(xb.r.field)]);
  // a planting changed after the days before were typed, so it goes into its bed fewer days before its days to harvest: it starts the
  // day after it goes in, and its notes say how many of the days it gets and why (Codex on #83: the number keeps one meaning, said)
  const late = E.create(plan({ before: N }, { dtm: 4, timingMode: 'manual' }), Lib), xl = partOf(late, P0), ql = mine(xl), nl = late.warnings(late.planting(P0)).filter(w => w.k === 'pick');
  check('a planting changed afterwards to go into its bed fewer days before: picked from the day after it goes in, and its notes say how many of the days asked apply and name the day it goes in', !!ql && days(xl.r.first, xl.r.field) === 4 && ql.ahead === 3 && ql.asked === N && nl.length === 1 && nl[0].t.includes(`3 of the ${N} days early asked`) && nl[0].t.includes(`goes into its bed ${iso(xl.r.field)}`) && +late.pickedFrom(late.planting(P0)) === +ql.first, [ql && ql.ahead, nl]);
  // none can apply: a planting that goes into its bed the day before its days to harvest. The days asked are kept and said, with the
  // days named; the planting is first picked with its crop (Codex on #83: the zero case is not silent)
  const zero = E.create(plan({ before: N }, { dtm: 1, timingMode: 'manual' }), Lib), xz = partOf(zero, P0), qz = mine(xz), nz = zero.warnings(zero.planting(P0)).filter(w => w.k === 'pick');
  check('none can apply (in its bed one day before its days to harvest): it is first picked with its crop, the days asked are kept on the part, and its notes say none can apply, with the day it goes in and the day it is first picked', !!qz && !qz.ahead && qz.asked === N && +qz.first === +xz.r.first && nz.length === 1 && nz[0].t.includes('none can apply') && nz[0].t.includes(iso(xz.r.field)) && nz[0].t.includes(iso(xz.r.first)) && +zero.pickedFrom(zero.planting(P0)) === +xz.r.first, [qz, nz]);
  const none = E.create(plan({ before: N }, { harvestEnd: iso(E.addDays(e1.calc(beds[0]).first, -1)) }), Lib), xn = partOf(none, P0);
  check('a planting that is not picked at all is not picked early either', xn.r.harvestDays === 0 && !(xn.parts || []).some(q => q.ahead), [xn.r.harvestDays, (xn.parts || []).map(q => q.ahead)]);
  // On demand with no days of its own, its planting's harvest cut short by a last day of its own: the share of its total its days
  // are of the days it would have had, counted with the days before
  const cutEnd = iso(E.addDays(e1.calc(beds[0]).first, 3)), od0 = E.create(plan({ days: undefined }, { harvestEnd: cutEnd }), Lib), od1 = E.create(plan({ days: undefined, before: N }, { harvestEnd: cutEnd }), Lib);
  const xo0 = partOf(od0, P0), xo1 = partOf(od1, P0), q0 = mine(xo0), q1o = mine(xo1), full = xo1.y.count * 0.5 * xo1.y.mk;   // grown for the thing alone: the whole planting
  check('On demand with no days of its own, its planting cut short: it gives the share of its total its days are of the days it would have had, the days before counted in both', !!q0 && !!q1o && xo1.r.harvestDays === 4 && xo1.r.expectedHarvestDays > 4 && near(q0.units, full * 4 / xo0.r.expectedHarvestDays) && near(q1o.units, full * (4 + N) / (xo1.r.expectedHarvestDays + N)), [q0 && q0.units, q1o && q1o.units, full, xo1.r.harvestDays, xo1.r.expectedHarvestDays]);
  const packed = E.create(withSell(given, C, { things: { [T]: { ...thing(), from: 'harvest', share: 20, holds: 2, of: e1.unitOf(e1.crop(C)), before: N } } }), Lib);
  check('a thing packed from the harvest has no days before: it is picked when its crop is', packed.thingsOf(C)[0].before === null);
}

// ── 3. a stand by its age ──
const e3 = E.create(given, Lib);
const stands = given.plantings.filter(p => { const r = e3.calc(p), y = r ? e3.yieldOf(p, r) : null; return !!y && e3.isPerennial(r.c) && !r.rack && y.units > 0; });
const S1 = stands.find(p => !e3.yieldOf(p).own && /raspberr|blackberr/i.test(e3.crop(p.cropId).name)), S2 = stands.find(p => e3.yieldOf(p).own);
check('the plan has a cane stand that follows the list, and one with a yield of its own', !!S1 && !!S2, [S1 && S1.id, S2 && S2.id]);
{
  const at = e3.calc(S1).first.getFullYear(), u = e => e.yieldOf(e.planting(S1.id)).units, base = u(e3), price = e3.yieldOf(S1).price;
  const yr = y => E.create(withPlanting(given, S1.id, { plantedIn: y }), Lib), hc = e3.harvestFor(S1.cropId);
  check('its crop’s card has two shares for a young stand, the published ones in grey: none the year it is planted, 80% the year after', !!hc.young && hc.young.map(x => x.fallback).join() === '0,80' && hc.young.every(x => x.mine == null && !!x.source), hc.young);
  check('a crop that is not perennial has none', e3.harvestFor(C).young === null);
  const y1 = yr(at), y2 = yr(at - 1), y3 = yr(at - 2), yf = yr(at + 1);
  check('planted the year it is picked: its first season, nothing of the list’s yield', u(y1) === 0 && y1.standAge(y1.planting(S1.id)).season === 1, u(y1));
  check('planted the year before: its second season, 80% of it', near(u(y2), base * 0.8) && y2.standAge(y2.planting(S1.id)).share === 80, [u(y2), base]);
  check('planted two years before or earlier, or with no year: all of it, as before', near(u(y3), base) && near(u(yr(1990)), base) && e3.standAge(S1) === null, [u(y3), base]);
  check('picked in a year before the stand is planted: nothing is counted, and its season is said as 0', u(yf) === 0 && yf.standAge(yf.planting(S1.id)).season === 0 && yf.warnings(yf.planting(S1.id)).some(w => w.k === 'stand' && w.t.includes('before the stand is planted')));
  const lost = base * 0.2 * price, w0 = worthOf(F.build(e3, { year })), w2 = worthOf(F.build(y2, { year }));
  check('the season’s worth falls by exactly what the young stand does not give', near(w0 - w2, lost, 1e-9) && lost > 0, [w0, w2, lost]);
  check('no date and no ground of any planting moves', lines(e3).map(l => l.split('|').slice(0, 6).join('|')).join('\n') === lines(y1).map(l => l.split('|').slice(0, 6).join('|')).join('\n'));
  const m1 = F.build(y1, { year });
  check('a stand that gives nothing yet is not in the forecast, and is not counted as having no yield', !m1.rows.some(r => r.plantings.some(q => q.p.id === S1.id)) && !m1.unset.some(x => x.p.id === S1.id) && m1.unset.length === F.build(e3, { year }).unset.length, m1.unset.map(x => x.p.id));
  const row2 = F.build(y2, { year }).rows.find(r => r.plantings.some(q => q.p.id === S1.id)), q2 = row2 && row2.plantings.find(q => q.p.id === S1.id);
  check('in the forecast a young stand carries its season and share, for the popup’s tag', !!q2 && q2.age && q2.age.season === 2 && q2.age.share === 80, q2 && q2.age);
  const his = E.create(withSell(withPlanting(given, S1.id, { plantedIn: at }), S1.cropId, { young: [10, 50] }), Lib), half = E.create(withSell(withPlanting(given, S1.id, { plantedIn: at - 1 }), S1.cropId, { young: [null, 60] }), Lib);
  check('his shares replace the published ones: 10% the first year; one emptied goes back to the published one', near(u(his), base * 0.1) && near(u(half), base * 0.6) && half.harvestFor(S1.cropId).young[0].value === 0, [u(his), u(half)]);
  const own = E.create(withPlanting(given, S2.id, { plantedIn: at }), Lib);
  check('a planting with a yield of its own keeps it as typed: no share is taken from it', near(own.yieldOf(own.planting(S2.id)).units, e3.yieldOf(S2).units) && !own.yieldOf(own.planting(S2.id)).age);
  const annual = E.create(withPlanting(given, beds[0].id, { plantedIn: at }), Lib);
  check('a year on a planting of a crop that is not perennial is not read', near(annual.yieldOf(annual.planting(beds[0].id)).units, e3.yieldOf(beds[0]).units) && !annual.yieldOf(annual.planting(beds[0].id)).age && annual.standAge(annual.planting(beds[0].id)) === null);
  // something else the stand's crop sells, out of each bed: a young stand gives its share of that too
  const withThing = (pl, y) => withSell(withPlanting(pl, S1.id, y ? { plantedIn: y } : {}), S1.cropId, { things: { 't-cane': { id: 't-cane', n: 1, name: 'Seconds', from: 'bed', unit: 'lb', price: 2, pattern: 'spread', share: 50, yield: 0.4 } } });
  const ct0 = E.create(withThing(given, null), Lib), ct2 = E.create(withThing(given, at - 1), Lib), tp = e => { const q = e.planting(S1.id), r = e.calc(q); return (e.soldOf(q, r) || []).find(x => x.thing === 't-cane'); };
  check('a young stand gives its share of what else its crop sells out of the bed too', !!tp(ct0) && !!tp(ct2) && near(tp(ct2).units, tp(ct0).units * 0.8), [tp(ct0) && tp(ct0).units, tp(ct2) && tp(ct2).units]);
  const n1 = y1.warnings(y1.planting(S1.id)).filter(w => w.k === 'stand'), n2 = y2.warnings(y2.planting(S1.id)).filter(w => w.k === 'stand');
  check('its notes say its season and what it gives', n1.length === 1 && n1[0].t.includes(`Planted in ${at}`) && n1[0].t.includes('nothing is picked') && n2.length === 1 && n2[0].t.includes('second season') && n2[0].t.includes('80%') && !y3.warnings(y3.planting(S1.id)).some(w => w.k === 'stand'), [n1, n2]);
  // something else the stand's crop sells, picked early across the New Year: the stand is aged to the year picking begins (Codex on #83)
  {
    const dated = `${at - 1}-11-01`, pl = withSell(withPlanting(given, S1.id, { date: dated, plantedIn: at - 1 }), S1.cropId, { things: { 't-cane': { id: 't-cane', n: 1, name: 'Seconds', from: 'bed', unit: 'lb', price: 2, pattern: 'spread', share: 50, yield: 0.4 } } });
    const plain = E.create(pl, Lib), earlyPl = withSell(pl, S1.cropId, { things: { 't-cane': { ...pl.assumptions.sell[S1.cropId].things['t-cane'], before: 90 } } }), xe = E.create(earlyPl, Lib);
    const q0 = plain.planting(S1.id), q1 = xe.planting(S1.id), r1 = xe.calc(q1), part = (xe.soldOf(q1, r1) || []).find(x => x.thing === 't-cane');
    check('a stand planted the year before, its crop ready in the new year, and something it sells picked early in December: that part is its first season (nothing), its crop’s own line its second (80%)', plain.calc(q0).first.getFullYear() === at && xe.standAge(q1).season === 2 && near(xe.yieldOf(q1, r1).units, plain.yieldOf(q0).units) && !!part && part.first.getFullYear() === at - 1 && part.age && part.age.season === 1 && part.units === 0 && xe.standYear(q1, r1) === at - 1, [iso(plain.calc(q0).first), part && iso(part.first), part && part.age, part && part.units]);
  }
  // the stand's earliest picking (standYear) reads what it is grown for as soldOf does (#84): a planting grown for a thing since taken
  // away gives the bed's things by shares, so one of them picked early in December is its earliest; where its bed's place has a thing
  // of its own, that thing alone, so a bed thing picked early is not
  {
    const cane = { id: 't-cane', n: 1, name: 'Seconds', from: 'bed', unit: 'lb', price: 2, pattern: 'spread', share: 50, yield: 0.4, before: 90 };
    const pl = withPlanting(given, S1.id, { date: `${at - 1}-11-01`, plantedIn: at - 1, gives: 't-gone' });
    const xe = E.create(withSell(pl, S1.cropId, { things: { 't-cane': cane } }), Lib), q = xe.planting(S1.id), r = xe.calc(q);
    const earliest = e => { const p = e.planting(S1.id), rr = e.calc(p), parts = e.soldOf(p, rr) || []; return Math.min(rr.first.getFullYear(), ...parts.map(x => (x.first || rr.first).getFullYear())); };
    check('a stand grown for a thing since taken away, another picked early in December: its earliest year is that of soldOf’s earliest picking, the year before', q.gives === 't-gone' && xe.grownFor(q) === null && r.first.getFullYear() === at && earliest(xe) === at - 1 && xe.standYear(q, r) === earliest(xe), [xe.grownFor(q), iso(r.first), earliest(xe), xe.standYear(q, r)]);
    const env = xe.envOf(r.b), xp = E.create(withSell(pl, S1.cropId, { things: { 't-cane': cane, 't-here': { id: 't-here', n: 2, name: 'Here ones', from: 'place', place: env, unit: 'lb', price: 2, pattern: 'spread', yield: 0.4 } } }), Lib), qp = xp.planting(S1.id), rp = xp.calc(qp);
    check('where its bed’s place has a thing of its own, the bed thing picked early is not its earliest: the year of its own first picking, as soldOf gives it', !!env && (xp.soldOf(qp, rp) || []).length === 1 && earliest(xp) === at && xp.standYear(qp, rp) === earliest(xp), [env, (xp.soldOf(qp, rp) || []).map(x => x.thing), earliest(xp), xp.standYear(qp, rp)]);
  }
  // a split cane stand first picked Jan 10, something else it sells 20 days early (Dec 21 the year before): each part takes the share of
  // the year it is picked in; a part picked before the stand is planted counts nothing and is said; the bed is "picking" only from a day
  // that counts (the chat that holds the build, on Codex's Zoom Out of #83)
  {
    const field = iso(E.addDays(E.s2d(`${at}-01-10`), -(e3.calc(S1).first - e3.calc(S1).field) / 864e5));
    const split = (y, young) => { let pl = withSell(withPlanting(given, S1.id, { date: field, ...(y ? { plantedIn: y } : {}) }), S1.cropId, { things: { 't-cane': { id: 't-cane', n: 1, name: 'Seconds', from: 'bed', unit: 'lb', price: 2, pattern: 'spread', share: 50, yield: 0.4, before: 20 } } }); if (young) pl = withSell(pl, S1.cropId, { young }); return E.create(pl, Lib); };
    const at2 = e => { const q = e.planting(S1.id), r = e.calc(q), y = e.yieldOf(q, r), part = (e.soldOf(q, r, y) || []).find(x => x.thing === 't-cane'), own = (e.soldOf(q, r, y) || []).find(x => !x.thing); return { q, r, y, part, own }; };
    const a = at2(split(at, [10, 80])), b = at2(split(at - 1, [10, 80])), m = at2(split(null));
    check('the case: first picked Jan 10 of the season, the other thing Dec 21 the year before', iso(a.r.first) === `${at}-01-10` && iso(a.part.first) === `${at - 1}-12-21`, [iso(a.r.first), a.part && iso(a.part.first)]);
    check('planted that season: its own line is its first season (10%), the part picked in December before it is planted counts nothing and its notes say so with the date', a.own.age.season === 1 && a.own.age.share === 10 && a.part.age.season === 0 && a.part.units === 0 && a.y.age.season === 1 && a.r && a.q && split(at, [10, 80]).warnings(a.q).some(w => w.k === 'stand' && w.t.includes(`${at - 1}-12-21`) && w.t.includes('before the stand is planted')), [a.own.age, a.part.age]);
    check('planted the year before: the December part is its first season (10%), its own line in January its second (80%)', b.part.age.season === 1 && b.part.age.share === 10 && b.own.age.season === 2 && b.own.age.share === 80 && near(b.part.units, m.part.units * 0.1) && near(b.own.units, m.own.units * 0.8), [b.part.age, b.own.age]);
    check('the bed is picking from the December part when it counts, and from its own first picking when it does not', +split(at - 1, [10, 80]).pickedFrom(b.q) === +b.part.first && +split(at, [10, 80]).pickedFrom(a.q) === +a.r.first);
  }
  // a perennial crop with no published figures: an empty box is all of it; his figure counts
  const other = given.plantings.find(p => !e3.isPerennial(e3.crop(p.cropId)) && follows(e3, p) && p.cropId !== C), oc = other && other.cropId;
  const asPerennial = pl => ({ ...pl, crops: [...(pl.crops || []).filter(c => c.id !== oc), { ...((pl.crops || []).find(c => c.id === oc) || { id: oc }), perennial: true }] });
  const p0 = E.create(asPerennial(withPlanting(given, other.id, { plantedIn: at })), Lib), p1 = E.create(withSell(asPerennial(withPlanting(given, other.id, { plantedIn: at })), oc, { young: [30, null] }), Lib);
  const uo = e => e.yieldOf(e.planting(other.id)).units;
  check('a perennial crop with no published figures: its boxes are empty and give all of it; his figure counts', p0.harvestFor(oc).young.every(x => x.fallback == null) && near(uo(p0), e3.yieldOf(other).units) && near(uo(p1), e3.yieldOf(other).units * 0.3), [uo(p0), uo(p1)]);
}

// ── 4. what the plan holds, read as it must be ──
{
  const e = E.create(withSell(given, C, { young: [150, -1] }), Lib), f = E.create(withSell(given, C, { young: 'x' }), Lib), g = E.create(withSell(given, C, { young: [null, '40'] }), Lib);
  check('shares out of 0 to 100, or not a list, are no shares', e.sellRule(C).young === null && f.sellRule(C).young === null && g.sellRule(C).young.join() === ',40');
  const t = E.create(plan({ before: 2.5 }), Lib).thingsOf(C)[0], t2 = E.create(plan({ before: 0 }), Lib).thingsOf(C)[0];
  check('days before are whole days from 1: 2.5 and 0 are none', t.before === null && t2.before === null);
}
finished = true;
