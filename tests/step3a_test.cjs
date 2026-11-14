// Step 3a (preview 0.22): where a crop's days start, and the audit of figures kept on plantings.
// node step3a_test.cjs <app-dir> <plan.json: a backup's or the shipped compact one> [dir of the 0.21 js, to prove the build moves nothing by itself]
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
const A = require(path.join(APP, 'js/audit.js')), SL = require(path.join(APP, 'js/seedlib.js'));
const raw = JSON.parse(fs.readFileSync(PLAN, 'utf8')), core = raw.format ? IO.unpack(raw) : IO.split(raw).core;
const clone = x => JSON.parse(JSON.stringify(x)), FIG = global.FIG = {};
const eng = E.create(core, Lib);
const sameDay = (a, b) => (a == null && b == null) || (a != null && b != null && +a === +b);
const sameCalc = (a, b) => !!a && !!b && sameDay(a.first, b.first) && sameDay(a.last, b.last) && sameDay(a.sow, b.sow);
const withStarts = (starts, extra) => E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, ...(extra || {}), starts } }, Lib);
const withPlan = change => E.create({ ...core, ...change }, Lib);
const days = (e, p) => e.effective(e.planting(p.id)).dtm, timing = (e, p) => e.effective(e.planting(p.id)).catalogTiming || {};

// ── the build itself moves nothing ──
if (OLD) {
  const save = global.LRFEngine; delete require.cache[require.resolve(path.join(OLD, 'engine.js'))];
  const E0 = require(path.join(OLD, 'engine.js')), old = E0.create(core, Lib), off = core.plantings.filter(p => !sameCalc(old.calc(p), eng.calc(p)) || old.effective(p).dtm !== eng.effective(p).dtm);
  check('with nothing set, every planting stands on the days it had in 0.21', off.length === 0, off.slice(0, 3).map(p => p.id));
  global.LRFEngine = save;
}
check('a plan with no list has no starting point set for any crop', eng.crops().every(c => !eng.startRule(c.id).set && eng.startRule(c.id).from === 'transplant' && eng.startRule(c.id).less === 14));

// ── which crops have a choice ──
const fixedOf = c => eng.startFixed(c);
check('a crop sown in place counts from sowing and has no choice', eng.crops().filter(c => !c.micro && c.method !== 'TP' && (c.plantingMaterial || c.material) !== 'bulb' && c.plantingMaterial !== 'plant').every(c => fixedOf(c) === 'sown'));
check('a bulb, or a bought plant, counts from planting and has no choice', eng.crops().filter(c => !c.micro && ((c.plantingMaterial || c.material) === 'bulb' || c.plantingMaterial === 'plant')).every(c => fixedOf(c) === 'planted'));
check('a transplanted crop grown from seed has the choice', eng.crops().filter(c => !c.micro && c.method === 'TP' && (c.plantingMaterial || c.material) !== 'bulb' && c.plantingMaterial !== 'plant').every(c => fixedOf(c) === null));

