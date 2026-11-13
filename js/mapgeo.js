/* Little River Farm Planner — the geometry of the farm map.
 *
 * No page and no plan in here: plain numbers in, plain numbers out, so every rule can be tested without a browser.
 *
 * A shape is { x, y, rot, W, L }: its centre in map pixels, its turn in degrees clockwise from the top of the photo,
 * and its size in map pixels across (W) and along (L). `round: true` marks a tower, which is a circle W wide.
 *
 * Beds on a farm rarely lie square to the photo, so nothing here works in the photo's own left and right. Lining up,
 * spacing and snapping are done in a frame turned to the beds themselves: u runs across a bed, v runs along it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRFMapGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const rad = d => d * Math.PI / 180;
  const turn = a => ((a % 360) + 360) % 360;
  /** How far two directions are from lying along the same lines, 0 to 45: a bed turned a quarter turn still lines up. */
  const offAxis = (a, b) => { const d = (((a - b) % 90) + 90) % 90; return Math.min(d, 90 - d); };
  /** A map point in a frame turned `angle`, and back again. */
  const into = (angle, x, y) => { const c = Math.cos(rad(angle)), s = Math.sin(rad(angle)); return [x * c + y * s, -x * s + y * c]; };
  const outOf = (angle, u, v) => { const c = Math.cos(rad(angle)), s = Math.sin(rad(angle)); return [u * c - v * s, u * s + v * c]; };

  /** The four corners of a shape, in map pixels. */
  function corners(shape) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => {
      const [x, y] = outOf(shape.rot || 0, dx * shape.W / 2, dy * shape.L / 2);
      return [shape.x + x, shape.y + y];
    });
  }
  /** Half the room a shape takes across and along a frame. */
  function half(shape, angle) {
    if (shape.round) return [shape.W / 2, shape.W / 2];
    const d = rad((shape.rot || 0) - angle), c = Math.abs(Math.cos(d)), s = Math.abs(Math.sin(d));
    return [(c * shape.W + s * shape.L) / 2, (s * shape.W + c * shape.L) / 2];
  }
  /** A shape's box in a frame: its edges (u0, u1, v0, v1) and its middle (u, v). */
  function box(shape, angle) {
    const [u, v] = into(angle, shape.x, shape.y), [hu, hv] = half(shape, angle);
    return { u0: u - hu, u1: u + hu, v0: v - hv, v1: v + hv, u, v };
  }
  /** The box round several shapes. */
  function boxAll(shapes, angle) {
    const out = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
    for (const shape of shapes) {
      const b = box(shape, angle);
      out.u0 = Math.min(out.u0, b.u0); out.u1 = Math.max(out.u1, b.u1);
      out.v0 = Math.min(out.v0, b.v0); out.v1 = Math.max(out.v1, b.v1);
    }
    out.u = (out.u0 + out.u1) / 2; out.v = (out.v0 + out.v1) / 2;
    return out;
  }
  /**
   * The same lines as `angle`, turned by quarter turns until u points to the right of the photo and v down it (within 45
   * degrees either way). Left, right, top and bottom then mean what they look like on the page.
   */
  const upright = angle => { const a = (((angle + 45) % 90) + 90) % 90 - 45; return Object.is(a, -0) ? 0 : a; };
  /** The frame a group of shapes lies in: the turn most of them share, set upright. */
  function frameOf(shapes) {
    const turns = shapes.map(s => upright(s.rot || 0)).sort((a, b) => a - b);
    return turns.length ? turns[Math.floor(turns.length / 2)] : 0;
  }

  // ── do two spaces lie on top of each other? ──
  /** Shrink a shape by `by` pixels all round, so that beds that only touch do not count as overlapping. */
  const shrunk = (shape, by) => ({ ...shape, W: Math.max(0, shape.W - 2 * by), L: Math.max(0, shape.L - 2 * by) });
  function overlaps(a, b, slack = 0) {
    const p = shrunk(a, slack), q = shrunk(b, slack);
    if (!(p.W > 0 && p.L > 0 && q.W > 0 && q.L > 0)) return false;
    if (p.round && q.round) return Math.hypot(p.x - q.x, p.y - q.y) < (p.W + q.W) / 2;
    // separating axes: two rectangles are apart when some side of either one has them wholly on different sides of it
    const A = corners(p), B = corners(q);
    for (const poly of [A, B]) {
      for (let i = 0; i < 2; i++) {
        const [x0, y0] = poly[i], [x1, y1] = poly[i + 1], nx = y1 - y0, ny = x0 - x1;
        const span = pts => { let lo = Infinity, hi = -Infinity; for (const [x, y] of pts) { const d = x * nx + y * ny; lo = Math.min(lo, d); hi = Math.max(hi, d); } return [lo, hi]; };
        const [a0, a1] = span(A), [b0, b1] = span(B);
        if (a1 <= b0 || b1 <= a0) return false;
      }
    }
    return true;
  }
  /**
   * The guard rail for the layout: which still shapes would a changed shape newly lie on?
   * `before` is the same shape as it stood. A pair that already overlapped is left alone: it came with the plan.
   */
  function newOverlaps(after, before, still, slack = 0) {
    return still.filter(s => overlaps(after, s, slack) && !(before && overlaps(before, s, slack)));
  }

  // ── snapping: where a dragged group settles ──
  /** The paths a row already keeps: the open strips between neighbours that lie side by side, most common first. */
  function pathsOf(boxes, axis = 'u', most = 40) {
    const [a0, a1, b0, b1] = axis === 'u' ? ['u0', 'u1', 'v0', 'v1'] : ['v0', 'v1', 'u0', 'u1'];
    const sorted = [...boxes].sort((p, q) => p[a0] - q[a0]), seen = new Map();
    for (let i = 0; i < sorted.length; i++) {
      // the nearest shape past this one that shares some of its length
      const next = sorted.slice(i + 1).find(o => o[b0] < sorted[i][b1] && sorted[i][b0] < o[b1] && o[a0] >= sorted[i][a1] - 1e-6);
      if (!next) continue;
      const gap = next[a0] - sorted[i][a1];
      if (gap <= 1e-6 || gap > most) continue;
      const key = Math.round(gap * 100) / 100;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen].sort((p, q) => q[1] - p[1] || p[0] - q[0]).map(([gap]) => gap).slice(0, 3);
  }
  /**
   * The smallest shift, within reach, that lines the moving box up with a still one or leaves the path its neighbours keep.
   * mv: the moving group's box. still: boxes of shapes lying the same way. reach: how close counts, in map pixels.
   * paths: { u: [...], v: [...] } path widths to fall back on beside a neighbour that stands alone. edges: which of the moving box's edges may snap
   * (all of them when a group is dragged; one when an end is being stretched).
   * Returns { du, dv, lines }: each line says what was matched, so the page can draw it.
   */
  function snap(mv, still, reach, paths = {}, edges = null) {
    const out = { du: 0, dv: 0, lines: [] };
    for (const axis of ['u', 'v']) {
      const [a0, a1, a, b0, b1] = axis === 'u' ? ['u0', 'u1', 'u', 'v0', 'v1'] : ['v0', 'v1', 'v', 'u0', 'u1'];
      const mine = (edges ? edges[axis] || [] : [a0, a, a1]).map(k => [k, mv[k]]);
      const found = [];
      // A path is kept with the next space along, not with one two beds away: the nearest still space on each side
      // that shares some of the moving box's length.
      const beside = still.filter(s => s[b0] < mv[b1] && mv[b0] < s[b1]);
      const before = beside.filter(s => s[a] < mv[a]).sort((p, q) => q[a1] - p[a1])[0], after = beside.filter(s => s[a] >= mv[a]).sort((p, q) => p[a0] - q[a0])[0];
      // The path worth keeping beside a neighbour is the one that neighbour keeps with its own neighbour on the far side:
      // a bed set down at the end of a row carries the row's rhythm on. Only a neighbour that stands alone falls back on
      // the paths found round about.
      const rhythm = (s, away) => {
        const row = still.filter(o => o !== s && o[b0] < s[b1] && s[b0] < o[b1]);
        const next = away < 0 ? row.filter(o => o[a1] <= s[a0] + 1e-6).sort((p, q) => q[a1] - p[a1])[0] : row.filter(o => o[a0] >= s[a1] - 1e-6).sort((p, q) => p[a0] - q[a0])[0];
        const gap = next ? (away < 0 ? s[a0] - next[a1] : next[a0] - s[a1]) : 0;
        return gap > 1e-6 ? [gap] : paths[axis] || [];
      };
      const gapsBefore = before ? rhythm(before, -1) : [], gapsAfter = after ? rhythm(after, 1) : [];
      for (const s of still) {
        for (const [key, at] of mine) {
          for (const k of [a0, a, a1]) {
            // a middle only lines up with a middle; an edge with either edge
            if ((key === a) !== (k === a)) continue;
            found.push({ d: s[k] - at, kind: 'edge', axis, at: s[k], s });
          }
          if (key === a) continue;
          if (key === a0 && s === before) for (const gap of gapsBefore) found.push({ d: s[a1] + gap - at, kind: 'path', axis, at: s[a1] + gap, from: s[a1], gap, s });
          if (key === a1 && s === after) for (const gap of gapsAfter) found.push({ d: s[a0] - gap - at, kind: 'path', axis, at: s[a0] - gap, from: s[a0], gap, s });
        }
      }
      const within = found.filter(f => Math.abs(f.d) <= reach);
      if (!within.length) continue;
      within.sort((p, q) => Math.abs(p.d) - Math.abs(q.d) || (p.kind === 'path' ? -1 : 1));
      const best = within[0].d;
      out[axis === 'u' ? 'du' : 'dv'] = best;
      const seen = new Set();
      for (const f of within) {
        if (Math.abs(f.d - best) > 1e-6) continue;
        const id = `${f.kind}|${Math.round(f.at * 100)}|${f.gap || 0}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.lines.push({ axis, kind: f.kind, at: f.at, from: f.from, gap: f.gap, lo: Math.min(f.s[b0], mv[b0]), hi: Math.max(f.s[b1], mv[b1]) });
      }
    }
    return out;
  }
  /** A turn settles on a neighbour's line or a square one when it comes close. */
  function snapTurn(angle, others = [], reach = 2.5) {
    let best = null;
    const tryAt = t => { const d = ((t - angle + 540) % 360) - 180; if (Math.abs(d) <= reach && (best == null || Math.abs(d) < Math.abs(best))) best = d; };
    for (const o of others) for (let k = 0; k < 4; k++) tryAt(o + 90 * k);
    for (let t = 0; t < 360; t += 45) tryAt(t);
    return best == null ? { angle: turn(Math.round(angle)), snapped: false } : { angle: turn(angle + best), snapped: true };
  }

  // ── tidying a group ──
  /** Line a group up in its own frame. where: u0 | u | u1 (across) or v0 | v | v1 (along). Returns id -> { x, y }. */
  function align(shapes, where, angle = frameOf(shapes)) {
    const all = boxAll(shapes, angle), axis = where[0], out = new Map();
    for (const shape of shapes) {
      const b = box(shape, angle), d = all[where] - b[where];
      const [x, y] = outOf(angle, axis === 'u' ? d : 0, axis === 'v' ? d : 0);
      out.set(shape.id, { x: shape.x + x, y: shape.y + y });
    }
    return out;
  }
  /**
   * Space a group along one axis of its frame. With a path width, each shape sits that far from the one before, starting
   * from the first; without one, the two ends stay where they are and the paths between come out equal.
   */
  function spread(shapes, axis = 'u', path = null, angle = frameOf(shapes)) {
    const [a0, a1, a] = axis === 'u' ? ['u0', 'u1', 'u'] : ['v0', 'v1', 'v'];
    const rows = shapes.map(shape => ({ shape, b: box(shape, angle) })).sort((p, q) => p.b[a] - q.b[a]), out = new Map();
    if (rows.length < 2) return { moves: out, path: path || 0 };
    const sizes = rows.reduce((n, r) => n + (r.b[a1] - r.b[a0]), 0);
    const gap = path != null ? path : (rows[rows.length - 1].b[a1] - rows[0].b[a0] - sizes) / (rows.length - 1);
    let at = rows[0].b[a0];
    for (const { shape, b } of rows) {
      const d = at - b[a0], [x, y] = outOf(angle, axis === 'u' ? d : 0, axis === 'v' ? d : 0);
      out.set(shape.id, { x: shape.x + x, y: shape.y + y });
      at += (b[a1] - b[a0]) + gap;
    }
    return { moves: out, path: gap };
  }
  /**
   * Set a group out in rows: so many side by side with a path between, then the next row past an end gap.
   * The shapes are taken in the order given and brought onto the same lines; the group's first corner stays where it is.
   * A bed already on those lines keeps its own turn, so the end its plantings are measured from does not swap.
   */
  function arrange(shapes, { columns, path, endGap }, angle = frameOf(shapes)) {
    const all = boxAll(shapes, angle), out = new Map(), per = Math.max(1, Math.floor(columns) || 1);
    let v = all.v0;
    for (let i = 0; i < shapes.length; i += per) {
      const row = shapes.slice(i, i + per);
      let u = all.u0, tallest = 0;
      for (const shape of row) {
        const rot = offAxis(shape.rot || 0, angle) < 1e-6 ? shape.rot || 0 : angle, [hu, hv] = half({ ...shape, rot }, angle);
        const [x, y] = outOf(angle, u + hu, v + hv);
        out.set(shape.id, { x, y, rot });
        u += 2 * hu + path; tallest = Math.max(tallest, 2 * hv);
      }
      v += tallest + endGap;
    }
    return out;
  }
  /** Turn a group about a point, each shape turning with it. Returns id -> { x, y, rot }. */
  function turnAbout(shapes, cx, cy, by) {
    const out = new Map();
    for (const shape of shapes) {
      const [x, y] = outOf(by, shape.x - cx, shape.y - cy);
      out.set(shape.id, { x: cx + x, y: cy + y, rot: turn((shape.rot || 0) + by) });
    }
    return out;
  }
  /**
   * Scale a group about a point: how a whole garden's drawing is matched to the photo. Sizes on the page follow the
   * garden's own scale, so only the centres are worked out here.
   */
  function scaleAbout(shapes, cx, cy, by) {
    const out = new Map();
    for (const shape of shapes) out.set(shape.id, { x: cx + (shape.x - cx) * by, y: cy + (shape.y - cy) * by });
    return out;
  }
  /**
   * Stretch one side of a bed. side: 'v0' | 'v1' (an end, changing the length) or 'u0' | 'u1' (a side, changing the width).
   * by: how far the side moves outward, in map pixels. The opposite side stays where it is, so the middle moves half as far.
   */
  function stretch(shape, side, by) {
    const along = side[0] === 'v', sign = side[1] === '1' ? 1 : -1, size = along ? shape.L : shape.W;
    const grown = Math.max(1e-6, size + by), [x, y] = outOf(shape.rot || 0, along ? 0 : sign * (grown - size) / 2, along ? sign * (grown - size) / 2 : 0);
    return { ...shape, x: shape.x + x, y: shape.y + y, W: along ? shape.W : grown, L: along ? grown : shape.L };
  }

  // ── new ground ──
  /**
   * Fill a block of ground with beds. block: { x, y, rot, W, L } in map pixels. bedFt and pathFt in feet; pxPerFt turns
   * feet into map pixels. Beds run the long way of the block (runs: 'long') or the short way ('short'), as many as fit
   * side by side, centred in the block. Lengths come out in whole half feet. Returns [{ x, y, rot, w, l }] with w and l in feet.
   */
  function fillBlock(block, { bedFt, pathFt, pxPerFt, runs = 'long', roundTo = 0.5, most = 200 }) {
    const tall = block.L >= block.W, sideways = runs === 'short' ? tall : !tall;
    const span = (sideways ? block.L : block.W) / pxPerFt, run = (sideways ? block.W : block.L) / pxPerFt;
    const length = Math.floor(run / roundTo + 1e-9) * roundTo;
    if (!(bedFt > 0) || !(length > 0)) return [];
    const count = Math.min(most, Math.max(0, Math.floor((span + pathFt + 1e-9) / (bedFt + pathFt))));
    const used = count * bedFt + (count - 1) * pathFt, beds = [];
    for (let i = 0; i < count; i++) {
      const offset = (-used / 2 + bedFt / 2 + i * (bedFt + pathFt)) * pxPerFt;
      const [x, y] = outOf(block.rot || 0, sideways ? 0 : offset, sideways ? offset : 0);
      beds.push({ x: block.x + x, y: block.y + y, rot: turn((block.rot || 0) + (sideways ? 90 : 0)), w: bedFt, l: length });
    }
    return beds;
  }
  /**
   * Where the next bed of a row goes: one step past the last, the step being the one the row already keeps.
   * A lone bed is followed across its width, a path away.
   */
  function nextInRow(shapes, pathPx) {
    const last = shapes[shapes.length - 1];
    if (shapes.length >= 2) {
      const prev = shapes[shapes.length - 2], dx = last.x - prev.x, dy = last.y - prev.y;
      if (Math.hypot(dx, dy) > 1e-6 && offAxis(last.rot || 0, prev.rot || 0) < 2) return { x: last.x + dx, y: last.y + dy, rot: last.rot || 0 };
    }
    const [x, y] = outOf(last.rot || 0, last.W + pathPx, 0);
    return { x: last.x + x, y: last.y + y, rot: last.rot || 0 };
  }
  /** Names for new beds: the numbers after the highest in use, or "name 2", "name 3" where the beds are not numbered. */
  function nextNames(taken, count, stem = '') {
    const used = new Set(taken.map(String)), numbers = taken.map(t => (/^\d+$/.test(String(t).trim()) ? +t : NaN)).filter(Number.isFinite), out = [];
    let n = numbers.length ? Math.max(...numbers) : 0;
    const numbered = numbers.length > 0 || !taken.length || !stem;
    while (out.length < count) {
      n++;
      const name = numbered ? String(n) : `${stem} ${n + 1}`;
      if (!used.has(name)) { used.add(name); out.push(name); }
    }
    return out;
  }
  /** The order beds read in: across their frame, then along it. Used to number a garden. */
  function reading(shapes, angle = frameOf(shapes)) {
    const rows = shapes.map(shape => ({ shape, b: box(shape, angle) }));
    const tall = Math.max(1, ...rows.map(r => r.b.v1 - r.b.v0));
    return rows.sort((p, q) => (Math.abs(p.b.v - q.b.v) > tall / 2 ? p.b.v - q.b.v : p.b.u - q.b.u)).map(r => r.shape);
  }

  // ── pots and crates: which ones a crop stands in ──
  /**
   * Which containers of a group each planting stands in, worked out for the whole season at once, so that a crop keeps
   * its place from the day it goes in to the day it comes out and nothing shuffles when the date moves.
   * items: [{ id, from, to, n, pin? }], from and to being day numbers, both counted. cap: containers in the group.
   * First in, first seated: side by side where there is room for the whole crop, otherwise the lowest free ones.
   * A pin (the first container, chosen by hand) is kept whenever those containers are free.
   * Returns Map id -> [index, ...]. A crop the group has no room for gets what is left, which may be none.
   */
  function seats(items, cap) {
    const order = [...items].sort((a, b) => a.from - b.from || String(a.id).localeCompare(String(b.id))), placed = [], out = new Map();
    const size = Math.max(0, Math.floor(cap));
    for (const item of order) {
      const want = Math.max(0, Math.round(item.n)), taken = new Uint8Array(size);
      for (const other of placed) if (other.item.from <= item.to && item.from <= other.item.to) for (const i of other.at) taken[i] = 1;
      const freeRun = start => { if (start < 0 || start + want > size) return false; for (let i = start; i < start + want; i++) if (taken[i]) return false; return true; };
      let at = null;
      if (want > 0 && Number.isInteger(item.pin) && freeRun(item.pin)) at = item.pin;
      if (at == null && want > 0) for (let i = 0; i + want <= size; i++) if (freeRun(i)) { at = i; break; }
      const mine = [];
      if (at != null) for (let i = at; i < at + want; i++) mine.push(i);
      else for (let i = 0; i < size && mine.length < want; i++) if (!taken[i]) mine.push(i);
      placed.push({ item, at: mine });
      out.set(item.id, mine);
    }
    return out;
  }

  /** Feet to one map pixel, from two points on the photo and the real distance between them. */
  function scaleFrom(a, b, feet) {
    const px = Math.hypot(a[0] - b[0], a[1] - b[1]);
    return px > 0 && feet > 0 ? feet / px : null;
  }

  return { rad, turn, offAxis, upright, into, outOf, corners, half, box, boxAll, frameOf, overlaps, newOverlaps, pathsOf, snap, snapTurn, align, spread, arrange, turnAbout, scaleAbout, stretch, fillBlock, nextInRow, nextNames, reading, seats, scaleFrom };
});
