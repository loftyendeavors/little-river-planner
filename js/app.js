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
    plan: null, engine: null, attic: null, extras: null, bundled: null, mapImageUrl: '',
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
  const touched = (ops, engine) => { const ids = new Set(); for (const op of ops) { if (['assume', 'garden', 'variety', 'crop', 'settings'].includes(op.kind)) continue; if (op.kind === 'bed') { for (const p of engine.plantingsIn((op.after || op.before).id)) ids.add(p.id); } else if (op.after) ids.add(op.after.id); } return [...ids]; };
  /** Why the guard rails refuse an edit, in words. */
  function refusalText(no, engine) {
    const bed = engine.bedOf(no.p.bedId), what = cropLabel(no.p, engine), unit = engine.capUnit(bed);
    if (no.kind === 'too-long') return `${what} would run past the end: ${bedLabel(bed, engine)} is ${UI.num(engine.capOf(bed), 1)} ${unit}`;
    if (!no.other) return `${bedLabel(bed, engine)} is resting then`;
    const r = engine.calc(no.other), until = engine.occupancyThrough(no.other, r), starts = engine.occupancyFrom(no.other, r) > engine.occupancyFrom(no.p, no.r);
    return `${what} would overlap ${cropLabel(no.other, engine)} in ${bedLabel(bed, engine)} (${starts ? 'goes in ' + day(r.field) : until === Infinity ? 'stays all season' : 'holds the ground until ' + day(until)})`;
  }
  function commit(label, ops, options = {}) {
    if (!ops.length) return false;
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
    } else res.text = { space: 'Not a growing space', crop: 'This crop cannot be planned here', 'micro-needs-bench': 'Microgreens go on a living-tray bench', 'bench-needs-micro': 'This bench takes living trays only', 'too-long': 'Does not fit this space' }[res.why] || heldText(res);
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
      const date = E.addDays(E.s2d(source.date), every * i), eng = E.create(working, Lib);
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
    if (!Zip.isZip(bytes)) return { plan: JSON.parse(new TextDecoder().decode(bytes)), image: null };
    const entries = Zip.directory(bytes), planEntry = entries.get('plan.json');
    if (!planEntry) throw new Error('This zip has no plan.json. Use a backup made by the planner.');
    const plan = JSON.parse(new TextDecoder().decode(await Zip.read(bytes, planEntry))), ref = plan.map && plan.map.imageFile;
    const imageEntry = ref && ref.sha256 ? entries.get('files/' + ref.sha256) : null;
    const image = imageEntry ? { sha256: ref.sha256, mime: /^image\/(jpeg|png|webp)$/.test(ref.mime || '') ? ref.mime : 'image/jpeg', bytes: await Zip.read(bytes, imageEntry) } : null;
    return { plan, image };
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
    const { core, attic } = IO.split(parsed.plan), info = IO.summary(core), replacing = !(state.plan.lrfNext && state.plan.lrfNext.sample);
    if (replacing) {
      const ok = await UI.confirm({
        title: 'Replace the plan in this app?',
        body: `The backup holds ${info.plantings} plantings in ${info.beds} growing spaces across ${info.gardens} gardens for ${info.year || 'an unknown year'}. It replaces what is here now, including edits made here. Your v7 planner and its data are not touched.`,
        confirmLabel: 'Replace plan', danger: true
      });
      if (!ok) return;
    }
    const cloud = store.backend !== 'memory';   // somewhere durable to keep the photo and the rest of the backup
    core.lrfNext = { attic: cloud ? 'cloud' : 'session', importedAt: new Date().toISOString(), from: file.name };
    state.plan = core; state.attic = attic; state.extras = emptyExtras(); state.undo.length = 0; state.redo.length = 0; state.sel = null; delete document.body.dataset.sel;
    showMapImage(parsed.image && parsed.image.bytes, parsed.image && parsed.image.mime);
    rebuild(); state.date = defaultDate(); root.LRFMap.fit(true);
    emit('plan'); emit('date'); emit('sel');
    toast(`Loaded ${info.plantings} plantings in ${info.beds} growing spaces from ${file.name}`);
    if (!cloud) { store.save(core); return; }
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
    if (saved) state.plan = saved;
    else {
      // Nothing saved yet: start from the farm's plan that ships with the page.
      const compact = inlined ? inlined.plan : state.bundled ? await getJSON('data/plan.json') : null;
      if (compact) { state.plan = IO.unpack(compact); state.plan.lrfNext = { source: 'bundled', attic: 'none', backup: state.bundled.backup, startedAt: new Date().toISOString() }; firstRun = !loadError; }
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
    store.watch(() => toast('This plan was changed on another device.', { label: 'Reload', run: () => root.location.reload() }));
  }

  root.LRFApp = {
    state, on, emit, start, planYear, setDate, select, setView, arm, bedLabel, cropLabel,
    commit, undo, redo, updatePlanting, updateBeds, removePlantings, preview, place, addSuccessions, setAssumption, setGardenType,
    revise: assume, impact, varietyRecord, keepVarietyRecord, uid, storage: () => (store ? store.backend : 'memory'),
    exportBackup, importBackup, retrySave: () => store && store.retry(), isSample: () => !!(state.plan && state.plan.lrfNext && state.plan.lrfNext.sample)
  };
})(window);
