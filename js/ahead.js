/* Little River Farm Planner — planning ahead, opened in place.
 *
 * Two ways to add to a plan that already has its main crops. Neither is a page of its own:
 *
 *   An opening     ground that stands free before, after or between the crops planned in a bed. Clicked on the
 *                  timeline or in a bed's panel, it shows in the details panel with the crops whose whole cycle
 *                  goes into it. Pick one, check its dates, add it.
 *   A series       a run of plantings of one crop a set number of days apart, placed in the first ground free
 *                  for each. It opens as a sheet over the page and shows everything before anything is added:
 *                  where each goes, what could not be placed and why, and the weeks of harvest it gives.
 *
 * Nothing is added until its button is pressed, and each addition is one step that can be undone.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, S = root.LRFSuccession, F = root.LRFForecast, Lib = root.LRFLibrary;
  const { h, clear, num, day, span } = UI;
  const $ = id => document.getElementById(id);
  const lower = c => String((c && c.name) || 'crop').toLowerCase();
  let sheet = null;
  const O = { key: '', mine: true, pick: null, all: false };
  const P = { cropId: '', varietyId: '', sourceId: '', gardenIds: null, basis: 'planting', from: '', endMode: 'count', count: 4, to: '', every: '', unit: 'whole', amount: 1, skipCovered: false, done: null };

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
      h('div.ah-actions', h('button.btn.primary', { type: 'button', id: 'ahAdd', disabled: !t.ok, onclick: () => addFit(o, t, crop) }, 'Add planting'), h('button.btn', { type: 'button', onclick: () => { O.pick = null; redraw(); } }, 'Cancel')));
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

  // ───────────────────────────── a series ─────────────────────────────
  const seriesCrops = eng => eng.crops().filter(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0);
  function seedSeries(cropId, sourceId) {
    const eng = App.state.engine, source = sourceId ? eng.planting(sourceId) : null, crop = eng.crop(source ? source.cropId : cropId);
    Object.assign(P, { cropId: crop ? crop.id : '', varietyId: source ? source.varietyId || '' : '', sourceId: source ? source.id : '', gardenIds: null, done: null });
    if (!crop) return;
    const gardens = S.gardensFor(eng, crop), r = source ? eng.calc(source) : null;
    if (source && r) {
      P.gardenIds = [r.b.gardenId];
      P.every = String(r.tw && source.towerCycle && source.towerCycle.days ? 7 : Math.max(7, Math.min(28, r.c.hw || 14)));
      P.from = E.d2s(E.addDays(r.field, +P.every));
    } else {
      const models = S.models(eng, crop.id), planted = gardens.filter(g => g.planted);
      P.gardenIds = planted.map(g => g.garden.id);
      // where the crop is grown in towers, a new series follows the cycle those plantings use
      const like = models.find(m => planted.length && m.r.kind === planted[0].kind && m.r.kind !== 'bed');
      if (like) P.sourceId = like.p.id;
      P.every = String(Math.max(7, Math.min(28, +crop.hw || 14)));
      // start no earlier than this crop may go into the first ground chosen: a series that opens in January is all refusals
      if (!P.from) {
        const bed = S.spaces(eng, crop, P.gardenIds.length ? P.gardenIds : gardens.slice(0, 1).map(g => g.garden.id))[0], year = App.planYear();
        const floors = bed ? [eng.firstFieldDate(crop, bed, year), eng.fieldPlantingWindow(bed, year).from].filter(E.validDate) : [];
        P.from = E.d2s(new Date(Math.max(+App.state.date, ...floors.map(d => +d))));
      }
    }
    P.unit = 'whole'; P.amount = 1;
  }
  function seriesInput(model) {
    const rows = model.rows.filter(r => r.cropId === P.cropId);
    return { cropId: P.cropId, varietyId: P.varietyId || undefined, sourceId: P.sourceId || undefined, gardenIds: P.gardenIds || [], basis: P.basis, from: P.from, every: P.every, unit: P.unit, amount: P.amount,
      ...(P.endMode === 'count' ? { count: P.count } : { to: P.to }), skipCovered: P.skipCovered, covered: d => { const i = model.index(d); return i >= 0 && i < model.days && rows.some(r => r.days[i] > 1e-9); } };
  }
  /** Weeks of harvest, now and with the series: two rows of the same weeks, so the gaps that close can be seen. */
  function coverage(model, after, cropId) {
    const now = model.rows.filter(r => r.cropId === cropId), then = after.rows.filter(r => r.cropId === cropId), s = F.season(after, then);
    if (!s) return null;
    const lo = Math.min(s.i0, model.index(new Date(model.year, 3, 1))), hi = Math.max(s.i1, model.index(new Date(model.year, 9, 31))), cols = F.periods(model, 'week', lo, hi);
    const cells = (rows, base) => h('div.ah-cells', cols.map(c => {
      const q = rows.reduce((n, r) => n + F.sum(r.days, c.i0, c.i1), 0), was = base ? base.reduce((n, r) => n + F.sum(r.days, c.i0, c.i1), 0) : q;
      const cls = q > 1e-9 ? (base && q > was + 1e-9 ? (was > 1e-9 ? '.on' : '.new') : '.on') : '';
      return h('i' + cls, { title: `Week of ${day(c.start)}: ${q > 1e-9 ? F.amount(q, rows[0] ? rows[0].unit : '', rows[0] ? rows[0].group : 'produce') : 'nothing to pick'}` });
    }));
    const gapsNow = now.length ? F.gaps(model, now) : [], gapsThen = F.gaps(after, then);
    return h('div.ah-strip', { id: 'ahStrip', role: 'img', 'aria-label': `Weeks with a harvest: ${cols.filter(c => now.some(r => F.sum(r.days, c.i0, c.i1) > 1e-9)).length} now, ${cols.filter(c => then.some(r => F.sum(r.days, c.i0, c.i1) > 1e-9)).length} with this series` },
      h('div.ah-strip-row', h('span', ''), h('div.ah-cells.ah-months', cols.map(c => h('b', c.top || '')))),
      h('div.ah-strip-row', h('span', 'Now'), cells(now, null)),
      h('div.ah-strip-row', h('span', 'With this'), cells(then, now)),
      h('div.ah-legend', h('span', h('i.on'), 'a week with a harvest'), h('span', h('i.new'), 'a week this series adds'), h('span', h('i'), 'nothing to pick'),
        h('span', gapsThen.length ? `${num(gapsThen.length)} gap${gapsThen.length === 1 ? '' : 's'} left${gapsNow.length ? ` (${num(gapsNow.length)} now)` : ''}: ${gapsThen.slice(0, 3).map(g => span(g.start, g.end)).join(', ')}` : now.length && gapsNow.length ? `closes ${num(gapsNow.length)} gap${gapsNow.length === 1 ? '' : 's'}: no week without a harvest between the first and the last` : 'no week without a harvest between the first and the last')));
  }
  function seriesBody() {
    const eng = App.state.engine, crops = seriesCrops(eng), mine = new Set(S.candidates(eng, true).map(c => c.id)), used = new Set(App.state.plan.plantings.map(p => p.cropId));
    if (!P.cropId || !eng.crop(P.cropId)) seedSeries((crops.find(c => used.has(c.id) && c.id === 'radish') || crops.find(c => used.has(c.id)) || crops[0] || {}).id, '');
    const crop = eng.crop(P.cropId), set = change => { Object.assign(P, change, { done: null }); draw(); };
    if (!crop) return [h('p.hv-empty', 'There is no crop to plan a series of yet.')];
    const gardens = S.gardensFor(eng, crop), chosen = new Set(P.gardenIds || []), models = S.models(eng, crop.id);
    // a series started from one planting copies that planting, whether or not it is the latest of its kind
    const copied = P.sourceId ? eng.planting(P.sourceId) : null;
    if (copied && copied.cropId === crop.id && !models.some(m => m.p.id === copied.id) && eng.calc(copied)) models.unshift({ p: copied, r: eng.calc(copied) });
    else if (P.sourceId && !(copied && copied.cropId === crop.id)) P.sourceId = '';
    const kind = (gardens.find(g => chosen.has(g.garden.id)) || gardens[0] || {}).kind || 'bed';
    const model = forecast(eng), result = S.series(eng, seriesInput(model));
    const own = c => used.has(c.id) || mine.has(c.id);
    const cropSel = h('select', { id: 'ahSeriesCrop', onchange: e => { P.from = ''; seedSeries(e.target.value, ''); draw(); } },
      h('optgroup', { label: 'Crops you grow' }, crops.filter(own).map(c => h('option', { value: c.id, selected: c.id === crop.id }, c.name))),
      h('optgroup', { label: 'Every other crop' }, crops.filter(c => !own(c)).map(c => h('option', { value: c.id, selected: c.id === crop.id }, c.name))));
    const varSel = h('select', { id: 'ahSeriesVariety', onchange: e => set({ varietyId: e.target.value }) }, h('option', { value: '' }, P.sourceId ? 'As in the planting copied' : 'No variety chosen'), eng.varietiesOf(crop.id).map(v => h('option', { value: v.id, selected: v.id === P.varietyId }, v.name)));
    const modelSel = models.length ? h('select', { id: 'ahSeriesModel', onchange: e => set({ sourceId: e.target.value }) }, h('option', { value: '' }, 'The crop’s own figures'),
      models.map(m => h('option', { value: m.p.id, selected: m.p.id === P.sourceId }, `Like ${App.bedLabel(m.r.b)}, ${day(m.r.field)}${m.r.c.vname ? ' · ' + m.r.c.vname : ''} (${num(E.dayDiff(m.r.first, m.r.field))} days, picked ${num(m.r.harvestDays)})`))) : null;
    const gardenList = h('div.ah-gardens', { id: 'ahSeriesGardens' }, gardens.length ? gardens.map(g => h('label', h('input', { type: 'checkbox', value: g.garden.id, checked: chosen.has(g.garden.id), onchange: e => { const next = new Set(P.gardenIds || []); if (e.target.checked) next.add(g.garden.id); else next.delete(g.garden.id); set({ gardenIds: gardens.map(x => x.garden.id).filter(id => next.has(id)) }); } }),
      g.garden.name, h('small', `${num(g.spaces)} ${g.kind === 'bed' ? 'bed' : g.kind === 'tower' ? 'tower' : 'group'}${g.spaces === 1 ? '' : 's'}${g.planted ? ' · grown here' : ''}`))) : h('p.help', 'No garden has ground this crop can go in.'));
    const unitWord = kind === 'tower' ? 'whole towers' : kind === 'containers' ? 'whole groups' : 'whole beds';
    const form = h('div.ah-form', { id: 'ahSeriesForm' },
      h('label.tr-field', h('span', 'Crop'), cropSel),
      h('label.tr-field', h('span', 'Variety'), varSel),
      modelSel ? h('label.tr-field', h('span', 'Days and settings'), modelSel) : null,
      h('div.tr-field', h('span', 'Where, in this order'), gardenList),
      h('div.tr-field', h('span', 'Dates are for'), h('div.seg', { role: 'group' },
        h('button', { type: 'button', 'aria-pressed': String(P.basis === 'planting'), id: 'ahBasisPlant', onclick: () => set({ basis: 'planting' }) }, 'Going in'),
        h('button', { type: 'button', 'aria-pressed': String(P.basis === 'harvest'), id: 'ahBasisHarvest', onclick: () => set({ basis: 'harvest' }) }, 'First harvest'))),
      h('div.ah-pair',
        h('label.tr-field', h('span', P.basis === 'harvest' ? 'First harvest on' : 'First one on'), h('input', { type: 'date', id: 'ahSeriesFrom', value: P.from, onchange: e => set({ from: e.target.value }) })),
        h('label.tr-field', h('span', 'Then every'), h('span.ah-inline', h('input', { type: 'number', id: 'ahSeriesEvery', min: 1, max: 366, step: 1, value: P.every, onchange: e => set({ every: e.target.value }) }), 'days'))),
      h('div.tr-field', h('span', 'How many'), h('span.ah-inline',
        h('select', { id: 'ahSeriesEnd', onchange: e => set({ endMode: e.target.value, to: P.to || E.d2s(E.addDays(E.s2d(P.from) > 0 ? E.s2d(P.from) : App.state.date, 56)) }) }, h('option', { value: 'count', selected: P.endMode === 'count' }, 'This many'), h('option', { value: 'to', selected: P.endMode === 'to' }, 'Until a date')),
        P.endMode === 'count' ? h('input', { type: 'number', id: 'ahSeriesCount', min: 1, max: S.LIMIT, step: 1, value: P.count, onchange: e => set({ count: e.target.value }) }) : h('input', { type: 'date', id: 'ahSeriesTo', value: P.to, onchange: e => set({ to: e.target.value }) }))),
      h('div.tr-field', h('span', 'Each one takes'), h('span.ah-inline',
        h('input', { type: 'number', id: 'ahSeriesAmount', min: 1, max: 2000, step: 1, value: P.amount, onchange: e => set({ amount: e.target.value }) }),
        kind === 'bed' ? h('select', { id: 'ahSeriesUnit', onchange: e => set({ unit: e.target.value, amount: e.target.value === 'ft' ? 30 : 1 }) }, h('option', { value: 'whole', selected: P.unit === 'whole' }, 'whole beds'), h('option', { value: 'ft', selected: P.unit === 'ft' }, 'feet of bed')) : h('span', unitWord))),
      h('label.ah-check', h('input', { type: 'checkbox', id: 'ahSeriesSkip', checked: P.skipCovered, onchange: e => set({ skipCovered: e.target.checked }) }), h('span', `Leave one out when ${lower(crop)} is already being picked on the day it would first be ready`)));

    // what it comes to
    const out = [h('h3', `${crop.name}: the series`)];
    if (P.done) {
      out.push(h('p.ah-sum', { id: 'ahDone' }, `Added ${num(P.done.n)} planting${P.done.n === 1 ? '' : 's'}. They are on the map and the timeline now.`),
        h('div.ah-actions', h('button.btn', { type: 'button', id: 'ahSee', onclick: () => { close(); App.setView('timeline'); } }, 'See them on the timeline'), h('button.btn', { type: 'button', onclick: () => { App.undo(); P.done = null; draw(); } }, 'Undo'),
          h('button.btn.primary', { type: 'button', id: 'ahAgain', onclick: () => { P.done = null; draw(); } }, 'Plan another')));
    } else if (result.error) out.push(h('p.ah-sum.bad', { id: 'ahSeriesError' }, result.error));
    else {
      const n = result.plantings.length, total = result.waves.length, groundWord = result.groundUnit === 'ft' ? 'ft of bed' : result.groundUnit === 'sites' ? (result.ground === 1 ? 'tower' : 'towers') : result.groundUnit;
      const group = F.groupOf(crop, result.unit, (App.state.plan.lrfNext || {}).groups);
      out.push(h('p.ah-sum', { id: 'ahSeriesSum' }, n
        ? `${num(result.placed)} of ${num(total)} succession${total === 1 ? '' : 's'} can be placed: ${num(n)} planting${n === 1 ? '' : 's'}, ${num(result.ground, 1)} ${groundWord}. Harvest ${span(result.firstHarvest, result.lastHarvest)}${result.units > 0 ? `, about ${F.amount(result.units, result.unit, group)} in all` : ''}.${result.skipped ? ` ${num(result.skipped)} left out: already being picked then.` : ''}${result.short ? ` ${num(result.short)} could not be placed in full.` : ''}`
        : result.skipped === total ? `Nothing to add: ${lower(crop)} is already being picked on every one of those days.` : 'None of these can be placed. The table says what stands in the way of each.'));
      if (n) {
        const plan2 = { ...App.state.plan, plantings: [...App.state.plan.plantings, ...result.plantings] }, eng2 = E.create(plan2, Lib), strip = coverage(model, F.build(eng2, { year: App.planYear() }), crop.id);
        if (strip) out.push(strip);
        if (result.plantings.some(p => { const r = eng2.calc(p); return r && r.sow; })) {
          const was = S.benchRoom(eng), will = S.benchRoom(eng2);
          if (will.cap && will.least) out.push(h('p.hv-note', { id: 'ahBench' }, `Heated benches with these seedlings: ${num(Math.floor(will.least.free))} of ${num(will.cap)} tray spaces free in the tightest week (${day(will.least.start)})${was.least ? `; ${num(Math.floor(was.least.free))} now` : ''}.${will.least.free <= 0 ? ' That week is full.' : ''}`));
        }
      }
      const rows = result.waves.map(w => {
        if (w.skipped) return h('tr.skip', h('td.n', num(w.k + 1)), h('td', day(w.target)), h('td', { colSpan: 5 }, `Left out: already being picked on ${day(w.firstHarvest)}`));
        const first = w.placed[0], where = w.placed.map(x => `${App.bedLabel(x.bed)}${x.r.tw || x.r.physicalLength >= x.r.cap - 1e-6 ? '' : ` (${num(x.r.physicalLength, 1)} ft)`}`).join('; ');
        const miss = w.short > 1e-6 ? h('div.ah-miss', `${w.placed.length ? `${num(w.short, 1)} ${P.unit === 'ft' ? 'ft' : w.short === 1 ? 'space' : 'spaces'} short. ` : 'No room. '}${w.why.map(x => `${x.why}${x.spaces > 1 ? ` (${num(x.spaces)} spaces)` : ''}`).join(' · ')}`) : null;
        return h('tr' + (w.short > 1e-6 ? '.short' : ''), h('td.n', num(w.k + 1)), h('td', day(w.target)),
          h('td', first ? day(first.r.field) : '—'), h('td', first && first.r.sow ? day(first.r.sow) : first ? 'in the ground' : '—'),
          h('td', where || null, miss), h('td', first ? span(first.r.first, new Date(Math.max(...w.placed.map(x => +x.r.last)))) : '—'),
          h('td.n', w.placed.length ? F.amount(w.placed.reduce((m, x) => m + x.units, 0), result.unit, group) : '—'));
      });
      out.push(h('table.as.ah-waves', { id: 'ahWaves' }, h('thead', h('tr', h('th.n', '#'), h('th', P.basis === 'harvest' ? 'Ready by' : 'Asked for'), h('th', 'Goes in'), h('th', 'Sown'), h('th', 'Where'), h('th', 'Harvest'), h('th.n', 'About'))), h('tbody', rows)));
      out.push(h('div.ah-actions',
        h('button.btn.primary', { type: 'button', id: 'ahSeriesAdd', disabled: !n, onclick: () => {
          if (!App.addPlantings(result.plantings, `Add ${n} succession${n === 1 ? '' : 's'} of ${lower(crop)}`)) return;
          P.done = { n }; UI.toast(`Added ${num(n)} planting${n === 1 ? '' : 's'} of ${lower(crop)}`, { label: 'Undo', run: () => { App.undo(); P.done = null; draw(); } }); draw();
        } }, n ? `Add ${num(n)} planting${n === 1 ? '' : 's'}` : 'Nothing to add'),
        h('small', 'One step, and it can be undone. Each planting can then be moved or changed like any other.')));
    }
    return [h('div.ah-cols', form, h('div.ah-out', { id: 'ahSeriesOut' }, out))];
  }

  // ───────────────────────────── the sheet a series opens in ─────────────────────────────
  function close() { if (!sheet) return; const el = sheet; sheet = null; el.close(); el.remove(); }
  function draw() {
    if (!sheet || !App.state.ready) return;
    const body = sheet.querySelector('.ah-sheet-body'), keep = sheet.scrollTop;
    UI.add(clear(body), seriesBody());
    sheet.scrollTop = keep;
  }
  /** Open the series sheet with something in mind: { sourceId? } copies a planting, { cropId? } starts from a crop. */
  function series(focus) {
    if (!App.state.ready) return;
    focus = focus || {};
    P.from = ''; seedSeries(focus.cropId || '', focus.sourceId || '');
    if (!sheet) {
      sheet = h('dialog.dialog.wide.ah-sheet', { id: 'ahSheet', oncancel: e => { e.preventDefault(); close(); } },
        h('header.ah-sheet-head', h('div', h('p.eyebrow', `Planning ahead · ${App.planYear()}`), h('h2', 'A crop coming steadily')),
          h('button.icon-btn.close', { type: 'button', id: 'ahClose', 'aria-label': 'Close', onclick: close }, '×')),
        h('p.dlg-lead', 'A run of plantings of one crop, a set number of days apart. Each goes into the first ground that is free for it, in the gardens you tick, in season. Nothing is added until you say so.'),
        h('div.ah-sheet-body'));
      document.body.append(sheet);
      sheet.showModal();
    }
    draw();
  }
  function init() {
    App.on('plan', draw);
  }
  root.LRFAhead = { init, opening, series, close, state: { O, P } };
})(window);
