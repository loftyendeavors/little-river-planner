/* Physical water and fertilizer records. Store measured quantities and the recipe as used.
 * A report has its own identity. Reports can describe one physical job; only that job draws stock. */
(function (root) {
  'use strict';
  const values = map => Object.values(map || {});
  const put = (book, table, row) => ({ ...book, [table]: { ...book[table], [row.id]: row } });
  const sortTime = (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
  const scopeKey = report => JSON.stringify([...(report.beds || [])].sort());
  const stationKey = r => r.controller && r.station ? JSON.stringify([r.controller.trim().toLowerCase(),r.station]) : '';
  function sameRunEvidence(a, b) {
    return ['elapsed','planned','meter','status','source','rate'].every(key=>(a[key] ?? null)===(b[key] ?? null)) && scopeKey(a)===scopeKey(b) && stationKey(a)===stationKey(b);
  }
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
    for (const r of values(book.reports).filter(r=>r.kind===kind && !book.voids?.[r.id]).sort((a,b) => a.entered.localeCompare(b.entered) || a.id.localeCompare(b.id))) {
      const groupId = book.review?.[r.id] === 'separate' ? r.id : r.job;
      if (book.cancelled?.[groupId]) continue;
      if (!byJob.has(groupId)) byJob.set(groupId, []);
      byJob.get(groupId).push(r);
    }
    const result = Array.from(byJob, ([id, reports]) => {
      const chosen = reports.find(r => r.id === book.accepted?.[id]) || reports[0];
      const pending = reports.filter(r => r.id === chosen.id || !book.review?.[r.id]);
      const differing = key => new Set(pending.map(r=>r[key]).filter(v=>v!=null)).size > 1;
      const meterStations = new Set(pending.map(stationKey).filter(Boolean));
      const meterConflict = kind === 'run' && (differing('meter') || meterStations.size>1);
      const workConflict = kind === 'run' && (differing('status') || differing('elapsed'));
      // A missing rate can be an explicit choice to omit today's setting on a past run.
      const rateConflict = kind === 'run' && chosen.status!=='Skipped' && pending.every(r=>r.meter==null)
        && new Set(pending.map(r=>r.rate ?? null)).size>1;
      const scopeConflict = kind === 'run' && new Set(pending.map(scopeKey)).size>1;
      const planned = kind === 'run' && !differing('planned') ? pending.find(r => r.planned != null)?.planned ?? null : null;
      const unsettled = pending.filter(r => r.id !== chosen.id && (
        kind === 'refill' && (!r.reminder || !chosen.reminder || r.at.slice(0,16) !== chosen.at.slice(0,16) || JSON.stringify(r.items) !== JSON.stringify(chosen.items) || r.remainder !== chosen.remainder || r.gallons !== chosen.gallons) ||
        kind === 'run' && (r.elapsed !== chosen.elapsed || r.status !== chosen.status || differing('planned') || meterConflict || rateConflict || scopeConflict) ||
        kind === 'spread' && JSON.stringify(r.items) !== JSON.stringify(chosen.items) ||
        (kind === 'delivery' || kind === 'count') && (r.items[r.productId].lb !== chosen.items[chosen.productId].lb ||
          kind === 'delivery' && r.at.slice(0,16) !== chosen.at.slice(0,16))));
      return { id, chosen, reports, unsettled, meterConflict, workConflict, rateConflict, planned, pending };
    }).sort((a, b) => sortTime(a.chosen, b.chosen));
    if (kind === 'run') {
      const byStationTime = new Map();
      for (const group of result) {
        for (const r of group.pending) {
          const station = stationKey(r);
          if (!station) continue;
          const key = JSON.stringify([station,r.at.slice(0,16)]);
          if (!byStationTime.has(key)) byStationTime.set(key,new Set());
          byStationTime.get(key).add(group);
        }
      }
      for (const matches of byStationTime.values()) {
        if (matches.size<2) continue;
        for (const g of matches) {
          g.workConflict=true;
          g.overlap=[...new Set([...(g.overlap || []),...[...matches].map(m=>m.id)])];
        }
      }
    }
    return result;
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
    const elapsed = opts.status === 'Skipped' && (opts.elapsed == null || opts.elapsed === '') ? 0 : number(opts.elapsed, 'elapsed minutes');
    const planned = opts.planned === '' || opts.planned == null ? null : number(opts.planned, 'planned minutes');
    const meter = opts.meter === '' || opts.meter == null ? null : number(opts.meter, 'metered gallons');
    if (!['Completed','Interrupted','Skipped'].includes(opts.status)) throw Error('Choose a run status.');
    if (opts.status === 'Skipped' && (elapsed || meter)) throw Error('A skipped run has no elapsed time or metered water.');
    return { id: opts.id, job: JSON.stringify([zone.id, opts.at]), kind: 'run', gardenId: zone.gardenId, zoneId: zone.id, beds: [...(zone.beds || [])], label: zone.name,
      at: opts.at, entered: opts.entered, status: opts.status, elapsed, planned, meter, rate: zone.rate ?? null, source: opts.source };
  }
  function water(group) {
    const r = group.chosen;
    if (group.workConflict) return { gallons: null, basis: 'Run details disputed' };
    if (r.status === 'Skipped') return { gallons: 0, basis: 'Skipped' };
    if (group.meterConflict) return { gallons: null, basis: 'Conflicting meter readings' };
    if (group.rateConflict) return { gallons: null, basis: 'Conflicting rated flow' };
    const metered = r.meter ?? (group.pending || group.reports).find(x => x.meter != null && x.elapsed === r.elapsed && x.status === r.status)?.meter;
    if (metered != null) return { gallons: metered, basis: 'Metered' };
    if (r.rate != null) return { gallons: r.rate * r.elapsed, basis: 'Estimated' };
    return { gallons: null, basis: 'Unknown' };
  }
  function runSummary(groups) {
    const total = { started: 0, skipped: 0, interrupted: 0, minutes: 0, disputed: 0,
      metered: null, estimated: null, unknown: 0, reviews: [] };
    for (const group of groups) {
      const r = group.chosen;
      if (group.unsettled.length || group.overlap) total.reviews.push(group);
      if (group.workConflict) {
        total.disputed++;
      } else if (r.status === 'Skipped') {
        total.skipped++;
        continue;
      } else {
        total.started++;
        total.minutes += r.elapsed;
        if (r.status === 'Interrupted') total.interrupted++;
      }
      const amount = water(group);
      if (amount.gallons == null) total.unknown++;
      else if (amount.basis === 'Metered') total.metered = (total.metered || 0) + amount.gallons;
      else if (amount.basis === 'Estimated') total.estimated = (total.estimated || 0) + amount.gallons;
    }
    return total;
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
  function stockEntry(product, kind, input) {
    if (!['count','delivery'].includes(kind)) throw Error('Choose a shelf count or a delivery.');
    if ([input.bags,input.loose].every(x=>x==null || x==='')) throw Error('Enter a bag count or loose pounds. Enter 0 for an empty shelf.');
    const bags=number(input.bags || 0,'the number of full bags'), loose=number(input.loose || 0,'the loose pounds');
    if (!Number.isSafeInteger(bags)) throw Error('Enter whole bags and put the rest under loose pounds.');
    const lb=bags*product.bag+loose;
    if (!Number.isFinite(lb) || (kind==='delivery' && lb===0)) throw Error('Enter a positive delivery weight.');
    const reference=String(input.reference || '').trim();
    const key=kind==='delivery' && reference ? ['ref',reference.toLowerCase()] : ['time',input.at.slice(0,16)];
    return {id:input.id,job:JSON.stringify([kind,product.id,...key]),kind,productId:product.id,at:input.at,entered:input.entered,
      label:product.name,reference,bags,bagLb:product.bag,loose,items:{[product.id]:{name:product.name,lb}}};
  }
  function difference(a,b) {
    const diff=a-b;
    return Math.abs(diff)<=Number.EPSILON*Math.max(Math.abs(a),Math.abs(b))*4?0:diff;
  }
  function stockGroups(book) {
    return ['refill','spread','delivery','count'].flatMap(kind=>groups(book,kind));
  }
  function stock(book, productId, accepted=stockGroups(book)) {
    const rows=values(book.receipts).filter(r=>r.productId===productId).map(r=>({
      id:r.id,kind:'legacy',at:r.at,label:'Stock added',lb:r.lb,review:false
    }));
    for(const group of accepted) {
      const chosen=group.chosen, item=chosen.items?.[productId], review=group.unsettled.length>0;
      if (!item && !(review && group.reports.some(r=>r.items?.[productId]))) continue;
      rows.push({id:group.id,kind:chosen.kind,at:chosen.at,label:chosen.label,lb:item?item.lb:0,review,group});
    }
    rows.sort(sortTime);
    let used=0, received=0, available=0, drawn=0, anchored=false, uncertain=false, review=false, timing=false;
    function orderUnclear(count) {
      const times=r=>(r.group?.pending || [r]).map(x=>x.at);
      const countTimes=times(count);
      return rows.some(r=>{
        if(r.kind==='count') return false;
        let before=false, after=false;
        for(const t of times(r)) for(const c of countTimes) {
          if(t===c || ((t.endsWith(':00.000Z') || c.endsWith(':00.000Z')) && t.slice(0,16)===c.slice(0,16))) return true;
          if(t<c) before=true; else after=true;
        }
        return before && after;
      });
    }
    for(const r of rows) {
      const debit=r.kind==='refill' || r.kind==='spread';
      if (r.kind==='count') {
        anchored=true; available=r.lb; drawn=0; uncertain=false; timing=orderUnclear(r); review=r.review || timing;
      } else {
        if (debit) used+=r.lb || 0; else received+=r.lb;
        if (r.kind==='legacy') anchored=true;
        if (debit) drawn+=r.lb || 0; else available+=r.lb;
        uncertain ||= r.lb==null;
        review ||= r.review;
      }
      r.balance=anchored?difference(available,drawn):null;
      r.provisional=uncertain || review;
    }
    return {received,used,balance:anchored?difference(available,drawn):null,uncertain,review,timing,rows};
  }
  function purchase(product, inventory, demand, spare) {
    const needed=number(demand,'planned product pounds'), reserve=number(spare,'the spare percentage',0,100);
    const gross=needed*(1+reserve/100);
    if (inventory.balance==null || inventory.uncertain || inventory.review || inventory.balance<0) {
      return {gross,short:null,bags:null};
    }
    const short=Math.max(0,difference(gross,inventory.balance));
    // Make decimal pack boundaries insensitive to IEEE-754 arithmetic.
    const packs=short/product.bag;
    const nearest=Math.round(packs);
    return {gross,short,bags:nearest>0 && Math.abs(packs-nearest)<=Number.EPSILON*packs*4 ? nearest : Math.ceil(packs)};
  }
  const api = { values, put, number, name, product, recipe, snapshot, groups, lastMix, cycle, reminder, refill, run, water, runSummary, sameRunEvidence, stock, occurrence, nextJob, targetPounds, nutrientTotals, recipeConcentration, tapeFlow, zoneRate, stockEntry, stockGroups, purchase };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFWaterFeed = api;
})(typeof self !== 'undefined' ? self : this);
