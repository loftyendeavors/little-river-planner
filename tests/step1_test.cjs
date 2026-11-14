// Step 1 (preview 0.16): 98-cell rockwool sheets, what "To settle" may list, the tray space's name, a seed lot from one line.
// node step1_test.cjs <app-dir> <plan.json: a backup's or the shipped compact one>      (absolute paths)
const path = require('path'), fs = require('fs');
const [APP, PLAN] = process.argv.slice(2);
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js')), Sow = require(path.join(APP, 'js/sowing.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L;
const Rails = require(path.join(APP, 'js/rails.js')), Trays = require(path.join(APP, 'js/trays.js')), SL = require(path.join(APP, 'js/seedlib.js'));
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const results = [], fail = [];
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); if (!ok) fail.push(name); };
const clone = x => JSON.parse(JSON.stringify(x));
let n = 0; const uid = () => 'test-' + (++n);

// ── rockwool: a sheet is 98 cells, 14 rows of 7 ──
const eng = E.create(core, Lib), compat = E.create(core, Lib, { multipliers: true });
const tower = e => e.plan.plantings.map(p => ({ p, r: e.calc(p) })).filter(x => x.r && x.r.tw && x.r.sowing && !x.r.sowing.error);
const T = tower(eng), V = tower(compat);
check('the sheet itself: 98 cells, 14 rows of 7, on a 10 × 20 footprint', Sow.ROCKWOOL_SHEET.cells === 98 && Sow.ROCKWOOL_SHEET.rows === 14 && Sow.ROCKWOOL_SHEET.columns === 7 && Sow.ROCKWOOL_SHEET.widthIn === 10 && Sow.ROCKWOOL_SHEET.lengthIn === 20);
check('every tower sowing is in a 98-cell sheet', T.length > 0 && T.every(x => x.r.sowing.tray.cells === 98 && x.r.sowing.tray.rows === 14 && x.r.sowing.tray.columns === 7 && x.r.sowing.medium === 'rockwool'), { sowings: T.length });
check('each batch fills whole rows of 7', T.every(x => x.r.sowing.batch.cells % 7 === 0 && x.r.sowing.batch.mode === 'row'));
const lots = e => { const seen = new Map(); for (const x of tower(e)) { const g = x.r.sowing.trayGroup, key = g ? g.id : x.r.sowing.batchId; if (!seen.has(key)) seen.set(key, g ? { cells: g.cells, trays: g.trays, per: g.tray.cells, carriers: g.carriers } : { cells: x.r.sowing.batch.cells, trays: x.r.sowing.batch.trays, per: x.r.sowing.batch.tray.cells, carriers: null }); } return [...seen.values()]; };
const LA = lots(eng), LV = lots(compat);
check('sheets are counted whole: cells ÷ 98, rounded up, one open tray under each', LA.every(g => g.per === 98 && g.trays === Math.ceil(g.cells / 98) && (g.carriers == null || g.carriers === g.trays)), { lots: LA.length, sheets: LA.reduce((a, g) => a + g.trays, 0) });
check('no plug tray planting changed: only tower sowings are in sheets', eng.plan.plantings.every(p => { const r = eng.calc(p), q = compat.calc(compat.plan.plantings.find(x => x.id === p.id)); return !r || r.tw || !r.sowing || r.sowing.error || !q || !q.sowing || r.sowing.tray.cells === q.sowing.tray.cells; }));
check('counted in the compatibility mode, a tower sowing is still in its crop’s own tray', V.length === T.length && V.every(x => x.r.sowing.tray.cells === (+x.r.c.tray || 72) && x.r.sowing.tray.cells !== 98));
// a tray named for the crop, or for the planting, still wins over the sheet
const tp = T[0].p, cropId = T[0].r.c.id;
const own = c => ({ ...core, crops: [...(core.crops || []).filter(x => x.id !== cropId), { ...(core.crops || []).find(x => x.id === cropId) || Lib.crops.find(x => x.id === cropId) || { id: cropId }, ...c }] });
const named = E.create(own({ trayId: 'tray-200' }), Lib), rn = named.calc(named.plan.plantings.find(p => p.id === tp.id));
check('a tray named on the crop wins over the sheet', rn.sowing.tray.cells === 200, { cells: rn.sowing.tray.cells });
const onP = E.create({ ...core, plantings: core.plantings.map(p => p.id === tp.id ? { ...p, trayId: 'tray-72' } : p) }, Lib), rp = onP.calc(onP.plan.plantings.find(p => p.id === tp.id));
check('a tray named on the planting wins over the sheet', rp.sowing.tray.cells === 72, { cells: rp.sowing.tray.cells });
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const figures = { sowings: T.length, cells: { compat: sum(V, x => x.r.sowing.cells), now: sum(T, x => x.r.sowing.cells) }, seeds: { compat: sum(V, x => x.r.sowing.seeds), now: sum(T, x => x.r.sowing.seeds) }, sheets: { compat: sum(LV, g => g.trays), now: sum(LA, g => g.trays) } };

