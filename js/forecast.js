/* Little River Farm Planner — the harvest forecast.
 *
 * What the plan is expected to yield, day by day: every planting's marketable yield (engine.yieldOf),
 * added up by crop. How it comes in is the crop's harvest pattern: evenly over the days it is picked
 * (a total, or a weekly figure), or all of it the day it is ready. A crop that keeps after picking is
 * then drawn down evenly over the weeks it keeps, so each row has two series: `picked`, what comes
 * out of the ground, and `days`, what there is to sell. With nothing keeping they are the same.
 * A crop is counted in its own unit (heads, bunches, pounds, stems, trays) and different units are
 * never added together.
 *
 * Three kinds of thing are forecast, because that is how they are sold: vegetables (with herbs and
 * fruit), microgreen trays, and flower stems.
 *
 * A planting is grown to sell unless it is marked for personal use (useOf): on the planting, or on its
 * bed, or on its garden. A personal planting is picked like any other and is worth nothing here: its
 * quantities are in the rows, its dollars are not. build(engine, { use: 'commercial' | 'personal' })
 * counts one kind only; the list that is sent is the commercial one.
 *
 * No DOM and no storage in this file. It runs in the browser and in Node.
 *
 *   const model = LRFForecast.build(engine);
 *   LRFForecast.sum(model.rows[0].days, i0, i1)      -> how much of that crop from day i0 to day i1
 *   LRFForecast.periods(model, 'week')               -> the columns of a week-by-week table
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.LRFForecast = factory(root.LRFEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const GROUPS = [['produce', 'Vegetables', 'Vegetables, herbs and fruit'], ['micro', 'Microgreens', 'Microgreen trays'], ['flower', 'Flowers', 'Flower stems']];
  // Cut flowers by name. A crop counted in stems is a flower whatever it is called; the grower can move any crop.
  const FLOWER = new RegExp('\\b(' + ['ageratum', 'agrostemma', 'alyssum', 'amaranthus', 'ammi', 'ammobium', 'anemone', 'artemisia', 'asclepias', 'aster', 'atriplex', 'bachelor', 'bells of ireland', 'bupleurum',
    'calendula', 'calla', 'campanula', 'carthamus', 'safflower', 'celosia', 'centaurea', 'cerinthe', 'clarkia', 'columbine', 'cosmos', 'craspedia', 'crocus', 'cynoglossum', 'dahlia', 'daucus', 'delphinium',
    'dianthus', 'sweet william', 'didiscus', 'digitalis', 'foxglove', 'dusty miller', 'echinacea', 'echinops', 'eryngium', 'eucalyptus', 'euphorbia', 'geranium', 'gladiol\\w*', 'gomphrena', 'gypsophila',
    'helipterum', 'hibiscus', 'larkspur', 'lavender', 'lil(?:y|ies)', 'lisianthus', 'lupine', 'marigold', 'matricaria', 'feverfew', 'monarda', 'morning glory', 'narcissus', 'daffodil', 'nicotiana', 'nigella',
    'orlaya', 'peon(?:y|ies)', 'petunia', 'phacelia', 'phlox', 'popp(?:y|ies)', 'portulaca', 'queen anne', 'ranunculus', 'rudbeckia', 'black[- ]eyed susan', 'salvia', 'saponaria', 'scabiosa', 'snapdragon', 'statice',
    'stock', 'strawflower', 'sunflowers?', 'sweet peas?', 'tithonia', 'tulips?', 'verbena', 'viola', 'pansy', 'yarrow', 'xeranthemum', 'zinnias?'].join('|') + ')\\b', 'i');

  // ── personal use or commercial ──
  const said = record => record && (record.use === 'personal' || record.use === 'commercial') ? record.use : null;
  const whose = (use, by) => ({ use, personal: use === 'personal', by });
  /** A space's own word, or its garden's, or commercial: { use, personal, by: 'bed' | 'garden' | 'default' }. */
  function useOfBed(eng, bed) {
    const own = said(bed);
    if (own) return whose(own, 'bed');
    const garden = said(bed && eng.gardenOf(bed));
    return garden ? whose(garden, 'garden') : whose('commercial', 'default');
  }
  /** Whom a planting is grown for: its own word, or its bed's, or its garden's, or commercial. by: 'planting' | 'bed' | 'garden' | 'default'. */
  function useOf(eng, p) {
    const own = said(p);
    return own ? whose(own, 'planting') : useOfBed(eng, p && eng.bedOf(p.bedId));
  }
  /** What a record would be with nothing said on it: a planting follows its bed, a bed its garden, a garden is commercial. */
  function follows(eng, kind, record) {
    if (kind === 'planting') return useOfBed(eng, record && eng.bedOf(record.bedId)).use;
    if (kind === 'bed') return said(record && eng.gardenOf(record)) || 'commercial';
    return 'commercial';
  }

  /** Which of the three a crop is sold as. `own` is the grower's say: { cropId: 'produce' | 'flower' }. */
  function groupOf(crop, unit, own) {
    if (!crop) return 'produce';
    if (crop.micro) return 'micro';
    const said = own && own[crop.id];
    if (said === 'flower' || said === 'produce') return said;
    return /^stems?$/i.test(String(unit || '')) || FLOWER.test(String(crop.name || '')) ? 'flower' : 'produce';
  }
  /** "12 heads", "3.5 lb", "40 bunches", "6 trays", "25" for things counted singly. */
  const PLURAL = { head: 'heads', bunch: 'bunches', stem: 'stems', tray: 'trays', pint: 'pints', quart: 'quarts', bag: 'bags', case: 'cases', box: 'boxes', each: '', lb: 'lb', oz: 'oz', bu: 'bu', kg: 'kg', g: 'g' };
  function unitWord(n, unit, group) {
    const u = String(unit || 'each');
    if (group === 'flower' && /^(each|stems?)$/i.test(u)) return Math.abs(n - 1) < 1e-9 ? 'stem' : 'stems';
    if (Math.abs(n - 1) < 1e-9) return u === 'each' ? '' : u;
    return Object.prototype.hasOwnProperty.call(PLURAL, u) ? PLURAL[u] : u;
  }
  /** A quantity a chef can order against: whole numbers once there are ten, one decimal below. Never rounded up to something that is not there. */
  function shown(n) {
    if (!(n > 0)) return 0;
    return n >= 10 ? Math.floor(n + 1e-6) : Math.floor(n * 10 + 1e-6) / 10;
  }
  const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: n >= 10 ? 0 : 1 });
  /** "Micro · Arugula" is listed under Microgreens as "Arugula". */
  const short = name => String(name || '').replace(/^micro\s*[·-]?\s*/i, '').trim() || String(name || '');
  const amount = (n, unit, group) => { const v = shown(n), w = unitWord(v, unit, group); return `${fmt(v)}${w ? ' ' + w : ''}`; };

  /**
   * The forecast for one season. options: { year, groups: the grower's own sorting of crops, use }.
   * rows are one per crop and unit, each with a quantity for every day of the year.
   * use: 'commercial' or 'personal' counts only those plantings; without it every planting is counted, and a personal
   * one gives its quantity and no dollars. `personal` is how many plantings of the season are marked for personal use,
   * whichever were counted.
   */
  function build(eng, options = {}) {
    const plan = eng.plan, year = +options.year || +(plan.settings && plan.settings.year) || new Date().getFullYear();
    const start = new Date(year, 0, 1), n = Math.round(E.dayDiff(new Date(year + 1, 0, 1), start)), own = options.groups || (plan.lrfNext && plan.lrfNext.groups) || null;
    const rows = new Map(), unset = [], at = d => Math.round(E.dayDiff(d, start));
    const use = options.use === 'commercial' || options.use === 'personal' ? options.use : 'all';
    let counted = 0, marked = 0;
    for (const p of plan.plantings || []) {
      const r = eng.calc(p);
      if (!r || r.b.active === false || r.g.active === false || !(r.harvestDays > 0) || r.last < start || at(r.first) >= n) continue;
      const y0 = eng.yieldOf(p, r);
      if (!y0) continue;                                            // a cover crop: nothing to pick
      const personal = useOf(eng, p).personal;
      if (personal) marked++;
      if (use !== 'all' && personal !== (use === 'personal')) continue;
      const y = personal ? { ...y0, price: 0 } : y0;                // grown for the farm's own table: picked, and not sold
      const crop = eng.crop(p.cropId) || r.c, key = p.cropId + '|' + y.unit;
      let row = rows.get(key);
      if (!row) {
        row = { key, cropId: p.cropId, name: short(crop.name || r.c.name || 'Crop'), unit: y.unit, group: groupOf(crop, y.unit, own), color: eng.cropColor(r.c), days: new Float64Array(n), picked: new Float64Array(n), value: new Float64Array(n),
          total: 0, pickedTotal: 0, worth: 0, plantings: [], varieties: new Map(), unset: 0, first: null, last: null, keeps: 0, patterns: new Set() };
        rows.set(key, row);
      }
      if (!y.set || !(y.units > 0)) { row.unset++; unset.push({ p, r, why: y.set ? 'its yield works out to nothing' : 'no yield is set for this crop' }); if (!y.set) continue; }
      // the days it is picked: its harvest period
      const picked = [];
      for (let d = new Date(r.first), i = at(d); d <= r.last; d = E.addDays(d, 1), i++) if (eng.pickedOn(r, d)) picked.push(i);
      if (!picked.length || !(y.units > 0)) continue;
      const rate = y.units / picked.length, vId = p.varietyId || '', v = eng.variety(p.varietyId);
      let variety = row.varieties.get(vId);
      if (!variety) { variety = { id: vId, name: v && v.name ? v.name : 'No variety chosen', days: new Float64Array(n), picked: new Float64Array(n), total: 0 }; row.varieties.set(vId, variety); }
      // what comes out of the ground each day, and what there is to sell: a crop that keeps is drawn down evenly over the weeks it keeps
      const keep = Math.max(1, Math.round((y.keep || 0) * 7)), lo = picked[0], span = picked[picked.length - 1] - lo + keep, out = new Float64Array(span), avail = new Float64Array(span);
      const lots = y.pattern === 'once' ? [[lo, y.units]] : picked.map(i => [i, rate]);
      for (const [i, q] of lots) { out[i - lo] += q; if (keep === 1) avail[i - lo] += q; else for (let k = 0; k < keep; k++) avail[i - lo + k] += q / keep; }
      let inYear = 0, cut = 0;
      for (let k = 0; k < span; k++) {
        const i = lo + k;
        if (i < 0 || i >= n) continue;
        if (out[k]) { row.picked[i] += out[k]; variety.picked[i] += out[k]; cut += out[k]; }
        if (avail[k]) { row.days[i] += avail[k]; row.value[i] += avail[k] * y.price; variety.days[i] += avail[k]; inYear += avail[k]; }
      }
      if (!(inYear > 0) && !(cut > 0)) continue;
      row.total += inYear; row.pickedTotal += cut; row.worth += inYear * y.price; variety.total += inYear; counted++;
      if (keep > 1) row.keeps = Math.max(row.keeps, y.keep);
      row.patterns.add(y.pattern);
      row.plantings.push({ p, r, units: y.units, inYear, rate, lo, avail, out, pattern: y.pattern, keep: y.keep || 0, i0: Math.max(0, lo), i1: Math.min(n - 1, lo + span - 1), p0: Math.max(0, lo), p1: Math.min(n - 1, picked[picked.length - 1]), price: y.price, personal });
      const a = new Date(Math.max(r.first, start)), z = new Date(Math.min(r.last, E.addDays(start, n - 1)));
      if (!row.first || a < row.first) row.first = a;
      if (!row.last || z > row.last) row.last = z;
    }
    const order = { produce: 0, micro: 1, flower: 2 };
    const list = [...rows.values()].filter(r => r.total > 0 || r.unset).sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name));
    for (const row of list) row.varieties = [...row.varieties.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { year, start, days: n, rows: list, unset, counted, use, personal: marked, keeps: list.some(r => r.keeps > 0), date: i => E.addDays(start, i), index: at };
  }

  /** How much of one planting falls between two days: of what there is to sell, or (`picked`) of what comes out of the ground. */
  function share(x, i0, i1, picked) {
    const series = picked ? x.out : x.avail;
    let total = 0;
    for (let i = Math.max(i0, x.lo), end = Math.min(i1, x.lo + series.length - 1); i <= end; i++) total += series[i - x.lo];
    return total;
  }
  const sum = (days, i0, i1) => { let total = 0; for (let i = Math.max(0, i0); i <= i1 && i < days.length; i++) total += days[i]; return total; };
  const monday = d => E.addDays(d, -((d.getDay() + 6) % 7));
  /** The columns of a table: days, weeks (Monday to Sunday) or months, each with the days of the year it covers. */
  function periods(model, grain, from, to) {
    const out = [], lo = Math.max(0, from == null ? 0 : from), hi = Math.min(model.days - 1, to == null ? model.days - 1 : to);
    if (grain === 'day') { for (let i = lo; i <= hi; i++) { const d = model.date(i); out.push({ key: E.d2s(d), i0: i, i1: i, start: d, end: d, label: String(d.getDate()), top: d.getDate() === 1 || i === lo ? MONTHS[d.getMonth()] : '', weekend: d.getDay() === 0 || d.getDay() === 6, monday: d.getDay() === 1 }); } return out; }
    if (grain === 'month') {
      for (let m = 0; m < 12; m++) { const a = model.index(new Date(model.year, m, 1)), z = model.index(new Date(model.year, m + 1, 0)); if (z < lo || a > hi) continue; out.push({ key: `${model.year}-${String(m + 1).padStart(2, '0')}`, i0: a, i1: z, start: model.date(a), end: model.date(z), label: MONTHS[m], top: '' }); }
      return out;
    }
    for (let d = monday(model.date(lo)); model.index(d) <= hi; d = E.addDays(d, 7)) {
      const a = Math.max(0, model.index(d)), z = Math.min(model.days - 1, model.index(d) + 6), first = model.date(a);
      out.push({ key: E.d2s(d), i0: a, i1: z, start: first, end: model.date(z), label: String(first.getDate()), top: !out.length || first.getDate() <= 7 ? MONTHS[first.getMonth()] : '' });
    }
    return out;
  }
  /** The first and last day of the year anything is picked, as day numbers; null when nothing is. */
  function season(model, rows = model.rows) {
    let lo = -1, hi = -1;
    for (const row of rows) { for (let i = 0; i < model.days; i++) if (row.days[i] > 1e-9) { if (lo < 0 || i < lo) lo = i; break; } for (let i = model.days - 1; i >= 0; i--) if (row.days[i] > 1e-9) { if (i > hi) hi = i; break; } }
    return lo < 0 ? null : { i0: lo, i1: hi };
  }
  /** What is there between two days: one line per crop that has anything, with its varieties. */
  function available(model, i0, i1, options = {}) {
    const out = [];
    for (const row of model.rows) {
      if (options.group && row.group !== options.group) continue;
      const qty = sum(row.days, i0, i1);
      if (!(shown(qty) > 0)) continue;
      out.push({ row, qty, worth: sum(row.value, i0, i1), varieties: row.varieties.map(v => ({ id: v.id, name: v.name, qty: sum(v.days, i0, i1) })).filter(v => shown(v.qty) > 0) });
    }
    return out;
  }
  /** The headline figures for a stretch of days. Flowers add up as stems; microgreens as trays; vegetables only as a count of crops and a value. */
  function glance(model, i0, i1) {
    const list = available(model, i0, i1), by = g => list.filter(x => x.row.group === g);
    return { crops: list.length, produce: by('produce').length, flowers: by('flower').length, micros: by('micro').length,
      trays: by('micro').reduce((n, x) => n + x.qty, 0), stems: by('flower').reduce((n, x) => n + x.qty, 0), worth: list.reduce((n, x) => n + x.worth, 0), list };
  }

  /** A plain-text availability list, the kind that is pasted into an email or a text to a chef. */
  function text(model, cols, options = {}) {
    const lines = [], farm = options.farm || 'Farm', DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], md = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const heading = c => options.grain === 'month' ? `${MONTHS[c.start.getMonth()]} ${model.year}` : c.i0 === c.i1 ? `${DAYS[c.start.getDay()]} ${md(c.start)}` : `Week of ${md(c.start)} – ${c.start.getMonth() === c.end.getMonth() ? c.end.getDate() : md(c.end)}`;
    lines.push(`${farm} — what is available`);
    for (const c of cols) {
      const list = available(model, c.i0, c.i1, { group: options.group });
      lines.push('', heading(c));
      if (!list.length) { lines.push('  Nothing forecast.'); continue; }
      for (const [g, , title] of GROUPS) {
        const part = list.filter(x => x.row.group === g);
        if (!part.length) continue;
        lines.push(`  ${title}`);
        for (const x of part) {
          const price = options.prices && x.qty > 0 && x.worth > 0 ? ` @ $${(x.worth / x.qty).toFixed(2)}` : '';
          lines.push(`    ${x.row.name}: ${amount(x.qty, x.row.unit, x.row.group)}${price}`);
          if (options.varieties && (x.varieties.length > 1 || (x.varieties.length === 1 && x.varieties[0].id))) for (const v of x.varieties) lines.push(`      ${v.name}: ${amount(v.qty, x.row.unit, x.row.group)}`);
        }
      }
    }
    lines.push('', 'Forecast from the crop plan. Quantities are estimates and move with the weather.');
    return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
  }
  /** The same table as a spreadsheet file. */
  function csv(model, cols, options = {}) {
    const cell = v => { let s = String(v == null ? '' : v); if (/^\s*[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const head = ['Kind', 'Crop', 'Variety', 'Unit', 'Season total', ...cols.map(c => options.grain === 'month' ? `${MONTHS[c.start.getMonth()]} ${model.year}` : E.d2s(c.start))], out = [head];
    const title = Object.fromEntries(GROUPS.map(([g, t]) => [g, t])), n = x => Math.round(x * 100) / 100;
    for (const row of model.rows) {
      if (!(row.total > 0)) continue;
      out.push([title[row.group], row.name, 'All', row.unit, n(row.total), ...cols.map(c => n(sum(row.days, c.i0, c.i1)))]);
      if (row.varieties.length > 1 || (row.varieties[0] && row.varieties[0].id)) for (const v of row.varieties) out.push([title[row.group], row.name, v.name, row.unit, n(v.total), ...cols.map(c => n(sum(v.days, c.i0, c.i1)))]);
    }
    return out.map(r => r.map(cell).join(',')).join('\r\n');
  }
  /** Weeks, between the first and last harvest of some rows, in which nothing is picked: the gaps a succession would fill. */
  function gaps(model, rows) {
    const s = season(model, rows);
    if (!s) return [];
    const out = [];
    let run = null;
    for (const c of periods(model, 'week', s.i0, s.i1)) {
      const any = rows.some(row => sum(row.days, c.i0, c.i1) > 1e-9);
      if (any) { if (run) { out.push(run); run = null; } continue; }
      if (run) { run.end = c.end; run.i1 = c.i1; run.weeks++; } else run = { start: c.start, end: c.end, i0: c.i0, i1: c.i1, weeks: 1 };
    }
    if (run) out.push(run);
    return out;
  }

  return { GROUPS, MONTHS, useOf, useOfBed, follows, build, sum, share, periods, season, available, glance, text, csv, gaps, groupOf, unitWord, shown, amount, monday };
});
