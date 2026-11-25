/* Physical water and fertilizer records. Store measured quantities and the recipe as used.
 * A report has its own identity. Reports can describe one physical job; only that job draws stock. */
(function (root) {
  'use strict';
  const values = map => Object.values(map || {});
  const put = (book, table, row) => ({ ...book, [table]: { ...book[table], [row.id]: row } });
  const sortTime = (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
  const scopeKey = report => JSON.stringify([...(report.beds || [])].sort());
  const stationKey = r => r.controller && r.station ? JSON.stringify([r.controller.trim().toLowerCase(),r.station]) : '';
  function feedKey(feed) {
    if (!feed) return '';
    return JSON.stringify([feed.mode,feed.tankId,feed.ratio,feed.treated,
      Object.entries(feed.stock || {}).sort(([a],[b])=>a.localeCompare(b)).map(([id,r])=>[id,r.lb,r.n,r.p,r.k])]);
  }
  function sameRunEvidence(a, b) {
    return ['elapsed','planned','meter','status','source','rate'].every(key=>(a[key] ?? null)===(b[key] ?? null)) && scopeKey(a)===scopeKey(b) && stationKey(a)===stationKey(b) && feedKey(a.feed)===feedKey(b.feed);
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
    const row = { id, name: name(fields.name, 'a product name'), bag: fields.bag==null || fields.bag==='' ? null : number(fields.bag, 'bag weight', 0.000001) };
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
      const elapsed=kind==='run' && !workConflict ? pending.find(r=>r.elapsed!=null)?.elapsed ?? null : null;
      // A missing rate can be an explicit choice to omit today's setting on a past run.
      const rateConflict = kind === 'run' && chosen.status!=='Skipped' && pending.every(r=>r.meter==null)
        && new Set(pending.map(r=>r.rate ?? null)).size>1;
      const scopeConflict = kind === 'run' && new Set(pending.map(scopeKey)).size>1;
      const feedReports=pending.filter(r=>r.feed);
      const reportedMeter=pending.find(r=>r.meter!=null)?.meter;
      const feedConflict=kind==='run' && (new Set(feedReports.map(r=>feedKey(r.feed))).size>1 ||
        (reportedMeter!=null && feedReports.some(r=>r.feed.mode==='part' && r.feed.treated>reportedMeter)));
      const planned = kind === 'run' && !differing('planned') ? pending.find(r => r.planned != null)?.planned ?? null : null;
      const unsettled = pending.filter(r => r.id !== chosen.id && (
        kind === 'refill' && (!r.reminder || !chosen.reminder || r.at.slice(0,16) !== chosen.at.slice(0,16) || JSON.stringify(r.items) !== JSON.stringify(chosen.items) || r.remainder !== chosen.remainder || r.gallons !== chosen.gallons) ||
        kind === 'run' && (workConflict || differing('planned') || meterConflict || rateConflict || scopeConflict || feedConflict) ||
        kind === 'spread' && JSON.stringify(r.items) !== JSON.stringify(chosen.items) ||
        (kind === 'delivery' || kind === 'count') && (r.items[r.productId].lb !== chosen.items[chosen.productId].lb ||
          kind === 'delivery' && r.at.slice(0,16) !== chosen.at.slice(0,16))));
      return { id, chosen, reports, unsettled, meterConflict, workConflict, rateConflict, scopeConflict, feedConflict, elapsed, planned, pending };
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
    const elapsed = opts.elapsed == null || opts.elapsed === '' ? (opts.status==='Skipped'?0:null) : number(opts.elapsed,'elapsed minutes');
    const planned = opts.planned === '' || opts.planned == null ? null : number(opts.planned, 'planned minutes');
    const meter = opts.meter === '' || opts.meter == null ? null : number(opts.meter, 'metered gallons');
    if (elapsed==null && meter==null) throw Error('Enter the water in gallons or the actual minutes.');
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
    const metered = r.meter ?? (group.pending || group.reports).find(x => x.meter != null && (x.elapsed==null || r.elapsed==null || x.elapsed===r.elapsed) && x.status === r.status)?.meter;
    if (metered != null) return { gallons: metered, basis: 'Metered' };
    const elapsed=group.elapsed ?? r.elapsed;
    if (r.rate != null && elapsed != null) return { gallons: r.rate * elapsed, basis: 'Estimated' };
    return { gallons: null, basis: 'Unknown' };
  }
  function runSummary(groups) {
    const total = { started: 0, skipped: 0, interrupted: 0, minutes: 0, unknownMinutes: 0, disputed: 0,
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
        const elapsed=group.elapsed ?? r.elapsed;
        if(elapsed==null) total.unknownMinutes++; else total.minutes += elapsed;
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
  const mgPerL = 453592.37 / 3.785411784;
  function stockWeight(ppm, n, gallons, ratio) {
    const concentration=number(ppm,'the target ppm N',0.000001);
    const nitrogen=number(n,'the fertilizer nitrogen percentage',0.000001,100)/100;
    return concentration*number(gallons,'the final stock volume',0.000001)*number(ratio,'the injection ratio',1)/(mgPerL*nitrogen);
  }
  function usualInjector(book, gardenId, zone, at) {
    const pref=book.constantFeed?.[gardenId], tank=book.tanks?.[pref?.tankId];
    if(!tank || tank.gardenId!==gardenId || !tank.ratio || !book.recipes?.[tank.recipeId] ||
        !(Date.parse(at)>=Date.parse(pref.since)) || !zone || zone.gardenId!==gardenId) return null;
    if(tank.beds?.length && (!zone.beds?.length || !zone.beds.every(id=>tank.beds.includes(id)))) return null;
    return tank;
  }
  function recipeConcentration(book, recipeId, ratio) {
    return stockConcentration(snapshot(book,recipeId,1),ratio);
  }
  function stockConcentration(stock,ratio) {
    const dilution=number(ratio,'the injector dilution denominator',1), lbPerGallon=nutrientTotals(stock);
    return Object.fromEntries(Object.entries(lbPerGallon).map(([key,lb]) =>
      [key, lb == null ? null : lb * mgPerL / dilution]));
  }
  function injectedFeed(book,tank,mode,ratio,treated) {
    if(mode==='plain') return {mode};
    if(!['whole','part'].includes(mode) || !tank || !book.recipes?.[tank.recipeId]) throw Error('Choose the injector and recipe used for this watering.');
    return {mode,tankId:tank.id,tankName:tank.name,recipe:book.recipes[tank.recipeId].name,
      ratio:number(ratio,'the injection ratio',1),treated:mode==='part' && treated!=null && String(treated).trim()!==''?number(treated,'the gallons watered with fertilizer',0.000001):null,
      stock:snapshot(book,tank.recipeId,1)};
  }
  function feedDelivery(group) {
    // The injector's evidence belongs to the watering, whichever report's figures were accepted for its water: a controller's
    // report chosen in a review carries no feed of its own and must not take the grower's away (Codex on #113).
    let feed=group.chosen.feed;
    if(!feed) {
      const others=group.reports.filter(r=>r.feed);
      if(new Set(others.map(r=>feedKey(r.feed))).size>1) return {feed:others[0].feed,held:true};
      feed=others[0]?.feed;
    }
    if(!feed) return null;
    if(group.workConflict || group.scopeConflict || group.feedConflict) return {feed,held:true};
    if(feed.mode==='plain' || group.chosen.status==='Skipped') return {feed,plain:true};
    const volume=water(group);
    if(group.meterConflict || group.rateConflict || (feed.mode==='part' && volume.gallons!=null && feed.treated>volume.gallons)) return {feed,held:true};
    const gallons=feed.mode==='part'?feed.treated:volume.gallons;
    if(gallons==null) return {feed,gallons:null};
    const stockGallons=gallons/feed.ratio;
    const items=values(feed.stock).map(item=>({...item,lb:item.lb*stockGallons}));
    return {feed,gallons,stockGallons,totals:nutrientTotals(items)};
  }
  // What reached a garden through its injectors. A tank mix and a logged watering count the same fertilizer: the mix when the
  // product went into the tank, the watering when the stock went down the line. Neither record is ever whole (a clock waters
  // unlogged, a bucket is refilled unticked), and product that was never mixed cannot have been injected. So each is a floor
  // under what was fed, the larger of the two stands, and they are never added. Each row holds one job's pounds of n, p and k;
  // a null is a job whose weight or label is not known, counted and left out of the sum.
  function injectorFeed(mixes, waterings) {
    const side = rows => {
      const sum = key => rows.reduce((total, row) => (row[key] == null ? total : (total ?? 0) + row[key]), null);
      return { n: sum('n'), p: sum('p'), k: sum('k'), count: rows.length, unknown: rows.filter(row => row.n == null).length };
    };
    const tanks = side(mixes), logged = side(waterings);
    const basis = !tanks.count && !logged.count ? null : !logged.count || (tanks.count && (tanks.n ?? 0) >= (logged.n ?? 0)) ? 'tanks' : 'waterings';
    return { basis, tanks, waterings: logged, counted: basis === 'tanks' ? tanks : basis ? logged : null };
  }
  // A garden's injectors, each counted by itself: one tank's mixes say nothing of another tank's waterings, so the larger
  // of the two is taken tank by tank and the tanks are added. Each row holds one job (its pounds of n, p and k, the tank it
  // belongs to, and anything else the caller wants back). rows: the jobs that are counted, as they were given.
  function gardenFeed(mixes, waterings) {
    // A job that names no tank belongs to the garden's one tank where it has only one: on a tank of its own it would be added
    // to that tank's mixes, the same fertilizer twice.
    const named = new Set([...mixes, ...waterings].map(row => row.tank).filter(Boolean)), only = named.size === 1 ? [...named][0] : '';
    const tanks = new Map(), of = row => { const key = row.tank || only; if (!tanks.has(key)) tanks.set(key, { mixes: [], waterings: [] }); return tanks.get(key); };
    for (const row of mixes) of(row).mixes.push(row);
    for (const row of waterings) of(row).waterings.push(row);
    const parts = [...tanks].map(([tank, jobs]) => ({ tank, ...injectorFeed(jobs.mixes, jobs.waterings), jobs }));
    const rows = parts.flatMap(part => (part.basis === 'tanks' ? part.jobs.mixes : part.jobs.waterings));
    const sum = key => rows.reduce((total, row) => (row[key] == null ? total : (total ?? 0) + row[key]), null);
    const by = basis => parts.filter(part => part.basis === basis).reduce((total, part) => total + part.counted.count, 0);
    // Nitrogen is added up as far as it is known, and what is missing is said beside the figure (the counts below). P and K have
    // no such line, so one job without them leaves the total unknown, as in the rows of the table above it.
    const whole = key => (rows.some(row => row[key] == null) ? null : sum(key));
    return { parts, rows, counted: rows.length ? { n: sum('n'), p: whole('p'), k: whole('k') } : null, mixes: by('tanks'), waterings: by('waterings'),
      // mixes of unknown weight are said wherever they stand, counted tank or not: a floor with a hole in it
      unknownMixes: mixes.filter(row => row.n == null).length, unknownWaterings: parts.filter(part => part.basis === 'waterings').reduce((total, part) => total + part.counted.unknown, 0) };
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
    if(bags && !product.bag) throw Error('Add the bag weight in Products and recipes or enter the total pounds.');
    const lb=(bags?bags*product.bag:0)+loose;
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
    if(!product.bag) return {gross,short,bags:short===0?0:null};
    const packs=short/product.bag;
    const nearest=Math.round(packs);
    return {gross,short,bags:nearest>0 && Math.abs(packs-nearest)<=Number.EPSILON*packs*4 ? nearest : Math.ceil(packs)};
  }
  const api = { values, put, number, name, product, recipe, snapshot, groups, lastMix, cycle, reminder, refill, run, water, runSummary, sameRunEvidence, stockWeight, stockConcentration, usualInjector, stock, occurrence, nextJob, targetPounds, nutrientTotals, recipeConcentration, injectedFeed, feedDelivery, injectorFeed, gardenFeed, tapeFlow, zoneRate, stockEntry, stockGroups, purchase };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFWaterFeed = api;
})(typeof self !== 'undefined' ? self : this);