// ── a supplier's printed days, read by the crop's starting point ──
// A planting in a soil bed, transplanted, whose variety prints days and does not itself say where they start, nothing recorded.
const stated = v => v && E.create && ['seed', 'transplant', 'direct'].includes(v.catalogMaturityBasis);
const plain = core.plantings.filter(p => { if (eng.pinned(p) || p.done) return false; const e = eng.effective(p), b = eng.bedOf(p.bedId), v = eng.variety(p.varietyId), t = e && e.catalogTiming; return e && b && eng.isSoilBed(b) && e.method === 'TP' && e.gh > 0 && v && !stated(v) && t && t.activeMode === 'catalog' && !eng.startFixed(eng.crop(p.cropId)) && t.printed - Math.round(e.gh * 7) > 1; });
const open = plain.find(p => !timing(eng, p).inferredBasis), guessed = plain.find(p => timing(eng, p).inferredBasis && timing(eng, p).conversion === 'seed-minus-nursery');
check('the plan has a transplanted planting on supplier days with no stated start to test with', !!open, { plain: plain.length });
if (open) {
  const c = eng.crop(open.cropId), e0 = eng.effective(open), t0 = e0.catalogTiming, nursery = Math.round(e0.gh * 7), printed = t0.printed;
  check('not set: the printed days count from the day it goes in the bed, as before', days(eng, open) === printed && t0.basisBy === 'none');
  const seed = withStarts({ [c.id]: { from: 'seed' } }), ts = timing(seed, open);
  check('set to sowing: the nursery time comes off the printed days', days(seed, open) === printed - nursery && ts.conversion === 'seed-minus-nursery' && ts.off === nursery && ts.basisBy === 'crop' && ts.inferredBasis === false, { got: days(seed, open), printed, nursery });
  const direct = withStarts({ [c.id]: { from: 'direct' } }), td = timing(direct, open);
  check('set to direct sowing: 14 days come off, not the nursery time', days(direct, open) === printed - 14 && td.conversion === 'direct-less' && td.off === 14 && td.basis === 'direct', { got: days(direct, open), printed });
  check('and the 14 can be changed for the crop', days(withStarts({ [c.id]: { from: 'direct', less: 10 } }), open) === printed - 10 && days(withStarts({ [c.id]: { from: 'direct', less: 0 } }), open) === printed);
  check('set to transplanting: the printed days stand', days(withStarts({ [c.id]: { from: 'transplant' } }), open) === printed && timing(withStarts({ [c.id]: { from: 'transplant' } }), open).basisBy === 'crop');
  check('a rule for another crop changes nothing here', days(withStarts({ 'no-such-crop': { from: 'seed' } }), open) === printed);
  check('a rule the planner does not know is no rule', days(withStarts({ [c.id]: { from: 'moon' } }), open) === printed && !withStarts({ [c.id]: { from: 'moon' } }).startRule(c.id).set);
  check('the compatibility mode ignores the rule', E.create({ ...core, assumptions: { v: 1, crops: {}, varieties: {}, starts: { [c.id]: { from: 'seed' } } } }, Lib, { multipliers: true }).effective(open).dtm === E.create(core, Lib, { multipliers: true }).effective(open).dtm);
  // the variety's own word beats the crop's rule
  const say = basis => E.create({ ...core, varieties: core.varieties.map(v => v.id === open.varietyId ? { ...v, catalogMaturityBasis: basis, catalogSourceChoice: v.catalogSourceChoice || 'url' } : v), assumptions: { v: 1, crops: {}, varieties: {}, starts: { [c.id]: { from: 'seed' } } } }, Lib);
  check('a variety that says “transplanting” keeps it under a crop set to sowing', days(say('transplant'), open) === printed && timing(say('transplant'), open).basisBy === 'variety');
  check('a variety that says “direct sowing” gets the crop’s days less, with no rule for the crop needed', days(say('direct'), open) === printed - 14 && days(E.create({ ...core, varieties: core.varieties.map(v => v.id === open.varietyId ? { ...v, catalogMaturityBasis: 'direct', catalogSourceChoice: v.catalogSourceChoice || 'url' } : v) }, Lib), open) === printed - 14);
  // a figure that leaves nothing for the bed is not used
  const tiny = E.create({ ...core, varieties: core.varieties.map(v => v.id === open.varietyId ? { ...v, catalogDtm: nursery, catalogDtmMax: nursery } : v), assumptions: { v: 1, crops: {}, varieties: {}, starts: { [c.id]: { from: 'seed' } } } }, Lib);
  check('printed days that leave nothing for the bed are set aside for the crop’s number', timing(tiny, open).activeMode === 'fallback' && days(tiny, open) >= 1);
  // recorded days: the nursery time is the one that happened
  const fieldDay = E.d2s(E.addDays(E.s2d(open.date), 0)), sowDay = E.d2s(E.addDays(E.s2d(open.date), -(nursery + 9)));
  const rec = E.create({ ...core, plantings: core.plantings.map(p => p.id === open.id ? { ...p, done: { sow: sowDay, field: fieldDay } } : p), assumptions: { v: 1, crops: {}, varieties: {}, starts: { [c.id]: { from: 'seed' } } } }, Lib);
  check('with sowing and planting out both recorded, the days that passed between them come off', printed - (nursery + 9) >= 1 ? days(rec, open) === printed - (nursery + 9) : timing(rec, open).activeMode === 'fallback', { got: days(rec, open) });
  FIG.sample = { crop: c.name, printed, nursery };
}
if (guessed) {
  const c = eng.crop(guessed.cropId), t0 = timing(eng, guessed), set = withStarts({ [c.id]: { from: 'transplant' } });
  check('a start guessed from a page’s wording is marked as a guess', t0.basisBy === 'guess' && t0.inferredBasis === true);
  check('setting the crop’s starting point ends the guess', days(set, guessed) === t0.printed && timing(set, guessed).inferredBasis === false && timing(set, guessed).basisBy === 'crop', { was: days(eng, guessed), now: days(set, guessed) });
  FIG.guess = { crop: c.name, printed: t0.printed, was: days(eng, guessed) };
} else check('(no planting rests on a guessed start in this plan)', true);

