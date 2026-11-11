/* Little River Farm Planner — an opening, shown in place.
 *
 * An opening is ground that stands free before, after or between the crops planned in a bed. Clicked on the
 * timeline or in a bed's panel, it shows in the details panel with the crops whose whole cycle goes into it.
 * Pick one, check its dates, add it; or start a series from that day (js/series.js).
 *
 * Nothing is added until its button is pressed, and each addition is one step that can be undone.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, S = root.LRFSuccession, F = root.LRFForecast, Lib = root.LRFLibrary;
  const { h, clear, num, day, span } = UI;
  const $ = id => document.getElementById(id);
  const lower = c => String((c && c.name) || 'crop').toLowerCase();
  const O = { key: '', mine: true, pick: null, all: false };

  // ── what the plan is already picking, so an addition can be judged against it ──
  const forecast = eng => root.LRFHarvestView && eng === App.state.engine ? root.LRFHarvestView.model() : F.build(eng, { year: App.planYear() });
  function pickedShare(model) {
    const byCrop = new Map();
    for (const row of model.rows) { if (!byCrop.has(row.cropId)) byCrop.set(row.cropId, []); byCrop.get(row.cropId).push(row); }
    return (cropId, from, to) => {
      const rows = byCrop.get(cropId);
      if (!rows) return 0;
      let on = 0, all = 0;
      for (let i = model.index(from), end = model.index(to); i <= end; i++) { all++; if (i >= 0 && i < model.days && rows.some(r => r.days[i] > 1e-9)) on++; }
      return all ? on / all : 0;
    };
  }

  // ───────────────────────────── an opening, in the details panel ─────────────────────────────
  const stat = (label, value) => h('div.stat', h('span', label), h('b', value));
  const labelFor = (o, crop) => `Plant ${lower(crop)} ${o.before ? 'before the ' + lower(o.before.r.c) : o.after ? 'after the ' + lower(o.after.r.c) : 'in open ground'}`;
  const find = (eng, sel) => S.openings(eng, { bedId: sel.bedId }).find(o => o.id === sel.id) || null;
  function addFit(o, t, crop) {
    const p = { ...t.p, id: App.uid() };
    if (!App.addPlantings([p], labelFor(o, crop))) return;
    O.pick = null;
    UI.toast(`${crop.name} → ${App.bedLabel(o.bed)} · ${day(t.r.field)}`, { label: 'Undo', run: App.undo });
    App.select({ type: 'planting', id: p.id });
  }
  /** One crop looked at closely in the opening: variety, day and length can be changed, and the schedule follows. */
  function review(o, redraw) {
    const eng = App.state.engine, crop = eng.crop(O.pick.cropId);
    if (!crop) return null;
    const t = S.tryCrop(eng, o, crop, { varietyId: O.pick.varietyId || undefined, date: O.pick.date || undefined, ft: O.pick.ft || undefined, id: 'opening-review' }), r = t.r;
    const set = change => { Object.assign(O.pick, change); redraw(); };
    const variety = h('select', { id: 'ahVariety', onchange: e => set({ varietyId: e.target.value, date: '' }) }, h('option', { value: '' }, 'No variety chosen'), eng.varietiesOf(crop.id).map(v => h('option', { value: v.id, selected: v.id === O.pick.varietyId }, v.name)));
    const dateIn = h('input', { type: 'date', id: 'ahDate', value: t.p.date, min: E.d2s(o.from), max: E.d2s(o.to), onchange: e => set({ date: E.validDate(E.s2d(e.target.value)) ? e.target.value : '' }) });
    const ftIn = h('input', { type: 'number', id: 'ahFt', min: 1, max: o.length, step: 0.5, value: O.pick.ft || '', placeholder: `${num(o.length, 1)}`, onchange: e => { const n = +e.target.value; set({ ft: n > 0 && n < o.length ? n : '' }); } });
    const next = o.before ? `before the ${lower(o.before.r.c)}` : 'before this opening ends';
    const line = (label, value) => h('li', h('span', label), h('b', value));
    const sched = t.ok ? h('ol.schedule', { id: 'ahSched' },
      r.sow ? line('Sow in the nursery', day(r.sow)) : null,
      line(r.c.method === 'TP' ? 'Transplant' : 'Sow', day(r.field)),
      line('Harvest', span(r.first, r.last)),
      line('Ground free again', day(E.addDays(t.through, 1))),
      line('Days to spare', t.spare ? `${num(t.spare)} ${next}` : `none ${next}`),
      t.units > 0 ? line('About', F.amount(t.units, t.unit, F.groupOf(crop, t.unit, (App.state.plan.lrfNext || {}).groups))) : null,
      E.d2s(t.latest) !== t.p.date ? line('Could go in as late as', day(t.latest)) : null)
      : h('p.ah-why', { id: 'ahWhy' }, t.why);
    return h('section.insp-section.form.ah-review', { id: 'ahReview' },
      h('h3', `${crop.name} here`),
      h('label.field', h('span', 'Variety'), variety),
      h('div.field-pair', h('label.field', h('span', r && r.c.method === 'TP' ? 'Transplant date' : 'Sowing date'), dateIn), h('label.field', h('span', 'Length (ft)'), ftIn)),
      sched,
      t.ok && t.rotation ? h('p.help', `${crop.name} would follow ${lower(o.after.r.c)} here, the same family (${t.family}).`) : null,
      h('div.ah-actions', h('button.btn.primary', { type: 'button', id: 'ahAdd', disabled: !t.ok, onclick: () => addFit(o, t, crop) }, 'Add planting'), h('button.btn', { type: 'button', onclick: () => { O.pick = null; redraw(); } }, 'Cancel')),
      t.ok ? h('button.linkish', { type: 'button', id: 'ahSeries', title: `${crop.name} every so many days, the first on this day, in ${o.garden.name}`, onclick: () => App.openAhead({ mode: 'series', cropId: crop.id, varietyId: O.pick.varietyId || undefined, from: t.p.date, gardenId: o.garden.id }) }, `Or plan a series of ${lower(crop)} from this day…`) : null);
  }
  /**
   * Draw the opening that is selected into the details panel. False when it is no longer there (something was planted
   * in it, or the plan changed), so the panel can show the bed instead.
   */
  function opening(host, sel, redraw) {
    const eng = App.state.engine, o = find(eng, sel);
    if (!o) return false;
    if (O.key !== o.id) Object.assign(O, { key: o.id, pick: null, all: false });
    const fits = S.fits(eng, o, { mine: O.mine, covered: pickedShare(forecast(eng)) }), shown = O.all ? fits : fits.slice(0, 8);
    const chips = shown.map(t => h('button.ah-fit' + (t.rotation ? '.rot' : t.covered != null && t.covered < 0.25 ? '.gap' : ''), { type: 'button', 'aria-pressed': String(!!(O.pick && O.pick.cropId === t.crop.id)), style: { '--crop': eng.cropColor(t.crop) }, dataset: { crop: t.crop.id },
      title: `${t.crop.name}: in ${day(t.r.field)}, harvest ${span(t.r.first, t.r.last)}${t.rotation ? '. Follows its own family here.' : t.covered != null && t.covered < 0.25 ? '. The plan has little or none of it then.' : ''}`,
      onclick: () => { O.pick = O.pick && O.pick.cropId === t.crop.id ? null : { cropId: t.crop.id, varietyId: '', date: '', ft: '' }; redraw(); } },
      h('i'), t.crop.name, h('small', `harvest ${day(t.r.first)}`)));
    const around = [o.after ? ['After', o.after, x => `ground clear ${day(E.addDays(eng.occupancyThrough(x.p, x.r), 1))}`] : null, o.before ? ['Before', o.before, x => `goes in ${day(eng.occupancyFrom(x.p, x.r))}`] : null].filter(Boolean);
    UI.add(host,
      h('header.insp-head', h('p.eyebrow', `Opening · ${App.bedLabel(o.bed)}`), h('h2', { id: 'ahTitle' }, span(o.from, o.to)),
        h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select(null) }, '×')),
      h('div.stats', { id: 'ahFigures' }, stat('Days open', num(o.days)), stat(o.whole ? 'Whole bed (ft)' : `Feet of ${num(o.cap, 1)}`, num(o.length, 1))),
      h('section.insp-section', h('h3', 'It comes'), around.length
        ? h('ul.ah-around', around.map(([word, x, when]) => h('li', h('span', `${word} ${lower(x.r.c)}${x.r.c.vname ? ' · ' + x.r.c.vname : ''}`), h('b', when(x)))))
        : h('p.note', o.rests ? 'Until the bed rests.' : 'Nothing else is planned here.')),
      h('section.insp-section', { id: 'ahFits' }, h('h3', fits.length ? `What fits · ${num(fits.length)}` : 'What fits'),
        fits.length ? h('div.ah-fits', chips, fits.length > shown.length ? h('button.ah-more', { type: 'button', id: 'ahMore', onclick: () => { O.all = true; redraw(); } }, `+${num(fits.length - shown.length)} more`) : null)
          : h('p.note', { id: 'ahNone' }, O.mine ? 'Too short for anything on your crop list.' : 'Too short for any crop in the library.'),
        h('label.ah-check', h('input', { type: 'checkbox', id: 'ahMine', checked: !O.mine, onchange: e => { O.mine = !e.target.checked; O.pick = null; redraw(); } }), h('span', 'Offer crops I do not grow yet')),
        fits.length ? h('p.help', 'A crop fits when all of it goes in: growing, its whole harvest and its own turnover, in season. A green edge: the plan has little or none of it then. Dashed: it would follow its own family.') : null),
      O.pick && O.pick.cropId ? review(o, redraw) : null,
      h('p.insp-aside', h('button.link', { type: 'button', id: 'ahToBed', onclick: () => App.select({ type: 'bed', id: o.bed.id }) }, `Everything in ${App.bedLabel(o.bed)}`)));
    return true;
  }

  function init() { /* nothing to wire: an opening is drawn by the details panel, when one is selected */ }
  root.LRFAhead = { init, opening, state: { O } };
})(window);
