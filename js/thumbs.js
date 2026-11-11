/* Little River Farm Planner — variety photos, small, wherever a crop or variety is named.
 *
 * One store of thumbnails keyed by variety (data: addresses, about 240 px on the long side), and
 * one element builder. A crop is pictured by its most-planted variety that has a photo. Where
 * there is no photo the tile shows the first letter on the crop's colour, so rows still line up.
 *
 * A variety whose thumbnail is not kept here yet, but whose record says where its picture came
 * from, is shown straight from that address while the computer is online (`remote`). The app
 * replaces it with a kept thumbnail as soon as it can fetch one.
 */
(function (root) {
  'use strict';
  const h = root.LRFUI.h;
  let map = {}, best = {}, remote = {};
  const listeners = [];
  const tell = () => { for (const fn of listeners) fn(); };

  /** Replace every thumbnail. */
  function set(next) { map = next && typeof next === 'object' ? next : {}; tell(); }
  function put(id, uri) { if (uri) map = { ...map, [id]: uri }; else { const { [id]: gone, ...rest } = map; map = rest; } tell(); }
  const get = id => (id && map[id]) || '';
  const count = () => Object.keys(map).length;
  /** Where to show a picture from while no thumbnail is kept: { varietyId: https address }. */
  function setRemote(next) { const was = JSON.stringify(remote); remote = next && typeof next === 'object' ? next : {}; if (JSON.stringify(remote) !== was) tell(); }
  const remoteOf = id => (id && !map[id] && remote[id]) || '';
  const has = id => !!(id && (map[id] || remote[id]));
  /** Choose the variety that pictures each crop: the one planted most, then the first by name. */
  function index(plan) {
    const used = new Map(), next = {};
    for (const p of (plan && plan.plantings) || []) if (p.varietyId) used.set(p.varietyId, (used.get(p.varietyId) || 0) + 1);
    const live = ((plan && plan.varieties) || []).filter(v => v && v.active !== false && !v.deleted && has(v.id));
    // a picture kept here comes before one that has to be fetched each time
    live.sort((a, b) => (map[a.id] ? 0 : 1) - (map[b.id] ? 0 : 1) || (used.get(b.id) || 0) - (used.get(a.id) || 0) || String(a.name).localeCompare(String(b.name)));
    for (const v of live) if (!next[v.cropId]) next[v.cropId] = v.id;
    best = next;
  }
  const forCrop = cropId => get(best[cropId]);
  /** Is there a picture for this crop, kept here or to be shown from where it came? */
  const cropHas = cropId => has(best[cropId]);
  const letter = (node, label) => { node.classList.add('none'); node.replaceChildren(h('span', String(label || '').trim().charAt(0).toUpperCase())); };

  /**
   * A thumbnail element. { varietyId?, cropId?, color?, label?, size?, cls? }
   * A planting with a variety shows that variety's photo or none; one without shows its crop's.
   */
  function el(o) {
    const id = o.varietyId || (o.cropId ? best[o.cropId] : ''), uri = get(id), far = uri ? '' : remoteOf(id);
    const node = h('span.thumb' + (o.cls ? '.' + o.cls.split(' ').join('.') : ''), { style: { '--thumb': (o.size || 32) + 'px', '--thumb-c': o.color || 'var(--line)' } });
    if (uri) node.append(h('img', { src: uri, alt: '', decoding: 'async', draggable: false }));
    // from the supplier's own site: no referrer is sent, it loads when it scrolls into view, and offline the letter stands in
    else if (far) node.append(h('img', { src: far, alt: '', decoding: 'async', loading: 'lazy', referrerPolicy: 'no-referrer', draggable: false, onerror: () => letter(node, o.label) }));
    else letter(node, o.label);
    // A picture is never something to drag by itself: left to the browser, pressing on one starts dragging the image
    // and the planner's own drag (a crop onto a bed, a bar along the timeline) is cancelled.
    for (const img of node.querySelectorAll('img')) img.setAttribute('draggable', 'false');
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
  /** Several thumbnails at once, with one notice to the views. */
  function putAll(more) { map = { ...map, ...more }; tell(); }
  root.LRFThumbs = { set, put, putAll, get, has, cropHas, count, index, forCrop, el, make, setRemote, remoteOf, on: fn => listeners.push(fn), all: () => map };
})(window);
