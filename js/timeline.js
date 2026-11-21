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
 * A crop carried from the library (clicked there, and not yet dropped) is drawn where it would grow: every other bar goes to half
 * strength, each opening of a whole bed it fits is lit, and the planting is drawn in it as any planting is, on the first day it can
 * go in, with one line of what it gives. A click there plants it, through the same step as a drop. A garden that is shut shows a thin
 * band of how full its ground is, week by week, and, while a crop is carried, the weeks it could start there.
 *
 * Two kinds of bar are not plantings in a bed. While the series tool is open, what it would add is drawn
 * as ghost bars in the rows it would go to: nothing is in the plan until its button is pressed. And
 * plantings that have no bed yet wait on a row of their own at the top, each on its own date, to be
 * dragged down onto a row.
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
  // beds with nothing planned all year: drawn with no opening, but a carried crop can go in them
  const emptyCache = new WeakMap();
  function emptyBeds(eng) {
    if (!emptyCache.has(eng)) emptyCache.set(eng, root.LRFSuccession ? root.LRFSuccession.openings(eng, { empty: true }).filter(o => o.whole && !o.planted) : []);
    return emptyCache.get(eng);
  }
  /**
   * Room for a crop: the crop carried from the library, and every opening of a whole bed whose days it fits, a bed with nothing planned
   * all year included, worked out by the same test the opening's own panel uses (LRFSuccession.tryCrop: the first day it may go in, the
   * last, what it gives). Null when nothing from the library is carried. Worked out once per plan state and crop.
   */
  const roomCache = new WeakMap();
  function roomFor(eng) {
    const armed = App.state.armed, S = root.LRFSuccession;
    if (!S || !armed || !armed.cropId || armed.plantingId || armed.waitingId) return null;
    const crop = eng.crop(armed.cropId);
    if (!crop) return null;
    const key = `${crop.id}|${armed.varietyId || ''}`;
    let kept = roomCache.get(eng);
    if (!kept) { kept = new Map(); roomCache.set(eng, kept); }
    if (kept.has(key)) return kept.get(key);
    const fits = new Map();
    for (const o of [...[...openingsBy(eng).values()].flat(), ...emptyBeds(eng)]) {
      if (!S.suits(eng, crop, o.bed)) continue;
      const t = S.tryCrop(eng, o, crop, armed.varietyId ? { varietyId: armed.varietyId } : {});
      if (t.ok) fits.set(o.id, { o, t });
    }
    const out = { crop, varietyId: armed.varietyId || '', fits };
    kept.set(key, out);
    return out;
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
      const probe = kind === 'room' ? h('div.tl-room-say', { style: { visibility: 'hidden' } }, h('b', 'x')) : kind === 'open' ? h('div.tl-open', { style: { visibility: 'hidden' } }) : kind === 'cell' ? h('div.tl-cell', { style: { visibility: 'hidden' } }, 'x') : kind === 'tray' ? h('div.tl-row.tl-pool', { style: { visibility: 'hidden' } }, h('div.tl-bar', h('span.tl-name', 'x'))) : h('div.tl-bar', { style: { visibility: 'hidden' } }, h('span.tl-name', 'x'));
      $('tlBody').append(probe);
      const cs = getComputedStyle(kind === 'bar' || kind === 'room' ? probe.firstChild : kind === 'tray' ? probe.querySelector('.tl-name') : probe);
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
  // what is picked, as drawn: the bed whose row is edged, the planting whose bar is ringed, the bed to bring into view (pickOf)
  let pick = { row: null, bar: null, bed: null };
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
    const sel = pick.bar === p.id;
    // what a series would add: drawn where it would go, and not yet a planting (it cannot be picked up or selected)
    if (item.ghost) return barEl({ from: eng.occupancyFrom(p, r), to: through === Infinity ? yearEnd() : through, through, field: r.field, first: r.first, last: r.last, sow: r.sow, lane, color: eng.cropColor(r.c),
      cls: '.tl-ghost-bar', dataset: { ghost: p.id }, tries: namesOf(r.c), pictured: pictureOf(p), alt: r.c.name, title: `Not added yet: ${App.cropLabel(p)} would go in ${day(r.field)} · harvest ${span(r.first, r.last)}` });
    // a tray batch is named by its row and shows its trays; every other bar names its crop, then its variety
    // a planting marked failed stays on record, greyed, to the day before it failed (at least its first day, when it failed in the nursery)
    const from = eng.occupancyFrom(p, r), held = through === Infinity ? yearEnd() : through, failed = r.failed ? `Failed ${day(E.s2d(r.failed))} · ` : '';
    return barEl({ from, to: held < from ? from : held, through, field: r.field, first: r.first, last: r.last, sow: r.sow, lane, color: eng.cropColor(r.c),
      cls: (sel ? '.sel' : '') + (r.failed ? '.tl-failed' : ''), dataset: { hook: 'tl-planting', planting: p.id }, kind: tray ? 'tray' : 'bar', fixed: tray ? num(r.len) : null, tries: tray ? null : namesOf(r.c), pictured: tray ? null : pictureOf(p), alt: r.c.name,
      title: failed + (tray ? `${root.LRFTrays.short(r.c.name)} · ${num(r.len)} tray${r.len === 1 ? '' : 's'} · sow ${day(r.field)} · ready ${day(r.first)}` : `${App.cropLabel(p)} · in ${day(r.field)} · ${r.failed && !r.harvestDays ? 'no harvest' : 'harvest ' + span(r.first, r.last)}`) });
  }
  /** Several plantings drawn as one bar: the same crop going in on the same day. It is not dragged; a click opens it to its plantings. */
  function summaryBar(g, lane, words) {
    const eng = App.state.engine, items = g.list, first = items[0], min = f => new Date(Math.min(...items.map(f))), max = f => new Date(Math.max(...items.map(f)));
    const endless = items.some(x => x.to === Infinity), through = endless ? Infinity : max(x => x.to), sows = items.filter(x => x.r.sow).map(x => +x.r.sow);
    const holdsSel = !!pick.bar && items.some(x => x.p.id === pick.bar), ghost = !!first.ghost;
    // plantings marked failed are summed apart from the others (their key says so), so a group is failed whole or not at all
    const failed = !ghost && items.every(x => x.r.failed), said = failed ? `Failed · ${words.title}` : words.title;
    const el = barEl({ from: new Date(g.from), to: endless ? yearEnd() : through, through, field: min(x => +x.r.field), first: min(x => +x.r.first), last: max(x => +x.r.last), sow: sows.length ? new Date(Math.min(...sows)) : null,
      lane, color: eng.cropColor(first.r.c), cls: ghost ? '.tl-ghost-bar' : '.tl-sum' + (holdsSel ? '.sel' : '') + (failed ? '.tl-failed' : ''), dataset: ghost ? { ghost: first.p.id } : { sum: g.key, first: first.p.id }, tries: words.tries, pictured: words.pictured, alt: first.r.c.name, title: ghost ? 'Not added yet. ' + words.title.replace(/\. Click to open[^.]*\.$/, '.') : said });
    if (el && !ghost) for (const x of items) sums.set(x.p.id, el);
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
  // what the series tool would add, by the space it would go to; filled at the start of each drawing
  let ghostBy = new Map();
  const itemsOf = (eng, bed) => eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).concat(ghostBy.get(bed.id) || []).map(x => {
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
    for (const [id, name] of FILTERS) host.append(h('button.chip', { type: 'button', dataset: { tlFilter: id, hook: 'tl-filter' }, 'aria-pressed': String(prefs.filter === id), title: id === 'all' ? 'Every growing space' : `Only ${SECTION_NAME[id].toLowerCase()}`, onclick: () => setFilter(id) }, name, h('small', num(counts[id] || 0))));
  }

  // ── rows ──
  function groupHead(name, small, expanded, toggle, title) {
    return h('div.tl-group', h('button.tl-group-name', { type: 'button', 'aria-expanded': String(expanded), title: title || '', onclick: toggle }, h('span.caret', expanded ? '▾' : '▸'), name, h('small', small)));
  }
  const flip = (bag, key) => () => { if (bag[key]) delete bag[key]; else bag[key] = true; savePrefs(); render(); };
  // the crop carried from the library, worked out for this drawing, and how many of the openings it fits are drawn on the page
  let room = null, roomHere = 0;
  function bedRow(body, eng, bed, items, open, label, small, extra) {
    const lanes = lanesFor(items), lane = laneEl(lanes), sel = App.state.sel;
    // an opening is drawn under the bars: ground free before, after or between what is planned
    for (const o of open || []) {
      const a = idx(o.from), n = idx(o.to) - a + 1, next = o.before ? `before the ${o.before.r.c.name.toLowerCase()}` : o.after ? `after the ${o.after.r.c.name.toLowerCase()}` : 'open';
      const fit = room && room.fits.get(o.id);
      // The words stand in the part of the opening before the nursery line of a planting that comes after it, so the line never
      // crosses them: the days up to the first such line that reaches into the opening.
      let clear = n;
      for (const x of items) {
        const r = x.r;
        if (!r || !r.sow || !(r.sow < r.field)) continue;
        const s0 = idx(clampDay(r.sow)), f0 = idx(clampDay(r.field));
        if (f0 > a && s0 < a + n) clear = Math.min(clear, Math.max(0, s0 - a));
      }
      const full = `${num(o.days)} days open`, short = `${num(o.days)} d`, text = document.createTextNode('');
      const box = h('div.tl-open' + (sel && sel.type === 'opening' && sel.id === o.id ? '.sel' : '') + (fit ? '.fit' : ''), { style: at(a, n), dataset: fit ? { opening: o.id, room: o.id, hook: 'room-opening' } : { opening: o.id },
        title: fit ? '' : `Open ${span(o.from, o.to)}: ${num(o.days)} days ${next}. Click to see what fits.`, 'aria-label': `${num(o.days)} days open, ${span(o.from, o.to)}` }, h('span.tl-ow', { style: { '--c': clear } }, h('span', text)));
      // never cut off: the words in full where the clear part is wide enough, "26 d" where it is not, nothing where even that will not fit
      fitList.push(() => {
        const w = Math.max(0, clear * ppd - 1), label = fit ? '' : measure('open', full) + OPEN_PAD <= w ? full : measure('open', short) + OPEN_PAD <= w ? short : '';
        if (text.data !== label) { text.data = label; box.classList.toggle('bare', !label); }
      });
      lane.append(box);
      if (fit) roomIn(lane, eng, o, fit, a, n, lanes);
    }
    for (const item of items) { const el = plantingBar(item, item.lane); if (el) lane.append(el); }
    const selBed = pick.row === bed.id;
    body.append(rowEl('div.tl-row' + (selBed ? '.sel' : '') + (extra && extra.cls || ''), { dataset: { hook: 'tl-space', bed: bed.id, ...(extra && extra.dataset || {}) } }, h('div.tl-label', label, small ? h('small', small) : null), lane, !!extra));
  }
  /** What a carried crop would give, in the unit it is sold in: "85 bunches". */
  function roomAmount(eng, t) {
    const F = root.LRFForecast;
    if (!F || !(t.units > 0)) return '';
    return F.amount(t.units, t.unit, F.groupOf(t.r.c, t.unit, (eng.plan.lrfNext || {}).groups));
  }
  const pickWords = r => +r.first === +r.last ? `pick ${day(r.first)}` : r.first.getMonth() === r.last.getMonth() ? `pick ${day(r.first)} to ${r.last.getDate()}` : `pick ${day(r.first)} to ${day(r.last)}`;
  /**
   * The carried crop drawn in an opening it fits: the Timeline's own bar, at the crop's days, on the first day it can go in; and one
   * line of words, beside the bar where the opening has room, under it where the row is tall enough, and otherwise left to the hint.
   */
  function roomIn(lane, eng, o, fit, a0, n0, lanes) {
    const t = fit.t, r = t.r, through = t.through, from = eng.occupancyFrom(t.p, r);
    const bar = barEl({ from, to: through === Infinity ? yearEnd() : through, through, field: r.field, first: r.first, last: r.last, sow: r.sow, lane: 0, color: eng.cropColor(r.c),
      cls: '.tl-room', dataset: { room: o.id, hook: 'room-bar' }, tries: namesOf(r.c), pictured: pictureOf(t.p), alt: r.c.name });
    if (!bar) return;
    roomHere++;
    lane.append(bar);
    const amount = roomAmount(eng, t), when = pickWords(r), a = idx(clampDay(from)), z = idx(through === Infinity ? yearEnd() : clampDay(through)) + 1, end = a0 + n0;
    const tall = lanes * LANE_H + 6 >= 3 + 16 + 4 + 14, b = h('b'), rest = document.createTextNode(''), say = h('div.tl-room-say', { dataset: { hook: 'room-words', room: o.id }, hidden: true }, b, rest);
    lane.append(say);
    // a crop started in trays says the day its trays are sown first, where there is room for it
    const sown = r.sow && r.sow < r.field ? `sow ${day(r.sow)} · ` : '', tries = amount ? [...(sown ? [[amount, ` ${sown}${when}`]] : []), [amount, ` ${when}`], [amount, '']] : [['', sown + when], ['', when]];
    let shown = null;
    fitList.push(() => {
      const beside = (end - z) * ppd - 14, under = (end - a) * ppd - 10;
      let pick = null;
      for (const words of tries) {
        const w = measure('room', words[0] + words[1]);
        if (w <= beside) { pick = { words, at: 'beside' }; break; }
        if (tall && w <= under) { pick = { words, at: 'under' }; break; }
      }
      const key = pick ? pick.at + '|' + pick.words.join('') : '';
      if (key === shown) return;
      shown = key;
      say.hidden = !pick;
      if (!pick) return;
      b.textContent = pick.words[0]; rest.data = pick.words[1];
      say.classList.toggle('under', pick.at === 'under');
      say.style.setProperty('--x', pick.at === 'under' ? a : z);
    });
  }
  /**
   * A garden that is shut: an 8 px band of how full its ground is, week by week (the feet held on each day of the week, over the
   * feet it has, as an amount in ink), and while a crop is carried an orange line under the weeks it could start there. What holds
   * the ground is what the openings and the guard rails count (eng.holders): each planting by its footprint, and a bed set to rest.
   */
  function shutBand(head, eng, spaces) {
    const days = yearDays(), feet = spaces.map(b => +eng.capOf(b) || 0), cap = feet.reduce((t, f) => t + f, 0);
    if (!(cap > 0)) return;
    const held = new Float64Array(days);
    spaces.forEach((bed, k) => {
      const L = feet[k], mine = new Float64Array(days);
      for (const x of eng.holders(bed, yearStart(), yearEnd(), null)) {
        const f = x.rect, i0 = Math.max(0, idx(clampDay(x.from))), i1 = x.through === Infinity ? days - 1 : Math.min(days - 1, idx(clampDay(x.through)));
        const ft = Math.min(L, f ? Math.max(0, f.a1 - f.a0) * Math.max(0, f.x1 - f.x0) : +x.len || L);
        for (let i = i0; i <= i1; i++) mine[i] += ft;
      }
      for (let i = 0; i < days; i++) held[i] += Math.min(L, mine[i]);
    });
    const band = h('div.tl-band', { dataset: { hook: 'garden-band' }, 'aria-hidden': 'true' });
    for (let i = 0; i < days;) {
      let j = i; while (j + 1 < days && E.addDays(yearStart(), j + 1).getDay() !== 1) j++;
      let sum = 0; for (let k = i; k <= j; k++) sum += held[k];
      const share = sum / (j - i + 1) / cap, pct = Math.round(share * 100);
      band.append(h('i', { style: { ...at(i, j - i + 1), '--p': share > 0 ? Math.round(6 + 50 * share) + '%' : '0%' }, title: `Week of ${day(E.addDays(yearStart(), i))}: ${pct}% of its ground held` }));
      i = j + 1;
    }
    if (room) {
      const ids = new Set(spaces.map(b => b.id)), here = [...room.fits.values()].filter(f => ids.has(f.o.bed.id));
      for (const f of here) { const s0 = idx(clampDay(f.t.earliest)), s1 = idx(clampDay(f.t.latest || f.t.earliest)); band.append(h('b', { style: at(s0, s1 - s0 + 1), dataset: { hook: 'band-start' } })); }
      if (here.length) head.querySelector('small').append(' · ', h('b.tl-fits', { dataset: { hook: 'band-fits' } }, `${plainCrop(room.crop.name)} fits ${num(here.length)}`));
    }
    head.classList.add('banded');
    head.append(band);
  }

  /** A bank of towers: one row, the towers that are planted alike drawn as one bar, until it is opened to single towers. */
  function bankRows(body, eng, group, key) {
    const { garden, spaces, count } = group, opened = !!prefs.open[key];
    body.append(groupHead(garden.name, `${plural(spaces.length, 'tower')}${opened ? '' : ' as one row'} · ${plural(count, 'planting')}`, opened, flip(prefs.open, key), opened ? 'Show the bank as one row' : 'Show every tower on a row of its own'));
    if (opened) { for (const bed of spaces) bedRow(body, eng, bed, itemsOf(eng, bed), null, h('b', 'Tower ' + bed.bed), `${num(eng.capOf(bed))} ${eng.capUnit(bed)}`); return; }
    const merged = new Map();
    for (const bed of spaces) for (const item of itemsOf(eng, bed)) {
      const k = [item.p.cropId, item.p.varietyId || '', item.from, item.to, item.ghost ? 'ghost' : '', item.r.failed ? 'failed' : ''].join('|');   // a failed tower is summed apart, even where it ends the day a healthy one does
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
      for (const item of list) { const k = String(item.from) + (item.ghost ? '|ghost' : '') + (item.r.failed ? '|failed' : ''); if (!merged.has(k)) merged.set(k, { key: key + '|' + k, from: item.from, to: 0, list: [] }); const g = merged.get(k); g.list.push(item); g.to = Math.max(g.to, item.to); }
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
      body.append(rowEl('div.tl-row.tl-pool.tl-strip', { dataset: { bed: bed.id, pool: '' }, title: 'Trays standing on the benches each week. Planned from weekly demand under Live trays, in the Nursery view.' },
        h('div.tl-label', h('b', 'Live trays'), h('small', items.length ? `${plural(crops, 'crop')} · most ${num(peak)} at once` : 'no weekly demand yet')), lane, true));
      if (!opened) continue;
      // the benches are not one place, so each tray crop gets a row: each bar is a batch from sowing to ready, labelled with its trays
      const byCrop = new Map();
      for (const item of items) { const list = byCrop.get(item.p.cropId) || []; list.push(item); byCrop.set(item.p.cropId, list); }
      const names = [...byCrop.keys()].sort((a, b) => root.LRFTrays.short((eng.crop(a) || {}).name).localeCompare(root.LRFTrays.short((eng.crop(b) || {}).name)));
      for (const cropId of names) {
        const list = byCrop.get(cropId), lanes = lanesFor(list), row = laneEl(lanes);
        for (const item of list) { const el = plantingBar(item, item.lane, true); if (el) row.append(el); }
        body.append(rowEl('div.tl-row.tl-pool', { dataset: { bed: bed.id, pool: cropId }, title: 'Planned from weekly demand under Live trays, in the Nursery view' },
          h('div.tl-label', h('b', root.LRFTrays.short((eng.crop(cropId) || {}).name) || 'Trays'), h('small', `${num(list.reduce((n, x) => n + x.r.len, 0))} trays`)), row, true));
      }
    }
  }

  /**
   * Plantings with no bed yet, on a row of their own at the top: each on its own date, to be dragged down onto a row. Their days are
   * read off a space like the ones they are headed for. What the series tool would send here is drawn with them, as ghosts.
   */
  function waitRows(body, eng, ghosts) {
    const Ahead = root.LRFSuccession, list = App.waiting(), soon = (ghosts && ghosts.held) || [];
    if (!Ahead || (!list.length && !soon.length)) return;
    const sel = App.state.sel, items = [];
    for (const [w, ghost] of [...list.map(w => [w, false]), ...soon.map(w => [w, true])]) {
      const a = Ahead.about(eng, w), date = E.s2d(w.date), c = eng.crop(w.cropId) || { name: 'Crop' };
      // one that cannot be worked out anywhere still shows, as a week from its date
      const x = a ? { r: a.r, from: +a.from, to: a.through === Infinity ? Infinity : +a.through } : { r: { c, field: date, first: E.addDays(date, 7), last: E.addDays(date, 6), sow: null }, from: +date, to: +E.addDays(date, 6) };
      items.push({ w, ghost, ...x });
    }
    const lanes = lanesFor(items), lane = laneEl(lanes);
    for (const x of items) {
      const { w, r } = x, color = eng.cropColor(r.c), through = x.to === Infinity ? Infinity : new Date(x.to), label = App.cropLabel(w), nth = w.wait && w.wait.of > 1 ? ` · ${num(w.wait.k)} of ${num(w.wait.of)}` : '';
      const el = barEl({ from: new Date(x.from), to: through === Infinity ? yearEnd() : through, through, field: r.field, first: r.first, last: r.last, sow: r.sow, lane: x.lane, color,
        cls: x.ghost ? '.tl-ghost-bar' : sel && sel.type === 'waiting' && sel.id === w.id ? '.sel' : '', dataset: x.ghost ? { ghost: w.id } : { waiting: w.id }, tries: namesOf(r.c), pictured: pictureOf(w), alt: r.c.name,
        title: x.ghost ? `Not added yet: ${label} would wait to be placed, for ${day(r.field)}` : `${label}${nth} · goes in ${day(r.field)} · no bed yet. Drag it onto a row; it keeps its date.` });
      if (el) lane.append(el);
    }
    const n = list.length;
    body.append(h('div.tl-section.tl-waithead', { dataset: { section: 'waiting' }, title: 'Not in a bed yet, so not in the forecast, seed or sowing lists.' },
      h('span', 'To place', h('small', n ? `${plural(n, 'planting')} with no bed yet · counted nowhere until placed` : 'what the series would leave to place'))));
    body.append(rowEl('div.tl-row.tl-wait', { dataset: { wait: '' } }, h('div.tl-label', { title: 'Plantings a series made that have no bed yet. Drag one onto a row to place it.' }, h('b', 'No bed yet'), h('small', 'drag onto a row')), lane, true));
  }

  function render() {
    if (!App.state.ready || App.state.view !== 'timeline') { dirty = true; return; }
    dirty = false; fitList = []; sums.clear(); hideHint(); pick = pickOf();
    const eng = App.state.engine, plan = App.state.plan, body = clear($('tlBody'));
    // the openings: all of them while Openings is on; while a crop is carried, the ones it fits whether or not
    room = roomFor(eng); roomHere = 0;
    const open = new Map();
    for (const [id, list] of openingsBy(eng)) { const shown = prefs.openings ? list : room ? list.filter(o => room.fits.has(o.id)) : []; if (shown.length) open.set(id, shown); }
    // a bed with nothing planned all year has no opening drawn; one the carried crop fits is drawn lit, as any other it fits
    if (room) for (const { o } of room.fits.values()) if (!o.planted) open.set(o.bed.id, [...(open.get(o.bed.id) || []), o]);
    body.classList.toggle('room', !!room);
    const ghosts = root.LRFSeries ? root.LRFSeries.ghosts() : null;
    ghostBy = new Map();
    for (const x of (ghosts && ghosts.placed) || []) { if (!ghostBy.has(x.bed.id)) ghostBy.set(x.bed.id, []); ghostBy.get(x.bed.id).push({ p: x.p, r: x.r, ghost: true }); }
    drawHead();
    waitRows(body, eng, ghosts);
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
        const shut = !!prefs.shut[key], head = groupHead(group.garden.name, `${plural(group.spaces.length, 'space')} · ${plural(group.count, 'planting')}`, !shut, flip(prefs.shut, key));
        body.append(head);
        if (shut) { if (s === 'field' || s === 'cover') shutBand(head, eng, group.spaces); continue; }
        for (const bed of group.spaces) {
          const items = itemsOf(eng, bed);
          if (eng.isCt(bed) && items.length > CROWDED && new Set(items.map(x => x.p.cropId)).size > 1) { crateRows(body, eng, bed, items); continue; }
          bedRow(body, eng, bed, items, open.get(bed.id), h('b', bed.bed), eng.isSoilBed(bed) ? `${num(bed.l, 1)} ft` : `${num(eng.capOf(bed))} ${eng.capUnit(bed)}`, eng.isCt(bed) ? { cls: '.tl-ct' } : null);
        }
      }
    }
    if (!body.querySelector('.tl-group, .tl-row[data-bed]')) body.append(h('p.tl-none', all ? 'No growing space is set up yet.' : `This plan has no ${SECTION_NAME[prefs.filter].toLowerCase()}.`));
    roomLine(eng);
    refit(); cursor();
  }
  /** One line beside Openings while a crop is carried: its picture, where it fits, and × to put it down. */
  function roomLine(eng) {
    const host = $('tlRoomLine');
    if (!host) return;
    clear(host);
    host.hidden = !room;
    if (!room) return;
    const farm = room.fits.size, name = App.cropLabel({ cropId: room.crop.id, ...(room.varietyId ? { varietyId: room.varietyId } : {}) });
    const says = !farm ? 'fits no opening on the farm' : `fits ${roomHere ? num(roomHere) : 'none'} here · ${num(farm)} on the farm`;
    host.append(root.LRFThumbs.el({ ...(room.varietyId ? { varietyId: room.varietyId } : {}), cropId: room.crop.id, color: eng.cropColor(room.crop), label: room.crop.name, size: 20 }),
      h('b', name), h('span', { dataset: { hook: 'room-count' } }, says),
      h('button.tl-room-x', { type: 'button', 'aria-label': `Put ${name} down`, title: `Put ${name} down`, onclick: () => App.arm(null) }, '×'));
  }
  /** What is picked, as the Timeline shows it (#88): the bed whose row is edged (a bed picked, or an opening's bed); the planting
   *  whose bar is ringed (a planting picked, or the planting row open in the bed's card or panel, which follows the card as it is
   *  opened and closed); and the bed to bring into view. */
  function pickOf() {
    const sel = App.state.sel, C = root.LRFCard;
    if (!sel) return { row: null, bar: null, bed: null };
    if (sel.type === 'bed') return { row: sel.id, bar: (C && C.openRow && C.openRow()) || null, bed: sel.id };
    if (sel.type === 'opening') return { row: sel.bedId, bar: null, bed: sel.bedId };
    if (sel.type === 'planting') { const p = App.state.engine.planting(sel.id); return { row: null, bar: sel.id, bed: p ? p.bedId : null }; }
    return { row: null, bar: null, bed: null };
  }
  /** Show what is selected without drawing the chart again: the bar (or the summary that holds it), the bed's rows, the opening. */
  function markSel() {
    for (const el of document.querySelectorAll('#tlBody .sel')) el.classList.remove('sel');
    const sel = App.state.sel;
    pick = pickOf();
    if (!sel) return;
    const each = (query, fn) => { for (const el of document.querySelectorAll(query)) fn(el); }, on = el => el.classList.add('sel');
    if (pick.bar) { const bar = barOf(pick.bar); if (bar) on(bar); }
    if (sel.type === 'waiting') { each(`.tl-bar[data-waiting="${CSS.escape(sel.id)}"]`, on); return; }
    if (sel.type === 'opening') each(`.tl-open[data-opening="${CSS.escape(sel.id)}"]`, on);
    if (pick.row) each(`.tl-row[data-bed="${CSS.escape(pick.row)}"]:not(.tl-pool)`, on);
  }
  /** A planting's bar as drawn, or the summary bar that holds it. */
  function barOf(id) {
    const bar = document.querySelector(`#tlBody .tl-bar[data-planting="${CSS.escape(id)}"]`) || sums.get(id);
    return bar && bar.isConnected ? bar : null;
  }
  /** Bring the row of what is picked into view, up or down only, and only when none of it can be seen: the date stays where it
   *  is, and a row that shows at all is left where it is, so nothing jumps under the pointer (#88). */
  function showRow() {
    const scroll = $('tlScroll'), eng = App.state.engine;
    const find = () => { const bar = pick.bar && barOf(pick.bar); return (bar && bar.closest('.tl-row')) || (pick.bed && document.querySelector(`#tlBody .tl-row[data-bed="${CSS.escape(pick.bed)}"]`)); };
    let row = find();
    // hidden by the filter, a closed garden or a bank of towers: opened to, then found again on the page drawn afresh (Codex on #89)
    if (!row && pick.bed && revealSpace(eng, eng.bedOf(pick.bed))) row = find();
    if (!row || !scroll.clientHeight) return;
    const box = row.getBoundingClientRect(), view = scroll.getBoundingClientRect(), head = scroll.querySelector('.tl-head');
    const top = view.top + (head ? head.offsetHeight : 0), bottom = view.top + scroll.clientHeight;
    if (box.bottom > top && box.top < bottom) return;
    scroll.scrollTop += box.top - top - Math.max(0, (bottom - top - box.height) / 3);
  }
  /** The bed's card opened or closed one of its plantings: the Timeline rings it, and brings its row into view if it was hidden. */
  function showPick() {
    if (!App.state.ready || App.state.view !== 'timeline') return;
    markSel(); showRow();
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
    const eng = App.state.engine, p = eng.planting(plantingId);
    return revealSpace(eng, p && eng.bedOf(p.bedId), p && p.cropId);
  }
  /** Open whatever hides a space's row: the filter that leaves its kind out, its garden closed, its bank of towers as one row, and
   *  (for a planting's crop) a crate's crop drawn as one bar. A bed picked is opened to as a planting picked is (Codex on #89). */
  function revealSpace(eng, bed, cropId) {
    const garden = bed && eng.gardenOf(bed);
    if (!bed || !garden) return false;
    const s = sectionOf(eng, bed, garden), key = `${s}:${garden.id}`;
    let changed = false;
    if (prefs.filter !== 'all' && prefs.filter !== s && s !== 'trays') { prefs.filter = s; changed = true; }
    if (s === 'tower' && !prefs.open[key]) { prefs.open[key] = true; changed = true; }
    if (s !== 'tower' && s !== 'trays' && prefs.shut[key]) { delete prefs.shut[key]; changed = true; }
    if (s === 'crate' && cropId) { const k = `crop:${bed.id}:${cropId}`; if (!prefs.open[k] && eng.plantingsIn(bed.id).length > CROWDED) { prefs.open[k] = true; changed = true; } }
    if (changed) { savePrefs(); render(); }
    return changed;
  }
  /** Bring what the series tool would add into sight: the first of its ghost bars. False when none is on the page. */
  function showGhosts() {
    const el = document.querySelector('#tlBody .tl-row[data-bed] .tl-ghost-bar') || document.querySelector('#tlBody .tl-ghost-bar');
    if (!el) return false;
    bringIntoView(null, el);
    return true;
  }
  function bringIntoView(plantingId, bar) {
    const el = bar || document.querySelector(`.tl-bar[data-planting="${CSS.escape(plantingId)}"]`), scroll = $('tlScroll');
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

  /** Plant the carried crop in an opening it fits, on the first day it can go in. The same step as a drop: App.place. */
  function plantRoom(openingId) {
    const fit = room && room.fits.get(openingId);
    if (!fit || !App.state.armed) return;
    hideHint();
    App.place(App.state.armed, fit.o.bed.id, E.s2d(fit.t.p.date));
  }
  let hint = null, hintFor = '';
  function hideHint() {
    if (hint) hint.hidden = true;
    hintFor = '';
    for (const el of document.querySelectorAll('#tlBody .tl-room.on')) el.classList.remove('on');
  }
  /** What a carried crop would be in one opening: where, the days it would go in, when it is picked, when the ground is free, what it gives. */
  function showHint(el) {
    const id = el.dataset.room, fit = room && room.fits.get(id);
    if (!fit) { hideHint(); return; }
    if (hintFor === id && hint && !hint.hidden) return;
    hideHint();
    hintFor = id;
    const eng = App.state.engine, { o, t } = fit, r = t.r, bar = document.querySelector(`#tlBody .tl-room[data-room="${CSS.escape(id)}"]`);
    if (!bar) return;
    bar.classList.add('on');
    if (!hint) { hint = h('div.hint.tl-room-hint', { id: 'tlRoomHint', role: 'tooltip', dataset: { hook: 'room-hint' } }); document.body.append(hint); }
    const B = d => h('b', day(d)), later = t.latest && +t.latest > +t.earliest ? [', or any day to ', B(t.latest)] : [];
    const goes = r.sow && r.sow < r.field ? ['Sow in trays ', B(r.sow), ' · Plant out ', B(r.field), ...later] : ['Sow ', B(r.field), ...later];
    const free = t.through === Infinity ? ' · Holds it to the season’s end' : [' · Free ', B(E.addDays(t.through, 1))], amount = roomAmount(eng, t), name = App.cropLabel(t.p);
    clear(hint);
    hint.append(h('div.tl-rh-head', root.LRFThumbs.el({ ...(t.p.varietyId ? { varietyId: t.p.varietyId } : {}), cropId: r.c.id, color: eng.cropColor(r.c), label: r.c.name, size: 40 }),
      h('div', h('b', name.charAt(0).toUpperCase() + name.slice(1)), h('small', `${App.bedLabel(o.bed)} · not planted yet`))),
      h('p', goes, ' · Pick ', B(r.first), ' to ', B(r.last), free),
      h('p', `${num(+r.physicalLength || +r.len, 1)} ft${amount ? ' · ' + amount : ''}`),
      t.frost ? h('p', { dataset: { hook: 'room-hint-frost' } }, UI.plainDays(t.frost)) : null,
      h('p.tl-rh-foot', 'Click to plant it here · Undo follows'));
    hint.hidden = false;
    const at = bar.getBoundingClientRect(), box = hint.getBoundingClientRect(), left = Math.max(8, Math.min(at.left, innerWidth - box.width - 8));
    const below = at.bottom + 8, top = below + box.height > innerHeight - 8 ? Math.max(8, at.top - box.height - 8) : below;
    hint.style.left = Math.round(left) + 'px'; hint.style.top = Math.round(top) + 'px';
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
      } else if (barEl && barEl.dataset.waiting) {
        const w = App.waitingOne(barEl.dataset.waiting), c = w && App.state.engine.crop(w.cropId);
        if (c) root.LRFDrag.watch(e, { payload: { waitingId: w.id }, label: App.cropLabel(w), color: App.state.engine.cropColor(c) });
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
      // a carried crop, clicked where it is drawn: planted there on the first day it can go, as a drop there plants it
      const roomEl = App.state.armed && e.target.closest('[data-room]');
      if (roomEl) { plantRoom(roomEl.dataset.room); return; }
      const barEl = e.target.closest('.tl-bar'), row = e.target.closest('.tl-row');
      if (barEl && barEl.dataset.planting) { App.select({ type: 'planting', id: barEl.dataset.planting }); return; }
      if (barEl && barEl.dataset.waiting) { App.select({ type: 'waiting', id: barEl.dataset.waiting }); return; }
      if (barEl && barEl.dataset.ghost !== undefined) return;
      if (row && row.dataset.wait !== undefined) return;
      if (barEl && barEl.dataset.first) { const id = barEl.dataset.first; reveal(id); App.select({ type: 'planting', id }); requestAnimationFrame(() => bringIntoView(id)); return; }
      if (!row) return;
      if (row.dataset.pool !== undefined) { if (root.LRFTraysView && root.LRFTraysView.open) root.LRFTraysView.open('live'); else App.setView('trays'); return; }
      if (!row.dataset.bed) { const fold = row.dataset.fold; if (fold && e.target.closest('.tl-label')) flip(prefs.open, fold)(); return; }
      const spot = targetAt(e.clientX, e.clientY);
      if (App.state.armed && spot) { App.place(App.state.armed, spot.bedId, spot.date); return; }
      // while the series tool is asking for beds, a click on a row names that bed
      if (root.LRFSeries && root.LRFSeries.picking() && root.LRFSeries.toggleBed(row.dataset.bed)) return;
      const openEl = e.target.closest('.tl-open');
      if (openEl) { App.select({ type: 'opening', id: openEl.dataset.opening, bedId: row.dataset.bed }); return; }
      App.select({ type: 'bed', id: row.dataset.bed });
      // the date moves to the day clicked, and says so, with the way back (L3)
      if (spot && e.target.closest('.tl-lane')) {
        const was = App.state.date;
        App.setDate(spot.date);
        if (+App.state.date !== +was) UI.toast(`The date is now ${day(App.state.date)} (was ${day(was)})`, { label: 'Undo', run: () => App.setDate(was) });
      }
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
    App.on('ghost', render);
    App.on('armed', () => { hideHint(); if (App.state.view === 'timeline') render(); else dirty = true; });
    // the one hint card for a carried crop's planting, under the pointer
    scroll.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-room]'); if (el) showHint(el); else hideHint(); });
    scroll.addEventListener('pointerleave', hideHint);
    scroll.addEventListener('scroll', hideHint, { passive: true });
    App.on('sel', () => {
      if (App.state.view !== 'timeline') { dirty = true; return; }
      // a planting chosen somewhere else (the panel, a list) is brought out of whatever summary holds it
      const sel = App.state.sel;
      if (sel && sel.type === 'planting' && !document.querySelector(`.tl-bar[data-planting="${CSS.escape(sel.id)}"]`) && reveal(sel.id)) { requestAnimationFrame(() => bringIntoView(sel.id)); return; }
      markSel();
      // picked somewhere else (the card, a list): its row is brought into view if it was hidden; a click here is on a row in view (#88)
      showRow();
    });
    App.on('date', cursor);
    // the typefaces arrive after the first draw: measure again in the real one
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { forgetFonts(); if (App.state.view === 'timeline') render(); else dirty = true; }).catch(() => {});
    if (root.ResizeObserver) new ResizeObserver(() => { if (sized) settle(); }).observe(scroll);
    App.on('view', () => {
      if (App.state.view !== 'timeline') return;
      if (dirty) render(); else markSel();   // the card may have opened another of the bed's plantings while the Timeline was away
      requestAnimationFrame(() => {
        const first = settle();
        const x = xOf(App.state.date) - laneRoom() / 2;
        if (first && scroll.scrollLeft === 0 && x > 0) scroll.scrollLeft = x;
        showRow();   // what the card holds, brought into view if it is hidden (#88)
      });
    });
  }

  root.LRFTimeline = { init, targetAt, showDrop, setScale, setFilter, reveal, showGhosts, showPick, scale: () => ppd, fit: fitPpd, prefs: () => prefs, levels: { weeks: WEEKS_AT, days: DAYS_AT, max: MAX_PPD } };
})(window);
