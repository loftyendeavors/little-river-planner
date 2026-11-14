'use strict';
// Guard-rail rules checked on the real plan, without a browser.
// usage: node rails_test.cjs <app-dir> <plan.json>
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path');
const [appDir, planFile] = process.argv.slice(2);
const E = require(path.join(appDir, 'js/engine.js')), Lib = require(path.join(appDir, 'js/library.js'));
const IO = require(path.join(appDir, 'js/planio.js')), R = require(path.join(appDir, 'js/rails.js'));

const { core } = IO.split(JSON.parse(fs.readFileSync(planFile, 'utf8')));
const results = [], fail = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) fail.push(name); };
const withOps = (plan, ops) => ({ ...plan, plantings: [...plan.plantings.filter(q => !ops.some(op => op.before && op.before.id === q.id)), ...ops.map(op => op.after).filter(Boolean)] });
const state = eng => { let over = 0; const pairs = new Set(); for (const p of eng.plan.plantings) { const r = eng.calc(p); if (!r) continue; if (eng.overflow(p, r)) over++; for (const o of eng.conflicts(p, r)) pairs.add([p.id, o.p ? o.p.id : 'rest'].sort().join('|')); } return { over, pairs: pairs.size }; };
const bedNamed = (eng, garden, bed) => eng.plan.beds.find(b => eng.gardenOf(b).name === garden && String(b.bed) === String(bed));
const D = E.s2d;

// 1 ── what the plan arrives with
let eng = E.create(core, Lib);
const start = state(eng), todo = R.cleanup(eng);
check('the plan arrives with over-long plantings and colliding pairs, none of them on the shared benches', start.over >= 1 && start.pairs >= 8 && todo.long.every(x => !eng.isPool(x.r.b)) && todo.groups.every(g => !eng.isPool(g.bed)), start);
check('cleanup lists every one of them', todo.long.length === start.over && todo.groups.length >= 6 && todo.groups.reduce((n, g) => n + g.early.length, 0) === start.pairs, { long: todo.long.length, groups: todo.groups.map(g => `${eng.gardenOf(g.bed).name} ${g.bed.bed}: ${g.late.cropId} vs ${g.early.length} (${g.days}d) -> ${g.options.map(o => o.id + (o.also && o.also.length ? '+' + o.also.length : '')).join('/')}`) });
check('every situation has at least one way to settle it', todo.groups.every(g => g.options.length > 0), todo.groups.filter(g => !g.options.length).map(g => `${eng.gardenOf(g.bed).name} ${g.bed.bed}: ${g.late.cropId} ${g.late.date}`));

// each option, on its own, removes that collision and starts no new one
let optionsOk = true; const optionNotes = [];
for (const g of todo.groups) for (const o of g.options) {
  const after = E.create(withOps(core, o.ops), Lib), early = new Set(g.early.map(x => x.p.id));
  const still = after.conflicts(after.planting(g.late.id)).some(x => x.p && early.has(x.p.id)), refused = R.refusal(eng, after, o.ops.map(x => x.after.id));
  if (still || refused) { optionsOk = false; optionNotes.push({ bed: g.bed.bed, option: o.id, still, refused: refused && refused.kind }); }
}
check('each offered option clears its collision and passes the gate', optionsOk, optionNotes);

// settle everything: trim, then keep taking the first option until nothing is left
let plan = withOps(core, R.trimOps(eng, todo.long)), rounds = 0;
for (; rounds < 60; rounds++) { const e = E.create(plan, Lib), c = R.cleanup(e); if (!c.groups.length) break; plan = withOps(plan, c.groups[0].options[0].ops); }
const clean = E.create(plan, Lib), end = state(clean);
check('after cleanup nothing overlaps and nothing is over-long', end.over === 0 && end.pairs === 0 && plan.plantings.length === core.plantings.length, { ...end, rounds });
eng = clean;

