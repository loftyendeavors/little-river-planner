/* Little River Farm Planner — the Tasks view (view id "sow": it began as the Sowing view, then the Week view).
 *
 * The work of a day, or of a whole week, as the acts the grower performs, in two lists. Nursery is the raising of the
 * plant: a batch of plug trays filled for several beds, rockwool for the towers, the week's live trays, potting up,
 * hardening off. Field is planting, wherever the plant goes (beds, tunnels, greenhouses, towers, crates; bulbs, canes
 * and bought-in plants with the transplants), seed sown in the ground, and crates moved out.
 *
 * The page opens on today. A week of days across the top says what each day holds; a press shows that day, and any
 * date written at the top opens a calendar to go to any other. A tick records the task at once, on today; a task that
 * is late is asked the day it was really done, in a popup calendar that says what each day would move before it is
 * chosen. A recorded day is a fact: seed comes off stock, and a transplant sown or hardened off late goes out as many
 * days later (js/week.js). A task can be put off to another day on purpose, skipped, or given a note. Every change
 * says what it did, with Undo.
 *
 * On a phone this view is the whole page, one list at a time. The week prints as a sheet.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, SL = root.LRFSeedLib, T = root.LRFTrays, Thumbs = root.LRFThumbs, Bench = root.LRFBench, Week = root.LRFWeek;
  const { h, s, clear, add, num, day } = UI;
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
    ['live', 'Live trays', 'Whole trays sown to the weekly demand under Live trays, in the Nursery view.'],
    ['direct', 'Sown in the ground', 'Seed that goes straight into a bed or a container.']
  ];
  // The rest of a planting's jobs, in the order they are drawn after the sowing.
  const JOBS = [
    ['potup', 'Pot up', 'Seedlings moved on from their plug trays into pots.'],
    ['harden', 'Harden off', 'Trays moved out of the greenhouse ahead of planting.'],
    ['plant', 'Plant out', 'Transplants going into beds, towers and containers, and what is planted, not sown: bulbs, canes, bought-in plants.'],
    ['move', 'Move out', 'Sheltered containers going out to where they stand for the season.']
  ];
  // What is on screen: a day (or, with no day, the whole week), the row that is opened, the list a phone shows, the popup.
  const ui = { day: null, week: null, open: null, shown: {}, tab: 'nursery', scope: 'all', pop: null, busy: false };
  // The two halves of the list. Nursery is the raising of the plant. Field is planting, wherever the plant goes, and seed sown in place.
  const GROUPS = [
    ['nursery', 'Nursery', 'Raising the plant: sowing in trays and rockwool, live trays, potting up, hardening off.', ['plugs', 'rockwool', 'live'], ['potup', 'harden']],
    ['field', 'Field', 'Planting, wherever the plant goes: beds, tunnels, greenhouses, towers and crates. And seed sown in the ground.', ['direct'], ['plant', 'move']]
  ];
  const SCOPES = [['all', 'Everything', 'Nursery and field together'], ['nursery', 'Nursery', GROUPS[0][2]], ['field', 'Field', GROUPS[1][2]]];
  const halfOf = id => (GROUPS.find(g => g[3].includes(id) || g[4].includes(id)) || GROUPS[1])[0];
  // what this browser remembers of the list: which half a phone shows
  const PREF_KEY = 'lrf-next:tasks';
  try { const kept = JSON.parse(root.localStorage.getItem(PREF_KEY) || 'null'); if (kept && SCOPES.some(x => x[0] === kept.scope)) { ui.scope = kept.scope; if (kept.scope !== 'all') ui.tab = kept.scope; } } catch (_) { /* nothing remembered */ }
  const keepPrefs = () => { try { root.localStorage.setItem(PREF_KEY, JSON.stringify({ scope: ui.scope })); } catch (_) { /* a browser that keeps nothing still works */ } };
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
      if (!s || !(s.unit === 'seeds' || s.unit === 'g') || (s.failed && !s.done)) continue;   // a planting marked failed is listed only for what was recorded
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
      const skipOn = m => (!m.s.done && !m.s.sown ? Week.skipOf(m.p, m.s.kind) : null), left = line.members.map(skipOn).filter(Boolean);
      const open = line.members.filter(m => !m.s.done && !m.s.sown && !skipOn(m)), done = line.members.filter(m => m.s.done);
      line.open = open; line.state = !open.length ? 'done' : open.length === line.members.length ? 'open' : 'part';
      line.skipped = !open.length && !done.length && left.length ? left.sort().pop() : null;   // the day it was skipped on, when nothing of it was sown
      line.delayedFrom = open.map(m => { const put = Week.delayOf(m.p, m.s.kind); return put && put.to === line.date ? put.from : null; }).filter(Boolean).sort()[0] || null;
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

  // ── one list of everything: a sowing or another job is a task with its day ──
  const ACT = { plugs: 'Sow', rockwool: 'Sow', live: 'Sow', direct: 'Direct sow', potup: 'Pot up', harden: 'Harden off', plant: 'Plant out', move: 'Move out' };
  const PAST = { plugs: 'sown', rockwool: 'sown', live: 'sown', direct: 'sown', potup: 'potted up', harden: 'hardened off', plant: 'planted out', move: 'moved out' };
  const ORDER = ['plugs', 'rockwool', 'live', 'potup', 'harden', 'direct', 'plant', 'move'];
  const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const plus = (iso, n) => E.d2s(E.addDays(d(iso), n));
  const diff = (a, b) => E.dayDiff(d(a), d(b));
  const wd = iso => UI.DAYS[d(iso).getDay()];
  const shortDay = iso => `${wd(iso)} ${day(d(iso))}`;
  const cap = text => text.charAt(0).toUpperCase() + text.slice(1);
  /** A crop as a task names it: without its bracketed kind, and with no capital unless the name has more than one. */
  const cropWord = name => { const w = T.short(name).replace(/\s*\([^)]*\)\s*$/, '').trim() || T.short(name); return /[A-Z]/.test(w.slice(1)) ? w : w.charAt(0).toLowerCase() + w.slice(1); };
  const isOpen = t => t.state === 'open' || t.state === 'part';
  const taskCache = new WeakMap();
  /**
   * Every task of the plan's year, in the order it is listed: { key, line, sow, id, half, state, due, on, title, items() }.
   * `due` is the day the plan has it on. `on` is the day it was done, or skipped. `items()` is what ticking it records.
   */
  function tasks() {
    const eng = App.state.engine;
    if (taskCache.has(eng)) return taskCache.get(eng);
    const make = (l, id, sow) => ({ key: l.key, line: l, sow, id, half: halfOf(id), state: l.skipped ? 'skipped' : l.state, due: !sow && l.state === 'done' && l.planned ? l.planned : l.date, on: l.skipped || (l.state === 'done' ? l.doneOn : null),
      title: `${ACT[id]} ${cropWord(l.crop.name)}`, items: () => l.open.map(m => ({ id: m.p.id, kind: sow ? m.s.kind : l.kind })) });
    const out = [...figures().list.map(l => make(l, l.kind, true)), ...jobs().filter(l => !l.passed || l.skipped).map(l => make(l, l.section, false))];
    // by day, then by kind; within a kind the lists' own order stands, which keeps sowings that share trays together
    out.forEach((t, i) => { t.at = i; });
    out.sort((a, b) => a.due.localeCompare(b.due) || ORDER.indexOf(a.id) - ORDER.indexOf(b.id) || a.at - b.at);
    taskCache.set(eng, out);
    return out;
  }
  const byKey = key => tasks().find(t => t.key === key) || null;
  /** The plantings a task stands for, with the kind of job each one records. */
  const membersOf = t => t.line.members.map(m => ({ p: m.p, kind: t.sow ? m.s.kind : t.line.kind }));
  const noteOf = t => { const m = membersOf(t).find(x => Week.noteOf(x.p, x.kind)); return m ? Week.noteOf(m.p, m.kind) : ''; };

  // ── what a row says ──
  /** The line under a task's name: the variety, how much, where; then anything that sets it apart. It wraps, and is never cut. */
  function detail(t) {
    const l = t.line, bits = [];
    if (t.sow) bits.push(l.kind === 'live' ? [l.variety ? l.name : '', l.sub].filter(Boolean).join(', ') : l.variety ? l.name : 'no variety chosen', howText(l), howNote(l), whereText(l));
    else { const how = jobHow(l); bits.push(l.variety ? l.name : 'no variety chosen', how[0], how[1], jobWhere(l)); }
    if (l.state === 'part') bits.push(`${num(l.members.length - l.open.length)} of ${num(l.members.length)} recorded`);
    if (isOpen(t) && l.delayedFrom) bits.push(`delayed from ${shortDay(l.delayedFrom)}`);
    else if (isOpen(t) && t.sow && l.set) bits.push('its day set by hand');
    if (isOpen(t) && !t.sow && l.pushed.length) bits.push(`${days(Math.max(...l.pushed.map(f => f.days)))} later than first planned`);
    const note = noteOf(t);
    if (note) bits.push(`“${note}”`);
    return bits.filter(Boolean).join(' · ');
  }
  /**
   * What stands in a task's way, said only when it is so, in one line that never wraps: seed (or bulbs) on hand but short of
   * what it takes; or, on a planting out or a sowing in the ground, a bed that another planting still holds on that day.
   */
  function flagText(t, stock) {
    return isOpen(t) ? shortText(t, stock) || bedText(t) : '';
  }
  function shortText(t, stock) {
    const l = t.line, key = t.sow ? [l.stockKey, l.stockUnit] : l.stock ? [l.stock.key, l.stock.stockUnit] : null;
    if (!key || !(l.estimate > 0)) return '';
    const have = (stock[key[0] + '|' + key[1]] || {}).onHand || 0, bare = n => amountText(n, key[1]).replace(/ seeds?$/, '');
    return have && have + 1e-9 < l.estimate ? `${key[1] === 'seeds' || key[1] === 'g' ? 'Seed short' : 'Short'}: ${bare(have)} of ${amountText(l.estimate, key[1])}` : '';
  }
  /** The day the ground a planting goes into is free, when another planting still holds it on the day it goes in. */
  function bedText(t) {
    if (t.id !== 'plant' && t.id !== 'direct') return '';
    const eng = App.state.engine;
    let until = null, stays = false;
    for (const m of t.line.open) {
      for (const o of eng.conflicts(m.p, m.r)) {
        if (o.rest || !o.p || !(o.from < m.r.field) || !(o.through >= m.r.field)) continue;
        if (o.through === Infinity) stays = true; else if (!until || o.through > until) until = o.through;
      }
    }
    return stays ? 'Bed not free: what is in it stays all season' : until ? `Bed not free until ${shortDay(E.d2s(E.addDays(until, 1)))}` : '';
  }
  const TICK = () => s('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('path', { d: 'M2.5 7.4l3 3 6-6.6' }));
  const CHEV = () => s('svg.tk-chev', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('path', { d: 'M5 2.5l4.5 4.5L5 11.5' }));
  const CARET = () => s('svg.tk-caret', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: 'M2 3.5l3 3 3-3' }));
  const WARN = () => s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, s('path.a', { d: 'M8 1.5c.52 0 1 .28 1.26.73l5.86 10.2c.5.9-.13 2.02-1.26 2.02H2.14c-1.13 0-1.77-1.12-1.26-2.02l5.86-10.2C7 1.78 7.48 1.5 8 1.5z' }), s('path.b', { d: 'M8 6.1v3.5' }), s('circle.c', { cx: 8, cy: 11.9, r: 0.95 }));
  const RING = (r, size) => s('svg.tk-ring', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, s('circle.track', { cx: size / 2, cy: size / 2, r }), s('circle.fill', { cx: size / 2, cy: size / 2, r }));
  /** A ring filled to a share. It is drawn at the share it last showed and moved to the new one, so a tick is seen to fill it. */
  const ringShares = new Map();
  function fillRing(svg, name, share, length) {
    const fill = svg.querySelector('.fill'), was = ringShares.has(name) ? ringShares.get(name) : share, set = x => { fill.style.strokeDasharray = String(length); fill.style.strokeDashoffset = String(length * (1 - x)); fill.style.opacity = x ? 1 : 0; };
    ringShares.set(name, share); set(was);
    if (was !== share) root.requestAnimationFrame(() => root.requestAnimationFrame(() => set(share)));
  }

  function rowEl(t, stock, now) {
    const l = t.line, open = isOpen(t), late = open && t.due < now ? diff(now, t.due) : 0, shown = open && ui.open === t.key, flag = flagText(t, stock);
    const right = t.state === 'skipped' ? h('span.tk-when.skip', 'Skipped') : !open ? h('span.tk-when', t.on === now ? 'Done' : `Done ${shortDay(t.on)}`)
      : h('button.tk-put' + (late ? '.late' : ''), { type: 'button', dataset: { act: 'delay' }, title: 'Put it off to another day', 'aria-label': `${late ? `${days(late)} late. ` : ''}Delay ${t.title}, ${l.name}` }, late ? `${days(late)} late` : 'Delay');
    return h('div.tk-row' + (open ? '' : '.done') + (shown ? '.open' : '') + (ui.pop && ui.pop.key === t.key ? '.pending' : ''), { dataset: { line: t.key, kind: t.id, state: t.state, due: t.due } },
      h('div.tk-main',
        h('button.tk-tick', { type: 'button', role: 'checkbox', 'aria-checked': String(!open), 'aria-label': `${t.title}, ${l.name}`, dataset: { act: 'tick' } }, h('i', TICK())),
        Thumbs.el({ varietyId: l.variety && l.variety.id, cropId: l.crop.id, color: App.state.engine.cropColor(l.crop), label: l.name, size: 42, cls: 'tk-thumb' }),
        h('button.tk-words', { type: 'button', 'aria-expanded': String(shown), tabIndex: open ? 0 : -1, dataset: { act: 'open' } }, h('span.tk-title', t.title), h('span.tk-sub', detail(t))),
        right,
        flag ? h('span.tk-flag', WARN(), flag) : null),
      h('div.tk-drawer', h('div', shown ? h('div.tk-inner',
        h('input.tk-note', { type: 'text', placeholder: 'Add a note', maxLength: 400, value: noteOf(t), 'aria-label': `Note for ${t.title}, ${l.name}`, dataset: { note: t.key } }),
        h('div.tk-acts', h('button.tk-soft', { type: 'button', dataset: { act: 'delay' } }, 'Delay…'), h('button.tk-link', { type: 'button', dataset: { act: 'skip' } }, 'Skip this task'),
          isPhone() ? null : h('button.tk-link.map', { type: 'button', dataset: { act: 'map' } }, 'Show on the map'))) : null)));
  }
  /** How much a group holds: its tasks, and the trays its sowings fill. */
  const tally = rows => { const trays = rows.reduce((n, t) => n + (t.sow && isOpen(t) ? Math.ceil(t.line.trays - 1e-9) : 0), 0); return `${num(rows.length)}${trays ? ` · ${plural(trays, 'tray')}` : ''}`; };
  /** "Mark all done" on Late and on Today, once a group has three tasks or more. Late ones are asked one day for all of them. */
  const ALL_FROM = 3;
  const allButton = (rows, all) => all && rows.length >= ALL_FROM && rows.every(isOpen)
    ? h('button.tk-all', { type: 'button', dataset: { act: 'all', keys: JSON.stringify(rows.map(t => t.key)), hook: 'tasks-mark-all' } }, 'Mark all done') : null;
  function group(label, cls, rows, stock, now, all) {
    if (!rows.length) return null;
    return [label ? h('div.tk-sec' + (cls ? '.' + cls : ''), h('span.tk-sec-name', label), h('span.tk-sec-n', tally(rows)), allButton(rows, all)) : h('div.tk-lead'), withShares(rows, stock, now)];
  }
  /** The line above sowings that share trays: how many trays there are, and how they are filled. Each row then says its own tray and rows. */
  function shareLine(line) {
    const g = line.group, list = line.groupLines, wool = g.medium === 'rockwool', crops = [...new Set(list.map(l => T.short(l.crop.name)))];
    return h('div.tk-share', { dataset: { group: line.key } },
      h('b', wool ? `${crops.length > 1 ? crops.join(' and ') : crops[0]}: ${plural(list.length, 'sowing')} share ${plural(g.trays, 'sheet')}, on ${plural(g.carriers || g.trays, 'open 1020 tray')}` : `${T.short(line.crop.name)}: ${plural(list.length, 'variety', 'varieties')} share ${plural(g.trays, 'tray')}`),
      ` · ${num(g.cells / g.tray.columns)} rows of ${num(g.tray.columns)} in ${num(g.tray.cells)}-cell ${wool ? 'sheets' : 'trays'}, filled in the order listed`);
  }
  const shares = t => t.sow && isOpen(t) && t.line.group && t.line.groupLines.length > 1 ? t.line.group : null;
  const withShares = (rows, stock, now) => rows.flatMap((t, i) => (shares(t) && (!i || shares(rows[i - 1]) !== shares(t)) ? [shareLine(t.line), rowEl(t, stock, now)] : [rowEl(t, stock, now)]));
  /**
   * What is late, oldest first. A long run of it is folded to the most recent few, with one line that opens the rest:
   * a plan that was not recorded for a while should not bury today under its past.
   */
  const LATE_SHOWN = 6, LATE_FOLD = 12;
  function lateGroup(id, rows, stock, now) {
    if (rows.length <= LATE_FOLD || ui.shown[id + ':late']) return group('Late', 'late', rows, stock, now, true);
    const hidden = rows.length - LATE_SHOWN;
    return [h('div.tk-sec.late', h('span.tk-sec-name', 'Late'), h('span.tk-sec-n', tally(rows)), allButton(rows, true)),
      h('button.tk-more', { type: 'button', dataset: { act: 'late', half: id } }, `${num(hidden)} more, back to ${shortDay(rows[0].due)}`), withShares(rows.slice(hidden), stock, now)];
  }
  const dayLabel = (k, now) => k === plus(now, 1) ? ['Tomorrow ', h('i', shortDay(k))] : [`${FULL[d(k).getDay()]} `, h('i', day(d(k)))];

  // ── what is on screen: one day, or a whole week ──
  /** The tasks on screen for one half, or for both: still to do, and done. Today, and this week, also hold whatever is late. */
  function onScreen(half) {
    const all = tasks().filter(t => !half || t.half === half), now = App.today(), a = ui.week, end = plus(a, 6), cur = T.monday(now);
    if (ui.day) return { open: all.filter(t => isOpen(t) && (ui.day === now ? t.due <= now : ui.day > now && t.due === ui.day)), done: all.filter(t => t.on === ui.day) };
    return { open: all.filter(t => isOpen(t) && (a === cur ? t.due <= end : a > cur && t.due >= a && t.due <= end)), done: all.filter(t => t.on && t.on >= a && t.on <= end) };
  }
  const live = () => { const now = App.today(); return ui.day ? ui.day === now : ui.week === T.monday(now); };
  const later = () => { const now = App.today(); return ui.day ? ui.day > now : ui.week > T.monday(now); };
  const fold = (id, done, label, stock, now) => done.length ? [h('button.tk-fold', { type: 'button', 'aria-expanded': String(!!ui.shown[id]), dataset: { act: 'fold', half: id } }, `${label} `, h('b', num(done.length)), CHEV()),
    h('div.tk-fold-body' + (ui.shown[id] ? '' : '.shut'), h('div', done.map(t => rowEl(t, stock, now))))] : null;
  /** The next task still to do after today, said where a list has nothing left. */
  function nextLine(id, now) {
    const next = tasks().find(t => t.half === id && isOpen(t) && t.due > now);
    return next ? h('button.tk-next', { type: 'button', dataset: { act: 'go', day: next.due } }, `Next: ${next.title.charAt(0).toLowerCase() + next.title.slice(1)}, ${next.due === plus(now, 1) ? 'tomorrow' : shortDay(next.due)}`) : null;
  }
  const finished = (name, words, id, now) => h('div.tk-finished', h('span', TICK()), h('strong', `${name} is done for ${words}`), nextLine(id, now));
  function dayBody(id, name, stock, now) {
    const k = ui.day, s = onScreen(id);
    if (k === now) return [s.open.length ? [lateGroup(id, s.open.filter(t => t.due < now), stock, now), group('Today', '', s.open.filter(t => t.due === now), stock, now, true)]
      : s.done.length ? finished(name, 'today', id, now) : h('div.tk-empty', h('p', 'Nothing is planned for today.'), nextLine(id, now)), fold(id, s.done, 'Completed today', stock, now)];
    if (k > now) return s.open.length || s.done.length ? [group('', '', s.open, stock, now), fold(id, s.done, 'Already done', stock, now)] : h('div.tk-empty', h('p', 'Nothing is planned.'));
    const missed = tasks().filter(t => t.half === id && isOpen(t) && t.due === k).length;
    return [s.done.length ? group('', '', s.done, stock, now) : h('div.tk-empty', h('p', 'Nothing was recorded.')),
      missed ? h('p.tk-missed', `${plural(missed, 'task')} of that day ${missed === 1 ? 'was' : 'were'} not done, and ${missed === 1 ? 'is' : 'are'} on today’s list.`) : null];
  }
  /** A whole week, a day at a time: the same rows under a line for each day. */
  function weekBody(id, name, stock, now) {
    const a = ui.week, cur = T.monday(now), s = onScreen(id), out = [];
    if (a < cur) {
      for (let i = 0; i < 7; i++) { const k = plus(a, i); out.push(group(dayLabel(k, now), '', s.done.filter(t => t.on === k), stock, now)); }
      return out.some(Boolean) ? out : h('div.tk-empty', h('p', 'Nothing was recorded.'));
    }
    if (a === cur) out.push(lateGroup(id, s.open.filter(t => t.due < now), stock, now), group('Today', '', s.open.filter(t => t.due === now), stock, now, true));
    for (let i = 0; i < 7; i++) { const k = plus(a, i); if (k > now) out.push(group(dayLabel(k, now), '', s.open.filter(t => t.due === k), stock, now)); }
    return [out.some(Boolean) ? out : a === cur && s.done.length ? finished(name, 'the week', id, now) : h('div.tk-empty', h('p', 'Nothing is planned.')), a === cur ? fold(id, s.done, 'Completed this week', stock, now) : null];
  }

  // ── "Trays to fill", at the head of Nursery: what the sowings on screen take, falling as they are ticked ──
  /** The trays, rockwool sheets and mix the open sowings in view take, by size, and how many varieties. Null when there is no sowing in trays. */
  function fillFigures(rows) {
    const sizes = new Map(), groups = new Set(), kinds = new Set(), own = (App.state.plan.lrfNext || {}).supplies || null, N = root.LRFNursery;
    let trays = 0, sheets = 0, mix = 0;
    const take = (label, n, mixId) => { if (!(n > 0)) return; sizes.set(label, (sizes.get(label) || 0) + n); const each = mixId && N ? N.mixEach(own, mixId) : null; if (each != null) mix += n * each; };
    for (const t of rows) {
      const l = t.line;
      if (!t.sow || l.kind === 'direct' || !isOpen(t)) continue;
      kinds.add(l.variety ? l.variety.id : 'c:' + l.crop.id);
      if (l.kind === 'live') { const how = App.state.engine.liveSow(l.crop), n = whole(l.trays); trays += n; take(how.how === 'cells' && how.cells > 0 ? `${num(how.cells)}-cell live tray` : 'live tray', n, how.how === 'cells' && how.cells > 0 ? 'tray-' + how.cells : 'open'); continue; }
      const b = l.batch;
      if (!b || b.medium === 'pots') continue;
      const g = l.group, key = g ? g.id : l.key;
      if (groups.has(key)) continue;   // trays shared by several sowings are counted once
      groups.add(key);
      const n = whole(g ? g.trays : b.trays), cells = (g || b).tray.cells;
      if (l.kind === 'rockwool') { sheets += n; take(`${num(cells)}-cell sheet`, n, null); } else { trays += n; take(`${num(cells)}`, n, 'tray-' + cells); }
    }
    return trays + sheets ? { trays, sheets, mix, kinds: kinds.size, sizes: [...sizes].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true })) } : null;
  }
  function fillHead(rows) {
    const f = fillFigures(rows);
    if (!f) return null;
    return h('div.tk-fill', { dataset: { hook: 'tasks-trays-to-fill' } },
      h('div.tk-sec', h('span.tk-sec-name', 'Trays to fill'), h('span.tk-sec-n', [f.trays ? plural(f.trays, 'tray') : '', f.sheets ? plural(f.sheets, 'rockwool sheet') : '', f.mix > 0 ? `${num(f.mix, f.mix < 10 ? 1 : 0)} cu ft mix` : '', plural(f.kinds, 'variety', 'varieties')].filter(Boolean).join(' · '))),
      h('div.tk-fill-sizes', f.sizes.map(([label, n]) => h('span', h('b', num(n)), ` × ${label}`))));
  }

  // ── Upcoming weeks: one card under both lists, a line for each of the next four weeks ──
  const TO = { plugs: 'to sow', rockwool: 'to sow', live: 'to sow', direct: 'to direct sow', potup: 'to pot up', harden: 'to harden off', plant: 'to plant out', move: 'to move out' };
  const TO_ORDER = ['to sow', 'to direct sow', 'to pot up', 'to harden off', 'to plant out', 'to move out'];
  function upCell(name, list) {
    if (!list.length) return h('span.tk-up-cell.none', h('em', name), h('span.tk-up-fig', 'Nothing planned'));
    const trays = list.reduce((n, t) => n + (t.sow && t.id !== 'direct' ? whole(t.line.trays) : 0), 0), by = new Map(), seen = new Set(), pics = [];
    for (const t of list) { by.set(TO[t.id], (by.get(TO[t.id]) || 0) + 1); const k = t.line.variety ? t.line.variety.id : 'c:' + t.line.crop.id; if (!seen.has(k)) { seen.add(k); pics.push(t.line); } }
    return h('span.tk-up-cell', h('em', name),
      h('span.tk-up-fig', h('b', num(list.length)), ` ${list.length === 1 ? 'task' : 'tasks'}${trays ? ` · ${plural(trays, 'tray')}` : ''}`),
      h('span.tk-up-mix', TO_ORDER.filter(w => by.get(w)).map(w => `${num(by.get(w))} ${w}`).join(' · ')),
      h('span.tk-up-stack', pics.slice(0, 4).map(l => Thumbs.el({ varietyId: l.variety && l.variety.id, cropId: l.crop.id, color: App.state.engine.cropColor(l.crop), label: l.name, size: 32, cls: 'tk-up-thumb' })),
        pics.length > 4 ? h('i', `+${num(pics.length - 4)}`) : null));
  }
  function upcoming(now) {
    const cur = T.monday(now), all = tasks().filter(isOpen);
    return h('section.tk-upcoming', { 'aria-label': 'Upcoming weeks', dataset: { hook: 'tasks-upcoming' } },
      h('header', h('h3', 'Upcoming weeks'), GROUPS.map(([, name]) => h('span', name)), h('i')),
      [1, 2, 3, 4].map(w => {
        const a = plus(cur, 7 * w), z = plus(a, 6), inWeek = all.filter(t => t.due >= a && t.due <= z);
        return h('button.tk-up-row', { type: 'button', 'aria-pressed': String(!ui.day && ui.week === a), dataset: { act: 'upweek', week: a, hook: 'tasks-upcoming-week' } },
          h('span.tk-up-wk', h('b', w === 1 ? 'Next week' : span(a, UI.MONTHS)), h('small', w === 1 ? span(a, UI.MONTHS) : `in ${w} weeks`)),
          GROUPS.map(([id, name]) => upCell(name, inWeek.filter(t => t.half === id))), CHEV());
      }));
  }

  // ── the message after a change: what was recorded, and what it moved ──
  const where = ids => new Map(ids.map(id => { const eng = App.state.engine, p = eng.planting(id), r = p && eng.calc(p); return [id, r ? { out: r.rack ? null : E.d2s(r.planned), first: E.validDate(r.first) ? E.d2s(r.first) : null } : {}]; }));
  /** What moved between two readings of the same plantings: the day they go out, and their first harvest. */
  function movedText(before, kindIsOut) {
    const after = where([...before.keys()]), pairs = name => { const set = new Set(); for (const [id, was] of before) { const now = after.get(id) || {}; if (was[name] && now[name] && was[name] !== now[name]) set.add(`${was[name]}|${now[name]}`); } return [...set].map(x => x.split('|')); };
    const say = (word, list) => !list.length ? '' : list.length === 1 ? `${word} ${day(d(list[0][0]))} → ${day(d(list[0][1]))}` : `${word} moves for ${plural(list.length, 'planting')}`;
    return [kindIsOut ? '' : say('planting out', pairs('out')), say('first harvest', pairs('first'))].filter(Boolean);
  }
  const stockUnitOf = t => t.sow ? t.line.stockUnit : t.line.stock ? t.line.stock.stockUnit : null;
  /** Record a task as done on a day, and say what that did. */
  function finishTick(t, date) {
    const items = t.items(), now = App.today(), before = where(items.map(i => i.id)), off = diff(date, t.due), unit = stockUnitOf(t);
    const done = App.recordWork(items, { date, follow: true });
    if (!done) return;
    const moved = movedText(before, t.id === 'plant' || t.id === 'direct');
    UI.toast([`${cap(cropWord(t.line.crop.name))} ${PAST[t.id]}${date === now ? (off ? ' today' : '') : ` ${shortDay(date)}`}${off > 0 ? `, ${days(off)} late` : off < 0 ? `, ${days(-off)} early` : ''}`,
      unit ? (done.used ? `${amountText(done.used, unit)} off stock` : 'nothing off stock') + (done.untracked ? ` · ${amountText(done.untracked, unit)} not from a counted lot` : '') : '',
      ...moved, off && !moved.length ? 'nothing else moves' : '',
      done.held ? `${plural(done.held, 'planting')} would have left ${App.planYear()} and stayed where ${done.held === 1 ? 'it was' : 'they were'}` : '',
      done.failed.length ? `${plural(done.failed.length, 'planting')} left as it was: ${done.failed[0].why}` : '',
      done.overlaps ? `${done.overlaps === 1 ? 'one planting now overlaps another' : done.overlaps + ' plantings now overlap others'}: see To settle` : '',
      done.planOfRecord ? 'the plan as it stood is kept under Snapshots as the plan of record' : ''].filter(Boolean).join(' · '), { label: 'Undo', run: App.undo });
  }
  const backText = done => (done.restored ? ` · ${plural(done.restored, 'planting')} back on the day first planned` : '');
  /** Untick a done task: its day is cleared, and what it took or pushed goes back. A skipped task comes back onto the list. */
  function takeBack(t) {
    const l = t.line, unit = stockUnitOf(t);
    if (t.state === 'skipped') { if (App.skipWork(membersOf(t).filter(m => Week.skipOf(m.p, m.kind)).map(m => ({ id: m.p.id, kind: m.kind })), null)) UI.toast(`${t.title} is back on the list`, { label: 'Undo', run: App.undo }); return; }
    const done = t.sow ? App.takeBackSowings(l.members.filter(m => m.s.done).map(m => m.p.id)) : App.takeBackWork(l.members.filter(m => m.st.done).map(m => ({ id: m.p.id, kind: l.kind })));
    if (done) UI.toast(`${t.title} taken back${done.returned && unit ? ` · ${amountText(done.returned, unit)} returned to stock` : ''}${done.lost && unit ? ` · ${amountText(done.lost, unit)} could not go back: that lot is gone` : ''}${backText(done)}`, { label: 'Undo', run: App.undo });
  }
  /** Put a task off to a day, on purpose, and say what moved with it. */
  function delayTo(t, date) {
    const items = t.items(), before = where(items.map(i => i.id)), off = diff(date, t.due), done = App.delayWork(items, date);
    if (!done) return;
    const moved = movedText(before, t.id === 'plant' || t.id === 'direct');
    UI.toast([`${t.title} ${off > 0 ? 'put off to' : 'brought forward to'} ${date === App.today() ? 'today' : shortDay(date)}`, ...moved, moved.length ? '' : 'nothing else moves',
      done.failed.length ? `${plural(done.failed.length, 'planting')} left where it was: ${done.failed[0].why}` : '',
      done.overlaps ? `${done.overlaps === 1 ? 'one planting now overlaps another' : done.overlaps + ' plantings now overlap others'}: see To settle` : ''].filter(Boolean).join(' · '), { label: 'Undo', run: App.undo });
  }
  function skipTask(t) {
    ui.open = null;
    if (App.skipWork(t.items(), App.today())) UI.toast(`${t.title} skipped · the plan is unchanged`, { label: 'Undo', run: App.undo });
  }
  const calm = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /** A tick: at once when the task is not late, with the row struck through and folded away first; a late task is asked its day. */
  function tick(t, row) {
    if (ui.busy) return;
    if (!isOpen(t)) { takeBack(t); return; }
    const now = App.today();
    if (t.due < now) { openPop('done', t); return; }
    if (diff(t.due, now) >= AHEAD_ASK) { openPop('ahead', t); return; }
    strike(row, () => finishTick(t, now));
  }
  /** A tick this many days or more before a task's day asks first; within a week it records at once. */
  const AHEAD_ASK = 7;
  /** "Mark all done": the tasks of one group recorded on one day, as one step with Undo, and what that did said once. */
  function finishAll(keys, date) {
    // "each": every task on the day it was due, so that nothing moves; otherwise all of them on the one day chosen
    const each = date === 'each', list = keys.map(byKey).filter(t => t && isOpen(t)), items = list.flatMap(t => t.items().map(i => (each ? { ...i, date: t.due } : i)));
    if (each) date = App.today();
    if (!items.length) return;
    const now = App.today(), before = where(items.map(i => i.id)), units = new Set(list.map(stockUnitOf).filter(Boolean)), unit = units.size === 1 ? [...units][0] : null;
    const done = App.recordWork(items, { date, follow: true });
    if (!done) return;
    const moved = movedText(before, list.every(t => t.id === 'plant' || t.id === 'direct'));
    UI.toast([`${plural(list.length, 'task')} recorded ${each ? 'each on the day it was due' : date === now ? 'today' : shortDay(date)}`,
      unit && done.used ? `${amountText(done.used, unit)} off stock` : done.used ? 'seed off stock' : '',
      ...moved, !moved.length ? 'nothing else moves' : '',
      done.held ? `${plural(done.held, 'planting')} would have left ${App.planYear()} and stayed where ${done.held === 1 ? 'it was' : 'they were'}` : '',
      done.failed.length ? `${plural(done.failed.length, 'planting')} left as ${done.failed.length === 1 ? 'it was' : 'they were'}: ${done.failed[0].why}` : '',
      done.overlaps ? `${done.overlaps === 1 ? 'one planting now overlaps another' : done.overlaps + ' plantings now overlap others'}: see To settle` : '',
      done.planOfRecord ? 'the plan as it stood is kept under Snapshots as the plan of record' : ''].filter(Boolean).join(' · '), { label: 'Undo', run: App.undo });
  }
  function markAll(keys, el) {
    if (ui.busy) return;
    const list = keys.map(byKey).filter(t => t && isOpen(t)), now = App.today();
    if (!list.length) return;
    if (list.some(t => t.due < now)) { openPop('all', null, el && el.id, list.map(t => t.key)); return; }
    ui.open = null; finishAll(list.map(t => t.key), now);
  }
  function strike(row, then) {
    ui.open = null;
    if (!row || calm()) { then(); return; }
    ui.busy = true; row.classList.remove('open', 'pending'); row.classList.add('ticking');
    root.setTimeout(() => { row.style.height = row.offsetHeight + 'px'; void row.offsetHeight; row.style.height = '0px'; row.style.opacity = '0'; root.setTimeout(() => { ui.busy = false; then(); }, 300); }, 480);
  }

  // ── the popup calendar: the one place a day is chosen (when it was done, what to put it off to, which day to look at) ──
  const rowOf = key => [...document.querySelectorAll('#swWrap .tk-row')].find(r => r.dataset.line === key) || null;
  function openPop(mode, t, anchor, keys) {
    const now = App.today(), year = App.planYear(), first = `${year}-01-01`, last = `${year}-12-31`;
    const earliest = keys ? keys.map(byKey).filter(Boolean).map(x => x.due).sort()[0] || now : null;
    const at = mode === 'go' ? (ui.day || ui.week) : mode === 'delay' ? (t.due > now ? t.due : now) : now, view = d(at < first && mode === 'delay' ? first : at);
    ui.pop = { mode, key: t ? t.key : null, keys: keys || null, y: view.getFullYear(), m: view.getMonth(), anchor: anchor || null,
      lo: mode === 'go' ? '0000-01-01' : mode === 'delay' ? (now > first ? now : first) : mode === 'all' ? plus(earliest, -120) : t ? plus(t.due, -120) : now, hi: mode === 'go' ? '9999-12-31' : mode === 'delay' ? last : now };
    render(); drawPop(); placePop();
    const go = $('tkPop').querySelector('.tk-quick button, .tk-menu button, .tk-cell:not([disabled])');
    if (go) go.focus({ preventScroll: true });
  }
  function closePop() { if (!ui.pop) return; ui.pop = null; $('tkPop').hidden = true; $('tkScrim').hidden = true; render(); }
  /** Beside the list, so the row being answered for stays in view; a day to look at opens under the date that was pressed. */
  function placePop() {
    const p = ui.pop, pop = $('tkPop');
    $('tkScrim').hidden = false; pop.hidden = false; pop.style.left = ''; pop.style.top = '';
    if (isPhone()) return;
    const row = p.key ? rowOf(p.key) : p.keys ? rowOf(p.keys[0]) : null, anchor = (p.key && row && row.querySelector(p.mode === 'delay' ? '.tk-put, .tk-soft' : '.tk-tick')) || (p.anchor && $(p.anchor)) || (row && row.querySelector('.tk-tick')) || $('tkDate') || $('tkWeek');
    if (!anchor) return;
    const r = anchor.getBoundingClientRect(), card = ((row && row.closest('.tk-list')) || anchor).getBoundingClientRect(), w = pop.offsetWidth, ht = pop.offsetHeight, W = root.innerWidth, H = root.innerHeight;
    let left = null, top;
    if (row) { if (card.right + 12 + w <= W - 12) left = card.right + 12; else if (card.left - 12 - w >= 12) left = card.left - 12 - w; }
    if (left != null) top = Math.max(12, Math.min(r.top + r.height / 2 - 100, H - ht - 12));
    else { left = Math.max(12, Math.min(r.left, W - w - 12)); top = r.bottom + 8; if (top + ht > H - 12) top = Math.max(12, r.top - ht - 8); }
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  /** What a day would mean, said before it is chosen. */
  function dayHint(k) {
    if (k === 'each') return [h('b', 'Each on the day it was due'), ' · nothing moves'];
    const p = ui.pop, now = App.today(), t = p.key ? byKey(p.key) : null, head = h('b', k === now ? 'Today' : shortDay(k));
    if (p.mode === 'go') { const n = k < now ? tasks().filter(x => x.on === k).length : tasks().filter(x => isOpen(x) && (k === now ? x.due <= now : x.due === k)).length; return [head, ` · ${k < now ? `${num(n)} done` : `${num(n)} ${k === now ? 'to do' : 'planned'}`}`]; }
    if (p.mode === 'all') {
      // what one day for all of them moves: plantings pushed out later by late sowing or hardening off, and harvests counted from a later day in the ground
      const list = p.keys.map(byKey).filter(Boolean), pre = App.previewWork(list.flatMap(x => x.items()), { date: k, follow: true }, { impact: false, firsts: true }), moved = pre.moved || [], firsts = pre.firsts || [];
      const said = [moved.length ? `${plural(moved.length, 'planting')} ${moved.length === 1 ? 'goes' : 'go'} out up to ${days(Math.max(...moved.map(m => m.days)))} later` : '', firsts.length ? `${plural(firsts.length, 'first harvest')} ${firsts.length === 1 ? 'moves' : 'move'}` : ''].filter(Boolean);
      return [head, ` · ${plural(list.length, 'task')} · ${said.length ? said.join(' · ') : 'nothing moves'}`];
    }
    const off = diff(k, t.due);
    if (p.mode === 'delay') return [head, ` · ${off ? `${days(Math.abs(off))} ${off > 0 ? 'later' : 'sooner'}` : 'where it is now'} · ${t.line.members.some(m => Week.MOVES.includes(t.sow ? m.s.kind : t.line.kind)) ? 'what follows it moves as many days' : 'nothing else moves'}`];
    const pre = App.previewWork(t.items(), { date: k, follow: true }, { impact: false }), moved = pre.moved || [], pairs = [...new Set(moved.map(m => `${m.from}|${m.to}`))].map(x => x.split('|'));
    return [head, ` · ${off > 0 ? `${days(off)} late` : off < 0 ? `${days(-off)} early` : 'on its day'} · ${!moved.length ? 'nothing moves' : pairs.length === 1 && pairs[0][1] !== 'null' ? `planting out ${day(d(pairs[0][0]))} → ${day(d(pairs[0][1]))}, and the harvest with it` : `${plural(moved.length, 'planting')} ${moved.length === 1 ? 'goes' : 'go'} out ${days(Math.max(...moved.map(m => m.days)))} later`}`];
  }
  function restHint() {
    const p = ui.pop, t = p.key ? byKey(p.key) : null;
    if (p.mode === 'go') return ui.day ? 'Pick any day to see what it holds.' : 'Pick any day to see its week.';
    if (p.mode === 'delay') return 'Pick the day you mean to do it.';
    if (p.mode === 'all') return 'One day for all of them, or each on the day it was due. A sowing or hardening off recorded after its day moves planting out, and the harvest, by as many days.';
    return t && (t.id === 'plugs' || t.id === 'rockwool' || t.id === 'harden') ? 'The circled day is when it was due: nothing moves. A later day moves planting out, and the harvest, by as many days.' : 'The circled day is when it was due.';
  }
  /** What ticking a task today, before its day, would do: said before it is done. */
  function aheadText(t, now) {
    const pre = App.previewWork(t.items(), { date: now, follow: true }, { impact: false, firsts: true }), firsts = pre.firsts || [], pairs = [...new Set(firsts.map(f => `${f.from}|${f.to}`))].map(x => x.split('|'));
    return `It is due ${shortDay(t.due)}, in ${days(diff(t.due, now))}. Ticked now, it is recorded as done today${!firsts.length ? ', and nothing else moves' : pairs.length === 1 ? `, and its first harvest moves ${day(d(pairs[0][0]))} → ${day(d(pairs[0][1]))}` : `, and ${plural(firsts.length, 'planting')} ${firsts.length === 1 ? 'is' : 'are'} picked sooner`}.`;
  }
  function drawPop() {
    const p = ui.pop, pop = $('tkPop'), now = App.today(), t = p.key ? byKey(p.key) : null;
    if (p.key && !t) { closePop(); return; }
    const head = (title, small) => [h('span.tk-grab', { 'aria-hidden': 'true' }), h('div.tk-pophead', h('div', h('strong', title), h('small', small)), h('button.tk-x', { type: 'button', 'aria-label': 'Close', dataset: { close: '1' } }, '×'))];
    if (p.mode === 'ahead') {
      clear(pop);
      add(pop, head('Done already?', `${t.title} · ${t.line.name}`), h('p.tk-ask', aheadText(t, now)),
        h('div.tk-quick', h('button', { type: 'button', dataset: { ahead: 'yes', hook: 'tasks-ahead-yes' } }, 'Record it today', h('small', shortDay(now)))),
        h('button.tk-plain', { type: 'button', dataset: { close: '1', hook: 'tasks-ahead-no' } }, 'Not yet'));
      return;
    }
    if (p.mode === 'more') {
      const n = App.seasonRecords();
      clear(pop);
      add(pop, head('This season’s records', `${App.planYear()}`),
        h('div.tk-menu', h('button', { type: 'button', disabled: !(n.sowings + n.jobs + n.delays + n.skips), dataset: { more: 'takeback', hook: 'tasks-takeback' } }, 'Take back everything recorded…')));
      return;
    }
    if (p.mode === 'all' && !p.keys.map(byKey).some(x => x && isOpen(x))) { closePop(); return; }
    const inRange = k => k >= p.lo && k <= p.hi && !(p.mode === 'delay' && k === t.due);
    const quick = p.mode === 'delay' ? [[plus(now, 1), 'Tomorrow'], [plus(T.monday(now), 7), 'Next week']].find(q => inRange(q[0])) : [now, 'Today'];
    const first = new Date(p.y, p.m, 1), blanks = (first.getDay() + 6) % 7, n = new Date(p.y, p.m + 1, 0).getDate(), cells = [];
    const busy = p.mode === 'go' ? new Set(tasks().flatMap(x => (isOpen(x) ? [x.due < now ? now : x.due] : x.on ? [x.on] : []))) : null;
    for (let b = 0; b < blanks; b++) cells.push(h('i'));
    for (let i = 1; i <= n; i++) {
      const k = E.d2s(new Date(p.y, p.m, i)), ok = inRange(k), due = p.mode === 'done' && !!t && k === t.due, cur = p.mode === 'delay' && k === t.due;
      cells.push(h('button.tk-cell' + (k === now ? '.now' : '') + (due ? '.due' : '') + (cur ? '.cur' : '') + (p.mode === 'go' && k === ui.day ? '.sel' : '') + (busy && busy.has(k) ? '.has' : ''),
        { type: 'button', disabled: !ok, dataset: ok ? { pick: k } : {}, 'aria-label': `${shortDay(k)}${due ? ', the day it was due' : cur ? ', where it is now' : k === now ? ', today' : ''}` }, String(i)));
    }
    const lastOfPrev = E.d2s(new Date(p.y, p.m, 0)), firstOfNext = E.d2s(new Date(p.y, p.m + 1, 1));
    clear(pop);
    add(pop, h('span.tk-grab', { 'aria-hidden': 'true' }),
      h('div.tk-pophead', h('div', h('strong', p.mode === 'go' ? 'Go to a day' : p.mode === 'delay' ? 'Delay it to' : p.mode === 'all' ? 'When were they done?' : 'When was it done?'), h('small', t ? `${t.title} · ${t.line.name}` : p.mode === 'all' ? `${plural(p.keys.length, 'task')}, all marked done on one day` : 'A dot marks a day with tasks')),
        h('button.tk-x', { type: 'button', 'aria-label': 'Close', dataset: { close: '1' } }, '×')),
      quick ? h('div.tk-quick', h('button', { type: 'button', dataset: { pick: quick[0] } }, quick[1], h('small', shortDay(quick[0])))) : null,
      p.mode === 'all' ? h('div.tk-quick.each', h('button', { type: 'button', dataset: { pick: 'each', hook: 'tasks-mark-all-each' }, title: 'Each recorded on the day it was due: nothing moves' }, 'Each on the day it was due', h('small', 'nothing moves'))) : null,
      h('div.tk-calhead', h('b', `${MONTH[p.m]} ${p.y}`), h('button', { type: 'button', 'aria-label': 'The month before', disabled: lastOfPrev < p.lo, dataset: { month: '-1' } }, '‹'), h('button', { type: 'button', 'aria-label': 'The month after', disabled: firstOfNext > p.hi, dataset: { month: '1' } }, '›')),
      h('div.tk-cal', ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('span', { 'aria-hidden': 'true' }, x)), cells),
      h('p.tk-hint', { id: 'tkHint' }, restHint()));
  }
  function pick(k) {
    const p = ui.pop, t = p.key ? byKey(p.key) : null, row = p.key ? rowOf(p.key) : null, weekly = !ui.day;
    ui.pop = null; $('tkPop').hidden = true; $('tkScrim').hidden = true;
    if (p.mode === 'go') { if (weekly) show(null, T.monday(k)); else viewDay(k); return; }
    if (p.mode === 'all') { ui.open = null; finishAll(p.keys, k); render(); return; }
    if (!t) { render(); return; }
    if (p.mode === 'delay') { ui.open = null; delayTo(t, k); render(); return; }
    if (row) row.classList.remove('pending');
    strike(row, () => { finishTick(t, k); render(); });
  }

  // ── which day or week is on screen ──
  let swapped = false;
  /** One day on screen, or a whole week (day null). What the lists hold comes in with a small rise when it changes. */
  function show(dayIso, week) {
    swapped = ui.day !== dayIso || ui.week !== week;
    ui.day = dayIso; ui.week = week; ui.open = null;
    render();
  }
  const viewDay = k => show(k, T.monday(k));
  /** Arriving at another week shows all of it; this week opens on today. */
  const viewWeek = a => { const now = App.today(); show(a === T.monday(now) ? now : null, a); };
  function setScope(scope) { if (!SCOPES.some(x => x[0] === scope)) return false; ui.scope = scope; if (scope !== 'all') ui.tab = scope; keepPrefs(); render(); return true; }
  let arrive = null;
  /** Go to the list on one of its halves, on the week the planner's date is in: the way in from the Nursery. */
  function open(scope) {
    if (scope && SCOPES.some(x => x[0] === scope)) { ui.scope = scope; if (scope !== 'all') ui.tab = scope; keepPrefs(); }
    const week = T.monday(E.d2s(App.state.date));
    if (App.state.view !== 'sow') { arrive = week; App.setView('sow'); } else viewWeek(week);
  }
  /** What is still to do in one week, by kind and by half: for a view that points here. */
  function weekCounts(week) {
    const sow = figures().list.filter(l => l.week === week && l.state !== 'done'), other = jobs().filter(l => l.week === week && !l.passed && l.state !== 'done');
    const n = k => other.filter(l => l.section === k).length, tray = sow.filter(l => l.kind !== 'direct').length, direct = sow.length - tray;
    return { sow: tray, direct, potup: n('potup'), harden: n('harden'), plant: n('plant'), move: n('move'), nursery: tray + n('potup') + n('harden'), field: direct + n('plant') + n('move') };
  }

  /** A line's place on the map. On a phone the page is the tasks and nothing else, so there is no way there. */
  function showOnMap(m) { if (isPhone()) return; App.setView('map'); App.setDate(m.r.field); App.select({ type: 'planting', id: m.p.id }); }
  const span = (a, names) => { const x = d(a), y = d(plus(a, 6)); return `${names[x.getMonth()]} ${x.getDate()} – ${y.getMonth() === x.getMonth() ? '' : names[y.getMonth()] + ' '}${y.getDate()}`; };

  function render() {
    if (!App.state.ready || App.state.view !== 'sow') { dirty = true; return; }
    dirty = false;
    const host = $('swWrap'), keep = host.parentElement.scrollTop, now = App.today(), phone = isPhone(), stock = App.stockNow(), cur = T.monday(now);
    if (!ui.week) { ui.day = now; ui.week = cur; }
    const a = ui.week, k = ui.day, isNow = live(), soon = later(), all = onScreen(), todo = all.open.length, did = all.done.length;
    if (ui.open && !all.open.some(t => t.key === ui.open)) ui.open = null;
    // the week's seven cells: what each day holds. Today also holds whatever is late.
    const openOn = new Map(), doneOn = new Map();
    let late = 0;
    for (const t of tasks()) { if (isOpen(t)) { if (t.due < now) late++; else openOn.set(t.due, (openOn.get(t.due) || 0) + 1); } else if (t.on) doneOn.set(t.on, (doneOn.get(t.on) || 0) + 1); }
    let dayRing = null, dayShare = 0;
    const cells = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const x = plus(a, i), dn = doneOn.get(x) || 0, open = x < now ? 0 : (openOn.get(x) || 0) + (x === now ? late : 0), lateHere = x === now ? late : 0;
      const said = `${FULL[d(x).getDay()]} ${day(d(x))}: ${x < now ? `${num(dn)} done` : `${num(open)} to do${lateHere ? `, ${num(lateHere)} of them late` : ''}${dn ? `, ${num(dn)} done` : ''}`}`;
      const ring = x === now ? RING(18.5, 42) : null;
      if (ring) { dayRing = ring; dayShare = open + dn ? dn / (open + dn) : 0; }
      return h('button.tk-day' + (x === now ? '.now' : '') + (x < now ? '.gone' : ''), { type: 'button', dataset: { act: 'day', day: x }, 'aria-pressed': String(x === k), 'aria-label': said, title: said },
        h('small', wd(x)), h('span.tk-face', ring, h('b', String(d(x).getDate()))), h('em' + (lateHere ? '.late' : !open && dn ? '.ok' : ''), open ? num(open) : dn ? `✓ ${num(dn)}` : ''));
    });
    const dated = k ? d(k) : null, near = k && Math.abs(diff(k, now)) < 2;
    const title = k ? (k === now ? 'Today' : k === plus(now, 1) ? 'Tomorrow' : k === plus(now, -1) ? 'Yesterday' : FULL[dated.getDay()]) : a === cur ? 'This week' : a === plus(cur, 7) ? 'Next week' : a === plus(cur, -7) ? 'Last week' : `Week of ${day(d(a))}`;
    const count = isNow ? (todo ? `${num(todo)} to do` : did ? 'all done' : 'nothing to do') : soon ? (todo ? `${num(todo)} planned` : 'nothing planned') : `${num(did)} done`;
    const lists = GROUPS.map(([id, name]) => {
      const s = onScreen(id), left = s.open.length, n = s.done.length, ring = isNow && left + n ? RING(10, 26) : null;
      if (ring) fillRing(ring, id, n / (left + n), 62.83);
      return h('section.tk-list' + (ui.tab === id ? '' : '.off'), { dataset: { half: id }, 'aria-label': name },
        h('header', h('h3', name), h('span.tk-count', isNow ? (left + n ? `${num(n)} of ${num(left + n)}` : '') : soon ? (left ? `${num(left)} planned` : '') : (n ? `${num(n)} done` : '')), ring),
        h('div.tk-body' + (swapped ? '.swap' : ''), id === 'nursery' ? fillHead(s.open) : null, k ? dayBody(id, name, stock, now) : weekBody(id, name, stock, now)));
    });
    if (dayRing) fillRing(dayRing, 'day', dayShare, 116.24);
    clear(host);
    add(host,
      h('div.tk-top',
        h('h2', { id: 'wkTitle' }, title),
        h('span.tk-range', { id: 'tkRange' }, k ? [h('button.tk-date', { type: 'button', id: 'tkDate', 'aria-haspopup': 'dialog', title: 'Go to another day', dataset: { act: 'cal' } }, `${near ? FULL[dated.getDay()] + ', ' : ''}${MONTH[dated.getMonth()]} ${dated.getDate()}${dated.getFullYear() === d(now).getFullYear() ? '' : ', ' + dated.getFullYear()}`, CARET()), ' · '] : null, count),
        framed || phone ? null : h('button.tk-quiet', { type: 'button', id: 'wkPrint', title: 'The week as a sheet to carry: a box for each task and a place for the day it was done', dataset: { act: 'print' } }, 'Print the week'),
        h('button.tk-dots', { type: 'button', id: 'tkMore', 'aria-label': 'More', 'aria-haspopup': 'dialog', title: 'This season’s records', dataset: { act: 'more', hook: 'tasks-more' } }, '⋯')),
      h('section.tk-week', { id: 'tkBar', 'aria-label': 'The week' },
        h('div.tk-wk-head',
          h('button.tk-wk-date', { type: 'button', id: 'tkWeek', 'aria-haspopup': 'dialog', title: 'Go to another day', dataset: { act: 'cal' } }, h('span.wide', span(a, MONTH)), h('span.slim', span(a, UI.MONTHS)), CARET()),
          k === now ? null : h('button.tk-today', { type: 'button', id: 'wkToday', dataset: { act: 'today' } }, 'Today'),
          h('div.tk-mode', { role: 'group', 'aria-label': 'Show a day or the whole week', id: 'tkMode' },
            h('button', { type: 'button', 'aria-pressed': String(!!k), dataset: { act: 'mode', mode: 'day' } }, 'Day'), h('button', { type: 'button', 'aria-pressed': String(!k), dataset: { act: 'mode', mode: 'week' } }, 'Week')),
          h('div.tk-step', { role: 'group', 'aria-label': 'Move by a week' },
            h('button', { type: 'button', 'aria-label': 'Back one week', dataset: { act: 'week', by: '-7' } }, s('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('path', { d: 'M9 2.5L4.5 7 9 11.5' }))),
            h('button', { type: 'button', 'aria-label': 'Forward one week', dataset: { act: 'week', by: '7' } }, s('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, s('path', { d: 'M5 2.5L9.5 7 5 11.5' }))))),
        h('div.tk-days', { id: 'tkDays', role: 'group', 'aria-label': 'Days of the week' }, cells)),
      h('div.tk-tabs', { role: 'tablist', 'aria-label': 'Lists', id: 'tkTabs' }, GROUPS.map(([id, name]) => {
        const s = onScreen(id), left = s.open.length, lateHere = isNow && s.open.some(t => t.due < now);
        return h('button', { type: 'button', role: 'tab', 'aria-selected': String(ui.tab === id), dataset: { act: 'tab', half: id } }, name, h('small' + (lateHere ? '.late' : ''), !isNow && !soon ? `${num(s.done.length)} done` : left ? `${num(left)}${isNow ? ' left' : ''}` : isNow ? 'done' : '0'));
      })),
      h('div.tk-lists', { id: 'tkLists' }, lists),
      upcoming(now),
      phone ? null : Bench.line());
    swapped = false;
    host.parentElement.scrollTop = keep;
    if (ui.pop && !$('tkPop').hidden) placePop();
  }

  // ── what a press does ──
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, row = el.closest('.tk-row'), t = row ? byKey(row.dataset.line) : null, now = App.today();
    if (act === 'tick') { if (t) tick(t, row); }
    else if (act === 'open') { if (t && isOpen(t) && !ui.busy) { ui.open = ui.open === t.key ? null : t.key; render(); } }
    else if (act === 'delay') { if (t && !ui.busy) openPop('delay', t); }
    else if (act === 'skip') { if (t && !ui.busy) skipTask(t); }
    else if (act === 'map') { if (t) showOnMap(t.line.members[0]); }
    else if (act === 'fold') { const on = !ui.shown[el.dataset.half]; ui.shown[el.dataset.half] = on; el.setAttribute('aria-expanded', String(on)); el.nextElementSibling.classList.toggle('shut', !on); }
    else if (act === 'late') { ui.shown[el.dataset.half + ':late'] = true; render(); }
    else if (act === 'go' || act === 'day') viewDay(el.dataset.day);
    else if (act === 'today') viewDay(now);
    else if (act === 'week') viewWeek(plus(ui.week, +el.dataset.by));
    else if (act === 'cal') openPop('go', null, el.id);
    else if (act === 'tab') { ui.tab = el.dataset.half; ui.scope = ui.tab; keepPrefs(); render(); }
    else if (act === 'print') printWeek(figures(), ui.week);
    else if (act === 'all') { try { markAll(JSON.parse(el.dataset.keys), el); } catch (_) { /* a list of keys that cannot be read is left alone */ } }
    else if (act === 'upweek') { viewWeek(el.dataset.week); const top = host => host && host.parentElement && host.parentElement.scrollTo && host.parentElement.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); top($('swWrap')); }
    else if (act === 'more') openPop('more', null, el.id);
    else if (act === 'mode') {
      if (el.dataset.mode === 'week') { if (ui.day) show(null, ui.week); return; }
      if (ui.day) return;
      if (ui.week === T.monday(now)) { viewDay(now); return; }
      const busy = tasks().find(x => (isOpen(x) ? x.due : x.on) >= ui.week && (isOpen(x) ? x.due : x.on) <= plus(ui.week, 6));
      viewDay(busy ? (isOpen(busy) ? busy.due : busy.on) : ui.week);
    }
  }
  /** A note is kept when the box is left, and Enter leaves it. */
  function onChange(e) {
    const key = e.target && e.target.dataset && e.target.dataset.note, t = key ? byKey(key) : null;
    if (t) App.noteWork(membersOf(t).map(m => ({ id: m.p.id, kind: m.kind })), e.target.value);
  }
  function onKey(e) {
    if (App.state.view !== 'sow') return;
    if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.note) { e.target.blur(); ui.open = null; render(); return; }
    if (e.key === 'Escape') { if (ui.pop) closePop(); else if (ui.open) { ui.open = null; render(); } return; }
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || ui.pop || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    const by = e.key === 'ArrowLeft' ? -1 : 1;
    if (ui.day) viewDay(plus(ui.day, by)); else viewWeek(plus(ui.week, 7 * by));
  }
  function onPop(e) {
    const p = ui.pop;
    if (!p) return;
    if (e.target.closest('[data-close]')) { closePop(); return; }
    const m = e.target.closest('[data-month]');
    if (m) { const to = new Date(p.y, p.m + (+m.dataset.month), 1); p.y = to.getFullYear(); p.m = to.getMonth(); drawPop(); return; }
    const cell = e.target.closest('[data-pick]');
    if (cell) { pick(cell.dataset.pick); return; }
    if (e.target.closest('[data-ahead]')) { const t = byKey(p.key), row = rowOf(p.key); ui.pop = null; $('tkPop').hidden = true; $('tkScrim').hidden = true; if (t && isOpen(t)) strike(row, () => { finishTick(t, App.today()); render(); }); else render(); return; }
    if (e.target.closest('[data-more="takeback"]')) { closePop(); askTakeBack(); }
  }

  // ── everything recorded this season, taken back at once: under "⋯", with a sheet that counts what goes back ──
  async function askTakeBack() {
    const n = App.seasonRecords(), year = App.planYear();
    if (!(n.sowings + n.jobs + n.delays + n.skips)) { UI.toast(`Nothing is recorded in ${year}.`); return; }
    const lines = [n.sowings ? `${plural(n.sowings, 'sowing')} taken back${n.seed ? ', with the seed they took returned to its lots' : ''}` : '', n.jobs ? `${plural(n.jobs, 'other task')} (potting up, hardening off, planting out, moving out) taken back` : '',
      n.delays ? `${plural(n.delays, 'task')} put off go${n.delays === 1 ? 'es' : ''} back to ${n.delays === 1 ? 'its' : 'their'} day` : '', n.skips ? `${plural(n.skips, 'skipped task')} back on the list` : ''].filter(Boolean);
    const keep = [n.notes ? `${plural(n.notes, 'note')} on tasks stay` : 'notes on tasks stay', n.failed ? `${plural(n.failed, 'planting')} marked failed stay${n.failed === 1 ? 's' : ''} marked` : ''].filter(Boolean);
    const yes = await new Promise(resolve => {
      const done = value => { dialog.close(); dialog.remove(); resolve(value); };
      const dialog = h('dialog.dialog.tk-sheet', { dataset: { hook: 'tasks-takeback-sheet' }, oncancel: e => { e.preventDefault(); done(false); } },
        h('h2', `Take back everything recorded in ${year}?`),
        h('p', `The plan goes back to what it was before the season was recorded, in ${plural(n.plantings, 'planting')}. A snapshot of the plan as it stands is kept first, and Undo puts it all back.`),
        h('ul.tk-sheet-list', { dataset: { hook: 'tasks-takeback-counts' } }, lines.map(x => h('li', x)), keep.map(x => h('li.keep', x))),
        h('div.dialog-actions', h('button.btn', { type: 'button', onclick: () => done(false) }, 'Cancel'),
          h('button.btn.primary', { type: 'button', dataset: { hook: 'tasks-takeback-yes' }, onclick: () => done(true) }, 'Take back everything')));
      document.body.append(dialog); dialog.showModal();
    });
    if (!yes) return;
    const done = await App.takeBackSeason();
    if (!done) return;
    UI.toast([`Everything recorded in ${year} taken back`, done.sowings ? plural(done.sowings, 'sowing') : '', done.jobs ? plural(done.jobs, 'other task') : '', done.delays ? `${plural(done.delays, 'task')} put back on ${done.delays === 1 ? 'its' : 'their'} day` : '',
      done.skips ? `${plural(done.skips, 'skip')} cleared` : '', done.lost ? 'some seed could not go back: its lot is gone' : '', done.failed.length ? `${plural(done.failed.length, 'planting')} left as it was: ${done.failed[0].why}` : '',
      done.overlaps ? `${done.overlaps === 1 ? 'one planting now overlaps another' : done.overlaps + ' plantings now overlap others'}: see To settle` : '', done.snapshot ? 'the plan as it stood is under Snapshots' : ''].filter(Boolean).join(' · '), { label: 'Undo', run: App.undo });
  }
  const hint = nodes => { const el = $('tkHint'); if (el) { clear(el); add(el, nodes); } };

  // ── the printed sheet: the week as a list to carry and tick by hand ──
  const framed = (() => { try { return root.self !== root.top; } catch (_) { return true; } })();
  function sheetRows(title, lines, cells) {
    if (!lines.length) return null;
    return [h('tr.wkp-head', h('th', { colSpan: 6 }, title)), lines.map(l => { const c = cells(l), over = l.state === 'done'; return h('tr', h('td.wkp-box', over ? '☑' : '☐'), h('td.wkp-day', c[0]), h('td', h('b', l.name), l.sub ? h('span', ` ${l.sub}`) : null), h('td', c[1]), h('td', c[2]), h('td.wkp-done', over && l.doneOn ? day(d(l.doneOn)) : '')); })];
  }
  function sheetTable(sow, other, withWeek) {
    const when = l => { const x = d(l.date); return withWeek ? `${day(x)}` : `${UI.DAYS[x.getDay()]} ${x.getDate()}`; };
    const body = [];
    for (const [id, title, , kinds, jobKinds] of GROUPS) {
      const rows = [
        ...KINDS.filter(k => kinds.includes(k[0])).map(([kind, name]) => sheetRows(kind === 'direct' ? 'Sow in the ground' : `Sow: ${name.toLowerCase()}`, sow.filter(l => l.kind === kind), l => [when(l), [howText(l), howNote(l), l.amount ? amountText(l.state === 'done' ? l.amount : l.estimate, l.unit) : ''].filter(Boolean).join(' · '), whereText(l)])),
        ...JOBS.filter(k => jobKinds.includes(k[0])).map(([job, name]) => sheetRows(name, other.filter(l => l.section === job && !l.passed), l => [when(l), jobHow(l).filter(Boolean).join(' · '), jobWhere(l)]))].filter(Boolean);
      if (!rows.length) continue;
      body.push(h('tr.wkp-half', { dataset: { half: id } }, h('th', { colSpan: 6 }, title)));
      body.push(...rows);
    }
    return body.length ? h('table', h('thead', h('tr', h('th'), h('th', withWeek ? 'Planned' : 'Day'), h('th', 'What'), h('th', 'How much'), h('th', 'Where, or for'), h('th', 'Done on'))), h('tbody', body)) : null;
  }
  /** The week as a sheet of paper: every job with a box to tick and a place to write the day it was done. */
  function sheet(fig, now, span = 1) {
    const until = E.d2s(E.addDays(d(now), 7 * span - 1)), inSpan = l => l.week >= now && l.week <= until;
    const sown = fig.list.filter(l => !l.skipped), all = jobs().filter(l => !l.skipped), week = sown.filter(inSpan), weekJobs = all.filter(inSpan), earlier = sown.filter(l => l.week < now && l.state !== 'done'), earlierJobs = all.filter(l => l.week < now && l.state !== 'done');
    const last = d(until), half = '', from = UI.dayLong(d(now)).replace(/^\w+ /, '');
    return h('div.wkp', { dataset: { scope: 'all' } },
      h('h1', span === 1 ? `${half}${half ? 'week' : 'Week'} of ${from}` : `${half}${num(span)} weeks from ${from}`), h('p.wkp-sub', `Monday ${day(d(now))} to Sunday ${day(last)} · ${plural(week.length + weekJobs.filter(l => !l.passed).length, 'task')} · printed ${day(new Date())}`),
      sheetTable(week, weekJobs, span > 1) || h('p', span === 1 ? 'Nothing is planned for this week.' : 'Nothing is planned for these weeks.'),
      // what is late is printed with this week, where it is listed: a task is late by today's date, whatever week is looked at
      now === T.monday(App.today()) && earlier.length + earlierJobs.length ? [h('h2', 'Not recorded from earlier weeks'), sheetTable(earlier, earlierJobs, true)] : null,
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

  let lastView = null, swipe = null;
  /** Coming to the page from elsewhere: it opens on today, or on the week a link asked for. */
  function onView() {
    const view = App.state.view;
    if (view === 'sow' && lastView !== 'sow' && App.state.ready) {
      const now = App.today(), week = arrive || T.monday(now);
      arrive = null; ui.week = week; ui.day = week === T.monday(now) ? now : null; ui.open = null; swapped = false;
    }
    if (view !== 'sow' && ui.pop) { ui.pop = null; $('tkPop').hidden = true; $('tkScrim').hidden = true; }
    lastView = view;
    render();
  }
  function init() {
    App.on('plan', render); App.on('view', onView); App.on('nursery', render);
    Thumbs.on(() => { if (App.state.view === 'sow') render(); });
    if (narrow) { narrow.addEventListener('change', fitPhone); App.on('plan', fitPhone); App.on('view', fitPhone); fitPhone(); }
    const full = $('wkFull'), host = $('swWrap');
    if (full) full.addEventListener('click', leavePhone);
    host.addEventListener('click', onClick); host.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    // a sideways swipe on the week moves a week
    host.addEventListener('touchstart', e => { swipe = e.target.closest('.tk-week') ? e.touches[0].clientX : null; }, { passive: true });
    host.addEventListener('touchend', e => { if (swipe == null) return; const dx = e.changedTouches[0].clientX - swipe; swipe = null; if (Math.abs(dx) > 48) viewWeek(plus(ui.week, dx < 0 ? 7 : -7)); }, { passive: true });
    document.body.append(h('div.tk-scrim', { id: 'tkScrim', hidden: true, onclick: closePop }), h('div.tk-pop', { id: 'tkPop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a day', hidden: true, onclick: onPop,
      onmouseover: e => { const c = e.target.closest('[data-pick]'); if (c && ui.pop) hint(dayHint(c.dataset.pick)); }, onfocusin: e => { const c = e.target.closest('[data-pick]'); if (c && ui.pop) hint(dayHint(c.dataset.pick)); },
      onmouseout: e => { if (e.target.closest('[data-pick]') && ui.pop) hint(restHint()); } }));
  }
  root.LRFSowView = { init, render, figures, jobs, tasks, weekCounts, setScope, open, scope: () => ui.scope, GROUPS: GROUPS.map(g => ({ id: g[0], name: g[1], sow: g[3], jobs: g[4] })),
    sheet: () => sheet(figures(), ui.week || T.monday(App.today())), show: k => viewDay(k), showWeek: a => show(null, T.monday(a)), where: () => ({ day: ui.day, week: ui.week, tab: ui.tab, open: ui.open, pop: ui.pop ? ui.pop.mode : null }),
    fitPhone, leavePhone, get dirty() { return dirty; } };
})(window);
