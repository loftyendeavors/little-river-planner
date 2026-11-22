/* Little River Farm Planner — application state, edits, undo and start-up.
 *
 * One plan object, one engine built from it, and a short list of events the
 * views listen to. Every edit goes through commit(), which records how to
 * undo it, rebuilds the engine, queues a save and tells the views.
 */
(function (root) {
  'use strict';
  const E = root.LRFEngine, Lib = root.LRFLibrary, IO = root.LRFPlanIO, UI = root.LRFUI, Rails = root.LRFRails;
  const { h, toast, day, span } = UI;

  const state = {
    plan: null, engine: null, attic: null, extras: null, inventoryBase: null, inventoryAsked: null, packsBase: {}, keptThumbs: {}, bundled: null, mapImageUrl: '',
    date: new Date(), view: 'map', sel: null, armed: null,
    undo: [], redo: [], ready: false,
    mixing: null,   // the bed varieties are being dropped into one after another: { bedId, by: 'length' | 'rows' } (see shareDrop)
    last: null   // the last change taken or refused: { kind: 'saved' | 'refused', label | text, at, step }, read by the panel's "Saved" line
  };
  const listeners = {};
  const on = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };
  const emit = (event, detail) => { for (const fn of listeners[event] || []) fn(detail); };
  const uid = () => root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
  const clone = v => JSON.parse(JSON.stringify(v));

  let store = null;
  /** Why this window takes no change, in words: the plan is held by, or was changed in, another window of this browser (see js/store.js). '' in the window that holds the plan. */
  const elsewhere = () => ({
    window: 'This window only shows the plan: the planner is open in another window of this browser, and changes are made there.',
    moved: 'This window only shows the plan: it is now being worked on in another window.',
    changed: 'This window takes no more changes: the plan was changed in another window. Reload it to carry on.'
  }[store && store.readOnly] || '');
  const rebuild = () => { state.engine = E.create(state.plan, Lib); };
  /** What this app keeps beside a plan, apart from the plan's own records. It travels in a plan file's own note (see withOwn). */
  const OWN_KEYS = ['crates', 'trayStart', 'trays', 'groups', 'facts', 'waiting', 'supplies', 'runs'];
  /**
   * A fingerprint of what the plan says: the same for the same plan, whenever and wherever it was opened. The app's own
   * bookkeeping (when the plan was loaded, from which file) is left out. Sync and snapshots tell "changed" from "the same" by it.
   */
  function contentKey(plan = state.plan) {
    const mine = plan.lrfNext || {}, keep = {};
    for (const key of OWN_KEYS) if (mine[key] != null) keep[key] = mine[key];
    const text = JSON.stringify({ ...plan, lrfNext: keep });
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 33) ^ c) | 0; }
    return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}-${text.length.toString(36)}`;
  }

  // ───────────────────────────── navigation ─────────────────────────────
  function setDate(d) {
    if (!E.validDate(d)) return;
    const year = planYear(), lo = new Date(year, 0, 1), hi = new Date(year, 11, 31);
    state.date = d < lo ? lo : d > hi ? hi : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    emit('date');
  }
  const isSample = () => !!(state.plan && state.plan.lrfNext && state.plan.lrfNext.sample);
  const planYear = () => +(state.plan && state.plan.settings && state.plan.settings.year) || new Date().getFullYear();
  function select(sel) { state.sel = sel; if (sel) document.body.dataset.sel = sel.type; else delete document.body.dataset.sel; emit('sel'); }
  function setView(view) { state.view = view; document.body.dataset.view = view; emit('view'); }
  function arm(payload) { state.armed = payload; document.body.classList.toggle('armed', !!payload); emit('armed'); }

  const bedLabel = (b, eng = state.engine) => { const g = eng.gardenOf(b); return `${g ? g.name : 'Garden'} · ${eng.isTower(b) ? 'Tower ' : ''}${b.bed}`; };
  const cropLabel = (p, eng = state.engine) => { const c = eng.crop(p.cropId), v = eng.variety(p.varietyId); return v && v.name ? `${v.name} ${c ? c.name.toLowerCase() : ''}`.trim() : c ? c.name : 'Crop'; };

  // ─────────────────────────── edits and undo ───────────────────────────
  /**
   * ops: [{ before, after, kind? }] — add, change or remove a planting (or a bed, kind: 'bed').
   * Every edit passes the guard rails first: one that would put two plantings in the same
   * ground at the same time, or run a planting past the end of its bed, does not happen.
   */
  function withOps(plan, ops, direction) {
    const lists = { plantings: plan.plantings.slice() }, next = { ...plan };
    // Undo runs a step backwards, last change first, so that a record taken out goes back where it stood (its place is noted on
    // the step as it is taken out). Put back at the end instead, the plan would read the same and still count as changed.
    for (const op of direction === 'undo' ? ops.slice().reverse() : ops) {
      const from = direction === 'undo' ? op.after : op.before, to = direction === 'undo' ? op.before : op.after;
      if (op.kind === 'assume') { if (to) next.assumptions = to; else delete next.assumptions; continue; }
      if (op.kind === 'settings') { next.settings = to; continue; }
      if (op.kind === 'map') { next.map = to || {}; continue; }   // the photo's scale and the like (mapedit.js)
      if (op.kind === 'inventory') { if (to) next.seedInventory = to; else delete next.seedInventory; continue; }
      if (op.kind === 'trays') { if (to) next.liveTrayPlans = to; else delete next.liveTrayPlans; continue; }
      if (op.kind === 'nursery') { if (to) next.nursery = to; else delete next.nursery; continue; }
      if (op.kind === 'own') { next.lrfNext = { ...(next.lrfNext || {}) }; if (to == null) delete next.lrfNext[op.key]; else next.lrfNext[op.key] = to; continue; }
      const key = { bed: 'beds', garden: 'gardens', variety: 'varieties', crop: 'crops' }[op.kind] || 'plantings', list = lists[key] || (lists[key] = (plan[key] || []).slice());
      const index = from ? list.findIndex(x => x.id === from.id) : -1;
      if (to && index >= 0) list[index] = to;
      else if (to) { if (direction === 'undo' && Number.isInteger(op.at) && op.at <= list.length) list.splice(op.at, 0, to); else list.push(to); }
      else if (index >= 0) { if (direction !== 'undo') op.at = index; list.splice(index, 1); }
    }
    return Object.assign(next, lists);
  }
  let lastTouch = 0;   // when the plan was last changed here, or a key or the pointer last pressed: another device's changes wait for a pause
  function adopt(plan, engine) {
    lastTouch = Date.now();
    startOfDay();   // the plan as it stood before the first change of a day is kept as a snapshot
    state.plan = plan; state.engine = engine || E.create(plan, Lib);
    store.save(state.plan);
    folderSoon();
    if (sync) sync.touch();
    emit('plan');
  }
  const touched = (ops, engine) => { const ids = new Set(); for (const op of ops) { if (['assume', 'garden', 'variety', 'crop', 'settings', 'map', 'inventory', 'trays', 'nursery', 'own'].includes(op.kind)) continue; if (op.kind === 'bed') { for (const p of engine.plantingsIn((op.after || op.before).id)) ids.add(p.id); } else if (op.after) ids.add(op.after.id); } return [...ids]; };
  /** Why the guard rails refuse an edit, in words. */
  function refusalText(no, engine) {
    const bed = engine.bedOf(no.p.bedId), what = cropLabel(no.p, engine), unit = engine.capUnit(bed);
    if (no.kind === 'too-long') return `${what} would run past the end: ${bedLabel(bed, engine)} is ${UI.num(engine.capOf(bed), 1)} ${unit}`;
    if (!no.other) return `${bedLabel(bed, engine)} is resting then`;
    const r = engine.calc(no.other), until = engine.occupancyThrough(no.other, r), starts = engine.occupancyFrom(no.other, r) > engine.occupancyFrom(no.p, no.r);
    return `${what} would overlap ${cropLabel(no.other, engine)} in ${bedLabel(bed, engine)} (${starts ? 'goes in ' + day(r.field) : until === Infinity ? 'stays all season' : 'holds the ground until ' + day(until)})`;
  }
  /**
   * A change made here to a crop, variety, garden or bed is a statement about the farm. It is noted beside the plan,
   * in the same step, so that loading a newer full backup does not quietly take it back (see IO.carry).
   */
  function noted(ops) {
    const lists = { crop: 'crops', variety: 'varieties', garden: 'gardens', bed: 'beds' }, was = (state.plan.lrfNext || {}).facts || null;
    let facts = was;
    for (const op of ops) if (lists[op.kind] && op.after) facts = IO.note(facts, lists[op.kind], op.before, op.after, op.kind === 'crop' && Lib.crops.some(c => c.id === op.after.id));
    return JSON.stringify(facts) === JSON.stringify(was) ? ops : [...ops, { kind: 'own', key: 'facts', before: was, after: facts }];
  }
  function commit(label, ops, options = {}) {
    if (!ops.length) return false;
    if (elsewhere()) return refuse(elsewhere());
    // A sowing day set by hand belongs to the date it was set against: when the planting moves, the plan's own day applies again.
    ops = ops.map(op => { if (op.kind || !op.before || !op.after || !op.after.sowOn || op.after.liveTray || op.before.date === op.after.date || op.before.sowOn !== op.after.sowOn) return op; const after = { ...op.after }; delete after.sowOn; return { ...op, after }; });
    if (!isSample()) ops = noted(ops);
    const plan = withOps(state.plan, ops, 'do'), engine = E.create(plan, Lib);
    const no = options.unchecked ? null : Rails.refusal(state.engine, engine, touched(ops, engine));
    if (no) { const text = refusalText(no, engine); state.last = { kind: 'refused', text, at: Date.now() }; toast(text); emit('refused'); return false; }
    const step = { label, ops };
    state.undo.push(step);
    if (state.undo.length > 200) state.undo.shift();
    state.redo.length = 0;
    // options.page: the change is answered by the page's own answer (a drop on the map or the timeline), so the panel that shows
    // what it changed does not say it again (L3, DESIGN.md rule 3)
    state.last = { kind: 'saved', label, at: Date.now(), step, page: !!options.page };
    adopt(plan, engine);
    return true;
  }
  /** A change turned down before it reached commit (the layout's own guard rail): said the same way, in a toast and in the panel. */
  function refuse(text) { state.last = { kind: 'refused', text, at: Date.now() }; toast(text); emit('refused'); return false; }
  /** The last change, as the panel says it: taken ("Saved", with its Undo while it is still the last step) or refused, and when. */
  function lastChange() {
    const l = state.last;
    if (!l) return null;
    return l.kind === 'saved' ? { kind: 'saved', label: l.label, at: l.at, canUndo: state.undo[state.undo.length - 1] === l.step, page: !!l.page } : { kind: 'refused', text: l.text, at: l.at };
  }
  /**
   * How a step is undone. While every record it touched is still as the step left it: as it was made ({ ops: the step's own }).
   * Once another device's changes have been taken in, a record may have moved on. Then only what the step itself changed is
   * taken back out of it, by the merge's own rules (the record after the step is the start, the record before it one side, the
   * record now the other): { ops, kept }, `kept` counting what stays as the other device left it. A step that recorded work or
   * seed is not taken out of a record that has moved on: null.
   */
  function undoWay(step) {
    const M = root.LRFMerge, plan = state.plan, lists = { bed: 'beds', garden: 'gardens', variety: 'varieties', crop: 'crops' };
    const whole = { assume: 'assumptions', settings: 'settings', map: 'map', inventory: 'seedInventory', trays: 'liveTrayPlans', nursery: 'nursery' };
    const listOf = op => lists[op.kind] || 'plantings';
    const now = op => (op.kind === 'own' ? (plan.lrfNext || {})[op.key] : whole[op.kind] ? plan[whole[op.kind]] : (plan[listOf(op)] || []).find(x => x.id === (op.after || op.before).id));
    const alike = (a, b) => (M ? M.same(a == null ? null : a, b == null ? null : b) : JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b));
    const left = op => (op.kind === 'map' ? op.after || {} : op.after);
    if (step.ops.every(op => alike(now(op), left(op)))) return { ops: step.ops, kept: 0 };
    if (!M || !M.joinOne) return null;
    const worked = p => JSON.stringify([(p && p.done) || null, (p && p.workflow) || null]);
    const ops = [], made = [];
    let kept = 0;
    for (const op of step.ops) {
      const is = now(op);
      if (!op.kind && op.before == null && is && is.liveTray && step.ops.some(o => o.kind === 'trays')) { made.push([op, is]); continue; }   // a batch of a demand plan the step changed: below
      if (alike(is, left(op))) { ops.push(op); continue; }
      if (op.kind === 'inventory' || (!op.kind && worked(op.before) !== worked(op.after))) return null;
      if (is == null || op.before == null || op.after == null) { kept++; continue; }   // made or taken out by the step, and changed or gone since: it stays as it is now
      const place = op.kind === 'own' ? 'lrfNext.' + op.key : whole[op.kind] || listOf(op) + '[]', joined = M.joinOne(place, op.after, op.before, is);
      kept += joined.items.length;
      if (!alike(joined.value, is)) ops.push({ ...op, before: joined.value, after: is });
    }
    // A weekly batch the step made follows its demand plan as the undo leaves it, as an unsown batch does whenever the demand
    // changes: it goes when that plan no longer lists its week, and stays when it does (another device may have widened the plan
    // further since). One the other device has changed goes only with nothing recorded on it; one with work recorded stays, as history.
    if (made.length) {
      const Trays = root.LRFTrays, back = ops.find(o => o.kind === 'trays'), plans = back ? back.before || [] : plan.liveTrayPlans || [];
      const listed = p => { const demand = plans.find(t => t.id === p.liveTray.planId); try { return !!demand && Trays.schedule(demand).batches.some(b => b.key === p.liveTray.key); } catch (_) { return false; } };
      // work can also be recorded in the records kept beside the plan (harvests, picks): read where they are loaded; where they are
      // kept and not loaded, nothing is taken out
      const kept0 = state.attic ? state.attic.rest || {} : ((plan.lrfNext || {}).attic || 'none') === 'none' ? {} : null, records = kept0 && { harvests: kept0.harvests, fieldRecords: kept0.fieldRecords };
      for (const [op, is] of made) if ((alike(is, left(op)) || (records && !Trays.locked(plan, is, records))) && !listed(is)) ops.push({ ...op, after: is }); else kept++;
    }
    return { ops, kept };
  }
  /** Take the last step back. `options.quiet`: the page that offered the Undo says so where it was pressed (N1), so no message. */
  function undo(options) {
    const quiet = !!options && options.quiet === true;
    if (elsewhere()) { refuse(elsewhere()); return; }
    const step = state.undo.pop();
    if (!step) return;
    const way = undoWay(step);
    if (!way) { state.undo.push(step); refuse(`“${step.label}” cannot be undone by itself: it recorded work or seed, and another device has changed the same records since. Take the work back where it was recorded.`); return; }
    state.last = null;
    if (way.ops === step.ops) state.redo.push(step); else state.redo.length = 0;   // a step taken out part by part is not one to do again whole
    const twiceWas = state.joined ? bookedTwice(state.engine) : 0;   // counted only once another device's changes are in: before that a step cannot undo into taken ground
    if (way.ops.length) adopt(withOps(state.plan, way.ops, 'undo'));
    if (state.sel && state.sel.type === 'planting' && !state.engine.planting(state.sel.id)) select(null);
    if (state.sel && state.sel.type === 'waiting' && !waitingOne(state.sel.id)) select(null);
    const more = state.joined ? Math.max(0, bookedTwice(state.engine) - twiceWas) : 0;
    if (more) { toast(`Undid: ${step.label}. Another device has planted that ground since: ${UI.num(more)} more to settle.`); return; }
    if (!quiet) toast(way.kept ? `Undid: ${step.label}. ${way.kept} part${way.kept === 1 ? '' : 's'} of it stay${way.kept === 1 ? 's' : ''} as another device changed ${way.kept === 1 ? 'it' : 'them'}.` : `Undid: ${step.label}`);
  }
  function redo() {
    if (elsewhere()) { refuse(elsewhere()); return; }
    const step = state.redo.pop();
    if (!step) return;
    state.last = null;
    state.undo.push(step); adopt(withOps(state.plan, step.ops, 'do'));
    if (state.sel && state.sel.type === 'waiting' && !waitingOne(state.sel.id)) select(null);
    toast(`Redid: ${step.label}`);
  }
  const changed = (record, change) => { const after = { ...record }; for (const [key, value] of Object.entries(change)) { if (value === undefined || value === null || value === '') delete after[key]; else after[key] = value; } return after; };
  function updatePlanting(id, change, label) {
    const before = state.engine.planting(id);
    return !!before && commit(label || 'Edit planting', [{ before, after: changed(before, change) }]);
  }
  function updateBeds(ids, change, label) {
    const ops = ids.map(id => state.engine.bedOf(id)).filter(Boolean).map(before => ({ kind: 'bed', before, after: changed(before, change) }));
    return commit(label || 'Edit bed', ops);
  }
  // ───────────────────── personal use or commercial ─────────────────────
  /**
   * Whom a planting is grown for: the farm's own table, or to sell. A flag, not a share. A planting follows its bed and a bed its
   * garden, so the word is kept only where it differs from what the record would follow. kind: 'planting' | 'bed' | 'garden'.
   * It moves no date and no yield: a personal planting is sown, grown and picked like any other, and is left out of revenue and
   * out of the list that is sent. What that does to the season's worth is said with the change.
   */
  function setUse(kind, ids, use) {
    const F = root.LRFForecast, eng = state.engine, want = use === 'personal' || use === 'commercial' ? use : null, ops = [];
    const find = id => kind === 'planting' ? eng.planting(id) : kind === 'bed' ? eng.bedOf(id) : (state.plan.gardens || []).find(g => g.id === id);
    for (const id of ids) {
      const before = find(id);
      if (!before) continue;
      const after = { ...before };
      delete after.use;
      if (want && want !== F.follows(eng, kind, after)) after.use = want;
      if ((before.use || null) !== (after.use || null)) ops.push(kind === 'planting' ? { before, after } : { kind, before, after });
    }
    if (!ops.length) return false;
    const first = ops[0].after, n = ops.length;
    const what = kind === 'planting' ? (n === 1 ? cropLabel(first) : `${n} plantings`) : kind === 'bed' ? (n === 1 ? bedLabel(first) : `${n} spaces`) : n === 1 ? first.name || 'Garden' : `${n} gardens`;
    const label = `${what}: ${want === 'personal' ? 'personal use' : want === 'commercial' ? 'commercial' : kind === 'planting' ? 'follows its bed' : 'follows its garden'}`;
    const engine = E.create(withOps(state.plan, ops, 'do'), Lib), worthOf = e => F.build(e).rows.reduce((sum, r) => sum + r.worth, 0), was = worthOf(eng), now = worthOf(engine);
    let out = 0, back = 0;
    for (const p of engine.plan.plantings) { const q = eng.planting(p.id), a = !!q && F.useOf(eng, q).personal, b = F.useOf(engine, p).personal; if (b && !a) out++; else if (a && !b) back++; }
    if (!commit(label, ops, { unchecked: true })) return false;
    const count = (k, words) => k ? `${k} planting${k === 1 ? '' : 's'} ${words}` : '';
    const moved = [count(out, `${out === 1 ? 'is' : 'are'} left out of revenue`), count(back, `${back === 1 ? 'counts' : 'count'} as revenue again`)].filter(Boolean).join(', ') || 'no planting changes';
    toast(`${label} · ${moved} · ${Math.abs(now - was) >= 0.5 ? `the season’s worth goes from ${dollars(was)} to ${dollars(now)}` : `the season’s worth stays ${dollars(now)}`}`, { label: 'Undo', run: undo });
    return { was, now, out, back };
  }
  // ───────────────────── which thing a planting is grown for ─────────────────────
  /**
   * Where two things come out of one bed of a crop, which of them one planting is grown for. value: 'first' (the crop's own
   * line and nothing else), a thing's id (that thing on the whole planting), or nothing (both, by the crop's shares, which is
   * what a planting does until it is told otherwise). It moves no date. What it does to the season's worth is said with it.
   */
  function setGives(id, value) {
    const F = root.LRFForecast, eng = state.engine, before = eng.planting(id);
    if (!before) return false;
    const beds = eng.thingsOf(before.cropId).filter(t => t.counts && t.from === 'bed'), want = value === 'first' || beds.some(t => t.id === value) ? value : null;
    if ((before.gives || null) === want) return false;
    const ops = [{ before, after: changed(before, { gives: want }) }], c = eng.crop(before.cropId), t = beds.find(x => x.id === want);
    const worthOf = e => F.build(e).rows.reduce((sum, r) => sum + r.worth, 0), was = worthOf(eng), now = worthOf(E.create(withOps(state.plan, ops, 'do'), Lib));
    const label = `${cropLabel(before)}: grown for ${want === 'first' ? `${c.name} only` : t ? `${t.name} only` : `both, by ${c.name}’s shares`}`;
    if (!commit(label, ops, { unchecked: true })) return false;
    toast(`${label} · ${worthSaid(was, now)} · no date moves`, { label: 'Undo', run: undo });
    return { was, now };
  }
  // ───────────────────── the year a cane stand was planted (E2c part 2) ─────────────────────
  /**
   * The year a stand of a perennial crop was planted (`plantedIn`), or nothing: a mature stand, as before. A young stand gives the
   * share of a mature stand's yield its crop's line gives for its season (engine.standAge). It moves no date. A year after the
   * one it is picked in is refused in a sentence. What it does to the season's worth is said with it, and one Undo takes it back.
   */
  function setPlantedIn(id, value) {
    const F = root.LRFForecast, eng = state.engine, before = eng.planting(id), r = before ? eng.calc(before) : null;
    if (!before || !r || !eng.isPerennial(r.c)) return false;
    const year = value == null || String(value).trim() === '' ? null : Math.round(+value), at = r.first.getFullYear();   // the planting's own first picking: a year saved never falls out of the box
    if (year != null && !(year >= 1900 && year <= at)) return refuse(`A stand picked in ${at} was planted in ${at} or before. Type a year up to ${at}, or empty the box for a mature stand.`);
    if ((Number.isInteger(before.plantedIn) ? before.plantedIn : null) === year) return false;
    const ops = [{ before, after: changed(before, { plantedIn: year }) }], next = E.create(withOps(state.plan, ops, 'do'), Lib);
    const worth = e => F.build(e).rows.reduce((sum, row) => sum + row.worth, 0), was = worth(eng), now = worth(next);
    const q = next.planting(id), age = next.standAge(q), y = next.yieldOf(q);
    const label = `${cropLabel(before)}, ${bedLabel(eng.bedOf(before.bedId))}: ${year == null ? 'year planted emptied' : `planted in ${year}`}`;
    const said = y && y.own ? 'its own yield stands' : !age || age.season >= 3 ? 'a mature stand' : age.season === 0 ? 'picked before it is planted: none counted' : `its ${age.season === 1 ? 'first' : 'second'} season, ${Math.round(age.share * 10) / 10}% of a mature stand’s yield`;
    if (!commit(label, ops, { unchecked: true })) return false;
    toast(`${label} · ${said} · ${worthSaid(was, now)} · no date moves`, { label: 'Undo', run: undo });
    return { was, now };
  }
  // ───────────────────────── assumptions ─────────────────────────
  // A change to the list, or to a garden's growing conditions, is a statement about the world, not
  // an edit to the plan. It is never refused. What it does to the plan is shown first when it would
  // book two crops into the same ground; those then wait on the overview under "To settle".
  function impact(before, after) {
    const pairs = eng => { const set = new Set(); for (const p of eng.plan.plantings) { const r = eng.calc(p); if (r) for (const o of eng.conflicts(p, r)) if (!o.rest) set.add([p.id, o.p.id].sort().join('|')); } return set; };
    let changed = 0, later = 0, sooner = 0, most = 0;
    const byCrop = new Map();
    for (const p of after.plan.plantings) {
      const a = after.calc(p), q = before.planting(p.id), b = q && before.calc(q);
      if (!a || !b) continue;
      const shift = E.dayDiff(a.first, b.first);
      if (shift || +a.last !== +b.last) { changed++; const row = byCrop.get(p.cropId) || { cropId: p.cropId, n: 0, shifts: [] }; row.n++; row.shifts.push(shift); byCrop.set(p.cropId, row); }
      if (shift > 0) later++; else if (shift < 0) sooner++;
      if (Math.abs(shift) > Math.abs(most)) most = shift;
    }
    const was = pairs(before), now = pairs(after), worthOf = eng => root.LRFForecast.build(eng).rows.reduce((n, r) => n + r.worth, 0);
    return { changed, later, sooner, most, overlaps: [...now].filter(k => !was.has(k)).length, settled: [...was].filter(k => !now.has(k)).length, byCrop: [...byCrop.values()], worth: [worthOf(before), worthOf(after)] };
  }
  const dollars = n => '$' + Math.round(n).toLocaleString('en-US');
  /** `options.shown`: whoever called has shown what the step does, worth and ground booked twice included, and he agreed. */
  async function assume(label, ops, options = {}) {
    const plan = withOps(state.plan, ops, 'do'), engine = E.create(plan, Lib), hit = impact(state.engine, engine);
    const moves = hit.changed && !hit.most ? `${hit.changed} planting${hit.changed === 1 ? ' ends its' : 's end their'} harvest on another day` : hit.changed ? `${hit.changed} planting${hit.changed === 1 ? '' : 's'} ${hit.later && hit.sooner ? 'shift' : hit.later ? 'harvest later' : 'harvest sooner'}, by up to ${Math.abs(hit.most)} day${Math.abs(hit.most) === 1 ? '' : 's'}` : 'No planting’s dates change';
    const line = row => { const c = engine.crop(row.cropId), lo = Math.min(...row.shifts), hi = Math.max(...row.shifts), days = lo === hi ? Math.abs(hi) : `${Math.min(Math.abs(lo), Math.abs(hi))} to ${Math.max(Math.abs(lo), Math.abs(hi))}`; return UI.h('li', UI.h('b', c ? c.name : 'Crop'), ` ${row.n} planting${row.n === 1 ? '' : 's'}, ${lo === 0 && hi === 0 ? 'harvest ends on another day' : `${days} day${hi === 1 || hi === -1 ? '' : 's'} ${lo < 0 && hi > 0 ? 'either way' : hi > 0 ? 'later' : 'sooner'}`}`); };
    const detail = hit.changed ? UI.h('ul.moves', { id: 'assumeMoves' }, hit.byCrop.sort((a, b) => b.n - a.n).map(line)) : null;
    // what the change does to the season's worth, and to ground booked twice, is said with it
    const worth = Math.abs(hit.worth[1] - hit.worth[0]) >= 0.5 ? `the season’s worth goes from ${dollars(hit.worth[0])} to ${dollars(hit.worth[1])}` : options.shown ? `the season’s worth stays ${dollars(hit.worth[0])}` : '';
    const settles = hit.settled ? `${hit.settled} double booking${hit.settled === 1 ? ' is' : 's are'} settled` : '';
    const also = [worth, settles].filter(Boolean).join(' · ');
    if (hit.overlaps && !options.shown) {
      const ok = await UI.confirm({ title: label, confirmLabel: 'Apply', body: `${moves}. ${hit.overlaps} pair${hit.overlaps === 1 ? '' : 's'} of plantings would then be booked into the same ground. They are not refused, because the plan was only ever as good as the number. They will wait on the overview under “To settle”.${also ? ' Also: ' + also + '.' : ''}`, detail });
      if (!ok) return false;
    } else if (options.ask && hit.changed && !options.shown) {
      // Several lines of the list changed at once: say what moves before it does.
      if (!await UI.confirm({ title: label, confirmLabel: 'Apply', body: `${moves}. No new double bookings. One undo takes it all back.`, detail })) return false;
    }
    commit(label, ops, { unchecked: true });
    // `options.more` and `options.offers`: what else is so after the step, and what can be done about it from the answer (L3)
    toast(`${label} · ${hit.changed || !also ? moves.charAt(0).toLowerCase() + moves.slice(1) : ''}${hit.changed && also ? ' · ' : ''}${also}${options.more ? ' · ' + options.more : ''}`, [{ label: 'Undo', run: undo }, ...(options.offers || [])]);
    return true;
  }
  const blankList = () => ({ v: 1, crops: {}, varieties: {} });
  const emptyList = a => !['crops', 'varieties', 'starts', 'sell', 'sellV', 'nursery'].some(k => a[k] && Object.keys(a[k]).length);
  /** One change to the list, as a step: `edit` is handed a copy to change. Empty groups are dropped, and an empty list is no list. */
  function listStep(edit) {
    const current = state.plan.assumptions || null, next = current ? clone(current) : blankList();
    edit(next);
    for (const k of ['starts', 'sell', 'sellV', 'nursery']) if (next[k] && !Object.keys(next[k]).length) delete next[k];
    if (JSON.stringify(next) === JSON.stringify(current || blankList())) return null;
    return [{ kind: 'assume', before: current, after: emptyList(next) ? null : next }];
  }
  /** Set one figure in a cell of the list (days, or a yield), leaving what else the cell holds. No value clears it. */
  function setCell(next, kind, id, env, field, value) {
    next[kind] = next[kind] || {};
    const record = { ...(next[kind][id] || {}) }, cell = { ...(record[env] || {}) };
    if (value == null) delete cell[field]; else cell[field] = value;
    if (Object.keys(cell).length) record[env] = cell; else delete record[env];
    if (Object.keys(record).length) next[kind][id] = record; else delete next[kind][id];
  }
  /** Set, or with no days clear, the grower's days to harvest for a crop or variety in one growing condition. */
  function setAssumption(kind, id, env, days, label) {
    const ops = listStep(next => setCell(next, kind, id, env, 'dtm', days > 0 ? Math.round(days) : null));
    return ops ? assume(label, ops, kind === 'crops' && days > 0 ? keptOwn(id, env, Math.round(days), label, ops) : {}) : Promise.resolve(false);
  }
  /**
   * His own days typed for a crop do not reach a planting whose variety has days of its own there (its row on the list, or the
   * supplier's figure), nor one that carries its own. The answer says so, and offers to set those varieties to the same days, as
   * a step of its own with its own Undo, and to see the plantings that differ from the list (L3). { more, offers }, or {}.
   */
  function keptOwn(cropId, env, days, label, ops) {
    const eng = E.create(withOps(state.plan, ops, 'do'), Lib), kept = new Map();
    let own = 0;
    for (const p of eng.plan.plantings) {
      const b = p.cropId === cropId ? eng.bedOf(p.bedId) : null, x = b && eng.envOf(b) === env ? eng.effective(p) : null;
      if (!x) continue;
      if (eng.pinned(p)) { own++; continue; }
      const v = eng.variety(p.varietyId);
      if (!(x.assumed && x.assumed.level === 'crop') && v && v.cropId === cropId) kept.set(v.id, v);
    }
    if (!kept.size && !own) return {};
    const list = [...kept.values()], n = list.length, offers = [];
    const see = root.LRFAssume && root.LRFAssume.openDiffer ? { label: 'See the plantings', run: () => root.LRFAssume.openDiffer() } : null;
    // the varieties' days are a step of their own: what it moves is shown first (`ask`), and its answer still offers the plantings (Codex on #93)
    if (n) offers.push({ label: `Set its ${n === 1 ? 'variety' : `${n} varieties`} too`, run: () => {
      const more = listStep(next => { for (const v of list) setCell(next, 'varieties', v.id, env, 'dtm', days); });
      if (more) assume(`${label}, for ${names(list.map(v => v.name))} too`, more, { ask: true, offers: see ? [see] : [] });
    } });
    if (see) offers.push(see);
    const said = [n ? `${names(list.map(v => v.name))} keep${n === 1 ? 's' : ''} days of ${n === 1 ? 'its' : 'their'} own` : '', own ? `${UI.num(own)} planting${own === 1 ? ' keeps its' : 's keep their'} own` : ''];
    return { more: said.filter(Boolean).join(' · '), offers };
  }
  // ── the second half of the list: what a crop is sold as, how it is picked, what it yields ──
  const figure3 = x => Math.round(x * 1000) / 1000;
  /** Set, or with null clear, a yield for a crop or variety in one growing condition. It is in the crop's pattern: a total, or a week's picking. */
  function setYield(kind, id, env, value, label, how) {
    const ops = yieldOps(kind, id, env, value, how);
    return ops ? assume(label, ops, how && how.shown ? { shown: true } : {}) : Promise.resolve(false);
  }
  /**
   * The step setYield makes, not yet taken (E2d). `how`, from the card's box, for a crop's own figure only: { rows } the rows of the bed the figure was typed for, or
   * { inRow } the spacing in the row a plant's figure was typed at; the figure is then kept to six places, since it was typed for a
   * whole bed and divided by its length. Without `how` the figure alone changes if it already had a yield.
   * Clearing a yield or replacing one cleared by an older device also clears its rows or spacing.
   */
  function yieldOps(kind, id, env, value, how) {
    if (kind !== 'crops') how = undefined;   // only a crop's own figure says rows or a spacing: a variety's is as it was (Codex on #92)
    const none = value == null || value === '' || !(+value >= 0), whole = v => Number.isSafeInteger(v) && v >= 1 ? v : null, inches = v => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    return listStep(next => {
      const was = next[kind]?.[id]?.[env]?.yield;
      const hadYield = was != null && was !== '' && Number.isFinite(+was) && +was >= 0;
      setCell(next, kind, id, env, 'yield', none ? null : how ? Math.round(+value * 1e6) / 1e6 : figure3(+value));
      if (none || how || !hadYield) {
        const rows = none || !how ? null : whole(how.rows);
        setCell(next, kind, id, env, 'rows', rows);
        setCell(next, kind, id, env, 'inRow', none || !how || rows ? null : inches(how.inRow));
      }
    });
  }
  /**
   * Change a crop's line: `change` may hold unit, price, pattern, days, keep, share, turnover, until and young; a null goes back to the default.
   * Changing between a weekly figure and a total turns the yields already typed for the crop and its varieties into the other,
   * over the crop's harvest days, so the choice of words does not by itself change what is forecast.
   */
  function setSell(cropId, change, label, options) {
    const ops = sellOps(cropId, change);
    return ops ? thingsFirst(cropId, label, ops, options).then(ok => ok ? assume(label, ops, options) : false) : Promise.resolve(false);
  }
  /**
   * The step setSell makes, not yet taken: for the call itself, and for whoever has to say first what it would do. `days: 'season'`
   * is the harvest choice's other side (js/yieldcard.js): the crop is picked to the season's end. The list's days are cleared, and
   * where the crop's own record is picked for a set number of days, that record says "to the season's end" instead (`harvestMode`,
   * the field the engine already reads), in the same step.
   */
  function sellOps(cropId, change) {
    const eng = state.engine, season = change && change.days === 'season';
    if (season) change = { ...change, days: null };
    const list = sellList(cropId, change), c = season ? eng.crop(cropId) : null;
    if (!c || c.harvestMode === 'season') return list;
    const own = (state.plan.crops || []).find(x => x.id === cropId) || null;
    return [...(list || []), { kind: 'crop', before: own, after: { ...(own || { id: cropId }), harvestMode: 'season' } }];
  }
  function sellList(cropId, change) {
    const eng = state.engine, before = eng.harvestFor(cropId);
    return listStep(next => {
      next.sell = next.sell || {};
      const record = { ...(next.sell[cropId] || {}) };
      for (const key of ['unit', 'price', 'pattern', 'days', 'keep', 'share', 'turnover']) {
        if (!(key in change)) continue;
        const v = change[key];
        if (v == null || v === '') delete record[key];
        else record[key] = key === 'unit' || key === 'pattern' ? String(v) : key === 'days' ? Math.max(1, Math.round(+v)) : key === 'turnover' ? Math.max(0, Math.round(+v)) : key === 'share' ? Math.min(100, Math.max(0, +v)) : Math.max(0, +v);
      }
      // a young stand's shares (E2c part 2): `young` is [the year it is planted, the year after], each a percent or null (back to
      // the published figure); two nulls, or a null `young`, clear them
      if ('young' in change) {
        const y = [0, 1].map(i => { const n = Array.isArray(change.young) ? change.young[i] : null; return n == null || n === '' || !Number.isFinite(+n) ? null : figure3(Math.min(100, Math.max(0, +n))); });
        if (y.some(n => n != null)) record.young = y; else delete record.young;
      }
      // a last picking for a place: `until` is { place: 'MM-DD' }, or null for a place to go back to the season's end there
      if (change.until && typeof change.until === 'object') {
        const until = { ...(record.until || {}) };
        for (const [env, md] of Object.entries(change.until)) { if (!eng.ENVS.includes(env)) continue; if (typeof md === 'string' && /^\d{2}-\d{2}$/.test(md) && E.validDate(E.s2d('2000-' + md))) until[env] = md; else delete until[env]; }
        if (Object.keys(until).length) record.until = until; else delete record.until;
      }
      // A tick says the crop's figures were looked at in the unit it was then sold by. With another unit they are to be looked
      // at again: the figures stay as typed, and the tick comes off in the same step.
      if ('unit' in change && before && before.unit.value !== (record.unit || before.unit.fallback)) delete record.looked;
      if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];
      const weekly = (record.pattern || 'spread') === 'weekly';
      if (before && 'pattern' in change && weekly !== before.weekly) {
        const turn = y => figure3(weekly ? y * 7 / before.nominal : y * before.nominal / 7), mine = new Set(eng.varietiesOf(cropId).map(v => v.id));
        for (const [kind, ids] of [['crops', [cropId]], ['varieties', Object.keys(next.varieties || {}).filter(id => mine.has(id))]])
          for (const id of ids) for (const [env, cell] of Object.entries((next[kind] || {})[id] || {})) if (cell && cell.yield != null) next[kind][id][env] = { ...cell, yield: turn(+cell.yield) };
      }
    });
  }
  /** A variety's own unit or price: `change` may hold unit and price; a null goes back to the crop's. */
  function setSellV(varietyId, change, label) {
    const v = state.engine.variety(varietyId), ops = listStep(next => {
      next.sellV = next.sellV || {};
      const record = { ...(next.sellV[varietyId] || {}) };
      for (const key of ['unit', 'price']) { if (!(key in change)) continue; const v = change[key]; if (v == null || v === '') delete record[key]; else record[key] = key === 'unit' ? String(v) : Math.max(0, +v); }
      if (Object.keys(record).length) next.sellV[varietyId] = record; else delete next.sellV[varietyId];
    });
    // a variety sold by a unit of its own is counted as that variety is sold, whole: its plantings leave the crop's other things
    return ops ? thingsFirst(v ? v.cropId : '', label, ops).then(ok => ok ? assume(label, ops) : false) : Promise.resolve(false);
  }
  // ── what is kept for personal use, and what has been looked at ──
  // Two marks on a crop's line of the list, beside the figures they speak of, and one switch in the farm's settings. None of the
  // three is a figure. A mark moves nothing by itself; the switch, and saying a crop is sold in full, change what counts as sold,
  // so what either does to the season's worth is shown before it is done.
  /** One crop's line with a mark set (`house`: true, `looked`: a year) or, with nothing, taken off. */
  const markStep = (cropId, key, value) => listStep(next => {
    next.sell = next.sell || {};
    const record = { ...(next.sell[cropId] || {}) };
    if (value == null || value === false) delete record[key]; else record[key] = value;
    if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];
  });
  /**
   * Tick a crop as looked at for the plan's year, or take the tick off. One step, and nothing else in the plan changes. The tick
   * is said in a message of its own, whose Undo takes back the tick and nothing before it; `note` is added to what it says.
   */
  function setLooked(cropId, on, note) {
    const c = state.engine.crop(cropId), year = planYear(), ops = c ? markStep(cropId, 'looked', on ? year : null) : null;
    if (!ops) return false;
    const label = `${c.name}: ${on ? 'looked at' : 'not looked at'} for ${year}`;
    if (!commit(label, ops, { unchecked: true })) return false;
    toast(`${label}${note ? ' · ' + note : ''}`, { label: 'Undo', run: undo });
    return true;
  }
  /**
   * N1: the tick of Assumptions › Starting and nursery, apart from the tick of Yield and price (assumptions.nursery.<crop>.looked:
   * the plan's year). One step; nothing else in the plan changes. Answered on the card it was pressed on, so no message is shown.
   */
  function setStartLooked(cropId, on) {
    const c = state.engine.crop(cropId), year = planYear();
    const ops = c ? listStep(next => {
      next.nursery = next.nursery || {};
      const record = { ...(next.nursery[cropId] || {}) };
      if (on) record.looked = year; else delete record.looked;
      if (Object.keys(record).length) next.nursery[cropId] = record; else delete next.nursery[cropId];
    }) : null;
    return !!ops && commit(`${c.name}: ${on ? 'started as said' : 'starting not looked at'} for ${year}`, ops, { unchecked: true, page: true });
  }
  /**
   * N1: one change to how a crop is started (a crop's, a variety's or the farm's figures), as one step with one Undo. The card that
   * made it has already said what it moves, under the box, so the step is answered there: no message, no window.
   */
  function setStarting(label, ops) { return commit(label, ops, { unchecked: true, page: true }); }
  /**
   * Say whom a crop is grown for. `part` true: for sale and personal use, which marks the crop and changes no figure. `part` false:
   * sold in full, which counts all that is packed as sold; what that does to the season's worth is shown first, and it is done
   * only if he agrees.
   */
  async function setHouse(cropId, part) {
    const eng = state.engine, c = eng.crop(cropId), hc = c ? eng.harvestFor(cropId) : null;
    if (!hc || hc.micro || !hc.house.farm) return false;
    if (part) {
      const ops = hc.house.marked ? null : markStep(cropId, 'house', true);
      if (!ops) return false;
      commit(`${c.name}: grown for sale and personal use`, ops, { unchecked: true });
      toast(`${c.name}: grown for sale and personal use · no figure changes: ${figure3(hc.house.sold)}% of what is packed counts as sold, as before`, { label: 'Undo', run: undo });
      return true;
    }
    const ops = listStep(next => { next.sell = next.sell || {}; const record = { ...(next.sell[cropId] || {}), share: 100 }; delete record.house; next.sell[cropId] = record; });
    if (!ops) return false;
    const was = worthOf(eng), now = worthOf(E.create(withOps(state.plan, ops, 'do'), Lib)), label = `${c.name}: sold in full`;
    if (hc.house.sold < 100 && !await UI.confirm({ title: `${c.name}: sold in full?`, confirmLabel: 'Sold in full',
      body: `Today ${figure3(hc.house.sold)}% of what is packed counts as sold, and the other ${figure3(100 - hc.house.sold)}% is for personal use. Sold in full, all of it counts as sold: ${worthSaid(was, now)}. No date and no yield changes, and one undo takes it back.` })) return false;
    commit(label, ops, { unchecked: true });
    toast(`${label} · ${worthSaid(was, now)}`, { label: 'Undo', run: undo });
    return { was, now };
  }
  /**
   * The farm's own switch. Off: nothing is kept for personal use, every crop is sold in full whatever its line says, and the idea is
   * shown on no page. On: each crop's own share counts again. Either way the season's worth before and after is shown first.
   */
  async function setHouseFarm(on) {
    const settings = { ...state.plan.settings }, isOn = settings.houseKeeps !== false;
    if (!!on === isOn) return false;
    if (on) delete settings.houseKeeps; else settings.houseKeeps = false;
    const was = worthOf(state.engine), now = worthOf(E.create({ ...state.plan, settings }, Lib));
    const ok = await UI.confirm(on
      ? { title: 'Keep part of some crops for personal use?', confirmLabel: 'Turn it on', body: `Each crop’s own share counts again: what its line says is sold, and the rest is for personal use. ${worthSaid(was, now).replace(/^t/, 'T')}. No date and no yield changes, and one undo takes it back.` }
      : { title: 'Everything this farm packs is sold?', confirmLabel: 'Sell everything', body: `Nothing is kept for personal use: every crop counts as sold in full, and what is kept for personal use is shown on no page. Each crop’s own share is kept as it is, for the day this is turned on again. ${worthSaid(was, now).replace(/^t/, 'T')}. No date and no yield changes, and one undo takes it back.` });
    if (!ok) return false;
    const label = on ? 'Part of some crops is for personal use' : 'Everything the farm packs is sold';
    if (!commit(label, [{ kind: 'settings', before: state.plan.settings, after: settings }], { unchecked: true })) return false;
    toast(`${label} · ${worthSaid(was, now)}`, { label: 'Undo', run: undo });
    return { was, now };
  }
  // ── more than one thing sold from a crop ──
  // A crop's own line is the first thing it sells. Each other thing is a record inside that line, with an id of its own that never
  // changes (engine.thingsOf says what each holds). A thing counts for nothing until every figure it needs is there, so adding
  // one, or filling a box of one that still waits on another, moves nothing. A change that would move the forecast (the thing
  // becomes complete, stops being complete, or counts differently) says what it does to the season's worth first and is made only
  // if the grower agrees: one step, one undo.
  const THING_UNITS = ['each', 'bunch', 'lb', 'pint', 'quart', 'clamshell', 'head', 'stem', 'bouquet'];
  const thingStep = (cropId, edit) => listStep(next => {
    next.sell = next.sell || {};
    const record = { ...(next.sell[cropId] || {}) }, things = { ...(record.things || {}) };
    edit(things, record);
    if (Object.keys(things).length) record.things = things; else delete record.things;
    if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];
  });
  const aOne = unit => unit === 'each' ? 'one' : `a ${unit}`;
  /** The season's worth before and after, with the difference in words: "goes from $96,997 to $96,872: $125 less". */
  const worthTold = (was, now) => `${worthSaid(was, now)}${Math.abs(now - was) >= 0.5 ? `: ${dollars(Math.abs(now - was))} ${now > was ? 'more' : 'less'}` : ''}`;
  /**
   * A window that asks before something is done to what a thing counts as. It opens with the button that agrees in focus, so
   * that Enter after a figure takes the figure; Escape and Cancel leave everything as it was.
   */
  function askFirst({ title, body, confirmLabel = 'Apply' }) {
    return new Promise(resolve => {
      const done = value => { dialog.close(); dialog.remove(); resolve(value); };
      const yes = UI.h('button.btn.primary', { type: 'button', onclick: () => done(true) }, confirmLabel);
      const dialog = UI.h('dialog.dialog', { dataset: { ask: 'things' }, oncancel: e => { e.preventDefault(); done(false); } }, UI.h('h2', title), UI.h('p', body),
        UI.h('div.dialog-actions', UI.h('button.btn', { type: 'button', onclick: () => done(false) }, 'Cancel'), yes));
      document.body.append(dialog); dialog.showModal(); yes.focus();
    });
  }
  /** The plantings a thing is, or would be, fed by: those of its crop that follow the crop's line, in its place if it has one. */
  function thingPlantings(eng, cropId, t) {
    const taken = new Set(eng.thingsOf(cropId).filter(x => x.counts && x.from === 'place').map(x => x.place)), out = [];
    for (const p of state.plan.plantings) {
      if (p.cropId !== cropId) continue;
      const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null, v = eng.variety(p.varietyId), env = r ? eng.envOf(r.b) : null;
      if (!y || y.own || (r.rack && r.c.micro) || (v && v.cropId === cropId && eng.sellVRule(v.id).unit)) continue;
      if (t.from === 'place' ? env === t.place : !taken.has(env)) out.push(r);
    }
    return out;
  }
  /**
   * What a step on a crop's own line, or on one of its varieties, would do to the other things the crop sells: null when it
   * leaves each as it is. Else { said, was, now }: which thing would stop being counted, start, or be fed by other plantings,
   * what the plan counts before and after, and the season's worth before and after.
   */
  function thingsAfter(cropId, ops) {
    const eng = state.engine, F = root.LRFForecast;
    if (!ops || !cropId || !eng.thingsOf(cropId).length) return null;
    const next = E.create(withOps(state.plan, ops, 'do'), Lib), rows = e => new Map(F.build(e).rows.filter(r => r.cropId === cropId && r.thing).map(r => [r.thing, r.plantings.length]));
    const a = rows(eng), b = rows(next), then = new Map(next.thingsOf(cropId).map(t => [t.id, t])), says = [];
    for (const t of eng.thingsOf(cropId)) {
      const t2 = then.get(t.id);
      if (!t2) continue;
      if (t.counts && !t2.counts) says.push(`${t.name} would no longer be counted: ${t2.waits.length ? `it would wait on ${thingWaits(t2).join(', ')}, typed again for the new unit` : thingWhy(t2)}.`);
      else if (!t.counts && t2.counts) says.push(`${t.name} would be counted from then on.`);
      else if ((a.get(t.id) || 0) !== (b.get(t.id) || 0)) says.push(`${t.name} would be fed by ${b.get(t.id) || 0} planting${(b.get(t.id) || 0) === 1 ? '' : 's'}, not ${a.get(t.id) || 0}.`);
    }
    if (!says.length) return null;
    const was = worthOf(eng), now = worthOf(next), before = linesOf(eng, cropId), after = linesOf(next, cropId);
    return { was, now, said: `${says.join(' ')} Today the plan counts ${before.said}. Then: ${after.said}. ${worthTold(was, now).replace(/^t/, 'T')}.` };
  }
  /** Ask before a step that would change what a thing counts as. `options.told`: whoever called has said it already. */
  async function thingsFirst(cropId, label, ops, options) {
    const hit = options && options.told ? null : thingsAfter(cropId, ops);
    return !hit || askFirst({ title: label, confirmLabel: 'Apply', body: `${hit.said} No date changes, and one undo takes it back.` });
  }
  /** The figures a thing still waits on, each in a few words. */
  function thingWaits(t) {
    const say = { price: 'its price', share: t.from === 'bed' ? 'its share of each bed' : 'its share of the harvest', yield: 'its yield',
      weighs: `what ${aOne(t.from === 'harvest' ? t.source : t.counted || t.source)} weighs`, holds: `what ${aOne(t.unit)} holds` };
    return t.waits.map(key => say[key] || key);
  }
  /** Why a thing that has every figure is still not counted. */
  const thingWhy = t => t.why === 'taken' ? 'another thing is already sold from that place' : t.why === 'over' ? 'the shares come to more than 100' : t.why === 'place' ? 'it has no place' : '';
  /** A crop's lines of the forecast, as they are said in a window: "Carrots 233 bunches, Carrots · Babies 27 lb". */
  const linesOf = (eng, cropId) => { const F = root.LRFForecast, rows = F.build(eng).rows.filter(r => r.cropId === cropId && r.total > 0); return { rows, said: rows.length ? rows.map(r => `${r.name} ${F.amount(r.total, r.unit, r.group)}`).join(', ') : 'nothing' }; };
  const sameLines = (a, b) => a.length === b.length && a.every((r, i) => r.key === b[i].key && Math.abs(r.total - b[i].total) <= 1e-9 * Math.max(1, r.total) && Math.abs(r.worth - b[i].worth) <= 1e-9 * Math.max(1, r.worth));
  /**
   * Add something else a crop sells: input { name, from: 'place' | 'bed' | 'harvest', place, unit }. It is added empty, so it counts
   * for nothing and the forecast is what it was: the message says so, and what the thing waits on. Returns its id.
   */
  function addThing(cropId, input = {}) {
    const eng = state.engine, c = eng.crop(cropId), hc = c ? eng.harvestFor(cropId) : null;
    if (!hc || hc.micro || eng.isCoverCrop(c)) return false;
    const from = ['place', 'bed', 'harvest'].includes(input.from) ? input.from : null, name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 40), unit = String(input.unit || '').trim() || hc.unit.value, have = eng.thingsOf(cropId);
    if (!from || !name) return false;
    if (name.toLowerCase() === String(c.name).toLowerCase() || have.some(t => t.name.toLowerCase() === name.toLowerCase())) return refuse(`${c.name} already sells something called ${name}. Give this one another name.`);
    if (from === 'place' && (!eng.ENVS.includes(input.place) || have.some(t => t.from === 'place' && t.place === input.place))) return refuse('Another thing is already sold from that place.');
    const id = 't-' + uid(), record = { id, n: have.reduce((m, t) => Math.max(m, t.n), 0) + 1, name, from, unit };
    if (from === 'place') record.place = input.place;
    // sold by weight where the crop itself is counted: its yield is typed in what is counted, and the helper row gives the weight
    if (from !== 'harvest' && eng.WEIGHED.includes(unit) && eng.COUNTED.includes(hc.unit.value)) record.counted = hc.unit.value;
    const ops = thingStep(cropId, things => { things[id] = record; }), worth = worthOf(eng), label = `${c.name}: ${name} added as something else it sells`;
    if (!ops || !commit(label, ops, { unchecked: true })) return false;
    const t = state.engine.thingsOf(cropId).find(x => x.id === id);
    toast(`${label} · not counted yet: it waits on ${thingWaits(t).join(', ')} · the season’s worth stays ${dollars(worth)}`, { label: 'Undo', run: undo });
    return id;
  }
  /**
   * Change one thing a crop sells. `change` may hold name, unit, price, pattern, days, before, share, yield and helper (the helper row's
   * figure: what one counted thing weighs, or what one of this holds); a null empties the box. A share is held to what the other
   * things of its kind leave of 100, and harvest days to what its plantings have. A window asks first, with the season's worth
   * before and after, when the thing would start counting, stop counting, or be sold by another unit (which keeps every figure
   * as typed and takes the crop's tick off). A figure changed on a thing that already counts is applied at once, as a crop's
   * own boxes are, with a message that gives the worth before and after and an Undo. `options.asked(yes)` is told how a
   * window was answered. Returns { was, now, counts } or false.
   */
  async function setThing(cropId, id, change, label, options = {}) {
    const eng = state.engine, c = eng.crop(cropId), hc = c ? eng.harvestFor(cropId) : null, all = c ? eng.thingsOf(cropId) : [], t = all.find(x => x.id === id);
    if (!t) return false;
    const year = planYear(), one = n => Math.round(n * 1000) / 1000;
    if ('share' in change && change.share != null) {
      const others = all.filter(x => x.from === t.from && x.id !== id).reduce((n, x) => n + (x.share || 0), 0), want = +change.share;
      if (!(want >= 0) || want > 100) return refuse('A share is 0 to 100.');
      if (want + others > 100 + 1e-9) return refuse(`${t.from === 'bed' ? 'Shares of each bed' : 'Shares of the harvest'} add up to 100 with ${c.name}’s own: ${others > 0 ? `the others take ${one(others)}, so ` : ''}at most ${one(100 - others)} can go to ${t.name}.`);
    }
    if ('name' in change) {
      const name = String(change.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!name) return false;
      if (name.toLowerCase() === String(c.name).toLowerCase() || all.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return refuse(`${c.name} already sells something called ${name}. Give this one another name.`);
    }
    if ('before' in change && change.before != null) {
      // first picked before the crop's days to harvest (E2c part 2): never before a planting it comes from is in its bed, so that
      // the number means the same in every bed
      // only the plantings that give it, as soldOf gives them: one grown for the crop alone, or for another thing, is not (Codex on #83)
      // a `gives` that names no thing in force (taken away, or not counted yet) is nothing said, as soldOf reads it: both, by shares
      // (#84: eng.grownFor, the one reading soldOf and standYear make too)
      const gives = r => { const g = eng.grownFor(r.planting); return t.from !== 'bed' || (g !== 'first' && (!g || g === t.id)); };
      const want = Math.round(+change.before), fed = t.from === 'harvest' ? [] : thingPlantings(eng, cropId, t).filter(r => r.harvestDays > 0 && gives(r));
      const room = fed.length ? Math.min(...fed.map(r => E.dayDiff(r.first, r.field) - 1)) : null, tight = room == null ? null : fed.find(r => E.dayDiff(r.first, r.field) - 1 === room);
      if (t.from === 'harvest') return refuse(`${t.name} is packed from ${c.name}’s harvest, so it is picked when ${c.name} is.`);
      if (!(want >= 1)) return refuse('Days before are a whole number from 1. Empty the box to pick it with the crop.');
      if (room != null && want > room) return refuse(`${t.name} cannot be first picked ${want} days before ${c.name}: ${cropLabel(tight.planting)} in ${bedLabel(tight.b)} goes into its bed only ${room + 1} days before its days to harvest. Type ${Math.max(1, room)} or fewer, or empty the box to pick it with ${c.name}.`);
    }
    if ('days' in change && change.days != null && t.from !== 'harvest') {
      // a thing is never picked after its planting's last picking: more days than its plantings have would only cut what it counts as
      const fed = thingPlantings(eng, cropId, t), longest = fed.length ? Math.max(...fed.map(r => r.harvestDays + eng.aheadOf(t, r))) : null, want = Math.round(+change.days);
      if (longest != null && want > longest) return refuse(`${t.name} cannot be picked for ${want} days: the plantings it comes from are picked for ${longest} day${longest === 1 ? '' : 's'} at the most, and a thing is never picked after its planting’s last picking. Type ${longest} or fewer, or empty the box to pick it as long as ${c.name}.`);
    }
    const unitTo = 'unit' in change && change.unit && String(change.unit) !== t.unit ? String(change.unit) : null;
    const ops = thingStep(cropId, (things, record) => {
      const x = { ...things[id] }, put = (key, v) => { if (v == null || v === '' || !Number.isFinite(+v)) delete x[key]; else x[key] = +v; };
      if ('name' in change) x.name = String(change.name).trim().replace(/\s+/g, ' ').slice(0, 40);
      if ('price' in change) put('price', change.price == null ? null : Math.max(0, +change.price));
      if ('share' in change) put('share', change.share == null ? null : Math.min(100, Math.max(0, +change.share)));
      if ('yield' in change) put('yield', change.yield == null || change.yield === '' ? null : figure3(Math.max(0, +change.yield)));
      if ('days' in change) put('days', change.days == null ? null : Math.max(1, Math.round(+change.days)));
      if ('before' in change && t.from !== 'harvest') put('before', change.before == null ? null : Math.max(1, Math.round(+change.before)));
      if ('helper' in change) {
        const v = change.helper == null || !(+change.helper > 0) ? null : +change.helper;
        if (t.from !== 'harvest') put('weighs', v);
        else { delete x.holds; delete x.weighs; delete x.of; if (v != null) { x[t.way] = v; x.of = t.source; } }   // typed against the unit the crop is sold by today
      }
      if ('pattern' in change) {
        const to = eng.PATTERNS.includes(change.pattern) ? change.pattern : null, weekly = (to || 'spread') === 'weekly', nominal = t.days || hc.nominal;
        if (to) x.pattern = to; else delete x.pattern;
        // as for a crop's own line: between a week's picking and a total the yield typed is turned into the other, over its harvest days
        if (weekly !== (t.pattern === 'weekly') && x.yield != null) x.yield = figure3(weekly ? x.yield * 7 / nominal : x.yield * nominal / 7);
      }
      if (unitTo) {
        x.unit = unitTo;
        if (t.from !== 'harvest') { if (eng.WEIGHED.includes(unitTo) && eng.COUNTED.includes(hc.unit.value)) x.counted = x.counted || hc.unit.value; else delete x.counted; }
        delete record.looked;   // looked at in the unit it was then sold by: to be looked at again
      }
      things[id] = x;
    });
    if (!ops) return false;
    const next = E.create(withOps(state.plan, ops, 'do'), Lib), t2 = next.thingsOf(cropId).find(x => x.id === id), before = linesOf(eng, cropId), after = linesOf(next, cropId), was = worthOf(eng), now = worthOf(next);
    const moved = !sameLines(before.rows, after.rows) || Math.abs(now - was) >= 0.005, name = t2.name;
    label = label || `${c.name} · ${name}: changed`;
    const waits = t2.waits.length ? `it waits on ${thingWaits(t2).join(', ')}` : thingWhy(t2);
    const state2 = t2.counts ? (t.counts ? '' : 'counted from now on') : `not counted yet: ${waits}`;
    const typed = t.price != null || t.share != null || t.yield != null || t.weighs != null || t.holds != null;
    if (t2.counts !== t.counts || (unitTo && typed)) {
      const unitSaid = unitTo ? `No figure is turned into the new unit: ${[t.price != null ? `the price stays $${one(t.price)} and will mean $${one(t.price)} for ${aOne(unitTo)}` : '', t.yield != null ? 'the yield stays as typed' : ''].filter(Boolean).join(', ') || 'what is typed stays as typed'}.${hc.looked === year ? ` The tick for ${year} comes off, so ${c.name} goes back among the crops to check.` : ''} ` : '';
      const what = !moved ? `Nothing in the forecast changes: ${name} is ${t2.counts ? 'counted as before' : 'still not counted'}.`
        : t2.counts && !t.counts ? `${name} has every figure it needs, and is counted from now on. Today the plan counts ${before.said}. With it: ${after.said}.`
        : !t2.counts && t.counts ? `${name} would no longer be counted (${waits}), and ${c.name} would be forecast as it was before ${name} was added. Today the plan counts ${before.said}. Then: ${after.said}.`
        : `Today the plan counts ${before.said}. Then: ${after.said}.`;
      const yes = await askFirst({ title: label, confirmLabel: unitTo ? 'Change the unit' : 'Apply', body: `${unitSaid}${what} ${worthTold(was, now).replace(/^t/, 'T')}. No date changes, and one undo takes it back.` });
      if (options.asked) options.asked(yes);
      if (!yes) return false;
    }
    if (!commit(label, ops, { unchecked: true })) return false;
    toast(`${label}${state2 ? ' · ' + state2 : ''} · ${worthTold(was, now)}`, { label: 'Undo', run: undo });
    return { was, now, counts: t2.counts };
  }
  /** Take a thing away again. What that does to the season's worth is shown first; one undo brings it back with every figure. */
  async function removeThing(cropId, id) {
    const eng = state.engine, c = eng.crop(cropId), t = c ? eng.thingsOf(cropId).find(x => x.id === id) : null;
    if (!t) return false;
    const ops = thingStep(cropId, things => { delete things[id]; });
    if (!ops) return false;
    const next = E.create(withOps(state.plan, ops, 'do'), Lib), before = linesOf(eng, cropId), after = linesOf(next, cropId), was = worthOf(eng), now = worthOf(next), label = `${c.name}: ${t.name} taken away`;
    if (!await UI.confirm({ title: `Take ${t.name} away from ${c.name}?`, confirmLabel: 'Take it away',
      body: `Its column goes, with the figures typed in it. ${t.counts ? `${c.name} is forecast as it was before ${t.name} was added. Today the plan counts ${before.said}. Then: ${after.said}.` : `${t.name} was not counted yet, so nothing in the forecast changes.`} ${worthTold(was, now).replace(/^t/, 'T')}. One undo brings it back.` })) return false;
    if (!commit(label, ops, { unchecked: true })) return false;
    toast(`${label} · ${worthSaid(was, now)}`, { label: 'Undo', run: undo });
    return { was, now };
  }
  /**
   * Say where crops' days start: `changes` is [{ cropId, from, less }]. `from` is transplant, seed or direct; `less` the days a
   * transplant saves on a figure for seed sown in place. A null for either goes back to the default. One step, whatever the number of crops.
   */
  function setStarts(changes, label, options) {
    const current = state.plan.assumptions || null, next = current ? JSON.parse(JSON.stringify(current)) : { v: 1, crops: {}, varieties: {} };
    next.starts = next.starts || {};
    for (const change of changes) {
      const record = { ...(next.starts[change.cropId] || {}) };
      for (const key of ['from', 'less']) { if (!(key in change)) continue; if (change[key] == null || change[key] === '') delete record[key]; else record[key] = key === 'less' ? Math.max(0, Math.round(+change[key])) : change[key]; }
      if (Object.keys(record).length) next.starts[change.cropId] = record; else delete next.starts[change.cropId];
    }
    if (!Object.keys(next.starts).length) delete next.starts;
    if (JSON.stringify(next) === JSON.stringify(current || { v: 1, crops: {}, varieties: {} })) return Promise.resolve(false);
    return assume(label, [{ kind: 'assume', before: current, after: emptyList(next) ? null : next }], options);
  }
  const setStart = (cropId, change, label) => setStarts([{ cropId, ...change }], label);

  // ───────────────────────── figures kept on plantings ─────────────────────────
  // A planting that carries its own days does not listen to the list. The audit (js/audit.js) finds them, shows what a
  // release would move before anything changes, and carries the decisions out as one step, with the plan as it stood
  // kept as a snapshot first. Recorded work and tray batches are never touched.
  const Audit = root.LRFAudit;
  const auditSurvey = () => Audit.survey(state.engine, Lib);
  const auditStudy = () => Audit.study(state.plan, Lib);
  function auditPreview(rows, choices) {
    const step = Audit.build(state.plan, rows, choices);
    return { step, ...Audit.preview(state.plan, Lib, step.ops, state.engine) };
  }
  async function auditApply(rows, choices) {
    const step = Audit.build(state.plan, rows, choices), n = step.plantings;
    if (!step.ops.length) return false;
    const view = Audit.preview(state.plan, Lib, step.ops, state.engine);
    await snapshot('Before plantings followed the list');
    const label = `${n} planting${n === 1 ? '' : 's'} follow${n === 1 ? 's' : ''} the list`;
    if (!commit(label, step.ops, { unchecked: true })) return false;
    const moved = view.harvest || view.sowing ? `${view.harvest} harvest date${view.harvest === 1 ? '' : 's'} and ${view.sowing} sowing date${view.sowing === 1 ? '' : 's'} moved` : 'no date moved';
    const worth = Math.abs(view.worth[1] - view.worth[0]) >= 0.5 ? ` · the season’s worth goes from ${dollars(view.worth[0])} to ${dollars(view.worth[1])}` : view.yields.length ? ' · the season’s worth is unchanged' : '';
    toast(`${label} · ${moved}${worth}`, { label: 'Undo', run: undo });
    return { ...step, ...view };
  }

  // ───────────────────────── the farm's dates ─────────────────────────
  // The frost dates and the days that bound planting in open ground (js/farmdates.js). A change writes the plan's settings and
  // touches no planting; what it does to the plan as it stands is worked out first, in the window that changes them (js/season.js).
  const FD = root.LRFFarmDates;
  const farmTools = { trouble: (eng, p, r) => root.LRFSuccession.seasonTrouble(eng, p, r), frost: (eng, p, r) => root.LRFSuccession.frostNote(eng, p, r), worth: eng => root.LRFForecast.build(eng).rows.reduce((n, r) => n + r.worth, 0) };
  const farmDates = () => FD.read(state.engine);
  /** What these dates would do, with nothing changed: the dates that differ, why they cannot stand if they cannot, and what moves. */
  function farmDatesPreview(dates) {
    const errors = FD.check(dates), changed = errors.length ? {} : FD.changed(state.engine, dates);
    if (errors.length || !Object.keys(changed).length) return { errors, changed, idle: true, same: true };
    const settings = FD.settingsWith(state.engine, dates), engine = E.create({ ...state.plan, settings }, Lib);
    return { errors, changed, settings, engine, ...FD.compare(state.engine, engine, farmTools) };
  }
  /** Set the farm's dates: one step, one undo. Only dates that make no season are refused; what moves is said at the time. */
  function setFarmDates(dates) {
    const view = farmDatesPreview(dates), keys = Object.keys(view.changed);
    if (view.errors.length) return refuse(view.errors[0].text);
    if (!keys.length) return false;
    const label = keys.length === 1 ? `Set ${FD.FIELDS.find(f => f.key === keys[0]).short} to ${FD.word(view.changed[keys[0]])}` : `Change ${keys.length} of the farm’s dates`;
    if (!commit(label, [{ kind: 'settings', before: state.plan.settings, after: view.settings }], { unchecked: true })) return false;
    const n = view.harvest.length, moved = n ? `${n} planting${n === 1 ? '’s harvest ends' : 's’ harvests end'} on another day` : 'no planting’s dates change';
    const fresh = view.ground.fresh.length ? ` · ${view.ground.fresh.length} new pair${view.ground.fresh.length === 1 ? '' : 's'} booked into the same ground, under “To settle”` : '';
    const worth = Math.abs(view.worth[1] - view.worth[0]) >= 0.5 ? ` · the season’s worth goes from ${dollars(view.worth[0])} to ${dollars(view.worth[1])}` : '';
    toast(`${label} · ${moved}${fresh}${worth}`, { label: 'Undo', run: undo });
    return view;
  }
  /** Say what kind of place a garden is. Its house factor and frost setting follow. */
  function setGardenType(gardenId, type) {
    const before = state.plan.gardens.find(g => g.id === gardenId), preset = Lib.gardenTypes[type];
    if (!before || !preset || before.type === type) return Promise.resolve(false);
    const after = { ...before, type, dtmFactor: preset.dtmFactor, frost: preset.frost, frostOffset: preset.frostOffset };
    return assume(`${before.name} is ${{ field: 'open field', tunnel: 'an unheated tunnel', greenhouse: 'a heated greenhouse' }[type] || type}`, [{ kind: 'garden', before, after }]);
  }

  // ───────────────────────── seed library ─────────────────────────
  // A variety or crop record is, like the list above, a statement about the world: saving one is never
  // refused, and what it does to the plan is shown first. The long record of what a supplier's page said
  // is kept beside the plan, not in it, and rejoins it when a backup is downloaded.
  const emptyExtras = () => ({ v: 1, varieties: {} });
  async function loadExtras() {
    if (state.extras) return state.extras;
    let text = null;
    try { text = await store.loadBlob('attic-new'); } catch (_) { /* nothing kept yet */ }
    let kept = null;
    try { kept = text ? JSON.parse(text) : null; } catch (_) { kept = null; }
    return (state.extras = kept && kept.varieties ? kept : emptyExtras());
  }
  /** The page record last kept for a variety: from this app, or from the full backup it came in with. */
  async function varietyRecord(id) {
    const extras = await loadExtras();
    if (extras.varieties[id]) return extras.varieties[id];
    try { const attic = await loadAttic(); return (attic.varieties && attic.varieties[id]) || null; } catch (_) { return null; }
  }
  /** Keep a variety's page record. Resolves to false when this view has nowhere durable to keep it. */
  async function keepVarietyRecord(id, heavy) {
    const extras = await loadExtras();
    extras.varieties[id] = heavy;
    try { return await store.saveBlob('attic-new', JSON.stringify(extras)); } catch (_) { return false; }
  }

  // ───────────────────────── photos and stock ─────────────────────────
  // Thumbnails are kept beside the plan (never in it): the ones that ship with the page for the plan it
  // was drawn from, then whatever was read from a backup's photos or added here.
  const Thumbs = root.LRFThumbs;
  async function loadThumbs() {
    let base = {}, kept = null;
    if (state.plan.lrfNext && state.plan.lrfNext.source === 'bundled') {
      const inlined = root.LRF_BUNDLED && root.LRF_BUNDLED.thumbs, path = state.bundled && state.bundled.thumbs;
      try { base = inlined || (path ? await fetch(path).then(r => (r.ok ? r.json() : {})) : {}); } catch (_) { base = {}; }
    }
    try { const text = store.backend === 'memory' ? null : await store.loadBlob('thumbs'); kept = text ? JSON.parse(text) : null; } catch (_) { kept = null; }
    state.keptThumbs = kept && typeof kept === 'object' ? kept : {};
    Thumbs.set({ ...base, ...state.keptThumbs });
    refreshRemote();
    Thumbs.index(state.plan); emit('plan');
    rebuildThumbs();
  }
  const saveThumbs = async () => { try { return store.backend === 'memory' ? false : await store.saveBlob('thumbs', JSON.stringify(state.keptThumbs)); } catch (_) { return false; } };

  // A variety's photo record says where its picture came from (a full backup has one; the importer here writes one). Where the small photo
  // itself is not kept in this browser, the app goes and gets it: through the grower's fetch service when that is set up, else
  // straight from the supplier when the supplier allows it. Until then the picture is shown from the supplier's site while online.
  const liveVariety = v => !!v && v.active !== false && !v.deleted;
  const photoSource = v => { const ph = v && v.photo && typeof v.photo === 'object' ? v.photo : null; for (const u of ph ? [ph.sourceUrl, ph.url] : []) if (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u)) return u; return ''; };
  function refreshRemote() {
    const far = {};
    if (state.plan && !isSample()) for (const v of state.plan.varieties || []) if (liveVariety(v) && !Thumbs.get(v.id)) { const u = photoSource(v); if (u) far[v.id] = u; }
    Thumbs.setRemote(far);
  }
  const MISS_KEY = 'lrf-next:thumb-miss', MISS_DAYS = 7;
  const misses = value => { try { if (value === undefined) return JSON.parse(root.localStorage.getItem(MISS_KEY) || '{}') || {}; root.localStorage.setItem(MISS_KEY, JSON.stringify(value)); } catch (_) { /* then each visit simply tries again */ } return value || {}; };
  const fetchService = () => { const S = root.LRFSeeds; return S && S.serviceReady && S.serviceReady() ? S.service() : null; };
  async function fetchPhoto(url, service) {
    if (service) return root.LRFReader.fetchImage(url, service);
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type || '')) throw new Error('not a picture');
    return blob;
  }
  const photoWork = { running: false, again: false, fetched: 0, failed: 0, left: 0 };
  let planLoads = 0;   // counts whole plans loaded over the one that was open
  /**
   * Fetch and keep the thumbnails that are missing. With ids, only those varieties, and a miss noted earlier is tried again.
   * A picture that cannot be had is not asked for again for a week, unless the fetch service has been set up since.
   */
  async function rebuildThumbs(ids) {
    if (!state.ready || isSample() || (root.navigator && root.navigator.onLine === false)) return photoWork;
    if (photoWork.running) { photoWork.again = true; return photoWork; }
    const service = fetchService(), today = Math.floor(Date.now() / 86400000), missed = misses(), started = planLoads;   // another plan loaded meanwhile ends this run
    const want = (state.plan.varieties || []).filter(v => liveVariety(v) && !Thumbs.get(v.id) && photoSource(v) && (!ids || ids.includes(v.id)))
      .filter(v => { const m = missed[v.id]; return ids || !m || m.u !== photoSource(v) || today - m.t >= MISS_DAYS || (service && !m.s); });
    if (!want.length) return photoWork;
    Object.assign(photoWork, { running: true, again: false, left: want.length }); emit('photos');
    const got = {}, fresh = {};
    let next = 0, since = 0;
    const flush = async last => {
      const ready = Object.keys(fresh);
      if (!ready.length || planLoads !== started) return;
      state.keptThumbs = { ...state.keptThumbs, ...fresh }; Thumbs.putAll(fresh); thumbsRev++;
      for (const id of ready) delete fresh[id];
      refreshRemote(); Thumbs.index(state.plan); emit('plan');
      if (last || (since += ready.length) >= 24) { since = 0; await saveThumbs(); }
    };
    const worker = async () => {
      while (next < want.length && planLoads === started) {
        const v = want[next++], url = photoSource(v);
        try { const uri = await Thumbs.make(await fetchPhoto(url, service)); got[v.id] = uri; fresh[v.id] = uri; delete missed[v.id]; photoWork.fetched++; }
        catch (_) { missed[v.id] = { u: url, t: today, s: service ? 1 : 0 }; photoWork.failed++; }
        photoWork.left--;
        if (Object.keys(fresh).length >= 8) await flush(false);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await flush(true);
    misses(missed);
    photoWork.running = false; emit('photos');
    if (Object.keys(got).length) folderSoon();
    if (photoWork.again) return rebuildThumbs();
    return photoWork;
  }
  /** What the plan should have pictures of and has not: the farm photo, and varieties whose photo record has no thumbnail kept here. */
  function photoGaps() {
    const plan = state.plan, ref = plan && plan.map && plan.map.imageFile;
    const waiting = plan && !isSample() ? plan.varieties.filter(v => liveVariety(v) && v.photo && !Thumbs.get(v.id)) : [];
    return { map: !!plan && !isSample() && !state.mapImageUrl && !!(ref && (ref.sha256 || ref.name)), varieties: waiting.length, shown: waiting.filter(v => photoSource(v)).length, working: photoWork.running, left: photoWork.left, service: !!fetchService() };
  }
  /** Keep (or with no picture, drop) one variety's thumbnail. */
  async function keepThumb(id, uri) {
    const next = { ...state.keptThumbs };
    if (uri) next[id] = uri; else delete next[id];
    state.keptThumbs = next; Thumbs.put(id, uri); thumbsRev++;
    refreshRemote(); Thumbs.index(state.plan); emit('plan');
    const kept = await saveThumbs();
    folderSoon();
    return kept;
  }
  /** Make thumbnails from the variety photos inside a full backup's zip file. */
  async function importPhotos(parsed, where) {
    const out = {}, zip = parsed.zip, Zip = root.LRFZip;
    const list = zip ? (parsed.plan.varieties || []).filter(v => v && v.photo && v.photo.sha256 && zip.entries.get('files/' + v.photo.sha256)) : [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      try { out[v.id] = await Thumbs.make(new Blob([await Zip.read(zip.bytes, zip.entries.get('files/' + v.photo.sha256))], { type: v.photo.mime || 'image/jpeg' })); } catch (_) { /* one unreadable photo does not stop the rest */ }
      if ((i + 1) % 20 === 0) showStatus({ backend: where, state: 'saving', label: `Reading photos ${i + 1}/${list.length}` });
    }
    // pictures carried over from the plan this one replaces stay, under the backup's own
    state.keptThumbs = { ...state.keptThumbs, ...out }; Thumbs.set(state.keptThumbs); refreshRemote(); Thumbs.index(state.plan); emit('plan');
    await saveThumbs();
    return list.length;
  }

  // ───────────────────────── photos added to the plan that is open ─────────────────────────
  const digest = async bytes => { try { const d = await root.crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (_) { return null; } };
  const pictureType = b => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E ? 'image/png' : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? 'image/webp' : '';
  const isThumb = uri => typeof uri === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(uri);
  /** Make a picture the farm photo of the plan that is open. The plan keeps its own scale and bed positions. */
  async function setMapPhoto(bytes, mime) {
    let size;
    try { const bitmap = await createImageBitmap(new Blob([bytes], { type: mime })); size = { w: bitmap.width, h: bitmap.height }; if (bitmap.close) bitmap.close(); } catch (_) { throw new Error('is not a picture this browser can read'); }
    const hash = await digest(bytes), map = { ...(state.plan.map || {}) }, ref = map.imageFile, drawn = map.imgW > 0 && map.imgH > 0;
    const shape = drawn && Math.abs(size.w / size.h - map.imgW / map.imgH) > 0.02 * (map.imgW / map.imgH) ? { w: size.w, h: size.h, planW: map.imgW, planH: map.imgH } : null;
    if (!drawn) { map.imgW = size.w; map.imgH = size.h; }   // a plan with no photo yet takes the picture's own size
    showMapImage(bytes, mime);
    let kept = false;
    if (store.backend !== 'memory') { try { kept = await store.saveBlob('mapimage', toBase64(bytes)); } catch (_) { kept = false; } }
    adopt({ ...state.plan, map, lrfNext: { ...(state.plan.lrfNext || {}), mapImage: { mime, sha256: hash } } }, state.engine);
    return { kept, same: !!(ref && ref.sha256 && hash && ref.sha256 === hash), known: !!(ref && ref.sha256), shape };
  }
  /** Add small photos for varieties of the open plan. One already kept here stays as it is unless `replace`. */
  async function addThumbs(found, options = {}) {
    const ids = new Set(state.plan.varieties.map(v => v.id)), fresh = {};
    let had = 0, strange = 0;
    for (const [id, uri] of Object.entries(found || {})) {
      if (!isThumb(uri)) continue;
      if (!ids.has(id)) strange++; else if (Thumbs.get(id) && !options.replace) had++; else fresh[id] = uri;
    }
    const added = Object.keys(fresh).length;
    if (added) { state.keptThumbs = { ...state.keptThumbs, ...fresh }; Thumbs.putAll(fresh); thumbsRev++; refreshRemote(); Thumbs.index(state.plan); emit('plan'); await saveThumbs(); }
    return { added, had, strange };
  }
  /** The pictures inside a complete backup .zip, matched to the open plan's varieties: by record, else by crop and name. */
  async function zipPictures(bytes) {
    const Zip = root.LRFZip, entries = Zip.directory(bytes), planEntry = entries.get('plan.json');
    if (!planEntry) throw new Error('has no plan.json inside, so its pictures cannot be matched to varieties');
    const theirs = JSON.parse(new TextDecoder().decode(await Zip.read(bytes, planEntry))), mine = state.plan.varieties.filter(liveVariety);
    const byId = new Map(mine.map(v => [v.id, v])), byName = new Map(mine.map(v => [v.cropId + '|' + SL.varietyKey(v.name), v])), thumbs = {};
    const list = (theirs.varieties || []).filter(v => v && v.photo && v.photo.sha256 && entries.get('files/' + v.photo.sha256));
    for (let i = 0; i < list.length; i++) {
      const v = list[i], here = byId.get(v.id) || byName.get(v.cropId + '|' + SL.varietyKey(v.name));
      if (here && !Thumbs.get(here.id)) { try { thumbs[here.id] = await Thumbs.make(new Blob([await Zip.read(bytes, entries.get('files/' + v.photo.sha256))], { type: v.photo.mime || 'image/jpeg' })); } catch (_) { /* one unreadable photo does not stop the rest */ } }
      if ((i + 1) % 20 === 0) showStatus({ backend: store.backend, state: 'saving', label: `Reading photos ${i + 1}/${list.length}` });
    }
    const ref = theirs.map && theirs.map.imageFile, mapEntry = ref && ref.sha256 ? entries.get('files/' + ref.sha256) : null;
    return { thumbs, map: mapEntry ? await Zip.read(bytes, mapEntry) : null };
  }
  /**
   * Pictures for the plan that is open, from files. A picture is the farm photo. A thumbnails file (as the plan folder keeps
   * one), a photo file made for this plan, or a complete backup .zip gives variety photos, and the farm photo when it holds
   * one and none is shown yet. The plan itself is never replaced, and a variety photo already here is never written over.
   */
  async function addPhotos(files) {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length) return null;
    if (isSample()) { toast('Load your plan first. Its photos can be added after that.'); return null; }
    if (elsewhere()) { refuse(elsewhere()); return null; }
    const out = { map: null, added: 0, had: 0, strange: 0, problems: [] }, tally = r => { out.added += r.added; out.had += r.had; out.strange += r.strange; };
    const mapFrom = async (bytes, mime, force) => { if (force || !state.mapImageUrl) out.map = await setMapPhoto(bytes, mime); };
    for (const file of list) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()), mime = pictureType(bytes);
        if (mime) { await mapFrom(bytes, mime, true); continue; }
        if (root.LRFZip.isZip(bytes)) { const found = await zipPictures(bytes); if (found.map) await mapFrom(found.map, pictureType(found.map) || 'image/jpeg', false); tally(await addThumbs(found.thumbs)); continue; }
        let data;
        try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error('is not a picture, a photo file or a backup'); }
        if (data && Array.isArray(data.plantings)) throw new Error('is a plan, not photos. To open it, use Backup, Load a backup');
        if (data && data.format === 'lrf-photos-1') { if (data.map && data.map.data) { const b = fromBase64(data.map.data); await mapFrom(b, pictureType(b) || data.map.mime || 'image/jpeg', false); } tally(await addThumbs(data.thumbs)); continue; }
        if (!data || typeof data !== 'object' || !Object.values(data).some(isThumb)) throw new Error('holds no photos');
        tally(await addThumbs(data));
      } catch (error) { out.problems.push(`${file.name} ${(error && error.message) || 'could not be read'}`); }
    }
    showStatus({ backend: store.backend, state: 'saved' });
    const said = [];
    if (out.map) said.push(out.map.shape ? `The farm photo is set, but it is ${out.map.shape.w} × ${out.map.shape.h} and the plan was drawn on one ${out.map.shape.planW} × ${out.map.shape.planH}: beds may not sit where they should`
      : `The farm photo is set${out.map.known && !out.map.same ? ' (it is not the same file the plan was drawn on)' : ''}`);
    if (out.added) said.push(`${out.added} variety photo${out.added === 1 ? '' : 's'} added`);
    if (out.had && !out.added) said.push(`all ${out.had} variety photo${out.had === 1 ? ' was' : 's were'} here already`);
    if (out.strange) said.push(`${out.strange} belong${out.strange === 1 ? 's' : ''} to varieties that are not in this plan`);
    if (!out.map && !out.added && !out.had && !out.strange && !out.problems.length) said.push('No photos were found in that');
    toast([...said, ...out.problems].join('. ') + '.');
    if (out.map || out.added) folderSoon();
    return out;
  }
  // Seed stock. A plan loaded from a full backup carries its lots and their change log. A plan saved before stock
  // could be edited here does not, so its records are fetched once from where they were set aside (the page's own
  // copy, or the stored backup records) and join the plan with the first change made to them.
  const SL = root.LRFSeedLib;
  function loadInventory() {
    if (state.plan.seedInventory || state.inventoryAsked === state.plan.lrfNext) return Promise.resolve(false);
    const asked = (state.inventoryAsked = state.plan.lrfNext || {});
    const from = asked.source === 'bundled'
      ? Promise.resolve((root.LRF_BUNDLED && root.LRF_BUNDLED.inventory) || (state.bundled && state.bundled.inventory ? fetch(state.bundled.inventory).then(r => (r.ok ? r.json() : null)) : null))
      : loadAttic().then(attic => (attic.rest && attic.rest.seedInventory) || null);
    return from.catch(() => null).then(found => { if (state.inventoryAsked !== asked) return false; state.inventoryBase = found && Array.isArray(found.lots) ? found : null; return !!state.inventoryBase; });
  }
  const inventoryNow = () => state.plan.seedInventory || state.inventoryBase || SL.emptyInventory();
  const stockNow = () => SL.stock(inventoryNow());
  /** Change seed stock: `change(inventory, ctx)` returns the changed copy, or null for no change. One undoable step. */
  function editStock(label, change, name) {
    const ctx = { now: new Date().toISOString(), uid, year: planYear(), name: name || '' };
    let after = null;
    try { after = change(inventoryNow(), ctx); } catch (error) { toast(error.message || 'That stock change could not be made.'); return false; }
    if (!after) return false;
    return commit(label, [{ kind: 'inventory', before: state.plan.seedInventory || null, after }], { unchecked: true });
  }

  // Vendor size lists. A plan loaded from a full backup carries each variety's own list. The plan that ships with this
  // page is the compact copy and does not, so its lists ship beside it and are read when the page opens.
  async function loadPacks() {
    state.packsBase = {};
    if (!(state.plan.lrfNext && state.plan.lrfNext.source === 'bundled')) return;
    const inlined = root.LRF_BUNDLED && root.LRF_BUNDLED.packs, path = state.bundled && state.bundled.packs;
    let found = null;
    try { found = inlined || (path ? await fetch(path).then(r => (r.ok ? r.json() : null)) : null); } catch (_) { found = null; }
    if (found && typeof found === 'object') { state.packsBase = found; emit('plan'); }
  }
  // A plan first saved by an early preview holds each variety's planning figures only. Supplier, product code, page
  // address and seed counts were added to the page's copy later; where a saved record lacks them, they are filled in
  // from that copy. Nothing the grower has set is touched: only fields the saved record does not have at all.
  const REFERENCE_FIELDS = ['source', 'supplier', 'sku', 'url', 'catalogDtmText', 'catalogHarvestStage', 'seedsPerPacket', 'seedsPerOz', 'seedsPerG', 'seedsPerLb'];
  async function topUpVarieties() {
    if (!(state.plan.lrfNext && state.plan.lrfNext.source === 'bundled') || !state.plan.varieties.some(v => v && v.source === undefined)) return false;
    const started = state.plan.lrfNext;
    let compact = null;
    try { compact = (root.LRF_BUNDLED && root.LRF_BUNDLED.plan) || (state.bundled ? await fetch('data/plan.json').then(r => (r.ok ? r.json() : null)) : null); } catch (_) { compact = null; }
    if (state.plan.lrfNext !== started) return false;   // another plan was loaded meanwhile
    const shipped = new Map(((compact && compact.varieties) || []).map(v => [v.id, v]));
    let filled = 0;
    const varieties = state.plan.varieties.map(v => {
      const from = shipped.get(v.id);
      let next = v;
      if (from) for (const key of REFERENCE_FIELDS) if (v[key] === undefined && from[key] !== undefined) { if (next === v) next = { ...v }; next[key] = from[key]; }
      if (next !== v) filled++;
      return next;
    });
    if (filled) adopt({ ...state.plan, varieties });
    return filled > 0;
  }
  /** The sizes a variety's vendor sells it in, and what covers an amount of it in those sizes. */
  const packsFor = v => SL.packs(v, v && state.packsBase[v.id]);
  const coverFor = (amount, unit, v) => SL.toCover(amount, unit, v, v && state.packsBase[v.id]);

  // Sowing. A planned sowing never touches stock; recording that it happened does. The date is a fact, so the guard
  // rails do not refuse it: if a late direct sowing now runs into the next crop, the overview lists the pair to settle.
  const todayText = () => E.d2s(new Date());
  const sowingOf = p => SL.sowing(state.engine, p);
  function sowingStep(label, work) {
    const ctx = { now: new Date().toISOString(), uid, year: planYear(), name: '', today: todayText() };
    let result;
    try { result = work(ctx); } catch (error) { toast(error.message || 'That could not be recorded.'); return null; }
    const ops = [{ before: result.before, after: result.planting }];
    if (result.inventory) ops.push({ kind: 'inventory', before: state.plan.seedInventory || null, after: result.inventory });
    const was = state.engine;
    if (!commit(label, ops, { unchecked: true })) return null;
    result.overlaps = impact(was, state.engine).overlaps;
    return result;
  }
  /** Record that a planting was sown (or planted): input { date, quantity?, note? }. One undoable step. */
  function recordSowing(id, input) {
    const p = state.engine.planting(id), s = p && sowingOf(p);
    if (!s) return null;
    const first = nothingRecorded(), before = state.plan;
    const done = sowingStep(`${cropLabel(p)}: sown ${day(E.s2d(input.date))}`, ctx => ({ before: p, ...Week.record(state.engine, inventoryNow(), p, s.kind, input, ctx) }));
    if (done && first) keepPlanOfRecord(before);
    return done;
  }
  /** Take a recorded sowing back: the date is cleared and the seed goes back onto its lots. One undoable step. */
  function takeBackSowing(id) {
    const p = state.engine.planting(id), s = p && sowingOf(p);
    return s ? sowingStep(`${cropLabel(p)}: sowing taken back`, ctx => ({ before: p, ...Week.takeBack(state.engine, inventoryNow(), p, s.kind, ctx) })) : null;
  }
  /**
   * Several sowings as one undoable step. Each planting is worked exactly as it would be alone, with the seed stock
   * carried from one to the next, so two plantings of a variety draw the same lots down in turn. A planting that
   * cannot be done (a date that contradicts work already recorded, say) is left alone and reported; the rest go ahead.
   */
  function workOps(items, work) {
    const ctx = { now: new Date().toISOString(), uid, year: planYear(), name: '', today: todayText() }, ops = [], done = [], failed = [];
    let inventory = inventoryNow(), touched = false;
    // two jobs of one planting in one step (Mark all done: its sowing and its hardening off) are worked one after the other on the
    // planting as the first left it, and give one change, so that neither record is lost
    const at = new Map();
    for (const item of items || []) {
      const was = at.has(item.id) ? ops[at.get(item.id)].after : state.engine.planting(item.id);
      if (!was) continue;
      try {
        const result = work(was, item, inventory, ctx);
        if (at.has(item.id)) ops[at.get(item.id)].after = result.planting; else { at.set(item.id, ops.length); ops.push({ before: was, after: result.planting }); }
        if (result.inventory) { inventory = result.inventory; touched = true; }
        done.push({ id: was.id, ...result });
      } catch (error) { failed.push({ id: was.id, label: cropLabel(was), why: error.message || 'It could not be recorded.' }); }
    }
    if (touched) ops.push({ kind: 'inventory', before: state.plan.seedInventory || null, after: inventory });
    return { ops, done, failed };
  }
  function sowingSteps(label, items, work) {
    const { ops, done, failed } = workOps(items, work);
    if (!ops.length) { toast(failed.length ? failed[0].why : 'Nothing to record.'); return null; }
    const was = state.engine;
    if (!commit(label(done.length), ops, { unchecked: true })) return null;
    const total = key => Math.round(done.reduce((n, r) => n + (Array.isArray(r[key]) ? r[key].reduce((m, u) => m + u.quantity, 0) : Number(r[key]) || 0), 0) * 1e6) / 1e6;
    return { done, failed, overlaps: impact(was, state.engine).overlaps, used: total('used'), untracked: total('untracked'), returned: total('returned'), lost: total('lost'),
      moved: done.filter(r => r.moved).map(r => ({ id: r.id, ...r.moved })), held: done.filter(r => r.held).length, restored: done.filter(r => r.restored).length };
  }
  /** Record several sowings on one date: items [{ id, quantity? }]. Quantities left out are the plan's own. */
  const recordSowings = (items, input) => recordWork((items || []).map(item => { const p = state.engine.planting(item.id), s = p && sowingOf(p); return s ? { ...item, kind: s.kind } : null; }).filter(Boolean), input);

  // The week's work. Sowing, potting up, hardening off, planting out and moving out are each ticked on the day they were
  // really done. A recorded day is a fact: it is never refused. A transplant sown or hardened off late goes out as many
  // days later, in the same step, unless `follow` is false; early work moves nothing after it.
  const Week = root.LRFWeek;
  const nothingRecorded = () => !state.plan.plantings.some(p => p.done && typeof p.done === 'object' && Object.keys(p.done).length);
  /** The plan as it stood before the first work of its year was recorded, kept by name so plan and season can be compared later. */
  function keepPlanOfRecord(plan) {
    const year = +(plan.settings && plan.settings.year) || planYear();
    return snapshot(`Plan of record ${year} (before the first work was recorded)`, { plan, why: 'record:' + year });
  }
  // an item may carry a day of its own ("Mark all done", each on the day it was due); otherwise the day given for all of them
  const jobWork = input => (p, item, inventory, ctx) => Week.record(state.engine, inventory, p, item.kind, { date: item.date || input.date, quantity: item.quantity, note: input.note, follow: input.follow }, ctx);
  const seedJob = item => { const p = state.engine.planting(item.id), s = p && sowingOf(p); return !!s && s.kind === item.kind && (s.unit === 'seeds' || s.unit === 'g'); };
  /** Record jobs on one date, as one undoable step: items [{ id, kind, quantity? }], input { date, follow?, note? }. */
  function recordWork(items, input) {
    items = items || [];
    const sowings = items.length > 0 && items.every(seedJob), word = n => `${n} ${sowings ? 'sowing' : 'task'}${n === 1 ? '' : 's'}`;
    const first = nothingRecorded(), before = state.plan;
    const done = sowingSteps(n => `${word(n)} recorded ${day(E.s2d(input.date))}`, items, jobWork(input));
    if (done && first) { done.planOfRecord = true; keepPlanOfRecord(before); }
    return done;
  }
  /**
   * What recording those jobs on that day would do, with nothing recorded: how many plantings it pushes and by how much,
   * how many it would push out of the plan's year (those stay), and how many new pairs it books into the same ground.
   */
  function previewWork(items, input, options = {}) {
    const { ops, done, failed } = workOps(items, jobWork(input));
    const moved = done.filter(r => r.moved).map(r => ({ id: r.id, ...r.moved })), held = done.filter(r => r.held).length;
    // asked for: whose first harvest the record moves (a planting put in its bed early is picked from that day)
    if (options.firsts && ops.length) {
      const after = E.create(withOps(state.plan, ops, 'do'), Lib), firsts = [];
      // a planting with two of its jobs in the step is one first harvest
      for (const id of new Set(done.map(r => r.id))) { const a = state.engine.calc(state.engine.planting(id)), b = after.calc(after.planting(id)); if (a && b && E.validDate(a.first) && E.validDate(b.first) && +a.first !== +b.first) firsts.push({ id, from: E.d2s(a.first), to: E.d2s(b.first) }); }
      return { n: done.length, moved, held, overlaps: 0, failed, firsts };
    }
    // the ground is looked at only when something is pushed: a day recorded for planting is a fact, and its overlaps are said when it is recorded
    if (!ops.length || !moved.length || options.impact === false) return { n: done.length, moved, held, overlaps: 0, failed };
    const engine = E.create(withOps(state.plan, ops, 'do'), Lib), pairs = eng => { const set = new Set(); for (const p of eng.plan.plantings) { const r = eng.calc(p); if (r) for (const o of eng.conflicts(p, r)) if (!o.rest) set.add([p.id, o.p.id].sort().join('|')); } return set; };
    const was = pairs(state.engine);
    return { n: done.length, moved, held, overlaps: [...pairs(engine)].filter(k => !was.has(k)).length, failed };
  }
  /** Take recorded jobs back, as one step: items [{ id, kind }]. */
  const takeBackWork = items => sowingSteps(n => `${n} task${n === 1 ? '' : 's'} taken back`, items || [], (p, item, inventory, ctx) => Week.takeBack(state.engine, inventory, p, item.kind, ctx));
  /**
   * Put jobs off to a day on purpose, as one step: items [{ id, kind }]. A change to the plan, so the guard rails have
   * their say. Returns { moved: [{ id, days, from, to, moves }], failed, overlaps }.
   */
  function delayWork(items, date) {
    const ops = [], moved = [], failed = [];
    for (const item of items || []) {
      const p = state.engine.planting(item.id);
      if (!p) continue;
      try { const r = Week.delay(state.engine, p, item.kind, date); if (r) { ops.push({ before: p, after: r.planting }); moved.push({ id: p.id, days: r.days, from: r.from, to: r.to, moves: r.moves }); } }
      catch (error) { failed.push({ id: p.id, label: cropLabel(p), why: error.message || 'It could not be moved.' }); }
    }
    if (!ops.length) { toast(failed.length ? `Nothing moved: ${failed[0].label}: ${failed[0].why}` : 'That is the day it is planned for already.'); return null; }
    const was = state.engine;
    if (!commit(`${ops.length} task${ops.length === 1 ? '' : 's'} put off to ${day(E.s2d(date))}`, ops)) return null;
    return { moved, failed, overlaps: impact(was, state.engine).overlaps };
  }
  /** Skip jobs, or with no day put them back on the list, as one step: items [{ id, kind }]. The plan itself does not change. */
  function skipWork(items, on) {
    const ops = [];
    for (const item of items || []) { const p = state.engine.planting(item.id); if (p && Week.skipOf(p, item.kind) !== (on || null)) ops.push({ before: p, after: Week.skip(p, item.kind, on || null) }); }
    if (!ops.length) return null;
    return commit(on ? `${ops.length} task${ops.length === 1 ? '' : 's'} skipped` : `${ops.length} task${ops.length === 1 ? '' : 's'} back on the list`, ops, { unchecked: true }) ? { n: ops.length } : null;
  }
  /** A note kept for jobs that are not done yet: items [{ id, kind }]. */
  function noteWork(items, text) {
    const note = String(text || '').trim().slice(0, 400), ops = [];
    for (const item of items || []) { const p = state.engine.planting(item.id); if (p && Week.noteOf(p, item.kind) !== note) ops.push({ before: p, after: Week.withTask(p, 'note', item.kind, note) }); }
    if (!ops.length) return null;
    return commit(note ? 'A note on a task' : 'A task’s note cleared', ops, { unchecked: true }) ? { n: ops.length } : null;
  }
  // ── a planting that failed: its bed is free from that day, nothing more is picked, and it stays on record (js/engine.js failedOn) ──
  /** The days a planting can be marked failed on: from the day it was started (its sowing, or its day in the ground) to today. Null when it has not started. */
  function failedRange(p) {
    const r = p && state.engine.calc(p);
    if (!r || p.established === true) return null;
    // to today, or to the last day it held its ground where that came first: a failure after its bed was free frees nothing
    // from the day it was started, and never before the last work recorded on it: a recorded day is a fact, and it failed after it
    const days = Object.keys(p.done && typeof p.done === 'object' ? p.done : {}).map(k => SL.doneDate(p, k)).filter(Boolean).sort();
    const recorded = [SL.doneDate(p, 'sow'), SL.doneDate(p, 'field')].filter(Boolean).sort()[0] || null, planned = E.d2s(r.start), first = recorded && recorded < planned ? recorded : planned;
    const lo = days.length && days[days.length - 1] > first ? days[days.length - 1] : first;
    const held = state.engine.occupancyThrough(p, r), today = todayText(), hi = held !== Infinity && E.d2s(held) < today ? E.d2s(held) : today;
    return lo <= hi ? { lo, hi } : null;
  }
  const failedTo = (p, date) => Week.fail(p, date, new Date().toISOString());
  /** Why a day cannot be the day a planting failed, in words; null when it can. */
  function failedRefusal(p, date) {
    const range = failedRange(p);
    if (!range) return 'It has not been started yet, so it cannot have failed. Remove it instead, or move it.';
    if (!SL.realDay(date)) return 'Choose a real calendar date.';
    if (date > range.hi) return range.hi < todayText() ? `Its bed was free after ${day(E.s2d(range.hi))}: choose that day or an earlier one.` : 'A failure is marked on the day it happened: today or an earlier day.';
    if (date < range.lo) return `That is before ${SL.doneDate(p, 'sow') === range.lo || E.d2s(state.engine.calc(p).start) === range.lo ? 'it was started' : 'the last work recorded on it'} (${day(E.s2d(range.lo))}).`;
    return null;
  }
  /**
   * What marking a planting failed on a day would do, with nothing changed: the day its bed is free (and the day it was free
   * before), what comes off the forecast (its amount and the season's worth), and the tasks that leave the list.
   */
  function previewFailed(id, date) {
    const p = state.engine.planting(id), why = p ? failedRefusal(p, date) : 'That planting is not in the plan.';
    if (why) return { why };
    const r = state.engine.calc(p), after = failedTo(p, date), engine = E.create(withOps(state.plan, [{ before: p, after }], 'do'), Lib), q = engine.planting(id), a = engine.calc(q);
    const was = state.engine.occupancyThrough(p, r), y0 = state.engine.yieldOf(p, r), y1 = engine.yieldOf(q, a), worth = impact(state.engine, engine).worth;
    return { date, freeFrom: date, wasFree: was === Infinity ? null : E.d2s(E.addDays(was, 1)), unit: y0 ? y0.unit : null, units: y0 && y1 ? Math.max(0, y0.units - y1.units) : 0,
      worth: Math.max(0, worth[0] - worth[1]), tasks: Week.steps(state.engine, p).filter(st => !st.done && !st.skipped).length, lastPick: a.harvestDays > 0 ? E.d2s(a.last) : null };
  }
  /** Mark a planting failed on a day, or with no day take the mark off: one step, with Undo. Taking it off puts it back in its bed, and says what that overlaps. */
  function markFailed(id, date) {
    const p = state.engine.planting(id);
    if (!p) return null;
    const was = state.engine;
    if (date == null) {
      if (!p.failed) return null;
      const after = Week.fail(p, null);
      return commit(`${cropLabel(p)}: no longer marked failed`, [{ before: p, after }], { unchecked: true }) ? { overlaps: impact(was, state.engine).overlaps } : null;
    }
    const why = failedRefusal(p, date);
    if (why) { toast(why); return null; }
    const shown = previewFailed(id, date);
    return commit(`${cropLabel(p)}: marked failed ${day(E.s2d(date))}`, [{ before: p, after: failedTo(p, date) }], { unchecked: true }) ? shown : null;
  }

  // ── everything recorded in the season, taken back at once (Tasks, "⋯") ──
  const UNDO_ORDER = ['move', 'field', 'harden', 'potup', 'sow'];
  /** A sowing, as the sheet counts it: seed put in a tray or in the ground. Bulbs, canes and plants put in are counted with the other tasks. */
  const sownJob = (st, sow) => st.kind === 'sow' || (st.seed && !!sow && (sow.unit === 'seeds' || sow.unit === 'g'));
  /**
   * What "Take back everything recorded" would take back in the plan's year: the jobs recorded (sowings apart, with the seed
   * they took), what was put off and what was skipped. Notes are kept, and so is a planting marked failed.
   */
  function seasonRecords() {
    const year = planYear(), out = { sowings: 0, jobs: 0, delays: 0, skips: 0, notes: 0, failed: 0, seed: 0, plantings: 0 };
    for (const p of state.plan.plantings) {
      if (!SL.onTasks(state.engine, p, year)) continue;   // the plantings Tasks lists: the year's own and its season's (a December tray batch for January)
      const steps = Week.steps(state.engine, p), sow = sowingOf(p), t = p.tasks && typeof p.tasks === 'object' ? p.tasks : {};
      const jobs = steps.filter(st => st.done), delays = Object.keys(t.delay || {}).length, skips = Object.keys(t.skip || {}).length;
      for (const st of jobs) { if (sownJob(st, sow)) out.sowings++; else out.jobs++; }
      if (sow && sow.done) out.seed += sow.uses.filter(u => u && u.source === 'sowing' && u.lotId).reduce((n, u) => n + (+u.quantity || 0), 0);
      out.delays += delays; out.skips += skips; out.notes += Object.keys(t.note || {}).length; if (p.failed) out.failed++;
      if (jobs.length || delays || skips) out.plantings++;
    }
    return out;
  }
  /**
   * Take back everything recorded in the plan's year, as one step with Undo, after a snapshot of the plan as it stands.
   * Each planting's jobs go back last first, so seed returns to its lots and a planting pushed by late work returns to its
   * day; then what was put off goes back where it was, and skips are cleared. Notes stay.
   */
  /** What taking back everything recorded in the season would change, worked out on the plan as it stands now. */
  function seasonTakeBack() {
    const year = String(planYear()), ctx = { now: new Date().toISOString(), uid, year: planYear(), name: '', today: todayText() }, ops = [], failed = [];
    let inventory = inventoryNow(), touched = false, returned = 0, lost = 0, sowings = 0, jobs = 0, delays = 0, skips = 0;
    for (const p0 of state.plan.plantings) {
      if (!SL.onTasks(state.engine, p0, planYear())) continue;   // as seasonRecords: what Tasks lists
      // one planting at a time, its seed carried in a copy that is kept only when the whole planting went back. A planting marked
      // failed lists no work, so its work is undone with the mark set aside, and the mark put back after: failed marks stay
      let p = p0.failed ? Week.fail(p0, null) : p0, inv = inventory, back = { returned: 0, lost: 0, sowings: 0, jobs: 0, delays: 0, skips: 0, inv: false };
      try {
        // Work is undone last first, whatever kind it was: a put-off that still stands where it was put goes back by its days, and
        // otherwise the latest recorded job is taken back (a planting it pushed returns to its day). Each undo can let an earlier
        // one stand again, so the two are tried in turn until neither can go further.
        for (let guard = 0; guard < 40; guard++) {
          const standing = Object.keys(((p.tasks && typeof p.tasks === 'object' ? p.tasks : {}).delay) || {}).find(kind => { const st = Week.delayOf(p, kind) && Week.step(state.engine, p, kind); return !!(st && st.delayedFrom); });
          if (standing) {
            const put = Week.delayOf(p, standing);
            let moved = null;
            try { moved = Week.delay(state.engine, p, standing, put.from); } catch (_) { moved = null; }   // one that would leave the year keeps its day
            p = moved ? moved.planting : Week.withTask(p, 'delay', standing, null);
            back.delays++;
            continue;
          }
          const kind = UNDO_ORDER.find(k => { const st = Week.step(state.engine, p, k); return !!(st && st.done); });
          if (!kind) break;
          const st = Week.step(state.engine, p, kind), sown = sownJob(st, sowingOf(p)), result = Week.takeBack(state.engine, inv, p, kind, ctx);
          p = result.planting;
          if (result.inventory) { inv = result.inventory; back.inv = true; }
          back.returned += +result.returned || 0; back.lost += +result.lost || 0;
          if (sown) back.sowings++; else back.jobs++;
        }
        const t = p.tasks && typeof p.tasks === 'object' ? p.tasks : {};
        // what is left was put off from a day the planting no longer stands on (moved by hand since): its record goes, its day stays
        for (const kind of Object.keys(t.delay || {})) { p = Week.withTask(p, 'delay', kind, null); back.delays++; }
        for (const kind of Object.keys(t.skip || {})) { p = Week.withTask(p, 'skip', kind, null); back.skips++; }
      } catch (error) { failed.push({ id: p0.id, label: cropLabel(p0), why: error.message || 'It could not be taken back.' }); continue; }
      if (p0.failed) p = { ...p, failed: p0.failed };
      if (!(back.sowings + back.jobs + back.delays + back.skips)) p = p0;
      inventory = inv; if (back.inv) touched = true;
      returned += back.returned; lost += back.lost; sowings += back.sowings; jobs += back.jobs; delays += back.delays; skips += back.skips;
      if (p !== p0) ops.push({ before: p0, after: p });
    }
    if (touched) ops.push({ kind: 'inventory', before: state.plan.seedInventory || null, after: inventory });
    return { year, ops, failed, sowings, jobs, delays, skips, returned, lost };
  }
  async function takeBackSeason() {
    if (elsewhere()) return refuse(elsewhere());
    let plan = state.plan, w = seasonTakeBack();
    const none = x => { toast(x.failed.length ? `Nothing was taken back: ${x.failed[0].label}: ${x.failed[0].why}` : 'Nothing is recorded in this season.'); return null; };
    if (!w.ops.length) return none(w);
    const kept = await snapshot(`Before everything recorded in ${w.year} was taken back`, { plan });
    if (!kept && Snaps && !isSample()) { toast('The snapshot could not be kept, so nothing was taken back.'); return null; }
    // the plan may have changed while the snapshot was kept (an edit, or changes taken in from another device): what goes back is
    // worked out again on the plan as it is now, and the change made at once, with nothing awaited between the two
    if (state.plan !== plan) { if (elsewhere()) return refuse(elsewhere()); plan = state.plan; w = seasonTakeBack(); if (!w.ops.length) return none(w); }
    const was = state.engine;
    if (!commit(`Everything recorded in ${w.year} taken back`, w.ops, { unchecked: true })) return null;
    return { sowings: w.sowings, jobs: w.jobs, delays: w.delays, skips: w.skips, returned: Math.round(w.returned * 1e6) / 1e6, lost: Math.round(w.lost * 1e6) / 1e6, failed: w.failed, overlaps: impact(was, state.engine).overlaps, snapshot: kept ? kept.name : null };
  }

  /**
   * Set the day sowings are planned for, as one step. Nothing is marked sown and no seed leaves stock: this moves the plan.
   * A transplant keeps the day it goes out and is raised for longer or shorter. A tray batch keeps the day it is due.
   * Seed sown in the ground moves with its planting, so the guard rails have their say. With no date, the plan's own day is put back.
   */
  function planSowings(ids, date) {
    const ops = [], skipped = [], when = date ? E.s2d(date) : null;
    if (date && !E.validDate(when)) { toast('Choose a real calendar date.'); return null; }
    for (const id of ids || []) {
      const p = state.engine.planting(id), r = p && state.engine.calc(p);
      if (!r || p.established === true) continue;
      const skip = why => skipped.push({ id, label: cropLabel(p), why });
      if (r.rack) {
        if (date) {
          if (!(when < r.first)) { skip('that is not before the day the trays are due'); continue; }
          if (date !== p.date) ops.push({ before: p, after: { ...p, date, dtm: E.dayDiff(r.first, when), sowOn: date } });
        } else if (p.sowOn) {
          const demand = p.liveTray && (state.plan.liveTrayPlans || []).find(x => x.id === p.liveTray.planId), row = demand && demand.rows.find(x => x.id === p.liveTray.rowId);
          if (!row) { skip('its weekly demand is not in this plan'); continue; }
          const after = { ...p, date: E.d2s(E.addDays(r.first, -row.days)), dtm: row.days }; delete after.sowOn;
          ops.push({ before: p, after });
        }
      } else if (r.plannedSow) {
        if (date && !(when < r.planned)) { skip('that is not before the day it goes out'); continue; }
        const after = { ...p };
        if (date && date !== E.d2s(r.sowDefault)) after.sowOn = date; else delete after.sowOn;
        if (after.sowOn !== p.sowOn) ops.push({ before: p, after });
      } else if (date && date !== p.date) ops.push({ before: p, after: { ...p, date } });
    }
    if (!ops.length) { toast(skipped.length ? `Nothing moved: ${skipped[0].label}: ${skipped[0].why}.` : date ? 'Those are already planned for that day.' : 'Those are on the plan’s own day already.'); return null; }
    const was = state.engine;
    if (!commit(date ? `${ops.length} sowing${ops.length === 1 ? '' : 's'} planned for ${day(when)}` : `${ops.length} sowing${ops.length === 1 ? '' : 's'} put back on the plan’s day`, ops)) return null;
    return { moved: ops.length, skipped, overlaps: impact(was, state.engine).overlaps };
  }
  /** Take several recorded sowings back at once. */
  const takeBackSowings = ids => sowingSteps(n => `${n} sowing${n === 1 ? '' : 's'} taken back`, (ids || []).map(id => ({ id })),
    (p, item, inventory, ctx) => { const s = sowingOf(p); if (!s) throw new Error('No sowing is recorded for this planting.'); return Week.takeBack(state.engine, inventory, p, s.kind, ctx); });

  // ───────────────────────── live trays ─────────────────────────
  const Trays = root.LRFTrays;
  /** Harvest and pick records are among the records a full backup carries that the planner does not edit; a batch with any is history and stays as it is. */
  async function trayRecords() {
    try { const attic = await loadAttic(); return { harvests: attic.rest.harvests, fieldRecords: attic.rest.fieldRecords }; } catch (_) { return {}; }
  }
  /** Save a weekly demand plan: its record, its crops and its batches change together, as one step that can be undone. */
  async function saveTrays(label, input) {
    const records = await trayRecords(), farm = state.plan;
    let result;
    try { result = Trays.apply(farm, input, { uid, now: new Date().toISOString(), crop: id => state.engine.crop(id), records, keepRecorded: true }); } catch (error) { toast(error.message); return null; }
    const ops = Trays.ops(farm, result.plan);
    // Saving the same demand again would only restamp the record: that is not a change, and not a step to undo.
    const bare = list => JSON.stringify((list || []).map(({ updatedAt, ...rest }) => rest));
    if (!ops.length || (ops.length === 1 && ops[0].kind === 'trays' && bare(ops[0].before) === bare(ops[0].after))) return { unchanged: true };
    if (!commit(label, ops, { unchecked: true })) return null;   // the shared benches have no guard rails: room there is shown, not refused
    return result;
  }
  async function removeTrays(id) {
    const records = await trayRecords(), farm = state.plan, plan = (farm.liveTrayPlans || []).find(p => p.id === id);
    if (!plan) return false;
    let next;
    try { next = Trays.remove(farm, id, records, { keepRecorded: true }); } catch (error) { toast(error.message); return false; }
    return commit(`Delete ${plan.name}`, Trays.ops(farm, next), { unchecked: true });
  }
  /** A plan saved by an earlier preview kept its demand plans with the records the planner does not edit. Bring them into the plan. */
  async function adoptTrayPlans() {
    if (Array.isArray(state.plan.liveTrayPlans) || !state.plan.plantings.some(p => p.liveTray)) return;
    try { const attic = await loadAttic(), kept = attic.rest.liveTrayPlans; if (Array.isArray(kept) && kept.length) { adopt({ ...state.plan, liveTrayPlans: kept }); } } catch (_) { /* the batches are still shown; the demand table says the plan record is missing */ }
  }

  /** One of this app's own settings (kept beside the plan, outside the plan's own records), as a step that can be undone. */
  function setOwn(key, value, label) {
    const before = (state.plan.lrfNext || {})[key];
    if ((before == null ? null : before) === (value == null ? null : value)) return false;
    return commit(label, [{ kind: 'own', key, before: before == null ? null : before, after: value == null ? null : value }], { unchecked: true });
  }
  // ───────────────────────── the nursery ─────────────────────────
  // The benches are a statement about the farm, like the list of assumptions: a change is never refused, it moves no
  // planting, and what it does to the room is said when it is made.
  const Nursery = root.LRFNursery;
  /**
   * One change to the benches, as a step that can be undone. `edit` is handed the nursery record as it stands and gives
   * back the changed one (or { nursery, … }). Returns null when it was refused (the reason is on the page),
   * { unchanged: true } when nothing differs, else the room on each kind of bench before and after.
   */
  function editNursery(label, edit) {
    const before = state.plan.nursery || null;
    let out;
    try { out = edit(before); } catch (error) { toast(error.message); return null; }
    const extra = out && out.nursery ? out : {}, changed = extra.nursery || out;
    if (JSON.stringify(changed) === JSON.stringify(before)) return { ...extra, unchanged: true };
    const after = { ...changed, lrfEdited: true };   // so that loading an older backup does not quietly take the benches back (IO.carry)
    const was = Nursery.roomOf(state.engine.benchList());
    if (!commit(label, [{ kind: 'nursery', before, after }], { unchecked: true })) return null;
    return { ...extra, was, now: Nursery.roomOf(state.engine.benchList()) };
  }
  /** What is on the shelf, the mix one tray, pot or crate takes, or the pots a carrying tray holds: the grower's own figures, kept beside the plan. */
  function setSupply(kind, id, value) {
    const before = (state.plan.lrfNext || {}).supplies || null;
    let after;
    try { after = Nursery.setSupply(before, kind, id, value); } catch (error) { toast(error.message); return null; }
    if (JSON.stringify(after) === JSON.stringify(before)) return { unchanged: true };
    return commit(kind === 'mix' ? 'Mix one takes' : kind === 'pockets' ? 'Pots a carrying tray holds' : 'Supplies on hand', [{ kind: 'own', key: 'supplies', before, after }], { unchecked: true }) ? { changed: true } : null;
  }
  /**
   * How a live-tray crop is sown: in cells (cells a tray, seeds a cell) or broadcast in an open tray (grams a tray).
   * change: { how?: 'cells' | 'open', cells?, perCell?, grams? }; '' clears a figure. The figures of the way not in use are kept.
   */
  function setLiveSow(cropId, change) {
    const own = (state.plan.crops || []).find(c => c.id === cropId);
    if (!own || !own.micro) { toast('This crop comes with the planner. Add it to a demand plan to give it your own figures.'); return null; }
    const after = { ...own }, live = { ...(own.liveSow && typeof own.liveSow === 'object' ? own.liveSow : {}) };
    live.how = state.engine.liveSow(state.engine.crop(cropId)).how;   // the way it is counted now, said or not
    const figure = (value, what, lo, hi, whole) => { if (value == null || String(value).trim() === '') return null; const n = Number(value); if (!Number.isFinite(n) || n < lo || n > hi || (whole && !Number.isInteger(n))) throw Error(`${what}: ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi.toLocaleString('en-US')}.`); return n; };
    try {
      if ('how' in change) { if (!['cells', 'open'].includes(change.how)) throw Error('A live tray is sown in cells or in an open tray.'); live.how = change.how; }
      if ('cells' in change) { const n = figure(change.cells, 'Cells a tray', 1, 1000, true); if (n == null) delete live.cells; else live.cells = n; }
      if ('perCell' in change) { const n = figure(change.perCell, 'Seeds a cell', 0.1, 1000, false); if (n == null) delete live.perCell; else live.perCell = Math.round(n * 10) / 10; }
      if ('grams' in change) { const n = figure(change.grams, 'Grams of seed a tray', 0, 2000, false); after.seedG = n == null ? null : Math.round(n * 10) / 10; }
    } catch (error) { toast(error.message); return null; }
    after.liveSow = live;   // once he has touched it, the way a tray is sown is on the record and no longer follows a default
    if (JSON.stringify(after) === JSON.stringify(own)) return { unchanged: true };
    const name = String(own.name || '').replace(/^micro\s*[·-]?\s*/i, '').trim();
    if (!commit(`How ${name} trays are sown`, [{ kind: 'crop', before: own, after }], { unchecked: true })) return null;
    return { changed: true, name, sow: state.engine.liveSow(state.engine.crop(cropId)) };
  }
  /** Trays are wanted on Mondays: a demand window that opens mid-week is moved to the Monday on or after it. Returns the plan and what moved. */
  function traysToMonday(farm, records) {
    const moved = [];
    let plan = farm;
    for (const tray of farm.liveTrayPlans || []) {
      let monday;
      try { monday = Trays.mondayOnOrAfter(tray.from); } catch (_) { continue; }
      if (monday === tray.from || monday > tray.through) continue;
      try { const eng = E.create(plan, Lib, { sowing: false }); plan = Trays.apply(plan, { ...tray, from: monday }, { uid, now: new Date().toISOString(), crop: id => eng.crop(id), records, keepRecorded: true }).plan; moved.push({ name: tray.name, from: tray.from, to: monday }); } catch (_) { /* that plan stays as the backup has it */ }
    }
    return { plan, moved };
  }

  /** Turn on "trays open on a Monday" for this farm and move any demand window that opens mid-week, as one step. */
  async function applyTrayStart() {
    const records = await trayRecords(), farm = state.plan, result = traysToMonday(farm, records);
    const ops = Trays.ops(farm, result.plan);
    if ((farm.lrfNext || {}).trayStart !== 'monday') ops.push({ kind: 'own', key: 'trayStart', before: (farm.lrfNext || {}).trayStart || null, after: 'monday' });
    if (!ops.length) return [];
    commit('Trays open on a Monday', ops, { unchecked: true });
    return result.moved;
  }

  function removePlantings(ids, label) {
    // a batch tied to a weekly demand plan follows it: it is changed on Live trays, never removed by itself (LRFTrays.removable)
    const { ids: free, kept } = root.LRFTrays.removable(state.plan, ids), demand = p => ((state.plan.liveTrayPlans || []).find(t => t.id === p.liveTray.planId) || {}).name || 'its plan';
    if (kept.length && !free.length) return refuse(`${cropLabel(kept[0])} follows the weekly demand in ${demand(kept[0])}: it stays. Change its weeks or trays on Live trays, in Nursery.`);
    const ops = free.map(id => state.engine.planting(id)).filter(Boolean).map(before => ({ before, after: null }));
    if (!ops.length) return;
    if (state.sel && state.sel.type === 'planting' && ids.includes(state.sel.id)) select({ type: 'bed', id: ops[0].before.bedId });
    commit(label || (ops.length === 1 ? `Remove ${cropLabel(ops[0].before)}` : `Remove ${ops.length} plantings`), ops);
    toast((ops.length === 1 ? `Removed ${cropLabel(ops[0].before)}` : `Removed ${ops.length} plantings`) + (kept.length ? ` · ${kept.length} live-tray batch${kept.length === 1 ? '' : 'es'} stay${kept.length === 1 ? 's' : ''}: ${kept.length === 1 ? 'it follows' : 'they follow'} weekly demand` : ''), { label: 'Undo', run: undo });
  }

  // ─────────────────── placing plantings (drag, tap, move) ───────────────────
  const names = list => list.length <= 2 ? list.join(' and ') : `${list[0]} and ${list.length - 1} more`;
  function heldText(result) {
    const eng = state.engine, first = (result.blockers || []).slice().sort((a, b) => a.from - b.from)[0];
    if (!first) return 'No room for these dates';
    if (first.rest) return `Resting until ${day(first.through)}`;
    return `Held by ${cropLabel(first.p)} ${first.through === Infinity ? 'all season' : first.from > result.from ? 'from ' + day(first.r.field) : 'until ' + day(first.through)}`;
  }
  /**
   * Check a drop without changing anything: used for live feedback while dragging.
   * target: { bedId, date, along?, across? }. Returns the proposal plus `text` to show.
   */
  /** Whether a drop on held ground asks to split or replace: only what comes from the library, and only on the map. */
  const asksToShare = payload => !!payload && !payload.plantingId && !payload.waitingId && state.view === 'map';
  function preview(payload, target) {
    const eng = state.engine, bed = eng.bedOf(target.bedId);
    if (payload.waitingId) return previewWaiting(payload.waitingId, target);
    let res = Rails.propose(eng, payload, target);
    // A trade is only offered where the grower can see it coming: while dragging.
    const mixingHere = !!state.mixing && state.mixing.bedId === target.bedId;
    if (res.state === 'blocked' && res.why === 'held' && payload.plantingId && !target.noSwap) res = Rails.swap(eng, payload, target) || res;
    // Ground that is held can be shared, or what holds it replaced: the drop asks which (shareDrop). Only a crop or a variety brought
    // from the library onto the map asks (asksToShare). A planting that is moved, on the map or on the timeline, trades places where
    // it can and is otherwise refused: two plantings brought up against each other are not offered a share of one bed. A pass over
    // every bed while something is in the air only asks whether the question would arise; the bed under the pointer gets the ways worked out.
    if (res.state === 'blocked' && res.why === 'held' && asksToShare(payload) && !target.noSwap && bed && eng.isSoilBed(bed)) {
      const sh = sharing(eng, payload, target);
      if (sh && (target.survey ? !sh.no.replace : sh.length || sh.rows || sh.replace)) res = { ...res, state: 'split', share: sh };
      else if (sh && sh.no.replace && sh.no.replace.who) res = { ...res, fixedBy: sh.no.replace };
    }
    const unit = bed ? eng.capUnit(bed) : 'ft', r = res.r, harvest = r ? `harvest ${span(r.first, r.last)}` : '';
    if (res.state === 'split') {
      const way = mixingHere && res.share[state.mixing.by];
      res.text = way ? (state.mixing.by === 'rows' ? `Splits the rows again: ${UI.num(way.each)} of ${UI.num(way.total)} each` : `Splits again: ${UI.num(way.each, 1)} ft each`) : `${heldText(res)} · drop to ${res.share.length || res.share.rows || target.survey ? 'split or replace' : 'replace'}`;
    } else if (res.fixedBy) res.text = `${heldText(res)}, and ${{ recorded: 'it is already recorded as sown or planted', standing: 'it stands for years', tray: 'it follows weekly demand' }[res.fixedBy.why] || 'it cannot give up ground'}`;
    else if (res.state === 'swap') res.text = `Trade places with ${names(res.traded.map(q => cropLabel(q)))}`;
    else if (res.state === 'ok') res.text = payload.plantingId ? `${payload.copy ? 'Copy' : 'Move'} here · ${harvest}` : `${day(r.field)} · ${harvest}`;
    else if (res.state === 'partial') {
      const rows = res.rect && res.rect.rows && res.rect.rows.count < res.rect.rows.total ? `${res.rect.rows.count} of ${res.rect.rows.total} rows · ` : '';
      res.text = `${rows}${UI.num(r.physicalLength, 1)} ${unit} free${res.was && res.shrunk ? ` (it has ${UI.num(res.was.len, 1)})` : ''} · ${harvest}`;
    } else res.text = { space: 'Not a growing space', crop: 'This crop cannot be planned here', 'micro-needs-bench': 'Microgreens go on a living-tray bench', 'bench-needs-micro': 'This bench takes living trays only', 'no-count': 'This bench has no tray count yet', 'too-long': 'Does not fit this space', pool: 'Live trays follow weekly demand: change it under Live trays, in the Nursery view' }[res.why] || heldText(res);
    return res;
  }
  // ─────────────────── plantings with no bed yet ───────────────────
  // A planting sent off its bed waits to be placed (and a series, before 0.84, could leave some). They live in a list of their own beside the plan (lrfNext.waiting), so nothing
  // counts them: not seeds required, sowing lists, bench load nor the forecast. Putting one on a bed makes it a planting like any other,
  // on its own date, through the same guard rails. Every change to the list is one step that can be undone.
  const Ahead = root.LRFSuccession;
  const waiting = () => Ahead.waiting(state.plan);
  const waitingOne = id => waiting().find(w => w.id === id) || null;
  const waitingOp = after => ({ kind: 'own', key: 'waiting', before: (state.plan.lrfNext || {}).waiting || null, after: after.length ? after : null });
  /** What a drop of a waiting planting would do in a space. It keeps its own date; `target.survey` is the quick pass over every space. */
  function previewWaiting(id, target) {
    const eng = state.engine, w = waitingOne(id), bed = eng.bedOf(target.bedId);
    if (!w) return { state: 'blocked', why: 'gone', text: 'That planting is no longer waiting' };
    const res = Ahead.landing(eng, w, target, { quick: !!target.survey }), unit = bed ? eng.capUnit(bed) : 'ft', r = res.r, harvest = r ? `harvest ${span(r.first, r.last)}` : '';
    if (res.state === 'ok') res.text = `${day(r.field)} · ${harvest}`;
    else if (res.state === 'split') res.text = `Held by ${cropLabel(res.holder.p)} then · drop to share the bed`;
    else if (res.state === 'partial') {
      const rows = res.rect && res.rect.rows && res.rect.rows.count < res.rect.rows.total ? `${res.rect.rows.count} of ${res.rect.rows.total} rows · ` : '';
      res.text = `${rows}${UI.num(r.physicalLength, 1)} ${unit} free${res.wants ? ` (it asks for ${UI.num(res.wants, 1)})` : ''} · ${eng.isSoilBed(bed) ? 'drop to choose' : harvest}`;
    } else res.text = { space: 'Not a growing space', crop: 'This crop cannot be planned here', 'micro-needs-bench': 'Microgreens go on a living-tray bench', 'bench-needs-micro': 'This bench takes living trays only', 'no-count': 'This bench has no tray count yet', 'too-long': 'Does not fit this space', pool: 'Live trays follow weekly demand: change it under Live trays, in the Nursery view' }[res.why] || heldText(res);
    return res;
  }
  /**
   * Put a waiting planting on a bed. A free bed takes it whole. A soil bed that is held then by one crop, or only partly free, asks how
   * the bed is to be shared (`pick` answers without asking: 'free', or { id: 'length' | 'rows', n }). Resolves to the planting, or null.
   */
  async function placeWaiting(id, bedId, aim = {}, pick) {
    const eng = state.engine, w = waitingOne(id), bed = eng.bedOf(bedId);
    if (!w || !bed) return null;
    const result = previewWaiting(id, { bedId, ...aim });
    if (result.state === 'blocked') { toast(result.why === 'held' ? heldSaid(bed, result, { waitingId: id }, E.s2d(w.date)) : result.text); return null; }
    let ops, p;
    if (result.state === 'ok' || !eng.isSoilBed(bed) || pick === 'free') { if (!result.p || result.state === 'split') return null; p = result.p; ops = [{ before: null, after: p }]; }
    else {
      let made = null;
      if (pick && pick.id) { const way = (result.ways || []).find(x => x.id === pick.id); made = way ? way.make(pick.n == null ? way.def : pick.n) : null; }
      else { const answer = root.LRFSeries ? await root.LRFSeries.share(w, bed, result) : null; made = answer === 'free' ? { ops: [{ before: null, after: result.p }], p: result.p } : answer; }
      if (!made) { if (pick) toast('That way of sharing the bed does not fit.'); return null; }
      if (state.engine !== eng) { toast('The plan changed meanwhile. Nothing was placed.'); return null; }
      ops = made.ops.slice(); p = made.p;
    }
    ops.push(waitingOp(waiting().filter(x => x.id !== id)));
    const what = cropLabel(p), shared = ops.length > 2;
    if (!commit(shared ? `Place ${what}, sharing ${bedLabel(bed)}` : `Place ${what}`, ops, { page: true })) return null;
    select({ type: 'planting', id: p.id });
    const r = state.engine.calc(p), unit = state.engine.capUnit(bed), f = state.engine.footprint(p, r);
    const size = f && f.rows && f.rows.count < f.rows.total ? ` · ${f.rows.count} of ${f.rows.total} rows` : r.partial ? ` · ${UI.num(r.physicalLength, 1)} ${unit}` : '';
    toast(`${what} → ${bedLabel(bed)} · ${day(r.field)}${size}`, { label: 'Undo', run: undo });
    return p;
  }
  // ─────────────────── a run of successions (E4) ───────────────────
  // A run is kept as a record of its own beside the plan (lrfNext.runs), and each of its plantings carries run: { id, n, gap }.
  // Its plantings are plantings like any other: they count everywhere, and go through the same guard rails.
  const runs = () => Ahead.runs(state.plan);
  const runsOp = after => ({ kind: 'own', key: 'runs', before: (state.plan.lrfNext || {}).runs || null, after: after.length ? after : null });
  /**
   * Add a run as one step, which one Undo takes back: its record and every planting LRFSuccession.planRun found a bed for.
   * Refused whole, with nothing added, when the result is an error or has no sowing, when the run is already in the plan, or when
   * the guard rails turn down any one of its plantings (the plan changed after it was worked out). True when it was added.
   */
  function addRun(result, label) {
    if (!result || result.error || !result.run || !Ahead.isRun(result.run) || !Array.isArray(result.sowings) || !result.sowings.length) return refuse((result && result.error) || 'Nothing to add: no sowing of this run has a bed.');
    if (runs().some(r => r.id === result.run.id)) return refuse('That run is already in the plan.');
    const ps = result.sowings.map(s => s.p);
    if (ps.some(p => !p || !p.run || p.run.id !== result.run.id || state.engine.planting(p.id))) return refuse('That run was worked out on another plan. Nothing was added.');
    const crop = state.engine.crop(result.run.cropId), n = ps.length;
    return commit(label || `Add a succession of ${crop ? crop.name.toLowerCase() : 'a crop'}: ${n} planting${n === 1 ? '' : 's'}`, [...ps.map(p => ({ before: null, after: p })), runsOp([...runs(), result.run])]);
  }
  /**
   * Take a run's record out, as one step. Its plantings stay, as plain plantings (their mark of the run is taken off, nothing else
   * of them changes), unless options.plantings: then they go with it. True when it was taken out.
   */
  function removeRun(id, options = {}, label) {
    const list = runs(), record = list.find(r => r.id === id);
    if (!record) return false;
    const mine = state.plan.plantings.filter(p => p.run && p.run.id === id), crop = state.engine.crop(record.cropId), what = crop ? crop.name.toLowerCase() : 'a crop';
    const ops = mine.map(before => { if (options.plantings) return { before, after: null }; const after = { ...before }; delete after.run; return { before, after }; });
    // a planting of the run sent to To place waits with its mark of the run: it goes with the run, or loses the mark, as the others do (Codex on #103)
    const list0 = waiting(), held = list0.filter(w => w.run && w.run.id === id);
    if (held.length) ops.push(waitingOp(options.plantings ? list0.filter(w => !(w.run && w.run.id === id)) : list0.map(w => { if (!(w.run && w.run.id === id)) return w; const after = { ...w }; delete after.run; return after; })));
    if (options.plantings && state.sel && state.sel.type === 'planting' && mine.some(p => p.id === state.sel.id)) select(null);
    // nothing takes new ground: a planting given up, or the same planting less its mark, never overlaps anything it did not already
    const n = mine.length + held.length;
    return commit(label || (options.plantings ? `Remove a succession of ${what} and its ${n} planting${n === 1 ? '' : 's'}` : `Remove a succession of ${what}, keeping its plantings`), [...ops, runsOp(list.filter(r => r.id !== id))], { unchecked: true });
  }
  function removeWaiting(ids, label) {
    const gone = new Set(ids), list = waiting(), left = list.filter(w => !gone.has(w.id)), n = list.length - left.length;
    if (!n) return false;
    if (state.sel && state.sel.type === 'waiting' && gone.has(state.sel.id)) select(null);
    const said = label || (n === 1 ? `Remove ${cropLabel(list.find(w => gone.has(w.id)))}, not yet placed` : `Remove ${n} plantings not yet placed`);
    if (!commit(said, [waitingOp(left)])) return false;
    toast(n === 1 ? `Removed ${cropLabel(list.find(w => gone.has(w.id)))}. It had no bed yet.` : `Removed ${n} plantings that had no bed yet`, { label: 'Undo', run: undo });
    return true;
  }
  /** Change a waiting planting: its date, its variety, the feet it asks for. Still no bed, still counted nowhere. */
  function updateWaiting(id, change, label) {
    const list = waiting(), before = list.find(w => w.id === id);
    if (!before) return false;
    const after = changed(before, change);
    delete after.bedId;
    if (!Ahead.isWaiting(after)) { toast('Choose a real calendar date.'); return false; }
    return commit(label || 'Change a planting not yet placed', [waitingOp(list.map(w => w.id === id ? after : w))]);
  }

  const sameSpot = (a, b) => a.bedId === b.bedId && a.date === b.date && (a.ft || 0) === (b.ft || 0) && (a.trays || 0) === (b.trays || 0) && (a.startFt || 0) === (b.startFt || 0) && JSON.stringify(a.bedLayout || null) === JSON.stringify(b.bedLayout || null);
  // ── a bed that is held: split it, or replace what is there ──
  let sharedMemo = { eng: null, key: '', value: null };
  /** Rails.share for a drop, remembered while the pointer stays on the same foot of the same bed. */
  function sharing(eng, payload, target) {
    const key = `${target.survey ? 'q' : 'f'}|${target.bedId}|${+target.date}|${JSON.stringify(payload)}|${target.along == null ? '' : Math.round(target.along)}`;
    if (sharedMemo.eng !== eng || sharedMemo.key !== key) sharedMemo = { eng, key, value: Rails.share(eng, payload, target, target.survey ? { quick: true } : {}) };
    return sharedMemo.value;
  }
  function setMixing(next) {
    const was = state.mixing;
    if ((was && was.bedId) === (next && next.bedId) && (was && was.by) === (next && next.by)) return;
    state.mixing = next; emit('mixing');
  }
  const worthOf = eng => root.LRFForecast.build(eng).rows.reduce((n, r) => n + r.worth, 0);
  const worthSaid = (was, now) => Math.abs(now - was) >= 0.5 ? `the season’s worth goes from ${dollars(was)} to ${dollars(now)}` : `the season’s worth stays ${dollars(now)}`;
  const plantsSaid = x => `${cropLabel(x.p)} goes from ${UI.num(x.was.plants)} plant${x.was.plants === 1 ? '' : 's'} to ${UI.num(x.now.plants)}`;
  /** What each way would do, in a line, said before it is chosen. */
  function shareLines(sh, payload) {
    const eng = state.engine, what = cropLabel(sh.base), bed = sh.bed, cap = eng.capOf(bed), out = {};
    const held = way => way.shares.filter(x => !x.isNew && x.was && x.was.plants !== x.now.plants), counts = way => { const list = held(way); return list.length ? ` ${plantsSaid(list[0])}${list.length > 1 ? `, and ${list.length - 1} more likewise` : ''}.` : ''; };
    if (sh.length) {
      const w = sh.length, n = w.shares.length, mine = w.shares.find(x => x.isNew) || w.shares[w.shares.length - 1];
      out.length = w.equal ? `${n === 2 ? `${cropLabel(w.shares.find(x => x !== mine).p)} and ${what} take` : `All ${n} take`} ${UI.num(w.each, 1)} ft each of ${UI.num(cap, 1)}.${counts(w)}`
        : `${held(w).length ? cropLabel(held(w)[0].p) : 'The share it is dropped on'} keeps ${UI.num(held(w).length ? held(w)[0].now.len : w.each, 1)} ft and ${what} takes ${UI.num(w.each, 1)}.${counts(w)}`;
    }
    if (sh.rows) { const w = sh.rows, n = w.shares.length; out.rows = `${n === 2 ? `${cropLabel(w.shares.find(x => !x.isNew).p)} keeps ${UI.num(w.each)} of ${UI.num(w.total)} rows and ${what} takes ${UI.num(w.each)}` : `All ${n} take ${UI.num(w.each)} of ${UI.num(w.total)} rows each`}.${counts(w)}`; }
    if (sh.replace) { const gone = sh.holders.map(o => cropLabel(o.p)), one = gone.length === 1; out.replace = `${what} takes ${sh.replace.r && sh.replace.r.partial ? 'the ground' : 'the bed'}. ${names(gone)} ${one ? 'leaves it and waits' : 'leave it and wait'} under To place, with ${one ? 'its date' : 'their dates'}.`; }
    return out;
  }
  let asking = null;
  /** The question, asked at the bed: split the length, split the rows, or replace. Resolves to the way chosen, or null. Nothing changes until one is. */
  function askShare(sh, payload) {
    if (asking) asking(null);
    return new Promise(resolve => {
      const eng = state.engine, bed = sh.bed, lines = shareLines(sh, payload), first = sh.holders.slice().sort((a, b) => a.from - b.from)[0], n = sh.holders.length;
      const done = value => { if (asking !== done) return; asking = null; root.removeEventListener('keydown', onKey, true); root.removeEventListener('pointerdown', onAway, true); box.remove(); resolve(value); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      const onAway = e => { if (!box.contains(e.target)) done(null); };
      const way = (id, title, line) => line ? h('button.fix-btn', { type: 'button', dataset: { way: id }, onclick: () => done(id) }, h('b', title), h('small', line)) : null;
      const through = Math.max(...sh.holders.map(o => +o.through)), until = Number.isFinite(through) ? `to ${day(new Date(through))}` : 'for the rest of the season';
      const not = [['length', 'the length'], ['rows', 'the rows']].filter(([id]) => !sh[id] && sh.no[id] && !['rows'].includes(sh.no[id].why)).map(([id, word]) => `${word} cannot be split here (${{ short: 'a share would be under a foot', crowded: 'another crop lies in the feet that would be given up', fit: 'it would not fit' }[sh.no[id].why] || 'it would not fit'})`);
      const box = h('div.share-ask', { id: 'shareAsk', role: 'dialog', 'aria-label': `${bedLabel(bed)} is held` },
        h('button.icon-btn.close', { type: 'button', id: 'shareAskClose', 'aria-label': 'Close', title: 'Close. Nothing is planted.', onclick: () => done(null) }, '×'),
        h('p.share-ask-head', h('b', `${bedLabel(bed)} is held by ${n === 1 ? cropLabel(first.p) : `${cropLabel(first.p)} and ${n - 1} more`}`), h('small', `${day(first.r.field)} ${until}. No date changes, whichever you choose.`)),
        h('div.fix-actions', way('length', 'Split the length', lines.length), way('rows', 'Split the rows', lines.rows), way('replace', 'Replace', lines.replace)),
        not.length ? h('p.help', { id: 'shareAskNot' }, `${not.join('; ').replace(/^./, c => c.toUpperCase())}.`) : null,
        sh.length || sh.rows ? h('p.help', 'After a split, the next variety dropped on this bed splits it again without asking, until you press Done.') : null);
      document.body.append(box);
      // beside the bed where it is drawn; in the middle of the page where it is not (a drop on the Timeline)
      const el = state.view === 'map' ? document.querySelector(`#mapBeds [data-bed="${CSS.escape(bed.id)}"]`) : null, at = el ? el.getBoundingClientRect() : null, w = box.offsetWidth, hgt = box.offsetHeight, vw = root.innerWidth, vh = root.innerHeight;
      const left = at ? (at.right + 14 + w <= vw - 8 ? at.right + 14 : at.left - 14 - w >= 8 ? at.left - 14 - w : Math.max(8, vw - w - 8)) : (vw - w) / 2, top = at ? Math.min(Math.max(60, at.top), Math.max(60, vh - hgt - 8)) : Math.max(60, (vh - hgt) / 3);
      box.style.left = `${Math.round(left)}px`; box.style.top = `${Math.round(top)}px`;
      asking = done;
      root.addEventListener('keydown', onKey, true);
      setTimeout(() => { if (asking === done) root.addEventListener('pointerdown', onAway, true); }, 0);
      const firstBtn = box.querySelector('.fix-btn'); if (firstBtn) firstBtn.focus();
    });
  }
  /** Make the split or the replacement, in one step, and say what it did. */
  function applyShare(payload, sh, by) {
    const eng = state.engine, way = sh[by], bed = sh.bed;
    if (!way) return null;
    const ops = way.ops.slice(), what = cropLabel(way.p), where = bedLabel(bed);
    if (by === 'replace') ops.push(waitingOp([...waiting(), ...way.waiting]));
    const gone = sh.holders.map(o => cropLabel(o.p));
    const label = by === 'replace' ? `Replace ${names(gone)} with ${what}` : `Split ${where} for ${what}`;
    const was = worthOf(eng);
    if (!commit(label, ops, { page: true })) return null;
    const now = worthOf(state.engine), n = way.shares.length;
    setMixing(by === 'replace' ? null : { bedId: bed.id, by });
    select({ type: 'planting', id: way.p.id });
    toast(by === 'replace' ? `${what} took ${where} · ${names(gone)} ${gone.length === 1 ? 'waits' : 'wait'} under To place · ${worthSaid(was, now)}`
      : `${what} → ${where} · ${by === 'rows' ? `${UI.num(way.each)} of ${UI.num(way.total)} rows` : `${UI.num(way.each, 1)} ft`}${way.equal && n > 2 ? `, as each of the ${n} has` : ''} · ${worthSaid(was, now)}`, { label: 'Undo', run: undo });
    return state.engine.planting(way.p.id);
  }
  /** A drop onto ground that is held: asked once a bed, then split the same way again for as long as that bed is being mixed. */
  async function shareDrop(payload, target, result) {
    const eng = state.engine, sh = result.share.length || result.share.rows || result.share.replace ? result.share : Rails.share(eng, payload, target);
    let by = state.mixing && state.mixing.bedId === target.bedId && sh[state.mixing.by] ? state.mixing.by : null;
    if (!by) {
      by = await askShare(sh, payload);
      if (!by) return null;
      if (state.engine !== eng) { toast('The plan changed meanwhile. Nothing was planted.'); return null; }
    }
    return applyShare(payload, sh, by);
  }
  /** Equal shares again for the plantings that stand together with this one. */
  function equalShares(plantingId) {
    const eng = state.engine, p = eng.planting(plantingId), group = p ? Rails.mates(eng, p) : [];
    if (group.length < 2) return false;
    const res = Rails.equalize(eng, group.map(x => x.p.id)), bed = eng.bedOf(p.bedId);
    if (res.no) { toast({ recorded: `${cropLabel(res.who)} is already recorded as sown or planted: its ground is not changed.`, standing: `${cropLabel(res.who)} stands for years: its ground is not changed.`, rows: 'The rows of this bed do not divide evenly among them.', short: 'A share would come to under a foot.' }[res.no] || 'They cannot be given equal shares as they stand.'); return false; }
    if (!res.ops.length) { toast('They already have equal shares.'); return false; }
    const was = worthOf(eng);
    const twice = Rails.cleanup(eng).groups.length;
    if (!commit(`Equal shares in ${bedLabel(bed)}`, res.ops)) return false;
    const settled = twice - Rails.cleanup(state.engine).groups.length;   // where they were booked into the same ground, sharing it settles that
    toast(`Equal shares in ${bedLabel(bed)}${settled > 0 ? ' · that ground is no longer booked twice' : ''} · ${worthSaid(was, worthOf(state.engine))}`, { label: 'Undo', run: undo });
    return true;
  }
  /**
   * Several varieties in the bed a planting stands in: each variety named becomes a planting of its own beside it, with its date
   * and its choices, and the bed is shared again in equal parts among all that stand in it together (Rails.equalize).
   * Worked out here without changing anything.
   * Returns { ops, added, n, bed, by, len, plants: [was, now] } or { no: the reason in words }.
   */
  function planVarieties(plantingId, varietyIds, by = 'length') {
    const eng = state.engine, p0 = eng.planting(plantingId), bed = p0 && eng.bedOf(p0.bedId);
    if (!p0 || !bed || !eng.isSoilBed(bed)) return { no: 'Only a bed in the ground can be divided this way.' };
    if (!varietyIds.length) return { no: 'Tick the varieties to add.' };
    // each variety is a copy of the planting: its date and its choices, another variety, no record of work, and ground of its own
    const drafts = varietyIds.map(varietyId => { const d = { ...p0, id: uid(), varietyId }; for (const key of ['variety', 'done', 'workflow', 'flagReviews', 'planningSource', 'standId', 'plantedIn', 'tasks', 'failed', 'sowOn', 'seat', 'ft', 'startFt', 'bedLayout', 'run']) delete d[key]; return d; });
    const group = Rails.mates(eng, p0), res = Rails.equalize(eng, group.length ? group.map(x => x.p.id) : [p0.id], { extra: drafts, by });
    if (res.no) return { no: res.who ? `${cropLabel(res.who)} cannot give up ground: it ${{ recorded: 'is already recorded as sown or planted', standing: 'stands for years', tray: 'follows weekly demand' }[res.no] || 'is held'}.`
      : res.no === 'rows' ? (by === 'rows' ? 'The rows of this bed do not divide evenly among that many, or the bed is already shared along its length.' : 'This bed is shared by rows: choose By rows.')
        : res.no === 'short' ? 'A share would come to under a foot.' : 'They would not fit beside what else is planted in this bed on those days.' };
    const mine = res.shares.find(x => x.p.id === plantingId), r0 = eng.calc(p0);
    return { ops: res.ops, added: drafts.map(d => d.id), n: (group.length || 1) + drafts.length, bed, by, len: mine ? mine.now.len : r0.physicalLength, rows: by === 'rows' ? { count: res.each, total: res.total } : null, plants: [r0.plants, mine ? mine.now.plants : r0.plants] };
  }
  /** Make it so, in one step. Returns the ids of the plantings added, or null. */
  function addVarieties(plantingId, varietyIds, by = 'length') {
    const plan = planVarieties(plantingId, varietyIds, by);
    if (plan.no) { toast(plan.no); return null; }
    const was = worthOf(state.engine);
    if (!commit(`Divide ${bedLabel(plan.bed)} among ${plan.n} varieties`, plan.ops)) return null;
    toast(`${bedLabel(plan.bed)}: ${plan.n} plantings, ${by === 'rows' ? `${UI.num(plan.rows.count)} of ${UI.num(plan.rows.total)} rows each` : `${UI.num(plan.len, 1)} ft each`} · ${worthSaid(was, worthOf(state.engine))}`, { label: 'Undo', run: undo });
    return plan.added;
  }
  /** A planting taken out of its bed and sent to wait under To place, with its date; those it stood with share its ground again. One step. */
  function sendToWait(plantingId, options = {}) {
    const eng = state.engine, p = eng.planting(plantingId), r = p && eng.calc(p), bed = r && r.b;
    if (!p || !r || eng.isPool(bed)) return false;
    const stuck = Rails.fixed(eng, { p });
    if (stuck) { toast(`${cropLabel(p)} ${{ recorded: 'is already recorded as sown or planted', standing: 'stands for years', tray: 'follows weekly demand' }[stuck]}: it stays where it is.`); return false; }
    const w = { ...p }, asked = !p.bedLayout && +p.ft > 0 && r.physicalLength < r.cap - 1e-6 ? +p.ft : null;
    for (const key of ['bedId', 'ft', 'startFt', 'bedLayout', 'trays', 'shelter', 'out', 'seat']) delete w[key];
    if (asked) w.ft = asked;
    const run = p.run && runs().find(x => x.id === p.run.id);
    if (run?.kind === 'containers') w.ft = r.physicalLength;
    if (run?.kind === 'bench') w.trays = r.physicalLength;
    w.wait = { why: options.why || 'It was taken out of its bed', from: bed.id };
    const ops = [{ before: p, after: null }];
    // the ones it stood with take up its ground: two or more in equal shares; one alone, the whole bed again where it held the full width
    const others = eng.isSoilBed(bed) ? Rails.mates(eng, p).filter(x => x.p.id !== p.id) : [];
    if (others.length) {
      const without = E.create({ ...eng.plan, plantings: eng.plan.plantings.filter(q => q.id !== p.id) }, Lib);
      if (others.length >= 2) { const res = Rails.equalize(without, others.map(x => x.p.id)); if (res.ops) ops.push(...res.ops); }
      else {
        const q = others[0].p, f = others[0].rect;
        if (!q.bedLayout && (!f.rows || f.rows.count === f.rows.total) && !Rails.fixed(eng, others[0])) {
          const whole = { ...q }; delete whole.ft; delete whole.startFt;
          if (!Rails.refusal(without, E.create({ ...without.plan, plantings: without.plan.plantings.map(x => x.id === q.id ? whole : x) }, Lib), [q.id])) ops.push({ before: q, after: whole });
        }
      }
    }
    ops.push(waitingOp([...waiting(), w]));
    const was = worthOf(eng);
    if (!commit(`Send ${cropLabel(p)} to wait`, ops)) return false;
    toast(`${cropLabel(p)} left ${bedLabel(bed)} and waits under To place · ${worthSaid(was, worthOf(state.engine))}`, { label: 'Undo', run: undo });
    return true;
  }
  // a bed stops being mixed when something outside it is selected, when another view is shown, or on Escape
  on('sel', () => { const m = state.mixing, sel = state.sel; if (!m || !sel) return; const inBed = sel.type === 'planting' ? (state.engine.planting(sel.id) || {}).bedId === m.bedId : sel.type === 'bed' && sel.id === m.bedId; if (!inBed) setMixing(null); });
  on('view', () => { if (state.mixing && state.view !== 'map') setMixing(null); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && state.mixing && !asking && !(root.LRFDrag && root.LRFDrag.active()) && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) setMixing(null); });
  /**
   * A drop turned down because the ground is held names the day it was judged on (L3): on the map a crop from the library goes in
   * on the map's date and a planting keeps its own; on the Timeline it is the day it was dropped on.
   */
  function heldSaid(bed, result, payload, date) {
    const source = payload.plantingId ? state.engine.planting(payload.plantingId) : null, own = !!payload.waitingId || (!!source && E.d2s(date) === source.date);
    const when = own ? `judged on its own date, ${day(date)}` : state.view === 'map' ? `judged on ${day(date)}, the map’s date` : `judged on ${day(date)}`;
    return `${bedLabel(bed)}: ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)} · ${when}`;
  }
  /** How far a planting moved, said with the move (L3): "4 days later, May 19 → May 23". Nothing when its day stayed. */
  function movedSaid(was, now) {
    const n = was && now ? E.dayDiff(now, was) : 0;
    return n ? `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'later' : 'earlier'}, ${day(was)} → ${day(now)}` : '';
  }
  function place(payload, bedId, date, aim = {}) {
    if (payload.waitingId) { placeWaiting(payload.waitingId, bedId, aim); return null; }   // it may ask how to share the bed first
    const result = preview(payload, { bedId, date, ...aim }), bed = state.engine.bedOf(bedId);
    if (state.mixing && state.mixing.bedId !== bedId) setMixing(null);   // a drop somewhere else ends the mixing of a bed
    if (result.state === 'split') { shareDrop(payload, { bedId, date, ...aim }, result); return null; }   // it asks first, unless this bed is being mixed
    if (result.state === 'blocked') { toast(bed && result.why === 'held' ? heldSaid(bed, result, payload, date) : result.text); return null; }
    const p = result.p, before = payload.plantingId && !payload.copy ? state.engine.planting(payload.plantingId) : null;
    if (before && sameSpot(before, p)) return null;
    const what = cropLabel(p), where = bedLabel(bed), unit = state.engine.capUnit(bed), r0 = before ? state.engine.calc(before) : null;
    const ops = result.state === 'swap' ? result.ops : [{ before, after: p }];
    const label = result.state === 'swap' ? `Trade ${what} with ${names(result.traded.map(q => cropLabel(q)))}` : before ? `Move ${what}` : payload.copy ? `Copy ${what}` : `Plant ${what}`;
    if (!commit(label, ops, { page: true })) return null;
    select({ type: 'planting', id: p.id });
    const r = state.engine.calc(p), size = result.state === 'partial' || r.partial ? ` · ${UI.num(r.physicalLength, 1)} ${unit}` : '';
    const moved = result.state !== 'swap' && r0 ? movedSaid(r0.field, r.field) : '';
    toast(result.state === 'swap' ? `${what} traded places with ${names(result.traded.map(q => cropLabel(q)))}`
      : moved ? (before.bedId === bedId ? `${what}, ${where}: ${moved}${size}` : `${what} → ${where} · ${moved}${size}`) : `${what} → ${where} · ${day(r.field)}${size}`, { label: 'Undo', run: undo });
    return p;
  }
  /** Add plantings worked out elsewhere (a series of successions, a crop for an opening) as one step. The guard rails still have the last word. */
  function addPlantings(list, label) {
    const ops = (list || []).map(p => ({ before: null, after: p }));
    return ops.length ? commit(label || `Add ${ops.length} planting${ops.length === 1 ? '' : 's'}`, ops) : false;
  }
  /**
   * Plan ahead with something in mind: { mode: 'succession', sourceId?, cropId?, varietyId?, thing?, bedId?, gardenId?, from?, by? } opens
   * the Successions page on a new run filled in from it; { bedId, openingId } shows that opening in the details panel, as a click on it does.
   */
  function openAhead(focus) {
    focus = focus || {};
    if (focus.mode === 'succession') { if (root.LRFSuccessions) root.LRFSuccessions.open(focus); return; }
    if (focus.openingId && focus.bedId) select({ type: 'opening', id: focus.openingId, bedId: focus.bedId });
    else if (focus.bedId) select({ type: 'bed', id: focus.bedId });
  }

  /**
   * Names this app has since changed, put right on a plan as it is opened. The stand-in space live trays are filed under may
   * still be named "Shared heated space"; here it is the heated greenhouse benches. Every plan opened or loaded passes through
   * here, so a full backup loaded later is renamed too, with nothing to remember.
   */
  function tidy(plan) {
    let changed = false;
    const gardens = (plan.gardens || []).map(g => { const after = Trays.poolRenamed(g); if (after) changed = true; return after || g; });
    return changed ? { ...plan, gardens } : plan;
  }

  // ─────────────────────────── backup in / out ───────────────────────────
  const emptyAttic = () => ({ v: 1, rest: {}, varieties: {} });
  async function loadAttic() {
    if (state.attic) return state.attic;
    const source = (state.plan.lrfNext && state.plan.lrfNext.attic) || 'none';
    if (source === 'cloud') { const text = await store.loadBlob('attic'); if (text) return (state.attic = JSON.parse(text)); throw new Error('The stored backup records are missing. Load the backup again before downloading one.'); }
    if (source === 'session') throw new Error('Some records that came with the backup were only held for the session they were loaded in. Load the backup again before downloading one.');
    return (state.attic = emptyAttic());
  }
  async function exportBackup() {
    try {
      const attic = await loadAttic(), extras = await loadExtras();
      const plan = withOwn(IO.join(state.plan, { ...attic, varieties: { ...(attic.varieties || {}), ...extras.varieties } }), new Date().toISOString()), text = JSON.stringify(plan);
      const filename = `little-river-plan-${planYear()}-${E.d2s(new Date())}.json`;
      const downloads = root.claude && root.claude.use ? await root.claude.use('downloads') : null;
      const planOnly = !(state.plan.lrfNext && state.plan.lrfNext.attic === 'cloud');
      const done = planOnly ? 'Plan file saved. It holds the plan only: not the saved supplier pages or the photos.' : 'Backup saved.';
      const noted = () => adopt({ ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), lastExport: new Date().toISOString() } }, state.engine);
      if (downloads) { await downloads.save({ filename, data: new Blob([text], { type: 'application/json' }) }); noted(); toast(done); return true; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = h('a', { href: url, download: filename });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      noted(); toast('Backup download started.');
      return true;
    } catch (error) {
      if (error && error.code === 'declined') return false;
      toast(`Backup not saved: ${(error && error.message) || 'downloads are not available in this view'}`);
      return false;
    }
  }
  /** .zip (complete backup) or .json (plan only) -> { plan, image } */
  async function readBackupFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer()), Zip = root.LRFZip;
    if (!Zip.isZip(bytes)) return { plan: JSON.parse(new TextDecoder().decode(bytes)), image: null, zip: null };
    const entries = Zip.directory(bytes), planEntry = entries.get('plan.json');
    if (!planEntry) throw new Error('This zip has no plan.json. Use a backup made by the planner.');
    const plan = JSON.parse(new TextDecoder().decode(await Zip.read(bytes, planEntry))), ref = plan.map && plan.map.imageFile;
    const imageEntry = ref && ref.sha256 ? entries.get('files/' + ref.sha256) : null;
    const image = imageEntry ? { sha256: ref.sha256, mime: /^image\/(jpeg|png|webp)$/.test(ref.mime || '') ? ref.mime : 'image/jpeg', bytes: await Zip.read(bytes, imageEntry) } : null;
    return { plan, image, zip: { bytes, entries } };
  }
  const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fromBase64 = text => { const s = atob(text), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  function showMapImage(bytes, mime) {
    if (state.mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(state.mapImageUrl);
    state.mapImageUrl = bytes ? URL.createObjectURL(new Blob([bytes], { type: mime })) : bundledImage();
  }
  /** The farm photo that ships with the page, when it is the one this plan was drawn on. */
  function bundledImage() {
    const ref = state.plan && state.plan.map && state.plan.map.imageFile, shipped = state.bundled && state.bundled.mapImage;
    return shipped && ref && ref.sha256 === shipped.sha256 ? shipped.src : '';
  }
  /** What kind of picture some bytes are, read from their first few. */
  const mimeOf = b => b && b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? 'image/webp' : b && b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : 'image/jpeg';
  async function restoreMapImage() {
    let info = state.plan.lrfNext && state.plan.lrfNext.mapImage;
    if (store.backend === 'memory') return;
    try {
      const text = await store.loadBlob('mapimage');
      if (!text) return;
      const bytes = fromBase64(text);
      if (!info) {
        // The plan has lost its note of the photo while the photo itself is still kept here (a plan opened from the cloud once
        // dropped it). Where the bytes are the very picture this plan was drawn on, the note is written again; any other picture is left alone.
        const ref = state.plan.map && state.plan.map.imageFile, hash = ref && ref.sha256 ? await digest(bytes) : null;
        if (!hash || hash !== ref.sha256) return;
        info = { mime: mimeOf(bytes), sha256: hash };
        state.plan = { ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), mapImage: info } };
        rebuild();
        store.save(state.plan);
      }
      showMapImage(bytes, info.mime); emit('plan');
    } catch (_) { /* the plan is still usable without its photo */ }
  }
  async function importBackup(file, extra = {}) {
    while (joinBusy) await joinBusy;   // another device's changes are being taken in: a whole plan is loaded after that, never across it
    if (elsewhere()) return refuse(elsewhere());   // a whole plan is never loaded in a window that only shows the plan: nothing is kept, replaced or saved
    let parsed;
    try { parsed = await readBackupFile(file); IO.assertPlan(parsed.plan); } catch (error) { toast(`That file could not be read: ${error.message}`); return false; }
    // A file this app saved carries a note of what was settled here; any other full backup has no such note.
    const own = parsed.plan.lrfNextKeep && typeof parsed.plan.lrfNextKeep === 'object' ? parsed.plan.lrfNextKeep : null;
    delete parsed.plan.lrfNextKeep;
    const ownKeep = {};
    for (const key of OWN_KEYS) if (own && own.keep && own.keep[key] != null) ownKeep[key] = own.keep[key];
    if (extra.image && !parsed.image) parsed.image = extra.image;
    const split = IO.split(parsed.plan), attic = split.attic, info = IO.summary(split.core), replacing = !isSample();
    // The plan comes from the backup. What was established here about the farm is put back on it.
    // (Not for a snapshot or the cloud's plan: those are this app's own plan at another moment, and are opened exactly as they were.)
    const carried = extra.exact ? { plan: split.core, keep: {}, notes: [], gone: [] } : IO.carry(state.plan, split.core);
    // A file this app saved says for itself what was waiting to be placed, even when that is nothing: the list open here does not ride over it.
    const leftBehind = own && carried.keep.waiting && !ownKeep.waiting ? carried.keep.waiting.length : 0;
    if (own && carried.keep.waiting) { delete carried.keep.waiting; carried.notes = carried.notes.filter(n => !/waiting to be placed$/.test(n)); }
    let core = carried.plan;
    const records = { harvests: attic.rest.harvests, fieldRecords: attic.rest.fieldRecords };
    const monday = carried.keep.trayStart === 'monday' ? traysToMonday(core, records) : { plan: core, moved: [] };
    core = monday.plan;
    const kept = [...carried.notes, ...monday.moved.map(m => `${m.name} opening on a Monday (${day(E.s2d(m.to))}, not ${day(E.s2d(m.from))})`)];
    if (state.unreadable) {
      const ok = await UI.confirm({ title: 'Replace what is stored here?', body: `The plan stored in this browser could not be opened. Loading this one (${info.plantings} plantings for ${info.year || 'an unknown year'}) puts it in that place, and what is stored now is gone for good. If it may hold work that is nowhere else, cancel and use “Download what is stored” first.`, confirmLabel: 'Replace it', danger: true });
      if (!ok) return false;
      store.release(); state.unreadable = null;
    } else if (replacing && !extra.asked) {
      const ok = await UI.confirm({
        title: 'Replace the plan in this app?',
        body: `The backup holds ${info.plantings} plantings in ${info.beds} growing spaces across ${info.gardens} gardens for ${info.year || 'an unknown year'}. Plantings, tray demand and seed stock are replaced by the backup’s, including what was changed here. ${kept.length ? `Kept from this copy: ${kept.join('; ')}. ` : ''}${leftBehind ? `The ${leftBehind} planting${leftBehind === 1 ? '' : 's'} still to place here ${leftBehind === 1 ? 'is' : 'are'} not in that file and will be gone. ` : ''}${carried.gone.length ? `${carried.gone.length} variet${carried.gone.length === 1 ? 'y' : 'ies'} here ${carried.gone.length === 1 ? 'is' : 'are'} not in the backup and will be gone (${carried.gone.slice(0, 3).join(', ')}${carried.gone.length > 3 ? '…' : ''}). ` : ''}The backup file itself is not changed.`,
        confirmLabel: 'Replace plan', danger: true
      });
      if (!ok) return false;
    }
    // Whatever replaces a whole plan, the plan that was open is kept as a snapshot first, so it can be gone back to.
    if (replacing) state.lastAuto = await snapshot(extra.why || `Before loading ${file.name}`, { auto: true, skipSame: true });
    const cloud = store.backend !== 'memory';   // somewhere durable to keep the photo and the rest of the backup
    // A file that holds the plan only brings no pictures. The ones already here stay with the varieties they belong to, and the
    // farm photo stays while the new plan was drawn on the same one, so loading a newer plan file does not strip the app bare.
    const planOnly = !parsed.zip && !extra.thumbs, was = replacing ? state.plan : null, wasInfo = (was && was.lrfNext) || {}, sameRef = (a, b) => !!(a && b && a.sha256 && a.sha256 === b.sha256);
    const keptIds = new Set(core.varieties.map(v => v.id)), carriedThumbs = {};
    if (planOnly && was) for (const [id, uri] of Object.entries(Thumbs.all())) if (keptIds.has(id)) carriedThumbs[id] = uri;
    // The farm photo is kept on its own terms, whether or not variety photos came with the plan: a plan opened from the cloud
    // brings only the photos that changed there, and new variety photos must not cost the browser its farm photo.
    const keepMap = !parsed.zip && !parsed.image && !!wasInfo.mapImage && !!state.mapImageUrl && sameRef(core.map && core.map.imageFile, was && was.map && was.map.imageFile);
    core.lrfNext = { attic: cloud ? 'cloud' : 'session', importedAt: new Date().toISOString(), from: file.name, backup: (parsed.plan.backup && parsed.plan.backup.exportedAt) || parsed.plan._localUpdatedAt || null, ...carried.keep, ...ownKeep, ...(keepMap ? { mapImage: wasInfo.mapImage } : {}) };
    core = tidy(core);
    planLoads++;
    state.plan = core; state.attic = attic; state.extras = emptyExtras(); state.inventoryBase = null; state.inventoryAsked = null; state.packsBase = {}; state.keptThumbs = carriedThumbs; Thumbs.set(carriedThumbs); refreshRemote(); thumbsRev++; state.undo.length = 0; state.redo.length = 0; state.sel = null; delete document.body.dataset.sel;
    if (!keepMap) showMapImage(parsed.image && parsed.image.bytes, parsed.image && parsed.image.mime);
    rebuild(); state.date = defaultDate(); root.LRFMap.fit(true);
    emit('plan'); emit('date'); emit('sel');
    const gaps = photoGaps(), lacking = planOnly ? [gaps.map ? 'no farm photo' : '', gaps.varieties ? `${gaps.varieties} variety photo${gaps.varieties === 1 ? '' : 's'} missing` : ''].filter(Boolean) : [];
    if (!extra.quiet) toast(`Loaded ${core.plantings.length} plantings in ${info.beds} growing spaces from ${file.name}${kept.length ? `. Kept from this copy: ${kept.join('; ')}` : ''}${lacking.length ? `. This file holds the plan only: ${lacking.join(', ')}. See the overview` : ''}`);
    const ownThumbs = async () => {
      if (!extra.thumbs) return;
      try { const kept = JSON.parse(extra.thumbs); state.keptThumbs = kept; Thumbs.set(kept); Thumbs.index(state.plan); emit('plan'); if (store.backend !== 'memory') await store.saveBlob('thumbs', extra.thumbs); } catch (_) { /* the plan is open without its small photos */ }
    };
    if (!cloud) { store.save(core); await importPhotos(parsed, 'memory'); await ownThumbs(); rebuildThumbs(); if (sync) sync.touch(); return true; }
    const where = store.backend;
    try { await store.clearBlob('attic-new'); } catch (_) { /* nothing was kept */ }
    // The plan itself is saved first; the bulky extras follow and may fail without harming it.
    try { await store.saveNow(core); } catch (error) { toast('The plan is open but could not be saved here yet. Use the save indicator to retry.'); return true; }
    try {
      await store.saveBlob('attic', JSON.stringify(attic), (i, n) => showStatus({ backend: where, state: 'saving', label: `Storing records ${i}/${n}` }));
      if (parsed.image) {
        await store.saveBlob('mapimage', toBase64(parsed.image.bytes), (i, n) => showStatus({ backend: where, state: 'saving', label: `Storing map photo ${i}/${n}` }));
        core.lrfNext.mapImage = { mime: parsed.image.mime, sha256: parsed.image.sha256 };
      }
    } catch (error) {
      core.lrfNext.attic = 'session';
      toast('The plan is saved, but the extra backup records could not be stored here. Keep the backup file.');
    }
    await importPhotos(parsed, where);
    await ownThumbs();
    store.save(core);
    folderSoon();
    if (sync) sync.touch();
    rebuildThumbs();
    return true;
  }

  /** Files dropped on the page, sorted by what they are: pictures and photo files join the open plan; a plan or a backup replaces it, after asking. */
  async function openFiles(files) {
    const photos = [], plans = [];
    for (const file of [...(files || [])].filter(Boolean)) {
      let head = new Uint8Array(0);
      try { head = new Uint8Array(await file.slice(0, 400).arrayBuffer()); } catch (_) { /* importBackup says what is wrong with it */ }
      const text = pictureType(head) || root.LRFZip.isZip(head) ? '' : new TextDecoder().decode(head);
      if (pictureType(head) || /^\s*\{\s*"format"\s*:\s*"lrf-photos-1"/.test(text) || /^\s*\{\s*"[^"]+"\s*:\s*"data:image\//.test(text)) photos.push(file); else plans.push(file);
    }
    if (photos.length) await addPhotos(photos);
    if (plans.length) await importBackup(plans[0]);
  }

  // ───────────────────────────── the plan folder ─────────────────────────────
  // Where the browser allows it, the plan is also kept as a file in a folder the user chose, written a moment after every change.
  const Folder = root.LRFFolder;
  let folderTimer = 0, statusNow = null, thumbsRev = 0;
  /** The app's own record, added to a plan file so that opening the file here again loses nothing the app keeps beside the plan. */
  function withOwn(plan, savedAt, source = state.plan) {
    const mine = source.lrfNext || {}, keep = {};
    for (const key of OWN_KEYS) if (mine[key] != null) keep[key] = mine[key];
    plan.lrfNextKeep = { v: 1, savedAt, device: Folder ? Folder.device() : null, keep };
    return plan;
  }
  /** The whole plan as a file's text: what Backup downloads, what the folder, a snapshot and the cloud each hold. `plan` is taken as it stands at the call. */
  async function planText(plan = state.plan) {
    let attic = null;
    try { attic = await loadAttic(); } catch (_) { attic = emptyAttic(); }   // the plan is saved even when the records the planner does not edit are out of reach
    const extras = await loadExtras(), savedAt = new Date().toISOString();
    return { text: JSON.stringify(withOwn(IO.join(plan, { ...attic, varieties: { ...(attic.varieties || {}), ...extras.varieties } }), savedAt, plan)), savedAt };
  }
  /** The photos kept beside the plan: the farm photo and the small variety photos. */
  async function photoFiles(mine = state.plan.lrfNext || {}) {
    let map = null, thumbs = null;
    try { const b64 = mine.mapImage && store.backend !== 'memory' ? await store.loadBlob('mapimage') : null; if (b64) map = { bytes: fromBase64(b64), mime: mine.mapImage.mime || 'image/jpeg' }; } catch (_) { /* the plan is saved without its photo */ }
    try { const all = Thumbs.all(), list = all instanceof Map ? Object.fromEntries(all) : all; if (list && Object.keys(list).length) thumbs = JSON.stringify(list); } catch (_) { /* nor its thumbnails */ }
    return { map, thumbs };
  }
  /** What goes in the folder: the complete plan (what Backup downloads), and the photos when they have changed. */
  async function folderPayload() {
    const plan = state.plan, mine = plan.lrfNext || {}, made = await planText(plan);
    return { ...made, extrasKey: `${(mine.mapImage && mine.mapImage.sha256) || 'no-photo'}|${thumbsRev}|${Thumbs.count ? Thumbs.count() : 0}`, extras: () => photoFiles(mine) };
  }
  const folderInfo = () => (Folder ? Folder.info() : { supported: false, connected: false });
  async function saveToFolder(options = {}) {
    clearTimeout(folderTimer);
    if (!Folder || isSample()) return { skipped: 'sample' };
    if (elsewhere()) return { skipped: 'window' };   // the folder is written by the window that holds the plan
    const done = await Folder.save(folderPayload, options);
    if (done.error) toast(`The plan folder could not be written: ${done.error}`);
    return done;
  }
  function folderSoon() {
    if (!Folder || !state.ready || isSample() || !folderInfo().connected) return;
    clearTimeout(folderTimer);
    folderTimer = setTimeout(() => { saveToFolder(); }, 1500);
  }
  const clock = iso => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };
  /** The manual save: into the folder at once where there is one, a downloaded backup file where there is not. */
  async function saveNow() {
    const f = folderInfo();
    if (state.unreadable) { toast('Not saved: the plan stored in this browser could not be opened and is kept as it is. The choices are at the top of the page.'); return null; }
    if (elsewhere()) { refuse(elsewhere()); return null; }
    if (isSample()) { toast('This is the sample plan. Load your backup first.'); return null; }
    if (f.needsPermission) { await reconnectFolder(); return null; }
    if (f.conflict) { toast('The folder holds a different plan. Choose which to keep under Backup.'); return null; }
    const cloud = !!(sync && sync.info().configured);
    if (!f.connected && cloud) {
      // no folder, but a cloud: the manual save sends the plan there now
      try { await store.saveNow(state.plan); } catch (_) { /* the indicator shows the browser's own trouble */ }
      const c = await sync.run('save');
      toast(c.status === 'in-step' ? `Saved to the cloud at ${clock(c.savedAt)}` : c.status === 'waiting' ? 'The cloud could not be reached. The plan is saved in this browser and is sent when there is a connection.' : 'Not sent to the cloud: see Backup, Cloud sync.');
      return { cloud: c.status === 'in-step' };
    }
    if (!f.connected) { await exportBackup(); return { downloaded: true }; }
    try { await store.saveNow(state.plan); } catch (_) { /* the folder is still written; the indicator shows the browser's own trouble */ }
    const done = await saveToFolder();
    if (cloud) sync.run('save');
    if (done.saved) toast(`Saved to the folder “${f.name}” at ${clock(done.savedAt)}`);
    return done;
  }
  /** Choose the folder the plan is kept in. Called from a click: the browser shows its own folder window. */
  async function chooseFolder() {
    if (!Folder || !Folder.supported()) { toast('This browser cannot write to a folder. Chrome and Edge on a computer can.'); return null; }
    let f;
    try { f = await Folder.choose(); } catch (error) { if (!error || error.name !== 'AbortError') toast(`That folder could not be used: ${(error && error.message) || 'the browser refused'}`); return null; }
    if (f.conflict) toast(`“${f.name}” already holds a plan. Choose which to keep under Backup.`);
    else if (!isSample()) { const done = await saveToFolder(); if (done.saved) toast(`The plan is now kept in “${f.name}” and saved there as you work.`); }
    else toast(`“${f.name}” is set. Your plan is saved there once it is loaded.`);
    return f;
  }
  async function reconnectFolder() {
    const f = await Folder.reconnect();
    if (f.needsPermission) toast('The browser did not allow the folder. Nothing is written there until it does.');
    else if (!f.conflict && !isSample()) { const done = await saveToFolder(); if (done.saved) toast(`Saving to “${f.name}” again.`); }
    return f;
  }
  /** Open the plan the folder holds, in place of the one open here. */
  async function openFolderPlan() {
    let data = null;
    try { data = await Folder.read(); } catch (error) { toast(`The folder could not be read: ${error.message}`); return false; }
    if (!data) { toast('The plan file in the folder cannot be read. It was left as it is.'); return false; }
    const ok = await importBackup(new File([data.text], Folder.PLAN, { type: 'application/json' }), { image: data.map ? { bytes: data.map.bytes, mime: data.map.mime, sha256: null } : null, thumbs: data.thumbs });
    if (ok) { clearTimeout(folderTimer); await Folder.accept(); }
    return ok;
  }
  /**
   * From a browser that holds no plan: choose the folder a plan is kept in and open what it holds, photos and all. Saving then
   * carries on in that folder. Nothing is written until the plan is open, and a folder with no plan in it is let go again.
   */
  async function openMyFolder() {
    if (!Folder || !Folder.supported()) { toast('This browser cannot open a folder. Chrome and Edge on a computer can. Load a backup file instead.'); return false; }
    if (!isSample() && !state.unreadable) { toast('A plan is already open here. Backup has the folder choices.'); return false; }
    let f, held = null;
    try { f = await Folder.choose(); } catch (error) { if (!error || error.name !== 'AbortError') toast(`That folder could not be used: ${(error && error.message) || 'the browser refused'}`); return false; }
    try { held = await Folder.read(); } catch (_) { held = null; }
    if (held) { const ok = await openFolderPlan(); if (!ok && (isSample() || state.unreadable)) await Folder.forget(); return ok; }
    const name = f.name, broken = !!(f.conflict && f.conflict.broken);
    await Folder.forget();
    toast(broken ? `The plan file in “${name}” cannot be read. It was left as it is.` : `“${name}” holds no plan (no ${Folder.PLAN}). Nothing was changed. Choose the folder your plan is kept in, or load a backup file.`);
    return false;
  }
  /** What is stored in this browser, exactly as it is, as a file: for a plan that would not open. */
  async function downloadStored() {
    const text = store && store.raw();
    if (text == null) { toast('There is nothing stored in this browser to download.'); return false; }
    const filename = `little-river-stored-plan-unreadable-${E.d2s(new Date())}.txt`, blob = new Blob([text], { type: 'text/plain' });
    try {
      const downloads = root.claude && root.claude.use ? await root.claude.use('downloads') : null;
      if (downloads) await downloads.save({ filename, data: blob });
      else { const url = URL.createObjectURL(blob), a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
      toast('What was stored here is downloading, exactly as it is.');
      return true;
    } catch (error) { toast(`It could not be downloaded: ${(error && error.message) || 'the browser refused'}`); return false; }
  }
  /** Give up on the plan that would not open, and carry on from the one shown. Asked first: what is stored is replaced at the next save. */
  async function useShown() {
    if (!state.unreadable) return false;
    const ok = await UI.confirm({ title: 'Carry on from the plan shown?', body: 'The plan stored in this browser could not be opened. Carrying on saves the plan shown here in its place, and what is stored now is gone for good. If it may hold work that is nowhere else, cancel and use “Download what is stored” first.', confirmLabel: 'Replace it', danger: true });
    if (!ok) return false;
    store.release(); state.unreadable = null;
    store.save(state.plan); emit('plan');
    return true;
  }
  /** Keep the plan open here, and write it over the one in the folder. */
  const overwriteFolder = async () => { const done = await saveToFolder({ force: true }); if (done.saved) toast(`The folder “${folderInfo().name}” now holds this plan.`); return done; };
  const leaveFolder = async () => { clearTimeout(folderTimer); const name = folderInfo().name; await Folder.forget(); toast(`No longer saving to “${name}”. The files there are left as they are.`); };

  // ───────────────────────────── snapshots ─────────────────────────────
  // The whole plan as it stood at a moment, kept in this browser (and, when named, in the cloud) so it can be gone back to.
  const Snaps = root.LRFSnaps || null, Sync = root.LRFSync || null;
  let sync = null, snapDay = '', flushing = false;
  /**
   * Keep the plan as it stands now. @returns the snapshot's record, or null when there is nothing to keep or nowhere to keep it.
   * options: auto (taken by the planner, not asked for), skipSame (when the newest snapshot already holds this very plan, that one is returned),
   * daily (a day, 'YYYY-MM-DD': one of these is kept per day, however often the page is opened), plan.
   */
  async function snapshot(name, options = {}) {
    const plan = options.plan || state.plan;
    if (!Snaps || !plan || (plan.lrfNext && plan.lrfNext.sample) || state.unreadable) return null;
    try {
      const key = contentKey(plan);
      if (options.skipSame || options.daily || options.why) {
        const kept = await Snaps.list(), today = options.daily ? kept.find(s => s.why === 'day:' + options.daily) : null;
        if (today) return today;
        const same = options.why ? kept.find(s => s.why === options.why) : null;   // one per reason: the plan of record of a year is kept once
        if (same) return same;
        if (options.skipSame && kept[0] && kept[0].key === key) return kept[0];
      }
      const made = await planText(plan);
      const record = await Snaps.add({ name, auto: !!options.auto, join: !!options.join, why: options.daily ? 'day:' + options.daily : options.why || '', plantings: plan.plantings.length, waiting: ((plan.lrfNext || {}).waiting || []).length, year: +(plan.settings && plan.settings.year) || null, key, device: Folder ? Folder.device() : '', at: made.savedAt }, made.text);
      emit('snaps');
      if (!record.auto) sendSnapshot(record, made.text);
      return record;
    } catch (error) {
      if (!options.auto) toast(`The snapshot could not be kept: ${(error && error.message) || 'the browser refused'}`);
      return null;
    }
  }
  /** A named snapshot goes to the cloud too, when there is one. One taken with no connection follows at the next sync. */
  async function sendSnapshot(record, text) {
    if (!sync || !sync.info().configured || record.auto || record.cloud) return false;
    try {
      const body = text || await Snaps.text(record.id);
      if (!body) return false;
      await sync.putSnap(record.id, { name: record.name, savedAt: record.at, plantings: record.plantings, waiting: record.waiting, year: record.year, bytes: record.bytes }, body);
      await Snaps.note(record.id, { cloud: true }); emit('snaps');
      return true;
    } catch (_) { return false; }
  }
  async function flushSnapshots() {
    if (flushing || !Snaps || !sync || !sync.info().configured) return;
    flushing = true;
    try { for (const s of await Snaps.list()) if (!s.auto && !s.cloud && !(await sendSnapshot(s))) break; } catch (_) { /* tried again at the next sync */ } finally { flushing = false; }
  }
  function startOfDay() {
    const today = E.d2s(new Date());
    if (snapDay === today || !state.ready || !Snaps || elsewhere()) return;
    snapDay = today;
    snapshot(`Start of ${day(new Date())}`, { auto: true, skipSame: true, daily: today, plan: state.plan });
  }
  /** Every snapshot there is to go back to: the ones in this browser, and the ones the cloud holds (its named ones, its own, and a copy of each earlier day). */
  async function snapshots() {
    const local = Snaps ? await Snaps.list().catch(() => []) : [], rows = local.map(s => ({ ...s, kind: 'snap', here: true })), byId = new Map(rows.map(r => [r.id, r]));
    let cloudNote = '';
    if (sync && sync.info().configured) {
      try {
        const there = await sync.snaps(), ids = new Set(there.filter(c => c.kind === 'snap').map(c => c.id));
        for (const r of rows) r.cloud = ids.has(r.id);
        for (const c of there) {
          if (c.kind === 'snap' && byId.has(c.id)) continue;
          const m = c.meta || {}, d = c.kind === 'day' ? E.s2d(c.id) : null;
          rows.push({ id: c.id, kind: c.kind, name: c.kind === 'day' ? `End of ${E.validDate(d) ? day(d) : c.id}` : m.name || 'Snapshot', at: m.savedAt || m.at || c.uploaded || '', auto: c.kind === 'day' || !!m.auto, plantings: m.plantings, waiting: m.waiting || 0, year: m.year || null, bytes: m.bytes || c.size, label: m.label || '', here: false, cloud: true });
        }
      } catch (error) { cloudNote = error.kind === 'offline' ? 'The cloud could not be reached, so only the snapshots in this browser are listed.' : `The cloud’s snapshots could not be listed: ${error.message}`; }
    }
    rows.sort((a, b) => (String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0));
    return { rows, cloudNote, available: !!Snaps && await Snaps.available() };
  }
  const snapshotText = row => (row.here ? Snaps.text(row.id) : sync.getSnap(row.kind, row.id));
  /** Make the plan what it was at a snapshot. The plan as it is now is kept as a snapshot first. */
  async function restoreSnapshot(row, options = {}) {
    if (elsewhere()) return refuse(elsewhere());
    let text = null;
    try { text = await snapshotText(row); } catch (error) { toast(`That snapshot could not be read: ${(error && error.message) || 'it is out of reach'}`); return false; }
    if (!text) { toast('That snapshot is no longer kept.'); return false; }
    if (!options.asked) {
      const at = new Date(row.at), ok = await UI.confirm({ title: `Go back to “${row.name}”?`, body: `The plan becomes what it was ${Number.isFinite(+at) ? `on ${day(at)} at ${clock(row.at)}` : 'then'}${Number.isFinite(+row.plantings) ? `, with ${row.plantings} plantings` : ''}. The plan as it is now is kept as a snapshot first, so this can be taken back. The undo list starts again.`, confirmLabel: 'Go back to it' });
      if (!ok) return false;
    }
    const done = await importBackup(new File([text], `the snapshot “${row.name}”`, { type: 'application/json' }), { exact: true, asked: true, quiet: true, why: `Before going back to “${row.name}”` });
    if (!done) return false;
    const before = state.lastAuto;   // the plan as it was a moment ago, kept by importBackup
    if (options.asked) toast('Taken back: the plan is as it was before.');
    else toast(`The plan is as it was at “${row.name}”.`, before ? { label: 'Take it back', run: () => restoreSnapshot({ ...before, kind: 'snap', here: true }, { asked: true }) } : undefined);
    return true;
  }
  async function deleteSnapshot(row) {
    try {
      if (row.here && Snaps) await Snaps.remove(row.id);
      if (row.cloud && sync && sync.info().configured) await sync.dropSnap(row.kind, row.id);
    } catch (error) { toast(`It could not be deleted everywhere: ${(error && error.message) || 'the cloud is out of reach'}`); emit('snaps'); return false; }
    emit('snaps');
    return true;
  }
  async function downloadSnapshot(row) {
    try {
      const text = await snapshotText(row);
      if (!text) throw new Error('it is no longer kept');
      const filename = `little-river-plan-${String(row.at).slice(0, 10)}-${String(row.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'snapshot'}.json`;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = h('a', { href: url, download: filename });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (error) { toast(`That snapshot could not be downloaded: ${(error && error.message) || 'it is out of reach'}`); return false; }
  }

  // ───────────────────────────── cloud sync ─────────────────────────────
  // js/sync.js does the talking; this is what it may ask of the app.
  let photoMemo = { at: '', key: '' };
  const thumbList = () => { const all = Thumbs.all(); return (all instanceof Map ? Object.fromEntries(all) : all) || {}; };
  /** A fingerprint of the photos kept beside the plan, worked out again only when they have changed. */
  async function extrasKey() {
    const mine = state.plan.lrfNext || {}, list = thumbList(), n = Object.keys(list).length, photo = (mine.mapImage && (mine.mapImage.sha256 || 'photo')) || 'none', at = `${photo}|${thumbsRev}|${n}`;
    if (photoMemo.at !== at) {
      const text = JSON.stringify(list);
      let x = 2166136261;
      for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619);
      photoMemo = { at, key: `${photo}|${n}|${(x >>> 0).toString(36)}` };
    }
    return photoMemo.key;
  }
  /** Photos that came from the cloud by themselves (another device added some): they replace the set kept here. The plan is not touched. */
  async function takePhotos({ image, thumbs }) {
    if (thumbs) {
      try { const kept = JSON.parse(thumbs); state.keptThumbs = kept; Thumbs.set(kept); thumbsRev++; refreshRemote(); Thumbs.index(state.plan); if (store.backend !== 'memory') await store.saveBlob('thumbs', thumbs); } catch (_) { /* the ones here stay */ }
    }
    if (image && image.bytes) {
      showMapImage(image.bytes, image.mime);
      try { if (store.backend !== 'memory') await store.saveBlob('mapimage', toBase64(image.bytes)); } catch (_) { /* shown for this session */ }
      state.plan = { ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), mapImage: { mime: image.mime, sha256: image.sha256 } } };
      store.save(state.plan);
    }
    emit('plan'); folderSoon();
  }
  // ───────────── another device's changes, taken in (js/sync.js says when and keeps the order; js/merge.js joins) ─────────────
  /** May another device's changes be taken in now? Not in the middle of a drag, with a window open, or within a moment of a change, a key or a press. */
  const idle = () => !document.body.classList.contains('dragging') && !document.querySelector('dialog[open]') && Date.now() - lastTouch >= 1500;
  for (const type of ['keydown', 'input', 'pointerdown']) root.addEventListener(type, () => { lastTouch = Date.now(); }, true);
  /** Pairs of plantings booked on the same ground at the same time, as the overview counts them. */
  function bookedTwice(eng) { const set = new Set(); for (const p of eng.plan.plantings) { const r = eng.calc(p); if (r) for (const o of eng.conflicts(p, r)) if (!o.rest) set.add([p.id, o.p.id].sort().join('|')); } return set.size; }
  /**
   * Join the plan here with the plan the cloud holds, from the plan the two started from, and take the result in: the plan that
   * was here is kept first (or nothing happens), the joined plan is saved in this browser (or nothing happens), and only then
   * is it the plan open here. Undo, and what is selected, are kept. What js/sync.js is told: see its `host.join`.
   */
  let joinBusy = null;   // while a join is writing: a whole plan is not loaded over it (importBackup waits), so the two never write the plan's records in turn
  async function joinPlans(startText, theirsText, o = {}) {
    while (joinBusy) await joinBusy;
    let done;
    joinBusy = new Promise(resolve => { done = resolve; });
    try { return await joinPlansNow(startText, theirsText, o); } finally { joinBusy = null; done(); }
  }
  async function joinPlansNow(startText, theirsText, o = {}) {
    const Merge = root.LRFMerge;
    if (!Merge || !Merge.joinTexts || elsewhere() || isSample() || state.unreadable) return { ok: false, why: '' };
    // The records the planner does not edit are part of the plan's file. If they cannot be read now, the file made below would
    // lack them, and the join would take that for this device having removed them: nothing is joined.
    try { await loadAttic(); if (!state.extras && store.backend !== 'memory') await store.loadBlob('attic-new'); await loadExtras(); } catch (error) { return { ok: false, why: `The records kept beside the plan could not be read (${(error && error.message) || 'the browser refused'}), so nothing was joined.` }; }
    const loads = planLoads, loaded = () => (planLoads !== loads ? { ok: false, why: 'A whole plan was loaded here while the two were being joined. Whole plans are not joined.' } : null);
    for (let turn = 0; turn < 4; turn++) {
      if (loaded()) return loaded();   // the plan open now does not come from the plan the two devices shared
      const plan = state.plan, made = await planText(plan);
      if (state.plan !== plan) continue;   // changed while its text was made: join the plan as it stands now
      const r = Merge.joinTexts(startText, made.text, theirsText, { order: SL.DONE_ORDER });
      if (!r.ok) return { ok: false, why: r.why };
      // the cloud's plan says nothing the plan here does not (it was sent again as it was, or with only its sender's own notes changed): there is nothing to take in
      if (r.same && !r.taken.any) return { ok: true, same: true, key: contentKey(plan), taken: r.taken, report: r.report, twice: 0 };
      let core, attic;
      try {
        const file = JSON.parse(r.text), own = (file.lrfNextKeep && file.lrfNextKeep.keep) || {};
        delete file.lrfNextKeep; IO.assertPlan(file);
        const split = IO.split(file), mine = plan.lrfNext || {}, note = {};
        for (const key of Object.keys(mine)) if (!OWN_KEYS.includes(key)) note[key] = mine[key];   // what this device notes for itself stays its own
        for (const key of OWN_KEYS) if (own[key] != null) note[key] = own[key];
        attic = split.attic; core = tidy({ ...split.core, lrfNext: note });
      } catch (error) { return { ok: false, why: `The joined plan could not be opened (${(error && error.message) || 'unreadable'}).` }; }
      const before = await snapshot(`Before taking in changes from ${o.from || 'another device'}`, { auto: true, join: true, plan });
      if (!before) return { ok: false, why: 'The plan here could not be kept first (this browser gives the page no database for snapshots), so nothing was taken in.' };
      if (state.plan !== plan) continue;
      if (!idle()) return { ok: false, later: true, why: '' };   // a window was opened or a drag begun during the wait: at the next pause
      // The records the planner does not edit travel in the plan's file: where the joined file's differ from the ones kept here, they are kept first.
      // They are written before the plan, and put back as they were if the plan is then not saved or not swapped in: neither
      // a joined plan beside the old records nor the old plan beside the joined records is left behind.
      let newAttic = false, since = null, putBack = async () => true;
      try {
        const had = await loadAttic().catch(() => emptyAttic()), extras = await loadExtras(), text = JSON.stringify(attic);
        newAttic = text !== JSON.stringify({ ...had, varieties: { ...(had.varieties || {}), ...extras.varieties } });   // an attic the join left empty is a change too: kept, or the record the other device took out would come back from here
        if (newAttic && store.backend !== 'memory') {
          const wasAttic = await store.loadBlob('attic'), wasNew = await store.loadBlob('attic-new');   // a read that fails stops the join here, before anything is written: it is never taken for "nothing was kept"
          putBack = async () => { try { if (wasAttic) await store.saveBlob('attic', wasAttic); else await store.clearBlob('attic'); if (wasNew) await store.saveBlob('attic-new', wasNew); else await store.clearBlob('attic-new'); return true; } catch (_) { return false; } };
          // What was kept since the plan was loaded ('attic-new') is read over the records above. It is set to what the join decided for the same
          // varieties, before anything else is written, and is not cleared: whichever of these writes a closed page or a refusing browser leaves
          // undone, what is read beside the plan is the joined record, never the one from before the join over it; and no clearing is left on its
          // way to take out a page record kept just after (Codex, twice, on #65).
          since = { ...extras, varieties: Object.fromEntries(Object.keys(extras.varieties || {}).filter(id => attic.varieties && attic.varieties[id] !== undefined).map(id => [id, attic.varieties[id]])) };
          if (wasNew) await store.saveBlob('attic-new', JSON.stringify(since));
          await store.saveBlob('attic', text); core = { ...core, lrfNext: { ...core.lrfNext, attic: 'cloud' } };
        }
      } catch (error) { await putBack(); return { ok: false, stop: true, why: 'The records kept beside the plan could not be saved in this browser, so nothing was taken in.' }; }
      const lost = { ok: false, stop: true, why: 'The records kept beside the plan could not be put back as they were after a joined plan was not saved. Download a backup now, from Backup.' };
      if (state.plan !== plan) { if (!(await putBack())) return lost; continue; }
      try { await store.saveNow(core); }
      catch (error) { store.save(state.plan); if (!(await putBack())) return lost; return { ok: false, stop: true, why: `The joined plan could not be saved in this browser (${(error && error.message) || 'the browser refused'}), so nothing was taken in.` }; }
      if (state.plan !== plan) { store.save(state.plan); if (!(await putBack())) return lost; continue; }   // changed during the save: what is stored follows the plan open here, and the two are joined again
      if (loaded() || !idle()) { store.save(state.plan); if (!(await putBack())) return lost; return loaded() || { ok: false, later: true, why: '' }; }   // asked once more before the plan is swapped: nothing is open over a record that is about to change
      const twiceBefore = bookedTwice(state.engine);
      state.plan = core; if (newAttic) { state.attic = attic; state.extras = since || emptyExtras(); }
      state.redo.length = 0; state.last = null;
      rebuild(); Thumbs.index(state.plan);
      if (state.sel && state.sel.type === 'planting' && !state.engine.planting(state.sel.id)) select(null);
      if (state.sel && state.sel.type === 'waiting' && !waitingOne(state.sel.id)) select(null);
      folderSoon(); emit('plan');
      return { ok: true, same: r.same, key: contentKey(core), taken: r.taken, report: r.report, twice: Math.max(0, bookedTwice(state.engine) - twiceBefore) };
    }
    return { ok: false, why: 'The plan here kept changing while the two were being joined. It is tried again at the next look.' };
  }
  const WORDS = { seedInventory: 'seed on hand', assumptions: 'the assumptions', beds: 'the layout', gardens: 'the layout', map: 'the layout', containers: 'the layout', varieties: 'the crop library', crops: 'the crop library', cropUnits: 'the crop library',
    nursery: 'the nursery', liveTrayPlans: 'tray demand', settings: 'the farm’s settings', customers: 'customers', planningPreferences: 'planning settings', 'own.waiting': 'what waits to be placed', 'own.runs': 'successions', 'own.supplies': 'supplies' };
  /** What was taken in, as a line: "1 sowing recorded, 2 plantings changed". */
  function takenLine(t) {
    const parts = [], n = (count, one, many) => `${UI.num(count)} ${count === 1 ? one : many}`;
    if (!t) return '';
    for (const [kind, count] of Object.entries(t.recorded || {})) { const w = SL.DONE_WORD[kind] || 'job'; parts.push(`${n(count, w, w + 's')} recorded`); }
    for (const [kind, count] of Object.entries(t.takenBack || {})) { const w = SL.DONE_WORD[kind] || 'job'; parts.push(`${n(count, w, w + 's')} taken back`); }
    if (t.added) parts.push(`${n(t.added, 'planting', 'plantings')} added`);
    if (t.removed) parts.push(`${n(t.removed, 'planting', 'plantings')} taken out`);
    if (t.changed) parts.push(`${n(t.changed, 'planting', 'plantings')} changed`);
    const worked = Object.keys(t.recorded || {}).length || Object.keys(t.takenBack || {}).length;
    const other = [...new Set((t.lists || []).filter(k => !(k === 'seedInventory' && worked)).map(k => WORDS[k] || (k.startsWith('own.') ? 'the planner’s notes' : 'other records')))];
    if (other.length) parts.push(`changes to ${other.join(', ')}`);
    return parts.join(', ');
  }
  /** What the last join could not keep as each device left it, for the Cloud sync window: one row a thing, with "Use mine" where this device's value can be put back by one change. */
  function differed(report) {
    const rows = [], keep = new Set(), items = ((report && report.items) || []).filter(x => !(Array.isArray(x.path) && x.path[0] === 'lrfNext'));   // a file says the planner's own record twice: once is enough
    const eng = state.engine, plantingName = id => { const p = eng.planting(id); return p ? `${cropLabel(p)}${eng.bedOf(p.bedId) ? ', ' + bedLabel(eng.bedOf(p.bedId)) : ''}` : 'a planting no longer in the plan'; };
    const short = v => { const text = v === undefined ? 'nothing' : typeof v === 'string' ? `“${v}”` : JSON.stringify(v); return text.length > 90 ? text.slice(0, 88) + '…' : text; };
    for (const x of items) {
      const path = Array.isArray(x.path) ? x.path : [], top = path[0] === 'lrfNextKeep' ? 'own.' + path[2] : path[0], id = String(path[1] || '').startsWith('#') ? path[1].slice(1) : x.id;
      const what = top === 'plantings' ? plantingName(id) : WORDS[top] || 'the plan';
      const key = JSON.stringify([x.kind, path, x.what]);
      if (keep.has(key)) continue; keep.add(key);
      if (x.kind === 'same-box') rows.push({ what, where: path.slice(top === 'plantings' ? 2 : 1).filter(s => !String(s).startsWith('#')).join(' · ') || 'the whole record', theirs: short(x.theirs), mine: short(x.mine), item: usable(x) ? x : null });
      else if (x.kind === 'move-not-applied') {
        if (x.what === 'tray-demand') rows.push({ what, where: 'its tray demand', note: x.whose === 'mine' ? 'This batch was sown on the other device, so the demand changes made here were not applied to it.' : 'This batch was sown here, so the demand changes made on the other device were not applied to it.' });
        else rows.push({ what, where: x.what === 'day' ? 'its day' : 'its place', note: x.whose === 'mine' ? 'Work was recorded on it on the other device, so the move made here was not applied.' : 'Work was recorded on it here, so the move made on the other device was not applied.' });
      }
      else if (x.kind === 'recorded-twice') rows.push({ what: plantingName(x.id), where: SL.DONE_WORD[x.job] || x.job, note: `Recorded on both devices${x.theirs ? ` (there on ${x.theirs}${x.mine ? `, here on ${x.mine}` : ''})` : ''}: the other device’s record stands, and seed was drawn once.` });
      else if (x.kind === 'failed-before-work') rows.push({ what: plantingName(x.id), where: x.whose === 'mine' ? 'marked failed' : SL.DONE_WORD[x.job] || x.job, note: x.whose === 'mine'
        ? `Marked failed here on ${x.on}, and ${SL.DONE_WORD[x.job] || x.job} on ${x.work} on the other device: the other device’s record stands, so it is not marked failed. Mark it again if it failed after that.`
        : `Marked failed on the other device on ${x.on}, and ${SL.DONE_WORD[x.job] || x.job} here on ${x.work}: the mark stands, so the work recorded here was not kept.` });
      else if (x.kind === 'kept') rows.push({ what, where: 'kept', note: x.removedBy === 'mine' ? 'Taken out here and changed on the other device: it stays, as changed.' : 'Taken out on the other device and changed here: it stays, as changed.' });
      else if (x.kind === 'seed-short') rows.push({ what: 'seed on hand', where: 'a lot ran short', note: `The two devices together drew ${UI.num(x.short)} more than the lot held. The lot is at zero, and that seed is counted as used without a counted lot.` });
      else if (x.kind === 'placed-and-waiting') rows.push({ what: plantingName(x.id), where: 'placed', note: 'Put on a bed on one device and changed while it waited on the other: it is on its bed.' });
      else if (x.kind === 'tray-batches') rows.push({ what: 'tray demand', where: 'weekly batches', note: x.whose === 'mine' ? 'A demand plan changed here was taken out on the other device: it stays as it is here, with its weekly batches.' : `A demand plan changed on both devices, or taken out here and changed there: the other device’s stands, with its weekly batches${(x.dropped || []).length ? ` (${UI.num(x.dropped.length)} made here went)` : ''}${(x.reset || []).length ? ` (${UI.num(x.reset.length)} changed here ${x.reset.length === 1 ? 'is' : 'are'} as the other device has ${x.reset.length === 1 ? 'it' : 'them'})` : ''}.` });
      else if (x.kind === 'tray-batch-twice') rows.push({ what: plantingName(x.id), where: 'one week of tray demand', note: x.conflict ? 'Each device made this week’s batch and recorded work on its own: both are kept, so the week shows twice the trays. Take the work back on the one that is not the true record, and remove it.' : 'Each device made this week’s batch: one is kept, the one with work recorded on it.' });
      else if (x.kind === 'sowing-of-removed-planting') rows.push({ what: 'seed on hand', where: 'a sowing', note: 'A planting was sown on one device and then taken out there, and kept on the other: its seed stays used. If both devices recorded that one sowing, count the lot by hand.' });
    }
    return rows;
  }
  /** Can this device's value be put back by one change? A box, or keys read together, of a planting, a bed, a garden, a variety, a crop, the assumptions, the settings or the nursery. */
  function usable(x) {
    const p = x.path || [], top = p[0];
    if (['plantings', 'beds', 'gardens', 'varieties', 'crops'].includes(top)) return String(p[1] || '').startsWith('#') && p.length >= 3;
    return ['assumptions', 'settings', 'nursery'].includes(top) && p.length >= 2;
  }
  /** `value` put at `path` in a copy of `node`: '#id' finds a record of a list; `keys` are keys of the last record, set (or taken away) together. */
  function putAt(node, path, i, value, keys) {
    if (i === path.length - (keys ? 1 : 0)) { if (!keys) return value; const out = { ...node }; for (const k of keys) { if (value && value[k] !== undefined) out[k] = value[k]; else delete out[k]; } return out; }
    const seg = path[i];
    if (Array.isArray(node)) { const id = String(seg).slice(1); if (!node.some(x => x && String(x.id) === id)) throw new Error('That record is no longer in the plan.'); return node.map(x => (x && String(x.id) === id ? putAt(x, path, i + 1, value, keys) : x)); }
    const out = { ...(node || {}) }, next = putAt(out[seg], path, i + 1, value, keys);
    if (next === undefined) delete out[seg]; else out[seg] = next;
    return out;
  }
  /** "Use mine": this device's value put back over the other device's, as one change of its own (undone like any other, and sent on). */
  function useMine(x) {
    if (!x || !usable(x)) return false;
    const top = x.path[0], kinds = { beds: 'bed', gardens: 'garden', varieties: 'variety', crops: 'crop' };
    let ops;
    try {
      const after = putAt(state.plan[top], x.path, 1, x.mine, Array.isArray(x.keys) ? x.keys : null);
      if (Array.isArray(state.plan[top])) { const id = String(x.path[1]).slice(1), was = state.plan[top].find(r => String(r.id) === id), now = after.find(r => String(r.id) === id); ops = [{ ...(kinds[top] ? { kind: kinds[top] } : {}), before: was, after: now }]; }
      else ops = [{ kind: top === 'assumptions' ? 'assume' : top, before: state.plan[top], after }];
    } catch (error) { return refuse(error.message); }
    const done = commit('Used this device’s value', ops);
    if (done && state.joined) { state.joined = { ...state.joined, rows: state.joined.rows.map(r => (r.item === x ? { ...r, item: null, used: true } : r)) }; emit('joined'); }
    return done;
  }
  /** js/sync.js says changes were taken in: said once in a toast, and kept for the Cloud sync window while anything in it could not be kept as left. */
  function sayTaken(info) {
    const who = info.from || 'another device', line = takenLine(info.taken), rows = differed(info.report), twice = info.twice || 0;
    state.joined = { from: who, at: Date.now(), line, rows, twice };
    const tail = `${rows.length ? ` ${UI.num(rows.length)} thing${rows.length === 1 ? ' was' : 's were'} changed on both devices: see what differed.` : ''}${twice ? ` ${UI.num(twice)} more to settle: ground is booked twice.` : ''}`;
    if (line || rows.length || twice) toast(`Taken in from ${who}${line ? `: ${line}` : ''}.${tail}`);
    emit('joined');
  }
  function startSync(photosReady) {
    if (!Sync || sync) return;
    let lastJoin = null;
    sync = Sync.create({
      idle, join: async (start, theirs, o) => { lastJoin = await joinPlans(start, theirs, o); return lastJoin; }, taken: info => sayTaken({ ...info, twice: lastJoin && lastJoin.twice }),
      mode: () => (state.unreadable || elsewhere() ? 'held' : isSample() ? 'sample' : 'plan'),   // a window that only shows the plan sends and opens nothing by itself
      stored: () => (store.backend === 'device' ? { n: store.count, ok: !store.pending } : null), readOnly: () => !!elsewhere(),
      key: () => contentKey(),
      payload: async () => { const plan = state.plan, key = contentKey(plan), made = await planText(plan); return { ...made, key, plantings: plan.plantings.length, waiting: ((plan.lrfNext || {}).waiting || []).length, year: planYear() }; },
      extrasKey, extras: () => photoFiles(), photos: takePhotos,
      open: (text, o = {}) => importBackup(new File([text], o.from || 'the cloud', { type: 'application/json' }), { exact: true, asked: true, quiet: true, why: o.why, image: o.image, thumbs: o.thumbs }),
      loads: () => planLoads, device: () => (Folder ? Folder.device() : 'd-session'), say: message => toast(message)
    });
    sync.on(info => { if (statusNow) showStatus(statusNow); emit('sync'); if (info.status === 'in-step') flushSnapshots(); });
    // the photos are counted into what is sent: wait until the ones kept here have been read
    Promise.resolve(photosReady).catch(() => {}).then(() => sync.start());
  }
  const syncInfo = () => (sync ? sync.info() : { supported: false, configured: false, status: 'off', url: '', label: '' });

  // ───────────────────────────── start-up ─────────────────────────────
  function defaultDate() {
    const year = planYear(), today = new Date();
    return today.getFullYear() === year ? today : new Date(year, 5, 15);
  }
  function showStatus(info) {
    const el = document.getElementById('saveState');
    if (!el) return;
    statusNow = info;
    // A window that only shows the plan says so here whatever was last reported: nothing is saved from it.
    if (elsewhere()) { el.textContent = 'Not saving in this window'; el.dataset.state = 'error'; el.title = elsewhere(); delete el.dataset.ask; return; }
    const f = folderInfo(), where = info.backend === 'cloud' ? 'Saved' : info.backend === 'device' ? 'Saved on this device' : 'Not saved';
    let text = info.label || { saving: 'Saving…', pending: 'Saving…', saved: where, error: 'Save failed · click to retry', unsaved: 'Not saved in this view', loading: 'Opening plan…', sample: 'Sample plan', held: 'Not saving · stored plan unreadable' }[info.state] || where;
    if (isSample() && info.state === 'saved') text = 'Sample plan';
    let state2 = info.state === 'held' ? 'error' : isSample() && info.state === 'saved' ? 'sample' : info.state, title = info.state === 'held' ? 'The plan stored in this browser could not be opened. It is kept as it is; nothing is saved over it until you choose. Click for the choices.' : info.detail || (info.backend === 'cloud' ? 'Synced to this page’s database' : info.backend === 'device' ? 'Kept in this browser only. Backup, Keep the plan in a folder, puts a file on the computer too.' : 'Storage is not available here');
    // With a plan folder, the indicator answers for the file as well as for the browser's own copy.
    if (info.state === 'saved' || info.state === 'sample') {
      if (f.needsPermission) { text = 'Folder needs reconnecting · click'; state2 = 'error'; title = `The browser has to be asked again before it writes to “${f.name}”.`; }
      else if (f.conflict) { text = 'Folder holds another plan'; state2 = 'error'; title = 'Saving to the folder is paused. Choose which plan to keep under Backup.'; }
      else if (f.error) { text = 'Folder save failed · click to retry'; state2 = 'error'; title = f.error; }
      else if (f.connected && f.busy) { text = 'Saving to folder…'; state2 = 'saving'; }
      else if (f.connected && f.savedAt && info.state === 'saved') { text = `Saved · ${f.name} ${clock(f.savedAt)}`; title = `Kept in this browser, and written to the folder “${f.name}” at ${clock(f.savedAt)}.`; }
    }
    // With cloud sync, it answers for the copy off this computer too. The folder's own trouble is said first.
    const c = syncInfo(), folderFine = state2 !== 'error' && state2 !== 'saving';
    let ask = '';
    if ((info.state === 'saved' || info.state === 'sample') && folderFine && c.status !== 'off' && (c.configured || c.status === 'signin')) {
      const filed = f.connected && f.savedAt && info.state === 'saved';
      if (c.status === 'conflict') { text = 'Cloud holds another plan · click'; state2 = 'error'; ask = 'cloud'; title = 'Nothing is sent to the cloud or replaced here until you choose which plan to keep.'; }
      else if (c.status === 'newer') { text = 'Newer plan in the cloud · click'; state2 = 'error'; ask = 'cloud'; title = 'Another device has saved a newer plan. Nothing here has changed since the last sync.'; }
      else if (c.status === 'signin') { text = 'Cloud needs the passphrase · click'; state2 = 'error'; ask = 'cloud'; title = 'The plan is saved in this browser. It is not sent to the cloud until the passphrase is typed again.'; }
      else if (c.status === 'error') { text = 'Cloud sync failed · click'; state2 = 'error'; ask = 'cloud'; title = c.error; }
      else if (c.status === 'sending') { text = 'Sending to the cloud…'; state2 = 'saving'; }
      else if (c.status === 'receiving') { text = 'Opening from the cloud…'; state2 = 'saving'; }
      else if (c.status === 'joining') { text = 'Taking in changes…'; state2 = 'saving'; title = 'Another device has saved. Its changes are joined with the plan here when you pause.'; }
      else if (c.status === 'waiting' && info.state === 'saved') { text = filed ? `Saved · ${f.name} · cloud waiting` : 'Saved here · cloud waiting'; title = 'The cloud could not be reached. The plan is saved in this browser and is sent when there is a connection.'; }
      else if (c.status === 'in-step' && info.state === 'saved' && c.savedAt) { text = filed ? `Saved · folder + cloud ${clock(c.savedAt)}` : `Saved · cloud ${clock(c.savedAt)}`; title = `Kept in this browser${filed ? `, written to the folder “${f.name}” at ${clock(f.savedAt)}` : ''}, and sent to the cloud at ${clock(c.savedAt)}.`; }
    }
    if (ask) el.dataset.ask = ask; else delete el.dataset.ask;
    el.textContent = text; el.dataset.state = state2; el.title = title;
  }
  async function start() {
    showStatus({ backend: 'cloud', state: 'loading' });
    // What the store reports goes to the indicator. Sync is told when the plan has reached the browser's storage, and the page when this window stops taking changes.
    store = root.LRFStore.create(info => { showStatus(info); if (info.state === 'saved' && sync) sync.saved(); if (info.state === 'elsewhere') { emit('window'); if (sync) sync.run('window'); } });
    const getJSON = path => fetch(path).then(r => r.ok ? r.json() : null).catch(() => null);
    const inlined = root.LRF_BUNDLED || null;   // the single-file build carries its data in the page
    const bundledInfo = inlined ? Promise.resolve(inlined.info) : getJSON('data/plan-info.json');
    let saved = null, loadError = null, firstRun = false;
    await store.connect();
    try { saved = await store.load(); } catch (error) { loadError = error; }
    // something is stored but it is not a plan (a list, an object with no plantings): treated as unreadable, not opened and not written over
    if (saved && !(typeof saved === 'object' && Array.isArray(saved.plantings) && Array.isArray(saved.beds) && Array.isArray(saved.gardens))) { saved = null; loadError = new Error('what is stored is not a plan'); }
    state.bundled = await bundledInfo;
    if (saved) {
      state.plan = saved;
      // The plan saved here wins. When this copy of the page was built from a later full backup, say so instead of opening the older plan silently.
      const mine = saved.lrfNext || {}, held = String(mine.backup || mine.importedAt || mine.startedAt || '');
      if (state.bundled && state.bundled.backup && !mine.sample && String(state.bundled.backup) > held && mine.passedOver !== state.bundled.backup) state.newer = { backup: state.bundled.backup, held: mine.backup || null, counts: state.bundled.counts || null };
    } else {
      // Nothing saved yet: start from the farm's plan that ships with the page.
      const compact = inlined ? inlined.plan : state.bundled ? await getJSON('data/plan.json') : null;
      if (compact) { state.plan = IO.unpack(compact); state.plan.lrfNext = { source: 'bundled', attic: 'none', backup: state.bundled.backup, startedAt: new Date().toISOString(), ...(state.bundled.keep || {}) }; firstRun = !loadError; }
      else state.plan = IO.sample(Lib);
    }
    const opened = state.plan;
    state.plan = tidy(state.plan);
    const tidied = state.plan !== opened;
    state.mapImageUrl = bundledImage();
    rebuild();
    state.date = defaultDate(); state.ready = true;
    document.body.dataset.view = state.view;
    emit('plan'); emit('date'); emit('sel'); emit('view');
    if (Folder) Folder.on(() => { if (statusNow) showStatus(statusNow); emit('folder'); });
    if (loadError) {
      // Kept as it is: saving is held until he brings a plan in or says to start from the one shown. (Before 0.20 the next change wrote over it.)
      store.hold();
      state.unreadable = { why: loadError.message, stored: store.raw() != null };
      showStatus({ backend: store.backend, state: 'held', detail: loadError.message });
      emit('plan');
      toast('The plan stored in this browser could not be opened. It is kept as it is: nothing done here is saved over it.');
      startSync();   // nothing is sent or opened by itself in this state; the cloud's plan can be asked for
      return;
    }
    if (firstRun || (tidied && saved)) store.save(state.plan); else showStatus({ backend: store.backend, state: saved ? 'saved' : 'sample' });
    if (saved) restoreMapImage();
    const photosReady = loadThumbs();
    loadPacks(); topUpVarieties().catch(() => {}); adoptTrayPlans();
    // Stock is needed wherever a sowing can be recorded, not only on the Seeds view: fetch it now, not on first visit.
    loadInventory().then(found => { if (found) emit('plan'); }).catch(() => {});
    store.watch(() => toast('This plan was changed on another device.', { label: 'Reload', run: () => root.location.reload() }));
    if (Folder) {
      Folder.restore().then(f => { if (f.connected && !f.conflict && !isSample() && (!f.savedAt || tidied)) saveToFolder(); }).catch(() => {});
    }
    startSync(photosReady);
    // Ask the browser not to clear this site's data when the disk runs short. Chrome grants it without a question to a site in regular use.
    try { if (saved && root.navigator && root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist().catch(() => {}); } catch (_) { /* not offered here */ }
  }

  /** Replace the plan saved here with the one this copy of the page carries. */
  async function useBundled() {
    const inlined = root.LRF_BUNDLED || null, compact = inlined ? inlined.plan : await fetch('data/plan.json').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!compact || !state.bundled) { toast('The newer plan could not be read.'); return; }
    const carried = IO.carry(state.plan, IO.unpack(compact)), plan = carried.plan, shipped = state.bundled.keep || {};
    const facts = {};
    for (const list of ['crops', 'varieties', 'gardens', 'beds']) { const both = { ...((shipped.facts || {})[list] || {}), ...((carried.keep.facts || {})[list] || {}) }; if (Object.keys(both).length) facts[list] = both; }
    plan.lrfNext = { source: 'bundled', attic: 'none', backup: state.bundled.backup, startedAt: new Date().toISOString(), ...shipped, ...carried.keep, ...(Object.keys(facts).length ? { facts } : {}) };
    try { await store.saveNow(plan); } catch (error) { toast(`The newer plan could not be saved here (${error.message}). Nothing was changed.`); return; }
    root.location.reload();
  }

  /** In a window that only shows the plan: have the plan handed to this one. The page reloads, and holds the plan as it starts. */
  async function useThisWindow() {
    if (!store || !store.readOnly) return false;
    await store.takeOver();
    root.location.reload();
    return true;
  }

  /** Keep the plan saved here and stop offering the one this copy carries. */
  function keepMine() {
    if (!state.newer) return;
    const passedOver = state.newer.backup; state.newer = null;
    adopt({ ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), passedOver } }, state.engine);
  }

  on('plan', () => Thumbs.index(state.plan));   // first listener: views drawn after it see the right crop pictures

  root.LRFApp = {
    state, on, emit, start, planYear, setDate, select, setView, arm, bedLabel, cropLabel,
    commit, undo, redo, lastChange, refuse, setUse, setGives, setPlantedIn, farmDates, farmDatesPreview, setFarmDates, shareDrop, applyShare, askShare, asksToShare, equalShares, planVarieties, addVarieties, sendToWait, mixing: () => state.mixing, endMixing: () => setMixing(null), updatePlanting, updateBeds, removePlantings, preview, place, addPlantings, openAhead, setAssumption, setGardenType, setStart, setStarts, setYield, setSell, setSellV, setLooked, setStartLooked, setStarting, setHouse, setHouseFarm, addThing, setThing, removeThing, thingWaits, thingWhy, THING_UNITS, sellOps, thingsAfter,
    auditSurvey, auditStudy, auditPreview, auditApply,
    waiting, waitingOne, placeWaiting, removeWaiting, updateWaiting, runs, addRun, removeRun,
    revise: assume, impact, varietyRecord, keepVarietyRecord, keepThumb, addPhotos, openFiles, rebuildThumbs, photoGaps, photoSource, loadInventory, inventoryNow, stockNow, editStock, packsFor, coverFor, sowingOf, recordSowing, takeBackSowing, recordSowings, takeBackSowings, planSowings, recordWork, previewWork, takeBackWork, delayWork, skipWork, noteWork, failedRange, previewFailed, markFailed, seasonRecords, takeBackSeason, today: todayText, uid, storage: () => (store ? store.backend : 'memory'),
    yieldOps, engineAfter: ops => E.create(withOps(state.plan, ops, 'do'), Lib),
    saveTrays, removeTrays, trayRecords, useBundled, keepMine, exportBackup, importBackup, retrySave: () => { if (elsewhere()) { refuse(elsewhere()); return null; } if (state.unreadable) { toast('The plan stored in this browser could not be opened. The choices are at the top of the page.'); return null; } const f = folderInfo(); if (f.needsPermission) return reconnectFolder(); if (f.error && f.connected) return saveToFolder(); return store && store.retry(); },
    saveNow, chooseFolder, reconnectFolder, openFolderPlan, openMyFolder, downloadStored, useShown, overwriteFolder, leaveFolder, folder: folderInfo, saveToFolder, isSample, setOwn, editNursery, setSupply, setLiveSow, traysToMonday: () => applyTrayStart(),
    snapshot, snapshots, restoreSnapshot, deleteSnapshot, downloadSnapshot, contentKey, joined: () => state.joined || null, useMine, doneJoined: () => { state.joined = null; emit('joined'); }, windowState: () => (store ? store.readOnly : ''), useThisWindow, sync: () => sync, syncInfo, linkService: () => (sync && sync.linkService ? sync.linkService() : null), snapshotsKept: () => !!Snaps
  };
})(window);
