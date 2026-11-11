/* Little River Farm Planner — the Harvest view.
 *
 * What the plan is expected to give, by day, week or month: vegetables, microgreen trays and flower
 * stems, a row to a crop. The shade of a cell says how much against that crop's own best period; the
 * number is always written in it. A list for one stretch can be copied, printed or downloaded to send
 * to a chef.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, F = root.LRFForecast;
  const { h, clear, num, day } = UI;
  const $ = id => document.getElementById(id);
  const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const TITLES = Object.fromEntries(F.GROUPS.map(([g, short, long]) => [g, { short, long }]));
  let dirty = true, grain = 'week', group = 'all', query = '';
  const opened = new Set();

  const cache = new WeakMap();
  function model() {
    const eng = App.state.engine;
    if (!cache.has(eng)) cache.set(eng, F.build(eng, { year: App.planYear() }));
    return cache.get(eng);
  }
  const todayIndex = m => Math.max(0, Math.min(m.days - 1, m.index(App.state.date)));
  /** The week the planning date is in, as a column. */
  const thisWeek = m => { const i = todayIndex(m); return F.periods(m, 'week', i, i).find(c => c.i0 <= i && c.i1 >= i) || F.periods(m, 'week', i, i)[0]; };
  const colTitle = c => grain === 'month' ? `${UI.MONTHS[c.start.getMonth()]}` : c.i0 === c.i1 ? UI.dayLong(c.start).replace(/, \d{4}$/, '') : `week of ${day(c.start)}`;
  const qty = n => { const v = F.shown(n); return v ? num(v, v < 10 ? 1 : 0) : ''; };

  // ── things that leave the page ──
  function download(name, text, type) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type })), a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      UI.toast(`${name} downloaded.`);
    } catch (_) { UI.toast('Downloads are not available in this view. Copy the list instead.'); }
  }
  async function copy(text, box) {
    try { await navigator.clipboard.writeText(text); UI.toast('Copied. Paste it into an email or a text.'); return; } catch (_) { /* fall through to selecting it */ }
    const range = document.createRange(); range.selectNodeContents(box);
    const sel = root.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let done = false;
    try { done = document.execCommand('copy'); } catch (_) { done = false; }
    UI.toast(done ? 'Copied. Paste it into an email or a text.' : 'The list is selected: press Ctrl+C (or Cmd+C) to copy it.');
  }
  function print(text) {
    let sheet = $('printSheet');
    if (!sheet) { sheet = h('div', { id: 'printSheet' }); document.body.append(sheet); }
    sheet.textContent = text;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); root.removeEventListener('afterprint', done); };
    root.addEventListener('afterprint', done);
    try { root.print(); } catch (_) { UI.toast('Printing is not available in this view. Copy the list instead.'); }
    setTimeout(done, 1500);
  }
  /** The list that goes to a chef: pick the stretch, look at it, then copy, print or download it. */
  function share() {
    const m = model(), wk = thisWeek(m), weeks = F.periods(m, 'week'), at = weeks.findIndex(c => c.key === wk.key), s = F.season(m);
    const ranges = [['this', `Week of ${day(wk.start)}`, () => ({ cols: [wk], grain: 'week' })], ['four', 'The next four weeks', () => ({ cols: weeks.slice(at, at + 4), grain: 'week' })],
      ['weeks', 'The whole season, week by week', () => ({ cols: s ? F.periods(m, 'week', s.i0, s.i1) : [], grain: 'week' })], ['months', 'The whole season, month by month', () => ({ cols: s ? F.periods(m, 'month', s.i0, s.i1) : [], grain: 'month' })]];
    const range = h('select', { id: 'hvShareRange', 'aria-label': 'Which stretch' }, ranges.map(([v, label]) => h('option', { value: v }, label)));
    const kind = h('select', { id: 'hvShareKind', 'aria-label': 'Which kinds' }, h('option', { value: '' }, 'Everything'), F.GROUPS.map(([g, short]) => h('option', { value: g }, `${short} only`)));
    const varieties = h('input', { type: 'checkbox', id: 'hvShareVar' }), prices = h('input', { type: 'checkbox', id: 'hvSharePrice' });
    const sheet = h('div.hv-sheet', { id: 'hvSheet', tabindex: 0 });
    const current = () => { const r = ranges.find(x => x[0] === range.value)[2](); return { ...r, text: F.text(m, r.cols, { farm: App.state.plan.settings.farm || 'Farm', grain: r.grain, varieties: varieties.checked, prices: prices.checked, group: kind.value || undefined }) }; };
    const draw = () => { sheet.textContent = current().text; };
    for (const el of [range, kind, varieties, prices]) el.addEventListener('change', draw);
    const close = () => { dialog.close(); dialog.remove(); };
    const dialog = h('dialog.dialog.wide', { id: 'hvShare', oncancel: e => { e.preventDefault(); close(); } },
      h('h2', 'A list to send'), h('p', 'What the plan expects to have, as plain text for an email or a text message. Quantities are rounded down, never up.'),
      h('div.hv-opts', range, kind, h('label', varieties, 'Name the varieties'), h('label', prices, 'Show prices')),
      sheet,
      h('div.dialog-actions',
        h('button.btn', { type: 'button', id: 'hvCsv', onclick: () => { const r = current(); download(`${(App.state.plan.settings.farm || 'farm').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-availability-${m.year}.csv`, F.csv(m, r.cols, { grain: r.grain }), 'text/csv'); } }, 'Download spreadsheet'),
        h('button.btn', { type: 'button', id: 'hvPrint', onclick: () => print(current().text) }, 'Print'),
        h('span.grow'),
        h('button.btn', { type: 'button', onclick: close }, 'Close'),
        h('button.btn.primary', { type: 'button', id: 'hvCopy', onclick: () => copy(current().text, sheet) }, 'Copy')));
    document.body.append(dialog); draw(); dialog.showModal();
  }
  /** Where a figure comes from: the plantings picked in that stretch. */
  function sources(row, col) {
    const eng = App.state.engine, list = row.plantings.filter(x => x.i0 <= col.i1 && x.i1 >= col.i0).map(x => ({ ...x, here: x.rate * (Math.min(x.i1, col.i1) - Math.max(x.i0, col.i0) + 1) })).sort((a, b) => b.here - a.here);
    const close = () => { dialog.close(); dialog.remove(); };
    const go = x => { close(); App.setDate(x.r.first > App.state.date ? x.r.first : App.state.date); App.setView('map'); App.select({ type: 'planting', id: x.p.id }); };
    const dialog = h('dialog.dialog.wide', { id: 'hvFrom', oncancel: e => { e.preventDefault(); close(); } },
      h('h2', `${row.name}, ${colTitle(col)}`), h('p', `${F.amount(F.sum(row.days, col.i0, col.i1), row.unit, row.group)} from ${num(list.length)} planting${list.length === 1 ? '' : 's'}. Each one’s yield is spread evenly over the days it is picked.`),
      h('ul.hv-from', list.map(x => h('li',
        h('b', `${App.bedLabel(x.r.b, eng)}${x.r.c.vname ? ' · ' + x.r.c.vname : ''}`),
        h('span', `picked ${UI.span(x.r.first, x.r.last)}`), h('span', F.amount(x.here, row.unit, row.group)),
        h('button.link', { type: 'button', onclick: () => go(x) }, 'Show on the map')))),
      h('div.dialog-actions', h('button.btn.primary', { type: 'button', onclick: close }, 'Close')));
    document.body.append(dialog); dialog.showModal();
  }

  // ── the page ──
  const stat = (label, value, note) => h('div.tr-stat', h('span', label), h('strong', value), note ? h('small', note) : null);
  function tiles(m) {
    const wk = thisWeek(m), now = F.glance(m, wk.i0, wk.i1), all = F.glance(m, 0, m.days - 1), s = F.season(m);
    let best = null;
    for (const c of F.periods(m, 'week')) { const worth = m.rows.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0); if (!best || worth > best.worth) best = { c, worth }; }
    const kinds = [[now.produce, 'vegetable', 'vegetables'], [now.micros, 'microgreen', 'microgreens'], [now.flowers, 'flower', 'flowers']].filter(x => x[0]).map(([n, one, many]) => `${num(n)} ${n === 1 ? one : many}`).join(' · ');
    return h('div.tr-stats', { id: 'hvTiles' },
      stat(`Ready the week of ${day(wk.start)}`, `${num(now.crops)} crop${now.crops === 1 ? '' : 's'}`, kinds || 'nothing is being picked'),
      stat('Worth that week', money(now.worth), `${money(all.worth)} over the season, at each crop’s own price`),
      stat('Microgreen trays', num(F.shown(now.trays)), `that week · ${num(F.shown(all.trays))} over the season`),
      stat('Flower stems', num(F.shown(now.stems)), `that week · ${num(F.shown(all.stems))} over the season`),
      stat('Picking season', s ? UI.span(m.date(s.i0), m.date(s.i1)) : '—', best && best.worth > 0 ? `fullest week: ${day(best.c.start)}, ${money(best.worth)}` : ''));
  }
  function columns(m) {
    const s = F.season(m), i = todayIndex(m);
    if (grain === 'day') { const a = thisWeek(m).i0; return F.periods(m, 'day', a, Math.min(m.days - 1, a + 27)); }   // four weeks, from the Monday of the planning week
    if (!s) return [];
    const lo = Math.min(s.i0, i), hi = Math.max(s.i1, i);
    return F.periods(m, grain, lo, hi);
  }
  function table(m, cols, rows) {
    const i = todayIndex(m), isNow = c => c.i0 <= i && c.i1 >= i, eng = App.state.engine;
    const head = h('tr', h('th.hv-name', 'Crop'), h('th.hv-total', 'Season'),
      cols.map(c => h('th' + (isNow(c) ? '.now' : '') + (c.weekend ? '.wkend' : ''), { scope: 'col', title: `Go to ${colTitle(c)}`, onclick: () => App.setDate(c.start), dataset: { col: c.key } }, h('b', c.top || ''), c.label)));
    const body = [];
    const line = (cls, label, total, series, row, maxOf) => {
      const peak = maxOf != null ? maxOf : Math.max(0, ...cols.map(c => F.sum(series, c.i0, c.i1)));
      return h('tr' + cls, label, total, cols.map(c => {
        const v = F.sum(series, c.i0, c.i1), text = qty(v);
        if (!text) return h('td.hv-c.zero' + (isNow(c) ? '.now' : ''));
        const p = peak > 0 ? Math.round(10 + 52 * Math.min(1, v / peak)) : 10;
        return h('td.hv-c' + (isNow(c) ? '.now' : ''), { style: { '--p': p + '%' }, title: row ? `${row.name}, ${colTitle(c)}: ${F.amount(v, row.unit, row.group)}` : '', onclick: row ? () => sources(row, c) : null }, text);
      }));
    };
    const plain = (cls, label, total, value) => h('tr' + cls, label, total, cols.map(c => { const v = value(c); return h('td' + (isNow(c) ? '.now' : ''), v || ''); }));
    for (const [g, , long] of F.GROUPS) {
      const part = rows.filter(r => r.group === g);
      if (!part.length) continue;
      body.push(h('tr.hv-group', { dataset: { group: g } }, h('th', { colSpan: 2 }, long, h('small', `${num(part.length)} crop${part.length === 1 ? '' : 's'}`)), h('td', { colSpan: cols.length })));
      for (const row of part) {
        const many = row.varieties.length > 1 || (row.varieties.length === 1 && row.varieties[0].id), isOpen = opened.has(row.key);
        const name = h('td.hv-name', h('button.hv-crop', { type: 'button', disabled: !many, 'aria-expanded': many ? String(isOpen) : null, style: { '--crop': row.color }, title: many ? `${isOpen ? 'Hide' : 'Show'} the varieties` : row.name,
          onclick: () => { if (isOpen) opened.delete(row.key); else opened.add(row.key); render(); } }, h('span.caret', many ? (isOpen ? '▾' : '▸') : ''), h('i'), h('span', row.name), h('small', F.unitWord(2, row.unit, row.group) || 'each')));
        body.push(line('.hv-row', name, h('td.hv-total', { title: `${money(row.worth)} at its own price` }, row.total > 0 ? F.amount(row.total, row.unit, row.group) : '—'), row.days, row));
        body[body.length - 1].dataset.crop = row.cropId;
        if (many && isOpen) {
          const peak = Math.max(0, ...cols.map(c => F.sum(row.days, c.i0, c.i1)));
          for (const v of row.varieties) body.push(line('.hv-var', h('td.hv-name', { title: v.name }, v.name), h('td.hv-total', F.amount(v.total, row.unit, row.group)), v.days, null, peak));
          if (g !== 'micro') body.push(h('tr.hv-var', h('td.hv-name', { colSpan: 2 }, 'Listed with ', h('button.linkish.hv-move', { type: 'button', onclick: () => moveCrop(row, g === 'flower' ? 'produce' : 'flower') }, `move to ${g === 'flower' ? 'vegetables' : 'flowers'}`)), h('td', { colSpan: cols.length })));
        }
      }
      // trays add up, and so do stems; pounds and heads and bunches do not
      if (g !== 'produce' && part.length > 1) {
        const all = new Float64Array(m.days); for (const r of part) for (let k = 0; k < m.days; k++) all[k] += r.days[k];
        body.push(line('.hv-sum', h('td.hv-name', g === 'micro' ? 'All trays' : 'All stems'), h('td.hv-total', num(F.shown(F.sum(all, 0, m.days - 1)))), all, null));
      }
    }
    const foot = plain('', h('td.hv-name', 'Worth, at each crop’s own price'), h('td.hv-total', money(rows.reduce((n, r) => n + r.worth, 0))), c => { const v = rows.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0); return v >= 1 ? money(v) : ''; });
    return h('div.hv-scroll', { id: 'hvScroll' }, h('table.hv', { id: 'hvTable' }, h('thead', head), h('tbody', body), h('tfoot', foot)));
  }
  /** A crop the planner sorted wrongly is moved by hand, and stays moved. */
  function moveCrop(row, to) {
    const groups = { ...((App.state.plan.lrfNext || {}).groups || {}) };
    groups[row.cropId] = to;
    if (App.setOwn('groups', groups, `${row.name} listed with ${to === 'flower' ? 'flowers' : 'vegetables'}`)) UI.toast(`${row.name} is listed with ${to === 'flower' ? 'flowers' : 'vegetables'}.`, { label: 'Undo', run: App.undo });
  }
  function render() {
    if (!App.state.ready || App.state.view !== 'harvest') { dirty = true; return; }
    dirty = false;
    const m = model(), host = $('hvWrap'), keepTop = host.parentElement.scrollTop, keepLeft = $('hvScroll') ? $('hvScroll').scrollLeft : null, wk = thisWeek(m);
    const needle = query.trim().toLowerCase();
    const rows = m.rows.filter(r => r.total > 0 && (group === 'all' || r.group === group) && (!needle || r.name.toLowerCase().includes(needle) || r.varieties.some(v => v.name.toLowerCase().includes(needle))));
    const cols = columns(m);
    const seg = (value, label) => h('button', { type: 'button', 'aria-pressed': String(grain === value), dataset: { hvGrain: value }, onclick: () => { grain = value; render(); } }, label);
    const chip = (value, label, n) => h('button.chip', { type: 'button', 'aria-pressed': String(group === value), dataset: { hvGroup: value }, onclick: () => { group = value; render(); } }, label, h('small', num(n)));
    const search = h('input', { type: 'search', id: 'hvSearch', placeholder: 'Find a crop', value: query, autocomplete: 'off', 'aria-label': 'Find a crop or variety' });
    search.addEventListener('input', () => { query = search.value; render(); const again = $('hvSearch'); again.focus(); again.setSelectionRange(query.length, query.length); });
    const noYield = m.unset.filter(u => u.why.startsWith('no yield'));
    UI.add(clear(host),
      h('header.as-head', h('p.eyebrow', `Harvest forecast · ${App.state.plan.settings.farm || 'Farm'} · ${m.year}`), h('h2', 'What is ready, and when'),
        h('p', 'Every planting’s expected yield, spread evenly over the days it is picked and added up by crop. Each crop is counted in the unit it is sold in. Click a figure to see which plantings it comes from.')),
      tiles(m),
      h('div.hv-bar',
        h('span.tr-stepper', h('button.icon-btn', { type: 'button', 'aria-label': 'Back one week', id: 'hvPrev', onclick: () => App.setDate(E.addDays(App.state.date, -7)) }, '‹'),
          h('b', { id: 'hvWeek' }, `Week of ${day(wk.start)}`), h('button.icon-btn', { type: 'button', 'aria-label': 'Forward one week', id: 'hvNext', onclick: () => App.setDate(E.addDays(App.state.date, 7)) }, '›')),
        h('div.seg', { role: 'group', 'aria-label': 'Show by' }, seg('day', 'Days'), seg('week', 'Weeks'), seg('month', 'Months')),
        h('div.sd-filters', { role: 'group', 'aria-label': 'Which kinds' }, chip('all', 'All', m.rows.filter(r => r.total > 0).length), F.GROUPS.map(([g, short]) => chip(g, short, m.rows.filter(r => r.total > 0 && r.group === g).length))),
        h('span.grow'), search,
        h('button.btn.primary', { type: 'button', id: 'hvShareBtn', onclick: share }, 'A list to send…')),
      !m.rows.some(r => r.total > 0) ? h('p.hv-empty', 'Nothing in this plan has a harvest to forecast yet.') : !rows.length ? h('p.hv-empty', 'No crop matches.') : table(m, cols, rows),
      noYield.length ? h('p.hv-note.warn', `${num(noYield.length)} planting${noYield.length === 1 ? ' has' : 's have'} no yield figure for the crop, so nothing is forecast for ${noYield.length === 1 ? 'it' : 'them'}: ${[...new Set(noYield.map(u => u.r.c.name))].slice(0, 6).join(', ')}.`) : null,
      h('p.hv-note', 'A planting’s yield is what it is counted by (plants, bed-feet, trays) × the crop’s yield each × its marketable share. A live tray is counted whole on the Monday it is due. Days to harvest are the same in every month, so an early or late planting is as good here as a midsummer one: read the ends of the season with that in mind.'));
    host.parentElement.scrollTop = keepTop;
    const scroller = $('hvScroll');
    if (scroller) {
      if (keepLeft != null && render.lastGrain === grain) scroller.scrollLeft = keepLeft;
      else { const now = scroller.querySelector('thead th.now'); if (now) scroller.scrollLeft = Math.max(0, now.offsetLeft - 320 - 3 * now.offsetWidth); }
    }
    render.lastGrain = grain;
  }
  function init() {
    App.on('plan', render); App.on('view', render); App.on('date', () => { if (App.state.view === 'harvest') render(); });
  }
  root.LRFHarvestView = { init, render, model, get dirty() { return dirty; } };
})(window);
