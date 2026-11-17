/* Little River Farm Planner — snapshots: the whole plan as it stood at a moment, kept in this browser so it can be returned to.
 *
 * A snapshot is the plan file itself (what Backup downloads), with a name and a time. Two kinds:
 *   named      taken on purpose ("before releasing pins"). Kept until deleted.
 *   automatic  taken by the planner before anything that replaces the whole plan (restoring a snapshot, opening the
 *              cloud's plan, loading a backup file), and at the start of each day the plan is worked on. The newest 20 are kept.
 *   before changes from another device were taken in (`join`): the plan as it stood here just before. These are kept apart from
 *              the 20, so that a day of two devices does not push the start-of-day snapshots out: the newest 5, and the first
 *              of each hour of the last day.
 *
 * They live in the browser's database, not in the plan and not in the browser's text storage: a snapshot is about a megabyte.
 * No page of the app is touched here; the app hands over the text and asks for it back.
 */
(function (root) {
  'use strict';
  const DB = 'lrf-next-snaps', KEEP_AUTO = 20, KEEP_JOIN = 5, JOIN_HOURS = 24;
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
  // A plan kept before a taking-in is kept packed, where the browser can pack: there may be a few dozen of them in a day, each
  // the size of the plan. Every other snapshot is kept as text, as it always was.
  const viaStream = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  async function packed(text) {
    if (typeof CompressionStream !== 'function') return text;
    try { return { gz: await viaStream(new TextEncoder().encode(text), new CompressionStream('gzip')) }; } catch (_) { return text; }
  }
  async function unpacked(body) {
    if (typeof body === 'string') return body;
    if (!body || !body.gz || typeof DecompressionStream !== 'function') return null;
    try { return new TextDecoder().decode(await viaStream(body.gz, new DecompressionStream('gzip'))); } catch (_) { return null; }
  }
  const newId = () => 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  /** Newest first. Each: { id, name, at, auto, why, plantings, waiting, year, bytes, key, device, cloud }. */
  async function list() {
    const all = await tx('readonly', meta => meta.getAll());
    return (all || []).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  /** Keep a snapshot. @param info { name, auto?, why?, plantings, waiting, year, key?, device?, at?, id?, cloud? } */
  async function add(info, text) {
    if (typeof text !== 'string' || !text.length) throw new Error('There is no plan to keep.');
    const record = { id: info.id || newId(), name: String(info.name || '').trim().slice(0, 80) || 'Snapshot', at: info.at || new Date().toISOString(), auto: !!info.auto, why: info.why || '', ...(info.join ? { join: true } : {}),
      plantings: +info.plantings || 0, waiting: +info.waiting || 0, year: info.year || null, bytes: text.length, key: info.key || '', device: info.device || '', cloud: !!info.cloud };
    const kept = record.join ? await packed(text) : text;
    await tx('readwrite', (meta, body) => { meta.put(record); body.put(kept, record.id); });
    if (record.auto) await prune();
    return record;
  }
  const text = id => tx('readonly', (meta, body) => body.get(id)).then(unpacked);
  const remove = id => tx('readwrite', (meta, body) => { meta.delete(id); body.delete(id); });
  /** Change what is noted about a snapshot (its name, whether the cloud has it). The plan inside is never changed. */
  async function note(id, change) {
    const all = await list(), was = all.find(s => s.id === id);
    if (!was) return null;
    const next = { ...was, ...change, id: was.id, at: was.at, bytes: was.bytes };
    await tx('readwrite', meta => { meta.put(next); });
    return next;
  }
  /** Of the plans kept before changes were taken in (newest first), the ones to keep: the newest 5, and the first of each hour of the last day. */
  function joinsKept(joins, now = Date.now()) {
    const keep = new Set(joins.slice(0, KEEP_JOIN).map(s => s.id)), since = new Date(now - JOIN_HOURS * 3600000).toISOString(), hours = new Set();
    for (const s of joins.slice().reverse()) { const hour = String(s.at).slice(0, 13); if (s.at >= since && !hours.has(hour)) { hours.add(hour); keep.add(s.id); } }   // oldest first: the first of each hour
    return keep;
  }
  /** The automatic ones beyond the newest 20 go, and the plans kept before a taking-in beyond their own few. Named ones are never removed here. */
  /** Of every snapshot (newest first), the ones that go. */
  function outgrown(all, now) {
    const joins = all.filter(s => s.auto && s.join), keep = joinsKept(joins, now);
    return [...all.filter(s => s.auto && !s.join).slice(KEEP_AUTO), ...joins.filter(s => !keep.has(s.id))];
  }
  async function prune() {
    const old = outgrown(await list());
    if (old.length) await tx('readwrite', (meta, body) => { for (const s of old) { meta.delete(s.id); body.delete(s.id); } });
    return old.length;
  }
  root.LRFSnaps = { available, list, add, text, remove, note, prune, newId, joinsKept, outgrown, KEEP_AUTO, KEEP_JOIN };
  if (typeof module === 'object' && module.exports) module.exports = root.LRFSnaps;
})(typeof self !== 'undefined' ? self : globalThis);
