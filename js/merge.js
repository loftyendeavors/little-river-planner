/* Little River Farm Planner — two copies of one plan joined, record by record.
 *
 * merge(start, mine, theirs) takes three plans: the plan as it stood when this device and the cloud last held the same one
 * (start), the plan as it is here (mine), and the plan the cloud holds now (theirs). It gives one plan that keeps what each
 * side changed since the start, and a report of what it could not keep. No page is touched and nothing is stored: three
 * plans in, one plan out. The three are never changed. It takes a plan as a file holds it or as the planner works on it.
 *
 * It goes by shape, not by a list of the kinds of record a plan holds:
 *   an object                         is joined key by key
 *   a list of records that have ids   is joined record by record. A record either side added is kept. One side took a
 *                                     record out and the other changed it: it stays, as changed. The order is the cloud's,
 *                                     then what this device added.
 *   anything else                     is one value. Changed on one side: that side's. Changed on both, to different values:
 *                                     the cloud's stands, and this device's is in the report.
 *
 * and these are not left to shape:
 *   a thing taken whole     a bed's place on the map, a planting's layout in its bed and the like (WHOLE): never half from
 *                           each side.
 *   a stamp                 "last changed at": the later one, and nothing is said.
 *   a planting's place      which bed, how long, where in it; and its day with a sowing day set by hand. Each is one value.
 *   a recording             a job ticked as done on a planting is one unit: its day, its line of history, the seed it drew.
 *                           Recorded on one side: it stands whole, and the planting's place and day are that side's (a move
 *                           made on the other side is reported, not applied). Recorded on both: the cloud's stands whole and
 *                           this device's is dropped whole, its seed with it.
 *   seed on hand            a lot's count is never joined as a number. It is the cloud's count, plus what this device did to
 *                           it other than by a recorded sowing (read from the change log, whose entries have ids, so the same
 *                           change seen twice counts once), less the seed of the sowings in the joined plan that the cloud's
 *                           plan does not have, plus the seed of those it has and the joined plan does not. A count never
 *                           goes below zero: what a lot could not cover is kept as seed used without a counted lot.
 *
 * Before the joined plan is given back it is put through five tests (verify). If one fails nothing is joined: the answer is
 * { ok: false, why }, and whoever asked does what the planner did before there was a merge, which is to ask which plan to keep.
 */
