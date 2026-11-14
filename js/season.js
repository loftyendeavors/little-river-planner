/* Little River Farm Planner — the season ribbon.
 *
 * The planning date drives everything: the map shows that day, a dropped crop
 * is planted on that day. The ribbon is the date control, drawn over a chart
 * of how full the farm is week by week, with the frost dates marked.
 *
 * "Season…" on the ribbon opens the farm's dates (the two frost dates and the three days that bound
 * planting in open ground): the one place they are changed, with what a change does shown first.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine;
  const { s, h, clear } = UI;
  const $ = id => document.getElementById(id);
  let playing = null;

  const yearStart = () => new Date(App.planYear(), 0, 1);
  const yearDays = () => E.dayDiff(new Date(App.planYear(), 11, 31), yearStart()) + 1;
  const pct = d => (E.dayDiff(d, yearStart()) + 0.5) / yearDays() * 100;

  /** Share of growing spaces holding a crop, sampled weekly. */
  function occupancy() {
    const eng = App.state.engine, spaces = App.state.plan.beds.filter(b => b.active !== false && !eng.isPool(b)), out = [];
    for (let d = yearStart(), i = 0; i < 53; i++, d = E.addDays(d, 7)) {
      if (d.getFullYear() !== App.planYear()) break;
      let used = 0;
      for (const b of spaces) if (eng.cropsAt(b.id, d).length) used++;
      out.push({ d, share: spaces.length ? used / spaces.length : 0, used });
    }
    return out;
  }

  function drawChart() {
    if (!App.state.ready) return;
    const svg = clear($('seasonChart')), marks = clear($('seasonMarks')), W = 1000, H = 100, year = App.planYear();
    const series = occupancy(), x = d => (E.dayDiff(d, yearStart()) + 0.5) / yearDays() * W, y = v => H - 6 - v * (H - 14);
    if (series.length) {
      const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.share).toFixed(1)}`).join(' ');
      svg.append(s('path.season-area', { d: `${line} L${x(series[series.length - 1].d).toFixed(1)} ${H} L${x(series[0].d).toFixed(1)} ${H} Z` }),
        s('path.season-line', { d: line, 'vector-effect': 'non-scaling-stroke' }));
    }
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      marks.append(h('span.season-month', { style: { left: (E.dayDiff(first, yearStart()) / yearDays() * 100) + '%' } }, UI.MONTHS[m]));
    }
    const frost = App.state.engine.frostDates(year);
    for (const [d, label] of [[frost.last, 'last frost'], [frost.first, 'first frost']]) {
      if (E.validDate(d)) marks.append(h('span.season-frost' + (label === 'last frost' ? '.before' : ''), { dataset: { side: label === 'last frost' ? 'before' : 'after' }, style: { left: pct(d) + '%' }, title: `${label}: ${UI.day(d)}` }, h('i'), label));
    }
    const peak = series.reduce((a, p) => p.share > a.share ? p : a, { share: 0 });
    // in three parts, so a narrow strip can drop the middle and keep "Peak 94%" over "week of Jun 18"
    const say = clear($('seasonPeak'));
    if (peak.share) say.append(h('span', `Peak ${Math.round(peak.share * 100)}%`), h('span.mid', ' of spaces planted,'), h('span', ` week of ${UI.day(peak.d)}`)); else say.textContent = 'No plantings yet';
    say.title = peak.share ? `Peak ${Math.round(peak.share * 100)}% of spaces planted, week of ${UI.day(peak.d)}` : '';
    fit();
  }

  /**
   * The strip follows the room it has. In a narrow column the track drops under the date and takes the full
   * width, where its months stay readable; a frost label that would run off the end reads from the other side.
   */
  function fit() {
    const foot = document.querySelector('.season'), w = foot ? foot.clientWidth : 0;
    if (!w) return;
    foot.classList.toggle('stacked', w < 900 && w >= 600);
    foot.classList.toggle('slim', w < 600);
    // beside the date and its buttons the peak has what room is left: it drops its week, then itself, sooner than be cut off
    const peak = $('seasonPeak');
    foot.classList.remove('tight', 'bare');
    if (foot.classList.contains('stacked') && peak.scrollWidth > peak.clientWidth + 1) { foot.classList.add('tight'); if (peak.scrollWidth > peak.clientWidth + 1) foot.classList.add('bare'); }
    const track = $('seasonMarks').clientWidth;
    for (const el of document.querySelectorAll('.season-frost')) el.classList.toggle('before', el.dataset.side === 'before' || track * (1 - parseFloat(el.style.left) / 100) < el.offsetWidth + 6);
  }

  function drawDate() {
    if (!App.state.ready) return;
    const d = App.state.date;
    $('dateBig').textContent = UI.day(d);
    $('dateSub').textContent = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} · week ${UI.isoWeek(d)} · ${d.getFullYear()}`;
    $('datePick').value = E.d2s(d);
    $('datePick').min = `${App.planYear()}-01-01`; $('datePick').max = `${App.planYear()}-12-31`;
    const range = $('dateRange');
    range.max = yearDays() - 1; range.value = E.dayDiff(d, yearStart());
    range.setAttribute('aria-valuetext', UI.dayLong(d));
    $('seasonCursor').style.left = pct(d) + '%';
  }

  function stop() { clearInterval(playing); playing = null; $('datePlay').setAttribute('aria-pressed', 'false'); $('datePlay').textContent = 'Play season'; }
  function play() {
    if (playing) { stop(); return; }
    if (E.dayDiff(new Date(App.planYear(), 11, 31), App.state.date) < 7) App.setDate(new Date(App.planYear(), 2, 1));
    $('datePlay').setAttribute('aria-pressed', 'true'); $('datePlay').textContent = 'Pause';
    playing = setInterval(() => {
      const next = E.addDays(App.state.date, 7);
      if (next.getFullYear() !== App.planYear()) { stop(); return; }
      App.setDate(next);
    }, 380);
  }

  // ── "Season…": the farm's dates, changed with what the change does shown first (js/farmdates.js) ──
  const FD = root.LRFFarmDates;
  const plural = (n, one, many) => `${UI.num(n)} ${n === 1 ? one : many || one + 's'}`;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  /** The engine says days as 2027-05-15; a grower reads May 15. */
  const plainDays = text => String(text || '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y, m, d) => `${UI.MONTHS[+m - 1]} ${+d}`);
  let win = null;
  function openDates() {
    if (win || !App.state.ready) return;
    const start = App.farmDates(), year = start.year, draft = { ...start.dates }, inputs = {}, notes = {};
    const sum = h('div.fd-sum', { id: 'fdSum', 'aria-live': 'polite' });
    const apply = h('button.btn.primary', { type: 'button', id: 'fdApply', disabled: true }, 'Apply');
    const reset = h('button.btn.quiet', { type: 'button', id: 'fdReset', disabled: true, title: 'Put the five dates back as the plan has them' }, 'Back to the plan’s dates');
    const close = () => { if (!win) return; win = null; el.close(); el.remove(); };
    const cropName = (eng, id) => { const c = eng.crop(id); return c ? c.name : 'Crop'; };
    const more = (list, limit, line, rest) => [list.slice(0, limit).map(line), list.length > limit ? h('li.fd-more', rest(list.length - limit)) : null];

    function draw() {
      const view = App.farmDatesPreview(draft), keys = Object.keys(view.changed), eng = view.engine || App.state.engine;
      for (const f of FD.FIELDS) {
        const moved = draft[f.key] !== start.dates[f.key];
        inputs[f.key].closest('.fd-row').dataset.changed = String(moved);
        inputs[f.key].setAttribute('aria-invalid', String(view.errors.some(x => x.key === f.key)));
        notes[f.key].textContent = moved ? `was ${FD.word(start.dates[f.key])}` : '';
      }
      reset.disabled = !FD.KEYS.some(key => draft[key] !== start.dates[key]);
      apply.disabled = !!view.errors.length || !keys.length;
      clear(sum); sum.dataset.state = view.errors.length ? 'refused' : !keys.length ? 'idle' : view.same ? 'same' : 'moves';
      if (view.errors.length) { UI.add(sum, h('b.fd-head', { id: 'fdHead' }, 'These dates cannot stand'), h('ul.fd-errors', { id: 'fdErrors' }, view.errors.map(x => h('li', x.text))), h('p.fd-fine', 'Nothing is changed.')); return; }
      if (!keys.length) { UI.add(sum, h('b.fd-head', { id: 'fdHead' }, 'Nothing is changed'), h('p.fd-line', 'These are the dates the plan is worked out from now. Change one to see what it would do to the plan, before anything is changed.')); return; }
      const ids = new Set([...view.harvest, ...view.dates, ...view.out, ...view.yields].map(x => x.id)), worthMoved = Math.abs(view.worth[1] - view.worth[0]) >= 0.5;
      const fig = (label, value, marked, id) => h('span' + (marked ? '.bad' : ''), id ? { id } : {}, h('i', label), h('b', typeof value === 'number' ? UI.num(value) : value));
      const harvestLine = row => { const lo = Math.min(Math.abs(row.lo), Math.abs(row.hi)), hi = Math.max(Math.abs(row.lo), Math.abs(row.hi)), days = lo === hi ? plural(hi, 'day') : `${lo} to ${hi} days`; return h('li', h('b', cropName(eng, row.cropId)), ` ${plural(row.n, 'planting')}, harvest ends ${row.lo < 0 && row.hi > 0 ? days + ' either way' : row.hi > 0 ? days + ' later' : row.lo < 0 ? days + ' sooner' : 'on the same day; the ground is held to another day'}`); };
      const pairLine = ([a, b]) => { const p = eng.planting(a), q = eng.planting(b), bed = p && eng.bedOf(p.bedId); return h('li', `${bed ? App.bedLabel(bed) : 'A space'}: ${p ? App.cropLabel(p) : '?'} and ${q ? App.cropLabel(q) : '?'}`); };
      // one planting's reason is given whole; a crop's several plantings share the rule and each has its own day
      const whyLine = row => h('li', h('b', cropName(eng, row.cropId)), ` ${plural(row.n, 'planting')}`, row.why ? h('small', ` ${row.n === 1 ? plainDays(row.why) : plainDays(row.why).split(';')[0].replace(/\.$/, '') + '.'}`) : null);
      UI.add(sum,
        h('b.fd-head', { id: 'fdHead' }, ids.size ? `${plural(ids.size, 'planting')} would change` : 'No planting in the plan would change'),
        h('p.au-figs', { id: 'fdFigs' },
          fig('harvest ends moved', view.harvest.length, view.harvest.length > 0, 'fdHarvestN'),
          view.dates.length ? fig('sowing or planting days moved', view.dates.length, true, 'fdDatesN') : null,
          view.out.length ? fig('days of moving out moved', view.out.length, true, 'fdOutN') : null,
          fig('yields changed', view.yields.length, view.yields.length > 0, 'fdYieldN'),
          fig('new double bookings', view.ground.fresh.length, view.ground.fresh.length > 0, 'fdFreshN'),
          view.ground.settled.length ? fig('double bookings settled', view.ground.settled.length, false, 'fdSettledN') : null,
          h('span' + (worthMoved ? '.bad' : ''), { id: 'fdWorth', title: 'What the season’s harvest is worth at each crop’s price, before and after' }, h('i', 'season’s worth'), h('b', worthMoved ? `${money(view.worth[0])} → ${money(view.worth[1])}` : money(view.worth[0])))),
        view.harvest.length ? h('ul.fd-list', { id: 'fdHarvest' }, more(FD.byCrop(view.harvest), 8, harvestLine, n => `and ${plural(n, 'more crop')}`)) : null,
        view.ground.fresh.length ? h('ul.au-new', { id: 'fdNew' }, more(view.ground.fresh, 6, pairLine, n => `and ${UI.num(n)} more`)) : null,
        view.outside.length ? [h('p.fd-line', { id: 'fdOutsideSay' }, h('b', `${plural(view.outside.length, 'planting')} would stand outside these dates.`), ` ${view.outside.length === 1 ? 'It stays where it is' : 'They stay where they are'}: the planner moves nothing and flags nothing. It would not offer ${view.outside.length === 1 ? 'that place' : 'those places'} again.`),
          h('ul.fd-list.fd-why', { id: 'fdOutside' }, more(FD.byCrop(view.outside), 6, whyLine, n => `and ${plural(n, 'more crop')}`))] : null,
        view.inside.length ? h('p.fd-line', { id: 'fdInsideSay' }, h('b', `${plural(view.inside.length, 'planting')} that ${view.inside.length === 1 ? 'stands' : 'stand'} outside the dates today would be inside them.`)) : null,
        view.same ? h('p.fd-line', { id: 'fdSameSay' }, 'From here on the planner offers places by the new dates.') : null,
        h('p.fd-fine', `Only the date${keys.length === 1 ? ' is' : 's are'} written. No planting is touched, so setting ${keys.length === 1 ? 'it' : 'them'} back puts everything back, and one undo does the same.${view.ground.standing && view.ground.fresh.length ? ` The ${plural(view.ground.standing, 'pair')} already booked into the same ground ${view.ground.standing === 1 ? 'is' : 'are'} not counted as new.` : ''}`));
    }

    const row = f => {
      const input = h('input', { type: 'date', id: 'fd-' + f.key, min: `${year}-01-01`, max: `${year}-12-31`, value: `${year}-${draft[f.key]}`, dataset: { key: f.key },
        onchange: e => { const d = E.s2d(e.target.value); draft[f.key] = E.validDate(d) ? E.d2s(d).slice(5) : ''; draw(); } });
      inputs[f.key] = input; notes[f.key] = h('small.fd-was');
      return h('div.fd-row', { dataset: { key: f.key, changed: 'false' } }, h('label', { for: 'fd-' + f.key }, f.label), h('span.fd-set', input, notes[f.key]), h('p.fd-does', f.does));
    };
    const el = h('dialog.dialog.bk.fd', { id: 'seasonDlg', oncancel: e => { e.preventDefault(); close(); } },
      h('button.icon-btn.close', { type: 'button', id: 'fdClose', 'aria-label': 'Close', title: 'Close. Nothing is changed.', onclick: () => close() }, '×'),
      h('h2', `The season’s dates, ${year}`),
      h('p.dlg-lead', 'Five days of the year the plan is worked out from. Change one and what it does to the plan is shown below. Nothing changes until you press Apply.'),
      Object.entries(FD.GROUPS).map(([group, title]) => h('section.fd-group', { dataset: { group } }, h('h3', title), FD.FIELDS.filter(f => f.group === group).map(row))),
      h('p.fd-fine.fd-cover', 'A tunnel that still freezes counts the frost dates with its own days of protection added. A crop with a field day of its own keeps it.'),
      sum,
      h('div.dialog-actions', reset, h('span.grow'), h('button.btn', { type: 'button', id: 'fdCancel', onclick: () => close() }, 'Cancel'), apply));
    reset.addEventListener('click', () => { for (const key of FD.KEYS) { draft[key] = start.dates[key]; inputs[key].value = `${year}-${draft[key]}`; } draw(); });
    apply.addEventListener('click', () => { if (apply.disabled) return; if (App.setFarmDates(draft)) close(); else draw(); });
    win = { el, close, draw, draft };
    document.body.append(el); el.showModal(); draw();
  }

  function init() {
    $('dateRange').addEventListener('input', e => { if (playing) stop(); App.setDate(E.addDays(yearStart(), +e.target.value)); });
    $('datePick').addEventListener('change', e => { const d = E.s2d(e.target.value); if (E.validDate(d)) App.setDate(d); else drawDate(); });
    $('datePrev').addEventListener('click', () => App.setDate(E.addDays(App.state.date, -7)));
    $('dateNext').addEventListener('click', () => App.setDate(E.addDays(App.state.date, 7)));
    $('datePlay').addEventListener('click', play);
    $('seasonEdit').addEventListener('click', openDates);
    let pending = 0;
    App.on('plan', () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { drawChart(); drawDate(); }); });
    App.on('date', drawDate);
    if (root.ResizeObserver) new ResizeObserver(fit).observe(document.querySelector('.season'));
  }

  root.LRFSeason = { init, openDates, closeDates: () => { if (win) win.close(); } };
})(window);
