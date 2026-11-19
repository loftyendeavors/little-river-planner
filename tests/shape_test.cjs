'use strict';
// The plan's shape, written down in tests/plan_shape.cjs, held to three things without a browser:
//   1. itself: every entry readable, each hanging from a place that holds it
//   2. js/merge.js: each rule the shape names is the merge's own, place for place, read from the merge's code
//   3. the made-up farm, as the planner holds it and as a file holds it, and the plans the planner's own functions make of it
//      (every kind of job recorded and taken back, put off, skipped, noted; seed lots added, counted, received, moved, deleted)
// Its page counterpart, tests/shape_check.py, holds the plans the page itself makes to the same shape.
// usage: node shape_test.cjs <app-dir> <plan.json: a backup's> <inventory.json> <dir holding node_modules/acorn>
//        node shape_test.cjs --plan <a plan file> <app-dir>      what in a plan of one's own the shape does not name (prints; checks nothing)
const path = require('path'), fs = require('fs');
const SH = require('./plan_shape.cjs');
global.window = global;

if (process.argv[2] === '--plan') {
  const [, , , FILE, APP0] = process.argv, IO0 = require(path.join(APP0, 'js/planio.js'));
  const r = SH.check(JSON.parse(fs.readFileSync(FILE, 'utf8')), '', { attic: IO0.CORE_KEYS, limit: 500 });
  const places = list => [...new Set(list.map(x => x.place + (x.want ? ` (${x.got}, written down as ${x.want})` : '')))].sort();
  console.log(JSON.stringify({ unknown: places(r.unknown), wrong: places(r.wrong) }, null, 1));
  process.exit(0);
}