// ── "To settle": bench room is a load, never a fault ──
const todo = Rails.cleanup(eng);
check('on this plan no tray batch and no bench is listed as too long', todo.long.every(x => !x.p.liveTray && !eng.isRack(x.r.b)), { long: todo.long.length });
check('on this plan no tray batch is listed as ground booked twice', todo.groups.every(g => !g.late.liveTray && !eng.isRack(g.bed) && g.early.every(o => !o.p.liveTray)), { groups: todo.groups.length });
// The stand-in space, with its flag lost: a bench with 0 trays. (The card "40 plantings are 1 trays long in 0-trays beds" came from something like this.)
const pool = core.beds.find(b => b.liveTrayPool === true), batches = core.plantings.filter(p => p.liveTray);
if (pool && batches.length) {
  const bare = { ...core, beds: core.beds.map(b => { if (b.id !== pool.id) return b; const { liveTrayPool, ...rest } = b; return rest; }), gardens: core.gardens.map(g => { if (g.id !== pool.gardenId) return g; const { liveTrayPool, ...rest } = g; return rest; }) };
  const e2 = E.create(bare, Lib), b2 = e2.bedOf(pool.id), c2 = Rails.cleanup(e2);
  check('a bench with no tray count is a stand-in whether or not it is flagged: nothing on it is too long', e2.isRack(b2) && !e2.isPool(b2) && e2.capOf(b2) === 0 && c2.long.every(x => x.r.b.id !== pool.id), { batches: batches.length, long: c2.long.filter(x => x.r.b.id === pool.id).length });
  check('nor booked twice', c2.groups.every(g => g.bed.id !== pool.id), { groups: c2.groups.filter(g => g.bed.id === pool.id).length });
  check('its batches report no overflow and no conflict one by one', batches.every(p => { const q = e2.planting(p.id), r = e2.calc(q); return !r || (!e2.overflow(q, r) && e2.conflicts(q, r).length === 0); }));
  // a real bench with a tray count: tray batches made from weekly demand are still never listed
  const real = { ...bare, beds: bare.beds.map(b => b.id === pool.id ? { ...b, trays: 1 } : b) }, e3 = E.create(real, Lib), c3 = Rails.cleanup(e3);
  check('tray batches on a bench that does have a count are still never listed', e3.capOf(e3.bedOf(pool.id)) === 1 && c3.long.every(x => !x.p.liveTray) && c3.groups.every(g => !g.late.liveTray), { long: c3.long.length, groups: c3.groups.length });
  // a planting put on that bench by hand is held to its count, as before
  const micro = e3.crop(batches[0].cropId), hand = { id: 'hand-1', bedId: pool.id, cropId: micro.id, date: batches[0].date, trays: 5 };
  const e4 = E.create({ ...real, plantings: [...real.plantings, hand] }, Lib), r4 = e4.calc(e4.planting('hand-1'));
  check('a planting set on a counted bench by hand is still held to the count', !!r4 && e4.overflow(e4.planting('hand-1'), r4) === true && Rails.cleanup(e4).long.some(x => x.p.id === 'hand-1'));
  check('nothing can be dropped by hand on a bench with no tray count', Rails.propose(e2, { cropId: micro.id }, { bedId: pool.id, date: E.s2d(batches[0].date) }).state === 'blocked');
} else check('the plan has a tray space and batches to test with', false);
// soil beds are untouched by the rule
const soil = core.beds.find(b => eng.isSoilBed(b) && eng.plantingsIn(b.id).length);
if (soil) { const short = E.create({ ...core, beds: core.beds.map(b => b.id === soil.id ? { ...b, l: 1 } : b) }, Lib); check('a planting longer than its soil bed is still listed', Rails.cleanup(short).long.some(x => x.r.b.id === soil.id)); }

