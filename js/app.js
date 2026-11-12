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
  /** What this app keeps beside a plan that v7 knows nothing of. It travels in a plan file's own note (see withOwn). */
  const OWN_KEYS = ['crates', 'trayStart', 'trays', 'groups', 'facts', 'waiting'];
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
    startOfDay();   // the plan as it stood before the first change of a day is kept as a snapshot
    state.plan = plan; state.engine = engine || E.create(plan, Lib);
    store.save(state.plan);
    folderSoon();
    if (sync) sync.touch();
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
    if (state.sel && state.sel.type === 'waiting' && !waitingOne(state.sel.id)) select(null);
    toast(`Undid: ${step.label}`);
  }
  function redo() {
    const step = state.redo.pop();
    if (!step) return;
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
    const moves = hit.changed ? `${hit.changed} planting${hit.changed === 1 ? '' : 's'} ${hit.later && hit.sooner ? 'shift' : hit.later ? 'harvest later' : 'harvest sooner'}, by up to ${Math.abs(hit.most)} day${Math.abs(hit.most) === 1 ? '' : 's'}` : 'No planting’s dates change';
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
    refreshRemote();
    Thumbs.index(state.plan); emit('plan');
    rebuildThumbs();
  }
  const saveThumbs = async () => { try { return store.backend === 'memory' ? false : await store.saveBlob('thumbs', JSON.stringify(state.keptThumbs)); } catch (_) { return false; } };

  // A variety's photo record says where its picture came from (v7 writes one; so does the importer here). Where the small photo
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
  /** Make thumbnails from the variety photos inside a v7 backup zip. */
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
    const out = { map: null, added: 0, had: 0, strange: 0, problems: [] }, tally = r => { out.added += r.added; out.had += r.had; out.strange += r.strange; };
    const mapFrom = async (bytes, mime, force) => { if (force || !state.mapImageUrl) out.map = await setMapPhoto(bytes, mime); };
    for (const file of list) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()), mime = pictureType(bytes);
        if (mime) { await mapFrom(bytes, mime, true); continue; }
        if (root.LRFZip.isZip(bytes)) { const found = await zipPictures(bytes); if (found.map) await mapFrom(found.map, pictureType(found.map) || 'image/jpeg', false); tally(await addThumbs(found.thumbs)); continue; }
        let data;
        try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error('is not a picture, a photo file or a backup'); }
        if (data && Array.isArray(data.plantings)) throw new Error('is a plan, not photos. To open it, use Backup, Load a v7 backup');
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
    if (payload.waitingId) return previewWaiting(payload.waitingId, target);
    let res = Rails.propose(eng, payload, target);
    // A trade is only offered where the grower can see it coming: while dragging.
    if (res.state === 'blocked' && res.why === 'held' && payload.plantingId && !target.noSwap) res = Rails.swap(eng, payload, target) || res;
    const unit = bed ? eng.capUnit(bed) : 'ft', r = res.r, harvest = r ? `harvest ${span(r.first, r.last)}` : '';
    if (res.state === 'swap') res.text = `Trade places with ${names(res.traded.map(q => cropLabel(q)))}`;
    else if (res.state === 'ok') res.text = payload.plantingId ? `${payload.copy ? 'Copy' : 'Move'} here · ${harvest}` : `${day(r.field)} · ${harvest}`;
    else if (res.state === 'partial') {
      const rows = res.rect && res.rect.rows && res.rect.rows.count < res.rect.rows.total ? `${res.rect.rows.count} of ${res.rect.rows.total} rows · ` : '';
      res.text = `${rows}${UI.num(r.physicalLength, 1)} ${unit} free${res.was && res.shrunk ? ` (it has ${UI.num(res.was.len, 1)})` : ''} · ${harvest}`;
    } else res.text = { space: 'Not a growing space', crop: 'This crop cannot be planned here', 'micro-needs-bench': 'Microgreens go on a living-tray bench', 'bench-needs-micro': 'This bench takes living trays only', 'no-count': 'This bench has no tray count yet', 'too-long': 'Does not fit this space', pool: 'Live trays follow weekly demand: change it on the Trays view' }[res.why] || heldText(res);
    return res;
  }
  // ─────────────────── plantings with no bed yet ───────────────────
  // A series can make plantings that wait to be placed. They live in a list of their own beside the plan (lrfNext.waiting), so nothing
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
    } else res.text = { space: 'Not a growing space', crop: 'This crop cannot be planned here', 'micro-needs-bench': 'Microgreens go on a living-tray bench', 'bench-needs-micro': 'This bench takes living trays only', 'no-count': 'This bench has no tray count yet', 'too-long': 'Does not fit this space', pool: 'Live trays follow weekly demand: change it on the Trays view' }[res.why] || heldText(res);
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
    if (result.state === 'blocked') { toast(result.why === 'held' ? `${bedLabel(bed)}: ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)}` : result.text); return null; }
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
    if (!commit(shared ? `Place ${what}, sharing ${bedLabel(bed)}` : `Place ${what}`, ops)) return null;
    select({ type: 'planting', id: p.id });
    const r = state.engine.calc(p), unit = state.engine.capUnit(bed), f = state.engine.footprint(p, r);
    const size = f && f.rows && f.rows.count < f.rows.total ? ` · ${f.rows.count} of ${f.rows.total} rows` : r.partial ? ` · ${UI.num(r.physicalLength, 1)} ${unit}` : '';
    toast(`${what} → ${bedLabel(bed)} · ${day(r.field)}${size}`, { label: 'Undo', run: undo });
    return p;
  }
  /** Add a series as one step: what found ground goes onto it, what did not (or was asked to wait) joins the list to place. */
  function addSeries(result, label) {
    const ops = (result.plantings || []).map(p => ({ before: null, after: p })), held = result.held || [];
    if (held.length) ops.push(waitingOp([...waiting(), ...held]));
    return ops.length ? commit(label || 'Add a series', ops) : false;
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
  function place(payload, bedId, date, aim = {}) {
    if (payload.waitingId) { placeWaiting(payload.waitingId, bedId, aim); return null; }   // it may ask how to share the bed first
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

  /** Add plantings worked out elsewhere (a series of successions, a crop for an opening) as one step. The guard rails still have the last word. */
  function addPlantings(list, label) {
    const ops = (list || []).map(p => ({ before: null, after: p }));
    return ops.length ? commit(label || `Add ${ops.length} planting${ops.length === 1 ? '' : 's'}`, ops) : false;
  }
  /**
   * Plan ahead with something in mind, in place: { mode: 'series', sourceId?, cropId?, varietyId?, bedId?, gardenId?, from? } opens the
   * series tool in the details panel; { bedId, openingId } shows that opening there, as a click on it does.
   */
  function openAhead(focus) {
    focus = focus || {};
    if (focus.mode === 'series') { if (root.LRFSeries) root.LRFSeries.open(focus); return; }
    if (focus.openingId && focus.bedId) select({ type: 'opening', id: focus.openingId, bedId: focus.bedId });
    else if (focus.bedId) select({ type: 'bed', id: focus.bedId });
  }

  /**
   * Names this app has since changed, put right on a plan as it is opened. v7 called the stand-in space live trays are filed
   * under "Shared heated space"; here it is the heated greenhouse benches. Every plan opened or loaded passes through here, so
   * a v7 backup loaded later is renamed too, with nothing to remember.
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
    if (source === 'cloud') { const text = await store.loadBlob('attic'); if (text) return (state.attic = JSON.parse(text)); throw new Error('The stored backup records are missing. Load the v7 backup again before exporting.'); }
    if (source === 'session') throw new Error('The records this app does not edit yet were only held for the session they were loaded in. Load the v7 backup again before exporting.');
    return (state.attic = emptyAttic());
  }
  async function exportBackup() {
    try {
      const attic = await loadAttic(), extras = await loadExtras();
      const plan = withOwn(IO.join(state.plan, { ...attic, varieties: { ...(attic.varieties || {}), ...extras.varieties } }), new Date().toISOString()), text = JSON.stringify(plan);
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
  async function importBackup(file, extra = {}) {
    let parsed;
    try { parsed = await readBackupFile(file); IO.assertPlan(parsed.plan); } catch (error) { toast(`That file could not be read: ${error.message}`); return false; }
    // A file this app saved says what was settled here (v7 knows none of it); a v7 backup has no such note.
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
        body: `The backup holds ${info.plantings} plantings in ${info.beds} growing spaces across ${info.gardens} gardens for ${info.year || 'an unknown year'}. Plantings, tray demand and seed stock are replaced by the backup’s, including what was changed here. ${kept.length ? `Kept from this copy: ${kept.join('; ')}. ` : ''}${leftBehind ? `The ${leftBehind} planting${leftBehind === 1 ? '' : 's'} still to place here ${leftBehind === 1 ? 'is' : 'are'} not in that file and will be gone. ` : ''}${carried.gone.length ? `${carried.gone.length} variet${carried.gone.length === 1 ? 'y' : 'ies'} here ${carried.gone.length === 1 ? 'is' : 'are'} not in the backup and will be gone (${carried.gone.slice(0, 3).join(', ')}${carried.gone.length > 3 ? '…' : ''}). ` : ''}Your v7 planner and its data are not touched.`,
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
    const keepMap = planOnly && !parsed.image && !!wasInfo.mapImage && !!state.mapImageUrl && sameRef(core.map && core.map.imageFile, was && was.map && was.map.imageFile);
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
  /** The app's own record, added to a plan file so that opening the file here again loses nothing v7 does not know. */
  function withOwn(plan, savedAt, source = state.plan) {
    const mine = source.lrfNext || {}, keep = {};
    for (const key of OWN_KEYS) if (mine[key] != null) keep[key] = mine[key];
    plan.lrfNextKeep = { v: 1, savedAt, device: Folder ? Folder.device() : null, keep };
    return plan;
  }
  /** The whole plan as a file's text: what Backup downloads, what the folder, a snapshot and the cloud each hold. `plan` is taken as it stands at the call. */
  async function planText(plan = state.plan) {
    let attic = null;
    try { attic = await loadAttic(); } catch (_) { attic = emptyAttic(); }   // the plan is saved even when the records v7 keeps beside it are out of reach
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
      if (options.skipSame || options.daily) {
        const kept = await Snaps.list(), today = options.daily ? kept.find(s => s.why === 'day:' + options.daily) : null;
        if (today) return today;
        if (options.skipSame && kept[0] && kept[0].key === key) return kept[0];
      }
      const made = await planText(plan);
      const record = await Snaps.add({ name, auto: !!options.auto, why: options.daily ? 'day:' + options.daily : '', plantings: plan.plantings.length, waiting: ((plan.lrfNext || {}).waiting || []).length, year: +(plan.settings && plan.settings.year) || null, key, device: Folder ? Folder.device() : '', at: made.savedAt }, made.text);
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
    if (snapDay === today || !state.ready || !Snaps) return;
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
  function startSync(photosReady) {
    if (!Sync || sync) return;
    sync = Sync.create({
      mode: () => (state.unreadable ? 'held' : isSample() ? 'sample' : 'plan'),
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
      else if (c.status === 'waiting' && info.state === 'saved') { text = filed ? `Saved · ${f.name} · cloud waiting` : 'Saved here · cloud waiting'; title = 'The cloud could not be reached. The plan is saved in this browser and is sent when there is a connection.'; }
      else if (c.status === 'in-step' && info.state === 'saved' && c.savedAt) { text = filed ? `Saved · folder + cloud ${clock(c.savedAt)}` : `Saved · cloud ${clock(c.savedAt)}`; title = `Kept in this browser${filed ? `, written to the folder “${f.name}” at ${clock(f.savedAt)}` : ''}, and sent to the cloud at ${clock(c.savedAt)}.`; }
    }
    if (ask) el.dataset.ask = ask; else delete el.dataset.ask;
    el.textContent = text; el.dataset.state = state2; el.title = title;
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
    // something is stored but it is not a plan (a list, an object with no plantings): treated as unreadable, not opened and not written over
    if (saved && !(typeof saved === 'object' && Array.isArray(saved.plantings) && Array.isArray(saved.beds) && Array.isArray(saved.gardens))) { saved = null; loadError = new Error('what is stored is not a plan'); }
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

  /** Keep the plan saved here and stop offering the one this copy carries. */
  function keepMine() {
    if (!state.newer) return;
    const passedOver = state.newer.backup; state.newer = null;
    adopt({ ...state.plan, lrfNext: { ...(state.plan.lrfNext || {}), passedOver } }, state.engine);
  }

  on('plan', () => Thumbs.index(state.plan));   // first listener: views drawn after it see the right crop pictures

  root.LRFApp = {
    state, on, emit, start, planYear, setDate, select, setView, arm, bedLabel, cropLabel,
    commit, undo, redo, updatePlanting, updateBeds, removePlantings, preview, place, addSuccessions, addPlantings, openAhead, setAssumption, setGardenType,
    waiting, waitingOne, placeWaiting, addSeries, removeWaiting, updateWaiting,
    revise: assume, impact, varietyRecord, keepVarietyRecord, keepThumb, addPhotos, openFiles, rebuildThumbs, photoGaps, photoSource, loadInventory, inventoryNow, stockNow, editStock, packsFor, coverFor, sowingOf, recordSowing, takeBackSowing, recordSowings, takeBackSowings, planSowings, today: todayText, uid, storage: () => (store ? store.backend : 'memory'),
    saveTrays, removeTrays, trayRecords, useBundled, keepMine, exportBackup, importBackup, retrySave: () => { if (state.unreadable) { toast('The plan stored in this browser could not be opened. The choices are at the top of the page.'); return null; } const f = folderInfo(); if (f.needsPermission) return reconnectFolder(); if (f.error && f.connected) return saveToFolder(); return store && store.retry(); },
    saveNow, chooseFolder, reconnectFolder, openFolderPlan, openMyFolder, downloadStored, useShown, overwriteFolder, leaveFolder, folder: folderInfo, saveToFolder, isSample, setOwn, traysToMonday: () => applyTrayStart(),
    snapshot, snapshots, restoreSnapshot, deleteSnapshot, downloadSnapshot, contentKey, sync: () => sync, syncInfo, snapshotsKept: () => !!Snaps
  };
})(window);