const [APP, PLAN, STOCK, MODS] = process.argv.slice(2);
const results = [], fail = [];
let finished = false, stopped = '';
process.on('uncaughtException', e => { stopped = String(e && e.stack || e).split('\n').slice(0, 4).join(' | '); process.exit(1); });
process.on('exit', () => { if (!finished) { results.push(`FAIL (the test stopped before its end) ${stopped}`); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 900)}`); if (!ok) fail.push(name); };
const tryCase = (name, run) => { try { const out = run(); check(name, out === true || (Array.isArray(out) && out[0] === true), Array.isArray(out) ? out[1] : out); } catch (e) { check(name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } };

const E = require(path.join(APP, 'js/engine.js')), IO = require(path.join(APP, 'js/planio.js'));
const L = require(path.join(APP, 'js/library.js')), Lib = global.LRFLibrary || L; require(path.join(APP, 'js/guide.js'));
const SL = require(path.join(APP, 'js/seedlib.js')), W = require(path.join(APP, 'js/week.js'));
const acorn = require(path.join(MODS, 'node_modules/acorn'));

// ── what js/merge.js and js/app.js say, read from their code ──
const parse = file => acorn.parse(fs.readFileSync(path.join(APP, 'js', file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
/** Every node of a tree, depth first. */
function* nodes(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const key of Object.keys(node)) { const v = node[key]; if (Array.isArray(v)) for (const x of v) yield* nodes(x); else if (v && typeof v.type === 'string') yield* nodes(v); }
}
const declared = (tree, name) => { for (const n of nodes(tree)) if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name) return n.init; return null; };
/** The strings of ['a', 'b'] or new Set(['a', 'b']), or the keys of { a: …, 'b': … }. */
function words(init) {
  if (!init) return null;
  if (init.type === 'NewExpression' && init.arguments.length) return words(init.arguments[0]);
  if (init.type === 'ArrayExpression') return init.elements.map(x => (x && x.type === 'Literal' ? x.value : null));
  if (init.type === 'ObjectExpression') return init.properties.map(p => (p.key.type === 'Literal' ? p.key.value : p.key.name));
  return null;
}
const MERGE = parse('merge.js'), APPJS = parse('app.js');
const merged = {};
for (const name of ['WHOLE', 'QUIET', 'STAMPS', 'NO_IDS', 'PLACE', 'TIME', 'TRAY_DEMAND', 'RULES']) merged[name] = words(declared(MERGE, name));
// the keys of a record that are joined as one value: { 'place': [['a', 'b']] } read as the places place.a and place.b
merged.TOGETHER = (init => (init && init.type === 'ObjectExpression' ? init.properties.flatMap(p => (p.value.type === 'ArrayExpression' ? p.value.elements.flatMap(g => (words(g) || [null]).map(k => (k == null ? null : (p.key.type === 'Literal' ? p.key.value : p.key.name) + '.' + k))) : [null])) : null))(declared(MERGE, 'TOGETHER'));
// the parts of a planting joinPlanting joins as a recording: the keys of its object `special`, and any key set on it afterwards
const special = (() => {
  let fn = null;
  for (const n of nodes(MERGE)) if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'joinPlanting') fn = n;
  if (!fn) return null;
  const keys = words(declared(fn, 'special')) || [];
  for (const n of nodes(fn)) if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && n.left.object.type === 'Identifier' && n.left.object.name === 'special' && !n.left.computed) keys.push(n.left.property.name);
  return keys;
})();
const OWN_KEYS = words(declared(APPJS, 'OWN_KEYS'));
check('the merge\'s own tables and the planner\'s own keys can be read from their code', Object.values(merged).every(Array.isArray) && Array.isArray(special) && special.length >= 2 && Array.isArray(OWN_KEYS) && OWN_KEYS.length > 0, { merged, special, OWN_KEYS });

// ── 1. the shape itself ──
const all = SH.entries();
tryCase('the written shape can be read: every entry a known type, and known rules', () => {
  const bad = all.filter(e => !e.types.length || e.types.some(t => !SH.TYPES.includes(t)) || e.rules.some(r => !SH.RULES.includes(r)) || (e.types.includes('object') && e.types.includes('map')));
  return [bad.length === 0 && all.length > 300, bad.map(e => e.place)];
});
tryCase('every entry hangs from a place that holds it: a key of an object, any key of a map, a member of a list', () => {
  const bad = [];
  for (const e of all) {
    if (!e.place) continue;
    const { parent, how } = SH.parentOf(e.place), p = SH.entry(parent);
    const holds = p && (how === 'member' ? p.types.some(t => ['records', 'lines', 'list'].includes(t)) : how === 'any key' ? p.types.includes('map') : p.types.includes('object'));
    if (!holds) bad.push(e.place);
  }
  return [bad.length === 0, bad];
});
tryCase('a list of objects without ids says how it is joined, in one word: whole, kept or one (one value, the merge\'s default)', () => {
  const bad = all.filter(e => e.types.includes('lines') && ['whole', 'kept', 'one'].filter(r => e.rules.includes(r)).length !== 1).map(e => e.place);
  return [bad.length === 0, bad];
});

// ── 2. the rules are the merge's own, both ways ──
const marked = rule => all.filter(e => e.rules.includes(rule)).map(e => e.place).sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const both = (name, mine, theirs) => check(name, same(mine, theirs), { 'marked in the shape only': mine.filter(x => !theirs.includes(x)), 'in merge.js only': theirs.filter(x => !mine.includes(x)) });
both('whole: what js/merge.js takes whole (WHOLE) is what the shape marks whole, place for place', marked('whole'), merged.WHOLE || []);
both('kept: the lines js/merge.js keeps from each side (NO_IDS) are those the shape marks kept', marked('kept'), merged.NO_IDS || []);
both('quiet: what js/merge.js takes from the cloud without a word (QUIET) is what the shape marks quiet', marked('quiet'), merged.QUIET || []);
both('together: the keys js/merge.js joins as one value with others of their record (TOGETHER) are those the shape marks together', marked('together'), merged.TOGETHER || []);
both('stamp: every place whose key is one of js/merge.js STAMPS is marked stamp, and no other place is',
  marked('stamp'), all.filter(e => (merged.STAMPS || []).includes(e.place.split('.').pop())).map(e => e.place));
both('place: where a planting is (js/merge.js PLACE) is what the shape marks place on a planting', marked('place'), (merged.PLACE || []).map(k => 'plantings[].' + k));
both('time: when a planting is (js/merge.js TIME) is what the shape marks time on a planting', marked('time'), (merged.TIME || []).map(k => 'plantings[].' + k));
both('rule: what js/merge.js joins by a rule of its own (RULES) is what the shape marks rule', marked('rule'), merged.RULES || []);
both('recording: what joinPlanting joins as a recording is what the shape marks recording on a planting', marked('recording'),
  [...(special || []), ...(merged.TRAY_DEMAND || [])].map(k => 'plantings[].' + k));
tryCase('every place a merge rule names is written in the shape: none names a place the plan cannot hold', () => {
  const named = [...(merged.WHOLE || []), ...(merged.NO_IDS || []), ...(merged.QUIET || []), ...(merged.TOGETHER || []), ...(merged.RULES || []), ...(merged.PLACE || []).map(k => 'plantings[].' + k), ...(merged.TIME || []).map(k => 'plantings[].' + k)];
  const missing = named.filter(p => !SH.entry(p));
  return [missing.length === 0, missing];
});
tryCase('the planner\'s own collections (planio.js CORE_KEYS) and what it keeps beside a plan (app.js OWN_KEYS) are each written in the shape', () => {
  const missing = [...IO.CORE_KEYS.filter(k => !SH.entry(k)), ...OWN_KEYS.filter(k => !SH.entry('lrfNext.' + k)).map(k => 'lrfNext.' + k)];
  return [missing.length === 0, missing];
});

// ── 3. the farm, and what the planner's own functions make of it ──
const split = IO.split(JSON.parse(fs.readFileSync(PLAN, 'utf8')));
const FARM = Object.freeze({ ...split.core, seedInventory: JSON.parse(fs.readFileSync(STOCK, 'utf8')) });
const short = r => ({ unknown: r.unknown.slice(0, 8), wrong: r.wrong.slice(0, 8) });
const fitsPlan = plan => { const r = SH.check(plan); return [r.unknown.length === 0 && r.wrong.length === 0, short(r)]; };
/** The plan as a file holds it: what Backup downloads, the folder, a snapshot and the cloud each hold (app.js planText). */
const asFile = plan => ({ ...IO.join(plan, split.attic), lrfNextKeep: { v: 1, savedAt: '2027-03-01T10:00:00.000Z', device: 'device-1', keep: Object.fromEntries(OWN_KEYS.filter(k => (plan.lrfNext || {})[k] != null).map(k => [k, plan.lrfNext[k]])) } });
const fitsFile = plan => { const r = SH.check(asFile(plan), '', { attic: IO.CORE_KEYS }); return [r.unknown.length === 0 && r.wrong.length === 0, short(r)]; };
tryCase('the farm, as the planner holds it, fits the written shape', () => fitsPlan(FARM));
tryCase('the farm, as a file holds it, fits the written shape (the records the planner does not edit are passed over)', () => fitsFile(FARM));

let n = 0;
const ctx = { now: '2027-03-01T10:00:00.000Z', uid: () => 'shape-' + (++n), year: 2027, name: '', today: '2027-12-31' };
const eng = plan => E.create(plan, Lib);
const put = (plan, r) => ({ ...plan, plantings: plan.plantings.map(q => (q.id === r.planting.id ? r.planting : q)), ...(r.inventory ? { seedInventory: r.inventory } : {}) });
const KINDS = ['sow', 'potup', 'harden', 'field', 'move'];
/** For each kind of job, the first planting of the farm that has it open, and its day. Found on the farm, named nowhere. */
const open = new Map();
for (const p of FARM.plantings) {
  let steps = [];
  try { steps = W.steps(eng(FARM), p); } catch (_) { continue; }
  for (const s of steps) if (!s.done && !open.has(s.kind) && KINDS.includes(s.kind) && String(E.d2s(s.planned)).slice(0, 4) === '2027') open.set(s.kind, { id: p.id, date: E.d2s(s.planned) });
  if (open.size === KINDS.length) break;
}
let worked = FARM;
tryCase('every kind of job, recorded by the planner\'s own function, leaves a plan that fits, as the planner holds it and as a file holds it', () => {
  const missing = KINDS.filter(k => !open.has(k)), done = [];
  for (const kind of KINDS) {
    const j = open.get(kind);
    if (!j) continue;
    const p = worked.plantings.find(q => q.id === j.id);
    worked = put(worked, W.record(eng(worked), worked.seedInventory, p, kind, { date: j.date }, ctx)); done.push(kind);
  }
  const a = fitsPlan(worked), b = fitsFile(worked);
  return [missing.length === 0 && done.length === KINDS.length && a[0] && b[0], { missing, done, plan: a[1], file: b[1] }];
});
tryCase('a job recorded days after its plan, which pushes its planting later, leaves a plan that fits', () => {
  const j = open.get('sow') || open.get('field');
  if (!j) return [false, 'the farm has no open job to record late'];
  const kind = open.get('sow') ? 'sow' : 'field', p = FARM.plantings.find(q => q.id === j.id);
  const r = W.record(eng(FARM), FARM.seedInventory, p, kind, { date: E.d2s(E.addDays(E.s2d(j.date), 3)) }, ctx), plan = put(FARM, r);
  const a = fitsPlan(plan), b = fitsFile(plan);
  return [!!r.moved && a[0] && b[0], { moved: r.moved, held: r.held, plan: a[1], file: b[1] }];
});
tryCase('each of those jobs taken back leaves a plan that fits', () => {
  let plan = worked, back = 0;
  for (const kind of KINDS) { const p = plan.plantings.find(q => q.done && q.done[kind]); if (p) { plan = put(plan, W.takeBack(eng(plan), plan.seedInventory, p, kind, ctx)); back++; } }
  const a = fitsPlan(plan);
  return [back === KINDS.length && a[0], { back, plan: a[1] }];
});
tryCase('a job put off (one that moves its planting, one that does not), skipped and given a note leaves a plan that fits', () => {
  let plan = FARM;
  const moves = open.get('field'), stays = open.get('potup') || open.get('harden'), other = open.get('sow');
  if (!moves || !stays || !other) return [false, 'the farm has no open jobs to put off'];
  const later = (j, d) => E.d2s(E.addDays(E.s2d(j.date), d));
  for (const [j, kind] of [[moves, 'field'], [stays, open.get('potup') ? 'potup' : 'harden']]) { const r = W.delay(eng(plan), plan.plantings.find(q => q.id === j.id), kind, later(j, 3)); if (!r) return [false, 'nothing was put off']; plan = put(plan, r); }
  plan = put(plan, { planting: W.skip(plan.plantings.find(q => q.id === other.id), 'sow', later(other, 1)) });
  plan = put(plan, { planting: W.withTask(plan.plantings.find(q => q.id === other.id), 'note', 'sow', 'a note') });
  const delays = plan.plantings.filter(p => p.tasks && p.tasks.delay).length, a = fitsPlan(plan), b = fitsFile(plan);
  return [delays === 2 && a[0] && b[0], { delays, plan: a[1], file: b[1] }];
});
tryCase('a planting marked failed, and another marked and the mark taken off, by the planner\'s own function, leave a plan that fits', () => {
  const [a0, b0] = FARM.plantings.filter(p => !p.established && eng(FARM).calc(p));
  if (!a0 || !b0) return [false, 'the farm has no plantings to mark'];
  let plan = put(FARM, { planting: W.fail(a0, a0.date, ctx.now) });
  plan = put(plan, { planting: W.fail(W.fail(b0, b0.date, ctx.now), null) });
  const marked = plan.plantings.filter(p => p.failed).length, a = fitsPlan(plan), b = fitsFile(plan);
  return [marked === 1 && plan.plantings.find(p => p.id === a0.id).failed.on === a0.date && a[0] && b[0], { marked, plan: a[1], file: b[1] }];
});
tryCase('seed lots added, counted, received, moved and deleted by the planner\'s own functions leave a plan that fits', () => {
  let inv = FARM.seedInventory;
  const lots = inv.lots.filter(l => l.deleted !== true), first = lots[0];
  if (lots.length < 4) return [false, 'the farm has fewer than four seed lots'];
  inv = SL.updateLot(inv, first.id, { quantity: 5 }, 'count', ctx) || inv;
  inv = SL.addLot(inv, { key: first.key, unit: 'seeds', quantity: 9, status: 'ordered' }, ctx);
  inv = SL.receiveLot(inv, inv.lots[inv.lots.length - 1].id, ctx) || inv;
  inv = SL.moveLot(inv, lots[1].id, lots[2].key, ctx) || inv;
  inv = SL.deleteLot(inv, lots[3].id, ctx) || inv;
  const plan = { ...FARM, seedInventory: inv }, changes = (inv.adjustments || []).length - (FARM.seedInventory.adjustments || []).length, a = fitsPlan(plan);
  return [changes >= 4 && a[0], { changes, plan: a[1] }];
});

// the variety editor and the crop editor: the screens that call them are not on the page's tour, so their own functions are called here
tryCase('a variety saved from a supplier page, one with no days given, and one edited by hand, by the planner\'s own functions, fit', () => {
  const v = FARM.varieties.find(x => x.active !== false && x.cropId);
  if (!v) return [false, 'the farm has no variety'];
  const page = { url: 'https://supplier.example/variety', supplier: 'A Supplier', description: 'A line of text.', facts: { latin: 'Planta exempli', depth: '1/4 in', seedsPerLb: 120000, seedsPerG: 260 }, prices: [{ label: '1 g', price: 3.5, seeds: 250 }] };
  const form = { name: v.name, cropId: v.cropId, supplier: 'A Supplier', sku: 'AB-1', dtmMin: 50, dtmMax: 55, basis: 'transplant', stage: 'mature', nurseryDays: 28, inRow: 9, rowSp: 12, germ: 85, rowsPerBed: 3, seedsPerPacket: 250, seedsPerOz: 7000, dtm: 52 };
  const fromPage = SL.apply(v, SL.fields(page, form));
  const noDays = SL.apply(v, SL.fields(page, { ...form, dtmMin: '', dtmMax: '' }));
  const byHand = SL.apply(v, SL.fields(null, { ...form, notes: 'kept by hand', inRow: '', germ: '' }, { edit: true }));
  const rs = [fromPage, noDays, byHand].map(x => SH.check(x, 'varieties[]')), bad = rs.flatMap(r => r.unknown.concat(r.wrong));
  return [noDays.catalogDtm === null && fromPage.description === page.description && byHand.notes === 'kept by hand' && bad.length === 0, bad.slice(0, 8)];
});
tryCase('the farm packed as the plan that ships with the page, and opened again, fits (a variety noted determinate among it)', () => {
  const v = FARM.varieties.find(x => x.active !== false);
  if (!v) return [false, 'the farm has no variety'];
  const marked = { ...FARM, varieties: FARM.varieties.map(x => (x.id === v.id ? { ...x, notes: 'A determinate tomato.' } : x)) };
  const back = IO.unpack(IO.pack(marked)), r = SH.check(back), mark = (back.varieties.find(x => x.id === v.id) || {})._determinate;
  return [mark === true && !r.unknown.length && !r.wrong.length, { mark, ...short(r) }];
});
tryCase('a crop added to the library by the planner\'s own function fits', () => {
  const c = SL.newCrop({ name: 'A New Crop', family: 'Asteraceae', method: 'TP', material: 'seed' }, 'c_shape-new-crop');
  const r = SH.check(c, 'crops[]');
  return [!!c && !!c.id && !r.unknown.length && !r.wrong.length, short(r)];
});

// ── the check itself finds what it is there for ──
const P0 = FARM.plantings[0];
const withPlanting = change => ({ ...FARM, plantings: [{ ...P0, ...change }, ...FARM.plantings.slice(1)] });
tryCase('and a field named nowhere is found: on a planting, inside a map, and an object in a list of plain values', () => {
  const a = SH.check(withPlanting({ fresh: 1 })), b = SH.check(withPlanting({ done: { sow: '2027-03-01', other: { x: 1 } } })), c = SH.check({ ...FARM, planningPreferences: { ...(FARM.planningPreferences || {}), gardenOrder: [{ id: 'x' }] } });
  const places = [a, b, c].map(r => r.unknown.concat(r.wrong).map(x => x.place).join());
  return [places[0] === 'plantings[].fresh' && places[1] === 'plantings[].done.*' && places[2] === 'planningPreferences.gardenOrder[]', places];
});
tryCase('and a value of another type is found, and a record without an id, or with an id twice, in a list of records', () => {
  const a = SH.check(withPlanting({ ft: 'twenty' })), b = SH.check({ ...FARM, beds: [...FARM.beds, { bed: 'no id' }, { ...FARM.beds[0] }] });
  return [a.wrong.length === 1 && a.wrong[0].place === 'plantings[].ft' && b.wrong.filter(w => w.place === 'beds').length === 2, { a: a.wrong, b: b.wrong }];
});
tryCase('and the records the planner does not edit are passed over in a file and nowhere else', () => {
  const plan = { ...FARM, harvests: [{ any: 'thing' }] }, a = SH.check(plan, '', { attic: IO.CORE_KEYS }), b = SH.check(plan);
  return [a.unknown.length === 0 && b.unknown.length === 1 && b.unknown[0].place === 'harvests', { file: a.unknown, plan: b.unknown }];
});
finished = true;
