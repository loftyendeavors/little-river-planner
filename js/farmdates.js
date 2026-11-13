/* Little River Farm Planner — the farm's dates.
 *
 * Five days of the year that belong to the farm and to no crop, and that the plan is worked out from:
 *
 *   the last spring frost     a frost-tender crop is not proposed in ground open to frost before it, and a crate or tower
 *                             kept under cover moves out on it when it has no day of its own
 *   the first fall frost      where the harvest of a frost-tender crop ends in ground open to frost
 *   field planting starts     for cool-season crops, and for warm-season crops: the first day each is proposed in the field
 *   outdoor planting ends     the last day anything is proposed outdoors
 *
 * They are kept in the plan's settings as month and day ("05-01"). Changing one writes that one line and touches no
 * planting: whatever moves, moves because the plan is worked out from the dates. So a date set back puts everything
 * back. What a change would do is worked out here, from two engines, before anything is written.
 *
 * No DOM and no storage in this file. It runs in the browser and in Node.
 *
 *   LRFFarmDates.read(engine)                    -> { year, dates: { frostLast: '05-01', … }, own: { frostLast: true, … } }
 *   LRFFarmDates.check(dates)                    -> [{ key, text }] why these dates cannot stand; empty when they can
 *   LRFFarmDates.settingsWith(engine, dates)     -> the plan's settings with those dates, or the same object when nothing differs
 *   LRFFarmDates.compare(before, after, tools)   -> what the change does to the plan as it stands
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.LRFFarmDates = factory(root.LRFEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  /**
   * The five dates, in the order the window shows them. `fallback` is what the plan is worked out from when a plan does not say:
   * the frost dates come from the built-in defaults, the field dates are the engine's own.
   */
  const FIELDS = [
    { key: 'frostLast', group: 'frost', label: 'Last spring frost', short: 'the last spring frost', fallback: null, does: 'A frost-tender crop is not offered ground open to frost before it. Crates and towers under cover move out on it, unless they have a day of their own.' },
    { key: 'frostFirst', group: 'frost', label: 'First fall frost', short: 'the first fall frost', fallback: null, does: 'Where the harvest of a frost-tender crop ends in ground open to frost.' },
    { key: 'firstCoolField', group: 'field', label: 'Cool-season crops, from', short: 'the start of cool-season field planting', fallback: '04-15', does: 'The first day the planner offers a cool-season crop a place in the field.' },
    { key: 'firstWarmField', group: 'field', label: 'Warm-season crops, from', short: 'the start of warm-season field planting', fallback: '05-01', does: 'The first day it offers a warm-season crop a place in the field.' },
    { key: 'lastOutdoorField', group: 'field', label: 'Outdoor planting ends', short: 'the end of outdoor planting', fallback: '10-01', does: 'The last day it offers anything a place outdoors.' }
  ];
  const GROUPS = { frost: 'Frost', field: 'Planting in open ground' };
  const KEYS = FIELDS.map(f => f.key);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const validMonthDay = s => /^\d{2}-\d{2}$/.test(String(s || '')) && E.validDate(E.s2d('2000-' + s));
  const word = md => validMonthDay(md) ? `${MONTHS[+md.slice(0, 2) - 1]} ${+md.slice(3)}` : '—';
  const planYear = eng => +(eng.plan.settings && eng.plan.settings.year) || new Date().getFullYear();

  /** The dates the plan stands on, and which of them the plan itself says (the rest are the fallbacks). */
  function read(eng) {
    const settings = eng.plan.settings || {}, defaults = (eng.lib && eng.lib.defaults) || {}, dates = {}, own = {};
    for (const f of FIELDS) {
      own[f.key] = validMonthDay(settings[f.key]);
      dates[f.key] = own[f.key] ? settings[f.key] : (f.fallback || (validMonthDay(defaults[f.key]) ? defaults[f.key] : null));
    }
    return { year: planYear(eng), dates, own };
  }

  /** Why a set of dates cannot stand. The planner refuses only what makes no season at all. */
  function check(dates) {
    const out = [], d = dates || {};
    for (const f of FIELDS) if (!validMonthDay(d[f.key])) out.push({ key: f.key, text: `A day of the year is needed for ${f.short}.` });
    if (out.length) return out;
    if (!(d.frostLast < d.frostFirst)) out.push({ key: 'frostFirst', text: 'The first fall frost has to come after the last spring frost.' });
    for (const key of ['firstCoolField', 'firstWarmField']) if (!(d[key] < d.lastOutdoorField)) out.push({ key: 'lastOutdoorField', text: 'Outdoor planting has to end after field planting starts.' });
    return out.filter((x, i) => out.findIndex(y => y.text === x.text) === i);
  }

  /** The dates among `dates` that differ from what the plan stands on now. */
  function changed(eng, dates) {
    const now = read(eng).dates, out = {};
    for (const key of KEYS) if (dates && validMonthDay(dates[key]) && dates[key] !== now[key]) out[key] = dates[key];
    return out;
  }

  /** The plan's settings with those dates. Only a date that differs is written; with none, the same object comes back. */
  function settingsWith(eng, dates) {
    const settings = eng.plan.settings || {}, diff = changed(eng, dates);
    return Object.keys(diff).length ? { ...settings, ...diff } : settings;
  }

  const dayOf = d => E.validDate(d) ? E.d2s(d) : '';
  const through = (eng, p, r) => { const t = eng.occupancyThrough(p, r); return t === Infinity ? 'all' : E.validDate(t) ? E.d2s(t) : ''; };
  const pairsOf = eng => {
    const set = new Set();
    for (const p of eng.plan.plantings) { const r = eng.calc(p); if (r) for (const o of eng.conflicts(p, r)) if (!o.rest) set.add([p.id, o.p.id].sort().join('|')); }
    return set;
  };

  /**
   * What a change of dates does to the plan as it stands. `before` and `after` are engines made from the same plan with
   * different settings. tools.trouble(engine, planting, calc) says why the season would refuse a planting where it stands
   * (the planner's own rule for what it offers); tools.worth(engine) is the season's worth. Both are optional.
   *
   * harvest   plantings whose last harvest day moves: { id, cropId, was, now, days }  (days > 0 is later)
   * dates     plantings whose sowing, planting or first harvest day moves (the farm's dates should move none: listed if any does)
   * out       crates and towers whose day of moving out moves: { id, cropId, was, now }
   * yields    plantings whose yield changes: { id, cropId, was, now, unit }
   * ground    { fresh, settled, standing }: pairs booked into the same ground that are new, gone, and there either way
   * outside   plantings the planner would no longer offer the place they stand in: { id, cropId, why }
   * inside    plantings it would offer their place again
   * worth     [before, after], or null without tools.worth
   */
  function compare(before, after, tools = {}) {
    const harvest = [], dates = [], out = [], yields = [], outside = [], inside = [];
    let counted = 0;
    for (const p of after.plan.plantings) {
      const q = before.planting(p.id), a = q && before.calc(q), b = after.calc(p);
      if (!a || !b) continue;
      counted++;
      const base = { id: p.id, cropId: p.cropId };
      if (dayOf(a.last) !== dayOf(b.last) || through(before, q, a) !== through(after, p, b)) harvest.push({ ...base, was: dayOf(a.last), now: dayOf(b.last), days: E.dayDiff(b.last, a.last), heldWas: through(before, q, a), heldNow: through(after, p, b) });
      if (dayOf(a.field) !== dayOf(b.field) || dayOf(a.sow) !== dayOf(b.sow) || dayOf(a.first) !== dayOf(b.first)) dates.push({ ...base, was: { sow: dayOf(a.sow), field: dayOf(a.field), first: dayOf(a.first) }, now: { sow: dayOf(b.sow), field: dayOf(b.field), first: dayOf(b.first) } });
      if (dayOf(a.out) !== dayOf(b.out)) out.push({ ...base, was: dayOf(a.out), now: dayOf(b.out) });
      const ya = before.yieldOf(q), yb = after.yieldOf(p), ua = ya ? +ya.units || 0 : 0, ub = yb ? +yb.units || 0 : 0;
      if (Math.abs(ua - ub) > 1e-6) yields.push({ ...base, was: ua, now: ub, unit: (yb && yb.unit) || (ya && ya.unit) || '' });
      if (tools.trouble) {
        const ta = tools.trouble(before, q, a), tb = tools.trouble(after, p, b);
        if (!ta && tb) outside.push({ ...base, why: tb }); else if (ta && !tb) inside.push({ ...base, why: ta });
      }
    }
    const was = pairsOf(before), now = pairsOf(after);
    const ground = { fresh: [...now].filter(k => !was.has(k)).map(k => k.split('|')), settled: [...was].filter(k => !now.has(k)).map(k => k.split('|')), standing: [...now].filter(k => was.has(k)).length };
    const worth = tools.worth ? [tools.worth(before), tools.worth(after)] : null;
    const same = !harvest.length && !dates.length && !out.length && !yields.length && !ground.fresh.length && !ground.settled.length && !outside.length && !inside.length && (!worth || Math.abs(worth[1] - worth[0]) < 0.005);
    return { counted, harvest, dates, out, yields, ground, outside, inside, worth, same };
  }

  /** Lines for a list: a result's plantings gathered by crop. Each { cropId, n, ids, lo, hi } with lo and hi the fewest and most days moved. */
  function byCrop(list) {
    const rows = new Map();
    for (const x of list) {
      const row = rows.get(x.cropId) || { cropId: x.cropId, n: 0, ids: [], lo: Infinity, hi: -Infinity, why: x.why || '' };
      row.n++; row.ids.push(x.id);
      if (Number.isFinite(x.days)) { row.lo = Math.min(row.lo, x.days); row.hi = Math.max(row.hi, x.days); }
      rows.set(x.cropId, row);
    }
    return [...rows.values()].sort((a, b) => b.n - a.n);
  }

  return { FIELDS, GROUPS, KEYS, read, check, changed, settingsWith, compare, byCrop, validMonthDay, word };
});
