/* Little River Farm Planner — guard rails.
 *
 * The rules that keep two plantings out of the same ground at the same time,
 * as pure functions over an engine so they can be tested without a browser:
 *
 *   propose()  where a dropped crop or a moved planting would land in a space
 *   refusal()  why an edit is not allowed, or null when it is
 *   stretch()  dragging an end of a planting along its bed
 *   slide()    the same, where the end lies against a neighbour: the line between the two moves
 *   share()    a drop onto a bed that is held: how it could be split, and what replacing would do
 *   equalize() the plantings that stand together in a bed, given equal shares again
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
    if (eng.isRack(bed) && !(eng.capOf(bed) > 0)) return { state: 'blocked', why: 'no-count', p: base };   // a bench with no tray count holds nothing by hand
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

  // ─────────────────────── sharing a bed that is held ───────────────────────
  // A planting in a soil bed covers so many feet along it and a share of its rows across (engine.footprint), and any number of
  // them can stand in one bed. What follows makes such beds: nothing here changes a plan. Each way is worked out on a copy,
  // checked against the guard rails, and handed back as edits for the app to make in one step. No date is ever moved.
  const wholeWidth = f => !f || !f.rows || (f.x0 <= EPS && f.x1 >= 1 - EPS);
  const put = (record, change) => { const after = { ...record }; for (const [key, value] of Object.entries(change)) { if (value === undefined || value === null || value === '') delete after[key]; else after[key] = value; } return after; };
  const recorded = p => !!p && ((!!p.done && typeof p.done === 'object' && Object.keys(p.done).length > 0) || (!!p.workflow && Array.isArray(p.workflow.seedUse) && p.workflow.seedUse.length > 0) || p.established === true);
  /** Why something that holds ground cannot be asked to give any up, or to leave: 'rest' | 'recorded' | 'standing' | 'tray' | ''. */
  function fixed(eng, o) {
    if (o.rest) return 'rest';
    if (recorded(o.p)) return 'recorded';
    if (eng.standKey(o.p)) return 'standing';
    if (o.p.liveTray) return 'tray';
    return '';
  }
  /**
   * A planting laid on feet [a0, a1) of its bed, with the rows it has. Lengths are kept exact, not rounded: a bed in three is
   * three thirds, so that each share comes to the same number of plants. A plant count pinned on a share is let go with its old length.
   */
  function laid(p, a0, a1, L) {
    const len = a1 - a0, after = { ...p };
    if (p.bedLayout) { const layout = { ...p.bedLayout, startFt: Math.max(0, a0) }; delete layout.plantCount; after.bedLayout = layout; after.ft = len; delete after.startFt; return after; }
    if (len >= L - EPS) { delete after.ft; delete after.startFt; return after; }
    after.ft = len;
    if (a0 > EPS) after.startFt = a0; else delete after.startFt;
    return after;
  }
  const spanOf = (o, L) => [o.rect.a0, Math.min(o.rect.a1, L)];
  /** The edits, tried on a copy: null when the guard rails would refuse them. Otherwise the copy's engine and what each planting comes to. */
  function tried(eng, ops, L) {
    const gone = new Set(ops.filter(op => op.before).map(op => op.before.id)), added = ops.filter(op => op.after).map(op => op.after);
    const trial = E.create({ ...eng.plan, plantings: [...eng.plan.plantings.filter(q => !gone.has(q.id)), ...added] }, eng.lib, PROBE);
    if (refusal(eng, trial, added.map(q => q.id))) return null;
    const shares = [];
    for (const op of ops) {
      if (!op.after) continue;
      const r1 = trial.calc(op.after), r0 = op.before && eng.planting(op.before.id) ? eng.calc(op.before) : null, f1 = r1 && trial.footprint(op.after, r1);
      if (!r1) return null;
      shares.push({ p: op.after, isNew: !r0, was: r0 ? { len: r0.physicalLength, plants: r0.plants } : null,
        now: { len: r1.physicalLength, plants: r1.plants, a0: f1 ? f1.a0 : 0, a1: f1 ? Math.min(f1.a1, L) : r1.physicalLength, rows: f1 && f1.rows && f1.rows.count < f1.rows.total ? { count: f1.rows.count, total: f1.rows.total } : null } });
    }
    return { trial, shares };
  }
  /** Equal lanes along a bed: every holder the full width, all one length, each starting on a multiple of it. Returns how many lanes, or 0. */
  function lanesAlong(others, L) {
    if (!others.length || !others.every(o => wholeWidth(o.rect))) return 0;
    const len = spanOf(others[0], L)[1] - spanOf(others[0], L)[0], m = Math.round(L / len);
    if (!(len > 0) || m < 1 || Math.abs(m * len - L) > 1e-4) return 0;
    for (const o of others) { const [a0, a1] = spanOf(o, L), i = a0 / len; if (Math.abs(a1 - a0 - len) > 1e-4 || Math.abs(i - Math.round(i)) > 1e-4) return 0; }
    return m;
  }
  /** Equal lanes across a bed: every holder the same run of feet, the same count of rows of one grid, each starting on a multiple of it. { m, T, c, a0, a1 } or null. */
  function lanesAcross(others, L) {
    if (!others.length) return null;
    const rowsOf = o => o.rect.rows ? o.rect.rows : { start: 0, count: o.r.rows, total: o.r.rows }, first = rowsOf(others[0]), T = first.total, c = first.count, [a0, a1] = spanOf(others[0], L);
    if (!Number.isInteger(T) || T < 2 || T > 12 || !Number.isInteger(c) || c < 1 || T % c) return null;
    for (const o of others) { const x = rowsOf(o), [b0, b1] = spanOf(o, L); if (x.total !== T || x.count !== c || x.start % c || Math.abs(b0 - a0) > 1e-4 || Math.abs(b1 - a1) > 1e-4) return null; }
    return { m: T / c, T, c, a0, a1, rowsOf };
  }
  /**
   * A drop onto a soil bed where ground is held on those days. payload and target are propose()'s; options.source is the
   * planting dropped when it is not in the plan (one waiting to be placed), options.by ('length' | 'rows' | 'replace') works out one
   * way only, and options.quick none: it then says only who holds the bed and whether any of them is fixed (`no`).
   * Returns null where the question does not arise (not a soil bed, or nothing holds it then). Otherwise
   *   { bed, holders, from, through, base, length, rows, replace, no: { length?, rows?, replace? } }
   * holders: everything that holds any of the bed at any time while the newcomer would be in the ground.
   * A way: { ops, p, r, shares: [{ p, isNew, was, now }], equal? } — `p` is the newcomer as it would be planted.
   * length: where the bed is in equal full-width shares, all of them close up and the newcomer takes an equal share at the end;
   *         otherwise the share the drop points at (or the longest) gives up its second half.
   * rows:   where the bed is in equal runs of rows and the rows divide by one more, each gives up rows for an equal run.
   * replace: every holder leaves the bed, as `waiting` records (the app sends them to wait), and the newcomer goes in as propose() says.
   * no[way]: why a way is not offered: 'recorded' | 'standing' | 'tray' | 'rest' | 'rows' | 'short' | 'crowded' | 'fit', with `who` where a planting is the reason.
   */
  function share(eng, payload, target, options = {}) {
    const bed = eng.bedOf(target.bedId), source = options.source || (payload.plantingId ? eng.planting(payload.plantingId) : null);
    if (!bed || bed.active === false || !eng.isSoilBed(bed) || (payload.plantingId && !source)) return null;
    const base = baseDraft(eng, payload, source, bed.id, target.date), crop = eng.crop(base.cropId);
    if (!crop || crop.micro) return null;
    const probe = plain(base), r0 = eng.evaluate(probe);
    if (!r0) return null;
    const from = eng.occupancyFrom(probe, r0), through = eng.occupancyThrough(probe, r0), L = eng.capOf(bed);
    const others = eng.holders(bed, from, through, base.id).slice().sort((a, b) => (a.rect.a0 - b.rect.a0) || (a.rect.x0 - b.rect.x0) || (a.from - b.from));
    if (!others.length) return null;
    const out = { bed, holders: others, from, through, base: probe, length: null, rows: null, replace: null, no: {} };
    const stuck = others.map(o => ({ o, why: fixed(eng, o) })).find(x => x.why);
    if (stuck) { for (const way of ['length', 'rows', 'replace']) out.no[way] = { why: stuck.why, who: stuck.o.p || null }; return out; }
    if (options.quick) return out;   // only whether the question arises: no way is worked out
    const before = source && !payload.copy && eng.planting(source.id) ? source : null;
    const finish = (ops, p, extra = {}) => { const t = tried(eng, ops, L); if (!t) return null; return { ops, p, r: t.trial.calc(p), shares: t.shares, ...extra }; };

    // ── along the bed ──
    if (!options.by || options.by === 'length') {
      const m = lanesAlong(others, L), ops = [];
      let mine = null, why = '';
      if (m) {
        const len = L / m;
        if (L / (m + 1) < MIN_FT - EPS) why = 'short';
        else {
          for (const o of others) { const i = Math.round(o.rect.a0 / len); ops.push({ before: o.p, after: laid(o.p, L * i / (m + 1), L * (i + 1) / (m + 1), L) }); }
          mine = [L * m / (m + 1), L];
        }
      } else {
        // not in equal shares (he has sized them): the share pointed at, or the longest, gives up its second half
        const able = others.filter(o => wholeWidth(o.rect)), at = target.along;
        const host = (at != null && able.find(o => at >= o.rect.a0 - EPS && at <= Math.min(o.rect.a1, L) + EPS)) || able.slice().sort((a, b) => (spanOf(b, L)[1] - spanOf(b, L)[0]) - (spanOf(a, L)[1] - spanOf(a, L)[0]))[0];
        if (!host) why = 'rows';
        else {
          const [h0, h1] = spanOf(host, L), mid = (h0 + h1) / 2;
          if (mid - h0 < MIN_FT - EPS) why = 'short';
          else {
            for (const o of others) {
              const [a0, a1] = spanOf(o, L);
              if (a1 <= mid + EPS || a0 >= h1 - EPS) continue;                    // clear of the feet given up
              if (a0 >= mid - EPS || !wholeWidth(o.rect)) { why = 'crowded'; break; }   // it lies in them, or holds rows across them
              if (mid - a0 < MIN_FT - EPS) { why = 'short'; break; }
              ops.push({ before: o.p, after: laid(o.p, a0, mid, L) });
            }
            if (!why) mine = [mid, h1];
          }
        }
      }
      if (mine) {
        const p = { ...probe, ft: mine[1] - mine[0], startFt: mine[0] };
        out.length = finish([...ops, { before, after: p }], p, { equal: !!m, each: mine[1] - mine[0] });
        if (!out.length) out.no.length = { why: 'fit' };
      } else out.no.length = { why };
    }

    // ── across the bed ──
    if (!options.by || options.by === 'rows') {
      const g = lanesAcross(others, L);
      if (!g || (g.T % (g.m + 1))) out.no.rows = { why: 'rows' };
      else {
        const c = g.T / (g.m + 1), gid = (others.map(o => o.p.bedLayout && o.p.bedLayout.groupId).find(Boolean)) || `split:${newId()}`, ops = [];
        let ok = true;
        for (const o of others) {
          const change = rowsChange(eng, o.p, (g.rowsOf(o).start / g.c) * c, c, g.T);
          if (!change) { ok = false; break; }
          const after = put(o.p, change);
          if (after.bedLayout) after.bedLayout = { ...after.bedLayout, groupId: gid };
          ops.push({ before: o.p, after });
        }
        const p = { ...probe, ft: g.a1 - g.a0, rowsPerBed: g.T, inRow: r0.inRow, rowSp: r0.rowSp, bedLayout: { v: 1, groupId: gid, rowStart: g.m * c, rowCount: c, startFt: g.a0 } };
        out.rows = ok ? finish([...ops, { before, after: p }], p, { equal: true, each: c, total: g.T }) : null;
        if (!out.rows) out.no.rows = { why: 'fit' };
      }
    }

    // ── in their place ──
    if (!options.by || options.by === 'replace') {
      const leaving = new Set(others.map(o => o.p.id));
      const without = E.create({ ...eng.plan, plantings: eng.plan.plantings.filter(q => !leaving.has(q.id)) }, eng.lib, PROBE);
      const got = propose(without, payload, target, { source });
      if (got.state === 'blocked' || !got.p) out.no.replace = { why: 'fit' };
      else {
        const ops = [...others.map(o => ({ before: o.p, after: null })), { before, after: got.p }];
        const t = tried(eng, ops, L);
        if (!t) out.no.replace = { why: 'fit' };
        else out.replace = { ops, p: got.p, r: t.trial.calc(got.p), shares: t.shares, waiting: others.map(o => {
          // what goes to wait: the planting with its date and its choices, less the ground it stood on. The length it had is the length it asks for.
          const w = { ...o.p }, asked = !o.p.bedLayout && +o.p.ft > 0 && o.r.physicalLength < L - EPS ? +o.p.ft : null;
          for (const key of ['bedId', 'ft', 'startFt', 'bedLayout', 'trays', 'shelter', 'out', 'seat']) delete w[key];
          if (asked) w.ft = asked;
          w.wait = { why: 'Another crop took its bed', from: bed.id };
          return w;
        }) };
      }
    }
    return out;
  }
  /**
   * The plantings that stand together in a soil bed with this one (their days overlap its days), itself first in bed order:
   * [{ p, r, rect }], or [] where it stands alone. The ones a share would be divided among.
   */
  function mates(eng, p) {
    const r = p && eng.calc(p);
    if (!r || !eng.isSoilBed(r.b)) return [];
    const others = eng.holders(r.b, eng.occupancyFrom(p, r), eng.occupancyThrough(p, r), p.id).filter(o => !o.rest);
    if (!others.length) return [];
    return [{ p, r, rect: eng.footprint(p, r) }, ...others].sort((a, b) => (a.rect.a0 - b.rect.a0) || (a.rect.x0 - b.rect.x0));
  }
  /**
   * Equal shares for the plantings that stand together in a bed, and for any that are to join them. ids: plantings of the plan, all
   * in one soil bed. options.extra: plantings not in the plan yet (the same bed, any dates), which take the last shares.
   * options.by: 'length' (each the full width, laid end to end in the order they lie) or 'rows' (each a run of rows over the same
   * feet, where the rows divide evenly); left out, it is whichever way they are shared now, and the length where they are not.
   * Returns { ops, by, shares, each, total? } or { no: why, who? }. Shares that are already equal give { ops: [] }.
   */
  function equalize(eng, ids, options = {}) {
    const list = ids.map(id => eng.planting(id)).filter(Boolean).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && eng.isSoilBed(x.r.b)).map(x => ({ ...x, rect: eng.footprint(x.p, x.r) }));
    const extra = (options.extra || []).map(d => ({ d: plain(d), r: eng.evaluate(plain(d)) }));
    if (!list.length || list.length + extra.length < 2 || list.some(x => x.r.b.id !== list[0].r.b.id) || extra.some(x => !x.r || x.d.bedId !== list[0].r.b.id)) return { no: 'alone' };
    const stuck = list.find(x => fixed(eng, x));
    if (stuck) return { no: fixed(eng, stuck), who: stuck.p };
    const L = list[0].r.cap, n = list.length + extra.length, ops = [], apart = list.some(x => !wholeWidth(x.rect));
    const by = options.by || (apart ? 'rows' : 'length');
    let each, total;
    if (by === 'length') {
      if (apart) return { no: 'rows' };
      if (L / n < MIN_FT - EPS) return { no: 'short' };
      each = L / n;
      list.sort((a, b) => a.rect.a0 - b.rect.a0).forEach((x, i) => { const after = laid(x.p, L * i / n, L * (i + 1) / n, L); if (JSON.stringify(after) !== JSON.stringify(x.p)) ops.push({ before: x.p, after }); });
      extra.forEach((x, k) => { const i = list.length + k; ops.push({ before: null, after: { ...x.d, ft: L / n, startFt: L * i / n } }); });
    } else {
      const rowsOf = x => x.rect.rows ? x.rect.rows.total : x.r.rows, T = rowsOf(list[0]), [a0, a1] = spanOf(list[0], L);
      if (!Number.isInteger(T) || T < 2 || T > 12 || T % n || list.some(x => rowsOf(x) !== T || Math.abs(spanOf(x, L)[0] - a0) > 1e-4 || Math.abs(spanOf(x, L)[1] - a1) > 1e-4)) return { no: 'rows' };
      const c = T / n, gid = list.map(x => x.p.bedLayout && x.p.bedLayout.groupId).find(Boolean) || `split:${newId()}`;
      each = c; total = T;
      list.sort((a, b) => a.rect.x0 - b.rect.x0).forEach((x, i) => {
        const change = rowsChange(eng, x.p, i * c, c, T), after = change && put(x.p, change);
        if (after && after.bedLayout) after.bedLayout = { ...after.bedLayout, groupId: gid };
        if (after && JSON.stringify(after) !== JSON.stringify(x.p)) ops.push({ before: x.p, after });
      });
      extra.forEach((x, k) => { const i = list.length + k; ops.push({ before: null, after: { ...x.d, ft: a1 - a0, rowsPerBed: T, inRow: x.r.inRow, rowSp: x.r.rowSp, bedLayout: { v: 1, groupId: gid, rowStart: i * c, rowCount: c, startFt: a0 } } }); });
    }
    if (!ops.length) return { ops, by, shares: [], each, total };
    const t = tried(eng, ops, L);
    return t ? { ops, by, shares: t.shares, each, total } : { no: 'fit' };
  }
  /**
   * Dragging an end of a planting where it lies against a neighbour. Pulled back, the end gives up feet as stretch() has it.
   * Pushed on, the line between the two moves: this one grows and the neighbour gives up the feet, down to its last foot.
   * Returns what stretch() returns; where the line moved, `ops` are the two edits (one step) and `other` is the neighbour.
   */
  function slide(eng, p, edge, ft) {
    const res = stretch(eng, p, edge, ft);
    if (!res) return null;
    const r = eng.calc(p), f = eng.footprint(p, r), L = r.cap, end = Math.min(f.a1, L), want = snap(ft);
    if (!wholeWidth(f) || (edge === 'end' ? want <= res.hi + EPS : want >= res.lo - EPS)) return res;
    const beside = eng.holders(r.b, eng.occupancyFrom(p, r), eng.occupancyThrough(p, r), p.id).filter(o => !o.rest && wholeWidth(o.rect));
    const touching = beside.filter(o => Math.abs((edge === 'end' ? o.rect.a0 : Math.min(o.rect.a1, L)) - (edge === 'end' ? res.hi : res.lo)) < 0.01);
    if (touching.length !== 1 || fixed(eng, touching[0]) || recorded(p)) return res;
    const o = touching[0], [g0, g1] = spanOf(o, L);
    if (g1 - g0 < 2 * MIN_FT - EPS) return res;
    const line = edge === 'end' ? clamp(want, f.a0 + MIN_FT, g1 - MIN_FT) : clamp(want, g0 + MIN_FT, end - MIN_FT);
    const mine = edge === 'end' ? [f.a0, line] : [line, end], theirs = edge === 'end' ? [line, g1] : [g0, line];
    const ops = [{ before: p, after: laid(p, mine[0], mine[1], L) }, { before: o.p, after: laid(o.p, theirs[0], theirs[1], L) }];
    if (!tried(eng, ops, L)) return res;
    return { ...res, a0: mine[0], a1: mine[1], len: mine[1] - mine[0], change: null, ops, other: { p: o.p, len: theirs[1] - theirs[0] }, same: false };
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

  return { propose, swap, refusal, stretch, slide, share, mates, equalize, fixed, rowsChange, cleanup, trimOps, freeRects, sharedDays, MIN_FT };
});