// 2 ── drops from the library
const empty = eng.plan.beds.find(b => eng.isSoilBed(b) && b.active !== false && eng.plantingsIn(b.id).length === 0);
let res = R.propose(eng, { cropId: 'carrot' }, { bedId: empty.id, date: D('2027-06-01') });
check('a crop on an empty bed takes the whole bed', res.state === 'ok' && res.p.ft == null && res.p.startFt == null && res.rect.a0 === 0 && res.rect.a1 === eng.capOf(empty), { state: res.state, rect: res.rect });
const busyBed = bedNamed(eng, 'Long Rows', 1);
res = R.propose(eng, { cropId: 'carrot' }, { bedId: busyBed.id, date: D('2027-05-10') });
check('a crop on held ground is refused, naming who holds it', res.state === 'blocked' && res.why === 'held' && res.blockers.length >= 2, { state: res.state, why: res.why, n: res.blockers && res.blockers.length });
check('microgreens only go on a bench', R.propose(eng, { cropId: (eng.crops().find(c => c.micro) || {}).id }, { bedId: empty.id, date: D('2027-06-01') }).why === 'micro-needs-bench');
const pool = eng.plan.beds.find(b => eng.isPool(b));
if (pool) {
  const batch = eng.plantingsIn(pool.id)[0];
  check('nothing is dropped onto the shared benches, and a tray batch is not moved by hand', R.propose(eng, { cropId: (eng.crops().find(c => c.micro) || {}).id }, { bedId: pool.id, date: D('2027-06-01') }).why === 'pool' && (!batch || R.propose(eng, { plantingId: batch.id }, { bedId: pool.id, date: D('2027-07-01') }).why === 'pool') && (!batch || R.propose(eng, { plantingId: batch.id }, { bedId: empty.id, date: D('2027-07-01') }).why === 'pool'));
}

// a shortened planting leaves a stretch free; the next crop lands in it
plan = withOps(eng.plan, [{ before: null, after: res = R.propose(eng, { cropId: 'carrot' }, { bedId: empty.id, date: D('2027-06-01') }).p }]);
const first = plan.plantings[plan.plantings.length - 1];
let e2 = E.create(plan, Lib);
const s1 = R.stretch(e2, e2.planting(first.id), 'end', 12.3);
check('dragging an end snaps to whole feet and gives a length', s1.a0 === 0 && s1.a1 === 12 && s1.change.ft === 12 && s1.change.startFt == null, s1);
plan = { ...plan, plantings: plan.plantings.map(q => q.id === first.id ? { ...q, ft: 12 } : q) }; e2 = E.create(plan, Lib);
res = R.propose(e2, { cropId: 'beet' }, { bedId: empty.id, date: D('2027-06-10') });
const L = e2.capOf(empty);
check('a crop on a part-held bed takes the free stretch, at its position', res.state === 'partial' && res.p.ft === L - 12 && res.p.startFt === 12 && res.rect.a0 === 12 && res.rect.a1 === L, { state: res.state, ft: res.p && res.p.ft, startFt: res.p && res.p.startFt, L });
plan = withOps(plan, [{ before: null, after: res.p }]); e2 = E.create(plan, Lib);
const second = res.p;
check('the two share the bed without colliding', e2.conflicts(e2.planting(first.id)).length === 0 && e2.conflicts(e2.planting(second.id)).length === 0);
const s2 = R.stretch(e2, e2.planting(first.id), 'end', 17);
check('an end cannot be dragged into the neighbour', s2.a1 === 12 && s2.hi === 12, s2);
const s3 = R.stretch(e2, e2.planting(second.id), 'start', 15.2);
check('the neighbour can give ground back', s3.a0 === 15 && s3.change.ft === L - 15 && s3.change.startFt === 15, s3);
res = R.propose(e2, { cropId: 'radish' }, { bedId: empty.id, date: D('2027-06-20') });
check('a full bed refuses a third crop', res.state === 'blocked', res.state);

// 3 ── the gate on edits
const grow = (p, change) => { const after = E.create({ ...e2.plan, plantings: e2.plan.plantings.map(q => q.id === p.id ? { ...q, ...change } : q) }, Lib); return R.refusal(e2, after, [p.id]); };
check('lengthening into the neighbour is refused', (grow(first, { ft: 15 }) || {}).kind === 'overlap', grow(first, { ft: 15 }) && grow(first, { ft: 15 }).kind);
check('lengthening past the bed end is refused', (grow(second, { ft: L - 12 + 3 }) || {}).kind === 'too-long');
check('an edit that keeps clear is allowed', grow(first, { ft: 10 }) === null && grow(first, { date: '2027-06-03' }) === null);
// a collision already in the plan may shrink but not grow
// The subject is found on the plan: the last planting of a bed, put in while an earlier one still held the same ground, by a week or more.
const raw = E.create(core, Lib), day = n => E.d2s(E.addDays(D(cab.date), n));
const lateOnes = raw.plan.plantings.map(p => { const r = raw.calc(p); if (!r || !raw.isSoilBed(r.b) || p.bedLayout) return null; if (raw.plantingsIn(p.bedId).some(q => q.date > p.date)) return null;   // the last crop in its bed: moved later, it meets nothing new
  const before = raw.conflicts(p, r).filter(o => o.p && o.from < r.field); if (!before.length) return null;
  const days = Math.max(...before.map(o => E.dayDiff(o.through, r.field) + 1)); return days >= 8 ? { p, days } : null; }).filter(Boolean);
