/* Little River Farm Planner — planning ahead: successions, and openings in the ground.
 *
 * Two questions a plan is asked once the main crops are in:
 *
 *   series()    "I want this crop coming steadily from here to there": a run of plantings a set number of
 *               days apart, each put into the first ground that is free for it, in the gardens named.
 *   openings()  "Where is there room?": stretches of a bed that stand empty before, after or between the
 *               crops planned there, and fits() the crops whose whole cycle (growing, harvest, turnover)
 *               goes into one. Radishes before the eggplant; cabbage after the potatoes.
 *
 * Both obey the guard rails (nothing lands on ground that is held) and the season (nothing goes out
 * before its first field date, into a closed house, or across a frost). Neither changes the plan: they
 * return plantings for the app to add as one step.
 *
 * No DOM and no storage in this file. It runs in the browser and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./rails.js'));
  else root.LRFSuccession = factory(root.LRFEngine, root.LRFRails);
})(typeof self !== 'undefined' ? self : this, function (E, Rails) {
  'use strict';
  const EPS = 1e-6, PROBE = { sowing: false }, SEASON_KINDS = ['field', 'frost', 'closed', 'timing'];
  const day = d => E.validDate(d) ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}` : '—';
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const planYear = eng => +(eng.plan.settings && eng.plan.settings.year) || new Date().getFullYear();
  /** Why the season refuses a planting, in the engine's own words; null when it does not. */
  function seasonTrouble(eng, p, r) {
    const w = eng.warnings(p, r).find(x => SEASON_KINDS.includes(x.k));
    if (w) return w.t;
    // a crop with no season of its own still does not go into open ground before the farm's first field date
    const win = eng.fieldPlantingWindow(r.b, r.field.getFullYear());
    if (win.from && r.field < win.from && !p.established && !(r.out && r.out >= win.from)) return `Outdoor planting starts ${day(win.from)} here; this goes in ${day(r.field)}.`;
    return null;
  }
  const kindWord = { bed: 'bed', tower: 'tower', containers: 'container group', bench: 'bench' };
  const unitOfKind = { bed: 'ft', tower: 'sites', containers: 'containers', bench: 'trays' };
  /** May this crop be planned in this space at all? */
  function suits(eng, crop, bed) {
    if (!crop || !bed || bed.active === false || (eng.gardenOf(bed) || {}).active === false || eng.isPool(bed)) return false;
    if (crop.micro) return eng.isRack(bed);
    if (eng.isRack(bed)) return false;
    return !eng.isTower(bed) || crop.tower === true;
  }
  /** The spaces a series may use: those of the gardens named, in that order, that suit the crop. */
  function spaces(eng, crop, gardenIds) {
    const order = new Map((gardenIds || []).map((id, i) => [id, i]));
    return (eng.plan.beds || []).filter(b => order.has(b.gardenId) && suits(eng, crop, b)).sort((a, b) => order.get(a.gardenId) - order.get(b.gardenId) || natural(a.bed, b.bed));
  }
  /** Gardens with any space this crop could go in, and how many. */
  function gardensFor(eng, crop) {
    const out = [];
    for (const g of eng.plan.gardens || []) {
      if (g.active === false) continue;
      const list = (eng.plan.beds || []).filter(b => b.gardenId === g.id && suits(eng, crop, b));
      if (list.length) out.push({ garden: g, spaces: list.length, kind: eng.spaceKind(list[0]), planted: list.some(b => eng.plantingsIn(b.id).some(p => p.cropId === crop.id)) });
    }
    return out;
  }
  /** Plantings already in the plan that a new series could copy its settings from: the latest of each kind of space and variety. */
  function models(eng, cropId) {
    const seen = new Map();
    for (const p of eng.plan.plantings || []) {
      if (p.cropId !== cropId || p.liveTray || p.established === true) continue;
      const r = eng.calc(p);
      if (!r) continue;
      const key = r.kind + '|' + (p.varietyId || '');
      if (!seen.has(key) || r.field > seen.get(key).r.field) seen.set(key, { p, r });
    }
    return [...seen.values()].sort((a, b) => b.r.field - a.r.field);
  }

  // ───────────────────────────── successions ─────────────────────────────
  const LIMIT = 60;
  function normalize(eng, input) {
    const o = { ...input }, crop = eng.crop(o.cropId);
    if (!crop) return { error: 'Choose a crop.' };
    if (crop.micro) return { error: 'Live trays are planned from weekly demand, on the Trays view.' };
    const source = o.sourceId ? eng.planting(o.sourceId) : null;
    if (o.sourceId && (!source || source.cropId !== crop.id)) return { error: 'The planting this series copies is no longer in the plan.' };
    const from = E.s2d(o.from);
    if (!E.validDate(from)) return { error: 'Choose the first date.' };
    const every = Math.round(+o.every);
    if (!(every >= 1 && every <= 366)) return { error: 'Days apart: a whole number from 1 to 366.' };
    const basis = o.basis === 'harvest' ? 'harvest' : 'planting';
    let count = o.count === '' || o.count == null ? null : Math.round(+o.count);
    const to = count == null ? E.s2d(o.to) : null;
    if (count == null) { if (!E.validDate(to) || to < from) return { error: 'Choose a last date on or after the first, or a number of plantings.' }; count = Math.floor(E.dayDiff(to, from) / every) + 1; }
    if (!(count >= 1)) return { error: 'How many: at least one.' };
    if (count > LIMIT) return { error: `That is ${count} successions. Plan up to ${LIMIT} at a time: shorten the dates or widen the days apart.` };
    const unit = o.unit === 'ft' ? 'ft' : 'whole', amount = +o.amount;
    if (!(amount > 0) || (unit === 'whole' && !Number.isInteger(amount)) || amount > 2000) return { error: unit === 'ft' ? 'Feet in each succession: a number above zero.' : 'Spaces in each succession: a whole number, at least one.' };
    const list = spaces(eng, crop, o.gardenIds);
    if (!list.length) return { error: 'Choose at least one garden with room this crop can go in.' };
    const variety = o.varietyId ? eng.variety(o.varietyId) : null;
    if (o.varietyId && (!variety || variety.cropId !== crop.id)) return { error: 'That variety belongs to another crop.' };
    return { crop, source, from, every, basis, count, unit, amount, spaces: list, variety, skipCovered: o.skipCovered === true, gardenIds: (o.gardenIds || []).slice() };
  }
  /** The planting a series puts into a space: the crop from the library, or a copy of the planting it is modelled on. */
  function draftFor(eng, o, bed, date) {
    const payload = o.source ? { plantingId: o.source.id, copy: true } : { cropId: o.crop.id, varietyId: o.variety ? o.variety.id : undefined };
    // a copy keeps its own settings only where they still describe the space: its length means nothing in a bed of another size
    let source = o.source;
    if (source) { source = { ...source }; if (o.variety) source.varietyId = o.variety.id; if (o.unit === 'ft' || source.bedId !== bed.id) { delete source.ft; delete source.startFt; delete source.bedLayout; delete source.trays; } delete source.sowOn; delete source.harvestEnd; }
    return Rails.propose(eng, payload, { bedId: bed.id, date }, { source, noShrink: false });
  }
  /**
   * Plan a run of plantings. input: { cropId, varietyId?, sourceId?, gardenIds, basis: 'planting' | 'harvest', from, to | count, every,
   * unit: 'whole' | 'ft', amount, skipCovered?, covered?: day => is the crop already being picked that day }.
   * Returns { waves, plantings, placed, short } or { error }. Nothing is added to the plan.
   */
  function series(eng, input) {
    const o = normalize(eng, input);
    if (o.error) return o;
    const lib = eng.lib, waves = [], added = [], covered = typeof input.covered === 'function' ? input.covered : null;
    let work = eng.plan, probe = eng;
    for (let k = 0; k < o.count; k++) {
      const target = E.addDays(o.from, k * o.every), wave = { k, target, placed: [], want: o.amount, got: 0, why: [], skipped: null };
      waves.push(wave);
      let remaining = o.amount;
      const reasons = new Map(), note = (why, bed) => { if (!reasons.has(why)) reasons.set(why, []); reasons.get(why).push(bed); };
      for (const bed of o.spaces) {
        if (remaining <= EPS) break;
        // the day it goes in: the target itself, or as many days before the target as it takes to reach first harvest
        let date = target;
        if (o.basis === 'harvest') {
          const first = draftFor(probe, o, bed, target);
          if (!first.r) { note('This crop cannot be worked out here', bed); continue; }
          date = E.addDays(target, -E.dayDiff(first.r.first, first.r.field));
        }
        let res = draftFor(probe, o, bed, date);
        if (res.state === 'blocked' || !res.r) { note(res.why === 'held' ? heldWhy(probe, res) : res.why === 'too-long' ? 'Does not fit the space' : 'This crop cannot go here', bed); continue; }
        if (res.p.bedLayout) { note('Only some of the rows are free', bed); continue; }                // a series takes ground the full width of the bed
        const whole = res.r.physicalLength >= res.r.cap - EPS || res.r.tw;
        if (o.unit === 'whole' && !whole && !(o.source && res.state === 'ok')) { note(`Only part of it is free (${Math.floor(res.r.physicalLength)} ${probe.capUnit(bed)})`, bed); continue; }
        let p = res.p, r = res.r;
        if (o.unit === 'ft' && probe.isSoilBed(bed)) {
          const take = Math.min(r.physicalLength, remaining);
          if (take < Rails.MIN_FT - EPS) continue;
          if (take < r.physicalLength - EPS) {
            p = { ...p, ft: Math.round(take * 100) / 100 };
            const rect = res.rect; if (rect && rect.a0 > EPS) p.startFt = rect.a0; else delete p.startFt;
            const fit = probe.fit(p);
            if (!fit.ok) { note('No room for these dates', bed); continue; }
            r = fit.r;
          }
        }
        const trouble = seasonTrouble(probe, p, r);
        if (trouble) { note(trouble, bed); continue; }
        if (!(r.harvestDays > 0)) { note('Nothing would be ready before the season ends', bed); continue; }
        if (o.skipCovered && covered && !wave.placed.length && covered(r.first)) { wave.skipped = 'covered'; wave.firstHarvest = r.first; break; }
        const y = eng.yieldOf(p, r);
        wave.placed.push({ p, r, bed, units: y ? y.units : 0, unit: y ? y.unit : '' });
        added.push(p);
        remaining -= o.unit === 'ft' && probe.isSoilBed(bed) ? r.physicalLength : 1;
        work = { ...work, plantings: [...work.plantings, p] };
        probe = E.create(work, lib, PROBE);
      }
      wave.got = o.amount - Math.max(0, remaining);
      wave.short = wave.skipped ? 0 : Math.max(0, remaining);
      // say why, briefly: the commonest reason first, with how many spaces it turned away
      wave.why = wave.short > EPS ? [...reasons].sort((a, b) => b[1].length - a[1].length).slice(0, 2).map(([why, beds]) => ({ why, spaces: beds.length })) : [];
    }
    const placed = waves.filter(w => w.placed.length), all = waves.flatMap(w => w.placed);
    return { options: o, waves, plantings: added, placed: placed.length, skipped: waves.filter(w => w.skipped).length, short: waves.filter(w => w.short > EPS).length,
      firstHarvest: all.length ? new Date(Math.min(...all.map(x => +x.r.first))) : null, lastHarvest: all.length ? new Date(Math.max(...all.map(x => +x.r.last))) : null,
      units: all.reduce((n, x) => n + x.units, 0), unit: all.length ? all[0].unit : eng.unitOf(o.crop), ground: all.reduce((n, x) => n + (x.r.tw ? 1 : x.r.len), 0), groundUnit: o.spaces.length ? unitOfKind[eng.spaceKind(o.spaces[0])] : 'ft' };
  }
  function heldWhy(eng, res) {
    const first = (res.blockers || []).slice().sort((a, b) => a.from - b.from)[0];
    if (!first) return 'No room for these dates';
    if (first.rest) return 'Resting then';
    const c = eng.crop(first.p.cropId);
    return `Held by ${c ? c.name.toLowerCase() : 'another crop'}`;
  }

  // ───────────────────────────── openings ─────────────────────────────
  const crosses = (f, g) => f.a0 < g.a1 - EPS && g.a0 < f.a1 - EPS && f.x0 < g.x1 - EPS && g.x0 < f.x1 - EPS;
  /**
   * The first day this plan puts anything into unheated ground, field or tunnel. Days to harvest are the same in every
   * month here, so without a floor the planner would offer radishes for a cold tunnel on New Year's Day. The plan's own
   * first planting is the grower's word on when that ground wakes up; a heated house is offered from January.
   */
  function unheatedStart(eng) {
    const year = planYear(eng);
    let first = null;
    for (const p of eng.plan.plantings || []) {
      const r = eng.calc(p);
      if (!r || !eng.isSoilBed(r.b) || (r.g || {}).type === 'greenhouse' || eng.isStandingCrop(p, r) || r.field.getFullYear() !== year) continue;
      if (!first || r.field < first) first = r.field;
    }
    return first;
  }
  const fullWidth = r => r.x0 <= EPS && r.x1 >= 1 - EPS;
  /**
   * Stretches of soil beds that stand empty. options: { from, to, minDays = 21, minFt = 8, gardenIds?, bedId?, empty = false (beds with nothing planned at all),
   * unheatedFrom? (the first day unheated ground is offered: by default the plan's own first planting in it; null for no floor) }.
   * Each opening is a piece of ground the full width of its bed, free from one day to another, with the crop it follows and the crop it comes before.
   */
  function openings(eng, options = {}) {
    const year = planYear(eng), lo = E.validDate(E.s2d(options.from)) ? E.s2d(options.from) : new Date(year, 0, 1), hi = E.validDate(E.s2d(options.to)) ? E.s2d(options.to) : new Date(year, 11, 31);
    const minDays = options.minDays > 0 ? Math.round(options.minDays) : 21, minFt = options.minFt > 0 ? +options.minFt : 8, out = [];
    const gardens = options.gardenIds && options.gardenIds.length ? new Set(options.gardenIds) : null;
    const cold = options.unheatedFrom === undefined ? unheatedStart(eng) : E.validDate(E.s2d(options.unheatedFrom)) ? E.s2d(options.unheatedFrom) : null;
    for (const bed of eng.plan.beds || []) {
      if (!eng.isSoilBed(bed) || bed.active === false || (options.bedId && bed.id !== options.bedId) || (gardens && !gardens.has(bed.gardenId))) continue;
      const g = eng.gardenOf(bed);
      if (!g || g.active === false) continue;
      const L = eng.capOf(bed), planted = eng.plantingsIn(bed.id).some(p => eng.calc(p));
      if (!(L > 0) || (!planted && !options.empty)) continue;
      // open ground is no use before the farm's first field date, or a house before it opens
      const win = eng.gWindow(g, year), field = eng.fieldPlantingWindow(bed, year), opens = [lo, win.open, field.from, g.type === 'greenhouse' ? null : cold].filter(E.validDate), from = new Date(Math.max(...opens)), to = win.close && win.close < hi ? win.close : hi;
      if (to < from) continue;
      // everything that holds any of this bed at any time in the year, with the days it holds it (turnover included) and where
      const held = eng.holders(bed, new Date(year - 1, 0, 1), new Date(year + 1, 11, 31), null).filter(x => x.rect);
      const starts = new Set([+from]);
      for (const x of held) if (x.through !== Infinity) { const next = E.addDays(x.through, 1); if (next > from && next <= to) starts.add(+next); }
      for (const t of [...starts].sort((a, b) => a - b)) {
        const a = new Date(t), active = held.filter(x => x.from <= a && (x.through === Infinity || x.through >= a)), justEnded = held.filter(x => x.through !== Infinity && +E.addDays(x.through, 1) === t);
        const free = active.length ? Rails.freeRects(L, active.map(x => x.rect)).filter(fullWidth) : [{ a0: 0, a1: L, x0: 0, x1: 1 }];
        for (const rect of free) {
          const length = rect.a1 - rect.a0;
          if (length < Math.min(minFt, L) - EPS) continue;
          if (t !== +from && !justEnded.some(x => crosses(rect, x.rect))) continue;                   // it was already open yesterday: listed from the day it opened
          const later = held.filter(x => x.from > a && crosses(rect, x.rect)).sort((p, q) => p.from - q.from)[0] || null;
          const z = later ? E.addDays(later.from, -1) : to, end = z > to ? to : z, days = E.dayDiff(end, a) + 1;
          if (days < minDays) continue;
          const before = held.filter(x => x.through !== Infinity && x.through < a && crosses(rect, x.rect) && !x.rest).sort((p, q) => q.through - p.through)[0] || null;
          out.push({ id: `${bed.id}|${E.d2s(a)}|${rect.a0}`, bed, garden: g, from: a, to: end, days, a0: rect.a0, a1: rect.a1, length, whole: length >= L - EPS, cap: L,
            after: before ? { p: before.p, r: before.r } : null, before: later && !later.rest && later.from <= E.addDays(to, 1) ? { p: later.p, r: later.r } : null, rests: !!(later && later.rest), planted });
        }
      }
    }
    return out.sort((a, b) => a.from - b.from || natural(a.garden.name, b.garden.name) || natural(a.bed.bed, b.bed.bed) || a.a0 - b.a0);
  }
  /** Crops worth offering for an opening: annual, harvested, grown in the ground. `mine` keeps to crops already in the plan or with varieties saved. */
  function candidates(eng, mine = true) {
    const used = new Set((eng.plan.plantings || []).map(p => p.cropId)), kept = new Set((eng.plan.varieties || []).filter(v => v.active !== false && !v.deleted).map(v => v.cropId));
    return eng.crops().filter(c => !c.micro && !eng.isPerennial(c) && !eng.isCoverCrop(c) && c.material !== 'bulb' && +c.dtm > 0 && (!mine || used.has(c.id) || kept.has(c.id)));
  }
  /**
   * Try one crop in one opening. options: { varietyId?, date? (else the first day it may go in), ft? (else the whole opening) }.
   * Returns { ok, p, r, earliest, latest, spare, why } — `why` says what stops it when it does not fit.
   */
  function tryCrop(eng, opening, crop, options = {}) {
    const bed = opening.bed, year = opening.from.getFullYear(), first = eng.firstFieldDate(crop, bed, year), last = eng.lastFieldDate(crop, bed, year);
    // an opening is worth its planting days: the days in it on which something may still go in
    const plantBy = last && last < opening.to ? last : opening.to;
    const earliest = first && first > opening.from ? first : opening.from, asked = options.date ? E.s2d(options.date) : null, date = E.validDate(asked) ? asked : earliest;
    const ft = options.ft > 0 ? Math.min(+options.ft, opening.length) : opening.length;
    const p = { id: options.id || 'opening-probe', bedId: bed.id, cropId: crop.id, date: E.d2s(date) };
    if (options.varietyId) p.varietyId = options.varietyId;
    if (ft < opening.cap - EPS) { p.ft = Math.round(ft * 100) / 100; if (opening.a0 > EPS) p.startFt = opening.a0; }
    const base = { p, earliest, latest: null, spare: null };
    if (date < opening.from) return { ...base, ok: false, why: `This ground is not free until ${day(opening.from)}` };
    if (date > opening.to) return { ...base, ok: false, why: `This ground is taken again after ${day(opening.to)}` };
    if (date > plantBy) return { ...base, ok: false, why: `Outdoor planting ends ${day(last)}` };
    const fit = eng.fit(p), r = fit.r;
    if (!r) return { ...base, ok: false, why: 'This crop cannot be worked out here' };
    base.r = r; base.through = fit.through;
    const trouble = seasonTrouble(eng, p, r);
    if (trouble) return { ...base, ok: false, why: trouble };
    if (!(r.harvestDays > 0)) return { ...base, ok: false, why: 'Nothing would be ready before the season ends' };
    const full = r.harvestMode === 'season' ? r.harvestDays >= r.expectedHarvestDays : r.harvestDays >= Math.max(1, Math.min(r.c.hw || 1, r.expectedHarvestDays || r.c.hw || 1));
    if (!full) return { ...base, ok: false, why: `Only ${r.harvestDays} of its ${r.harvestMode === 'season' ? r.expectedHarvestDays : r.c.hw} harvest days fit` };
    const spare = fit.through === Infinity ? -1 : E.dayDiff(opening.to, fit.through);
    if (!fit.ok || spare < 0) {
      const next = opening.before ? eng.crop(opening.before.p.cropId) : null;
      return { ...base, ok: false, spare, why: fit.over ? 'Does not fit the space' : spare < 0 ? `Needs the ground until ${day(fit.through)}, ${-spare} day${spare === -1 ? '' : 's'} past ${next ? 'the ' + next.name.toLowerCase() : 'the end of this opening'}` : 'Another crop holds part of this ground then' };
    }
    // the last day it could go in and still be out of the way: checked, because a later start can run a crop into a frost or a closed house
    let latest = date;
    if (!options.inner && spare > 0) {
      const lastDay = E.addDays(date, spare), wanted = last && last < lastDay ? last : lastDay;
      if (wanted > date && tryCrop(eng, opening, crop, { ...options, date: E.d2s(wanted), inner: true }).ok) latest = wanted;
    }
    const y = eng.yieldOf(p, r), prev = opening.after && opening.after.r.c, rotation = !!(prev && prev.family && prev.family === r.c.family && prev.id !== r.c.id && prev.family !== 'Cover crop');
    return { ...base, ok: true, spare, latest, units: y ? y.units : 0, unit: y ? y.unit : '', rotation, family: r.c.family || '' };
  }
  /**
   * The crops that fit an opening, best first. options: { mine = true, cropId?, covered?: (cropId, from, to) => share of those days the crop is already being picked }.
   * A crop the plan has no harvest of in those weeks comes before one it already has plenty of; one that follows its own family comes last.
   */
  function fits(eng, opening, options = {}) {
    const list = options.cropId ? [eng.crop(options.cropId)].filter(Boolean) : candidates(eng, options.mine !== false), out = [];
    for (const crop of list) {
      const t = tryCrop(eng, opening, crop);
      if (!t.ok) continue;
      t.crop = crop;
      t.covered = options.covered ? options.covered(crop.id, t.r.first, t.r.last) : null;
      out.push(t);
    }
    const band = t => (t.rotation ? 4 : 0) + (t.covered == null ? 1 : t.covered < 0.25 ? 0 : t.covered < 0.75 ? 1 : 2);
    return out.sort((a, b) => band(a) - band(b) || a.r.first - b.r.first || a.crop.name.localeCompare(b.crop.name));
  }
  /** Free room on the heated benches, week by week: what the benches hold less the fullest day of each week. */
  function benchRoom(eng) {
    const cap = eng.heatedTraySpaces(), year = planYear(eng), weeks = [];
    if (!cap) return { cap: 0, weeks, least: null };
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) {
      const monday = E.addDays(d, -((d.getDay() + 6) % 7)), key = E.d2s(monday), total = eng.benchDay(d).total;
      let w = weeks[weeks.length - 1];
      if (!w || w.key !== key) { w = { key, start: new Date(Math.max(+monday, +new Date(year, 0, 1))), most: 0 }; weeks.push(w); }
      if (total > w.most) w.most = total;
    }
    for (const w of weeks) w.free = Math.max(0, cap - w.most);
    const least = weeks.reduce((a, b) => !a || b.free < a.free ? b : a, null);
    return { cap, weeks, least };
  }

  return { series, normalize, spaces, gardensFor, models, suits, openings, unheatedStart, candidates, tryCrop, fits, benchRoom, seasonTrouble, kindWord, unitOfKind, LIMIT };
});
