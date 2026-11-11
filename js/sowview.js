/* Little River Farm Planner — the Sowing view.
 *
 * Everything that is sown, a week at a time, set out as the acts the grower performs: one batch of plug
 * trays filled for several beds, rockwool for the towers, the week's live trays, a variety drilled into
 * its beds. Tick what was done and record it in one step: each planting is dated and its seed comes off
 * stock, exactly as recording one planting does.
 *
 * Only seed is listed. Bulbs, canes and bought-in plants are planted, not sown, and are recorded from
 * their own planting.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, SL = root.LRFSeedLib, T = root.LRFTrays, Thumbs = root.LRFThumbs, Bench = root.LRFBench, Sow = root.LRFSowing;
  const { h, clear, add, num, day } = UI;
  const $ = id => document.getElementById(id);
  const d = iso => E.s2d(iso);
  const dayName = date => UI.dayLong(date).replace(/, \d{4}$/, '');
  const round6 = n => Math.round(n * 1e6) / 1e6;
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  /** Seed as it is handled: a count, or a weight in grams up to a pound and pounds beyond. */
  const amountText = (n, unit) => unit === 'g' ? (!n ? '0 g' : n < 453.6 ? `${num(n, n < 10 ? 1 : 0)} g` : `${num(n / 453.592, 1)} lb`) : `${num(n)} seed${n === 1 ? '' : 's'}`;

  // In the order the sections are drawn.
  const KINDS = [
    ['plugs', 'Seedling trays', 'Plug trays sown in the greenhouse for transplanting. Plantings of one variety with one schedule are sown as one batch.'],
    ['rockwool', 'Tower seedlings', 'Rockwool sown for the towers.'],
    ['live', 'Live trays', 'Whole trays sown to the weekly demand on the Trays view.'],
    ['direct', 'Sown in the ground', 'Seed that goes straight into a bed or a container.']
  ];
  const ui = { sel: new Set(), qty: new Map(), filter: 'all', earlier: false, date: null };
  let dirty = true;

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
    list.sort((a, b) => a.date.localeCompare(b.date) || KINDS.findIndex(k => k[0] === a.kind) - KINDS.findIndex(k => k[0] === b.kind) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    const weeks = [...new Set(list.map(l => l.week))].sort();
    const out = { list, weeks, total: list.length, done: list.filter(l => l.state === 'done').length };
    cache.set(eng, out);
    return out;
  }

  // ── what a line says ──
  /** How the sowing is done: rows of a tray, a number of trays, or rows in the ground. */
  function howText(line) {
    if (line.kind === 'live') { const g = line.crop.seedG > 0 ? ` · ${num(line.crop.seedG, 1)} g a tray` : ''; return `${plural(line.trays, 'tray')}${g}`; }
    if (line.kind === 'direct') {
      const rowFt = line.members.reduce((n, m) => n + (m.r.ct ? 0 : m.r.rows * m.r.physicalLength), 0), crates = line.members.reduce((n, m) => n + (m.r.ct ? m.r.len : 0), 0);
      return [rowFt ? `${num(rowFt)} row-ft` : '', crates ? plural(crates, 'container') : ''].filter(Boolean).join(' · ') || plural(line.members.reduce((n, m) => n + m.r.plants, 0), 'plant');
    }
    const b = line.batch;
    if (!b) return `${num(line.members.reduce((n, m) => n + m.r.cells, 0))} cells`;
    if (b.medium === 'pots') return `${plural(b.cells, 'pot')}`;
    const rows = b.mode === 'row' && Number.isInteger(b.rowsSown) ? `${plural(b.rowsSown, 'row')} of ${num(b.tray.columns)}` : `${num(b.cells)} cells`;
    return `${rows} · ${plural(b.trays, 'tray')}`;
  }
  const howNote = line => line.kind === 'plugs' && line.batch && line.batch.medium !== 'pots' ? `${num(line.batch.tray.cells)}-cell tray` : line.kind === 'rockwool' && line.batch ? `${num(line.batch.tray.cells)}-cell sheet` : '';
  /** Where it is going: the beds a transplant is raised for and the day it goes out, or the beds a direct sowing is in. */
  function whereText(line) {
    if (line.kind === 'live') return `ready ${dayName(line.members[0].r.first)}`;
    const byGarden = new Map();
    for (const m of line.members) { const list = byGarden.get(m.r.g.name) || []; list.push(String(m.r.b.bed)); byGarden.set(m.r.g.name, list); }
    const places = [...byGarden].map(([garden, beds]) => { const uniq = [...new Set(beds)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); return `${garden}${/\d$/.test(garden) ? ':' : ''} ${uniq.length > 6 ? uniq.slice(0, 5).join(', ') + ` +${uniq.length - 5}` : uniq.join(', ')}`; }).join('; ');
    return line.kind === 'direct' ? places : `${places} · out ${day(line.field)}`;
  }
  /** Whether the seed is there. Only a real shortfall is coloured: seed on order, or none counted yet, is said plainly. */
  function stockNote(line, stock) {
    if (line.state === 'done') return null;
    if (line.kind === 'live' && !(line.crop.seedG > 0)) return h('small', 'no grams per tray set');
    const row = stock[line.stockKey + '|' + line.stockUnit] || {}, have = row.onHand || 0, bare = n => amountText(n, line.stockUnit).replace(/ seeds?$/, '');
    if (have + 1e-9 >= line.estimate && have) return h('small', `${bare(have)} on hand`);
    if (have) return h('small.sw-short', `only ${bare(have)} on hand`);
    return h('small', row.onOrder ? `${bare(row.onOrder)} on order` : line.variety || line.kind === 'live' ? 'none on hand' : 'no variety chosen');
  }

  // ── recording ──
  /** What each planting of a line records when the line's total is typed over: the same shares, scaled. */
  function itemsFor(line) {
    const open = line.open, typed = ui.qty.get(line.key);
    if (typed == null || typed === '' || !(Number(typed) >= 0) || round6(Number(typed)) === line.estimate) return open.map(m => ({ id: m.p.id }));
    const total = Number(typed), base = line.estimate || open.length, whole = line.stockUnit !== 'g';
    const shares = open.map(m => (line.estimate ? m.s.estimate : 1) / base * total), out = shares.map(x => whole ? Math.floor(x) : round6(x));
    if (whole) { let left = Math.round(total - out.reduce((n, x) => n + x, 0)); const order = shares.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]); for (let i = 0; left > 0 && order.length; i++, left--) out[order[i % order.length][1]]++; }
    return open.map((m, i) => ({ id: m.p.id, quantity: out[i] }));
  }
  function record(fig) {
    const lines = fig.list.filter(l => ui.sel.has(l.key) && l.open.length), date = ui.date || App.today();
    if (!lines.length) return;
    const done = App.recordSowings(lines.flatMap(itemsFor), { date });
    if (!done) return;
    for (const l of lines) { ui.sel.delete(l.key); ui.qty.delete(l.key); }
    const units = [...new Set(lines.map(l => l.stockUnit))], unit = units.length === 1 ? units[0] : null, n = done.done.length;
    UI.toast(`${plural(lines.length, 'sowing')} recorded ${day(d(date))}${n !== lines.length ? ` for ${plural(n, 'planting')}` : ''}`
      + (unit ? ` · ${done.used ? amountText(done.used, unit) + ' off stock' : 'nothing off stock'}${done.untracked ? ` · ${amountText(done.untracked, unit)} not from a counted lot` : ''}` : done.used || done.untracked ? ' · seed taken off stock where there was any' : '')
      + (done.failed.length ? ` · ${plural(done.failed.length, 'planting')} left as it was: ${done.failed[0].why}` : '')
      + (done.overlaps ? ` · ${done.overlaps === 1 ? 'one planting now overlaps another' : done.overlaps + ' plantings now overlap others'}: see To settle` : ''), { label: 'Undo', run: App.undo });
  }
  function takeBack(line) {
    const done = App.takeBackSowings(line.members.filter(m => m.s.done).map(m => m.p.id));
    if (done) UI.toast(`${line.name}: sowing taken back${done.returned ? ` · ${amountText(done.returned, line.stockUnit)} returned to stock` : ''}${done.lost ? ` · ${amountText(done.lost, line.stockUnit)} could not go back: that lot is gone` : ''}`, { label: 'Undo', run: App.undo });
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
      h('td.sw-when', h('b', withWeek ? day(d(line.date)) : UI.DAYS[d(line.date).getDay()]), h('small', withWeek ? UI.DAYS[d(line.date).getDay()] : day(d(line.date)))),
      h('td.sw-what', h('div.sd-cell', Thumbs.el({ varietyId: line.variety && line.variety.id, cropId: line.crop.id, color, label: line.name, size: 34 }), h('span.sd-name', h('b', line.name), line.sub ? h('small', line.sub) : null))),
      h('td.sw-how', h('span', howText(line)), howNote(line) ? h('small', howNote(line)) : null),
      h('td.sw-seed', seed, stockNote(line, stock), !open && line.doneOn ? h('small', `sown ${day(d(line.doneOn))}`) : line.state === 'part' ? h('small', `${num(line.members.length - line.open.length)} of ${num(line.members.length)} recorded`) : null),
      h('td.sw-where', h('button.linkish', { type: 'button', title: 'Show on the map', onclick: () => { App.setView('map'); App.setDate(first.r.field); App.select({ type: 'planting', id: first.p.id }); } }, whereText(line)),
        line.members.length > 1 && line.kind !== 'live' ? h('small', ` ${plural(line.members.length, 'planting')}`) : null),
      h('td.sw-act', !open && line.members.some(m => m.s.done) ? h('button.link', { type: 'button', onclick: () => takeBack(line) }, 'Take back') : null));
  }
  function table(lines, stock, withWeek) {
    const openKeys = lines.filter(l => l.state !== 'done').map(l => l.key), all = openKeys.length > 0 && openKeys.every(k => ui.sel.has(k));
    return h('div.tr-scroll', h('table.as.sw',
      h('thead', h('tr',
        h('th.sw-pick', openKeys.length ? h('input', { type: 'checkbox', checked: all, 'aria-label': 'All of these', title: 'All of these', onchange: e => { for (const k of openKeys) { if (e.target.checked) ui.sel.add(k); else { ui.sel.delete(k); ui.qty.delete(k); } } render(); } }) : null),
        h('th.sw-when', withWeek ? 'Planned' : 'Day'), h('th.sw-what', 'What'), h('th.sw-how', 'How much'), h('th.sw-seed', 'Seed'), h('th.sw-where', 'For'), h('th.sw-act'))),
      h('tbody', lines.map(l => lineRow(l, stock, withWeek)))));
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

  function render() {
    if (!App.state.ready || App.state.view !== 'sow') { dirty = true; return; }
    dirty = false;
    const host = $('swWrap'), keep = host.parentElement.scrollTop, fig = figures(), stock = App.stockNow(), now = T.monday(E.d2s(App.state.date)), today = App.today();
    // a selection outlives a redraw, but not the line it pointed at
    const known = new Set(fig.list.filter(l => l.state !== 'done').map(l => l.key));
    for (const k of [...ui.sel]) if (!known.has(k)) { ui.sel.delete(k); ui.qty.delete(k); }
    if (!ui.date || ui.date > today) ui.date = today;
    const week = fig.list.filter(l => l.week === now), earlier = fig.list.filter(l => l.week < now && l.state !== 'done'), weekOpen = week.filter(l => l.state !== 'done');
    const sum = (list, unit) => list.filter(l => l.unit === unit).reduce((n, l) => n + l.amount, 0), trays = week.reduce((n, l) => n + l.trays, 0);
    const next = fig.weeks.find(w => w > now), prev = fig.weeks.filter(w => w < now).pop(), step = n => () => App.setDate(E.addDays(d(now), n));
    const selected = fig.list.filter(l => ui.sel.has(l.key)), chips = [['all', 'Everything'], ...KINDS.map(k => [k[0], k[1]])].filter(([id]) => id === 'all' || week.some(l => l.kind === id) || (ui.earlier && earlier.some(l => l.kind === id)));
    if (!chips.some(([id]) => id === ui.filter)) ui.filter = 'all';
    clear(host);
    add(host,
      h('header.as-head', h('p.eyebrow', `Sowing · ${App.planYear()}`), h('h2', 'What to sow, week by week'),
        h('p', 'Each line is one sowing as it is done: a batch of plug trays filled for several beds, rockwool for the towers, the week’s live trays, a variety drilled into its beds. Tick what was sown and record it: the plantings are dated and the seed comes off stock.')),
      h('div.tr-stats.sw-stats',
        stat(`Week of ${day(d(now))}`, week.length ? `${num(weekOpen.length)} to sow` : 'Nothing', week.length ? (week.length - weekOpen.length ? `${num(week.length - weekOpen.length)} of ${num(week.length)} recorded` : plural(week.length, 'sowing') + ' planned') : next ? `next sowing ${dayName(d(fig.list.find(l => l.week === next).date))}` : 'no sowing after this'),
        stat('Seed this week', sum(week, 'seeds') ? num(sum(week, 'seeds')) : sum(week, 'g') ? amountText(sum(week, 'g'), 'g') : '—', sum(week, 'seeds') ? `seeds${sum(week, 'g') ? ' · ' + amountText(sum(week, 'g'), 'g') + ' for trays' : ''}` : sum(week, 'g') ? 'for live trays' : ''),
        stat('Trays to fill', trays ? num(trays) : '—', trays ? [['plugs', 'seedling'], ['rockwool', 'tower'], ['live', 'live']].map(([k, word]) => { const n = week.filter(l => l.kind === k).reduce((m, l) => m + l.trays, 0); return n ? `${num(n)} ${word}` : ''; }).filter(Boolean).join(' · ') : ''),
        stat('Earlier, not recorded', num(earlier.length), earlier.length ? `since ${day(d(earlier[0].date))}` : 'nothing is waiting'),
        stat('This season', `${num(fig.done)} of ${num(fig.total)}`, 'sowings recorded')),
      h('div.sw-bar',
        h('span.tr-stepper', h('button.icon-btn', { type: 'button', 'aria-label': 'Back one week', onclick: step(-7) }, '‹'), h('b', `Week of ${day(d(now))}`), h('button.icon-btn', { type: 'button', 'aria-label': 'Forward one week', onclick: step(7) }, '›')),
        !week.length && next ? h('button.btn.small', { type: 'button', onclick: () => App.setDate(d(next)) }, `Next sowing: week of ${day(d(next))}`) : null,
        !week.length && !next && prev ? h('button.btn.small', { type: 'button', onclick: () => App.setDate(d(prev)) }, `Last sowing: week of ${day(d(prev))}`) : null,
        h('span.grow'),
        chips.length > 2 ? h('div.sd-filters', { role: 'group', 'aria-label': 'Which sowings to list' }, chips.map(([id, label]) => h('button.chip', { type: 'button', 'aria-pressed': String(ui.filter === id), onclick: () => { ui.filter = id; render(); } }, label))) : null),
      earlier.length ? h('details.sw-earlier', { open: ui.earlier, ontoggle: e => { if (e.target.open !== ui.earlier) { ui.earlier = e.target.open; render(); } } },
        h('summary', h('b', `${plural(earlier.length, 'earlier sowing')} ${earlier.length === 1 ? 'is' : 'are'} not recorded`), h('span', ' Planned before this week. Record them here, or leave them: nothing is assumed sown.')),
        ui.earlier ? sections(earlier, stock, true) : null) : null,
      week.length ? sections(week, stock, false) : h('p.empty.sw-none', `Nothing is sown in the week of ${day(d(now))}.`),
      selected.length ? h('div.sw-record', { role: 'region', 'aria-label': 'Record the ticked sowings' },
        h('b', `${plural(selected.length, 'sowing')} ticked`),
        h('span', (() => { const s = sum(selected, 'seeds'), g = sum(selected, 'g'); return [s ? amountText(s, 'seeds') : '', g ? amountText(g, 'g') + ' of seed' : ''].filter(Boolean).join(' · '); })()),
        h('span.grow'),
        h('label', h('span', 'Sown on'), h('input', { type: 'date', value: ui.date, max: today, 'aria-label': 'Sown on', onchange: e => { ui.date = e.target.value || today; } })),
        h('button.btn', { type: 'button', onclick: () => { ui.sel.clear(); ui.qty.clear(); render(); } }, 'Clear'),
        h('button.btn.primary', { type: 'button', id: 'swRecord', onclick: () => record(fig) }, `Record ${plural(selected.length, 'sowing')}`)) : null,
      Bench.section('Heated bench room'));
    host.parentElement.scrollTop = keep;
  }

  function init() {
    App.on('plan', render); App.on('view', render); App.on('date', () => { if (App.state.view === 'sow') render(); });
    Thumbs.on(() => { if (App.state.view === 'sow') render(); });
  }
  root.LRFSowView = { init, render, figures, get dirty() { return dirty; } };
})(window);