check('the plan holds a planting put in a week or more before the ground was free', lateOnes.length > 0, lateOnes.length);
const cab = (lateOnes[0] || {}).p, overlapDays = (lateOnes[0] || {}).days;
const edit = change => R.refusal(raw, E.create({ ...core, plantings: core.plantings.map(q => q.id === cab.id ? { ...q, ...change } : q) }, Lib), [cab.id]);
check('an old overlap may be made smaller', !!cab && edit({ date: day(3) }) === null);
check('an old overlap may not be made bigger', !!cab && (edit({ date: day(-7) }) || {}).kind === 'overlap');
check('an old overlap may be cleared', !!cab && edit({ date: day(overlapDays + 1) }) === null);

// 4 ── moving plantings
const moveable = e2.plan.plantings.find(p => { const r = e2.calc(p); return r && e2.isSoilBed(r.b) && !p.bedLayout && !e2.standKey(p) && !(p.ft > 0) && r.field < D('2027-06-15') && e2.occupancyThrough(p, r) > D('2027-06-15'); });
const there = e2.bedOf(moveable.bedId);
const spare = e2.plan.beds.find(b => e2.isSoilBed(b) && b.id !== there.id && b.id !== empty.id && R.propose(e2, { plantingId: moveable.id }, { bedId: b.id, date: D(moveable.date) }).state === 'ok');
res = spare && R.propose(e2, { plantingId: moveable.id }, { bedId: spare.id, date: D(moveable.date) });
check('a planting moves to a free bed and keeps its date and id', !!res && res.state === 'ok' && res.p.id === moveable.id && res.p.date === moveable.date && res.p.bedId === spare.id);
// swap: two whole-bed plantings that hold different beds over the same weeks
let trade = null;
for (const b of e2.plan.beds) {
  if (!e2.isSoilBed(b) || b.id === there.id) continue;
  const blocked = R.propose(e2, { plantingId: moveable.id }, { bedId: b.id, date: D(moveable.date) });
  if (blocked.state !== 'blocked') continue;
  const t = R.swap(e2, { plantingId: moveable.id }, { bedId: b.id, date: D(moveable.date) });
  if (t) { trade = { t, b }; break; }
}
if (trade) {
  const after = E.create(withOps(e2.plan, trade.t.ops), Lib), ids = trade.t.ops.map(o => o.after.id);
  check('a blocked move can be made as a swap that leaves nothing colliding', ids.every(id => after.conflicts(after.planting(id)).length === 0 && !after.overflow(after.planting(id), after.calc(after.planting(id)))) && after.planting(moveable.id).bedId === trade.b.id && trade.t.traded.every(q => after.planting(q.id).bedId === there.id) && R.refusal(e2, after, ids) === null, { traded: trade.t.traded.length, to: e2.gardenOf(trade.b).name + ' ' + trade.b.bed });
} else check('a blocked move can be made as a swap that leaves nothing colliding', false, 'no swap candidate found');
// row-split plantings keep their rows
const potato = e2.plan.plantings.find(p => p.cropId === 'potato' && p.bedLayout), pr = e2.calc(potato);
const quiet = D('2027-11-15'), longBed = e2.plan.beds.find(b => e2.isSoilBed(b) && b.id !== potato.bedId && e2.capOf(b) >= 30 && R.propose(e2, { plantingId: potato.id }, { bedId: b.id, date: quiet }).state !== 'blocked');
res = R.propose(e2, { plantingId: potato.id }, { bedId: longBed.id, date: quiet });
check('a planting on one of two rows keeps that row when moved', !!res.r && !!res.r.layout && res.rect.x1 - res.rect.x0 === 0.5 && res.r.rows === 1, { state: res.state, rect: res.rect, len: res.r && res.r.physicalLength, from: pr.physicalLength });
// a row given up becomes a strip the next crop can take
const whole = e2.planting(first.id), rc = R.rowsChange(e2, whole, 0, 1, 3);
plan = { ...e2.plan, plantings: e2.plan.plantings.map(q => { if (q.id !== first.id) return q; const n = { ...q }; for (const [k, v] of Object.entries(rc)) { if (v == null) delete n[k]; else n[k] = v; } return n; }) };
let e3 = E.create(plan, Lib);
const narrowed = e3.calc(e3.planting(first.id));
check('giving up rows makes a valid row split', !!narrowed.layout && narrowed.rows === 1 && narrowed.totalRows === 3, { layout: narrowed.layout, rows: narrowed.rows });
res = R.propose(e3, { cropId: 'radish' }, { bedId: empty.id, date: D('2027-06-05'), along: 5, across: 0.8 });
check('a crop aimed at the freed rows takes them', res.state === 'partial' && !!res.r.layout && res.r.layout.rowStart === 1 && res.r.layout.rowCount === 2 && res.rect.a0 === 0 && res.rect.a1 === 12, { state: res.state, why: res.why, rect: res.rect });

