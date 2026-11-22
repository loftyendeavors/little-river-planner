/* Little River Farm Planner — planning ahead: successions, and openings in the ground.
 *
 * Two questions a plan is asked once the main crops are in:
 *
 *   planRun()   "This crop, one whole bed every so many days, or so much a week, picked from here to there": a run of
 *               successions, each sowing one whole bed, worked out without changing the plan. Planned to an amount the
 *               spacing is found, never the size. What has no bed is said: a date is never moved to make a sowing fit.
 *               A run is kept as one (lrfNext.runs, and run: { id, n, gap } on each of its plantings).
 *   waiting()   plantings that have no bed yet. They are kept apart from the plan's plantings, so they
 *               count toward nothing (seeds, sowing, benches, the forecast) until one is put on a bed:
 *               landing() says where one would go in a space, and splits() how a bed could be shared.
 *   openings()  "Where is there room?": stretches of a bed that stand empty before, after or between the
 *               crops planned there, and fits() the crops whose whole cycle (growing, harvest, turnover)
 *               goes into one. Radishes before the eggplant; cabbage after the potatoes.
 *
 * Both obey the guard rails (nothing lands on ground that is held) and the season (nothing goes out
 * before its first field date or into a closed house). A frost date never stops a planting: it is placed,
 * and carries the engine's frost note (frostNote). Neither changes the plan: they return plantings for the
 * app to add as one step.
 *
 * No DOM and no storage in this file. It runs in the browser and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./rails.js'), require('./forecast.js'));
  else root.LRFSuccession = factory(root.LRFEngine, root.LRFRails, root.LRFForecast);
})(typeof self !== 'undefined' ? self : this, function (E, Rails, F) {
  'use strict';
  const EPS = 1e-6, PROBE = { sowing: false }, SEASON_KINDS = ['field', 'closed', 'timing'];
  const day = d => E.validDate(d) ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}` : '—';
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const round = v => Math.round(v * 1e9) / 1e9, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let counter = 0;
  const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const planYear = eng => +(eng.plan.settings && eng.plan.settings.year) || new Date().getFullYear();
  /** Why the season refuses a planting, in the engine's own words; null when it does not. A frost date is a note, never a refusal (frostNote). */
  function seasonTrouble(eng, p, r) {
    const early = eng.fieldFrostOnly(p, r), w = eng.warnings(p, r).find(x => SEASON_KINDS.includes(x.k) && !(x.k === 'field' && x.t === early));
    if (w) return w.t;
    // a crop with no season of its own still does not go into open ground before the farm's first field date
    const win = eng.fieldPlantingWindow(r.b, r.field.getFullYear());
    if (win.from && r.field < win.from && !p.established && !(r.out && r.out >= win.from)) return `Outdoor planting starts ${day(win.from)} here; this goes in ${day(r.field)}.`;
    return null;
  }
  /** What a frost date does to a planting, in the engine's own words (its frost warning, or a field day set by the frost alone); null when nothing. */
  function frostNote(eng, p, r) {
    const w = eng.warnings(p, r).find(x => x.k === 'frost');
    return w ? w.t : eng.fieldFrostOnly(p, r);
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

  // ───────────────────────────── successions ─────────────────────────────
  const LIMIT = 60;
  /** A space to judge a crop's days by when it has no bed: where the planting it copies stands, else where the crop is already grown, else the first that suits. */
  function refSpace(eng, crop, source) {
    const home = source && eng.bedOf(source.bedId);
    if (home && suits(eng, crop, home)) return home;
    const grown = gardensFor(eng, crop), pick = grown.find(g => g.planted) || grown[0];
    return pick ? (eng.plan.beds || []).find(b => b.gardenId === pick.garden.id && suits(eng, crop, b)) || null : null;
  }
  const SPACE_FIELDS = ['bedId', 'ft', 'startFt', 'bedLayout', 'trays', 'shelter', 'out'];
  /** Gardens can hold several kinds of space. Offer each kind separately. */
  function runGardens(eng, crop) {
    const out = [];
    for (const garden of eng.plan.gardens || []) {
      const groups = new Map();
      for (const bed of spaces(eng, crop, [garden.id])) {
        const kind = eng.spaceKind(bed);
        if (!groups.has(kind)) groups.set(kind, { garden, kind, spaces: 0, planted: false });
        const row = groups.get(kind);
        row.spaces++;
        if (!row.planted) row.planted = eng.plantingsIn(bed.id).some(p => p.cropId === crop.id);
      }
      out.push(...groups.values());
    }
    return out;
  }
  /** The latest planting of this crop and variety in this kind of space. Automatic live-tray batches follow demand. */
  function runSource(eng, cropId, varietyId, kind) {
    if (kind !== 'tower' && kind !== 'containers') return null;
    let latest = null;
    for (const p of eng.plan.plantings) {
      if (p.cropId !== cropId || (varietyId && p.varietyId !== varietyId) || p.liveTray || p.established || p.failed) continue;
      const bed = eng.bedOf(p.bedId);
      if (bed && eng.spaceKind(bed) === kind && (!latest || p.date > latest.date)) latest = p;
    }
    return latest;
  }
  /** Make a new planting. Crops on beds use their defaults. Other spaces can follow a planting's cycle and block size. */
  function draftFor(eng, o, bed, date) {
    let source = o.source;
    if (source) {
      source = { ...source };
      delete source.sowOn;
      delete source.harvestEnd;
      delete source.out;       // an absolute date from the earlier sowing
      if (o.kind === 'bench') source.trays = o.size;
      if (o.kind === 'containers') source.ft = o.size;
    }
    const payload = source ? { plantingId: source.id, copy: true } : { cropId: o.crop.id, varietyId: o.variety ? o.variety.id : undefined };
    const res = Rails.propose(eng, payload, { bedId: bed.id, date }, { source, noShrink: false });
    if (o.kind === 'tower' && res.r && res.r.plants !== eng.capOf(bed)) {
      res.p = { ...res.p, towerUsedSites: eng.capOf(bed) };
      res.r = eng.evaluate(res.p);
    }
    return res;
  }
  // ── sized by harvest ──
  /**
   * What a planting gives of what a series is sized by: the crop's own line, or (`o.thing`, an id) another thing the crop sells.
   * Null where the planting gives none of it: a thing sold from one place only is not had from another.
   */
  function given(eng, o, p, r) {
    const y = eng.yieldOf(p, r), parts = y && eng.soldOf ? eng.soldOf(p, r, y) : null;
    if (!y || !parts) return o.thing ? null : y;
    return parts.find(x => (x.thing || '') === (o.thing || '')) || null;
  }
  /** Why the crop's own line cannot be sized from a planting: where it stands, everything is sold as another thing. Null where that is not so. */
  function soldElse(eng, p, r) {
    const own = eng.yieldOf(p, r), parts = own && eng.soldOf ? eng.soldOf(p, r, own) : null;
    if (!parts || parts.some(x => !x.thing)) return null;
    return `Everything ${r.c.name} gives there is sold as ${parts.map(x => x.name).join(' and ')}, so there is no amount of ${r.c.name} itself to plan from it. Choose ${parts[0].name} under “Of”, or a garden where ${r.c.name} itself is sold.`;
  }
  const NEAR = 0.05;           // a week within a twentieth of what was asked is a full week
  /**
   * What a planting worked out in a space is expected to give, and what that rests on: `per` is what one foot of bed (or one
   * whole tower or group) gives to sell; `open` says the yield is the new-crop starting figure nobody has looked at; `part` is how
   * much of the stretch it is meant to serve its harvest really covers (a harvest the season cuts short serves fewer days).
   */
  function gauge(eng, o, p, r) {
    const y = given(eng, o, p, r);
    if (!y) return null;
    const soil = eng.isSoilBed(r.b), size = soil ? r.physicalLength : 1, hf = eng.harvestFor(o.crop.id, p.varietyId), env = eng.envOf(r.b);
    const keepDays = Math.round((y.keep || 0) * 7), once = y.pattern === 'once', more = keepDays > 0 ? keepDays - 1 : 0;
    const meant = once ? Math.max(1, keepDays) : Math.max(1, r.expectedHarvestDays) + more, there = once ? Math.max(1, keepDays) : r.harvestDays + more;
    return { y, soil, size, per: size > 0 ? y.units / size : 0, env, meant, there, part: clamp(there / Math.max(1, Math.min(meant, o.every || meant)), 0, 1),
      open: !y.own && y.by === 'default' && !!(hf && hf.open && hf.open.yield), first: r.first, last: r.last, field: r.field, cap: r.cap, bed: r.b };
  }
  const openWhy = crop => `${crop.name} stands on a yield nobody has checked. Set it under Assumptions, Yield and price, and plantings can be sized from it.`;
  function heldWhy(eng, res) {
    const first = (res.blockers || []).slice().sort((a, b) => a.from - b.from)[0];
    if (!first) return 'No room for these dates';
    if (first.rest) return 'Resting then';
    const c = eng.crop(first.p.cropId);
    return `Held by ${c ? c.name.toLowerCase() : 'another crop'}`;
  }

  // ───────────────────────────── a run (E4, #90 section 9, #102) ─────────────────────────────
  // A run is one succession kept as one thing: a sowing of one whole bed every so many days. Planned by beds, the spacing is
  // given; planned to an amount a week, the spacing is found: the largest number of whole days apart at which whole beds give,
  // on average over the weeks asked, at least the amount wanted, of the run's own (what the plan already gives is said beside it, and
  // not taken off: a run is planned for an amount of its own, #102's example). The size of a sowing never
  // changes, a date is never moved to make one fit, and a frost date stops none (it is placed and marked). The yield of a bed
  // is asked of the engine (yieldOf) on a trial planting of that whole bed, and the weeks are read off the forecast itself, built
  // with the trial plantings in the plan, less the forecast without them: nothing here multiplies a stored figure.
  const RUN_BY = ['beds', 'amount'], RUN_DATES = ['picking', 'planting'];
  const isRun = x => !!x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && !!x.id && typeof x.cropId === 'string';
  /** The runs a plan keeps (lrfNext.runs), in the order they were added. */
  function runs(plan) {
    const list = plan && plan.lrfNext && plan.lrfNext.runs;
    return Array.isArray(list) ? list.filter(isRun) : [];
  }
  /** The plantings of a run, by their number in it. */
  const runPlantings = (plan, id) => ((plan && plan.plantings) || []).filter(p => p.run && p.run.id === id).sort((a, b) => (a.run.n || 0) - (b.run.n || 0));
  const ids = list => (Array.isArray(list) ? list.filter(x => typeof x === 'string' && x) : []);
  /** A run's description read and checked: the options the solver works from, or { error }. */
  function runOptions(eng, input) {
    const o0 = input || {}, crop = eng.crop(o0.cropId);
    if (!crop) return { error: 'Choose a crop.' };
    const kind = o0.kind || 'bed';
    if (!Object.hasOwn(kindWord, kind)) return { error: 'Choose a kind of growing space.' };
    if (crop.micro && (kind !== 'bench' || !o0.sourceId || o0.by === 'amount')) return { error: 'Live trays are planned from weekly demand, under Live trays in the Nursery view. Open a manual bench planting to repeat its trays by spacing.' };
    if (eng.isCoverCrop(crop) || (!crop.micro && !(+crop.dtm > 0))) return { error: `${crop.name} has no harvest to plan a succession by.` };
    let variety = o0.varietyId ? eng.variety(o0.varietyId) : null;
    if (o0.varietyId && (!variety || variety.cropId !== crop.id)) return { error: 'That variety belongs to another crop.' };
    const source = kind === 'bed' ? null : o0.sourceId ? eng.planting(o0.sourceId) : runSource(eng, crop.id, o0.varietyId, kind);
    if (o0.sourceId && kind !== 'bed' && (!source || source.cropId !== crop.id || (o0.varietyId && source.varietyId !== o0.varietyId) || source.liveTray || source.established || eng.isPool(eng.bedOf(source.bedId)) || eng.spaceKind(eng.bedOf(source.bedId)) !== kind)) return { error: 'Choose a planting of this crop and variety in this kind of space.' };
    if (kind === 'bench' && (!source || !crop.micro)) return { error: 'Open a live-tray planting on a bench to repeat its trays.' };
    if (!variety && source?.varietyId) variety = eng.variety(source.varietyId);
    const size = source && (kind === 'bench' || kind === 'containers') ? eng.calc(source).physicalLength : null;
    const by = o0.by || 'beds', datesFor = o0.datesFor || 'picking', reach = o0.reach || 'spacing';
    if (!RUN_BY.includes(by)) return { error: 'Plan by beds each sowing, or by an amount a week.' };
    if (!RUN_DATES.includes(datesFor)) return { error: 'The dates are for picking, or for planting.' };
    if (reach !== 'spacing') return { error: 'A sowing is one whole bed: only the spacing changes to reach the amount.' };
    if (o0.wholeBeds === false) return { error: 'A sowing of a run is one whole bed.' };
    const from = E.s2d(o0.from), to = E.s2d(o0.to);
    if (!E.validDate(from)) return { error: 'Choose the first date.' };
    if (!E.validDate(to) || to < from) return { error: 'Choose a last date on or after the first.' };
    let every = null, want = null, margin = 0;
    if (by === 'beds') {
      every = Math.round(+o0.every);
      if (!(every >= 1 && every <= 366)) return { error: 'Days apart: a whole number from 1 to 366.' };
      const count = Math.floor(E.dayDiff(to, from) / every) + 1;
      if (count > LIMIT) return { error: `That is ${count} sowings. Plan up to ${LIMIT} at a time: shorten the dates or widen the days apart.` };
    } else {
      want = +o0.want; margin = o0.margin == null || o0.margin === '' ? 0 : +o0.margin;
      if (!(want > 0 && want <= 1e6)) return { error: 'Wanted a week: a number above zero.' };
      if (!(margin >= 0 && margin <= 1000)) return { error: 'Margin: a percentage, zero or more.' };
    }
    // where the sowings go: the beds named, in that order; else the gardens named; then the gardens to use if those run out of room
    const bedIds = ids(o0.bedIds), gardenIds = ids(o0.gardenIds), then = ids(o0.then), seen = new Set(), list = [];
    const take = b => { if (b && !seen.has(b.id) && eng.spaceKind(b) === kind && suits(eng, crop, b)) { seen.add(b.id); list.push({ bed: b, then: false }); } };
    if (bedIds.length) bedIds.map(id => eng.bedOf(id)).forEach(take);
    else spaces(eng, crop, gardenIds).forEach(take);
    const first = list.length;
    for (const b of spaces(eng, crop, then)) if (eng.spaceKind(b) === kind && !seen.has(b.id)) { seen.add(b.id); list.push({ bed: b, then: true }); }
    if (!list.length) return { error: bedIds.length ? 'This crop cannot go in the beds chosen.' : 'Choose a garden with ground this crop can go in.' };
    const thing = by === 'amount' && o0.thing ? String(o0.thing) : '';
    const record = { ...(kind !== 'bed' ? { kind } : {}), ...(source ? { sourceId: source.id } : {}), id: typeof o0.id === 'string' && o0.id ? o0.id : 'run-' + newId(), cropId: crop.id, ...(variety ? { varietyId: variety.id } : {}), ...(thing ? { thing } : {}), by,
      ...(by === 'amount' ? { want, margin } : {}), datesFor, from: E.d2s(from), to: E.d2s(to), reach: 'spacing', ...(every ? { every } : {}), wholeBeds: true, gardenIds, bedIds, then };
    // a run's sowing is the crop from the library, never a copy of another planting: draftFor's own fields for that
    // the sowings the grower dropped from the proposal, by their number: left out of what is laid, never of the spacing found
    const drop = new Set((Array.isArray(o0.drop) ? o0.drop : []).map(Number).filter(n => Number.isInteger(n) && n >= 1));
    return { record, drop, crop, variety, thing, by, datesFor, from, to, every, want, margin, wanted: want == null ? null : want * (1 + margin / 100), spaces: list, named: first, source, kind, size };
  }
  /** One sowing tried in one whole bed, on the date of the run it is numbered for: { p, r } or { why }. A date is never moved. */
  function sowIn(probe, o, bed, target) {
    let date = target;
    if (o.datesFor === 'picking') {
      const first = draftFor(probe, o, bed, target);
      if (!first.r) return { why: 'This crop cannot be worked out here' };
      date = E.addDays(target, -E.dayDiff(first.r.first, first.r.field));   // dated back by the crop's own days in this bed
    }
    const res = draftFor(probe, o, bed, date);
    if (res.state === 'blocked' || !res.r) return { why: res.why === 'held' ? heldWhy(probe, res) : res.why === 'too-long' ? 'Does not fit the space' : 'This crop cannot go here' };
    if (res.p.bedLayout) return { why: 'Only some of the rows are free' };
    if (!(res.r.tw || res.r.physicalLength >= (o.size ?? res.r.cap) - EPS)) return { why: `Only part of it is free (${Math.floor(res.r.physicalLength)} ${probe.capUnit(bed)})` };
    const trouble = seasonTrouble(probe, res.p, res.r);
    if (trouble) return { why: trouble };
    if (!(res.r.harvestDays > 0) && !res.r.frostCut) return { why: 'Nothing would be ready before the season ends' };   // the frost stops none
    return { p: res.p, r: res.r };
  }
  /** The first picking of a whole bed sown on a day, read off the first bed of the run: how planting days are turned into picking days. */
  function pickOf(eng, o, day0) {
    const bed = o.spaces[0].bed, res = draftFor(eng, o, bed, day0);
    return res.r ? res.r.first : null;
  }
  /**
   * The run laid out at a spacing: each numbered date from the first to the last, into the first whole bed of the list that is
   * free then, the plan worked out again after each so that two sowings never take the same ground. What finds no bed is said,
   * with why, and (`say`) with the gardens outside the run that have a whole bed free for it that day. `ghosts` are what the
   * sowings that found no bed would have been in the run's first bed with nothing else planted: what the spacing is judged by,
   * so that room running out is said as room, and never makes the sowings closer.
   */
  function layRun(eng, o, gap, end, say) {
    const count = Math.floor(E.dayDiff(end, o.from) / gap) + 1, sowings = [], unplaced = [], ghosts = [];
    let work = eng.plan, probe = eng, bare = null;
    for (let k = 0; k < count; k++) {
      const n = k + 1, target = E.addDays(o.from, k * gap), reasons = new Map();
      if (say && o.drop.has(n)) continue;   // dropped by the grower: no bed is asked for it, and it is not said as wanting one
      let got = null;
      for (const s of o.spaces) {
        const t = sowIn(probe, o, s.bed, target);
        if (t.p) { got = { ...t, bed: s.bed, then: s.then }; break; }
        if (!reasons.has(t.why)) reasons.set(t.why, 0);
        reasons.set(t.why, reasons.get(t.why) + 1);
      }
      if (!got) {
        bare = bare || E.create({ ...eng.plan, plantings: [] }, eng.lib, PROBE);
        const g = sowIn(bare, o, o.spaces[0].bed, target);
        if (g.p) ghosts.push(g.p);
        unplaced.push({ n, target, why: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([why, spaces]) => ({ why, spaces })), ...(say ? { room: roomElse(probe, o, target) } : {}) });
        continue;
      }
      const p = { ...got.p, run: { id: o.record.id, n, gap } }, r = got.r, y = given(eng, o, p, r);
      sowings.push({ p, r, bed: got.bed, garden: eng.gardenOf(got.bed), then: got.then, n, target, sow: r.sow || r.field, plant: r.field, nursery: !!r.sow, firstPick: r.first, lastPick: r.last,
        units: y ? y.units : 0, unit: y ? y.unit : '', frost: frostNote(probe, p, r) || null });
      work = { ...work, plantings: [...work.plantings, p] };
      probe = E.create(work, eng.lib, PROBE);
    }
    return { count, sowings, unplaced, ghosts, work };
  }
  /** The gardens outside a run with a whole bed free for one of its sowings on its day: [{ garden, beds }]. */
  function roomElse(probe, o, target) {
    const mine = new Set(o.spaces.map(s => s.bed.id)), out = [];
    for (const g of gardensFor(probe, o.crop)) {
      let beds = 0;
      for (const b of probe.plan.beds || []) if (b.gardenId === g.garden.id && !mine.has(b.id) && probe.spaceKind(b) === o.kind && suits(probe, o.crop, b) && sowIn(probe, o, b, target).p) beds++;
      if (beds) out.push({ garden: g.garden, beds });
    }
    return out;
  }
  /** The weeks between two picking days: wanted, what the plan already gives, and what the run gives, read off the forecast. */
  function runWeeks(eng, o, base, work, unit, a, z) {
    const year = planYear(eng), after = work === eng.plan ? base : F.build(E.create(work, eng.lib), { year, use: 'commercial' });
    const i0 = Math.max(0, base.index(a)), i1 = Math.min(base.days - 1, base.index(z));
    if (!(i1 >= i0)) return { weeks: [], days: 0 };
    const mine = row => row.cropId === o.crop.id && row.unit === unit && (row.thing || '') === (o.thing || '');
    const now = base.rows.filter(mine), then = after.rows.filter(mine), qty = (rows, c) => rows.reduce((n, row) => n + F.sum(row.days, Math.max(c.i0, i0), Math.min(c.i1, i1)), 0);
    const weeks = F.periods(base, 'week', i0, i1).map(c => {
      const days = Math.min(c.i1, i1) - Math.max(c.i0, i0) + 1, have = qty(now, c), run = Math.max(0, qty(then, c) - have), wanted = o.wanted == null ? null : o.wanted * days / 7;
      return { start: c.start, key: c.key, days, wanted, have, run, total: have + run, need: wanted, short: wanted != null && run < wanted * (1 - NEAR) };
    });
    return { weeks, days: weeks.reduce((n, w) => n + w.days, 0) };
  }
  const sumOf = (list, key) => list.reduce((n, x) => n + (x[key] || 0), 0);
  /**
   * What a run would plant, without changing the plan. input (a run's record, as lrfNext.runs keeps it):
   *   { id?, cropId, varietyId?, thing?, by: 'beds' | 'amount', want?, margin?, datesFor: 'picking' | 'planting', from, to,
   *     reach: 'spacing', every? (by beds), wholeBeds: true, gardenIds, bedIds, then }
   * by beds: one whole bed every `every` days from `from` to `to`. by amount: `want` (plus `margin` %) of the crop's unit (or of
   * the thing `thing`) each week between the first and the last picking day, from the run's own sowings; the spacing is
   * found. datesFor 'picking': `from` and `to` are picking days and each sowing is dated back from its number's day by the crop's
   * days in its bed; 'planting': they are days into the bed, and the weeks asked run from the first picking of a bed planted on
   * `from` to that of one planted on `to`.
   * Returns { run, every, sowings, unplaced, weeks, average, short, overshoot, totals, rests, where } or { error, unchecked? }:
   *   run        the record to keep, its id and its spacing in it (`every`, found or given)
   *   sowings    one a bed: { p, r, bed, garden, then, n, target, sow, plant, nursery, firstPick, lastPick, units, unit, frost },
   *              p a trial planting carrying run: { id, n, gap }; frost the engine's note where a frost date touches it, else null
   *   unplaced   [{ n, target, why: [{ why, spaces }], room: [{ garden, beds }] }]: numbered dates no bed of the run takes
   *   weeks      [{ start, key, days, wanted, have, run, total, need, short }] from the first picking day asked to the last
   *   average    a week, over those weeks: { wanted, have, run, total }; short: the weeks that come up short (by amount)
   *   overshoot  { days, lastPick, end } where the last sowing is picked past the last day asked, else null
   *   totals     { sowings, beds, feet, units, unit, frost }
   */
  function planRun(eng, input) {
    const o = runOptions(eng, input);
    if (o.error) return o;
    const year = planYear(eng), base = F.build(eng, { year, use: 'commercial' });
    // the picking days asked: as given, or turned from planting days by the run's first bed
    let a = o.from, z = o.to;
    if (o.datesFor === 'planting') { a = pickOf(eng, o, o.from); z = pickOf(eng, o, o.to); if (!a || !z) return { error: 'This crop cannot be worked out where it is headed.' }; }
    // what one whole bed gives, read once off the run's first bed: by amount, a yield nobody has checked plans nothing (as a series)
    const lead = draftFor(eng, o, o.spaces[0].bed, o.from), back = lead.r && o.datesFor === 'picking' ? draftFor(eng, o, o.spaces[0].bed, E.addDays(o.from, -E.dayDiff(lead.r.first, lead.r.field))) : lead;
    const ref = back.r ? back : lead, rests = ref.r ? gauge(eng, o, ref.p, ref.r) : null;
    let unit = rests ? rests.y.unit : eng.unitOf(o.crop, o.variety);
    if (o.by === 'amount') {
      if (!rests) return { error: (!o.thing && ref.r && soldElse(eng, ref.p, ref.r)) || (o.thing ? 'That is not sold from the beds of this run.' : 'This crop cannot be worked out where it is headed.') };
      if (rests.open) return { unchecked: true, error: openWhy(o.crop) };
      if (!rests.y.set || !(rests.y.units > 0)) return { error: `${o.crop.name} has no yield to plan an amount from. Set it under Assumptions, Yield and price.`, unchecked: true };
      unit = rests.y.unit;
    }
    // the last numbered date: picking or planting, as the dates are
    const end = o.to;
    let laid = null, every = o.every, weeks = null;
    if (o.by === 'beds') { laid = layRun(eng, o, every, end, true); weeks = runWeeks(eng, o, base, laid.work, unit, a, z); }
    else {
      const asked = runWeeks(eng, o, base, eng.plan, unit, a, z), need = sumOf(asked.weeks, 'need');
      if (!(need > EPS)) return { error: 'The first and last picking days give no week to plan for.' };
      {
        // the spacing a whole bed's yield gives against the amount still wanted a week, and from there the largest whole number of
        // days apart that gives it on average over the weeks asked, as the run would be with room for every sowing (what finds no bed
        // is then said, and never makes the sowings closer). Wider is tried while it gives enough, closer until it does, halving and
        // then halving the difference.
        const perWeek = need * 7 / Math.max(1, asked.days), steady = clamp(Math.floor(rests.y.units * 7 / perWeek + EPS), 1, 366), tried = new Map();
        const most = Math.max(1, Math.ceil(E.dayDiff(end, o.from) / LIMIT)), fits = gap => Math.floor(E.dayDiff(end, o.from) / gap) + 1 <= LIMIT;
        const at = gap => {
          if (!tried.has(gap)) { const l = layRun(eng, o, gap, end, false), w = runWeeks(eng, o, base, { ...l.work, plantings: [...l.work.plantings, ...l.ghosts] }, unit, a, z), run = sumOf(w.weeks, 'run'); tried.set(gap, { gap, run, enough: run >= need - EPS }); }
          return tried.get(gap);
        };
        let good = null, bad = null;   // the widest that gives enough, and the closest that does not
        let gap = Math.max(steady, most);
        if (at(gap).enough) { good = gap; for (let up = gap * 2; ; up *= 2) { const g = Math.min(366, up); if (at(g).enough) { good = g; if (g === 366) break; } else { bad = g; break; } } }
        else { bad = gap; for (let down = Math.floor(gap / 2); ; down = Math.floor(down / 2)) { const g = Math.max(most, down); if (g >= bad) break; if (at(g).enough) { good = g; break; } bad = g; if (g === most) break; } }
        if (good != null && bad != null) while (bad - good > 1) { const mid = Math.floor((good + bad) / 2); if (at(mid).enough) good = mid; else bad = mid; }
        // nothing gives enough even as close as the limit of sowings allows: the closest, unless no sowing of it gives anything (out of season), then the steady one
        every = good != null ? good : at(most).run > EPS ? most : clamp(steady, most, 366);
        if (!fits(every)) return { error: `That takes more than ${LIMIT} sowings. Plan fewer weeks at a time, or a smaller amount.` };
        const pick = { l: layRun(eng, o, every, end, true) };
        pick.w = runWeeks(eng, o, base, pick.l.work, unit, a, z);
        laid = pick.l; weeks = pick.w;
      }
    }
    const list = laid.sowings, last = list[list.length - 1], perDay = key => (weeks.days ? sumOf(weeks.weeks, key) * 7 / weeks.days : 0);
    const asksPicking = o.datesFor === 'picking' || o.by === 'amount';
    const overshoot = asksPicking && last && last.lastPick > z ? { days: E.dayDiff(last.lastPick, z), lastPick: last.lastPick, end: z } : null;
    const where = [];
    for (const s of o.spaces) {
      const g = eng.gardenOf(s.bed);
      let row = where.find(x => x.garden.id === g.id);
      if (!row) where.push(row = { garden: g, spaces: 0, used: 0, then: s.then });
      row.spaces++;
      if (list.some(x => x.bed.id === s.bed.id)) row.used++;
    }
    const run = { ...o.record, ...(every ? { every } : {}) };
    if (!every) delete run.every;
    return { run, every, sowings: list, unplaced: laid.unplaced, count: laid.count, picking: { from: a, to: z },
      weeks: weeks.weeks, average: { wanted: o.wanted, have: perDay('have'), run: perDay('run'), total: perDay('total') }, short: weeks.weeks.filter(w => w.short), overshoot,
      totals: { sowings: list.length, beds: new Set(list.map(x => x.bed.id)).size, feet: list.reduce((n, x) => n + (eng.isSoilBed(x.bed) ? x.r.physicalLength : 0), 0), units: sumOf(list, 'units'), unit, frost: list.filter(x => x.frost).length },
      rests: rests ? { units: rests.y.units, unit: rests.y.unit, by: rests.y.by, open: rests.open, bed: rests.bed, days: rests.there } : null, where };
  }

  // ───────────────────────────── plantings with no bed yet ─────────────────────────────
  // They are kept in a list of their own beside the plan (lrfNext.waiting), never among its plantings: whatever walks the
  // plan's plantings (seeds required, sowing lists, bench load, the forecast, the map) cannot count one by accident.
  const isWaiting = w => !!w && typeof w === 'object' && !Array.isArray(w) && typeof w.id === 'string' && !!w.id && typeof w.cropId === 'string' && E.validDate(E.s2d(w.date)) && !w.bedId;
  /** The plantings waiting to be placed, in the order they were added. */
  function waiting(plan) {
    const list = plan && plan.lrfNext && plan.lrfNext.waiting;
    return Array.isArray(list) ? list.filter(isWaiting) : [];
  }
  /** The planting a waiting record becomes once it has a bed: itself, less the note of why it waits and the length it asks for. */
  function bare(w) {
    const p = { ...w };
    for (const key of ['wait', ...SPACE_FIELDS]) delete p[key];
    return p;
  }
  /** Put a change onto a record the way an edit does: an empty value takes the field away. */
  const changed = (record, change) => { const after = { ...record }; for (const [key, value] of Object.entries(change)) { if (value === undefined || value === null || value === '') delete after[key]; else after[key] = value; } return after; };
  const wholeWidth = f => !f || !f.rows || (f.x0 <= EPS && f.x1 >= 1 - EPS);
  /**
   * Where a waiting planting would land in a space, on its own date (the date is never moved here).
   * target: { bedId, along?, across? }. Returns what Rails.propose returns, with these differences:
   *   - a planting that asks for so many feet takes that many, where the free ground is longer;
   *   - state 'split': the ground is held then, by one crop the bed could be shared with (see splits());
   *   - `holder` is that crop, when there is exactly one.
   * options.quick leaves the ways to share unworked (for a pass over every space while something is dragged).
   */
  function landing(eng, w, target, options = {}) {
    const bed = eng.bedOf(target.bedId), date = E.s2d(w.date), source = bare(w);
    if (!bed || !isWaiting(w)) return { state: 'blocked', why: 'space' };
    const run = w.run && runs(eng.plan).find(x => x.id === w.run.id), originalBed = eng.bedOf(w.wait?.from);
    const kind = run?.kind || (originalBed && eng.spaceKind(originalBed) === eng.spaceKind(bed) && eng.spaceKind(bed));
    if (kind && kind !== 'bed') {
      if (eng.spaceKind(bed) !== kind || !suits(eng, eng.crop(w.cropId), bed)) return { state: 'blocked', why: 'space' };
      // A kept sowing owns this many containers or trays, including when its original space was full.
      const key = kind === 'bench' ? 'trays' : 'ft', size = +w[key];
      if (kind !== 'tower' && size > eng.capOf(bed)) return { state: 'blocked', why: 'too-long' };
      source.bedId = bed.id;
      if (kind === 'tower' && run?.kind) source.towerUsedSites = eng.capOf(bed);
      else if (size > 0) source[key] = size;
      return Rails.propose(eng, { plantingId: w.id }, { bedId: bed.id, date }, { source, noShrink: true });
    }
    let res = Rails.propose(eng, { plantingId: w.id }, { bedId: bed.id, date, along: target.along, across: target.across }, { source });
    const soil = eng.isSoilBed(bed), own = soil && +w.ft > 0 ? +w.ft : null;
    if (own && res.state !== 'blocked' && res.r && !res.p.bedLayout) {
      const rect = res.rect, free = rect ? rect.a1 - rect.a0 : res.r.physicalLength;
      if (free > own + EPS) {
        const a0 = round(clamp(target.along != null ? Math.round(target.along - own / 2) : rect.a0, rect.a0, rect.a1 - own)), p = { ...res.p, ft: round(own) };
        if (a0 > EPS) p.startFt = a0; else delete p.startFt;
        const fit = eng.fit(p);
        if (fit.ok) res = { ...res, state: 'ok', p, r: fit.r, rect: fit.rect, from: fit.from, through: fit.through, shrunk: false };
      } else if (free < own - EPS) res = { ...res, state: 'partial', shrunk: true, wants: own };
      else res = { ...res, state: 'ok' };
    }
    if (!soil || (res.state !== 'partial' && !(res.state === 'blocked' && res.why === 'held'))) return res;
    // ground that is held, or only partly free: is there one crop it could be shared with?
    const r0 = res.r, from = res.from || (r0 && eng.occupancyFrom(res.p, r0)), through = res.through || (r0 && eng.occupancyThrough(res.p, r0));
    if (!r0 || !from) return res;
    const others = eng.holders(bed, from, through, null);
    const holder = others.length === 1 && !others[0].rest && !eng.standKey(others[0].p) && !others[0].p.liveTray ? others[0] : null;
    if (!holder) return res;
    res = { ...res, holder };
    if (options.quick) {
      // without trying them: is there anything to give up? Two feet of full width at least, or two rows
      const f = holder.rect, rows = f && f.rows ? f.rows.count : holder.r.rows, room = f && ((wholeWidth(f) && Math.min(f.a1, eng.capOf(bed)) - f.a0 >= 2 * Rails.MIN_FT - EPS) || (rows >= 2 && (f.rows ? f.rows.total : rows) <= 12));
      return res.state === 'blocked' && room ? { ...res, state: 'split' } : res;
    }
    const ways = splits(eng, w, { ...target, bedId: bed.id }, holder);
    if (ways.length) res = { ...res, ways, state: res.state === 'blocked' ? 'split' : res.state };
    return res;
  }
  /**
   * Ways a waiting planting could share a soil bed with the one crop that holds it then. Each: { id: 'length' | 'rows', holder, min, max, def, unit,
   * make(n) → { ops, p, r, keeps } | null }. `length`: the crop there gives up its last n feet. `rows`: it gives up n of its rows.
   * Nothing here changes the plan; make() tries the split on a copy and returns the edits for the app to make as one step.
   */
  function splits(eng, w, target, holder) {
    const bed = eng.bedOf(target.bedId), out = [], date = E.s2d(w.date), source = bare(w), f = holder.rect, L = eng.capOf(bed);
    if (!bed || !eng.isSoilBed(bed) || !f) return out;
    const trial = after => E.create({ ...eng.plan, plantings: eng.plan.plantings.map(q => q.id === holder.p.id ? after : q) }, eng.lib, PROBE);
    const end = Math.min(f.a1, L), len = end - f.a0;
    // by length: only a crop that holds the full width gives up feet (one that holds some rows gives up rows)
    if (wholeWidth(f) && len >= 2 * Rails.MIN_FT - EPS) {
      const max = Math.floor(len - Rails.MIN_FT + EPS), def = clamp(+w.ft > 0 ? Math.round(+w.ft) : Math.round(len / 2), 1, max);
      const make = n => {
        n = Math.round(+n);
        if (!(n >= 1 && n <= max)) return null;
        const st = Rails.stretch(eng, holder.p, 'end', end - n);
        if (!st || st.same || Math.abs(end - st.a1 - n) > 0.51 || end - st.a1 < Rails.MIN_FT - EPS) return null;
        const gave = round(end - st.a1);
        const after = changed(holder.p, st.change), probe = trial(after);
        let got = Rails.propose(probe, { plantingId: w.id }, { bedId: bed.id, date, along: st.a1 + n / 2 }, { source });
        if (got.state === 'blocked' || !got.r || got.p.bedLayout || !got.rect || got.rect.a0 < st.a1 - EPS) return null;
        // exactly the feet given up, where more happens to be free beyond them
        if (got.rect.a1 - got.rect.a0 > gave + EPS || got.rect.a0 > st.a1 + EPS) {
          const p = { ...got.p, ft: gave, startFt: round(st.a1) }, fit = probe.fit(p);
          if (!fit.ok) return null;
          got = { ...got, p, r: fit.r, rect: fit.rect };
        }
        return { ops: [{ before: holder.p, after }, { before: null, after: got.p }], p: got.p, r: got.r, keeps: round(st.a1 - st.a0), takes: round(got.r.physicalLength) };
      };
      if (max >= 1 && make(def)) out.push({ id: 'length', holder, min: 1, max, def, unit: 'ft', make });
    }
    // by rows: the crop there keeps its first rows and gives up the rest
    const total = f.rows ? f.rows.total : holder.r.rows, start = f.rows ? f.rows.start : 0, count = f.rows ? f.rows.count : total;
    if (Number.isInteger(total) && total >= 2 && total <= 12 && count >= 2) {
      const max = count - 1, def = Math.floor(count / 2);
      const make = n => {
        n = Math.round(+n);
        if (!(n >= 1 && n <= max)) return null;
        const change = Rails.rowsChange(eng, holder.p, start, count - n, total);
        if (!change) return null;
        const after = changed(holder.p, change), probe = trial(after), mid = (f.a0 + end) / 2;
        const got = Rails.propose(probe, { plantingId: w.id }, { bedId: bed.id, date, along: mid, across: (start + count - n / 2) / total }, { source });
        if (got.state === 'blocked' || !got.r || !got.rect || !got.rect.rows || got.rect.rows.count !== n) return null;
        return { ops: [{ before: holder.p, after }, { before: null, after: got.p }], p: got.p, r: got.r, keeps: count - n, takes: n, total };
      };
      if (make(def)) out.push({ id: 'rows', holder, min: 1, max, def, unit: 'rows', total, make });
    }
    return out;
  }
  /**
   * The spaces a waiting planting could go into whole, on its own date and in season: those of the gardens or beds it was
   * headed for first, then the rest of the farm. Each: { bed, garden, p, r, wanted }.
   */
  function homes(eng, w) {
    const crop = eng.crop(w.cropId), out = [];
    if (!crop || !isWaiting(w)) return out;
    const wait = w.wait || {}, beds = new Set(wait.beds || []), gardens = new Map((wait.gardens || []).map((id, i) => [id, i]));
    const rank = b => beds.has(b.id) ? -1 : gardens.has(b.gardenId) ? gardens.get(b.gardenId) : 1e6;
    for (const bed of eng.plan.beds || []) {
      if (!suits(eng, crop, bed)) continue;
      const res = landing(eng, w, { bedId: bed.id }, { quick: true });
      if (res.state !== 'ok' || !res.r || seasonTrouble(eng, res.p, res.r) || !(res.r.harvestDays > 0 || res.r.frostCut)) continue;
      out.push({ bed, garden: eng.gardenOf(bed), p: res.p, r: res.r, wanted: rank(bed) < 1e6, frost: frostNote(eng, res.p, res.r) });
    }
    const order = new Map((eng.plan.gardens || []).map((g, i) => [g.id, g.order ?? i]));
    return out.sort((a, b) => rank(a.bed) - rank(b.bed) || (order.get(a.bed.gardenId) ?? 0) - (order.get(b.bed.gardenId) ?? 0) || natural(a.bed.bed, b.bed.bed));
  }
  /** A waiting planting worked out in a space like the ones it is headed for, to show its days before it has a bed. Null when it cannot be. */
  function about(eng, w) {
    const crop = eng.crop(w.cropId);
    if (!crop || !isWaiting(w)) return null;
    const wait = w.wait || {}, named = (wait.beds || []).map(id => eng.bedOf(id)).filter(b => b && suits(eng, crop, b))[0];
    const origin = wait.from && eng.bedOf(wait.from);
    const bed = origin || named || spaces(eng, crop, wait.gardens || [])[0] || refSpace(eng, crop, null);
    if (!bed) return null;
    const p = { ...bare(w), bedId: bed.id, ...(origin && w.ft ? { ft: w.ft } : {}), ...(origin && w.trays ? { trays: w.trays } : {}) }, r = eng.evaluate(p);
    return r ? { p, r, bed, from: eng.occupancyFrom(p, r), through: eng.occupancyThrough(p, r) } : null;
  }
  /**
   * "Where on the farm could this crop go, and when?" Every opening its whole cycle fits, soonest first, and the beds with nothing
   * planned all year, by garden. options: { varietyId?, from? }.
   */
  function room(eng, cropId, options = {}) {
    const crop = eng.crop(cropId), out = { crop, openings: [], empty: [] };
    if (!crop) return out;
    const emptyBy = new Map();
    for (const o of openings(eng, { from: options.from, empty: true })) {
      if (!suits(eng, crop, o.bed)) continue;
      const t = tryCrop(eng, o, crop, { varietyId: options.varietyId });
      if (!t.ok) continue;
      if (!o.planted) { const g = emptyBy.get(o.garden.id) || emptyBy.set(o.garden.id, { garden: o.garden, beds: [], from: t.earliest, to: t.latest }).get(o.garden.id); g.beds.push(o.bed); if (t.earliest < g.from) g.from = t.earliest; if (t.latest > g.to) g.to = t.latest; }
      else out.openings.push({ opening: o, earliest: t.earliest, latest: t.latest, first: t.r.first, spare: t.spare, frost: t.frost || null });
    }
    out.empty = [...emptyBy.values()];
    return out;
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
   * Returns { ok, p, r, earliest, latest, spare, why, frost } — `why` says what stops it when it does not fit. A frost date stops
   * nothing: where it is all that is short, it is ok and `frost` is the engine's note. On its own first day a crop the frost
   * leaves nothing to pick is not offered; on a day asked for, it is.
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
    const frost = frostNote(eng, p, r);
    if (!(r.harvestDays > 0) && !(r.frostCut && E.validDate(asked))) return { ...base, ok: false, why: r.frostCut ? frost : 'Nothing would be ready before the season ends' };
    // a harvest is whole when it has the days it needs; the days the frost cuts off are counted, since the frost stops nothing
    const need = r.harvestMode === 'season' ? r.expectedHarvestDays : Math.max(1, Math.min(r.c.hw || 1, r.expectedHarvestDays || r.c.hw || 1));
    if (!(r.harvestDays >= need || (r.frostCut && r.frostCut.plannedDays >= need))) return { ...base, ok: false, why: `Only ${r.harvestDays} of its ${r.harvestMode === 'season' ? r.expectedHarvestDays : r.c.hw} harvest days fit` };
    if (frost) base.frost = frost;
    const spare = fit.through === Infinity ? -1 : E.dayDiff(opening.to, fit.through);
    if (!fit.ok || spare < 0) {
      const next = opening.before ? eng.crop(opening.before.p.cropId) : null;
      return { ...base, ok: false, spare, why: fit.over ? 'Does not fit the space' : spare < 0 ? `Needs the ground until ${day(fit.through)}, ${-spare} day${spare === -1 ? '' : 's'} past ${next ? 'the ' + next.name.toLowerCase() : 'the end of this opening'}` : 'Another crop holds part of this ground then' };
    }
    // the last day it could go in and still be out of the way: checked, because a later start can run a crop into a frost or a closed house
    let latest = date;
    if (!options.inner && spare > 0) {
      const lastDay = E.addDays(date, spare), wanted = last && last < lastDay ? last : lastDay;
      const late = wanted > date ? tryCrop(eng, opening, crop, { ...options, date: E.d2s(wanted), inner: true }) : null;
      if (late && late.ok && !late.frost) latest = wanted;   // as late as it goes in clear of the frost
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
    const band = t => (t.frost ? 8 : 0) + (t.rotation ? 4 : 0) + (t.covered == null ? 1 : t.covered < 0.25 ? 0 : t.covered < 0.75 ? 1 : 2);   // a crop the frost cuts after those that fit whole
    return out.sort((a, b) => band(a) - band(b) || a.r.first - b.r.first || a.crop.name.localeCompare(b.crop.name));
  }
  /** Free room on the heated benches, week by week: what the benches hold less the fullest day of each week. */
  function benchRoom(eng) {
    const cap = eng.heatedTraySpaces(), year = planYear(eng), weeks = [];
    if (!cap) return { cap: 0, weeks, least: null };
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) {
      const monday = E.addDays(d, -((d.getDay() + 6) % 7)), key = E.d2s(monday), total = eng.benchDay(d).pools.heated.used;   // what stands under heat: seedlings hardening off outside are not in it
      let w = weeks[weeks.length - 1];
      if (!w || w.key !== key) { w = { key, start: new Date(Math.max(+monday, +new Date(year, 0, 1))), most: 0 }; weeks.push(w); }
      if (total > w.most) w.most = total;
    }
    for (const w of weeks) w.free = Math.max(0, cap - w.most);
    const least = weeks.reduce((a, b) => !a || b.free < a.free ? b : a, null);
    return { cap, weeks, least };
  }

  return { planRun, runs, runPlantings, isRun, runGardens, runSource, NEAR, spaces, gardensFor, suits, openings, unheatedStart, candidates, tryCrop, fits, benchRoom, seasonTrouble, frostNote, kindWord, unitOfKind, LIMIT,
    waiting, isWaiting, bare, landing, splits, homes, about, room, refSpace };
});
