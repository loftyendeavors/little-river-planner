/* Little River Farm Planner — the season ribbon.
 *
 * The planning date drives everything: the map shows that day, a dropped crop
 * is planted on that day. The ribbon is the date control, drawn over a chart
 * of how full the farm is week by week, with the frost dates marked.
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

  function init() {
    $('dateRange').addEventListener('input', e => { if (playing) stop(); App.setDate(E.addDays(yearStart(), +e.target.value)); });
    $('datePick').addEventListener('change', e => { const d = E.s2d(e.target.value); if (E.validDate(d)) App.setDate(d); else drawDate(); });
    $('datePrev').addEventListener('click', () => App.setDate(E.addDays(App.state.date, -7)));
    $('dateNext').addEventListener('click', () => App.setDate(E.addDays(App.state.date, 7)));
    $('datePlay').addEventListener('click', play);
    let pending = 0;
    App.on('plan', () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { drawChart(); drawDate(); }); });
    App.on('date', drawDate);
    if (root.ResizeObserver) new ResizeObserver(fit).observe(document.querySelector('.season'));
  }

  root.LRFSeason = { init };
})(window);
