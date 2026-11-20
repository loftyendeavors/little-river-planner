'use strict';
// E2d: a sown crop's figure on the list says the rows it was typed for, and a planting gives it by its own rows (the row-foot
// yield holds); a figure typed a plant says its spacing in the row and is held a row-foot the same way. A figure that says
// neither is read as it always was. On the made-up farm, without a browser.
//   1. nothing said: every planting gives what the build before gave, to the bit
//   2. a sown crop's figure with its rows; 3. a plant's figure with its spacing; 4. where neither counts
//   5. the bed a box speaks of, and the words; 6. two devices joined: the figure and its rows are one value
// usage: node e2d_test.cjs <app-dir> <plan.json: a backup's or the shipped compact one> [dir of the js of the build before]
const path = require('path'), fs = require('fs');
const [APP, PLAN, OLD] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 4).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 700)}`); if (!ok) fail.push(name); };
global.window = global;
const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L; require(path.join(APP, 'js/guide.js'));
const F = require(path.join(APP, 'js/forecast.js')), M = require(path.join(APP, 'js/merge.js'));
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const clone = x => JSON.parse(JSON.stringify(x)), near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const eng = E.create(core, Lib), soil = r => r && !r.tw && !r.ct && !r.rack;
const worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);
/** The plan with one cell of the list set: a crop's figure in a place, and what it says with it. */
const listed = (plan, cropId, env, cell, more) => { const next = clone(plan); next.assumptions = { v: 1, crops: {}, varieties: {}, ...(next.assumptions || {}) }; next.assumptions.crops = { ...next.assumptions.crops, [cropId]: { ...(next.assumptions.crops[cropId] || {}), [env]: cell } }; return more ? more(next) || next : next; };
const unitsOf = (e, id) => { const q = e.planting(id), r = q && e.calc(q), y = r && e.givenOf(q, r); return y ? y.units : null; };
// the plantings that follow their crop's own record, on soil beds, by crop and place: what a figure of the list would take over
const groups = new Map();
for (const p of core.plantings) {
  const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null;
  if (!y || !soil(r) || y.by !== 'default' || !y.set || y.own || eng.soldOf(p, r, y)) continue;
  const env = eng.envOf(r.b), key = p.cropId + '|' + env, g = groups.get(key) || { cropId: p.cropId, env, basis: y.basis, list: [], rows: new Set(), inRow: new Set(), weekly: y.pattern === 'weekly' };
  g.list.push({ p, r, y }); g.rows.add(r.totalRows); g.inRow.add(r.inRow); groups.set(key, g);
}
const all = [...groups.values()], figureOf = g => eng.harvestFor(g.cropId).cells[g.env].value;

// ── 1. nothing said ──
if (OLD) {
  const E0 = require(path.join(OLD, 'engine.js')), old = E0.create(core, Lib);
  const off = core.plantings.filter(p => { const a = old.calc(p), b = eng.calc(p); if (!a !== !b) return true; if (!a) return false; const ya = old.givenOf(p, a), yb = eng.givenOf(p, b); return !ya !== !yb || (ya && (ya.units !== yb.units || ya.price !== yb.price || ya.unit !== yb.unit)); });
  check('with no rows and no spacing said, every planting gives what the build before gave, to the bit', off.length === 0, off.slice(0, 3).map(p => p.id));
} else check('with no rows and no spacing said, every planting gives what the build before gave, to the bit (no build before was given: not compared)', true);
check('with nothing said no planting is scaled, and none says rows or a spacing', core.plantings.every(p => { const r = eng.calc(p), y = r && eng.yieldOf(p, r); return !y || (y.scale === 1 && y.rowsFor === undefined && y.inRowFor === undefined); }));

// ── 2. a sown crop's figure with its rows ──
const sown = all.filter(g => g.basis === 'ft' && g.rows.size > 1 && figureOf(g) > 0).sort((a, b) => b.list.length - a.list.length)[0];
check('the farm has a sown crop on beds of different rows, to try', !!sown, all.filter(g => g.basis === 'ft').map(g => [g.cropId, [...g.rows]]));
if (sown) {
  const fig = figureOf(sown), R = [...sown.rows].sort((a, b) => a - b)[0], plain = E.create(listed(core, sown.cropId, sown.env, { yield: fig }), Lib), said = E.create(listed(core, sown.cropId, sown.env, { yield: fig, rows: R }), Lib);
  const same = sown.list.filter(x => x.r.totalRows === R), other = sown.list.filter(x => x.r.totalRows !== R);
  check('a figure typed onto the list with no rows said gives what the crop’s record gave, to the bit', sown.list.every(x => unitsOf(plain, x.p.id) === x.y.units && plain.yieldOf(plain.planting(x.p.id)).by === 'crop'));
  check('a figure that says its rows gives the same, to the bit, on every bed of those rows', same.length > 0 && same.every(x => unitsOf(said, x.p.id) === x.y.units), same.map(x => [x.y.units, unitsOf(said, x.p.id)]).slice(0, 3));
  check('on a bed of other rows it gives the figure by the rows: rows of the planting ÷ rows of the figure', other.length > 0 && other.every(x => near(unitsOf(said, x.p.id), x.y.units * x.r.totalRows / R) && unitsOf(said, x.p.id) !== x.y.units), other.map(x => [x.r.totalRows, x.y.units, unitsOf(said, x.p.id)]).slice(0, 3));
  const ys = sown.list.map(x => { const q = said.planting(x.p.id), r = said.calc(q); return { r, y: said.yieldOf(q, r) }; });
  check('the planting says the rows the figure is for, its row-feet and the row-foot yield, and they come to its yield', ys.every(({ r, y }) => y.rowsFor === R && y.rowFeet === r.rows * r.physicalLength && near(y.perRowFt, y.per / R) && near(y.units, y.rowFeet * y.perRowFt * y.mk * y.part) && near(y.scale, r.totalRows / R)), ys.map(({ y }) => [y.rowsFor, y.rowFeet, y.perRowFt, y.units]).slice(0, 2));
  check('the row-foot yield is the same on every bed, whatever its rows', new Set(ys.map(({ y }) => +y.perRowFt.toFixed(9))).size === 1 || sown.weekly);
  check('what the season is worth moves by what those plantings move, and by nothing else', near(worth(said) - worth(plain), other.reduce((n, x) => { const q = said.planting(x.p.id), y = said.yieldOf(q), use = F.useOf(said, q); return n + (use.personal ? 0 : (y.units - x.y.units) * y.price); }, 0)), [worth(plain), worth(said)]);
  const cells = said.harvestFor(sown.cropId).cells;
  check('the crop’s line says the rows its figure in that place is for, and none where none is said', cells[sown.env].rows === R && plain.harvestFor(sown.cropId).cells[sown.env].rows === null && said.ENVS.filter(e => e !== sown.env).every(e => cells[e].rows === null));
  for (const bad of [0, -2, 1.5, '2', null, 1001]) { const e = E.create(listed(core, sown.cropId, sown.env, { yield: fig, rows: bad }), Lib); if (!sown.list.every(x => unitsOf(e, x.p.id) === x.y.units)) { check(`rows that are no whole number of rows (${JSON.stringify(bad)}) are read as none said`, false); break; } if (bad === 1001) check('rows that are no whole number of rows are read as none said', true); }
  // a planting that carries a yield of its own, and one that follows a variety's figure, do not follow the crop's rows
  const own = core.plantings.filter(p => p.cropId === sown.cropId && p.yield != null && p.yield !== '' && eng.calc(p));
  check('a planting with a yield of its own keeps it, whatever rows the crop’s figure says', own.every(p => unitsOf(said, p.id) === unitsOf(eng, p.id)), own.length);
  const vp = sown.list.find(x => x.r.totalRows !== R && x.p.varietyId && eng.variety(x.p.varietyId) && eng.variety(x.p.varietyId).cropId === sown.cropId);
  if (vp) { const withV = E.create(listed(core, sown.cropId, sown.env, { yield: fig, rows: R }, next => { next.assumptions.varieties = { ...next.assumptions.varieties, [vp.p.varietyId]: { [sown.env]: { yield: fig } } }; }), Lib); check('a planting that follows its variety’s figure is not scaled by the crop’s rows', unitsOf(withV, vp.p.id) === vp.y.units && withV.yieldOf(withV.planting(vp.p.id)).scale === 1, [vp.y.units, unitsOf(withV, vp.p.id)]); }
  else check('a planting that follows its variety’s figure is not scaled by the crop’s rows (the farm has none on other rows: not tried)', true);
  // picked each week: the figure is a week's, and is scaled the same
  const wk = clone(listed(core, sown.cropId, sown.env, { yield: fig, rows: R })); wk.assumptions.sell = { ...(wk.assumptions.sell || {}), [sown.cropId]: { ...((wk.assumptions.sell || {})[sown.cropId] || {}), pattern: 'weekly' } };
  const wk0 = clone(wk); delete wk0.assumptions.crops[sown.cropId][sown.env].rows;
  const ew = E.create(wk, Lib), ew0 = E.create(wk0, Lib);
  check('a crop picked each week is scaled the same: its week’s figure by the rows', sown.list.every(x => near(unitsOf(ew, x.p.id), unitsOf(ew0, x.p.id) * x.r.totalRows / R)) && other.some(x => unitsOf(ew, x.p.id) !== unitsOf(ew0, x.p.id)));
}

// ── 3. a plant's figure with its spacing ──
const spaced = all.filter(g => g.basis === 'plant' && g.inRow.size > 1 && figureOf(g) > 0).sort((a, b) => b.list.length - a.list.length)[0];
check('the farm has a crop counted a plant at different spacings in the row, to try', !!spaced);
if (spaced) {
  const fig = figureOf(spaced), s0 = [...spaced.inRow].sort((a, b) => a - b)[0], plain = E.create(listed(core, spaced.cropId, spaced.env, { yield: fig }), Lib), said = E.create(listed(core, spaced.cropId, spaced.env, { yield: fig, inRow: s0 }), Lib);
  const same = spaced.list.filter(x => x.r.inRow === s0), other = spaced.list.filter(x => x.r.inRow !== s0);
  check('a plant’s figure with no spacing said gives what the crop’s record gave, to the bit', spaced.list.every(x => unitsOf(plain, x.p.id) === x.y.units));
  check('a plant’s figure that says its spacing gives the same, to the bit, at that spacing', same.length > 0 && same.every(x => unitsOf(said, x.p.id) === x.y.units));
  check('at another spacing it is held a row-foot: the plants’ yield by spacing of the planting ÷ spacing of the figure', other.length > 0 && other.every(x => near(unitsOf(said, x.p.id), x.y.units * x.r.inRow / s0) && said.yieldOf(said.planting(x.p.id)).inRowFor === s0), other.map(x => [x.r.inRow, x.y.units, unitsOf(said, x.p.id)]).slice(0, 3));
  check('the crop’s line says the spacing, and a figure says rows or a spacing by how the crop is counted, never the other', said.harvestFor(spaced.cropId).cells[spaced.env].inRow === s0 && said.harvestFor(spaced.cropId).cells[spaced.env].rows === null && spaced.list.every(x => unitsOf(E.create(listed(core, spaced.cropId, spaced.env, { yield: fig, rows: 2 }), Lib), x.p.id) === x.y.units));
  if (sown) check('rows said on a sown crop’s figure are not read as a spacing, nor a spacing as rows', sown.list.every(x => unitsOf(E.create(listed(core, sown.cropId, sown.env, { yield: figureOf(sown), inRow: 7.5 }), Lib), x.p.id) === x.y.units));
}

// ── 4. where neither counts: towers, crates, trays ──
{
  const off = core.plantings.map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && !soil(x.r) && eng.yieldOf(x.p, x.r));
  let plan = clone(core);
  for (const x of off) plan = listed(plan, x.p.cropId, eng.envOf(x.r.b) || 'field', { yield: 3, rows: 7, inRow: 5 });
  const e = E.create(plan, Lib), bare = (() => { let q = clone(core); for (const x of off) q = listed(q, x.p.cropId, eng.envOf(x.r.b) || 'field', { yield: 3 }); return E.create(q, Lib); })();
  check('a tower, a crate and a tray are counted as before, whatever a figure says', off.length > 0 && off.every(x => unitsOf(e, x.p.id) === unitsOf(bare, x.p.id) && e.yieldOf(e.planting(x.p.id)).scale === 1), off.length);
}

// ── 5. the bed a box speaks of, and the words ──
if (sown) {
  const st = eng.statedFor(sown.cropId, sown.env), tally = new Map();
  for (const p of core.plantings) { if (p.cropId !== sown.cropId) continue; const r = eng.calc(p); if (!soil(r) || eng.envOf(r.b) !== sown.env) continue; const k = r.cap + '|' + r.totalRows; tally.set(k, (tally.get(k) || 0) + 1); }
  const most = Math.max(...tally.values());
  check('the bed a sown crop’s box speaks of is the commonest it stands on there: its length and its rows', !!st && tally.get(st.ft + '|' + st.rows) === most && st.mixed === true && st.n === [...tally.values()].reduce((a, b) => a + b, 0), st);
  const none = eng.crops().find(c => !c.micro && c.yBasis === 'ft' && !core.plantings.some(p => p.cropId === c.id)), sn = none && eng.statedFor(none.id, 'field');
  check('with nothing planted it is the commonest soil bed of the place, with the rows the crop’s record gives on it', !none || (!!sn && sn.n === 0 && sn.rows >= 1 && sn.ft > 0 && sn.mixed === false), sn);
  check('a tower has no bed to speak of', eng.statedFor(sown.cropId, 'tower') === null);
}
check('the words for what a yield is counted by come from the engine: a row-foot where rows are said, and plainly where they are not', eng.perSaid('ft', 3) === 'a row-foot' && eng.perSaid('ft') === 'a bed-foot, rows not said' && eng.perSaid('ft', null, true) === 'a bed-foot' && eng.perSaid('ft', 2, true) === 'a row-foot' && eng.perSaid('plant') === 'a plant' && eng.perSaid('tray') === 'a tray' && eng.perSaid('container') === 'a container');

// ── 6. two devices: the figure and its rows are one value ──
{
  const base = listed(listed(core, 'beet', 'field', { yield: 2 }), 'carrot', 'field', { yield: 1.2, dtm: 70 });
  const cellOf = (plan, id) => plan.assumptions.crops[id].field, items = (r, kind) => ((r.report && r.report.items) || []).filter(x => x.kind === kind);
  // each types another crop's pair
  let r = M.merge(base, listed(base, 'beet', 'field', { yield: 2.5, rows: 2 }), listed(base, 'carrot', 'field', { yield: 1.5, rows: 3, dtm: 70 }));
  check('two devices that each type another crop’s figure for a bed: both figures and both rows are kept', !!r.plan && JSON.stringify(cellOf(r.plan, 'beet')) === JSON.stringify({ yield: 2.5, rows: 2 }) && cellOf(r.plan, 'carrot').yield === 1.5 && cellOf(r.plan, 'carrot').rows === 3 && cellOf(r.plan, 'carrot').dtm === 70, r.plan && r.plan.assumptions.crops);
  // one device types the figure alone (an older build's box) on a cell whose rows the other wrote: the cloud's pair, said once
  const start = listed(core, 'beet', 'field', { yield: 2 });
  r = M.merge(start, listed(start, 'beet', 'field', { yield: 3 }), listed(start, 'beet', 'field', { yield: 2, rows: 2 }));
  check('one types a figure where the other gave the figure its rows: the cloud’s pair stands whole, and this device’s is said once', !!r.plan && JSON.stringify(cellOf(r.plan, 'beet')) === JSON.stringify({ yield: 2, rows: 2 }) && items(r, 'same-box').length === 1 && String(items(r, 'same-box')[0].path.join('.')).includes('yield+rows+inRow'), [r.plan && cellOf(r.plan, 'beet'), items(r, 'same-box')]);
  r = M.merge(start, listed(start, 'beet', 'field', { yield: 2, rows: 2 }), listed(start, 'beet', 'field', { yield: 3 }));
  check('and the other way round: the cloud’s figure, with no rows, and not half of each', !!r.plan && JSON.stringify(cellOf(r.plan, 'beet')) === JSON.stringify({ yield: 3 }) && items(r, 'same-box').length === 1, r.plan && cellOf(r.plan, 'beet'));
  // both type a pair: never the figure of one with the rows of the other
  r = M.merge(start, listed(start, 'beet', 'field', { yield: 1, rows: 2 }), listed(start, 'beet', 'field', { yield: 2, rows: 4 }));
  check('both type a figure for a bed of other rows: one pair whole, never one’s figure with the other’s rows', !!r.plan && JSON.stringify(cellOf(r.plan, 'beet')) === JSON.stringify({ yield: 2, rows: 4 }));
  // the days of the same cell are still joined by themselves
  const withDays = listed(core, 'beet', 'field', { yield: 2, dtm: 55 });
  r = M.merge(withDays, listed(withDays, 'beet', 'field', { yield: 2, dtm: 60 }), listed(withDays, 'beet', 'field', { yield: 2.5, rows: 2, dtm: 55 }));
  check('the days to harvest in the same cell are joined by themselves: one device’s days and the other’s figure with its rows', !!r.plan && JSON.stringify(cellOf(r.plan, 'beet')) === JSON.stringify({ yield: 2.5, rows: 2, dtm: 60 }) && items(r, 'same-box').length === 0, r.plan && cellOf(r.plan, 'beet'));
  // one side alone: taken as it is, and a figure cleared takes its rows with it
  const had = listed(core, 'beet', 'field', { yield: 2, rows: 2 });
  r = M.merge(had, listed(had, 'beet', 'field', { yield: 2.2, inRow: 3 }), had);
  check('changed on one side alone, that side’s three stand: a figure, with what it says now and without what it said', !!r.plan && JSON.stringify(cellOf(r.plan, 'beet')) === JSON.stringify({ yield: 2.2, inRow: 3 }), r.plan && cellOf(r.plan, 'beet'));
}
finished = true;