(function (root) {
  'use strict';

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  /** The same value: objects whatever the order of their keys, lists in their order. */
  function same(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const listA = Array.isArray(a);
    if (listA !== Array.isArray(b)) return false;
    if (listA) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) if (!Object.prototype.hasOwnProperty.call(b, key) || !same(a[key], b[key])) return false;
    return true;
  }
  /** A value as text that is the same for the same value (keys in order): how a line with no id is told from another. */
  const canon = v => JSON.stringify(v, (key, value) => (isObj(value) ? Object.keys(value).sort().reduce((o, k) => { o[k] = value[k]; return o; }, {}) : value));
  const usable = id => typeof id === 'string' || typeof id === 'number';
  /** The ids of a list of records, or null when it is not one: every member an object with an id, no id twice. */
  function idsOf(list) {
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    for (const x of list) { if (!isObj(x) || !usable(x.id) || seen.has(x.id)) return null; seen.add(x.id); }
    return seen;
  }
  /** Are these the same list of records, seen on each side? A side that has no such list, or an empty one, does not say no. */
  const recordLists = (...lists) => lists.some(l => Array.isArray(l) && l.length) && lists.every(l => l === undefined || l === null || (Array.isArray(l) && !!idsOf(l)));
  /** Lines with no ids, as a bag: `a` without one of each line of `b`. */
  function minus(a, b) {
    const left = new Map();
    for (const x of b) { const k = canon(x); left.set(k, (left.get(k) || 0) + 1); }
    return a.filter(x => { const k = canon(x), n = left.get(k) || 0; if (n) { left.set(k, n - 1); return false; } return true; });
  }
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round6 = n => Math.round(n * 1e6) / 1e6;
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  // Where a rule other than shape applies, by the place in the plan: "plantings[].bedLayout" is the key bedLayout of any
  // record of the list plantings.
  /** Taken whole from one side, never half from each. */
  const WHOLE = new Set(['beds[].px', 'beds[].potLayout', 'gardens[].bedOrder', 'gardens[].mapLayout', 'map.imageFile', 'nursery.spaces[].benchLayout',
    'plantings[].bedLayout', 'plantings[].growingDefaults', 'plantings[].liveTray', 'varieties[].supplierPacks', 'varieties[].prices', 'varieties[].webImport']);
  /** Who saved a file and with what: the cloud's, and nothing is said. */
  const QUIET = new Set(['lrfNextKeep.device', 'lrfNextKeep.v']);
  const STAMPS = new Set(['updatedAt', 'savedAt']);
  /**
   * Lists that hold records with no id and are still joined line by line, and what answers for each. Any other list whose
   * members are objects without ids is one value: the cloud's stands when both sides change it, which is safe and blunt.
   * A check holds the made-up farm to this list and to WHOLE, so that a build which adds such a list has to say how it is joined.
   */
  const NO_IDS = {
    'plantings[].workflow.history': 'the lines each side added are kept',
    'plantings[].workflow.seedUse': 'by the sowing each line belongs to'
  };
  /** Where a planting is, and when: each is one value. */
  const PLACE = ['bedId', 'ft', 'startFt', 'bedLayout', 'seat'], TIME = ['date', 'sowOn'];

  // ───────────────────────────── by shape ─────────────────────────────
  const said = (ctx, item) => { ctx.report.items.push(item); };
  function join(ctx, pat, path, s, m, t) {
    if (same(m, t) || same(s, m)) return t;
    if (same(s, t)) return m;
    // changed on both sides, and not to the same thing
    const rule = ctx.rules[pat];
    if (rule) return rule(ctx, pat, path, s, m, t);
    const key = path[path.length - 1];
    if (STAMPS.has(key) && typeof m === 'string' && typeof t === 'string') return m > t ? m : t;
    if (QUIET.has(pat)) return t;
    if (!WHOLE.has(pat)) {
      if (isObj(m) && isObj(t) && (s === undefined || s === null || isObj(s))) return joinObject(ctx, pat, path, s || {}, m, t);
      if (recordLists(s, m, t) && Array.isArray(m) && Array.isArray(t)) return joinRecords(ctx, pat, path, s || [], m, t);
    }
    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });
    return t;
  }
  function joinObject(ctx, pat, path, s, m, t, special) {
    const out = {};
    for (const key of [...Object.keys(t), ...Object.keys(m).filter(k => !Object.prototype.hasOwnProperty.call(t, k))]) {
      const value = special && Object.prototype.hasOwnProperty.call(special, key) ? special[key] : join(ctx, pat ? pat + '.' + key : key, path.concat(key), s[key], m[key], t[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  function joinRecords(ctx, pat, path, s, m, t) {
    const S = new Map(s.map(x => [x.id, x])), M = new Map(m.map(x => [x.id, x])), T = new Map(t.map(x => [x.id, x])), out = [];
    for (const rec of t) {
      const here = [...path, '#' + rec.id];
      if (M.has(rec.id)) out.push(join(ctx, pat + '[]', here, S.get(rec.id), M.get(rec.id), rec));
      else if (!S.has(rec.id)) out.push(rec);                                    // the cloud added it
      else if (!same(S.get(rec.id), rec)) { out.push(rec); said(ctx, { kind: 'kept', path: here, id: rec.id, removedBy: 'mine' }); }   // taken out here, changed there: it stays, as changed
    }
    for (const rec of m) {
      if (T.has(rec.id)) continue;
      const here = [...path, '#' + rec.id];
      if (!S.has(rec.id)) out.push(rec);                                         // this device added it
      else if (!same(S.get(rec.id), rec)) { out.push(rec); said(ctx, { kind: 'kept', path: here, id: rec.id, removedBy: 'theirs' }); }
    }
    return out;
  }

  // ───────────────────────────── a planting, and the work recorded on it ─────────────────────────────
  const flowOf = p => (isObj(p) && isObj(p.workflow) ? p.workflow : {});
  const linesOf = (p, key) => { const list = flowOf(p)[key]; return Array.isArray(list) ? list : []; };
  const doneOf = p => (isObj(p) && isObj(p.done) ? p.done : {});
  /** A planting whose record of work this script cannot read is joined by shape alone. */
  const readable = p => (p.done == null || isObj(p.done)) && (p.workflow == null || (isObj(p.workflow) && ['history', 'seedUse'].every(k => p.workflow[k] == null || Array.isArray(p.workflow[k]))));
  /** A job as it is recorded on a planting: its day, the line of history that recorded it, and the sowing that line names. */
  function jobOf(p, kind) {
    const date = doneOf(p)[kind];
    if (date == null) return null;
    const history = linesOf(p, 'history');
    let line = null;
    for (let i = history.length - 1; i >= 0; i--) { const x = history[i]; if (isObj(x) && x.kind === kind) { line = x.action === 'complete' ? x : null; break; } }
    return { date, line, batch: line && isObj(line.sowingReview) && line.sowingReview.batchId != null ? line.sowingReview.batchId : null };
  }
  const sameJob = (a, b) => (!a && !b) || (!!a && !!b && same(a.date, b.date) && same(a.line, b.line));
  const kindOf = line => (isObj(line) ? line.kind : undefined), batchOf = line => (isObj(line) && line.batchId != null ? line.batchId : null);

  function joinPlanting(ctx, pat, path, s, m, t) {
    if (!isObj(m) || !isObj(t) || (s != null && !isObj(s))) { said(ctx, { kind: 'same-box', path, mine: m, theirs: t }); return t; }
    const s0 = s || {};
    if (![s0, m, t].every(readable)) return joinObject(ctx, pat, path, s0, m, t);
    const id = t.id, done = {}, lost = new Set(), dropped = new Set(), kept = new Set();
    let mineStands = false, theirsRecorded = false;
    for (const kind of new Set([...Object.keys(doneOf(t)), ...Object.keys(doneOf(m)), ...Object.keys(doneOf(s0))])) {
      const js = jobOf(s0, kind), jm = jobOf(m, kind), jt = jobOf(t, kind);
      let pick = jt;
      if (sameJob(jm, jt) || sameJob(js, jm)) pick = jt;
      else if (sameJob(js, jt)) { pick = jm; if (jm) mineStands = true; }
      else {
        // recorded, or taken back, on both sides and not alike: the cloud's stands whole, and this device's is dropped whole
        lost.add(kind);
        if (jm && jm.batch != null && !(jt && jt.batch === jm.batch)) dropped.add(jm.batch);
        if (js && js.batch != null) kept.add(js.batch);
        said(ctx, { kind: 'recorded-twice', path, id, job: kind, mine: jm ? jm.date : null, theirs: jt ? jt.date : null });
      }
      if (jt && !sameJob(jt, js)) theirsRecorded = true;
      if (pick) done[kind] = pick.date;
    }
    // history: the cloud's lines, less those this device took out, then the lines this device added. Nothing of a job this device lost.
    const hs = linesOf(s0, 'history'), hm = linesOf(m, 'history'), ht = linesOf(t, 'history');
    const history = minus(ht, minus(hs, hm).filter(x => !lost.has(kindOf(x)))).concat(minus(minus(hm, hs), ht).filter(x => !lost.has(kindOf(x))));
    // seed used: line by line, by the sowing each belongs to
    const us = linesOf(s0, 'seedUse'), um = linesOf(m, 'seedUse'), ut = linesOf(t, 'seedUse');
    const seedUse = minus(ut, minus(us, um).filter(x => !kept.has(batchOf(x)))).concat(minus(minus(um, us), ut).filter(x => !dropped.has(batchOf(x))));
    const special = { done: Object.keys(done).length ? done : undefined };
    if (isObj(m.workflow) || isObj(t.workflow)) {
      const fm = flowOf(m), ft = flowOf(t), own = { history: history.length || Array.isArray(ft.history) ? history : undefined, seedUse: seedUse.length ? seedUse : undefined };
      const flow = joinObject(ctx, pat + '.workflow', path.concat('workflow'), flowOf(s0), { history: [], seedUse: [], ...fm }, { history: [], seedUse: [], ...ft }, own);
      special.workflow = flow;
    }
    // where it is and when: one value each, and the side that recorded work has both
    const side = theirsRecorded ? 't' : mineStands ? 'm' : '';
    for (const [keys, what] of [[PLACE, 'place'], [TIME, 'day']]) {
      const of = p => keys.map(k => p[k]), ms = same(of(m), of(s0)), ts = same(of(t), of(s0)), mt = same(of(m), of(t)), shown = p => Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
      let from = t;
      if (side === 't') { if (!mt && !ms) said(ctx, { kind: 'move-not-applied', path, id, what, whose: 'mine', mine: shown(m), theirs: shown(t) }); }
      else if (side === 'm') { from = m; if (!mt && !ts) said(ctx, { kind: 'move-not-applied', path, id, what, whose: 'theirs', mine: shown(m), theirs: shown(t) }); }
      else if (mt || ms) from = t;
      else if (ts) from = m;
      else said(ctx, { kind: 'same-box', path: path.concat(what), mine: shown(m), theirs: shown(t) });
      for (const key of keys) special[key] = from[key];
    }
    return joinObject(ctx, pat, path, s0, m, t, special);
  }

  // ───────────────────────────── seed on hand ─────────────────────────────
  const stockOf = plan => (isObj(plan) && isObj(plan.seedInventory) ? plan.seedInventory : null);
  const listOf = (obj, key) => (obj && Array.isArray(obj[key]) ? obj[key].filter(isObj) : []);
  /** Seed drawn from counted lots by the sowings recorded in a plan: lot id -> amount. */
  function drawsOf(plan) {
    const out = new Map();
    for (const p of listOf(plan, 'plantings')) for (const u of linesOf(p, 'seedUse')) if (isObj(u) && u.lotId != null && num(u.quantity) > 0) out.set(u.lotId, round6((out.get(u.lotId) || 0) + num(u.quantity)));
    return out;
  }
  /** Is this entry of the change log a recorded sowing drawing on a lot, or one taken back? Those are counted from the plantings, not from the log. */
  const ofSowing = e => (e.kind === 'use' && /^Reviewed sowing \S+: /.test(String(e.reason || ''))) || (e.kind === 'count' && /^Sowing \S+ taken back: /.test(String(e.reason || '')));
  const changeOf = e => (isObj(e.before) && isObj(e.after) ? round6(num(e.after.quantity) - num(e.before.quantity)) : 0);
  /**
   * What one side did to each lot's count that the other side's log does not hold: lot id -> amount. Entries the side has
   * and neither the other nor the start has count as made; entries of the start that the other still has and the side no
   * longer has count as taken back (an undo).
   * `all` counts the sowings too.
   */
  function ownChanges(side, other, start, all) {
    const has = inv => new Set(listOf(inv, 'adjustments').map(e => e.id)), mine = has(side), theirs = has(other), first = has(start), out = new Map();
    const add = (e, sign) => { if (!usable(e.id) || e.lotId == null || (!all && ofSowing(e))) return; const d = changeOf(e); if (d) out.set(e.lotId, round6((out.get(e.lotId) || 0) + sign * d)); };
    for (const e of listOf(side, 'adjustments')) if (!theirs.has(e.id) && !first.has(e.id)) add(e, 1);   // an entry of the start that the other side lacks is one the other side took back, not one this side made
    for (const e of listOf(start, 'adjustments')) if (theirs.has(e.id) && !mine.has(e.id)) add(e, -1);
    return out;
  }
  /** The count each lot of the joined plan should hold, worked from the three plans and the joined plantings: lot id -> { q, clash }. */
  function counts(start, mine, theirs, plan) {
    const iS = stockOf(start), iM = stockOf(mine), iT = stockOf(theirs), out = new Map();
    const lotsM = new Map(listOf(iM, 'lots').map(l => [l.id, l])), lotsT = new Map(listOf(iT, 'lots').map(l => [l.id, l]));
    const dM = drawsOf(mine), dT = drawsOf(theirs), dP = drawsOf(plan);
    const mineOnly = ownChanges(iM, iT, iS, false), theirsOnly = ownChanges(iT, iM, iS, false);
    for (const lot of listOf(stockOf(plan), 'lots')) {
      const lt = lotsT.get(lot.id), lm = lotsM.get(lot.id), base = lt || lm;
      if (!base || !usable(lot.id)) continue;
      let own = lt && lm ? mineOnly.get(lot.id) || 0 : 0, clash = false;
      if (own && theirsOnly.get(lot.id)) { own = 0; clash = true; }   // counted by hand on both sides: the cloud's count stands
      out.set(lot.id, { q: round6(num(base.quantity) + own + ((lt ? dT : dM).get(lot.id) || 0) - (dP.get(lot.id) || 0)), clash, mine: lm, theirs: lt });
    }
    return out;
  }
  /** Set each lot's count. A lot that would go below zero is left at zero, and the seed it could not cover is kept on its sowing as seed used without a counted lot. */
  function settleStock(ctx, start, mine, theirs, plan) {
    const inv = stockOf(plan);
    if (!inv || !Array.isArray(inv.lots)) return plan;
    // this device's own log must account for its counts: if it does not, the arithmetic below would lose a change without a word
    const iS = stockOf(start), iM = stockOf(mine);
    if (iM) {
      const was = new Map(listOf(iS, 'lots').map(l => [l.id, l])), did = ownChanges(iM, iS, iS, true);
      for (const lot of listOf(iM, 'lots')) { const before = was.get(lot.id); if (before && lot.deleted !== true && !near(num(lot.quantity), num(before.quantity) + (did.get(lot.id) || 0))) throw new Error('The seed on hand here does not follow its own record of changes.'); }
    }
    let plantings = plan.plantings;
    const theirsById = new Map(listOf(theirs, 'plantings').map(p => [p.id, p]));
    const want = counts(start, mine, theirs, plan), lots = inv.lots.slice();
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i], to = isObj(lot) ? want.get(lot.id) : null;
      if (!to) continue;
      let q = to.q;
      if (to.clash) said(ctx, { kind: 'same-box', path: ['seedInventory', 'lots', '#' + lot.id, 'quantity'], mine: to.mine.quantity, theirs: to.theirs.quantity });
      if (q < -1e-6) {
        // more was drawn on two devices than the lot held. What this device's sowings took beyond it becomes seed used without a counted lot.
        let short = round6(-q);
        const whole = short;
        plantings = plantings.slice();
        for (let j = plantings.length - 1; j >= 0 && short > 1e-6; j--) {
          const p = plantings[j], uses = linesOf(p, 'seedUse');
          if (!uses.some(u => isObj(u) && u.lotId === lot.id)) continue;
          const added = new Set(minus(uses, linesOf(theirsById.get(p.id), 'seedUse')).map(canon)), next = [];
          for (let k = uses.length - 1; k >= 0; k--) {
            const u = uses[k];
            if (!(short > 1e-6) || !isObj(u) || u.lotId !== lot.id || !added.has(canon(u))) { next.unshift(u); continue; }
            const take = Math.min(short, num(u.quantity)), left = round6(num(u.quantity) - take);
            short = round6(short - take);
            const loose = { ...u, lotId: null, quantity: take, untracked: true };
            if (left > 1e-6) next.unshift({ ...u, quantity: left }, loose); else next.unshift(loose);
          }
          plantings[j] = { ...p, workflow: { ...p.workflow, seedUse: next } };
        }
        said(ctx, { kind: 'seed-short', path: ['seedInventory', 'lots', '#' + lot.id], id: lot.id, short: whole });
        q = 0;
      }
      if (!near(num(lot.quantity), q)) lots[i] = { ...lot, quantity: q };
    }
    return { ...plan, plantings, seedInventory: { ...inv, lots } };
  }

  /** A planting put on a bed on one side while the other changed it as it waited would be both on a bed and waiting: placed wins. */
  function settleWaiting(ctx, theirs, plan) {
    const placed = new Set(listOf(plan, 'plantings').map(p => p.id));
    const clean = (own, theirOwn, path) => {
      if (!isObj(own) || !Array.isArray(own.waiting)) return own;
      const before = new Set(listOf(theirOwn, 'waiting').map(w => w.id)), stillTheirs = new Set(listOf(theirs, 'plantings').map(p => p.id));
      const waiting = own.waiting.filter(w => { const twice = isObj(w) && placed.has(w.id) && !(before.has(w.id) && stillTheirs.has(w.id)); if (twice) said(ctx, { kind: 'placed-and-waiting', path: path.concat('#' + w.id), id: w.id }); return !twice; });
      return waiting.length === own.waiting.length ? own : { ...own, waiting };
    };
    const out = { ...plan };
    if (isObj(plan.lrfNext)) out.lrfNext = clean(plan.lrfNext, theirs.lrfNext, ['lrfNext', 'waiting']);
    if (isObj(plan.lrfNextKeep) && isObj(plan.lrfNextKeep.keep)) out.lrfNextKeep = { ...plan.lrfNextKeep, keep: clean(plan.lrfNextKeep.keep, isObj(theirs.lrfNextKeep) ? theirs.lrfNextKeep.keep : null, ['lrfNextKeep', 'keep', 'waiting']) };
    return out;
  }

  // ───────────────────────────── the five tests ─────────────────────────────
  /** Every list of records in a plan, with the same list on the other plans beside it: fn(pattern, path, list, ...others). */
  function eachList(pat, path, node, others, fn) {
    if (Array.isArray(node)) {
      if (!node.length || !idsOf(node)) return;
      fn(pat, path, node, others.map(o => (Array.isArray(o) && idsOf(o) ? o : null)));
      const maps = others.map(o => (Array.isArray(o) && idsOf(o) ? new Map(o.map(x => [x.id, x])) : null));
      for (const rec of node) eachList(pat + '[]', path.concat('#' + rec.id), rec, maps.map(mp => (mp ? mp.get(rec.id) : undefined)), fn);
    } else if (isObj(node)) for (const key of Object.keys(node)) { const child = node[key]; if (child !== null && typeof child === 'object') eachList(pat ? pat + '.' + key : key, path.concat(key), child, others.map(o => (isObj(o) ? o[key] : undefined)), fn); }
  }
  const repeats = list => { const seen = new Set(); for (const x of list) { if (isObj(x) && usable(x.id)) { if (seen.has(x.id)) return x.id; seen.add(x.id); } } return null; };
  /** Lists whose members are objects and that have no usable ids, or an id twice: [{ pattern, why: 'no-id' | 'repeated', n }]. */
  function unkeyed(plan) {
    const out = new Map();
    (function walk(pat, node) {
      if (WHOLE.has(pat)) return;   // taken whole: what is inside it is never joined
      if (Array.isArray(node)) {
        const objects = node.filter(isObj);
        if (objects.length && !idsOf(node)) { const why = objects.every(x => usable(x.id)) && objects.length === node.length ? 'repeated' : 'no-id', key = pat + '|' + why; out.set(key, { pattern: pat, why, n: ((out.get(key) || {}).n || 0) + 1 }); }
        for (const x of node) walk(pat + '[]', x);
      } else if (isObj(node)) for (const key of Object.keys(node)) walk(pat ? pat + '.' + key : key, node[key]);
    })('', plan);
    return [...out.values()];
  }
  /**
   * The five tests a joined plan must pass before it is used. Returns '' when it passes, or the reason it does not.
   *   1. it opens as a plan
   *   2. no id is repeated
   *   3. every record either side added or changed is there, or its absence is in the report
   *   4. every day of recorded work, from either side, is there
   *   5. the seed that came off the lots adds up
   */
  function verify(start, mine, theirs, plan, report) {
    const items = (report && report.items) || [];
    // 1
    if (!isObj(plan)) return 'The joined plan is not a plan.';
    for (const key of ['gardens', 'beds', 'plantings']) if (!Array.isArray(plan[key])) return `The joined plan has no ${key}.`;
    let text;
    try { text = JSON.stringify(plan); } catch (_) { return 'The joined plan cannot be written as a file.'; }
    if (!same(JSON.parse(text), plan)) return 'The joined plan does not read back as it was written.';
    // 2: a list that is joined record by record has each id once. A list that already had an id twice on a side is not held to it.
    let why = '';
    const lists = (node, fn) => (function walk(pat, path, n, a, b) {
      if (Array.isArray(n)) {
        fn(pat, path, n, Array.isArray(a) ? a : null, Array.isArray(b) ? b : null);
        const ok = idsOf(n), A = ok && Array.isArray(a) && idsOf(a) ? new Map(a.map(x => [x.id, x])) : null, B = ok && Array.isArray(b) && idsOf(b) ? new Map(b.map(x => [x.id, x])) : null;
        if (ok) for (const rec of n) walk(pat + '[]', path.concat('#' + rec.id), rec, A ? A.get(rec.id) : undefined, B ? B.get(rec.id) : undefined);
      } else if (isObj(n)) for (const key of Object.keys(n)) { const child = n[key]; if (child !== null && typeof child === 'object') walk(pat ? pat + '.' + key : key, path.concat(key), child, isObj(a) ? a[key] : undefined, isObj(b) ? b[key] : undefined); }
    })('', [], node, mine, theirs);
    lists(plan, (pat, path, list, a, b) => { const twice = repeats(list); if (twice != null && !why && !(a && repeats(a) != null) && !(b && repeats(b) != null)) why = `An id is there twice in the joined plan (${path.join('.') || 'the plan'}: ${twice}).`; });
    if (why) return why;
    // 3
    const excused = new Set(items.filter(x => x.kind === 'placed-and-waiting').map(x => String(x.id)));
    const whole = items.filter(x => x.kind === 'same-box' && Array.isArray(x.path)).map(x => x.path.join('\u0000') + '\u0000'), under = path => { const at = path.join('\u0000') + '\u0000'; return whole.some(w => at.startsWith(w)); };
    for (const side of [mine, theirs]) {
      eachList('', [], side, [start, plan], (pat, path, list, [before, after]) => {
        if (why) return;
        const was = before ? new Map(before.map(x => [x.id, x])) : new Map(), now = after ? new Set(after.map(x => x.id)) : null;
        for (const rec of list) if ((!was.has(rec.id) || !same(was.get(rec.id), rec)) && !(now && now.has(rec.id)) && !(excused.has(String(rec.id)) && /waiting$/.test(pat)) && !under(path)) { why = `A record one side added or changed is not in the joined plan (${path.concat('#' + rec.id).join('.')}).`; return; }
      });
      if (why) return why;
    }
    // 4
    const twice = new Set(items.filter(x => x.kind === 'recorded-twice').map(x => `${x.id}|${x.job}`));
    const S = new Map(listOf(start, 'plantings').map(p => [p.id, p])), P = new Map(listOf(plan, 'plantings').map(p => [p.id, p]));
    const M = new Map(listOf(mine, 'plantings').map(p => [p.id, p])), T = new Map(listOf(theirs, 'plantings').map(p => [p.id, p]));
    for (const [side, other, name] of [[M, T, 'mine'], [T, M, 'theirs']]) for (const [id, p] of side) {
      for (const [kind, date] of Object.entries(doneOf(p))) {
        const before = doneOf(S.get(id))[kind], joined = P.get(id);
        if (same(before, date)) { const o = other.get(id); if (!o || !same(doneOf(o)[kind], date)) continue; }   // unchanged here: the other side may have taken it back or dated it again, or taken the planting out
        if (name === 'mine' && twice.has(`${id}|${kind}`)) continue;
        if (!joined || !same(doneOf(joined)[kind], date)) return `Work recorded on a planting is not in the joined plan (${id}, ${kind}, ${date}).`;
      }
    }
    // 5
    const inv = stockOf(plan);
    if (inv) {
      for (const p of listOf(plan, 'plantings')) {
        const n = q => new Set(linesOf(q, 'seedUse').map(batchOf).filter(b => b != null)).size;
        if (n(p) > Math.max(1, n(M.get(p.id)), n(T.get(p.id)))) return `A planting draws seed for more than one sowing (${p.id}).`;
      }
      let want;
      try { want = counts(start, mine, theirs, plan); } catch (_) { return 'The seed on hand could not be added up.'; }
      for (const lot of listOf(inv, 'lots')) {
        const to = want.get(lot.id);
        if (!to) continue;
        if (num(lot.quantity) < 0) return `A seed lot's count is below zero (${lot.id}).`;
        if (!near(num(lot.quantity), Math.max(0, to.q))) return `The seed on hand does not add up (${lot.id}: ${lot.quantity}, and it should be ${Math.max(0, to.q)}).`;
        if (to.q < -1e-6 && !items.some(x => x.kind === 'seed-short' && x.id === lot.id)) return `A seed lot was drawn below zero and the report does not say so (${lot.id}).`;
      }
    }
    return '';
  }

  // ───────────────────────────── the merge ─────────────────────────────
  const RULES = { 'plantings[]': joinPlanting, 'seedInventory.lots[].quantity': (ctx, pat, path, s, m, t) => t };   // a lot's count is worked out afterwards, from all three plans
  /**
   * @returns { ok: true, plan, report } or { ok: false, why, report }. report.items: what could not be kept as each side left it:
   *   { kind: 'same-box', path, mine, theirs }             changed on both sides to different values: the cloud's stands
   *   { kind: 'kept', path, id, removedBy }                taken out on one side, changed on the other: it stays, as changed
   *   { kind: 'recorded-twice', id, job, mine, theirs }    a job recorded on both sides: the cloud's stands, this device's is dropped
   *   { kind: 'move-not-applied', id, what, whose }        work was recorded on a planting the other side moved: the move is not applied
   *   { kind: 'seed-short', id, short }                    two devices drew more from a lot than it held
   *   { kind: 'placed-and-waiting', id }                   placed on one side, changed while waiting on the other: placed
   */
  function merge(start, mine, theirs) {
    const report = { items: [] };
    try {
      for (const [plan, name] of [[start, 'at the start'], [mine, 'here'], [theirs, 'in the cloud']]) {
        if (!isObj(plan)) throw new Error(`The plan ${name} is not a plan.`);
        for (const key of ['gardens', 'beds', 'plantings']) if (!Array.isArray(plan[key])) throw new Error(`The plan ${name} has no ${key}.`);
      }
      const ctx = { report, rules: RULES };
      let plan = join(ctx, '', [], start, mine, theirs);
      if (plan === mine || plan === theirs) return { ok: true, plan, report };   // one side changed nothing: the other's plan, as it is
      plan = settleWaiting(ctx, theirs, settleStock(ctx, start, mine, theirs, plan));
      const why = verify(start, mine, theirs, plan, report);
      return why ? { ok: false, why, report } : { ok: true, plan, report };
    } catch (error) {
      return { ok: false, why: (error && error.message) || 'The two plans could not be joined.', report };
    }
  }

  const api = { merge, verify, unkeyed, same, WHOLE, NO_IDS };
  root.LRFMerge = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