// 5 ── towers
const tw = e2.plan.plantings.find(p => p.towerCycle), tr = e2.calc(tw), row = e2.plan.beds.filter(b => e2.isTower(b) && b.id !== tw.bedId);
const heldTower = row.find(b => R.propose(e2, { plantingId: tw.id }, { bedId: b.id, date: tr.field }).state === 'blocked');
check('a tower already in a cycle refuses a second crop', !!heldTower);
if (heldTower) { const t = R.swap(e2, { plantingId: tw.id }, { bedId: heldTower.id, date: tr.field }); check('tower cycles trade places and keep their cycle', !!t && !!t.p.towerCycle && t.ops.length === 2 && t.ops.every(o => !!o.after.towerCycle), t && t.ops.length); }
check('a tower planting moved to a soil bed drops its tower cycle', (() => { const r = R.propose(e2, { plantingId: tw.id }, { bedId: spare.id, date: D('2027-11-20') }); return r.p && !r.p.towerCycle; })());

// 6 ── whatever is proposed must itself pass
let tried = 0, placed = 0, bad = 0; const crops = eng.crops().filter(c => !c.micro).map(c => c.id), seenBeds = new Set(), badNotes = [];
let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * n); };   // the high bits: an LCG's low bits repeat
for (let i = 0; i < 3000; i++) {
  const b = e2.plan.beds[rnd(e2.plan.beds.length)], date = E.addDays(D('2027-03-01'), rnd(240));
  const payload = rnd(3) ? { cropId: crops[rnd(crops.length)] } : { plantingId: e2.plan.plantings[rnd(e2.plan.plantings.length)].id };
  const at = rnd(2) ? { along: rnd(Math.max(1, Math.round(e2.capOf(b)))), across: rnd(100) / 100 } : {};
  const r = R.propose(e2, payload, { bedId: b.id, date, ...at });
  tried++; seenBeds.add(b.id);
  if (r.state === 'blocked') continue;
  placed++;
  const after = E.create(withOps(e2.plan, [{ before: payload.plantingId ? e2.planting(payload.plantingId) : null, after: r.p }]), Lib), q = after.planting(r.p.id);
  if (after.conflicts(q).length || after.overflow(q, after.calc(q))) { bad++; if (badNotes.length < 4) badNotes.push({ bed: e2.gardenOf(b).name + ' ' + b.bed, date: E.d2s(date), payload, state: r.state }); }
}
check('3,000 random drops over every kind of space: none that is accepted collides or overflows', bad === 0 && placed > 200 && seenBeds.size > e2.plan.beds.length * 0.9, { tried, placed, bad, beds: seenBeds.size, of: e2.plan.beds.length, badNotes });

console.log(JSON.stringify({ passed: results.length - fail.length, checks: results.length, failed: fail, results: results.map(r => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail !== undefined && (!r.ok || process.env.VERBOSE) ? ' ' + JSON.stringify(r.detail).slice(0, 1200) : ''}`) }, null, 1));
process.exitCode = fail.length ? 1 : 0;
