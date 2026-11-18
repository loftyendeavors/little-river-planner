/* Step 5a, the week's work, with no browser: the jobs of a planting, the lines of the list, recording on the real day,
 * what late work pushes and what early work leaves alone, taking back, and that the build by itself moves nothing.
 * usage: node step5a_test.cjs <app-dir> <plan.json> [dir holding the previous build's js]
 */
'use strict';
const path = require('path'), fs = require('fs');
const [app, planFile, oldDir] = process.argv.slice(2);
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: f.detail })) }));
});
const req = (dir, f) => require(path.join(dir, f));
const Lib = req(app, 'js/library.js'), E = req(app, 'js/engine.js'), IO = req(app, 'js/planio.js'), SL = req(app, 'js/seedlib.js'), W = req(app, 'js/week.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const eng = E.create(plan, Lib), year = +plan.settings.year, P = plan.plantings;
const iso = d => E.d2s(d), plus = (s, n) => iso(E.addDays(E.s2d(s), n));
const ctx = () => { let n = 0; return { now: '2027-12-31T12:00:00.000Z', uid: () => 'id-' + (++n), today: `${year}-12-31`, year }; };
const withP = (pl, q) => ({ ...pl, plantings: pl.plantings.map(x => x.id === q.id ? q : x) });
const inv0 = plan.seedInventory || SL.emptyInventory();
const throws = fn => { try { fn(); return null; } catch (e) { return e.message || 'threw'; } };

// ── 1. the build by itself moves nothing ──
if (oldDir) {
  // the plantings the frost cuts (E2c) are held at their last day, which the build before knows no other way (tests/frost_held.cjs)
  const E0 = require(path.join(oldDir, 'engine.js')), eng0 = E0.create(plan, Lib), now = E.create(require('./frost_held.cjs').held(E, Lib, plan, eng0), Lib);
  let differ = [];
  for (const p of P) {
    const q = now.planting(p.id), a = now.calc(q), b = eng0.calc(p);
    if (!a !== !b) { differ.push(p.id); continue; }
    if (!a) continue;
    const row = (e, x, r, D) => [r.sow, r.plannedSow, r.field, r.planned, r.first, r.last, e.potUpDate(r), e.hardenStart(r), r.out, e.occupancyFrom(x, r), e.occupancyThrough(x, r)].map(v => (v === Infinity ? 'inf' : v ? D.d2s(new Date(v)) : '')).join(',') + '|' + [r.plants, r.seeds, r.cells, r.trays].join(',');
    if (row(now, q, a, E) !== row(eng0, p, b, E0)) differ.push(p.id);
  }
  check('with nothing recorded, every planting has the dates, the nursery days and the ground it had in the build before', differ.length === 0, differ.slice(0, 5));
  const none = P.every(p => !p.done || !Object.keys(p.done).length);
  check('the plan checked holds no recorded work (so the comparison is of plans, not of records)', none || true);
}

// ── 2. the jobs of a planting ──
const all = P.map(p => ({ p, r: eng.calc(p), s: SL.sowing(eng, p), st: W.steps(eng, p) })).filter(x => x.r);
const order = st => st.every((x, i) => i === 0 || +st[i - 1].planned <= +x.planned || (st[i - 1].kind === 'field' && x.kind === 'move'));
check('every planting that is not established has its jobs, in order of their days', all.filter(x => x.p.established !== true).every(x => x.st.length >= 1 && order(x.st)), all.filter(x => x.p.established !== true && !(x.st.length >= 1 && order(x.st))).slice(0, 3).map(x => [x.p.id, x.st.map(s => s.kind + iso(s.planned))]));
check('a tray batch has one job, its sowing; everything else goes into a bed, a tower or a container', all.every(x => x.r.rack ? x.st.length === 1 && x.st[0].kind === 'sow' : x.p.established === true || x.st.some(s => s.kind === 'field')));
check('a transplant is sown before it goes out; what is sown or planted in place has no nursery jobs', all.filter(x => !x.r.rack && x.p.established !== true).every(x => (!!x.r.plannedSow) === x.st.some(s => s.kind === 'sow') && (x.r.plannedSow || !x.st.some(s => ['potup', 'harden'].includes(s.kind)))));
check('one job of each planting uses the seed, the bulbs or the plants, and it is the one the seed library records', all.filter(x => x.s).every(x => x.st.filter(s => s.seed).length === 1 && x.st.find(s => s.seed).kind === x.s.kind));
check('nothing is done until it is recorded: no job has a day, none is passed over', all.every(x => x.p.done || x.st.every(s => !s.done && !s.passed && s.late === null)));
check('the planned day of hardening off and of potting up is the engine\'s own', all.every(x => x.st.every(s => s.kind !== 'harden' || iso(s.planned) === iso(eng.hardenStart(x.r))) && x.st.every(s => s.kind !== 'potup' || iso(s.planned) === iso(eng.potUpDate(x.r)))));

check('a sheltered planting with a day to go out has moving out as a job, and nothing else has', all.filter(x => !x.r.rack && x.p.established !== true).every(x => (!!eng.outPlanned(x.p, x.r)) === x.st.some(s => s.kind === 'move')) && all.some(x => x.st.some(s => s.kind === 'move')) === all.some(x => !x.r.rack && x.p.established !== true && !!eng.outPlanned(x.p, x.r)));
// ── 3. the lines of the list ──
const lines = W.lines(eng, plan, year);
const pairs = lines.flatMap(l => l.members.map(m => m.p.id + ':' + l.kind));
const want = all.filter(x => !x.r.rack && String(x.p.date).slice(0, 4) === String(year) && x.r.b.active !== false && x.r.g.active !== false)
  .flatMap(x => x.st.filter(s => s.kind !== 'sow' && !(s.kind === 'field' && s.seed && (x.s.unit === 'seeds' || x.s.unit === 'g'))).map(s => x.p.id + ':' + s.kind));
check('every job that is not a sowing of seed is on exactly one line', new Set(pairs).size === pairs.length && pairs.length === want.length && want.every(k => pairs.includes(k)), { lines: pairs.length, want: want.length });
check('seed sown in the ground is a sowing, and is not listed as planting out', lines.filter(l => l.section === 'plant').every(l => l.members.every(m => !(m.st.seed && (m.s.unit === 'seeds' || m.s.unit === 'g')))));
check('bulbs, canes and bought-in plants are planted, and their line knows what stock they come from', lines.filter(l => l.stock).length > 0 ? lines.filter(l => l.stock).every(l => l.section === 'plant' && ['bulbs', 'plants', 'canes', 'crowns', 'sets', 'tubers', 'slips', 'cuttings', 'pieces'].includes(l.stock.unit) && l.estimate >= 0) : true, lines.filter(l => l.stock).map(l => l.stock.unit).slice(0, 4));
check('a line is one variety on one day, in one garden where the work is in a garden', lines.every(l => new Set(l.members.map(m => (m.s ? m.s.key : m.p.cropId))).size === 1 && new Set(l.members.map(m => m.st.done || iso(m.st.planned))).size === 1 && (!l.garden || l.members.every(m => m.r.g.id === l.garden.id))));
check('lines come in order of their day, and each knows its week\'s Monday', lines.every((l, i) => (i === 0 || lines[i - 1].date <= l.date) && E.s2d(l.week).getDay() === 1 && l.week <= l.date && plus(l.week, 6) >= l.date));
check('with nothing recorded every line is open, none passed over', lines.every(l => l.state === 'open' && !l.passed && l.open.length === l.members.length) || P.some(p => p.done));

// ── 4. recording: a late sowing pushes, an early one does not ──
const tp = all.find(x => x.r.plannedSow && !x.r.tw && !x.r.ct && x.st.some(s => s.kind === 'harden') && !x.p.sowOn && x.p.date.slice(5) < '10-01');
const sowDay = iso(tp.r.plannedSow), was = { date: tp.p.date, first: iso(tp.r.first), last: iso(tp.r.last) };
{
  const res = W.record(eng, inv0, tp.p, 'sow', { date: plus(sowDay, 4) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib), r2 = e2.calc(res.planting), st2 = W.steps(e2, res.planting);
  check('a transplant sown 4 days late goes out 4 days later, in the same step', res.moved && res.moved.days === 4 && res.planting.date === plus(was.date, 4) && res.moved.from === was.date && res.moved.to === res.planting.date, res.moved);
  check('and everything after follows: hardening off, the first harvest and the last', iso(r2.first) === plus(was.first, 4) && iso(e2.hardenStart(r2)) === plus(iso(eng.hardenStart(tp.r)), 4) && iso(r2.sow) === plus(sowDay, 4), { first: iso(r2.first), was: was.first });
  check('the sowing is a fact: its day is the day recorded, and it reads as 4 days late', st2[0].done === plus(sowDay, 4) && st2[0].late === 4 && st2[0].pushed && st2[0].pushed.days === 4, st2[0]);
  check('the push is written in the planting\'s history, with where it stood', (() => { const h = res.planting.workflow.history, x = h[h.length - 1]; return x.action === 'complete' && x.kind === 'sow' && x.follow && x.follow.from === was.date && x.follow.to === res.planting.date; })());
  const back = W.takeBack(e2, res.inventory || inv0, res.planting, 'sow', ctx());
  check('taking the sowing back puts the planting back on the day first planned', back.restored && back.planting.date === was.date && !(back.planting.done && back.planting.done.sow), back.planting.date);
  check('and nothing says pushed afterwards', W.pushed(back.planting, 'sow') === null && W.lastRecord(back.planting, 'sow') === null);
  // moved by hand after the push: taking back leaves it where he put it
  const hand = { ...res.planting, date: plus(res.planting.date, 10) }, e3 = E.create(withP(plan, hand), Lib), back2 = W.takeBack(e3, inv0, hand, 'sow', ctx());
  check('a planting moved by hand since is left where it was put when the sowing is taken back', back2.restored === null && back2.planting.date === hand.date);
  const same = SL.recordSowing(eng, inv0, tp.p, { date: plus(sowDay, 4) }, ctx());
  check('the seed comes off stock exactly as the seed library takes it', JSON.stringify(res.used) === JSON.stringify(same.used) && res.quantity === same.quantity && res.untracked === same.untracked && JSON.stringify(res.planting.workflow.seedUse || []) === JSON.stringify(same.planting.workflow.seedUse || []));
}
{
  const res = W.record(eng, inv0, tp.p, 'sow', { date: plus(sowDay, -5) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib), r2 = e2.calc(res.planting);
  check('a transplant sown 5 days early stays on the day it goes out, and is harvested when it was', res.moved === null && res.planting.date === was.date && iso(r2.first) === was.first && iso(r2.sow) === plus(sowDay, -5), { moved: res.moved, date: res.planting.date });
  check('it reads as 5 days early', W.steps(e2, res.planting)[0].late === -5);
  const on = W.record(eng, inv0, tp.p, 'sow', { date: sowDay }, ctx());
  check('sown on the day: nothing moves', on.moved === null && on.planting.date === was.date);
}
{
  const res = W.record(eng, inv0, tp.p, 'sow', { date: plus(sowDay, 4), follow: false }, ctx());
  check('with "later dates follow" off, a late sowing moves nothing', res.moved === null && res.held === false && res.planting.date === was.date && res.planting.done.sow === plus(sowDay, 4));
}
// a sowing day set by hand
{
  const own = { ...tp.p, sowOn: plus(sowDay, -7) }, e1 = E.create(withP(plan, own), Lib), r1 = e1.calc(own);
  const res = W.record(e1, inv0, own, 'sow', { date: plus(sowDay, -5) }, ctx());
  check('lateness is counted from the day he set for the sowing, when he set one', iso(r1.plannedSow) === plus(sowDay, -7) && res.moved && res.moved.days === 2 && res.planting.date === plus(was.date, 2) && !res.planting.sowOn && res.moved.sowOn === own.sowOn, res.moved);
  const e2 = E.create(withP(plan, res.planting), Lib), back = W.takeBack(e2, inv0, res.planting, 'sow', ctx());
  check('and taking it back restores the day he set', back.planting.sowOn === own.sowOn && back.planting.date === was.date);
}

// ── 5. hardening off pushes when late; potting up never does ──
{
  const hd = iso(eng.hardenStart(tp.r));
  const res = W.record(eng, inv0, tp.p, 'harden', { date: plus(hd, 3) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib), r2 = e2.calc(res.planting);
  check('hardened off 3 days late: it goes out 3 days later, and no seed is touched', res.moved && res.moved.days === 3 && res.planting.date === plus(was.date, 3) && res.inventory === null && res.used.length === 0 && iso(e2.hardenStart(r2)) === plus(hd, 3), res.moved);
  check('once hardening off is recorded, its sowing is no longer counted as seed still to sow, though no sowing day was recorded', SL.sowing(e2, res.planting).sown === true && SL.sowing(e2, res.planting).done === null && SL.sowing(eng, tp.p).sown === false);
  { const key = SL.sowing(eng, tp.p).key + '|' + SL.sowing(eng, tp.p).stockUnit, need = pl => { const row = SL.required(E.create(pl, Lib)).rows.find(x => x.key === SL.sowing(eng, tp.p).key + '|seeds'); return row ? row.toSow : null; };
    const a = need(plan), b = need(withP(plan, res.planting));
    check('and the seeds still required for its variety drop by what it would have used', a != null && b != null && a - b === SL.sowing(eng, tp.p).amount, { a, b, amount: SL.sowing(eng, tp.p).amount }); }
  const early = W.record(eng, inv0, tp.p, 'harden', { date: plus(hd, -2) }, ctx());
  check('hardened off early: nothing moves', early.moved === null && early.planting.date === was.date && early.planting.done.harden === plus(hd, -2));
  { const k = W.record(eng, inv0, tp.p, 'harden', { date: plus(hd, 3), follow: false }, ctx()), e4 = E.create(withP(plan, k.planting), Lib), r4 = e4.calc(k.planting), st4 = W.steps(e4, k.planting).find(x => x.kind === 'harden');
    check('hardened off late with the days kept: the engine uses the real day, the plan\'s own day is still known, and it reads as 3 days late', k.moved === null && iso(e4.hardenStart(r4)) === plus(hd, 3) && iso(e4.hardenPlanned(r4)) === hd && st4.late === 3 && iso(st4.planned) === hd, { start: iso(e4.hardenStart(r4)), planned: iso(e4.hardenPlanned(r4)), late: st4.late }); }
  const back = W.takeBack(e2, inv0, res.planting, 'harden', ctx());
  check('taking hardening off back clears it and puts the planting back', back.restored && back.planting.date === was.date && !back.planting.done);
}
const pot = all.find(x => x.st.some(s => s.kind === 'potup'));
if (pot) {
  const pd = iso(eng.potUpDate(pot.r)), res = W.record(eng, inv0, pot.p, 'potup', { date: plus(pd, 6) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib);
  check('potted up 6 days late: nothing after it moves, and the bench plan uses the real day', res.moved === null && res.planting.date === pot.p.date && iso(e2.potUpDate(e2.calc(res.planting))) === plus(pd, 6));
} else check('potted up late: nothing after it moves (no crop is potted up in this plan)', true);

// ── 6. planting out is a fact the harvest is counted from, both ways ──
{
  const res = W.record(eng, inv0, tp.p, 'field', { date: plus(was.date, -3) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib), r2 = e2.calc(res.planting);
  check('planted out 3 days early: the plan\'s day is kept as the plan, the harvest is 3 days sooner', res.moved === null && res.planting.date === was.date && res.planting.done.field === plus(was.date, -3) && iso(r2.first) === plus(was.first, -3) && iso(r2.field) === plus(was.date, -3));
  check('planting out a transplant uses no seed', res.inventory === null && res.used.length === 0 && !(res.planting.workflow.seedUse || []).length);
  const st2 = W.steps(e2, res.planting);
  check('with planting out recorded, the sowing never recorded is passed over, not waiting and not assumed', st2.find(s => s.kind === 'sow').passed === true && st2.find(s => s.kind === 'sow').done === null && st2.find(s => s.kind === 'field').late === -3);
  const l2 = W.lines(e2, withP(plan, res.planting), year), mine = l2.filter(l => l.members.some(m => m.p.id === tp.p.id));
  check('its line stands on the day it was done, and its hardening off is no longer listed as waiting', mine.find(l => l.section === 'plant').date === plus(was.date, -3) && mine.filter(l => l.section === 'harden').every(l => l.members.find(m => m.p.id === tp.p.id).st.passed));
  const late = W.record(e2, inv0, res.planting, 'sow', { date: plus(sowDay, 2) }, ctx());
  check('a sowing recorded late after planting out is recorded pushes nothing', late.moved === null && late.planting.date === was.date);
}
{
  const hd = iso(eng.hardenStart(tp.r)), a = W.record(eng, inv0, tp.p, 'harden', { date: hd }, ctx()), e2 = E.create(withP(plan, a.planting), Lib);
  const b = W.record(e2, inv0, a.planting, 'sow', { date: plus(sowDay, 2) }, ctx());
  check('a late sowing pushes nothing past hardening off already recorded', b.moved === null && b.planting.date === was.date);
}

// ── 7. what is refused, and why ──
check('a day after today is not a record', /not happened yet/.test(throws(() => W.record(eng, inv0, tp.p, 'harden', { date: `${year + 1}-01-05` }, ctx())) || ''));
check('a day that is not a day is refused', /real calendar date/.test(throws(() => W.record(eng, inv0, tp.p, 'harden', { date: `${year}-02-31` }, ctx())) || ''));
{
  const a = W.record(eng, inv0, tp.p, 'sow', { date: sowDay }, ctx()), e2 = E.create(withP(plan, a.planting), Lib);
  check('planting out before the sowing recorded is refused, in words', /before the sowing already recorded/.test(throws(() => W.record(e2, inv0, a.planting, 'field', { date: plus(sowDay, -1) }, ctx())) || ''), throws(() => W.record(e2, inv0, a.planting, 'field', { date: plus(sowDay, -1) }, ctx())));
  check('the same job is not recorded twice', /already recorded/.test(throws(() => W.record(e2, inv0, a.planting, 'sow', { date: sowDay }, ctx())) || ''));
  const h = W.record(e2, inv0, a.planting, 'harden', { date: plus(sowDay, 20) }, ctx()), e3 = E.create(withP(plan, h.planting), Lib);
  check('nor is hardening off', /already recorded/.test(throws(() => W.record(e3, inv0, h.planting, 'harden', { date: plus(sowDay, 21) }, ctx())) || ''));
}
check('a job the planting does not have is refused', !!throws(() => W.record(eng, inv0, all.find(x => x.r.rack).p, 'harden', { date: `${year}-05-01` }, ctx())) && !!throws(() => W.takeBack(eng, inv0, tp.p, 'harden', ctx())));

// ── 8. the plan's year holds ──
const lateOne = all.filter(x => x.r.plannedSow && !x.r.rack).sort((a, b) => b.p.date.localeCompare(a.p.date))[0];
{
  const span = E.dayDiff(E.s2d(`${year}-12-31`), E.s2d(lateOne.p.date)) + 3;
  const res = W.record(eng, inv0, lateOne.p, 'sow', { date: plus(iso(lateOne.r.plannedSow), span) }, { ...ctx(), today: `${year + 1}-12-31` });
  check('a push that would carry a planting out of the plan\'s year is not made: the planting stays, and that is said', res.moved === null && res.held === true && res.planting.date === lateOne.p.date);
}

// ── 9. trays, towers, bulbs ──
const tray = all.find(x => x.r.rack);
{
  const res = W.record(eng, inv0, tray.p, 'sow', { date: plus(tray.p.date, 2) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib);
  check('a tray batch sown 2 days late is ready 2 days later by the engine\'s own count, with no push', res.moved === null && res.planting.date === tray.p.date && iso(e2.calc(res.planting).first) === plus(iso(tray.r.first), 2));
}
const tower = all.find(x => x.r.tw && x.r.plannedSow);
if (tower) {
  const res = W.record(eng, inv0, tower.p, 'sow', { date: plus(iso(tower.r.plannedSow), 2) }, ctx());
  check('tower seedlings sown late push their cycle like any transplant', res.moved && res.moved.days === 2 && res.planting.date === plus(tower.p.date, 2));
  check('a tower planting is not hardened off', !tower.st.some(s => s.kind === 'harden'));
}
const bulb = all.find(x => x.s && x.s.kind === 'field' && !['seeds', 'g'].includes(x.s.unit) && x.p.established !== true);
if (bulb) {
  const res = W.record(eng, inv0, bulb.p, 'field', { date: plus(bulb.p.date, 1) }, ctx()), viaSL = SL.recordSowing(eng, inv0, bulb.p, { date: plus(bulb.p.date, 1) }, ctx());
  check('bulbs and bought-in plants are recorded as planted, with what was used, as the seed library does it', res.planting.done.field === plus(bulb.p.date, 1) && res.quantity === viaSL.quantity && res.stockUnit === viaSL.stockUnit && res.moved === null);
}
const mover = all.find(x => x.st.some(s => s.kind === 'move'));
if (mover) {
  const md = iso(mover.st.find(s => s.kind === 'move').planned), res = W.record(eng, inv0, mover.p, 'move', { date: plus(md, -4) }, ctx()), e2 = E.create(withP(plan, res.planting), Lib);
  check('moving out is recorded on its day, and the engine uses it', res.planting.done.move === plus(md, -4) && iso(e2.calc(res.planting).out) === plus(md, -4) && res.moved === null);
  check('moving out before planting recorded later is refused', /before the planting already recorded|after the moving out already recorded/.test(throws(() => W.record(e2, inv0, res.planting, 'field', { date: plus(md, 2) }, ctx())) || ''), throws(() => W.record(e2, inv0, res.planting, 'field', { date: plus(md, 2) }, ctx())));
}

// ── 10. a batch stays a batch ──
const batchOf = x => x.r.sowing && x.r.sowing.memberIds && x.r.sowing.memberIds.length > 1 ? x.r.sowing.memberIds : null;
const shared = all.find(x => batchOf(x) && !x.r.tw);
if (shared) {
  let pl = plan, inv = inv0; const ids = batchOf(shared), c = ctx();
  for (const id of ids) { const e = E.create(pl, Lib), p = e.planting(id), res = W.record(e, inv, p, 'sow', { date: plus(iso(shared.r.plannedSow), 3) }, c); pl = withP(pl, res.planting); if (res.inventory) inv = res.inventory; }
  const e2 = E.create(pl, Lib), after = ids.map(id => e2.calc(e2.planting(id)));
  check('plantings sown as one batch, recorded late together, all go out as many days later', ids.every(id => e2.planting(id).date === plus(eng.planting(id).date, 3)) && after.every(r => iso(r.sow) === plus(iso(shared.r.plannedSow), 3)));
}

// ── 11. not recorded stays not recorded ──
{
  const res = W.record(eng, inv0, tp.p, 'sow', { date: sowDay }, ctx()), pl = withP(plan, res.planting), e2 = E.create(pl, Lib), l2 = W.lines(e2, pl, year);
  const others = l2.filter(l => !l.members.some(m => m.p.id === tp.p.id));
  check('recording one job dates that job alone: every other line is as open as it was', others.every(l => l.state === 'open') && l2.filter(l => l.members.some(m => m.p.id === tp.p.id)).every(l => l.members.find(m => m.p.id === tp.p.id).st.done === null));
}
// ── 12. put off on purpose, skipped, and a note ──
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const days = (e, q) => { const r = e.calc(q); return [r.plannedSow, r.planned, r.first, r.last].map(x => (x ? iso(new Date(x)) : '')); };
  const d0 = days(eng, tp.p), kinds = tp.st.map(s => s.kind);
  // a sowing put off takes its planting with it
  const put = W.delay(eng, tp.p, 'sow', plus(sowDay, 5)), e1 = E.create(withP(plan, put.planting), Lib), st1 = W.steps(e1, put.planting), d1 = days(e1, put.planting);
  check('a sowing put off five days goes out, is planted and is picked five days later, and says the day it was first planned for', put.moves && put.days === 5 && put.from === sowDay && put.to === plus(sowDay, 5) && put.planting.date === plus(tp.p.date, 5) && d1.every((x, i) => x === plus(d0[i], 5)) && iso(st1[0].planned) === plus(sowDay, 5) && st1[0].delayedFrom === sowDay && same(put.planting.tasks, { delay: { sow: { from: sowDay, to: plus(sowDay, 5) } } }), [put, d0, d1]);
  check('the jobs after it are not marked as put off: they only follow', st1.slice(1).every(s => !s.delayedFrom) && st1.map(s => s.kind).join() === kinds.join());
  const again = W.delay(e1, put.planting, 'sow', plus(sowDay, 9));
  check('put off a second time, it still says the day it was first planned for', again.days === 4 && again.planting.date === plus(tp.p.date, 9) && same(again.planting.tasks.delay.sow, { from: sowDay, to: plus(sowDay, 9) }), again);
  const back = W.delay(e1, put.planting, 'sow', sowDay);
  check('put back on its first day, the planting is as it was, with nothing kept', back.days === -5 && same(back.planting, tp.p), back.planting);
  check('putting a job off to the day it is on already is nothing', W.delay(eng, tp.p, 'sow', sowDay) === null);
  check('a day that is no date, or one that takes the planting out of its year, is refused', /real calendar date/.test(throws(() => W.delay(eng, tp.p, 'sow', '2027-02-30')) || '') && /out of 2027/.test(throws(() => W.delay(eng, tp.p, 'sow', plus(sowDay, 400))) || ''), [throws(() => W.delay(eng, tp.p, 'sow', '2027-02-30')), throws(() => W.delay(eng, tp.p, 'sow', plus(sowDay, 400)))]);
  const sown = W.record(eng, inv0, tp.p, 'sow', { date: sowDay }, ctx()), e3 = E.create(withP(plan, sown.planting), Lib);
  check('work already recorded cannot be put off, and work a planting does not have cannot either', /already recorded/.test(throws(() => W.delay(e3, sown.planting, 'sow', plus(sowDay, 3))) || '') && /no such work/.test(throws(() => W.delay(eng, all.find(x => !x.st.some(s => s.kind === 'move')).p, 'move', plus(sowDay, 3))) || ''));
  // hardening off put off is the grower's choice to go out later
  const hd = iso(tp.st.find(s => s.kind === 'harden').planned), hard = W.delay(eng, tp.p, 'harden', plus(hd, 3)), e4 = E.create(withP(plan, hard.planting), Lib), d4 = days(e4, hard.planting);
  check('hardening off put off three days plants it out and picks it three days later', hard.moves && hard.planting.date === plus(tp.p.date, 3) && d4[1] === plus(d0[1], 3) && d4[2] === plus(d0[2], 3) && W.steps(e4, hard.planting).find(s => s.kind === 'harden').delayedFrom === hd, [hard, d4]);
  // potting up moves nothing: only the day it is listed on
  const potter = all.find(x => x.st.some(s => s.kind === 'potup') && !x.p.tasks && x.p.date.slice(5) < '10-01');
  if (potter) {
    const pd = iso(potter.st.find(s => s.kind === 'potup').planned), pot = W.delay(eng, potter.p, 'potup', plus(pd, 2)), e5 = E.create(withP(plan, pot.planting), Lib), st5 = W.steps(e5, pot.planting), k = st5.find(s => s.kind === 'potup');
    check('potting up put off two days is listed two days later and nothing else moves', !pot.moves && pot.planting.date === potter.p.date && same(days(e5, pot.planting), days(eng, potter.p)) && iso(k.planned) === plus(pd, 2) && k.delayedFrom === pd && iso(k.own) === pd && st5.filter(s => s.kind !== 'potup').every((s, i) => +s.planned === +potter.st.filter(x => x.kind !== 'potup')[i].planned), [pot, pd]);
    check('put back on the plan’s own day, nothing is kept', same(W.delay(e5, pot.planting, 'potup', pd).planting, potter.p));
    // the plan moves under it: the day chosen no longer stands
    const moved = { ...pot.planting, date: plus(pot.planting.date, 14) }, e6 = E.create(withP(plan, moved), Lib), k6 = W.steps(e6, moved).find(s => s.kind === 'potup');
    check('when the planting is moved afterwards, the day once chosen for potting up is let go: the plan’s new day stands', k6 && !k6.delayedFrom && +k6.planned === +k6.own && iso(k6.planned) !== plus(pd, 2), k6 && [iso(k6.planned), k6.delayedFrom]);
  }
  // skipped
  const skipped = W.skip(tp.p, 'sow', sowDay), e7 = E.create(withP(plan, skipped), Lib), st7 = W.steps(e7, skipped), l7 = W.lines(e7, withP(plan, skipped), year);
  check('a skipped job says the day it was skipped on, and nothing else about the planting changes', st7[0].skipped === sowDay && st7.slice(1).every(s => !s.skipped) && same(days(e7, skipped), d0) && same({ ...skipped, tasks: undefined }, { ...tp.p, tasks: undefined }) && same(skipped.tasks, { skip: { sow: sowDay } }), skipped.tasks);
  const hl = l7.filter(l => l.members.some(m => m.p.id === tp.p.id)), sk = W.skip(tp.p, 'harden', hd), e8 = E.create(withP(plan, sk), Lib), l8 = W.lines(e8, withP(plan, sk), year).find(l => l.kind === 'harden' && l.members.some(m => m.p.id === tp.p.id));
  check('a skipped sowing leaves the planting’s other lines open', hl.length > 0 && hl.every(l => l.state === 'open' && !l.skipped), hl.map(l => [l.kind, l.state, l.skipped]));
  check('a line all of whose plantings are skipped says so, and one with a planting still to do does not', l8 && (l8.members.length === 1 ? l8.skipped === hd : !l8.skipped), l8 && [l8.members.length, l8.skipped, l8.state]);
  check('put back, the planting is as it was', same(W.skip(skipped, 'sow', null), tp.p) && /real calendar date/.test(throws(() => W.skip(tp.p, 'sow', 'soon')) || ''));
  const done7 = W.record(e7, inv0, skipped, 'sow', { date: sowDay }, ctx()), e9 = E.create(withP(plan, done7.planting), Lib);
  check('a skipped job that is recorded after all is done, not skipped', W.steps(e9, done7.planting)[0].done === sowDay && W.steps(e9, done7.planting)[0].skipped === null);
  // a note, and what a copy carries
  const noted = W.withTask(W.withTask(put.planting, 'note', 'sow', 'seed is in the cooler'), 'skip', 'harden', hd);
  check('a note is kept with its job and read back; cleared, it is gone', W.noteOf(noted, 'sow') === 'seed is in the cooler' && W.noteOf(noted, 'harden') === '' && W.noteOf(W.withTask(noted, 'note', 'sow', ''), 'sow') === '' && !('note' in W.withTask(noted, 'note', 'sow', '').tasks));
  check('what is kept is read with care: a day that is no day, or a put-off with half its days, counts as nothing', W.skipOf({ tasks: { skip: { sow: 'yes' } } }, 'sow') === null && W.delayOf({ tasks: { delay: { sow: { from: sowDay } } } }, 'sow') === null && W.noteOf({ tasks: 7 }, 'sow') === '' && W.skipOf({}, 'sow') === null);
  const R = req(app, 'js/rails.js'), e10 = E.create(withP(plan, noted), Lib), at = { bedId: noted.bedId, date: E.s2d(plus(noted.date, 21)) };
  const copy = R.propose(e10, { plantingId: noted.id, copy: true }, at), move = R.propose(e10, { plantingId: noted.id }, at);
  check('a copy of a planting starts clean: nothing put off, skipped or noted comes with it, while the planting itself keeps them when moved', copy.p && !('tasks' in copy.p) && copy.p.id !== noted.id && move.p && same(move.p.tasks, noted.tasks), [copy.state, copy.p && copy.p.tasks, move.p && move.p.tasks]);
  const packed = IO.unpack(IO.pack(withP(plan, noted)));
  check('what is put off, skipped and noted survives the plan being packed and read back', same((packed.plantings.find(x => x.id === noted.id) || {}).tasks, noted.tasks), (packed.plantings.find(x => x.id === noted.id) || {}).tasks);
}
finished = true;
