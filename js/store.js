/* Little River Farm Planner — saving and loading the plan.
 *
 * Three places a plan can live, tried in this order:
 *   cloud   the page's own database (synced across devices, survives republish)
 *   device  this browser's localStorage (one device only)
 *   memory  nothing durable; the page still works for the session
 *
 * The cloud copy is split into parts so a small edit rewrites one small
 * document rather than the whole plan:
 *   plan/manifest   { rev, savedAt, session, parts:[names], buckets:{plantings:n, varieties:n} }
 *   plan/<part>     { json: "<JSON text>" }
 * Parts hold JSON text because the store limits documents to 256 KiB and
 * its own typing rules are stricter than a plan's records.
 *
 * The device copy is one text, written whole, and two windows of one browser share it. Two guards keep a window from
 * writing over what another has saved:
 *   one window holds the plan: the browser's lock "lrf-next:plan", asked for once as the page starts and held for the
 *   life of the page. A window without it only shows the plan. It can ask for the plan to be handed over (takeOver).
 *   a count beside the stored plan ("lrf-next:plan-n"), read with the plan and read again before every write. If it is
 *   not the one this window last read or wrote, another window has written since, and nothing is written here.
 * A window that writes nothing is read-only and says why (readOnly): 'window' another window holds the plan, 'moved' the
 * plan was handed to another window, 'changed' another window has written. Only a reload ends it.
 */