// ── the list's own numbers count from the row's starting point ──
const bare = core.plantings.find(p => { if (eng.pinned(p) || p.done) return false; const e = eng.effective(p), b = eng.bedOf(p.bedId), t = e && e.catalogTiming; return e && b && eng.isSoilBed(b) && e.method === 'TP' && e.gh > 0 && !eng.startFixed(eng.crop(p.cropId)) && (!t || t.activeMode !== 'catalog') && !(eng.variety(p.varietyId) && eng.variety(p.varietyId).dtm > 0); });
const typedOn = open || bare;
if (typedOn) {
  const c = eng.crop(typedOn.cropId), env = eng.envOf(eng.bedOf(typedOn.bedId)), nursery = Math.round(eng.effective(typedOn).gh * 7), level = open ? 'varieties' : 'crops', id = open ? typedOn.varietyId : c.id, N = nursery + 40;
  const list = starts => withStarts(starts, { [level]: { [id]: { [env]: { dtm: N } } } });
  check('a number of your own, row not set: used as it is', days(list({}), typedOn) === N);
  check('row set to sowing: your number less the nursery time', days(list({ [c.id]: { from: 'seed' } }), typedOn) === 40);
  check('row set to direct sowing: your number less 14', days(list({ [c.id]: { from: 'direct' } }), typedOn) === N - 14);
  check('a number that leaves nothing for the bed still gives one day, never none', days(withStarts({ [c.id]: { from: 'seed' } }, { [level]: { [id]: { [env]: { dtm: 3 } } } }), typedOn) === 1);
  const t = list({ [c.id]: { from: 'seed' } }).timingFor(c.id, open ? id : null, env);
  check('the list shows it as typed, and what it comes to: nursery + bed = from seed', t.mine === N && t.value === N && t.bed === 40 && t.nursery === nursery && t.total === nursery + 40 && t.start === 'seed' && t.off === nursery, t);
  const a = list({ [c.id]: { from: 'seed' } }).effective(typedOn).assumed;
  check('the planting says which row it follows and what came off', !!a && a.typed === N && a.off === nursery && a.basis === 'seed' && a.env === env);
}
// defaults do not move when a row's starting point changes: they are shown from the new start instead
const sample = eng.crops().filter(c => !c.micro && !eng.startFixed(c) && eng.timingFor(c.id, null, 'field').source !== 'none').slice(0, 12);
const moved = sample.filter(c => { const t0 = eng.timingFor(c.id, null, 'field'), s = withStarts({ [c.id]: { from: 'seed' } }).timingFor(c.id, null, 'field'), d = withStarts({ [c.id]: { from: 'direct' } }).timingFor(c.id, null, 'field'); return !(s.bed === t0.bed && d.bed === t0.bed && s.fallback === t0.bed + s.nursery && d.fallback === t0.bed + 14 && s.total === s.nursery + s.bed && t0.fallback === t0.bed); });
check('a crop’s default keeps its days in the bed whatever the row is set to; only the figure shown changes', sample.length >= 5 && moved.length === 0, moved.map(c => c.name));
check('a row with no choice shows no nursery time and nothing taken off', eng.crops().filter(c => eng.startFixed(c) && !c.micro).slice(0, 10).every(c => { const t = eng.timingFor(c.id, null, 'field'); return t.source === 'none' || (t.off === 0 && t.nursery === 0 && t.bed === t.value); }));
const tw = core.plantings.find(p => eng.isTower(eng.bedOf(p.bedId)));
if (tw) { const t = eng.timingFor(tw.cropId, null, 'tower'), c = eng.crop(tw.cropId); check('in towers the nursery time is the days in rockwool', t.source === 'none' || t.nursery === Math.max(0, Math.round(c.rockwoolDays ?? 21)), t); }

