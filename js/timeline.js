/* Little River Farm Planner — the season timeline.
 *
 * One row per growing space, one bar per planting: a thin lead-in for nursery
 * time, a lighter stretch while the crop grows, the full colour while it is
 * harvested, and a hatched tail for turnover. A drop on a row plants on the
 * date under the pointer; dragging a bar reschedules or moves it.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine;
  const { h, clear, day, span } = UI;
  const $ = id => document.getElementById(id);
  const LABEL_W = 148, LANE_H = 22;
  let pxPerDay = 3.2, collapsed = new Set(), dirty = true, showOpen = true;
  // where whole beds stand open, worked out once per plan state
  const openCache = new WeakMap();
  function openingsBy(eng) {
    if (openCache.has(eng)) return openCache.get(eng);
    const map = new Map();
    if (root.LRFSuccession) for (const o of root.LRFSuccession.openings(eng)) { if (!o.whole) continue; if (!map.has(o.bed.id)) map.set(o.bed.id, []); map.get(o.bed.id).push(o); }
    openCache.set(eng, map);
    return map;
  }

  // An opening's label is never cut off: the words in full where the box is wide enough for them, "26 d" where it is not,
  // nothing where even that will not fit. The detail is always on hover. Widths are measured in the label's own typeface.
  let ruler = null, ruled = '';
  function textWidth(text) {
    if (!ruler) ruler = document.createElement('canvas').getContext('2d');
    if (!ruled) { const probe = h('div.tl-open', { style: { visibility: 'hidden' } }); $('tlBody').append(probe); const cs = getComputedStyle(probe); ruled = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; probe.remove(); }
    ruler.font = ruled;
    return ruler.measureText(text).width;
  }
  // A bar says what crop it is before it says which variety: "Carrot · Early Orange". Where that will not fit, the
  // variety gives way first, then anything in brackets after the crop's name; the crop's name itself is the last thing to go.
  // A small photo leads the bar where there is one and room for it. Nothing is ever cut off: the hover has it all.
  let barFont = '';
  function barWidth(text) {
    if (!ruler) ruler = document.createElement('canvas').getContext('2d');
    if (!barFont) { const probe = h('div.tl-bar', { style: { visibility: 'hidden' } }, h('span.tl-name', 'x')); $('tlBody').append(probe); const cs = getComputedStyle(probe.firstChild); barFont = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; probe.remove(); }
    ruler.font = barFont;
    return ruler.measureText(text).width;
  }
  const BAR_PAD = 11, ICON = 14, ICON_ROOM = ICON + 4;
  const plainCrop = name => String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(name || '');
  function barLabel(r, width, icon) {
    const crop = r.c.name || '', variety = r.c.vname || '', short = plainCrop(crop);
    const tries = [...new Set(variety ? [`${crop} · ${variety}`, `${short} · ${variety}`, crop, short] : [crop, short])];
    for (const withIcon of icon ? [true, false] : [false]) {
      const room = width - BAR_PAD - (withIcon ? ICON_ROOM : 0);
      const text = tries.find(t => barWidth(t) <= room);
      if (text) return { text, icon: withIcon };
    }
    return { text: '', icon: icon && width >= ICON + 2 };
  }

  const OPEN_PAD = 17;   // the box's own padding and border, and a little air
  function openLabel(days, width) {
    const full = `${UI.num(days)} days open`, short = `${UI.num(days)} d`;
    return textWidth(full) + OPEN_PAD <= width ? full : textWidth(short) + OPEN_PAD <= width ? short : '';
  }

  const yearStart = () => new Date(App.planYear(), 0, 1);
  const yearEnd = () => new Date(App.planYear(), 11, 31);
  const yearDays = () => E.dayDiff(yearEnd(), yearStart()) + 1;
  const xOf = d => E.dayDiff(d, yearStart()) * pxPerDay;
  const clampDay = d => d < yearStart() ? yearStart() : d > yearEnd() ? yearEnd() : d;

  function bar(p, r, lane, tray) {
    const eng = App.state.engine, color = eng.cropColor(r.c);
    const through = eng.occupancyThrough(p, r), end = clampDay(through === Infinity ? yearEnd() : through), from = clampDay(eng.occupancyFrom(p, r));
    if (end < yearStart() || from > yearEnd()) return null;
    const left = xOf(from), width = Math.max(4, xOf(E.addDays(end, 1)) - left);
    const seg = (cls, a, b) => { a = clampDay(a); b = clampDay(b); return b < a ? null : h('i.' + cls, { style: { left: (xOf(a) - left) + 'px', width: Math.max(1, xOf(E.addDays(b, 1)) - xOf(a)) + 'px' } }); };
    const sel = App.state.sel && App.state.sel.type === 'planting' && App.state.sel.id === p.id;
    // a tray batch is named by its row and shows its trays; every other bar names its crop, then its variety
    const T = root.LRFThumbs, pictured = !tray && (p.varietyId && T.has(p.varietyId) ? { varietyId: p.varietyId } : T.cropHas(p.cropId) ? { cropId: p.cropId } : null);
    const label = tray ? { text: UI.num(r.len), icon: false } : barLabel(r, width, !!pictured);
    const name = h('span.tl-name' + (label.icon ? '.pic' : ''), label.icon ? T.el({ ...pictured, color, label: r.c.name, size: ICON }) : null, label.text);
    const el = h('div.tl-bar' + (sel ? '.sel' : ''), {
      style: { left: left + 'px', width: width + 'px', top: (lane * LANE_H + 3) + 'px', '--crop': color, color: UI.inkOn(color) },
      dataset: { planting: p.id }, title: tray ? `${root.LRFTrays.short(r.c.name)} · ${UI.num(r.len)} tray${r.len === 1 ? '' : 's'} · sow ${day(r.field)} · ready ${day(r.first)}` : `${App.cropLabel(p)} · in ${day(r.field)} · harvest ${span(r.first, r.last)}`
    },
      seg('ph-grow', r.field, E.addDays(r.first, -1)),
      r.last >= r.first ? seg('ph-pick', r.first, r.last) : null,
      through !== Infinity && through > r.last ? seg('ph-turn', E.addDays(r.last < r.field ? r.field : r.last, 1), through) : null,
      name);
    // Nursery time happens off the bed, so it is a lead-in line rather than part of the bar.
    if (r.sow && r.sow < r.field) {
      const a = clampDay(r.sow);
      el.append(h('i.ph-nursery', { style: { left: (xOf(a) - left) + 'px', width: Math.max(0, left - xOf(a)) + 'px' }, title: `Sow ${day(r.sow)}` }));
    }
    return el;
  }

  /** Stack plantings that share a bed at the same time into lanes. */
  function lanesFor(items) {
    const ends = [];
    for (const item of items.sort((a, b) => a.from - b.from)) {
      let lane = ends.findIndex(end => end < item.from);
      if (lane < 0) { lane = ends.length; ends.push(0); }
      ends[lane] = item.to; item.lane = lane;
    }
    return Math.max(1, ends.length);
  }

  function render() {
    if (!App.state.ready || App.state.view !== 'timeline') { dirty = true; return; }
    dirty = false;
    const eng = App.state.engine, plan = App.state.plan, year = App.planYear(), width = yearDays() * pxPerDay;
    const head = clear($('tlMonths')), body = clear($('tlBody')), open = showOpen ? openingsBy(eng) : new Map();
    head.style.width = width + 'px';
    for (let m = 0; m < 12; m++) {
      const a = new Date(year, m, 1), b = new Date(year, m + 1, 0);
      head.append(h('div.tl-month', { style: { left: xOf(a) + 'px', width: (xOf(E.addDays(b, 1)) - xOf(a)) + 'px' } }, UI.MONTHS[m]));
    }
    const grid = clear($('tlGrid'));
    Object.assign(grid.style, { left: LABEL_W + 'px', width: width + 'px' });
    for (let m = 0; m < 12; m++) grid.append(h('i', { style: { left: xOf(new Date(year, m, 1)) + 'px' } }));
    const gardens = [...plan.gardens].filter(g => g.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
    for (const garden of gardens) {
      const spaces = plan.beds.filter(b => b.gardenId === garden.id && b.active !== false).sort((a, b) => String(a.bed).localeCompare(String(b.bed), undefined, { numeric: true }));
      if (!spaces.length) continue;
      const closed = collapsed.has(garden.id), count = spaces.reduce((n, b) => n + eng.plantingsIn(b.id).length, 0);
      body.append(h('div.tl-group', { style: { width: (LABEL_W + width) + 'px' } },
        h('button.tl-group-name', { type: 'button', 'aria-expanded': String(!closed), onclick: () => { closed ? collapsed.delete(garden.id) : collapsed.add(garden.id); render(); } },
          h('span.caret', closed ? '▸' : '▾'), garden.name, h('small', spaces.every(b => eng.isPool(b)) ? `live trays · ${count} batch${count === 1 ? '' : 'es'}` : `${spaces.length} space${spaces.length === 1 ? '' : 's'} · ${count} planting${count === 1 ? '' : 's'}`))));
      if (closed) continue;
      for (const bed of spaces) {
        const items = eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).map(x => {
          const through = eng.occupancyThrough(x.p, x.r);
          return { ...x, from: +eng.occupancyFrom(x.p, x.r), to: through === Infinity ? Infinity : +through };
        });
        if (eng.isPool(bed)) {
          // The shared benches are not one place, so weekly tray batches get a row per crop: each bar is a batch from sowing to ready, labelled with its trays.
          const byCrop = new Map();
          for (const item of items) { const list = byCrop.get(item.p.cropId) || []; list.push(item); byCrop.set(item.p.cropId, list); }
          const names = [...byCrop.keys()].sort((a, b) => root.LRFTrays.short((eng.crop(a) || {}).name).localeCompare(root.LRFTrays.short((eng.crop(b) || {}).name)));
          for (const cropId of names) {
            const list = byCrop.get(cropId), lanes = lanesFor(list), lane = h('div.tl-lane', { style: { width: width + 'px', height: (lanes * LANE_H + 6) + 'px' } });
            for (const item of list) { const el = bar(item.p, item.r, item.lane, true); if (el) lane.append(el); }
            const trays = list.reduce((n, x) => n + x.r.len, 0);
            body.append(h('div.tl-row.tl-pool', { dataset: { bed: bed.id, pool: cropId }, title: 'Planned from weekly demand on the Trays view' },
              h('div.tl-label', { style: { width: LABEL_W + 'px' } }, h('b', root.LRFTrays.short((eng.crop(cropId) || {}).name) || 'Trays'), h('small', `${UI.num(trays)} trays`)), lane));
          }
          if (!names.length) body.append(h('div.tl-row.tl-pool', { dataset: { bed: bed.id, pool: '' } }, h('div.tl-label', { style: { width: LABEL_W + 'px' } }, h('b', 'Live trays'), h('small', 'no weekly demand yet')), h('div.tl-lane', { style: { width: width + 'px', height: (LANE_H + 6) + 'px' } })));
          continue;
        }
        const lanes = lanesFor(items), lane = h('div.tl-lane', { style: { width: width + 'px', height: (lanes * LANE_H + 6) + 'px' } });
        // an opening is drawn under the bars: ground free before, after or between what is planned
        for (const o of open.get(bed.id) || []) {
          const left = xOf(o.from), w = xOf(E.addDays(o.to, 1)) - left, next = o.before ? `before the ${o.before.r.c.name.toLowerCase()}` : o.after ? `after the ${o.after.r.c.name.toLowerCase()}` : 'open';
          const box = Math.max(6, w - 1), label = openLabel(o.days, box);
          lane.append(h('div.tl-open' + (label ? '' : '.bare'), { style: { left: left + 'px', width: box + 'px' }, dataset: { opening: o.id }, title: `Open ${span(o.from, o.to)}: ${UI.num(o.days)} days ${next}. Click to see what fits.`, 'aria-label': `${UI.num(o.days)} days open, ${span(o.from, o.to)}` }, label));
        }
        for (const item of items) { const el = bar(item.p, item.r, item.lane); if (el) lane.append(el); }
        const selBed = App.state.sel && App.state.sel.type === 'bed' && App.state.sel.id === bed.id;
        body.append(h('div.tl-row' + (selBed ? '.sel' : ''), { dataset: { bed: bed.id } },
          h('div.tl-label', { style: { width: LABEL_W + 'px' } }, h('b', (eng.isTower(bed) ? 'Tower ' : '') + bed.bed),
            h('small', eng.isSoilBed(bed) ? `${UI.num(bed.l, 1)} ft` : `${UI.num(eng.capOf(bed))} ${eng.capUnit(bed)}`)), lane));
      }
    }
    $('tlInner').style.width = (LABEL_W + width) + 'px';
    cursor();
  }
  function cursor() {
    if (!App.state.ready) return;
    const el = $('tlCursor');
    el.style.left = (LABEL_W + xOf(App.state.date) + pxPerDay / 2) + 'px';
    el.dataset.label = UI.day(App.state.date);
  }

  /** Bed and date under a screen point. */
  function targetAt(cx, cy, grabDays = 0) {
    const scroll = $('tlScroll').getBoundingClientRect();
    if (cx < scroll.left || cx > scroll.right || cy < scroll.top || cy > scroll.bottom) return null;
    const el = document.elementFromPoint(cx, cy), row = el && el.closest && el.closest('.tl-row');
    if (!row) return null;
    const lane = row.querySelector('.tl-lane').getBoundingClientRect(), dayIndex = Math.floor((cx - lane.left) / pxPerDay) - grabDays;
    if (dayIndex < 0 || dayIndex >= yearDays()) return null;
    return { bedId: row.dataset.bed, date: E.addDays(yearStart(), dayIndex) };
  }
  function showDrop(target) {
    for (const row of document.querySelectorAll('.tl-row.drop-target')) row.classList.remove('drop-target');
    const ghost = $('tlGhost');
    if (!target) { ghost.hidden = true; return; }
    const row = document.querySelector(`.tl-row[data-bed="${CSS.escape(target.bedId)}"]`);
    if (!row) { ghost.hidden = true; return; }
    row.classList.add('drop-target');
    const res = target.preview, inner = $('tlInner').getBoundingClientRect(), box = row.getBoundingClientRect();
    if (!res || !res.r || !res.from) { ghost.hidden = true; return; }
    const end = res.through === Infinity ? yearEnd() : clampDay(res.through);
    ghost.hidden = false; ghost.dataset.state = res.state;
    Object.assign(ghost.style, { left: (LABEL_W + xOf(clampDay(res.from))) + 'px', width: Math.max(6, xOf(E.addDays(end, 1)) - xOf(clampDay(res.from))) + 'px', top: (box.top - inner.top + 3) + 'px', height: (box.height - 7) + 'px' });
  }

  function init() {
    const scroll = $('tlScroll');
    let press = null;
    scroll.addEventListener('pointerdown', e => {
      const barEl = e.target.closest('.tl-bar');
      press = { x: e.clientX, y: e.clientY, barEl, pointerType: e.pointerType };
      if (barEl && e.pointerType !== 'touch' && e.button === 0) {
        const p = App.state.engine.planting(barEl.dataset.planting), r = p && App.state.engine.calc(p);
        if (!r) return;
        const lane = barEl.parentElement.getBoundingClientRect(), grabDays = Math.floor((e.clientX - lane.left) / pxPerDay) - E.dayDiff(r.field, yearStart());
        root.LRFDrag.watch(e, { payload: { plantingId: p.id }, label: App.cropLabel(p), color: App.state.engine.cropColor(r.c), grabDays });
      }
    });
    scroll.addEventListener('click', e => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) return;
      const barEl = e.target.closest('.tl-bar'), row = e.target.closest('.tl-row');
      if (barEl) { App.select({ type: 'planting', id: barEl.dataset.planting }); return; }
      if (!row) return;
      if (row.dataset.pool !== undefined) { App.setView('trays'); return; }
      const at = targetAt(e.clientX, e.clientY);
      if (App.state.armed && at) { App.place(App.state.armed, at.bedId, at.date); return; }
      const openEl = e.target.closest('.tl-open');
      if (openEl) { App.openAhead({ mode: 'openings', bedId: row.dataset.bed, openingId: openEl.dataset.opening }); return; }
      App.select({ type: 'bed', id: row.dataset.bed });
      if (at && e.target.closest('.tl-lane')) App.setDate(at.date);
    });
    $('tlMonths').addEventListener('click', e => {
      const box = $('tlMonths').getBoundingClientRect(), index = Math.floor((e.clientX - box.left) / pxPerDay);
      if (index >= 0 && index < yearDays()) App.setDate(E.addDays(yearStart(), index));
    });
    for (const button of document.querySelectorAll('[data-tl-zoom]')) {
      button.addEventListener('click', () => {
        pxPerDay = +button.dataset.tlZoom;
        for (const other of document.querySelectorAll('[data-tl-zoom]')) other.setAttribute('aria-pressed', String(other === button));
        render();
      });
    }
    const toggle = $('tlOpenToggle');
    if (toggle) toggle.addEventListener('click', () => { showOpen = !showOpen; toggle.setAttribute('aria-pressed', String(showOpen)); render(); });
    App.on('plan', render);
    App.on('sel', render);
    App.on('date', cursor);
    // the typefaces arrive after the first draw: measure again in the real one
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { ruled = ''; barFont = ''; if (App.state.view === 'timeline') render(); else dirty = true; }).catch(() => {});
    App.on('view', () => { if (App.state.view === 'timeline' && dirty) render(); if (App.state.view === 'timeline') requestAnimationFrame(() => { const x = LABEL_W + xOf(App.state.date) - scroll.clientWidth / 2; if (scroll.scrollLeft === 0 && x > 0) scroll.scrollLeft = Math.max(0, x - 80); }); });
  }

  root.LRFTimeline = { init, targetAt, showDrop };
})(window);
