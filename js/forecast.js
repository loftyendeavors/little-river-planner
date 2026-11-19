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
 *   LRFForecast.kept(engine, options)                -> the same as build, worked out once for an engine and its options
 *   LRFForecast.byMonth(engine, cropId)              -> what a crop is forecast to sell, month by month
 *
 * An engine is made afresh for every change to the plan (js/app.js), so a forecast kept for an engine is the forecast of
 * that plan for as long as the engine is the plan's: a change makes a new engine, and the new engine has nothing kept.
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
  const PLURAL = { head: 'heads', bunch: 'bunches', stem: 'stems', bouquet: 'bouquets', tray: 'trays', pint: 'pints', quart: 'quarts', bag: 'bags', case: 'cases', box: 'boxes', each: '', lb: 'lb', oz: 'oz', bu: 'bu', kg: 'kg', g: 'g' };
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
  // Things sold by the piece: a list to send says them in whole numbers. Weighed things keep their decimal below ten.
  const WEIGHED = ['lb', 'oz', 'kg', 'g', 'bu'];
  const counted = unit => !WEIGHED.includes(String(unit || 'each'));
  /** A quantity in the list to send: a thing counted is a whole number, rounded down; one sold singly reads "each". */
  function sendShown(n, unit) { return counted(unit) ? (n > 0 ? Math.floor(n + 1e-6) : 0) : shown(n); }
  function sendAmount(n, unit, group) {
    const v = sendShown(n, unit), w = unitWord(v, unit, group);
    return `${fmt(v)} ${w || 'each'}`;
  }

  /**
   * The forecast for one season. options: { year, groups: the grower's own sorting of crops, use }.
   * rows are one per crop and unit, each with a quantity for every day of the year; a crop that sells more than one thing has a
   * row for each (`thing`: the thing's id, `sold`: its name; the crop's own line has neither).
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
    const keepOf = y => Math.max(1, Math.round((y.keep || 0) * 7));
    for (const p of plan.plantings || []) {
      const r = eng.calc(p);
      if (!r || r.b.active === false || r.g.active === false || !(r.harvestDays > 0)) continue;
      const y0 = eng.yieldOf(p, r);
      if (!y0) continue;                                            // a cover crop: nothing to pick
      // what it gives of each thing the crop sells: the crop's own line alone, as always, unless another thing counts for it.
      // A thing's row is listed with its crop (a flower's bouquets among the flowers), whatever unit the thing is sold by.
      const parts = (eng.soldOf && eng.soldOf(p, r, y0)) || [y0];
      // picked only after the year: a thing first picked before its crop's days to harvest (E2c part 2) may still fall in it
      if (!parts.some(y => at(y.first || r.first) < n)) continue;
      // a planting picked before the year is in it while what it gave is still to sell: stock carried in across Jan 1
      if (!parts.some(y => at(y.last || r.last) + keepOf(y) - 1 >= 0)) continue;
      const personal = useOf(eng, p).personal;
      if (personal) marked++;
      if (use !== 'all' && personal !== (use === 'personal')) continue;
      let any = false;
      for (const part of parts) {
        const y = personal ? { ...part, price: 0 } : part;              // grown for the farm's own table: picked, and not sold
        const crop = eng.crop(p.cropId) || r.c, key = p.cropId + '|' + y.unit + (y.thing ? '|' + y.thing : ''), from = y.first || r.first, to = y.last || r.last;
        let row = rows.get(key);
        if (!row) {
          row = { key, cropId: p.cropId, name: short(crop.name || r.c.name || 'Crop') + (y.thing ? ' · ' + y.name : ''), unit: y.unit, group: groupOf(crop, y.thing ? eng.unitOf(crop) : y.unit, own), color: eng.cropColor(r.c), days: new Float64Array(n), picked: new Float64Array(n), value: new Float64Array(n),
            total: 0, pickedTotal: 0, worth: 0, plantings: [], varieties: new Map(), unset: 0, first: null, last: null, keeps: 0, patterns: new Set(), ...(y.thing ? { thing: y.thing, sold: y.name } : {}),
            // of `days` and `value`: what was picked before Jan 1 and is still to sell (carried in); and what is to sell after Dec 31 (in no figure here)
            carried: new Float64Array(n), carriedValue: new Float64Array(n), carriedTotal: 0, carriedWorth: 0, carriedFrom: [], after: 0, afterWorth: 0 };
          rows.set(key, row);
        }
        // a young stand that gives nothing yet is not a yield that works out to nothing: it is picked from a later year (E2c part 2)
        if (y.set && y.age && !(y.age.share > 0)) continue;
        // a first thing that is left nothing by the others is not a yield that works out to nothing
        if ((!y.set || !(y.units > 0)) && !(parts.length > 1 && y.set)) { row.unset++; unset.push({ p, r, why: y.set ? 'its yield works out to nothing' : 'no yield is set for this crop' }); if (!y.set) continue; }
        // the days it is picked: its harvest period, or a thing's own days (which may start before the planting's first picking)
        const picked = [];
        for (let d = new Date(from), i = at(d); d <= to; d = E.addDays(d, 1), i++) if (y.first || eng.pickedOn(r, d)) picked.push(i);
        if (!picked.length || !(y.units > 0)) continue;
        const rate = y.units / picked.length, vId = p.varietyId || '', v = eng.variety(p.varietyId);
        let variety = row.varieties.get(vId);
        if (!variety) { variety = { id: vId, name: v && v.name ? v.name : 'No variety chosen', days: new Float64Array(n), picked: new Float64Array(n), value: new Float64Array(n), total: 0, worth: 0, carried: new Float64Array(n), carriedValue: new Float64Array(n), carriedTotal: 0, carriedWorth: 0 }; row.varieties.set(vId, variety); }
        // what comes out of the ground each day, and what there is to sell: a crop that keeps is drawn down evenly over the weeks it keeps.
        // `carry` is the part of `avail` picked before the year (a day number below 0): stock carried in, kept apart so it is shown apart
        const keep = keepOf(y), lo = picked[0], span = picked[picked.length - 1] - lo + keep, out = new Float64Array(span), avail = new Float64Array(span), carry = new Float64Array(span);
        const lots = y.pattern === 'once' ? [[lo, y.units]] : picked.map(i => [i, rate]);
        for (const [i, q] of lots) {
          out[i - lo] += q;
          for (let k = 0; k < keep; k++) { avail[i - lo + k] += q / keep; if (i < 0) carry[i - lo + k] += q / keep; }
          const from = i < 0 && i + keep > 0 ? E.addDays(start, i).getFullYear() : null;   // the year a lot still to sell in this one was picked in
          if (from !== null && !row.carriedFrom.includes(from)) row.carriedFrom.push(from);
        }
        let inYear = 0, cut = 0, carried = 0, after = 0;
        for (let k = 0; k < span; k++) {
          const i = lo + k;
          if (i >= n) { after += avail[k]; continue; }
          if (i < 0) continue;
          if (out[k]) { row.picked[i] += out[k]; variety.picked[i] += out[k]; cut += out[k]; }
          if (avail[k]) { row.days[i] += avail[k]; row.value[i] += avail[k] * y.price; variety.days[i] += avail[k]; variety.value[i] += avail[k] * y.price; inYear += avail[k]; }
          if (carry[k]) { row.carried[i] += carry[k]; row.carriedValue[i] += carry[k] * y.price; variety.carried[i] += carry[k]; variety.carriedValue[i] += carry[k] * y.price; carried += carry[k]; }
        }
        row.after += after; row.afterWorth += after * y.price;
        if (!(inYear > 0) && !(cut > 0)) continue;
        row.total += inYear; row.pickedTotal += cut; row.worth += inYear * y.price; variety.total += inYear; variety.worth += inYear * y.price; any = true;
        row.carriedTotal += carried; row.carriedWorth += carried * y.price; variety.carriedTotal += carried; variety.carriedWorth += carried * y.price;
        if (keep > 1) row.keeps = Math.max(row.keeps, y.keep);
        row.patterns.add(y.pattern);
        row.plantings.push({ p, r, units: y.units, inYear, rate, lo, avail, out, carry, carried, pattern: y.pattern, keep: y.keep || 0, i0: Math.max(0, lo), i1: Math.min(n - 1, lo + span - 1), p0: Math.max(0, lo), p1: Math.min(n - 1, picked[picked.length - 1]), price: y.price, personal, ...(y.first ? { from, to } : {}), ...(y.ahead ? { ahead: y.ahead } : {}), ...(y.age && y.age.season < 3 ? { age: y.age } : {}) });
        const a = new Date(Math.max(from, start)), z = new Date(Math.min(to, E.addDays(start, n - 1)));
        if (!row.first || a < row.first) row.first = a;
        if (!row.last || z > row.last) row.last = z;
      }
      if (any) counted++;
    }
    const order = { produce: 0, micro: 1, flower: 2 };
    const list = [...rows.values()].filter(r => r.total > 0 || r.unset).sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name));
    for (const row of list) row.varieties = [...row.varieties.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    // The year's two edges. Carried in: picked before Jan 1, still to sell in the year, and counted in it (in `days`, the totals and
    // the worth, once). After: to sell after Dec 31 from what is picked in the year, picked or still in store: it counts in the next
    // year, where it is carried in, and in no figure of this one. A pound is in the one season it is sold in.
    const edge = (q, w) => { const crops = list.filter(r => r[q] > 1e-9); return { crops: crops.map(r => r.name), total: crops.reduce((t, r) => t + r[q], 0), worth: crops.reduce((t, r) => t + r[w], 0) }; };
    for (const row of list) row.carriedFrom.sort((a, b) => a - b);
    const carried = { ...edge('carriedTotal', 'carriedWorth'), years: [...new Set(list.filter(r => r.carriedTotal > 1e-9).flatMap(r => r.carriedFrom))].sort((a, b) => a - b) }, after = edge('after', 'afterWorth');
    return { year, start, days: n, rows: list, unset, counted, use, personal: marked, keeps: list.some(r => r.keeps > 0), carried, after, date: i => E.addDays(start, i), index: at };
  }

  // ── the forecast kept for an engine and its options ──
  const KEPT = new WeakMap();
  /** The options build reads, said the one way: two calls that would build the same forecast ask for the same kept one. */
  function keyOf(eng, options = {}) {
    const plan = eng.plan || {}, year = +options.year || +(plan.settings && plan.settings.year) || new Date().getFullYear();
    const use = options.use === 'commercial' || options.use === 'personal' ? options.use : 'all';
    return JSON.stringify([year, use, options.groups || null]);
  }
  /**
   * The forecast of an engine's plan, worked out the first time it is asked for with these options and kept with the engine.
   * It is build's own result: the same rows, the same figures. Nothing in it is to be changed by the caller.
   */
  function kept(eng, options = {}) {
    let mine = KEPT.get(eng);
    if (!mine) { mine = new Map(); KEPT.set(eng, mine); }
    const key = keyOf(eng, options);
    if (!mine.has(key)) mine.set(key, build(eng, options));
    return mine.get(key);
  }
  /** Is a forecast with these options kept for this engine? (For the checks: a change to the plan leaves nothing kept.) */
  const isKept = (eng, options = {}) => !!(KEPT.get(eng) && KEPT.get(eng).has(keyOf(eng, options)));
  /**
   * What one crop is forecast to sell, month by month, in one call: its plantings grown to sell, as there is to sell each month
   * (what keeps is counted in the months it is sold). One line a unit or thing the crop is sold as, each with twelve amounts and
   * twelve dollar figures, January first. options: { year }.
   */
  function byMonth(eng, cropId, options = {}) {
    const m = kept(eng, { year: options.year, use: 'commercial' }), months = [];
    for (let k = 0; k < 12; k++) months.push([m.index(new Date(m.year, k, 1)), m.index(new Date(m.year, k + 1, 0))]);
    const rows = m.rows.filter(r => r.cropId === cropId).map(r => ({ key: r.key, name: r.name, unit: r.unit, ...(r.thing ? { thing: r.thing } : {}),
      sold: months.map(([a, z]) => sum(r.days, a, z)), worth: months.map(([a, z]) => sum(r.value, a, z)) }));
    return { year: m.year, cropId, months: MONTHS.slice(), rows };
  }

  /**
   * How much of one planting falls between two days: of what there is to sell, or (`picked`) of what comes out of the ground.
   * part: 'carried', only what was picked before the year; 'own', what there is to sell without that; otherwise all of it.
   */
  function share(x, i0, i1, picked, part) {
    const series = picked ? x.out : x.avail, carry = !picked && x.carry && (part === 'carried' || part === 'own') ? x.carry : null;
    let total = 0;
    for (let i = Math.max(i0, x.lo), end = Math.min(i1, x.lo + series.length - 1); i <= end; i++) total += part === 'carried' ? (carry ? carry[i - x.lo] : 0) : series[i - x.lo] - (carry ? carry[i - x.lo] : 0);
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
  /** How many crops some rows stand for: a crop that sells more than one thing has a row for each, and is one crop. */
  const cropCount = rows => rows.filter(r => !r.thing).length + new Set(rows.filter(r => r.thing && !rows.some(q => !q.thing && q.cropId === r.cropId)).map(r => r.cropId)).size;
  /** Does a row add to the stems? Another thing a flower sells does only where it is itself counted in stems (a bouquet is not a stem). */
  const inStems = row => !row.thing || /^(each|stems?)$/i.test(String(row.unit));
  /** The headline figures for a stretch of days. Flowers add up as stems; microgreens as trays; vegetables only as a count of crops and a value. */
  function glance(model, i0, i1) {
    const list = available(model, i0, i1), by = g => list.filter(x => x.row.group === g), crops = part => cropCount(part.map(x => x.row));
    return { crops: crops(list), produce: crops(by('produce')), flowers: crops(by('flower')), micros: crops(by('micro')),
      trays: by('micro').reduce((n, x) => n + x.qty, 0), stems: by('flower').filter(x => inStems(x.row)).reduce((n, x) => n + x.qty, 0), worth: list.reduce((n, x) => n + x.worth, 0), list };
  }

  /** The entries a grower sees in one period of the list to send, shared by text and spreadsheet. */
  function offered(model, col, options) {
    const out = [];
    for (const { row, qty, worth, varieties } of available(model, col.i0, col.i1, options)) {
      const amount = sendShown(qty, row.unit);
      if (amount <= 0) continue;
      const breakdown = options.varieties && (varieties.length > 1 || (varieties.length === 1 && varieties[0].id));
      const listed = breakdown ? varieties.map(v => ({ ...v, amount: sendShown(v.qty, row.unit) })).filter(v => v.amount > 0) : [];
      out.push({ row, amount, price: options.prices && worth > 0 ? (worth / qty).toFixed(2) : '', breakdown, varieties: listed });
    }
    return out;
  }

  /** A plain-text availability list, the kind that is pasted into an email or a text to a chef. */
  function text(model, cols, options = {}) {
    const lines = [], farm = options.farm || 'Farm', DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], md = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const heading = c => options.grain === 'month' ? `${MONTHS[c.start.getMonth()]} ${model.year}` : c.i0 === c.i1 ? `${DAYS[c.start.getDay()]} ${md(c.start)}` : `Week of ${md(c.start)} – ${c.start.getMonth() === c.end.getMonth() ? c.end.getDate() : md(c.end)}`;
    lines.push(`${farm} — what is available`);
    for (const c of cols) {
      const list = offered(model, c, options);
      lines.push('', heading(c));
      if (!list.length) { lines.push('  Nothing forecast.'); continue; }
      for (const [g, , title] of GROUPS) {
        const part = list.filter(x => x.row.group === g);
        if (!part.length) continue;
        lines.push(`  ${title}`);
        for (const x of part) {
          const price = x.price ? ` @ $${x.price}` : '';
          lines.push(`    ${x.row.name}: ${sendAmount(x.amount, x.row.unit, x.row.group)}${price}`);
          for (const v of x.varieties) lines.push(`      ${v.name}: ${sendAmount(v.amount, x.row.unit, x.row.group)}`);
        }
      }
    }
    lines.push('', 'Forecast from the crop plan. Quantities are estimates and move with the weather.');
    return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
  }
  /** The reviewed list as a spreadsheet, with a quantity and optional unit price per selected period. */
  function csv(model, cols, options = {}) {
    const cell = v => { let s = String(v == null ? '' : v); if (/^\s*[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const dates = cols.flatMap(c => {
      const label = options.grain === 'month' ? `${MONTHS[c.start.getMonth()]} ${model.year}` : E.d2s(c.start);
      return options.prices ? [label, `${label} unit price (USD)`] : [label];
    });
    const out = [['Kind', 'Crop', 'Variety', 'Unit', ...dates]];
    const title = Object.fromEntries(GROUPS.map(([g, t]) => [g, t])), rows = new Map();
    for (const [i, c] of cols.entries()) {
      for (const item of offered(model, c, options)) {
        const { row, varieties } = item;
        if (!rows.has(row)) rows.set(row, { crop: [], varieties: new Map() });
        const record = rows.get(row);
        record.crop[i] = item;
        for (const v of varieties) {
          if (!record.varieties.has(v.id)) record.varieties.set(v.id, []);
          record.varieties.get(v.id)[i] = v;
        }
      }
    }
    const figures = (entries, crop = []) => cols.flatMap((_, i) => {
      // Blank means the preview gave only a crop total. Zero means this row had nothing to offer.
      const item = entries[i], amount = item?.amount ?? (crop[i] && !crop[i].breakdown ? '' : 0);
      return options.prices ? [amount, item?.price || ''] : [amount];
    });
    for (const row of model.rows) {
      const record = rows.get(row);
      if (!record) continue;
      out.push([title[row.group], row.name, 'All', row.unit, ...figures(record.crop)]);
      for (const v of row.varieties) {
        const entries = record.varieties.get(v.id);
        if (entries) out.push([title[row.group], row.name, v.name, row.unit, ...figures(entries, record.crop)]);
      }
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

  return { GROUPS, MONTHS, useOf, useOfBed, follows, build, kept, isKept, byMonth, sendAmount, sendShown, counted, sum, share, periods, season, available, glance, text, csv, gaps, groupOf, unitWord, shown, amount, monday, cropCount, inStems };
});
