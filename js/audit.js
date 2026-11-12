/* Little River Farm Planner — the audit of figures kept on plantings.
 *
 * The assumptions list is meant to decide the plan's numbers. A planting that carries a figure of its own
 * does not listen to it. This module finds those figures, says what each would become if the planting
 * followed the list, and works out, before anything is changed, what a release would move:
 *
 *   survey()   how many plantings carry which figure of their own (cheap; shown on the Assumptions view)
 *   study()    the plantings that keep their own days, nursery weeks, yield, harvest days or turnover days,
 *              or a copy of the crop's values from the old planner, as rows to decide on
 *   build()    the one step that carries out a set of decisions
 *   preview()  what that step moves, and which double bookings it would start
 *
 * Three things can be done with a row:
 *   take    the list takes the plantings' figure, and they follow the list: no date moves
 *   follow  the plantings drop their figure and take the list's: dates move, and the preview says by how much
 *   keep    nothing changes
 *
 * Nothing here touches recorded work: a planting with any step ticked off keeps its figures.
 * A tray batch takes its days from the tray plan, which is its own list, so it is counted and left alone.
 * A tower cycle's one harvest day and no turnover are what make it a cycle: they are counted and left alone too.
 * Pure functions over a plan, so they run in Node for their tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./forecast.js'));
  else root.LRFAudit = factory(root.LRFEngine, root.LRFForecast);
})(typeof self !== 'undefined' ? self : this, function (E, F) {
  'use strict';
  const has = (p, k) => p[k] != null && p[k] !== '';
  const pinned = p => Number.isFinite(+p.dtm) && +p.dtm > 0;
  const trayBatch = p => !!p.liveTray;
  const recorded = p => !!p.done && E.DONE_KINDS.some(k => typeof p.done[k] === 'string' && p.done[k] !== '');
  /** The planting with its own days taken off. "Manual" goes with them: it only ever meant "use my number". */
  const freed = p => { const q = { ...p }; delete q.dtm; if (q.timingMode === 'manual') delete q.timingMode; return q; };
  /** The nursery weeks v7 froze on a planting, when it froze any. */
  const frozenWeeks = p => { const g = p.growingDefaults, x = g && g.v === 1 && g.cropId === p.cropId && g.crop && g.crop.gh; return x && x.present === true && Number.isFinite(+x.value) ? +x.value : null; };
  function thawed(p) {
    const g = p.growingDefaults, crop = { ...g.crop };
    delete crop.gh;
    return { ...p, growingDefaults: { ...g, crop } };
  }
  const waitingOf = plan => ((plan.lrfNext || {}).waiting) || [];
  const tally = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const same = (a, b) => !!a && !!b && +a.first === +b.first && +a.last === +b.last && +(a.sow || 0) === +(b.sow || 0);

  /** Every planting that keeps its own days and may be asked about: placed, not a tray batch, nothing recorded. */
  function open(plan) {
    const days = [], weeks = [], held = [];
    for (const p of plan.plantings) {
      if (trayBatch(p)) continue;
      if (recorded(p)) { if (pinned(p) || frozenWeeks(p) != null) held.push(p); continue; }
      if (pinned(p)) days.push(p);
      if (frozenWeeks(p) != null) weeks.push(p);
    }
    return { days, weeks, held };
  }

  /**
   * How many plantings carry which figure of their own. `days` and `nursery` can be released now;
   * the rest are counted so the size of what is still to come is plain.
   */
  function survey(eng, Lib) {
    const plan = eng.plan, P = plan.plantings, o = open(plan), n = f => P.filter(f).length;
    const ids = new Set(o.days.map(p => p.id));
    const bare = ids.size ? E.create({ ...plan, plantings: P.map(p => ids.has(p.id) ? freed(p) : p) }, Lib) : eng;
    let agree = 0;
    for (const p of o.days) if (same(eng.calc(p), bare.calc(bare.planting(p.id)))) agree++;
    const differs = p => { const c = eng.crop(p.cropId), b = eng.bedOf(p.bedId); return !!c && !!b && !eng.isRack(b) && +(c.gh || 0) !== frozenWeeks(p); };
    const other = p => { const g = p.growingDefaults; return !!(g && g.crop && Object.keys(g.crop).some(k => k !== 'gh')) || !!(g && g.variety && Object.keys(g.variety).length); };
    // Plantings whose supplier days are read by a start guessed from the wording of the supplier's page.
    const guess = P.filter(p => { if (pinned(p)) return false; const e = eng.effective(p), t = e && e.catalogTiming; return !!t && t.activeMode === 'catalog' && t.basisBy === 'guess'; });
    return {
      plantings: P.length, guessed: { plantings: guess.length, crops: [...new Set(guess.map(p => p.cropId))] },
      days: { own: o.days.length, agree, differ: o.days.length - agree, recorded: o.held.filter(pinned).length, waiting: waitingOf(plan).filter(pinned).length },
      nursery: { own: o.weeks.length, differ: o.weeks.filter(differs).length },
      trays: n(p => trayBatch(p) && pinned(p)),
      later: {
        window: n(p => !trayBatch(p) && (has(p, 'hw') || has(p, 'harvestMode'))), turnover: n(p => !trayBatch(p) && has(p, 'turnover')), yield: n(p => !trayBatch(p) && has(p, 'yield')),
        copy: n(p => !trayBatch(p) && other(p)), spacing: n(p => has(p, 'inRow') || has(p, 'rowSp') || has(p, 'rowsPerBed'))
      },
      // what the review window can let go: plantings in beds, towers and crates with nothing recorded
      harvest: (() => {
        const live = P.filter(p => !trayBatch(p) && !recorded(p)), free = live.filter(p => !cycle(p));
        return { yield: live.filter(ownYield).length, window: free.filter(ownWindow).length, turnover: free.filter(ownTurn).length, cycles: live.filter(p => cycle(p) && (ownWindow(p) || ownTurn(p))).length,
          copy: live.filter(p => copied(p).length).length, recorded: P.filter(p => !trayBatch(p) && recorded(p) && (ownYield(p) || ownWindow(p) || ownTurn(p))).length };
      })()
    };
  }

  /**
   * The rows to decide on. One row is the plantings of one crop and variety, in one growing condition, that carry
   * the same days; or the plantings of one crop that carry the same frozen nursery weeks; or waiting plantings.
   */
  function study(plan, Lib) {
    const eng = E.create(plan, Lib), o = open(plan), ids = new Set(o.days.map(p => p.id));
    const bare = E.create({ ...plan, plantings: plan.plantings.map(p => ids.has(p.id) ? freed(p) : p) }, Lib);
    const rows = new Map();
    for (const p of o.days) {
      const bed = eng.bedOf(p.bedId), env = eng.envOf(bed) || '', now = eng.calc(p), q = bare.planting(p.id), alone = bare.calc(q), e = bare.effective(q);
      if (!now || !alone || !e) continue;
      const key = ['days', p.cropId, p.varietyId || '', env, Math.round(+p.dtm)].join('|');
      const row = rows.get(key) || { key, kind: 'days', cropId: p.cropId, varietyId: p.varietyId || '', env, days: Math.round(+p.dtm), ids: [], listDays: new Set(), shifts: [], agrees: true, take: null };
      row.ids.push(p.id); row.listDays.add(e.dtm); row.shifts.push(E.dayDiff(alone.first, now.first));
      if (!same(now, alone)) row.agrees = false;
      rows.set(key, row);
    }
    const list = [...rows.values()];
    // Which rows could hand their figure to the list. One line of the list holds one number, so within a crop
    // and variety in one condition only the commonest figure can go there; a crop line only when the whole
    // crop agrees on it there.
    const byBucket = new Map(), byCrop = new Map();
    for (const r of list) {
      const b = [r.cropId, r.varietyId, r.env].join('|'), c = [r.cropId, r.env].join('|');
      byBucket.set(b, [...(byBucket.get(b) || []), r]); byCrop.set(c, [...(byCrop.get(c) || []), r]);
    }
    const cand = [];
    for (const r of list) {
      if (r.agrees || !r.env) continue;
      const mates = byBucket.get([r.cropId, r.varietyId, r.env].join('|')), main = mates.slice().sort((a, b) => b.ids.length - a.ids.length || a.days - b.days)[0];
      if (main !== r) continue;
      const alone = new Set(byCrop.get([r.cropId, r.env].join('|')).filter(x => !x.agrees).map(x => x.days)).size === 1;
      const level = alone ? 'crop' : r.varietyId ? 'variety' : null;
      if (level) cand.push({ row: r, level, typed: r.days });
    }
    // Try them all at once, and keep only those that leave every date where it is. A figure that starts at
    // sowing has the nursery time added on the way in; a crop line that would move someone else's planting
    // gives way to a line for the variety.
    for (let round = 0; round < 5 && cand.some(c => !c.ok && !c.dead); round++) {
      const next = clone(plan.assumptions) || { v: 1, crops: {}, varieties: {} };
      for (const c of cand) if (!c.dead) entry(next, c.level, c.level === 'crop' ? c.row.cropId : c.row.varietyId, c.row.env, c.typed);
      const sim = E.create({ ...plan, assumptions: next, plantings: plan.plantings.map(p => ids.has(p.id) ? freed(p) : p) }, Lib);
      for (const c of cand) {
        if (c.ok || c.dead) continue;
        const r = c.row, mine = r.ids.map(id => ({ a: eng.calc(eng.planting(id)), b: sim.calc(sim.planting(id)), e: sim.effective(sim.planting(id)) }));
        const others = plan.plantings.filter(p => p.cropId === r.cropId && !ids.has(p.id)).every(p => same(eng.calc(p), sim.calc(sim.planting(p.id))));
        if (!others) { if (c.level === 'crop' && r.varietyId) { c.level = 'variety'; c.typed = r.days; } else c.dead = true; continue; }
        if (mine.every(x => same(x.a, x.b))) { c.ok = true; continue; }
        const off = mine.map(x => x.e ? r.days - x.e.dtm : NaN);
        if (off.every(d => Number.isFinite(d) && d === off[0]) && off[0] !== 0 && !c.tuned) { c.typed += off[0]; c.tuned = true; } else if (c.level === 'crop' && r.varietyId) { c.level = 'variety'; c.typed = r.days; c.tuned = false; } else c.dead = true;
      }
    }
    for (const c of cand) if (c.ok) c.row.take = { level: c.level, id: c.level === 'crop' ? c.row.cropId : c.row.varietyId, env: c.row.env, typed: c.typed };
    for (const r of list) {
      r.listDays = [...r.listDays].sort((a, b) => a - b); r.shift = [Math.min(...r.shifts), Math.max(...r.shifts)]; delete r.shifts;
      r.choice = r.agrees ? 'follow' : r.take ? 'take' : 'keep';
    }
    // Nursery weeks frozen on the planting by v7, where the crop now says something else.
    const weeks = new Map();
    for (const p of o.weeks) {
      const c = eng.crop(p.cropId), bed = eng.bedOf(p.bedId), was = frozenWeeks(p);
      if (!c || !bed || eng.isRack(bed) || +(c.gh || 0) === was) continue;
      const key = ['weeks', p.cropId, was].join('|'), row = weeks.get(key) || { key, kind: 'weeks', cropId: p.cropId, varietyId: '', env: '', weeks: was, listWeeks: +(c.gh || 0), ids: [], agrees: false, take: null, choice: 'keep' };
      row.ids.push(p.id); weeks.set(key, row);
    }
    // Waiting plantings have no bed, so no date to compare. One follows the list when the placed plantings it was copied from do.
    const wait = new Map();
    for (const w of waitingOf(plan)) {
      if (!pinned(w)) continue;
      const key = ['wait', w.cropId, w.varietyId || '', Math.round(+w.dtm)].join('|'), row = wait.get(key) || { key, kind: 'wait', cropId: w.cropId, varietyId: w.varietyId || '', env: '', days: Math.round(+w.dtm), ids: [], agrees: false, take: null };
      row.ids.push(w.id); wait.set(key, row);
    }
    for (const r of wait.values()) { const twin = list.find(x => x.cropId === r.cropId && x.varietyId === r.varietyId && x.days === r.days); r.choice = twin && twin.choice !== 'keep' ? 'follow' : 'keep'; }
    const more = harvestRows(plan, Lib, eng);
    const order = (a, b) => String((eng.crop(a.cropId) || {}).name || '').localeCompare(String((eng.crop(b.cropId) || {}).name || '')) || String((eng.variety(a.varietyId) || {}).name || '').localeCompare(String((eng.variety(b.varietyId) || {}).name || '')) || (a.days || 0) - (b.days || 0);
    const bySize = (a, b) => order(a, b) || String(a.field || '').localeCompare(String(b.field || '')) || String(a.value).localeCompare(String(b.value), 'en', { numeric: true });
    return { rows: [...list.sort(order), ...[...weeks.values()].sort(order), ...[...wait.values()].sort(order), ...more.rows.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || bySize(a, b))], held: new Set([...o.held.map(p => p.id), ...more.held]).size };
  }

  // ───────────────────────── yield, harvest days, turnover, and the old planner's copies ─────────────────────────
  const KINDS = ['days', 'weeks', 'wait', 'yield', 'window', 'turn', 'copy'];
  const cycle = p => !!(p.towerCycle && p.towerCycle.v === 1);
  const ownYield = p => has(p, 'yield'), ownWindow = p => has(p, 'hw') || p.harvestMode === 'season' || p.harvestMode === 'window', ownTurn = p => has(p, 'turnover');
  /** Crop values the old planner copied onto a planting that bear on its harvest. The rest are facts about that planting (a bulb, a bought plant, its spacing). */
  const COPY = ['yield', 'price', 'mk', 'hw', 'harvestMode', 'yieldDays', 'harvestUntil', 'baseUnit', 'yBasis'];
  const frozen = p => { const g = p.growingDefaults; return g && g.v === 1 && g.cropId === p.cropId && g.crop && typeof g.crop === 'object' && !Array.isArray(g.crop) ? g.crop : null; };
  const copied = p => { const c = frozen(p); return c ? COPY.filter(k => c[k] && typeof c[k] === 'object') : []; };
  const STRIP = {
    yield: p => { const q = { ...p }; delete q.yield; return q; },
    window: p => { const q = { ...p }; delete q.hw; delete q.harvestMode; return q; },
    turn: p => { const q = { ...p }; delete q.turnover; return q; }
  };
  function uncopied(p, fields) {
    const g = p.growingDefaults, crop = { ...g.crop };
    for (const k of fields) delete crop[k];
    return { ...p, growingDefaults: { ...g, crop } };
  }
  /** Everything about a planting that a harvest figure can change: its dates, how long it holds its ground, and what it yields. */
  function figure(eng, p) {
    const r = p && eng.calc(p);
    if (!r) return null;
    const y = eng.yieldOf(p, r), through = eng.occupancyThrough(p, r);
    return { first: +r.first, last: +r.last, sow: +(r.sow || 0), through: through === Infinity ? Infinity : +through, units: y ? y.units : 0, unit: y ? y.unit : '', price: y ? y.price : 0, pattern: y ? y.pattern : '' };
  }
  const alike = (a, b) => !!a && !!b && a.first === b.first && a.last === b.last && a.sow === b.sow && a.through === b.through && Math.abs(a.units - b.units) < 1e-6 && a.unit === b.unit && Math.abs(a.price - b.price) < 1e-9 && a.pattern === b.pattern;
  const with_ = (plan, ids, strip) => ({ ...plan, plantings: plan.plantings.map(p => ids.has(p.id) ? strip(p) : p) });
  /** Write a figure the list takes from plantings onto its line, beside whatever the line already holds. */
  function put(a, take) {
    if (take.what === 'yield') {
      const kind = take.level === 'crop' ? 'crops' : 'varieties';
      a[kind] = a[kind] || {};
      const record = { ...(a[kind][take.id] || {}) };
      record[take.env] = { ...(record[take.env] || {}), yield: take.typed };
      a[kind][take.id] = record;
    } else { a.sell = a.sell || {}; a.sell[take.id] = { ...(a.sell[take.id] || {}), [take.what === 'window' ? 'days' : 'turnover']: take.typed }; }
  }
  const blank = () => ({ v: 1, crops: {}, varieties: {} });
  function harvestRows(plan, Lib, eng) {
    const live = plan.plantings.filter(p => !trayBatch(p)), open = live.filter(p => !recorded(p)), out = [];
    const held = live.filter(p => recorded(p) && (ownYield(p) || ownWindow(p) || ownTurn(p))).map(p => p.id);
    const windowOf = p => p.harvestMode === 'season' && !has(p, 'hw') ? 'season' : has(p, 'hw') ? String(Math.round(+p.hw)) : 'window';
    const kinds = [
      ['yield', open.filter(ownYield), p => String(+p.yield), (bare, q) => { const y = bare.yieldOf(q); return y ? +(+y.per).toFixed(3) : null; }],
      ['window', open.filter(p => ownWindow(p) && !cycle(p)), windowOf, (bare, q) => { const r = bare.calc(q); return r ? (r.harvestMode === 'season' ? 'season' : Math.round(r.c.hw)) : null; }],
      ['turn', open.filter(p => ownTurn(p) && !cycle(p)), p => String(Math.round(+p.turnover)), (bare, q) => bare.turnoverFor(q)]
    ];
    for (const [kind, list, valueOf, listOf] of kinds) {
      if (!list.length) continue;
      const ids = new Set(list.map(p => p.id)), strip = STRIP[kind], bare = E.create(with_(plan, ids, strip), Lib), split = kind === 'yield';
      // One row is the plantings of a crop that carry the same figure (for a yield: in one growing condition), told apart by whether
      // letting it go would change anything. A yield row no crop line can take is then set out variety by variety.
      let rows = new Map();
      for (const p of list) {
        const env = eng.envOf(eng.bedOf(p.bedId)) || '', now = figure(eng, p), q = bare.planting(p.id), alone = figure(bare, q);
        if (!now || !alone) continue;
        const value = valueOf(p), ok = alike(now, alone), key = [kind, p.cropId, split ? env : '', value, ok ? 'same' : 'own'].join('|');
        const row = rows.get(key) || { key, kind, cropId: p.cropId, varietyId: '', env: split ? env : '', value, ids: [], agrees: ok, take: null, list: new Set(), unit: now.unit, varieties: new Map() };
        row.ids.push(p.id); row.list.add(listOf(bare, q)); row.varieties.set(p.id, p.varietyId || '');
        rows.set(key, row);
      }
      const a0 = plan.assumptions || {}, lineOf = (level, id, env) => (((a0[level === 'crop' ? 'crops' : 'varieties'] || {})[id] || {})[env] || {}).yield;
      // A line that already holds a figure of the grower's is never written over.
      const taken = (level, id, env) => kind === 'yield' ? lineOf(level, id, env) != null && lineOf(level, id, env) !== '' : ((a0.sell || {})[id] || {})[kind === 'window' ? 'days' : 'turnover'] != null;
      const typedFor = r => { const n = +r.value; if (!Number.isFinite(n) || n < 0) return null; if (kind === 'window') return n >= 1 ? Math.round(n) : null; if (kind === 'turn') return Math.round(n); const h = eng.harvestFor(r.cropId); return h && h.weekly ? n * 7 / h.nominal : n; };
      const tryAll = cands => {
        if (!cands.length) return;
        const next = clone(plan.assumptions) || blank();
        for (const c of cands) put(next, { what: kind, level: c.level, id: c.id, env: c.env, typed: c.typed });
        const sim = E.create({ ...with_(plan, ids, strip), assumptions: next }, Lib);
        for (const c of cands) {
          const cropId = c.rows[0].cropId, mine = c.rows.flatMap(r => r.ids).every(id => alike(figure(eng, eng.planting(id)), figure(sim, sim.planting(id))));
          c.ok = mine && plan.plantings.filter(p => p.cropId === cropId && !ids.has(p.id)).every(p => alike(figure(eng, p), figure(sim, sim.planting(p.id))));
        }
        // one that fails may have spoiled another's test: try the ones that passed again, alone together
        const good = cands.filter(c => c.ok);
        if (good.length && good.length < cands.length) {
          const again = clone(plan.assumptions) || blank();
          for (const c of good) put(again, { what: kind, level: c.level, id: c.id, env: c.env, typed: c.typed });
          const sim2 = E.create({ ...with_(plan, ids, strip), assumptions: again }, Lib);
          for (const c of good) { const cropId = c.rows[0].cropId; c.ok = plan.plantings.filter(p => p.cropId === cropId).every(p => alike(figure(eng, p), figure(sim2, sim2.planting(p.id)))); }
        }
        for (const c of cands) if (c.ok) for (const r of c.rows) r.take = { what: kind, level: c.level, id: c.id, env: c.env || '', typed: c.typed };
      };
      // a crop's line, where every planting of the crop there that differs carries the one figure
      const groups = new Map();
      for (const r of rows.values()) if (!r.agrees) { const g = [r.cropId, r.env].join('|'); groups.set(g, [...(groups.get(g) || []), r]); }
      const whole = [];
      for (const group of groups.values()) {
        const first = group[0], typed = typedFor(first);
        if (group.length === 1 && typed != null && (kind !== 'yield' || first.env) && !taken('crop', first.cropId, first.env)) whole.push({ rows: group, level: 'crop', id: first.cropId, env: first.env, typed });
      }
      tryAll(whole);
      // else, for a yield, the variety's line
      if (split) {
        const next = new Map(), single = [];
        for (const r of rows.values()) {
          if (r.agrees || r.take) { next.set(r.key, r); continue; }
          for (const id of r.ids) {
            const vid = r.varieties.get(id), key = [kind, r.cropId, vid, r.env, r.value, 'own'].join('|');
            const row = next.get(key) || { ...r, key, varietyId: vid, ids: [], list: r.list, varieties: new Map() };
            row.ids.push(id); row.varieties.set(id, vid); next.set(key, row);
          }
        }
        rows = next;
        const byVariety = new Map();
        for (const r of rows.values()) if (!r.agrees && !r.take && r.varietyId && r.env) { const g = [r.varietyId, r.env].join('|'); byVariety.set(g, [...(byVariety.get(g) || []), r]); }
        for (const group of byVariety.values()) { const r = group[0], typed = typedFor(r); if (group.length === 1 && typed != null && !taken('variety', r.varietyId, r.env)) single.push({ rows: group, level: 'variety', id: r.varietyId, env: r.env, typed }); }
        tryAll(single);
      }
      for (const r of rows.values()) { r.list = [...r.list].filter(x => x != null); r.varieties = [...new Set(r.varieties.values())].filter(Boolean); r.choice = r.agrees ? 'follow' : r.take ? 'take' : 'keep'; out.push(r); }
    }
    // The old planner's copies of crop values. A copy that says what the crop says now changes nothing and is let go in one row;
    // one that says something else is a row of its own, let go where that changes nothing for its plantings and kept otherwise.
    const sameIds = {}, differ = new Map();
    for (const p of open) {
      const c = frozen(p), crop = eng.plan.crops && eng.crop(p.cropId), record = (plan.crops || []).find(x => x && x.id === p.cropId) || {}, lib = (Lib.crops || []).find(x => x.id === p.cropId) || {};
      if (!c || !crop) continue;
      for (const k of copied(p)) {
        const was = c[k].present === false ? undefined : c[k].value, now = k in record ? record[k] : lib[k];
        if (JSON.stringify(was === undefined ? null : was) === JSON.stringify(now === undefined ? null : now)) { (sameIds[p.id] = sameIds[p.id] || []).push(k); continue; }
        const key = ['copy', p.cropId, k, JSON.stringify(was === undefined ? null : was)].join('|'), row = differ.get(key) || { key, kind: 'copy', cropId: p.cropId, varietyId: '', env: '', field: k, value: was === undefined ? null : was, now: now === undefined ? null : now, ids: [], agrees: true, take: null };
        row.ids.push(p.id); differ.set(key, row);
      }
    }
    for (const r of differ.values()) {
      const ids = new Set(r.ids), bare = E.create(with_(plan, ids, p => uncopied(p, [r.field])), Lib);
      r.agrees = r.ids.every(id => alike(figure(eng, eng.planting(id)), figure(bare, bare.planting(id))));
      r.choice = r.agrees ? 'follow' : 'keep'; out.push(r);
    }
    const same = Object.keys(sameIds);
    if (same.length) out.push({ key: 'copy|same', kind: 'copy', cropId: '', varietyId: '', env: '', same: true, fields: sameIds, value: '', ids: same, agrees: true, take: null, choice: 'follow' });
    return { rows: out, held };
  }
  const clone = x => x == null ? null : JSON.parse(JSON.stringify(x));
  function entry(assumptions, level, id, env, days) {
    const kind = level === 'crop' ? 'crops' : 'varieties';
    assumptions[kind] = assumptions[kind] || {};
    assumptions[kind][id] = { ...(assumptions[kind][id] || {}), [env]: { ...((assumptions[kind][id] || {})[env] || {}), dtm: Math.round(days) } };
  }

  /** The one step that carries out the choices: `choices` maps a row's key to take, follow or keep. */
  function build(plan, rows, choices) {
    const pick = r => (choices && choices[r.key]) || r.choice, ops = [], by = new Map(plan.plantings.map(p => [p.id, p]));
    const next = clone(plan.assumptions) || blank(), after = new Map();
    const lines = new Set(), stays = new Set();
    let released = 0, kept = 0, thaw = 0, waiting = 0;
    for (const r of rows) {
      const choice = pick(r) === 'take' && !r.take ? 'keep' : pick(r), later = !['days', 'weeks', 'wait'].includes(r.kind);
      if (choice === 'keep') { if (later) r.ids.forEach(id => stays.add(id)); else kept += r.ids.length; continue; }
      if (r.kind === 'wait') { waiting += r.ids.length; continue; }
      if (choice === 'take' && later) { put(next, r.take); lines.add([r.take.what, r.take.level, r.take.id, r.take.env].join('|')); }
      else if (choice === 'take') { entry(next, r.take.level, r.take.id, r.take.env, r.take.typed); lines.add([r.take.level, r.take.id, r.take.env].join('|')); }
      for (const id of r.ids) {
        const p = after.get(id) || by.get(id);
        if (!p) continue;
        after.set(id, r.kind === 'weeks' ? thawed(p) : r.kind === 'days' ? freed(p) : r.kind === 'copy' ? uncopied(p, r.same ? r.fields[id] : [r.field]) : STRIP[r.kind](p));
      }
      if (r.kind === 'weeks') thaw += r.ids.length; else if (r.kind === 'days') released += r.ids.length;
    }
    // a planting counts once however many of its figures are let go; one that keeps any figure is among the kept
    for (const id of after.keys()) stays.delete(id);
    kept += stays.size;
    const taken = lines.size;   // lines of the list that take a number: two rows of one crop can share a line
    if (taken) ops.push({ kind: 'assume', before: plan.assumptions || null, after: next });
    for (const [id, to] of after) ops.push({ before: by.get(id), after: to });
    const list = waitingOf(plan), let_go = new Set(rows.filter(r => r.kind === 'wait' && pick(r) !== 'keep').flatMap(r => r.ids));
    if (let_go.size) ops.push({ kind: 'own', key: 'waiting', before: list, after: list.map(w => let_go.has(w.id) ? freed(w) : w) });
    return { ops, taken, released, kept, thaw, waiting, plantings: after.size + let_go.size };
  }
  /** The plan after a step. Only the kinds of change this module makes. */
  function apply(plan, ops) {
    const next = { ...plan }, by = new Map();
    for (const op of ops) {
      if (op.kind === 'assume') { if (op.after) next.assumptions = op.after; else delete next.assumptions; }
      else if (op.kind === 'own') next.lrfNext = { ...(next.lrfNext || {}), [op.key]: op.after };
      else by.set(op.before.id, op.after);
    }
    if (by.size) next.plantings = plan.plantings.map(p => by.get(p.id) || p);
    return next;
  }
  /** Pairs of plantings booked into the same ground. */
  function pairs(eng) {
    const set = new Set();
    for (const p of eng.plan.plantings) { const r = eng.calc(p); if (r) for (const o of eng.conflicts(p, r)) if (!o.rest) set.add([p.id, o.p.id].sort().join('|')); }
    return set;
  }
  /**
   * What a step moves. `moves` lists every planting whose first harvest, last harvest or sowing day changes;
   * `fresh` the double bookings the step would start, apart from those the plan already has.
   */
  function preview(plan, Lib, ops, before) {
    const was = before || E.create(plan, Lib), now = ops.length ? E.create(apply(plan, ops), Lib) : was, moves = [];
    if (ops.length) for (const p of plan.plantings) {
      const a = was.calc(p), q = now.planting(p.id), b = q && now.calc(q);
      if (!a || !b) continue;
      const first = E.dayDiff(b.first, a.first), last = E.dayDiff(b.last, a.last), sow = a.sow && b.sow ? E.dayDiff(b.sow, a.sow) : 0;
      if (first || last || sow) moves.push({ id: p.id, first, last, sow });
    }
    const old = pairs(was), after = ops.length ? pairs(now) : old, fresh = [...after].filter(k => !old.has(k)).map(k => k.split('|')), settled = [...old].filter(k => !after.has(k)).map(k => k.split('|'));
    const most = moves.reduce((m, x) => Math.abs(x.first) > Math.abs(m) ? x.first : m, 0), mostSow = moves.reduce((m, x) => Math.abs(x.sow) > Math.abs(m) ? x.sow : m, 0);
    // what the step does to yields, to what the season is worth, and to how long ground is held
    const yields = [], ground = [];
    if (ops.length) for (const p of plan.plantings) {
      const a = figure(was, p), b = figure(now, now.planting(p.id));
      if (!a || !b) continue;
      if (Math.abs(a.units - b.units) > 1e-6 || a.unit !== b.unit || Math.abs(a.price - b.price) > 1e-9) yields.push({ id: p.id, cropId: p.cropId, unit: [a.unit, b.unit], units: [a.units, b.units], price: [a.price, b.price] });
      if (a.through !== b.through && Number.isFinite(a.through) && Number.isFinite(b.through)) ground.push({ id: p.id, days: Math.round((b.through - a.through) / 86400000) });
    }
    const fa = F.build(was), fb = ops.length ? F.build(now) : fa, worthOf = m => m.rows.reduce((n, r) => n + r.worth, 0), totals = m => new Map(m.rows.map(r => [r.key, r]));
    const ta = totals(fa), tb = totals(fb), crops = [];
    for (const key of new Set([...ta.keys(), ...tb.keys()])) {
      const a = ta.get(key), b = tb.get(key), one = a || b;
      if (Math.abs((a ? a.total : 0) - (b ? b.total : 0)) > 1e-6 || Math.abs((a ? a.worth : 0) - (b ? b.worth : 0)) > 0.005) crops.push({ cropId: one.cropId, name: one.name, unit: one.unit, group: one.group, total: [a ? a.total : 0, b ? b.total : 0], worth: [a ? a.worth : 0, b ? b.worth : 0] });
    }
    return { moves, harvest: moves.filter(x => x.first || x.last).length, sowing: moves.filter(x => x.sow).length, most, mostSow, fresh, settled, standing: old.size, engine: now,
      yields, ground, crops: crops.sort((a, b) => Math.abs(b.worth[1] - b.worth[0]) - Math.abs(a.worth[1] - a.worth[0])), worth: [worthOf(fa), worthOf(fb)] };
  }

  return { survey, study, build, apply, preview, pairs, freed, pinned, recorded, trayBatch, frozenWeeks, figure, alike, cycle, copied, KINDS, COPY };
});
