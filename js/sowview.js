/* Little River Farm Planner — the Week view (it began as the Sowing view, and its sowing lists are as they were).
 *
 * The week's work, set out as the acts the grower performs. First what is sown: one batch of plug trays filled
 * for several beds, rockwool for the towers, the week's live trays, a variety drilled into its beds. Then the rest
 * of a planting's jobs: pot up, harden off, plant out (bulbs, canes and bought-in plants with the transplants),
 * move out. Tick what was done and record it in one step, on the day it was really done: each planting is dated,
 * seed comes off stock, and a transplant sown or hardened off late goes out as many days later (js/week.js).
 *
 * On a phone this view is the whole page: the week, and nothing else. The same list prints as a sheet.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, SL = root.LRFSeedLib, T = root.LRFTrays, Thumbs = root.LRFThumbs, Bench = root.LRFBench, Sow = root.LRFSowing, Week = root.LRFWeek;
  const { h, clear, add, num, day } = UI;
  const $ = id => document.getElementById(id);
  const d = iso => E.s2d(iso);
  const dayName = date => UI.dayLong(date).replace(/, \d{4}$/, '');
  const round6 = n => Math.round(n * 1e6) / 1e6;
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  /** Seed as it is handled: a count, or a weight in grams up to a pound and pounds beyond. */
  const amountText = (n, unit) => unit === 'g' ? (!n ? '0 g' : n < 453.6 ? `${num(n, n < 10 ? 1 : 0)} g` : `${num(n / 453.592, 1)} lb`) : unit && unit !== 'seeds' ? `${num(n)} ${n === 1 ? unit.replace(/s$/, '') : unit}` : `${num(n)} seed${n === 1 ? '' : 's'}`;

  // In the order the sections are drawn.
  const KINDS = [
    ['plugs', 'Seedling trays', 'Plug trays sown in the greenhouse for transplanting. Plantings of one variety with one schedule are sown as one batch.'],
    ['rockwool', 'Tower seedlings', 'Rockwool sown for the towers.'],
    ['live', 'Live trays', 'Whole trays sown to the weekly demand on the Trays view.'],
    ['direct', 'Sown in the ground', 'Seed that goes straight into a bed or a container.']
  ];
  // The rest of a planting's jobs, in the order they are drawn after the sowing.
  const JOBS = [
    ['potup', 'Pot up', 'Seedlings moved on from their plug trays into pots.'],
    ['harden', 'Harden off', 'Trays moved out of the greenhouse ahead of planting.'],
    ['plant', 'Plant out', 'Transplants going into beds, towers and containers, and what is planted, not sown: bulbs, canes, bought-in plants.'],
    ['move', 'Move out', 'Sheltered containers going out to where they stand for the season.']
  ];
  const DID = { potup: 'potted up', harden: 'hardened off', plant: 'planted', move: 'moved out' };
  const ui = { sel: new Set(), qty: new Map(), filter: 'all', earlier: false, date: null, follow: true, span: 1 };
  const SPANS = [[1, 'Week'], [2, '2 weeks'], [4, '4 weeks']];
  let dirty = true;
  const isPhone = () => document.body.classList.contains('phone');
  const days = n => `${num(n)} day${n === 1 ? '' : 's'}`;

  // ── the other jobs of the week: pot up, harden off, plant out, move out (worked out in js/week.js) ──
  const jobCache = new WeakMap();
  function jobs() {
    const eng = App.state.engine;
    if (!jobCache.has(eng)) jobCache.set(eng, Week.lines(eng, App.state.plan, App.planYear()));
    return jobCache.get(eng);
  }

  // ── the lines of the list, worked out once per plan state ──
  const cache = new WeakMap();
  /**
   * One line is one act of sowing: a shared batch of plug trays, a tower sowing, a tray batch, or one variety
   * drilled into one garden on one day. It carries the plantings it is for, and what each of them would record.
   */
  function figures() {
    const eng = App.state.engine;
    if (cache.has(eng)) return cache.get(eng);
    const plan = App.state.plan, year = String(App.planYear()), lines = new Map(), demand = new Map((plan.liveTrayPlans || []).map(p => [p.id, p]));
    for (const p of plan.plantings || []) {
      if (String(p.date).slice(0, 4) !== year) continue;
      const s = SL.sowing(eng, p);
      if (!s || !(s.unit === 'seeds' || s.unit === 'g')) continue;
      const r = s.r, planned = s.planned;
      if (r.b.active === false || r.g.active === false || !E.validDate(planned)) continue;
      const w = r.sowing, kind = r.rack ? 'live' : s.kind !== 'sow' ? 'direct' : r.tw ? 'rockwool' : 'plugs', iso = E.d2s(planned);
      // a batch is known by its first planting, so the line keeps its name when recording it changes the batch's own dates
      const key = kind === 'live' ? 'live:' + p.id : kind === 'direct' ? ['direct', s.key, iso, r.g.id].join('|') : w ? 'batch:' + (w.memberIds || [p.id])[0] + '|' + iso : 'own:' + p.id;
      let line = lines.get(key);
      if (!line) {
        lines.set(key, line = { key, kind, date: iso, week: T.monday(iso), crop: r.c, variety: s.variety, unit: s.unit, stockUnit: s.stockUnit, stockKey: s.key, members: [], amount: 0, estimate: 0,
          batch: w ? (w.batch || w) : null, garden: r.g, field: r.field, demand: p.liveTray ? demand.get(p.liveTray.planId) : null });
      }
      line.members.push({ p, s, r });
      line.amount = round6(line.amount + s.amount);
      if (!s.done && !s.sown) line.estimate = round6(line.estimate + s.estimate);
    }
    const list = [...lines.values()];
    for (const line of list) {
      const open = line.members.filter(m => !m.s.done && !m.s.sown), done = line.members.filter(m => m.s.done);
      line.open = open; line.state = !open.length ? 'done' : open.length === line.members.length ? 'open' : 'part';
      line.doneOn = done.length ? done.map(m => m.s.done).sort().pop() : null;
      line.name = line.variety ? line.variety.name : T.short(line.crop.name);
      line.sub = line.kind === 'live' ? (line.demand ? line.demand.name : '') : line.variety ? T.short(line.crop.name) : 'no variety chosen';
      line.trays = line.kind === 'live' ? line.members.reduce((n, m) => n + m.r.len, 0) : line.batch && line.batch.medium !== 'pots' ? line.batch.trays : 0;
    }
    const kindAt = l => KINDS.findIndex(k => k[0] === l.kind), groupOf = l => (l.batch && l.batch.trayGroup) || null;
    // Rockwool sheets are shared by different crops, so those lines keep together by their sheets first; everything else by crop.
    const lead = l => { const g = groupOf(l); return g && g.medium === 'rockwool' ? '\u0000' + g.id : String(l.crop.name); };
    list.sort((a, b) => a.date.localeCompare(b.date) || kindAt(a) - kindAt(b) || lead(a).localeCompare(lead(b)) || String(a.crop.name).localeCompare(String(b.crop.name)) || String(groupOf(a) ? groupOf(a).id : '').localeCompare(String(groupOf(b) ? groupOf(b).id : '')) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    // Varieties that share trays are filled in the order listed, so each line can be told its tray and rows.
    const fills = new Map();
    for (const line of list) {
      const g = groupOf(line);
      line.set = line.members.some(m => m.p.sowOn && !m.s.done && !m.s.sown);
      if (!g || !Number.isInteger(line.batch.rowsSown) || !(g.tray.rows > 0)) continue;
      const f = fills.get(g) || { at: 0, lines: [] };
      line.group = g; line.slot = f.lines.length; line.rowsFrom = f.at; line.rowsTo = f.at + line.batch.rowsSown; line.groupLines = f.lines;
      f.at = line.rowsTo; f.lines.push(line); fills.set(g, f);
    }
    const weeks = [...new Set(list.map(l => l.week))].sort();
    const out = { list, weeks, total: list.length, done: list.filter(l => l.state === 'done').length };
    cache.set(eng, out);
    return out;
  }

  // ── what a line says ──
  /** How the sowing is done: rows of a tray, a number of trays, or rows in the ground. */
  function howText(line) {
    if (line.kind === 'live') { const how = App.state.engine.liveSow(line.crop), g = !how.set ? '' : how.how === 'cells' ? ` · ${num(how.cells)} cells, ${num(how.perCell, 1)} seed${how.perCell === 1 ? '' : 's'} a cell` : ` · ${num(how.grams, 1)} g a tray`; return `${plural(line.trays, 'tray')}${g}`; }
    if (line.kind === 'direct') {
      const rowFt = line.members.reduce((n, m) => n + (m.r.ct ? 0 : m.r.rows * m.r.physicalLength), 0), crates = line.members.reduce((n, m) => n + (m.r.ct ? m.r.len : 0), 0);
      return [rowFt ? `${num(rowFt)} row-ft` : '', crates ? plural(crates, 'container') : ''].filter(Boolean).join(' · ') || plural(line.members.reduce((n, m) => n + m.r.plants, 0), 'plant');
    }
    const b = line.batch;
    if (!b) return `${num(line.members.reduce((n, m) => n + m.r.cells, 0))} cells`;
    if (b.medium === 'pots') return `${plural(b.cells, 'pot')}`;
    const rows = b.mode === 'row' && Number.isInteger(b.rowsSown) ? `${plural(b.rowsSown, 'row')} of ${num(b.tray.columns)}` : `${num(b.cells)} cells`;
    if (line.group) return rows;                                        // shared trays are counted on the group's own row
    // a rockwool sheet, whole or part, rides in one open 10 × 20 tray
    return line.kind === 'rockwool' ? `${rows} · ${plural(b.trays, 'sheet')} on ${plural(b.trays, 'open 1020 tray')}` : `${rows} · ${plural(b.trays, 'tray')}`;
  }
  /** Where a line sits in the trays it shares: "tray 1, rows 13–16". */
  function slotText(line) {
    const per = line.group.tray.rows, a = line.rowsFrom, b = line.rowsTo - 1, t1 = Math.floor(a / per) + 1, t2 = Math.floor(b / per) + 1, r1 = a % per + 1, r2 = b % per + 1, word = line.group.medium === 'rockwool' ? 'sheet' : 'tray';
    return t1 === t2 ? `${word} ${t1}, ${r1 === r2 ? 'row ' + r1 : `rows ${r1}–${r2}`}` : `${word} ${t1} from row ${r1}, into ${word} ${t2} to row ${r2}`;
  }
  const howNote = line => line.group ? slotText(line) : line.kind === 'plugs' && line.batch && line.batch.medium !== 'pots' ? `${num(line.batch.tray.cells)}-cell tray` : line.kind === 'rockwool' && line.batch ? `${num(line.batch.tray.cells)}-cell sheet` : '';
  const SLOTS = 5;   // colours that tell varieties apart in a shared tray; beyond them one neutral
  /** The row above varieties that share trays: how many trays, and each tray drawn row by row. */
  function groupRow(line) {
    const g = line.group, list = line.groupLines, per = g.tray.rows, owner = new Array(g.trays * per).fill(null), shown = Math.min(g.trays, 8), wool = g.medium === 'rockwool', Word = wool ? 'Sheet' : 'Tray';
    const crops = [...new Set(list.map(l => T.short(l.crop.name)))];
    for (const l of list) for (let k = l.rowsFrom; k < l.rowsTo && k < owner.length; k++) owner[k] = l;
    const trays = [];
    for (let t = 0; t < shown; t++) {
      const mine = owner.slice(t * per, (t + 1) * per), names = [...new Set(mine.filter(Boolean).map(l => l.name))], empty = mine.filter(l => !l).length;
      trays.push(h('span.sw-tray', { role: 'img', 'aria-label': `${Word} ${t + 1}: ${names.join(', ')}${empty ? `, ${empty} rows empty` : ''}`, title: `${Word} ${t + 1}: ${names.join(', ')}${empty ? ` · ${empty} rows empty` : ''}` },
        mine.map(l => h('i', l ? { dataset: { k: Math.min(l.slot, SLOTS) } } : {}))));
    }
    return h('tr.sw-group', { dataset: { group: line.key } }, h('td'), h('td', { colSpan: 6 }, h('div.sw-group-in',
      h('b', wool ? `${crops.length > 1 ? crops.join(' and ') : crops[0]}: ${plural(list.length, 'sowing')} share ${plural(g.trays, 'sheet')}, on ${plural(g.carriers || g.trays, 'open 1020 tray')}`
        : `${T.short(line.crop.name)}: ${plural(list.length, 'variety', 'varieties')} share ${plural(g.trays, 'tray')}`),
      h('span', `${num(g.cells / g.tray.columns)} rows of ${num(g.tray.columns)} in ${num(g.tray.cells)}-cell ${wool ? 'sheets' : 'trays'}, filled in the order listed`),
      h('span.sw-trays', trays, g.trays > shown ? h('small', `+${num(g.trays - shown)} more`) : null))));
  }
  /** Where it is going: the beds a transplant is raised for and the day it goes out, or the beds a direct sowing is in. */
  function placesText(members) {
    const byGarden = new Map();
    for (const m of members) { const list = byGarden.get(m.r.g.name) || []; list.push(String(m.r.b.bed)); byGarden.set(m.r.g.name, list); }
    return [...byGarden].map(([garden, beds]) => { const uniq = [...new Set(beds)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); return `${garden}${/\d$/.test(garden) ? ':' : ''} ${uniq.length > 6 ? uniq.slice(0, 5).join(', ') + ` +${uniq.length - 5}` : uniq.join(', ')}`; }).join('; ');
  }
  function whereText(line) {
    if (line.kind === 'live') return `ready ${dayName(line.members[0].r.first)}`;
    const places = placesText(line.members);
    return line.kind === 'direct' ? places : `${places} · out ${day(line.field)}`;
  }
  // ── what a job's line says ──
  const whole = n => Math.ceil(n - 1e-9);
  /** How much there is to handle, and of what: [figure, note]. */
  function jobHow(line) {
    const trays = whole(line.trays);
    if (line.section === 'potup') return [plural(line.pots, 'pot'), trays ? `from ${plural(trays, 'tray')}` : ''];
    if (line.section === 'harden') return [trays ? plural(trays, 'tray') : plural(line.pots, 'pot'), `${num(line.plants)} plants`];
    if (line.section === 'move') return [plural(line.containers, 'container'), `${num(line.plants)} plants`];
    const beds = new Set(line.members.filter(m => !m.r.ct && !m.r.tw).map(m => m.r.b.id)).size, towers = line.members.filter(m => m.r.tw).length;
    return [amountText(whole(line.plants), line.stock ? line.stock.unit : 'plants'), [beds ? plural(beds, 'bed') : '', towers ? plural(towers, 'tower') : '', line.containers ? plural(line.containers, 'container') : ''].filter(Boolean).join(' · ')];
  }
  /** Where the work is, or what it is for. */
  function jobWhere(line) {
    const places = placesText(line.members);
    if (line.section === 'plant') return places;
    if (line.section === 'move') return `to ${places}`;
    return `${places} · out ${day(new Date(Math.min(...line.members.map(m => +m.r.field))))}`;
  }
  /** Why a job is not on the day first planned: an earlier job of the same plantings was done late, and pushed it. */
  function pushNote(line) {
    if (!line.pushed.length || line.state === 'done') return null;
    const most = Math.max(...line.pushed.map(f => f.days));
    return h('small.sw-set', { title: `First planned ${days(most)} earlier. Its seedlings were sown or hardened off late, so the day moved with them. Move the planting to set another day.` }, `${days(most)} later`);
  }
  /** What stands in the status column: what was done and when, or what is there to plant. */
  function jobStatus(line, stock) {
    if (line.passed) return h('small', 'no day recorded');
    if (line.state === 'done') {
      const late = line.late, pushed = line.members.map(m => m.st.pushed).filter(Boolean);
      // the day it was done is the day the line stands on; here, how that sat against the plan
      return [h('small.sw-did', { title: `${DID[line.section].charAt(0).toUpperCase() + DID[line.section].slice(1)} ${day(d(line.doneOn))}` }, late > 0 ? `${days(late)} late` : late < 0 ? `${days(-late)} early` : 'on the day'),
        pushed.length ? h('small', `out ${days(Math.max(...pushed.map(f => f.days)))} later`) : null];
    }
    const out = [];
    if (line.stock) {
      const row = stock[line.stock.key + '|' + line.stock.stockUnit] || {}, have = row.onHand || 0;
      out.push(have + 1e-9 >= line.estimate && have ? h('small', `${num(have)} on hand`) : have ? h('small.sw-short', `only ${num(have)} on hand`) : h('small', row.onOrder ? `${num(row.onOrder)} on order` : 'none on hand'));
    }
    out.push(pushNote(line));
    if (line.state === 'part') out.push(h('small', `${num(line.members.length - line.open.length)} of ${num(line.members.length)} recorded`));
    return out;
  }
  /** Whether the seed is there. Only a real shortfall is coloured: seed on order, or none counted yet, is said plainly. */
  function stockNote(line, stock) {
    if (line.state === 'done') return null;
    if (line.kind === 'live' && !App.state.engine.liveSow(line.crop).set) return h('small', 'no seed figure set');
    const row = stock[line.stockKey + '|' + line.stockUnit] || {}, have = row.onHand || 0, bare = n => amountText(n, line.stockUnit).replace(/ seeds?$/, '');
    if (have + 1e-9 >= line.estimate && have) return h('small', `${bare(have)} on hand`);
    if (have) return h('small.sw-short', `only ${bare(have)} on hand`);
    return h('small', row.onOrder ? `${bare(row.onOrder)} on order` : line.variety || line.kind === 'live' ? 'none on hand' : 'no variety chosen');
  }

  // ── recording ──
  /** What each planting of a line records when the line's total is typed over: the same shares, scaled. */
  function itemsFor(line) {
    const open = line.open, typed = ui.qty.get(line.key);
    if (typed == null || typed === '' || !(Number(typed) >= 0) || round6(Number(typed)) === line.estimate) return open.map(m => ({ id: m.p.id, kind: m.s.kind }));
    const total = Number(typed), base = line.estimate || open.length, whole = line.stockUnit !== 'g';
    const shares = open.map(m => (line.estimate ? m.s.estimate : 1) / base * total), out = shares.map(x => whole ? Math.floor(x) : round6(x));
    if (whole) { let left = Math.round(total - out.reduce((n, x) => n + x, 0)); const order = shares.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]); for (let i = 0; left > 0 && order.length; i++, left--) out[order[i % order.length][1]]++; }
    return open.map((m, i) => ({ id: m.p.id, kind: m.s.kind, quantity: out[i] }));
  }
  /** What is ticked and still open: sowings, and the other jobs. */
  const ticked = fig => ({ sow: fig.list.filter(l => ui.sel.has(l.key) && l.open.length), jobs: jobs().filter(l => ui.sel.has(l.key) && l.open.length) });
  const itemsOf = t => [...t.sow.flatMap(itemsFor), ...t.jobs.flatMap(l => l.open.map(m => ({ id: m.p.id, kind: l.kind })))];
  /**
   * What recording the ticked lines on that day would move, worked out before anything is recorded: plantings pushed by late
   * work, and the ground that would then be booked twice. Kept for as long as the plan and the ticks stand.
   */
  const preCache = new WeakMap();
  function preview(t, date) {
    const eng = App.state.engine, items = itemsOf(t), key = [date, ui.follow, ...items.map(i => `${i.id}:${i.kind}`)].join('|'), kept = preCache.get(eng);
    if (kept && kept.key === key) return kept.value;
    const value = App.previewWork(items, { date, follow: true }, { impact: ui.follow });
    preCache.set(eng, { key, value });
    return value;
  }
  const movedText = moved => { if (!moved.length) return ''; const lo = Math.min(...moved.map(m => m.days)), hi = Math.max(...moved.map(m => m.days)); return `${plural(moved.length, 'planting')} ${moved.length === 1 ? 'goes' : 'go'} out ${lo === hi ? days(hi) : `${num(lo)} to ${days(hi)}`} later`; };
  function record(fig) {
    const t = ticked(fig), lines = [...t.sow, ...t.jobs], date = ui.date || App.today();
    if (!lines.length) return;
    const done = App.recordWork(itemsOf(t), { date, follow: ui.follow });
    if (!done) return;
    for (const l of lines) { ui.sel.delete(l.key); ui.qty.delete(l.key); }
    const stocked = [...t.sow.map(l => l.stockUnit), ...t.jobs.filter(l => l.stock).map(l => l.stock.stockUnit)], units = [...new Set(stocked)], unit = units.length === 1 ? units[0] : null, n = done.done.length;
    UI.toast(`${plural(lines.length, t.jobs.length ? 'task' : 'sowing')} recorded ${day(d(date))}${n !== lines.length ? ` for ${plural(n, 'planting')}` : ''}`
      + (unit ? ` · ${done.used ? amountText(done.used, unit) + ' off stock' : 'nothing off stock'}${done.untracked ? ` · ${amountText(done.untracked, unit)} not from a counted lot` : ''}` : done.used || done.untracked ? ' · seed taken off stock where there was any' : '')
      + (done.moved.length ? ` · ${movedText(done.moved)}` : '')
      + (done.held ? ` · ${plural(done.held, 'planting')} would have left ${App.planYear()} and stayed where ${done.held === 1 ? 'it was' : 'they were'}` : '')
      + (done.failed.length ? ` · ${plural(done.failed.length, 'planting')} left as it was: ${done.failed[0].why}` : '')
      + (done.overlaps ? ` · ${done.overlaps === 1 ? 'one planting now overlaps another' : done.overlaps + ' plantings now overlap others'}: see To settle` : '')
      + (done.planOfRecord ? ' · the plan as it stood is kept under Snapshots as the plan of record' : ''), { label: 'Undo', run: App.undo });
  }
  /** A day after today cannot be a record. It sets when the ticked sowings are planned for. */
  function planFor(fig) {
    const lines = fig.list.filter(l => ui.sel.has(l.key) && l.open.length), date = ui.date;
    if (!lines.length) return;
    const done = App.planSowings(lines.flatMap(l => l.open.map(m => m.p.id)), date);
    if (!done) return;
    ui.sel.clear(); ui.qty.clear(); ui.date = App.today();
    render();   // the lines are still open, so nothing else takes the ticks away
    UI.toast(`${plural(lines.length, 'sowing')} planned for ${dayName(d(date))} · nothing marked sown${done.skipped.length ? ` · ${plural(done.skipped.length, 'planting')} left where it was: ${done.skipped[0].why}` : ''}`, { label: 'Undo', run: App.undo });
  }
  function putBack(line) {
    const done = App.planSowings(line.open.map(m => m.p.id), null);
    if (done) UI.toast(`${line.name}: back on the day the plan works out`, { label: 'Undo', run: App.undo });
  }
  const backText = done => (done.restored ? ` · ${plural(done.restored, 'planting')} back on the day first planned` : '');
  function takeBack(line) {
    const done = App.takeBackSowings(line.members.filter(m => m.s.done).map(m => m.p.id));
    if (done) UI.toast(`${line.name}: sowing taken back${done.returned ? ` · ${amountText(done.returned, line.stockUnit)} returned to stock` : ''}${done.lost ? ` · ${amountText(done.lost, line.stockUnit)} could not go back: that lot is gone` : ''}${backText(done)}`, { label: 'Undo', run: App.undo });
  }
  function takeBackJob(line) {
    const done = App.takeBackWork(line.members.filter(m => m.st.done).map(m => ({ id: m.p.id, kind: line.kind })));
    const unit = line.stock ? line.stock.stockUnit : null;
    if (done) UI.toast(`${line.name}: ${Week.NAME[line.kind].toLowerCase()} taken back${done.returned && unit ? ` · ${amountText(done.returned, unit)} returned to stock` : ''}${done.lost && unit ? ` · ${amountText(done.lost, unit)} could not go back: that lot is gone` : ''}${backText(done)}`, { label: 'Undo', run: App.undo });
  }

  // ── drawing ──
  const stat = (label, value, note, cls) => h('div.tr-stat' + (cls ? '.' + cls : ''), h('span', label), h('strong', value), note ? h('small', note) : null);
  function lineRow(line, stock, withWeek) {
    const eng = App.state.engine, open = line.state !== 'done', on = ui.sel.has(line.key), color = eng.cropColor(line.crop);
    const pick = open ? h('input', { type: 'checkbox', checked: on, 'aria-label': `${line.name}: sown`, onchange: e => { if (e.target.checked) ui.sel.add(line.key); else { ui.sel.delete(line.key); ui.qty.delete(line.key); } render(); } }) : h('span.sw-tick', { title: 'Recorded' }, '✓');
    const seed = open && on
      ? h('input.tr-n.sw-qty', { type: 'number', min: 0, step: line.stockUnit === 'g' ? 'any' : 1, value: ui.qty.has(line.key) ? ui.qty.get(line.key) : line.estimate, 'aria-label': `${line.name}: ${line.unit === 'g' ? 'grams of seed' : 'seeds'} used`, title: 'What was used, if it differs from the plan', onclick: e => e.stopPropagation(),
        onchange: e => { ui.qty.set(line.key, e.target.value); } })
      : h('b', line.amount ? amountText(open ? line.estimate : line.amount, line.unit) : '—');
    const first = line.members[0];
    return h('tr' + (on ? '.on' : '') + (open ? '' : '.done'), { dataset: { line: line.key, kind: line.kind, state: line.state }, onclick: e => { if (!open || e.target.closest('input, button, a')) return; if (on) { ui.sel.delete(line.key); ui.qty.delete(line.key); } else ui.sel.add(line.key); render(); } },
      h('td.sw-pick', pick),
      h('td.sw-when', h('b', withWeek ? day(d(line.date)) : UI.DAYS[d(line.date).getDay()]), h('small', withWeek ? UI.DAYS[d(line.date).getDay()] : day(d(line.date))), line.set && open ? h('small.sw-set', { title: 'This day was set here, not worked out from the planting date' }, 'your day') : null),
      h('td.sw-what', h('div.sd-cell', Thumbs.el({ varietyId: line.variety && line.variety.id, cropId: line.crop.id, color, label: line.name, size: 34 }), h('span.sd-name', h('b', line.name), line.sub ? h('small', line.sub) : null))),
      h('td.sw-how', h('span', line.group ? h('i.sw-key', { dataset: { k: Math.min(line.slot, SLOTS) } }) : null, howText(line)), howNote(line) ? h('small', howNote(line)) : null),
      h('td.sw-seed', seed, stockNote(line, stock), !open && line.doneOn ? h('small', `sown ${day(d(line.doneOn))}`) : line.state === 'part' ? h('small', `${num(line.members.length - line.open.length)} of ${num(line.members.length)} recorded`) : null,
        (() => { const f = line.members.map(m => Week.pushed(m.p, 'sow')).filter(Boolean); return f.length ? h('small.sw-pushed', `${days(Math.max(...f.map(x => x.days)))} late: out as much later`) : null; })()),
      h('td.sw-where', h('button.linkish', { type: 'button', title: 'Show on the map', onclick: () => showOnMap(first) }, whereText(line)),
        line.members.length > 1 && line.kind !== 'live' ? h('small', ` ${plural(line.members.length, 'planting')}`) : null),
      h('td.sw-act', !open && line.members.some(m => m.s.done) ? h('button.link', { type: 'button', onclick: () => takeBack(line) }, 'Take back')
        : open && line.set ? h('button.link', { type: 'button', title: 'Back to the day the plan works out', onclick: () => putBack(line) }, 'Plan’s day') : null));
  }
  /** A line's place on the map. On a phone the page is the week and nothing else, so the words stay words. */
  function showOnMap(m) { if (isPhone()) return; App.setView('map'); App.setDate(m.r.field); App.select({ type: 'planting', id: m.p.id }); }
  function jobRow(line, stock, withWeek) {
    const eng = App.state.engine, open = line.state !== 'done', on = ui.sel.has(line.key), color = eng.cropColor(line.crop), how = jobHow(line), first = line.members[0], when = d(line.date);
    const flip = () => { if (on) ui.sel.delete(line.key); else ui.sel.add(line.key); render(); };
    const pick = open ? h('input', { type: 'checkbox', checked: on, 'aria-label': `${line.name}: ${DID[line.section]}`, onchange: flip }) : line.passed ? h('span.sw-tick.none', { title: 'Later work is recorded for it, so it is not waiting; no day was recorded for this task' }, '–') : h('span.sw-tick', { title: 'Recorded' }, '✓');
    return h('tr' + (on ? '.on' : '') + (open ? '' : '.done'), { dataset: { line: line.key, kind: line.section, state: line.passed ? 'passed' : line.state }, onclick: e => { if (!open || e.target.closest('input, button, a')) return; flip(); } },
      h('td.sw-pick', pick),
      h('td.sw-when', h('b', withWeek ? day(when) : UI.DAYS[when.getDay()]), h('small', withWeek ? UI.DAYS[when.getDay()] : day(when))),
      h('td.sw-what', h('div.sd-cell', Thumbs.el({ varietyId: line.variety && line.variety.id, cropId: line.crop.id, color, label: line.name, size: 34 }), h('span.sd-name', h('b', line.name), line.sub ? h('small', line.sub) : null))),
      h('td.sw-how', h('span', how[0]), how[1] ? h('small', how[1]) : null),
      h('td.sw-seed', jobStatus(line, stock)),
      h('td.sw-where', h('button.linkish', { type: 'button', title: 'Show on the map', onclick: () => showOnMap(first) }, jobWhere(line)),
        line.members.length > 1 ? h('small', ` ${plural(line.members.length, 'planting')}`) : null),
      h('td.sw-act', line.members.some(m => m.st.done) ? h('button.link', { type: 'button', onclick: () => takeBackJob(line) }, 'Take back') : null));
  }
  function jobTable(lines, stock, withWeek) {
    const openKeys = lines.filter(l => l.state !== 'done').map(l => l.key), all = openKeys.length > 0 && openKeys.every(k => ui.sel.has(k));
    return h('div.tr-scroll', h('table.as.sw.wk',
      h('thead', h('tr',
        h('th.sw-pick', openKeys.length ? h('input', { type: 'checkbox', checked: all, 'aria-label': 'All of these', title: 'All of these', onchange: e => { for (const k of openKeys) { if (e.target.checked) ui.sel.add(k); else ui.sel.delete(k); } render(); } }) : null),
        h('th.sw-when', withWeek ? 'Planned' : 'Day'), h('th.sw-what', 'What'), h('th.sw-how', 'How much'), h('th.sw-seed'), h('th.sw-where', lines[0] && lines[0].section === 'plant' ? 'Where' : lines[0] && lines[0].section === 'move' ? 'Where to' : 'For'), h('th.sw-act'))),
      h('tbody', lines.map(l => jobRow(l, stock, withWeek)))));
  }
  /** Pot up, harden off, plant out, move out: a section each, when the week has any. */
  function jobSections(lines, stock, withWeek) {
    const out = [];
    for (const [id, title, about] of JOBS) {
      if (ui.filter !== 'all' && ui.filter !== id) continue;
      const mine = lines.filter(l => l.section === id);
      if (!mine.length) continue;
      const open = mine.filter(l => l.state !== 'done').length, plantings = mine.reduce((n, l) => n + l.members.length, 0);
      out.push(h('section.wk-kind', { dataset: { kind: id } },
        h('div.sw-kind-head', h('h4', title), h('span', [open === mine.length ? plural(mine.length, 'task') : `${num(mine.length - open)} of ${plural(mine.length, 'task')} recorded`, plantings !== mine.length ? plural(plantings, 'planting') : ''].filter(Boolean).join(' · ')), h('small', about)),
        jobTable(mine, stock, withWeek)));
    }
    return out;
  }
  function table(lines, stock, withWeek) {
    const openKeys = lines.filter(l => l.state !== 'done').map(l => l.key), all = openKeys.length > 0 && openKeys.every(k => ui.sel.has(k));
    return h('div.tr-scroll', h('table.as.sw',
      h('thead', h('tr',
        h('th.sw-pick', openKeys.length ? h('input', { type: 'checkbox', checked: all, 'aria-label': 'All of these', title: 'All of these', onchange: e => { for (const k of openKeys) { if (e.target.checked) ui.sel.add(k); else { ui.sel.delete(k); ui.qty.delete(k); } } render(); } }) : null),
        h('th.sw-when', withWeek ? 'Planned' : 'Day'), h('th.sw-what', 'What'), h('th.sw-how', 'How much'), h('th.sw-seed', 'Seed'), h('th.sw-where', 'For'), h('th.sw-act'))),
      h('tbody', lines.flatMap((l, i) => l.group && l.groupLines.length > 1 && (i === 0 || lines[i - 1].group !== l.group) ? [groupRow(l), lineRow(l, stock, withWeek)] : [lineRow(l, stock, withWeek)]))));
  }
  function sections(lines, stock, withWeek) {
    const out = [];
    for (const [kind, title, about] of KINDS) {
      if (ui.filter !== 'all' && ui.filter !== kind) continue;
      const mine = lines.filter(l => l.kind === kind);
      if (!mine.length) continue;
      const seeds = mine.filter(l => l.unit === 'seeds').reduce((n, l) => n + l.amount, 0), grams = mine.filter(l => l.unit === 'g').reduce((n, l) => n + l.amount, 0), trays = mine.reduce((n, l) => n + l.trays, 0);
      out.push(h('section.sw-kind', { dataset: { kind } },
        h('div.sw-kind-head', h('h4', title), h('span', [plural(mine.length, 'sowing'), trays ? plural(trays, 'tray') : '', seeds ? amountText(seeds, 'seeds') : '', grams ? amountText(grams, 'g') + ' of seed' : ''].filter(Boolean).join(' · ')), h('small', about)),
        table(mine, stock, withWeek)));
    }
    return out;
  }

  // ── the printed sheet: the week as a list to carry and tick by hand ──
  const framed = (() => { try { return root.self !== root.top; } catch (_) { return true; } })();
  function sheetRows(title, lines, cells) {
    if (!lines.length) return null;
    return [h('tr.wkp-head', h('th', { colSpan: 6 }, title)), lines.map(l => { const c = cells(l), over = l.state === 'done'; return h('tr', h('td.wkp-box', over ? '☑' : '☐'), h('td.wkp-day', c[0]), h('td', h('b', l.name), l.sub ? h('span', ` ${l.sub}`) : null), h('td', c[1]), h('td', c[2]), h('td.wkp-done', over && l.doneOn ? day(d(l.doneOn)) : '')); })];
  }
  function sheetTable(sow, other, withWeek) {
    const when = l => { const x = d(l.date); return withWeek ? `${day(x)}` : `${UI.DAYS[x.getDay()]} ${x.getDate()}`; };
    const body = [
      ...KINDS.map(([kind, title]) => sheetRows(kind === 'direct' ? 'Sow in the ground' : `Sow: ${title.toLowerCase()}`, sow.filter(l => l.kind === kind), l => [when(l), [howText(l), howNote(l), l.amount ? amountText(l.state === 'done' ? l.amount : l.estimate, l.unit) : ''].filter(Boolean).join(' · '), whereText(l)])),
      ...JOBS.map(([id, title]) => sheetRows(title, other.filter(l => l.section === id && !l.passed), l => [when(l), jobHow(l).filter(Boolean).join(' · '), jobWhere(l)]))].filter(Boolean);
    return body.length ? h('table', h('thead', h('tr', h('th'), h('th', withWeek ? 'Planned' : 'Day'), h('th', 'What'), h('th', 'How much'), h('th', 'Where, or for'), h('th', 'Done on'))), h('tbody', body)) : null;
  }
  /** The week as a sheet of paper: every job with a box to tick and a place to write the day it was done. */
  function sheet(fig, now, span = 1) {
    const until = E.d2s(E.addDays(d(now), 7 * span - 1)), inSpan = l => l.week >= now && l.week <= until;
    const all = jobs(), week = fig.list.filter(inSpan), weekJobs = all.filter(inSpan), earlier = fig.list.filter(l => l.week < now && l.state !== 'done'), earlierJobs = all.filter(l => l.week < now && l.state !== 'done');
    const last = d(until);
    return h('div.wkp',
      h('h1', span === 1 ? `Week of ${UI.dayLong(d(now)).replace(/^\w+ /, '')}` : `${num(span)} weeks from ${UI.dayLong(d(now)).replace(/^\w+ /, '')}`), h('p.wkp-sub', `Monday ${day(d(now))} to Sunday ${day(last)} · ${plural(week.length + weekJobs.filter(l => !l.passed).length, 'task')} · printed ${day(new Date())}`),
      sheetTable(week, weekJobs, span > 1) || h('p', span === 1 ? 'Nothing is planned for this week.' : 'Nothing is planned for these weeks.'),
      // the earlier jobs are printed when they are open on the page: what is seen is what is printed
      ui.earlier && earlier.length + earlierJobs.length ? [h('h2', 'Not recorded from earlier weeks'), sheetTable(earlier, earlierJobs, true)] : null,
      h('p.wkp-foot', 'Tick what was done and write the day. Enter it in the planner afterwards: a task done late moves what comes after it.'));
  }
  function printWeek(fig, now, span = 1) {
    let host = $('printSheet');
    if (!host) { host = h('div', { id: 'printSheet' }); document.body.append(host); }
    clear(host); host.append(sheet(fig, now, span));
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); root.removeEventListener('afterprint', done); };
    root.addEventListener('afterprint', done);
    try { root.print(); } catch (_) { UI.toast('Printing is not available in this view.'); }
    setTimeout(done, 1500);
  }

  function render() {
    if (!App.state.ready || App.state.view !== 'sow') { dirty = true; return; }
    dirty = false;
    const host = $('swWrap'), keep = host.parentElement.scrollTop, fig = figures(), all = jobs(), stock = App.stockNow(), now = T.monday(E.d2s(App.state.date)), today = App.today(), phone = isPhone();
    // a selection outlives a redraw, but not the line it pointed at
    const known = new Set([...fig.list, ...all].filter(l => l.state !== 'done').map(l => l.key));
    for (const k of [...ui.sel]) if (!known.has(k)) { ui.sel.delete(k); ui.qty.delete(k); }
    if (!ui.date) ui.date = today;
    const later = ui.date > today;
    // how far ahead is listed: this week, or the two or four weeks from its Monday (a phone shows the week and nothing else)
    const span = phone ? 1 : ui.span, until = E.d2s(E.addDays(d(now), 7 * span - 1)), inSpan = l => l.week >= now && l.week <= until, stretch = span === 1 ? `Week of ${day(d(now))}` : `${day(d(now))} – ${day(d(until))}`;
    const week = fig.list.filter(inSpan), earlier = fig.list.filter(l => l.week < now && l.state !== 'done'), weekOpen = week.filter(l => l.state !== 'done');
    const weekJobs = all.filter(l => inSpan(l) && !l.passed), earlierJobs = all.filter(l => l.week < now && l.state !== 'done'), jobsOpen = weekJobs.filter(l => l.state !== 'done'), late = earlier.length + earlierJobs.length;
    const sum = (list, unit) => list.filter(l => l.unit === unit).reduce((n, l) => n + l.amount, 0), trays = week.reduce((n, l) => n + l.trays, 0);
    const busy = [...new Set([...fig.list.map(l => l.week), ...all.filter(l => !l.passed).map(l => l.week)])].sort();
    const next = busy.find(w => w > until), prev = busy.filter(w => w < now).pop(), step = n => () => App.setDate(E.addDays(d(now), n));
    const t = ticked(fig), selected = [...t.sow, ...t.jobs], word = t.jobs.length ? 'task' : 'sowing';
    const chips = [['all', 'Everything'], ...KINDS.map(k => [k[0], k[1]]), ...JOBS.map(k => [k[0], k[1]])].filter(([id]) => id === 'all' || week.some(l => l.kind === id) || weekJobs.some(l => l.section === id) || (ui.earlier && (earlier.some(l => l.kind === id) || earlierJobs.some(l => l.section === id))));
    if (!chips.some(([id]) => id === ui.filter)) ui.filter = 'all';
    const anything = week.length + weekJobs.length > 0, nothingAfter = !anything && !next;
    const pre = selected.length && !later ? preview(t, ui.date) : null;
    const jobNote = JOBS.map(([id, title]) => { const n = jobsOpen.filter(l => l.section === id).length; return n ? `${title.toLowerCase()} ${num(n)}` : ''; }).filter(Boolean).join(' · ');
    const seasonJobs = all.filter(l => !l.passed), seasonDone = fig.done + seasonJobs.filter(l => l.state === 'done').length, seasonAll = fig.total + seasonJobs.length;
    clear(host);
    add(host,
      h('header.as-head.wk-head', h('p.eyebrow', `Tasks · ${App.planYear()}`), h('h2', { id: 'wkTitle' }, span === 1 ? 'This week’s tasks' : `Tasks for ${num(span)} weeks`),
        h('p', 'Tick what was done and record it on the day it was done. Seed comes off stock, and a transplant sown or hardened off late goes out as many days later.')),
      h('div.tr-stats.sw-stats',
        stat(stretch, week.length ? `${num(weekOpen.length)} to sow` : 'Nothing', week.length ? (week.length - weekOpen.length ? `${num(week.length - weekOpen.length)} of ${num(week.length)} recorded` : plural(week.length, 'sowing') + ' planned') : 'to sow'),
        stat('Seed this week', sum(week, 'seeds') ? num(sum(week, 'seeds')) : sum(week, 'g') ? amountText(sum(week, 'g'), 'g') : '—', sum(week, 'seeds') ? `seeds${sum(week, 'g') ? ' · ' + amountText(sum(week, 'g'), 'g') + ' for trays' : ''}` : sum(week, 'g') ? 'for live trays' : ''),
        stat('Trays to fill', trays ? num(trays) : '—', trays ? [['plugs', 'seedling'], ['rockwool', 'tower'], ['live', 'live']].map(([k, w]) => { const n = week.filter(l => l.kind === k).reduce((m, l) => m + l.trays, 0); return n ? `${num(n)} ${w}` : ''; }).filter(Boolean).join(' · ') : ''),
        stat('Other tasks', weekJobs.length ? `${num(jobsOpen.length)} to do` : 'Nothing', weekJobs.length ? (jobNote || `${plural(weekJobs.length, 'task')} recorded`) : 'to pot up, harden off or plant', 'wk-other'),
        stat('Earlier, not recorded', num(late), late ? `since ${day(d([...earlier, ...earlierJobs].map(l => l.date).sort()[0]))}` : 'nothing is waiting', late ? 'wk-late' : ''),
        stat('This season', `${num(seasonDone)} of ${num(seasonAll)}`, 'tasks recorded')),
      h('div.sw-bar',
        h('span.tr-stepper', h('button.icon-btn', { type: 'button', 'aria-label': 'Back one week', onclick: step(-7) }, '‹'), h('b', { id: 'wkStretch' }, stretch), h('button.icon-btn', { type: 'button', 'aria-label': 'Forward one week', onclick: step(7) }, '›')),
        phone ? null : h('div.seg.wk-span', { role: 'group', 'aria-label': 'How far ahead to list', id: 'wkSpan' }, SPANS.map(([n, label]) => h('button', { type: 'button', dataset: { span: n }, 'aria-pressed': String(ui.span === n), title: n === 1 ? 'This week only' : `This week and the ${n - 1 === 1 ? 'one' : num(n - 1)} after it`, onclick: () => { ui.span = n; render(); } }, label))),
        now !== T.monday(today) && String(App.planYear()) === today.slice(0, 4) ? h('button.btn.small', { type: 'button', id: 'wkToday', onclick: () => App.setDate(d(today)) }, 'This week') : null,
        !anything && next ? h('button.btn.small', { type: 'button', onclick: () => App.setDate(d(next)) }, `Next work: week of ${day(d(next))}`) : null,
        nothingAfter && prev ? h('button.btn.small', { type: 'button', onclick: () => App.setDate(d(prev)) }, `Last work: week of ${day(d(prev))}`) : null,
        h('span.grow'),
        chips.length > 2 ? h('div.sd-filters', { role: 'group', 'aria-label': 'Which tasks to list' }, chips.map(([id, label]) => h('button.chip', { type: 'button', 'aria-pressed': String(ui.filter === id), onclick: () => { ui.filter = id; render(); } }, label))) : null,
        framed || phone ? null : h('button.btn', { type: 'button', id: 'wkPrint', title: 'This week as a sheet to carry: a box for each task and a place for the day it was done', onclick: () => printWeek(fig, now, span) }, span === 1 ? 'Print the week' : `Print the ${num(span)} weeks`)),
      late ? h('details.sw-earlier', { open: ui.earlier, ontoggle: e => { if (e.target.open !== ui.earlier) { ui.earlier = e.target.open; render(); } } },
        h('summary', h('b', `${plural(late, 'earlier task')} ${late === 1 ? 'is' : 'are'} not recorded`), h('span', ' Planned before this week. Record them here on the day they were done, or leave them: nothing is assumed done.')),
        ui.earlier ? [sections(earlier, stock, true), jobSections(earlierJobs, stock, true)] : null) : null,
      anything ? [sections(week, stock, span > 1), jobSections(weekJobs, stock, span > 1)] : h('p.empty.sw-none', span === 1 ? `Nothing is planned for the week of ${day(d(now))}.` : `Nothing is planned from ${day(d(now))} to ${day(d(until))}.`),
      selected.length ? h('div.sw-record', { role: 'region', 'aria-label': 'Record what is ticked' },
        h('b', `${plural(selected.length, word)} ticked`),
        h('span', (() => { const s = sum(t.sow, 'seeds'), g = sum(t.sow, 'g'); return [s ? amountText(s, 'seeds') : '', g ? amountText(g, 'g') + ' of seed' : ''].filter(Boolean).join(' · '); })()),
        h('span.grow'),
        h('label', h('span', later ? 'Plan for' : t.jobs.length ? 'Done on' : 'Sown on'), h('input', { type: 'date', value: ui.date, 'aria-label': later ? 'Plan for' : t.jobs.length ? 'Done on' : 'Sown on', onchange: e => { ui.date = e.target.value || today; render(); } })),
        h('button.btn', { type: 'button', onclick: () => { ui.sel.clear(); ui.qty.clear(); render(); } }, 'Clear'),
        h('button.btn.primary', { type: 'button', id: 'swRecord', disabled: later && !t.sow.length, onclick: () => (later ? planFor(fig) : record(fig)) }, later ? `Plan ${plural(t.sow.length, 'sowing')} for ${dayName(d(ui.date))}` : `Record ${plural(selected.length, word)}`),
        later ? h('small.sw-later', t.jobs.length ? `A day after today is a plan, not a record. Sowings move to that day; nothing is marked done and no seed leaves stock. ${t.sow.length ? 'The other tasks ticked stay' : 'These tasks stay'} where they are: to plan another day for planting out, move the planting.`
          : 'A day after today is a plan. Nothing is marked sown and no seed leaves stock: the sowing moves to that day.') : null,
        pre && pre.moved.length ? h('label.sw-follow', { id: 'wkFollow' },
          h('input', { type: 'checkbox', checked: ui.follow, onchange: e => { ui.follow = e.target.checked; render(); } }), h('b', 'Later dates follow'),
          h('span', ui.follow ? `Late by ${(() => { const lo = Math.min(...pre.moved.map(m => m.days)), hi = Math.max(...pre.moved.map(m => m.days)); return lo === hi ? days(hi) : `${num(lo)} to ${days(hi)}`; })()}: ${movedText(pre.moved)}.${pre.overlaps ? ` ${pre.overlaps === 1 ? 'One pair of plantings' : num(pre.overlaps) + ' pairs of plantings'} would then share ground, and wait under To settle.` : ''}`
            : `${plural(pre.moved.length, 'planting')} ${pre.moved.length === 1 ? 'was' : 'were'} sown or hardened off late and ${pre.moved.length === 1 ? 'keeps the day it goes' : 'keep the days they go'} out.`)) : null,
        pre && pre.held ? h('small.sw-later', `${plural(pre.held, 'planting')} would be pushed out of ${App.planYear()}, and ${pre.held === 1 ? 'stays' : 'stay'} where ${pre.held === 1 ? 'it is' : 'they are'}.`) : null) : null,
      phone ? null : Bench.section());
    host.parentElement.scrollTop = keep;
  }

  // ── a phone: the week is the whole page ──
  // Narrower than a small tablet, the planner is this view and nothing else: no map, no library, no other views to stray into.
  // "Full planner" leaves that for the visit, for a narrow window on a computer.
  const narrow = root.matchMedia ? root.matchMedia('(max-width: 700px)') : null;
  let fullHere = false;
  function fitPhone() {
    const phone = !!(narrow && narrow.matches) && !fullHere, was = isPhone();
    document.body.classList.toggle('phone', phone);
    if (phone && App.state.ready && App.state.view !== 'sow') { App.setView('sow'); return; }
    if (phone !== was && App.state.ready) render();
  }
  function leavePhone() { fullHere = true; fitPhone(); }

  function init() {
    App.on('plan', render); App.on('view', render); App.on('nursery', render); App.on('date', () => { if (App.state.view === 'sow') render(); });
    Thumbs.on(() => { if (App.state.view === 'sow') render(); });
    if (narrow) { narrow.addEventListener('change', fitPhone); App.on('plan', fitPhone); App.on('view', fitPhone); fitPhone(); }
    const full = $('wkFull');
    if (full) full.addEventListener('click', leavePhone);
  }
  root.LRFSowView = { init, render, figures, jobs, sheet: () => sheet(figures(), T.monday(E.d2s(App.state.date)), isPhone() ? 1 : ui.span), span: () => ui.span, ticked: () => ticked(figures()), fitPhone, leavePhone, get dirty() { return dirty; }, get follow() { return ui.follow; } };
})(window);
