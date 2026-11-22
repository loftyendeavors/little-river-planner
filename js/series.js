/* Little River Farm Planner — plantings that have no bed yet ("To place"), and sharing a bed when one is placed.
 *
 *   To place          plantings with no bed: one sent there from its bed, or (from before 0.84) a series asked to wait. A date
 *                     is never moved to make one fit. They count toward nothing (seeds, sowing, benches, the forecast) until
 *                     placed, so the number waiting is shown wherever the page is: in the header, above the crop library, and
 *                     on a row of their own at the top of the timeline.
 *   Sharing a bed     dropped on a free bed a waiting planting takes it whole. Dropped where one crop holds the
 *                     ground then, it asks how the bed is to be shared: by length or by rows.
 *
 * Successions are planned on a page of their own (js/successions.js). The series tool that stood in the details panel is gone (0.84).
 * Each placing is one step that can be undone.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, S = root.LRFSuccession, T = root.LRFThumbs;
  const { h, clear, add, num, day, span, plainDays: plain } = UI;
  const $ = id => document.getElementById(id);
  const lower = c => String((c && c.name) || 'crop').toLowerCase();
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  const field = (label, control, help) => h('label.field', h('span', label), control, help ? h('small', help) : null);
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const KIND = { bed: 'Bed', tower: 'Tower', containers: 'Crates', bench: 'Bench' };
  /** A space named so that the part that tells rows apart comes first: "Bed 12 · North Field". */
  const spaceName = (b, eng = App.state.engine) => { const g = eng.gardenOf(b); return `${KIND[eng.spaceKind(b)] || 'Space'} ${b.bed}${g ? ' · ' + g.name : ''}`; };

  // ───────────────────────────── a planting with no bed yet, in the details panel ─────────────────────────────
  const W = { key: '', all: false };
  function waitingSize(eng, w) {
    const origin = eng.bedOf(w.wait?.from), run = w.run && S.runs(eng.plan).find(x => x.id === w.run.id);
    const kind = run?.kind || (origin && eng.spaceKind(origin)) || 'bed';
    if (kind === 'tower') return 'One tower';
    if (kind === 'bench') return w.trays ? plural(w.trays, 'tray') : 'Whole bench';
    if (kind === 'containers') return w.ft ? plural(w.ft, 'container') : 'Whole group';
    return '';
  }
  function waitingPanel(host, sel, redraw) {
    const eng = App.state.engine, w = App.waitingOne(sel.id);
    if (!w) return false;
    if (W.key !== w.id) Object.assign(W, { key: w.id, all: false });
    const crop = eng.crop(w.cropId) || { name: 'Crop' }, v = eng.variety(w.varietyId), color = eng.cropColor(crop), a = S.about(eng, w), wait = w.wait || {}, date = E.s2d(w.date);
    const size = waitingSize(eng, w);
    const mates = wait.s ? App.waiting().filter(q => q.wait && q.wait.s === wait.s) : [w];
    const set = (change, label) => { if (!App.updateWaiting(w.id, change, label)) redraw(); };
    const variety = h('select', { id: 'wtVariety', onchange: e => set({ varietyId: e.target.value || null }, 'Change variety') }, h('option', { value: '' }, 'No variety chosen'), eng.varietiesOf(w.cropId).map(q => h('option', { value: q.id, selected: q.id === w.varietyId }, q.name)));
    if (v && !eng.varietiesOf(w.cropId).includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    const homes = S.homes(eng, w), shown = W.all ? homes : homes.slice(0, 8), r = a && a.r;
    add(host,
      h('header.insp-head.planting', { style: { '--crop': color } }, T.el({ varietyId: w.varietyId, cropId: w.cropId, color, label: (v && v.name) || crop.name, size: 64, cls: 'head' }),
        h('p.eyebrow', { title: wait.of > 1 ? `Number ${num(wait.k)} of a succession of ${num(wait.of)}, ${num(wait.every)} days apart` : '' }, `No bed yet${wait.of > 1 ? ` · ${num(wait.k)} of ${num(wait.of)}` : ''}`), h('h2', { id: 'wtTitle' }, v && v.name ? `${crop.name} · ${v.name}` : crop.name),
        h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select(null) }, '×')),
      h('p.wt-note', { id: 'wtNote' }, 'It counts toward nothing until it is on a bed: not seeds required, the sowing lists, the benches or the forecast.'),
      h('section.insp-section.form',
        h('div.field-pair', field(r && r.c.method !== 'TP' ? 'Sowing date' : 'Goes in', h('input', { type: 'date', id: 'wtDate', value: w.date, onchange: e => { if (E.validDate(E.s2d(e.target.value))) set({ date: e.target.value }, 'Change date'); else redraw(); } })),
          size ? field('Space', h('span', size)) : field('Length (ft)', h('input', { type: 'number', id: 'wtFt', min: 1, max: 2000, step: 0.5, value: w.ft > 0 ? w.ft : '', placeholder: 'Whole bed', onchange: e => set({ ft: +e.target.value > 0 ? +e.target.value : null }, 'Change length') }))),
        field('Variety', variety)),
      r ? h('section.insp-section', h('h3', 'Its days'),
        h('ol.schedule', { id: 'wtSched' }, r.sow ? h('li', h('span', 'Sow in nursery'), h('b', day(r.sow))) : null, h('li', h('span', r.c.method === 'TP' ? 'Transplant' : 'Direct sow'), h('b', day(r.field))),
          h('li', h('span', 'First harvest'), h('b', day(r.first))), h('li', h('span', 'Last harvest'), h('b', r.harvestDays ? day(r.last) : 'None before the season ends'))),
        h('p.help', `Worked out as if in ${spaceName(a.bed, eng)}. The bed it goes to decides.`)) : null,
      h('section.insp-section', { id: 'wtHomes' }, h('h3', homes.length ? `Free for it on ${day(date)} · ${num(homes.length)}` : `Free for it on ${day(date)}`),
        homes.length ? [shown.map(x => h('button.p-open', { type: 'button', dataset: { home: x.bed.id }, title: `Place it here: ${App.bedLabel(x.bed)}, ${x.r.harvestDays > 0 ? `harvest ${span(x.r.first, x.r.last)}` : 'nothing picked'}`, onclick: () => App.placeWaiting(w.id, x.bed.id) },
          h('b', `${KIND[eng.spaceKind(x.bed)] || ''} ${x.bed.bed}`.trim()), h('span', (x.garden || {}).name || ''), x.frost ? h('small.frost', { dataset: { hook: 'home-frost' }, title: plain(x.frost) }, 'frost') : null, h('small', x.wanted ? 'where it was sent' : ''))),
          homes.length > shown.length ? h('button.ah-more', { type: 'button', id: 'wtMore', onclick: () => { W.all = true; redraw(); } }, `+${num(homes.length - shown.length)} more`) : null,
          h('p.help', 'Click one to place it there, or drag it onto any bed. A bed that holds one other crop then can be shared: drop it there to choose how.')]
          : h('p.note.sr-none', { id: 'wtNoHome' }, 'No space is free for all of its days, in season. Drag it onto a bed to share one, or change its date.'),
        wait.why ? h('p.help', { id: 'wtWhy' }, wait.from ? `Why it waits: ${wait.why.charAt(0).toLowerCase()}${wait.why.slice(1)}${eng.bedOf(wait.from) ? ` (${App.bedLabel(eng.bedOf(wait.from))})` : ''}. It keeps its date.` : `Why it waits: ${wait.why.charAt(0).toLowerCase()}${wait.why.slice(1)} in the ${wait.beds ? 'beds' : 'gardens'} it was sent to.`) : null),
      h('div.insp-actions.wt-actions', h('button.btn.danger', { type: 'button', id: 'wtRemove', onclick: () => App.removeWaiting([w.id]) }, 'Remove'),
        mates.length > 1 ? h('button.btn', { type: 'button', id: 'wtRemoveAll', dataset: { hook: 'waiting-remove-all' }, onclick: () => App.removeWaiting(mates.map(q => q.id), `Remove ${plural(mates.length, 'planting')} of a succession, not yet placed`) }, `Remove all ${num(mates.length)} of this succession still to place`) : null));
    return true;
  }

  // ───────────────────────────── "To place": the third side of the library's switch, and the count in the header ─────────────────────────────
  // The plantings that wait for a bed are listed where crops are picked, as a third choice beside My crops and All crops: not a box that
  // stands above the library. The choice carries an orange count while anything waits, seen from either list of crops.
  function drawBox() {
    const badge = $('waitBadge'), count = document.querySelector('.lib-wait-n');
    if (!badge || !App.state.ready) return;
    const n = App.waiting().length;
    badge.hidden = !n;
    if (n) { clear(badge); add(badge, h('b', num(n)), ' to place', h('span.wb-more', ' · not counted here')); badge.title = `${plural(n, 'planting')} ${n === 1 ? 'has' : 'have'} no bed yet. ${n === 1 ? 'It is' : 'They are'} not counted in seeds required, the sowing lists, bench load or the forecast until placed. Click to see ${n === 1 ? 'it' : 'them'}.`; }
    if (count) { count.hidden = !n; count.textContent = n ? num(n) : ''; }
    // the list itself is drawn by the library; what is picked in it changes with the selection
    const P2 = root.LRFPanels;
    if (P2 && P2.scope && P2.scope() === 'wait') P2.renderLibrary();
  }
  /** The waiting plantings as rows of the library, soonest first: a picture, the name over what it wants, its date at the right. `query` narrows by name. */
  function fillWaiting(host, query) {
    const eng = App.state.engine, q = String(query || '').trim().toLowerCase(), sel = App.state.sel;
    const list = App.waiting().slice().sort((a, b) => a.date.localeCompare(b.date) || natural((eng.crop(a.cropId) || {}).name, (eng.crop(b.cropId) || {}).name));
    if (!list.length) { add(host, h('p.empty.lib-wait-lead', { dataset: { hook: 'waiting-lead' } }, 'Nothing waits for a bed. A planting sent to To place waits here.')); return; }
    add(host, h('p.lib-wait-lead', { dataset: { hook: 'waiting-lead' } }, 'Not in a bed yet, so not in the forecast, seed or sowing lists.'));
    let shown = 0;
    for (const w of list) {
      const c = eng.crop(w.cropId) || { name: 'Crop' }, v = eng.variety(w.varietyId), wait = w.wait || {}, name = v && v.name ? `${c.name} · ${v.name}` : c.name;
      if (q && !name.toLowerCase().includes(q)) continue;
      shown++;
      const from = wait.from && eng.bedOf(wait.from), size = waitingSize(eng, w) || (w.ft > 0 ? `${num(w.ft, 1)} ft` : ''), nth = wait.of > 1 ? `${num(wait.k)} of ${num(wait.of)} of a succession` : from ? `taken out of ${App.bedLabel(from)}` : '';
      add(host, h('div.lib-row.wait-row' + (sel && sel.type === 'waiting' && sel.id === w.id ? '.armed' : ''), { dataset: { waiting: w.id, hook: 'waiting-row' }, role: 'button', tabindex: 0, title: `${App.cropLabel(w)} · goes in ${day(E.s2d(w.date))}${wait.of > 1 ? ` · ${num(wait.k)} of ${num(wait.of)}` : ''}\nDrag onto a bed. It keeps its date.` },
        T.el({ varietyId: w.varietyId, cropId: w.cropId, color: eng.cropColor(c), label: c.name, size: 40, cls: 'key' }),
        h('div.wait-what', h('b.lib-name', name), h('small', [size, nth].filter(Boolean).join(' · '))),
        h('span.lib-count', day(E.s2d(w.date)))));
    }
    if (!shown) add(host, h('p.empty', `No planting waiting matches “${query}”.`));
  }
  function initBox() {
    // the count in the header opens To place in the library, on the Map or the Timeline
    $('waitBadge').addEventListener('click', () => {
      if (!['map', 'timeline'].includes(App.state.view)) App.setView('timeline');
      if (root.LRFPanels) root.LRFPanels.setScope('wait');
      const el = $('libList'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      if (App.state.view === 'timeline') { const s = $('tlScroll'); if (s) s.scrollTop = 0; }
    });
  }

  // ───────────────────────────── sharing a bed ─────────────────────────────
  /**
   * Ask how a waiting planting is to share a bed that is held then, or only partly free. Resolves to 'free' (take the free ground as it is),
   * to the edits of the way chosen ({ ops, p }), or to null when the window is left: × and Escape do nothing.
   */
  function share(w, bed, result) {
    return new Promise(resolve => {
      const eng = App.state.engine, crop = eng.crop(w.cropId), mine = App.cropLabel(w), holder = result.holder, theirs = holder ? App.cropLabel(holder.p) : '', ways = result.ways || [];
      const done = value => { dialog.close(); dialog.remove(); resolve(value); };
      const options = [];
      if (result.state === 'partial' && result.p) {
        const rows = result.rect && result.rect.rows && result.rect.rows.count < result.rect.rows.total ? `${result.rect.rows.count} of ${result.rect.rows.total} rows, ` : '';
        options.push(h('div.share-way', { dataset: { way: 'free' } }, h('div', h('b', `Take what is free: ${rows}${num(result.r.physicalLength, 1)} ft`), h('small', `${result.wants ? `It asks for ${num(result.wants, 1)} ft. ` : ''}Nothing else in the bed changes.`)),
          h('button.btn.primary', { type: 'button', id: 'shareFree', onclick: () => done('free') }, 'Place')));
      }
      for (const way of ways) {
        const length = way.id === 'length', inputEl = h('input', { type: 'number', min: way.min, max: way.max, step: 1, value: way.def, id: length ? 'shareFt' : 'shareRows', 'aria-label': length ? `Feet for ${mine}` : `Rows for ${mine}` });
        const says = h('small'), go = h('button.btn.primary', { type: 'button', id: length ? 'shareLength' : 'shareByRows' }, 'Place');
        let made = null;
        const work = () => {
          made = way.make(inputEl.value);
          go.disabled = !made;
          says.textContent = made ? (length ? `${theirs} keeps ${num(made.keeps, 1)} ft and gives up its last ${num(made.takes, 1)}. Its plant count follows.` : `${theirs} keeps ${plural(made.keeps, 'row')} of ${num(made.total)}.`)
            : `Between ${num(way.min)} and ${num(way.max)} ${length ? 'ft' : way.max === 1 ? 'row' : 'rows'}.`;
        };
        inputEl.addEventListener('input', work); work();
        go.addEventListener('click', () => { if (made) done(made); });
        options.push(h('div.share-way', { dataset: { way: way.id } }, h('div', h('b', length ? 'Split the length' : 'Split the rows'), h('label.share-n', inputEl, h('span', length ? `ft for ${lower(crop)}` : `of ${num(way.total)} rows for ${lower(crop)}`)), says), go));
      }
      const until = holder && holder.through !== Infinity ? `until ${day(holder.through)}` : 'all season';
      const dialog = h('dialog.dialog.share', { id: 'shareDlg', oncancel: e => { e.preventDefault(); done(null); } },
        h('button.icon-btn.close', { type: 'button', id: 'shareClose', 'aria-label': 'Close', title: 'Close. Nothing is placed.', onclick: () => done(null) }, '×'),
        h('h2', `Share ${spaceName(bed, eng)}?`),
        h('p', { id: 'shareLead' }, holder ? `${theirs} holds ${result.state === 'partial' ? 'part of it' : 'it'} ${holder.from > result.from ? `from ${day(holder.r.field)}` : until}. ${mine} goes in ${day(E.s2d(w.date))}; its date does not change.` : `Only part of it is free on ${day(E.s2d(w.date))}.`),
        h('div.share-ways', options),
        h('div.dialog-actions', h('button.btn', { type: 'button', id: 'shareCancel', onclick: () => done(null) }, 'Cancel')));
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  function init() {
    initBox();
    App.on('plan', drawBox);
    App.on('sel', drawBox);
  }
  root.LRFSeries = { init, waitingPanel, share, drawBox, fillWaiting };
})(window);
