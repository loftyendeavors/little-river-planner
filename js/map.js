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
 *
 * Moves of the view that the grower asks for with a button, a garden's name or a double click are eased, and a mouse
 * wheel's notches are smoothed; a move asked for by another part of the planner (fit, fitGarden) lands at once.
 * Pots and crates: each crop keeps the same containers for as long as it stands (see seatsOf).
 * Editing the layout itself (moving, sizing, adding beds) lives in mapedit.js, which borrows this map through
 * lock(), watch() and the small readers at the foot of this file.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, Rails = root.LRFRails, Geo = root.LRFMapGeo;
  const { s, h, clear, day, span, num } = UI;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const view = { x: 0, y: 0, z: 1, home: 1, fitted: false, moved: false };   // moved: the grower has panned or zoomed since the farm was last fitted
  const beds = new Map();       // bedId -> { bed, geo, g, base, fills, tag, parts, status, drop }
  const gardenSize = new Map(); // gardenId -> number of spaces drawn
  let layers = { photo: true, labels: true }, highlightCrop = null, feetPerPx = 0.1, raf = 0, spaceDown = false;
  // While the layout is being edited this map only moves the view: picking, dragging and hover cards are the editor's.
  let locked = false;
  const watchers = [];
  const tell = (what, detail) => { for (const fn of watchers) fn(what, detail); };

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
    clear(world); clear(labels); clear(plates); clear($('mapOver')); beds.clear(); gardenSize.clear(); seated.clear();
    const photo = $('mapPhoto');
    if (hasPhoto) { photo.setAttribute('href', App.state.mapImageUrl); photo.setAttribute('width', map.imgW || 2000); photo.setAttribute('height', map.imgH || 1200); }
    photo.style.display = hasPhoto && layers.photo ? '' : 'none';
    $('map').classList.toggle('on-photo', hasPhoto && layers.photo);
    $('mapPhotoToggle').hidden = !hasPhoto;

    const slots = unplacedSlots(plan, eng);
    for (const bed of plan.beds) {
      if (bed.active === false || (eng.gardenOf(bed) || {}).active === false || eng.isPool(bed)) continue;
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
    tell('build');
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
      const todo = plan.beds.filter(b => b.gardenId === garden.id && b.active !== false && !placed.includes(b) && !eng.isPool(b));
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

  // ── pots and crates: a crop keeps its containers ──
  // Which containers of a group each planting stands in is worked out for the whole season at once (Geo.seats): first in,
  // first seated, side by side where there is room. So a crop is drawn in the same crates from the day it goes in to the
  // day its ground is free again, and nothing shuffles when the planning date moves. A planting may carry `seat`, the
  // first container chosen for it by hand; it is kept whenever those containers are free.
  const seated = new Map();   // bedId -> Map(planting id -> [container index]); forgotten whenever the plan changes
  const EPOCH = new Date(2000, 0, 1);
  /** Every crop of a group for the season, as Geo.seats takes them. `trial` tries one planting in another place: { id, seat }. */
  function seatsFor(bed, count, trial) {
    const eng = App.state.engine, byKey = new Map();
    for (const p of eng.plantingsIn(bed.id)) {
      const r = eng.calc(p);
      if (!r) continue;
      const key = eng.standKey(p) || p.id, through = eng.occupancyThrough(p, r), seat = trial && trial.id === p.id ? trial.seat : p.seat;
      const item = { id: key, ids: [p.id], from: E.dayDiff(eng.occupancyFrom(p, r), EPOCH), to: through === Infinity ? 1e9 : E.dayDiff(through, EPOCH), n: Math.max(1, Math.round(r.len)), pin: Number.isInteger(seat) ? seat : undefined };
      const had = byKey.get(key);   // one stand kept over several plantings takes one place
      if (had) { had.ids.push(p.id); had.from = Math.min(had.from, item.from); had.to = Math.max(had.to, item.to); had.n = Math.max(had.n, item.n); if (had.pin === undefined || (trial && trial.id === p.id)) had.pin = item.pin; }
      else byKey.set(key, item);
    }
    const byStand = Geo.seats([...byKey.values()], count), out = new Map();
    for (const item of byKey.values()) for (const id of item.ids) out.set(id, byStand.get(item.id) || []);
    return out;
  }
  function seatsOf(bed, count) {
    if (!seated.has(bed.id)) seated.set(bed.id, seatsFor(bed, count));
    return seated.get(bed.id);
  }
  /** The container of a group under a screen point, or null between or beyond them. */
  function cellAt(item, cx, cy) {
    const { geo } = item, c = geo.cells, rect = $('map').getBoundingClientRect(), a = -geo.rot * Math.PI / 180;
    const wx = (cx - rect.left - view.x) / view.z - geo.x, wy = (cy - rect.top - view.y) / view.z - geo.y;
    const bx = wx * Math.cos(a) - wy * Math.sin(a) + geo.W / 2, by = wx * Math.sin(a) + wy * Math.cos(a) + geo.L / 2;
    const col = Math.floor(bx / (c.w + c.gap)), row = Math.floor(by / (c.l + c.gap)), i = row * c.columns + col;
    return bx >= 0 && by >= 0 && col < c.columns && i < c.count ? i : null;
  }
  /**
   * Where a crop picked up in its own group of containers would stand if set down at `cell`: it moves as far as the
   * pointer has, stays whole inside the group, and is `free` when no crop that goes in before it holds those containers.
   * (Crops that go in later make room: their places are worked out after it.)
   */
  function reseat(held, cell) {
    const eng = App.state.engine, p = held && eng.planting(held.plantingId), item = p && beds.get(p.bedId);
    if (!item || !item.geo.cells || cell == null || held.cell == null) return null;
    const count = item.geo.cells.count, now = seatsOf(item.bed, count).get(p.id) || [];
    if (!now.length) return null;
    const start = clamp(now[0] + cell - held.cell, 0, Math.max(0, count - now.length)), got = seatsFor(item.bed, count, { id: p.id, seat: start }).get(p.id) || [];
    return { p, item, start, n: now.length, same: start === now[0] && got.length === now.length, free: got.length === now.length && got[0] === start && got[got.length - 1] === start + now.length - 1 };
  }
  /** The longest run of a crop's containers along one row of the group: where its name is written. */
  function longestRun(indexes, columns) {
    let best = null, run = null;
    for (const i of indexes) {
      if (run && i === run.to + 1 && Math.floor(i / columns) === run.row) run.to = i; else run = { from: i, to: i, row: Math.floor(i / columns) };
      if (!best || run.to - run.from > best.to - best.from) best = { ...run };
    }
    return best;
  }

  // ── the whole season at once ──
  // "Whole season" shows, in every space, everything it grows this year: one band per crop, first crop first, each band as
  // large as its share of the ground and the days it holds it. A tower is a pie; pots and crates are counted out.
  let wholeSeason = false;
  /** What a space grows over the plan's year: runs of one crop in the order they go in (pots and crates: one entry per crop). */
  function seasonOf(eng, bed) {
    const y0 = new Date(App.planYear(), 0, 1), y1 = new Date(App.planYear(), 11, 31), cap = eng.capOf(bed) || 1, byCrop = eng.isCt(bed) || eng.isRack(bed), runs = [];
    const items = eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).sort((a, b) => a.r.field - b.r.field || String(a.p.id).localeCompare(String(b.p.id)));
    for (const { p, r } of items) {
      const through = eng.occupancyThrough(p, r), from = eng.occupancyFrom(p, r) < y0 ? y0 : eng.occupancyFrom(p, r), to = through === Infinity || through > y1 ? y1 : through, days = E.dayDiff(to, from) + 1;
      if (days <= 0) continue;
      const share = r.tw ? 1 : Math.min(1, Math.max(0.02, (r.len || cap) / cap));
      let run = byCrop ? runs.find(x => x.c.id === r.c.id) : runs.length && runs[runs.length - 1].c.id === r.c.id ? runs[runs.length - 1] : null;
      if (!run) runs.push(run = { c: r.c, weight: 0, list: [], from: r.field, first: r.first, last: r.last, varieties: new Set() });
      run.weight += days * share; run.list.push(p);
      if (r.c.vname) run.varieties.add(r.c.vname);
      if (r.first < run.first) run.first = r.first;
      if (r.last > run.last) run.last = r.last;
    }
    const total = runs.reduce((n, x) => n + x.weight, 0) || 1;
    for (const run of runs) run.part = run.weight / total;
    return runs;
  }
  const wedge = (r, a0, a1) => { const at = a => `${r * Math.sin(a)} ${-r * Math.cos(a)}`; return `M0 0L${at(a0)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)}Z`; };
  function paintSeason() {
    const eng = App.state.engine, counts = new Map(), sel = App.state.sel, selPlanting = sel && sel.type === 'planting' ? sel.id : null;
    for (const item of beds.values()) {
      const { bed, geo, g, fills } = item, runs = seasonOf(eng, bed);
      clear(fills); item.parts = []; item.status = eng.bedStatus(bed, App.state.date); item.season = runs;
      const holdsSel = !!selPlanting && runs.some(x => x.list.some(p => p.id === selPlanting));
      // where the bed's own starting end points on the page: down or right means the bands run from the other end
      const turn = (geo.rot || 0) * Math.PI / 180, flip = -Math.sin(turn) + Math.cos(turn) > 0;
      for (const id of new Set(runs.map(x => x.c.id))) counts.set(id, (counts.get(id) || 0) + 1);   // a space counts once for a crop, however often it returns
      let at = 0;
      runs.forEach((run, k) => {
        const color = eng.cropColor(run.c), attrs = { fill: color, class: 'bed-fill pick season', 'data-crop': run.c.id }, name = run.c.name, a0 = at, a1 = k === runs.length - 1 ? 1 : at + run.part;
        at = a1;
        if (geo.shape === 'circle') {
          fills.append(runs.length === 1 ? s('circle', { ...attrs, r: geo.W / 2 }) : s('path', { ...attrs, d: wedge(geo.W / 2, a0 * 2 * Math.PI, a1 * 2 * Math.PI) }));
          if (runs.length === 1) item.parts.push({ id: `season-${k}`, name, short: String(bed.bed), w: geo.W, l: geo.L, cx: 0, cy: 0, along: false });
          return;
        }
        if (geo.cells) {
          const c = geo.cells, i0 = Math.round(a0 * c.count), i1 = Math.max(i0 + (k === runs.length - 1 ? 0 : 1), Math.round(a1 * c.count)), group = s('g', { 'data-crop': run.c.id });
          for (let i = i0; i < Math.min(c.count, i1); i++) {
            const x = -geo.W / 2 + (i % c.columns) * (c.w + c.gap), y = -geo.L / 2 + Math.floor(i / c.columns) * (c.l + c.gap);
            group.append(c.round ? s('circle', { ...attrs, cx: x + c.w / 2, cy: y + c.l / 2, r: c.w * 0.46 }) : s('rect', { ...attrs, x: x + c.w * 0.04, y: y + c.l * 0.04, width: c.w * 0.92, height: c.l * 0.92, rx: c.w * 0.08 }));
          }
          fills.append(group);
          if (runs.length === 1) item.parts.push({ id: `season-${k}`, name, w: geo.W, l: geo.L, cx: 0, cy: 0, along: geo.L >= geo.W });
          return;
        }
        // a band along the bed: the first crop at the end nearer the top or left of the page, so every bed reads the same way
        const hgt = geo.L * (a1 - a0), y = flip ? -geo.L / 2 + geo.L * a0 : geo.L / 2 - geo.L * a1;
        fills.append(s('rect', { ...attrs, x: -geo.W / 2, y, width: geo.W, height: hgt }));
        item.parts.push({ id: `season-${k}`, name, w: geo.W, l: hgt, cx: 0, cy: y + hgt / 2, along: hgt >= geo.W });
      });
      for (const part of item.parts) {
        const base = geo.shape === 'circle' ? -geo.rot : upright(geo.rot, part.along ? -90 : 0);
        part.el = s('text.bed-label', { transform: `translate(${part.cx} ${part.cy}) rotate(${base})`, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        fills.append(part.el);
      }
      item.planted = runs.length > 0;
      g.setAttribute('class', ['bed', geo.shape === 'circle' ? 'tower' : geo.shape === 'cells' ? 'pots' : '', runs.length ? 'is-planted' : 'is-empty',
        highlightCrop && !runs.some(x => x.c.id === highlightCrop) ? 'dim' : '', sel && ((sel.type === 'bed' && sel.id === bed.id) || (sel.type === 'opening' && sel.bedId === bed.id)) ? 'sel' : '', holdsSel ? 'has-sel' : '', item.drop || ''].filter(Boolean).join(' '));
    }
    paintLegend(counts);
    paintHandles();
    scheduleLabels();
  }
  function setWholeSeason(on) {
    wholeSeason = !!on; highlightCrop = null;
    $('mapSeasonToggle').setAttribute('aria-pressed', String(wholeSeason));
    $('mapView').classList.toggle('whole-season', wholeSeason);
    $('mapBar').querySelector('.bar-title').textContent = wholeSeason ? 'Through the season' : 'In the ground';
    hideTip(); paint();
  }

  function paint() {
    if (!App.state.ready) return;
    if (wholeSeason) { paintSeason(); return; }
    const eng = App.state.engine, date = App.state.date, counts = new Map(), sel = App.state.sel, selPlanting = sel && sel.type === 'planting' ? sel.id : null;
    // while the series tool is open: the spaces it would plant, and the beds named for it
    const Series = root.LRFSeries, ghosts = Series ? Series.ghosts() : null, willPlant = new Set(((ghosts && ghosts.placed) || []).map(x => x.bed.id)), named = new Set((ghosts && ghosts.named) || []);
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
          // each crop in the containers that are its own for the season
          const c = geo.cells, mine = seatsOf(bed, c.count).get(id) || [], group = s('g', { 'data-planting': id });
          for (const i of mine) {
            const x = -geo.W / 2 + (i % c.columns) * (c.w + c.gap), y = -geo.L / 2 + Math.floor(i / c.columns) * (c.l + c.gap);
            group.append(c.round ? s('circle', { ...attrs, cx: x + c.w / 2, cy: y + c.l / 2, r: c.w * 0.46 }) : s('rect', { ...attrs, x: x + c.w * 0.04, y: y + c.l * 0.04, width: c.w * 0.92, height: c.l * 0.92, rx: c.w * 0.08 }));
          }
          fills.append(group); used += mine.length;
          const run = longestRun(mine, c.columns);
          if (mine.length >= c.count) item.parts.push({ id, name, w: geo.W, l: geo.L, cx: 0, cy: 0, along: geo.L >= geo.W });
          else if (run) {
            // its name goes on the longest run of its containers in one row
            const n = run.to - run.from + 1, w = n * c.w + (n - 1) * c.gap;
            item.parts.push({ id, name, w, l: c.l, cx: -geo.W / 2 + (run.from % c.columns) * (c.w + c.gap) + w / 2, cy: -geo.L / 2 + run.row * (c.l + c.gap) + c.l / 2, along: false });
          }
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
        highlightCrop && !here.some(r => r.c.id === highlightCrop) ? 'dim' : '', sel && ((sel.type === 'bed' && sel.id === bed.id) || (sel.type === 'opening' && sel.bedId === bed.id)) ? 'sel' : '', holdsSel ? 'has-sel' : '',
        willPlant.has(bed.id) ? 'will-plant' : '', named.has(bed.id) ? 'named' : '', item.drop || ''].filter(Boolean).join(' '));
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
    if (!rows.length) { host.append(h('span.legend-empty', wholeSeason ? 'Nothing planted this season' : 'Nothing on this date')); fitLegend(); return; }
    for (const { c, n } of rows) {
      const on = highlightCrop === c.id;
      host.append(h('button.legend-chip' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(on), title: on ? `Showing only ${c.name}. Click to show everything.` : `${c.name}: ${n} space${n === 1 ? '' : 's'}${wholeSeason ? ' this season' : ''}. Click to show only this crop.`,
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
    const part = !wholeSeason && item && item.parts.find(x => x.id === p.id);
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
    tell('view');
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
  /** The view that frames some spaces, with room for the tools above and the legend below. Nothing is moved here. */
  function framed(items, pad, top = 30, most = 60) {
    const rect = $('map').getBoundingClientRect();
    if (!rect.width || !items.length) return null;
    const box = bounds(items), w = (box.x1 - box.x0) || 100, hgt = (box.y1 - box.y0) || 100;
    const z = Math.min(60, most, rect.width / (w * (1 + 2 * pad)), (rect.height - top - 46) / (hgt * (1 + 2 * pad)));
    return { z, x: rect.width / 2 - (box.x0 + w / 2) * z, y: (rect.height - 46 + top) / 2 - (box.y0 + hgt / 2) * z };
  }
  // ── moving the view smoothly ──
  const calm = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let gliding = 0, wheel = null;
  function settle() { if (gliding) { cancelAnimationFrame(gliding); gliding = 0; } if (wheel) { cancelAnimationFrame(wheel.raf); wheel = null; } }
  /**
   * Take the view to `to` in one eased motion. The point in the middle of the map is carried in a straight line while the
   * zoom changes by equal ratios, so near and far moves both read as one movement and not a slide followed by a jump.
   */
  function glide(to, ms = 280) {
    settle();
    const rect = $('map').getBoundingClientRect();
    if (calm() || !(ms > 0) || !rect.width) { view.x = to.x; view.y = to.y; view.z = to.z; applyView(); return; }
    const mid = v => [(rect.width / 2 - v.x) / v.z, (rect.height / 2 - v.y) / v.z], from = { x: view.x, y: view.y, z: view.z }, a = mid(from), b = mid(to), t0 = performance.now();
    const step = now => {
      const k = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);   // a frame's own clock can read a hair before the click that started this
      const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e), cx = a[0] + (b[0] - a[0]) * e, cy = a[1] + (b[1] - a[1]) * e;
      view.z = z; view.x = rect.width / 2 - cx * z; view.y = rect.height / 2 - cy * z;
      if (k >= 1) { view.x = to.x; view.y = to.y; view.z = to.z; gliding = 0; } else gliding = requestAnimationFrame(step);
      applyView();
    };
    gliding = requestAnimationFrame(step);
  }
  /** The view after zooming by `factor` about a point on the screen. */
  function zoomed(cx, cy, factor) {
    const rect = $('map').getBoundingClientRect(), px = cx - rect.left, py = cy - rect.top, z = clamp(view.z * factor, 0.05, 60);
    return { z, x: px - (px - view.x) * (z / view.z), y: py - (py - view.y) * (z / view.z) };
  }
  /**
   * The beds are framed; the farm photo is then settled under them. On a screen wider than the photo the whole photo sits in
   * the middle, with the same margin either side. Where the photo is the wider, it is slid just far enough that no empty strip
   * shows beside it while its other side runs off the screen. Either way every bed stays in view.
   */
  function settlePhoto(v) {
    const photo = $('mapPhoto'), rect = $('map').getBoundingClientRect(), w = +photo.getAttribute('width') * v.z;
    if (!App.state.mapImageUrl || !layers.photo || !(w > 0) || !beds.size) return v;
    const box = bounds([...beds.values()]), lo = 12 - box.x0 * v.z, hi = rect.width - 12 - box.x1 * v.z;
    if (lo > hi) return v;
    return { ...v, x: clamp(w <= rect.width ? (rect.width - w) / 2 : clamp(v.x, rect.width - w, 0), lo, hi) };
  }
  /** Take the view somewhere: at once, or eased when the grower asked for it by hand. */
  function go(to, eased) { if (eased) glide(to); else { settle(); view.x = to.x; view.y = to.y; view.z = to.z; applyView(); } }
  function fit(later, eased) {
    if (later === true) { view.fitted = false; return; }
    const to = framed([...beds.values()], 0.05);
    if (!to) return;
    const home = settlePhoto(to);
    view.home = home.z; view.fitted = true; view.moved = false;
    go(home, eased === true);
  }
  function fitGarden(id, eased) {
    const to = framed([...beds.values()].filter(x => x.bed.gardenId === id), 0.22, 54);
    if (to) { view.moved = true; go(to, eased === true); }
  }
  /** Frame some spaces by id: the layout editor brings what is being worked on into view. It never zooms closer than is useful. */
  function fitSpaces(ids, eased, pad = 0.3) {
    const to = framed(ids.map(id => beds.get(id)).filter(Boolean), pad, 54, Math.max(view.z, 22));
    if (to) { view.moved = true; go(to, eased === true); }
  }
  function zoomAt(cx, cy, factor) {
    const to = zoomed(cx, cy, factor);
    view.x = to.x; view.y = to.y; view.z = to.z; view.moved = true;
    applyView();
  }
  /** One notch of a mouse wheel: the zoom it asks for is reached over a few frames, about the pointer. Notches add up. */
  function wheelTo(cx, cy, factor) {
    if (gliding) { cancelAnimationFrame(gliding); gliding = 0; }
    const z = clamp((wheel ? wheel.z : view.z) * factor, 0.05, 60);
    if (wheel) { wheel.z = z; wheel.cx = cx; wheel.cy = cy; return; }
    wheel = { z, cx, cy, last: performance.now(), raf: 0 };
    const step = now => {
      if (!wheel) return;
      const dt = Math.min(64, Math.max(1, now - wheel.last)), k = 1 - Math.exp(-dt / 60), want = Math.log(wheel.z), at = Math.log(view.z) + (want - Math.log(view.z)) * k, done = Math.abs(want - at) < 0.003;
      wheel.last = now;
      const target = done ? wheel.z : Math.exp(at), { cx: x, cy: y } = wheel;
      if (done) wheel = null; else wheel.raf = requestAnimationFrame(step);
      zoomAt(x, y, target / view.z);
    };
    wheel.raf = requestAnimationFrame(step);
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
    hideTip(); settle();
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z }; return; }
    if (pointers.size !== 1) return;
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, target: e.target }, mouse = e.pointerType !== 'touch', free = e.button === 0 && !spaceDown && !locked;
    const grip = free && e.target.closest('[data-handle]'), fill = free && mouse && !App.state.armed && e.target.closest('#mapBeds [data-planting]');
    const cur = grip && selected();
    if (cur) { gesture = { ...start, kind: 'stretch', edge: grip.dataset.handle, cur, result: null }; $('map').classList.add('stretching'); return; }
    if (fill) {
      const p = App.state.engine.planting(fill.dataset.planting), r = p && App.state.engine.calc(p);
      if (r) {
        const own = beds.get(p.bedId);
        gesture = { ...start, kind: 'hold', plantingId: p.id, cell: own && own.geo.cells ? cellAt(own, e.clientX, e.clientY) : null };
        root.LRFDrag.watch(e, { payload: { plantingId: p.id }, label: App.cropLabel(p), color: App.state.engine.cropColor(r.c) }); return;
      }
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
      if (gesture.kind === 'pan') { view.x = gesture.vx + dx; view.y = gesture.vy + dy; view.moved = true; applyView(); }
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
    if (done.kind === 'hold' && root.LRFDrag.active() && !e.altKey) {
      // a crop set down in its own group of containers: other containers, nothing else about it changes
      const spot = targetAt(e.clientX, e.clientY), to = spot && spot.cell != null ? reseat(done, spot.cell) : null;
      if (to && spot.bedId === to.p.bedId) {
        root.LRFDrag.cancel();
        if (to.same) return;
        if (!to.free) { UI.toast(`Those containers are taken while ${App.cropLabel(to.p)} stands: a crop that goes in before it keeps its place.`); return; }
        if (App.updatePlanting(to.p.id, { seat: to.start }, `Move ${App.cropLabel(to.p)} to other containers`)) UI.toast(`${App.cropLabel(to.p)} moved within ${App.bedLabel(to.item.bed)}. Later crops make room for it.`, { label: 'Undo', run: App.undo });
        return;
      }
    }
    if (done.kind === 'hold' ? root.LRFDrag.active() : done.kind !== 'tap') return;
    if (locked) { tell('tap', e); return; }   // a click on open ground while the layout is being edited: the editor's to answer
    const at = done.target.closest ? done.target : done.target.parentNode, label = at.closest('.garden-label');
    if (label) { fitGarden(label.dataset.garden, true); return; }
    const fill = at.closest('#mapBeds [data-planting]'), bedEl = at.closest('[data-bed]');
    const bedId = bedEl ? bedEl.dataset.bed : nearest(e.clientX, e.clientY, 10);
    if (App.state.armed) { if (bedId) App.place(App.state.armed, bedId, App.state.date, aimAt(bedId, e.clientX, e.clientY)); return; }
    // while the series tool is asking for beds, a click on a bed names it
    if (bedId && root.LRFSeries && root.LRFSeries.picking() && root.LRFSeries.toggleBed(bedId)) return;
    if (fill) App.select({ type: 'planting', id: fill.dataset.planting });
    else if (bedId) App.select({ type: 'bed', id: bedId });
    else if (App.state.sel && App.state.sel.type !== 'series') App.select(null);   // a stray click on the photo does not throw a half-filled series away
  }
  function onWheel(e) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
    // A mouse wheel turns in notches, and each one is eased. A trackpad or a pinch sends a stream of small moves: those are followed as they come.
    if (e.ctrlKey || e.deltaMode !== 0 || Math.abs(e.deltaY) < 40 || calm()) { settle(); zoomAt(e.clientX, e.clientY, factor); }
    else wheelTo(e.clientX, e.clientY, factor);
  }

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
    const el = !locked && e.target.closest && e.target.closest('[data-bed]');
    if (!el) { hideTip(); return; }
    const item = beds.get(el.dataset.bed), eng = App.state.engine;
    if (!item || !item.status) return;
    const { bed, status } = item, date = App.state.date, unit = eng.capUnit(bed), over = e.target.closest('[data-planting]');
    const nodes = [h('strong', App.bedLabel(bed)), h('span.tip-spec', eng.isSoilBed(bed) ? `${num(bed.w, 1)} × ${num(bed.l, 1)} ft` : `${num(status.cap)} ${unit}`)];
    if (wholeSeason) {
      // everything this space grows this year, in the order it goes in
      const runs = item.season || [], on = e.target.closest('[data-crop]');
      for (const run of runs.slice(0, 8)) {
        const n = run.list.length, kinds = [...run.varieties], first = run.list[0];
        nodes.push(h('div.tip-crop' + (on && on.dataset.crop === run.c.id ? '.on' : ''), root.LRFThumbs.el({ varietyId: kinds.length === 1 ? first.varietyId : null, cropId: run.c.id, color: eng.cropColor(run.c), label: run.c.name, size: 30, cls: 'key' }),
          h('span', `${run.c.name}${kinds.length === 1 ? ' · ' + kinds[0] : kinds.length > 1 ? ` · ${kinds.length} varieties` : ''}`),
          h('small', `${n > 1 ? `${n} plantings · ` : ''}in ${day(run.from)} · harvest ${span(run.first, run.last)}`)));
      }
      if (runs.length > 8) nodes.push(h('div.tip-free', `and ${runs.length - 8} more`));
      if (!runs.length) nodes.push(h('div.tip-free', 'Nothing planned here this season'));
      showTip(e, nodes);
      return;
    }
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
    if (!bedId) return null;
    const item = beds.get(bedId);
    return item && item.geo.cells ? { bedId, cell: cellAt(item, cx, cy) } : { bedId, ...aimAt(bedId, cx, cy) };
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
    const to = item && item.geo.cells && gesture && gesture.kind === 'hold' && target.cell != null ? reseat(gesture, target.cell) : null;
    if (to && to.p.bedId === targetId) {
      // within its own group: the containers it would take, drawn one by one
      const c = item.geo.cells, layer = s('g.drop-layer', { transform: bedTransform(item.geo) });
      for (let i = to.start; i < to.start + to.n; i++) layer.append(s('rect.drop-ghost.cell', { x: -item.geo.W / 2 + (i % c.columns) * (c.w + c.gap), y: -item.geo.L / 2 + Math.floor(i / c.columns) * (c.l + c.gap), width: c.w, height: c.l, rx: c.w * 0.08, 'data-state': to.free ? 'ok' : 'blocked' }));
      over.append(layer);
      return;
    }
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
    svg.addEventListener('dblclick', e => { if (!e.target.closest('.garden-label')) { view.moved = true; glide(zoomed(e.clientX, e.clientY, 1.8), 220); } });
    svg.addEventListener('auxclick', e => e.preventDefault());
    const typing = e => /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test((e.target && e.target.tagName) || '');
    root.addEventListener('keydown', e => { if (e.code === 'Space' && !typing(e) && App.state.view === 'map') { spaceDown = true; svg.classList.add('pan-ready'); e.preventDefault(); } });
    root.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; svg.classList.remove('pan-ready'); } });
    const center = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    $('mapZoomIn').addEventListener('click', () => { view.moved = true; glide(zoomed(...center(), 1.5), 200); });
    $('mapZoomOut').addEventListener('click', () => { view.moved = true; glide(zoomed(...center(), 1 / 1.5), 200); });
    $('mapFit').addEventListener('click', () => fit(false, true));
    $('mapPhotoToggle').addEventListener('click', e => { layers.photo = !layers.photo; e.currentTarget.setAttribute('aria-pressed', layers.photo); build(); });
    $('mapLabelToggle').addEventListener('click', e => { layers.labels = !layers.labels; e.currentTarget.setAttribute('aria-pressed', layers.labels); updateLabels(); });
    $('mapSeasonToggle').addEventListener('click', () => setWholeSeason(!wholeSeason));
    // A window that changes size (dragged to the other monitor, made full screen) is fitted again, unless the grower has moved the view since.
    new ResizeObserver(() => { if (App.state.ready && App.state.view === 'map' && (!view.fitted || !view.moved)) fit(); if (App.state.ready) fitLegend(); }).observe(svg);
    $('legendMore').addEventListener('click', () => { legendOpen = !legendOpen; fitLegend(); });
    App.on('plan', () => { $('mapSample').hidden = !App.isSample(); });
    App.on('plan', build);
    App.on('date', () => { if (!wholeSeason) paint(); });   // the whole season does not depend on the day
    // what the series tool would plant is marked while it is open; drawn when the map is next looked at, if it is not on the page now
    let ghostsStale = false;
    App.on('ghost', () => { if (App.state.view !== 'map') { ghostsStale = true; return; } if (!wholeSeason) paint(); });
    App.on('view', () => { if (App.state.view === 'map' && ghostsStale) { ghostsStale = false; if (!wholeSeason) paint(); } });
    App.on('sel', () => { paint(); const sel = App.state.sel; if (sel && App.state.view === 'map') { const p = sel.type === 'planting' ? App.state.engine.planting(sel.id) : null; focusBed(p ? p.bedId : sel.type === 'opening' ? sel.bedId : sel.id); } });
    App.on('view', () => { if (App.state.view === 'map' && !view.fitted) requestAnimationFrame(() => fit()); });
  }

  // ── what the layout editor borrows ──
  /** A space as plain geometry: centre, turn and drawn size in map pixels (see mapgeo.js). */
  const shapeOf = id => { const item = beds.get(id); return item ? { id, x: item.geo.x, y: item.geo.y, rot: item.geo.rot, W: item.geo.W, L: item.geo.L, round: item.geo.shape === 'circle', placed: item.geo.placed } : null; };
  const toWorld = (cx, cy) => { const rect = $('map').getBoundingClientRect(); return [(cx - rect.left - view.x) / view.z, (cy - rect.top - view.y) / view.z]; };
  /** A map point on the page, measured from the map's own top left corner. */
  const toScreen = (x, y) => [x * view.z + view.x, y * view.z + view.y];
  function lock(on) { locked = !!on; hideTip(); $('map').classList.toggle('locked', locked); }

  root.LRFMap = { init, targetAt, showDrop, fit, fitGarden, wholeSeason: on => { if (on !== undefined) setWholeSeason(on); return wholeSeason; }, seasonOf,
    lock, watch: fn => { watchers.push(fn); }, shapeOf, spaces: () => [...beds.keys()], element: id => (beds.get(id) || {}).g || null, toWorld, toScreen, nearest, fitSpaces,
    zoom: () => view.z, feetPerPx: () => feetPerPx, seatsOf: bedId => { const item = beds.get(bedId); return item && item.geo.cells ? seatsOf(item.bed, item.geo.cells.count) : new Map(); },
    cellsOf: bedId => { const item = beds.get(bedId); return item ? item.geo.cells : null; } };
})(window);
