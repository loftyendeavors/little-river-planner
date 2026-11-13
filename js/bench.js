/* Little River Farm Planner — the benches: their room week by week, the benches themselves, and what a season uses.
 *
 * Seedling trays, tower seedlings, potted seedlings and live trays stand under heat; from the day they start
 * hardening off, seedlings stand outside where there is a bench for them. Each kind of bench with room or with
 * anything on it gets a chart: one column a week, stacked by what stands there, at that kind's fullest day.
 * The load is shown, never enforced: nothing here moves a planting.
 *
 * The benches are edited in place, in the section that draws them. Every change is one step and can be undone.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, T = root.LRFTrays, N = root.LRFNursery;
  const { h, s, clear, num, day } = UI;
  const d = iso => E.s2d(iso);
  // In the order they are stacked. The colours are the chart palette's, validated as neighbours in this order.
  const KINDS = [['live', 'Live trays'], ['tray', 'Seedling trays'], ['rockwool', 'Tower seedlings'], ['pot', 'Potted seedlings'], ['crate', 'Sheltered crates']];
  const POOL_WORD = { heated: 'under heat', unheated: 'on unheated benches', outside: 'outside' };
  const dayName = date => UI.dayLong(date).replace(/, \d{4}$/, '');
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  let tipTimer = null, editing = false, refocus = null, newHouse = null;

  const cache = new WeakMap();
  /** The season on the benches (LRFNursery.season), worked out once per plan state, with the kinds of thing that stand there. */
  function figures(eng = App.state.engine) {
    if (cache.has(eng)) return cache.get(eng);
    const fig = N.season(eng, App.planYear());
    fig.kinds = KINDS.filter(([k]) => fig.weeks.some(w => w.row && w.row[k] > 0));
    cache.set(eng, fig);
    return fig;
  }

  /** One kind of bench through the season. */
  function chart(fig, kind, tip) {
    const pool = fig.pools[kind], main = kind === 'heated', weeks = fig.weeks, W = 980, H = main ? 240 : 150, M = { l: 40, r: 96, t: 16, b: 26 }, plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const at = w => (w.pools ? w.pools[kind] : null), filled = p => !!p && p.used > 1e-9;
    const top = Math.max(pool.cap, ...weeks.map(w => (at(w) ? Math.max(at(w).used, at(w).cap) : 0))), step = top > 400 ? 200 : top > 160 ? 100 : top > 60 ? 50 : top > 20 ? 10 : 5, yMax = Math.max(step, Math.ceil(top * 1.06 / step) * step);
    const band = plotW / weeks.length, barW = Math.max(3, Math.min(24, band - 3)), y = v => M.t + plotH - v / yMax * plotH, x = i => M.l + i * band + (band - barW) / 2;
    const isOver = p => p.cap > 0 && p.over > 0.05;
    const svg = s('svg.bn-chart', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'data-pool': kind, 'aria-label': `Tray spaces wanted ${POOL_WORD[kind]} each week${pool.cap ? `, against the ${num(pool.cap)} those benches hold` : ''}. Arrow keys move between weeks.` });
    for (let v = 0; v <= yMax; v += step) svg.append(s('line.bn-grid', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }), s('text.bn-tick', { x: M.l - 7, y: y(v) + 3.5, 'text-anchor': 'end' }, num(v)));
    let month = -1;
    weeks.forEach((w, i) => { const m = d(w.week).getMonth(); if (m !== month && (i === 0 || d(w.week).getDate() <= 7)) { month = m; svg.append(s('text.bn-tick', { x: M.l + i * band, y: H - 8 }, UI.MONTHS[m])); } });
    const now = T.monday(E.d2s(App.state.date)), cols = [], start = Math.max(0, weeks.findIndex(w => w.week === now));
    weeks.forEach((w, i) => {
      const p = at(w), on = filled(p), ofCap = on && p.cap ? ` of ${num(p.cap)}` : '';
      // One stop for the keyboard: the planning week's column takes focus and the arrow keys walk the rest.
      const g = s('g.bn-col' + (w.week === now ? '.now' : ''), { tabindex: i === start ? 0 : -1, role: 'img', 'aria-label': on ? `Week of ${day(d(w.week))}: ${num(p.used, 1)}${ofCap} tray spaces in use${isOver(p) ? `, ${num(p.over, 1)} more than the benches hold` : ''}` : `Week of ${day(d(w.week))}: benches empty` });
      let base = 0;
      const parts = on ? KINDS.filter(([k]) => p[k] > 1e-9) : [];
      parts.forEach(([k], n) => {
        const y1 = y(base + p[k]), y0 = y(base), last = n === parts.length - 1, ht = Math.max(1, y0 - y1 - (n ? 2 : 0)), r = last ? Math.min(4, barW / 2, ht) : 0, left = x(i), bottom = y1 + ht;
        // a 2px gap of surface between segments; only the top of the column is rounded
        g.append(s('path.bn-seg', { 'data-kind': k, d: `M${left},${bottom}V${y1 + r}Q${left},${y1} ${left + r},${y1}H${left + barW - r}Q${left + barW},${y1} ${left + barW},${y1 + r}V${bottom}Z` }));
        base += p[k];
      });
      if (on && isOver(p)) g.append(s('text.bn-over', { x: x(i) + barW / 2, y: y(p.used) - 5, 'text-anchor': 'middle' }, '▲'));
      g.append(s('rect.bn-hit', { x: M.l + i * band, y: M.t, width: band, height: plotH }));
      const show = () => {
        clearTimeout(tipTimer);
        clear(tip).append(h('b', `Week of ${day(d(w.week))}`), h('small', on ? `fullest on ${dayName(p.date)}` : 'benches empty'));
        if (on) {
          for (const [k, label] of KINDS) if (p[k] > 1e-9) tip.append(h('span.bn-tip-row', h('i', { 'data-kind': k }), h('strong', num(p[k], 1)), label));
          tip.append(h('span.bn-tip-row.total', h('i'), h('strong', num(p.used, 1)), p.cap ? `of ${num(p.cap)} tray spaces` : 'tray spaces'),
            !p.cap ? null : isOver(p) ? h('span.bn-tip-over', `▲ ${num(p.over, 1)} more than the benches hold`) : h('span.bn-tip-room', `${num(p.cap - p.used, 1)} free`));
        }
        if (main && w.row && w.row.floorCrates) tip.append(h('span.bn-tip-room', `${num(w.row.floorCrates)} sheltered crates on the floor`));
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
    if (pool.cap) svg.append(s('line.bn-cap', { x1: M.l, x2: W - M.r + 4, y1: y(pool.cap), y2: y(pool.cap) }), s('text.bn-cap-label', { x: W - M.r + 8, y: y(pool.cap) - 3 }, `${num(pool.cap)} spaces`), s('text.bn-tick', { x: W - M.r + 8, y: y(pool.cap) + 10 }, 'benches hold'));
    return svg;
  }

  // ── what the season reads as, one line for each kind of bench ──
  function poolLine(fig, kind) {
    const pool = fig.pools[kind], t = pool.tightest, benches = pool.benches ? `${plural(pool.benches, 'bench', 'benches')} · ${num(pool.cap)} tray spaces` : 'no bench listed';
    const share = k => (t && t.used ? Math.round(t[k] / t.used * 100) : 0);
    let reading, state = '';
    if (!t || !(t.used > 1e-9)) reading = 'Nothing stands here this season.';
    else if (!pool.cap) reading = `No room to measure against. The most wanted on one day is ${num(t.used, 1)} tray spaces, on ${dayName(t.date)}.`;
    else if (pool.over.length) { state = 'over'; reading = `Over in ${plural(pool.over.length, 'week')}, worst on ${dayName(t.date)}: ${num(t.used, 1)} tray spaces wanted, ${num(t.cap)} there${kind === 'heated' && t.live ? `. Live trays are ${share('live')}% of that day’s load` : ''}.`; }
    else if (t.cap - t.used < 0.05) { state = 'full'; reading = `Full at its fullest, on ${dayName(t.date)}: ${num(t.used, 1)} of ${num(t.cap)} tray spaces${kind === 'heated' ? '' : '. What does not fit stays further in'}.`; }
    else { state = 'ok'; reading = `Room to spare all season. The fullest day is ${dayName(t.date)}: ${num(t.used, 1)} of ${num(t.cap)} tray spaces.`; }
    return h('li', { dataset: { pool: kind, state } }, h('b', N.kindName(kind)), h('span.bn-pool-room', benches), h('span.bn-pool-reading', reading));
  }
  /** Hardening off: how long, how much at the most, and where it stands. */
  function hardenLine(fig) {
    const hd = fig.hardening, days = fig.hardenDays;
    if (!days) return h('li', { dataset: { pool: 'harden' } }, h('b', 'Hardening off'), h('span.bn-pool-room', 'not planned'), h('span.bn-pool-reading', 'Seedlings stay under cover until they are planted. Set the days under Benches.'));
    if (!(hd.most > 1e-9)) return null;
    const out = fig.room.outside, cool = fig.room.unheated;
    const where = !out && !cool ? 'No bench is listed outside, so they are counted under heat until they are planted.'
      : hd.inside > 0.05 ? `The benches ${out ? 'outside' : 'without heat'} take what they hold; up to ${num(hd.inside, 1)} tray spaces stay under cover (${dayName(hd.insideOn)}).`
      : `The benches outside take all of it.`;
    return h('li', { dataset: { pool: 'harden' } }, h('b', 'Hardening off'), h('span.bn-pool-room', `${plural(days, 'day')} before planting out`), h('span.bn-pool-reading', `Up to ${num(hd.most, 1)} tray spaces at once, on ${dayName(hd.on)}. ${where}`));
  }

  // ── the benches themselves, edited in place ──
  const roomText = r => N.KIND_IDS.filter(k => r.was[k] !== r.now[k]).map(k => `${N.kindName(k).toLowerCase()} ${num(r.was[k])} → ${num(r.now[k])} tray spaces`).join(' · ');
  /** Make one change, say what it did to the room, and come back to the field it was made in. */
  function change(label, edit, focus) {
    refocus = focus || null;
    const done = App.editNursery(label, edit);
    if (!done) { refocus = null; App.emit('nursery'); return null; }
    if (done.unchanged) { refocus = null; return done; }
    const room = roomText(done);
    UI.toast(room ? `${label} · ${room}` : label, { label: 'Undo', run: App.undo });
    return done;
  }
  function editor(fig) {
    const nursery = App.state.plan.nursery || {}, benches = fig.benches, shared = N.sharedNames(benches.filter(b => b.active)), areas = (nursery.benchAreas || []).filter(a => a && a.id);
    const packing = Math.round(+nursery.packing > 0 ? +nursery.packing : 85);
    const field = (b, f, input) => { input.dataset.f = f; return input; };
    const text = (b, i) => {
      const input = h('input.bn-name', { type: 'text', value: b.name, maxLength: 60, 'aria-label': `Bench ${i + 1}: name` });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = b.name; input.blur(); } });
      input.addEventListener('change', () => { if (input.value.trim() === b.name) { input.value = b.name; return; } if (!change(`${b.name} renamed ${input.value.trim() || '…'}`, n => N.setBench(n, b.id, { name: input.value }), [b.id, 'name'])) input.value = b.name; });
      return field(b, 'name', input);
    };
    const number = (b, i, f, value, label, what, extra = {}) => {
      const input = h('input.tr-n', { type: 'number', min: extra.min == null ? 0.5 : extra.min, max: extra.max || 300, step: extra.step || 0.25, value: value == null ? '' : value, placeholder: extra.placeholder || '', 'aria-label': `Bench ${i + 1}: ${label}`, inputMode: 'decimal' });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = value == null ? '' : value; input.blur(); } });
      input.addEventListener('change', () => { const typed = input.value.trim(); if (typed === String(value == null ? '' : value)) return; if (!change(`${b.name}: ${what(typed)}`, n => N.setBench(n, b.id, { [f]: typed }), [b.id, f])) input.value = value == null ? '' : value; });
      return field(b, f, input);
    };
    const body = h('tbody');
    benches.forEach((b, i) => {
      const house = h('select.bn-house', { 'aria-label': `Bench ${i + 1}: house` }, h('option', { value: '' }, 'No house'), areas.map(a => h('option', { value: a.id, selected: a.id === b.areaId }, a.name || 'House')), h('option', { value: '+' }, 'New house…'));
      house.addEventListener('change', () => {
        if (house.value === '+') { newHouse = b.id; refocus = [b.id, 'house-name']; App.emit('nursery'); return; }
        const name = house.value ? (areas.find(a => a.id === house.value) || {}).name : '';
        change(`${b.name} ${name ? 'stands in ' + name : 'stands in no house'}`, n => N.setBench(n, b.id, { areaId: house.value }), [b.id, 'house']);
      });
      // a new house is named where the bench is, and Escape or × leaves the bench where it was
      const naming = newHouse === b.id ? (() => {
        const input = h('input.bn-name', { type: 'text', maxLength: 60, placeholder: 'Name of the house', 'aria-label': `Bench ${i + 1}: name of the new house`, dataset: { f: 'house-name' } });
        const leave = () => { newHouse = null; refocus = [b.id, 'house']; App.emit('nursery'); };
        const save = () => { const name = input.value.trim(); if (!name) { leave(); return; } newHouse = null; if (!change(`${b.name} stands in ${name}`, n => { const made = N.addArea(n, name, App.uid); return N.setBench(made.nursery, b.id, { areaId: made.id }); }, [b.id, 'house'])) App.emit('nursery'); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.stopPropagation(); leave(); } });
        return h('span.bn-newhouse', input, h('button.btn.small', { type: 'button', onclick: save }, 'Add'), h('button.icon-btn', { type: 'button', 'aria-label': 'Leave the house as it was', title: 'Leave the house as it was', onclick: leave }, '×'));
      })() : null;
      const kind = h('select.bn-kind', { 'aria-label': `Bench ${i + 1}: kind` }, N.KINDS.map(([k, label]) => h('option', { value: k, selected: k === b.kind }, label)));
      kind.addEventListener('change', () => change(`${b.name} is ${kind.value === 'outside' ? 'outside' : kind.value === 'unheated' ? 'under cover without heat' : 'under heat'}`, n => N.setBench(n, b.id, { kind: kind.value }), [b.id, 'kind']));
      const use = h('input', { type: 'checkbox', checked: b.active, 'aria-label': `Bench ${i + 1}: in use` });
      use.addEventListener('change', () => change(`${b.name} ${use.checked ? 'is in use' : 'is out of use'}`, n => N.setBench(n, b.id, { active: use.checked }), [b.id, 'active']));
      const move = (by, label, glyph) => h('button.icon-btn.bn-move', { type: 'button', disabled: by < 0 ? i === 0 : i === benches.length - 1, 'aria-label': `Move ${b.name} ${label}`, title: `Move ${label}`, dataset: { f: by < 0 ? 'up' : 'down' }, onclick: () => change(`${b.name} moved ${label}`, n => N.moveBench(n, b.id, by), [b.id, by < 0 ? 'up' : 'down']) }, glyph);
      body.append(h('tr' + (b.active ? '' : '.off'), { dataset: { bench: b.id, kind: b.kind } },
        h('td', text(b, i), b.active && shared.has(b.name.trim().toLowerCase()) ? h('small.bn-same', 'another bench has this name') : null),
        h('td', naming || field(b, 'house', house)),
        h('td', field(b, 'kind', kind)),
        h('td', number(b, i, 'w', b.w, 'width in feet', v => `${v} ft wide`)),
        h('td', number(b, i, 'l', b.l, 'length in feet', v => `${v} ft long`)),
        h('td.bn-holds', number(b, i, 'holds', b.holds, 'trays it holds', v => (v === '' ? `holds what its area gives, ${num(b.estimate)}` : `holds ${v} trays`), { min: 0, max: 5000, step: 1, placeholder: num(b.estimate) }),
          b.holds != null ? h('small', `area gives ${num(b.estimate)}`) : null),
        h('td.bn-use', field(b, 'active', use)),
        h('td.bn-tools', move(-1, 'up', '↑'), move(1, 'down', '↓'),
          h('button.tr-x', { type: 'button', 'aria-label': `Remove ${b.name}`, title: `Remove ${b.name}`, dataset: { f: 'remove' }, onclick: () => change(`${b.name} removed`, n => N.removeBench(n, b.id), null) }, '×'))));
    });
    const option = (id, value, label, unit, f, what, lo, hi) => {
      const input = h('input.tr-n', { id, type: 'number', min: lo, max: hi, step: 1, value, 'aria-label': label, inputMode: 'numeric' });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = value; input.blur(); } });
      input.addEventListener('change', () => { if (+input.value === value && input.value.trim() !== '') return; if (!change(what(input.value), n => N.setOptions(n, { [f]: input.value.trim() === '' ? NaN : +input.value }), ['', id])) input.value = value; });
      input.dataset.f = id;
      return h('label.bn-opt', h('span', label), input, h('small', unit));
    };
    const close = () => { editing = false; newHouse = null; refocus = ['', 'bnEdit']; App.emit('nursery'); };
    const box = h('div.bn-edit', { id: 'bnEditor', role: 'group', 'aria-label': 'The benches' },
      h('div.bn-edit-head', h('h4', 'Benches'), h('p', `A bench holds its area × ${num(packing)}% ÷ one 10 × 20 tray, unless you say what it holds.`),
        h('button.icon-btn', { type: 'button', id: 'bnEditClose', 'aria-label': 'Close the benches', title: 'Close (Esc)', onclick: close }, '×')),
      benches.length ? h('div.tr-scroll', h('table.as.bn-benches', h('thead', h('tr', h('th', 'Bench'), h('th', 'House'), h('th', 'Kind'), h('th', 'Wide, ft'), h('th', 'Long, ft'), h('th', { title: 'Trays the bench takes. Empty: what its area gives.' }, 'Holds'), h('th', { title: 'A bench out of use holds nothing' }, 'In use'), h('th', ''))), body))
        : h('p.bn-note', 'No benches yet. Add the first: its size can be changed afterwards.'),
      h('div.bn-edit-foot',
        h('button.btn', { type: 'button', id: 'bnAdd', onclick: () => { const done = change('Bench added', n => N.addBench(n, { uid: App.uid }), null); if (done && done.bench) { refocus = [done.bench.id, 'name']; App.emit('nursery'); } } }, '+ Add a bench'),
        option('bnPacking', packing, 'Share of a bench that takes trays', '%', 'packing', v => `${v}% of a bench takes trays`, 30, 100),
        option('bnHarden', fig.hardenDays, 'Hardening off', 'days before planting out', 'harden', v => `Hardening off starts ${v} days before planting out`, 0, 21)));
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    return box;
  }

  /** The whole section: a line for each kind of bench, the charts, the benches when they are open, and where the crates stand. */
  function section(title = 'Bench room') {
    const fig = figures(), eng = App.state.engine, apart = eng.shareTrays === false, SHEET = root.LRFSowing.ROCKWOOL_SHEET;
    const lines = fig.shown.map(k => poolLine(fig, k)), harden = fig.weeks.length ? hardenLine(fig) : null;
    const charts = fig.weeks.length ? fig.shown.map(kind => { const tip = h('div.bn-tip', { hidden: true, role: 'status' }); return h('div.bn-pool', { dataset: { pool: kind } }, fig.shown.length > 1 ? h('h4', N.kindName(kind)) : null, h('div.bn-chart-wrap', chart(fig, kind, tip), tip)); }) : [];
    const areas = new Map();
    for (const b of fig.benches) { if (!b.active) continue; const key = b.area || 'In no house', row = areas.get(key) || { benches: 0, cap: 0 }; row.benches++; row.cap += b.cap; areas.set(key, row); }
    const crates = fig.onBenches
      ? ['Sheltered crates are counted as standing on the benches, the way v7 counts them. ', h('button.linkish', { type: 'button', onclick: () => App.setOwn('crates', null, 'Sheltered crates stand on the floor') }, 'They stand on the floor')]
      : fig.floorMost ? [`Up to ${num(fig.floorMost)} are sheltered under heat${fig.floorUntil ? ` until ${day(fig.floorUntil)}` : ''}. They stand on the floor and take no bench room. `, h('button.linkish', { type: 'button', onclick: () => App.setOwn('crates', 'bench', 'Count sheltered crates on the benches') }, 'Count them on the benches instead')] : null;
    const sharing = eng.sowingBatches().length ? [apart ? 'Every variety is counted in trays of its own, the way v7 counts them. ' : `Varieties of one crop sown the same day share trays, each in whole rows. Tower crops sown the same day share rockwool sheets (${SHEET.cells} cells, ${SHEET.rows} rows of ${SHEET.columns}), whatever the crop. `,
      h('button.linkish', { type: 'button', onclick: () => App.setOwn('trays', apart ? null : 'variety', apart ? 'Varieties of one crop share trays' : 'Every variety in trays of its own') }, apart ? 'Let varieties of one crop share trays' : 'Count every variety in trays of its own')] : null;
    const open = h('button.btn.small', { type: 'button', id: 'bnEdit', 'aria-expanded': String(editing), 'aria-controls': 'bnEditor', dataset: { f: 'bnEdit' }, onclick: () => { editing = !editing; newHouse = null; refocus = editing ? null : ['', 'bnEdit']; App.emit('nursery'); } }, editing ? 'Close the benches' : fig.benches.length ? 'Benches…' : 'Add benches…');
    const node = h('section.bn', h('div.bn-head', h('h3', title), open),
      lines.length || harden ? h('ul.bn-pools', lines, harden) : h('p.bn-note', 'Nothing in this plan stands on a bench.'),
      editing ? editor(fig) : null,
      fig.weeks.length ? h('div.bn-legend', { 'aria-label': 'What the colours stand for' }, fig.kinds.map(([k, label]) => h('span', h('i', { 'data-kind': k }), label))) : null,
      charts,
      h('dl.bn-facts',
        crates ? [h('dt', 'Sheltered crates'), h('dd.bn-crates', crates)] : null,
        sharing ? [h('dt', 'Shared trays'), h('dd.bn-share', sharing)] : null,
        areas.size ? [h('dt', 'Where the room is'), h('dd.bn-where', [...areas].map(([name, a]) => h('span', h('b', name), ` ${plural(a.benches, 'bench', 'benches')}, ${num(a.cap)} tray spaces`)))] : null));
    if (refocus) {
      const [id, f] = refocus; refocus = null;
      requestAnimationFrame(() => { const el = id ? node.querySelector(`tr[data-bench="${id}"] [data-f="${f}"]`) : node.querySelector(`[data-f="${f}"]`); if (el && !el.disabled) el.focus({ preventScroll: !id }); });
    }
    return node;
  }

  // ── what the season uses, less what is on the shelf ──
  function supplies() {
    const eng = App.state.engine, fig = figures(), sup = N.supplies(eng, App.planYear(), (App.state.plan.lrfNext || {}).supplies || null, fig);
    if (!sup.any) return null;
    const cell = (r, kind, value, label, step) => {
      const input = h('input.tr-n', { type: 'number', min: 0, max: 1000000, step, value: value || '', placeholder: kind === 'mix' ? 'qt' : '0', 'aria-label': `${r.name}: ${label}`, inputMode: step === 1 ? 'numeric' : 'decimal', dataset: { f: kind } });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = value || ''; input.blur(); } });
      input.addEventListener('change', () => {
        if (+input.value === +(value || 0)) return;
        refocus = null;
        const done = App.setSupply(kind, r.id, input.value);
        if (!done) { input.value = value || ''; return; }
        if (done.changed) UI.toast(kind === 'mix' ? `${r.name}: ${input.value.trim() === '' || +input.value === 0 ? 'no mix counted' : `${num(+input.value, 2)} qt of mix each`}` : `${r.name}: ${num(+input.value || 0)}${r.id === 'mix' ? ' qt' : ''} on hand`, { label: 'Undo', run: App.undo });
      });
      return input;
    };
    const how = r => r.how.map(x => h(x.aside ? 'small' : 'span', `${num(x.n)} ${x.text}${x.on ? ` (${day(x.on)})` : ''}`));
    const body = h('tbody');
    for (const r of sup.rows) body.append(h('tr', { dataset: { supply: r.id } },
      h('td', h('b', r.name)), h('td.tr-fig', num(r.need)), h('td.bn-how', how(r)),
      h('td', cell(r, 'have', r.have, 'on hand', 1)), h('td.tr-fig.bn-buy', r.buy ? num(r.buy) : h('span.tr-unset', '—')),
      h('td', r.fills > 0 ? cell(r, 'mix', r.mixEach, 'quarts of mix one takes', 0.05) : null),
      h('td.tr-fig', r.fills > 0 ? (r.mixQt != null ? num(r.mixQt, 0) : h('span.tr-unset', '—')) : null)));
    const m = sup.mix;
    const mixHow = !m.of ? 'Nothing in this plan takes mix.' : !m.counted ? 'Say how much mix one tray or pot takes, in the column to the right, and it is added up here.'
      : `${num(m.cuFt, 1)} cubic feet${m.missing.length ? `. Not counted, for want of a figure: ${m.missing.join(', ')}` : ''}.`;
    body.append(h('tr.bn-mix', { dataset: { supply: 'mix' } },
      h('td', h('b', 'Potting mix')), h('td.tr-fig', m.counted ? `${num(m.need, 0)} qt` : h('span.tr-unset', '—')), h('td.bn-how', h('span', mixHow)),
      h('td', cell({ id: 'mix', name: 'Potting mix' }, 'have', m.have, 'quarts on hand', 1)), h('td.tr-fig.bn-buy', m.counted && m.buy > 0 ? `${num(m.buy, 0)} qt` : h('span.tr-unset', '—')),
      h('td'), h('td.tr-fig', m.counted ? num(m.need, 0) : h('span.tr-unset', '—'))));
    return h('section.bn-sup', { id: 'bnSupplies' }, h('h3', 'Supplies for the season'),
      h('ul.bn-sup-notes', h('li', h('b', 'Plug trays'), ' come back, so they are counted at the most in use on one day.'), h('li', h('b', 'Live trays, rockwool and mix'), ' leave or are used up, so they are counted over the season.'), h('li', h('b', 'Mix'), ` is in dry quarts: ${num(N.DRY_QT_PER_CUFT, 1)} to a cubic foot.`)),
      h('div.tr-scroll', h('table.as.bn-supplies', h('thead', h('tr', h('th', 'Supply'), h('th', 'Needed'), h('th', 'Counted as'), h('th', 'On hand'), h('th', 'To buy'), h('th', { title: 'Dry quarts of potting mix one tray or pot takes' }, 'Mix each, qt'), h('th', 'Mix, qt'))), body)));
  }

  root.LRFBench = { figures, section, supplies, KINDS, get editing() { return editing; }, openEditor(on = true) { editing = !!on; App.emit('nursery'); } };
})(window);
