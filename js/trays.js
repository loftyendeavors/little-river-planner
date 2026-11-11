/* Little River Farm Planner — live trays: weekly demand turned into sowing batches.
 *
 * The records are v7's own, so either planner reads what the other saved: a demand plan in
 * `liveTrayPlans` (crops, days to ready, price, trays a week in spring, summer and fall), and one
 * ordinary planting per crop per week, filed under the shared heated-bench space. The schedule and
 * the way a saved plan is turned into plantings follow v7.16.172's live-trays module line for line;
 * tests/trays_test.cjs runs the two side by side.
 *
 * One rule of v7's is not kept by the app: v7 refuses to change a plan once any batch has work recorded.
 * With `keepRecorded`, such batches stay exactly as they are and the rest follow the demand.
 *
 * Nothing here touches the page. Functions take a plan and return a new one.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFTrays = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  const date = s => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) throw Error('Choose a complete calendar date.');
    const [y, m, d] = s.split('-').map(Number), v = new Date(y, m - 1, d, 12);
    if (v.getFullYear() !== y || v.getMonth() !== m - 1 || v.getDate() !== d) throw Error('Choose a real calendar date.');
    return v;
  };
  const iso = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const add = (s, n) => { const d = date(s); d.setDate(d.getDate() + n); return iso(d); };
  const monday = s => { const d = date(s); return add(s, -((d.getDay() + 6) % 7)); };
  /** The Monday on or after a date: where a demand window opens when trays are wanted on Mondays only. */
  const mondayOnOrAfter = s => { const m = monday(s); return m === s ? s : add(m, 7); };
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
  const norm = s => String(s || '').toLowerCase().replace(/^micro\s*[·-]?\s*/, '').replace(/[^a-z0-9]/g, '');
  /** "Micro · Arugula" and "Micro -  Thai Basil" are shown as the crop alone. */
  const short = s => String(s || '').replace(/^micro\s*[·-]?\s*/i, '').trim();
  const SEASONS = ['spring', 'summer', 'fall'];

  /** An empty demand plan for a season: May 1 to Thanksgiving, summer from July 1, fall from September 16. */
  function draft(year) {
    const nov = new Date(year, 10, 1, 12), thanksgiving = new Date(year, 10, 1 + (4 - nov.getDay() + 7) % 7 + 21, 12);
    return { v: 1, year, name: '', customerId: '', from: year + '-05-01', through: iso(thanksgiving), summer: year + '-07-01', fall: year + '-09-16', rows: [] };
  }
  /** A checked copy of a demand plan, or an error in words. */
  function validate(input) {
    const p = clone(input);
    if (!Number.isInteger(p.year) || p.year < 2000 || p.year > 2200) throw Error('Choose a supported planning season.');
    if (!String(p.name || '').trim()) throw Error('Name this weekly demand plan.');
    p.name = p.name.trim();
    for (const k of ['from', 'through', 'summer', 'fall']) date(p[k]);
    if (p.from > p.through || date(p.from).getFullYear() !== p.year || date(p.through).getFullYear() !== p.year) throw Error('Choose an active demand window within this planning season.');
    if (p.summer >= p.fall) throw Error('Summer must start before fall.');
    if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 50) throw Error('Add between 1 and 50 crops.');
    const keys = new Set();
    for (const r of p.rows) {
      if (!r.id || keys.has(r.id)) throw Error('Crop rows need unique identities.');
      keys.add(r.id); r.name = String(r.name || '').trim();
      if (!r.name) throw Error('Name every live-tray crop.');
      if (!Number.isInteger(r.days) || r.days < 1 || r.days > 366) throw Error(r.name + ': days to ready must be a whole number from 1 to 366.');
      if (!Number.isFinite(r.price) || r.price < 0) throw Error(r.name + ': enter a price of zero or greater.');
      for (const k of SEASONS) if (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 10000) throw Error(r.name + ': weekly quantities must be whole trays from 0 to 10,000.');
    }
    return p;
  }
  /**
   * Weekly demand -> batches. Each active week has one batch per crop, ready on its Monday (the first
   * active date in the opening week) and sown `days` before that. Both partial boundary weeks get a full week's trays.
   */
  function schedule(input) {
    const p = validate(input), batches = [], weeks = [];
    for (let w = monday(p.from); w <= p.through; w = add(w, 7)) {
      const ready = w < p.from ? p.from : w, season = ready >= p.fall ? 'fall' : ready >= p.summer ? 'summer' : 'spring', rows = [];
      for (const r of p.rows) {
        const trays = r[season];
        if (!trays) continue;
        const b = { key: r.id + ':' + w, rowId: r.id, name: r.name, week: w, ready, sow: add(ready, -r.days), days: r.days, season, trays, price: r.price, revenue: trays * r.price };
        batches.push(b); rows.push(b);
      }
      weeks.push({ week: w, ready, season, trays: sum(rows, r => r.trays), revenue: sum(rows, r => r.revenue) });
    }
    return { plan: p, batches, weeks, trays: sum(batches, b => b.trays), revenue: sum(batches, b => b.revenue), firstSow: batches.map(b => b.sow).sort()[0] || null };
  }
  /** Has work been recorded on this batch? Such a batch is history and is never regenerated or removed with its plan. */
  function locked(plan, p, records) {
    const harvests = (records && records.harvests) || plan.harvests, picks = ((records && records.fieldRecords) || plan.fieldRecords || {}).picks;
    return !!(Object.values(p.done || {}).some(Boolean) || p.established || (p.workflow && Object.keys(p.workflow).length) || p.harvestComplete || p.outcome
      || (harvests && harvests[p.id] && Object.keys(harvests[p.id]).length) || (Array.isArray(picks) && picks.some(h => h.plantingId === p.id)));
  }
  /**
   * Save a demand plan into a farm plan: the plan record, its crops, and its batches as plantings.
   * A batch that already exists (same crop row, same week) keeps its id and anything else recorded on it.
   * options: uid() for new ids, now (ISO time), crop(id) to find a crop the plan does not list itself, records { harvests, fieldRecords },
   * keepRecorded: batches with work recorded are history: left untouched, whatever the demand now says, while the others follow it.
   */
  function apply(farm, input, options) {
    const { uid, crop } = options, state = { ...farm, gardens: farm.gardens.slice(), beds: farm.beds.slice(), crops: (farm.crops || []).slice(), plantings: farm.plantings.slice() };
    const model = schedule(input), plan = model.plan, prior = (state.liveTrayPlans || []).find(x => x.id === plan.id);
    if (plan.customerId && !(state.customers || []).some(c => c.id === plan.customerId)) throw Error('Choose an existing customer.');
    if (prior && prior.year !== plan.year) throw Error('Keep an existing demand plan in its saved season.');
    const old = state.plantings.filter(p => plan.id && p.liveTray && p.liveTray.planId === plan.id);
    const done = old.filter(p => locked(state, p, options.records));
    if (done.length && !options.keepRecorded) throw Error('This plan contains recorded work. Keep those batches intact; create a separate demand plan for new weeks.');
    plan.id = (prior && prior.id) || uid();
    let garden = state.gardens.find(g => g.liveTrayPool === true), bed = state.beds.find(b => b.liveTrayPool === true);
    if (bed && (!garden || bed.gardenId !== garden.id)) throw Error('Review the shared heated-space destination before continuing.');
    if (!garden) { garden = { id: uid(), name: 'Shared heated space', type: 'greenhouse', active: true, frost: false, dtmFactor: 1, curveMode: 'flat', gapMode: 'none', liveTrayPool: true, growingEnvironment: { v: 1, kind: 'heated', minTempF: null } }; state.gardens.push(garden); }
    if (!bed) { bed = { id: uid(), gardenId: garden.id, bed: 'Live trays · shared benches', type: 'Bench', trays: 0, w: 0, l: 0, orient: '', active: true, px: null, liveTrayPool: true, note: 'Uses existing heated nursery benches; adds no physical capacity.' }; state.beds.push(bed); }
    if (garden.active === false || bed.active === false) throw Error('The shared heated-space destination is inactive. Reactivate it before planning trays.');
    const crops = new Map();
    for (const r of plan.rows) {
      let c = r.cropId && crop ? crop(r.cropId) : null;
      if (!c) c = state.crops.find(c => c.micro && norm(c.name) === norm(r.name));
      if (!c) { c = { id: uid(), name: 'Micro · ' + r.name, micro: true, family: 'Microgreens', method: 'DS', gh: 0, dtm: r.days, hw: 1, baseUnit: 'tray', yBasis: 'tray', yield: 1, mk: 1, price: r.price, seedG: null, seedLb: null, tower: false, frostTender: false }; state.crops.push(c); }
      if (!c.micro) throw Error(r.name + ' must be a live-tray crop.');
      r.cropId = c.id; crops.set(r.id, c.id);
    }
    const records = model.batches.map(b => {
      const original = old.find(p => p.liveTray && p.liveTray.key === b.key);
      if (original && done.includes(original)) return original;
      const p = { ...(original || {}), id: (original && original.id) || uid(), bedId: bed.id, cropId: crops.get(b.rowId), date: b.sow, trays: b.trays, dtm: b.days, timingMode: 'manual', price: b.price, yield: 1,
        liveTray: { ...((original && original.liveTray) || {}), planId: plan.id, key: b.key, ready: b.ready, week: b.week, rowId: b.rowId } };
      p.growingDefaults = { v: 1, cropId: p.cropId, crop: { mk: { present: true, value: 1 }, baseUnit: { present: true, value: 'tray' }, yBasis: { present: true, value: 'tray' }, gh: { present: true, value: 0 } } };
      if (plan.customerId) p.customerId = plan.customerId; else delete p.customerId;
      // Not in v7: a batch's sowing day can be set by hand on the Sowing view. It holds while it falls before the day the batch is due.
      if (p.sowOn && p.sowOn < b.ready) { p.date = p.sowOn; p.dtm = Math.round((date(b.ready) - date(p.sowOn)) / 86400000); } else delete p.sowOn;
      // Not in v7: a crop row may name the variety its trays are sown with, so that sowing them draws that variety's seed.
      const row = plan.rows.find(r => r.id === b.rowId);
      if (row && 'varietyId' in row) { if (row.varietyId) p.varietyId = row.varietyId; else delete p.varietyId; }
      return p;
    });
    const wanted = new Map(records.map(p => [p.id, p]));
    for (const p of done) if (!wanted.has(p.id)) wanted.set(p.id, p);   // sown for a week or a crop the demand no longer lists: still history
    state.plantings = state.plantings.filter(p => !(p.liveTray && p.liveTray.planId === plan.id) || wanted.has(p.id)).map(p => wanted.get(p.id) || p);
    const have = new Set(state.plantings.map(p => p.id));
    state.plantings.push(...records.filter(p => !have.has(p.id)));
    state.liveTrayPlans = (state.liveTrayPlans || []).filter(p => p.id !== plan.id).concat({ ...prior, ...plan, updatedAt: options.now || new Date().toISOString() });
    return { plan: state, saved: plan, records, model, kept: done.length };
  }
  /**
   * Take a demand plan and its batches out of a farm plan. With keepRecorded, batches with work recorded
   * stay as plain plantings on the benches, no longer tied to a demand plan.
   */
  function remove(farm, id, records, options = {}) {
    const old = farm.plantings.filter(p => p.liveTray && p.liveTray.planId === id), done = new Set(old.filter(p => locked(farm, p, records)).map(p => p.id));
    if (done.size && !options.keepRecorded) throw Error('Recorded work is attached to this plan. Keep its production history intact.');
    const plantings = farm.plantings.filter(p => !(p.liveTray && p.liveTray.planId === id) || done.has(p.id)).map(p => { if (!done.has(p.id)) return p; const { liveTray, ...rest } = p; return rest; });
    return { ...farm, plantings, liveTrayPlans: (farm.liveTrayPlans || []).filter(p => p.id !== id) };
  }
  /** The difference between two farm plans as undoable steps, in the form the app commits. */
  function ops(before, after) {
    const out = [], same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
    for (const [key, kind] of [['gardens', 'garden'], ['beds', 'bed'], ['crops', 'crop'], ['plantings', null]]) {
      const was = new Map((before[key] || []).map(x => [x.id, x])), now = new Map((after[key] || []).map(x => [x.id, x]));
      for (const [id, x] of was) if (!now.has(id)) out.push({ ...(kind ? { kind } : {}), before: x, after: null });
      for (const [id, x] of now) if (!was.has(id)) out.push({ ...(kind ? { kind } : {}), before: null, after: x }); else if (!same(was.get(id), x)) out.push({ ...(kind ? { kind } : {}), before: was.get(id), after: x });
    }
    if (!same(before.liveTrayPlans, after.liveTrayPlans)) out.push({ kind: 'trays', before: before.liveTrayPlans || null, after: after.liveTrayPlans || null });
    return out;
  }

  /** The live-tray batches a plan holds, as the engine works them out: sow and ready dates, trays, expected revenue, seed. */
  function batches(eng, E) {
    const out = [];
    for (const p of eng.plan.plantings) {
      const r = eng.calc(p);
      if (!r || !r.rack || !r.c.micro || r.b.active === false || r.g.active === false) continue;
      const price = p.price != null && p.price !== '' ? Math.max(0, +p.price || 0) : Math.max(0, +r.c.price || 0);
      const yld = Math.max(0, +(p.yield != null && p.yield !== '' ? p.yield : r.c.yield) || 0), mk = Math.min(1, Math.max(0, Number.isFinite(+r.c.mk) && r.c.mk !== null && r.c.mk !== '' ? +r.c.mk : 0.9));
      out.push({ p, r, id: p.id, cropId: p.cropId, name: short(r.c.name), sow: E.d2s(r.field), ready: E.d2s(r.first), trays: r.len, price, revenue: r.len * yld * mk * price,
        seedG: r.seedG || 0, sown: !!(p.done && p.done.sow), planned: !!p.liveTray, planId: p.liveTray ? p.liveTray.planId : null });
    }
    return out.sort((a, b) => a.sow.localeCompare(b.sow) || a.name.localeCompare(b.name));
  }
  /** Trays to sow, trays ready and expected revenue for each week (Monday) the batches touch, with the empty weeks between. */
  function weeks(list) {
    const map = new Map();
    for (const b of list) for (const [d, k] of [[b.sow, 'sow'], [b.ready, 'ready']]) {
      const w = monday(d), row = map.get(w) || { week: w, sow: 0, ready: 0, revenue: 0 };
      row[k] += b.trays; if (k === 'ready') row.revenue += b.revenue;
      map.set(w, row);
    }
    if (map.size) { const keys = [...map.keys()].sort(); for (let w = keys[0]; w <= keys[keys.length - 1]; w = add(w, 7)) if (!map.has(w)) map.set(w, { week: w, sow: 0, ready: 0, revenue: 0 }); }
    return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
  }
  /** Season totals for each crop: trays, batches, expected revenue, and seed where the crop has a rate. */
  function byCrop(list) {
    const map = new Map();
    for (const b of list) {
      const row = map.get(b.cropId) || { cropId: b.cropId, name: b.name, crop: b.r.c, trays: 0, batches: 0, revenue: 0, seedG: 0, sown: 0, first: b.sow, last: b.ready };
      row.trays += b.trays; row.batches++; row.revenue += b.revenue; row.seedG += b.seedG; if (b.sown) row.sown += b.trays;
      if (b.sow < row.first) row.first = b.sow; if (b.ready > row.last) row.last = b.ready;
      map.set(b.cropId, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return { draft, validate, schedule, locked, apply, remove, ops, batches, weeks, byCrop, monday, mondayOnOrAfter, add, short, norm, SEASONS };
});
