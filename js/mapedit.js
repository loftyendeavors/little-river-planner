/* Little River Farm Planner — editing the layout of the farm.
 *
 * "Edit layout" on the map turns the map from a plan into a drawing of the ground. Nothing here plans a crop: plantings
 * stay with their beds and are shown faintly, and every change is one step that Undo takes back.
 *
 *   click a bed to pick it · Shift-click picks more · Shift-drag picks a box · a garden's name picks all of it
 *   drag what is picked to move it · Alt-drag leaves it and moves a copy · arrow keys nudge half a foot
 *   one bed picked: drag an end or a side to change its real length or width · the round handle turns
 *   New garden: drag a block on the map and beds fill it · Measure: a distance on the photo, and the photo's scale
 *
 * Guard rails, not flags: a change that would lay one space on top of another does not happen (an overlap that came
 * with the plan may stay), a space that holds plantings cannot be removed, and a bed cannot be made shorter than what
 * is planted in it (that one is the planner's own rule, in rails.js).
 *
 * Everything is worked out in the beds' own lines, not the photo's: see mapgeo.js. This file is the page side of it:
 * what is picked, the handles, the guide lines, the panel and the list of gardens.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, Lib = root.LRFLibrary, M = root.LRFMap, Geo = root.LRFMapGeo;
  const { h, s, clear, num, toast } = UI;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round2 = n => Math.round(n * 100) / 100;

  // on: the mode. picked: ids of the spaces picked, the first being the one the others are lined up to.
  // tool: null | 'block' | 'tape'. drag: the gesture in hand. draft: a garden drawn and not yet made. tape: a measured line.
  const S = { on: false, picked: [], tool: null, drag: null, draft: null, tape: null, nudge: null };
  let layer = null, ghosts = null, read = null, pill = null, side = null, panel = null, button = null;

  // ── the plan, read as ground ──
  const plan = () => App.state.plan, eng = () => App.state.engine;
  const bedOf = id => eng().bedOf(id);
  const gardenOf = bed => eng().gardenOf(bed) || {};
  const kindOf = bed => eng().spaceKind(bed);
  const scaleOf = garden => { const k = garden && garden.mapScale; return typeof k === 'number' && Number.isFinite(k) && k >= 0.05 && k <= 20 ? k : 1; };
  /** Map pixels to a real foot, for a space: the photo's scale, and the garden's own where its drawing was matched to the photo. */
  const pxPerFt = bed => scaleOf(gardenOf(bed)) / M.feetPerPx();
  const shapes = ids => ids.map(id => M.shapeOf(id)).filter(Boolean);
  const drawn = () => shapes(M.spaces());
  const WORD = { bed: 'Bed', tower: 'Tower', containers: 'Group', bench: 'Bench' };
  const nameOf = bed => /^\d+$/.test(String(bed.bed).trim()) ? `${WORD[kindOf(bed)]} ${bed.bed}` : String(bed.bed);
  const plural = (n, one, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;
  const inGarden = gardenId => M.spaces().map(bedOf).filter(b => b && b.gardenId === gardenId);
  /** The garden, when what is picked is exactly all of one garden's spaces. */
  function wholeGarden(ids = S.picked) {
    const beds = ids.map(bedOf).filter(Boolean);
    if (!beds.length || beds.some(b => b.gardenId !== beds[0].gardenId)) return null;
    return inGarden(beds[0].gardenId).length === beds.length ? gardenOf(beds[0]) : null;
  }
  function describe(ids) {
    const beds = ids.map(bedOf).filter(Boolean), g = wholeGarden(ids);
    if (g && beds.length > 1) return g.name;
    if (beds.length === 1) return `${gardenOf(beds[0]).name || 'Garden'} · ${nameOf(beds[0])}`;
    return plural(beds.length, 'space');
  }
  /** The bed width and path the farm mostly uses: what a new garden starts from. */
  function typical() {
    const widths = new Map(), paths = new Map();
    for (const g of plan().gardens) {
      const own = inGarden(g.id).filter(b => kindOf(b) === 'bed');
      for (const b of own) widths.set(+b.w, (widths.get(+b.w) || 0) + 1);
      if (own.length < 2) continue;
      // the path is the narrower of the strips a garden keeps: side by side, or end to end where its beds lie that way
      const frame = Geo.frameOf(shapes(own.map(b => b.id))), k = pxPerFt(own[0]), boxes = shapes(own.map(b => b.id)).map(x => Geo.box(x, frame));
      const gaps = [...Geo.pathsOf(boxes, 'u', 12 * k).slice(0, 1), ...Geo.pathsOf(boxes, 'v', 12 * k).slice(0, 1)].map(gap => Math.round(gap / k * 2) / 2).filter(ft => ft > 0);
      if (gaps.length) { const ft = Math.min(...gaps); paths.set(ft, (paths.get(ft) || 0) + own.length); }
    }
    const top = (m, d) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || d;
    return { bedFt: top(widths, 4), pathFt: top(paths, 2) };
  }

  // ── guard rails ──
  /**
   * Would this change lay a space on top of another? after: Map id -> shape as it would be drawn. Returns the first
   * clash as { id, on } or null. Spaces that already overlapped are left alone, and so are spaces moving together.
   */
  function clash(after, together = true) {
    const moving = new Set(after.keys()), still = drawn().filter(x => !moving.has(x.id)), slack = 0.15 / M.feetPerPx();
    for (const [id, shape] of after) {
      const hit = Geo.newOverlaps(shape, M.shapeOf(id), still, slack);
      if (hit.length) return { id, on: hit[0].id };
    }
    if (together) return null;
    const list = [...after];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, sa] = list[i], [b, sb] = list[j], wa = M.shapeOf(a), wb = M.shapeOf(b);
      if (Geo.overlaps(sa, sb, slack) && !(wa && wb && Geo.overlaps(wa, wb, slack))) return { id: a, on: b };
    }
    return null;
  }
  const clashText = c => { const a = bedOf(c.id), b = bedOf(c.on); return `${a ? nameOf(a) : 'That'} would lie on ${b ? `${gardenOf(b).name} · ${nameOf(b)}` : 'another space'}`; };

  // ── changes, each one undoable step ──
  const spot = (x, y, rot) => ({ x: round2(x), y: round2(y), rot: round2(Geo.turn(rot || 0)) });
  /** Move, turn, size or rename spaces. changes: Map id -> { x?, y?, rot?, and any bed field }. */
  function change(label, changes, more = []) {
    const ops = [...more];
    for (const [id, c] of changes) {
      const before = bedOf(id), at = M.shapeOf(id);
      if (!before) continue;
      const after = { ...before }, moved = c.x !== undefined || c.y !== undefined || c.rot !== undefined;
      if (moved && at) after.px = spot(c.x ?? at.x, c.y ?? at.y, c.rot ?? at.rot);
      for (const [key, value] of Object.entries(c)) if (!['x', 'y', 'rot'].includes(key)) { if (value == null) delete after[key]; else after[key] = value; }
      if (JSON.stringify(after) !== JSON.stringify(before)) ops.push({ kind: 'bed', before, after });
    }
    return ops.length ? App.commit(label, ops) : false;
  }
  const undoable = message => toast(message, { label: 'Undo', run: App.undo });
  const uniqueGarden = name => { const taken = new Set(plan().gardens.map(g => g.name)); if (!taken.has(name)) return name; for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`; };
  const nextOrder = () => Math.max(0, ...plan().gardens.map(g => +g.order || 0)) + 1;
  const orient = rot => { const a = Geo.turn(rot) % 180; return a > 45 && a < 135 ? 'EW' : 'NS'; };

  /** Copies of spaces, set down at `at` (Map id -> { x, y, rot }). A whole garden copied is a new garden. */
  function copyTo(ids, at) {
    const whole = ids.length > 1 ? wholeGarden(ids) : null, ops = [], made = [];
    let gardenId = null;
    if (whole) {
      const g = { ...whole, id: App.uid(), name: uniqueGarden(whole.name), order: nextOrder() };
      delete g.mapLayout; delete g.bedOrder;
      ops.push({ kind: 'garden', before: null, after: g }); gardenId = g.id;
    }
    const names = new Map();
    for (const id of ids) {
      const bed = bedOf(id), p = at.get(id);
      if (!bed || !p) continue;
      let name = bed.bed;
      if (!whole) {
        const taken = names.get(bed.gardenId) || names.set(bed.gardenId, plan().beds.filter(b => b.gardenId === bed.gardenId).map(b => String(b.bed))).get(bed.gardenId);
        name = Geo.nextNames(taken, 1, String(bed.bed))[0]; taken.push(name);
      }
      const after = { ...bed, id: App.uid(), bed: name, gardenId: gardenId || bed.gardenId, px: spot(p.x, p.y, p.rot), orient: orient(p.rot) };
      ops.push({ kind: 'bed', before: null, after }); made.push(after.id);
    }
    if (!made.length || !App.commit(whole ? `Copy ${whole.name}` : `Copy ${describe(ids)}`, ops)) return false;
    pick(made);
    return true;
  }
  /** One more bed past the end of a row, a step on from the last, the same size. */
  function addNext(ids = S.picked) {
    const picked = ids.map(bedOf).filter(Boolean);
    if (!picked.length) return;
    const row = (picked.length > 1 ? picked : inGarden(picked[0].gardenId).filter(b => kindOf(b) === kindOf(picked[0])));
    const numbered = row.every(b => /^\d+$/.test(String(b.bed).trim()));
    const ordered = numbered ? [...row].sort((a, b) => +a.bed - +b.bed) : Geo.reading(shapes(row.map(b => b.id))).map(x => bedOf(x.id));
    const last = ordered[ordered.length - 1], lined = shapes(ordered.map(b => b.id)), k = pxPerFt(last);
    const at = Geo.nextInRow(lined, typical().pathFt * k), shape = { ...lined[lined.length - 1], id: 'new', ...at };
    const still = drawn(), hit = still.find(x => Geo.overlaps(shape, x, 0.15 / M.feetPerPx()));
    if (hit) { const b = bedOf(hit.id); toast(`No room past ${nameOf(last)}: the next one would lie on ${b ? `${gardenOf(b).name} · ${nameOf(b)}` : 'another space'}. Move it there by hand: Alt-drag a bed to copy it.`); return; }
    const name = Geo.nextNames(plan().beds.filter(b => b.gardenId === last.gardenId).map(b => String(b.bed)), 1, String(last.bed))[0];
    const after = { ...last, id: App.uid(), bed: name, px: spot(at.x, at.y, at.rot), orient: orient(at.rot) };
    if (App.commit(`Add ${nameOf(after)} to ${gardenOf(last).name}`, [{ kind: 'bed', before: null, after }])) { pick([after.id]); undoable(`${nameOf(after)} added to ${gardenOf(last).name}, ${sizeText(after)}.`); }
  }
  async function remove(ids = S.picked) {
    const beds = ids.map(bedOf).filter(Boolean);
    if (!beds.length) return;
    const held = beds.map(b => ({ b, n: eng().plantingsIn(b.id).length })).filter(x => x.n);
    if (held.length) {
      const { b, n } = held[0];
      toast(`${gardenOf(b).name} · ${nameOf(b)} holds ${plural(n, 'planting')} this season${held.length > 1 ? `, and ${plural(held.length - 1, 'other space')} picked hold some too` : ''}. Move or remove them first: a space with plantings stays.`);
      return;
    }
    const whole = wholeGarden(ids), what = whole && beds.length > 1 ? whole.name : beds.length === 1 ? `${gardenOf(beds[0]).name} · ${nameOf(beds[0])}` : plural(beds.length, 'space');
    if (beds.length > 1 && !(await UI.confirm({ title: `Remove ${what}?`, body: `${plural(beds.length, 'space')} come off the map and out of the plan. Nothing is planted in them. One Undo puts them back.`, confirmLabel: 'Remove', danger: true }))) return;
    const ops = beds.map(before => ({ kind: 'bed', before, after: null })), going = new Set(beds.map(b => b.id));
    // a garden left with no space at all goes with its last one
    for (const g of plan().gardens) if (beds.some(b => b.gardenId === g.id) && !plan().beds.some(b => b.gardenId === g.id && !going.has(b.id))) ops.push({ kind: 'garden', before: g, after: null });
    if (App.commit(`Remove ${what}`, ops)) { pick([]); undoable(`${what} removed.`); }
  }
  const sizeText = bed => kindOf(bed) === 'bed' ? `${num(bed.w, 2)} × ${num(bed.l, 2)} ft` : kindOf(bed) === 'containers' ? plural(+bed.count || 0, 'container') : plural(eng().capOf(bed), 'site');

  // ── picking ──
  function pick(ids, how = {}) {
    const known = new Set(M.spaces()), next = how.add ? [...S.picked] : [];
    for (const id of ids) {
      if (!known.has(id)) continue;
      const i = next.indexOf(id);
      if (i < 0) next.push(id); else if (how.toggle) next.splice(i, 1);
    }
    S.picked = next;
    refresh();
  }
  const pickGarden = (gardenId, how) => pick(inGarden(gardenId).map(b => b.id), how);

  // ── on and off ──
  function open(focus = {}) {
    if (App.state.view !== 'map') App.setView('map');
    if (!S.on) {
      App.arm(null); App.select(null);
      if (M.wholeSeason()) M.wholeSeason(false);
      S.on = true; S.picked = []; S.tool = null; S.draft = null; S.tape = null;
      document.body.dataset.layout = 'on';
      M.lock(true);
      button.setAttribute('aria-pressed', 'true');
    }
    if (focus.bedId && bedOf(focus.bedId)) { pick([focus.bedId]); M.fitSpaces(inGarden(bedOf(focus.bedId).gardenId).map(b => b.id), true); }
    else refresh();
    if (focus.field) { const el = $(focus.field); if (el) { el.focus(); el.select(); } }
  }
  function close() {
    if (!S.on) return;
    settleNudge(); dropDrag();
    S.on = false; S.picked = []; S.tool = null; S.draft = null; S.tape = null;
    delete document.body.dataset.layout;
    M.lock(false);
    button.setAttribute('aria-pressed', 'false');
    refresh();
  }
  function setTool(tool) {
    settleNudge();
    S.tool = S.tool === tool ? null : tool; S.draft = null; S.tape = null;
    if (S.tool) S.picked = [];
    refresh();
  }

  // ── the pointer ──
  const world = e => M.toWorld(e.clientX, e.clientY);
  let spaceDown = false;
  function down(e) {
    S.press = null;
    if (!S.on || e.button !== 0 || spaceDown || e.pointerType === 'touch') return;
    const grip = e.target.closest && e.target.closest('[data-le]');
    const bedEl = e.target.closest && e.target.closest('#mapBeds [data-bed]'), label = e.target.closest && e.target.closest('.garden-label, .plate');
    let start = null;
    if (grip) start = grip.dataset.le === 'turn' ? beginTurn(e) : beginStretch(e, grip.dataset.le);
    else if (S.tool === 'block') start = beginBlock(e);
    else if (S.tool === 'tape') start = { kind: 'tape', a: world(e) };
    else if (bedEl) {
      const id = bedEl.dataset.bed;
      if (e.shiftKey) { pick([id], { add: true, toggle: true }); start = { kind: 'none' }; }
      else { if (!S.picked.includes(id)) pick([id]); else if (S.picked[0] !== id) { S.picked = [id, ...S.picked.filter(x => x !== id)]; } start = beginMove(e); }
    } else if (label) {
      const gardenId = label.dataset.garden, all = inGarden(gardenId).map(b => b.id), whole = all.length && all.every(id => S.picked.includes(id));
      if (e.shiftKey) { pickGarden(gardenId, { add: true }); start = { kind: 'none' }; }
      else if (whole || label.classList.contains('garden-label')) { if (!whole) pickGarden(gardenId); start = beginMove(e); }
      else start = { kind: 'press', gardenId };   // open ground inside a garden: a click picks the garden, a drag still moves the map
    } else if (e.shiftKey) start = { kind: 'box', a: [e.clientX, e.clientY] };
    if (!start) return;                            // open ground: the map pans, and a click there is told to tapped()
    if (start.kind === 'press') { S.press = { ...start, x: e.clientX, y: e.clientY }; return; }
    e.stopImmediatePropagation(); e.preventDefault();
    settleNudge();
    S.drag = { ...start, x: e.clientX, y: e.clientY, live: false };
    root.addEventListener('pointermove', move, true);
    root.addEventListener('pointerup', up, true);
    root.addEventListener('pointercancel', cancel, true);
  }
  function move(e) {
    const d = S.drag;
    if (!d) return;
    if (!d.live && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.live = true;
    e.preventDefault();
    if (d.kind === 'move') dragMove(e);
    else if (d.kind === 'turn') dragTurn(e);
    else if (d.kind === 'stretch') dragStretch(e);
    else if (d.kind === 'box') { d.b = [e.clientX, e.clientY]; paint(); }
    else if (d.kind === 'block') dragBlock(e);
    else if (d.kind === 'tape') { S.tape = { a: d.a, b: world(e) }; paint(); say(e, [h('strong', feetBetween(S.tape))]); }
  }
  function dropDrag() {
    root.removeEventListener('pointermove', move, true);
    root.removeEventListener('pointerup', up, true);
    root.removeEventListener('pointercancel', cancel, true);
    const d = S.drag; S.drag = null;
    hush();
    document.body.classList.remove('le-dragging');
    return d;
  }
  function cancel() {
    const d = dropDrag();
    if (!d) return;
    if (d.kind === 'block') S.draft = null;
    if (d.kind === 'tape') S.tape = null;
    restore(); refresh();
  }
  /** Put every space back where the plan has it: a drag only ever moves the drawing. */
  function restore() { for (const id of M.spaces()) { const el = M.element(id), x = M.shapeOf(id); if (el && x) el.setAttribute('transform', `translate(${x.x} ${x.y}) rotate(${x.rot})`); } }
  function show(after) { for (const [id, x] of after) { const el = M.element(id); if (el) el.setAttribute('transform', `translate(${x.x} ${x.y}) rotate(${x.rot})`); } }
  function up(e) {
    const d = dropDrag();
    if (!d || !d.live) { refresh(); return; }
    if (d.kind === 'move') endMove(d, e);
    else if (d.kind === 'turn') endShape(d, `Turn ${describe(d.ids)}`);
    else if (d.kind === 'stretch') endStretch(d);
    else if (d.kind === 'box') endBox(d, e);
    else if (d.kind === 'block') { if (S.draft && Math.min(S.draft.block.W, S.draft.block.L) * M.feetPerPx() < 2) S.draft = null; refresh(); if (S.draft) { const el = $('leName'); if (el) { el.focus(); el.select(); } } }
    else if (d.kind === 'tape') { if (!S.tape || Math.hypot(S.tape.a[0] - S.tape.b[0], S.tape.a[1] - S.tape.b[1]) * M.zoom() < 6) S.tape = null; refresh(); if (S.tape) { const el = $('leReal'); if (el) el.focus(); } }
  }
  /** A click on open ground, passed on by the map. */
  function tapped(e) {
    if (!S.on) return;
    const press = S.press; S.press = null;
    if (S.tool) return;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) { pickGarden(press.gardenId); return; }
    // beds are thin targets: a click just beside one still picks it
    const id = M.nearest(e.clientX, e.clientY, 8);
    if (id) pick([id], { add: e.shiftKey, toggle: e.shiftKey }); else if (S.picked.length && !e.shiftKey) pick([]);
  }

  // ── moving ──
  function beginMove(e) {
    const ids = [...S.picked], before = new Map(shapes(ids).map(x => [x.id, x]));
    return before.size ? { kind: 'move', ids, before, at: world(e), frame: Geo.upright(before.get(ids[0]).rot), after: null, bad: null } : null;
  }
  /** What a moving box could line up with: spaces on the same lines, near enough to matter. */
  function nearby(box, frame, moving) {
    const far = 80 / M.feetPerPx();
    return drawn().filter(x => !moving.has(x.id) && (x.round || Geo.offAxis(x.rot, frame) < 2)).map(x => Geo.box(x, frame))
      .filter(b => b.u1 > box.u0 - far && b.u0 < box.u1 + far && b.v1 > box.v0 - far && b.v0 < box.v1 + far);
  }
  function settleBox(box, frame, moving, edges) {
    const still = nearby(box, frame, moving), most = 30 / M.feetPerPx();
    return Geo.snap(box, still, 7 / M.zoom(), { u: Geo.pathsOf(still, 'u', most), v: Geo.pathsOf(still, 'v', most) }, edges);
  }
  function dragMove(e) {
    const d = S.drag, [wx, wy] = world(e);
    let dx = wx - d.at[0], dy = wy - d.at[1];
    const shifted = (ax, ay) => new Map([...d.before].map(([id, x]) => [id, { ...x, x: x.x + ax, y: x.y + ay }]));
    d.lines = [];
    if (!e.ctrlKey && !e.metaKey) {
      const found = settleBox(Geo.boxAll([...shifted(dx, dy).values()], d.frame), d.frame, new Set(d.ids));
      const [sx, sy] = Geo.outOf(d.frame, found.du, found.dv);
      dx += sx; dy += sy; d.lines = found.lines;
    }
    d.after = shifted(dx, dy); d.copy = e.altKey;
    d.bad = clash(d.after);
    document.body.classList.add('le-dragging');
    show(d.copy ? d.before : d.after);
    paint();
    const k = pxPerFt(bedOf(d.ids[0])), ft = Math.hypot(dx, dy) / k, path = d.lines.find(l => l.kind === 'path');
    say(e, d.bad ? [h('strong.bad', clashText(d.bad)), h('small', 'It will go back where it was')] : [h('strong', `${d.copy ? 'Copy' : 'Move'} ${num(ft, 1)} ft`), h('small', path ? `${num(path.gap / k, 1)} ft path, as its neighbours keep` : d.lines.length ? 'Lined up' : e.ctrlKey ? 'Free' : 'Ctrl moves freely · Alt copies')]);
  }
  function endMove(d, e) {
    restore();
    if (!d.after) { refresh(); return; }
    if (d.bad) { toast(`${clashText(d.bad)}: it stays where it was. Spaces cannot lie on top of each other.`); refresh(); return; }
    const done = d.copy ? copyTo(d.ids, d.after) : change(`Move ${describe(d.ids)}`, new Map([...d.after].map(([id, x]) => [id, { x: x.x, y: x.y, rot: x.rot }])));
    if (!done) refresh();
  }

  // ── turning ──
  function middle(list, frame) { const b = Geo.boxAll(list, frame); return Geo.outOf(frame, b.u, b.v); }
  function beginTurn(e) {
    const ids = [...S.picked], before = new Map(shapes(ids).map(x => [x.id, x]));
    if (!before.size) return null;
    const frame = Geo.upright(before.get(ids[0]).rot), [cx, cy] = middle([...before.values()], frame), [wx, wy] = world(e);
    return { kind: 'turn', ids, before, cx, cy, from: Math.atan2(wy - cy, wx - cx) * 180 / Math.PI, after: null, bad: null };
  }
  function dragTurn(e) {
    const d = S.drag, [wx, wy] = world(e), first = d.before.get(d.ids[0]);
    let by = Math.atan2(wy - d.cy, wx - d.cx) * 180 / Math.PI - d.from;
    const others = e.ctrlKey ? [] : drawn().filter(x => !d.before.has(x.id) && !x.round).map(x => x.rot);
    const to = e.ctrlKey ? { angle: Geo.turn(first.rot + by), snapped: false } : Geo.snapTurn(first.rot + by, [...new Set(others.map(a => Math.round(a * 10) / 10))]);
    by = to.angle - first.rot;
    d.after = new Map([...Geo.turnAbout([...d.before.values()], d.cx, d.cy, by)].map(([id, p]) => [id, { ...d.before.get(id), ...p }]));
    d.bad = clash(d.after);
    document.body.classList.add('le-dragging');
    show(d.after); paint();
    say(e, d.bad ? [h('strong.bad', clashText(d.bad))] : [h('strong', `${num(Geo.turn(to.angle), 1)}°`), h('small', to.snapped ? 'On a neighbour’s line' : 'Ctrl turns freely')]);
  }
  /** The end of a turn or any other drag that leaves spaces somewhere new. */
  function endShape(d, label) {
    restore();
    if (!d.after) { refresh(); return; }
    if (d.bad) { toast(`${clashText(d.bad)}: nothing was changed. Spaces cannot lie on top of each other.`); refresh(); return; }
    if (!change(label, new Map([...d.after].map(([id, x]) => [id, { x: x.x, y: x.y, rot: x.rot }])))) refresh();
  }

  // ── stretching one bed: its real length or width ──
  function beginStretch(e, side) {
    const id = S.picked[0], before = M.shapeOf(id), bed = bedOf(id);
    return before && bed && kindOf(bed) === 'bed' ? { kind: 'stretch', id, side, before, bed, after: null, bad: null } : null;
  }
  function dragStretch(e) {
    const d = S.drag, x = d.before, k = pxPerFt(d.bed), along = d.side[0] === 'v', sign = d.side[1] === '1' ? 1 : -1;
    const [wx, wy] = world(e), [lu, lv] = Geo.into(x.rot, wx - x.x, wy - x.y), size = along ? x.L : x.W;
    const step = e.altKey ? 0.1 : 0.5, least = along ? 1 : 0.5, most = along ? 2000 : 30;
    let ft = clamp(Math.round(((sign * (along ? lv : lu) + size / 2) / k) / step) * step, least, most), same = null;
    if (!e.ctrlKey) {
      // the same as a neighbour, when it comes close: rows are usually one length
      const mates = inGarden(d.bed.gardenId).filter(b => b.id !== d.id && kindOf(b) === 'bed').map(b => ({ b, v: +(along ? b.l : b.w) }));
      const hit = mates.filter(m => Math.abs(m.v - ft) <= (e.altKey ? 0.15 : 0.74)).sort((p, q) => Math.abs(p.v - ft) - Math.abs(q.v - ft))[0];
      if (hit) { ft = hit.v; same = hit.b; }
    }
    ft = round2(ft);
    const grown = Geo.stretch(x, d.side, ft * k - size);
    d.after = new Map([[d.id, grown]]); d.size = along ? { l: ft } : { w: ft }; d.same = same;
    d.bad = clash(d.after);
    document.body.classList.add('le-dragging');
    paint();
    const w = along ? d.bed.w : ft, l = along ? ft : d.bed.l, n = eng().plantingsIn(d.id).length;
    say(e, d.bad ? [h('strong.bad', clashText(d.bad))] : [h('strong', `${num(w, 2)} × ${num(l, 2)} ft`), h('small', `${same ? `The same as ${nameOf(same)} · ` : ''}was ${num(along ? d.bed.l : d.bed.w, 2)} ft${n ? ` · ${plural(n, 'planting')} follow${n === 1 ? 's' : ''}` : ''}`)]);
  }
  function endStretch(d) {
    if (!d.after) { refresh(); return; }
    if (d.bad) { toast(`${clashText(d.bad)}: the bed keeps its size. Spaces cannot lie on top of each other.`); refresh(); return; }
    const x = d.after.get(d.id), along = d.side[0] === 'v';
    if (!change(`Change ${describe([d.id])} ${along ? 'length' : 'width'}`, new Map([[d.id, { x: x.x, y: x.y, rot: x.rot, ...d.size }]]))) refresh();
  }

  // ── picking a box ──
  function endBox(d, e) {
    const [ax, ay] = M.toWorld(d.a[0], d.a[1]), [bx, by] = M.toWorld(e.clientX, e.clientY);
    const box = { x: (ax + bx) / 2, y: (ay + by) / 2, rot: 0, W: Math.abs(bx - ax), L: Math.abs(by - ay) };
    pick(drawn().filter(x => Geo.overlaps(box, x)).map(x => x.id), { add: true });
  }

  // ── a new garden: draw a block, beds fill it ──
  function beginBlock(e) {
    const [wx, wy] = world(e), far = 250 / M.feetPerPx();
    // new ground usually lies the way the ground beside it does: the block takes the lines of the nearest space
    const near = e.ctrlKey ? null : drawn().filter(x => !x.round).map(x => ({ x, d: Math.hypot(x.x - wx, x.y - wy) })).filter(o => o.d < far).sort((p, q) => p.d - q.d)[0];
    const frame = near ? Geo.upright(near.x.rot) : 0;
    return { kind: 'block', frame, a: Geo.into(frame, wx, wy) };
  }
  function dragBlock(e) {
    const d = S.drag, [u, v] = Geo.into(d.frame, ...world(e)), [x, y] = Geo.outOf(d.frame, (d.a[0] + u) / 2, (d.a[1] + v) / 2);
    const block = { x, y, rot: d.frame, W: Math.abs(u - d.a[0]), L: Math.abs(v - d.a[1]) };
    if (!S.draft) { const t = typical(); S.draft = { what: 'beds', name: uniqueGarden('New garden'), type: 'field', bedFt: t.bedFt, pathFt: t.pathFt, runs: 'long', ct: ((plan().containers || [])[0] || {}).id || '' }; }
    S.draft.block = block;
    paint();
    const made = drafted();
    say(e, [h('strong', made.text), h('small', `${num(block.W * M.feetPerPx(), 0)} × ${num(block.L * M.feetPerPx(), 0)} ft of ground`)]);
  }
  /** What the block drawn would become: the spaces, in words, and whether it lies on something. */
  function drafted() {
    const D = S.draft, k = 1 / M.feetPerPx(), out = { beds: [], shapes: [], text: '', on: null };
    if (!D || !D.block) return out;
    if (D.what === 'pots') {
      const type = (plan().containers || []).find(c => c.id === D.ct), [cw, cl] = type ? eng().ctDims(type) : [1, 1];
      const columns = Math.floor(D.block.W / k / cw + 1e-9), rows = Math.floor(D.block.L / k / cl + 1e-9), count = Math.min(2000, columns * rows);
      if (type && count > 0) {
        out.beds.push({ kind: 'pots', x: D.block.x, y: D.block.y, rot: D.block.rot, count, columns });
        out.shapes.push({ id: 'new0', x: D.block.x, y: D.block.y, rot: D.block.rot, W: columns * cw * k, L: Math.ceil(count / columns) * cl * k });
      }
      out.text = type && count > 0 ? `${plural(count, 'container')} · ${num(columns)} side by side · ${plural(rows, 'row')}` : 'Too small for one container';
    } else {
      out.beds = Geo.fillBlock(D.block, { bedFt: +D.bedFt, pathFt: +D.pathFt, pxPerFt: k, runs: D.runs });
      out.shapes = out.beds.map((b, i) => ({ id: 'new' + i, x: b.x, y: b.y, rot: b.rot, W: b.w * k, L: b.l * k }));
      const b = out.beds[0];
      out.text = b ? `${plural(out.beds.length, 'bed')} · ${num(b.w, 2)} × ${num(b.l, 1)} ft · ${num(+D.pathFt, 1)} ft paths` : 'Too small for one bed';
    }
    const still = drawn(), slack = 0.15 * k, hit = out.shapes.map(x => still.find(o => Geo.overlaps(x, o, slack))).find(Boolean);
    if (hit) { const b = bedOf(hit.id); out.on = b ? gardenOf(b).name : 'another space'; }
    return out;
  }
  function createGarden() {
    const D = S.draft, made = drafted();
    if (!D || !made.beds.length || made.on) return;
    const name = uniqueGarden(String(D.name || '').trim() || 'New garden'), type = Lib.gardenTypes[D.type] ? D.type : 'field';
    const garden = { id: App.uid(), name, type, active: true, order: nextOrder(), ...Lib.gardenTypes[type], notes: '' };
    const beds = made.beds.map((b, i) => b.kind === 'pots'
      ? { id: App.uid(), bed: '1', gardenId: garden.id, type: 'CT', orient: orient(b.rot), note: '', active: true, ct: D.ct, count: b.count, w: 0, l: 0, potLayout: { columns: b.columns, gapFt: 0 }, px: spot(b.x, b.y, b.rot) }
      : { id: App.uid(), bed: String(i + 1), gardenId: garden.id, type: 'IG', orient: orient(b.rot), w: b.w, l: b.l, note: '', active: true, px: spot(b.x, b.y, b.rot) });
    if (!App.commit(`New garden: ${name}`, [{ kind: 'garden', before: null, after: garden }, ...beds.map(after => ({ kind: 'bed', before: null, after }))])) return;
    S.tool = null; S.draft = null;
    pick(beds.map(b => b.id));
    undoable(`${name} made: ${made.text}. It is picked: drag it, or turn it with the round handle.`);
  }

  // ── measuring, and the photo's scale ──
  const feetBetween = t => `${num(Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]) * M.feetPerPx(), 1)} ft`;
  function setScale(feet) {
    const now = M.feetPerPx(), next = S.tape && Geo.scaleFrom(S.tape.a, S.tape.b, +feet);
    if (!next || !(next > 0.001 && next < 100)) { toast('Type the real distance in feet, more than nothing.'); return; }
    const before = plan().map || {}, share = now / next;
    if (!App.commit('Set the photo’s scale', [{ kind: 'map', before, after: { ...before, ftPerPx: next } }])) return;
    undoable(`The photo’s scale is set: that line is ${num(+feet, 1)} ft. Every space is drawn ${share >= 1 ? `${num((share - 1) * 100, 1)}% larger` : `${num((1 - share) * 100, 1)}% smaller`}; middles stay where they were on the photo.`);
  }

  // ── nudging with the arrow keys ──
  // Arrow presses move the drawing at once and become one step when the keys rest, so a run of presses is one Undo.
  function nudge(dx, dy) {
    if (!S.picked.length) return;
    const n = S.nudge || (S.nudge = { ids: [...S.picked], before: new Map(shapes(S.picked).map(x => [x.id, x])), dx: 0, dy: 0, timer: 0 });
    n.dx += dx; n.dy += dy;
    n.after = new Map([...n.before].map(([id, x]) => [id, { ...x, x: x.x + n.dx, y: x.y + n.dy }]));
    show(n.after); paint();
    clearTimeout(n.timer); n.timer = setTimeout(settleNudge, 650);
  }
  function settleNudge() {
    const n = S.nudge;
    if (!n) return;
    clearTimeout(n.timer); S.nudge = null;
    restore();
    const bad = clash(n.after);
    if (bad) { toast(`${clashText(bad)}: it stays where it was.`); refresh(); return; }
    if (!change(`Nudge ${describe(n.ids)}`, new Map([...n.after].map(([id, x]) => [id, { x: x.x, y: x.y, rot: x.rot }])))) refresh();
  }

  // ── tidying what is picked ──
  const frameNow = () => { const first = M.shapeOf(S.picked[0]); return first ? Geo.upright(first.rot) : 0; };
  function tidy(label, moves, together) {
    const after = new Map();
    for (const [id, p] of moves) { const x = M.shapeOf(id); if (x) after.set(id, { ...x, ...p }); }
    const bad = clash(after, together === true);
    if (bad) { toast(`${clashText(bad)}: nothing was changed.`); return false; }
    return change(label, new Map([...after].map(([id, x]) => [id, { x: x.x, y: x.y, rot: x.rot }])));
  }
  const lineUp = where => tidy(`Line up ${describe(S.picked)}`, Geo.align(shapes(S.picked), where, frameNow()));
  function spaceOut(axis, pathFt) {
    const first = bedOf(S.picked[0]), k = first ? pxPerFt(first) : 1;
    const { moves } = Geo.spread(shapes(S.picked), axis, pathFt == null ? null : pathFt * k, frameNow());
    return tidy(`Space ${describe(S.picked)} ${pathFt == null ? 'evenly' : `${num(pathFt, 2)} ft apart`}`, moves);
  }
  function inRows({ columns, pathFt, endFt }) {
    const first = bedOf(S.picked[0]), k = first ? pxPerFt(first) : 1, list = ordered(S.picked);
    return tidy(`Set ${describe(S.picked)} out in rows`, Geo.arrange(shapes(list), { columns, path: pathFt * k, endGap: endFt * k }, frameNow()));
  }
  /** Picked spaces in the order they are numbered, or as they read where they are not. */
  function ordered(ids) {
    const beds = ids.map(bedOf).filter(Boolean);
    return beds.every(b => /^\d+$/.test(String(b.bed).trim())) && new Set(beds.map(b => b.gardenId)).size === 1 ? [...beds].sort((a, b) => +a.bed - +b.bed).map(b => b.id) : Geo.reading(shapes(ids), frameNow()).map(x => x.id);
  }
  function numberInOrder() {
    const list = Geo.reading(shapes(S.picked), frameNow()), changes = new Map();
    list.forEach((x, i) => changes.set(x.id, { bed: String(i + 1) }));
    if (change(`Number ${describe(S.picked)} in order`, changes)) undoable(`Numbered 1 to ${list.length}, as they read on the map. Plantings stay with their beds.`);
  }
  function turnTo(angle) {
    const first = M.shapeOf(S.picked[0]);
    if (!first || !Number.isFinite(angle)) return;
    const list = shapes(S.picked), [cx, cy] = middle(list, Geo.upright(first.rot));
    tidy(`Turn ${describe(S.picked)}`, Geo.turnAbout(list, cx, cy, angle - first.rot), true);
  }
  /** Sizes typed in the panel: real feet, for every bed picked. */
  function resize(field, value) {
    const beds = S.picked.map(bedOf).filter(b => b && kindOf(b) === 'bed'), least = field === 'w' ? 0.5 : 1, most = field === 'w' ? 30 : 2000;
    if (!beds.length || !(value >= least && value <= most)) { toast(`A bed’s ${field === 'w' ? 'width is between half a foot and 30 ft' : 'length is between 1 and 2,000 ft'}.`); refresh(); return; }
    const after = new Map(), changes = new Map();
    for (const b of beds) { const x = M.shapeOf(b.id), k = pxPerFt(b); if (x) { after.set(b.id, { ...x, [field === 'w' ? 'W' : 'L']: value * k }); changes.set(b.id, { [field]: value }); } }
    const bad = clash(after, false);
    if (bad) { toast(`${clashText(bad)} at that size: nothing was changed.`); refresh(); return; }
    if (!change(`Change ${describe(beds.map(b => b.id))} ${field === 'w' ? 'width' : 'length'}`, changes)) refresh();
  }
  /** How large a garden is drawn against its real size: the way a whole garden is matched to the photo. */
  function drawAt(garden, percent) {
    const k = percent / 100, was = scaleOf(garden);
    if (!(k >= 0.5 && k <= 2)) { toast('Between 50% and 200% of true size.'); refresh(); return; }
    const own = shapes(inGarden(garden.id).map(b => b.id)), [cx, cy] = middle(own, Geo.frameOf(own)), moves = Geo.scaleAbout(own, cx, cy, k / was), after = new Map();
    for (const x of own) after.set(x.id, { ...x, ...moves.get(x.id), W: x.W * k / was, L: x.L * k / was });
    const bad = clash(after);
    if (bad) { toast(`${clashText(bad)} at that size: nothing was changed.`); refresh(); return; }
    const next = { ...garden }; if (Math.abs(k - 1) < 1e-9) delete next.mapScale; else next.mapScale = k;
    if (!change(`Draw ${garden.name} at ${num(percent, 1)}%`, new Map([...moves].map(([id, p]) => [id, p])), [{ kind: 'garden', before: garden, after: next }])) refresh();
  }
  function renameGarden(garden, name) {
    const text = String(name || '').trim();
    if (!text || text === garden.name) { refresh(); return; }
    if (plan().gardens.some(g => g.id !== garden.id && g.name === text)) { toast(`Another garden is already called ${text}.`); refresh(); return; }
    App.commit(`Rename ${garden.name} to ${text}`, [{ kind: 'garden', before: garden, after: { ...garden, name: text } }]);
  }
  function renameBed(bed, name) {
    const text = String(name || '').trim();
    if (!text || text === String(bed.bed)) { refresh(); return; }
    if (plan().beds.some(b => b.id !== bed.id && b.gardenId === bed.gardenId && String(b.bed) === text)) { toast(`${gardenOf(bed).name} already has a ${text}.`); refresh(); return; }
    change(`Rename ${describe([bed.id])}`, new Map([[bed.id, { bed: text }]]));
  }
  /** Pots and crates: how many, of what kind, how many side by side, how far apart. */
  function setGroup(bed, patch) {
    const layout = { ...(bed.potLayout || {}) }, next = {};
    if (patch.count !== undefined) { if (!(patch.count >= 1 && patch.count <= 5000)) { toast('Between 1 and 5,000 containers.'); refresh(); return; } next.count = Math.round(patch.count); }
    if (patch.ct !== undefined) next.ct = patch.ct;
    if (patch.columns !== undefined) { if (!(patch.columns >= 1)) { refresh(); return; } layout.columns = Math.round(patch.columns); next.potLayout = layout; }
    if (patch.gapFt !== undefined) { if (!(patch.gapFt >= 0 && patch.gapFt <= 100)) { refresh(); return; } layout.gapFt = +patch.gapFt; next.potLayout = layout; }
    // what the group would then cover on the map, to keep it off its neighbours
    const type = (plan().containers || []).find(c => c.id === (next.ct || bed.ct)) || eng().ctOf(bed), [cw, cl] = eng().ctDims(type), count = next.count || Math.max(1, Math.floor(+bed.count || 1));
    const cols = Number.isInteger(layout.columns) && layout.columns > 0 ? Math.min(count, layout.columns) : Math.ceil(Math.sqrt(count)), gap = +layout.gapFt || 0, k = pxPerFt(bed), x = M.shapeOf(bed.id);
    const bad = x && clash(new Map([[bed.id, { ...x, W: (cols * cw + (cols - 1) * gap) * k, L: (Math.ceil(count / cols) * cl + (Math.ceil(count / cols) - 1) * gap) * k }]]));
    if (bad) { toast(`${clashText(bad)} set out that way: nothing was changed.`); refresh(); return; }
    if (!change(`Set out ${describe([bed.id])}`, new Map([[bed.id, next]]))) refresh();
  }

  // ── keys ──
  function key(e) {
    if (e.code === 'Space') spaceDown = e.type === 'keydown';
    if (e.type !== 'keydown' || !S.on || App.state.view !== 'map' || document.querySelector('dialog[open]')) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '');
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'Escape') {
      stop();
      if (S.drag) cancel();
      else if (S.tool || S.draft || S.tape) { if (typing) e.target.blur(); S.tool = null; S.draft = null; S.tape = null; refresh(); }   // a form half filled in is left without doing anything
      else if (typing) e.target.blur();
      else if (S.picked.length) pick([]);
      else close();
      return;
    }
    if (typing) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrows) {
      stop();   // while the layout is being edited the arrows move ground, not the planning date
      const ft = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
      nudge(arrows[0] * ft / M.feetPerPx(), arrows[1] * ft / M.feetPerPx());
      return;
    }
    settleNudge();
    const mod = e.ctrlKey || e.metaKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.picked.length) { stop(); remove(); }
    else if (mod && e.key.toLowerCase() === 'd' && S.picked.length) { stop(); duplicate(); }
    else if (mod && e.key.toLowerCase() === 'a') { stop(); const gardens = new Set(S.picked.map(id => (bedOf(id) || {}).gardenId)); pick(M.spaces().filter(id => !gardens.size || gardens.has(bedOf(id).gardenId))); }
  }
  /** A copy beside what is picked: one step along the row for a bed, clear of the garden for a whole garden. */
  function duplicate() {
    const list = shapes(S.picked);
    if (!list.length) return;
    const frame = Geo.upright(list[0].rot), box = Geo.boxAll(list, frame), first = bedOf(S.picked[0]), gap = typical().pathFt * pxPerFt(first);
    const tries = [[box.u1 - box.u0 + gap, 0], [0, box.v1 - box.v0 + gap], [-(box.u1 - box.u0 + gap), 0], [0, -(box.v1 - box.v0 + gap)]];
    for (const [du, dv] of tries) {
      const [dx, dy] = Geo.outOf(frame, du, dv), at = new Map(list.map(x => [x.id, { ...x, id: 'copy-' + x.id, x: x.x + dx, y: x.y + dy }]));
      if ([...at.values()].some(x => drawn().some(o => Geo.overlaps(x, o, 0.15 / M.feetPerPx())))) continue;
      if (copyTo(S.picked, new Map([...at].map(([id, x]) => [id, { x: x.x, y: x.y, rot: x.rot }])))) undoable(`Copied beside the original. Drag the copy where it belongs.`);
      return;
    }
    toast('No open ground beside it for a copy. Alt-drag it to where the copy should go.');
  }

  // ── what is drawn over the map ──
  const P = (x, y) => M.toScreen(x, y);
  const outline = (x, cls) => {
    if (x.round) { const [cx, cy] = P(x.x, x.y); return s('circle.' + cls, { cx, cy, r: x.W / 2 * M.zoom() }); }
    return s('polygon.' + cls, { points: Geo.corners(x).map(([px, py]) => P(px, py).join(',')).join(' ') });
  };
  const word = (text, x, y, cls = 'le-word') => s('text.' + cls, { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text);
  function paint() {
    if (!layer) return;
    clear(layer); clear(ghosts);
    if (!S.on) return;
    const z = M.zoom(), d = S.drag, live = (d && d.live && d.after) || (S.nudge && S.nudge.after) || null;
    const now = id => (live && live.get(id)) || M.shapeOf(id), list = S.picked.map(now).filter(Boolean);
    const bad = d && d.bad ? d.bad.id : null;
    // a copy in the air leaves the original where it is
    if (d && d.live && d.kind === 'move' && d.copy) for (const x of d.before.values()) layer.append(outline(x, 'le-from'));
    for (const x of list) layer.append(outline(x, 'le-pick' + (bad ? '.bad' : '')));
    if (list.length) {
      const first = list[0], frame = Geo.upright(first.rot), box = Geo.boxAll(list, frame), corner = (u, v) => P(...Geo.outOf(frame, u, v));
      if (list.length > 1) layer.append(s('polygon.le-box', { points: [corner(box.u0, box.v0), corner(box.u1, box.v0), corner(box.u1, box.v1), corner(box.u0, box.v1)].map(p => p.join(',')).join(' ') }));
      const busy = d && d.live;
      // one bed: an end or a side to drag
      const bed = list.length === 1 ? bedOf(first.id) : null;
      if (bed && kindOf(bed) === 'bed' && !S.nudge && (!busy || d.kind === 'stretch') && first.L * z >= 30) {
        for (const [side, lu, lv] of [['v0', 0, -1], ['v1', 0, 1], ['u0', -1, 0], ['u1', 1, 0]]) {
          if (lu && first.L * z < 46) continue;
          const [wx, wy] = Geo.outOf(first.rot, lu * first.W / 2, lv * first.L / 2), [x, y] = P(first.x + wx, first.y + wy), long = clamp((lu ? first.L : first.W) * z * 0.6, 12, 30);
          layer.append(s('rect.le-grip', { x: -long / 2, y: -3.5, width: long, height: 7, rx: 3.5, transform: `translate(${x} ${y}) rotate(${first.rot + (lu ? 90 : 0)})`, 'data-le': side, style: { cursor: cursorFor(first.rot + (lu ? 0 : 90)) } },
            s('title', lu ? 'Drag to change the width' : 'Drag to change the length')));
        }
      }
      // the round handle, off the corner that reads as top right: clear of the garden's name, which sits over the middle
      if (!S.nudge && (!busy || d.kind === 'turn') && !(list.length === 1 && first.round)) {
        const [ax, ay] = corner(box.u1, box.v0), [bx, by] = corner(box.u, box.v), len = Math.hypot(ax - bx, ay - by) || 1, ux = (ax - bx) / len, uy = (ay - by) / len;
        layer.append(s('line.le-stem', { x1: ax, y1: ay, x2: ax + ux * 20, y2: ay + uy * 20 }), s('circle.le-turn', { cx: ax + ux * 20, cy: ay + uy * 20, r: 6.5, 'data-le': 'turn' }, s('title', 'Drag to turn')));
      }
      // what it measures, under it and clear of the beds' own numbers
      const [fx, fy] = corner(box.u, box.v1), [mx, my] = corner(box.u, box.v), len = Math.hypot(fx - mx, fy - my) || 1;
      const text = d && d.live && d.kind === 'stretch' && d.size ? `${num(d.size.w ?? bed.w, 2)} × ${num(d.size.l ?? bed.l, 2)} ft` : bed ? sizeText(bed) : plural(list.length, 'space');
      if (!(d && d.live && d.kind === 'stretch')) layer.append(word(text, fx + (fx - mx) / len * 27, fy + (fy - my) / len * 27));   // while an end is dragged the card by the pointer says it
    }
    // guide lines: what a drag has lined up with
    if (d && d.live && d.lines && !d.bad) {
      const k = pxPerFt(bedOf(d.ids[0])), mv = Geo.boxAll([...d.after.values()], d.frame);
      for (const line of d.lines) {
        const at = (a, b) => P(...(line.axis === 'u' ? Geo.outOf(d.frame, a, b) : Geo.outOf(d.frame, b, a)));
        const [x1, y1] = at(line.at, line.lo), [x2, y2] = at(line.at, line.hi);
        layer.append(s('line.le-guide', { x1, y1, x2, y2 }));
        if (line.kind !== 'path') continue;
        const mid = line.axis === 'u' ? mv.v : mv.u, [px, py] = at(line.from, mid), [qx, qy] = at(line.at, mid);
        layer.append(s('line.le-gap', { x1: px, y1: py, x2: qx, y2: qy }), word(`${num(line.gap / k, 1)} ft`, (px + qx) / 2, (py + qy) / 2 - 9, 'le-word.small'));
      }
    }
    if (d && d.live && d.kind === 'box' && d.b) {
      const rect = $('map').getBoundingClientRect(), x = Math.min(d.a[0], d.b[0]) - rect.left, y = Math.min(d.a[1], d.b[1]) - rect.top;
      layer.append(s('rect.le-lasso', { x, y, width: Math.abs(d.b[0] - d.a[0]), height: Math.abs(d.b[1] - d.a[1]) }));
    }
    // a garden drawn and not yet made
    if (S.draft && S.draft.block) {
      const made = drafted(), b = S.draft.block;
      ghosts.append(s('rect.le-block' + (made.on ? '.bad' : ''), { x: -b.W / 2, y: -b.L / 2, width: b.W, height: b.L, transform: `translate(${b.x} ${b.y}) rotate(${b.rot})` }));
      for (const x of made.shapes) ghosts.append(s('rect.le-new' + (made.on ? '.bad' : ''), { x: -x.W / 2, y: -x.L / 2, width: x.W, height: x.L, rx: Math.min(x.W, x.L) * 0.1, transform: `translate(${x.x} ${x.y}) rotate(${x.rot})` }));
    }
    // a measured line
    if (S.tape) {
      const [x1, y1] = P(...S.tape.a), [x2, y2] = P(...S.tape.b), len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len * 6, ny = (x2 - x1) / len * 6;
      layer.append(s('line.le-tape.under', { x1, y1, x2, y2 }), s('line.le-tape', { x1, y1, x2, y2 }),
        s('line.le-tape', { x1: x1 - nx, y1: y1 - ny, x2: x1 + nx, y2: y1 + ny }), s('line.le-tape', { x1: x2 - nx, y1: y2 - ny, x2: x2 + nx, y2: y2 + ny }),
        word(feetBetween(S.tape), (x1 + x2) / 2 + nx * 2.4, (y1 + y2) / 2 + ny * 2.4));
    }
  }
  const cursorFor = angle => ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round((((angle % 180) + 180) % 180) / 45) % 4];
  /** The small card that follows the pointer during a drag. */
  function say(e, nodes) {
    clear(read).append(...nodes); read.hidden = false;
    const host = $('mapView').getBoundingClientRect(), w = read.offsetWidth, hgt = read.offsetHeight;
    read.style.left = clamp(e.clientX - host.left + 16, 8, host.width - w - 8) + 'px';
    read.style.top = clamp(e.clientY - host.top + 18, 8, host.height - hgt - 8) + 'px';
  }
  const hush = () => { if (read) read.hidden = true; };

  // ── the panel on the right ──
  const field = (label, control, help) => h('label.field', h('span', label), control, help ? h('small', help) : null);
  const stat = (label, value, id) => h('div.stat', id ? { id } : {}, h('span', label), h('b', value));
  const number = (id, value, onset, attrs = {}) => h('input', { type: 'number', id, value: value == null ? '' : value, step: 0.5, ...attrs, onchange: e => { const n = +e.target.value; if (e.target.value === '' || !Number.isFinite(n)) refresh(); else onset(n); } });
  const act = (id, title, small, run, cls = '') => h('button.fix-btn' + cls, { type: 'button', id, onclick: run }, h('b', title), small ? h('small', small) : null);
  const head = (eyebrow, title, onClose, closeLabel) => h('header.insp-head', h('p.eyebrow', eyebrow), h('h2', title), h('button.icon-btn.close', { type: 'button', id: 'leClose', 'aria-label': closeLabel, title: closeLabel, onclick: onClose }, '×'));
  /** Six small pictures for lining up: three bars against a line. */
  function glyph(where) {
    const along = where[0] === 'v', at = where.length === 1 ? 9 : where[1] === '0' ? 2 : 16, bars = [[4, 10], [8, 6], [12, 13]];
    const g = s('svg.le-glyph', { viewBox: '0 0 18 18', width: 18, height: 18, 'aria-hidden': 'true' });
    g.append(along ? s('line', { x1: 1, y1: at, x2: 17, y2: at }) : s('line', { x1: at, y1: 1, x2: at, y2: 17 }));
    bars.forEach(([pos, len], i) => {
      const from = where.length === 1 ? at - len / 2 : where[1] === '0' ? at + 1 : at - 1 - len;
      g.append(along ? s('rect', { x: 2.5 + i * 5, y: from, width: 3, height: len, rx: 1 }) : s('rect', { x: from, y: 2.5 + i * 5, width: len, height: 3, rx: 1 }));
    });
    return g;
  }
  function renderPanel() {
    if (!panel) return;
    const focused = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.id : '', keep = panel.scrollTop;
    clear(panel);
    if (!S.on) return;
    if (S.draft && S.draft.block) panelDraft();
    else if (S.tool === 'block') panel.append(head('New ground', 'New garden', () => setTool('block'), 'Stop'), h('section.insp-section', h('p.note', 'Drag a block on the map where the garden goes. Beds fill it as you drag; it takes the lines of the ground beside it.'), h('p.help', 'Hold Ctrl to draw it square to the photo. Escape stops.')));
    else if (S.tool === 'tape') panelTape();
    else if (!S.picked.length) panelFarm();
    else panelPicked();
    panel.scrollTop = keep;
    const again = focused && $(focused);
    if (again && again !== document.activeElement) again.focus();
  }
  function panelFarm() {
    const beds = M.spaces().map(bedOf).filter(Boolean), ground = beds.filter(b => kindOf(b) === 'bed').reduce((n, b) => n + (+b.w || 0) * (+b.l || 0), 0), gardens = new Set(beds.map(b => b.gardenId)).size;
    panel.append(head('Editing the layout', 'The farm’s ground', close, 'Done editing'),
      h('div.stats', stat('Gardens', num(gardens), 'leGardens'), stat('Growing spaces', num(beds.length), 'leSpaces'), stat('Beds (sq ft)', num(ground), 'leGround')),
      h('section.insp-section', h('h3', 'How it works'),
        h('dl.le-keys',
          h('dt', 'Click'), h('dd', 'a bed to pick it; a garden’s name for all of it'),
          h('dt', 'Shift'), h('dd', 'click to pick more; drag to pick a box'),
          h('dt', 'Drag'), h('dd', 'what is picked to move it. It lines up with its neighbours and keeps their path'),
          h('dt', 'Handles'), h('dd', 'an end or a side changes the real size; the round one turns'),
          h('dt', 'Arrows'), h('dd', 'nudge half a foot (Shift 5 ft, Alt a tenth)'),
          h('dt', 'Alt'), h('dd', 'drag to leave it and move a copy'),
          h('dt', 'Ctrl'), h('dd', 'drag freely, with no lining up')),
        h('p.help', 'Plantings stay with their beds. Every change is one Undo (Ctrl+Z).')),
      h('section.insp-section', h('h3', 'The photo'), h('p.note', { id: 'leScaleNow' }, `One pixel of the photo is ${num(M.feetPerPx(), 3)} ft.`),
        h('button.linkish', { type: 'button', id: 'leTapeLink', onclick: () => setTool('tape') }, 'Measure a distance, or set the scale…')));
  }
  function panelPicked() {
    const beds = S.picked.map(bedOf).filter(Boolean), first = beds[0], garden = wholeGarden(), soil = beds.filter(b => kindOf(b) === 'bed'), one = beds.length === 1 ? first : null;
    const gardens = [...new Set(beds.map(b => gardenOf(b).name))], label = Lib.gardenTypeLabels || {};
    const plantings = beds.reduce((n, b) => n + eng().plantingsIn(b.id).length, 0), x = M.shapeOf(first.id);
    panel.append(head(one ? `${gardenOf(one).name || 'Garden'} · ${label[gardenOf(one).type] || ''}` : garden ? `${label[garden.type] || 'Garden'} · ${plural(beds.length, 'space')}` : gardens.length === 1 ? gardens[0] : plural(gardens.length, 'garden'),
      one ? nameOf(one) : garden ? garden.name : plural(beds.length, 'space'), () => pick([]), 'Let go of what is picked'));
    // what it measures, to be read at a glance
    const same = key => soil.length && soil.every(b => +b[key] === +soil[0][key]) ? soil[0][key] : null, w = same('w'), l = same('l');
    if (soil.length) panel.append(h('div.stats.dims', { id: 'leDims' }, stat('Width (ft)', w == null ? 'mixed' : num(w, 2), 'leWidth'), stat('Length (ft)', l == null ? 'mixed' : num(l, 2), 'leLength'),
      stat(soil.length > 1 ? 'Beds (sq ft)' : 'Area (sq ft)', num(soil.reduce((n, b) => n + b.w * b.l, 0)), 'leArea')));
    const form = h('section.insp-section.form', { id: 'leForm' });
    if (garden && beds.length > 1) {
      form.append(field('Garden', h('input', { type: 'text', id: 'leGarden', value: garden.name, maxLength: 60, onchange: e => renameGarden(garden, e.target.value) })));
      if (['field', 'tunnel', 'greenhouse'].includes(garden.type)) form.append(field('Kind of place', h('select', { id: 'leType', onchange: async e => { const type = e.target.value; await App.setGardenType(garden.id, type); refresh(); } },
        ['field', 'tunnel', 'greenhouse'].map(t => h('option', { value: t, selected: garden.type === t }, { field: 'Field', tunnel: 'Unheated tunnel', greenhouse: 'Heated greenhouse' }[t]))), 'Growing conditions follow the kind of place: changing it can move harvest dates, and says so first.'));
    }
    if (one) form.append(field('Name or number', h('input', { type: 'text', id: 'leBed', value: one.bed, maxLength: 40, onchange: e => renameBed(one, e.target.value) })));
    if (soil.length) form.append(h('div.field-pair',
      field('Width (ft)', number('fLayW', w, n => resize('w', n), { min: 0.5, max: 30, placeholder: 'mixed' })),
      field('Length (ft)', number('fLayL', l, n => resize('l', n), { min: 1, max: 2000, placeholder: 'mixed' }))));
    if (one && kindOf(one) === 'containers') {
      const cells = M.cellsOf(one.id) || { columns: 1 }, layout = one.potLayout || {};
      form.append(field('Kind of container', h('select', { id: 'leCt', onchange: e => setGroup(one, { ct: e.target.value }) }, (plan().containers || []).map(c => h('option', { value: c.id, selected: c.id === one.ct }, c.name)))),
        h('div.field-pair', field('How many', number('leCount', one.count, n => setGroup(one, { count: n }), { min: 1, max: 5000, step: 1 })),
          field('Side by side', number('leColumns', cells.columns, n => setGroup(one, { columns: n }), { min: 1, max: 500, step: 1 }))),
        field('Gap between them (ft)', number('leGap', +layout.gapFt || 0, n => setGroup(one, { gapFt: n }), { min: 0, max: 100, step: 0.25 })));
    }
    if (x && !x.round) form.append(field('Turned (°)', number('leTurn', round2(Geo.turn(x.rot)), n => turnTo(n), { min: 0, max: 360, step: 1 }), beds.length > 1 ? 'The whole group turns about its middle.' : 'Clockwise from the top of the photo.'));
    if (garden && beds.length > 1) form.append(field('Drawn at (% of true size)', number('leDrawn', round2(scaleOf(garden) * 100), n => drawAt(garden, n), { min: 50, max: 200, step: 0.5 }), 'For matching a whole garden to the photo. The beds’ real sizes do not change.'));
    form.append(h('p.help', { id: 'leFollow' }, plantings ? `${plural(plantings, 'planting')} this season ${plantings === 1 ? 'follows' : 'follow'} ${beds.length === 1 ? 'this space' : 'these spaces'}: moving and turning change nothing in the plan; a new size works rows and plant counts out again.` : 'Nothing is planted here this season.'));
    panel.append(form);
    if (beds.length > 1) {
      const t = typical(), k = pxPerFt(first), frame = frameNow(), boxes = shapes(S.picked).map(o => Geo.box(o, frame));
      const pathNow = Geo.pathsOf(boxes, 'u', 30 * k)[0], endNow = Geo.pathsOf(boxes, 'v', 60 * k)[0];
      // how many stand side by side now: those level with the first one
      const top = Math.min(...boxes.map(b => b.v)), tall = Math.max(...boxes.map(b => b.v1 - b.v0)), level = boxes.filter(b => b.v - top < tall / 2).length;
      const across = number('lePath', round2(pathNow ? pathNow / k : t.pathFt), () => {}, { min: 0, max: 100, step: 0.5 }), cols = number('leCols', level, () => {}, { min: 1, max: 200, step: 1 });
      const ends = number('leEnd', round2(endNow ? endNow / k : Math.max(t.pathFt, 3)), () => {}, { min: 0, max: 200, step: 0.5 });
      panel.append(h('section.insp-section', { id: 'leTidy' }, h('h3', 'Line up'),
        h('div.le-row', [['u0', 'Left sides'], ['u', 'Middles, side to side'], ['u1', 'Right sides'], ['v0', 'Top ends'], ['v', 'Middles, end to end'], ['v1', 'Bottom ends']].map(([where, title]) =>
          h('button.le-icon', { type: 'button', title, 'aria-label': title, dataset: { align: where }, onclick: () => lineUp(where) }, glyph(where)))),
        h('h3', 'Space'),
        h('div.field-pair', field('Path between (ft)', across), field('Side by side', cols)),
        field('Between rows, end to end (ft)', ends),
        h('div.fix-actions',
          act('leSpread', 'Space them this far apart', 'Side by side, each a path from the last; the first one stays', () => spaceOut('u', +across.value)),
          act('leEven', 'Even out the paths', 'The two outer ones stay; the paths between come out equal', () => spaceOut('u', null)),
          act('leRows', 'Set out in rows', 'So many side by side, then the next row', () => inRows({ columns: +cols.value, pathFt: +across.value, endFt: +ends.value })))));
    }
    const numbered = beds.length > 1 && beds.every(b => /^\d+$/.test(String(b.bed).trim())) && gardens.length === 1;
    panel.append(h('section.insp-section', { id: 'leActions' }, h('h3', one ? 'This space' : 'These spaces'), h('div.fix-actions',
      one || garden ? act('leAdd', garden && beds.length > 1 ? 'Add a bed' : 'Add the next one', 'One step past the end of the row, the same size', () => addNext(garden && beds.length > 1 ? inGarden(garden.id).filter(b => kindOf(b) === kindOf(first)).map(b => b.id) : [first.id])) : null,
      act('leCopy', garden && beds.length > 1 ? 'Copy the garden' : 'Copy', 'Set down beside it (Ctrl+D), or Alt-drag it anywhere', duplicate),
      numbered ? act('leNumber', 'Number in order', 'As they read on the map. Plantings stay with their beds.', numberInOrder) : null,
      !garden && gardens.length === 1 ? act('leWhole', 'Pick the whole garden', `All of ${gardens[0]}`, () => pickGarden(first.gardenId)) : null,
      act('leRemove', 'Remove', plantings ? 'Not while plantings stand here' : 'Off the map and out of the plan (Delete)', () => remove(), '.danger'))));
  }
  function panelDraft() {
    const D = S.draft, made = drafted(), set = patch => { Object.assign(D, patch); paint(); renderPanel(); };
    const kinds = { field: 'Field', tunnel: 'Unheated tunnel', greenhouse: 'Heated greenhouse' }, pots = (plan().containers || []);
    panel.append(head('New ground', 'New garden', () => { S.draft = null; refresh(); }, 'Leave without making it'),
      h('section.insp-section.form', { id: 'leDraft' },
        field('Name', h('input', { type: 'text', id: 'leName', value: D.name, maxLength: 60, oninput: e => { D.name = e.target.value; } })),
        field('Kind of place', h('select', { id: 'leKind', onchange: e => set({ type: e.target.value }) }, Object.entries(kinds).map(([v, text]) => h('option', { value: v, selected: D.type === v }, text)))),
        pots.length ? h('div.seg', { role: 'group', 'aria-label': 'What stands here' },
          h('button', { type: 'button', id: 'leWhatBeds', 'aria-pressed': String(D.what === 'beds'), onclick: () => set({ what: 'beds' }) }, 'Beds'),
          h('button', { type: 'button', id: 'leWhatPots', 'aria-pressed': String(D.what === 'pots'), onclick: () => set({ what: 'pots' }) }, 'Pots or crates')) : null,
        D.what === 'pots'
          ? field('Kind of container', h('select', { id: 'leNewCt', onchange: e => set({ ct: e.target.value }) }, pots.map(c => h('option', { value: c.id, selected: c.id === D.ct }, c.name))))
          : [h('div.field-pair', field('Bed width (ft)', number('leBedFt', D.bedFt, n => set({ bedFt: clamp(n, 0.5, 30) }), { min: 0.5, max: 30 })), field('Path (ft)', number('lePathFt', D.pathFt, n => set({ pathFt: clamp(n, 0, 50) }), { min: 0, max: 50 }))),
            h('div.field', h('span', 'Beds run'), h('div.seg', { role: 'group', 'aria-label': 'Which way the beds run' },
              h('button', { type: 'button', id: 'leRunLong', 'aria-pressed': String(D.runs === 'long'), onclick: () => set({ runs: 'long' }) }, 'The long way'),
              h('button', { type: 'button', id: 'leRunShort', 'aria-pressed': String(D.runs === 'short'), onclick: () => set({ runs: 'short' }) }, 'The short way')))],
        h('p.le-made' + (made.on || !made.beds.length ? '.bad' : ''), { id: 'leMade' }, made.on ? `This block lies on ${made.on}. Draw it on open ground.` : made.text),
        h('div.dialog-actions',
          h('button.btn', { type: 'button', id: 'leCancel', onclick: () => { S.draft = null; refresh(); } }, 'Cancel'),
          h('button.btn.primary', { type: 'button', id: 'leCreate', disabled: !made.beds.length || !!made.on, onclick: createGarden }, D.what === 'pots' ? 'Make the garden' : `Make ${made.beds.length ? plural(made.beds.length, 'bed') : 'the garden'}`)),
        h('p.help', 'Drag on the map again to draw the block afresh. Once made it is picked, ready to move or turn.')));
  }
  function panelTape() {
    const t = S.tape, real = h('input', { type: 'number', id: 'leReal', min: 0.1, step: 0.5, placeholder: 'feet', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); setScale(e.target.value); } } });
    panel.append(head('The photo', 'Measure', () => setTool('tape'), 'Stop measuring'),
      h('section.insp-section', t ? [h('div.stats', stat('This line', feetBetween(t), 'leMeasured'), stat('Scale', `${num(M.feetPerPx(), 3)} ft a pixel`)),
        h('p.help', 'Drag again to measure something else.')] : h('p.note', 'Drag between two points on the map. The distance is read in feet from the photo’s scale.')),
      t ? h('section.insp-section.form', { id: 'leScale' }, h('h3', 'Set the photo’s scale'),
        h('p.note', 'If you know what this line really measures (a house, a bed you have taped), type it. Every space is then drawn to that scale.'),
        field('This line is really (ft)', real),
        h('button.btn', { type: 'button', id: 'leSetScale', onclick: () => setScale(real.value) }, 'Set the scale'),
        h('p.help', 'Spaces keep their middles on the photo and change size about them. One Undo puts the scale back.')) : null);
  }

  // ── the list of gardens on the left ──
  function renderSide() {
    if (!side) return;
    clear(side);
    if (!S.on) return;
    const list = h('div.le-list', { id: 'leList' }), picked = new Set(S.picked);
    const gardens = [...plan().gardens].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
    for (const g of gardens) {
      const own = inGarden(g.id);
      if (!own.length) continue;
      const soil = own.filter(b => kindOf(b) === 'bed'), towers = own.filter(b => kindOf(b) === 'tower'), pots = own.filter(b => kindOf(b) === 'containers');
      const uniform = soil.length && soil.every(b => +b.w === +soil[0].w && +b.l === +soil[0].l);
      const what = [soil.length ? `${plural(soil.length, 'bed')}${uniform ? ` · ${num(soil[0].w, 2)} × ${num(soil[0].l, 1)} ft` : ''}` : '', towers.length ? plural(towers.length, 'tower') : '', pots.length ? plural(pots.reduce((n, b) => n + (+b.count || 0), 0), 'container') : ''].filter(Boolean).join(' · ');
      const n = own.filter(b => picked.has(b.id)).length, loose = own.some(b => !(M.shapeOf(b.id) || {}).placed);
      list.append(h('button.le-garden' + (n === own.length ? '.on' : n ? '.part' : ''), { type: 'button', dataset: { garden: g.id }, title: `Pick all of ${g.name} and bring it into view`,
        onclick: e => { pickGarden(g.id, { add: e.shiftKey }); M.fitSpaces(S.picked, true); } },
        h('b', g.name), h('small', what + (loose ? ' · not on the photo yet' : ''))));
    }
    side.append(h('header', h('h2', 'Layout'), h('p.le-lead', 'The ground itself: where each bed lies and what it measures.')),
      h('div.le-tools',
        h('button.le-tool', { type: 'button', id: 'leNew', 'aria-pressed': String(S.tool === 'block'), onclick: () => setTool('block') }, h('b', 'New garden…'), h('small', 'Drag a block on the map; beds fill it')),
        h('button.le-tool', { type: 'button', id: 'leTape', 'aria-pressed': String(S.tool === 'tape'), onclick: () => setTool('tape') }, h('b', 'Measure…'), h('small', 'A distance on the photo, and its scale'))),
      h('p.lib-meta', 'Gardens'), list,
      h('p.lib-hint', 'Click a garden to pick all of it. Shift-click adds another.'));
    // what is picked is kept in sight in the list, as it is on the map
    const on = list.querySelector('.le-garden.on, .le-garden.part');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function renderPill() {
    if (!pill) return;
    pill.hidden = !S.on;
    if (!S.on) return;
    const text = S.tool === 'block' ? (S.draft ? 'Name the new garden on the right, or drag again' : 'Drag a block where the new garden goes') : S.tool === 'tape' ? 'Drag between two points to measure' : S.picked.length ? `${describe(S.picked)} picked` : 'Click a bed, or a garden’s name';
    clear(pill).append(h('b', 'Editing the layout'), h('span', { id: 'lePillText' }, text), h('button.btn.primary', { type: 'button', id: 'leDone', onclick: close }, 'Done'));
  }
  function refresh() {
    document.body.dataset.leTool = S.tool || '';
    if (ghosts && ghosts.parentNode !== $('mapOver')) $('mapOver').append(ghosts);   // the map clears its overlays when it is drawn again
    paint(); renderPanel(); renderSide(); renderPill();
  }

  // ── start ──
  function init() {
    const svg = $('map'), tools = document.querySelector('.map-tools');
    button = h('button.tool-btn', { type: 'button', id: 'mapEditToggle', 'aria-pressed': 'false', title: 'Move, size, add and remove beds and gardens; measure; set the photo’s scale. Plantings stay with their beds.', onclick: () => (S.on ? close() : open()) }, 'Edit layout');
    tools.prepend(button);
    layer = s('g', { id: 'mapEdit' }); svg.append(layer);
    ghosts = s('g.le-ghosts'); $('mapOver').append(ghosts);
    read = h('div.tip.le-read', { hidden: true }); pill = h('div.le-pill', { id: 'lePill', hidden: true });
    $('mapView').append(read, pill);
    side = h('div', { id: 'layoutSide' }); document.querySelector('.library').append(side);
    panel = h('div.inspector-body', { id: 'layoutPanel' }); document.querySelector('.inspector').append(panel);
    svg.addEventListener('pointerdown', down, true);
    svg.addEventListener('dblclick', e => {   // a double click on a bed picks its whole garden
      const bedEl = S.on && !S.tool && e.target.closest && e.target.closest('#mapBeds [data-bed]');
      if (!bedEl) return;
      e.stopImmediatePropagation(); pickGarden(bedOf(bedEl.dataset.bed).gardenId);
    }, true);
    // which space is under the pointer, and what it measures: read before anything is picked
    svg.addEventListener('pointermove', e => {
      if (!S.on || S.drag || S.tool || e.buttons) return;
      const el = e.target.closest && e.target.closest('#mapBeds [data-bed]'), bed = el && bedOf(el.dataset.bed);
      if (!bed) { hush(); return; }
      const n = eng().plantingsIn(bed.id).length;
      say(e, [h('strong', `${gardenOf(bed).name || 'Garden'} · ${nameOf(bed)}`), h('small', `${sizeText(bed)}${n ? ` · ${plural(n, 'planting')} this season` : ' · nothing planted'}`)]);
    });
    svg.addEventListener('pointerleave', hush);
    root.addEventListener('keydown', key, true);
    root.addEventListener('keyup', key, true);
    M.watch((what, detail) => {
      if (!S.on) return;
      if (what === 'tap') tapped(detail);
      else if (what === 'build') { const known = new Set(M.spaces()); S.picked = S.picked.filter(id => known.has(id)); $('mapOver').append(ghosts); if (S.nudge) { clearTimeout(S.nudge.timer); S.nudge = null; } refresh(); }
      else if (what === 'view') paint();
    });
    // leaving the map, or picking a planting or a crop from elsewhere, ends the editing
    App.on('view', () => { if (S.on && App.state.view !== 'map') close(); });
    App.on('sel', () => { if (S.on && App.state.sel) close(); });
    App.on('armed', () => { if (S.on && App.state.armed) close(); });
    // The header's two counts (to place, to settle) open a list in a side panel, and while the layout is edited those panels are the
    // layout's own. So a press on either leaves the layout first: what it opens is then there to see. (In the capture phase, to run ahead
    // of the count's own listener, wherever in the count the press lands.)
    for (const id of ['waitBadge', 'settleBadge']) { const count = $(id); if (count) count.addEventListener('click', () => { if (S.on) close(); }, true); }
  }
  init();

  root.LRFMapEdit = { open, close, on: () => S.on, picked: () => [...S.picked], pick, pickGarden, tool: () => S.tool, setTool, draft: () => S.draft, drafted, typical, addNext, remove, duplicate, lineUp, spaceOut, inRows, numberInOrder, resize, turnTo, drawAt, setScale, clash };
})(window);
