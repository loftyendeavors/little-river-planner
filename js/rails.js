/* Little River Farm Planner — guard rails.
 *
 * The rules that keep two plantings out of the same ground at the same time,
 * as pure functions over an engine so they can be tested without a browser:
 *
 *   propose()  where a dropped crop or a moved planting would land in a space
 *   refusal()  why an edit is not allowed, or null when it is
 *   stretch()  dragging an end of a planting along its bed
 *   cleanup()  overlaps that came in with an older plan, with ways to settle each
 *
 * Nothing here warns. An edit either fits or it does not happen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.LRFRails = factory(root.LRFEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const EPS = 1e-6, MIN_FT = 1;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = v => Math.round(v * 1e9) / 1e9;   // tidy float noise; positions are otherwise exact
  const snap = (v, step = 1) => Math.round(v / step) * step;
  const uniq = list => [...new Set(list.map(round))].sort((a, b) => a - b);
  let counter = 0;
  const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  // ───────────────────────── free ground in a bed ─────────────────────────
  /** Free rectangles of a bed `L` feet long, given the rectangles in use. Widest first, then longest. */
  function freeRects(L, used) {
    const A = uniq([0, L, ...used.flatMap(r => [clamp(r.a0, 0, L), clamp(r.a1, 0, L)])]), X = uniq([0, 1, ...used.flatMap(r => [r.x0, r.x1])]);
    const busy = (i, j) => used.some(r => r.a0 < A[i + 1] - EPS && A[i] < r.a1 - EPS && r.x0 < X[j + 1] - EPS && X[j] < r.x1 - EPS);
    const out = [], seen = new Set();
    for (let i = 0; i < A.length - 1; i++) {
      for (let j = 0; j < X.length - 1; j++) {
        if (busy(i, j)) continue;
        let j0 = j, j1 = j;
        while (j0 > 0 && !busy(i, j0 - 1)) j0--;
        while (j1 < X.length - 2 && !busy(i, j1 + 1)) j1++;
        const clear = k => { for (let c = j0; c <= j1; c++) if (busy(k, c)) return false; return true; };
        let i0 = i, i1 = i;
        while (i0 > 0 && clear(i0 - 1)) i0--;
        while (i1 < A.length - 2 && clear(i1 + 1)) i1++;
        const key = `${i0},${i1},${j0},${j1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a0: A[i0], a1: A[i1 + 1], x0: X[j0], x1: X[j1 + 1] });
      }
    }
    return out;
  }
  const fullWidth = r => r.x0 <= EPS && r.x1 >= 1 - EPS;
  const lengthOf = r => r.a1 - r.a0;
  const holds = (r, at) => at && at.along != null && at.along >= r.a0 - EPS && at.along <= r.a1 + EPS && (at.across == null || (at.across >= r.x0 - EPS && at.across <= r.x1 + EPS));
  const isFree = (rect, used) => !used.some(g => rect.a0 < g.a1 - EPS && g.a0 < rect.a1 - EPS && rect.x0 < g.x1 - EPS && g.x0 < rect.x1 - EPS);

  // ───────────────────────────── proposals ─────────────────────────────
  /** The planting a drop starts from: a new one for a library crop, or the moved (or copied) planting. */
  function baseDraft(eng, payload, source, bedId, date) {
    const iso = E.d2s(date);
    if (!source) {
      const p = { id: newId(), bedId, cropId: payload.cropId, date: iso };
      if (payload.varietyId) p.varietyId = payload.varietyId;
      return p;
    }
    const next = { ...source, bedId, date: iso };
    if (payload.copy) { next.id = newId(); delete next.done; delete next.workflow; delete next.flagReviews; delete next.planningSource; delete next.standId; }
    if (bedId !== source.bedId) {
      // Settings that describe the old space do not follow the planting to a different kind of space.
      const target = eng.bedOf(bedId);
      delete next.shelter; delete next.out;
      if (!eng.isTower(target)) { delete next.towerCycle; delete next.towerUsedSites; }
      if (!eng.isCt(target)) delete next.perC;
    }
    return next;
  }
  // An engine made only to ask whether something fits: dates and ground are all it is asked, so it skips working out sowing batches.
  const PROBE = { sowing: false };
  const plain = p => { const q = { ...p }; delete q.bedLayout; delete q.startFt; delete q.ft; delete q.trays; return q; };

  /**
   * Where a crop from the library, or a planting being moved, would land.
   * target: { bedId, date, along?, across? } — `along` in bed-feet and `across` 0..1 when the pointer can aim inside the bed.
   * Returns { state: 'ok' | 'partial' | 'blocked', p, r, rect, blockers, why, from, through, was }.
   */
  function propose(eng, payload, target, options = {}) {
    const bed = eng.bedOf(target.bedId), source = options.source || (payload.plantingId ? eng.planting(payload.plantingId) : null);
    if (!bed || bed.active === false || (payload.plantingId && !source)) return { state: 'blocked', why: 'space' };
    // Live trays are planned from weekly demand. Their batches are regenerated from it, so a batch moved by hand would be put back.
    if (eng.isPool(bed) || (source && eng.isPool(eng.bedOf(source.bedId)))) return { state: 'blocked', why: 'pool' };
    const base = baseDraft(eng, payload, source, bed.id, target.date), crop = eng.crop(base.cropId);
    if (!crop) return { state: 'blocked', why: 'crop' };
    if (crop.micro && !eng.isRack(bed)) return { state: 'blocked', why: 'micro-needs-bench', p: base };
    if (!crop.micro && eng.isRack(bed)) return { state: 'blocked', why: 'bench-needs-micro', p: base };
    const sameBed = !!source && !payload.copy && source.bedId === bed.id;
    const sourceR = source ? eng.calc(source) || eng.evaluate(source) : null, was = sourceR ? { len: sourceR.physicalLength, cap: sourceR.cap } : null;
    const done = (state, p, extra = {}) => {
      const fit = eng.fit(p);
      if (!fit.r) return { state: 'blocked', why: 'crop', p };
      if (!fit.ok) return { state: 'blocked', why: fit.over ? 'too-long' : 'held', p, r: fit.r, blockers: fit.blockers, from: fit.from, through: fit.through, rect: fit.rect, was };
      return { state, p, r: fit.r, rect: fit.rect, blockers: [], from: fit.from, through: fit.through, was, ...extra };
    };

    // Towers are held whole.
    if (eng.isTower(bed)) return done('ok', plain(base));

    // Benches and container groups share by count.
    if (!eng.isSoilBed(bed)) {
      const key = eng.isRack(bed) ? 'trays' : 'ft', cap = eng.capOf(bed), probe = plain(base), r0 = eng.evaluate(probe);
      if (!r0) return { state: 'blocked', why: 'crop', p: probe };
      const room = eng.roomFor(bed, eng.occupancyFrom(probe, r0), eng.occupancyThrough(probe, r0), probe.id, null, 0);
      const own = source && +source[key] > 0 && (sameBed || eng.spaceKind(eng.bedOf(source.bedId)) === eng.spaceKind(bed)) ? Math.min(+source[key], cap) : null;
      const want = own || cap, n = Math.floor(Math.min(want, room) + 1e-9);
      if (n < 1) return done('ok', own ? { ...probe, [key]: own } : probe);
      if (n < want && options.noShrink) return done('ok', own ? { ...probe, [key]: own } : probe);
      return done(n >= want ? 'ok' : 'partial', n >= cap ? probe : { ...probe, [key]: n }, { shrunk: n < want });
    }

    // Soil beds: find free ground.
    const L = eng.capOf(bed), probe = plain(base), r0 = eng.evaluate(probe);
    if (!r0) return { state: 'blocked', why: 'crop', p: probe };
    const from = eng.occupancyFrom(probe, r0), through = eng.occupancyThrough(probe, r0);
    const others = eng.holders(bed, from, through, base.id), used = others.map(o => o.rect);
    const fromSoil = !!sourceR && eng.isSoilBed(sourceR.b), srcRect = fromSoil ? eng.footprint(source, sourceR) : null;
    const at = target.along != null ? target : null;
    const aim = (len, lo, hi) => clamp(at ? snap(at.along - len / 2) : sameBed && srcRect ? srcRect.a0 : lo, lo, Math.max(lo, hi - len));

    // A planting that holds only some of the rows keeps that share of the width.
    if (srcRect && srcRect.rows && !fullWidth(srcRect)) {
      const len = Math.min(sourceR.physicalLength, L), shrunk = len < sourceR.physicalLength - EPS;
      const starts = [aim(len, 0, L), 0, ...used.map(g => g.a1), ...used.map(g => g.a0 - len)].filter(a => a >= -EPS && a + len <= L + EPS);
      const a0 = starts.find(a => isFree({ a0: a, a1: a + len, x0: srcRect.x0, x1: srcRect.x1 }, used));
      if (a0 == null || (shrunk && options.noShrink)) return { state: 'blocked', why: 'held', p: base, r: r0, blockers: others, from, through, was };
      const layout = { ...source.bedLayout, startFt: round(Math.max(0, a0)) };
      if (shrunk) delete layout.plantCount;
      if (payload.copy || !sameBed) layout.groupId = `split:${newId()}`;
      return done(shrunk ? 'partial' : 'ok', { ...base, ft: round(len), bedLayout: layout }, { shrunk });
    }

    // How long it wants to be: its own length if it had one, otherwise as much as there is.
    const ownLen = srcRect && sourceR.physicalLength < sourceR.cap - EPS ? Math.min(sourceR.physicalLength, L) : null;
    const rects = used.length ? freeRects(L, used).filter(r => lengthOf(r) >= MIN_FT - EPS) : [{ a0: 0, a1: L, x0: 0, x1: 1 }];
    const wide = rects.filter(fullWidth), strips = rects.filter(r => !fullWidth(r) && rowGrid(r, others));
    const longest = list => list.slice().sort((a, b) => lengthOf(b) - lengthOf(a) || a.a0 - b.a0)[0];
    const roomy = list => ownLen ? list.filter(r => lengthOf(r) >= ownLen - EPS) : list;
    const pick = wide.find(r => holds(r, at) && (!ownLen || lengthOf(r) >= ownLen - EPS)) || (at && at.across != null ? strips.find(r => holds(r, at)) : null)
      || (sameBed && srcRect ? roomy(wide).find(r => r.a0 <= srcRect.a0 + EPS && r.a1 >= srcRect.a0 + EPS) : null)
      || longest(roomy(wide)) || longest(wide) || longest(strips);
    if (!pick) return { state: 'blocked', why: 'held', p: probe, r: r0, blockers: others, from, through, was };

    const space = lengthOf(pick), len = ownLen ? Math.min(ownLen, space) : space, shrunk = ownLen ? len < ownLen - EPS : (!!source && space < L - EPS && fromSoil && !sameBed);
    if (shrunk && options.noShrink) return { state: 'blocked', why: 'held', p: probe, r: r0, blockers: others, from, through, was };
    const a0 = round(len < space - EPS ? aim(len, pick.a0, pick.a1) : pick.a0);
    if (!fullWidth(pick)) {
      const T = rowGrid(pick, others), layout = { v: 1, groupId: `split:${newId()}`, rowStart: Math.round(pick.x0 * T), rowCount: Math.round((pick.x1 - pick.x0) * T), startFt: a0 };
      if (options.noShrink) return { state: 'blocked', why: 'held', p: probe, r: r0, blockers: others, from, through, was };
      return done('partial', { ...probe, ft: round(len), rowsPerBed: T, inRow: r0.inRow, rowSp: r0.rowSp, bedLayout: layout }, { shrunk, strip: true });
    }
    const whole = len >= L - EPS, p = whole ? probe : { ...probe, ft: round(len), ...(a0 > EPS ? { startFt: a0 } : {}) };
    return done(whole || (ownLen && !shrunk) ? 'ok' : 'partial', p, { shrunk });
  }
  /** The row count a free strip is measured in: the grid of a row-split planting beside it. */
  function rowGrid(rect, others) {
    for (const T of new Set(others.map(o => o.rect && o.rect.rows && o.rect.rows.total).filter(Boolean))) {
      const a = rect.x0 * T, b = rect.x1 * T;
      if (Math.abs(a - Math.round(a)) < 1e-5 && Math.abs(b - Math.round(b)) < 1e-5 && Math.round(b) > Math.round(a)) return T;
    }
    return 0;
  }

  /**
   * A blocked move can still happen as a trade: whatever holds the target goes to the
   * space the moved planting leaves. Only like for like, and only if every piece fits unshrunk.
   */
  function swap(eng, payload, target) {
    const p = payload.plantingId && !payload.copy ? eng.planting(payload.plantingId) : null;
    if (!p || p.bedId === target.bedId) return null;
    const A = eng.bedOf(p.bedId), B = eng.bedOf(target.bedId);
    if (!A || !B || eng.spaceKind(A) !== eng.spaceKind(B) || eng.standKey(p)) return null;
    const probe = plain(baseDraft(eng, payload, p, B.id, target.date)), r = eng.evaluate(probe);
    if (!r) return null;
    const others = eng.holders(B, eng.occupancyFrom(probe, r), eng.occupancyThrough(probe, r), p.id);
    if (!others.length || others.length > 6 || others.some(o => o.rest || eng.standKey(o.p))) return null;
    const moving = new Set([p.id, ...others.map(o => o.p.id)]);
    let work = { ...eng.plan, plantings: eng.plan.plantings.filter(q => !moving.has(q.id)) };
    const ops = [];
    for (const o of others.slice().sort((a, b) => a.from - b.from)) {
      const res = propose(E.create(work, eng.lib, PROBE), { plantingId: o.p.id }, { bedId: A.id, date: E.s2d(o.p.date) }, { source: o.p, noShrink: true });
      if (res.state !== 'ok') return null;
      work = { ...work, plantings: [...work.plantings, res.p] };
      ops.push({ before: o.p, after: res.p });
    }
    const mine = propose(E.create(work, eng.lib, PROBE), payload, { bedId: B.id, date: target.date }, { source: p, noShrink: true });
    if (mine.state !== 'ok') return null;
    return { ...mine, state: 'swap', ops: [{ before: p, after: mine.p }, ...ops], traded: others.map(o => o.p) };
  }

  // ───────────────────────────── the gate ─────────────────────────────
  const sharedDays = (a, b) => { const lo = Math.max(+a.from, +b.from), hi = Math.min(+a.through, +b.through); return hi === Infinity ? Infinity : Math.max(0, Math.round((hi - lo) / 86400000) + 1); };
  function trouble(eng, p) {
    const r = p && eng.calc(p), partners = new Map();
    if (!r) return { over: false, partners, r: null };
    const mine = { from: eng.occupancyFrom(p, r), through: eng.occupancyThrough(p, r) };
    for (const o of eng.conflicts(p, r)) partners.set(o.rest ? 'rest' : o.p.id, sharedDays(mine, o));
    return { over: eng.overflow(p, r), partners, r };
  }
  /**
   * Why an edit is refused, or null. `ids` are the plantings the edit touches.
   * An overlap that is already in the plan may stay while it is being fixed, but it may not grow.
   */
  function refusal(before, after, ids) {
    for (const id of ids) {
      const now = after.planting(id);
      if (!now) continue;
      const was = before.planting(id), t1 = trouble(after, now), t0 = was ? trouble(before, was) : { over: false, partners: new Map() };
      if (t1.over && !t0.over) return { kind: 'too-long', p: now, r: t1.r };
      for (const [other, days] of t1.partners) {
        const prior = t0.partners.get(other);
        if (prior == null || days > prior) return { kind: 'overlap', p: now, r: t1.r, other: other === 'rest' ? null : after.planting(other), days };
      }
    }
    return null;
  }

  // ───────────────────── dragging an end along the bed ─────────────────────
  /** edge: 'start' | 'end'. `ft` is the pointer's position along the bed. */
  function stretch(eng, p, edge, ft) {
    const r = eng.calc(p), f = r && eng.footprint(p, r);
    if (!f) return null;
    const L = r.cap, beside = eng.holders(r.b, eng.occupancyFrom(p, r), eng.occupancyThrough(p, r), p.id).map(o => o.rect).filter(g => g.x0 < f.x1 - EPS && f.x0 < g.x1 - EPS);
    const end = Math.min(f.a1, L), lo = Math.max(0, ...beside.filter(g => g.a1 <= f.a0 + EPS).map(g => g.a1)), hi = Math.min(L, ...beside.filter(g => g.a0 >= end - EPS).map(g => g.a0));
    const near = (v, edgeValue) => Math.abs(v - edgeValue) < 0.5 ? edgeValue : v;
    let a0 = f.a0, a1 = end;
    if (edge === 'start') a0 = clamp(near(snap(ft), lo), lo, a1 - MIN_FT); else a1 = clamp(near(snap(ft), hi), a0 + MIN_FT, hi);
    a0 = round(a0); a1 = round(a1);
    const len = round(a1 - a0);
    let change;
    if (r.layout) { const layout = { ...p.bedLayout, startFt: a0 }; delete layout.plantCount; change = { ft: len, bedLayout: layout }; }
    else change = len >= L - EPS ? { ft: null, startFt: null } : { ft: len, startFt: a0 > EPS ? a0 : null };
    return { a0, a1, lo, hi, len, x0: f.x0, x1: f.x1, change, same: Math.abs(a0 - f.a0) < EPS && Math.abs(a1 - f.a1) < EPS };
  }
  /** Give a planting some of the rows of its bed: rows [start, start+count) of `total`. */
  function rowsChange(eng, p, start, count, total) {
    const r = eng.calc(p), f = r && eng.footprint(p, r);
    if (!f || !(total >= 1) || count < 1 || start < 0 || start + count > total) return null;
    const a0 = round(Math.min(f.a0, r.cap)), len = round(Math.min(f.a1, r.cap) - a0);
    if (count === total) return len >= r.cap - EPS ? { bedLayout: null, startFt: null, ft: null } : { bedLayout: null, ft: len, startFt: a0 > EPS ? a0 : null };
    const layout = { v: 1, groupId: (p.bedLayout && p.bedLayout.groupId) || `split:${newId()}`, rowStart: start, rowCount: count, startFt: a0 };
    return { bedLayout: layout, startFt: null, ft: len, rowsPerBed: total, inRow: r.inRow, rowSp: r.rowSp };
  }

  // ───────────────────────── one-time cleanup ─────────────────────────
  /**
   * Overlaps and over-long plantings already in the plan.
   *   long:   [{ p, r, want, cap }]
   *   groups: [{ late, early:[…], bed, days, options:[{ id, ops }] }] — one per planting that goes in while others still hold its ground
   */
  function cleanup(eng) {
    const long = [], byLate = new Map();
    for (const p of eng.plan.plantings) {
      const r = eng.calc(p);
      if (!r) continue;
      if (eng.overflow(p, r)) long.push({ p, r, want: r.physicalLength, cap: r.cap });
      const mine = { from: eng.occupancyFrom(p, r), through: eng.occupancyThrough(p, r) };
      for (const o of eng.conflicts(p, r)) {
        if (o.rest) continue;
        const later = +mine.from > +o.from || (+mine.from === +o.from && p.id > o.p.id);
        if (!later) continue;
        const g = byLate.get(p.id) || byLate.set(p.id, { late: p, r, bed: r.b, from: mine.from, early: [], days: 0 }).get(p.id);
        g.early.push(o); g.days = Math.max(g.days, sharedDays(mine, o));
      }
    }
    const groups = [...byLate.values()].sort((a, b) => a.from - b.from);
    // Ways to settle a collision are worked out when first asked for: each means trying the plan several ways.
    for (const g of groups) { let options = null; Object.defineProperty(g, 'options', { enumerable: true, get: () => options || (options = settle(eng, g)) }); }
    return { long, groups, count: long.length + groups.length };
  }
  /** Set a planting's last harvest day, in whichever way its harvest is modelled. */
  function endHarvest(after, r, last) {
    if (+last >= +r.last) return after;
    if (r.harvestMode === 'window') { after.hw = Math.round((+last - +r.first) / 86400000) + 1; after.harvestMode = 'window'; delete after.harvestEnd; } else after.harvestEnd = E.d2s(last);
    return after;
  }
  function settle(eng, g) {
    const options = [], late = g.late, earlyIds = new Set(g.early.map(o => o.p.id));
    const offer = (id, ops, info) => {
      const work = { ...eng.plan, plantings: eng.plan.plantings.map(q => { const op = ops.find(x => x.before.id === q.id); return op ? op.after : q; }) };
      const after = E.create(work, eng.lib, PROBE);
      if (after.conflicts(after.planting(late.id)).some(o => !o.rest && earlyIds.has(o.p.id))) return;
      if (refusal(eng, after, ops.map(op => op.after.id))) return;   // must pass the same gate as any edit
      options.push({ id, ops, ...info });
    };
    const lastThrough = Math.max(...g.early.map(o => +o.through));
    if (Number.isFinite(lastThrough)) {
      // Plant it once the ground is clear. Whatever it would then run into is pushed back in turn.
      const date = E.addDays(new Date(lastThrough), 1), ops = [{ before: late, after: { ...late, date: E.d2s(date) } }], also = [];
      for (let i = 0; i < 8; i++) {
        const work = { ...eng.plan, plantings: eng.plan.plantings.map(q => { const op = ops.find(x => x.before.id === q.id); return op ? op.after : q; }) }, after = E.create(work, eng.lib, PROBE);
        let pushed = false;
        for (const op of ops.slice()) {
          const now = after.planting(op.after.id), r = after.calc(now), mineFrom = +after.occupancyFrom(now, r), through = +after.occupancyThrough(now, r);
          for (const o of after.conflicts(now, r)) {
            if (o.rest || earlyIds.has(o.p.id) || ops.some(x => x.before.id === o.p.id) || +o.from < mineFrom || !Number.isFinite(through) || after.standKey(o.p)) continue;
            const next = E.addDays(new Date(through), 1 + Math.round((+E.s2d(o.p.date) - +o.from) / 86400000));
            ops.push({ before: eng.planting(o.p.id), after: { ...eng.planting(o.p.id), date: E.d2s(next) } }); also.push({ p: o.p, date: next }); pushed = true;
          }
        }
        if (!pushed) break;
      }
      offer('later', ops, { date, days: Math.round((+date - +E.s2d(late.date)) / 86400000), also });
    }
    const dayBefore = E.addDays(g.from, -1);
    // Finish the earlier crop sooner and keep its turnover days.
    const sooner = g.early.map(o => {
      if (!Number.isFinite(+o.through) || o.r.rack || eng.standKey(o.p)) return null;
      const last = E.addDays(dayBefore, -eng.turnoverFor(o.p));
      if (last < o.r.first) return null;
      return { before: o.p, after: endHarvest({ ...o.p }, o.r, last), last, lost: Math.round((+o.r.last - +last) / 86400000) };
    });
    if (sooner.every(Boolean)) offer('sooner', sooner.map(x => ({ before: x.before, after: x.after })), { date: new Date(Math.min(...sooner.map(x => +x.last))), days: Math.max(...sooner.map(x => x.lost)) });
    // Skip the turnover gap: the earlier crop comes out the day before the next goes in.
    const flips = g.early.map(o => {
      if (!(eng.turnoverFor(o.p) > 0) || !Number.isFinite(+o.through) || o.r.rack || eng.standKey(o.p)) return null;
      const last = new Date(Math.min(+o.r.last, +dayBefore));
      if (last < o.r.first) return null;
      return { before: o.p, after: endHarvest({ ...o.p, turnover: 0 }, o.r, last), last, lost: Math.round((+o.r.last - +last) / 86400000), gap: eng.turnoverFor(o.p) };
    });
    if (flips.every(Boolean)) offer('flip', flips.map(x => ({ before: x.before, after: x.after })), { date: new Date(Math.min(...flips.map(x => +x.last))), days: Math.max(...flips.map(x => x.lost)), gap: Math.max(...flips.map(x => x.gap)) });
    return options;
  }
  /** Over-long plantings cut back to the space they are in. */
  function trimOps(eng, long) {
    return long.map(({ p, r }) => {
      const after = { ...p };
      if (r.layout) { after.ft = round(r.cap - r.layout.startFt); const lay = { ...p.bedLayout }; delete lay.plantCount; after.bedLayout = lay; }
      else if (r.rack) delete after.trays; else { delete after.ft; delete after.startFt; }
      return { before: p, after };
    });
  }

  return { propose, swap, refusal, stretch, rowsChange, cleanup, trimOps, freeRects, sharedDays, MIN_FT };
});
