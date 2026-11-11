/* Little River Farm Planner — the season timeline.
 *
 * One row per growing space, one bar per planting: a thin lead-in for nursery
 * time, a lighter stretch while the crop grows, the full colour while it is
 * harvested, and a hatched tail for turnover. A drop on a row plants on the
 * date under the pointer; dragging a bar reschedules or moves it.
 *
 * What is shown is chosen at the top: everything, or only the field, the houses
 * and tunnels, the towers or the crates. The crowded kinds are drawn as a summary
 * that opens: a bank of towers is one row until it is opened to single towers, a
 * crate space is one row per crop until a crop is opened to its plantings, and
 * live trays are one strip of trays standing each week.
 *
 * The scale is continuous, set by the buttons above the chart (or Ctrl and the
 * wheel); the plain wheel scrolls the rows. Every position is a day count multiplied by one
 * number (--ppd, pixels per day) in the style sheet, so zooming changes that
 * number and nothing is drawn again; only the labels are fitted again, by
 * measured width, so none is ever cut off.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine;
  const { h, clear, day, span, num } = UI;
  const $ = id => document.getElementById(id);
  const LABEL_W = 148, LANE_H = 22, MAX_PPD = 48, WEEKS_AT = 4.5, DAYS_AT = 16, CROWDED = 6;
  const PREF_KEY = 'lrf-next:timeline';
  const FILTERS = [['all', 'All'], ['field', 'Field'], ['cover', 'Greenhouses and tunnels'], ['tower', 'Towers'], ['crate', 'Crates']];
  const SECTIONS = ['field', 'cover', 'tower', 'crate', 'trays'];
  const SECTION_NAME = { field: 'Field', cover: 'Greenhouses and tunnels', tower: 'Towers', crate: 'Crates and pots', trays: 'Live trays' };
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;

  // ── what this browser remembers about the timeline: the filter, the scale, what is opened or shut ──
  const prefs = { filter: 'all', ppd: 0, open: {}, shut: {}, openings: true };
  function loadPrefs() {
    try {
      const kept = JSON.parse(root.localStorage.getItem(PREF_KEY) || 'null');
      if (!kept || typeof kept !== 'object') return;
      if (FILTERS.some(f => f[0] === kept.filter)) prefs.filter = kept.filter;
      if (kept.ppd > 0 && kept.ppd <= MAX_PPD) prefs.ppd = +kept.ppd;
      for (const key of ['open', 'shut']) if (kept[key] && typeof kept[key] === 'object') prefs[key] = Object.fromEntries(Object.entries(kept[key]).filter(([, v]) => v === true));
      prefs.openings = kept.openings !== false;
    } catch (_) { /* nothing remembered: the defaults stand */ }
  }
  let saveTimer = 0;
  function writePrefs() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = 0;
    try { root.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* a browser that keeps nothing still works */ }
  }
  /** Written a moment after the last change, so a run of the wheel is one write; and at once if the page is being left. */
  function savePrefs() { clearTimeout(saveTimer); saveTimer = setTimeout(writePrefs, 250); }
  root.addEventListener('pagehide', writePrefs);

  // ── the scale ──
  let ppd = 3.2, atFit = true, sized = false, dirty = true, headYear = 0, held = null;
  const yearStart = () => new Date(App.planYear(), 0, 1);
  const yearEnd = () => new Date(App.planYear(), 11, 31);
  const yearDays = () => E.dayDiff(yearEnd(), yearStart()) + 1;
  const idx = d => E.dayDiff(d, yearStart());
  const xOf = d => idx(d) * ppd;
  const clampDay = d => d < yearStart() ? yearStart() : d > yearEnd() ? yearEnd() : d;
  const laneRoom = () => Math.max(120, $('tlScroll').clientWidth - LABEL_W);
  /** The smallest scale: the whole year across the room there is. The plan is locked to its year, so there is nothing further out to see. */
  const fitPpd = () => laneRoom() / yearDays();
  const tierOf = v => v >= DAYS_AT ? 'days' : v >= WEEKS_AT ? 'weeks' : 'months';
  const at = (a, n) => n == null ? { '--a': a } : { '--a': a, '--n': n };

  // where whole beds stand open, worked out once per plan state
  const openCache = new WeakMap();
  function openingsBy(eng) {
    if (openCache.has(eng)) return openCache.get(eng);
    const map = new Map();
    if (root.LRFSuccession) for (const o of root.LRFSuccession.openings(eng)) { if (!o.whole) continue; if (!map.has(o.bed.id)) map.set(o.bed.id, []); map.get(o.bed.id).push(o); }
    openCache.set(eng, map);
    return map;
  }

  // ── labels: measured in their own typeface, each text once ──
  let ruler = null;
  const fonts = {}, widths = new Map();
  function measure(kind, text) {
    const key = kind + '\n' + text;
    let w = widths.get(key);
    if (w !== undefined) return w;
    if (!ruler) ruler = document.createElement('canvas').getContext('2d');
    if (!fonts[kind]) {
      const probe = kind === 'open' ? h('div.tl-open', { style: { visibility: 'hidden' } }) : kind === 'cell' ? h('div.tl-cell', { style: { visibility: 'hidden' } }, 'x') : kind === 'tray' ? h('div.tl-row.tl-pool', { style: { visibility: 'hidden' } }, h('div.tl-bar', h('span.tl-name', 'x'))) : h('div.tl-bar', { style: { visibility: 'hidden' } }, h('span.tl-name', 'x'));
      $('tlBody').append(probe);
      const cs = getComputedStyle(kind === 'bar' ? probe.firstChild : kind === 'tray' ? probe.querySelector('.tl-name') : probe);
      fonts[kind] = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      probe.remove();
    }
    ruler.font = fonts[kind];
    w = ruler.measureText(text).width;
    widths.set(key, w);
    return w;
  }
  const forgetFonts = () => { for (const key of Object.keys(fonts)) delete fonts[key]; widths.clear(); };
  // A bar says what crop it is before it says which variety: "Carrot · Early Orange". Where that will not fit, the
  // variety gives way first, then anything in brackets after the crop's name; the crop's name itself is the last thing to go.
  // A small photo leads the bar where there is one and room for it. Nothing is ever cut off: the hover has it all.
  const BAR_PAD = 11, ICON = 14, ICON_ROOM = ICON + 4, OPEN_PAD = 17, CELL_PAD = 5;
  const plainCrop = name => String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(name || '');
  function namesOf(c, tail) {
    const crop = c.name || '', variety = c.vname || '', short = plainCrop(crop), end = tail ? ' ' + tail : '';
    return [...new Set(variety ? [`${crop} · ${variety}${end}`, `${short} · ${variety}${end}`, crop + end, short + end, tail || ''] : [crop + end, short + end, tail || ''])].filter(Boolean);
  }
  function pickLabel(kind, tries, width, icon) {
    for (const withIcon of icon ? [true, false] : [false]) {
      const room = width - BAR_PAD - (withIcon ? ICON_ROOM : 0);
      const text = tries.find(t => measure(kind, t) <= room);
      if (text) return { text, icon: withIcon };
    }
    return { text: '', icon: icon && width >= ICON + 2 };
  }
  // everything whose words depend on the scale, fitted again whenever it changes
  let fitList = [];
  const sums = new Map();   // planting id → the summary bar that holds it
  function refit() { for (const fit of fitList) fit(); }

  /**
   * One bar. `x` gives the days it stands (from, to), its stretches (field, first, last, through, sow), its colour,
   * the words to try in order, a picture if it has one, and what it is: a planting, or a summary of several.
   */
  function barEl(x) {
    const from = clampDay(x.from), to = clampDay(x.to);
    if (to < yearStart() || from > yearEnd()) return null;
    const a = idx(from), n = idx(to) - a + 1;
    const seg = (cls, s, e) => { s = clampDay(s); e = clampDay(e); return e < s ? null : h('i.' + cls, { style: at(idx(s) - a, idx(e) - idx(s) + 1) }); };
    const T = root.LRFThumbs, icon = x.pictured ? T.el({ ...x.pictured, color: x.color, label: x.alt || '', size: ICON }) : null, text = document.createTextNode('');
    const name = h('span.tl-name', icon, text);
    const el = h('div.tl-bar' + (x.cls || ''), { style: { ...at(a, n), top: (x.lane * LANE_H + 3) + 'px', '--crop': x.color, color: UI.inkOn(x.color) }, dataset: x.dataset || {}, title: x.title || '' },
      seg('ph-grow', x.field, E.addDays(x.first, -1)),
      x.last >= x.first ? seg('ph-pick', x.first, x.last) : null,
      x.through !== Infinity && x.through > x.last ? seg('ph-turn', E.addDays(x.last < x.field ? x.field : x.last, 1), x.through) : null,
      name);
    // Nursery time happens off the bed, so it is a lead-in line rather than part of the bar.
    if (x.sow && x.sow < x.field) { const s = clampDay(x.sow), lead = a - idx(s); if (lead > 0) el.append(h('i.ph-nursery', { style: at(-lead, lead), title: `Sow ${day(x.sow)}` })); }
    let shown = null;
    fitList.push(() => {
      const label = x.fixed != null ? { text: measure(x.kind || 'bar', x.fixed) <= Math.max(4, n * ppd) - BAR_PAD ? x.fixed : '', icon: false } : pickLabel(x.kind || 'bar', x.tries, Math.max(4, n * ppd), !!icon);
      if (shown && shown.text === label.text && shown.icon === label.icon) return;
      shown = label; text.data = label.text;
      if (icon) icon.hidden = !label.icon;
      name.classList.toggle('pic', label.icon);
    });
    return el;
  }
  const pictureOf = p => { const T = root.LRFThumbs; return p.varietyId && T.has(p.varietyId) ? { varietyId: p.varietyId } : T.cropHas(p.cropId) ? { cropId: p.cropId } : null; };
  function plantingBar(item, lane, tray) {
    const { p, r } = item, eng = App.state.engine, through = eng.occupancyThrough(p, r);
    const sel = App.state.sel && App.state.sel.type === 'planting' && App.state.sel.id === p.id;
    // a tray batch is named by its row and shows its trays; every other bar names its crop, then its variety
    return barEl({ from: eng.occupancyFrom(p, r), to: through === Infinity ? yearEnd() : through, through, field: r.field, first: r.first, last: r.last, sow: r.sow, lane, color: eng.cropColor(r.c),
      cls: sel ? '.sel' : '', dataset: { planting: p.id }, kind: tray ? 'tray' : 'bar', fixed: tray ? num(r.len) : null, tries: tray ? null : namesOf(r.c), pictured: tray ? null : pictureOf(p), alt: r.c.name,
      title: tray ? `${root.LRFTrays.short(r.c.name)} · ${num(r.len)} tray${r.len === 1 ? '' : 's'} · sow ${day(r.field)} · ready ${day(r.first)}` : `${App.cropLabel(p)} · in ${day(r.field)} · harvest ${span(r.first, r.last)}` });
  }
  /** Several plantings drawn as one bar: the same crop going in on the same day. It is not dragged; a click opens it to its plantings. */
  function summaryBar(g, lane, words) {
    const eng = App.state.engine, items = g.list, first = items[0], min = f => new Date(Math.min(...items.map(f))), max = f => new Date(Math.max(...items.map(f)));
    const endless = items.some(x => x.to === Infinity), through = endless ? Infinity : max(x => x.to), sows = items.filter(x => x.r.sow).map(x => +x.r.sow);
    const holdsSel = App.state.sel && App.state.sel.type === 'planting' && items.some(x => x.p.id === App.state.sel.id);
    const el = barEl({ from: new Date(g.from), to: endless ? yearEnd() : through, through, field: min(x => +x.r.field), first: min(x => +x.r.first), last: max(x => +x.r.last), sow: sows.length ? new Date(Math.min(...sows)) : null,
      lane, color: eng.cropColor(first.r.c), cls: '.tl-sum' + (holdsSel ? '.sel' : ''), dataset: { sum: g.key, first: first.p.id }, tries: words.tries, pictured: words.pictured, alt: first.r.c.name, title: words.title });
    if (el) for (const x of items) sums.set(x.p.id, el);
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
  const itemsOf = (eng, bed) => eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).map(x => {
    const through = eng.occupancyThrough(x.p, x.r);
    return { ...x, bed, from: +eng.occupancyFrom(x.p, x.r), to: through === Infinity ? Infinity : +through };
  });
  const laneEl = lanes => h('div.tl-lane', { style: { height: (lanes * LANE_H + 6) + 'px' } });
  /** A row off the page is not drawn until it is scrolled to. It is given its height here so the page is as tall either way. */
  const rowEl = (spec, attrs, label, lane, two) => h(spec, { ...attrs, style: { containIntrinsicBlockSize: `auto ${Math.max(two ? 37 : 29, parseFloat(lane.style.height) + 1)}px` } }, label, lane);

  /** Which part of the farm a space belongs to, for the filters. A garden with towers and beds shows under both. */
  function sectionOf(eng, bed, garden) {
    if (eng.isPool(bed)) return 'trays';
    if (eng.isTower(bed)) return 'tower';
    if (eng.isCt(bed)) return 'crate';
    return eng.isSoilBed(bed) && garden.type === 'field' ? 'field' : 'cover';
  }

  // ── the head: months, then weeks or days where there is room for their numbers ──
  function drawHead() {
    const year = App.planYear(), days = yearDays(), inner = $('tlInner');
    inner.style.setProperty('--days', days);
    if (headYear === year) return;
    headYear = year;
    const months = clear($('tlMonths'));
    for (let m = 0; m < 12; m++) {
      const a = idx(new Date(year, m, 1)), n = idx(new Date(year, m + 1, 0)) - a + 1;
      months.append(h('div.tl-month', { style: at(a, n) }, h('span', h('b.short', UI.MONTHS[m]), h('b.full', `${new Date(year, m, 1).toLocaleString('en-US', { month: 'long' })} ${year}`))));
    }
    ruled = '';
  }
  /**
   * The numbers under the months and the rules down the chart, for the scale in use: Mondays once a week has room for
   * a number, every day once a day has. Only what shows is on the page, so the wide scales stay light to draw.
   */
  let ruled = '';
  function drawRules(tier, weekNumbers) {
    const mode = `${App.planYear()}|${tier}|${weekNumbers}`;
    if (mode === ruled) return;
    ruled = mode;
    const year = App.planYear(), days = yearDays(), ticks = clear($('tlTicks')), grid = clear($('tlGrid'));
    for (let m = 0; m < 12; m++) grid.append(h('i.g-month', { style: at(idx(new Date(year, m, 1))) }));
    if (tier === 'months' && !weekNumbers) return;
    // At the days scale there are a year of numbers and rules, most of them off the page: they are kept a month to a box,
    // and a month off the page is not drawn. (A number fits inside its own day there, so a box never cuts one off.)
    let tickBox = ticks, gridBox = grid, boxStart = 0;
    for (let i = 0; i < days; i++) {
      const d = E.addDays(yearStart(), i), monday = d.getDay() === 1;
      if (tier === 'days' && d.getDate() === 1) {
        const n = idx(new Date(year, d.getMonth() + 1, 0)) - i + 1;
        boxStart = i; tickBox = h('div.tk-m', { style: at(i, n) }); gridBox = h('div.g-m', { style: at(i, n) });
        ticks.append(tickBox); grid.append(gridBox);
      }
      if (!monday && tier !== 'days') continue;
      tickBox.append(h('i.tk' + (monday ? '.mon' : ''), { style: at(i - boxStart) }, String(d.getDate())));
      if (d.getDate() !== 1 && tier !== 'months') gridBox.append(h('i.' + (monday ? 'g-week' : 'g-day'), { style: at(i - boxStart) }));
    }
  }
  function drawFilters(counts) {
    const host = clear($('tlFilters'));
    for (const [id, name] of FILTERS) host.append(h('button', { type: 'button', dataset: { tlFilter: id }, 'aria-pressed': String(prefs.filter === id), title: id === 'all' ? 'Every growing space' : `Only ${SECTION_NAME[id].toLowerCase()}`, onclick: () => setFilter(id) }, name, h('small', num(counts[id] || 0))));
  }

  // ── rows ──
  function groupHead(name, small, expanded, toggle, title) {
    return h('div.tl-group', h('button.tl-group-name', { type: 'button', 'aria-expanded': String(expanded), title: title || '', onclick: toggle }, h('span.caret', expanded ? '▾' : '▸'), name, h('small', small)));
  }
  const flip = (bag, key) => () => { if (bag[key]) delete bag[key]; else bag[key] = true; savePrefs(); render(); };
  function bedRow(body, eng, bed, items, open, label, small, extra) {
    const lanes = lanesFor(items), lane = laneEl(lanes), sel = App.state.sel;
    // an opening is drawn under the bars: ground free before, after or between what is planned
    for (const o of open || []) {
      const a = idx(o.from), n = idx(o.to) - a + 1, next = o.before ? `before the ${o.before.r.c.name.toLowerCase()}` : o.after ? `after the ${o.after.r.c.name.toLowerCase()}` : 'open';
      const full = `${num(o.days)} days open`, short = `${num(o.days)} d`, text = document.createTextNode('');
      const box = h('div.tl-open' + (sel && sel.type === 'opening' && sel.id === o.id ? '.sel' : ''), { style: at(a, n), dataset: { opening: o.id }, title: `Open ${span(o.from, o.to)}: ${num(o.days)} days ${next}. Click to see what fits.`, 'aria-label': `${num(o.days)} days open, ${span(o.from, o.to)}` }, h('span', text));
      // never cut off: the words in full where the box is wide enough, "26 d" where it is not, nothing where even that will not fit
      fitList.push(() => { const w = Math.max(6, n * ppd - 1), label = measure('open', full) + OPEN_PAD <= w ? full : measure('open', short) + OPEN_PAD <= w ? short : ''; if (text.data !== label) { text.data = label; box.classList.toggle('bare', !label); } });
      lane.append(box);
    }
    for (const item of items) { const el = plantingBar(item, item.lane); if (el) lane.append(el); }
    const selBed = sel && ((sel.type === 'bed' && sel.id === bed.id) || (sel.type === 'opening' && sel.bedId === bed.id));
    body.append(rowEl('div.tl-row' + (selBed ? '.sel' : '') + (extra && extra.cls || ''), { dataset: { bed: bed.id, ...(extra && extra.dataset || {}) } }, h('div.tl-label', label, small ? h('small', small) : null), lane, !!extra));
  }

  /** A bank of towers: one row, the towers that are planted alike drawn as one bar, until it is opened to single towers. */
  function bankRows(body, eng, group, key) {
    const { garden, spaces, count } = group, opened = !!prefs.open[key];
    body.append(groupHead(garden.name, `${plural(spaces.length, 'tower')}${opened ? '' : ' as one row'} · ${plural(count, 'planting')}`, opened, flip(prefs.open, key), opened ? 'Show the bank as one row' : 'Show every tower on a row of its own'));
    if (opened) { for (const bed of spaces) bedRow(body, eng, bed, itemsOf(eng, bed), null, h('b', 'Tower ' + bed.bed), `${num(eng.capOf(bed))} ${eng.capUnit(bed)}`); return; }
    const merged = new Map();
    for (const bed of spaces) for (const item of itemsOf(eng, bed)) {
      const k = [item.p.cropId, item.p.varietyId || '', item.from, item.to].join('|');
      if (!merged.has(k)) merged.set(k, { key: key + '|' + k, from: item.from, to: item.to, list: [] });
      merged.get(k).list.push(item);
    }
    const list = [...merged.values()], lanes = lanesFor(list), lane = laneEl(lanes);
    for (const g of list) {
      const c = g.list[0].r.c, n = g.list.length, towers = g.list.map(x => x.bed.bed).sort(natural);
      const el = summaryBar(g, g.lane, { tries: namesOf(c, `× ${num(n)}`), pictured: pictureOf(g.list[0].p),
        title: `${App.cropLabel(g.list[0].p)} · ${plural(n, 'tower')} (${towers.join(', ')}) · in ${day(g.list[0].r.field)} · harvest ${span(g.list[0].r.first, g.list[0].r.last)}. Click to open the bank.` });
      if (el) lane.append(el);
    }
    body.append(rowEl('div.tl-row.tl-bank', { dataset: { fold: key } }, h('div.tl-label', { title: 'Show every tower on a row of its own' }, h('b', 'All towers'), h('small', plural(spaces.reduce((s, b) => s + eng.capOf(b), 0), 'site'))), lane, true));
  }

  /** A space of crates with many plantings: one row per crop, a month's planting drawn as one bar, until the crop is opened. */
  function crateRows(body, eng, bed, items) {
    body.append(rowEl('div.tl-row.tl-space.tl-ct', { dataset: { bed: bed.id } }, h('div.tl-label', h('b', bed.bed), h('small', `${num(eng.capOf(bed))} ${eng.capUnit(bed)}`)), laneEl(0), true));
    const byCrop = new Map();
    for (const item of items) { if (!byCrop.has(item.p.cropId)) byCrop.set(item.p.cropId, []); byCrop.get(item.p.cropId).push(item); }
    const crops = [...byCrop.keys()].sort((a, b) => natural((eng.crop(a) || {}).name, (eng.crop(b) || {}).name));
    for (const cropId of crops) {
      const list = byCrop.get(cropId), key = `crop:${bed.id}:${cropId}`, opened = !!prefs.open[key], name = plainCrop((eng.crop(cropId) || {}).name) || 'Crop';
      const label = h('button.tl-fold', { type: 'button', 'aria-expanded': String(opened), title: opened ? 'Show each month’s planting as one bar' : 'Show every planting', onclick: flip(prefs.open, key) }, h('span.caret', opened ? '▾' : '▸'), h('b', name));
      if (opened) { bedRow(body, eng, bed, list, null, label, plural(list.length, 'planting'), { cls: '.tl-crop', dataset: { crop: cropId } }); continue; }
      const merged = new Map();
      for (const item of list) { const k = String(item.from); if (!merged.has(k)) merged.set(k, { key: key + '|' + k, from: item.from, to: 0, list: [] }); const g = merged.get(k); g.list.push(item); g.to = Math.max(g.to, item.to); }
      const groups = [...merged.values()], lanes = lanesFor(groups), lane = laneEl(lanes);
      for (const g of groups) {
        const n = g.list.length, holds = g.list.reduce((s, x) => s + (x.r.len || 0), 0), unit = eng.capUnit(bed) === 'containers' ? 'crate' : eng.capUnit(bed), varieties = new Set(g.list.map(x => x.r.c.vname).filter(Boolean));
        const el = n === 1 ? plantingBar(g.list[0], g.lane) : summaryBar(g, g.lane, { tries: [`${plural(n, 'planting')} · ${plural(holds, unit)}`, plural(n, 'planting'), `× ${num(n)}`], pictured: null,
          title: `${name} · ${plural(n, 'planting')} in ${plural(holds, unit)}${varieties.size ? ` · ${[...varieties].slice(0, 6).join(', ')}${varieties.size > 6 ? ` and ${num(varieties.size - 6)} more` : ''}` : ''} · in ${day(new Date(g.from))}. Click to open ${name.toLowerCase()} to its plantings.` });
        if (el) lane.append(el);
      }
      body.append(rowEl('div.tl-row.tl-crop', { dataset: { bed: bed.id, crop: cropId, fold: key } }, h('div.tl-label', label, h('small', plural(list.length, 'planting'))), lane, true));
    }
  }

  /** Live trays: one strip, the most trays standing in each week, until it is opened to a row per crop. */
  function trayRows(body, eng, group, key) {
    const { garden, spaces, count } = group, opened = !!prefs.open[key];
    body.append(groupHead(garden.name, `live trays · ${plural(count, 'batch', 'batches')}`, opened, flip(prefs.open, key), opened ? 'Show the trays as one strip' : 'Show a row for each tray crop'));
    for (const bed of spaces) {
      const items = itemsOf(eng, bed), days = yearDays(), load = new Float64Array(days), y0 = +yearStart(), y1 = +yearEnd();
      for (const item of items) { const a = Math.max(0, idx(new Date(Math.max(item.from, y0)))), b = Math.min(days - 1, idx(new Date(Math.min(item.to, y1)))); for (let i = a; i <= b; i++) load[i] += item.r.len || 0; }
      const lane = laneEl(1), peak = Math.max(0, ...load), crops = new Set(items.map(x => x.p.cropId)).size;
      for (let i = 0; i < days;) {
        // a week runs Monday to Sunday; the year's first and last weeks may be short
        let j = i; while (j + 1 < days && E.addDays(yearStart(), j + 1).getDay() !== 1) j++;
        let most = 0; for (let k = i; k <= j; k++) most = Math.max(most, load[k]);
        if (most > 0) {
          const text = document.createTextNode(''), words = num(most), n = j - i + 1;
          const cell = h('div.tl-cell', { style: { ...at(i, n), '--p': Math.round(14 + 46 * most / peak) + '%' }, title: `Week of ${day(E.addDays(yearStart(), i))}: up to ${plural(most, 'live tray')} on the benches` }, text);
          fitList.push(() => { const label = measure('cell', words) + CELL_PAD <= n * ppd - 1 ? words : ''; if (text.data !== label) text.data = label; });
          lane.append(cell);
        }
        i = j + 1;
      }
      body.append(rowEl('div.tl-row.tl-pool.tl-strip', { dataset: { bed: bed.id, pool: '' }, title: 'Trays standing on the benches each week. Planned from weekly demand on the Trays view.' },
        h('div.tl-label', h('b', 'Live trays'), h('small', items.length ? `${plural(crops, 'crop')} · most ${num(peak)} at once` : 'no weekly demand yet')), lane, true));
      if (!opened) continue;
      // the benches are not one place, so each tray crop gets a row: each bar is a batch from sowing to ready, labelled with its trays
      const byCrop = new Map();
      for (const item of items) { const list = byCrop.get(item.p.cropId) || []; list.push(item); byCrop.set(item.p.cropId, list); }
      const names = [...byCrop.keys()].sort((a, b) => root.LRFTrays.short((eng.crop(a) || {}).name).localeCompare(root.LRFTrays.short((eng.crop(b) || {}).name)));
      for (const cropId of names) {
        const list = byCrop.get(cropId), lanes = lanesFor(list), row = laneEl(lanes);
        for (const item of list) { const el = plantingBar(item, item.lane, true); if (el) row.append(el); }
        body.append(rowEl('div.tl-row.tl-pool', { dataset: { bed: bed.id, pool: cropId }, title: 'Planned from weekly demand on the Trays view' },
          h('div.tl-label', h('b', root.LRFTrays.short((eng.crop(cropId) || {}).name) || 'Trays'), h('small', `${num(list.reduce((n, x) => n + x.r.len, 0))} trays`)), row, true));
      }
    }
  }

  function render() {
    if (!App.state.ready || App.state.view !== 'timeline') { dirty = true; return; }
    dirty = false; fitList = []; sums.clear();
    const eng = App.state.engine, plan = App.state.plan, body = clear($('tlBody')), open = prefs.openings ? openingsBy(eng) : new Map();
    drawHead();
    const gardens = [...plan.gardens].filter(g => g.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
    const sections = new Map(SECTIONS.map(s => [s, []])), counts = { all: 0 };
    for (const garden of gardens) {
      const parts = new Map();
      for (const bed of plan.beds.filter(b => b.gardenId === garden.id && b.active !== false).sort((a, b) => natural(a.bed, b.bed))) { const s = sectionOf(eng, bed, garden); if (!parts.has(s)) parts.set(s, []); parts.get(s).push(bed); }
      for (const [s, spaces] of parts) {
        const count = spaces.reduce((n, b) => n + eng.plantingsIn(b.id).length, 0);
        counts[s] = (counts[s] || 0) + count; counts.all += count;
        sections.get(s).push({ garden, spaces, count });
      }
    }
    drawFilters(counts);
    const all = prefs.filter === 'all';
    for (const s of all ? SECTIONS : [prefs.filter]) {
      const groups = sections.get(s);
      if (!groups.length) continue;
      if (all) body.append(h('div.tl-section', { dataset: { section: s } }, h('span', SECTION_NAME[s], h('small', s === 'trays' ? plural(counts[s] || 0, 'batch', 'batches') : `${plural(groups.length, s === 'tower' ? 'bank' : 'garden')} · ${plural(counts[s] || 0, 'planting')}`))));
      for (const group of groups) {
        const key = `${s}:${group.garden.id}`;
        if (s === 'trays') { trayRows(body, eng, group, key); continue; }
        if (s === 'tower') { bankRows(body, eng, group, key); continue; }
        const shut = !!prefs.shut[key];
        body.append(groupHead(group.garden.name, `${plural(group.spaces.length, 'space')} · ${plural(group.count, 'planting')}`, !shut, flip(prefs.shut, key)));
        if (shut) continue;
        for (const bed of group.spaces) {
          const items = itemsOf(eng, bed);
          if (eng.isCt(bed) && items.length > CROWDED && new Set(items.map(x => x.p.cropId)).size > 1) { crateRows(body, eng, bed, items); continue; }
          bedRow(body, eng, bed, items, open.get(bed.id), h('b', bed.bed), eng.isSoilBed(bed) ? `${num(bed.l, 1)} ft` : `${num(eng.capOf(bed))} ${eng.capUnit(bed)}`, eng.isCt(bed) ? { cls: '.tl-ct' } : null);
        }
      }
    }
    if (!body.firstChild) body.append(h('p.tl-none', all ? 'No growing space is set up yet.' : `This plan has no ${SECTION_NAME[prefs.filter].toLowerCase()}.`));
    refit(); cursor();
  }
  /** Show what is selected without drawing the chart again: the bar (or the summary that holds it), the bed's rows, the opening. */
  function markSel() {
    for (const el of document.querySelectorAll('#tlBody .sel')) el.classList.remove('sel');
    const sel = App.state.sel;
    if (!sel) return;
    const each = (query, fn) => { for (const el of document.querySelectorAll(query)) fn(el); }, on = el => el.classList.add('sel');
    if (sel.type === 'planting') { const bar = document.querySelector(`.tl-bar[data-planting="${CSS.escape(sel.id)}"]`) || sums.get(sel.id); if (bar && bar.isConnected) on(bar); return; }
    const bedId = sel.type === 'opening' ? sel.bedId : sel.id;
    if (sel.type === 'opening') each(`.tl-open[data-opening="${CSS.escape(sel.id)}"]`, on);
    each(`.tl-row[data-bed="${CSS.escape(bedId)}"]:not(.tl-pool)`, on);
  }
  function cursor() {
    if (!App.state.ready) return;
    const el = $('tlCursor');
    el.style.setProperty('--a', idx(App.state.date));
    el.dataset.label = UI.day(App.state.date);
  }

  // ── scale and filter ──
  function showScale() {
    const inner = $('tlInner'), tier = tierOf(ppd);
    inner.style.setProperty('--ppd', ppd);
    inner.dataset.tier = tier;
    // numbers in the head only where they fit: a week's first day from about 17 px a week, every day from about 15 px a day
    drawRules(tier, ppd * 7 >= 17);
    for (const button of document.querySelectorAll('[data-tl-zoom]')) button.setAttribute('aria-pressed', String(button.dataset.tlZoom === tier));
    $('tlZoomOut').disabled = atFit; $('tlZoomIn').disabled = ppd >= MAX_PPD - 1e-6;
    refit();
  }
  /** Change the scale, keeping the day under `anchorX` (a screen x; the middle of the lanes if none) where it is. */
  function setScale(next, anchorX, remember = true) {
    const scroll = $('tlScroll'), box = scroll.getBoundingClientRect(), fit = fitPpd();
    next = Math.min(MAX_PPD, Math.max(fit, +next || fit));
    const offset = Math.max(0, (anchorX == null ? box.left + LABEL_W + laneRoom() / 2 : anchorX) - box.left - LABEL_W);
    // The page scrolls in whole pixels. Through one run of the wheel the day is worked out once and held, so the rounding of each step does not add up.
    const same = held && held.offset === offset && Math.abs(scroll.scrollLeft - held.left) <= 1 && performance.now() - held.at < 600;
    const dayAt = same ? held.day : (scroll.scrollLeft + offset) / ppd;
    ppd = next; atFit = next <= fit + 1e-9;
    showScale();
    scroll.scrollLeft = Math.max(0, dayAt * ppd - offset);
    held = { offset, day: dayAt, left: scroll.scrollLeft, at: performance.now() };
    if (remember) { prefs.ppd = atFit ? 0 : ppd; savePrefs(); }
  }
  const PRESET = { months: () => fitPpd(), weeks: () => 8, days: () => 26 };
  function setFilter(id) {
    if (!FILTERS.some(f => f[0] === id) || id === prefs.filter) return;
    prefs.filter = id; savePrefs();
    $('tlScroll').scrollTop = 0;
    render();
  }
  /** Open whatever summary holds this planting, so its own bar is on the page. */
  function reveal(plantingId) {
    const eng = App.state.engine, p = eng.planting(plantingId), bed = p && eng.bedOf(p.bedId), garden = bed && eng.gardenOf(bed);
    if (!bed || !garden) return false;
    const s = sectionOf(eng, bed, garden), key = `${s}:${garden.id}`;
    let changed = false;
    if (prefs.filter !== 'all' && prefs.filter !== s && s !== 'trays') { prefs.filter = s; changed = true; }
    if (s === 'tower' && !prefs.open[key]) { prefs.open[key] = true; changed = true; }
    if (s !== 'tower' && s !== 'trays' && prefs.shut[key]) { delete prefs.shut[key]; changed = true; }
    if (s === 'crate') { const k = `crop:${bed.id}:${p.cropId}`; if (!prefs.open[k] && eng.plantingsIn(bed.id).length > CROWDED) { prefs.open[k] = true; changed = true; } }
    if (changed) { savePrefs(); render(); }
    return changed;
  }
  function bringIntoView(plantingId) {
    const el = document.querySelector(`.tl-bar[data-planting="${CSS.escape(plantingId)}"]`), scroll = $('tlScroll');
    if (!el) return;
    const box = el.getBoundingClientRect(), view = scroll.getBoundingClientRect();
    if (box.top < view.top + 44 || box.bottom > view.bottom - 4) scroll.scrollTop += box.top - view.top - view.height / 2;
    if (box.right < view.left + LABEL_W + 20 || box.left > view.right - 20) scroll.scrollLeft += box.left - view.left - LABEL_W - 60;
  }

  /** Bed and date under a screen point. */
  function targetAt(cx, cy, grabDays = 0) {
    const scroll = $('tlScroll').getBoundingClientRect();
    if (cx < scroll.left || cx > scroll.right || cy < scroll.top || cy > scroll.bottom) return null;
    const el = document.elementFromPoint(cx, cy), row = el && el.closest && el.closest('.tl-row');
    if (!row || !row.dataset.bed) return null;
    const lane = row.querySelector('.tl-lane').getBoundingClientRect(), dayIndex = Math.floor((cx - lane.left) / ppd) - grabDays;
    if (dayIndex < 0 || dayIndex >= yearDays()) return null;
    return { bedId: row.dataset.bed, date: E.addDays(yearStart(), dayIndex), row };
  }
  function showDrop(target) {
    for (const row of document.querySelectorAll('.tl-row.drop-target')) row.classList.remove('drop-target');
    const ghost = $('tlGhost');
    if (!target) { ghost.hidden = true; return; }
    const row = target.row && target.row.isConnected ? target.row : document.querySelector(`.tl-row[data-bed="${CSS.escape(target.bedId)}"]`);
    if (!row) { ghost.hidden = true; return; }
    row.classList.add('drop-target');
    const res = target.preview, inner = $('tlInner').getBoundingClientRect(), box = row.getBoundingClientRect();
    if (!res || !res.r || !res.from) { ghost.hidden = true; return; }
    const end = res.through === Infinity ? yearEnd() : clampDay(res.through);
    ghost.hidden = false; ghost.dataset.state = res.state;
    Object.assign(ghost.style, { left: (LABEL_W + xOf(clampDay(res.from))) + 'px', width: Math.max(6, xOf(E.addDays(end, 1)) - xOf(clampDay(res.from))) + 'px', top: (box.top - inner.top + 3) + 'px', height: Math.max(8, box.height - 7) + 'px' });
  }

  /** The first time the timeline is on the page, and whenever its room changes: the remembered scale, or the whole year. */
  function settle() {
    if (App.state.view !== 'timeline' || !$('tlScroll').clientWidth) return;
    const first = !sized; sized = true;
    if (first) setScale(prefs.ppd || fitPpd(), null, false);
    else if (atFit || ppd < fitPpd()) setScale(fitPpd(), null, false);
    else showScale();
    return first;
  }

  function init() {
    loadPrefs();
    const scroll = $('tlScroll');
    let press = null, pan = null;
    const wheel = { factor: 1, x: 0, frame: 0 };
    const inLanes = e => e.clientX > scroll.getBoundingClientRect().left + LABEL_W;
    scroll.addEventListener('pointerdown', e => {
      const barEl = e.target.closest('.tl-bar');
      press = { x: e.clientX, y: e.clientY, barEl, pointerType: e.pointerType };
      if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('button')) return;
      if (barEl && barEl.dataset.planting) {
        const p = App.state.engine.planting(barEl.dataset.planting), r = p && App.state.engine.calc(p);
        if (!r) return;
        const lane = barEl.parentElement.getBoundingClientRect(), grabDays = Math.floor((e.clientX - lane.left) / ppd) - idx(r.field);
        root.LRFDrag.watch(e, { payload: { plantingId: p.id }, label: App.cropLabel(p), color: App.state.engine.cropColor(r.c), grabDays });
      } else if (!barEl && inLanes(e) && !App.state.armed) {
        // empty chart under the pointer: holding and moving slides the whole chart, both ways
        pan = { x: e.clientX, y: e.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, moved: false, id: e.pointerId };
      }
    });
    scroll.addEventListener('pointermove', e => {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved) { if (Math.hypot(dx, dy) < 5) return; pan.moved = true; scroll.classList.add('panning'); try { scroll.setPointerCapture(e.pointerId); } catch (_) { /* the move still works without it */ } }
      scroll.scrollLeft = pan.left - dx; scroll.scrollTop = pan.top - dy;
    });
    const endPan = () => { if (pan && pan.moved) scroll.classList.remove('panning'); pan = null; };
    scroll.addEventListener('pointerup', endPan);
    scroll.addEventListener('pointercancel', endPan);
    // The wheel scrolls the rows, as it always did, and with Shift it scrolls sideways: the browser's own behaviour, left alone.
    // (He tried the wheel as the zoom in 0.17 and asked for this back.) Only Ctrl and the wheel, or a pinch, change the scale,
    // about the day under the pointer.
    scroll.addEventListener('wheel', e => {
      if (!e.ctrlKey || !inLanes(e)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroll.clientHeight : 1, dy = Math.max(-240, Math.min(240, e.deltaY * unit));
      // several notches can arrive between two frames: they are added up and drawn once
      wheel.factor *= Math.exp(-dy * 0.0018); wheel.x = e.clientX;
      if (!wheel.frame) wheel.frame = requestAnimationFrame(() => { const f = wheel.factor; wheel.frame = 0; wheel.factor = 1; setScale(ppd * f, wheel.x); });
    }, { passive: false });
    scroll.addEventListener('click', e => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) return;
      if (e.target.closest('button')) return;
      const barEl = e.target.closest('.tl-bar'), row = e.target.closest('.tl-row');
      if (barEl && barEl.dataset.planting) { App.select({ type: 'planting', id: barEl.dataset.planting }); return; }
      if (barEl && barEl.dataset.first) { const id = barEl.dataset.first; reveal(id); App.select({ type: 'planting', id }); requestAnimationFrame(() => bringIntoView(id)); return; }
      if (!row) return;
      if (row.dataset.pool !== undefined) { App.setView('trays'); return; }
      if (!row.dataset.bed) { const fold = row.dataset.fold; if (fold && e.target.closest('.tl-label')) flip(prefs.open, fold)(); return; }
      const spot = targetAt(e.clientX, e.clientY);
      if (App.state.armed && spot) { App.place(App.state.armed, spot.bedId, spot.date); return; }
      const openEl = e.target.closest('.tl-open');
      if (openEl) { App.select({ type: 'opening', id: openEl.dataset.opening, bedId: row.dataset.bed }); return; }
      App.select({ type: 'bed', id: row.dataset.bed });
      if (spot && e.target.closest('.tl-lane')) App.setDate(spot.date);
    });
    $('tlScale').addEventListener('click', e => {
      const box = $('tlScale').getBoundingClientRect(), index = Math.floor((e.clientX - box.left) / ppd);
      if (index >= 0 && index < yearDays()) App.setDate(E.addDays(yearStart(), index));
    });
    for (const button of document.querySelectorAll('[data-tl-zoom]')) button.addEventListener('click', () => setScale(PRESET[button.dataset.tlZoom](), scroll.getBoundingClientRect().left + LABEL_W + xOf(App.state.date) - scroll.scrollLeft));
    $('tlZoomIn').addEventListener('click', () => setScale(ppd * 1.5));
    $('tlZoomOut').addEventListener('click', () => setScale(ppd / 1.5));
    const toggle = $('tlOpenToggle');
    toggle.setAttribute('aria-pressed', String(prefs.openings));
    toggle.addEventListener('click', () => { prefs.openings = !prefs.openings; savePrefs(); toggle.setAttribute('aria-pressed', String(prefs.openings)); render(); });
    App.on('plan', render);
    App.on('sel', () => {
      if (App.state.view !== 'timeline') { dirty = true; return; }
      // a planting chosen somewhere else (the panel, a list) is brought out of whatever summary holds it
      const sel = App.state.sel;
      if (sel && sel.type === 'planting' && !document.querySelector(`.tl-bar[data-planting="${CSS.escape(sel.id)}"]`) && reveal(sel.id)) { requestAnimationFrame(() => bringIntoView(sel.id)); return; }
      markSel();
    });
    App.on('date', cursor);
    // the typefaces arrive after the first draw: measure again in the real one
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { forgetFonts(); if (App.state.view === 'timeline') render(); else dirty = true; }).catch(() => {});
    if (root.ResizeObserver) new ResizeObserver(() => { if (sized) settle(); }).observe(scroll);
    App.on('view', () => {
      if (App.state.view !== 'timeline') return;
      if (dirty) render();
      requestAnimationFrame(() => {
        const first = settle();
        const x = xOf(App.state.date) - laneRoom() / 2;
        if (first && scroll.scrollLeft === 0 && x > 0) scroll.scrollLeft = x;
      });
    });
  }

  root.LRFTimeline = { init, targetAt, showDrop, setScale, setFilter, reveal, scale: () => ppd, fit: fitPpd, prefs: () => prefs, levels: { weeks: WEEKS_AT, days: DAYS_AT, max: MAX_PPD } };
})(window);
