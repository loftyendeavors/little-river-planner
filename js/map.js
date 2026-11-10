/* Little River Farm Planner — the farm map.
 *
 * Every growing space is drawn from its saved position, rotation and real
 * dimensions over the farm photo. Inside a bed each planting is drawn where it
 * actually sits: its feet along the bed and its rows across it. Colour is the
 * crop; the pale tint is a crop still growing, the full colour one being picked.
 *
 * On the map you can
 *   drop a crop from the library on a bed (it goes in on the planning date),
 *   pick a planting up and move it to other ground (Alt leaves a copy),
 *   drag the ends of the selected planting to lengthen or shorten it.
 * A drag on open ground pans; the wheel zooms; hold Space to pan from anywhere.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, Rails = root.LRFRails;
  const { s, h, clear, day, span, num } = UI;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const view = { x: 0, y: 0, z: 1, home: 1, fitted: false };
  const beds = new Map();       // bedId -> { bed, geo, g, base, fills, tag, parts, status, drop }
  const gardenSize = new Map(); // gardenId -> number of spaces drawn
  let layers = { photo: true, labels: true }, highlightCrop = null, feetPerPx = 0.1, raf = 0, spaceDown = false;

  // ── geometry: saved map pixels, real feet ──
  function geometry(bed, slot) {
    const eng = App.state.engine, g = eng.gardenOf(bed) || {}, map = App.state.plan.map || {};
    const scale = typeof g.mapScale === 'number' && Number.isFinite(g.mapScale) && g.mapScale >= 0.05 && g.mapScale <= 20 ? g.mapScale : 1;
    const pxPerFt = scale / feetPerPx;
    let w, l, shape = 'rect', ft = 0, cells = null;
    if (eng.isCt(bed)) {
      const type = eng.ctOf(bed), [cw, cl] = eng.ctDims(type), count = Math.max(1, Math.floor(+bed.count || 1)), cfg = bed.potLayout || {};
      const columns = Number.isInteger(cfg.columns) && cfg.columns > 0 ? Math.min(count, cfg.columns) : Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
      const gap = typeof cfg.gapFt === 'number' && cfg.gapFt >= 0 && cfg.gapFt <= 100 ? cfg.gapFt : 0;
      w = columns * cw + (columns - 1) * gap; l = rows * cl + (rows - 1) * gap; shape = 'cells';
      cells = { count, columns, w: cw * pxPerFt, l: cl * pxPerFt, gap: gap * pxPerFt, round: type.shape === 'round' };
    } else if (eng.isTower(bed)) { w = l = 3; shape = map.towerShape === 'square' ? 'rect' : 'circle'; }
    else { w = +bed.w || 1; l = +bed.l || 1; ft = eng.isSoilBed(bed) ? eng.capOf(bed) : 0; }
    const px = bed.px && Number.isFinite(+bed.px.x) && Number.isFinite(+bed.px.y) ? bed.px : slot;
    return { x: +px.x, y: +px.y, rot: +px.rot || 0, W: Math.max(1, w * pxPerFt), L: Math.max(1, l * pxPerFt), shape, ft, cells, placed: px === bed.px };
  }
  /** Rotation that keeps text readable: `base` is the text direction inside the bed (0 across, -90 along). */
  function upright(rot, base) {
    let a = ((rot + base) % 360 + 540) % 360 - 180;
    return a > 90 || a < -90 ? base + 180 : base;
  }
  const bedTransform = geo => `translate(${geo.x} ${geo.y}) rotate(${geo.rot})`;

  function build() {
    const plan = App.state.plan, eng = App.state.engine, map = plan.map || {}, world = $('mapBeds'), labels = $('mapGardens'), plates = $('mapPlates');
    const hasPhoto = !!App.state.mapImageUrl;
    feetPerPx = +map.ftPerPx > 0 ? +map.ftPerPx : eng.lib.blankFeetPerPx;
    clear(world); clear(labels); clear(plates); clear($('mapOver')); beds.clear(); gardenSize.clear();
    const photo = $('mapPhoto');
    if (hasPhoto) { photo.setAttribute('href', App.state.mapImageUrl); photo.setAttribute('width', map.imgW || 2000); photo.setAttribute('height', map.imgH || 1200); }
    photo.style.display = hasPhoto && layers.photo ? '' : 'none';
    $('map').classList.toggle('on-photo', hasPhoto && layers.photo);
    $('mapPhotoToggle').hidden = !hasPhoto;

    const slots = unplacedSlots(plan, eng);
    for (const bed of plan.beds) {
      if (bed.active === false || (eng.gardenOf(bed) || {}).active === false) continue;
      const geo = geometry(bed, slots.get(bed.id) || { x: 0, y: 0, rot: 0 });
      const g = s('g.bed', { transform: bedTransform(geo), 'data-bed': bed.id });
      const shape = cls => geo.shape === 'circle' ? s('circle.' + cls, { r: geo.W / 2 }) : s('rect.' + cls, { x: -geo.W / 2, y: -geo.L / 2, width: geo.W, height: geo.L, rx: Math.min(geo.W, geo.L) * (geo.shape === 'cells' ? 0.04 : 0.1) });
      const base = shape('bed-base'), fills = s('g.bed-fills'), edge = shape('bed-edge');
      const tag = s('text.bed-tag', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String(bed.bed));
      g.append(base, fills, edge, tag);
      world.append(g);
      beds.set(bed.id, { bed, geo, g, base, fills, tag, parts: [] });
    }
    // A plate under each garden lifts its beds off the photo; the name sits above it.
    for (const garden of plan.gardens) {
      const own = [...beds.values()].filter(x => x.bed.gardenId === garden.id);
      if (!own.length) continue;
      gardenSize.set(garden.id, own.length);
      const rots = own.map(x => ((x.geo.rot % 180) + 180) % 180).sort((a, b) => a - b), theta = rots[Math.floor(rots.length / 2)], t = -theta * Math.PI / 180;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const { geo } of own) for (const [cx, cy] of corners(geo)) {
        const px = cx * Math.cos(t) - cy * Math.sin(t), py = cx * Math.sin(t) + cy * Math.cos(t);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const pad = 1.6 / feetPerPx;
      plates.append(s('rect.plate', { transform: `rotate(${theta})`, x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad, rx: pad * 0.9, 'data-garden': garden.id }));
      const box = bounds(own);
      labels.append(s('text.garden-label', { x: (box.x0 + box.x1) / 2, y: box.y0, 'text-anchor': 'middle', 'data-garden': garden.id }, s('title', `Zoom to ${garden.name}`), garden.name));
    }
    if (!view.fitted) fit();
    paint(); applyView();
  }
  function corners(geo) {
    const r = geo.rot * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), out = [];
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const bx = dx * geo.W / 2, by = dy * geo.L / 2; out.push([geo.x + bx * c - by * sn, geo.y + bx * sn + by * c]); }
    return out;
  }

  /**
   * Positions for spaces the farm has not placed on a map yet: each garden as a
   * tidy block, gardens flowing left to right. Display only; nothing is saved.
   */
  function unplacedSlots(plan, eng) {
    const slots = new Map(), ft = 1 / feetPerPx, placed = plan.beds.filter(b => b.px && Number.isFinite(+b.px.x) && Number.isFinite(+b.px.y));
    const top = placed.length ? Math.max(...placed.map(b => +b.px.y)) + 60 * ft : 0, wrapAt = 420 * ft, gap = 26 * ft, path = 2 * ft;
    let x = 0, y = top, rowHeight = 0;
    const gardens = [...plan.gardens].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const garden of gardens) {
      const todo = plan.beds.filter(b => b.gardenId === garden.id && b.active !== false && !placed.includes(b));
      if (!todo.length) continue;
      const sized = todo.map(b => eng.isTower(b) ? { b, w: 3, l: 3 } : eng.isSoilBed(b) ? { b, w: +b.w || 3, l: +b.l || 20 } : { b, w: 4, l: 8 });
      const across = sized.every(z => z.b.orient === 'EW'), towers = sized.every(z => eng.isTower(z.b)), perRow = towers ? 11 : sized.length;
      const cells = sized.map((z, i) => {
        const col = i % perRow, row = Math.floor(i / perRow), pitch = (z.w * ft) + (towers ? ft : path);
        return across ? { z, cx: (z.l * ft) / 2, cy: i * pitch + (z.w * ft) / 2, rot: 90 } : { z, cx: col * pitch + (z.w * ft) / 2, cy: row * (z.l * ft + path) + (z.l * ft) / 2, rot: 0 };
      });
      const width = Math.max(...cells.map(c => c.cx + (c.rot ? c.z.l : c.z.w) * ft / 2)), height = Math.max(...cells.map(c => c.cy + (c.rot ? c.z.w : c.z.l) * ft / 2));
      if (x > 0 && x + width > wrapAt) { x = 0; y += rowHeight + gap * 1.6; rowHeight = 0; }
      for (const c of cells) slots.set(c.z.b.id, { x: x + c.cx, y: y + c.cy, rot: c.rot });
      x += width + gap; rowHeight = Math.max(rowHeight, height);
    }
    return slots;
  }
  function bounds(items) {
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const { geo } of items) for (const [x, y] of corners(geo)) { box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y); }
    return box;
  }

  // ── what stands where on the planning date ──
  /** A planting's rectangle in the bed's own drawing space. */
  const boxOf = (geo, f) => { const k = geo.L / geo.ft, a1 = Math.min(f.a1, geo.ft); return { x: geo.W * (f.x0 - 0.5), y: geo.L / 2 - a1 * k, w: geo.W * (f.x1 - f.x0), h: Math.max(0, a1 - f.a0) * k }; };
  const tint = hex => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return hex; const to = [244, 241, 230]; return '#' + [1, 2, 3].map((i, n) => Math.round(parseInt(m[i], 16) * 0.58 + to[n] * 0.42).toString(16).padStart(2, '0')).join(''); };

  function paint() {
    if (!App.state.ready) return;
    const eng = App.state.engine, date = App.state.date, counts = new Map(), sel = App.state.sel, selPlanting = sel && sel.type === 'planting' ? sel.id : null;
    for (const item of beds.values()) {
      const { bed, geo, g, fills } = item, status = eng.bedStatus(bed, date), cap = status.cap || 1;
      clear(fills); item.parts = []; item.status = status;
      const here = [...status.crops].sort((a, b) => a.field - b.field || String(a.planting.id).localeCompare(String(b.planting.id)));
      let used = 0, picking = false, holdsSel = false;
      for (const r of here) {
        const color = eng.cropColor(r.c), ripe = r.first <= date && date <= r.last, id = r.planting.id, name = r.c.vname || r.c.name;
        const attrs = { fill: ripe ? color : tint(color), 'data-planting': id, class: `bed-fill ${ripe ? 'pick' : 'grow'}${id === selPlanting ? ' sel' : ''}` };
        picking = picking || ripe; holdsSel = holdsSel || id === selPlanting;
        counts.set(r.c.id, (counts.get(r.c.id) || 0) + 1);
        if (r.tw) {   // a tower is held whole
          fills.append(geo.shape === 'circle' ? s('circle', { ...attrs, r: geo.W / 2 }) : s('rect', { ...attrs, x: -geo.W / 2, y: -geo.L / 2, width: geo.W, height: geo.L }));
          item.parts.push({ id, name, short: String(bed.bed), w: geo.W, l: geo.L, cx: 0, cy: 0, along: false }); break;
        }
        if (geo.cells) {
          const c = geo.cells, n = Math.max(1, Math.round(r.len)), group = s('g', { 'data-planting': id });
          for (let i = used; i < Math.min(c.count, used + n); i++) {
            const x = -geo.W / 2 + (i % c.columns) * (c.w + c.gap), y = -geo.L / 2 + Math.floor(i / c.columns) * (c.l + c.gap);
            group.append(c.round ? s('circle', { ...attrs, cx: x + c.w / 2, cy: y + c.l / 2, r: c.w * 0.46 }) : s('rect', { ...attrs, x: x + c.w * 0.04, y: y + c.l * 0.04, width: c.w * 0.92, height: c.l * 0.92, rx: c.w * 0.08 }));
          }
          fills.append(group); used += n;
          if (n >= c.count) item.parts.push({ id, name, w: geo.W, l: geo.L, cx: 0, cy: 0, along: geo.L >= geo.W });
          continue;
        }
        const f = eng.footprint(r.planting, r) || { a0: used, a1: Math.min(cap, used + r.len), x0: 0, x1: 1 };   // benches fill by count
        if (!geo.ft) { used = f.a1; }
        const b = geo.ft ? boxOf(geo, f) : { x: -geo.W / 2, y: geo.L / 2 - geo.L * f.a1 / cap, w: geo.W, h: geo.L * (f.a1 - f.a0) / cap };
        if (b.h <= 0) continue;
        fills.append(s('rect', { ...attrs, x: b.x, y: b.y, width: b.w, height: b.h }));
        // Rows, as they run down the bed.
        const rows = geo.ft && r.rows >= 1 && r.rows <= 16 ? r.rows : 0;
        if (rows) { let d = ''; for (let i = 0; i < rows; i++) { const x = b.x + (i + 0.5) / rows * b.w; d += `M${x} ${b.y}V${b.y + b.h}`; } fills.append(s('path.bed-rows', { d, stroke: ripe ? tint(color) : color })); }
        item.parts.push({ id, name, w: b.w, l: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, along: b.h >= b.w, f });
      }
      // Names are drawn after the fills so they sit on top.
      for (const part of item.parts) {
        const base = geo.shape === 'circle' ? -geo.rot : upright(geo.rot, part.along ? -90 : 0);
        part.el = s('text.bed-label', { transform: `translate(${part.cx} ${part.cy}) rotate(${base})`, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        fills.append(part.el);
      }
      const planted = here.length > 0;
      item.planted = planted;
      g.setAttribute('class', ['bed', geo.shape === 'circle' ? 'tower' : geo.shape === 'cells' ? 'pots' : '', planted ? 'is-planted' : status.resting ? 'is-resting' : 'is-empty', picking ? 'is-picking' : '',
        highlightCrop && !here.some(r => r.c.id === highlightCrop) ? 'dim' : '', sel && sel.type === 'bed' && sel.id === bed.id ? 'sel' : '', holdsSel ? 'has-sel' : '', item.drop || ''].filter(Boolean).join(' '));
    }
    paintLegend(counts);
    paintHandles();
    scheduleLabels();
  }
  /**
   * The crops in the ground, most beds first, as one quiet line. What does not fit
   * waits behind "+n"; the crop being shown on its own is always kept in view.
   */
  let legendOpen = false;
  function paintLegend(counts) {
    const eng = App.state.engine, host = clear($('mapLegend'));
    const rows = [...counts].map(([id, n]) => ({ c: eng.crop(id), n })).filter(x => x.c).sort((a, b) => (b.c.id === highlightCrop) - (a.c.id === highlightCrop) || b.n - a.n);
    $('mapBar').classList.toggle('empty', !rows.length);
    if (!rows.length) { host.append(h('span.legend-empty', 'Nothing on this date')); fitLegend(); return; }
    for (const { c, n } of rows) {
      const on = highlightCrop === c.id;
      host.append(h('button.legend-chip' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), title: on ? `Showing only ${c.name}. Click to show everything.` : `${c.name}: ${n} space${n === 1 ? '' : 's'}. Click to show only this crop.`,
        onclick: () => { highlightCrop = on ? null : c.id; paint(); } },
        h('i', { style: { background: eng.cropColor(c) } }), h('span', c.name), h('b', n)));
    }
    fitLegend();
  }
  function fitLegend() {
    const host = $('mapLegend'), more = $('legendMore'), bar = $('mapBar'), chips = [...host.querySelectorAll('.legend-chip')];
    for (const chip of chips) chip.hidden = false;
    bar.classList.toggle('open', legendOpen && chips.length > 0);
    more.hidden = !chips.length; more.textContent = legendOpen ? 'Less' : '+00'; more.setAttribute('aria-expanded', String(legendOpen));
    if (legendOpen || !chips.length) return;
    const room = host.clientWidth;
    let hidden = 0;
    for (const chip of chips) { if (chip.offsetLeft + chip.offsetWidth > room + 1) { chip.hidden = true; hidden++; } }
    more.hidden = !hidden; more.textContent = `+${hidden}`; more.title = `${hidden} more crop${hidden === 1 ? '' : 's'}`;
  }

  // ── the selected planting: an outline and two ends to drag ──
  function selected() {
    const sel = App.state.sel, p = sel && sel.type === 'planting' ? App.state.engine.planting(sel.id) : null, item = p && beds.get(p.bedId);
    const part = item && item.parts.find(x => x.id === p.id);
    return part && part.f && item.geo.ft ? { p, item, part } : null;
  }
  function paintHandles(preview) {
    const over = $('mapOver');
    for (const el of over.querySelectorAll('.sel-layer')) el.remove();
    const cur = selected();
    if (!cur) return;
    const { item, part } = cur, geo = item.geo, f = preview || part.f, b = boxOf(geo, f), t = 7 / view.z, layer = s('g.sel-layer', { transform: bedTransform(geo) });
    layer.append(s('rect.sel-box' + (preview ? '.live' : ''), { x: b.x, y: b.y, width: b.w, height: b.h }));
    if (b.h * view.z >= 34 && b.w * view.z >= 9) {
      const grip = edge => s('rect.sel-grip', { x: b.x + b.w * 0.15, y: (edge === 'start' ? b.y + b.h : b.y) - t / 2, width: b.w * 0.7, height: t, rx: t / 2, 'data-handle': edge }, s('title', 'Drag to change the length'));
      layer.append(grip('start'), grip('end'));
    }
    over.append(layer);
  }

  // ── view transform ──
  function applyView() {
    const map = $('map'), ftPx = view.z / feetPerPx, rel = view.z / (view.home || view.z);
    $('mapWorld').setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.z})`);
    map.style.setProperty('--label-size', (10.5 / view.z) + 'px');
    map.style.setProperty('--tag-size', (9.5 / view.z) + 'px');
    map.style.setProperty('--garden-size', (11 / view.z) + 'px');
    map.classList.toggle('z-rows', ftPx >= 4.2);
    map.classList.toggle('z-tags', ftPx >= 2.6);
    // Close in, the photo is only a blur: let it fall back so the beds read.
    $('mapPhoto').style.opacity = clamp(1 - (rel - 1.6) * 0.16, 0.34, 1);
    const bar = $('mapScale'), nice = [5, 10, 20, 50, 100, 200, 500, 1000].find(n => n * ftPx >= 64) || 1000;
    bar.style.width = (nice * ftPx) + 'px'; bar.textContent = `${nice} ft`;
    paintHandles();
    scheduleLabels();
  }
  function scheduleLabels() { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateLabels); }
  function updateLabels() {
    const z = view.z;
    for (const { geo, parts, tag, planted } of beds.values()) {
      for (const part of parts) {
        const along = (part.along ? part.l : part.w) * z, across = (part.along ? part.w : part.l) * z, show = layers.labels && across >= 11 && along >= 26, room = Math.floor(along / 6.4);
        part.el.style.display = show ? '' : 'none';
        // A name cut to a few letters says nothing: a tower shows its number instead.
        if (show) part.el.textContent = part.name.length <= room ? part.name : part.short && room < 8 ? part.short : part.name.slice(0, Math.max(1, room - 1)) + '…';
      }
      // The space's own number: inside while it is empty, at its foot once planted.
      const fits = planted ? geo.shape !== 'circle' && geo.W * z >= 12 && $('map').classList.contains('z-tags') : Math.min(geo.W, geo.L) * z >= 11;
      tag.style.display = layers.labels && fits ? '' : 'none';
      if (fits) tag.setAttribute('transform', planted ? `translate(0 ${geo.L / 2 + 9 / z}) rotate(${-geo.rot})` : `rotate(${-geo.rot})`);
    }
    $('mapGardens').style.display = layers.labels ? '' : 'none';
    if (!layers.labels) return;
    // Garden names give way to each other: the garden with more beds keeps its label.
    const names = [...$('mapGardens').children].sort((a, b) => (gardenSize.get(b.dataset.garden) || 0) - (gardenSize.get(a.dataset.garden) || 0)), kept = [];
    for (const el of names) el.style.visibility = '';
    for (const el of names) {
      const r = el.getBoundingClientRect(), hit = kept.some(k => r.left < k.right + 6 && k.left < r.right + 6 && r.top < k.bottom + 2 && k.top < r.bottom + 2);
      if (hit) el.style.visibility = 'hidden'; else kept.push(r);
    }
  }
  function frame(items, pad, top = 30) {
    const rect = $('map').getBoundingClientRect();
    if (!rect.width || !items.length) return false;
    const box = bounds(items), w = (box.x1 - box.x0) || 100, hgt = (box.y1 - box.y0) || 100;
    view.z = Math.min(60, rect.width / (w * (1 + 2 * pad)), (rect.height - top - 46) / (hgt * (1 + 2 * pad)));
    view.x = rect.width / 2 - (box.x0 + w / 2) * view.z; view.y = (rect.height - 46 + top) / 2 - (box.y0 + hgt / 2) * view.z;
    return true;
  }
  function fit(later) {
    if (later === true) { view.fitted = false; return; }
    if (!frame([...beds.values()], 0.05)) return;
    view.home = view.z; view.fitted = true; applyView();
  }
  function fitGarden(id) {
    if (frame([...beds.values()].filter(x => x.bed.gardenId === id), 0.22, 54)) applyView();
  }
  function zoomAt(cx, cy, factor) {
    const rect = $('map').getBoundingClientRect(), px = cx - rect.left, py = cy - rect.top, z = clamp(view.z * factor, 0.05, 60);
    view.x = px - (px - view.x) * (z / view.z); view.y = py - (py - view.y) * (z / view.z); view.z = z;
    applyView();
  }
  function focusBed(bedId) {
    const item = beds.get(bedId), rect = $('map').getBoundingClientRect();
    if (!item || !rect.width) return;
    const sx = item.geo.x * view.z + view.x, sy = item.geo.y * view.z + view.y;
    if (sx < 40 || sy < 40 || sx > rect.width - 40 || sy > rect.height - 40) { view.x += rect.width / 2 - sx; view.y += rect.height / 2 - sy; applyView(); }
  }
  /** A screen point in a bed's own terms: feet along it and 0..1 across it. */
  function inBed(item, cx, cy) {
    const { geo } = item, rect = $('map').getBoundingClientRect(), a = -geo.rot * Math.PI / 180;
    const wx = (cx - rect.left - view.x) / view.z - geo.x, wy = (cy - rect.top - view.y) / view.z - geo.y;
    const bx = wx * Math.cos(a) - wy * Math.sin(a), by = wx * Math.sin(a) + wy * Math.cos(a);
    return { along: (geo.L / 2 - by) / geo.L * (geo.ft || 1), across: bx / geo.W + 0.5 };
  }
  /** Aim inside a bed only counts when the bed is drawn big enough to aim at. */
  function aimAt(bedId, cx, cy) {
    const item = beds.get(bedId);
    if (!item || !item.geo.ft || item.geo.L * view.z < 110) return {};
    const at = inBed(item, cx, cy);
    return { along: clamp(at.along, 0, item.geo.ft), across: item.geo.W * view.z >= 26 ? clamp(at.across, 0, 1) : undefined };
  }

  // ── pointer: pan, pinch, click, pick up, stretch ──
  const pointers = new Map();
  let gesture = null;
  function onDown(e) {
    if (e.button > 1) return;
    if (e.button === 1) e.preventDefault();   // no browser auto-scroll on a middle-button pan
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    $('map').setPointerCapture(e.pointerId);
    hideTip();
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z }; return; }
    if (pointers.size !== 1) return;
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, target: e.target }, mouse = e.pointerType !== 'touch', free = e.button === 0 && !spaceDown;
    const grip = free && e.target.closest('[data-handle]'), fill = free && mouse && !App.state.armed && e.target.closest('#mapBeds [data-planting]');
    const cur = grip && selected();
    if (cur) { gesture = { ...start, kind: 'stretch', edge: grip.dataset.handle, cur, result: null }; $('map').classList.add('stretching'); return; }
    if (fill) {
      const p = App.state.engine.planting(fill.dataset.planting), r = p && App.state.engine.calc(p);
      if (r) { gesture = { ...start, kind: 'hold' }; root.LRFDrag.watch(e, { payload: { plantingId: p.id }, label: App.cropLabel(p), color: App.state.engine.cropColor(r.c) }); return; }
    }
    gesture = { ...start, kind: e.button === 1 || spaceDown ? 'pan' : 'tap' };
    if (gesture.kind === 'pan') $('map').classList.add('panning');
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) { if (!root.LRFDrag.active()) hover(e); return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (gesture.z * d / gesture.d) / view.z);
    } else if (gesture.kind === 'stretch') {
      const { cur } = gesture, res = Rails.stretch(App.state.engine, cur.p, gesture.edge, inBed(cur.item, e.clientX, e.clientY).along);
      if (!res) return;
      gesture.result = res;
      paintHandles(res);
      const r = App.state.engine.calc(cur.p), plants = r.rows * Math.floor(res.len * 12 / r.inRow);
      showTip(e, [h('strong', `${num(res.len, 1)} ft`), h('span.tip-spec', `${num(res.a0, 1)}–${num(res.a1, 1)} ft of ${num(r.cap, 1)} · ${num(plants)} plants`)]);
    } else if (gesture.kind === 'tap' || gesture.kind === 'pan') {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (gesture.kind === 'tap' && Math.hypot(dx, dy) > 4) { gesture.kind = 'pan'; $('map').classList.add('panning'); }
      if (gesture.kind === 'pan') { view.x = gesture.vx + dx; view.y = gesture.vy + dy; applyView(); }
    }
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const done = gesture; if (!pointers.size) gesture = null;
    $('map').classList.remove('panning', 'stretching');
    if (!done || e.type === 'pointercancel') { paintHandles(); return; }
    if (done.kind === 'stretch') {
      hideTip();
      const res = done.result;
      if (!res || res.same || !App.updatePlanting(done.cur.p.id, res.change, `Resize ${App.cropLabel(done.cur.p)}`)) paintHandles();
      return;
    }
    if (done.kind === 'hold' ? root.LRFDrag.active() : done.kind !== 'tap') return;
    const at = done.target.closest ? done.target : done.target.parentNode, label = at.closest('.garden-label');
    if (label) { fitGarden(label.dataset.garden); return; }
    const fill = at.closest('#mapBeds [data-planting]'), bedEl = at.closest('[data-bed]');
    const bedId = bedEl ? bedEl.dataset.bed : nearest(e.clientX, e.clientY, 10);
    if (App.state.armed) { if (bedId) App.place(App.state.armed, bedId, App.state.date, aimAt(bedId, e.clientX, e.clientY)); return; }
    if (fill) App.select({ type: 'planting', id: fill.dataset.planting });
    else if (bedId) App.select({ type: 'bed', id: bedId });
    else if (App.state.sel) App.select(null);
  }
  function onWheel(e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))); }

  // ── hover card ──
  function showTip(e, nodes) {
    const tip = $('tip');
    clear(tip).append(...nodes);
    tip.hidden = false;
    const host = $('mapView').getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(e.clientX - host.left + 14, 8, host.width - tw - 8) + 'px';
    tip.style.top = clamp(e.clientY - host.top + 14, 8, host.height - th - 8) + 'px';
  }
  function hover(e) {
    const el = e.target.closest && e.target.closest('[data-bed]');
    if (!el) { hideTip(); return; }
    const item = beds.get(el.dataset.bed), eng = App.state.engine;
    if (!item || !item.status) return;
    const { bed, status } = item, date = App.state.date, unit = eng.capUnit(bed), over = e.target.closest('[data-planting]');
    const nodes = [h('strong', App.bedLabel(bed)), h('span.tip-spec', eng.isSoilBed(bed) ? `${num(bed.w, 1)} × ${num(bed.l, 1)} ft` : `${num(status.cap)} ${unit}`)];
    const listed = status.crops.length > 6 && over ? status.crops.filter(r => r.planting.id === over.dataset.planting) : status.crops.slice(0, 6);
    for (const r of listed) {
      const f = eng.footprint(r.planting, r), where = f && r.partial ? ` · ${num(f.a0, 1)}–${num(Math.min(f.a1, r.cap), 1)} ft${f.rows && f.rows.count < f.rows.total ? `, ${f.rows.count} of ${f.rows.total} rows` : ''}` : r.partial ? ` · ${num(r.len, 1)} ${unit}` : '';
      nodes.push(h('div.tip-crop' + (over && over.dataset.planting === r.planting.id ? '.on' : ''), root.LRFThumbs.el({ varietyId: r.planting.varietyId, cropId: r.planting.cropId, color: eng.cropColor(r.c), label: r.c.vname || r.c.name, size: 30, cls: 'key' }),
        h('span', `${r.c.vname ? r.c.vname + ' · ' : ''}${r.c.name}`), h('small', `in ${day(r.field)} · harvest ${span(r.first, r.last)}${where}`)));
    }
    if (status.crops.length > listed.length) nodes.push(h('div.tip-free', `${status.crops.length} plantings here`));
    if (!status.crops.length) {
      const next = eng.nextPlanting(bed.id, date);
      nodes.push(h('div.tip-free', status.resting ? 'Turning over' : 'Free', next ? ` · next ${next.c.name} ${day(next.field)}` : ' for the rest of the plan'));
    } else if (over && e.pointerType !== 'touch') nodes.push(h('div.tip-hint', 'Drag to move · Alt-drag to copy'));
    showTip(e, nodes);
  }
  const hideTip = () => { $('tip').hidden = true; };

  // ── drop targets (used by the drag controller) ──
  /** The bed under a screen point, or the closest one within `reach` pixels: beds are thin targets. */
  function nearest(cx, cy, reach = 16) {
    let best = null, bestD = reach;
    for (const [id, { g }] of beds) {
      const r = g.getBoundingClientRect(), dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom), d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }
  function targetAt(cx, cy) {
    const rect = $('map').getBoundingClientRect();
    if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return null;
    const el = document.elementFromPoint(cx, cy), bedEl = el && el.closest && el.closest('#map [data-bed]');
    const bedId = bedEl ? bedEl.dataset.bed : nearest(cx, cy);
    return bedId ? { bedId, ...aimAt(bedId, cx, cy) } : null;
  }
  /** While something is in the air: mark what each space would do, and draw where the drop would land. */
  function showDrop(states, target) {
    const targetId = target && target.bedId;
    for (const [id, item] of beds) {
      const st = states ? states.get(id) : null;
      item.drop = st ? `drop-${st}${id === targetId ? ' drop-target' : ''}` : '';
      const base = item.g.getAttribute('class').split(' ').filter(c => !c.startsWith('drop-'));
      item.g.setAttribute('class', base.concat(item.drop ? item.drop.split(' ') : []).join(' '));
    }
    $('map').classList.toggle('dropping', !!states);
    const over = $('mapOver');
    for (const el of over.querySelectorAll('.drop-layer')) el.remove();
    const item = target && beds.get(targetId), res = target && target.preview;
    if (!item || !res || res.state === 'blocked') return;
    const geo = item.geo, layer = s('g.drop-layer', { transform: bedTransform(geo) });
    if (geo.ft && res.rect) { const b = boxOf(geo, res.rect); layer.append(s('rect.drop-ghost', { x: b.x, y: b.y, width: b.w, height: b.h, 'data-state': res.state })); }
    else layer.append(geo.shape === 'circle' ? s('circle.drop-ghost', { r: geo.W / 2, 'data-state': res.state }) : s('rect.drop-ghost', { x: -geo.W / 2, y: -geo.L / 2, width: geo.W, height: geo.L, 'data-state': res.state }));
    over.append(layer);
  }

  function init() {
    const svg = $('map');
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('pointerleave', hideTip);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', e => { if (!e.target.closest('.garden-label')) zoomAt(e.clientX, e.clientY, 1.8); });
    svg.addEventListener('auxclick', e => e.preventDefault());
    const typing = e => /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test((e.target && e.target.tagName) || '');
    root.addEventListener('keydown', e => { if (e.code === 'Space' && !typing(e) && App.state.view === 'map') { spaceDown = true; svg.classList.add('pan-ready'); e.preventDefault(); } });
    root.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; svg.classList.remove('pan-ready'); } });
    const center = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    $('mapZoomIn').addEventListener('click', () => zoomAt(...center(), 1.4));
    $('mapZoomOut').addEventListener('click', () => zoomAt(...center(), 1 / 1.4));
    $('mapFit').addEventListener('click', () => fit());
    $('mapPhotoToggle').addEventListener('click', e => { layers.photo = !layers.photo; e.currentTarget.setAttribute('aria-pressed', layers.photo); build(); });
    $('mapLabelToggle').addEventListener('click', e => { layers.labels = !layers.labels; e.currentTarget.setAttribute('aria-pressed', layers.labels); updateLabels(); });
    new ResizeObserver(() => { if (App.state.ready && !view.fitted) fit(); if (App.state.ready) fitLegend(); }).observe(svg);
    $('legendMore').addEventListener('click', () => { legendOpen = !legendOpen; fitLegend(); });
    App.on('plan', () => { $('mapSample').hidden = !App.isSample(); });
    App.on('plan', build);
    App.on('date', paint);
    App.on('sel', () => { paint(); const sel = App.state.sel; if (sel && App.state.view === 'map') { const p = sel.type === 'planting' ? App.state.engine.planting(sel.id) : null; focusBed(p ? p.bedId : sel.id); } });
    App.on('view', () => { if (App.state.view === 'map' && !view.fitted) requestAnimationFrame(() => fit()); });
  }

  root.LRFMap = { init, targetAt, showDrop, fit, fitGarden };
})(window);