// ── published starting points ──
const hintOf = name => { const c = eng.crops().find(x => x.name === name); return c ? eng.startHint(c.id) : undefined; };
const byName = re => eng.crops().find(c => re.test(c.name) && !eng.startFixed(c));
const kale = byName(/^kale\b/i), tomato = byName(/tomato/i), flower = byName(/zinnia|cosmos|snapdragon/i);
check('Johnny’s: kale from direct seeding, 14 days less as a transplant', !kale || (eng.startHint(kale.id).from === 'direct' && eng.startHint(kale.id).less === 14));
check('Johnny’s: tomatoes from transplanting', !tomato || eng.startHint(tomato.id).from === 'transplant');
check('Johnny’s: flowers from the seeding date', !flower || eng.startHint(flower.id).from === 'seed');
check('no published start is offered for a crop with no choice, or one the guide does not name', eng.crops().filter(c => eng.startFixed(c)).every(c => eng.startHint(c.id) === null) && Lib.guide.startFor({ name: 'Mystery crop' }) === null);
check('a supplier’s sentence: “from direct seeding” is direct sowing, “from seeding date” is sowing', SL.startOf('seed', 'From direct seeding; subtract about 14 days if transplanting.') === 'direct' && SL.startOf('seed', 'Days to maturity for all flowers and herbs is calculated from seeding date.') === 'seed' && SL.startOf('transplant', 'From transplanting.') === 'transplant' && SL.startOf('', '') === 'unspecified');
{ // every published start, taken at once
  const starts = {}; for (const c of eng.crops()) { const h = eng.startHint(c.id); if (h) starts[c.id] = h.less != null && h.less !== 14 ? { from: h.from, less: h.less } : { from: h.from }; }
  const all = withStarts(starts), pv = A.preview(core, Lib, [{ kind: 'assume', before: null, after: all.plan.assumptions }], eng);
  FIG.published = { crops: Object.keys(starts).length, harvestMoved: pv.harvest, most: pv.most, newDoubleBookings: pv.fresh.length };
  check('taking every published start is one step that can be previewed', Object.keys(starts).length > 5 && pv.moves.every(m => Number.isFinite(m.first)));
}

// ── the plan keeps the starting points ──
{ const plan = { ...core, assumptions: { v: 1, crops: {}, varieties: {}, starts: { x: { from: 'direct', less: 10 } } } }, back = IO.unpack(IO.pack(plan));
  check('a plan saved and opened again keeps where days start', JSON.stringify(back.assumptions) === JSON.stringify(plan.assumptions));
  const carried = IO.carry(plan, clone(core));
  check('a newer backup loaded over the plan does not lose them', !!carried.plan.assumptions && carried.plan.assumptions.starts.x.less === 10 && carried.notes.some(n => /assumptions/.test(n))); }

