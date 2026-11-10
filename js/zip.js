/* Little River Farm Planner — reading a backup .zip.
 *
 * A planner backup is an ordinary zip: plan.json, manifest.json and the
 * original uploads under files/<sha256>. This reads the zip's directory and
 * inflates only the entries asked for, using the browser's own decompressor.
 */
(function (root) {
  'use strict';
  const SIG_END = 0x06054b50, SIG_CENTRAL = 0x02014b50, SIG_LOCAL = 0x04034b50;

  /** @returns Map of entry name -> { method, compressedSize, size, offset } */
  function directory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === SIG_END) { end = i; break; }
    if (end < 0) throw new Error('This is not a zip file.');
    const count = view.getUint16(end + 10, true), entries = new Map(), decoder = new TextDecoder();
    let at = view.getUint32(end + 16, true);
    if (count === 0xffff || at === 0xffffffff) throw new Error('This zip is too large for the planner to read.');
    for (let n = 0; n < count; n++) {
      if (view.getUint32(at, true) !== SIG_CENTRAL) throw new Error('The zip directory is damaged.');
      const method = view.getUint16(at + 10, true), compressedSize = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true), offset = view.getUint32(at + 42, true);
      entries.set(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), { method, compressedSize, size, offset });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function read(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(entry.offset, true) !== SIG_LOCAL) throw new Error('A zip entry is damaged.');
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    const data = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new Error('This zip uses a compression the planner cannot read.');
    if (typeof root.DecompressionStream !== 'function') throw new Error('This browser cannot open zip backups. Use the plan-only .json backup instead.');
    const stream = new Blob([data]).stream().pipeThrough(new root.DecompressionStream('deflate-raw'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (out.length !== entry.size) throw new Error('A zip entry did not unpack to its recorded size.');
    return out;
  }

  const isZip = bytes => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  root.LRFZip = { directory, read, isZip };
})(typeof self !== 'undefined' ? self : globalThis);
