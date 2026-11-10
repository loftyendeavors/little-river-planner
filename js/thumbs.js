/* Little River Farm Planner — variety photos, small, wherever a crop or variety is named.
 *
 * One store of thumbnails keyed by variety (data: addresses, about 240 px on the long side), and
 * one element builder. A crop is pictured by its most-planted variety that has a photo. Where
 * there is no photo the tile shows the first letter on the crop's colour, so rows still line up.
 */
(function (root) {
  'use strict';
  const h = root.LRFUI.h;
  let map = {}, best = {};
  const listeners = [];
  const tell = () => { for (const fn of listeners) fn(); };

  /** Replace every thumbnail. */
  function set(next) { map = next && typeof next === 'object' ? next : {}; tell(); }
  function put(id, uri) { if (uri) map = { ...map, [id]: uri }; else { const { [id]: gone, ...rest } = map; map = rest; } tell(); }
  const get = id => (id && map[id]) || '';
  const count = () => Object.keys(map).length;
  /** Choose the variety that pictures each crop: the one planted most, then the first by name. */
  function index(plan) {
    const used = new Map(), next = {};
    for (const p of (plan && plan.plantings) || []) if (p.varietyId) used.set(p.varietyId, (used.get(p.varietyId) || 0) + 1);
    const live = ((plan && plan.varieties) || []).filter(v => v && v.active !== false && !v.deleted && map[v.id]);
    live.sort((a, b) => (used.get(b.id) || 0) - (used.get(a.id) || 0) || String(a.name).localeCompare(String(b.name)));
    for (const v of live) if (!next[v.cropId]) next[v.cropId] = v.id;
    best = next;
  }
  const forCrop = cropId => get(best[cropId]);

  /**
   * A thumbnail element. { varietyId?, cropId?, color?, label?, size?, cls? }
   * A planting with a variety shows that variety's photo or none; one without shows its crop's.
   */
  function el(o) {
    const uri = o.varietyId ? get(o.varietyId) : o.cropId ? forCrop(o.cropId) : '';
    const node = h('span.thumb' + (o.cls ? '.' + o.cls.split(' ').join('.') : ''), { style: { '--thumb': (o.size || 32) + 'px', '--thumb-c': o.color || 'var(--line)' } });
    if (uri) node.append(h('img', { src: uri, alt: '', decoding: 'async', draggable: false }));
    else { node.classList.add('none'); node.append(h('span', String(o.label || '').trim().charAt(0).toUpperCase())); }
    return node;
  }
  /** A picture file or blob -> a small JPEG data: address. */
  async function make(blob, max = 240) {
    const bitmap = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height)), w = Math.max(1, Math.round(bitmap.width * k)), ht = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = ht;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, ht); ctx.drawImage(bitmap, 0, 0, w, ht);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.74);
  }
  root.LRFThumbs = { set, put, get, count, index, forCrop, el, make, on: fn => listeners.push(fn), all: () => map };
})(window);
