// A stand-in for an R2 bucket, for running the sync Worker in Node: the parts of the binding the Worker uses, with the
// behaviour Cloudflare documents (strongly consistent; put() with a failed onlyIf stores nothing and returns null;
// an object's etag is the MD5 of its bytes; list() is in key order, 1000 at a time, metadata only when asked for).
import { createHash } from 'node:crypto';

const bytesOf = async value => {
  if (value == null) return new Uint8Array(0);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (typeof value.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
};

/**
 * @param options.wildcard  false makes `If-None-Match: *` pass even when the object exists, and 'throws' makes a put that
 *                          asks for it fail outright, in case a real bucket does not honour the wildcard: the Worker
 *                          must stay safe, and must keep working, either way.
 * @param options.pageSize  how many objects list() returns at a time (1000 on a real bucket)
 */
export function fakeBucket(options = {}) {
  const store = new Map(), log = [];
  const wildcard = options.wildcard !== false, pageSize = options.pageSize || 1000;
  const view = (key, rec, withBody) => {
    const obj = { key, version: rec.version, size: rec.bytes.length, etag: rec.etag, httpEtag: `"${rec.etag}"`, uploaded: rec.uploaded, httpMetadata: { ...rec.httpMetadata }, customMetadata: { ...rec.customMetadata } };
    if (withBody) {
      const copy = () => rec.bytes.slice();
      Object.defineProperty(obj, 'body', { get: () => new Response(copy()).body });
      obj.arrayBuffer = async () => copy().buffer;
      obj.text = async () => new TextDecoder().decode(copy());
      obj.json = async () => JSON.parse(new TextDecoder().decode(copy()));
    }
    return obj;
  };
  const passes = (only, rec) => {
    if (!only) return true;
    if (typeof Headers !== 'undefined' && only instanceof Headers) {
      const strip = v => String(v).trim().replace(/^W\//, '').replace(/^"|"$/g, '');
      const ifMatch = only.get('if-match'), ifNone = only.get('if-none-match');
      if (ifMatch != null) { if (!rec) return false; if (ifMatch.trim() !== '*' && !ifMatch.split(',').map(strip).includes(rec.etag)) return false; }
      if (ifNone != null) { if (ifNone.trim() === '*') { if (wildcard && rec) return false; } else if (rec && ifNone.split(',').map(strip).includes(rec.etag)) return false; }
      return true;
    }
    if (only.etagMatches !== undefined && !(rec && rec.etag === only.etagMatches)) return false;
    if (only.etagDoesNotMatch !== undefined && rec && rec.etag === only.etagDoesNotMatch) return false;
    return true;
  };
  let n = 0;
  const bucket = {
    async head(key) { log.push(['head', key]); const rec = store.get(key); return rec ? view(key, rec, false) : null; },
    async get(key) { log.push(['get', key]); const rec = store.get(key); return rec ? view(key, rec, true) : null; },
    async put(key, value, opts = {}) {
      const bytes = await bytesOf(value);   // read first, as a real upload would be, so two writers can cross
      log.push(['put', key]);
      if (options.wildcard === 'throws' && typeof Headers !== 'undefined' && opts.onlyIf instanceof Headers) throw new TypeError('conditional headers are not supported');
      if (!passes(opts.onlyIf, store.get(key))) return null;
      const rec = { bytes, etag: createHash('md5').update(bytes).digest('hex'), version: 'v' + (++n), uploaded: new Date(), httpMetadata: { ...(opts.httpMetadata || {}) }, customMetadata: { ...(opts.customMetadata || {}) } };
      store.set(key, rec);
      return view(key, rec, false);
    },
    async delete(keys) { for (const key of [].concat(keys)) { log.push(['delete', key]); store.delete(key); } },
    async list(opts = {}) {
      log.push(['list', opts.prefix || '']);
      const keys = [...store.keys()].filter(k => !opts.prefix || k.startsWith(opts.prefix)).sort(), from = opts.cursor ? keys.indexOf(opts.cursor) + 1 : 0, limit = Math.min(opts.limit || pageSize, pageSize);
      const page = keys.slice(from, from + limit), truncated = from + limit < keys.length;
      const include = opts.include || [];
      return { objects: page.map(k => { const o = view(k, store.get(k), false); if (!include.includes('customMetadata')) delete o.customMetadata; if (!include.includes('httpMetadata')) delete o.httpMetadata; return o; }), truncated, cursor: truncated ? page[page.length - 1] : undefined, delimitedPrefixes: [] };
    }
  };
  return { bucket, store, log };
}
