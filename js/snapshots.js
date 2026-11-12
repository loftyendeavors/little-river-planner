/* Little River Farm Planner — snapshots: the whole plan as it stood at a moment, kept in this browser so it can be returned to.
 *
 * A snapshot is the plan file itself (what Backup downloads), with a name and a time. Two kinds:
 *   named      taken on purpose ("before releasing pins"). Kept until deleted.
 *   automatic  taken by the planner before anything that replaces the whole plan (restoring a snapshot, opening the
 *              cloud's plan, loading a backup file), and at the start of each day the plan is worked on. The newest 20 are kept.
 *
 * They live in the browser's database, not in the plan and not in the browser's text storage: a snapshot is about a megabyte.
 * No page of the app is touched here; the app hands over the text and asks for it back.
 */
(function (root) {
  'use strict';
  const DB = 'lrf-next-snaps', KEEP_AUTO = 20;
  let opened = null;
  function open() {
    if (opened) return opened;
    opened = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('This browser keeps no database for the page.')); return; }
      const req = root.indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('meta', { keyPath: 'id' }); req.result.createObjectStore('text'); };
      req.onerror = () => reject(req.error || new Error('The snapshot store could not be opened.'));
      req.onblocked = () => reject(new Error('The snapshot store is in use by another tab.'));
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opened = null; }; resolve(req.result); };
    });
    opened.catch(() => { opened = null; });
    return opened;
  }
  /** One transaction over both stores; resolves with what `work` returned once everything is written. */
  async function tx(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(['meta', 'text'], mode);
      let out;
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = t.onabort = () => reject(t.error || new Error('The snapshot could not be written.'));
      try { out = work(t.objectStore('meta'), t.objectStore('text')); } catch (error) { try { t.abort(); } catch (_) { /* already over */ } reject(error); }
    });
  }
  const available = () => open().then(() => true, () => false);
  const newId = () => 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  /** Newest first. Each: { id, name, at, auto, why, plantings, waiting, year, bytes, key, device, cloud }. */
  async function list() {
    const all = await tx('readonly', meta => meta.getAll());
    return (all || []).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  /** Keep a snapshot. @param info { name, auto?, why?, plantings, waiting, year, key?, device?, at?, id?, cloud? } */
  async function add(info, text) {
    if (typeof text !== 'string' || !text.length) throw new Error('There is no plan to keep.');
    const record = { id: info.id || newId(), name: String(info.name || '').trim().slice(0, 80) || 'Snapshot', at: info.at || new Date().toISOString(), auto: !!info.auto, why: info.why || '',
      plantings: +info.plantings || 0, waiting: +info.waiting || 0, year: info.year || null, bytes: text.length, key: info.key || '', device: info.device || '', cloud: !!info.cloud };
    await tx('readwrite', (meta, body) => { meta.put(record); body.put(text, record.id); });
    if (record.auto) await prune();
    return record;
  }
  const text = id => tx('readonly', (meta, body) => body.get(id)).then(t => (typeof t === 'string' ? t : null));
  const remove = id => tx('readwrite', (meta, body) => { meta.delete(id); body.delete(id); });
  /** Change what is noted about a snapshot (its name, whether the cloud has it). The plan inside is never changed. */
  async function note(id, change) {
    const all = await list(), was = all.find(s => s.id === id);
    if (!was) return null;
    const next = { ...was, ...change, id: was.id, at: was.at, bytes: was.bytes };
    await tx('readwrite', meta => { meta.put(next); });
    return next;
  }
  /** The automatic ones beyond the newest 20 go. Named ones are never removed here. */
  async function prune() {
    const old = (await list()).filter(s => s.auto).slice(KEEP_AUTO);
    if (old.length) await tx('readwrite', (meta, body) => { for (const s of old) { meta.delete(s.id); body.delete(s.id); } });
    return old.length;
  }
  root.LRFSnaps = { available, list, add, text, remove, note, prune, newId, KEEP_AUTO };
})(typeof self !== 'undefined' ? self : globalThis);