// ── the audit: figures kept on plantings ──
const sv = A.survey(eng, Lib), P = core.plantings;
const ownDays = p => Number.isFinite(+p.dtm) && +p.dtm > 0, isTray = p => !!p.liveTray, isDone = p => !!p.done && Object.values(p.done).some(v => typeof v === 'string' && v);
const pinnedOpen = P.filter(p => ownDays(p) && !isTray(p) && !isDone(p));
check('counted as keeping their own days: every planting with a number of its own that is not a tray batch', sv.days.own === pinnedOpen.length && sv.trays === P.filter(p => isTray(p) && ownDays(p)).length && sv.days.agree + sv.days.differ === sv.days.own, sv.days);
// The audit grew in 0.23 (yield, harvest days, turnover, copies: step3b_test.cjs). This test is about days, nursery weeks and waiting plantings.
function study3a(plan, lib) { const s = A.study(plan, lib); return { ...s, rows: s.rows.filter(r => ['days', 'weeks', 'wait'].includes(r.kind)) }; }
const st = study3a(core, Lib), dayRows = st.rows.filter(r => r.kind === 'days'), weekRows = st.rows.filter(r => r.kind === 'weeks');
FIG.survey = sv; FIG.rows = { days: dayRows.length, weeks: weekRows.length, take: dayRows.filter(r => r.choice === 'take').length, follow: dayRows.filter(r => r.choice === 'follow').length, keep: dayRows.filter(r => r.choice === 'keep').length };
check('every such planting is in exactly one row, and no tray batch or unpinned planting is in any', (() => { const ids = dayRows.flatMap(r => r.ids); return ids.length === new Set(ids).size && ids.length === pinnedOpen.length && ids.every(id => { const p = eng.planting(id); return ownDays(p) && !isTray(p); }) && !st.rows.some(r => r.kind !== 'wait' && r.ids.some(id => isTray(eng.planting(id)))); })());
check('the count of plantings that already carry the list’s number is the rows that agree', sv.days.agree === dayRows.filter(r => r.agrees).reduce((n, r) => n + r.ids.length, 0) && (pinnedOpen.length === 0 || sv.days.agree < sv.days.own || dayRows.every(r => r.agrees)));
check('a row is one crop, one variety, one growing condition and one number', dayRows.every(r => r.ids.every(id => { const p = eng.planting(id); return p.cropId === r.cropId && (p.varietyId || '') === r.varietyId && Math.round(+p.dtm) === r.days && (eng.envOf(eng.bedOf(p.bedId)) || '') === r.env; })));
check('suggested: follow where the list already gives the number, take where it can, keep otherwise', dayRows.every(r => r.choice === (r.agrees ? 'follow' : r.take ? 'take' : 'keep')) && dayRows.every(r => !(r.agrees && r.take)));
if (pinnedOpen.length) {
  const step = A.build(core, st.rows, {}), pv = A.preview(core, Lib, step.ops, eng), after = A.apply(core, step.ops), e2 = pv.engine;
  FIG.suggested = { released: step.released, taken: step.taken, kept: step.kept, harvestMoved: pv.harvest, sowingMoved: pv.sowing, newDoubleBookings: pv.fresh.length, standing: pv.standing };
  check('the suggested step moves no date in the whole plan', pv.moves.length === 0 && P.every(p => sameCalc(eng.calc(p), e2.calc(e2.planting(p.id)))), pv.moves.slice(0, 3));
  check('and starts no double booking', pv.fresh.length === 0);
  const goneRows = st.rows.filter(r => r.kind === 'days' && r.choice !== 'keep'), gone = new Set(goneRows.flatMap(r => r.ids));
  check('the plantings it lets go carry no days and no “manual” afterwards', step.released === gone.size && [...gone].every(id => { const p = e2.planting(id); return !A.pinned(p) && p.timingMode !== 'manual'; }));
  check('everything else about them is as it was', [...gone].every(id => { const a = { ...eng.planting(id) }, b = { ...e2.planting(id) }; delete a.dtm; delete a.timingMode; return JSON.stringify(a) === JSON.stringify(b); }));
  check('the plantings it keeps are untouched', st.rows.filter(r => r.kind === 'days' && r.choice === 'keep').flatMap(r => r.ids).every(id => JSON.stringify(eng.planting(id)) === JSON.stringify(e2.planting(id))));
  check('no planting outside the rows is changed', P.filter(p => !gone.has(p.id)).every(p => JSON.stringify(p) === JSON.stringify(e2.planting(p.id))));
  const takes = goneRows.filter(r => r.choice === 'take');
  check('each number the list takes is on the list afterwards, on the line the row named', step.taken === new Set(takes.map(r => [r.take.level, r.take.id, r.take.env].join('|'))).size && takes.every(r => { const x = after.assumptions[r.take.level === 'crop' ? 'crops' : 'varieties'][r.take.id]; return x && x[r.take.env] && x[r.take.env].dtm === r.take.typed; }));
  check('and each of those plantings now says it follows the list', takes.every(r => r.ids.every(id => { const e = e2.effective(e2.planting(id)); return e.assumed && e.assumed.level === r.take.level && e.dtm === r.days; })));
  check('a crop line is used only where the whole crop agrees there; otherwise the variety’s line', takes.filter(r => r.take.level === 'crop').every(r => new Set(dayRows.filter(x => x.cropId === r.cropId && x.env === r.env && !x.agrees).map(x => x.days)).size === 1));
  const sv2 = A.survey(e2, Lib);
  check('afterwards the audit counts only the ones kept', sv2.days.own === step.kept - weekRows.reduce((n, r) => n + r.ids.length, 0) - st.rows.filter(r => r.kind === 'wait').reduce((n, r) => n + r.ids.length, 0), { own: sv2.days.own, kept: step.kept });
  // undo: each op is its own inverse
  const undone = A.apply(after, step.ops.map(op => ({ ...op, before: op.after, after: op.before })).reverse());
  check('undoing the step gives back the plan exactly', JSON.stringify(undone.plantings) === JSON.stringify(core.plantings) && JSON.stringify(undone.assumptions || null) === JSON.stringify(core.assumptions || null));
  // every row made to use the list's figure
  const allFollow = Object.fromEntries(st.rows.map(r => [r.key, 'follow'])), step2 = A.build(core, st.rows, allFollow), pv2 = A.preview(core, Lib, step2.ops, eng);
  const bareIds = new Set(pinnedOpen.map(p => p.id)), bareEng = E.create({ ...core, plantings: P.map(p => bareIds.has(p.id) ? A.freed(p) : p) }, Lib);
  FIG.allFollow = { released: step2.released, harvestMoved: pv2.harvest, sowingMoved: pv2.sowing, most: pv2.most, newDoubleBookings: pv2.fresh.length };
  check('“use the list’s” on every row: each planting gets what the list alone gives it', step2.taken === 0 && pinnedOpen.every(p => pv2.engine.effective(pv2.engine.planting(p.id)).dtm === bareEng.effective(bareEng.planting(p.id)).dtm));
  check('and the preview counts every date that moves, no more', pv2.harvest === P.filter(p => { const a = eng.calc(p), b = pv2.engine.calc(pv2.engine.planting(p.id)); return a && b && (!sameDay(a.first, b.first) || !sameDay(a.last, b.last)); }).length);
  check('new double bookings are told from the ones already there', pv2.standing === A.pairs(eng).size && pv2.fresh.every(([a, b]) => !A.pairs(eng).has([a, b].sort().join('|'))) && pv2.fresh.length === [...A.pairs(pv2.engine)].filter(k => !A.pairs(eng).has(k)).length);
  const allKeep = A.build(core, st.rows, Object.fromEntries(st.rows.map(r => [r.key, 'keep'])));
  check('“keep” on every row is no step at all', allKeep.ops.length === 0 && allKeep.kept === st.rows.reduce((n, r) => n + r.ids.length, 0));
  const noTake = dayRows.find(r => !r.take);
  if (noTake) check('“take” asked of a row that cannot give its number does nothing to it', (() => { try { return !A.build(core, st.rows, { ...Object.fromEntries(st.rows.map(r => [r.key, 'keep'])), [noTake.key]: 'take' }).ops.length; } catch (_) { return false; } })());
  // recorded work
  const one = pinnedOpen[0], recPlan = { ...core, plantings: P.map(p => p.id === one.id ? { ...p, done: { sow: '2027-01-05' } } : p) }, stR = study3a(recPlan, Lib);
  check('a planting with anything recorded is in no row, and is counted as left alone', !stR.rows.some(r => r.ids.includes(one.id)) && stR.held === 1 && A.survey(E.create(recPlan, Lib), Lib).days.recorded === 1);
  check('so no step can change it', (() => { const s = A.build(recPlan, stR.rows, Object.fromEntries(stR.rows.map(r => [r.key, 'follow']))); return !s.ops.some(op => !op.kind && op.before.id === one.id); })());
  // waiting plantings
  const twinRow = dayRows.find(r => r.choice !== 'keep'), keptRow = dayRows.find(r => r.choice === 'keep');
  const w = (r, id) => { const p = eng.planting(r.ids[0]), q = { ...p, id, wait: {} }; delete q.bedId; return q; };
  if (twinRow) {
    const waitPlan = { ...core, lrfNext: { ...(core.lrfNext || {}), waiting: [w(twinRow, 'w-a'), ...(keptRow ? [w(keptRow, 'w-b')] : []), { id: 'w-c', cropId: twinRow.cropId, date: '2027-06-01', wait: {} }] } };
    const stW = study3a(waitPlan, Lib), rowsW = stW.rows.filter(r => r.kind === 'wait');
    check('a waiting planting that carries days is listed; one that carries none is not', rowsW.flatMap(r => r.ids).sort().join() === (keptRow ? 'w-a,w-b' : 'w-a') && A.survey(E.create(waitPlan, Lib), Lib).days.waiting === (keptRow ? 2 : 1));
    check('it follows the list when the plantings it was copied from do, and is kept when they are', rowsW.find(r => r.ids.includes('w-a')).choice === 'follow' && (!keptRow || rowsW.find(r => r.ids.includes('w-b')).choice === 'keep'));
    const sW = A.build(waitPlan, stW.rows, {}), afterW = A.apply(waitPlan, sW.ops), listW = afterW.lrfNext.waiting;
    check('letting it go takes its days off in the waiting list, and nothing else', !A.pinned(listW.find(x => x.id === 'w-a')) && listW.find(x => x.id === 'w-a').timingMode !== 'manual' && listW.length === waitPlan.lrfNext.waiting.length && (!keptRow || A.pinned(listW.find(x => x.id === 'w-b'))) && JSON.stringify(listW.find(x => x.id === 'w-c')) === JSON.stringify(waitPlan.lrfNext.waiting.find(x => x.id === 'w-c')) && sW.waiting === 1);
  }
  check('the suggested step on the plan as shipped has work to do', step.ops.length > 0);
  // a planting of the same crop that already follows the list must not be moved by a number handed to the list
  const lender = dayRows.find(r => r.take && r.take.level === 'crop');
  if (lender) {
    const src = eng.planting(lender.ids[0]), extra = A.freed({ ...src, id: 'extra-unpinned' }), planX = { ...core, plantings: [...P, extra] }, engX = E.create(planX, Lib), stX = study3a(planX, Lib), rowX = stX.rows.find(r => r.key === lender.key);
    const stepX = A.build(planX, stX.rows, {}), pvX = A.preview(planX, Lib, stepX.ops, engX);
    check('where a planting of the crop already follows the list, the crop’s line is not changed under it', !!rowX && (!rowX.take || rowX.take.level !== 'crop') && pvX.moves.length === 0 && sameCalc(engX.calc(engX.planting('extra-unpinned')), pvX.engine.calc(pvX.engine.planting('extra-unpinned'))), { take: rowX && rowX.take, moves: pvX.moves.length });
  }
} else check('(no planting keeps its own days in this plan)', true);

