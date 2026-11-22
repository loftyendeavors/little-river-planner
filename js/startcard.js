/* Little River Farm Planner — how a crop is started, one crop at a time (N1).
 *
 * The first part of the Assumptions list: one home for every figure of the nursery. Down the left, every crop grouped by the
 * way it is started (sown in the nursery, live trays, direct, bought in), one short line a crop, with an "Every crop" row for
 * the farm's own figures and a meter of the crops looked at. The card: its head, one line of what it comes to, "Started as",
 * then only the parts that apply to it (Sowing, Potting up, For the towers, On the bench, A tray, Sown in place, Bought in),
 * its sowings as wanted → sown, its varieties, and "Looks right. Next: …".
 *
 * It holds no figure of its own. A box reads the figure where it is stored now: the crop's record (crops[]: tray, spc, germ,
 * gh, prop, potUpWk, potSize, perCarrier, rockwoolDays, seedsFt, liveSow, seedG), the variety's (varieties[]: germ, gh and its
 * environmentDefaults, as the variety form writes them), the farm's (settings.germ, settings.buffer; the pots a carrying tray
 * holds in Supplies). Three are new and are read only where typed: a crop's spare (crops[].spare), a variety's seeds a cell
 * (varieties[].spc) and a cell of several seeds kept as one station (crops[].station, set by "Use it" on its offer).
 *
 * A figure not typed shows grey: the farm's or the library's. While a box is typed the line under it says what it would move,
 * worked out on the plan with the figure taken (dates, cells, trays, seed, bench room); Enter or Tab takes it, Esc leaves it,
 * and the line then says what was done, with Undo. A switch or an offer says the same before "Use it". Nothing moves by opening
 * a card or walking the list; the tick is the one thing this page adds by itself (App.setStartLooked).
 *
 * Drawn by js/assume.js, which owns the page, its search box and "My crops / All crops".
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, N = root.LRFNursery, Sow = root.LRFSowing, Lib = root.LRFLibrary;
  const { h, clear, num } = UI;
  const $ = id => document.getElementById(id);
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  const GROUPS = [['nursery', 'Sown in the nursery'], ['live', 'Live trays'], ['direct', 'Direct'], ['bought', 'Bought in']];
  const SIDES = [['plug', 'Plug tray'], ['pot', 'Pot'], ['rockwool', 'Rockwool'], ['live', 'Live tray'], ['direct', 'Direct'], ['bought', 'Bought in']];
  const POT_SIZES = [4, 4.5];
  const CARRIERS = [10, 15];
  const MATERIAL = { bulb: 'bulbs', clove: 'cloves', piece: 'seed pieces', plant: 'plants' };
  // A published nursery length offered where the library's differs: onion is raised ten weeks from sowing to planting.
  const OFFER_DAYS = { onion: 70 };
  const FARM = '(farm)';

  // cur: the crop on the card (FARM: the farm's own figures). pending: a switch or a tick pressed and not yet used, { key, ops,
  // label }. typed: a box being typed, { key }. said: what the last step did, { key, text }, shown where it was done until the
  // card is drawn for another crop. own: varieties whose own figures are open. focus: the box the pointer goes back to.
  const ui = { cur: null, pending: null, said: null, own: new Set(), focus: null, redraw: () => {} };

  // ───────────────────────── what a crop is ─────────────────────────
  const libCrop = id => (Lib && Lib.crops || []).find(c => c.id === id) || null;
  const ownRec = (plan, id) => (plan.crops || []).find(c => c && c.id === id) || null;
  const materialOf = c => c.plantingMaterial || (c.material === 'bulb' ? 'bulb' : 'seed');
  /** The way a crop is started, for its beds: 'live', 'bought', 'direct' or 'nursery'. */
  function groupOf(c) {
    if (c.micro) return 'live';
    if (materialOf(c) !== 'seed') return 'bought';
    return c.method === 'DS' ? 'direct' : 'nursery';
  }
  /** The side of "Started as" a crop stands on. */
  function sideOf(c) {
    const g = groupOf(c);
    return g === 'nursery' ? (c.prop === 'pot' ? 'pot' : 'plug') : g;
  }
  /**
   * A figure of the crop: his where his own record says it (a crop of the library with a figure written over it, or a crop of
   * his own), else the library's, grey. { mine, fallback, value }.
   */
  function cropFig(eng, c, key, farm) {
    const own = ownRec(eng.plan, c.id), lib = libCrop(c.id), has = o => !!o && o[key] != null && o[key] !== '';
    // his: any figure on his own record, the library's or not, so that what is stored is what is drawn in ink
    const mine = has(own) ? own[key] : null;
    const fallback = farm != null ? farm : has(lib) ? lib[key] : null;
    return { mine: mine != null ? +mine : null, fallback: fallback != null ? +fallback : null, value: mine != null ? +mine : fallback != null ? +fallback : null };
  }
  const farmGerm = plan => +(plan.settings.germ > 0 ? plan.settings.germ : 85);
  const farmSpare = plan => (plan.settings.buffer != null && Number.isFinite(+plan.settings.buffer) ? +plan.settings.buffer : 10);
  // with no spare set for the farm, sowing counts 10% and plants bought in none (js/sowing.js, js/engine.js): each as it always has
  const farmSpareSet = plan => plan.settings.buffer != null && plan.settings.buffer !== '' && Number.isFinite(+plan.settings.buffer);
  const boughtSpare = plan => (farmSpareSet(plan) ? +plan.settings.buffer : 0);
  const sheetOf = () => (Sow && Sow.ROCKWOOL_SHEET) || { cells: 98 };
  /** A crop's plantings, and where they stand. */
  function plantingsOf(eng, c) {
    const out = { all: [], beds: [], towers: [], racks: [], gardens: new Map() };
    for (const p of eng.plan.plantings || []) {
      if (p.cropId !== c.id) continue;
      const b = eng.bedOf(p.bedId);
      if (!b) continue;
      out.all.push(p);
      if (eng.isTower(b)) out.towers.push(p); else if (eng.isRack(b)) out.racks.push(p); else out.beds.push(p);
      const g = eng.gardenOf(b), name = g ? g.name : 'Garden';
      out.gardens.set(name, (out.gardens.get(name) || 0) + 1);
    }
    return out;
  }
  /** His figures for a crop, said or not: whether the card shows any box in ink. */
  const keptOwn = (p, key) => !!(p.growingDefaults && p.growingDefaults.crop && p.growingDefaults.crop[key]);

  // ───────────────────────── what it comes to ─────────────────────────
  const cache = new WeakMap();
  /** Every sowing of the plan by crop, and the bench room each crop takes. Worked out once for an engine. */
  function study(eng) {
    if (cache.has(eng)) return cache.get(eng);
    const crops = new Map(), row = id => { if (!crops.has(id)) crops.set(id, { batches: [], items: [] }); return crops.get(id); };
    for (const b of eng.sowingBatches()) {
      const first = b.members[0];
      if (!first) continue;
      const r = first.r, wool = b.plan.medium === 'rockwool';
      const cells = b.members.reduce((n, m) => n + ((eng.calc(m.p) || {}).cells || 0), 0), seeds = b.members.reduce((n, m) => n + ((eng.calc(m.p) || {}).seeds || 0), 0);
      const wanted = b.members.reduce((n, m) => n + ((eng.calc(m.p) || {}).plants || 0), 0), trays = b.members.reduce((n, m) => n + ((eng.calc(m.p) || {}).trays || 0), 0);
      const pots = r.c.prop === 'potup' || r.c.prop === 'pot' ? b.members.reduce((n, m) => { const s = (eng.calc(m.p) || {}).sowing; return n + (s && s.potUpCells != null ? s.potUpCells : 0); }, 0) : 0;
      row(r.c.id).batches.push({ id: b.id, sow: r.sow, potUp: eng.potUpDate(r), varietyId: first.p.varietyId || null, wool, pot: b.plan.medium === 'pots', wanted, cells, seeds, trays, pots, tray: b.plan.tray, ids: b.memberIds.slice().sort() });
    }
    for (const it of eng.benchItems()) if (it.kind === 'prop') row(it.r.c.id).items.push(it);
    for (const x of crops.values()) x.batches.sort((a, b) => (a.sow || 0) - (b.sow || 0) || String(a.varietyId).localeCompare(String(b.varietyId)));
    const carrierLots = [];
    N.supplies(eng, +eng.plan.settings.year, (eng.plan.lrfNext || {}).supplies, null, carrierLots);
    const out = { crops, carrierLots };
    cache.set(eng, out);
    return out;
  }
  const NONE = { batches: [], items: [] };
  const of = (eng, id) => study(eng).crops.get(id) || NONE;
  /** The most tray spaces a crop takes on one day, the day, and the days its seedlings are on the bench. */
  function benchOf(eng, id) { return benchOfMany(eng, [id]); }
  /** The same for several crops at once: their bench room added up on each day, as the benches hold it (the farm's figures). */
  function benchOfMany(eng, ids) {
    const items = ids.flatMap(id => of(eng, id).items);
    if (!items.length) return { most: 0, on: null, from: null, to: null };
    const days = new Set();
    for (const it of items) { days.add(+it.from); const pu = eng.potUpDate(it.r); if (pu) days.add(+pu); }
    let most = 0, on = null;
    for (const t of days) {
      const d = new Date(t);
      let n = 0;
      for (const it of items) if (it.from <= d && d < it.to) { const u = eng.propOf(it.r, d); if (u) n += u.eq; }
      if (n > most + 1e-9) { most = n; on = d; }
    }
    return { most, on, from: new Date(Math.min(...items.map(it => +it.from))), to: new Date(Math.max(...items.map(it => +it.to))) };
  }
  /** What a crop's sowings come to: cells, trays (whole, by tray), sheets, seeds, pots and their carriers, mix in cubic feet. */
  function totals(eng, c) {
    const list = of(eng, c.id).batches, own = (eng.plan.lrfNext || {}).supplies || null, byTray = new Map();
    let cells = 0, seeds = 0, wanted = 0, sheets = 0, pots = 0, cubes = 0;
    for (const b of list) {
      cells += b.cells; seeds += b.seeds; wanted += b.wanted; pots += b.pots;
      if (b.wool) { sheets += b.trays; cubes += b.cells; } else if (!b.pot) { const k = b.tray ? b.tray.cells : +c.tray || 72; byTray.set(k, (byTray.get(k) || 0) + b.trays); }
    }
    const trays = [...byTray].map(([k, n]) => [k, Math.ceil(n - 1e-9)]).sort((a, b) => b[1] - a[1]);
    let mix = 0;
    for (const [k, n] of trays) { const each = N.mixEach(own, 'tray-' + k); if (each != null) mix += n * each; }
    const size = +c.potSize > 0 ? +c.potSize : 4.5, potEach = pots ? N.mixEach(own, 'pot-' + size) : null;
    if (potEach != null) mix += pots * potEach;
    const per = eng.potsPerCarrier(c), lots = study(eng).carrierLots.filter(lot => lot.cropId === c.id);
    const carriers = N.mostAtOnce(lots, lot => Math.ceil(lot.n / per - 1e-9)).most;
    return { cells, seeds, wanted, trays, sheets: Math.ceil(sheets - 1e-9), cubes, pots, size, per, carriers, mix, n: list.length };
  }
  const cuft = n => `${num(n, n < 10 ? 1 : 0)} cu ft`;
  const traysSaid = t => t.trays.map(([k, n]) => `${plural(n, 'tray')} of ${k}`).join(' and ');

  // ───────────────────────── what a change would move ─────────────────────────
  const D = d => (d && !Number.isNaN(+d) ? +d : null);
  /** Before and after, for one crop's plantings: dates that move, cells, trays and seed, the bench room at the most. */
  /**
   * What a step would move, worked out on the whole plan with the step taken and on the plan as it stands: the crop's own sowings
   * (cells, trays, seed, plants to buy), the plantings of any other crop that move with it (a rockwool sheet is shared by the crops
   * sown on one day), every date that moves, the rows of Supplies that change (trays, sheets, pots, carriers, mix), and the room
   * on each kind of bench at its fullest, from the same call Bench room draws from (js/nursery.js season).
   */
  function movesOf(eng, cropIds, ops) {
    const next = App.engineAfter(ops), ids = new Set(cropIds), year = +eng.plan.settings.year;
    const out = { dates: [], datesN: 0, batches: [], cells: [0, 0], trays: [0, 0], seeds: [0, 0], seedG: [0, 0], buy: [0, 0], others: { n: 0, crops: new Set(), cells: [0, 0], trays: [0, 0], seeds: [0, 0], buy: [0, 0] }, supplies: [], bench: [] };
    for (const p of eng.plan.plantings || []) {
      const a = eng.calc(p), q = next.planting(p.id), b = a && q ? next.calc(q) : null;
      if (!a || !b) continue;
      const pairs = [['sowing', a.plannedSow, b.plannedSow], ['pot-up', eng.potUpDate(a), next.potUpDate(b)], ['hardening off', eng.hardenStart(a), next.hardenStart(b)], ['planting', a.field, b.field]];
      let moved = false;
      for (const [what, x, y] of pairs) if (D(x) !== D(y)) { moved = true; if (out.dates.length < 3) out.dates.push({ what, was: x, now: y }); }
      if (moved) out.datesN++;
      const sum = (to, k, f) => { to[k][0] += a[f] || 0; to[k][1] += b[f] || 0; };
      if (ids.has(p.cropId)) { for (const k of ['cells', 'trays', 'seeds', 'seedG', 'buy']) sum(out, k, k); continue; }
      const differ = ['cells', 'trays', 'seeds', 'buy'].some(k => Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-9);
      if (!differ) continue;
      out.others.n++; out.others.crops.add(p.cropId);
      for (const k of ['cells', 'trays', 'seeds', 'buy']) sum(out.others, k, k);
    }
    const before = new Map(), after = new Map();
    for (const id of ids) { for (const x of of(eng, id).batches) before.set(x.ids.join(','), x); for (const x of of(next, id).batches) after.set(x.ids.join(','), x); }
    for (const [k, x] of before) { const y = after.get(k); if (y && (y.cells !== x.cells || Math.abs(y.trays - x.trays) > 1e-9 || y.seeds !== x.seeds)) out.batches.push({ was: x, now: y }); }
    // the benches and Supplies, as the Nursery page counts them
    try {
      const f0 = N.season(eng, year), f1 = N.season(next, year), most = (f, k) => f.weeks.reduce((n, w) => Math.max(n, w.pools && w.pools[k] ? w.pools[k].used : 0), 0);
      for (const k of N.KIND_IDS) { const x = most(f0, k), y = most(f1, k); if (Math.abs(x - y) > 0.05) out.bench.push({ kind: N.kindName(k), was: x, now: y }); }
      const s0 = N.supplies(eng, year, (eng.plan.lrfNext || {}).supplies || null, f0), s1 = N.supplies(next, year, (next.plan.lrfNext || {}).supplies || null, f1);
      const rows = new Map();
      const supplyName = r => r.pockets ? `${r.pockets}-pot carrying tray` : r.name;
      for (const r of s0.rows) rows.set(r.id, { name: supplyName(r), was: r.need, now: 0 });
      for (const r of s1.rows) { const x = rows.get(r.id) || { name: supplyName(r), was: 0, now: 0 }; x.now = r.need; rows.set(r.id, x); }
      for (const x of rows.values()) if (x.was !== x.now) out.supplies.push(x);
      if (Math.abs(s0.mix.need - s1.mix.need) > 0.005) out.supplies.push({ name: 'Potting mix', was: s0.mix.need, now: s1.mix.need, cuft: true });
    } catch (_) { /* a plan the nursery cannot read: the plantings' own figures above still stand */ }
    // the card's own line of what the crop comes to, before and after: every figure of it that differs is said
    out.card = [];
    if (ids.size === 1) {
      const id = [...ids][0], a = cardFigs(eng, id), b = cardFigs(next, id);
      for (const k of Object.keys(a)) if (a[k] !== b[k]) out.card.push({ what: CARD_WORDS[k], was: a[k], now: b[k] });
    }
    out.next = next;
    return out;
  }
  const CARD_WORDS = { sowings: 'its sowings', cells: 'its cells', trays: 'its trays', sheets: 'its rockwool sheets', seeds: 'its seed', pots: 'its pots', carriers: 'its carriers', mix: 'its mix', spaces: 'its bench room at the most', buy: 'its plants to buy' };
  /** What the card says a crop comes to, as words: the figures `movesSaid` holds before and after. */
  function cardFigs(eng, id) {
    const c = eng.crop(id);
    if (!c) return {};
    const t = totals(eng, c), b = benchOf(eng, id), buy = (eng.plan.plantings || []).filter(p => p.cropId === id).reduce((n, p) => n + ((eng.calc(p) || {}).buy || 0), 0);
    return { sowings: t.n ? plural(t.n, 'sowing') : 'none', cells: t.cells ? num(t.cells) : 'none', trays: t.trays.length ? traysSaid(t) : 'none', sheets: t.sheets ? plural(t.sheets, 'sheet') : 'none', seeds: t.seeds ? num(t.seeds) : 'none',
      pots: t.pots ? `${num(t.pots)} of ${t.size} in` : 'none', carriers: t.carriers ? `${plural(t.carriers, 'carrier')} of ${t.per}` : 'none', mix: t.mix ? cuft(t.mix) : 'none', spaces: b.most ? `${num(b.most, 1)} tray spaces` : 'none', buy: buy ? num(buy) : 'none' };
  }
  const traysWord = n => Number.isInteger(Math.round(n * 100) / 100) ? num(n) : num(n, 1);
  /** The moves, in a line of words. Empty when nothing would move. */
  function movesSaid(m) {
    const parts = [];
    if (m.card && m.card.length) parts.push(m.card.map(x => `${x.what} ${x.was} → ${x.now}`).join(', '));
    const first = m.batches[0];
    if (first) parts.push(`${UI.day(first.was.sow)}: ${num(first.was.cells)} → ${num(first.now.cells)} cells, ${traysWord(first.was.trays)} → ${traysWord(first.now.trays)} trays, ${num(first.was.seeds)} → ${num(first.now.seeds)} seeds`);
    if (m.batches.length > 1) parts.push(`in all ${plural(m.batches.length, 'sowing')}: ${num(m.cells[0])} → ${num(m.cells[1])} cells, ${num(m.seeds[0])} → ${num(m.seeds[1])} seeds`);
    else if (!first && m.seeds[0] !== m.seeds[1]) parts.push(`seed ${num(m.seeds[0])} → ${num(m.seeds[1])}`);
    if (Math.abs(m.seedG[0] - m.seedG[1]) > 1e-6) parts.push(`seed ${num(m.seedG[0], 1)} → ${num(m.seedG[1], 1)} g`);
    if (m.buy[0] !== m.buy[1]) parts.push(`plants to buy ${num(m.buy[0])} → ${num(m.buy[1])}`);
    if (m.others.n) parts.push(`${plural(m.others.n, 'planting')} of ${plural(m.others.crops.size, 'other crop')} move with it: trays ${traysWord(m.others.trays[0])} → ${traysWord(m.others.trays[1])}${m.others.cells[0] !== m.others.cells[1] ? `, cells ${num(m.others.cells[0])} → ${num(m.others.cells[1])}` : ''}${m.others.buy[0] !== m.others.buy[1] ? `, plants to buy ${num(m.others.buy[0])} → ${num(m.others.buy[1])}` : ''}`);
    if (m.datesN) parts.push(`${plural(m.datesN, 'planting')} move${m.datesN === 1 ? 's' : ''}: ${m.dates.map(d => `${d.what} ${UI.day(d.was)} → ${UI.day(d.now)}`).join(', ')}`);
    else if (parts.length || m.supplies.length || m.bench.length) parts.push('no date moves');
    for (const b of m.bench) parts.push(`${b.kind.toLowerCase()} benches at their fullest ${num(b.was, 1)} → ${num(b.now, 1)} tray spaces`);
    if (m.supplies.length) parts.push(`Supplies: ${m.supplies.map(x => `${x.name.toLowerCase()} ${x.cuft ? `${num(x.was, 2)} → ${num(x.now, 2)} cu ft` : `${num(x.was)} → ${num(x.now)}`}`).join(', ')}`);
    return parts.length ? parts.join('; ') + '.' : '';
  }

  // ───────────────────────── a step ─────────────────────────
  /** A change to the crop's own record, written over the library's where it has none: { key: value }, null clears. */
  function cropOps(eng, c, change) {
    const before = ownRec(eng.plan, c.id), after = { ...(before || { id: c.id }) };
    // null clears a figure; a key left undefined is not touched (an explicit figure of his stays as it is)
    for (const [k, v] of Object.entries(change)) { if (v === undefined) continue; if (v === null) delete after[k]; else after[k] = v; }
    if (JSON.stringify(after) === JSON.stringify(before || { id: c.id })) return null;
    // a record of a library crop left holding nothing but its id is no record: it goes, and so does the note made when it was
    // made here, so that typing a figure and clearing it leaves the plan as it was
    if (Object.keys(after).length === 1 && before && libCrop(c.id)) {
      const facts = (eng.plan.lrfNext || {}).facts || null, made = facts && facts.crops && facts.crops[c.id] && facts.crops[c.id].create;
      if (!made) return [{ kind: 'crop', before, after }];
      const crops = { ...facts.crops }; delete crops[c.id];
      const rest = { ...facts, crops }, any = ['crops', 'varieties', 'gardens', 'beds'].some(k => Object.keys(rest[k] || {}).length);
      return [{ kind: 'crop', before, after: null }, { kind: 'own', key: 'facts', before: facts, after: any ? rest : null }];
    }
    return [{ kind: 'crop', before, after }];
  }
  /** A variety's own figure: germ, spc, or days (its days from sowing to planting, kept as the variety form keeps them). */
  function varietyOps(eng, v, key, n) {
    const after = { ...v };
    if (key === 'days') {
      const cfg = v.environmentDefaults ? JSON.parse(JSON.stringify(v.environmentDefaults)) : null;
      // the figure the engine reads is each place's (environmentDefaults.field and .greenhouse): that, and nothing else, is written
      // or cleared. A bare gh, which the engine does not read, is left as it is.
      if (n == null) {
        if (!cfg) return null;
        for (const k of ['field', 'greenhouse']) if (cfg[k] && 'gh' in cfg[k]) { delete cfg[k].gh; delete cfg[k].startDays; if (!Object.keys(cfg[k]).length) delete cfg[k]; }
        if (Object.keys(cfg).some(k => k !== 'v')) after.environmentDefaults = cfg; else delete after.environmentDefaults;
      } else {
        const gh = n / 7, base = cfg || {};
        after.environmentDefaults = { ...base, v: base.v || 1, field: { ...(base.field || {}), gh, startDays: n }, greenhouse: { ...(base.greenhouse || {}), gh, startDays: n } };
      }
    } else if (n == null) delete after[key]; else after[key] = n;
    return JSON.stringify(after) === JSON.stringify(v) ? null : [{ kind: 'variety', before: v, after }];
  }
  /** A variety's days from sowing to planting, where it has its own. */
  /**
   * A variety's days from sowing to planting, as the engine reads them: place by place (environmentDefaults.field and .greenhouse;
   * its bare gh is not read). { one: days where one figure holds wherever it grows, or null; field, greenhouse: each place's }.
   */
  function varietyDays(v) {
    const cfg = v.environmentDefaults || {}, at = k => cfg[k] && cfg[k].gh != null && Number.isFinite(+cfg[k].gh) ? Math.round(+cfg[k].gh * 7) : null;
    const field = at('field'), greenhouse = at('greenhouse');
    return { field, greenhouse, one: field === greenhouse ? field : null, split: field !== greenhouse };
  }
  function settingsOps(plan, change) {
    const before = plan.settings, after = { ...before };
    for (const [k, v] of Object.entries(change)) { if (v == null) delete after[k]; else after[k] = v; }
    return JSON.stringify(after) === JSON.stringify(before) ? null : [{ kind: 'settings', before, after }];
  }
  function suppliesOps(plan, pockets) {
    const before = (plan.lrfNext || {}).supplies || null;
    let after;
    try { after = N.setSupply(before, 'pockets', null, pockets); } catch (_) { return null; }
    return JSON.stringify(after) === JSON.stringify(before) ? null : [{ kind: 'own', key: 'supplies', before, after }];
  }
  /** Take a step: one Undo, answered here. */
  function take(key, label, ops) {
    if (!ops) return false;
    ui.pending = null;
    const done = App.setStarting(label, ops);
    // the line that says what was done belongs to this one step (render drops it once another step is taken, undone or redone)
    if (done) ui.said = { key, text: `${label}.`, step: App.state.undo[App.state.undo.length - 1] };
    ui.redraw();
    return done;
  }
  // Undo where the step was taken: the line then says it is undone, and no message is shown (DESIGN.md rule 3, one answer)
  const undoLink = () => ui.said && ui.said.done ? '' : h('button.link', { type: 'button', dataset: { hook: 'start-undo' }, title: 'Takes this step back',
    onclick: () => {
      const said = ui.said, top = App.state.undo[App.state.undo.length - 1];
      // only ever the step the line names: if another has been taken since, the line goes and nothing is undone
      if (!said || !said.step || top !== said.step) { ui.said = null; ui.redraw(); return; }
      ui.said = { key: said.key, text: `Undone: ${said.step.label}.`, done: true, step: said.step };
      App.undo({ quiet: true });
    } }, 'Undo');
  /** The line of the last step stands only while that step is the last one taken (or, undone here, the next one to redo). */
  function sayingStill() {
    const s = ui.said;
    if (!s || !s.step) return;
    const last = list => list[list.length - 1];
    if (s.done ? last(App.state.redo) !== s.step : last(App.state.undo) !== s.step) ui.said = null;
  }
  // what the engine counts for one planting, figure by figure: the figure a typed box is held to (`uses`)
  const USE = {
    germ: (eng, r) => r.boughtIn || r.rack || r.bulbs ? null : r.sowing ? r.sowing.germination * 100 : +r.c.germ > 0 ? +r.c.germ : +eng.plan.settings.germ > 0 ? +eng.plan.settings.germ : 85,
    spare: (eng, r) => r.sowing ? r.sowing.buffer : r.boughtIn ? (r.c.spare != null && r.c.spare !== '' && Number.isFinite(+r.c.spare) ? +r.c.spare : Number.isFinite(+eng.plan.settings.buffer) && eng.plan.settings.buffer !== '' && eng.plan.settings.buffer != null ? Math.max(0, +eng.plan.settings.buffer) : 0) : null,
    spc: (eng, r) => r.sowing ? r.sowing.seedsPerCell : null,
    days: (eng, r) => r.sowing && !r.tw && r.sowDefault ? root.LRFEngine.dayDiff(r.planned, r.sowDefault) : null,
    potUpWk: (eng, r) => r.sowing && r.c.prop === 'potup' ? Math.round(Math.max(0, Number.isFinite(+r.c.potUpWk) && r.c.potUpWk !== '' && r.c.potUpWk != null ? +r.c.potUpWk : 2) * 7) : null,
    rockwoolDays: (eng, r) => r.tw ? r.c.ghDays : null,
    seedsFt: (eng, r) => !r.sowing && !r.boughtIn && !r.rack && r.c.method === 'DS' ? +r.c.seedsFt || 0 : null
  };
  const usesOf = (eng, list, k) => uniform(eng, list, r => USE[k](eng, r));
  /** The one figure the engine uses today for every planting given, by `value(r)`; null where they differ or there are none. */
  function uniform(eng, list, value) {
    const seen = new Set();
    for (const p of list) { const r = eng.calc(p); if (!r) continue; const v = value(r); if (v == null || !Number.isFinite(+v)) continue; seen.add(Math.round(+v * 1e6) / 1e6); }
    return seen.size === 1 ? [...seen][0] : null;
  }

  // ───────────────────────── a box ─────────────────────────
  /**
   * One number, with the line under it. `fig` { mine, fallback }: his figure in ink, else the grey one. `ops(n)` the step that
   * would set it (null clears it), `cropIds` whose plantings the line looks at. Typing says what it would move; Enter or Tab
   * takes it; Esc puts back what was there.
   */
  function box({ key, label, fig, unit, grey, ops, cropIds, min = 0, max = 1000, whole, help, amber, name, wide, farm, off, uses, correctsDays = false }) {
    const shown = fig.mine != null ? String(+(+fig.mine).toFixed(2)) : '';
    const line = h('p.sn-moves', { dataset: { hook: 'start-moves', key }, 'aria-live': 'polite' });
    const said = ui.said && ui.said.key === key ? ui.said : null;
    if (said) { line.append(said.text, ' ', undoLink()); line.dataset.said = 'true'; }
    if (!said && off) line.append(off);
    const input = h('input', { type: 'number', min, max, step: whole ? 1 : 'any', value: shown, placeholder: amber || fig.fallback == null ? '' : String(+(+fig.fallback).toFixed(2)), 'aria-label': `${name}: ${label.toLowerCase()}`,
      title: fig.mine != null ? `Yours. Clear it to go back to ${fig.fallback == null ? 'nothing' : fig.fallback}.` : fig.fallback != null ? `Grey: ${grey || 'the library’s'}, ${fig.fallback}. Type over it to make it yours.` : 'Nothing set. Type a figure.',
      dataset: { hook: 'start-box', key, sk: key }, disabled: !!off });
    if (off) input.title = off;
    const read = () => { const raw = input.value.trim(); if (raw === '') return { n: null }; const n = whole ? Math.round(+raw) : +raw; return (input.validity && input.validity.badInput) || !Number.isFinite(n) || n < min || n > max ? { bad: true } : { n }; };
    // The taking rule. A box not edited since it took focus takes nothing. A number equal to his own figure: nothing. Where he
    // has none, a number equal to the figure the engine uses today for every planting it speaks for (`uses`): not stored, and
    // the box goes back to grey. Any other number is stored as his, the library's or the farm's value included. Only emptying
    // the box puts a figure of his back to following.
    const eq = (a, b) => Math.abs(a - b) < 1e-6;
    let edited = false, sent = false;
    const follows = n => n != null && fig.mine == null && !farm && uses != null && eq(n, uses);
    const same = n => (n == null && fig.mine == null) || (n != null && fig.mine != null && eq(n, fig.mine) && !correctsDays) || follows(n);
    const commit = () => {
      if (sent || !edited) return false;
      const x = read();
      if (x.bad) { input.value = shown; clear(line); return false; }
      if (same(x.n)) { if (follows(x.n)) { input.value = shown; edited = false; } clear(line); return false; }
      sent = true;
      if (!ui.focus) ui.focus = key;
      return take(key, `${name}: ${label.toLowerCase()} ${x.n == null ? `back to ${fig.fallback == null ? 'nothing' : num(fig.fallback, 2)}` : num(x.n, 2)}${unit && x.n != null ? ' ' + unit : ''}`, ops(x.n));
    };
    input.addEventListener('focus', () => { edited = false; });
    input.addEventListener('input', () => {
      edited = true;
      ui.said = null;
      const x = read();
      clear(line); delete line.dataset.said; delete line.dataset.would;
      if (x.bad) { line.append(`Not a figure here: ${min} to ${max}.`); return; }
      if (follows(x.n)) { line.append('Every planting already counts this: nothing to take.'); return; }
      if (same(x.n)) return;
      const step = ops(x.n);
      if (!step) return;
      const said = movesSaid(movesOf(App.state.engine, cropIds, step));
      line.dataset.would = 'true';
      line.append(said ? `Would move: ${said}` : 'Moves nothing on this plan.', h('span.sn-keys', 'Enter or Tab to use it · Esc to leave it · Undo after'));
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); input.value = shown; clear(line); input.blur(); }
      else if (e.key === 'Enter') { e.preventDefault(); ui.focus = key; commit(); }
      // Tab takes it and the pointer goes to the next box: the browser's own Tab is held, or it would go on past that box
      else if (e.key === 'Tab' && !e.shiftKey) { const x = read(); if (edited && !x.bad && !same(x.n)) { e.preventDefault(); ui.focus = { after: key }; commit(); } else if (edited) { input.value = shown; clear(line); } }
    });
    // only Enter or Tab takes a figure: leaving the box any other way (a click elsewhere) leaves it as Esc does. The line keeps its
    // room until the press is over, so that what was pressed does not move away under the pointer and the click lands.
    input.addEventListener('blur', () => {
      if (sent || !edited) return;
      input.value = shown; edited = false; delete line.dataset.would;
      line.style.visibility = 'hidden';
      let gone = false;
      const go = () => { if (gone) return; gone = true; clear(line); line.style.visibility = ''; };
      document.addEventListener('pointerup', () => setTimeout(go, 0), { once: true, capture: true });
      setTimeout(() => { if (!document.querySelector(':active')) go(); }, 400);
    });
    return h('div.sn-f', { dataset: { field: key, hook: 'start-field' } },
      h('span.sn-lab', { dataset: { hook: 'start-label' } }, label, help ? UI.help(help, null, null, { label: `What ${label.toLowerCase()} means` }) : null),
      h('span.sn-ctl', h('span.yc-box' + (wide ? '.wide' : '') + (off ? '.off' : fig.mine != null ? '.mine' : amber ? '.amber' : ''), input), unit ? h('span.yc-unit', unit) : null, grey ? h('span.sn-grey', grey) : null),
      line);
  }
  const term = (word, says) => h('p', h('b', word), ': ', says);
  /** A fixed figure: what stands, and where it is set. */
  const fixed = (label, value, link) => h('div.sn-f', h('span.sn-lab', label), h('span.sn-ctl', h('span.sn-fixed', value), link || null));
  const toSetup = () => h('button.link', { type: 'button', dataset: { hook: 'start-to-setup' }, title: 'Opens Nursery › Set-up, where it is set for the farm', onclick: () => root.LRFTraysView && root.LRFTraysView.open('setup') }, 'Nursery › Set-up');

  /** A switch whose press says what it would move, then "Use it". `sides` [[value, words, disabled title]]. */
  function choice({ key, sides, on, name, label, ops, cropIds, hook, allowCurrent = false }) {
    const pend = ui.pending && ui.pending.key === key ? ui.pending : null, said = ui.said && ui.said.key === key ? ui.said : null;
    const seg = h('div.seg.sn-seg', { role: 'group', 'aria-label': `${name}: ${label.toLowerCase()}`, dataset: { hook, on: String(on) } },
      sides.map(([value, words, off]) => h('button', { type: 'button', 'aria-pressed': String(String(pend ? pend.value : on) === String(value)), disabled: !!off, title: off || `${words}: what it would move is shown first`, dataset: { hook: 'start-side', side: String(value) },
        onclick: () => {
          if (!allowCurrent && String(value) === String(on)) { ui.pending = null; ui.redraw(); return; }
          const step = ops(value);
          if (!step) return;
          ui.pending = { key, value, ops: step, label: `${name}: ${label.toLowerCase()} ${String(words).toLowerCase()}`, said: movesSaid(movesOf(App.state.engine, cropIds, step)) };
          ui.said = null; ui.redraw();
        } }, words)));
    const line = h('p.sn-moves', { dataset: { hook: 'start-moves', key } });
    if (pend) { line.dataset.would = 'true'; line.append(pend.said ? `Would move: ${pend.said} ` : 'Moves nothing on this plan. ', h('button.btn.small', { type: 'button', dataset: { hook: 'start-use' }, onclick: () => take(key, pend.label, pend.ops) }, 'Use it'), ' ', h('button.btn.quiet.small', { type: 'button', onclick: () => { ui.pending = null; ui.redraw(); } }, 'Leave it')); }
    else if (said) { line.dataset.said = 'true'; line.append(said.text, ' ', undoLink()); }
    return { seg, line };
  }
  /** Stage a change: what it would move is said under the control, and it is taken only with "Use it". */
  function stage(key, label, ops, cropIds, value) {
    if (!ops) { ui.pending = null; ui.redraw(); return; }
    ui.pending = { key, value, ops, label, said: movesSaid(movesOf(App.state.engine, cropIds, ops)) };
    ui.said = null; ui.redraw();
  }
  /** The line under a staged control: what it would move with "Use it", or what was done with Undo; null when neither. */
  function stagedLine(key) {
    const pend = ui.pending && ui.pending.key === key ? ui.pending : null, said = ui.said && ui.said.key === key ? ui.said : null;
    if (!pend && !said) return null;
    const line = h('p.sn-moves', { dataset: { hook: 'start-moves', key } });
    if (pend) { line.dataset.would = 'true'; line.append(pend.said ? `Would move: ${pend.said} ` : 'Moves nothing on this plan. ', h('button.btn.small', { type: 'button', dataset: { hook: 'start-use' }, onclick: () => take(key, pend.label, pend.ops) }, 'Use it'), ' ', h('button.btn.quiet.small', { type: 'button', onclick: () => { ui.pending = null; ui.redraw(); } }, 'Leave it')); }
    else { line.dataset.said = 'true'; line.append(said.text, ' ', undoLink()); }
    return line;
  }
  /** An offer of a new rule: what it would move, before and after, and "Use it". */
  function offer(key, words, ops, cropIds, label) {
    if (ui.said && ui.said.key === key) return stagedLine(key);
    if (!ops) return null;
    const m = movesOf(App.state.engine, cropIds, ops), said = movesSaid(m);
    return h('div.sn-offer', { dataset: { hook: 'start-offer', offer: key } },
      h('p', 'Offered: ', words, said ? ` ${said}` : ' It moves nothing on this plan.'),
      h('button.btn.small', { type: 'button', dataset: { hook: 'start-offer-use', offer: key }, onclick: () => take(key, `Offer used: ${label}`, ops) }, 'Use it'));
  }

  // ───────────────────────── the card ─────────────────────────
  function cardFor(eng, plan, c, next) {
    const pl = plantingsOf(eng, c), group = groupOf(c), side = sideOf(c), t = totals(eng, c), bench = benchOf(eng, c.id), year = +plan.settings.year;
    const name = c.name, ids = [c.id], looked = lookedOf(plan, c.id) === year;
    const where = !pl.all.length ? `Not planted in ${year}` : `${plural(pl.all.length, 'planting')} · ${[...pl.gardens].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${num(n)}`).join(' · ')}`;
    const head = h('header.yc-head',
      root.LRFThumbs.el({ cropId: c.id, color: eng.cropColor(c), label: name, size: 40, cls: 'key' }),
      h('div', h('h3', { dataset: { hook: 'start-name' } }, name), h('p.yc-where', where)),
      group === 'live' && !eng.liveSow(c).set ? h('p.yc-state', { dataset: { hook: 'start-state' } }, h('i.sn-dot.amber'), 'Seed not counted')
        : h('p.yc-state' + (looked ? '.done' : ''), { dataset: { hook: 'start-state' } }, looked ? `Looked at for ${year}` : `Not looked at for ${year}`));
    const card = h('section.yc-card.sn-card', { dataset: { hook: 'start-card', crop: c.id } }, head, comesLine(eng, c, pl, t, bench));
    const left = h('div.sn-col'), right = h('div.sn-col');

    // ── Started as: the crop's default for its beds ──
    const flip = value => {
      if (value === 'plug') return cropOps(eng, c, { method: 'TP', prop: c.prop === 'pot' ? null : c.prop, plantingMaterial: materialOf(c) !== 'seed' ? 'seed' : undefined });
      if (value === 'pot') return cropOps(eng, c, { method: 'TP', prop: 'pot', plantingMaterial: materialOf(c) !== 'seed' ? 'seed' : undefined });
      if (value === 'direct') return cropOps(eng, c, { method: 'DS', plantingMaterial: materialOf(c) !== 'seed' ? 'seed' : undefined });
      if (value === 'bought') return cropOps(eng, c, { plantingMaterial: 'plant' });
      return null;
    };
    const clean = ops => ops && ops.map(o => { if (o.kind !== 'crop') return o; const a = { ...o.after }; for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k]; return { ...o, after: a }; });
    const bulbs = ['bulb', 'clove', 'piece'].includes(materialOf(c));
    const sides = SIDES.map(([v, w]) => [v, w,
      v === 'rockwool' ? 'Only the towers start in rockwool: see For the towers' : (v === 'live') !== (group === 'live') ? (group === 'live' ? 'A live-tray crop is sown in its tray' : 'Only a live-tray crop is sown in a live tray') : group === 'live' ? 'A live-tray crop is sown in its tray'
        : bulbs && v !== 'bought' ? `Planted from ${MATERIAL[materialOf(c)]}: say otherwise on Seeds, in the crop’s own record` : null]);
    const sw = choice({ key: 'started', sides, on: side, name, label: 'Started as', ops: v => clean(flip(v)), cropIds: ids, hook: 'start-as' });
    const towers = pl.towers.length, beds = pl.beds.length;
    // each planting as it is started for itself (its own Seed | Bought in on Seeds), counted against the crop's way
    const boughtP = pl.beds.filter(p => (eng.calc(p) || {}).boughtIn === true), buyN = boughtP.reduce((n, p) => n + (eng.calc(p).buy || 0), 0);
    const follow = group === 'bought' ? boughtP.length : beds - boughtP.length, odd = beds - follow;
    const oddSaid = !odd ? '' : group === 'bought' ? ` ${plural(odd, 'planting')} ${odd === 1 ? 'is' : 'are'} sown, by ${odd === 1 ? 'its' : 'their'} own choice on Seeds.`
      : ` ${plural(odd, 'planting')} ${odd === 1 ? 'is' : 'are'} bought in, by ${odd === 1 ? 'its' : 'their'} own choice on Seeds: ${plural(buyN, 'plant')} to buy.`;
    const also = group === 'live' ? ['How many trays a week, and the days to ready, are on ', h('button.link', { type: 'button', dataset: { hook: 'start-to-live' }, onclick: () => root.LRFTraysView && root.LRFTraysView.open('live') }, 'Nursery › Live trays'), '.']
      : towers ? [`For its ${plural(beds, 'bed planting')}${odd ? ` (${num(follow)} follow it)` : ''}. Its ${plural(towers, 'tower planting')} start in rockwool, below.${oddSaid}`]
        : [h('span', { dataset: { hook: 'start-follow', follow: String(follow), odd: String(odd), buy: String(buyN) } }, !beds ? '' : odd ? `${num(follow)} of ${plural(beds, 'planting')} follow this.${oddSaid} ` : `All ${plural(beds, 'planting')} follow this. `), 'Any one can be switched to ', h('b', 'Bought in'), ' on ', h('button.link', { type: 'button', dataset: { hook: 'start-to-seeds' }, onclick: () => { App.setView('seeds'); } }, 'Seeds'), '.'];
    card.append(h('div.sn-start', h('span.sn-lab', 'Started as', UI.help(h('div', term('Started as', 'how this crop is started, wherever it is planted in a bed. One planting can still be set to Bought in on Seeds, and the towers always start in rockwool.')), null, null, { label: 'What started as means' })),
      sw.seg, h('p.sn-also', also), sw.line));

    const keep = key => pl.beds.filter(p => keptOwn(p, key)).length;
    const germ = cropFig(eng, c, 'germ', farmGerm(plan)), spare = cropFig(eng, c, 'spare', farmSpare(plan));
    const germBox = () => box({ key: 'germ', name, label: 'Germination', unit: '%', fig: germ, grey: germ.mine == null ? 'the farm’s' : null, min: 0.1, max: 100, ops: n => cropOps(eng, c, { germ: n }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'germ'), cropIds: ids,
      help: h('div', term('Germination', 'the share of seeds that come up. Cells and seed are counted for it; a variety may have its own.')) });
    const spareBox = (what, bought) => box({ key: 'spare', name, label: 'Spare', unit: '%', fig: bought ? cropFig(eng, c, 'spare', boughtSpare(plan)) : spare, grey: spare.mine == null ? (farmSpareSet(plan) ? 'the farm’s' : bought ? 'none: the farm has none set' : 'the farm has none set: sowing counts 10') : null, min: 0, max: 100, ops: n => cropOps(eng, c, { spare: n }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'spare'), cropIds: ids,
      help: h('div', term('Spare', what)) });

    if (group === 'nursery') {
      const lib = libCrop(c.id), trays = Sow.list(plan.nursery || {}).filter(x => x.active !== false && !x.sheet && x.cells > 1 && !x.invalid);
      const cells = +c.tray || 72, spc = cropFig(eng, c, 'spc'), gh = cropFig(eng, c, 'gh');
      const traySel = h('select.yc-sel' + (cropFig(eng, c, 'tray').mine != null ? '.mine' : ''), { 'aria-label': `${name}: tray`, dataset: { hook: 'start-tray', sk: 'tray' },
        onchange: e => { const n = +e.target.value; const step = cropOps(eng, c, { tray: n }); if (!step) return; ui.pending = { key: 'tray', value: n, ops: step, label: `${name}: trays of ${n}`, said: movesSaid(movesOf(eng, ids, step)) }; ui.redraw(); } },
        [...new Set([...trays.map(x => x.cells), cells])].sort((a, b) => a - b).map(n => h('option', { value: n, selected: n === cells }, `${n} cells`)));
      const trayPend = ui.pending && ui.pending.key === 'tray' ? ui.pending : null, trayLine = h('p.sn-moves', { dataset: { hook: 'start-moves', key: 'tray' } });
      if (trayPend) { traySel.value = String(trayPend.value); trayLine.dataset.would = 'true'; trayLine.append(trayPend.said ? `Would move: ${trayPend.said} ` : 'Moves nothing on this plan. ', h('button.btn.small', { type: 'button', dataset: { hook: 'start-use' }, onclick: () => take('tray', trayPend.label, trayPend.ops) }, 'Use it'), ' ', h('button.btn.quiet.small', { type: 'button', onclick: () => { ui.pending = null; ui.redraw(); } }, 'Leave it')); }
      else if (ui.said && ui.said.key === 'tray') trayLine.append(ui.said.text, ' ', undoLink());
      const sowing = h('div.sn-part', { dataset: { hook: 'start-sowing' } }, h('h4', 'Sowing'),
        h('div.sn-f', h('span.sn-lab', 'Tray'), h('span.sn-ctl', traySel, h('span.sn-grey', 'thrown out after use')), trayLine),
        box({ key: 'spc', name, label: 'Seeds a cell', fig: spc, grey: spc.mine == null && lib ? 'the library’s' : null, min: 0.1, max: 50, ops: n => cropOps(eng, c, { spc: n }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'spc'), cropIds: ids }),
        germBox(), spareBox('seedlings raised over the plants the bed takes, as cells and seed.'),
        box({ key: 'days', name, label: 'Days from sowing to planting', unit: 'days', fig: { mine: gh.mine != null ? Math.round(gh.mine * 7) : null, fallback: gh.fallback != null ? Math.round(gh.fallback * 7) : null }, wide: true,
          grey: [gh.value != null ? `${num(gh.value, 1)} weeks` : null, keep('gh') ? `${plural(keep('gh'), 'planting')} keep${keep('gh') === 1 ? 's' : ''} its own` : null].filter(Boolean).join(' · '), min: 0, max: 728, whole: true, correctsDays: gh.mine != null && !Number.isInteger(gh.mine * 7) && !Number.isInteger(c.startDays), ops: n => cropOps(eng, c, { gh: n == null ? null : n / 7, startDays: n }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'days'), cropIds: ids }));
      // the offers: a new rule, shown with what it would move, and used only with "Use it"
      if (+c.spc > 1 && c.station !== true) UI.add(sowing, offer('station', [`a cell of ${num(+c.spc, 1)} is one station, so it needs `, h('b', 'no extra cells for germination'), '.'], cropOps(eng, c, { station: true }), ids, `${name}: a cell of ${num(+c.spc, 1)} is one station, no extra cells for germination`));
      if (c.station === true) sowing.append(h('p.sn-also', { dataset: { hook: 'start-station' } }, `A cell of ${num(+c.spc, 1)} is one station: no extra cells for germination. `, h('button.btn.quiet.small', { type: 'button', dataset: { hook: 'start-station-off' }, onclick: () => stage('station', `${name}: extra cells for germination again`, cropOps(eng, c, { station: null }), ids) }, 'Count germination again'), stagedLine('station')));
      if (OFFER_DAYS[c.id] && ((ui.said && ui.said.key === 'days-' + c.id) || (gh.mine == null && gh.value != null && Math.round(gh.value * 7) !== OFFER_DAYS[c.id]))) UI.add(sowing, offer('days-' + c.id, [`${name} is raised `, h('b', `${OFFER_DAYS[c.id] / 7} weeks`), ' from sowing to planting.'], cropOps(eng, c, { gh: OFFER_DAYS[c.id] / 7, startDays: OFFER_DAYS[c.id] }), ids, `${name}: ${OFFER_DAYS[c.id] / 7} weeks from sowing to planting`));
      left.append(sowing);

      // ── potting up, or sown straight into pots ──
      const potted = c.prop === 'potup' || c.prop === 'pot';
      const farmCapacity = eng.carrierSize(null), cropCapacity = c.carrierSize;
      const carrierSides = CARRIERS.map(n => [n, String(n), null]);
      if (cropCapacity != null) carrierSides.push(['farm', 'Use farm setting', null]);
      const carrier = choice({ key: 'carrier', sides: carrierSides, on: eng.potsPerCarrier(c), allowCurrent: cropCapacity == null, name, label: 'Pots a carrier', ops: n => cropOps(eng, c, { carrierSize: n === 'farm' ? null : n }), cropIds: ids, hook: 'start-carrier' });
      const size = +c.potSize > 0 ? +c.potSize : 4.5;
      const sizeSel = h('select.yc-sel' + (cropFig(eng, c, 'potSize').mine != null ? '.mine' : ''), { 'aria-label': `${name}: pot size`, dataset: { hook: 'start-pot-size' }, onchange: e => stage('potSize', `${name}: into ${e.target.value} in pots`, cropOps(eng, c, { potSize: +e.target.value }), ids, +e.target.value) },
        [...new Set([...POT_SIZES, size])].map(n => h('option', { value: n, selected: n === (ui.pending && ui.pending.key === 'potSize' ? ui.pending.value : size) }, `${n} in pots`)));
      const potEach = N.mixEach((plan.lrfNext || {}).supplies || null, 'pot-' + size);
      if (potted) {
        const wk = cropFig(eng, c, 'potUpWk');
        left.append(h('div.sn-part', { dataset: { hook: 'start-potup' } }, h('h4', 'Potting up'),
          c.prop === 'potup' ? tickRow(eng, c, true, name) : fixed('Sown', 'straight into pots'),
          c.prop === 'potup' ? box({ key: 'potUpWk', name, label: 'Pot up after', unit: 'days from sowing', wide: true, fig: { mine: wk.mine != null ? Math.round(wk.mine * 7) : null, fallback: wk.fallback != null ? Math.round(wk.fallback * 7) : 14 }, grey: wk.mine == null ? 'the planner’s' : null, min: 0, max: 364, whole: true, ops: n => cropOps(eng, c, { potUpWk: n == null ? null : n / 7 }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'potUpWk'), cropIds: ids }) : null,
          h('div.sn-f', h('span.sn-lab', 'Into'), h('span.sn-ctl', sizeSel, potEach != null ? h('span.sn-grey', `${num(potEach, 3)} cu ft a pot`) : null), stagedLine('potSize')),
          h('div.sn-f', { dataset: { field: 'carrier' } }, h('span.sn-lab', 'Pots a carrier', UI.help(h('div', term('Pots a carrier', 'Choose the carrying tray used for this crop on the bench and in Supplies. Each size has its own stock.')), null, null, { label: 'What pots a carrier means' })),
            h('span.sn-ctl', carrier.seg, h('span.sn-grey', cropCapacity ? 'crop setting' : farmCapacity ? 'farm setting' : `Bench ${eng.potsPerCarrier(c)} · Supplies ${((plan.lrfNext || {}).supplies || {}).pockets || N.POCKETS[0]}`)), carrier.line)));
      }
      // ── on the bench ──
      const rule = eng.coolRules().find(x => x.cropId === c.id);
      left.append(h('div.sn-part', { dataset: { hook: 'start-bench' } }, h('h4', 'On the bench'),
        fixed(['Days under heat first', UI.help(h('div', term('Days under heat first', 'days on the heated benches before the trays move to the unheated ones. Without a rule: under heat until hardening off.')), null, null, { label: 'What days under heat first means' })],
          rule && rule.after != null ? `${num(rule.after)} days` : 'until hardening', toSetup()),
        fixed('Hardening off', `${plural(eng.hardenDays(), 'day')}, the farm’s${towers ? '; none for towers' : ''}`, toSetup()),
        !potted ? tickRow(eng, c, false, name) : null));

      // ── for the towers: always rockwool ──
      if (towers) {
        const rw = cropFig(eng, c, 'rockwoolDays');
        left.append(h('div.sn-part', { dataset: { hook: 'start-towers' } }, h('h4', 'For the towers ', h('span.sn-grey', 'always rockwool')),
          fixed('Sheet', `${sheetOf().cells} cubes, on an open 10 × 20 tray`),
          fixed('Seeds a cube', `${num(spc.value || 1, 1)}, as a cell`),
          box({ key: 'rockwoolDays', name, label: 'Days in rockwool', unit: 'days', fig: rw, grey: rw.mine == null ? 'the library’s' : null, min: 0, max: 366, whole: true, ops: n => cropOps(eng, c, { rockwoolDays: n }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'rockwoolDays'), cropIds: ids }),
          fixed('Sheets', 'shared between sowings of one day, whole rows a variety')));
      }
    } else if (group === 'direct') {
      const ft = cropFig(eng, c, 'seedsFt');
      left.append(h('div.sn-part', { dataset: { hook: 'start-direct' } }, h('h4', 'Sown in place'),
        box({ key: 'seedsFt', name, label: 'Seeds a foot of row', fig: ft, grey: ft.mine == null && ft.fallback ? 'the library’s' : 'none: one seed a plant', min: 0, max: 1000, ops: n => cropOps(eng, c, { seedsFt: n }), uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'seedsFt'), cropIds: ids }),
        germBox()));
    } else if (group === 'bought') {
      left.append(h('div.sn-part', { dataset: { hook: 'start-bought' } }, h('h4', 'Bought in'),
        fixed('Planted from', MATERIAL[materialOf(c)] || 'plants'),
        materialOf(c) === 'plant' ? spareBox('plants bought over what the bed takes.', true) : fixed('Spare', 'none: one a station, as Seeds counts them')));
    } else left.append(livePart(eng, plan, c, name, pl));

    // ── its sowings, wanted then sown; its varieties ──
    if (group === 'nursery' || (group === 'direct' && t.n)) UI.add(right, sowingsPart(eng, c, t));
    UI.add(right, varietiesPart(eng, plan, c, group, name));
    if (group === 'live') UI.add(right, liveFacts(eng, c, pl));
    if (group === 'nursery' && bench.most) UI.add(right, h('div.sn-facts', h('h4', 'On the bench'), h('p.sn-line', { dataset: { hook: 'start-bench-said', most: String(Math.round(bench.most * 10) / 10) } },
      `Up to `, h('b', `${num(bench.most, 1)} tray spaces`), `, on ${UI.day(bench.on)}. On the bench ${UI.day(bench.from)} – ${UI.day(bench.to)}; hardening off ${plural(eng.hardenDays(), 'day')} before planting. Counted as Bench room and Supplies count them.`)));
    card.append(h('div.sn-cols', left, right));
    card.append(footOf(eng, plan, c, next, group));
    return card;
  }
  /** "Potted up": a square tick; pressing it says what it would move first. */
  function tickRow(eng, c, on, name) {
    const pend = ui.pending && ui.pending.key === 'potup' ? ui.pending : null, said = ui.said && ui.said.key === 'potup' ? ui.said : null;
    const step = cropOps(eng, c, { prop: on ? null : 'potup' });
    const line = h('p.sn-moves', { dataset: { hook: 'start-moves', key: 'potup' } });
    if (pend) { line.dataset.would = 'true'; line.append(pend.said ? `Would move: ${pend.said} ` : 'Moves nothing on this plan. ', h('button.btn.small', { type: 'button', dataset: { hook: 'start-use' }, onclick: () => take('potup', pend.label, pend.ops) }, 'Use it'), ' ', h('button.btn.quiet.small', { type: 'button', onclick: () => { ui.pending = null; ui.redraw(); } }, 'Leave it')); }
    else if (said) line.append(said.text, ' ', undoLink());
    const tick = h('input', { type: 'checkbox', checked: pend ? !on : on, dataset: { hook: 'start-potted' },
      onchange: () => { if (pend) { ui.pending = null; ui.redraw(); return; } ui.pending = { key: 'potup', ops: step, label: `${name}: ${on ? 'not potted up' : 'potted up'}`, said: movesSaid(movesOf(eng, [c.id], step)) }; ui.said = null; ui.redraw(); } });
    return h('div.sn-f', h('span.sn-lab', on ? 'Potted up' : 'Potting up'), h('span.sn-ctl', h('label.sn-tick', tick, on ? ' Yes' : ' Potted up'), h('span.sn-grey', on ? 'into pots before planting' : 'not potted up')), line);
  }
  /** A live tray: how one is sown, and the seed it comes to. */
  function livePart(eng, plan, c, name, pl) {
    const how = eng.liveSow(c), own = ownRec(plan, c.id), live = (own && own.liveSow) || {}, mine = !!own;
    const set = change => {
      if (!own) return null;
      const after = { ...own }, x = { ...(own.liveSow && typeof own.liveSow === 'object' ? own.liveSow : {}) };
      x.how = how.how;
      if ('how' in change) x.how = change.how;
      if ('cells' in change) { if (change.cells == null) delete x.cells; else x.cells = Math.round(change.cells); }
      if ('perCell' in change) { if (change.perCell == null) delete x.perCell; else x.perCell = Math.round(change.perCell * 10) / 10; }
      if ('grams' in change) after.seedG = change.grams == null ? null : Math.round(change.grams * 10) / 10;
      after.liveSow = x;
      return JSON.stringify(after) === JSON.stringify(own) ? null : [{ kind: 'crop', before: own, after }];
    };
    const sw = choice({ key: 'liveHow', sides: [['cells', 'Cells', mine ? null : 'This crop comes with the planner: add it to a demand plan to give it your own figures'], ['open', 'An open tray', mine ? null : 'This crop comes with the planner']], on: how.how, name, label: 'Sown in', ops: v => set({ how: v }), cropIds: [c.id], hook: 'start-live-how' });
    const blank = v => ({ mine: v != null && v !== '' && +v > 0 ? +v : null, fallback: null });
    const off = mine ? null : 'This crop comes with the planner: give it figures of its own by adding it to a demand plan on Nursery › Live trays.';
    const counted = how.set;
    return h('div.sn-part', { dataset: { hook: 'start-live' } }, h('h4', 'A tray'),
      h('div.sn-f', h('span.sn-lab', 'Sown in'), h('span.sn-ctl', sw.seg), sw.line),
      how.how === 'cells' ? [
        box({ key: 'liveCells', name, label: 'Cells a tray', fig: blank(live.cells), amber: !(live.cells > 0), grey: live.cells > 0 ? null : 'to say', min: 1, max: 1000, whole: true, ops: n => set({ cells: n }), cropIds: [c.id], off }),
        box({ key: 'livePerCell', name, label: 'Seeds a cell', fig: blank(live.perCell), amber: !(live.perCell > 0), grey: live.perCell > 0 ? null : 'to say', min: 0.1, max: 1000, ops: n => set({ perCell: n }), cropIds: [c.id], off })]
        : box({ key: 'liveGrams', name, label: 'Grams a tray', unit: 'g', fig: blank(c.seedG), amber: !(c.seedG > 0), grey: c.seedG > 0 ? null : 'to say', min: 0, max: 2000, ops: n => set({ grams: n }), cropIds: [c.id], off }),
      h('div.sn-f', h('span.sn-lab', 'Seed a tray'), h('span.sn-ctl', counted
        ? h('span.sn-fixed', { dataset: { hook: 'start-live-seed', counted: 'true' } }, how.how === 'cells' ? `${num(how.seeds, 1)} seeds` : `${num(how.grams, 1)} g`)
        : h('span.sn-word', { dataset: { hook: 'start-live-seed', counted: 'false' } }, h('i.sn-dot.amber'), 'not counted'))));
  }
  /** What a live tray's seed comes to over the season, once said. */
  function liveFacts(eng, c, pl) {
    const how = eng.liveSow(c), counted = how.set, trays = pl.racks.reduce((n, p) => n + ((eng.calc(p) || {}).len || 0), 0);
    return h('div.sn-facts', { dataset: { hook: 'start-live-facts' } }, h('h4', counted ? 'What it counts' : 'What it counts once said'),
      h('p.sn-line', counted ? `Seed for the season: ${how.how === 'cells' ? `${num(Math.ceil(how.seeds * trays))} seeds` : `${num(how.grams * trays, 1)} g`}, for ${plural(trays, 'live tray')}, on Seeds.` : `Once said, seed for the season is ${how.how === 'cells' ? 'cells a tray × seeds a cell' : 'grams a tray'} × ${plural(trays, 'tray')}, on Seeds. Pea shoots and anything in an open tray go by grams a tray.`));
  }
  /** Plantings of a sown crop bought in by their own choice: how many, and the plants to buy. */
  function boughtOwn(eng, pl) {
    const list = pl.beds.filter(p => (eng.calc(p) || {}).boughtIn === true);
    return list.length ? [' · ', h('b', plural(list.length, 'planting')), ' bought in: ', h('b', plural(list.reduce((n, p) => n + (eng.calc(p).buy || 0), 0), 'plant')), ' to buy'] : null;
  }
  function comesLine(eng, c, pl, t, bench) {
    const g = groupOf(c), year = +eng.plan.settings.year, p = h('p.sn-comes', { dataset: { hook: 'start-comes', seeds: String(t.seeds), cells: String(t.cells), mix: String(Math.round(t.mix * 100) / 100) } });
    if (!pl.all.length) { p.append(`Not planted in ${year}: nothing is sown.`); return p; }
    if (g === 'live') {
      const how = eng.liveSow(c), trays = pl.racks.reduce((n, q) => n + ((eng.calc(q) || {}).len || 0), 0), each = N.mixEach((eng.plan.lrfNext || {}).supplies || null, 'open');
      UI.add(p, h('b', plural(trays, 'live tray')), ' of 10 × 20 · seed ', how.set ? h('b', how.how === 'cells' ? `${num(Math.ceil(how.seeds * trays))} seeds` : `${num(how.grams * trays, 1)} g`) : [h('b', 'not counted'), ' until a tray is said below'], each != null ? [' · ', h('b', cuft(trays * each)), ' of mix'] : null, ' · on the heated benches from sowing to sale');
      return p;
    }
    if (g === 'bought') {
      const buy = pl.all.reduce((n, q) => n + ((eng.calc(q) || {}).buy || 0), 0), bulbs = pl.all.reduce((n, q) => n + ((eng.calc(q) || {}).bulbs || 0), 0);
      UI.add(p, 'Bought in · ', h('b', buy ? plural(buy, 'plant') : bulbs ? `${num(bulbs)} ${MATERIAL[materialOf(c)] || 'bulbs'}` : 'nothing to buy'), buy ? ' (the beds’ and their spare)' : '', ' · nothing sown, no trays and no bench room');
      return p;
    }
    if (g === 'direct') { UI.add(p, 'Sown in place · ', h('b', `${num(pl.all.reduce((n, q) => n + ((eng.calc(q) || {}).seeds || 0), 0))} seeds`), ` for ${plural(pl.all.length, 'planting')} · no trays and no bench room`, boughtOwn(eng, pl)); return p; }
    const gh = +c.gh || 0, rw = Math.round(+c.rockwoolDays || 0);
    UI.add(p, 'Sown ', h('b', gh ? `${num(gh, 1)} weeks` : 'the day'), ' before planting', pl.towers.length ? [', ', h('b', `${rw} days`), ' for the towers'] : null,
      t.trays.length ? [' · ', h('b', traysSaid(t))] : null, t.sheets ? [t.trays.length ? ' and ' : ' · ', h('b', plural(t.sheets, 'rockwool sheet'))] : null,
      t.pots ? [', potted up into ', h('b', `${num(t.pots)} pots of ${t.size} in`), ' · ', h('b', `${plural(t.carriers, 'carrier')} of ${t.per} at the most`)] : null,
      ' · ', h('b', `${num(t.seeds)} seeds`), t.mix ? [' · ', h('b', cuft(t.mix)), ' of mix'] : null, boughtOwn(eng, pl),
      bench.most ? [' · up to ', h('b', `${num(bench.most, 1)} tray spaces`), `, ${UI.day(bench.from)} – ${UI.day(bench.to)}`] : null);
    return p;
  }
  function sowingsPart(eng, c, t) {
    const list = of(eng, c.id).batches;
    if (!list.length) return h('div.sn-facts', h('h4', 'Its sowings, wanted then sown'), h('p.sn-line', 'None: nothing of it is sown in the nursery.'));
    const row = b => {
      const v = b.varietyId ? eng.variety(b.varietyId) : null, unit = b.wool ? 'cubes' : 'cells', tray = b.wool ? (Math.abs(b.trays - 0.5) < 1e-9 ? '½ sheet' : `${traysWord(b.trays)} sheet${Math.abs(b.trays - 1) < 1e-9 ? '' : 's'}`) : `${traysWord(b.trays)} tray${Math.abs(b.trays - 1) < 1e-9 ? '' : 's'}`;
      return h('div.sn-sow', { dataset: { hook: 'start-sowing-row', batch: b.ids.join(','), sow: b.sow ? root.LRFEngine.d2s(b.sow) : '', wanted: String(b.wanted), cells: String(b.cells), trays: String(b.trays), seeds: String(b.seeds), pots: String(b.pots) } },
        h('span.sn-d', b.sow ? UI.day(b.sow) : '—'),
        root.LRFThumbs.el(v ? { varietyId: v.id, color: eng.cropColor(c), label: v.name, size: 24 } : { cropId: c.id, color: eng.cropColor(c), label: c.name, size: 24, cls: 'faint' }),
        h('span.sn-v', v ? v.name : 'No variety chosen'),
        h('span.sn-ws', `${num(b.wanted)} wanted → `, h('b', `${num(b.cells)} ${unit}`), b.pots ? ` · ${num(b.pots)} pots` : b.pot ? '' : ` · ${tray}`));
    };
    const shown = list.slice(0, 6), more = list.slice(6);
    return h('div.sn-facts', { dataset: { hook: 'start-sowings', n: String(list.length) } }, h('h4', 'Its sowings, wanted then sown'), shown.map(row),
      more.length ? h('details.sn-more', h('summary', `and ${plural(more.length, 'more sowing')}`), more.map(row)) : null,
      h('p.sn-line', { dataset: { hook: 'start-sowings-all' } }, 'In all ', h('b', `${num(t.wanted)} wanted → ${num(t.cells)} ${t.sheets && !t.trays.length ? 'cubes' : t.sheets ? 'cells and cubes' : 'cells'}`), t.trays.length ? `, ${traysSaid(t)}` : '', t.sheets ? `, ${plural(t.sheets, 'sheet')}` : '', t.pots ? `; ${num(t.pots)} pots (the plants and their spare)` : '', `, ${num(t.seeds)} seeds.`));
  }
  function varietiesPart(eng, plan, c, group, name) {
    const list = eng.varietiesOf(c.id).filter(v => v.active !== false && !v.deleted);
    if (!list.length || group === 'live') return null;
    const sowings = new Map();
    for (const b of of(eng, c.id).batches) if (b.varietyId) sowings.set(b.varietyId, (sowings.get(b.varietyId) || 0) + 1);
    const sorted = list.slice().sort((a, b) => (sowings.get(b.id) || 0) - (sowings.get(a.id) || 0) || String(a.name).localeCompare(String(b.name)));
    const crop = { germ: cropFig(eng, c, 'germ', farmGerm(plan)).value, days: Math.round((+c.gh || 0) * 7), spc: +c.spc || 1 };
    const row = v => {
      const vd = varietyDays(v), own = { germ: +v.germ > 0 ? +v.germ : null, days: vd.split ? -1 : vd.one, spc: +v.spc > 0 ? +v.spc : null }, any = Object.values(own).some(x => x != null), open = any || ui.own.has(v.id), vn = v.name;
      const says = Object.entries(own).filter(([, x]) => x != null).map(([k]) => ({ germ: 'germination', days: 'days to planting', spc: 'seeds a cell' })[k]);
      const boxes = !open ? null : h('div.sn-own', { dataset: { hook: 'start-variety-figures', variety: v.id } },
        box({ key: `v|${v.id}|germ`, name: vn, label: 'Germination', unit: '%', fig: { mine: own.germ, fallback: crop.germ }, grey: own.germ == null ? 'the crop’s' : null, min: 0.1, max: 100, ops: n => varietyOps(eng, v, 'germ', n), uses: usesOf(eng, eng.plan.plantings.filter(p => p.varietyId === v.id && p.cropId === c.id), 'germ'), cropIds: [c.id] }),
        group === 'nursery' && vd.split ? h('div.sn-f', { dataset: { hook: 'start-variety-days-split', variety: v.id } }, h('span.sn-lab', 'Days from sowing to planting'), h('span.sn-ctl', h('span.sn-fixed', `${vd.field == null ? 'the crop’s' : `${vd.field} days`} in the field, ${vd.greenhouse == null ? 'the crop’s' : `${vd.greenhouse} days`} under cover`), h('span.sn-grey', 'differs by place: not set here'))) : null,
        group === 'nursery' && !vd.split ? box({ key: `v|${v.id}|days`, name: vn, label: 'Days from sowing to planting', unit: 'days', wide: true, fig: { mine: own.days, fallback: crop.days }, grey: own.days == null ? 'the crop’s' : null, min: 0, max: 728, whole: true, correctsDays: ['field', 'greenhouse'].some(k => { const p = (v.environmentDefaults || {})[k]; return p && p.gh != null && !Number.isInteger(p.gh * 7) && !Number.isInteger(p.startDays); }), ops: n => varietyOps(eng, v, 'days', n), uses: usesOf(eng, eng.plan.plantings.filter(p => p.varietyId === v.id && p.cropId === c.id), 'days'), cropIds: [c.id] }) : null,
        group === 'nursery' ? box({ key: `v|${v.id}|spc`, name: vn, label: 'Seeds a cell', fig: { mine: own.spc, fallback: crop.spc }, grey: own.spc == null ? 'the crop’s' : null, min: 0.1, max: 50, ops: n => varietyOps(eng, v, 'spc', n), uses: usesOf(eng, eng.plan.plantings.filter(p => p.varietyId === v.id && p.cropId === c.id), 'spc'), cropIds: [c.id] }) : null);
      return h('div.sn-vrow', { dataset: { hook: 'start-variety', variety: v.id, own: String(any) } },
        h('div.row', root.LRFThumbs.el({ varietyId: v.id, color: eng.cropColor(c), label: vn, size: 40 }),
          h('div', h('span.row-name', vn), h('span.row-detail', `${plural(sowings.get(v.id) || 0, 'sowing')}${says.length ? ` · its own ${says.join(', ')}` : ''}`)),
          h('span.row-word', open ? (any ? '' : h('span.sn-grey', 'follows the crop')) : h('button.btn.quiet.small', { type: 'button', dataset: { hook: 'start-variety-own', variety: v.id }, onclick: () => { ui.own.add(v.id); ui.redraw(); } }, 'Its own figures…'))),
        boxes);
    };
    const shown = sorted.slice(0, 6), more = sorted.slice(6);
    return h('div.sn-facts', { dataset: { hook: 'start-varieties' } }, h('h4', 'Varieties'), shown.map(row),
      more.length ? h('details.sn-more', { open: more.some(v => ui.own.has(v.id)) }, h('summary', `and ${plural(more.length, 'more variety', 'more varieties')}`), more.map(row)) : null);
  }
  function footOf(eng, plan, c, next, group) {
    const nextCrop = next ? eng.crop(next) : null, year = +plan.settings.year, looked = lookedOf(plan, c.id) === year;
    const live = group === 'live' ? eng.liveSow(c) : null, still = live && !live.set ? (live.how === 'cells' ? 'cells a tray, seeds a cell' : 'grams a tray') : '';
    return h('div.sn-foot',
      h('button.btn.primary', { type: 'button', dataset: { hook: 'start-next', next: next || '' }, title: `Ticks ${c.name} as looked at for ${year}${nextCrop ? `, and opens ${nextCrop.name}` : ''}. Nothing else changes.`,
        onclick: () => { ui.pending = null; ui.said = null; if (!looked) App.setStartLooked(c.id, true); if (next) ui.cur = next; ui.redraw(); } }, nextCrop ? `Looks right. Next: ${nextCrop.name}` : 'Looks right.'),
      looked ? h('button.btn.quiet.small', { type: 'button', dataset: { hook: 'start-untick' }, onclick: () => App.setStartLooked(c.id, false) }, 'Take the tick off') : null,
      h('span.sn-still', { dataset: { hook: 'start-still' } }, still ? [h('i.sn-dot.amber'), `Still empty: ${still}.`] : 'Nothing moves until you change a box.'),
      h('span.yc-key.sn-key', h('i'), 'the farm’s or the library’s', h('i.mine'), 'yours'));
  }
  /** The farm's own figures: every crop counts by them unless it says otherwise. */
  function farmCard(eng, plan) {
    const all = eng.crops().filter(c => !c.micro), ids = all.map(c => c.id);
    const ownGerm = all.filter(c => { const r = ownRec(plan, c.id), l = libCrop(c.id); return r && r.germ != null && (!l || r.germ !== l.germ); });
    const ownSpare = all.filter(c => { const r = ownRec(plan, c.id); return r && r.spare != null; });
    const vGerm = eng.plan.varieties.filter(v => v.active !== false && !v.deleted && +v.germ > 0);
    const supplies = (plan.lrfNext || {}).supplies || {}, onP = eng.carrierSize(null);
    const carrier = choice({ key: 'pockets', sides: CARRIERS.map(n => [n, String(n), null]), on: onP, name: 'Every crop', label: 'Pots a carrier', ops: n => suppliesOps(plan, n), cropIds: ids, hook: 'start-pockets' });
    const card = h('section.yc-card.sn-card', { dataset: { hook: 'start-card', crop: FARM } },
      h('header.yc-head', h('span.thumb.key.sn-farm', { style: { '--thumb': '40px' } }), h('div', h('h3', { dataset: { hook: 'start-name' } }, 'Every crop'), h('p.yc-where', `The farm’s figures · ${plural(all.length - ownGerm.length, 'crop')} use them as they are`)), h('p.yc-state', 'The farm')),
      h('p.sn-comes', { dataset: { hook: 'start-comes' } }, ...(farmSpareSet(plan) ? ['Every sowing is counted for ', h('b', `${num(farmGerm(plan), 1)}% germination`), ' and ', h('b', `${num(farmSpare(plan), 1)}% spare`), ', unless its crop or variety says otherwise.']
        : ['Every sowing is counted for ', h('b', `${num(farmGerm(plan), 1)}% germination`), ', unless its crop or variety says otherwise. The farm’s spare is not set: sowing counts ', h('b', '10%'), ', plants bought in ', h('b', 'none'), '.'])),
      h('div.sn-cols', h('div.sn-col', h('div.sn-part', h('h4', 'For every crop'),
        box({ key: 'farmGerm', name: 'Every crop', label: 'Germination', unit: '%', fig: { mine: plan.settings.germ > 0 ? +plan.settings.germ : null, fallback: 85 }, farm: true, grey: plan.settings.germ > 0 ? null : 'not set: 85 is counted', min: 0.1, max: 100, ops: n => settingsOps(plan, { germ: n }), cropIds: ids,
          help: h('div', term('Germination', 'the share of seeds that come up, for every crop that does not say its own.')) }),
        box({ key: 'farmSpare', name: 'Every crop', label: 'Spare', unit: '%', fig: { mine: farmSpareSet(plan) ? +plan.settings.buffer : null, fallback: null }, farm: true, grey: farmSpareSet(plan) ? 'seedlings over the plants the bed takes' : 'not set: sowing counts 10%, plants bought in none', min: 0, max: 100, ops: n => settingsOps(plan, { buffer: n }), cropIds: ids,
          help: h('div', term('Spare', 'seedlings raised over the plants the bed takes, for every crop that does not say its own; plants bought in take the same.')) }),
        h('div.sn-f', { dataset: { field: 'pockets' } }, h('span.sn-lab', 'Pots a carrier', UI.help(h('div', term('Pots a carrier', 'Default carrying tray size for Bench room and Supplies. A crop’s own choice takes precedence. Stock is counted separately for each size.')), null, null, { label: 'What pots a carrier means' })),
          h('span.sn-ctl', carrier.seg, h('span.sn-grey', onP ? 'farm setting' : `Choose a size for both. Bench defaults to 10 · Supplies ${supplies.pockets || N.POCKETS[0]}.`)),
          carrier.line),
        fixed('Hardening off', plural(eng.hardenDays(), 'day'), toSetup()))),
      h('div.sn-col', h('div.sn-facts', h('h4', 'Crops with figures of their own'), h('p.sn-line', { dataset: { hook: 'start-own' } },
        'Germination: ', ownGerm.length || vGerm.length ? [...ownGerm.map(c => `${c.name} ${num(+c.germ, 1)}%`), ...vGerm.map(v => `${v.name} (${(eng.crop(v.cropId) || {}).name || 'variety'}) ${num(+v.germ, 1)}%`)].join(', ') : 'none', '. Spare: ',
        ownSpare.length ? ownSpare.map(c => `${c.name} ${num(+c.spare, 1)}%`).join(', ') : 'none', '.')))),
      h('div.sn-foot', h('button.btn.primary', { type: 'button', dataset: { hook: 'start-next', next: ui.order[0] || '' }, onclick: () => { ui.pending = null; ui.said = null; ui.cur = ui.order[0] || null; ui.redraw(); } }, 'Done')));
    return card;
  }

  // ───────────────────────── the list ─────────────────────────
  const lookedOf = (plan, id) => { const a = plan.assumptions && plan.assumptions.nursery && plan.assumptions.nursery[id]; return a ? a.looked : null; };
  /** One short line for a crop: how it is started, in a few words. `warn`: amber; `mine`: a figure of his own. */
  function shortOf(eng, plan, c) {
    const g = groupOf(c), own = ownRec(plan, c.id), lib = libCrop(c.id), mine = !!own && (!lib || ['tray', 'spc', 'germ', 'gh', 'spare', 'prop', 'potUpWk', 'perCarrier', 'carrierSize', 'station', 'rockwoolDays', 'seedsFt'].some(k => own[k] != null && own[k] !== lib[k]));
    if (g === 'live') { const how = eng.liveSow(c); return { text: how.set ? `live · ${how.how === 'cells' ? `${num(how.seeds, 1)} seeds a tray` : `${num(how.grams, 1)} g a tray`}` : 'not counted · live', warn: !how.set, mine }; }
    if (g === 'bought') return { text: materialOf(c) === 'plant' ? `plants · ${num(cropFig(eng, c, 'spare', boughtSpare(plan)).value, 1)}% spare` : MATERIAL[materialOf(c)] || 'bought in', mine };
    if (g === 'direct') return { text: `direct${+c.seedsFt > 0 ? ` · ${num(+c.seedsFt, 1)} a foot` : ''}`, mine };
    const towers = (eng.plan.plantings || []).some(p => p.cropId === c.id && eng.isTower(eng.bedOf(p.bedId)));
    const offered = (+c.spc > 1 && c.station !== true) || (OFFER_DAYS[c.id] && Math.round((+c.gh || 0) * 7) !== OFFER_DAYS[c.id] && !(own && own.gh != null));
    // what is offered comes first, so that it is never the part cut short in a narrow list
    return { text: `${offered ? 'offered · ' : ''}${c.prop === 'pot' ? 'pot' : 'plug ' + (+c.tray || 72)}${c.prop === 'potup' ? ' → pot' : ''}${+c.spc > 1 ? ` · ${num(+c.spc, 1)} seeds` : ''}${towers ? ` · towers ${Math.round(+c.rockwoolDays || 0)} d` : ` · ${Math.round((+c.gh || 0) * 7)} d`}`, warn: !!offered, mine };
  }
  /** The crops of the list, in the order they are walked: by group, then by how much of each is planted. */
  function arrange(eng, plan, scope, list, q) {
    const used = new Map();
    for (const p of plan.plantings) used.set(p.cropId, (used.get(p.cropId) || 0) + 1);
    const mine = c => root.LRFPanels.isMine(c, used, c.micro ? [] : eng.varietiesOf(c.id), list);
    const all = eng.crops().filter(c => !eng.isCoverCrop(c)), shown = all.filter(c => scope !== 'mine' || mine(c));
    const hit = c => !q || String(c.name).toLowerCase().includes(q) || eng.varietiesOf(c.id).some(v => String(v.name).toLowerCase().includes(q));
    const groups = GROUPS.map(([id, words]) => ({ id, words, crops: shown.filter(c => groupOf(c) === id && hit(c)).sort((a, b) => (used.get(b.id) || 0) - (used.get(a.id) || 0) || String(a.name).localeCompare(String(b.name))) }));
    return { groups, mine: all.filter(mine).length, all: all.length, shown };
  }
  function nextAfter(plan, order, id) {
    const year = +plan.settings.year, at = order.indexOf(id), open = x => x !== id && lookedOf(plan, x) !== year;
    return order.slice(at + 1).find(open) || order.slice(0, Math.max(0, at)).find(open) || null;
  }

  // ───────────────────────── drawing ─────────────────────────
  /** ctx: { eng, plan, q, list, scope, redraw }. Returns what the page's header needs: the counts and the line of figures. */
  function render(ctx) {
    const { eng, plan, q, list, scope } = ctx, host = $('snHost'), year = +plan.settings.year;
    ui.redraw = ctx.redraw;
    sayingStill();
    const made = arrange(eng, plan, scope, list, q), order = made.groups.flatMap(g => g.crops.map(c => c.id));
    ui.order = order;
    if (ui.cur !== FARM && !order.includes(ui.cur)) { ui.cur = order.find(id => lookedOf(plan, id) !== year) || order[0] || FARM; ui.pending = null; ui.said = null; }
    const looked = order.filter(id => lookedOf(plan, id) === year).length;
    const item = c => {
      const s = shortOf(eng, plan, c), done = lookedOf(plan, c.id) === year;
      return h('li', h('button.yc-item' + (done ? '.done' : ''), { type: 'button', dataset: { hook: 'start-item', crop: c.id, group: groupOf(c) }, 'aria-current': c.id === ui.cur ? 'true' : null, title: `${c.name}${done ? `: looked at for ${year}` : ''}`,
        onclick: () => { if (ui.cur !== c.id) { ui.pending = null; ui.said = null; } ui.cur = c.id; ui.redraw(); } },
        h('i.yc-tick', { 'aria-hidden': 'true' }, done ? '✓' : ''), root.LRFThumbs.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 20, cls: 'key' }), h('b', c.name), h('small' + (s.warn ? '.warn' : s.mine ? '.mine' : ''), s.text)));
    };
    const side = h('aside.yc-side', { 'aria-label': 'Every crop, by how it is started', dataset: { hook: 'start-list' } },
      h('div.yc-prog', { dataset: { hook: 'start-meter', looked: String(looked), of: String(order.length) } }, h('p', h('b', `${num(looked)} of ${num(order.length)}`), ` looked at for ${year}`),
        h('div.yc-meter', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': order.length, 'aria-valuenow': looked, 'aria-label': `Crops looked at for ${year}` }, h('i', { style: { width: `${order.length ? Math.round(looked / order.length * 1000) / 10 : 0}%` } }))),
      h('ol.yc-list',
        h('li', h('button.yc-item.sn-every', { type: 'button', dataset: { hook: 'start-every' }, 'aria-current': ui.cur === FARM ? 'true' : null, onclick: () => { ui.pending = null; ui.said = null; ui.cur = FARM; ui.redraw(); } },
          h('i.yc-tick', { 'aria-hidden': 'true' }), h('span.thumb.key.sn-farm', { style: { '--thumb': '20px' } }), h('b', 'Every crop'), h('small', `${num(farmGerm(plan), 1)}% · ${farmSpareSet(plan) ? `${num(farmSpare(plan), 1)}% spare` : 'spare not set'}`))),
        made.groups.filter(g => g.crops.length).map(g => [h('li.yc-sec', { dataset: { hook: 'start-group', group: g.id, n: String(g.crops.length) } }, g.words), g.crops.map(item)]),
        !order.length ? h('li.yc-sec', q ? 'No crop matches.' : 'No crops yet.') : null));
    const c = ui.cur === FARM ? null : eng.crop(ui.cur);
    const main = ui.cur === FARM || !c ? farmCard(eng, plan) : cardFor(eng, plan, c, nextAfter(plan, order, c.id));
    main.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.pending) { ui.pending = null; ui.redraw(); } });
    const keepScroll = host.querySelector('.yc-list') ? host.querySelector('.yc-list').scrollTop : 0;
    const active = document.activeElement, was = active && host.contains(active) && active.dataset ? active.dataset.sk : null;
    clear(host).append(side, main);
    const listEl = host.querySelector('.yc-list'), cur = listEl.querySelector('[aria-current="true"]');
    listEl.scrollTop = keepScroll;
    if (cur) { const a = cur.offsetTop - listEl.offsetTop, z = a + cur.offsetHeight; if (a < listEl.scrollTop) listEl.scrollTop = Math.max(0, a - 34); else if (z > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = z - listEl.clientHeight + 8; }
    // the pointer for typing goes back to the box it was in, or on to the next box after a Tab
    const want = ui.focus || was;
    ui.focus = null;
    if (want) {
      const boxes = [...main.querySelectorAll('input[data-sk]')], key = typeof want === 'object' ? want.after : want, at = boxes.findIndex(el => el.dataset.sk === key);
      // after the last box, Tab lands on the card's own button: the pointer stays in the card
      const to = typeof want === 'object' ? boxes[at + 1] || main.querySelector('.sn-foot .btn.primary') : boxes[at];
      if (to) { to.focus({ preventScroll: true }); if (to.select) to.select(); }
    }
    // the page's line of figures
    const counts = Object.fromEntries(GROUPS.map(([id]) => [id, made.shown.filter(x => groupOf(x) === id).length]));
    const unsaid = made.shown.filter(x => groupOf(x) === 'live' && !eng.liveSow(x).set).length;
    return { mine: made.mine, all: made.all, figs: [['Sown in the nursery', plural(counts.nursery, 'crop')], ['Live trays', num(counts.live)], ['Direct', num(counts.direct)], ['Bought in', num(counts.bought)],
      farmSpareSet(plan) ? ['Germination', `${num(farmGerm(plan), 1)}%`, 'spare', `${num(farmSpare(plan), 1)}%`, 'unless a crop says'] : ['Germination', `${num(farmGerm(plan), 1)}%`, 'spare not set: sowing', '10%', 'plants bought in', '0%'], unsaid ? ['Live trays with seed not counted', num(unsaid)] : null].filter(Boolean) };
  }
  /** Open the card of one crop (from Seeds' "Edit crop", or a script). */
  function open(id) { if (!id) return; if (ui.cur !== id) { ui.pending = null; ui.said = null; } ui.cur = id; }
  function reset() { ui.pending = null; ui.said = null; ui.own.clear(); }

  root.LRFStartCard = { render, open, reset, current: () => ui.cur, groupOf, movesOf, movesSaid, benchOfMany, state: ui, FARM };
})(window);
