/* Little River Farm Planner — the harvest forecast.
 *
 * What the plan is expected to yield, day by day: every planting's marketable yield (engine.yieldOf)
 * spread evenly over the days it is picked, then added up by crop. A crop is counted in its own unit
 * (heads, bunches, pounds, stems, trays) and different units are never added together.
 *
 * Three kinds of thing are forecast, because that is how they are sold: vegetables (with herbs and
 * fruit), microgreen trays, and flower stems.
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
   * The forecast for one season. options: { year, groups: the grower's own sorting of crops }.
   * rows are one per crop and unit, each with a quantity for every day of the year.
   */
  function build(eng, options = {}) {
    const plan = eng.plan, year = +options.year || +(plan.settings && plan.settings.year) || new Date().getFullYear();
    const start = new Date(year, 0, 1), n = Math.round(E.dayDiff(new Date(year + 1, 0, 1), start)), own = options.groups || (plan.lrfNext && plan.lrfNext.groups) || null;
    const rows = new Map(), unset = [], at = d => Math.round(E.dayDiff(d, start));
    let counted = 0;
    for (const p of plan.plantings || []) {
      const r = eng.calc(p);
      if (!r || r.b.active === false || r.g.active === false || !(r.harvestDays > 0) || r.last < start || at(r.first) >= n) continue;
      const y = eng.yieldOf(p, r);
      if (!y) continue;                                             // a cover crop: nothing to pick
      const crop = eng.crop(p.cropId) || r.c, key = p.cropId + '|' + y.unit;
      let row = rows.get(key);
      if (!row) {
        row = { key, cropId: p.cropId, name: short(crop.name || r.c.name || 'Crop'), unit: y.unit, group: groupOf(crop, y.unit, own), color: eng.cropColor(r.c), days: new Float64Array(n), value: new Float64Array(n),
          total: 0, worth: 0, plantings: [], varieties: new Map(), unset: 0, first: null, last: null };
        rows.set(key, row);
      }
      if (!y.set || !(y.units > 0)) { row.unset++; unset.push({ p, r, why: y.set ? 'its yield works out to nothing' : 'no yield is set for this crop' }); if (!y.set) continue; }
      // the days it is picked: its harvest period
      const picked = [];
      for (let d = new Date(r.first), i = at(d); d <= r.last; d = E.addDays(d, 1), i++) if (eng.pickedOn(r, d)) picked.push(i);
      if (!picked.length || !(y.units > 0)) continue;
      const rate = y.units / picked.length, vId = p.varietyId || '', v = eng.variety(p.varietyId);
      let variety = row.varieties.get(vId);
      if (!variety) { variety = { id: vId, name: v && v.name ? v.name : 'No variety chosen', days: new Float64Array(n), total: 0 }; row.varieties.set(vId, variety); }
      let inYear = 0;
      for (const i of picked) { if (i < 0 || i >= n) continue; row.days[i] += rate; row.value[i] += rate * y.price; variety.days[i] += rate; inYear += rate; }
      if (!(inYear > 0)) continue;
      row.total += inYear; row.worth += inYear * y.price; variety.total += inYear; counted++;
      row.plantings.push({ p, r, units: y.units, inYear, rate, i0: Math.max(0, picked[0]), i1: Math.min(n - 1, picked[picked.length - 1]), price: y.price });
      const a = new Date(Math.max(r.first, start)), z = new Date(Math.min(r.last, E.addDays(start, n - 1)));
      if (!row.first || a < row.first) row.first = a;
      if (!row.last || z > row.last) row.last = z;
    }
    const order = { produce: 0, micro: 1, flower: 2 };
    const list = [...rows.values()].filter(r => r.total > 0 || r.unset).sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name));
    for (const row of list) row.varieties = [...row.varieties.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { year, start, days: n, rows: list, unset, counted, date: i => E.addDays(start, i), index: at };
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

  return { GROUPS, MONTHS, build, sum, periods, season, available, glance, text, csv, gaps, groupOf, unitWord, shown, amount, monday };
});
