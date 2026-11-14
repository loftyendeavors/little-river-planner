/* Little River Farm Planner — the Nursery view (view id "trays": it began as the view of live trays alone).
 *
 * Everything raised on a bench, in four tabs. Bench room: what stands there week by week against what the benches hold.
 * Live trays: weekly demand for whole trays and the sowing it asks for; the demand table is edited in place, each change
 * regenerates that plan's batches as one step, and batches already sown stay as recorded. Supplies: what the season uses.
 * Set-up: the benches themselves and the rules for what stands where (js/bench.js draws all but Live trays).
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, T = root.LRFTrays, Thumbs = root.LRFThumbs, Bench = root.LRFBench;
  const { h, clear, add, num, day } = UI;
  const $ = id => document.getElementById(id);
  const clone = x => JSON.parse(JSON.stringify(x));
  const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(+n) ? 0 : 2 });
  const d = iso => E.s2d(iso);
  const dayName = date => UI.dayLong(date).replace(/, \d{4}$/, '');
  /** Seed by weight the way it is bought: grams up to a pound, pounds beyond. */
  const weight = g => !g ? '—' : g < 453.6 ? `${num(g, 0)} g` : `${num(g / 453.592, 1)} lb`;
  let dirty = true;

  // ── the four parts of the nursery. A visit starts on Bench room; the tab is kept while the page is open ──
  const TABS = [
    ['room', 'Bench room', 'Everything raised on a bench: seedling trays, tower seedlings, pots and live trays, week by week against what the benches hold. It is shown, never enforced.'],
    ['live', 'Live trays', 'Whole 10 × 20 trays sold live. Say how many are wanted each week and how long each crop takes: every batch is sown that many days before the Monday it is due, and stands on the heated benches until then.'],
    ['supplies', 'Supplies', 'What the season uses of trays, rockwool, pots and mix, less what is on the shelf.'],
    ['setup', 'Set-up', 'The benches themselves, and the rules for what stands where. Changing any of it moves no sowing, planting or harvest day.']
  ];
  let tab = 'room', drawn = null;
  function setTab(next) { if (!TABS.some(t => t[0] === next)) return false; tab = next; render(); return true; }
  /** Go to the Nursery, on one of its tabs: the way in from the other views. */
  function open(next) { if (next && TABS.some(t => t[0] === next)) tab = next; if (App.state.view !== 'trays') App.setView('trays'); else render(); }

  // ── figures the page is drawn from, worked out once per plan state ──
  const cache = new WeakMap();
  function figures() {
    const eng = App.state.engine;
    if (cache.has(eng)) return cache.get(eng);
    // This season's batches: those of this season's demand plans (whenever they were in fact sown), and any other tray batch dated in it.
    const year = App.planYear(), ours = new Set((App.state.plan.liveTrayPlans || []).filter(p => p.year === year).map(p => p.id));
    const list = T.batches(eng, E).filter(b => ours.has(b.planId) || d(b.ready).getFullYear() === year || d(b.sow).getFullYear() === year);
    const crops = T.byCrop(list);
    const out = { year, list, weeks: T.weeks(list), crops, trays: list.reduce((n, b) => n + b.trays, 0), revenue: list.reduce((n, b) => n + b.revenue, 0),
      seedG: list.reduce((n, b) => n + b.seedG, 0), seeds: list.reduce((n, b) => n + b.seeds, 0), unrated: crops.filter(c => !eng.liveSow(c.crop).set).length, sown: list.filter(b => b.sown).length };
    cache.set(eng, out);
    return out;
  }

  // ── saving ──
  const plans = () => (App.state.plan.liveTrayPlans || []).filter(p => p.year === App.planYear());
  const mondayRule = () => (App.state.plan.lrfNext || {}).trayStart === 'monday';
  /** change: fields to set, or a function of the plan as it stands now (a table cell may be older than the plan it edits). */
  async function save(plan, change, label) {
    const current = (App.state.plan.liveTrayPlans || []).find(p => p.id === plan.id);
    if (!current) { render(); return; }
    const next = { ...clone(current), ...(typeof change === 'function' ? change(current) : change) }, before = figures().trays;
    const done = await App.saveTrays(label, next);
    if (!done) { render(); return; }
    if (done.unchanged) return;
    const after = figures().trays;
    UI.toast(`${after === before ? label : `${label}: ${num(before)} → ${num(after)} trays this season`}${done.kept ? ` · ${num(done.kept)} sown batch${done.kept === 1 ? '' : 'es'} left as recorded` : ''}`, { label: 'Undo', run: App.undo });
  }
  const setRow = (plan, rowId, key, value, label) => save(plan, now => ({ rows: now.rows.map(r => r.id === rowId ? { ...r, [key]: value } : r) }), label);
  /** Seed for trays, in the two ways it is counted: seeds for what is sown in cells, weight for what is broadcast. */
  const seedText = (seeds, grams) => [seeds ? `${num(seeds)} seed${seeds === 1 ? '' : 's'}` : '', grams ? weight(grams) : ''].filter(Boolean).join(' · ') || '—';
  /** How one tray of a crop is sown, said in a line. */
  const sownText = how => !how.set ? 'no seed figure' : how.how === 'cells' ? `${num(how.cells)} cells × ${num(how.perCell, 1)} = ${num(how.seeds)} seeds a tray` : `${num(how.grams, 1)} g of seed a tray`;
  function setSown(crop, change) {
    const done = App.setLiveSow(crop.id, change);
    if (!done) { render(); return; }
    if (done.changed) UI.toast(`${done.name}: ${sownText(done.sow)}`, { label: 'Undo', run: App.undo });
  }
  /** The cell of the demand table that says how a tray is sown: in cells (cells a tray × seeds a cell) or in an open tray (grams). */
  function sownCell(crop, name, own) {
    const how = App.state.engine.liveSow(crop), live = (crop.liveSow && typeof crop.liveSow === 'object' ? crop.liveSow : {});
    const pick = h('select.tr-how', { 'aria-label': `${name}, how a tray is sown`, disabled: !own, title: own ? 'In cells: seed is counted in seeds. Open tray: seed is counted by weight.' : 'This crop comes with the planner' },
      h('option', { value: 'cells', selected: how.how === 'cells' }, 'In cells'), h('option', { value: 'open', selected: how.how === 'open' }, 'Open tray'));
    pick.addEventListener('change', () => setSown(crop, { how: pick.value }));
    const figures = how.how === 'cells'
      ? [numberCell(live.cells == null ? null : live.cells, { min: 1, max: 1000, label: `${name}, cells a tray`, disabled: !own, placeholder: 'cells', onset: v => setSown(crop, { cells: v }) }), h('i', '×'),
        numberCell(live.perCell == null ? null : live.perCell, { min: 0.1, max: 1000, step: 0.1, label: `${name}, seeds a cell`, disabled: !own, placeholder: 'seeds', onset: v => setSown(crop, { perCell: v }) })]
      : [numberCell(crop.seedG > 0 ? crop.seedG : null, { min: 0, max: 2000, step: 0.1, label: `${name}, grams of seed per tray`, disabled: !own, placeholder: '—', onset: v => setSown(crop, { grams: v }) }), h('i', 'g')];
    return h('div.tr-sown', { dataset: { how: how.how, set: how.set ? '1' : '' } }, pick, h('span.tr-sown-n', figures));
  }
  /** The first ready date. Where trays are wanted on Mondays, a mid-week date opens on the Monday on or after it. */
  function setFrom(plan, value) {
    const monday = T.mondayOnOrAfter(value);
    if (mondayRule() && monday !== value) { save(plan, { from: monday }, `Opens ${dayName(d(monday))}, the Monday after ${day(d(value))}`); return; }
    save(plan, { from: value }, 'First ready date');
  }

  // ── pieces ──
  const stat = (label, value, note, cls) => h('div.tr-stat' + (cls ? '.' + cls : ''), h('span', label), h('strong', value), note ? h('small', note) : null);
  /** A number typed into the table: committed on change, put back if it makes no sense. */
  function numberCell(value, { min = 0, max = 10000, step = 1, label, disabled, onset, placeholder }) {
    const input = h('input.tr-n', { type: 'number', min, max, step, value: value == null ? '' : value, 'aria-label': label, disabled: !!disabled, placeholder: placeholder || '', inputMode: step === 1 ? 'numeric' : 'decimal' });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = value == null ? '' : value; input.blur(); } });
    input.addEventListener('change', () => {
      const text = input.value.trim(), n = Number(text);
      if (text === '' && placeholder !== undefined) { onset(''); return; }
      if (text === '' || !Number.isFinite(n) || n < min || n > max || (step === 1 && !Number.isInteger(n))) { UI.toast(`${label}: ${step === 1 ? 'a whole number' : 'a number'} from ${num(min)} to ${num(max)}.`); input.value = value == null ? '' : value; return; }
      if (n !== value) onset(n);
    });
    return input;
  }
  function dateCell(value, label, onset) {
    const input = h('input.tr-date', { type: 'date', value, 'aria-label': label });
    input.addEventListener('change', () => { if (input.value && input.value !== value) onset(input.value); else input.value = value; });
    return h('label.tr-field', h('span', label), input);
  }

  function planSection(plan, fig) {
    const eng = App.state.engine, farm = App.state.plan;
    const mine = fig.list.filter(b => b.planId === plan.id), sown = mine.filter(b => b.sown).length, model = (() => { try { return T.schedule(plan); } catch (_) { return null; } })();
    const name = h('input.tr-name', { type: 'text', value: plan.name, 'aria-label': 'Plan name' });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => { const text = name.value.trim(); if (!text) { name.value = plan.name; return; } if (text !== plan.name) save(plan, { name: text }, 'Plan renamed'); });
    const customer = h('select.tr-customer', { 'aria-label': 'Customer' }, h('option', { value: '' }, 'No customer set'), (farm.customers || []).map(c => h('option', { value: c.id, selected: c.id === plan.customerId }, c.name || c.id)));
    customer.addEventListener('change', () => save(plan, { customerId: customer.value }, 'Customer changed'));

    const body = h('tbody');
    for (const r of plan.rows) {
      const crop = eng.crop(r.cropId), rows = mine.filter(b => b.p.liveTray && b.p.liveTray.rowId === r.id), trays = rows.reduce((n, b) => n + b.trays, 0), revenue = rows.reduce((n, b) => n + b.revenue, 0);
      const own = crop && (farm.crops || []).some(c => c.id === crop.id), seeds = rows.reduce((n, b) => n + b.seeds, 0), grams = rows.reduce((n, b) => n + b.seedG, 0);
      const q = (key, text) => h('td', numberCell(r[key], { label: `${r.name}, ${text}`, onset: v => setRow(plan, r.id, key, v, `${r.name}, ${text}`) }));
      body.append(h('tr', { dataset: { row: r.id } },
        h('td', h('div.as-name', Thumbs.el({ varietyId: r.varietyId || undefined, cropId: r.cropId, color: crop ? eng.cropColor(crop) : 'var(--line)', label: r.name, size: 24, cls: 'key' }), h('b', r.name),
          r.varietyId && eng.variety(r.varietyId) ? h('small.tr-var', { title: 'The variety these trays are sown with. Change it from any of its batches on the timeline.' }, eng.variety(r.varietyId).name) : null)),
        h('td', numberCell(r.days, { min: 1, max: 366, label: `${r.name}, days from sowing to ready`, onset: v => setRow(plan, r.id, 'days', v, `${r.name}, days to ready`) })),
        h('td', numberCell(r.price, { min: 0, max: 100000, step: 0.01, label: `${r.name}, price per tray`, onset: v => setRow(plan, r.id, 'price', v, `${r.name}, price per tray`) })),
        q('spring', 'spring trays a week'), q('summer', 'summer trays a week'), q('fall', 'fall trays a week'),
        h('td.tr-fig', num(trays)), h('td.tr-fig', money(revenue)),
        h('td', crop ? sownCell(crop, r.name, own) : '—'),
        h('td.tr-fig.tr-seed', seeds || grams ? seedText(seeds, grams) : h('span.tr-unset', '—')),
        h('td', h('button.tr-x', { type: 'button', title: `Take ${r.name} out of this plan`, 'aria-label': `Take ${r.name} out of this plan`, disabled: plan.rows.length < 2,
          onclick: () => save(plan, now => ({ rows: now.rows.filter(x => x.id !== r.id) }), `${r.name} taken out`) }, '×'))));
    }
    const total = mine.reduce((n, b) => n + b.trays, 0), totalRevenue = mine.reduce((n, b) => n + b.revenue, 0), totalSeed = mine.reduce((n, b) => n + b.seedG, 0), totalSeeds = mine.reduce((n, b) => n + b.seeds, 0);
    const sumOf = key => plan.rows.reduce((n, r) => n + (r[key] || 0), 0);
    const foot = h('tfoot', h('tr', h('td', 'All crops'), h('td'), h('td'), h('td.tr-fig', num(sumOf('spring'))), h('td.tr-fig', num(sumOf('summer'))), h('td.tr-fig', num(sumOf('fall'))), h('td.tr-fig', num(total)), h('td.tr-fig', money(totalRevenue)), h('td'), h('td.tr-fig.tr-seed', totalSeed || totalSeeds ? seedText(totalSeeds, totalSeed) : h('span.tr-unset', '—')), h('td')));
    // the three seasons, as the dates below cut them
    const spans = (() => { try { return { spring: `${day(d(plan.from))} – ${day(E.addDays(d(plan.summer), -1))}`, summer: `${day(d(plan.summer))} – ${day(E.addDays(d(plan.fall), -1))}`, fall: `${day(d(plan.fall))} – ${day(d(plan.through))}` }; } catch (_) { return {}; } })();
    const season = (text, key) => h('th', { title: `Trays wanted each week, ${spans[key] || ''}` }, text, h('small', spans[key] || ''));

    // add a crop: one already kept as a tray crop, or a new name
    const known = eng.crops().filter(c => c.micro && !plan.rows.some(r => r.cropId === c.id || T.norm(r.name) === T.norm(c.name)));
    const ownIds = new Set((farm.crops || []).map(c => c.id)), listId = 'trCrops-' + plan.id;
    const pick = h('input.tr-add', { type: 'text', list: listId, placeholder: 'Add a crop: choose or type a name', 'aria-label': 'Crop to add' });
    const addCrop = () => {
      const text = pick.value.trim();
      if (!text) { pick.focus(); return; }
      if (plan.rows.some(r => T.norm(r.name) === T.norm(text))) { UI.toast(`${T.short(text)} is already in this plan.`); return; }
      // A crop of the same name that is already kept is used as it is, the farm's own before the planner's built-in one.
      const match = known.filter(c => T.norm(c.name) === T.norm(text)).sort((a, b) => ownIds.has(b.id) - ownIds.has(a.id))[0];
      const row = { id: App.uid(), name: T.short(match ? match.name : text), days: match && match.dtm > 0 ? Math.round(match.dtm) : 21, price: match && match.baseUnit === 'tray' && match.price > 0 ? +match.price : 0, spring: 0, summer: 0, fall: 0 };
      if (match) row.cropId = match.id;
      save(plan, now => ({ rows: [...now.rows, row] }), `${row.name} added`);
    };
    pick.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCrop(); } });

    // a window that opens mid-week gets a full week of trays that day and another the Monday after
    const opensMidWeek = (() => { try { return T.monday(plan.from) !== plan.from; } catch (_) { return false; } })(), nextMonday = opensMidWeek ? T.mondayOnOrAfter(plan.from) : null;
    const doubled = opensMidWeek && model ? model.batches.filter(b => b.week === T.monday(plan.from)).reduce((n, b) => n + b.trays, 0) : 0;
    return h('section.tr-plan', { dataset: { plan: plan.id } },
      h('div.tr-plan-head', name, customer,
        h('button.btn.danger.small', { type: 'button', onclick: async () => {
          const ok = await UI.confirm({ title: `Delete ${plan.name}?`, body: `Its ${num(mine.length - sown)} unsown batch${mine.length - sown === 1 ? '' : 'es'} go with it${sown ? `; the ${num(sown)} already sown stay on the benches as plain plantings` : ''}. Other plantings stay as they are. You can undo this.`, confirmLabel: 'Delete plan', danger: true });
          if (ok && await App.removeTrays(plan.id)) UI.toast(`${plan.name} deleted`, { label: 'Undo', run: App.undo });
        } }, 'Delete plan')),
      h('div.tr-scroll', h('table.as.tr-demand',
        h('thead', h('tr', h('th', 'Crop'), h('th', { title: 'Days from sowing until the tray is ready to sell' }, 'Days'), h('th', '$ / tray'), season('Spring / wk', 'spring'), season('Summer / wk', 'summer'), season('Fall / wk', 'fall'), h('th', 'Trays'), h('th', 'Expected'), h('th', { title: 'How one tray is sown: in cells, so many seeds a cell, or broadcast in an open 10 × 20 tray, by weight' }, 'Sown'), h('th', 'Seed'), h('th', ''))),
        body, foot)),
      h('div.tr-window',
        dateCell(plan.from, 'First ready date', v => setFrom(plan, v)),
        dateCell(plan.summer, 'Summer from', v => save(plan, { summer: v }, 'Summer start')),
        dateCell(plan.fall, 'Fall from', v => save(plan, { fall: v }, 'Fall start')),
        dateCell(plan.through, 'Last week of', v => save(plan, { through: v }, 'Last week')),
        h('span.tr-addwrap', pick, h('datalist', { id: listId }, known.map(c => h('option', { value: T.short(c.name) }, ownIds.has(c.id) ? 'your crop' : 'built-in'))), h('button.btn', { type: 'button', onclick: addCrop }, 'Add crop'))),
      opensMidWeek && doubled ? h('p.tr-callout', h('span', `This plan opens on ${dayName(d(plan.from))}, mid-week. As it stands, ${num(doubled)} trays are ready that day and a full week again on ${dayName(d(nextMonday))}.`),
        h('button.btn.small', { type: 'button', onclick: async () => { const moved = await App.traysToMonday(); if (moved.length) UI.toast(`Opens ${dayName(d(moved[0].to))}. Newer backups loaded here are opened on a Monday too.`, { label: 'Undo', run: App.undo }); } }, `Open on ${dayName(d(nextMonday))}`)) : null,
      h('p.tr-note', `${model ? num(model.weeks.length) : '—'} active weeks. Trays are ready on Mondays and sown that many days before.${sown ? ` ${num(sown)} batch${sown === 1 ? ' is' : 'es are'} already sown and stay${sown === 1 ? 's' : ''} as recorded; changes reach the rest.` : ''}`));
  }

  function emptyState() {
    const year = App.planYear(), name = h('input.tr-name', { type: 'text', value: `${year} live trays`, 'aria-label': 'Plan name' }), crop = h('input.tr-add', { type: 'text', placeholder: 'First crop, for example Pea shoots', 'aria-label': 'First crop' });
    const start = () => {
      if (!name.value.trim() || !crop.value.trim()) { UI.toast('Give the plan a name and a first crop.'); return; }
      const first = T.draft(year);
      App.saveTrays('Weekly demand plan added', { ...first, from: T.mondayOnOrAfter(first.from), name: name.value.trim(), rows: [{ id: App.uid(), name: T.short(crop.value), days: 21, price: 0, spring: 0, summer: 0, fall: 0 }] });
    };
    crop.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
    return h('section.tr-plan.tr-empty', h('h3', 'No weekly demand yet'),
      h('p.tr-note', 'Name a plan and its first crop. Then set trays a week for spring, summer and fall: the sowings follow.'),
      h('div.tr-window', name, crop, h('button.btn.primary', { type: 'button', onclick: start }, 'Start a plan')));
  }

  function weekSection(fig) {
    const eng = App.state.engine, now = T.monday(E.d2s(App.state.date)), bench = new Map(Bench.figures().weeks.map(w => [w.week, w.row]));
    const sowing = new Map();
    for (const b of fig.list) { const k = T.monday(b.sow), list = sowing.get(k) || []; list.push(b); sowing.set(k, list); }
    const body = h('tbody');
    for (const w of fig.weeks) {
      const k = w.week, row = bench.get(k), sow = (sowing.get(k) || []).sort((a, b) => a.sow.localeCompare(b.sow) || a.name.localeCompare(b.name));
      if (!w.sow && !w.ready && !(row && row.live)) continue;
      body.append(h('tr' + (k === now ? '.now' : ''), { dataset: { week: k }, onclick: () => App.setDate(d(k)) },
        h('td', h('b', day(d(k))), k === now ? h('small.tr-nowtag', 'planning week') : null),
        h('td.tr-fig', w.sow ? num(w.sow) : '—'),
        h('td.tr-sow', sow.map(b => h('span.tr-chip' + (b.sown ? '.done' : ''), { style: { '--crop': eng.cropColor(b.r.c) }, title: `${b.name}: ${b.sown ? 'sown' : 'sow'} ${num(b.trays)} on ${UI.dayLong(d(b.sow))}, ready ${day(d(b.ready))}` }, h('i'), `${b.name} ${num(b.trays)}`, b.sown ? h('small', '✓ sown') : d(b.sow).getDay() === 1 ? null : h('small', UI.DAYS[d(b.sow).getDay()])))),
        h('td.tr-fig', w.ready ? num(w.ready) : '—'), h('td.tr-fig', w.revenue ? money(w.revenue) : '—'),
        h('td.tr-fig', row && row.livePeak ? num(row.livePeak) : '—')));
    }
    const step = n => () => App.setDate(E.addDays(d(now), n));
    return h('section.tr-weeks', h('div.tr-weeks-head', h('h3', 'Week by week'),
      h('button.linkish.tr-tosow', { type: 'button', id: 'trToTasks', onclick: () => { if (root.LRFSowView && root.LRFSowView.open) root.LRFSowView.open('nursery'); else App.setView('sow'); } }, 'Record what was sown, in Tasks'), h('span.grow'),
      h('span.tr-stepper', h('button.icon-btn', { type: 'button', 'aria-label': 'Back one week', onclick: step(-7) }, '‹'), h('b', `Week of ${day(d(now))}`), h('button.icon-btn', { type: 'button', 'aria-label': 'Forward one week', onclick: step(7) }, '›'))),
      body.children.length ? h('div.tr-scroll', h('table.as.tr-week', h('thead', h('tr', h('th', 'Week of'), h('th', 'Sow'), h('th', { title: 'Sown on the Monday unless a day is shown' }, 'What to sow'), h('th', 'Ready'), h('th', 'Expected'), h('th', { title: 'Most live trays standing on the benches on any day of the week' }, 'On the benches'))), body)) : h('p.tr-note', 'No trays are planned this season.'));
  }

  // ── the tabs ──
  /** Bench room: the season at a glance, this week on the benches and in the nursery's list, then the lines and charts. */
  function roomTab() {
    const bench = Bench.figures(), t = bench.tightest, now = T.monday(E.d2s(App.state.date)), wk = bench.weeks.find(w => w.week === now), here = wk && wk.pools ? wk.pools : {};
    const heat = here.heated, others = bench.shown.filter(k => k !== 'heated' && here[k] && (here[k].used > 1e-9 || here[k].cap)).map(k => `${root.LRFNursery.kindName(k).toLowerCase()} ${here[k].cap ? `${num(here[k].used, 0)} of ${num(here[k].cap)}` : num(here[k].used, 0)}`);
    const hd = bench.hardening, days = bench.hardenDays;
    const todo = root.LRFSowView && root.LRFSowView.weekCounts ? root.LRFSowView.weekCounts(now) : null, parts = todo ? [['sow', 'to sow'], ['potup', 'to pot up'], ['harden', 'to harden off']].filter(([k]) => todo[k]).map(([k, w]) => `${num(todo[k])} ${w}`) : [];
    return [h('div.tr-stats.nu-stats',
      stat(bench.shown.length > 1 ? 'Heated benches, fullest' : 'Benches at their fullest', t ? (bench.cap ? `${num(t.used, 0)} of ${num(t.cap)}` : `${num(t.used, 0)} spaces`) : '—', !t ? 'nothing under cover' : !bench.cap ? `${day(t.date)} · no benches listed` : `${day(t.date)}${t.over > 0.05 ? ` · ▲ ${num(t.over, 1)} over` : ' · room to spare'}`, t && bench.cap && t.over > 0.05 ? 'over' : ''),
      stat(`On the benches, week of ${day(d(now))}`, heat && heat.used > 1e-9 ? (heat.cap ? `${num(heat.used, 0)} of ${num(heat.cap)}` : `${num(heat.used, 0)} spaces`) : 'Nothing', [bench.shown.length > 1 && heat && heat.used > 1e-9 ? 'under heat' : '', ...others].filter(Boolean).join(' · ') || (heat && heat.used > 1e-9 ? `fullest on ${dayName(heat.date)}` : 'stands under heat'), heat && heat.cap && heat.over > 0.05 ? 'over' : ''),
      stat('Hardening off, most at once', !days ? 'Not planned' : hd && hd.most > 1e-9 ? `${num(hd.most, 0)} spaces` : 'Nothing', !days ? 'seedlings stay under cover until planted' : hd && hd.most > 1e-9 ? `${day(hd.on)} · ${num(days)} day${days === 1 ? '' : 's'} before planting out` : `${num(days)} day${days === 1 ? '' : 's'} before planting out`),
      h('div.tr-stat.nu-week', { id: 'nuWeek' }, h('span', 'This week in the nursery'), h('strong', todo && todo.nursery ? `${num(todo.nursery)} to do` : 'Nothing'), h('small', parts.join(' · ') || 'to sow, pot up or harden off'),
        h('button.linkish', { type: 'button', id: 'nuToTasks', title: 'The week’s list, with only the nursery’s tasks', onclick: () => { if (root.LRFSowView && root.LRFSowView.open) root.LRFSowView.open('nursery'); } }, 'Open the nursery’s list, in Tasks'))),
    Bench.room()];
  }
  /** Live trays: the season's figures, each demand plan, and under them the same batches week by week. */
  function liveTab() {
    const fig = figures(), list = plans(), now = T.monday(E.d2s(App.state.date)), week = fig.weeks.find(w => w.week === now) || { sow: 0, ready: 0, revenue: 0 };
    const orphans = fig.list.filter(b => b.planned && !(App.state.plan.liveTrayPlans || []).some(p => p.id === b.planId)).length;
    return [h('div.tr-stats.nu-stats',
      stat('Trays this season', num(fig.trays), `${num(fig.list.length)} batches · ${num(fig.crops.length)} crop${fig.crops.length === 1 ? '' : 's'}${fig.sown ? ` · ${num(fig.sown)} sown` : ''}`),
      stat('Expected', money(fig.revenue), 'if every tray sells at its price'),
      stat('Seed for the season', fig.seeds ? `${num(fig.seeds)} seeds` : fig.seedG ? weight(fig.seedG) : '—', (fig.seeds && fig.seedG ? `and ${weight(fig.seedG)} by weight · ` : '') + (!fig.crops.length ? '' : fig.unrated === fig.crops.length ? 'no seed figure set yet' : fig.unrated ? `${num(fig.crops.length - fig.unrated)} of ${num(fig.crops.length)} crops counted so far` : 'every crop counted')),
      stat(`Week of ${day(d(now))}`, `${num(week.sow)} to sow`, `${num(week.ready)} ready · ${money(week.revenue)}`)),
    orphans ? h('p.tr-callout', `${num(orphans)} tray batches belong to a demand plan whose record is missing. They are shown below but cannot be changed from here. Loading the backup again restores the record.`) : null,
    list.length ? list.map(p => planSection(p, fig)) : emptyState(),
    list.length ? h('p.tr-more', h('button.btn', { type: 'button', onclick: () => { const year = App.planYear(), n = list.length + 1, first = T.draft(year); App.saveTrays('Weekly demand plan added', { ...first, from: T.mondayOnOrAfter(first.from), name: `${year} live trays ${n}`, rows: [{ id: App.uid(), name: 'New crop', days: 21, price: 0, spring: 0, summer: 0, fall: 0 }] }); } }, '+ Another demand plan'),
      h('small', 'One plan holds one set of weekly numbers. A second customer is a second plan.')) : null,
    weekSection(fig)];
  }
  const suppliesTab = () => Bench.supplies() || h('p.tr-note.nu-none', 'Nothing in this plan is raised in a tray, a sheet or a pot, so there is nothing to count.');

  function render() {
    if (!App.state.ready || App.state.view !== 'trays') { dirty = true; return; }
    dirty = false;
    const host = $('trWrap'), scroller = host.parentElement, keep = drawn === tab ? scroller.scrollTop : 0, focus = document.activeElement && host.contains(document.activeElement) ? [document.activeElement.getAttribute('aria-label'), document.activeElement.closest('[data-plan]') && document.activeElement.closest('[data-plan]').dataset.plan] : null;
    const [, title, lead] = TABS.find(x => x[0] === tab);
    clear(host);
    host.dataset.tab = tab;
    add(host,
      h('header.as-head.nu-head', h('p.eyebrow', `Nursery · ${App.planYear()}`), h('h2', { id: 'nuTitle' }, title)),
      h('div.seg.nu-tabs', { id: 'nuTabs', role: 'group', 'aria-label': 'Which part of the nursery' }, TABS.map(([id, label]) => h('button', { type: 'button', dataset: { tab: id }, 'aria-pressed': String(id === tab), onclick: () => setTab(id) }, label))),
      h('p.nu-lead', { id: 'nuLead' }, lead),
      tab === 'room' ? roomTab() : tab === 'live' ? liveTab() : tab === 'supplies' ? suppliesTab() : Bench.setup());
    drawn = tab;
    scroller.scrollTop = keep;
    if (focus && focus[0]) { const again = [...host.querySelectorAll('input, select, button')].find(el => el.getAttribute('aria-label') === focus[0] && (!focus[1] || (el.closest('[data-plan]') && el.closest('[data-plan]').dataset.plan === focus[1]))); if (again) again.focus({ preventScroll: true }); }
  }

  function init() {
    App.on('plan', render); App.on('view', render); App.on('nursery', render); App.on('date', () => { if (App.state.view === 'trays') render(); });
    Thumbs.on(() => { if (App.state.view === 'trays') render(); });
  }
  root.LRFTraysView = { init, render, figures, setTab, open, tab: () => tab, TABS: TABS.map(t => t.slice(0, 2)), get dirty() { return dirty; } };
})(window);
