/* Little River Farm Planner — the nursery: its benches, the room on each kind of bench, and what a season uses up.
 *
 * Benches are v7's own records (`plan.nursery.spaces`, with the houses they stand in under `benchAreas`), so the
 * benches that came in with a backup are the ones edited here. Two things are added to a bench: a third kind,
 * `unheated`, and `holds`, the grower's own count of the trays a bench takes, which beats the estimate from its area.
 *
 * Nothing here touches the page or the plan: every edit takes a nursery record and returns a changed copy, or throws
 * an error in words. The season's figures are read from an engine.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFNursery = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  // In the order a seedling meets them.
  const KINDS = [['heated', 'Heated greenhouse'], ['unheated', 'Unheated greenhouse'], ['outside', 'Outside']];
  const KIND_IDS = KINDS.map(k => k[0]);
  const kindName = id => (KINDS.find(k => k[0] === id) || KINDS[0])[1];
  const STANDS = ['live', 'tray', 'rockwool', 'pot', 'crate'];
  const DRY_QT_PER_CUFT = 1728 / 67.200625;   // a US dry quart is 67.2 cubic inches

  // ───────────────────────────── the benches ─────────────────────────────
  const blank = () => ({ packing: 85, spaces: [], benchAreas: [] });
  const open = nursery => { const n = nursery && typeof nursery === 'object' ? clone(nursery) : blank(); if (!Array.isArray(n.spaces)) n.spaces = []; if (!Array.isArray(n.benchAreas)) n.benchAreas = []; return n; };
  const spacesOf = n => n.spaces.filter(x => x && typeof x === 'object');
  const kindOf = sp => (KIND_IDS.includes(sp.kind) ? sp.kind : 'heated');
  function feet(value, what) {
    const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);
    if (!Number.isFinite(n) || n < 0.5 || n > 300) throw Error(`${what}: enter feet, from 0.5 to 300.`);
    return Math.round(n * 100) / 100;
  }
  /** The next free "Bench N". */
  function nextName(n) {
    const used = new Set(spacesOf(n).map(sp => String(sp.name || '').trim().toLowerCase()));
    for (let i = spacesOf(n).length + 1; ; i++) if (!used.has('bench ' + i)) return 'Bench ' + i;
  }
  /**
   * Add a bench. With nothing said it is a copy of the last one in size, kind and house, since benches come in runs;
   * the first bench of a plan is 3 × 6 ft under heat. options: { uid(), after?: bench id }.
   */
  function addBench(nursery, options) {
    const n = open(nursery), list = spacesOf(n), like = (options.after && list.find(sp => sp.id === options.after)) || list[list.length - 1] || null;
    const bench = { id: 'nursery-bench-' + options.uid(), name: nextName(n), w: like ? like.w : 3, l: like ? like.l : 6, kind: like ? kindOf(like) : 'heated', active: true, from: '', to: '' };
    if (like && like.benchLayout && like.benchLayout.areaId) bench.benchLayout = { areaId: like.benchLayout.areaId };
    const at = like ? n.spaces.indexOf(n.spaces.find(sp => sp && sp.id === like.id)) + 1 : n.spaces.length;
    n.spaces.splice(at, 0, bench);
    return { nursery: n, bench };
  }
  /**
   * Change a bench. change may hold name, kind, w, l (feet), holds (a whole number of trays, or '' for the estimate),
   * active, and areaId ('' for no house). What is not named stays as it is, and so does everything v7 keeps on the record.
   */
  function setBench(nursery, id, change) {
    const n = open(nursery), sp = n.spaces.find(x => x && x.id === id);
    if (!sp) throw Error('That bench is no longer in the plan.');
    if ('name' in change) { const name = String(change.name || '').trim(); if (!name || name.length > 60) throw Error('Give the bench a name of 1 to 60 characters.'); sp.name = name; }
    if ('kind' in change) { if (!KIND_IDS.includes(change.kind)) throw Error('A bench is under heat, under cover without heat, or outside.'); sp.kind = change.kind; }
    if ('w' in change) sp.w = feet(change.w, 'Width');
    if ('l' in change) sp.l = feet(change.l, 'Length');
    if ('holds' in change) {
      if (change.holds == null || String(change.holds).trim() === '') delete sp.holds;
      else { const h = Number(change.holds); if (!Number.isInteger(h) || h < 0 || h > 5000) throw Error('Trays a bench holds: a whole number from 0 to 5,000, or nothing for the estimate.'); sp.holds = h; }
    }
    if ('active' in change) sp.active = !!change.active;
    if ('areaId' in change) {
      if (!change.areaId) { if (sp.benchLayout) { delete sp.benchLayout.areaId; if (!Object.keys(sp.benchLayout).length) delete sp.benchLayout; } }
      else { if (!n.benchAreas.some(a => a && a.id === change.areaId)) throw Error('That house is no longer in the plan.'); sp.benchLayout = { ...(sp.benchLayout || {}), areaId: change.areaId }; }
    }
    return n;
  }
  function removeBench(nursery, id) {
    const n = open(nursery), at = n.spaces.findIndex(x => x && x.id === id);
    if (at < 0) throw Error('That bench is no longer in the plan.');
    n.spaces.splice(at, 1);
    return n;
  }
  /** Move a bench up (-1) or down (+1) the list. The same record comes back when it is already at that end. */
  function moveBench(nursery, id, by) {
    const n = open(nursery), at = n.spaces.findIndex(x => x && x.id === id), to = at + (by < 0 ? -1 : 1);
    if (at < 0) throw Error('That bench is no longer in the plan.');
    if (to < 0 || to >= n.spaces.length) return n;
    [n.spaces[at], n.spaces[to]] = [n.spaces[to], n.spaces[at]];
    return n;
  }
  /** A house to stand benches in. A name already there is that house. */
  function addArea(nursery, name, uid) {
    const n = open(nursery), text = String(name || '').trim();
    if (!text || text.length > 60) throw Error('Give the house a name of 1 to 60 characters.');
    const have = n.benchAreas.find(a => a && String(a.name || '').trim().toLowerCase() === text.toLowerCase());
    if (have) return { nursery: n, id: have.id };
    const area = { id: 'bench-area-' + uid(), name: text };
    n.benchAreas.push(area);
    return { nursery: n, id: area.id };
  }
  /** The share of a bench that takes trays (30 to 100 %), and the days seedlings harden off before planting (0 to 21). */
  function setOptions(nursery, change) {
    const n = open(nursery);
    if ('packing' in change) { const p = Number(change.packing); if (!Number.isFinite(p) || p < 30 || p > 100) throw Error('The share of a bench that takes trays: 30 to 100 %.'); n.packing = Math.round(p); }
    if ('harden' in change) { const d = Number(change.harden); if (!Number.isInteger(d) || d < 0 || d > 21) throw Error('Days of hardening off: a whole number from 0 to 21.'); n.harden = d; }
    return n;
  }
  /** Names more than one bench in use goes by: two benches called the same cannot be told apart on a list. */
  function sharedNames(benches) {
    const seen = new Map();
    for (const b of benches) { const k = String(b.name).trim().toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }
  /** Tray spaces by kind of bench, counting the benches in use. */
  function roomOf(benches) {
    const room = { heated: 0, unheated: 0, outside: 0 };
    for (const b of benches) if (b.active) room[b.kind] += b.cap;
    return room;
  }

  // ───────────────────────────── the season on the benches ─────────────────────────────
  const iso = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => iso(plus(d, -((d.getDay() + 6) % 7)));
  const whole = n => Math.ceil(n - 1e-9);
  /**
   * A plan year on the benches, day by day and summed by week (Monday).
   *   weeks      every week from the first with anything under cover to the last: { week, row, pools }.
   *              row is the engine's bench day at the week's fullest; pools[kind] is that kind of bench at its own fullest day.
   *   pools      for each kind of bench: its room, its fullest day, the weeks it is over, and whether it is used at all.
   *   hardening  the most hardening off on one day, and the most of it left under heat for want of room elsewhere.
   * Then the trays themselves, as before: the most of each kind of plug tray on one day, carriers, live trays.
   */
  function season(eng, year) {
    const weeks = new Map(), plugMost = new Map(), flats = { carriers: 0, carriersOn: null, live: 0, liveOn: null };
    let floorMost = 0, floorUntil = null;
    const hardening = { most: 0, on: null, inside: 0, insideOn: null };
    for (let date = new Date(year, 0, 1), i = 0; i < 366 && date.getFullYear() === year; i++, date = plus(date, 1)) {
      const row = eng.benchDay(date);
      if (row.floorCrates > floorMost) floorMost = row.floorCrates;
      if (row.floorCrates) floorUntil = plus(date, 1);
      if (!row.total) continue;
      const use = eng.traysOn(date);
      for (const t of use.plug) { const was = plugMost.get(t.id); if (!was || t.n > was.n) plugMost.set(t.id, { ...t, on: new Date(date) }); }
      if (use.carriers > flats.carriers) { flats.carriers = use.carriers; flats.carriersOn = new Date(date); }
      if (use.live > flats.live) { flats.live = use.live; flats.liveOn = new Date(date); }
      if (row.harden > hardening.most) { hardening.most = row.harden; hardening.on = new Date(date); }
      const inside = row.harden - row.pools.outside.used;
      if (inside > hardening.inside + 1e-9) { hardening.inside = inside; hardening.insideOn = new Date(date); }
      const key = mondayOf(date), week = weeks.get(key) || { row: null, livePeak: 0, pools: {} };
      if (!week.row || row.total > week.row.total) week.row = row;
      week.livePeak = Math.max(week.livePeak, row.live);
      for (const k of KIND_IDS) { const p = row.pools[k], was = week.pools[k]; if (!was || p.used - p.cap > was.used - was.cap || (p.used - p.cap === was.used - was.cap && p.used > was.used)) week.pools[k] = { ...p, date: new Date(date), harden: row.harden }; }
      weeks.set(key, week);
    }
    for (const week of weeks.values()) week.row.livePeak = week.livePeak;
    const keys = [...weeks.keys()].sort(), list = [];
    if (keys.length) for (let w = keys[0]; w <= keys[keys.length - 1]; w = iso(plus(new Date(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10)), 7))) list.push({ week: w, row: weeks.has(w) ? weeks.get(w).row : null, pools: weeks.has(w) ? weeks.get(w).pools : null });
    const benches = eng.benchList(), room = roomOf(benches), pools = {};
    for (const k of KIND_IDS) {
      const mine = list.filter(w => w.pools && (w.pools[k].used > 1e-9)), tightest = list.reduce((a, w) => !w.pools ? a : !a || w.pools[k].used - w.pools[k].cap > a.used - a.cap ? w.pools[k] : a, null);
      pools[k] = { kind: k, name: kindName(k), cap: room[k], benches: benches.filter(b => b.active && b.kind === k).length, used: mine.length > 0, tightest: tightest && (tightest.used > 1e-9 || room[k]) ? tightest : null,
        over: list.filter(w => w.pools && w.pools[k].cap > 0 && w.pools[k].over > 0.05), stands: STANDS.filter(s => mine.some(w => w.pools[k][s] > 1e-9)) };
    }
    const sold = eng.benchItems().filter(it => it.kind === 'live' && it.r.first.getFullYear() === year).reduce((n, it) => n + it.n, 0);
    return { year, weeks: list, pools, room, benches, hardening, hardenDays: eng.hardenDays(), cap: room.heated,
      // the kinds of bench worth drawing: those with room, and the heated ones whenever anything stands under cover
      shown: KIND_IDS.filter(k => room[k] > 0 || pools[k].used || (k === 'heated' && list.length > 0)),
      tightest: pools.heated.tightest, over: room.heated ? pools.heated.over : [],
      plugMost: [...plugMost.values()].sort((a, b) => b.n - a.n), flats: { ...flats, sold }, onBenches: eng.cratesOnBenches, floorMost, floorUntil };
  }

  // ───────────────────────────── what the season uses ─────────────────────────────
  /**
   * Trays, rockwool, pots and potting mix for the plantings of a plan year, less what is on the shelf.
   * own: { have: { id: count }, mix: { id: quarts of mix one of them takes } } (the grower's figures, `plan.lrfNext.supplies`).
   * Each row: { id, name, need, how: [words], have, buy, fills, mixEach, mixQt }. Plug trays come back and are counted at the
   * most in use on one day; what leaves the farm or is used up (live trays, rockwool, mix) is counted over the season.
   * `figures` is the season() of the same engine and year, when the caller already has it.
   */
  function supplies(eng, year, own, figures) {
    const fig = figures || season(eng, year), have = (own && own.have) || {}, mix = (own && own.mix) || {}, text = String(year);
    const lots = new Map(), pots = new Map(), plug = new Map(), liveCells = new Map();
    let liveOpen = 0, sheets = 0, woolCells = 0;
    const trayRow = (cells, name) => { const id = 'tray-' + cells; if (!plug.has(id)) plug.set(id, { id, cells, name: name || `${cells}-cell plug tray`, atOnce: 0, on: null, filled: 0, sold: 0 }); return plug.get(id); };
    for (const it of eng.benchItems()) {
      if (String(it.p.date).slice(0, 4) !== text) continue;
      const r = it.r, c = r.c;
      if (it.kind === 'live') {
        const how = eng.liveSow(c);
        if (how.how === 'cells' && how.cells > 0) liveCells.set(how.cells, (liveCells.get(how.cells) || 0) + it.n); else liveOpen += it.n;
        continue;
      }
      if (it.kind !== 'prop') continue;
      const plan = r.sowing, potted = !r.tw && (c.prop === 'pot' || c.prop === 'potup');
      if (potted) { const size = +c.potSize > 0 ? +c.potSize : 4.5, n = plan && plan.potUpCells != null ? plan.potUpCells : r.cells; pots.set(size, (pots.get(size) || 0) + n); }
      if (!r.tw && c.prop === 'pot') continue;   // sown straight into pots: no tray
      const u = eng.propOf(r, r.sow);
      if (!u || u.kind === 'pot') continue;
      const tray = plan && plan.tray, key = plan && plan.trayGroup ? plan.trayGroup : plan && plan.batchId ? plan.batchId : it.p.id;
      const cells = tray ? tray.cells : (+c.tray > 0 ? +c.tray : 72), lot = lots.get(key) || { n: 0, wool: u.kind === 'rockwool', cells, name: tray ? tray.name : null };
      lot.n += u.n; lots.set(key, lot);
    }
    for (const lot of lots.values()) { const n = whole(lot.n); if (lot.wool) { sheets += n; woolCells = lot.cells; } else trayRow(lot.cells, lot.name).filled += n; }
    for (const t of fig.plugMost) { const m = /^tray-(\d+)$/.exec(t.id), row = m ? trayRow(+m[1], t.name) : null; if (row) { row.atOnce = t.n; row.on = t.on; } else plug.set(t.id, { id: t.id, cells: null, name: t.name, atOnce: t.n, on: t.on, filled: 0, sold: 0 }); }
    for (const [cells, n] of liveCells) trayRow(cells).sold += n;
    const rows = [];
    const row = (id, name, need, how, fills) => {
      const h = Number(have[id]) > 0 ? Math.floor(Number(have[id])) : 0, each = Number(mix[id]) > 0 ? Number(mix[id]) : null;
      rows.push({ id, name, need, how: how.filter(Boolean), have: h, buy: Math.max(0, need - h), fills, mixEach: each, mixQt: each == null ? null : fills * each });
    };
    for (const t of [...plug.values()].sort((a, b) => (a.cells || 0) - (b.cells || 0))) {
      // a row can come back between sowings; a tray that goes out with the sale does not
      const need = Math.max(t.atOnce, 0) + t.sold;
      row(t.id, t.name, need, [t.atOnce ? { n: t.atOnce, text: 'in use at once, at the most', on: t.on } : null, t.sold ? { n: t.sold, text: 'go out as live trays' } : null, t.filled ? { n: t.filled, text: 'filled over the season', aside: true } : null], t.filled + t.sold);
    }
    if (fig.flats.carriers) row('open-holes', 'Open 10 × 20 tray, with holes', fig.flats.carriers, [{ n: fig.flats.carriers, text: 'one under each rockwool sheet, at the most at once', on: fig.flats.carriersOn }], 0);
    if (liveOpen) row('open', 'Open 10 × 20 tray', liveOpen, [{ n: liveOpen, text: 'go out as live trays' }], liveOpen);
    if (sheets) row('rockwool', `Rockwool sheet${woolCells ? `, ${woolCells} cells` : ''}`, sheets, [{ n: sheets, text: 'sown over the season' }], 0);
    for (const [size, n] of [...pots].sort((a, b) => a[0] - b[0])) row('pot-' + size, `${size} in pot`, whole(n), [{ n: whole(n), text: 'filled over the season' }], whole(n));
    // potting mix: for whatever takes mix and has a figure; the rest is named, never guessed
    const takes = rows.filter(r => r.fills > 0), counted = takes.filter(r => r.mixEach != null), qt = counted.reduce((n, r) => n + r.mixQt, 0), haveQt = Number(have.mix) > 0 ? Number(have.mix) : 0;
    const mixRow = { id: 'mix', name: 'Potting mix', unit: 'qt', need: qt, cuFt: qt / DRY_QT_PER_CUFT, have: haveQt, buy: Math.max(0, qt - haveQt), counted: counted.length, of: takes.length, missing: takes.filter(r => r.mixEach == null).map(r => r.name) };
    return { year, rows, mix: mixRow, sheets, liveOpen, liveCells: [...liveCells], any: rows.length > 0 };
  }
  /** One figure of the grower's supplies record, set or (with nothing) cleared; an empty record is no record. kind: 'have' | 'mix'. */
  function setSupply(own, kind, id, value) {
    const next = own && typeof own === 'object' ? clone(own) : {};
    if (!['have', 'mix'].includes(kind)) throw Error('A supply has an amount on hand and, where it takes mix, the mix one takes.');
    const text = value == null ? '' : String(value).trim(), group = { ...(next[kind] || {}) };
    if (text === '') delete group[id];
    else {
      const n = Number(text), wholeOnly = kind === 'have' && id !== 'mix';
      if (!Number.isFinite(n) || n < 0 || n > 1e6 || (wholeOnly && !Number.isInteger(n))) throw Error(kind === 'mix' ? 'Mix one takes: quarts, 0 or more.' : wholeOnly ? 'On hand: a whole number, 0 or more.' : 'On hand: quarts, 0 or more.');
      if (n === 0) delete group[id]; else group[id] = Math.round(n * 100) / 100;
    }
    if (Object.keys(group).length) next[kind] = group; else delete next[kind];
    return Object.keys(next).length ? next : null;
  }

  return { KINDS, KIND_IDS, STANDS, kindName, DRY_QT_PER_CUFT, blank, addBench, setBench, removeBench, moveBench, addArea, setOptions, sharedNames, roomOf, season, supplies, setSupply };
});
