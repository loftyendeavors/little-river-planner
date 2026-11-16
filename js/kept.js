/* Little River Farm Planner — the plan as the cloud held it when this browser was last in step with it.
 *
 * Cloud sync remembers a stamp and a fingerprint of that plan, which can say that the plan here has changed since and cannot
 * say what changed. To join the plan here with a plan another device has sent (js/merge.js), the plan the two started from
 * has to be at hand. This keeps it: the text of the plan, and beside it the cloud's stamp for that text.
 *
 * The two are written in one transaction of the browser's database, so the stamp is never the stamp of another text. It is
 * the plan to compare with only while its stamp is the one cloud sync says it is in step with: whoever reads it checks that,
 * and a plan kept under any other stamp is no use and does no harm.
 *
 * It lives in a database of its own, not in the plan and not in the browser's text storage: the text is as large as the plan.
 * No page of the app is touched here. `space` names a farm's own place in this browser's storage; '' is the one farm there is.
 */
(function (root) {
  'use strict';
  const NAME = 'lrf-next-kept';
  function create(space) {
    const DB = space ? `${NAME}:${space}` : NAME;
    let opened = null;
    function open() {
      if (opened) return opened;
      opened = new Promise((resolve, reject) => {
        if (!root.indexedDB) { reject(new Error('This browser keeps no database for the page.')); return; }
        const req = root.indexedDB.open(DB, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('plan'); };
        req.onerror = () => reject(req.error || new Error('The plan kept to compare with could not be opened.'));
        req.onblocked = () => reject(new Error('The plan kept to compare with is in use by another tab.'));
        req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opened = null; }; resolve(req.result); };
      });
      opened.catch(() => { opened = null; });
      return opened;
    }
    /** One transaction; resolves with what `work` asked for once everything is written. */
    async function tx(mode, work) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('plan', mode);
        let asked;
        t.oncomplete = () => resolve(asked ? asked.result : undefined);
        t.onerror = t.onabort = () => reject(t.error || new Error('The plan kept to compare with could not be written.'));
        try { asked = work(t.objectStore('plan')); } catch (error) { try { t.abort(); } catch (_) { /* already over */ } reject(error); }
      });
    }
    /** Keep a plan: { etag: the cloud's stamp for it, text, key: its fingerprint, at }. The one kept before is replaced. */
    async function put(record) {
      if (!record || typeof record.etag !== 'string' || !record.etag || typeof record.text !== 'string' || !record.text.length) throw new Error('There is no plan to keep.');
      const note = { etag: record.etag, key: record.key || '', at: record.at || new Date().toISOString(), bytes: record.text.length };
      await tx('readwrite', store => { store.put(record.text, 'text'); return store.put(note, 'note'); });
      return note;
    }
    /** What is kept, without its text: { etag, key, at, bytes }, or null. */
    const note = () => tx('readonly', store => store.get('note')).then(n => (n && typeof n.etag === 'string' ? n : null));
    /** The kept plan whole: { etag, key, at, bytes, text }, or null. The note and the text are read in one transaction. */
    async function get() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('plan', 'readonly'), store = t.objectStore('plan'), a = store.get('note'), b = store.get('text');
        t.oncomplete = () => resolve(a.result && typeof a.result.etag === 'string' && typeof b.result === 'string' && b.result.length === a.result.bytes ? { ...a.result, text: b.result } : null);
        t.onerror = t.onabort = () => reject(t.error || new Error('The plan kept to compare with could not be read.'));
      });
    }
    const clear = () => tx('readwrite', store => { store.delete('text'); return store.delete('note'); }).then(() => true);
    return { put, note, get, clear };
  }
  const api = { create, NAME };
  root.LRFKept = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
