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
 *   a recording             a job ticked as done on a planting is one unit: its day, its lines of history, the seed it drew.
 *                           Recorded on one side: it stands whole, and the planting's place and day are that side's (a move
 *                           made on the other side is reported, not applied). The same job recorded on both: the cloud's
 *                           stands whole and this device's is dropped whole, its seed with it. Two different jobs, one on
 *                           each side: both stand, and the planting's place and day are joined as for any planting
 *                           (joinPlanting says the rest).
 *   seed on hand            a lot's count is never joined as a number. It is the cloud's count, plus what this device did to
 *                           it other than by a recorded sowing (read from the change log, whose entries have ids, so the same
 *                           change seen twice counts once), and then, sowing by sowing, the difference between what that
 *                           sowing took in the joined plan and what the cloud's log says it took. What a sowing took is read
 *                           from the log of the side whose record of it stands, so a sowing dropped takes nothing, one taken
 *                           back gives its seed back once, and a planting removed after it was sown keeps its seed used.
 *                           A count never goes below zero: what a lot could not cover is kept as seed used without a
 *                           counted lot.
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
    'plantings[].bedLayout', 'plantings[].growingDefaults', 'plantings[].liveTray', 'varieties[].supplierPacks', 'varieties[].prices', 'varieties[].webImport',
    // a thing written in one act, or whose parts are read together: a job put off (from, to), what the planner noted of an edit (set, was),
    // a photo's file and its type, a crop's selling line (its price, yield and weight are by its unit), a demand plan (its editor checks it whole)
    'plantings[].tasks.delay.*', 'plantings[].towerCycle', 'lrfNext.facts.*.*', 'lrfNext.waiting[].wait', 'varieties[].photo', 'varieties[].environmentDefaults',
    'assumptions.sell.*', 'assumptions.sellV.*', 'cropUnits.*', 'crops[].liveSow', 'gardens[].growingEnvironment', 'seedInventory.lots[].germination', 'liveTrayPlans[]']);
  /**
   * Who saved a file and with what, and what a device notes for itself about the plan it holds (when it was loaded, from which
   * file, whether it has the farm photo): the cloud's, and nothing is said. A device that takes a joined plan in keeps its own.
   */
  const QUIET = new Set(['lrfNextKeep.device', 'lrfNextKeep.v',
    'lrfNext.attic', 'lrfNext.backup', 'lrfNext.from', 'lrfNext.importedAt', 'lrfNext.lastExport', 'lrfNext.mapImage', 'lrfNext.passedOver', 'lrfNext.source', 'lrfNext.startedAt']);
  /**
   * Keys of one record that are read together, joined as one value: changed on one side, that side's, all of them; changed on
   * both to different values, the cloud's, and this device's are reported once. (A planting's place and its day are two more
   * such groups, with rules of their own below.)
   */
  const TOGETHER = { 'nursery.spaces[]': [['from', 'to']], 'crops[]': [['yield', 'yBasis']], 'plantings[]': [['yield', 'yieldBasis']] };
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
  /** A key as it stands in a pattern: one chosen by the data may hold a dot, a bracket or a star, and is never read as two keys or as a list. */
  const esc = key => String(key).replace(/[\\.*[\]]/g, '\\$&');
  /** A pattern cut at its dots: "plantings[].tasks.delay.sow" is four parts. */
  function parts(pat) {
    const out = [];
    let part = '';
    for (let i = 0; i < pat.length; i++) { const c = pat[i]; if (c === '\\') { part += c + (pat[i + 1] || ''); i++; } else if (c === '.') { out.push(part); part = ''; } else part += c; }
    out.push(part);
    return out;
  }
  const STARRED = [...WHOLE].filter(p => p.includes('*')).map(p => p.split('.'));
  /** What a file keeps of the planner's own record is that record, and a planting waiting to be placed is a planting: each is held to the other's rules. */
  const alike = pat => { const out = [pat]; let p = pat; if (p === 'lrfNextKeep.keep' || p.startsWith('lrfNextKeep.keep.')) { p = 'lrfNext' + p.slice('lrfNextKeep.keep'.length); out.push(p); } if (p.startsWith('lrfNext.waiting[].')) out.push('plantings[].' + p.slice('lrfNext.waiting[].'.length)); return out; };
  /** Is the thing at this place taken whole? By its place as written, or by one written with * for a key the data chose. */
  function wholeAt(pat) {
    for (const p of alike(pat)) {
      if (WHOLE.has(p)) return true;
      if (!STARRED.length) continue;
      const mine = parts(p);
      if (STARRED.some(w => w.length === mine.length && w.every((x, i) => (x === '*' ? !mine[i].endsWith('[]') : x === mine[i])))) return true;
    }
    return false;
  }
  /** The keys of a record that are read together, joined as one value each group: into `special`, for joinObject. */
  function together(ctx, pat, path, s, m, t, special) {
    for (const keys of TOGETHER[pat] || []) {
      const at = o => keys.map(k => o[k]), ms = same(at(m), at(s)), ts = same(at(t), at(s)), mt = same(at(m), at(t));
      const from = mt || ms ? t : ts ? m : t;
      if (!mt && !ms && !ts) said(ctx, { kind: 'same-box', path: path.concat(keys.join('+')), keys, mine: Object.fromEntries(keys.filter(k => m[k] !== undefined).map(k => [k, m[k]])), theirs: Object.fromEntries(keys.filter(k => t[k] !== undefined).map(k => [k, t[k]])) });
      for (const key of keys) special[key] = from[key];
    }
    return special;
  }
  function join(ctx, pat, path, s, m, t) {
    if (same(m, t) || same(s, m)) return t;
    if (same(s, t)) return m;
    // changed on both sides, and not to the same thing
    const rule = ctx.rules[pat];
    if (rule) return rule(ctx, pat, path, s, m, t);
    const key = path[path.length - 1];
    if (STAMPS.has(key) && typeof m === 'string' && typeof t === 'string') return m > t ? m : t;
    if (alike(pat).some(p => QUIET.has(p))) return t;
    if (!wholeAt(pat)) {
      if (isObj(m) && isObj(t) && (s === undefined || s === null || isObj(s))) return joinObject(ctx, pat, path, s || {}, m, t, TOGETHER[pat] ? together(ctx, pat, path, s || {}, m, t, {}) : undefined);
      if (recordLists(s, m, t) && Array.isArray(m) && Array.isArray(t)) return joinRecords(ctx, pat, path, s || [], m, t);
    }
    said(ctx, { kind: 'same-box', path, mine: m, theirs: t });
    return t;
  }
  function joinObject(ctx, pat, path, s, m, t, special) {
    const out = {};
    for (const key of [...Object.keys(t), ...Object.keys(m).filter(k => !Object.prototype.hasOwnProperty.call(t, k))]) {
      const value = special && Object.prototype.hasOwnProperty.call(special, key) ? special[key] : join(ctx, pat ? pat + '.' + esc(key) : esc(key), path.concat(key), s[key], m[key], t[key]);
      if (value !== undefined) { if (key === '__proto__') Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true }); else out[key] = value; }
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
  const kindOf = line => (isObj(line) ? line.kind : undefined), batchOf = line => (isObj(line) && line.batchId != null ? line.batchId : null);
  /** The sowing a line of history names, if it names one. */
  const sowingOf = line => (isObj(line) && isObj(line.sowingReview) && line.sowingReview.batchId != null ? line.sowingReview.batchId : null);
  /** A job as it is recorded on a planting: its day, and the line of history that recorded it (the last line of its kind, when that is a completion). */
  function jobOf(p, kind) {
    const date = doneOf(p)[kind];
    if (date == null) return null;
    const history = linesOf(p, 'history');
    let line = null;
    for (let i = history.length - 1; i >= 0; i--) { const x = history[i]; if (kindOf(x) === kind) { line = x.action === 'complete' ? x : null; break; } }
    return { date, line };
  }
  const sameJob = (a, b) => (!a && !b) || (!!a && !!b && same(a.date, b.date) && same(a.line, b.line));
  /** Lines as a bag that can be taken from one at a time. */
  const bagOf = lines => { const bag = new Map(); for (const x of lines) { const k = canon(x); bag.set(k, (bag.get(k) || 0) + 1); } return bag; };
  const take = (bag, x) => { const k = canon(x), n = bag.get(k) || 0; if (n) bag.set(k, n - 1); return n > 0; };
  /** Does list `a` begin list `b`, and stop short of its end? */
  const begins = (a, b) => a.length < b.length && a.every((x, i) => same(x, b[i]));
  /** Is `b` list `a` carried on, or `a` itself? A side that took lines out (an undo) has not carried on. */
  const carriesOn = (a, b) => same(a, b) || begins(a, b);

  /**
   * The work of one planting, joined job by job. For each kind of job (sow, pot up, harden off, plant out …) each side has a
   * story: the lines of that kind in the planting's history, and the day it stands recorded on, if any. One side's story
   * stands whole:
   *   only one side's story differs from the start       that side's
   *   one side's story begins the other's and stops      the longer one: that device had seen all the other holds, and went on
   *                                                      (a sowing sent, its answer lost, then taken back here)
   *   the two differ, and neither begins the other       the cloud's, and this device's is dropped whole: its lines, its day,
   *                                                      the seed it drew. Reported, unless this device left the job as it found it.
   * Two different jobs recorded one on each side both stand, unless together they are in an order the planner refuses (planted
   * out before it was sown): then the cloud's stands and this device's is dropped, and reported.
   */
  function joinPlanting(ctx, pat, path, s, m, t) {
    if (!isObj(m) || !isObj(t) || (s != null && !isObj(s))) { said(ctx, { kind: 'same-box', path, mine: m, theirs: t }); return t; }
    const s0 = s || {};
    if (![s0, m, t].every(readable)) return joinObject(ctx, pat, path, s0, m, t);
    const id = t.id, hs = linesOf(s0, 'history'), hm = linesOf(m, 'history'), ht = linesOf(t, 'history');
    const kinds = new Set([...Object.keys(doneOf(t)), ...Object.keys(doneOf(m)), ...Object.keys(doneOf(s0)), ...[...ht, ...hm, ...hs].map(kindOf).filter(k => typeof k === 'string')]);
    const side = new Map(), jobs = new Map(), of = (list, kind) => list.filter(x => kindOf(x) === kind);
    for (const kind of kinds) {
      const js = jobOf(s0, kind), jm = jobOf(m, kind), jt = jobOf(t, kind), ks = of(hs, kind), km = of(hm, kind), kt = of(ht, kind);
      const mineSame = sameJob(js, jm) && same(ks, km), theirsSame = sameJob(js, jt) && same(ks, kt);
      let who = 't';
      if (mineSame || (sameJob(jm, jt) && same(km, kt))) who = 't';
      else if (theirsSame || (carriesOn(ks, kt) && begins(kt, km))) who = 'm';
      else if (!(carriesOn(ks, km) && begins(km, kt)) && !sameJob(jm, js)) said(ctx, { kind: 'recorded-twice', path, id, job: kind, mine: jm ? jm.date : null, theirs: jt ? jt.date : null });
      // the same story on both sides (a recording sent, its answer lost, the page then carried on) is one that both have seen
      const alike = sameJob(jm, jt) && same(km, kt);
      side.set(kind, who); jobs.set(kind, { js, jm, jt, alike, mineMoved: !mineSame && !alike, theirsMoved: !theirsSame && !alike });
    }
    // two jobs that stand from different sides, in an order the planner refuses on one device: the cloud's stands
    // until nothing moves: a job given back to the cloud's side can then be out of order with another
    for (let moved = true; moved;) { moved = false; for (const [first, second] of ctx.order) {
      if (!side.has(first) || !side.has(second) || side.get(first) === side.get(second)) continue;
      const day = kind => { const j = jobs.get(kind), job = side.get(kind) === 'm' ? j.jm : j.jt; return job ? String(job.date) : null; };
      if (day(first) == null || day(second) == null || day(first) <= day(second)) continue;
      const kind = side.get(first) === 'm' ? first : second, j = jobs.get(kind);
      said(ctx, { kind: 'recorded-twice', path, id, job: kind, mine: j.jm ? j.jm.date : null, theirs: j.jt ? j.jt.date : null, against: kind === first ? second : first });
      side.set(kind, 't'); moved = true;
    } }
    const done = {};
    let mineStands = false, theirsRecorded = false;
    for (const kind of kinds) {
      const { jm, jt, mineMoved, theirsMoved } = jobs.get(kind), who = side.get(kind), job = who === 'm' ? jm : jt;
      if (job) done[kind] = job.date;
      // a side whose story of a job stands, and differs from the start, has the planting's place and day: a job recorded there
      // may have pushed the day, and one taken back there may have put it back
      if (who === 'm' && mineMoved) mineStands = true;
      if (who === 't' && theirsMoved) theirsRecorded = true;
    }
    // which side's record of each sowing stands: the seed lines below follow it, and so do the lots (settleStock)
    const sowing = new Map();
    for (const x of [...hs, ...hm, ...ht]) if (sowingOf(x) != null && side.has(kindOf(x))) sowing.set(sowingOf(x), side.get(kindOf(x)));
    for (const [batch, who] of sowing) ctx.sowings.set(batch, who);
    // history: the cloud's lines in the cloud's order, without the lines of a job whose story is this device's and which this
    // device no longer has; then this device's lines of those jobs that the cloud's history lacks. Lines of no kind: by the bag.
    const loose = x => !side.has(kindOf(x)), mineHas = bagOf(hm.filter(x => side.get(kindOf(x)) === 'm')), gone = bagOf(minus(hs.filter(loose), hm.filter(loose)));
    const history = ht.filter(x => (loose(x) ? !take(gone, x) : side.get(kindOf(x)) === 't' || take(mineHas, x)));
    for (const x of hm) if (!loose(x) && side.get(kindOf(x)) === 'm' && take(mineHas, x)) history.push(x);
    history.push(...minus(minus(hm.filter(loose), hs.filter(loose)), ht.filter(loose)));
    // seed used: the lines of a sowing come from the side whose record of that sowing stands. Lines of no known sowing: by the bag.
    const us = linesOf(s0, 'seedUse'), um = linesOf(m, 'seedUse'), ut = linesOf(t, 'seedUse'), whose = u => sowing.get(batchOf(u)), free = u => whose(u) === undefined;
    const goneUse = bagOf(minus(us.filter(free), um.filter(free)));
    const seedUse = [...ut.filter(u => (free(u) ? !take(goneUse, u) : whose(u) === 't')), ...um.filter(u => whose(u) === 'm'), ...minus(minus(um.filter(free), us.filter(free)), ut.filter(free))];
    const special = { done: Object.keys(done).length ? done : undefined };
    if (isObj(m.workflow) || isObj(t.workflow)) {
      const own = { history: history.length || Array.isArray(flowOf(t).history) ? history : undefined, seedUse: seedUse.length ? seedUse : undefined };
      special.workflow = joinObject(ctx, pat + '.workflow', path.concat('workflow'), flowOf(s0), { history: [], seedUse: [], ...flowOf(m) }, { history: [], seedUse: [], ...flowOf(t) }, own);
    }
    // Where it is and when: one value each. Where work was recorded on one side only, both are that side's, and a move the
    // other side made is reported, not applied. Where it was recorded on neither side, or on both (two different jobs), a
    // value only one side changed is that side's, and one both changed is the cloud's, reported.
    const recorder = theirsRecorded && !mineStands ? 't' : mineStands && !theirsRecorded ? 'm' : '';
    // A recording both sides hold that pushed the planting out moved its day on both: that day, and not the start's, is what each
    // side's day is measured from. (A sowing day set by hand goes when a recording pushes the planting, js/week.js.)
    // The last such push in the cloud's history is where the shared state left the day.
    let pushedTo = null;
    const sharedLines = [...kinds].map(kind => jobs.get(kind)).filter(j => j.alike && j.jt && j.jt.line && !hs.some(x => same(x, j.jt.line))).map(j => j.jt.line);   // added since the start: a push the start holds is in the start's day already
    for (const x of ht) if (sharedLines.some(line => same(line, x)) && isObj(x.follow) && x.follow.to && !same(x.follow.from, x.follow.to)) pushedTo = x.follow.to;
    const shared = pushedTo ? { ...s0, date: pushedTo, sowOn: undefined } : s0;
    for (const [keys, what] of [[PLACE, 'place'], [TIME, 'day']]) {
      const s1 = what === 'day' ? shared : s0, at = p => keys.map(k => p[k]), ms = same(at(m), at(s1)), ts = same(at(t), at(s1)), mt = same(at(m), at(t)), shown = p => Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
      let from = t;
      if (recorder === 't') { if (!mt && !ms) said(ctx, { kind: 'move-not-applied', path, id, what, whose: 'mine', mine: shown(m), theirs: shown(t) }); }
      else if (recorder === 'm') { from = m; if (!mt && !ts) said(ctx, { kind: 'move-not-applied', path, id, what, whose: 'theirs', mine: shown(m), theirs: shown(t) }); }
      else if (mt || ms) from = t;
      else if (ts) from = m;
      else if (theirsRecorded) said(ctx, { kind: 'move-not-applied', path, id, what, whose: 'mine', mine: shown(m), theirs: shown(t) });
      else said(ctx, { kind: 'same-box', path: path.concat(what), keys, mine: shown(m), theirs: shown(t) });
      for (const key of keys) special[key] = from[key];
    }
    together(ctx, pat, path, s0, m, t, special);
    return joinObject(ctx, pat, path, s0, m, t, special);
  }

  // ───────────────────────────── seed on hand ─────────────────────────────
  const stockOf = plan => (isObj(plan) && isObj(plan.seedInventory) ? plan.seedInventory : null);
  const listOf = (obj, key) => (obj && Array.isArray(obj[key]) ? obj[key].filter(isObj) : []);
  /**
   * The sowing an entry of the change log belongs to: a recorded sowing drawing on a lot, or one taken back. These are the
   * planner's own words for the two (js/seedlib.js); a check holds the two scripts to them. The third is written here only:
   * what a sowing drew beyond what a lot held, when two devices together drew more (settleStock).
   */
  function batchIn(e) {
    const reason = String(e.reason || ''), found = e.kind === 'use' ? /^Reviewed sowing (\S+): /.exec(reason) : e.kind === 'count' ? /^Sowing (\S+) taken back: /.exec(reason) || /^Joined: sowing (\S+) drew /.exec(reason) : null;
    return found ? found[1] : null;
  }
  const changeOf = e => (isObj(e.before) && isObj(e.after) ? round6(num(e.after.quantity) - num(e.before.quantity)) : 0);
  /** What each sowing has taken from each lot, less what a take-back put back, as one side's change log has it: 'sowing lot' -> amount (zero or less). */
  function sowingsOf(inv) {
    const out = new Map();
    for (const e of listOf(inv, 'adjustments')) { const batch = batchIn(e), d = batch == null || e.lotId == null ? 0 : changeOf(e); if (d) { const key = batch + '\u0000' + e.lotId; out.set(key, round6((out.get(key) || 0) + d)); } }
    return out;
  }
  /**
   * What one side did to each lot's count, other than by a sowing, that the other side's log does not hold: lot id -> amount.
   * Entries the side has and neither the other nor the start has count as made; entries of the start that the other still
   * has and the side no longer has count as taken back (an undo). `all` counts the sowings too.
   */
  function ownChanges(side, other, start, all) {
    const has = inv => new Set(listOf(inv, 'adjustments').map(e => e.id)), mine = has(side), theirs = has(other), first = has(start), out = new Map();
    const add = (e, sign) => { if (!usable(e.id) || e.lotId == null || (!all && batchIn(e) != null)) return; const d = changeOf(e); if (d) out.set(e.lotId, round6((out.get(e.lotId) || 0) + sign * d)); };
    for (const e of listOf(side, 'adjustments')) if (!theirs.has(e.id) && !first.has(e.id)) add(e, 1);   // an entry of the start that the other side lacks is one the other side took back, not one this side made
    for (const e of listOf(start, 'adjustments')) if (theirs.has(e.id) && !mine.has(e.id)) add(e, -1);
    return out;
  }
  /**
   * The count each lot of the joined plan should hold: lot id -> { q, clash, mine, theirs }. `sowingStands(batch, lotId, s, m, t)`
   * says what a sowing has taken from a lot in the joined plan, given what each side's log says it took.
   * A lot both sides hold starts from the cloud's count; one only this device holds, from this device's.
   */
  function counts(start, mine, theirs, plan, sowingStands) {
    const iS = stockOf(start), iM = stockOf(mine), iT = stockOf(theirs), out = new Map();
    const lotsM = new Map(listOf(iM, 'lots').map(l => [l.id, l])), lotsT = new Map(listOf(iT, 'lots').map(l => [l.id, l]));
    const nS = sowingsOf(iS), nM = sowingsOf(iM), nT = sowingsOf(iT), fromTheirs = new Map(), fromMine = new Map();
    for (const key of new Set([...nS.keys(), ...nM.keys(), ...nT.keys()])) {
      const [batch, lotId] = key.split('\u0000'), s = nS.get(key) || 0, m = nM.get(key) || 0, t = nT.get(key) || 0, said = sowingStands(batch, lotId, s, m, t), stands = said === 'm' ? m : said === 't' ? t : said;
      fromTheirs.set(lotId, round6((fromTheirs.get(lotId) || 0) + stands - t)); fromMine.set(lotId, round6((fromMine.get(lotId) || 0) + stands - m));
    }
    const mineOnly = ownChanges(iM, iT, iS, false), theirsOnly = ownChanges(iT, iM, iS, false);
    for (const lot of listOf(stockOf(plan), 'lots')) {
      const lt = lotsT.get(lot.id), lm = lotsM.get(lot.id), base = lt || lm;
      if (!base || !usable(lot.id)) continue;
      let own = lt && lm ? mineOnly.get(lot.id) || 0 : 0, clash = false;   // a lot only this device holds already carries this device's changes in its count
      if (own && theirsOnly.get(lot.id)) { own = 0; clash = true; }   // counted by hand on both sides: the cloud's count stands
      out.set(lot.id, { q: round6(num(base.quantity) + own + ((lt ? fromTheirs : fromMine).get(String(lot.id)) || 0)), clash, mine: lm, theirs: lt });
    }
    return out;
  }
  /** A sowing neither side's planting spoke for in this merge (its planting was changed on one side only, or is gone): what only one side changed is that side's. */
  const byLog = (s, m, t) => (near(m, s) ? t : near(t, s) ? m : t);
  /** Set each lot's count. A lot that would go below zero is left at zero, and the seed it could not cover is kept on its sowing as seed used without a counted lot. */
  function settleStock(ctx, start, mine, theirs, plan) {
    const inv = stockOf(plan);
    if (!inv || !Array.isArray(inv.lots)) return plan;
    // this device's own log must account for its counts: if it does not, the arithmetic below would lose a change without a word
    const iS = stockOf(start), iM = stockOf(mine);
    if (iM) {
      const was = new Map(listOf(iS, 'lots').map(l => [l.id, l])), did = ownChanges(iM, iS, iS, true);
      for (const lot of listOf(iM, 'lots')) { const before = was.get(lot.id); if (before && !near(num(lot.quantity), num(before.quantity) + (did.get(lot.id) || 0))) throw new Error('The seed on hand here does not follow its own record of changes.'); }
    }
    let plantings = plan.plantings;
    const theirsById = new Map(listOf(theirs, 'plantings').map(p => [p.id, p])), iT = stockOf(theirs);
    // Whose record of each sowing stands, so that what it took, and the lines of the change log that say so, come from one side.
    //   its planting was joined in this merge    the side whose story of that job stood (joinPlanting)
    //   its planting is in the joined plan       the side whose log agrees with the seed lines the planting ended up with
    //                                            (a planting kept because one side took it out and the other changed it)
    //   its planting is in no plan               what only one side changed is that side's (a planting removed after it was sown)
    const net = (inv, batch) => { let n = 0; for (const e of listOf(inv, 'adjustments')) if (batchIn(e) === batch && e.lotId != null) n = round6(n + changeOf(e)); return n; };
    const home = new Map(), lines = new Map();
    for (const side of [start, mine, theirs, plan]) for (const p of listOf(side, 'plantings')) for (const x of linesOf(p, 'history')) if (sowingOf(x) != null) home.set(String(sowingOf(x)), p.id);
    const placed = new Set(listOf(plan, 'plantings').map(p => p.id));
    for (const p of listOf(plan, 'plantings')) for (const u of linesOf(p, 'seedUse')) if (isObj(u) && u.lotId != null && batchOf(u) != null) lines.set(String(batchOf(u)), round6((lines.get(String(batchOf(u))) || 0) - num(u.quantity)));
    const startIds = new Set(listOf(iS, 'adjustments').map(e => e.id)), sideOf = new Map(), unlinked = [];
    for (const e of [...listOf(iS, 'adjustments'), ...listOf(iM, 'adjustments'), ...listOf(iT, 'adjustments')]) {
      const batch = batchIn(e);
      if (batch == null || sideOf.has(batch)) continue;
      const known = ctx.sowings.get(batch), sN = net(iS, batch), mN = net(iM, batch), tN = net(iT, batch);
      // where both sides' logs would do, the side that has lines of this sowing the start lacks (recorded and taken back there)
      const fresh = inv => listOf(inv, 'adjustments').some(x => batchIn(x) === batch && !startIds.has(x.id)), tie = () => (fresh(iM) && !fresh(iT) ? 'm' : 't');
      if (known) sideOf.set(batch, known);
      else if (placed.has(home.get(batch))) { const want = lines.get(batch) || 0, t = near(tN, want), m = near(mN, want); sideOf.set(batch, t && m ? tie() : t ? 't' : m ? 'm' : 't'); }
      else {
        const who = near(mN, sN) && near(tN, sN) ? tie() : near(mN, sN) ? 't' : near(tN, sN) ? 'm' : 't';
        sideOf.set(batch, who);
        if (!home.has(batch) && !near(who === 'm' ? mN : tN, sN)) unlinked.push({ batch, whose: who === 'm' ? 'mine' : 'theirs' });
      }
    }
    // a sowing recorded on a planting that its side then took out, where the other side kept the planting: the seed stays used, and it is said
    const kept = ctx.report.items.filter(x => x.kind === 'kept' && Array.isArray(x.path) && x.path[0] === 'plantings');
    for (const u of unlinked) if (kept.some(k => k.removedBy === u.whose)) said(ctx, { kind: 'sowing-of-removed-planting', path: ['seedInventory'], batch: u.batch, whose: u.whose, planting: kept.filter(k => k.removedBy === u.whose).map(k => k.id) });
    const want = counts(start, mine, theirs, plan, batch => sideOf.get(batch) || 't'), lots = inv.lots.slice();
    // The change log is joined record by record, so it holds both sides' lines for a sowing recorded on both. Only the lines of the
    // side whose record stands are kept, and a lot counted by hand on both keeps the cloud's count and the cloud's lines: so that the
    // joined plan's counts follow its own log, as a plan made on one device does, and it can be joined again.
    const idsIn = inv => new Set(listOf(inv, 'adjustments').map(e => e.id)), mineIds = idsIn(iM), theirIds = idsIn(iT);
    const clashed = new Set([...want].filter(([, to]) => to.clash).map(([lotId]) => lotId));
    let log = Array.isArray(inv.adjustments) ? inv.adjustments.filter(e => {
      if (!isObj(e)) return true;
      const batch = batchIn(e), keep = batch != null ? ((sideOf.get(batch) || 't') === 'm' ? mineIds.has(e.id) : theirIds.has(e.id)) : !(clashed.has(e.lotId) && mineIds.has(e.id) && !theirIds.has(e.id) && !startIds.has(e.id));
      if (!keep) ctx.report.dropped.push(e.id);   // the five tests are told, so that a line left out on purpose is not taken for one lost
      return keep;
    }) : inv.adjustments;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i], to = isObj(lot) ? want.get(lot.id) : null;
      if (!to) continue;
      let q = to.q;
      if (to.clash) said(ctx, { kind: 'same-box', path: ['seedInventory', 'lots', '#' + lot.id, 'quantity'], mine: to.mine.quantity, theirs: to.theirs.quantity });
      if (q < -1e-6) {
        // more was drawn on two devices than the lot held. What this device's sowings took beyond it becomes seed used without a counted lot.
        let short = round6(-q);
        const whole = short, beyond = new Map();
        plantings = plantings.slice();
        for (let j = plantings.length - 1; j >= 0 && short > 1e-6; j--) {
          const p = plantings[j], uses = linesOf(p, 'seedUse');
          if (!uses.some(u => isObj(u) && u.lotId === lot.id)) continue;
          const added = new Set(minus(uses, linesOf(theirsById.get(p.id), 'seedUse')).map(canon)), next = [];
          for (let k = uses.length - 1; k >= 0; k--) {
            const u = uses[k];
            if (!(short > 1e-6) || !isObj(u) || u.lotId !== lot.id || !added.has(canon(u))) { next.unshift(u); continue; }
            const part = Math.min(short, num(u.quantity)), left = round6(num(u.quantity) - part);
            short = round6(short - part);
            if (batchOf(u) != null) beyond.set(String(batchOf(u)), round6((beyond.get(String(batchOf(u))) || 0) + part));
            const loose = { ...u, lotId: null, quantity: part, untracked: true };
            if (left > 1e-6) next.unshift({ ...u, quantity: left }, loose); else next.unshift(loose);
          }
          plantings[j] = { ...p, workflow: { ...p.workflow, seedUse: next } };
        }
        said(ctx, { kind: 'seed-short', path: ['seedInventory', 'lots', '#' + lot.id], id: lot.id, short: whole, loose: round6(whole - short) });
        // And lines in the log, so that the lot's count still follows it: one for each sowing whose seed was made loose, which belongs
        // to that sowing (so that its draw in the log is its seed lines), and one for what no sowing of this side could take. Their
        // ids are made from what they record, so that two devices that join the same two plans write the same lines.
        if (Array.isArray(log)) {
          const n = log.filter(e => isObj(e) && e.lotId === lot.id).length, line = (tag, amount, reason) => ({ id: `seed_adjustment_joined_${lot.id}_${tag}_${n}_${Math.round(amount * 1e6)}`, lotId: lot.id, at: null, kind: 'count', reason, before: { ...lot, quantity: 0 }, after: { ...lot, quantity: amount } });
          const lines = [...beyond].map(([batch, amount]) => line(batch, amount, `Joined: sowing ${batch} drew ${amount} beyond the lot`));
          if (short > 1e-6) lines.push(line('rest', short, `Joined from two devices: more was drawn than the lot held (${short})`));
          log = [...log, ...lines];
        }
        q = 0;
      }
      if (!near(num(lot.quantity), q)) lots[i] = { ...lot, quantity: q };
    }
    return { ...plan, plantings, seedInventory: { ...inv, lots, ...(Array.isArray(log) ? { adjustments: log } : {}) } };
  }

  /**
   * What waits to be placed, set against what is placed. A planting put on a bed on one side while the other changed it as it
   * waited would be both on a bed and waiting: placed wins. One put on a bed on one side and taken off the waiting list on
   * the other is on its bed: both are reported.
   */
  function settleWaiting(ctx, start, mine, theirs, plan) {
    const placed = new Set(listOf(plan, 'plantings').map(p => p.id)), ownOf = p => (isObj(p) ? [p.lrfNext, isObj(p.lrfNextKeep) ? p.lrfNextKeep.keep : null] : [null, null]);
    const clean = (own, theirOwn, path) => {
      if (!isObj(own) || !Array.isArray(own.waiting)) return own;
      const before = new Set(listOf(theirOwn, 'waiting').map(w => w.id)), stillTheirs = new Set(listOf(theirs, 'plantings').map(p => p.id));
      const waiting = own.waiting.filter(w => { const twice = isObj(w) && placed.has(w.id) && !(before.has(w.id) && stillTheirs.has(w.id)); if (twice) said(ctx, { kind: 'placed-and-waiting', path: path.concat('#' + w.id), id: w.id }); return !twice; });
      return waiting.length === own.waiting.length ? own : { ...own, waiting };
    };
    const out = { ...plan };
    if (isObj(plan.lrfNext)) out.lrfNext = clean(plan.lrfNext, theirs.lrfNext, ['lrfNext', 'waiting']);
    if (isObj(plan.lrfNextKeep) && isObj(plan.lrfNextKeep.keep)) out.lrfNextKeep = { ...plan.lrfNextKeep, keep: clean(plan.lrfNextKeep.keep, isObj(theirs.lrfNextKeep) ? theirs.lrfNextKeep.keep : null, ['lrfNextKeep', 'keep', 'waiting']) };
    // waiting at the start, put on a bed by one side, and taken off the list by the other without placing it
    const waited = new Set(ownOf(start).flatMap(o => listOf(o, 'waiting')).map(w => w.id)), was = new Set(listOf(start, 'plantings').map(p => p.id));
    for (const [side, other, removedBy] of [[mine, theirs, 'theirs'], [theirs, mine, 'mine']]) {
      const stillWaits = new Set(ownOf(other).flatMap(o => listOf(o, 'waiting')).map(w => w.id)), there = new Set(listOf(other, 'plantings').map(p => p.id));
      for (const p of listOf(side, 'plantings')) if (waited.has(p.id) && !was.has(p.id) && placed.has(p.id) && !stillWaits.has(p.id) && !there.has(p.id)) said(ctx, { kind: 'kept', path: ['plantings', '#' + p.id], id: p.id, removedBy });
    }
    return out;
  }

  /**
   * The weekly batches of a live-tray demand plan follow the demand plan that stands. Where both devices changed one demand
   * plan the cloud's stands whole (WHOLE), and so do the cloud's batches of it: each is as the cloud holds it, one this device
   * made for its own version goes, and one this device took out comes back. A batch with work recorded on it here that the
   * cloud does not hold stays as joined. Without this, two devices that each changed the trays wanted would leave both sets.
   */
  function settleTrays(ctx, start, mine, theirs, plan) {
    const ids = new Set(ctx.report.items.filter(x => x.kind === 'same-box' && Array.isArray(x.path) && x.path.length === 2 && x.path[0] === 'liveTrayPlans').map(x => String(x.path[1]).slice(1)));
    if (!ids.size || !Array.isArray(plan.plantings)) return plan;
    const planOf = p => (isObj(p) && isObj(p.liveTray) && ids.has(String(p.liveTray.planId)) ? String(p.liveTray.planId) : null);
    const T = new Map(listOf(theirs, 'plantings').map(p => [p.id, p])), work = p => [doneOf(p), linesOf(p, 'history'), linesOf(p, 'seedUse')];
    const told = new Map(), tell = (id, key, pid) => { if (!told.has(id)) told.set(id, { kind: 'tray-batches', path: ['liveTrayPlans', '#' + id], id, dropped: [], back: [] }); told.get(id)[key].push(pid); };
    const out = [], here = new Set();
    for (const p of plan.plantings) {
      const id = planOf(p), t = id == null ? null : T.get(p.id);
      if (id == null) { out.push(p); continue; }
      if (t) { out.push(same(work(p), work(t)) ? t : p); here.add(p.id); }
      else if (Object.keys(doneOf(p)).length) { out.push(p); here.add(p.id); }   // work recorded on a batch the cloud's version does not have: it stays
      else tell(id, 'dropped', p.id);
    }
    for (const t of listOf(theirs, 'plantings')) { const id = planOf(t); if (id != null && !here.has(t.id)) { out.push(t); tell(id, 'back', t.id); } }
    if (!told.size && out.every((p, i) => p === plan.plantings[i])) return plan;
    const gone = new Set([...told.values()].flatMap(x => x.dropped));
    ctx.report.items = ctx.report.items.filter(x => !(x.kind === 'kept' && Array.isArray(x.path) && x.path[0] === 'plantings' && gone.has(x.id)));   // said once, by the batches' own line
    for (const item of told.values()) said(ctx, item);
    return { ...plan, plantings: out };
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
      if (wholeAt(pat)) return;   // taken whole: what is inside it is never joined
      if (Array.isArray(node)) {
        const objects = node.filter(isObj);
        if (objects.length && !idsOf(node)) { const why = objects.every(x => usable(x.id)) && objects.length === node.length ? 'repeated' : 'no-id', key = pat + '|' + why; out.set(key, { pattern: pat, why, n: ((out.get(key) || {}).n || 0) + 1 }); }
        for (const x of node) walk(pat + '[]', x);
      } else if (isObj(node)) for (const key of Object.keys(node)) walk(pat ? pat + '.' + esc(key) : esc(key), node[key]);
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
    const not = unreadable(plan);
    if (not) return `The joined plan ${not}.`;
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
    const batches = new Set(items.filter(x => x.kind === 'tray-batches').flatMap(x => x.dropped || []).map(String));
    const excused = new Set(items.filter(x => x.kind === 'placed-and-waiting').map(x => String(x.id))), droppedLines = new Set(((report && report.dropped) || []).map(String));
    const whole = items.filter(x => x.kind === 'same-box' && Array.isArray(x.path)).map(x => x.path.join('\u0000') + '\u0000'), under = path => { const at = path.join('\u0000') + '\u0000'; return whole.some(w => at.startsWith(w)); };
    for (const side of [mine, theirs]) {
      eachList('', [], side, [start, plan], (pat, path, list, [before, after]) => {
        if (why) return;
        const was = before ? new Map(before.map(x => [x.id, x])) : new Map(), now = after ? new Set(after.map(x => x.id)) : null;
        for (const rec of list) if ((!was.has(rec.id) || !same(was.get(rec.id), rec)) && !(now && now.has(rec.id)) && !(excused.has(String(rec.id)) && /waiting$/.test(pat)) && !(pat === 'seedInventory.adjustments' && droppedLines.has(String(rec.id))) && !(pat === 'plantings' && batches.has(String(rec.id))) && !under(path)) { why = `A record one side added or changed is not in the joined plan (${path.concat('#' + rec.id).join('.')}).`; return; }
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
        // the other side had seen this very recording (its line is in that side's history) and went on from it, to take it back or record it again
        const job = jobOf(p, kind), seen = job && job.line && other.has(id) && linesOf(other.get(id), 'history').some(x => same(x, job.line));
        if (seen && !same(doneOf(other.get(id))[kind], date)) continue;
        if (!joined || !same(doneOf(joined)[kind], date)) return `Work recorded on a planting is not in the joined plan (${id}, ${kind}, ${date}).`;
      }
    }
    // 5: worked a second way. The counts were set from which side's record of each sowing stands; here they are worked from
    // the seed lines the joined plantings ended up with, and the two must agree.
    const inv = stockOf(plan);
    if (inv) {
      for (const p of listOf(plan, 'plantings')) {
        const n = q => new Set(linesOf(q, 'seedUse').map(batchOf).filter(b => b != null)).size;
        if (n(p) > Math.max(1, n(M.get(p.id)), n(T.get(p.id)))) return `A planting draws seed for more than one sowing (${p.id}).`;
      }
      const home = new Map(), lines = new Map();
      for (const side of [start, mine, theirs, plan]) for (const p of listOf(side, 'plantings')) for (const x of linesOf(p, 'history')) if (sowingOf(x) != null) home.set(String(sowingOf(x)), p.id);
      for (const p of listOf(plan, 'plantings')) for (const u of linesOf(p, 'seedUse')) if (isObj(u) && u.lotId != null && batchOf(u) != null) { const key = batchOf(u) + '\u0000' + u.lotId; lines.set(key, round6((lines.get(key) || 0) + num(u.quantity))); }
      let want;
      try { want = counts(start, mine, theirs, plan, (batch, lotId, s, m, t) => (P.has(home.get(batch)) ? -(lines.get(batch + '\u0000' + lotId) || 0) : byLog(s, m, t))); } catch (_) { return 'The seed on hand could not be added up.'; }
      for (const lot of listOf(inv, 'lots')) {
        const to = want.get(lot.id);
        if (!to) continue;
        if (num(lot.quantity) < 0) return `A seed lot's count is below zero (${lot.id}).`;
        if (!near(num(lot.quantity), Math.max(0, to.q))) return `The seed on hand does not add up (${lot.id}: ${lot.quantity}, and it should be ${Math.max(0, to.q)}).`;
        if (to.q < -1e-6 && !items.some(x => x.kind === 'seed-short' && x.id === lot.id)) return `A seed lot was drawn below zero and the report does not say so (${lot.id}).`;
      }
      // and a third way: each lot's count follows the joined change log, as the cloud's follows the cloud's, so that the joined plan can be joined again
      const iT = stockOf(theirs), logT = new Map(listOf(iT, 'adjustments').map(e => [e.id, e])), logP = new Map(listOf(inv, 'adjustments').map(e => [e.id, e])), lotsT = new Map(listOf(iT, 'lots').map(l => [l.id, l]));
      const moved = new Map(), add = (e, sign) => { if (e.lotId != null) moved.set(e.lotId, round6((moved.get(e.lotId) || 0) + sign * changeOf(e))); };
      for (const [id, e] of logP) if (!logT.has(id)) add(e, 1);
      for (const [id, e] of logT) if (!logP.has(id)) add(e, -1);
      for (const lot of listOf(inv, 'lots')) { const was = lotsT.get(lot.id); if (was && lot.deleted !== true && was.deleted !== true && !near(num(lot.quantity), num(was.quantity) + (moved.get(lot.id) || 0))) return `A seed lot's count does not follow the joined record of changes (${lot.id}).`; }
    }
    return '';
  }

  // ───────────────────────────── the merge ─────────────────────────────
  const RULES = { 'plantings[]': joinPlanting, 'seedInventory.lots[].quantity': (ctx, pat, path, s, m, t) => t };   // a lot's count is worked out afterwards, from all three plans
  /**
   * Why a plan cannot be joined, or '' when it can: its gardens, beds and plantings, and its crops, varieties and seed lots
   * where it has them, must each be a list of records that have ids, none twice. A plan with a planting that has no id would
   * otherwise have its whole list of plantings joined as one value.
   */
  function unreadable(plan) {
    for (const key of ['gardens', 'beds', 'plantings']) if (!Array.isArray(plan[key])) return `has no ${key}`;
    const inv = stockOf(plan), lists = [['gardens', plan.gardens], ['beds', plan.beds], ['plantings', plan.plantings], ['crops', plan.crops], ['varieties', plan.varieties], ['seed lots', inv ? inv.lots : undefined], ['changes to seed lots', inv ? inv.adjustments : undefined]];
    for (const [name, list] of lists) if (list != null && !idsOf(list)) return `has ${name} that are not records with ids, each id once`;
    return '';
  }
  /**
   * @param options.order  the pairs of jobs the planner keeps in order on one planting ([['sow', 'field'], …]: the first is
   *                       never dated after the second). The planner's own list is LRFSeedLib.DONE_ORDER. Without it two
   *                       jobs recorded one on each device are not held to an order.
   * @returns { ok: true, plan, report } or { ok: false, why, report }. report.items: what could not be kept as each side left it:
   *   { kind: 'same-box', path, mine, theirs }             changed on both sides to different values: the cloud's stands
   *   { kind: 'kept', path, id, removedBy }                taken out on one side, changed on the other: it stays, as changed
   *   { kind: 'recorded-twice', id, job, mine, theirs }    a job recorded on both sides, or (with `against`) two jobs in an order
   *                                                        the planner refuses: the cloud's stands, this device's is dropped
   *   { kind: 'move-not-applied', id, what, whose }        work was recorded on a planting the other side moved: the move is not applied
   *   { kind: 'seed-short', id, short, loose }             two devices drew more from a lot than it held
   *   { kind: 'placed-and-waiting', id }                   placed on one side, changed while waiting on the other: placed
   *   { kind: 'tray-batches', id, dropped, back }          both sides changed one live-tray demand plan: the cloud's stands, and its weekly
   *                                                        batches with it. `dropped`: batches this device had made; `back`: ones it had taken out
   *   { kind: 'sowing-of-removed-planting', batch, whose, planting }   a side sowed a planting and then took it out, and the other side kept
   *                                                        it (`kept`): that sowing's seed stays used. It may be the very sowing the other
   *                                                        side recorded, which then drew seed twice: that is for the grower to say
   */
  function merge(start, mine, theirs, options) {
    const report = { items: [], dropped: [] };
    try {
      for (const [plan, name] of [[start, 'at the start'], [mine, 'here'], [theirs, 'in the cloud']]) {
        if (!isObj(plan)) throw new Error(`The plan ${name} is not a plan.`);
        const not = unreadable(plan);
        if (not) throw new Error(`The plan ${name} ${not}.`);
      }
      const order = options && Array.isArray(options.order) ? options.order.filter(pair => Array.isArray(pair) && pair.length === 2) : [];
      const ctx = { report, rules: RULES, order, sowings: new Map() };
      let plan = join(ctx, '', [], start, mine, theirs);
      if (plan === mine || plan === theirs) return { ok: true, plan, report };   // one side changed nothing: the other's plan, as it is
      plan = settleWaiting(ctx, start, mine, theirs, settleStock(ctx, start, mine, theirs, settleTrays(ctx, start, mine, theirs, plan)));
      const why = verify(start, mine, theirs, plan, report);
      return why ? { ok: false, why, report } : { ok: true, plan, report };
    } catch (error) {
      return { ok: false, why: (error && error.message) || 'The two plans could not be joined.', report };
    }
  }

  // ───────────────────────────── for whoever takes a joined plan in ─────────────────────────────
  /** A plan without what a device notes for itself and without who saved it: two plans alike in this are the same plan to a grower. */
  function bare(plan) {
    if (!isObj(plan)) return plan;
    const out = { ...plan };
    if (isObj(plan.lrfNext)) { out.lrfNext = { ...plan.lrfNext }; for (const pat of QUIET) if (pat.startsWith('lrfNext.')) delete out.lrfNext[pat.slice('lrfNext.'.length)]; }
    if (isObj(plan.lrfNextKeep)) out.lrfNextKeep = { keep: plan.lrfNextKeep.keep };
    return out;
  }
  /**
   * What one plan holds that another did not, counted in a grower's kinds: for the line that says what was taken in.
   * { added, removed, changed, recorded: { sow: n, … }, takenBack: { … }, lists: ['seedInventory', …] } — plantings added, taken
   * out, changed other than by work recorded; jobs recorded, and taken back, by kind; and the other collections that differ.
   */
  function tally(before, after) {
    const B = new Map(listOf(before, 'plantings').map(p => [p.id, p])), seen = new Set(), out = { added: 0, removed: 0, changed: 0, recorded: {}, takenBack: {}, lists: [] };
    for (const p of listOf(after, 'plantings')) {
      seen.add(p.id);
      const b = B.get(p.id);
      let jobs = 0;
      for (const kind of new Set([...Object.keys(doneOf(p)), ...Object.keys(doneOf(b))])) if (!same(doneOf(p)[kind], doneOf(b)[kind])) { const to = doneOf(p)[kind] == null ? out.takenBack : out.recorded; to[kind] = (to[kind] || 0) + 1; jobs++; }
      if (!b) out.added++; else if (!jobs && !same(b, p)) out.changed++;
    }
    for (const id of B.keys()) if (!seen.has(id)) out.removed++;
    const a = bare(after), b = bare(before), own = plan => (isObj(plan.lrfNextKeep) && isObj(plan.lrfNextKeep.keep) ? plan.lrfNextKeep.keep : plan.lrfNext) || {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!['plantings', 'lrfNext', 'lrfNextKeep'].includes(key) && !same(a[key], b[key])) out.lists.push(key);
    for (const key of new Set([...Object.keys(own(a)), ...Object.keys(own(b))])) if (!same(own(a)[key], own(b)[key])) out.lists.push('own.' + key);
    out.any = !!(out.added || out.removed || out.changed || Object.keys(out.recorded).length || Object.keys(out.takenBack).length || out.lists.length);
    return out;
  }
  /**
   * Three plans as files hold them, joined: { ok: true, plan, text, same, taken, report } or { ok: false, why, report }.
   * `same`: the joined plan is the cloud's (this device had nothing of its own to add), and `text` is then the cloud's very text.
   * `taken`: what the joined plan holds that the plan here did not (tally).
   */
  function joinTexts(startText, mineText, theirsText, options) {
    let start, mine, theirs;
    try { start = JSON.parse(startText); mine = JSON.parse(mineText); theirs = JSON.parse(theirsText); } catch (_) { return { ok: false, why: 'One of the plans could not be read.', report: { items: [], dropped: [] } }; }
    const r = merge(start, mine, theirs, options);
    if (!r.ok) return r;
    const alike = same(bare(r.plan), bare(theirs));
    return { ok: true, plan: alike ? theirs : r.plan, text: alike ? theirsText : JSON.stringify(r.plan), same: alike, taken: tally(mine, r.plan), report: r.report };
  }

  /**
   * One record, or one of a plan's collections, joined by the same rules: { value, items }. `place` is where it stands in a plan
   * ("plantings[]", "assumptions", "lrfNext.groups"). The planner's undo uses it to take one step's changes out of a record
   * another device has changed since: the record after the step is the start, the record before it one side, the record now the other.
   */
  function joinOne(place, start, mine, theirs) {
    const report = { items: [], dropped: [] }, ctx = { report, rules: RULES, order: [], sowings: new Map() };
    return { value: join(ctx, place, [place], start, mine, theirs), items: report.items };
  }

  const api = { merge, verify, unkeyed, same, tally, bare, joinTexts, joinOne, WHOLE, NO_IDS, TOGETHER, PLACE, TIME };
  root.LRFMerge = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
