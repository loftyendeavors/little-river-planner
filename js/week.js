/* Little River Farm Planner — the week's work, with no screen attached.
 *
 * A planting is a chain of jobs: sow, pot up, harden off, plant out, move out. Each has the day the plan works out
 * for it and, once it is ticked, the day it was really done. A recorded day is a fact: it is never refused, and it
 * is never assumed. A job whose day has passed with no record stays listed as not recorded.
 *
 * Late work pushes what comes after it. A transplant sown or hardened off N days late goes out N days late, in the
 * same step, because the seedlings need their days. Early work pulls nothing: the bed is free when it is free, and
 * the day it goes out is still the plan's to set. Planting out and sowing in the ground need no push: the harvest is
 * counted from the day recorded.
 *
 *   Week.steps(engine, p)                        -> the jobs of one planting, in order
 *   Week.lines(engine, plan, year)               -> pot up, harden off, plant out and move out, as lines of a list
 *   Week.record(engine, inventory, p, kind, input, ctx)   -> the planting with that job dated (and pushed, when late)
 *   Week.takeBack(engine, inventory, p, kind, ctx)        -> the planting with that job cleared (and put back)
 *
 * Sowing itself is recorded by the seed library (LRFSeedLib.recordSowing), which takes the seed off stock; this
 * file calls it and adds the push. The records are v7's own (done, workflow.history).
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.LRFEngine, node ? require('./seedlib.js') : root.LRFSeedLib);
  if (node) module.exports = api; else root.LRFWeek = api;
})(typeof self !== 'undefined' ? self : this, function (E, SL) {
  'use strict';
  const { s2d, d2s, addDays, dayDiff, validDate } = E;
  // In the order the jobs are done. `field` is the day a planting goes into its bed, tower or container.
  const ORDER = ['sow', 'potup', 'harden', 'field', 'move'];
  // What ends the wait for a job with no day of its own: work that can only have come after it.
  const AFTER = { sow: ['potup', 'harden', 'field', 'move', 'harvest', 'flip'], potup: ['harden', 'field', 'move', 'harvest', 'flip'], harden: ['field', 'move', 'harvest', 'flip'], field: ['move', 'harvest', 'flip'], move: ['flip'] };
  const NAME = { sow: 'Sow', potup: 'Pot up', harden: 'Harden off', field: 'Plant out', move: 'Move out' };
  const DID = { sow: 'sown', potup: 'potted up', harden: 'hardened off', field: 'planted', move: 'moved out' };
  // The jobs that push the day a transplant goes out when they are done late.
  const PUSHES = ['sow', 'harden'];
  const monday = iso => { const d = s2d(iso); return d2s(addDays(d, -((d.getDay() + 6) % 7))); };
  const done = (p, kind) => SL.doneDate(p, kind);
  const objectOr = (x, fallback) => (x && typeof x === 'object' && !Array.isArray(x) ? x : fallback);

  /**
   * The jobs of one planting, in order: [{ kind, planned: Date, done: 'YYYY-MM-DD' | null, passed, late }].
   * `planned` is the day the plan works out now; `passed` says later work is recorded though this job has no day;
   * `late` is days after the plan's day (negative when early), once done: counted from the day first planned when the
   * job pushed its planting, whose plan then moved to meet it (`pushed`: { days, from, to }).
   * `seed` marks the job that uses the seed or the bulbs, which is recorded with what was used.
   */
  function steps(engine, p) {
    const r = engine.calc(p);
    if (!r || p.established === true) return [];
    const s = SL.sowing(engine, p), out = [], use = s ? s.kind : null;
    const push = (kind, planned) => { if (validDate(planned)) out.push({ kind, planned, seed: kind === use }); };
    if (r.rack) push('sow', r.planned);
    else {
      if (r.plannedSow) { push('sow', r.plannedSow); push('potup', engine.potUpPlanned(r)); push('harden', engine.hardenPlanned(r)); }
      push('field', r.planned);
      push('move', engine.outPlanned(p, r));
    }
    for (const st of out) {
      st.done = done(p, st.kind);
      st.passed = !st.done && AFTER[st.kind].some(k => done(p, k));
      st.pushed = st.done ? pushed(p, st.kind) : null;
      st.late = st.done ? dayDiff(s2d(st.done), st.planned) + (st.pushed ? st.pushed.days : 0) : null;
    }
    return out;
  }
  const step = (engine, p, kind) => steps(engine, p).find(st => st.kind === kind) || null;
  /** The last record of a job in a planting's history that has not been taken back since. */
  function lastRecord(p, kind) {
    const history = Array.isArray(objectOr(p.workflow, {}).history) ? p.workflow.history : [];
    for (let i = history.length - 1; i >= 0; i--) {
      const x = history[i];
      if (!x || x.kind !== kind) continue;
      return x.action === 'complete' ? x : null;
    }
    return null;
  }
  /** Where a late job pushed its planting to, while the planting is still there. */
  function pushed(p, kind) {
    const x = lastRecord(p, kind), f = x && x.follow;
    return f && f.to === p.date ? f : null;
  }

  /**
   * How far recording a job on a day would push the day the planting goes out: { days, from, to } or null.
   * Only a transplant's sowing and hardening off push, only when late, never past work already recorded, and
   * never out of the plan's year.
   */
  function pushFor(engine, p, kind, date) {
    if (!PUSHES.includes(kind) || AFTER[kind].some(k => done(p, k))) return null;
    const r = engine.calc(p), st = r && !r.rack && r.plannedSow ? step(engine, p, kind) : null;
    if (!st) return null;
    const days = dayDiff(s2d(date), st.planned);
    if (!(days > 0)) return null;
    const to = d2s(addDays(s2d(p.date), days));
    return to.slice(0, 4) === String(p.date).slice(0, 4) ? { days, from: p.date, to } : { days, from: p.date, to: null };
  }

  /**
   * Record a job. input: { date, quantity?, note?, follow? }; ctx: { now, uid, today }.
   * follow (on unless false): a transplant sown or hardened off late goes out as many days later.
   * Returns what LRFSeedLib.recordSowing returns, with `moved` ({ days, from, to }) when the planting was pushed and
   * `held` when it would have left the plan's year and was left where it was.
   */
  function record(engine, inventory, p, kind, input, ctx) {
    const date = String((input && input.date) || ''), st = step(engine, p, kind);
    if (!st) throw new Error(`This planting has no ${SL.DONE_WORD[kind] || 'such work'} to record.`);
    const push = input && input.follow === false ? null : SL.realDay(date) ? pushFor(engine, p, kind, date) : null;
    let result;
    if (st.seed) result = SL.recordSowing(engine, inventory, p, input, ctx);
    else {
      if (st.done) throw new Error(`This ${SL.DONE_WORD[kind]} is already recorded, on ${st.done}.`);
      if (!SL.realDay(date)) throw new Error('Choose a real calendar date.');
      if (date > ctx.today) throw new Error('Work that has not happened yet cannot be recorded. Choose today or an earlier day.');
      if (p.done != null && !objectOr(p.done, null)) throw new Error('The recorded work of this planting cannot be read. It is kept as it is; nothing was changed.');
      const dates = { ...(p.done || {}), [kind]: date };
      for (const [a, b] of SL.DONE_ORDER) {
        const first = done({ done: dates }, a), second = done({ done: dates }, b);
        if (first && second && first > second) throw new Error(a === kind ? `That is after the ${SL.DONE_WORD[b]} already recorded for this planting (${second}).` : `That is before the ${SL.DONE_WORD[a]} already recorded for this planting (${first}).`);
      }
      const flow = objectOr(p.workflow, {}), history = flow.history;
      if (history != null && !Array.isArray(history)) throw new Error('The saved work history of this planting cannot be read. It is kept as it is; nothing was changed.');
      result = { planting: { ...p, done: dates, workflow: { ...flow, history: [...(history || []), { action: 'complete', date, note: String((input && input.note) || '').trim(), at: ctx.now, kind, previousActual: null }] } },
        inventory: null, used: [], untracked: 0, quantity: 0, kind, unit: null, stockUnit: null };
    }
    result.moved = null; result.held = false;
    if (push && push.to) {
      const planting = { ...result.planting, date: push.to }, history = planting.workflow.history.slice(), last = history.length - 1;
      const follow = { days: push.days, from: push.from, to: push.to };
      if (planting.sowOn) { follow.sowOn = planting.sowOn; delete planting.sowOn; }   // a sowing day set by hand belonged to the day it went out
      history[last] = { ...history[last], follow };
      planting.workflow = { ...planting.workflow, history };
      result.planting = planting; result.moved = follow;
    } else if (push) result.held = true;
    return result;
  }
  /**
   * Take a recorded job back: its day is cleared, the seed it used goes back onto its lots, and a planting it
   * pushed returns to where it was, unless it has been moved since.
   */
  function takeBack(engine, inventory, p, kind, ctx) {
    const st = step(engine, p, kind), was = done(p, kind);
    if (!was) throw new Error(`No ${SL.DONE_WORD[kind] || 'work'} is recorded for this planting.`);
    const back = pushed(p, kind);
    let result;
    if (st && st.seed) result = SL.takeBackSowing(engine, inventory, p, ctx);
    else {
      const flow = objectOr(p.workflow, {}), history = flow.history;
      if (history != null && !Array.isArray(history)) throw new Error('The saved work history of this planting cannot be read. It is kept as it is; nothing was changed.');
      const dates = { ...p.done };
      delete dates[kind];
      const planting = { ...p, workflow: { ...flow, history: [...(history || []), { action: 'clear-work', kind, previousActual: was, date: ctx.today, note: '', at: ctx.now }] } };
      if (Object.keys(dates).length) planting.done = dates; else delete planting.done;
      result = { planting, inventory: null, returned: 0, lost: 0, kind, unit: null, stockUnit: null };
    }
    result.restored = null;
    if (back) {
      const planting = { ...result.planting, date: back.from };
      if (back.sowOn) planting.sowOn = back.sowOn;
      result.planting = planting; result.restored = back;
    }
    return result;
  }

  // ── the lines of the list ──
  const SECTIONS = [['potup', 'Pot up'], ['harden', 'Harden off'], ['plant', 'Plant out'], ['move', 'Move out']];
  const KIND_OF = { potup: 'potup', harden: 'harden', plant: 'field', move: 'move' };
  /**
   * Everything but sowing seed, as the acts a grower performs: one line is one variety potted up, hardened off,
   * planted into one garden, or moved out to one garden, on one day. A line carries its plantings, and stands on the
   * day the work was done once it is recorded.
   *
   * "Plant out" holds transplants going into their beds, towers and containers, and whatever is planted and not sown:
   * bulbs, canes and bought-in plants. Seed sown straight into the ground is a sowing, and is not listed here.
   */
  function lines(engine, plan, year) {
    const map = new Map(), yr = String(year);
    for (const p of plan.plantings || []) {
      if (String(p.date).slice(0, 4) !== yr) continue;
      const r = engine.calc(p);
      if (!r || r.rack || r.b.active === false || r.g.active === false) continue;
      const s = SL.sowing(engine, p), vkey = s ? s.key : 'c:' + p.cropId;
      for (const st of steps(engine, p)) {
        if (st.kind === 'sow') continue;
        const seedInGround = st.kind === 'field' && st.seed && (s.unit === 'seeds' || s.unit === 'g');
        if (seedInGround) continue;
        const section = st.kind === 'field' ? 'plant' : st.kind, iso = st.done || d2s(st.planned), there = section === 'plant' || section === 'move';
        const key = [section, vkey, iso, there ? r.g.id : ''].join('|');
        let line = map.get(key);
        if (!line) map.set(key, line = { key, section, kind: st.kind, date: iso, week: monday(iso), crop: r.c, variety: s ? s.variety : null, garden: there ? r.g : null, members: [], stock: null });
        line.members.push({ p, r, s, st });
        if (st.seed && s) line.stock = line.stock || { unit: s.unit, stockUnit: s.stockUnit, key: s.key };
      }
    }
    const list = [...map.values()];
    for (const line of list) {
      const open = line.members.filter(m => !m.st.done && !m.st.passed), dated = line.members.filter(m => m.st.done);
      line.open = open;
      line.state = !open.length ? 'done' : open.length === line.members.length ? 'open' : 'part';
      line.passed = !open.length && !dated.length;                       // later work is recorded; this job never got a day
      line.doneOn = dated.length ? dated.map(m => m.st.done).sort().pop() : null;
      line.late = dated.length ? Math.max(...dated.map(m => m.st.late)) : null;
      line.name = line.variety ? line.variety.name : String(line.crop.name);
      line.sub = line.variety ? String(line.crop.name) : 'no variety chosen';
      line.plants = line.members.reduce((n, m) => n + (m.r.plants || 0), 0);
      line.trays = line.members.reduce((n, m) => n + ((m.r.plannedSow && m.r.sowing && !m.r.sowing.error && m.r.sowing.medium !== 'pots' && m.r.sowing.trays) || 0), 0);
      line.pots = line.members.reduce((n, m) => n + ((m.r.plannedSow && m.r.sowing && !m.r.sowing.error && m.r.sowing.potUpCells) || 0), 0);
      line.containers = line.members.reduce((n, m) => n + (m.r.ct ? m.r.len : 0), 0);
      line.estimate = line.stock ? open.reduce((n, m) => n + (m.s ? m.s.estimate : 0), 0) : 0;
      line.planned = line.members.map(m => d2s(m.st.planned)).sort()[0];
      line.pushed = line.members.map(m => pushed(m.p, 'sow') || pushed(m.p, 'harden')).filter(Boolean);
    }
    const at = l => SECTIONS.findIndex(x => x[0] === l.section);
    list.sort((a, b) => a.date.localeCompare(b.date) || at(a) - at(b) || String(a.crop.name).localeCompare(String(b.crop.name)) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    return list;
  }

  return { ORDER, NAME, DID, PUSHES, SECTIONS, KIND_OF, monday, steps, step, lastRecord, pushed, pushFor, record, takeBack, lines };
});
