/* Little River Farm Planner — heated bench room, week by week.
 *
 * Seedling trays, tower seedlings, potted seedlings and live trays all stand on the heated benches.
 * This draws what they take each week against the room the benches hold: one column a week, stacked
 * by kind, at the week's fullest day. The load is shown, never enforced: nothing here moves a planting.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, T = root.LRFTrays;
  const { h, s, clear, num, day } = UI;
  const d = iso => E.s2d(iso);
  // In the order they are stacked. The colours are the chart palette's, validated as neighbours in this order.
  const KINDS = [['live', 'Live trays'], ['tray', 'Seedling trays'], ['rockwool', 'Tower seedlings'], ['pot', 'Potted seedlings'], ['crate', 'Sheltered crates']];
  const dayName = date => UI.dayLong(date).replace(/, \d{4}$/, '');
  let tipTimer = null;

  const cache = new WeakMap();
  /** For each week of the plan year with anything under cover: the fullest day on the benches, and the most live trays. */
  function figures(eng = App.state.engine) {
    if (cache.has(eng)) return cache.get(eng);
    const year = App.planYear(), weeks = new Map();
    let floorMost = 0, floorUntil = null;
    // the trays themselves: the most of each kind in use on one day
    const plugMost = new Map(), flats = { carriers: 0, carriersOn: null, live: 0, liveOn: null };
    for (let date = new Date(year, 0, 1), i = 0; i < 366 && date.getFullYear() === year; i++, date = E.addDays(date, 1)) {
      const row = eng.benchDay(date);
      if (row.floorCrates > floorMost) floorMost = row.floorCrates;
      if (row.floorCrates) floorUntil = E.addDays(date, 1);
      if (!row.total) continue;
      const use = eng.traysOn(date);
      for (const t of use.plug) { const was = plugMost.get(t.id); if (!was || t.n > was.n) plugMost.set(t.id, { ...t, on: new Date(date) }); }
      if (use.carriers > flats.carriers) { flats.carriers = use.carriers; flats.carriersOn = new Date(date); }
      if (use.live > flats.live) { flats.live = use.live; flats.liveOn = new Date(date); }
      const key = T.monday(E.d2s(date)), week = weeks.get(key) || { row: null, livePeak: 0 };
      if (!week.row || row.total > week.row.total) week.row = row;
      week.livePeak = Math.max(week.livePeak, row.live);
      weeks.set(key, week);
    }
    for (const week of weeks.values()) week.row.livePeak = week.livePeak;
    const keys = [...weeks.keys()].sort(), list = [];
    if (keys.length) for (let w = keys[0]; w <= keys[keys.length - 1]; w = T.add(w, 7)) list.push({ week: w, row: weeks.has(w) ? weeks.get(w).row : null });
    const tightest = list.reduce((a, b) => b.row && (!a || b.row.total - b.row.cap > a.row.total - a.row.cap) ? b : a, null);
    // a plan that lists no heated benches has no room to be over: the load is shown on its own
    const cap = eng.heatedTraySpaces();
    // live trays leave with the sale, so each one is an open tray that does not come back
    flats.sold = eng.benchItems().filter(it => it.kind === 'live' && it.r.first.getFullYear() === year).reduce((n, it) => n + it.n, 0);
    const out = { year, weeks: list, tightest: tightest && tightest.row, over: cap ? list.filter(w => w.row && w.row.over > 0.05) : [], cap, benches: eng.benchList(),
      plugMost: [...plugMost.values()].sort((a, b) => b.n - a.n), flats,
      onBenches: eng.cratesOnBenches, floorMost, floorUntil, kinds: KINDS.filter(([k]) => list.some(w => w.row && w.row[k] > 0)) };
    cache.set(eng, out);
    return out;
  }

  function chart(fig, tip) {
    const weeks = fig.weeks, W = 980, H = 240, M = { l: 40, r: 96, t: 16, b: 26 }, plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const top = Math.max(fig.cap, ...weeks.map(w => w.row ? w.row.total : 0)), step = top > 400 ? 200 : top > 160 ? 100 : top > 60 ? 50 : top > 20 ? 10 : 5, yMax = Math.ceil(top * 1.06 / step) * step;
    const band = plotW / weeks.length, barW = Math.max(3, Math.min(24, band - 3)), y = v => M.t + plotH - v / yMax * plotH, x = i => M.l + i * band + (band - barW) / 2;
    const isOver = row => fig.cap > 0 && row.over > 0.05, ofCap = fig.cap ? ` of ${num(fig.cap)}` : '';
    const svg = s('svg.bn-chart', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Tray spaces wanted under heat each week${fig.cap ? `, against the ${num(fig.cap)} the benches hold` : ''}. Arrow keys move between weeks.` });
    for (let v = 0; v <= yMax; v += step) svg.append(s('line.bn-grid', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }), s('text.bn-tick', { x: M.l - 7, y: y(v) + 3.5, 'text-anchor': 'end' }, num(v)));
    let month = -1;
    weeks.forEach((w, i) => { const m = d(w.week).getMonth(); if (m !== month && (i === 0 || d(w.week).getDate() <= 7)) { month = m; svg.append(s('text.bn-tick', { x: M.l + i * band, y: H - 8 }, UI.MONTHS[m])); } });
    const now = T.monday(E.d2s(App.state.date)), cols = [], start = Math.max(0, weeks.findIndex(w => w.week === now));
    weeks.forEach((w, i) => {
      // One stop for the keyboard: the planning week's column takes focus and the arrow keys walk the rest.
      const g = s('g.bn-col' + (w.week === now ? '.now' : ''), { tabindex: i === start ? 0 : -1, role: 'img', 'aria-label': w.row ? `Week of ${day(d(w.week))}: ${num(w.row.total, 1)}${ofCap} tray spaces in use${isOver(w.row) ? `, ${num(w.row.over, 1)} more than the benches hold` : ''}` : `Week of ${day(d(w.week))}: benches empty` });
      let base = 0;
      const parts = w.row ? KINDS.filter(([k]) => w.row[k] > 0) : [];
      parts.forEach(([k], n) => {
        const y1 = y(base + w.row[k]), y0 = y(base), last = n === parts.length - 1, ht = Math.max(1, y0 - y1 - (n ? 2 : 0)), r = last ? Math.min(4, barW / 2, ht) : 0, left = x(i), bottom = y1 + ht;
        // a 2px gap of surface between segments; only the top of the column is rounded
        g.append(s('path.bn-seg', { 'data-kind': k, d: `M${left},${bottom}V${y1 + r}Q${left},${y1} ${left + r},${y1}H${left + barW - r}Q${left + barW},${y1} ${left + barW},${y1 + r}V${bottom}Z` }));
        base += w.row[k];
      });
      if (w.row && isOver(w.row)) g.append(s('text.bn-over', { x: x(i) + barW / 2, y: y(w.row.total) - 5, 'text-anchor': 'middle' }, '▲'));
      g.append(s('rect.bn-hit', { x: M.l + i * band, y: M.t, width: band, height: plotH }));
      const show = () => {
        clearTimeout(tipTimer);
        clear(tip).append(h('b', `Week of ${day(d(w.week))}`), h('small', w.row ? `fullest on ${dayName(w.row.date)}` : 'benches empty'));
        if (w.row) {
          for (const [k, label] of KINDS) if (w.row[k] > 0) tip.append(h('span.bn-tip-row', h('i', { 'data-kind': k }), h('strong', num(w.row[k], 1)), label));
          tip.append(h('span.bn-tip-row.total', h('i'), h('strong', num(w.row.total, 1)), fig.cap ? `of ${num(w.row.cap)} tray spaces` : 'tray spaces'),
            !fig.cap ? null : isOver(w.row) ? h('span.bn-tip-over', `▲ ${num(w.row.over, 1)} more than the benches hold`) : h('span.bn-tip-room', `${num(w.row.cap - w.row.total, 1)} free`));
          if (w.row.floorCrates) tip.append(h('span.bn-tip-room', `${num(w.row.floorCrates)} sheltered crates on the floor`));
        }
        const box = svg.getBoundingClientRect(), host = svg.parentElement.getBoundingClientRect(), cx = box.left - host.left + (M.l + (i + 0.5) * band) / W * box.width;
        tip.hidden = false;
        tip.style.left = Math.max(4, Math.min(host.width - tip.offsetWidth - 4, cx + 14 + tip.offsetWidth > host.width ? cx - tip.offsetWidth - 14 : cx + 14)) + 'px';
        tip.style.top = '8px';
      };
      const hide = () => { tipTimer = setTimeout(() => { tip.hidden = true; }, 80); };
      g.addEventListener('pointerenter', show); g.addEventListener('pointerleave', hide); g.addEventListener('focus', show); g.addEventListener('blur', hide);
      g.addEventListener('click', () => App.setDate(d(w.week)));
      g.addEventListener('keydown', e => {
        const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? weeks.length - 1 : -1;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.setDate(d(w.week)); return; }
        if (to < 0 || to >= weeks.length) return;
        e.preventDefault(); g.setAttribute('tabindex', -1); cols[to].setAttribute('tabindex', 0); cols[to].focus();
      });
      cols.push(g); svg.append(g);
    });
    // what the benches hold: a line across, named at its end
    if (fig.cap) svg.append(s('line.bn-cap', { x1: M.l, x2: W - M.r + 4, y1: y(fig.cap), y2: y(fig.cap) }), s('text.bn-cap-label', { x: W - M.r + 8, y: y(fig.cap) - 3 }, `${num(fig.cap)} spaces`), s('text.bn-tick', { x: W - M.r + 8, y: y(fig.cap) + 10 }, 'benches hold'));
    return svg;
  }

  /** The whole section: a sentence that reads the chart, its legend, the chart, and where the crates stand. */
  function section(title = 'Heated bench room') {
    const fig = figures(), t = fig.tightest, tip = h('div.bn-tip', { hidden: true, role: 'status' });
    const share = k => t && t.total ? Math.round(t[k] / t.total * 100) : 0;
    const reading = !fig.weeks.length ? 'Nothing in this plan stands on a heated bench.'
      : !fig.cap ? `This plan lists no heated benches, so there is no room to measure against. The most wanted on one day is ${num(t.total, 1)} tray spaces, on ${dayName(t.date)}.`
      : fig.over.length ? `The benches are over in ${num(fig.over.length)} week${fig.over.length === 1 ? '' : 's'}, worst on ${dayName(t.date)}: ${num(t.total, 1)} tray spaces wanted, ${num(t.cap)} there${t.live ? `. Live trays are ${share('live')}% of that day’s load` : ''}.`
      : `Room to spare all season. The fullest day is ${dayName(t.date)}: ${num(t.total, 1)} of ${num(t.cap)} tray spaces.`;
    const areas = new Map();
    for (const b of fig.benches) { if (!b.active || !b.heated) continue; const key = b.area || 'Other heated benches', row = areas.get(key) || { benches: 0, cap: 0 }; row.benches++; row.cap += b.cap; areas.set(key, row); }
    const crates = fig.onBenches
      ? h('p.bn-crates', 'Sheltered crates are counted as standing on the benches, the way v7 counts them. ', h('button.linkish', { type: 'button', onclick: () => App.setOwn('crates', null, 'Sheltered crates stand on the floor') }, 'They stand on the floor'))
      : fig.floorMost ? h('p.bn-crates', `Up to ${num(fig.floorMost)} crates are sheltered under heat${fig.floorUntil ? ` until ${day(fig.floorUntil)}` : ''}. They stand on the floor and take no bench room. `, h('button.linkish', { type: 'button', onclick: () => App.setOwn('crates', 'bench', 'Count sheltered crates on the benches') }, 'Count them on the benches instead')) : null;
    const eng = App.state.engine, apart = eng.shareTrays === false;
    const sharing = eng.sowingBatches().length ? h('p.bn-share', apart ? 'Every variety is counted in trays of its own, the way v7 counts them. ' : 'Varieties of one crop sown the same day share trays, each in whole rows. Tower crops sown the same day share rockwool sheets, whatever the crop. ',
      h('button.linkish', { type: 'button', onclick: () => App.setOwn('trays', apart ? null : 'variety', apart ? 'Varieties of one crop share trays' : 'Every variety in trays of its own') }, apart ? 'Let varieties of one crop share trays' : 'Count every variety in trays of its own')) : null;
    // The trays themselves. A rockwool sheet rides in an open 10 × 20 tray; a live tray is one, and leaves with the sale.
    const plugText = fig.plugMost.map(t => `${num(t.n)} × ${t.name.replace(/ plug tray$/, '')}`).join(', '), fl = fig.flats;
    const openText = [fl.carriers ? `up to ${num(fl.carriers)} at once under rockwool sheets` : '', fl.sold ? `${num(fl.sold)} go out with live trays over the season (${num(fl.live)} on the benches at the most)` : ''].filter(Boolean).join('; ');
    const traysLine = plugText || openText ? h('p.bn-trays', { id: 'bnTrays' }, h('b', 'Trays in use. '), plugText ? `Plug trays at the most on one day: ${plugText}. ` : '', openText ? `Open 10 × 20 trays: ${openText}.` : '') : null;
    return h('section.bn', h('h3', title), h('p.bn-note', reading),
      fig.weeks.length ? h('div.bn-legend', { 'aria-label': 'What the colours stand for' }, fig.kinds.map(([k, label]) => h('span', h('i', { 'data-kind': k }), label))) : null,
      fig.weeks.length ? h('div.bn-chart-wrap', chart(fig, tip), tip) : null,
      traysLine, crates, sharing,
      h('p.bn-note.small', `${areas.size ? [...areas].map(([name, a]) => `${name}: ${num(a.benches)} benches, ${num(a.cap)} tray spaces`).join(' · ') + '. Room' : 'Benches come in with a v7 backup. Their room'} is bench area × ${num((App.state.plan.nursery || {}).packing || 85)}% packing ÷ one 10 × 20 tray, as v7 counts it.`));
  }

  root.LRFBench = { figures, section, KINDS };
})(window);