// ── plantings that rest on a guessed start ──
{ const onGuess = P.filter(p => { if (ownDays(p)) return false; const t = (eng.effective(p) || {}).catalogTiming; return t && t.activeMode === 'catalog' && t.inferredBasis === true; });
  check('the audit counts the plantings whose start is a guess, and names their crops', sv.guessed.plantings === onGuess.length && sv.guessed.crops.slice().sort().join() === [...new Set(onGuess.map(p => p.cropId))].sort().join(), sv.guessed);
  if (onGuess.length) { const id = onGuess[0].cropId, set = withStarts({ [id]: { from: 'transplant' } }); check('a crop whose start is set is no longer among them', !A.survey(set, Lib).guessed.crops.includes(id) && A.survey(set, Lib).guessed.plantings === onGuess.filter(p => p.cropId !== id).length); }
  FIG.guessed = { plantings: onGuess.length, crops: sv.guessed.crops.map(id => eng.crop(id).name) }; }

// ── nursery weeks frozen on plantings ──
if (weekRows.length) {
  const r = weekRows[0], c = eng.crop(r.cropId);
  check('nursery weeks: listed where the planting’s frozen weeks differ from the crop’s, kept unless asked', weekRows.every(x => x.choice === 'keep' && x.weeks !== x.listWeeks && x.ids.every(id => A.frozenWeeks(eng.planting(id)) === x.weeks)) && r.listWeeks === +(c.gh || 0));
  const s = A.build(core, st.rows, { ...Object.fromEntries(st.rows.map(x => [x.key, 'keep'])), [r.key]: 'follow' }), pv = A.preview(core, Lib, s.ops, eng), e2 = pv.engine;
  check('using the crop’s weeks takes only the frozen weeks off; the rest of the old copy stays', s.thaw === r.ids.length && r.ids.every(id => { const a = eng.planting(id), b = e2.planting(id); return !!b.growingDefaults && !!b.growingDefaults.crop && !('gh' in b.growingDefaults.crop) && JSON.stringify({ ...a.growingDefaults.crop, gh: undefined }) === JSON.stringify(b.growingDefaults.crop) && JSON.stringify({ ...a.growingDefaults, crop: 0 }) === JSON.stringify({ ...b.growingDefaults, crop: 0 }) && ownDays(b) === ownDays(a); }));
  const sown = r.ids.map(id => ({ a: eng.calc(eng.planting(id)), b: e2.calc(e2.planting(id)) })).filter(x => x.a.sow && x.b.sow);
  check('its sowing day moves by the difference in weeks, and the preview says so', sown.every(x => E.dayDiff(x.b.sow, x.a.sow) === Math.round((r.weeks - r.listWeeks) * 7)) && pv.sowing === sown.filter(x => +x.a.sow !== +x.b.sow).length, { weeks: r.weeks, list: r.listWeeks, n: sown.length });
  FIG.weeks = weekRows.map(x => ({ crop: eng.crop(x.cropId).name, theirs: x.weeks, crop_now: x.listWeeks, plantings: x.ids.length }));
} else check('(no planting keeps frozen nursery weeks that differ in this plan)', true);
finished = true;
