/* Little River Farm Planner — the Forecast page (the view still called 'harvest' inside the planner).
 *
 * What the plan is expected to give, by day, week or month: vegetables, microgreen trays and flower
 * stems, a row to a crop, in amounts or in dollars, with each week's total and the season's. The shade
 * of a cell says how much against that crop's own best period; the number is written in it. "Whole
 * season" fits every week of the season to the screen at one press. A list for one stretch can be
 * copied, printed or downloaded to send to a chef.
 *
 * The page stands in the frame (DESIGN.md, rule 1): its title with "?" beside it, one line of figures,
 * its own controls, then the table. What its paragraphs said is behind "?".
 *
 * Every figure is the forecast's own (js/forecast.js), kept for the plan's engine: nothing here is worked
 * out afresh when the page draws again, and a change to the plan makes a new engine and a new forecast.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, F = root.LRFForecast;
  const { h, clear, num, day } = UI;
  const $ = id => document.getElementById(id);
  const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const TITLES = Object.fromEntries(F.GROUPS.map(([g, short, long]) => [g, { short, long }]));
  let dirty = true, grain = 'week', group = 'all', query = '', series = 'days';   // series: what there is to sell ('days'), or what is picked ('picked')
  // measure: amounts, or dollars (what there is to sell, at each crop's own price). fit: the whole season's weeks fitted to the screen.
  let measure = 'amounts', fit = false;
  const dollars = () => measure === 'dollars';
  const seriesOf = (m, x) => (dollars() ? x.value : series === 'picked' && m.keeps ? x.picked : x.days);
  // Stock picked before Jan 1 and still to sell in the year (js/forecast.js, `carried`) stands on a line of its own under its crop, so
  // the crop's line is the year's own harvest. On Picked there is none of it: nothing of it is picked in the year.
  const carries = (m, x) => !!x && x.carriedTotal > 1e-9 && !(series === 'picked' && m.keeps && !dollars());
  const carriedOf = x => (dollars() ? x.carriedValue : x.carried);
  /** A crop's or a variety's line without what was carried in (the line under it has that). */
  const ownOf = (m, x) => { const all = seriesOf(m, x); if (!carries(m, x)) return all; const c = carriedOf(x); return all.map((v, i) => v - c[i]); };
  const opened = new Set();

  // Whom it is grown for. Every planting is counted until one is marked for personal use; from then on the page can show
  // everything, what is grown to sell, or what is for the farm's own table. The list that is sent is always the commercial one.
  let use = 'all';
  const USES = [['all', 'Everything'], ['commercial', 'Commercial'], ['personal', 'Personal use']];
  /** The forecast of the open plan: every planting, or (which: 'commercial' | 'personal') one kind only. Kept with the plan's engine. */
  function model(which) {
    const eng = App.state.engine, key = which === 'commercial' || which === 'personal' ? which : 'all', all = F.kept(eng, { year: App.planYear() });
    return key === 'all' || !all.personal ? all : F.kept(eng, { year: App.planYear(), use: key });   // nothing marked: the three are one
  }
  /** The forecast the page is showing. */
  const shownModel = () => model(model().personal ? use : 'all');
  const todayIndex = m => Math.max(0, Math.min(m.days - 1, m.index(App.state.date)));
  /** The week the planning date is in, as a column. */
  const thisWeek = m => { const i = todayIndex(m); return F.periods(m, 'week', i, i).find(c => c.i0 <= i && c.i1 >= i) || F.periods(m, 'week', i, i)[0]; };
  const colTitle = c => grain === 'month' ? `${UI.MONTHS[c.start.getMonth()]}` : c.i0 === c.i1 ? UI.dayLong(c.start).replace(/, \d{4}$/, '') : `week of ${day(c.start)}`;
  const qty = n => { const v = F.shown(n); return v ? num(v, v < 10 ? 1 : 0) : ''; };
  /** A week's dollars in a cell: whole dollars, and nothing under one. */
  const cash = n => (n >= 1 ? money(n) : '');
  /**
   * In the whole season fitted to the screen a column is narrow: a thousand and more is written "1.2k", rounded down from the figure
   * itself (never from the figure already rounded to a dollar); below that the cell's own words, dollars without "$".
   */
  const tight = (text, n) => { if (!text) return ''; if (!(n >= 1000)) return String(text).replace('$', ''); return n >= 10000 ? `${Math.floor(n / 1000 + 1e-9)}k` : `${Math.floor(n / 100 + 1e-9) / 10}k`; };

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
  // Inside another page's frame (the Claude page) a download or a print is refused without a word, so those buttons are not offered there.
  const framed = (() => { try { return root.self !== root.top; } catch (_) { return true; } })();
  /** The list that goes to a chef: pick the stretch, look at it, then copy, print or download it. */
  function share() {
    // what is sent is what is for sale: plantings marked for personal use are not in it
    const m = model('commercial'), left = model().personal, wk = thisWeek(m), weeks = F.periods(m, 'week'), at = weeks.findIndex(c => c.key === wk.key), s = F.season(m);
    const ranges = [['this', `Week of ${day(wk.start)}`, () => ({ cols: [wk], grain: 'week' })], ['four', 'The next four weeks', () => ({ cols: weeks.slice(at, at + 4), grain: 'week' })],
      ['weeks', 'The whole season, week by week', () => ({ cols: s ? F.periods(m, 'week', s.i0, s.i1) : [], grain: 'week' })], ['months', 'The whole season, month by month', () => ({ cols: s ? F.periods(m, 'month', s.i0, s.i1) : [], grain: 'month' })]];
    const range = h('select', { id: 'hvShareRange', 'aria-label': 'Which stretch' }, ranges.map(([v, label]) => h('option', { value: v }, label)));
    const kind = h('select', { id: 'hvShareKind', 'aria-label': 'Which kinds' }, h('option', { value: '' }, 'Everything'), F.GROUPS.map(([g, short]) => h('option', { value: g }, `${short} only`)));
    const varieties = h('input', { type: 'checkbox', id: 'hvShareVar' }), prices = h('input', { type: 'checkbox', id: 'hvSharePrice' });
    const sheet = h('div.hv-sheet', { id: 'hvSheet', tabindex: 0 });
    const current = () => {
      const { cols, grain } = ranges.find(x => x[0] === range.value)[2]();
      return { cols, options: { farm: App.state.plan.settings.farm || 'Farm', grain, varieties: varieties.checked, prices: prices.checked, group: kind.value || undefined } };
    };
    const draw = () => { const { cols, options } = current(); sheet.textContent = F.text(m, cols, options); };
    for (const el of [range, kind, varieties, prices]) el.addEventListener('change', draw);
    const close = () => { dialog.close(); dialog.remove(); };
    const dialog = h('dialog.dialog.wide', { id: 'hvShare', oncancel: e => { e.preventDefault(); close(); } },
      h('h2', 'A list to send'), h('p', 'What the plan expects to have, as plain text for an email or a text message. Quantities are rounded down, never up.'),
      left ? h('p.dlg-hint', { id: 'hvShareOwn' }, `${num(left)} planting${left === 1 ? '' : 's'} marked for personal use ${left === 1 ? 'is' : 'are'} left out of this list.`) : null,
      h('div.hv-opts', range, kind, h('label', varieties, 'Name the varieties'), h('label', prices, 'Show prices')),
      sheet,
      framed ? h('p.dlg-hint', 'Here the list can be copied. Printing it or downloading a spreadsheet needs the planner opened at its own address.') : null,
      h('div.dialog-actions',
        framed ? null : h('button.btn', { type: 'button', id: 'hvCsv', onclick: () => { const { cols, options } = current(); download(`${options.farm.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-availability-${m.year}.csv`, F.csv(m, cols, options), 'text/csv'); } }, 'Download spreadsheet'),
        framed ? null : h('button.btn', { type: 'button', id: 'hvPrint', onclick: () => print(sheet.textContent) }, 'Print'),
        h('span.grow'),
        h('button.btn', { type: 'button', onclick: close }, 'Close'),
        h('button.btn.primary', { type: 'button', id: 'hvCopy', onclick: () => copy(sheet.textContent, sheet) }, 'Copy')));
    document.body.append(dialog); draw(); dialog.showModal();
  }
  /** A crop the series tool can size to a weekly amount: one with a harvest to space plantings by. Tray crops follow weekly demand instead. */
  function plannable(row) { const eng = App.state.engine, c = eng.crop(row.cropId); return row.group !== 'micro' && !!root.LRFSeries && !!c && +c.dtm > 0 && !eng.isCoverCrop(c); }
  /** How a planting is picked, in the Assumptions list's own words, as a tag. */
  const PATTERN = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };
  /**
   * Does a planting take its harvest window from its crop's line? The card's own rule (js/yieldcard.js): not when it, or its
   * variety, carries a window of its own, or it has a last day of its own; a tower's harvest is its own.
   */
  const followsLine = (eng, p) => (root.LRFYieldCard && root.LRFYieldCard.follows ? root.LRFYieldCard.follows(eng, p) : true);
  /**
   * Where a figure comes from: the plantings picked in that stretch, one row each, with how each is picked as tags. A figure in
   * dollars comes only from the plantings that earn it: one for personal use, or with no price, is not among them.
   */
  function sources(row, col, part) {
    const eng = App.state.engine, picked = !dollars() && series === 'picked' && shownModel().keeps;
    const list = row.plantings.map(x => ({ ...x, here: F.share(x, col.i0, col.i1, picked, part) })).filter(x => x.here > 1e-9 && (!dollars() || x.here * (x.price || 0) > 1e-9)).sort((a, b) => b.here - a.here), total = list.reduce((n, x) => n + x.here, 0);
    const worth = list.reduce((n, x) => n + x.here * (x.price || 0), 0);
    const close = () => { dialog.close(); dialog.remove(); };
    const go = x => { close(); App.setDate(x.r.first > App.state.date ? x.r.first : App.state.date); App.setView('map'); App.select({ type: 'planting', id: x.p.id }); };
    const when = x => x.pattern === 'once' ? `all of it ${day(x.from || x.r.first)}` : `picked ${UI.span(x.from || x.r.first, x.to || x.r.last)}`;   // a thing picked on days of its own says those
    const tag = (kind, text, title) => h('span.fc-tag', { dataset: { hook: 'fc-tag', tag: kind }, title: title || null }, text);
    const tags = x => {
      const bed = eng.bedOf(x.p.bedId), own = bed && !eng.isRack(bed) && !followsLine(eng, x.p);
      return [tag('pattern', PATTERN[x.pattern] || PATTERN.spread, 'How it is picked: its crop’s line under Assumptions, Yield and price'),
        own ? tag('own', 'Own window', 'This planting, or its variety, has a harvest window or a last day of its own: the crop’s choice of window does not move it') : null,
        x.keep ? tag('keeps', `Keeps ${num(x.keep, 1)} wk`) : null, x.personal ? tag('personal', 'Personal use') : null];
    };
    const lead = `${F.amount(total, row.unit, row.group)} ${picked ? 'picked' : 'to sell'} · ${num(list.length)} planting${list.length === 1 ? '' : 's'}`;
    const dialog = h('dialog.dialog.wide', { id: 'hvFrom', dataset: { hook: 'fc-from' }, oncancel: e => { e.preventDefault(); close(); } },
      h('h2', `${row.name}${part === 'carried' ? `, carried in from ${(row.carriedFrom && row.carriedFrom.length ? row.carriedFrom : [App.planYear() - 1]).join(' and ')}` : ''}, ${colTitle(col)}`), h('p', { dataset: { hook: 'fc-from-lead' } }, lead, !picked && worth >= 1 ? ` · ${money(worth)}` : ''),
      h('ul.hv-from', list.map(x => h('li.row', { dataset: { hook: 'fc-from-row', planting: x.p.id, pattern: x.pattern, here: String(x.here) } },
        root.LRFThumbs.el({ varietyId: x.p.varietyId, cropId: x.p.cropId, color: eng.cropColor(x.r.c), label: x.r.c.vname || x.r.c.name, size: 40 }),
        h('span', h('b.row-name', { dataset: { hook: 'fc-from-variety' } }, x.r.c.vname || 'No variety chosen'),
          h('span.row-detail', h('span', { dataset: { hook: 'fc-from-bed' } }, App.bedLabel(x.r.b, eng)), ` · ${when(x)}`), h('span.fc-tags', tags(x))),
        h('span.row-word', h('span', { dataset: { hook: 'fc-from-amount' } }, F.amount(x.here, row.unit, row.group)),
          h('button.link', { type: 'button', onclick: () => go(x) }, 'Show on the map'))))),
      h('div.dialog-actions',
        // more of it wanted that week: the series tool, asked from the harvest end, opens on this crop from that day
        plannable(row)
          ? h('button.btn', { type: 'button', id: 'hvPlan', title: `Say how much ${row.name.toLowerCase()} is wanted each week from here on, and see the plantings that would give it`, onclick: () => { close(); App.openAhead({ thing: row.thing || '', mode: 'series', by: 'harvest', cropId: row.cropId, from: E.d2s(col.start) }); } }, 'Plan to a weekly amount…') : null,
        h('span.grow'),
        h('button.btn.primary', { type: 'button', onclick: close }, 'Done')));
    document.body.append(dialog); dialog.showModal();
  }

  // ── the page ──
  /** The page's one line of figures (DESIGN.md, rule 1): the season's worth leads; the week in hand; what is ready; trays; stems. */
  const fig = (name, word, value, after, opts = {}) => h('span.fc-fig' + (opts.cls ? '.' + opts.cls : ''), { dataset: { hook: 'fc-fig', fig: name }, title: opts.title || null },
    word ? h('span', word + ' ') : null, h('b', value), after ? h('span', ' ' + after) : null);
  /** What the figures say beyond their line, for "?": the fullest week, the season's trays and stems, the kinds ready. */
  let figNotes = [];
  function figures(m, noYield) {
    // picking starts with the year's own harvest: stock carried in from the year before is sold in the year, not picked in it
    const wk = thisWeek(m), now = F.glance(m, wk.i0, wk.i1), all = F.glance(m, 0, m.days - 1), s = F.season(m, m.rows.map(r => (r.carriedTotal > 1e-9 ? { days: r.days.map((v, i) => v - r.carried[i]) } : r)));
    let best = null;
    for (const c of F.periods(m, 'week')) { const worth = m.rows.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0); if (!best || worth > best.worth) best = { c, worth }; }
    const kinds = [[now.produce, 'vegetable', 'vegetables'], [now.micros, 'microgreen', 'microgreens'], [now.flowers, 'flower', 'flowers']].filter(x => x[0]).map(([n, one, many]) => `${num(n)} ${n === 1 ? one : many}`).join(' · ');
    // once anything is marked for personal use, each figure says which plantings it counts
    const marked = model().personal > 0, which = !marked ? '' : m.use === 'commercial' ? 'commercial only' : m.use === 'personal' ? 'personal use only' : 'personal use included';
    const worthSays = m.use === 'personal' ? 'personal use is not counted as revenue' : marked ? 'commercial plantings only' : '';
    figNotes = [['Season', `${money(all.worth)}, at each crop’s own price${worthSays ? ' · ' + worthSays : ''}`],
      [`Week of ${day(wk.start)}`, `${money(now.worth)} · ${kinds || 'nothing is being picked'}${which ? ' · ' + which : ''}`],
      ['Microgreen trays', `${num(F.shown(now.trays))} that week · ${num(F.shown(all.trays))} over the season`],
      ['Flower stems', `${num(F.shown(now.stems))} that week · ${num(F.shown(all.stems))} over the season`],
      ...(best && best.worth > 0 ? [['Fullest week', `${day(best.c.start)}, ${money(best.worth)}`]] : []),
      // the year's two edges (js/forecast.js): a pound is in the one season it is sold in
      ...(m.carried && m.carried.total > 1e-9 ? [[`Carried in from ${(m.carried.years.length ? m.carried.years : [m.year - 1]).join(' and ')}`, `${money(m.carried.worth)} of ${m.carried.crops.join(', ')}, picked before Jan 1 and still to sell. It is in this season's figures, on a line of its own under its crop`]] : []),
      ...(m.after && m.after.total > 1e-9 ? [['After Dec 31', `${money(m.after.worth)} more of ${m.after.crops.join(', ')}, picked or still in store after the year's end. It counts in ${m.year + 1}, not in this season's worth`]] : [])];
    return h('p.frame-figs.fc-figs', { id: 'hvFigs', dataset: { hook: 'fc-figs', use: marked ? m.use : '' } },
      fig('season', 'Season', money(all.worth), worthSays, { cls: 'lead' }),
      fig('week', `Week of ${day(wk.start)}`, money(now.worth), which),
      fig('ready', '', `${num(now.crops)} crop${now.crops === 1 ? '' : 's'}`, 'ready that week'),
      fig('trays', '', num(F.shown(now.trays)), 'microgreen trays'),
      fig('stems', '', num(F.shown(now.stems)), 'flower stems'),
      fig('picking', 'Picking', s ? UI.span(m.date(s.i0), m.date(s.i1)) : '—'),
      // a planting the forecast can say nothing for: amber, a dot and a word (DESIGN.md, colour), where it is mended named in its title
      noYield.length ? fig('no-yield', '', `${num(noYield.length)} planting${noYield.length === 1 ? '' : 's'}`, 'with no yield set',
        { cls: 'short', title: `Nothing is forecast for ${noYield.length === 1 ? 'it' : 'them'} until the crop has a yield, under Assumptions, Yield and price: ${[...new Set(noYield.map(u => u.r.c.name))].slice(0, 6).join(', ')}` }) : null);
  }
  function columns(m) {
    const s = F.season(m), i = todayIndex(m);
    if (grain === 'day') { const a = thisWeek(m).i0; return F.periods(m, 'day', a, Math.min(m.days - 1, a + 27)); }   // four weeks, from the Monday of the planning week
    if (!s) return [];
    if (fit) return F.periods(m, 'week', s.i0, s.i1);   // the whole season, week by week, and nothing either side of it
    const lo = Math.min(s.i0, i), hi = Math.max(s.i1, i);
    return F.periods(m, grain, lo, hi);
  }
  function table(m, cols, rows) {
    const i = todayIndex(m), isNow = c => c.i0 <= i && c.i1 >= i, cash$ = dollars();
    const say = (text, n) => (fit ? tight(text, n) : text);
    const head = h('tr', h('th.hv-name', 'Crop'), h('th.hv-total', 'Season'),
      cols.map(c => h('th' + (isNow(c) ? '.now' : '') + (c.weekend ? '.wkend' : ''), { scope: 'col', title: `Go to ${colTitle(c)}`, onclick: () => App.setDate(c.start), dataset: { col: c.key } }, h('b', c.top || ''), c.label)));
    const body = [];
    // a line of the table: in amounts, a crop's quantity each period; in dollars, what it is worth then. The figure in full is in its title.
    const line = (cls, label, total, series, row, maxOf, unit, part) => {
      const peak = maxOf != null ? maxOf : Math.max(0, ...cols.map(c => F.sum(series, c.i0, c.i1)));
      return h('tr' + cls, label, total, cols.map(c => {
        const v = F.sum(series, c.i0, c.i1), text = cash$ ? cash(v) : qty(v), full = cash$ ? money(v) : unit ? F.amount(v, unit.unit, unit.group) : text;
        if (!text) return h('td.hv-c.zero' + (isNow(c) ? '.now' : ''));
        const p = peak > 0 ? Math.round(10 + 52 * Math.min(1, v / peak)) : 10;
        return h('td.hv-c' + (isNow(c) ? '.now' : ''), { style: { '--p': p + '%' }, title: row ? `${row.name}, ${colTitle(c)}: ${full}` : `${colTitle(c)}: ${full}`, onclick: row ? () => sources(row, c, part) : null }, say(text, cash$ ? v : F.shown(v)));
      }));
    };
    const plain = (cls, label, total, value) => h('tr' + cls, label, total, cols.map(c => { const n = value(c), v = cash(n); return h('td' + (isNow(c) ? '.now' : ''), { title: v ? `${colTitle(c)}: ${v}` : null }, say(v, n) || ''); }));
    for (const [g, , long] of F.GROUPS) {
      const part = rows.filter(r => r.group === g);
      if (!part.length) continue;
      body.push(h('tr.hv-group', { dataset: { group: g } }, h('th', { colSpan: 2 }, long, h('small', `${num(F.cropCount(part))} crop${F.cropCount(part) === 1 ? '' : 's'}`)), h('td', { colSpan: cols.length })));
      for (const row of part) {
        const many = row.varieties.length > 1 || (row.varieties.length === 1 && row.varieties[0].id), isOpen = opened.has(row.key);
        const name = h('td.hv-name', h('button.hv-crop', { type: 'button', disabled: !many, 'aria-expanded': many ? String(isOpen) : null, style: { '--crop': row.color }, title: many ? `${isOpen ? 'Hide' : 'Show'} the varieties` : row.name,
          onclick: () => { if (isOpen) opened.delete(row.key); else opened.add(row.key); render(); } }, h('span.caret', many ? (isOpen ? '▾' : '▸') : ''), h('i'), h('span', row.name), h('small', F.unitWord(2, row.unit, row.group) || 'each')),
          // more or less of it wanted: the series tool, asked from the harvest end, on this crop's own season
          plannable(row) && row.thing ? h('button.hv-plan', { type: 'button', dataset: { crop: row.cropId, thing: row.thing }, 'aria-label': `Plan ${row.name} to a weekly amount`, title: `Say how much of ${row.name} is wanted each week, and see the plantings that would give it`, onclick: () => App.openAhead({ mode: 'series', by: 'harvest', thing: row.thing, cropId: row.cropId }) }, 'plan…')
          : plannable(row) ? h('button.hv-plan', { type: 'button', dataset: { crop: row.cropId }, 'aria-label': `Plan ${row.name} to a weekly amount`, title: `Say how much ${row.name.toLowerCase()} is wanted each week, and see the plantings that would give it`, onclick: () => App.openAhead({ mode: 'series', by: 'harvest', cropId: row.cropId }) }, 'plan…') : null);
        // with stock carried in from the year before, the crop's line is the year's own and the carried stock is the line under it
        const carry = carries(m, row), cut = carry ? row.carriedTotal : 0, cutWorth = carry ? row.carriedWorth : 0;
        const whole = series === 'picked' && m.keeps ? row.pickedTotal : row.total - cut, worth = row.worth - cutWorth;
        const season = cash$ ? h('td.hv-total', { title: `${whole > 1e-9 ? F.amount(whole, row.unit, row.group) : '—'} to sell over the season` }, money(worth))
          : h('td.hv-total', { title: `${money(worth)} at its own price${row.keeps ? ` · keeps ${num(row.keeps, 1)} week${row.keeps === 1 ? '' : 's'} after picking` : ''}` }, whole > 1e-9 ? F.amount(whole, row.unit, row.group) : '—');
        const peak = Math.max(0, ...cols.map(c => F.sum(seriesOf(m, row), c.i0, c.i1)));
        body.push(line('.hv-row', name, season, ownOf(m, row), row, carry ? peak : null, row, carry ? 'own' : undefined));
        body[body.length - 1].dataset.crop = row.cropId;
        if (row.thing) body[body.length - 1].dataset.thing = row.thing;   // another thing the crop sells: a row of its own, in its own unit
        if (carry) {
          const from = `Carried in from ${(row.carriedFrom.length ? row.carriedFrom : [m.year - 1]).join(' and ')}`;
          body.push(line('.hv-var', h('td.hv-name', { title: `${row.name}: picked before Jan 1 and still to sell` }, from),
            h('td.hv-total', cash$ ? money(row.carriedWorth) : F.amount(row.carriedTotal, row.unit, row.group)), carriedOf(row), row, peak, row, 'carried'));
          Object.assign(body[body.length - 1].dataset, { hook: 'fc-carried', crop: row.cropId });
        }
        if (many && isOpen) {
          for (const v of row.varieties) { const vc = carries(m, v); body.push(line('.hv-var', h('td.hv-name', { title: v.name }, v.name), h('td.hv-total', cash$ ? money(v.worth - (vc ? v.carriedWorth : 0)) : F.amount(v.total - (vc ? v.carriedTotal : 0), row.unit, row.group)), ownOf(m, v), null, peak, row)); }
          if (g !== 'micro') body.push(h('tr.hv-var', h('td.hv-name', { colSpan: 2 }, 'Listed with ', h('button.linkish.hv-move', { type: 'button', onclick: () => moveCrop(row, g === 'flower' ? 'produce' : 'flower') }, `move to ${g === 'flower' ? 'vegetables' : 'flowers'}`)), h('td', { colSpan: cols.length })));
        }
      }
      // in dollars every kind adds up; in amounts trays add up, and so do stems, and pounds and heads and bunches do not
      if (cash$ ? part.length > 0 : g !== 'produce' && part.length > 1) {
        const all = new Float64Array(m.days); for (const r of part.filter(r => cash$ || g !== 'flower' || F.inStems(r))) { const src = seriesOf(m, r); for (let k = 0; k < m.days; k++) all[k] += src[k]; }
        const word = cash$ ? { produce: 'All vegetables', micro: 'All microgreens', flower: 'All flowers' }[g] : g === 'micro' ? 'All trays' : 'All stems';
        body.push(line('.hv-sum', h('td.hv-name', word), h('td.hv-total', cash$ ? money(part.reduce((n, r) => n + r.worth, 0)) : num(F.shown(F.sum(all, 0, m.days - 1)))), all, null));
        body[body.length - 1].dataset.hook = 'fc-kind-total';
        body[body.length - 1].dataset.group = g;
      }
    }
    // each week's worth, and the season's: in amounts and in dollars alike, the foot is in dollars
    const foot = plain('', h('td.hv-name', model().personal > 0 ? 'Worth of what is grown to sell' : 'Worth, at each crop’s own price'), h('td.hv-total', { dataset: { hook: 'fc-season-total' } }, money(rows.reduce((n, r) => n + r.worth, 0))), c => rows.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0));
    foot.dataset.hook = 'fc-week-totals';
    return h('div.hv-scroll' + (fit ? '.fit' : ''), { id: 'hvScroll', dataset: { hook: 'fc-scroll' } }, h('table.hv' + (fit ? '.fit' : ''), { id: 'hvTable', dataset: { hook: 'fc-table', measure, fit: fit ? 'season' : '' } }, h('thead', head), h('tbody', body), h('tfoot', foot)));
  }
  /** A crop the planner sorted wrongly is moved by hand, and stays moved. */
  function moveCrop(row, to) {
    const groups = { ...((App.state.plan.lrfNext || {}).groups || {}) };
    groups[row.cropId] = to;
    if (App.setOwn('groups', groups, `${row.name} listed with ${to === 'flower' ? 'flowers' : 'vegetables'}`)) UI.toast(`${row.name} is listed with ${to === 'flower' ? 'flowers' : 'vegetables'}.`, { label: 'Undo', run: App.undo });
  }
  // ── "?": what the page's paragraphs said, in the glossary's words (his notes of Nov 16, section 3) ──
  function lead(m, marked) {
    const b = text => h('b', text);
    return h('div.fc-lead', { id: 'hvLead', hidden: true, dataset: { hook: 'fc-lead' } },
      h('p', b('How the forecast is worked out'), h('br'), 'Amount = plants (or bed-feet, or trays) × marketable yield × sold share.'),
      h('p', b('When it lands'), ' follows each crop’s harvest pattern:', h('br'), 'Gradually: a week’s picking, every week of its harvest window.', h('br'), 'Clear: all of it on the day it is ready.', h('br'), 'On demand: spread evenly over its harvest window.'),
      h('p', 'Each crop is in the unit it is sold in. A live tray counts whole on the Monday it is due.'),
      h('p', b('Know this.'), ' Days to harvest are the same in every month, so an early or late planting is forecast as if it were midsummer. Read the ends of the season as optimistic.'),
      h('p', 'Change a figure under Assumptions › Yield and price. Click a figure to see its plantings.'),
      marked ? h('p.hv-note', { id: 'hvOwnNote' }, `${num(marked)} planting${marked === 1 ? ' is' : 's are'} marked for personal use. ${marked === 1 ? 'It is' : 'They are'} picked and counted like any other, ${m.use === 'commercial' ? 'and left out of this page while it shows Commercial' : m.use === 'personal' ? 'and this page shows only those' : 'so the quantities here include them'}; worth, and “A list to send…”, count only what is grown to sell.`) : null);
  }
  /** What "?" shows: the words kept unseen in the page, as they stand when it is opened. */
  function helpText() {
    const kept = $('hvLead');
    if (!kept) return null;
    const out = kept.cloneNode(true);
    out.hidden = false; out.removeAttribute('id'); out.dataset.hook = 'fc-help-text';
    for (const el of out.querySelectorAll('[id]')) el.removeAttribute('id');
    return out;
  }
  let helpBtn = null;
  function render() {
    if (!App.state.ready || App.state.view !== 'harvest') { dirty = true; return; }
    dirty = false;
    const everything = model(), marked = everything.personal, m = shownModel(), host = $('hvWrap'), keepTop = host.parentElement.scrollTop, keepLeft = $('hvScroll') ? $('hvScroll').scrollLeft : null, wk = thisWeek(m);
    const needle = query.trim().toLowerCase();
    const rows = m.rows.filter(r => r.total > 0 && (group === 'all' || r.group === group) && (!needle || r.name.toLowerCase().includes(needle) || r.varieties.some(v => v.name.toLowerCase().includes(needle))));
    const cols = columns(m);
    const seg = (value, label) => h('button', { type: 'button', 'aria-pressed': String(!fit && grain === value), dataset: { hvGrain: value }, onclick: () => { grain = value; fit = false; render(); } }, label);
    const chip = (value, label, n) => h('button.chip', { type: 'button', 'aria-pressed': String(group === value), dataset: { hvGroup: value }, onclick: () => { group = value; render(); } }, label, h('small', num(n)));
    const search = h('input', { type: 'search', id: 'hvSearch', placeholder: 'Find a crop', value: query, autocomplete: 'off', 'aria-label': 'Find a crop or variety' });
    search.addEventListener('input', () => { query = search.value; render(); const again = $('hvSearch'); again.focus(); again.setSelectionRange(query.length, query.length); });
    const noYield = m.unset.filter(u => u.why.startsWith('no yield'));
    if (!helpBtn) helpBtn = UI.help(helpText, () => $('hvWrap'), () => figNotes, { id: 'hvHelp', label: 'How the forecast is worked out' });
    helpBtn.dataset.hook = 'fc-help';
    UI.add(clear(host),
      // the title and "?", and beside them the two things done from the page: plan more of a crop, send what is there
      h('header.as-head.hv-head', h('div.hv-head-text', h('h2', { id: 'hvTitle', dataset: { hook: 'fc-title' } }, 'Forecast'), helpBtn, lead(m, marked)),
        h('div.hv-head-acts',
          root.LRFSeries ? h('button.btn', { type: 'button', id: 'hvPlanBar', title: 'Say how much of a crop is wanted each week: the planner says how many plantings, when and how large. It opens beside the timeline.', onclick: () => App.openAhead({ mode: 'series', by: 'harvest' }) }, 'Plan to a weekly amount…') : null,
          h('button.btn.primary', { type: 'button', id: 'hvShareBtn', onclick: share }, 'A list to send…'))),
      figures(m, noYield),
      h('div.hv-bar',
        h('span.tr-stepper', h('button.icon-btn', { type: 'button', 'aria-label': 'Back one week', id: 'hvPrev', onclick: () => App.setDate(E.addDays(App.state.date, -7)) }, '‹'),
          h('b', { id: 'hvWeek' }, `Week of ${day(wk.start)}`), h('button.icon-btn', { type: 'button', 'aria-label': 'Forward one week', id: 'hvNext', onclick: () => App.setDate(E.addDays(App.state.date, 7)) }, '›')),
        h('div.seg', { role: 'group', 'aria-label': 'Show by' }, seg('day', 'Days'), seg('week', 'Weeks'), seg('month', 'Months'),
          // the one press: every week of the season on the screen at once, each week's total under it and the season's beside
          h('button', { type: 'button', id: 'hvSeason', 'aria-pressed': String(fit), dataset: { hvGrain: 'season', hook: 'fc-season-btn' }, title: 'Every week of the season on one screen, with each week’s worth under it and the season’s total beside each crop', onclick: () => { fit = true; grain = 'week'; render(); } }, 'Whole season')),
        h('div.seg.fc-measure', { role: 'group', 'aria-label': 'Show as', dataset: { hook: 'fc-measure' } },
          [['amounts', 'Amounts', 'Each crop in the unit it is sold in'], ['dollars', 'Dollars', 'What each crop is worth, at its own price, with each kind’s total']].map(([value, label, title]) => h('button', { type: 'button', 'aria-pressed': String(measure === value), title, dataset: { measure: value }, onclick: () => { measure = value; render(); } }, label))),
        m.keeps ? h('div.seg.hv-series', { role: 'group', 'aria-label': 'What to count', hidden: dollars(), title: 'Some crops keep after picking. To sell: what is there to sell each week, drawn down over the weeks it keeps. Picked: what comes out of the ground.' },
          ['days', 'picked'].map(value => h('button', { type: 'button', 'aria-pressed': String(series === value), dataset: { hvSeries: value }, onclick: () => { series = value; render(); } }, value === 'days' ? 'To sell' : 'Picked'))) : null,
        marked ? h('div.seg.hv-use', { id: 'hvUse', role: 'group', 'aria-label': 'Grown for', title: 'Everything that is picked, only what is grown to sell, or only what is marked for personal use. Worth and the list to send count what is grown to sell.' },
          USES.map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(m.use === value), dataset: { hvUse: value }, onclick: () => { use = value; render(); } }, label))) : null,
        h('div.sd-filters', { role: 'group', 'aria-label': 'Which kinds' }, chip('all', 'All', F.cropCount(m.rows.filter(r => r.total > 0))), F.GROUPS.map(([g, short]) => chip(g, short, F.cropCount(m.rows.filter(r => r.total > 0 && r.group === g))))),
        h('span.grow'), search),
      !m.rows.some(r => r.total > 0) ? h('p.hv-empty', 'Nothing in this plan has a harvest to forecast yet.') : !rows.length ? h('p.hv-empty', 'No crop matches.') : table(m, cols, rows));
    host.parentElement.scrollTop = keepTop;
    const scroller = $('hvScroll'), at = fit ? 'season' : grain;
    if (scroller && fit) {
      scroller.scrollLeft = 0;
      // where even "1.2k" will not go in a column, the columns keep their shade and give their figure under the pointer
      const tbl = $('hvTable'), over = () => [...tbl.querySelectorAll('td.hv-c, tfoot td:not(.hv-name):not(.hv-total)')].some(td => td.scrollWidth > td.clientWidth + 1);
      tbl.classList.remove('bare');
      if (over()) tbl.classList.add('bare');
    } else if (scroller) {
      if (keepLeft != null && render.lastGrain === at) scroller.scrollLeft = keepLeft;
      else {   // the week in hand, three columns in, with a whole column against the crop names: never half of one
        const now = scroller.querySelector('thead th.now');
        if (now) { let first = now; for (let i = 0; i < 3 && first.previousElementSibling && first.previousElementSibling.dataset.col; i++) first = first.previousElementSibling; const edge = scroller.querySelector('thead .hv-total').getBoundingClientRect().right; scroller.scrollLeft = Math.max(0, scroller.scrollLeft + first.getBoundingClientRect().left - edge); }
      }
    }
    render.lastGrain = at;
  }
  function init() {
    App.on('plan', render); App.on('view', render); App.on('date', () => { if (App.state.view === 'harvest') render(); });
    // the whole season is fitted to the window as it is: a window made wider or narrower fits it again
    let soon = 0;
    root.addEventListener('resize', () => { if (!fit || App.state.view !== 'harvest') return; clearTimeout(soon); soon = setTimeout(render, 150); });
  }
  root.LRFHarvestView = { init, render, model, get dirty() { return dirty; }, series: () => series, use: () => (model().personal ? use : 'all'), setUse(value) { if (USES.some(u => u[0] === value)) { use = value; render(); } },
    tight, measure: () => measure, setMeasure(value) { if (value === 'amounts' || value === 'dollars') { measure = value; render(); } }, fitted: () => fit, setFit(on) { fit = !!on; if (fit) grain = 'week'; render(); } };
})(window);
