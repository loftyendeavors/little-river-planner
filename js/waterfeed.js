/* Physical water and fertilizer records. Store measured quantities and the recipe as used.
 * A report has its own identity. Reports can describe one physical job; only that job draws stock. */
(function (root) {
  'use strict';
  const values = map => Object.values(map || {});
  const put = (book, table, row) => ({ ...book, [table]: { ...book[table], [row.id]: row } });
  const sortTime = (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
  function number(raw, label, min = 0, max = Infinity) {
    if (raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < min || Number(raw) > max)
      throw Error('Enter ' + label + (min > 0 ? ' greater than zero.' : ' within its range.'));
    return Number(raw);
  }
  function name(raw, what) {
    const text = String(raw || '').trim();
    if (!text) throw Error('Enter ' + what + '.');
    return text;
  }
  function product(id, fields) {
    const row = { id, name: name(fields.name, 'a product name'), bag: number(fields.bag, 'bag weight', 0.000001) };
    for (const key of ['n', 'p', 'k']) row[key] = fields[key] == null || fields[key] === '' ? null : number(fields[key], 'a label percentage from 0 to 100', 0, 100);
    return row;
  }
  function recipe(id, fields, book) {
    const items = {}, gallons = number(fields.gallons, 'the final stock volume', 0.000001);
    for (const [key, amount] of Object.entries(fields.items || {})) {
      if (amount === '' || amount == null) continue;
      if (!book.products?.[key]) throw Error('Choose a product from Assumptions.');
      items[key] = number(amount, 'a product weight', 0.000001);
    }
    if (!Object.keys(items).length) throw Error('Add at least one product and its weight.');
    return { id, name: name(fields.name, 'a recipe name'), gallons, items };
  }
  function snapshot(book, recipeId, gallons) {
    const rec = book.recipes?.[recipeId];
    if (!rec) throw Error('Choose a saved recipe first.');
    const items = {};
    for (const [id, pounds] of Object.entries(rec.items)) {
      const p = book.products?.[id];
      if (!p) throw Error('The recipe refers to a missing product.');
      items[id] = { name: p.name, lb: pounds * gallons / rec.gallons, n: p.n, p: p.p, k: p.k };
    }
    return items;
  }
  function groups(book, kind) {
    const byJob = new Map();
    for (const r of values(book.reports).sort((a,b) => a.entered.localeCompare(b.entered) || a.id.localeCompare(b.id))) {
      if (r.kind !== kind || book.voids?.[r.id]) continue;
      const groupId = book.review?.[r.id] === 'separate' ? r.id : r.job;
      if (book.cancelled?.[groupId]) continue;
      if (!byJob.has(groupId)) byJob.set(groupId, []);
      byJob.get(groupId).push(r);
    }
    return Array.from(byJob, ([id, reports]) => {
      const chosen = reports.find(r => r.id === book.accepted?.[id]) || reports[0];
      const pending = reports.filter(r => r.id === chosen.id || !book.review?.[r.id]);
      const differing = key => new Set(pending.map(r=>r[key]).filter(v=>v!=null)).size > 1;
      const meterConflict = kind === 'run' && differing('meter');
      const unsettled = pending.filter(r => r.id !== chosen.id && (
        kind === 'refill' && (!r.reminder || !chosen.reminder || r.at.slice(0,16) !== chosen.at.slice(0,16) || JSON.stringify(r.items) !== JSON.stringify(chosen.items) || r.remainder !== chosen.remainder || r.gallons !== chosen.gallons) ||
        kind === 'run' && (r.elapsed !== chosen.elapsed || r.status !== chosen.status || differing('planned') || meterConflict) ||
        kind === 'spread' && JSON.stringify(r.items) !== JSON.stringify(chosen.items)));
      return { id, chosen, reports, unsettled, meterConflict, reviewed: !!book.accepted?.[id] };
    }).sort((a, b) => sortTime(a.chosen, b.chosen));
  }
  const lastMix = (book, tankId) => groups(book, 'refill').filter(g => g.chosen.tankId === tankId).at(-1);
  // Two phones can both know the last accepted refill. A later upload does not start a new cycle.
  // The cycle number is derived from a stable physical group, independent of which report was accepted.
  function cycle(book, tankId) {
    const last = lastMix(book, tankId);
    if (!last) return JSON.stringify([tankId, 'initial']);
    // Hash the physical group ID to keep chained offline identifiers short across seasons.
    let a = 2166136261, b = 5381;
    for (const c of last.id) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
    return JSON.stringify([tankId, (a >>> 0).toString(36), (b >>> 0).toString(36)]);
  }
  function nextJob(book, anchor) {
    let key = anchor, attempt = 0;
    while (book.cancelled?.[key]) key = anchor + '~' + (++attempt);
    return key;
  }
  function occurrence(book, tankId, at, fallback) {
    const mixes = groups(book,'refill').filter(g => g.chosen.tankId === tankId);
    const minute = at.slice(0,16);
    const sameTime = mixes.find(g => g.reports.some(r => r.at.slice(0,16) === minute));
    if (sameTime) return sameTime.id;
    const latest = mixes.at(-1);
    return latest && at < latest.chosen.at ? JSON.stringify([tankId, minute]) : fallback;
  }
  function reminder(book, tankId) {
    const key = cycle(book, tankId);
    return values(book.requests).find(r => r.cycle === key);
  }
  function refill(book, tank, opts) {
    const remaining = opts.remainder == null || opts.remainder === '' ? null : number(opts.remainder, 'measured gallons remaining');
    const gallons = opts.actual && (opts.gallons == null || opts.gallons === '') ? null : number(opts.gallons, 'final stock gallons', 0.000001);
    if (remaining != null && gallons != null && remaining > gallons) throw Error('The remainder exceeds the final stock volume.');
    const items = opts.actual ? {} : snapshot(book, tank.recipeId, gallons - (remaining || 0));
    if (opts.actual) {
      for (const [id, raw] of Object.entries(opts.actual)) {
        const p = book.products?.[id];
        if (!p) throw Error('Choose a saved product.');
        items[id] = { name: p.name, n: p.n, p: p.p, k: p.k, lb: raw === '' || raw == null ? null : number(raw, 'actual fresh pounds') };
      }
    }
    return { id: opts.id, job: opts.job, at: opts.at, entered: opts.entered, kind: 'refill', gardenId: tank.gardenId,
      tankId: tank.id, beds: [...(tank.beds || [])], label: tank.name, recipe: book.recipes[tank.recipeId].name, gallons, remainder: remaining,
      reminder: !!opts.reminder, items };
  }
  function run(zone, opts) {
    const elapsed = number(opts.elapsed, 'elapsed minutes'), planned = opts.planned === '' || opts.planned == null ? null : number(opts.planned, 'planned minutes');
    const meter = opts.meter === '' || opts.meter == null ? null : number(opts.meter, 'metered gallons');
    if (!['Completed','Interrupted','Skipped'].includes(opts.status)) throw Error('Choose a run status.');
    if (opts.status === 'Skipped' && (elapsed || meter)) throw Error('A skipped run has no elapsed time or metered water.');
    return { id: opts.id, job: JSON.stringify([zone.id, opts.at]), kind: 'run', gardenId: zone.gardenId, zoneId: zone.id, beds: [...(zone.beds || [])], label: zone.name,
      at: opts.at, entered: opts.entered, status: opts.status, elapsed, planned, meter, rate: zone.rate ?? null, source: opts.source };
  }
  function water(group) {
    const r = group.chosen;
    if (r.status === 'Skipped') return { gallons: 0, basis: 'Skipped' };
    if (group.meterConflict) return { gallons: null, basis: 'Conflicting meter readings' };
    const metered = r.meter ?? (!group.reviewed ? group.reports.find(x => x.meter != null && x.elapsed === r.elapsed && x.status === r.status)?.meter : null);
    if (metered != null) return { gallons: metered, basis: 'Metered' };
    if (r.rate != null) return { gallons: r.rate * r.elapsed, basis: 'Estimated' };
    return { gallons: null, basis: 'Unknown' };
  }
  // Convert a grower's chosen per-acre rate using the area to which it applies.
  function targetPounds(area, rates) {
    const acres = number(area, 'the treated area', 0.000001) / 43560;
    return Object.fromEntries(['n','p','k'].map(key => [key, rates[key] == null || rates[key] === '' ? null : acres * number(rates[key], 'the target rate')]));
  }
  function nutrientTotals(items) {
    return Object.fromEntries(['n','p','k'].map(key => {
      let pounds = 0;
      for (const item of values(items)) {
        if (item.lb === 0 || item[key] === 0) continue;
        if (item.lb == null || item[key] == null) return [key,null];
        pounds += item.lb * item[key] / 100;
      }
      return [key,pounds];
    }));
  }
  // A recipe's label-basis contribution at the entered dilution, using US liquid gallons.
  // This describes the recipe only. Measured source water and delivery are separate observations.
  function recipeConcentration(book, recipeId, ratio) {
    const dilution = number(ratio, 'the injector dilution denominator', 1);
    const lbPerGallon = nutrientTotals(snapshot(book,recipeId,1));
    const mgPerL = 453592.37 / 3.785411784;
    return Object.fromEntries(Object.entries(lbPerGallon).map(([key,lb]) =>
      [key, lb == null ? null : lb * mgPerL / dilution]));
  }
  function tapeFlow(beds, lines, ratedPerHundredFt) {
    const count = number(lines, 'the number of tape lines per bed', 1);
    if (!Number.isInteger(count)) throw Error('Enter a whole number of tape lines per bed.');
    const rate = number(ratedPerHundredFt, 'the rated tape flow', 0.000001);
    if (!beds.length) throw Error('Select the beds watered by this zone.');
    return beds.reduce((flow,bed) => flow + number(bed.l,'the served bed length',0.000001) * count * rate / 100,0);
  }
  function zoneRate(zone, beds) {
    if (zone.tapeRate == null) return zone.rate ?? null;
    const served = (zone.beds || []).map(id => beds.find(bed=>bed.id===id && bed.gardenId===zone.gardenId));
    if (!served.length || served.some(bed=>!bed || !(bed.l>0))) return null;
    return tapeFlow(served,zone.lines,zone.tapeRate);
  }
  function stock(book, productId) {
    const receipts = values(book.receipts).filter(r => r.productId === productId);
    let used = 0, uncertain = false, review = false;
    for (const group of groups(book, 'refill')) {
      const item = group.chosen.items[productId];
      if (group.unsettled.length && group.reports.some(r => r.items[productId])) review = true;
      if (!item) continue;
      if (item.lb == null) uncertain = true; else used += item.lb;
      if (group.unsettled.length) review = true;
    }
    for (const group of groups(book,'spread')) {
      used += group.chosen.items[productId]?.lb || 0;
      if(group.unsettled.length && group.reports.some(r=>r.items[productId])) review=true;
    }
    const received = receipts.reduce((sum, r) => sum + r.lb, 0);
    return { received, used, balance: receipts.length ? received - used : null, uncertain, review };
  }
  const api = { values, put, number, name, product, recipe, snapshot, groups, lastMix, cycle, reminder, refill, run, water, stock, occurrence, nextJob, targetPounds, nutrientTotals, recipeConcentration, tapeFlow, zoneRate };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFWaterFeed = api;
})(typeof self !== 'undefined' ? self : this);
