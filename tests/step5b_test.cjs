/* Step 5b, the nursery, with no browser: benches of three kinds and their edits, the room on each kind of bench,
 * hardening off going outside, how a live tray is sown and what that does to seed, what a season uses, and that the
 * build by itself moves nothing.
 * usage: node step5b_test.cjs <app-dir> <plan.json> [dir holding the previous build's js]
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
const Lib = req(app, 'js/library.js'), E = req(app, 'js/engine.js'), IO = req(app, 'js/planio.js'), SL = req(app, 'js/seedlib.js'), N = req(app, 'js/nursery.js'), T = req(app, 'js/trays.js'), W = req(app, 'js/week.js');
const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const plan = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const eng = E.create(plan, Lib), year = +plan.settings.year, P = plan.plantings;
const iso = d => E.d2s(d), near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const days = function* () { for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) yield d; };
const throws = fn => { try { fn(); return null; } catch (e) { return e.message || 'threw'; } };
let seq = 0; const uid = () => 'new-' + (++seq);
const withNursery = n => E.create({ ...plan, nursery: n }, Lib);
const STANDS = ['live', 'tray', 'rockwool', 'pot', 'crate'];

// ── 1. the build by itself moves nothing ──
if (oldDir) {
  const E0 = require(path.join(oldDir, 'engine.js')), SL0 = require(path.join(oldDir, 'seedlib.js')), eng0 = E0.create(plan, Lib);
  const differ = [];
  for (const p of P) {
    const a = eng.calc(p), b = eng0.calc(p);
    if (!a !== !b) { differ.push(p.id); continue; }
    if (!a) continue;
    const row = (e, r, D) => [r.sow, r.field, r.first, r.last, e.potUpDate(r), e.hardenStart(r), r.out].map(x => (x ? D.d2s(new Date(x)) : '')).join(',') + '|' + [r.plants, r.seeds, r.seedG, r.cells, r.trays, r.bulbs].join(',');
    if (row(eng, a, E) !== row(eng0, b, E0)) differ.push(p.id);
  }
  check('every planting has the dates, the seed, the cells and the trays it had in the build before', differ.length === 0, differ.slice(0, 5));
  const off = [];
  for (const d of days()) { const a = eng.benchDay(d), b = eng0.benchDay(d); if (!['total', 'cap', 'over', 'floorCrates', ...STANDS].every(k => near(a[k], b[k], 1e-9))) off.push(iso(d)); }
  check('the benches hold what they held, and carry what they carried, on every day of the year', off.length === 0 && eng.heatedTraySpaces() === eng0.heatedTraySpaces(), off.slice(0, 5));
  const rows = (lib, e) => lib.required(e).rows.filter(r => r.total > 0 || r.toSow > 0).map(r => [r.key, r.unit, r.total, r.toSow, r.trays].join('|')).join('\n');
  check('seeds required are the same, row for row and unit for unit, wherever anything is counted', rows(SL, eng) === rows(SL0, eng0));
  const tr = e => { const out = []; for (const d of days()) { const u = e.traysOn(d); out.push([u.carriers, u.live, ...u.plug.map(t => t.id + ':' + t.n)].join(',')); } return out.join('\n'); };
  check('the trays in use on every day are the same', tr(eng) === tr(eng0));
}

// ── 2. the room on each kind of bench ──
const fig = N.season(eng, year), list = eng.benchList();
check('a bench is under heat, under cover without heat, or outside, and every bench of the plan is one of them', list.length > 0 && list.every(b => N.KIND_IDS.includes(b.kind)) && N.KINDS.length === 3 && N.KIND_IDS.join() === 'heated,unheated,outside');
check('the room of a kind is the sum of its benches in use', N.KIND_IDS.every(k => fig.room[k] === list.filter(b => b.active && b.kind === k).reduce((n, b) => n + b.cap, 0)) && fig.room.heated === eng.heatedTraySpaces());
{
  let bad = [];
  for (const d of days()) { const r = eng.benchDay(d), sum = N.KIND_IDS.reduce((n, k) => n + r.pools[k].used, 0); if (!near(sum, r.total)) bad.push(iso(d)); for (const s of STANDS) if (!near(N.KIND_IDS.reduce((n, k) => n + r.pools[k][s], 0), r[s])) bad.push(iso(d) + s); }
  check('on every day, what stands on the three kinds of bench adds up to what stands under cover, kind by kind', bad.length === 0, bad.slice(0, 5));
}
const allHeated = list.every(b => b.kind === 'heated');
if (allHeated) {
  let bad = [];
  for (const d of days()) { const r = eng.benchDay(d); if (!near(r.pools.heated.used, r.total, 1e-12) || r.pools.outside.used || r.pools.unheated.used || !near(r.over, Math.max(0, r.total - r.cap), 1e-12)) bad.push(iso(d)); }
  check('with every bench under heat, everything stands under heat, hardening off included', bad.length === 0 && fig.shown.join() === 'heated' && fig.hardening.inside === fig.hardening.most, bad.slice(0, 3));
}
check('hardening off is found: some seedlings harden on some day, and none before its own hardening day', fig.hardening.most > 0 && [...days()].every(d => eng.benchDay(d).items.every(it => !it.harden || (eng.hardenStart(it.r) && d >= eng.hardenStart(it.r) && d < it.r.field))), fig.hardening);
check('tower seedlings and live trays never harden off', [...days()].every(d => eng.benchDay(d).items.every(it => !it.harden || (it.kind !== 'rockwool' && it.kind !== 'live'))));

// a bench outside, and one without heat
const most = fig.hardening.most, mostDay = fig.hardening.on;
const add = (n, change) => { const made = N.addBench(n, { uid }); return N.setBench(made.nursery, made.bench.id, change); };
{
  const small = Math.max(1, Math.floor(most / 3)), cool = Math.max(1, Math.floor(most / 4));
  const n1 = add(plan.nursery, { kind: 'outside', holds: small, name: 'Table outside' }), e1 = withNursery(n1), r1 = e1.benchDay(mostDay), r0 = eng.benchDay(mostDay);
  check('a bench outside takes what hardens off, up to what it holds, and that much leaves the heat', near(r1.pools.outside.used, Math.min(most, small)) && near(r1.pools.heated.used, r0.total - Math.min(most, small)) && r1.pools.outside.over === 0 && near(r1.total, r0.total), { out: r1.pools.outside.used, small, most });
  check('nothing but hardening seedlings ever stands outside', [...days()].every(d => { const r = e1.benchDay(d); return r.pools.outside.used <= r.harden + 1e-9 && r.pools.outside.live === 0 && r.pools.outside.rockwool === 0 && r.pools.outside.used <= r.pools.outside.cap + 1e-9; }));
  const n2 = add(n1, { kind: 'unheated', holds: cool, name: 'Cold bench' }), e2 = withNursery(n2), r2 = e2.benchDay(mostDay);
  check('with unheated benches too, what hardens off goes there first, then outside, and only what fits on neither stays under heat', near(r2.pools.unheated.used, Math.min(most, cool)) && near(r2.pools.outside.used, Math.min(most - cool, small)) && near(r2.pools.heated.used, r0.total - Math.min(most, cool) - Math.min(most - cool, small)) && near(r2.hardenIn, most - cool - Math.min(most - cool, small)) && most > cool + small, { r2: r2.pools, most, small, cool });
  {
    const roomy = add(n1, { kind: 'unheated', holds: Math.ceil(most) + 10, name: 'Roomy cold bench' }), r5 = withNursery(roomy).benchDay(mostDay);
    check('with room enough on the unheated benches, nothing that hardens off goes outside', near(r5.pools.unheated.used, most) && r5.pools.outside.used === 0 && near(r5.hardenIn, 0));
  }
  check('an unheated bench is not counted in the room under heat', e2.heatedTraySpaces() === eng.heatedTraySpaces() && e2.benchRoom(mostDay).unheated === cool && e2.benchRoom(mostDay).outside === small);
  const f2 = N.season(e2, year);
  check('the season names each kind of bench with room, its fullest day and the hardening left under cover', f2.shown.join() === 'heated,unheated,outside' && f2.pools.outside.tightest && near(f2.pools.outside.tightest.used, Math.min(most - cool, small)) && near(f2.pools.unheated.tightest.used, cool) && near(f2.hardening.inside, most - cool - Math.min(most - cool, small)) && f2.pools.outside.over.length === 0 && f2.pools.unheated.over.length === 0, { shown: f2.shown, inside: f2.hardening.inside });
  {
    const byWeek = new Map(), mon = d => iso(E.addDays(d, -((d.getDay() + 6) % 7)));
    for (const d of days()) { const r = e2.benchDay(d); if (!r.total) continue; const w = byWeek.get(mon(d)) || {}; for (const k of N.KIND_IDS) { const p = r.pools[k], gap = p.used - p.cap; if (!(k in w) || gap > w[k].gap || (gap === w[k].gap && p.used > w[k].used)) w[k] = { gap, used: p.used, day: iso(d) }; } byWeek.set(mon(d), w); }
    const off = f2.weeks.filter(w => w.pools).filter(w => N.KIND_IDS.some(k => !near(w.pools[k].used, byWeek.get(w.week)[k].used) || iso(w.pools[k].date) !== byWeek.get(w.week)[k].day));
    check('a week shows each kind of bench on that kind\'s own fullest day of the week', off.length === 0 && f2.weeks.some(w => w.pools && iso(w.pools.outside.date) !== iso(w.pools.heated.date)), off.slice(0, 2).map(w => w.week));
  }
  const big = add(plan.nursery, { kind: 'outside', holds: Math.ceil(most) + 50 }), e3 = withNursery(big);
  check('with room enough outside, nothing that hardens off stays under heat on any day', [...days()].every(d => { const r = e3.benchDay(d); return near(r.pools.outside.used, r.harden) && near(r.pools.heated.used, r.total - r.harden); }) && N.season(e3, year).hardening.inside < 1e-9);
  // the compatibility mode's reading of the same record
  const compat = E.create({ ...plan, nursery: n2 }, Lib, { multipliers: true });
  check('in the compatibility mode an unheated bench is under cover, and a typed tray count is not read', compat.benchList().find(b => b.name === 'Cold bench').kind === 'heated' && compat.benchList().find(b => b.name === 'Cold bench').cap === compat.benchList().find(b => b.name === 'Cold bench').estimate);
  // put away for the winter
  const seasonal = N.setBench(n1, n1.spaces[n1.spaces.length - 1].id, {}); seasonal.spaces[seasonal.spaces.length - 1].from = '04-15'; seasonal.spaces[seasonal.spaces.length - 1].to = '10-31';
  const e4 = withNursery(seasonal);
  check('a bench outside that is put away for the winter holds nothing then', e4.benchRoom(new Date(year, 1, 1)).outside === 0 && e4.benchRoom(new Date(year, 4, 1)).outside === small && e4.benchRoom(new Date(year, 10, 15)).outside === 0);
}

// ── 3. editing the benches ──
{
  const n0 = plan.nursery, before = JSON.stringify(n0), last = n0.spaces[n0.spaces.length - 1];
  const made = N.addBench(n0, { uid });
  check('a new bench is like the last one, in use, with a name no other bench has, and the record handed in is not touched', made.bench.w === last.w && made.bench.l === last.l && made.bench.kind === (last.kind || 'heated') && made.bench.active === true && !n0.spaces.some(s => s.name === made.bench.name) && made.nursery.spaces.length === n0.spaces.length + 1 && JSON.stringify(n0) === before, made.bench);
  check('the first bench of an empty plan is 3 by 6 feet under heat', (() => { const b = N.addBench(null, { uid }).bench; return b.w === 3 && b.l === 6 && b.kind === 'heated' && b.name === 'Bench 1'; })());
  const id = made.bench.id, cap = n => withNursery(n).benchList().find(b => b.id === id);
  check('a bench holds its area × packing ÷ one tray, rounded down', cap(made.nursery).cap === Math.floor(last.w * last.l * ((n0.packing || 85) / 100) / (200 / 144)) && cap(made.nursery).holds === null);
  const own = N.setBench(made.nursery, id, { holds: '17' });
  check('his own count of what a bench holds beats the estimate, and clearing it brings the estimate back', cap(own).cap === 17 && cap(own).holds === 17 && cap(own).estimate === cap(made.nursery).cap && cap(N.setBench(own, id, { holds: '' })).cap === cap(made.nursery).cap && !('holds' in N.setBench(own, id, { holds: '' }).spaces.find(s => s.id === id)));
  check('a bench out of use holds nothing', (() => { const off = N.setBench(own, id, { active: false }), e = withNursery(off), on = withNursery(own), d = new Date(year, 4, 1); return N.roomOf(e.benchList()).heated === N.roomOf(eng.benchList()).heated && e.benchList().find(b => b.id === id).active === false && e.heatedTraySpaces() === eng.heatedTraySpaces() && e.benchRoom(d).heated === eng.benchRoom(d).heated && on.benchRoom(d).heated === eng.benchRoom(d).heated + 17 && e.benchDay(d).pools.heated.cap === eng.benchDay(d).pools.heated.cap; })());
  check('a change keeps everything else on the record', (() => { const first = n0.spaces[0], n = N.setBench(n0, first.id, { name: 'Propagation bench' }), s = n.spaces[0]; return s.name === 'Propagation bench' && JSON.stringify({ ...s, name: first.name }) === JSON.stringify(first); })());
  const refused = [throws(() => N.setBench(n0, n0.spaces[0].id, { name: '  ' })), throws(() => N.setBench(n0, n0.spaces[0].id, { kind: 'cellar' })), throws(() => N.setBench(n0, n0.spaces[0].id, { w: '0' })), throws(() => N.setBench(n0, n0.spaces[0].id, { l: 'long' })), throws(() => N.setBench(n0, n0.spaces[0].id, { holds: '2.5' })), throws(() => N.setBench(n0, n0.spaces[0].id, { holds: -1 })), throws(() => N.setBench(n0, 'no-such-bench', { name: 'x' })), throws(() => N.setBench(n0, n0.spaces[0].id, { areaId: 'no-such-house' }))];
  check('what makes no sense is refused in words: no name, an unknown kind, no width, a length that is not a number, part of a tray, a bench that is gone, a house that is gone', refused.every(m => typeof m === 'string' && m.length > 10), refused);
  const gone = N.removeBench(made.nursery, id);
  check('a bench removed is gone and the others are as they were', JSON.stringify(gone.spaces) === JSON.stringify(n0.spaces));
  const ids = n => n.spaces.map(s => s.id), up = N.moveBench(n0, n0.spaces[1].id, -1), down = N.moveBench(n0, n0.spaces[0].id, 1);
  check('a bench moves one place up or down, and stays put at either end', ids(up)[0] === ids(n0)[1] && ids(up)[1] === ids(n0)[0] && ids(down).join() === ids(up).join() && ids(N.moveBench(n0, n0.spaces[0].id, -1)).join() === ids(n0).join() && ids(N.moveBench(n0, last.id, 1)).join() === ids(n0).join() && ids(up).length === ids(n0).length);
  const house = N.addArea(n0, 'Cold frame yard', uid), again = N.addArea(house.nursery, ' cold FRAME yard ', uid);
  check('a house is added by name, and a name already there is that house', house.nursery.benchAreas.length === (n0.benchAreas || []).length + 1 && again.id === house.id && again.nursery.benchAreas.length === house.nursery.benchAreas.length && throws(() => N.addArea(n0, '', uid)));
  const moved = N.setBench(house.nursery, n0.spaces[0].id, { areaId: house.id });
  check('a bench stands in the house it is given, and in none when the house is cleared', withNursery(moved).benchList()[0].area === 'Cold frame yard' && withNursery(N.setBench(moved, n0.spaces[0].id, { areaId: '' })).benchList()[0].area === '');
  const dup = N.sharedNames(eng.benchList().filter(b => b.active)), names = eng.benchList().map(b => b.name.toLowerCase());
  check('benches that share a name are found', [...dup].every(k => names.filter(x => x === k).length > 1) && names.filter((x, i) => names.indexOf(x) !== i).every(k => dup.has(k)), [...dup]);
  // options
  const tight = N.setOptions(n0, { packing: 60 }), e60 = withNursery(tight);
  check('the share of a bench that takes trays changes every estimate and no typed count', e60.heatedTraySpaces() < eng.heatedTraySpaces() && withNursery(N.setOptions(own, { packing: 60 })).benchList().find(b => b.id === id).cap === 17 && throws(() => N.setOptions(n0, { packing: 20 })) && throws(() => N.setOptions(n0, { packing: 101 })));
  const h3 = withNursery(N.setOptions(n0, { harden: 3 })), h0 = withNursery(N.setOptions(n0, { harden: 0 }));
  const sameDates = e => P.every(p => { const a = eng.calc(p), b = e.calc(e.planting(p.id)); return (!a && !b) || (iso(a.field) === iso(b.field) && iso(a.first) === iso(b.first) && iso(a.last) === iso(b.last) && (a.sow ? iso(a.sow) : '') === (b.sow ? iso(b.sow) : '') && a.seeds === b.seeds); });
  const hardened = P.map(p => eng.calc(p)).filter(r => r && eng.hardenStart(r));
  check('the days of hardening off move the day hardening starts and nothing else: no sowing, planting or harvest day, no seed', sameDates(h3) && sameDates(h0) && hardened.length > 0 && h3.hardenDays() === 3 && hardened.every(r => { const b = h3.calc(h3.planting(r.planting.id)), hs = h3.hardenStart(b); return hs && E.dayDiff(b.field, hs) <= 3; }) && P.every(p => { const b = h0.calc(h0.planting(p.id)); return !b || !h0.hardenStart(b); }) && throws(() => N.setOptions(n0, { harden: 22 })) && throws(() => N.setOptions(n0, { harden: 2.5 })));
}

// ── 4. recorded days feed the room ──
{
  const cand = P.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && !x.p.done && eng.hardenStart(x.r) && E.dayDiff(eng.hardenStart(x.r), x.r.sow) > 6 && x.r.cells)[0];
  if (cand) {
    const early = iso(E.addDays(eng.hardenStart(cand.r), -4)), q = { ...cand.p, done: { sow: iso(cand.r.sow), harden: early } };
    const big = add(plan.nursery, { kind: 'outside', holds: 500 }), e = E.create({ ...plan, nursery: big, plantings: P.map(x => (x.id === q.id ? q : x)) }, Lib), base = withNursery(big), day = E.s2d(early);
    const mine = en => (en.benchDay(day).items.find(it => it.p.id === q.id) || {});
    check('hardening off recorded early puts the seedlings outside from that day', mine(e).harden === true && mine(base).harden === false && e.benchDay(day).pools.outside.used > base.benchDay(day).pools.outside.used, { early, a: mine(e).harden, b: mine(base).harden });
  } else check('a planting that hardens off was found to record', false);
}

// ── 5. how a live tray is sown ──
const micro = P.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && x.r.rack && x.r.c.micro);
if (micro.length) {
  const cropId = micro[0].p.cropId, mine = micro.filter(x => x.p.cropId === cropId), trays = mine.reduce((n, x) => n + x.r.len, 0), crop0 = plan.crops.find(c => c.id === cropId);
  const withCrop = c => E.create({ ...plan, crops: plan.crops.map(x => (x.id === cropId ? c : x)) }, Lib);
  const totals = e => mine.reduce((t, x) => { const r = e.calc(e.planting(x.p.id)); return { seeds: t.seeds + r.seeds, g: t.g + r.seedG }; }, { seeds: 0, g: 0 });
  const bare = { ...crop0 }; delete bare.liveSow; bare.seedG = null;
  const unsaid = withCrop(bare), weighed = withCrop({ ...bare, seedG: 15 }), saidOpen = withCrop({ ...bare, liveSow: { how: 'open' } });
  check('a tray crop he has said nothing about, with no weight to count, is taken as sown in cells, and counts nothing', unsaid.liveSow(unsaid.crop(cropId)).how === 'cells' && unsaid.liveSow(unsaid.crop(cropId)).said === false && unsaid.liveSow(unsaid.crop(cropId)).set === false && totals(unsaid).seeds === 0 && totals(unsaid).g === 0);
  check('one that has a weight is still counted by weight, as before, and one he has said is broadcast stays broadcast', weighed.liveSow(weighed.crop(cropId)).how === 'open' && near(totals(weighed).g, trays * 15) && totals(weighed).seeds === 0 && saidOpen.liveSow(saidOpen.crop(cropId)).how === 'open' && saidOpen.liveSow(saidOpen.crop(cropId)).said === true);
  const part = withCrop({ ...crop0, seedG: 15, liveSow: { how: 'cells', cells: 72 } });
  check('said to be sown in cells but with a figure missing, a crop counts no seed at all: nothing is assumed', part.liveSow(part.crop(cropId)).set === false && totals(part).seeds === 0 && totals(part).g === 0);
  const cells = withCrop({ ...crop0, seedG: 15, liveSow: { how: 'cells', cells: 72, perCell: 12 } }), how = cells.liveSow(cells.crop(cropId));
  check('sown in cells, a tray takes cells × seeds a cell, and the weight is no longer counted', how.how === 'cells' && how.set && how.seeds === 864 && totals(cells).seeds === trays * 864 && totals(cells).g === 0, totals(cells));
  const need = e => SL.required(e).rows.filter(r => r.crop && r.crop.id === cropId);
  check('seeds required counts such a crop in seeds, and its sowing is recorded in seeds', need(cells).length > 0 && need(cells).every(r => r.unit === 'seeds') && need(cells).reduce((n, r) => n + r.total, 0) === trays * 864 && SL.sowing(cells, cells.planting(mine[0].p.id)).unit === 'seeds' && SL.sowing(cells, cells.planting(mine[0].p.id)).stockUnit === 'seeds' && SL.sowing(cells, cells.planting(mine[0].p.id)).amount === mine[0].r.len * 864);
  const open = withCrop({ ...crop0, seedG: 15, liveSow: { how: 'open', cells: 72, perCell: 12 } });
  check('back in an open tray it is counted by weight again, and the cell figures are kept for next time', open.liveSow(open.crop(cropId)).how === 'open' && near(totals(open).g, trays * 15) && totals(open).seeds === 0 && need(open).every(r => r.unit === 'g'));
  const frac = withCrop({ ...crop0, liveSow: { how: 'cells', cells: 50, perCell: 2.5 } });
  check('a part seed a cell is an average: the tray takes a whole number of seeds', mine.every(x => Number.isInteger(frac.calc(frac.planting(x.p.id)).seeds)) && totals(frac).seeds >= trays * 125 && totals(frac).seeds < trays * 125 + mine.length);
  const compat = E.create({ ...plan, crops: plan.crops.map(x => (x.id === cropId ? { ...crop0, seedG: 15, liveSow: { how: 'cells', cells: 72, perCell: 12 } } : x)) }, Lib, { multipliers: true });
  check('the compatibility mode does not know cells: it counts grams', mine.every(x => { const r = compat.calc(compat.planting(x.p.id)); return r.seeds === 0 && near(r.seedG, x.r.len * 15); }));
  check('the tray list knows seeds as well as grams', (() => { const b = T.batches(cells, E).filter(x => x.cropId === cropId), by = T.byCrop(T.batches(cells, E)).find(x => x.cropId === cropId); return b.reduce((n, x) => n + x.seeds, 0) === trays * 864 && by.seeds === trays * 864 && by.seedG === 0; })());
  // supplies follow
  const s0 = N.supplies(unsaid, year, null), s1 = N.supplies(cells, year, null), sOpen = N.supplies(saidOpen, year, null), row = (s, id) => s.rows.find(r => r.id === id) || { need: 0, fills: 0 };
  const inYear = mine.filter(x => String(x.p.date).slice(0, 4) === String(year)).reduce((n, x) => n + x.r.len, 0);
  check('a live tray sown in cells goes out in a celled tray of that size; until the cells are said, in a tray whose kind is not known; broadcast, in an open one', row(s1, 'live-unsaid').need === row(s0, 'live-unsaid').need - inYear && row(s1, 'tray-72').need === row(s0, 'tray-72').need + inYear && row(s1, 'tray-72').fills === row(s0, 'tray-72').fills + inYear && row(sOpen, 'open').need === row(s0, 'open').need + inYear && row(sOpen, 'live-unsaid').need === row(s0, 'live-unsaid').need - inYear && inYear > 0, { unsaid: [row(s0, 'live-unsaid').need, row(s1, 'live-unsaid').need], t72: [row(s0, 'tray-72').need, row(s1, 'tray-72').need], inYear });
} else check('the plan holds live trays to test with', false);

// ── 6. what the season uses ──
{
  const sup = N.supplies(eng, year, null, fig), row = id => sup.rows.find(r => r.id === id);
  const plugMost = new Map(); let carriers = 0;
  for (const d of days()) { const u = eng.traysOn(d); carriers = Math.max(carriers, u.carriers); for (const t of u.plug) plugMost.set(t.id, Math.max(plugMost.get(t.id) || 0, t.n)); }
  check('plug trays are used once (0.33): needed is every tray filled, never fewer than the most in use on one day, kind by kind', plugMost.size > 0 && [...plugMost].every(([id, n]) => row(id) && row(id).need === row(id).fills && row(id).need >= n && !row(id).how[0].on), [...plugMost]);
  check('as many trays are filled over the season as are ever in use at once, or more', [...plugMost].every(([id, n]) => row(id).fills >= n));
  {
    const filled = new Map(), plots = new Map();
    for (const it of eng.benchItems()) { if (it.kind !== 'prop' || it.r.tw || it.r.c.prop === 'pot' || String(it.p.date).slice(0, 4) !== String(year)) continue; const pl = it.r.sowing, k = pl.trayGroup || pl.batchId || it.p.id, was = plots.get(k) || { n: 0, id: pl.tray.id }; was.n += eng.propOf(it.r, it.r.sow).n; plots.set(k, was); }
    for (const lot of plots.values()) filled.set(lot.id, (filled.get(lot.id) || 0) + Math.ceil(lot.n - 1e-9));
    check('the trays that take mix are the trays filled, one sowing lot at a time, not the trays in use at once', [...filled].every(([id, n]) => row(id) && row(id).fills === n + (sup.liveCells.find(x => 'tray-' + x[0] === id) || [0, 0])[1]) && [...filled].every(([id]) => row(id).need === row(id).fills), [...filled]);
  }
  const liveInYear = eng.benchItems().filter(it => it.kind === 'live' && String(it.p.date).slice(0, 4) === String(year)).reduce((n, it) => n + it.n, 0);
  check('every live tray of the season goes out in a tray that does not come back', (row('open') ? row('open').need : 0) + (row('live-unsaid') ? row('live-unsaid').need : 0) + sup.liveCells.reduce((n, x) => n + x[1], 0) === liveInYear && liveInYear > 0, { liveInYear, open: row('open') && row('open').need });
  const lots = new Map();
  for (const it of eng.benchItems()) { if (it.kind !== 'prop' || !it.r.tw || String(it.p.date).slice(0, 4) !== String(year)) continue; const pl = it.r.sowing, k = pl.trayGroup || pl.batchId || it.p.id; lots.set(k, (lots.get(k) || 0) + eng.propOf(it.r, it.r.sow).n); }
  const sheets = [...lots.values()].reduce((n, x) => n + Math.ceil(x - 1e-9), 0);
  check('rockwool is counted in whole sheets, one lot of tower seedlings at a time, over the season', sheets > 0 && row('rockwool').need === sheets && row('rockwool').fills === 0 && row('open-holes').need === carriers && carriers > 0, { sheets, row: row('rockwool') });
  check('everything is to buy while nothing is on the shelf, and mix starts from round figures that are not his (0.33)', sup.rows.every(r => r.have === 0 && r.buy === r.need && !r.mixOwn) && sup.mix.own === 0 && sup.mix.of === sup.rows.filter(r => r.fills > 0).length && sup.mix.counted + sup.mix.missing.length === sup.mix.of);
  const some = sup.rows.find(r => r.fills > 0), other = sup.rows.find(r => r.fills > 0 && r.id !== some.id);
  let own = N.setSupply(null, 'have', some.id, String(Math.max(1, some.need - 3)));
  own = N.setSupply(own, 'mix', some.id, '3.5'); own = N.setSupply(own, 'have', 'mix', '40');
  const s2 = N.supplies(eng, year, own, fig), r2 = s2.rows.find(r => r.id === some.id);
  check('what is on hand comes off what is to buy, never below nothing', r2.have === Math.max(1, some.need - 3) && r2.buy === some.need - r2.have && N.supplies(eng, year, N.setSupply(null, 'have', some.id, String(some.need + 99)), fig).rows.find(r => r.id === some.id).buy === 0);
  check('mix is what is filled × what one takes, in cubic feet, his figure over the round one, and bags on hand come off the bags (0.33)', near(r2.mixCuFt, some.fills * 3.5) && r2.mixOwn && near(s2.mix.need, sup.mix.need + some.fills * (3.5 - some.mixEach)) && s2.mix.own === 1 && s2.mix.have === 40 && s2.mix.buy === Math.max(0, s2.mix.bags - 40) && (!other || !row(other.id).mixOwn), s2.mix);
  check('a cubic foot is 25.7 dry quarts', Math.abs(N.DRY_QT_PER_CUFT - 25.714) < 0.01);
  check('a figure cleared is forgotten, and an empty record is no record', N.setSupply(N.setSupply(null, 'have', 'x', '4'), 'have', 'x', '') === null && N.setSupply(N.setSupply(null, 'mix', 'x', '2'), 'mix', 'x', '') === null && JSON.stringify(own) === JSON.stringify({ have: { [some.id]: Math.max(1, some.need - 3), bags: 40 }, cuft: { [some.id]: 3.5 } }));
  const bad = [throws(() => N.setSupply(null, 'have', 'x', '-1')), throws(() => N.setSupply(null, 'have', 'x', '1.5')), throws(() => N.setSupply(null, 'mix', 'x', 'lots')), throws(() => N.setSupply(null, 'price', 'x', '1'))];
  check('a count on hand is a whole number, mix is a number, and neither is less than nothing', bad.every(m => typeof m === 'string' && m.length > 8) && !throws(() => N.setSupply(null, 'have', 'mix', '12.5')), bad);
  check('supplies count this year\'s plantings and no others', N.supplies(E.create({ ...plan, settings: { ...plan.settings, year: year + 5 } }, Lib), year + 5, null).rows.length === 0);
}

// ── 7. what travels and what stays ──
{
  const edited = { ...N.setBench(plan.nursery, plan.nursery.spaces[0].id, { kind: 'outside' }), lrfEdited: true };
  const prev = { ...plan, nursery: edited, lrfNext: { ...(plan.lrfNext || {}), supplies: { have: { rockwool: 20 } } } }, next = IO.split(JSON.parse(JSON.stringify(IO.join ? IO.join(plan, {}) : plan))).core;
  const out = IO.carry(prev, next), plain = IO.carry({ ...plan, lrfNext: {} }, next);
  check('benches changed here stay when an older backup is loaded, and so does what is on the shelf; benches never touched here come from the backup', JSON.stringify(out.plan.nursery) === JSON.stringify(edited) && out.notes.includes('your benches') && ((out.keep.supplies || {}).have || {}).rockwool === 20 && JSON.stringify(plain.plan.nursery) === JSON.stringify(next.nursery) && !plain.notes.includes('your benches'), { notes: out.notes });
  const round = IO.unpack(JSON.parse(JSON.stringify(IO.pack ? IO.pack({ ...plan, nursery: edited }) : { ...plan, nursery: edited, format: undefined })));
  check('a bench\'s kind and count come back from a saved plan as they went in', JSON.stringify((round.nursery || edited).spaces[0]) === JSON.stringify(edited.spaces[0]));
}
// ── 9. a crop grown on without heat ──
{
  const sown = P.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && x.r.sow && x.r.cells && !x.r.tw && String(x.p.date).slice(0, 4) === String(year));
  const byCrop = new Map(); for (const x of sown) byCrop.set(x.p.cropId, (byCrop.get(x.p.cropId) || 0) + 1);
  const cropId = [...byCrop].sort((a, b) => b[1] - a[1])[0][0], mine = sown.filter(x => x.p.cropId === cropId), mid = mine[Math.floor(mine.length / 2)];
  const md = d => iso(d).slice(5), from = md(E.addDays(mid.r.sow, -20)), to = md(E.addDays(mid.r.field, 20)), after = 4;
  const base = add(plan.nursery, { kind: 'unheated', holds: 400, name: 'Summer benches' }), ruled = N.setCool(base, cropId, { from: `${year}-${from}`, to, after }), e = withNursery(ruled), e0 = withNursery(base);
  check('a crop grown on without heat is one line: the crop, two days of the year and the days under heat first', JSON.stringify(ruled.cool) === JSON.stringify([{ cropId, from, to, after }]) && base.cool === undefined && JSON.stringify(N.setCool(ruled, cropId, { after: 7 }).cool) === JSON.stringify([{ cropId, from, to, after: 7 }]) && N.setCool(N.setCool(plan.nursery, cropId, {}), cropId, { from: '' }).cool[0].from === '' && !('cool' in N.removeCool(ruled, cropId)));
  const refused = [throws(() => N.setCool(base, cropId, { from: '13-01' })), throws(() => N.setCool(base, cropId, { to: 'June' })), throws(() => N.setCool(base, cropId, { from: '02-30' })), throws(() => N.setCool(base, cropId, { after: 2.5 })), throws(() => N.setCool(base, cropId, { after: 90 })), throws(() => N.setCool(base, '', {}))];
  check('a day that is not a day of the year, part of a day under heat, or no crop, is refused in words', refused.every(m => typeof m === 'string' && m.length > 10), refused);
  const at = (en, x, d) => en.benchDay(d).items.find(it => it.p.id === x.p.id) || {}, hs = eng.hardenStart(mid.r) || mid.r.field;
  const early = E.addDays(mid.r.sow, after - 1), up = E.addDays(mid.r.sow, after), span = E.dayDiff(hs, mid.r.sow);
  check('its trays stay under heat for their days to come up, then stand on the unheated benches until they harden off', span > after + 1 && at(e, mid, early).cool === false && at(e, mid, up).cool === true && at(e0, mid, up).cool === false && near(e.benchDay(up).pools.unheated.used - e0.benchDay(up).pools.unheated.used, e.benchDay(up).cool - 0) && e.benchDay(up).cool > 0 && near(e.benchDay(up).pools.heated.used, e0.benchDay(up).pools.heated.used - e.benchDay(up).cool), { span, early: at(e, mid, early).cool, up: at(e, mid, up).cool });
  const outOfSeason = mine.filter(x => !(md(x.r.sow) >= from && md(x.r.field) <= to) && (md(E.addDays(x.r.sow, after + 1)) < from || md(E.addDays(x.r.sow, after + 1)) > to));
  check('outside its two days the crop is raised under heat as before', outOfSeason.length > 0 ? outOfSeason.every(x => at(e, x, E.addDays(x.r.sow, after + 1)).cool !== true) : mine.every(x => md(x.r.sow) >= from), outOfSeason.length);
  check('only that crop moves, tower seedlings never do, and nothing leaves the count', [...days()].every(d => { const r = e.benchDay(d), r0 = e0.benchDay(d); return near(r.total, r0.total) && r.items.every(it => !it.cool || (it.p.cropId === cropId && it.kind !== 'rockwool' && !it.harden)) && near(N.KIND_IDS.reduce((n, k) => n + r.pools[k].used, 0), r.total) && STANDS.every(s => near(N.KIND_IDS.reduce((n, k) => n + r.pools[k][s], 0), r[s])); }));
  const sameDates = P.every(p => { const a = eng.calc(p), b = e.calc(e.planting(p.id)); return (!a && !b) || (iso(a.field) === iso(b.field) && iso(a.first) === iso(b.first) && (a.sow ? iso(a.sow) : '') === (b.sow ? iso(b.sow) : '') && a.seeds === b.seeds && a.trays === b.trays); });
  check('the rule moves no sowing, planting or harvest day, no seed and no tray', sameDates);
  // a bench too small for it
  const tight = withNursery(N.setCool(add(plan.nursery, { kind: 'unheated', holds: 1, name: 'One tray' }), cropId, { from, to, after })), fig = N.season(tight, year), peak = N.season(e, year).cool;
  check('a crop sent to benches too small for it puts them over, and the season says how much stands there by rule', fig.pools.unheated.over.length > 0 && fig.pools.unheated.tightest.used > 1 && peak.most > 0 && peak.on && near(fig.cool.most, peak.most), { over: fig.pools.unheated.over.length, most: peak.most });
  check('what hardens off has only the room the crop leaves on the unheated benches', [...days()].every(d => { const r = tight.benchDay(d); return r.pools.unheated.used <= Math.max(r.cool, r.pools.unheated.cap) + 1e-9 && r.hardenIn >= -1e-9; }) && [...days()].some(d => { const r = tight.benchDay(d); return r.cool >= 1 && r.harden > 0 && near(r.hardenIn, r.harden); }));
  const all = withNursery(N.setCool(base, cropId, { from: '', to: '', after: 0 }));
  check('with both days left open the crop is on the unheated benches all year, from the day it is sown', mine.every(x => { const hs2 = eng.hardenStart(x.r); return hs2 && E.dayDiff(hs2, x.r.sow) < 1 ? true : at(all, x, x.r.sow).cool === true; }));
  const compat = E.create({ ...plan, nursery: ruled }, Lib, { multipliers: true });
  check('the compatibility mode knows no such rule', [...days()].every(d => compat.benchDay(d).cool === 0) && compat.coolRules().length === 0);
}

// ── 8. a lot weighed where the plan counts seeds ──
{
  const lot = { id: 'lot-1', key: 'v:some-variety', unit: 'g', quantity: 250, usable: true, status: 'usable', name: 'Tray mix', createdAt: '2026-11-01T00:00:00.000Z' };
  const lib = { v: 1, lots: [lot], adjustments: [], legacyImported: {}, performanceNotes: {}, importReceipts: [] }, ctx = { now: '2026-11-12T12:00:00.000Z', uid, year, name: 'test' };
  const rate = SL.perGram({ seedsPerLb: 453.59237 * 120 }), turned = SL.moveLot(lib, 'lot-1', { unit: 'seeds', quantity: Math.floor(250 * rate), reason: 'turned' }, ctx);
  const after = turned.lots.find(l => l.id === 'lot-1');
  check('a lot weighed in grams is turned into seeds by the variety\'s seeds per gram, and the lot handed in is not touched', near(rate, 120) && SL.perGram({ seedsPerG: 300 }) === 300 && SL.perGram({}) === null && after.unit === 'seeds' && after.quantity === 30000 && lot.unit === 'g' && lot.quantity === 250 && turned.adjustments.length === 1);
  check('a part seed is refused, and a change of unit alone still reads the number as it stands', typeof throws(() => SL.moveLot(lib, 'lot-1', { unit: 'seeds', quantity: 10.5 }, ctx)) === 'string' && SL.moveLot(lib, 'lot-1', { unit: 'seeds' }, ctx).lots[0].quantity === 250);
}
finished = true;
