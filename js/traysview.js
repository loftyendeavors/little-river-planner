/* Little River Farm Planner — the Trays view.
 *
 * Weekly demand for whole live trays, the sowing it asks for week by week, and the heated bench
 * room everything started under cover has to share. The demand table is edited in place: each
 * change regenerates that plan's batches as one step and can be undone.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, T = root.LRFTrays, Thumbs = root.LRFThumbs;
  const { h, s, clear, add, num, day } = UI;
  const $ = id => document.getElementById(id);
  const clone = x => JSON.parse(JSON.stringify(x));
  const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(+n) ? 0 : 2 });
  const d = iso => E.s2d(iso);
  /** Seed by weight the way it is bought: grams up to a pound, pounds beyond. */
  const weight = g => !g ? '—' : g < 453.6 ? `${num(g, 0)} g` : `${num(g / 453.592, 1)} lb`;
  // What stands on the heated benches, in the order it is stacked in the chart. The colours are the chart palette's, validated as neighbours in this order.
  const KINDS = [['live', 'Live trays'], ['tray', 'Seedling trays'], ['rockwool', 'Tower seedlings'], ['pot', 'Potted seedlings'], ['crate', 'Sheltered crates']];
  let dirty = true, tipTimer = null;

  // ── figures the page is drawn from, worked out once per plan state ──
  const cache = new WeakMap();
  function figures() {
    const eng = App.state.engine;
    if (cache.has(eng)) return cache.get(eng);
    const year = App.planYear(), list = T.batches(eng, E).filter(b => d(b.ready).getFullYear() === year || d(b.sow).getFullYear() === year);
    const weeks = T.weeks(list), crops = T.byCrop(list);
    // Bench room: for each week, the day the benches are fullest.
    const bench = new Map();
    for (let date = new Date(year, 0, 1), i = 0; i < 366 && date.getFullYear() === year; i++, date = E.addDays(date, 1)) {
      const row = eng.benchDay(date);
      if (!row.total) continue;
      const key = T.monday(E.d2s(date)), week = bench.get(key) || { row: null, livePeak: 0 };
      if (!week.row || row.total > week.row.total) week.row = row;
      week.livePeak = Math.max(week.livePeak, row.live);
      bench.set(key, week);
    }
    for (const week of bench.values()) week.row.livePeak = week.livePeak;
    const benchWeeks = [...bench.keys()].sort(), full = [];
    if (benchWeeks.length) for (let w = benchWeeks[0]; w <= benchWeeks[benchWeeks.length - 1]; w = T.add(w, 7)) full.push({ week: w, row: bench.has(w) ? bench.get(w).row : null });
    const tightest = full.reduce((a, b) => b.row && (!a || b.row.total - b.row.cap > a.row.total - a.row.cap) ? b : a, null);
    const out = { year, list, weeks, crops, bench: full, tightest, cap: eng.heatedTraySpaces(), benches: eng.benchList(),
      trays: list.reduce((n, b) => n + b.trays, 0), revenue: list.reduce((n, b) => n + b.revenue, 0), seedG: list.reduce((n, b) => n + b.seedG, 0), unrated: crops.filter(c => !(c.crop.seedG > 0)).length };
    cache.set(eng, out);
    return out;
  }

  // ── saving ──
  const plans = () => (App.state.plan.liveTrayPlans || []).filter(p => p.year === App.planYear());
  const lockedBatches = plan => App.state.plan.plantings.filter(p => p.liveTray && p.liveTray.planId === plan.id && T.locked(App.state.plan, p)).length;
  /** change: fields to set, or a function of the plan as it stands now (a table cell may be older than the plan it edits). */
  async function save(plan, change, label) {
    const current = (App.state.plan.liveTrayPlans || []).find(p => p.id === plan.id);
    if (!current) { render(); return; }
    const next = { ...clone(current), ...(typeof change === 'function' ? change(current) : change) }, before = figures().trays;
    const done = await App.saveTrays(label, next);
    if (!done) { render(); return; }
    if (done.unchanged) return;
    const after = figures().trays;
    UI.toast(after === before ? label : `${label}: ${num(before)} → ${num(after)} trays this season`, { label: 'Undo', run: App.undo });
  }
  const setRow = (plan, rowId, key, value, label) => save(plan, now => ({ rows: now.rows.map(r => r.id === rowId ? { ...r, [key]: value } : r) }), label);
  function setSeed(crop, value) {
    const own = (App.state.plan.crops || []).find(c => c.id === crop.id);
    if (!own) { UI.toast('This crop comes with the planner. Its seed rate is the built-in one.'); render(); return; }
    const grams = value === '' ? null : +value;
    if (grams !== null && !(grams >= 0 && grams <= 2000)) { UI.toast('Seed per tray is a weight in grams, from 0 to 2,000.'); render(); return; }
    if ((own.seedG ?? null) === grams) return;
    App.commit(`Seed per tray, ${T.short(own.name)}`, [{ kind: 'crop', before: own, after: { ...own, seedG: grams } }], { unchecked: true });
  }

  // ── pieces ──
  const stat = (label, value, note, cls) => h('div.tr-stat' + (cls ? '.' + cls : ''), h('span', label), h('strong', value), note ? h('small', note) : null);
  /** A number typed into the table: committed on change, put back if it makes no sense. */
  function numberCell(value, { min = 0, max = 10000, step = 1, label, disabled, onset, placeholder }) {
    const input = h('input.tr-n', { type: 'number', min, max, step, value: value == null ? '' : value, 'aria-label': label, disabled: !!disabled, placeholder: placeholder || '' });
    input.addEventListener('change', () => {
      const text = input.value.trim(), n = Number(text);
      if (text === '' && placeholder !== undefined) { onset(''); return; }
      if (text === '' || !Number.isFinite(n) || n < min || n > max || (step === 1 && !Number.isInteger(n))) { UI.toast(`${label}: ${step === 1 ? 'a whole number' : 'a number'} from ${num(min)} to ${num(max)}.`); input.value = value == null ? '' : value; return; }
      if (n !== value) onset(n);
    });
    return input;
  }
  function dateCell(value, label, disabled, onset) {
    const input = h('input.tr-date', { type: 'date', value, 'aria-label': label, disabled: !!disabled });
    input.addEventListener('change', () => { if (input.value && input.value !== value) onset(input.value); else input.value = value; });
    return h('label.tr-field', h('span', label), input);
  }

  function planSection(plan, fig) {
    const eng = App.state.engine, farm = App.state.plan, locked = lockedBatches(plan), off = locked > 0;
    const mine = fig.list.filter(b => b.planId === plan.id), model = (() => { try { return T.schedule(plan); } catch (_) { return null; } })();
    const name = h('input.tr-name', { type: 'text', value: plan.name, 'aria-label': 'Plan name', disabled: off });
    name.addEventListener('change', () => { const text = name.value.trim(); if (!text) { name.value = plan.name; return; } if (text !== plan.name) save(plan, { name: text }, 'Plan renamed'); });
    const customer = h('select.tr-customer', { 'aria-label': 'Customer', disabled: off }, h('option', { value: '' }, 'No customer set'), (farm.customers || []).map(c => h('option', { value: c.id, selected: c.id === plan.customerId }, c.name || c.id)));
    customer.addEventListener('change', () => save(plan, { customerId: customer.value }, 'Customer changed'));

    const body = h('tbody');
    for (const r of plan.rows) {
      const crop = eng.crop(r.cropId), rows = mine.filter(b => b.p.liveTray && b.p.liveTray.rowId === r.id), trays = rows.reduce((n, b) => n + b.trays, 0), revenue = rows.reduce((n, b) => n + b.revenue, 0);
      const own = crop && (farm.crops || []).some(c => c.id === crop.id), rate = crop && crop.seedG > 0 ? crop.seedG : null;
      const q = (key, text) => h('td', numberCell(r[key], { label: `${r.name}, ${text}`, disabled: off, onset: v => setRow(plan, r.id, key, v, `${r.name}, ${text}`) }));
      body.append(h('tr', { dataset: { row: r.id } },
        h('td', h('div.as-name', Thumbs.el({ cropId: r.cropId, color: crop ? eng.cropColor(crop) : 'var(--line)', label: r.name, size: 24, cls: 'key' }), h('b', r.name))),
        h('td', numberCell(r.days, { min: 1, max: 366, label: `${r.name}, days from sowing to ready`, disabled: off, onset: v => setRow(plan, r.id, 'days', v, `${r.name}, days to ready`) })),
        h('td', numberCell(r.price, { min: 0, max: 100000, step: 0.01, label: `${r.name}, price per tray`, disabled: off, onset: v => setRow(plan, r.id, 'price', v, `${r.name}, price per tray`) })),
        q('spring', 'spring trays a week'), q('summer', 'summer trays a week'), q('fall', 'fall trays a week'),
        h('td.tr-fig', num(trays)), h('td.tr-fig', money(revenue)),
        h('td', crop ? numberCell(rate, { min: 0, max: 2000, step: 0.1, label: `${r.name}, grams of seed per tray`, disabled: !own, placeholder: 'g', onset: v => setSeed(crop, v) }) : '—'),
        h('td.tr-fig', rate ? weight(trays * rate) : h('span.tr-missing', 'no rate')),
        h('td', h('button.tr-x', { type: 'button', title: `Take ${r.name} out of this plan`, 'aria-label': `Take ${r.name} out of this plan`, disabled: off || plan.rows.length < 2,
          onclick: () => save(plan, now => ({ rows: now.rows.filter(x => x.id !== r.id) }), `${r.name} taken out`) }, '×'))));
    }
    const total = mine.reduce((n, b) => n + b.trays, 0), totalRevenue = mine.reduce((n, b) => n + b.revenue, 0), totalSeed = mine.reduce((n, b) => n + b.seedG, 0);
    const sumOf = key => plan.rows.reduce((n, r) => n + (r[key] || 0), 0);
    const foot = h('tfoot', h('tr', h('td', 'All crops'), h('td'), h('td'), h('td.tr-fig', num(sumOf('spring'))), h('td.tr-fig', num(sumOf('summer'))), h('td.tr-fig', num(sumOf('fall'))), h('td.tr-fig', num(total)), h('td.tr-fig', money(totalRevenue)), h('td'), h('td.tr-fig', totalSeed ? weight(totalSeed) : '—'), h('td')));

    // add a crop: one already kept as a tray crop, or a new name
    const known = eng.crops().filter(c => c.micro && !plan.rows.some(r => r.cropId === c.id || T.norm(r.name) === T.norm(c.name)));
    const ownIds = new Set((farm.crops || []).map(c => c.id)), listId = 'trCrops-' + plan.id;
    const pick = h('input.tr-add', { type: 'text', list: listId, placeholder: 'Add a crop: choose or type a name', 'aria-label': 'Crop to add', disabled: off });
    const addCrop = () => {
      const text = pick.value.trim();
      if (!text) return;
      if (plan.rows.some(r => T.norm(r.name) === T.norm(text))) { UI.toast(`${T.short(text)} is already in this plan.`); return; }
      // A crop of the same name that is already kept is used as it is, the farm's own before the planner's built-in one.
      const match = known.filter(c => T.norm(c.name) === T.norm(text)).sort((a, b) => ownIds.has(b.id) - ownIds.has(a.id))[0];
      const row = { id: App.uid(), name: T.short(match ? match.name : text), days: match && match.dtm > 0 ? Math.round(match.dtm) : 21, price: match && match.baseUnit === 'tray' && match.price > 0 ? +match.price : 0, spring: 0, summer: 0, fall: 0 };
      if (match) row.cropId = match.id;
      save(plan, now => ({ rows: [...now.rows, row] }), `${row.name} added`);
    };
    pick.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCrop(); } });

    const opening = model && model.batches.length ? model.batches.filter(b => b.week === T.monday(plan.from)) : [];
    const doubled = opening.length && plan.from !== T.monday(plan.from) ? `The window opens on ${UI.dayLong(d(plan.from))}, mid-week, so a full week of trays is ready that day and another full week on ${day(d(T.add(T.monday(plan.from), 7)))}.` : '';
    return h('section.tr-plan', { dataset: { plan: plan.id } },
      h('div.tr-plan-head', name, customer,
        h('button.btn.danger.small', { type: 'button', disabled: off, onclick: async () => {
          const ok = await UI.confirm({ title: `Delete ${plan.name}?`, body: `Its ${num(mine.length)} batches (${num(total)} trays) go with it. Other plantings and the benches stay as they are. You can undo this.`, confirmLabel: 'Delete plan', danger: true });
          if (ok && await App.removeTrays(plan.id)) UI.toast(`${plan.name} deleted`, { label: 'Undo', run: App.undo });
        } }, 'Delete plan')),
      off ? h('p.tr-locked', `${num(locked)} of this plan's batches ${locked === 1 ? 'has' : 'have'} work recorded. v7's rule, kept here, is that such a plan is no longer changed: add a second plan for demand that differs from here on.`) : null,
      h('div.tr-scroll', h('table.as.tr-demand',
        h('thead', h('tr', h('th', 'Crop'), h('th', { title: 'Days from sowing until the tray is ready to sell' }, 'Days'), h('th', '$ / tray'), h('th', 'Spring / wk'), h('th', 'Summer / wk'), h('th', 'Fall / wk'), h('th', 'Trays'), h('th', 'Expected'), h('th', { title: 'Grams of seed sown in one 10 × 20 tray' }, 'Seed g / tray'), h('th', 'Seed'), h('th', ''))),
        body, foot)),
      h('div.tr-window',
        dateCell(plan.from, 'First ready date', off, v => save(plan, { from: v }, 'First ready date')),
        dateCell(plan.summer, 'Summer from', off, v => save(plan, { summer: v }, 'Summer start')),
        dateCell(plan.fall, 'Fall from', off, v => save(plan, { fall: v }, 'Fall start')),
        dateCell(plan.through, 'Last week of', off, v => save(plan, { through: v }, 'Last week')),
        h('span.tr-addwrap', pick, h('datalist', { id: listId }, known.map(c => h('option', { value: T.short(c.name) }, ownIds.has(c.id) ? 'your crop' : 'built-in'))), h('button.btn', { type: 'button', disabled: off, onclick: addCrop }, 'Add crop'))),
      h('p.tr-note', `${model ? num(model.weeks.length) : '—'} active weeks. Trays are ready on Mondays and sown that many days before. ${doubled}`));
  }

  function emptyState() {
    const year = App.planYear(), name = h('input.tr-name', { type: 'text', value: `${year} live trays`, 'aria-label': 'Plan name' }), crop = h('input.tr-add', { type: 'text', placeholder: 'First crop, for example Pea shoots', 'aria-label': 'First crop' });
    const start = () => {
      if (!name.value.trim() || !crop.value.trim()) { UI.toast('Give the plan a name and a first crop.'); return; }
      App.saveTrays('Weekly demand plan added', { ...T.draft(year), name: name.value.trim(), rows: [{ id: App.uid(), name: T.short(crop.value), days: 21, price: 0, spring: 0, summer: 0, fall: 0 }] });
    };
    return h('section.tr-plan.tr-empty', h('h3', 'No weekly demand yet'),
      h('p.tr-note', 'Name a plan and its first crop. Then set trays a week for spring, summer and fall: the sowings follow, and the benches chart shows what they take.'),
      h('div.tr-window', name, crop, h('button.btn.primary', { type: 'button', onclick: start }, 'Start a plan')));
  }

  // ── heated bench room: weekly columns stacked by what stands there, against the room there is ──
  function benchChart(fig, tip) {
    const weeks = fig.bench, W = 980, H = 250, M = { l: 40, r: 96, t: 16, b: 26 }, plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    if (!weeks.length) return h('p.tr-note', 'Nothing in this plan stands on a heated bench.');
    const top = Math.max(fig.cap, ...weeks.map(w => w.row ? w.row.total : 0)), step = top > 400 ? 200 : top > 160 ? 100 : 50, yMax = Math.ceil(top * 1.06 / step) * step;
    const band = plotW / weeks.length, barW = Math.max(3, Math.min(24, band - 3)), y = v => M.t + plotH - v / yMax * plotH, x = i => M.l + i * band + (band - barW) / 2;
    const svg = s('svg.tr-chart', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Heated bench room in use each week, in tray spaces, against the ${num(fig.cap)} the benches hold. The table below carries the same figures.` });
    for (let v = 0; v <= yMax; v += step) svg.append(s('line.tr-grid', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }), s('text.tr-tick', { x: M.l - 7, y: y(v) + 3.5, 'text-anchor': 'end' }, num(v)));
    let month = -1;
    weeks.forEach((w, i) => { const m = d(w.week).getMonth(); if (m !== month && (i === 0 || d(w.week).getDate() <= 7)) { month = m; svg.append(s('text.tr-tick', { x: M.l + i * band, y: H - 8 }, UI.MONTHS[m])); } });
    const now = T.monday(E.d2s(App.state.date));
    weeks.forEach((w, i) => {
      const g = s('g.tr-col' + (w.week === now ? '.now' : ''), { tabindex: 0, role: 'img', 'aria-label': w.row ? `Week of ${day(d(w.week))}: ${num(w.row.total, 1)} of ${num(w.row.cap)} tray spaces in use` : `Week of ${day(d(w.week))}: benches empty` });
      let base = 0;
      const parts = w.row ? KINDS.filter(([k]) => w.row[k] > 0) : [];
      parts.forEach(([k], n) => {
        const y1 = y(base + w.row[k]), y0 = y(base), last = n === parts.length - 1, ht = Math.max(1, y0 - y1 - (n ? 2 : 0)), r = last ? Math.min(4, barW / 2, ht) : 0, left = x(i), bottom = y1 + ht;
        // a 2px gap of surface between segments; only the top of the column is rounded
        g.append(s('path.tr-seg', { 'data-kind': k, d: `M${left},${bottom}V${y1 + r}Q${left},${y1} ${left + r},${y1}H${left + barW - r}Q${left + barW},${y1} ${left + barW},${y1 + r}V${bottom}Z` }));
        base += w.row[k];
      });
      if (w.row && w.row.over > 0.05) g.append(s('text.tr-over', { x: x(i) + barW / 2, y: y(w.row.total) - 5, 'text-anchor': 'middle' }, '▲'));
      g.append(s('rect.tr-hit', { x: M.l + i * band, y: M.t, width: band, height: plotH }));
      const show = () => {
        clearTimeout(tipTimer);
        clear(tip).append(h('b', `Week of ${day(d(w.week))}`), w.row ? h('small', `fullest on ${UI.dayLong(w.row.date).replace(/, \d{4}$/, '')}`) : h('small', 'benches empty'));
        if (w.row) {
          for (const [k, label] of KINDS) if (w.row[k] > 0) tip.append(h('span.tr-tip-row', h('i', { 'data-kind': k }), h('strong', num(w.row[k], 1)), label));
          tip.append(h('span.tr-tip-row.total', h('i'), h('strong', num(w.row.total, 1)), `of ${num(w.row.cap)} tray spaces`),
            w.row.over > 0.05 ? h('span.tr-tip-over', `▲ ${num(w.row.over, 1)} more than the benches hold`) : h('span.tr-tip-room', `${num(w.row.cap - w.row.total, 1)} free`));
        }
        const box = svg.getBoundingClientRect(), host = svg.parentElement.getBoundingClientRect(), cx = box.left - host.left + (M.l + (i + 0.5) * band) / W * box.width;
        tip.hidden = false;
        tip.style.left = Math.max(4, Math.min(host.width - tip.offsetWidth - 4, cx + 14 + tip.offsetWidth > host.width ? cx - tip.offsetWidth - 14 : cx + 14)) + 'px';
        tip.style.top = '8px';
      };
      const hide = () => { tipTimer = setTimeout(() => { tip.hidden = true; }, 80); };
      g.addEventListener('pointerenter', show); g.addEventListener('pointerleave', hide); g.addEventListener('focus', show); g.addEventListener('blur', hide);
      g.addEventListener('click', () => App.setDate(d(w.week)));
      svg.append(g);
    });
    // what the benches hold: a line across, named at its end
    svg.append(s('line.tr-cap', { x1: M.l, x2: W - M.r + 4, y1: y(fig.cap), y2: y(fig.cap) }), s('text.tr-cap-label', { x: W - M.r + 8, y: y(fig.cap) - 3 }, `${num(fig.cap)} spaces`), s('text.tr-tick', { x: W - M.r + 8, y: y(fig.cap) + 10 }, 'benches hold'));
    return svg;
  }
  function benchSection(fig) {
    const areas = new Map();
    for (const b of fig.benches) { if (!b.active || !b.heated) continue; const key = b.area || 'Other heated benches', row = areas.get(key) || { benches: 0, cap: 0 }; row.benches++; row.cap += b.cap; areas.set(key, row); }
    const t = fig.tightest && fig.tightest.row, over = fig.bench.filter(w => w.row && w.row.over > 0.05);
    const share = k => t && t.total ? Math.round(t[k] / t.total * 100) : 0;
    const reading = !t ? '' : over.length
      ? `The benches are over in ${num(over.length)} week${over.length === 1 ? '' : 's'}, worst on ${UI.dayLong(t.date).replace(/, \d{4}$/, '')}: ${num(t.total, 1)} tray spaces wanted, ${num(t.cap)} there. That day live trays are ${share('live')}% of the load and sheltered crates ${share('crate')}%.`
      : `The fullest day is ${UI.dayLong(t.date).replace(/, \d{4}$/, '')}: ${num(t.total, 1)} of ${num(t.cap)} tray spaces.`;
    const tip = h('div.tr-tip', { id: 'trTip', hidden: true, role: 'status' });
    return h('section.tr-bench', h('h3', 'Heated bench room'),
      h('p.tr-note', reading),
      h('div.tr-legend', { 'aria-label': 'What the colours stand for' }, KINDS.map(([k, label]) => h('span', h('i', { 'data-kind': k }), label))),
      h('div.tr-chart-wrap', benchChart(fig, tip), tip),
      h('p.tr-note', `Room is counted the way v7 counts it: bench area × ${num((App.state.plan.nursery || {}).packing || 85)}% packing ÷ one 10 × 20 tray. ${[...areas].map(([name, a]) => `${name}: ${num(a.benches)} benches, ${num(a.cap)} spaces`).join(' · ')}. Seedling trays are counted per planting; v7's shared sowing batches, not rebuilt yet, round a few trays lower. Nothing here moves a planting: the load is shown, never enforced.`));
  }

  function weekSection(fig) {
    const eng = App.state.engine, now = T.monday(E.d2s(App.state.date)), bench = new Map(fig.bench.map(w => [w.week, w.row]));
    const keys = [...new Set([...fig.weeks.map(w => w.week), ...fig.bench.map(w => w.week)])].sort(), byWeek = new Map(fig.weeks.map(w => [w.week, w]));
    const sowing = new Map();
    for (const b of fig.list) { const k = T.monday(b.sow), list = sowing.get(k) || []; list.push(b); sowing.set(k, list); }
    const body = h('tbody');
    for (const k of keys) {
      const w = byWeek.get(k) || { sow: 0, ready: 0, revenue: 0 }, row = bench.get(k), sow = (sowing.get(k) || []).sort((a, b) => a.sow.localeCompare(b.sow) || a.name.localeCompare(b.name));
      if (!w.sow && !w.ready && !(row && row.live)) continue;
      body.append(h('tr' + (k === now ? '.now' : ''), { dataset: { week: k }, onclick: () => App.setDate(d(k)) },
        h('td', h('b', day(d(k))), k === now ? h('small.tr-nowtag', 'planning week') : null),
        h('td.tr-fig', w.sow ? num(w.sow) : '—'),
        h('td.tr-sow', sow.map(b => h('span.tr-chip' + (b.sown ? '.done' : ''), { style: { '--crop': eng.cropColor(b.r.c) }, title: `${b.name}: sow ${num(b.trays)} on ${UI.dayLong(d(b.sow))}, ready ${day(d(b.ready))}${b.sown ? ' · sown' : ''}` }, h('i'), `${b.name} ${num(b.trays)}`, h('small', UI.DAYS[d(b.sow).getDay()])))),
        h('td.tr-fig', w.ready ? num(w.ready) : '—'), h('td.tr-fig', w.revenue ? money(w.revenue) : '—'),
        h('td.tr-fig', row && row.livePeak ? num(row.livePeak) : '—'),
        h('td.tr-fig', row ? h('span', `${num(row.total, 1)} of ${num(row.cap)}`, row.over > 0.05 ? h('span.tr-overtag', ` ▲ ${num(row.over, 1)} over`) : null) : '—')));
    }
    const step = n => () => App.setDate(E.addDays(d(now), n));
    return h('section.tr-weeks', h('div.tr-weeks-head', h('h3', 'Week by week'),
      h('span.tr-stepper', h('button.icon-btn', { type: 'button', 'aria-label': 'Back one week', onclick: step(-7) }, '‹'), h('b', `Week of ${day(d(now))}`), h('button.icon-btn', { type: 'button', 'aria-label': 'Forward one week', onclick: step(7) }, '›'))),
      body.children.length ? h('div.tr-scroll', h('table.as.tr-week', h('thead', h('tr', h('th', 'Week of'), h('th', 'Sow'), h('th', 'What to sow, and the day'), h('th', 'Ready'), h('th', 'Expected'), h('th', { title: 'Most live trays on the benches on any day of the week' }, 'Live trays'), h('th', { title: 'Everything on the heated benches on the fullest day of the week' }, 'All benches'))), body)) : h('p.tr-note', 'No trays are planned this season.'));
  }

  function render() {
    if (!App.state.ready || App.state.view !== 'trays') { dirty = true; return; }
    dirty = false;
    const host = $('trWrap'), keep = host.parentElement.scrollTop, focus = document.activeElement && host.contains(document.activeElement) ? [document.activeElement.getAttribute('aria-label'), document.activeElement.closest('[data-plan]') && document.activeElement.closest('[data-plan]').dataset.plan] : null;
    const fig = figures(), list = plans(), now = T.monday(E.d2s(App.state.date)), week = fig.weeks.find(w => w.week === now) || { sow: 0, ready: 0, revenue: 0 };
    const customers = [...new Set(list.map(p => ((App.state.plan.customers || []).find(c => c.id === p.customerId) || {}).name).filter(Boolean))];
    const t = fig.tightest && fig.tightest.row, orphans = fig.list.filter(b => b.planned && !(App.state.plan.liveTrayPlans || []).some(p => p.id === b.planId)).length;
    clear(host);
    add(host,
      h('header.as-head', h('p.eyebrow', `Live trays${customers.length ? ' · ' + customers.join(', ') : ''} · ${fig.year}`), h('h2', 'Weekly trays, sown to order'),
        h('p', 'Whole 10 × 20 trays sold live. Say how many are wanted each week and how long each crop takes: every batch is sown that many days before the Monday it is due, and stands on the heated benches until then. Change a number and the sowings, the seed and the bench room follow.')),
      h('div.tr-stats',
        stat('Trays this season', num(fig.trays), `${num(fig.list.length)} batches · ${num(fig.crops.length)} crops`),
        stat('Expected', money(fig.revenue), 'if every tray sells at its price'),
        stat('Seed for the season', fig.seedG ? weight(fig.seedG) : '—', fig.unrated ? `${num(fig.unrated)} of ${num(fig.crops.length)} crops have no seed rate: set grams per tray below` : 'from grams per tray', fig.unrated ? 'warn' : ''),
        stat(`Week of ${day(d(now))}`, `${num(week.sow)} to sow`, `${num(week.ready)} ready · ${money(week.revenue)}`),
        stat('Benches at their fullest', t ? `${num(t.total, 0)} of ${num(t.cap)}` : '—', t ? `${day(t.date)}${t.over > 0.05 ? ` · ▲ ${num(t.over, 1)} over` : ''}` : 'nothing under cover', t && t.over > 0.05 ? 'over' : '')),
      orphans ? h('p.tr-locked', `${num(orphans)} tray batches in this plan belong to a demand plan whose record is missing. They are shown below but cannot be changed from here. Loading the v7 backup again restores the record.`) : null,
      list.length ? list.map(p => planSection(p, fig)) : emptyState(),
      list.length ? h('p.tr-more', h('button.btn', { type: 'button', onclick: () => { const year = App.planYear(), n = list.length + 1; App.saveTrays('Weekly demand plan added', { ...T.draft(year), name: `${year} live trays ${n}`, rows: [{ id: App.uid(), name: 'New crop', days: 21, price: 0, spring: 0, summer: 0, fall: 0 }] }); } }, '+ Another demand plan'),
        h('small', 'One plan holds one set of weekly numbers. A second customer, or demand that changes mid-season, is a second plan.')) : null,
      benchSection(fig), weekSection(fig));
    host.parentElement.scrollTop = keep;
    if (focus && focus[0]) { const again = [...host.querySelectorAll('input, select, button')].find(el => el.getAttribute('aria-label') === focus[0] && (!focus[1] || (el.closest('[data-plan]') && el.closest('[data-plan]').dataset.plan === focus[1]))); if (again) again.focus({ preventScroll: true }); }
  }

  function init() {
    App.on('plan', render); App.on('view', render); App.on('date', () => { if (App.state.view === 'trays') render(); });
    Thumbs.on(() => { if (App.state.view === 'trays') render(); });
  }
  root.LRFTraysView = { init, render, figures, get dirty() { return dirty; } };
})(window);
