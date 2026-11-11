/* Little River Farm Planner — the plan folder: the plan kept as a file on the computer, written as it changes.
 *
 * A browser keeps a site's data only until that data is cleared. A folder on the computer is the grower's own:
 * it is in his backups, it can sit in a synced drive, it can be copied to another machine. Where the browser
 * lets a page write to a folder it has been given (Chrome and Edge on a computer), the planner keeps this there:
 *
 *   little-river-plan.json          the whole plan, rewritten a moment after every change
 *   map-photo.jpg (or .png, .webp)  the farm photo
 *   thumbnails.json                 the small variety photos
 *   history/plan-YYYY-MM-DD.json    the plan as it stood at the end of each earlier day it was worked on (newest 30)
 *
 * One rule protects the file: a write never lands on a plan this browser did not put there. If the file has
 * changed since this browser last wrote it (another computer sharing the folder, or a copy dropped in by hand),
 * saving stops and the app asks which plan to keep.
 *
 * No page of the app is touched here. The app hands over what to write; this module owns the folder.
 */
(function (root) {
  'use strict';
  const PLAN = 'little-river-plan.json', THUMBS = 'thumbnails.json', HISTORY = 'history', KEEP = 30, DB = 'lrf-next-folder', WROTE = 'lrf-next:folder-wrote';
  const MAP_NAMES = { 'image/jpeg': 'map-photo.jpg', 'image/png': 'map-photo.png', 'image/webp': 'map-photo.webp' };
  const listeners = [];
  const st = { dir: null, name: '', needsPermission: false, savedAt: null, error: '', conflict: null, wrote: null, lastDay: '', busy: false, queued: null, extrasKey: null };

  const framed = () => { try { return root.self !== root.top; } catch (_) { return true; } };
  /** Can this browser, here, be given a folder to write to? Not inside another site's frame, and not in Firefox or Safari. */
  const supported = () => typeof root.showDirectoryPicker === 'function' && !framed();
  const info = () => ({ supported: supported() || !!st.dir, connected: !!st.dir && !st.needsPermission, name: st.name, needsPermission: st.needsPermission, savedAt: st.savedAt, error: st.error, conflict: st.conflict, busy: st.busy });
  const emit = () => { const now = info(); for (const fn of listeners) { try { fn(now); } catch (_) { /* a listener's fault is not the folder's */ } } };
  /** A name for this browser, so a plan file can say who wrote it. Made once, kept in the browser. */
  function device() {
    try {
      let id = root.localStorage.getItem('lrf-next:device');
      if (!id) { id = 'd-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); root.localStorage.setItem('lrf-next:device', id); }
      return id;
    } catch (_) { return 'd-session'; }
  }

  // The folder is remembered between visits. A handle cannot be written down as text; the browser's database can hold one.
  function idb(mode, work) {
    return new Promise((resolve, reject) => {
      const open = root.indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('handles', mode), request = work(tx.objectStore('handles'));
        tx.oncomplete = () => { open.result.close(); resolve(request && request.result); };
        tx.onerror = tx.onabort = () => { open.result.close(); reject(tx.error); };
      };
    });
  }
  const remember = handle => (root.indexedDB ? idb('readwrite', s => (handle ? s.put(handle, 'folder') : s.delete('folder'))).catch(() => {}) : Promise.resolve());
  const recall = () => (root.indexedDB ? idb('readonly', s => s.get('folder')).catch(() => null) : Promise.resolve(null));
  /** What this browser last wrote, by the time stamped inside the file: how it knows its own writing when it comes back. */
  function lastWrote(value) {
    try {
      if (value === undefined) return JSON.parse(root.localStorage.getItem(WROTE) || 'null');
      if (value) root.localStorage.setItem(WROTE, JSON.stringify(value)); else root.localStorage.removeItem(WROTE);
    } catch (_) { /* without it the app asks before the first write, which is the safe side */ }
    return value || null;
  }

  async function fileIn(dir, name) { try { return await dir.getFileHandle(name); } catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; } }
  async function writeFile(dir, name, data) {
    const handle = await dir.getFileHandle(name, { create: true }), out = await handle.createWritable();   // written beside the old file and swapped in on close
    try { await out.write(data); } finally { await out.close(); }
    return (await handle.getFile()).lastModified;
  }
  /** What the plan file in the folder says of itself: who saved it, when, how big a plan. */
  async function peek(dir = st.dir) {
    const handle = dir && await fileIn(dir, PLAN);
    if (!handle) return null;
    const file = await handle.getFile(), text = await file.text();
    let plan = null;
    try { plan = JSON.parse(text); } catch (_) { return { modified: file.lastModified, size: file.size, broken: true, text }; }
    const own = (plan && plan.lrfNextKeep) || {};
    return { modified: file.lastModified, size: file.size, savedAt: own.savedAt || null, device: own.device || null, mine: own.device === device(),
      plantings: plan && Array.isArray(plan.plantings) ? plan.plantings.length : 0, year: plan && plan.settings ? plan.settings.year : null, text };
  }
  const conflictOf = (there, why) => ({ why, savedAt: there.savedAt, modified: there.modified, plantings: there.plantings, mine: !!there.mine, broken: !!there.broken });

  /** Take a folder as the plan's home. A plan already in it that this browser did not write is never written over unasked. */
  async function adopt(dir, why) {
    st.dir = dir; st.name = dir.name; st.needsPermission = false; st.error = ''; st.conflict = null; st.lastDay = ''; st.extrasKey = null; st.wrote = null; st.savedAt = null;
    const there = await peek(dir), mine = lastWrote();
    if (there && mine && mine.name === dir.name && mine.savedAt && mine.savedAt === there.savedAt) { st.wrote = { modified: there.modified, savedAt: there.savedAt }; st.savedAt = there.savedAt; }
    else if (there) st.conflict = conflictOf(there, why);
    emit();
    return info();
  }
  /** Ask the user for a folder. Must be called from a click. */
  async function choose() {
    const dir = await root.showDirectoryPicker({ id: 'lrf-plan', mode: 'readwrite' });
    await remember(dir);
    return adopt(dir, 'found');
  }
  /** At start-up: is there a folder from last time, and may this page still write to it? (A test hands the folder in.) */
  async function restore(given) {
    const dir = given || await recall();
    if (!dir) return info();
    let allowed = 'granted';
    try { if (dir.queryPermission) allowed = await dir.queryPermission({ mode: 'readwrite' }); } catch (_) { allowed = 'prompt'; }
    if (allowed !== 'granted') { st.dir = dir; st.name = dir.name; st.needsPermission = true; emit(); return info(); }
    try { return await adopt(dir, 'changed'); } catch (e) { st.dir = dir; st.name = dir.name; st.error = (e && e.message) || 'The folder could not be read.'; emit(); return info(); }
  }
  /** The browser asks the user again whether the page may write to the folder. Must be called from a click. */
  async function reconnect() {
    if (!st.dir) return info();
    let allowed = 'granted';
    try { if (st.dir.requestPermission) allowed = await st.dir.requestPermission({ mode: 'readwrite' }); } catch (_) { allowed = 'denied'; }
    if (allowed !== 'granted') { st.needsPermission = true; emit(); return info(); }
    return adopt(st.dir, 'changed');
  }
  async function forget() {
    Object.assign(st, { dir: null, name: '', needsPermission: false, savedAt: null, error: '', conflict: null, wrote: null, lastDay: '', queued: null, extrasKey: null });
    lastWrote(null); await remember(null); emit();
  }
  /** For tests: hand over a folder directly (the browser's private file system gives one with no picker). */
  async function use(dir, options = {}) { if (options.keep !== false) await remember(dir); return adopt(dir, 'found'); }

  async function keepHistory(text, day) {
    const dir = await st.dir.getDirectoryHandle(HISTORY, { create: true }), name = `plan-${day}.json`;
    if (!(await fileIn(dir, name))) await writeFile(dir, name, text);
    const names = [];
    for await (const [entry, handle] of dir.entries()) if (handle.kind === 'file' && /^plan-\d{4}-\d{2}-\d{2}\.json$/.test(entry)) names.push(entry);
    names.sort();
    for (const old of names.slice(0, Math.max(0, names.length - KEEP))) { try { await dir.removeEntry(old); } catch (_) { /* an old copy that will not go is no harm */ } }
  }
  /**
   * Write the plan. make() returns { text, savedAt, extrasKey, extras: async () => ({ map: { bytes, mime } | null, thumbs: text | null }) }.
   * It is only called once the folder is known to be free to write, so nothing is built for a save that will not happen.
   * With force, a plan found in the folder is written over: the user has said to.
   */
  async function save(make, options = {}) {
    if (!st.dir || st.needsPermission) return { skipped: 'no folder' };
    if (st.conflict && !options.force) return { skipped: 'conflict' };
    if (st.busy) { st.queued = { make, options }; return { queued: true }; }
    st.busy = true; emit();
    try {
      const handle = await fileIn(st.dir, PLAN), modified = handle ? (await handle.getFile()).lastModified : null;
      let there = null;
      if (handle && !options.force && (!st.wrote || modified !== st.wrote.modified)) {
        // The file is not as this browser left it. A touched but identical file (a sync program can do that) is still ours.
        there = await peek();
        if (!(there && st.wrote && there.savedAt === st.wrote.savedAt)) { st.conflict = conflictOf(there || { modified }, 'changed'); return { skipped: 'conflict' }; }
      }
      const payload = await make(), day = payload.savedAt.slice(0, 10);
      if (st.lastDay !== day) {
        // the first save of a day: put the plan as it was left on its last day into the history
        const before = there || (handle ? await peek() : null), was = before && !before.broken && before.savedAt ? before.savedAt.slice(0, 10) : null;
        if (was && was !== day) await keepHistory(before.text, was);
        st.lastDay = day;
      }
      const written = await writeFile(st.dir, PLAN, payload.text);
      st.wrote = { modified: written, savedAt: payload.savedAt }; st.savedAt = payload.savedAt; st.error = ''; st.conflict = null;
      lastWrote({ name: st.name, savedAt: payload.savedAt });
      if (payload.extras && payload.extrasKey !== st.extrasKey) {
        const extra = await payload.extras();
        if (extra && extra.map && MAP_NAMES[extra.map.mime]) await writeFile(st.dir, MAP_NAMES[extra.map.mime], extra.map.bytes);
        if (extra && extra.thumbs) await writeFile(st.dir, THUMBS, extra.thumbs);
        st.extrasKey = payload.extrasKey;
      }
      return { saved: true, savedAt: payload.savedAt };
    } catch (e) {
      st.error = (e && e.message) || 'The folder could not be written.';
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) st.needsPermission = true;
      return { error: st.error };
    } finally {
      st.busy = false; emit();
      if (st.queued) { const next = st.queued; st.queued = null; save(next.make, next.options); }
    }
  }
  /** Everything the folder holds of the plan, for opening it here: { text, map: { bytes, mime } | null, thumbs: text | null, meta }. */
  async function read() {
    const meta = await peek();
    if (!meta || meta.broken) return null;
    let map = null, thumbs = null;
    for (const [mime, name] of Object.entries(MAP_NAMES)) {
      const handle = await fileIn(st.dir, name);
      if (handle) { map = { bytes: new Uint8Array(await (await handle.getFile()).arrayBuffer()), mime }; break; }
    }
    const t = await fileIn(st.dir, THUMBS);
    if (t) thumbs = await (await t.getFile()).text();
    return { text: meta.text, map, thumbs, meta };
  }
  /** The plan in the folder has been opened here: it is now this browser's own, and saving goes on from it. */
  async function accept() {
    const there = await peek();
    if (!there) return info();
    st.wrote = { modified: there.modified, savedAt: there.savedAt }; st.savedAt = there.savedAt; st.conflict = null; st.error = '';
    if (there.savedAt) lastWrote({ name: st.name, savedAt: there.savedAt });
    emit();
    return info();
  }

  root.LRFFolder = { supported, info, device, choose, restore, reconnect, forget, use, save, read, accept, on: fn => listeners.push(fn), PLAN };
})(window);