// ── the tray space's name ──
check('new name and old', Trays.POOL_NAME === 'Heated greenhouse benches' && Trays.POOL_NAME_V7 === 'Shared heated space');
const g7 = { id: 'g1', name: 'Shared heated space', liveTrayPool: true, type: 'greenhouse' };
check('a record under the former name is renamed, and nothing else on it changes', JSON.stringify(Trays.poolRenamed(g7)) === JSON.stringify({ ...g7, name: 'Heated greenhouse benches' }));
check('a name the grower gave it is left alone; so is a garden that only shares the name', Trays.poolRenamed({ ...g7, name: 'Prop house' }) === null && Trays.poolRenamed({ id: 'g2', name: 'Shared heated space' }) === null && Trays.poolRenamed({ ...g7, name: 'Heated greenhouse benches' }) === null);
const demand = (core.liveTrayPlans || [])[0];
if (demand) {
  const empty = { ...core, gardens: core.gardens.filter(g => g.liveTrayPool !== true), beds: core.beds.filter(b => b.liveTrayPool !== true), plantings: core.plantings.filter(p => !p.liveTray), liveTrayPlans: [] };
  const e5 = E.create(empty, Lib), { id, ...fresh } = demand;
  const made = Trays.apply(empty, fresh, { uid, now: '2026-11-11T12:00:00.000Z', crop: x => e5.crop(x), records: {}, keepRecorded: true }).plan;
  const g = made.gardens.find(x => x.liveTrayPool === true);
  check('a tray space made here is named Heated greenhouse benches', !!g && g.name === 'Heated greenhouse benches' && made.beds.some(b => b.liveTrayPool === true && b.gardenId === g.id), g && { name: g.name });
  const again = Trays.apply(core, demand, { uid, now: '2026-11-11T12:00:00.000Z', crop: x => eng.crop(x), records: {}, keepRecorded: true }).plan;
  check('saving demand on a plan that has the record under its former name does not make a second space', again.gardens.filter(x => x.liveTrayPool === true).length === 1 && again.beds.filter(x => x.liveTrayPool === true).length === 1);
}