(function (root) {
  'use strict';

  const DEVICE_KEY = 'lrf-next:plan', COUNT_KEY = 'lrf-next:plan-n', LOCK = 'lrf-next:plan', PART_TARGET = 100000, LOAD_TIMEOUT_MS = 10000;
  const SESSION = Math.random().toString(36).slice(2, 10);
  const BUCKETED = ['plantings', 'varieties'], WHOLE = ['gardens', 'beds', 'crops'];
  /** One large record cut into pieces of JSON text: seed stock and its change log grow with every count. */
  const CHUNKED = ['seedInventory'], CHUNK = 150000;
  const hash = s => { let x = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  const pad2 = n => String(n).padStart(2, '0');
  const timeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out')), ms))]);

  /** Plan -> { name: jsonText } with stable part boundaries. */
  function toParts(core, bucketCounts) {
    const parts = {}, buckets = {};
    const base = {};
    for (const [key, value] of Object.entries(core)) if (!BUCKETED.includes(key) && !WHOLE.includes(key) && !CHUNKED.includes(key)) base[key] = value;
    parts.base = JSON.stringify(base);
    for (const key of WHOLE) parts[key] = JSON.stringify(core[key] || []);
    for (const key of BUCKETED) {
      const list = core[key] || [], size = JSON.stringify(list).length;
      // Keep the bucket count once chosen; grow it only when a bucket would get too big.
      const n = Math.max(bucketCounts[key] || 1, Math.ceil(size / PART_TARGET));
      const groups = Array.from({ length: n }, () => []);
      for (const item of list) groups[hash(item && item.id) % n].push(item);
      groups.forEach((group, i) => { parts[`${key}-${pad2(i)}`] = JSON.stringify(group); });
      buckets[key] = n;
      // Record order separately: buckets scramble it and the plan's lists are order-sensitive.
      parts[`${key}-order`] = JSON.stringify(list.map(item => item && item.id));
    }
    for (const key of CHUNKED) {
      if (core[key] === undefined) continue;
      const text = JSON.stringify(core[key]), n = Math.max(1, Math.ceil(text.length / CHUNK));
      for (let i = 0; i < n; i++) parts[`${key}-${pad2(i)}`] = text.slice(i * CHUNK, (i + 1) * CHUNK);
      buckets[key + 'Parts'] = n;
    }
    return { parts, buckets };
  }
  function fromParts(parts, buckets) {
    const core = JSON.parse(parts.base);
    for (const key of WHOLE) core[key] = JSON.parse(parts[key] || '[]');
    for (const key of BUCKETED) {
      const byId = new Map();
      for (let i = 0; i < (buckets[key] || 0); i++) for (const item of JSON.parse(parts[`${key}-${pad2(i)}`] || '[]')) byId.set(item.id, item);
      const order = JSON.parse(parts[`${key}-order`] || '[]');
      core[key] = order.map(id => byId.get(id)).filter(Boolean);
    }
    for (const key of CHUNKED) {
      const n = buckets[key + 'Parts'] || 0;
      if (n) core[key] = JSON.parse(Array.from({ length: n }, (_, i) => parts[`${key}-${pad2(i)}`] || '').join(''));
    }
    return core;
  }

  /** Why a read-only window does not save, as saveNow says it. */
  const ELSEWHERE = { window: 'The planner is open in another window of this browser, and the plan is saved from there.', moved: 'The plan is now being worked on in another window.', changed: 'The plan was changed in another window.' };

  function create(onStatus) {
    let db = null, backend = 'memory', rev = 0, saved = {}, buckets = {}, dirty = null, saving = false, unsubscribe = null, failed = false;
    let timer = null, readOnly = '', count = 0, letGo = null, channel = null, given = null;
    const status = (state, detail) => onStatus && onStatus({ backend, state, detail: detail || '' });
    /** From here on this window writes nothing. The first reason stands. */
    function stop(why) {
      if (readOnly) return;
      readOnly = why; clearTimeout(timer);
      status('elsewhere', why);
    }
    /** The count beside the stored plan. A stored plan with no count beside it reads as 0. */
    const countNow = () => { const n = Number(root.localStorage.getItem(COUNT_KEY)); return Number.isInteger(n) && n > 0 ? n : 0; };

    /**
     * Ask for the plan, once. Without the lock this window is read-only. With it, the lock is kept until the page ends or
     * hands the plan over. A browser without locks has no gate: there the count alone guards the plan.
     */
    function gate() {
      const locks = root.navigator && root.navigator.locks;
      if (!locks || typeof locks.request !== 'function') return Promise.resolve();
      return new Promise(resolve => {
        const wait = setTimeout(resolve, 3000), go = () => { clearTimeout(wait); resolve(); };   // a browser that never answers does not stop the page from opening
        let asked;
        try {
          asked = locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, lock => {
            if (!lock) { stop('window'); go(); return undefined; }
            return new Promise(done => { letGo = done; go(); });
          });
        } catch (_) { go(); return; }
        Promise.resolve(asked).then(
          () => { if (readOnly === 'moved' && channel) channel.postMessage('given'); },   // let go on request: the lock is free now, and the asking window is told
          () => { if (letGo) { letGo = null; stop('moved'); } go(); });                    // taken from this window, or not allowed on this page (then there is no gate)
        listen();
      });
    }
    /** Windows of one browser talk here: 'take' asks the window that holds the plan to hand it over, 'given' says it has. */
    function listen() {
      if (channel || typeof root.BroadcastChannel !== 'function') return;
      try { channel = new root.BroadcastChannel(LOCK); } catch (_) { channel = null; return; }
      channel.onmessage = event => {
        if (event.data === 'take' && letGo) handOver();
        else if (event.data === 'given' && given) given();
      };
    }
    /** The window that holds the plan gives it up: what is waiting is written first (the write is synchronous), and nothing after. */
    function handOver() {
      clearTimeout(timer);
      if (dirty && !saving) flush();
      const done = letGo; letGo = null;
      stop('moved');
      done();
    }
    /**
     * Called in a window that only shows the plan: have the plan handed to this one. Resolves when the lock is free: given
     * up by its holder, or taken from it when it has not answered within 1.5 s (a page the browser has put to sleep). The
     * page then reloads, and takes the lock as it starts.
     */
    function takeOver() {
      const locks = root.navigator && root.navigator.locks;
      if (!locks || typeof locks.request !== 'function') return Promise.resolve(true);
      return new Promise(resolve => {
        const end = () => { if (!given) return; given = null; resolve(true); };
        given = end;
        listen();
        if (channel) channel.postMessage('take');
        setTimeout(() => {
          if (!given) return;
          try { Promise.resolve(locks.request(LOCK, { mode: 'exclusive', steal: true }, () => { end(); return new Promise(() => {}); })).catch(end); } catch (_) { end(); }
        }, 1500);
      });
    }

    async function connect() {
      try { db = root.claude && typeof root.claude.use === 'function' ? await timeout(root.claude.use('db'), LOAD_TIMEOUT_MS + 2000, 'Storage') : null; } catch (_) { db = null; }
      if (db) { backend = 'cloud'; return backend; }
      try { root.localStorage.setItem('lrf-next:probe', '1'); root.localStorage.removeItem('lrf-next:probe'); backend = 'device'; } catch (_) { backend = 'memory'; }
      if (backend === 'device') await gate();
      return backend;
    }

    /** @returns the saved plan, or null when nothing has been saved yet. */
    async function load() {
      if (backend === 'cloud') {
        const manifest = await timeout(db.doc('plan/manifest').get(), LOAD_TIMEOUT_MS, 'Loading the plan');
        if (!manifest.exists) return null;
        const info = manifest.data(), names = info.parts || [];
        const docs = await timeout(Promise.all(names.map(name => db.doc('plan/' + name).get())), LOAD_TIMEOUT_MS * 2, 'Loading the plan');
        const parts = {};
        docs.forEach((doc, i) => { if (!doc.exists) throw new Error(`The saved plan is incomplete (missing "${names[i]}").`); parts[names[i]] = doc.data().json; });
        rev = info.rev || 0; buckets = info.buckets || {}; saved = parts;
        return fromParts(parts, buckets);
      }
      if (backend === 'device') {
        count = countNow();   // read before the plan: a write that lands between the two is then seen at this window's next write
        const text = root.localStorage.getItem(DEVICE_KEY);
        return text ? JSON.parse(text) : null;
      }
      return null;
    }

    function watch(onRemoteChange) {
      if (backend !== 'cloud' || unsubscribe) return;
      try {
        unsubscribe = db.doc('plan/manifest').onSnapshot(snap => {
          if (!snap.exists || snap.metadata.hasPendingWrites) return;
          const info = snap.data();
          if (info.session !== SESSION && (info.rev || 0) > rev) onRemoteChange(info);
        }, () => { unsubscribe = null; });
      } catch (_) { unsubscribe = null; }
    }

    /** One write, retried once after a pause if the store says it is busy. */
    async function put(path, data) {
      try { await db.doc(path).set(data); }
      catch (error) {
        if (!error || !['resource_exhausted', 'unavailable'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1800 + Math.random() * 600));
        await db.doc(path).set(data);
      }
    }
    async function writeCloud(core) {
      const next = toParts(core, buckets), names = Object.keys(next.parts);
      for (const name of names) {
        if (saved[name] === next.parts[name]) continue;
        await put('plan/' + name, { json: next.parts[name] });
      }
      for (const name of Object.keys(saved)) if (!(name in next.parts)) await db.doc('plan/' + name).delete();
      rev += 1;
      await put('plan/manifest', { schema: 1, rev, savedAt: new Date().toISOString(), session: SESSION, parts: names, buckets: next.buckets });
      saved = next.parts; buckets = next.buckets;
    }

    /**
     * One write of the plan to this browser's storage. The count is read again first: if it is not the one this window last
     * read or wrote, another window has written since, and nothing is written. The count is written before the plan: a page
     * that ends between the two leaves a moved count over an old plan, which only makes other windows stop, where the other
     * order could let a window write over a newer plan unseen.
     */
    function writeDevice(core) {
      const text = JSON.stringify(core);
      if (countNow() !== count) { stop('changed'); return false; }
      root.localStorage.setItem(COUNT_KEY, String(count + 1)); count += 1;
      root.localStorage.setItem(DEVICE_KEY, text);
      return true;
    }
    async function flush() {
      if (held || readOnly || saving || !dirty) return;
      saving = true;
      while (dirty) {
        const core = dirty; dirty = null;
        status('saving');
        try {
          if (backend === 'cloud') await writeCloud(core);
          else if (backend === 'device' && !writeDevice(core)) { dirty = dirty || core; saving = false; return; }
          failed = false;
        } catch (error) {
          failed = true; dirty = dirty || core; saving = false;
          status('error', (error && (error.message || error.code)) || 'The plan could not be saved.');
          return;
        }
      }
      saving = false;
      status('saved');   // said once nothing is waiting or being written: whoever hears it can ask `pending` and be told no
    }
    /** Queue a save; bursts of edits collapse into one write. */
    function save(core) {
      dirty = core;
      if (readOnly) { status('elsewhere', readOnly); return; }
      if (held) { status('held'); return; }
      if (backend === 'memory') { status('unsaved'); return; }
      status('pending');
      clearTimeout(timer);
      timer = setTimeout(flush, 700);
    }
    const retry = () => { if (failed && dirty && !held) flush(); };
    // A stored plan that would not open is never written over by accident: while saving is held, nothing reaches the store.
    let held = false;
    const hold = () => { held = true; clearTimeout(timer); }, release = () => { held = false; };
    /** What is stored on this device, exactly as it is (for a plan that would not open). */
    const raw = () => { try { return backend === 'device' ? root.localStorage.getItem(DEVICE_KEY) : null; } catch (_) { return null; } };
    /** Save and wait for it. Throws if the plan could not be written. */
    async function saveNow(core) {
      clearTimeout(timer); dirty = core;
      if (held) { status('held'); throw new Error('The plan stored here could not be opened and is being kept as it is.'); }
      if (readOnly) { status('elsewhere', readOnly); throw new Error(ELSEWHERE[readOnly]); }
      if (backend === 'memory') { status('unsaved'); return; }
      await flush();
      if (readOnly) throw new Error(ELSEWHERE[readOnly]);
      if (failed) throw new Error('The plan could not be saved.');
    }
    if (root.addEventListener) {
      // A save that is waiting is written as the page is hidden or put away: on a phone its timer may never fire again.
      const hidden = () => { if (backend !== 'memory' && dirty && !saving) { clearTimeout(timer); flush(); } };
      root.addEventListener('pagehide', hidden);
      if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') hidden(); });
      // Another window has written the plan or its count: this one stops at once, before another change is made in it.
      root.addEventListener('storage', event => { if (backend === 'device' && (event.key === DEVICE_KEY || event.key === COUNT_KEY || event.key === null) && (!event.storageArea || event.storageArea === root.localStorage)) stop('changed'); });
    }

    /** Large read-only text (the attic) kept beside the plan, in the cloud only. */
    const idb = mode => new Promise((resolve, reject) => {
      const open = root.indexedDB.open('lrf-next', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('blobs');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const tx = open.result.transaction('blobs', mode); tx.onerror = () => reject(tx.error); resolve(tx.objectStore('blobs')); };
    });
    const idbDo = (mode, run) => idb(mode).then(storeIn => new Promise((resolve, reject) => { const q = run(storeIn); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); }));
    async function saveBlob(name, text, onProgress) {
      if (backend === 'device' && root.indexedDB) { await idbDo('readwrite', st => st.put(text, name)); if (onProgress) onProgress(1, 1); return true; }
      if (backend !== 'cloud') return false;
      // Pieces are sized by what they weigh once stored (quotes and backslashes are escaped), under the 256 KiB limit.
      const limit = 232000, encoder = new TextEncoder(), pieces = [];
      for (let at = 0; at < text.length;) {
        let size = Math.min(200000, text.length - at);
        while (size > 1000 && encoder.encode(JSON.stringify(text.slice(at, at + size))).length > limit) size = Math.floor(size * 0.85);
        pieces.push(text.slice(at, at + size)); at += size;
      }
      for (let i = 0; i < pieces.length; i++) {
        await put(`blob-${name}/part-${String(i).padStart(3, '0')}`, { i, text: pieces[i] });
        if (onProgress) onProgress(i + 1, pieces.length);
      }
      await put(`blob-${name}/manifest`, { n: pieces.length, length: text.length, savedAt: new Date().toISOString() });
      return true;
    }
    async function loadBlob(name) {
      if (backend === 'device' && root.indexedDB) { const text = await idbDo('readonly', st => st.get(name)); return typeof text === 'string' ? text : null; }
      if (backend !== 'cloud') return null;
      const manifest = await db.doc(`blob-${name}/manifest`).get();
      if (!manifest.exists) return null;
      const { n } = manifest.data(), parts = [];
      for (let i = 0; i < n; i++) {
        const doc = await db.doc(`blob-${name}/part-${String(i).padStart(3, '0')}`).get();
        if (!doc.exists) throw new Error('The stored backup data is incomplete.');
        parts.push(doc.data().text);
      }
      return parts.join('');
    }
    async function clearBlob(name) {
      if (backend === 'device' && root.indexedDB) { await idbDo('readwrite', st => st.delete(name)); return; }
      if (backend !== 'cloud') return;
      const manifest = await db.doc(`blob-${name}/manifest`).get();
      if (manifest.exists) await db.doc(`blob-${name}/manifest`).delete();
    }

    return { connect, load, save, saveNow, retry, hold, release, raw, get held() { return held; }, takeOver, get readOnly() { return readOnly; }, get count() { return count; }, watch, saveBlob, loadBlob, clearBlob, get backend() { return backend; }, get pending() { return !!dirty || saving; } };
  }

  root.LRFStore = { create, toParts, fromParts };
  if (typeof module === 'object' && module.exports) module.exports = root.LRFStore;
})(typeof self !== 'undefined' ? self : globalThis);
