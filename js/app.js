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
    undo: [], redo: [], ready: false
  };
  const listeners = {};
  const on = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };
  const emit = (event, detail) => { for (const fn of listeners[event] || []) fn(detail); };
  const uid = () => root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
  const clone = v => JSON.parse(JSON.stringify(v));

  let store = null;
  const rebuild = () => { state.engine = E.create(state.plan, Lib); };

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
    for (const op of ops) {
      const from = direction === 'undo' ? op.after : op.before, to = direction === 'undo' ? op.before : op.after;
      if (op.kind === 'assume') { if (to) next.assumptions = to; else delete next.assumptions; continue; }
      if (op.kind === 'settings') { next.settings = to; continue; }
      if (op.kind === 'inventory') { if (to) next.seedInventory = to; else delete next.seedInventory; continue; }
      if (op.kind === 'trays') { if (to) next.liveTrayPlans = to; else delete next.liveTrayPlans; continue; }
      if (op.kind === 'own') { next.lrfNext = { ...(next.lrfNext || {}) }; if (to == null) delete next.lrfNext[op.key]; else next.lrfNext[op.key] = to; continue; }
      const key = { bed: 'beds', garden: 'gardens', variety: 'varieties', crop: 'crops' }[op.kind] || 'plantings', list = lists[key] || (lists[key] = (plan[key] || []).slice());
      const index = from ? list.findIndex(x => x.id === from.id) : -1;
      if (to && index >= 0) list[index] = to; else if (to) list.push(to); else if (index >= 0) list.splice(index, 1);
    }
    return Object.assign(next, lists);
  }
  function adopt(plan, engine) {
    state.plan = plan; state.engine = engine || E.create(plan, Lib);
    store.save(state.plan);
    emit('plan');
  }
  const touched = (ops, engine) => { const ids = new Set(); for (const op of ops) { if (['assume', 'garden', 'variety', 'crop', 'settings', 'inventory', 'trays', 'own'].includes(op.kind)) continue; if (op.kind === 'bed') { for (const p of engine.plantingsIn((op.after || op.before).id)) ids.add(p.id); } else if (op.after) ids.add(op.after.id); } return [...ids]; };
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
   * in the same step, so that loading a newer v7 backup does not quietly take it back (see IO.carry).
   */
  function noted(ops) {
    const lists = { crop: 'crops', variety: 'varieties', garden: 'gardens', bed: 'beds' }, was = (state.plan.lrfNext || {}).facts || null;
    let facts = was;
    for (const op of ops) if (lists[op.kind] && op.after) facts = IO.note(facts, lists[op.kind], op.before, op.after, op.kind === 'crop' && Lib.crops.some(c => c.id === op.after.id));
    return JSON.stringify(facts) === JSON.stringify(was) ? ops : [...ops, { kind: 'own', key: 'facts', before: was, after: facts }];
  }
  function commit(label, ops, options = {}) {
    if (!ops.length) return false;
    // A sowing day set by hand belongs to the date it was set against: when the planting moves, the plan's own day applies again.
    ops = ops.map(op => { if (op.kind || !op.before || !op.after || !op.after.sowOn || op.after.liveTray || op.before.date === op.after.date || op.before.sowOn !== op.after.sowOn) return op; const after = { ...op.after }; delete after.sowOn; return { ...op, after }; });
    if (!isSample()) ops = noted(ops);
    const plan = withOps(state.plan, ops, 'do'), engine = E.create(plan, Lib);
    const no = options.unchecked ? null : Rails.refusal(state.engine, engine, touched(ops, engine));
    if (no) { toast(refusalText(no, engine)); return false; }
    state.undo.push({ label, ops });
    if (state.undo.length > 200) state.undo.shift();
    state.redo.length = 0;
    adopt(plan, engine);
    return true;
  }
  function undo() {
    const step = state.undo.pop();
    if (!step) return;
    state.redo.push(step); adopt(withOps(state.plan, step.ops, 'undo'));
    if (state.sel && state.sel.type === 'planting' && !state.engine.planting(state.sel.id)) select(null);
    toast(`Undid: ${step.label}`);
  }
  function redo() {
    const step = state.redo.pop();
    if (!step) return;
    state.undo.push(step); adopt(withOps(state.plan, step.ops, 'do'));
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
  // ───────────────────────── assumptions ─────────────────────────
  // A change to the list, or to a garden's growing conditions, is a statement about the world, not
  // an edit to the plan. It is never refused. What it does to the plan is shown first when it would
  // book two crops into the same ground; those then wait on the overview under "To settle".
  function impact(before, after) {
    const pairs = eng => { const set = new Set(); for (const p of eng.plan.plantings) { const r = eng.calc(p); if (r) for (const o of eng.conflicts(p, r)) if (!o.rest) set.add([p.id, o.p.id].sort().join('|')); } return set; };
    let changed = 0, later = 0, sooner = 0, most = 0;
    for (const p of after.plan.plantings) {
      const a = after.calc(p), q = before.planting(p.id), b = q && before.calc(q);
      if (!a || !b) continue;
      const shift = E.dayDiff(a.first, b.first);
      if (shift || +a.last !== +b.last) changed++;
      if (shift > 0) later++; else if (shift < 0) sooner++;
      if (Math.abs(shift) > Math.abs(most)) most = shift;
    }
    const was = pairs(before), now = pairs(after);
    return { changed, later, sooner, most, overlaps: [...now].filter(k => !was.has(k)).length };
  }
  async function assume(label, ops) {
    const plan = withOps(state.plan, ops, 'do'), engine = E.create(plan, Lib), hit = impact(state.engine, engine);
    const moves = hit.changed ? `${hit.changed} planting${hit.changed === 1 ? '' : 's'} ${hit.later && hit.sooner ? 'shift' : hit.later ? 'harvest later' : 'harvest sooner'}, by up to ${Math.abs(hit.most)} day${Math.abs(hit.most) === 1 ? '' : 's'}` : 'No planting uses it yet';
    if (hit.overlaps) {
      const ok = await UI.confirm({ title: label, confirmLabel: 'Apply', body: `${moves}. ${hit.overlaps} pair${hit.overlaps === 1 ? '' : 's'} of plantings would then be booked into the same ground. They are not refused, because the plan was only ever as good as the number. They will wait on the overview under “To settle”.` });
      if (!ok) return false;
    }
    commit(label, ops, { unchecked: true });
    toast(`${label} · ${moves.charAt(0).toLowerCase()}${moves.slice(1)}`, { label: 'Undo', run: undo });
    return true;
  }
  /** Set, or with no days clear, the grower's days to harvest for a crop or variety in one growing condition. */
  function setAssumption(kind, id, env, days, label) {
    const current = state.plan.assumptions || null, next = current ? JSON.parse(JSON.stringify(current)) : { v: 1, crops: {}, varieties: {} };
    next[kind] = next[kind] || {};
    const record = { ...(next[kind][id] || {}) };
    if (days > 0) record[env] = { dtm: Math.round(days) }; else delete record[env];
    if (Object.keys(record).length) next[kind][id] = record; else delete next[kind][id];
    const empty = !Object.keys(next.crops || {}).length && !Object.keys(next.varieties || {}).length;
    return assume(label, [{ kind: 'assume', before: current, after: empty ? null : next }]);
  }
  /** Say what kind of place a garden is. Its house factor and frost setting follow, as they did in v7. */
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
  /** The page record last kept for a variety: from this app, or from the v7 backup it came in with. */
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
    Thumbs.index(state.plan); emit('plan');
  }
  /** Keep (or with no picture, drop) one variety's thumbnail. */
  async function keepThumb(id, uri) {
    const next = { ...state.keptThumbs };
    if (uri) next[id] = uri; else delete next[id];
    state.keptThumbs = next; Thumbs.put(id, uri);
    Thumbs.index(state.plan); emit('plan');
    try { return store.backend === 'memory' ? false : await store.saveBlob('thumbs', JSON.stringify(next)); } catch (_) { return false; }
  }
  /** Make thumbnails from the variety photos inside a v7 backup zip. */
  async function importPhotos(parsed, where) {
    const out = {}, zip = parsed.zip, Zip = root.LRFZip;
    const list = zip ? (parsed.plan.varieties || []).filter(v => v && v.photo && v.photo.sha256 && zip.entries.get('files/' + v.photo.sha256)) : [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      try { out[v.id] = await Thumbs.make(new Blob([await Zip.read(zip.bytes, zip.entries.get('files/' + v.photo.sha256))], { type: v.photo.mime || 'image/jpeg' })); } catch (_) { /* one unreadable photo does not stop the rest */ }
      if ((i + 1) % 20 === 0) showStatus({ backend: where, state: 'saving', label: `Reading photos ${i + 1}/${list.length}` });
    }
    state.keptThumbs = out; Thumbs.set(out); Thumbs.index(state.plan); emit('plan');
    if (store.backend !== 'memory') { try { await store.saveBlob('thumbs', JSON.stringify(out)); } catch (_) { /* shown for this session only */ } }
    return list.length;
  }
  // Seed stock. A plan loaded from a v7 backup carries its lots and their change log. A plan saved before stock
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

  // Vendor size lists. A plan loaded from a v7 backup carries each variety's own list. The plan that ships with this
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
    const p = state.engine.planting(id);
    return p ? sowingStep(`${cropLabel(p)}: sown ${day(E.s2d(input.date))}`, ctx => ({ before: p, ...SL.recordSowing(state.engine, inventoryNow(), p, input, ctx) })) : null;
  }
  /** Take a recorded sowing back: the date is cleared and the seed goes back onto its lots. One undoable step. */
  function takeBackSowing(id) {
    const p = state.engine.planting(id);
    return p ? sowingStep(`${cropLabel(p)}: sowing taken back`, ctx => ({ before: p, ...SL.takeBackSowing(state.engine, inventoryNow(), p, ctx) })) : null;
  }
  /**
   * Several sowings as one undoable step. Each planting is worked exactly as it would be alone, with the seed stock
   * carried from one to the next, so two plantings of a variety draw the same lots down in turn. A planting that
   * cannot be done (a date that contradicts work already recorded, say) is left alone and reported; the rest go ahead.
   */
  function sowingSteps(label, items, work) {
    const ctx = { now: new Date().toISOString(), uid, year: planYear(), name: '', today: todayText() }, ops = [], done = [], failed = [];
    let inventory = inventoryNow(), touched = false;
    for (const item of items || []) {
      const p = state.engine.planting(item.id);
      if (!p) continue;
      try {
        const result = work(p, item, inventory, ctx);
        ops.push({ before: p, after: result.planting });
        if (result.inventory) { inventory = result.inventory; touched = true; }
        done.push({ id: p.id, ...result });
      } catch (error) { failed.push({ id: p.id, label: cropLabel(p), why: error.message || 'It could not be recorded.' }); }
    }
    if (!ops.length) { toast(failed.length ? failed[0].why : 'Nothing to record.'); return null; }
    if (touched) ops.push({ kind: 'inventory', before: state.plan.seedInventory || null, after: inventory });
    const was = state.engine;
    if (!commit(label(done.length), ops, { unchecked: true })) return null;
    const total = key => Math.round(done.reduce((n, r) => n + (Array.isArray(r[key]) ? r[key].reduce((m, u) => m + u.quantity, 0) : Number(r[key]) || 0), 0) * 1e6) / 1e6;
    return { done, failed, overlaps: impact(was, state.engine).overlaps, used: total('used'), untracked: total('untracked'), returned: total('returned'), lost: total('lost') };
  }
  /** Record several sowings on one date: items [{ id, quantity? }]. Quantities left out are the plan's own. */
  const recordSowings = (items, input) => sowingSteps(n => `${n} sowing${n === 1 ? '' : 's'} recorded ${day(E.s2d(input.date))}`, items,
    (p, item, inventory, ctx) => SL.recordSowing(state.engine, inventory, p, { date: input.date, quantity: item.quantity, note: input.note }, ctx));
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
    (p, item, inventory, ctx) => SL.takeBackSowing(state.engine, inventory, p, ctx));

  // ───────────────────────── live trays ─────────────────────────
  const Trays = root.LRFTrays;
  /** Harvest and pick records live in the part of a v7 backup this app does not edit; a batch with any is history and stays as it is. */
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
  /** A plan saved by an earlier preview kept v7's demand plans with the records it does not edit. Bring them into the plan. */
  async function adoptTrayPlans() {
    if (Array.isArray(state.plan.liveTrayPlans) || !state.plan.plantings.some(p => p.liveTray)) return;
    try { const attic = await loadAttic(), kept = attic.rest.liveTrayPlans; if (Array.isArray(kept) && kept.length) { adopt({ ...state.plan, liveTrayPlans: kept }); } } catch (_) { /* the batches are still shown; the demand table says the plan record is missing */ }
  }

  /** One of this app's own settings (kept beside the plan, never written into a v7 backup), as a step that can be undone. */
  function setOwn(key, value, label) {
    const before = (state.plan.lrfNext || {})[key];
    if ((before == null ? null : before) === (value == null ? null : value)) return false;
    return commit(label, [{ kind: 'own', key, before: before == null ? null : before, after: value == null ? null : value }], { unchecked: true });
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
    const ops = ids.map(id => state.engine.planting(id)).filter(Boolean).map(before => ({ before, after: null }));
    if (!ops.length) return;
    if (state.sel && state.sel.type === 'planting' && ids.includes(state.sel.id)) select({ type: 'bed', id: ops[0].before.bedId });
    commit(label || (ops.length === 1 ? `Remove ${cropLabel(ops[0].before)}` : `Remove ${ops.length} plantings`), ops);
    toast(ops.length === 1 ? `Removed ${cropLabel(ops[0].before)}` : `Removed ${ops.length} plantings`, { label: 'Undo', run: undo });
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
  function preview(payload, target) {
    const eng = state.engine, bed = eng.bedOf(target.bedId);
    let res = Rails.propose(eng, payload, target);
    // A trade is only offered where the grower can see it coming: while dragging.
    if (res.state === 'blocked' && res.why === 'held' && payload.plantingId && !target.noSwap) res = Rails.swap(eng, payload, target) || res;
    const unit = bed ? eng.capUnit(bed) : 'ft', r = res.r, harvest = r ? `harvest ${span(r.first, r.last)}` : '';
    if (res.state === 'swap') res.text = `Trade places with ${names(res.traded.map(q => cropLabel(q)))}`;
    else if (res.state === 'ok') res.text = payload.plantingId ? `${payload.copy ? 'Copy' : 'Move'} here · ${harvest}` : `${day(r.field)} · ${harvest}`;
    else if (res.state === 'partial') {
      const rows = res.rect && res.rect.rows && res.rect.rows.count < res.rect.rows.total ? `${res.rect.rows.count} of ${res.rect.rows.total} rows · ` : '';
      res.text = `${rows}${UI.num(r.physicalLength, 1)} ${unit} free${res.was && res.shrunk ? ` (it has ${UI.num(res.was.len, 1)})` : ''} · ${harvest}`;
    } else res.text = { space: 'Not a growing space', crop: 'This crop cannot be planned here', 'micro-needs-bench': 'Microgreens go on a living-tray bench', 'bench-needs-micro': 'This bench takes living trays only', 'too-long': 'Does not fit this space', pool: 'Live trays follow weekly demand: change it on the Trays view' }[res.why] || heldText(res);
    return res;
  }
  const sameSpot = (a, b) => a.bedId === b.bedId && a.date === b.date && (a.ft || 0) === (b.ft || 0) && (a.trays || 0) === (b.trays || 0) && (a.startFt || 0) === (b.startFt || 0) && JSON.stringify(a.bedLayout || null) === JSON.stringify(b.bedLayout || null);
  function place(payload, bedId, date, aim = {}) {
    const result = preview(payload, { bedId, date, ...aim }), bed = state.engine.bedOf(bedId);
    if (result.state === 'blocked') { toast(bed && result.why === 'held' ? `${bedLabel(bed)}: ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)}` : result.text); return null; }
    const p = result.p, before = payload.plantingId && !payload.copy ? state.engine.planting(payload.plantingId) : null;
    if (before && sameSpot(before, p)) return null;
    const what = cropLabel(p), where = bedLabel(bed), unit = state.engine.capUnit(bed);
    const ops = result.state === 'swap' ? result.ops : [{ before, after: p }];
    const label = result.state === 'swap' ? `Trade ${what} with ${names(result.traded.map(q => cropLabel(q)))}` : before ? `Move ${what}` : payload.copy ? `Copy ${what}` : `Plant ${what}`;
    if (!commit(label, ops)) return null;
    select({ type: 'planting', id: p.id });
    const r = state.engine.calc(p), size = result.state === 'partial' || r.partial ? ` · ${UI.num(r.physicalLength, 1)} ${unit}` : '';
    toast(result.state === 'swap' ? `${what} traded places with ${names(result.traded.map(q => cropLabel(q)))}` : `${what} → ${where} · ${day(r.field)}${size}`, { label: 'Undo', run: undo });
    return p;
  }
  /**
   * Repeat a planting: `count` more, `every` days apart. Each one goes in the
   * same space if it is free then, otherwise the next free space of the same
   * kind in the garden. Returns how many could not be placed.
   */
  function addSuccessions(id, count, every) {
    const eng0 = state.engine, source = eng0.planting(id);
    if (!source) return;
    const home = eng0.bedOf(source.bedId), kind = eng0.spaceKind(home);
    const candidates = [home, ...state.plan.beds.filter(b => b.id !== home.id && b.gardenId === home.gardenId && b.active !== false && eng0.spaceKind(b) === kind)];
    const ops = [];
    let working = state.plan, missed = 0;
    for (let i = 1; i <= count; i++) {
      const date = E.addDays(E.s2d(source.date), every * i), eng = E.create(working, Lib, { sowing: false });
      let placed = null;
      for (const bed of candidates) {
        const res = Rails.propose(eng, { plantingId: source.id, copy: true }, { bedId: bed.id, date }, { source, noShrink: true });
        if (res.state === 'ok') { placed = res.p; break; }
      }
      if (placed) { working = { ...working, plantings: [...working.plantings, placed] }; ops.push({ before: null, after: placed }); } else missed++;
    }
    if (ops.length) commit(`Add ${ops.length} succession${ops.length === 1 ? '' : 's'} of ${cropLabel(source)}`, ops);
    toast(ops.length ? `Added ${ops.length} succession${ops.length === 1 ? '' : 's'}${missed ? ` · ${missed} had no free space in ${eng0.gardenOf(home).name}` : ''}` : `No free space in ${eng0.gardenOf(home).name} for those dates`,
      ops.length ? { label: 'Undo', run: undo } : null);
  }

  // ─────────────────────────── backup in / out ───────────────────────────
  const emptyAttic = () => ({ v: 1, rest: {}, varieties: {} });
  async function loadAttic() {
    if (state.attic) return state.attic;
    const source = (state.plan.lrfNext && state.plan.lrfNext.attic) || 'none';
    if (source === 'cloud') { const text = await store.loadBlob('attic'); if (text) return (state.attic = JSON.parse(text)); throw new Error('The stored backup records are missing. Load the v7 backup again before exporting.'); }
    if (source === 'session') throw new Error('The records this app does not edit yet were only held for the session they were loaded in. Load the v7 backup again before exporting.');
    return (state.attic = emptyAttic());
  }
  async function exportBackup() {
    try {
      const attic = await loadAttic(), extras = await loadExtras();
      const plan = IO.join(state.plan, { ...attic, varieties: { ...(attic.varieties || {}), ...extras.varieties } }), text = JSON.stringify(plan);
      const filename = `little-river-plan-${planYear()}-${E.d2s(new Date())}.json`;
      const downloads = root.claude && root.claude.use ? await root.claude.use('downloads') : null;
      const planOnly = !(state.plan.lrfNext && state.plan.lrfNext.attic === 'cloud');
      const done = planOnly ? 'Plan file saved. It holds the plan only, not v7’s seed inventory, supplier pages or photos.' : 'Backup saved. The v7 planner can restore this file.';
      const noted = () => adopt({ ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), lastExport: new Date().toISOString() } }, state.engine);
      if (downloads) { await downloads.save({ filename, data: new Blob([text], { type: 'application/json' }) }); noted(); toast(done); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = h('a', { href: url, download: filename });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      noted(); toast('Backup download started.');
    } catch (error) {
      if (error && error.code === 'declined') return;
      toast(`Backup not saved: ${(error && error.message) || 'downloads are not available in this view'}`);
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
  async function restoreMapImage() {
    const info = state.plan.lrfNext && state.plan.lrfNext.mapImage;
    if (!info || store.backend === 'memory') return;
    try {
      const text = await store.loadBlob('mapimage');
      if (text) { showMapImage(fromBase64(text), info.mime); emit('plan'); }
    } catch (_) { /* the plan is still usable without its photo */ }
  }
  async function importBackup(file) {
    let parsed;
    try { parsed = await readBackupFile(file); IO.assertPlan(parsed.plan); } catch (error) { toast(`That file could not be read: ${error.message}`); return; }
    const split = IO.split(parsed.plan), attic = split.attic, info = IO.summary(split.core), replacing = !isSample();
    // The plan comes from the backup. What was established here about the farm is put back on it.
    const carried = IO.carry(state.plan, split.core);
    let core = carried.plan;
    const records = { harvests: attic.rest.harvests, fieldRecords: attic.rest.fieldRecords };
    const monday = carried.keep.trayStart === 'monday' ? traysToMonday(core, records) : { plan: core, moved: [] };
    core = monday.plan;
    const kept = [...carried.notes, ...monday.moved.map(m => `${m.name} opening on a Monday (${day(E.s2d(m.to))}, not ${day(E.s2d(m.from))})`)];
    if (replacing) {
      const ok = await UI.confirm({
        title: 'Replace the plan in this app?',
        body: `The backup holds ${info.plantings} plantings in ${info.beds} growing spaces across ${info.gardens} gardens for ${info.year || 'an unknown year'}. Plantings, tray demand and seed stock are replaced by the backup’s, including what was changed here. ${kept.length ? `Kept from this copy: ${kept.join('; ')}. ` : ''}${carried.gone.length ? `${carried.gone.length} variet${carried.gone.length === 1 ? 'y' : 'ies'} here ${carried.gone.length === 1 ? 'is' : 'are'} not in the backup and will be gone (${carried.gone.slice(0, 3).join(', ')}${carried.gone.length > 3 ? '…' : ''}). ` : ''}Your v7 planner and its data are not touched.`,
        confirmLabel: 'Replace plan', danger: true
      });
      if (!ok) return;
    }
    const cloud = store.backend !== 'memory';   // somewhere durable to keep the photo and the rest of the backup
    core.lrfNext = { attic: cloud ? 'cloud' : 'session', importedAt: new Date().toISOString(), from: file.name, backup: (parsed.plan.backup && parsed.plan.backup.exportedAt) || parsed.plan._localUpdatedAt || null, ...carried.keep };
    state.plan = core; state.attic = attic; state.extras = emptyExtras(); state.inventoryBase = null; state.inventoryAsked = null; state.packsBase = {}; state.keptThumbs = {}; Thumbs.set({}); state.undo.length = 0; state.redo.length = 0; state.sel = null; delete document.body.dataset.sel;
    showMapImage(parsed.image && parsed.image.bytes, parsed.image && parsed.image.mime);
    rebuild(); state.date = defaultDate(); root.LRFMap.fit(true);
    emit('plan'); emit('date'); emit('sel');
    toast(`Loaded ${core.plantings.length} plantings in ${info.beds} growing spaces from ${file.name}${kept.length ? `. Kept from this copy: ${kept.join('; ')}` : ''}`);
    if (!cloud) { store.save(core); await importPhotos(parsed, 'memory'); return; }
    const where = store.backend;
    try { await store.clearBlob('attic-new'); } catch (_) { /* nothing was kept */ }
    // The plan itself is saved first; the bulky extras follow and may fail without harming it.
    try { await store.saveNow(core); } catch (error) { toast('The plan is open but could not be saved here yet. Use the save indicator to retry.'); return; }
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
    store.save(core);
  }

  // ───────────────────────────── start-up ─────────────────────────────
  function defaultDate() {
    const year = planYear(), today = new Date();
    return today.getFullYear() === year ? today : new Date(year, 5, 15);
  }
  function showStatus(info) {
    const el = document.getElementById('saveState');
    if (!el) return;
    const where = info.backend === 'cloud' ? 'Saved' : info.backend === 'device' ? 'Saved on this device' : 'Not saved';
    const text = info.label || { saving: 'Saving…', pending: 'Saving…', saved: where, error: 'Save failed · click to retry', unsaved: 'Not saved in this view', loading: 'Opening plan…', sample: 'Sample plan' }[info.state] || where;
    el.textContent = text; el.dataset.state = info.state; el.title = info.detail || (info.backend === 'cloud' ? 'Synced to this page’s database' : info.backend === 'device' ? 'Kept in this browser only' : 'Storage is not available here');
  }
  async function start() {
    showStatus({ backend: 'cloud', state: 'loading' });
    store = root.LRFStore.create(showStatus);
    const getJSON = path => fetch(path).then(r => r.ok ? r.json() : null).catch(() => null);
    const inlined = root.LRF_BUNDLED || null;   // the single-file build carries its data in the page
    const bundledInfo = inlined ? Promise.resolve(inlined.info) : getJSON('data/plan-info.json');
    let saved = null, loadError = null, firstRun = false;
    await store.connect();
    try { saved = await store.load(); } catch (error) { loadError = error; }
    state.bundled = await bundledInfo;
    if (saved) {
      state.plan = saved;
      // The plan saved here wins. When this copy of the page was built from a later v7 backup, say so instead of opening the older plan silently.
      const mine = saved.lrfNext || {}, held = String(mine.backup || mine.importedAt || mine.startedAt || '');
      if (state.bundled && state.bundled.backup && !mine.sample && String(state.bundled.backup) > held && mine.passedOver !== state.bundled.backup) state.newer = { backup: state.bundled.backup, held: mine.backup || null, counts: state.bundled.counts || null };
    } else {
      // Nothing saved yet: start from the farm's plan that ships with the page.
      const compact = inlined ? inlined.plan : state.bundled ? await getJSON('data/plan.json') : null;
      if (compact) { state.plan = IO.unpack(compact); state.plan.lrfNext = { source: 'bundled', attic: 'none', backup: state.bundled.backup, startedAt: new Date().toISOString(), ...(state.bundled.keep || {}) }; firstRun = !loadError; }
      else state.plan = IO.sample(Lib);
    }
    state.mapImageUrl = bundledImage();
    rebuild();
    state.date = defaultDate(); state.ready = true;
    document.body.dataset.view = state.view;
    emit('plan'); emit('date'); emit('sel'); emit('view');
    if (loadError) { showStatus({ backend: store.backend, state: 'error', detail: loadError.message }); toast(`The saved plan could not be opened (${loadError.message}). Showing the starting plan; nothing is overwritten.`); return; }
    if (firstRun) store.save(state.plan); else showStatus({ backend: store.backend, state: saved ? 'saved' : 'sample' });
    if (saved) restoreMapImage();
    loadThumbs(); loadPacks(); topUpVarieties().catch(() => {}); adoptTrayPlans();
    // Stock is needed wherever a sowing can be recorded, not only on the Seeds view: fetch it now, not on first visit.
    loadInventory().then(found => { if (found) emit('plan'); }).catch(() => {});
    store.watch(() => toast('This plan was changed on another device.', { label: 'Reload', run: () => root.location.reload() }));
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

  /** Keep the plan saved here and stop offering the one this copy carries. */
  function keepMine() {
    if (!state.newer) return;
    const passedOver = state.newer.backup; state.newer = null;
    adopt({ ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), passedOver } }, state.engine);
  }

  on('plan', () => Thumbs.index(state.plan));   // first listener: views drawn after it see the right crop pictures

  root.LRFApp = {
    state, on, emit, start, planYear, setDate, select, setView, arm, bedLabel, cropLabel,
    commit, undo, redo, updatePlanting, updateBeds, removePlantings, preview, place, addSuccessions, setAssumption, setGardenType,
    revise: assume, impact, varietyRecord, keepVarietyRecord, keepThumb, loadInventory, inventoryNow, stockNow, editStock, packsFor, coverFor, sowingOf, recordSowing, takeBackSowing, recordSowings, takeBackSowings, planSowings, today: todayText, uid, storage: () => (store ? store.backend : 'memory'),
    saveTrays, removeTrays, trayRecords, useBundled, keepMine, exportBackup, importBackup, retrySave: () => store && store.retry(), isSample, setOwn, traysToMonday: () => applyTrayStart()
  };
})(window);