// ── a seed lot from one line ──
const ctx = () => ({ now: '2026-11-11T12:00:00.000Z', uid, year: +core.settings.year || 2027, name: '' });
const inv0 = core.seedInventory || SL.emptyInventory(), frozen = JSON.stringify(inv0), liveV = core.varieties.filter(v => v.active !== false && !v.deleted);
const v1 = liveV.find(v => v.supplier) || liveV[0];
const q1 = SL.quickLot(core, inv0, { varietyId: v1.id, vendor: '', year: '2026', quantity: '500', unit: 'seeds', status: 'usable' }, ctx());
check('a lot for a variety in the library: 500 seeds on hand, packed for 2026, the variety’s own vendor when none is typed', q1.added === null && q1.lot.key === 'v:' + v1.id && q1.lot.quantity === 500 && q1.lot.unit === 'seeds' && q1.lot.status === 'usable' && q1.lot.usable === true && q1.lot.year === 2026 && q1.lot.supplier === (v1.supplier || '') && q1.inventory.lots.length === inv0.lots.length + 1, { supplier: q1.lot.supplier });
check('the stock that was passed in is not changed', JSON.stringify(inv0) === frozen);
check('the change is logged as an added lot', (() => { const a = q1.inventory.adjustments[q1.inventory.adjustments.length - 1]; return a && a.kind === 'add' && a.lotId === q1.lot.id && a.before === null && a.after.quantity === 500; })());
check('it counts as on hand', (SL.stock(q1.inventory)['v:' + v1.id + '|seeds'] || {}).onHand === ((SL.stock(inv0)['v:' + v1.id + '|seeds'] || {}).onHand || 0) + 500);
const q2 = SL.quickLot(core, inv0, { varietyId: v1.id, vendor: 'Fedco Seeds', year: '', quantity: 250, unit: 'seeds', status: 'ordered' }, ctx());
check('ordered, a typed vendor, no year', q2.lot.status === 'ordered' && q2.lot.usable === false && q2.lot.supplier === 'Fedco Seeds' && q2.lot.year === null && (SL.stock(q2.inventory)['v:' + v1.id + '|seeds'] || {}).onOrder >= 250);
const cropFor = eng.crops().find(c => !c.micro && c.method === 'TP') || eng.crops()[0];
const q3 = SL.quickLot(core, inv0, { name: '  Quick Test Wonder ', cropId: cropFor.id, vendor: 'High Mowing Seeds', year: 2026, quantity: 100, unit: 'seeds', status: 'usable' }, ctx());
check('a variety that is not in the library is added with the lot', !!q3.added && q3.added.name === 'Quick Test Wonder' && q3.added.cropId === cropFor.id && q3.added.supplier === 'High Mowing Seeds' && /^v_named_/.test(q3.added.id) && q3.lot.key === 'v:' + q3.added.id && q3.variety === q3.added, q3.added && { id: q3.added.id, source: q3.added.source });
const twin = liveV.find(v => v.name && v.cropId), q4 = SL.quickLot(core, inv0, { name: twin.name.toUpperCase(), cropId: twin.cropId, vendor: '', year: 2026, quantity: 10, unit: 'seeds' }, ctx());
check('a “new” name that is already in the library under that crop is that variety, not a second one', q4.added === null && q4.variety.id === twin.id);
const refuses = (input, re) => { try { SL.quickLot(core, inv0, input, ctx()); return false; } catch (e) { return re.test(e.message); } };
check('no variety: refused in words', refuses({ name: '', vendor: 'x', quantity: 5 }, /Variety/));
check('a new name with no crop: refused, and says what to do', refuses({ name: 'Nobody Knows', cropId: '', quantity: 5 }, /Choose its crop/));
check('no amount, zero, and half a seed: refused', refuses({ varietyId: v1.id, quantity: '' }, /How many seeds/) && refuses({ varietyId: v1.id, quantity: 0 }, /above 0/) && refuses({ varietyId: v1.id, quantity: 2.5, unit: 'seeds' }, /whole number/));
check('a year that is not a year: refused', refuses({ varietyId: v1.id, quantity: 5, year: 26 }, /year/i));
check('a variety that has been removed: refused', refuses({ varietyId: 'no-such-variety', quantity: 5 }, /no longer in the library/));
const q5 = SL.quickLot(core, inv0, { varietyId: v1.id, quantity: '12.5', unit: 'g', year: 2026 }, ctx());
check('grams may be a part number', q5.lot.unit === 'g' && q5.lot.quantity === 12.5);
check('plants are counted whole', refuses({ varietyId: v1.id, quantity: 1.5, unit: 'plants' }, /whole number/));

console.log(results.join('\n'));
console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail, rockwool: figures, toSettle: { long: todo.long.length, groups: todo.groups.length } }));
