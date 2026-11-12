/* Little River Farm Planner — the series tool, and plantings that have no bed yet.
 *
 *   The series tool   "this crop every N days": a run of plantings counted between the days they go in the
 *                     ground. It opens in the details panel, from a crop, a planting, a bed or an opening, and
 *                     shows what it would add as ghost bars on the timeline before anything is added. The
 *                     plantings go to the gardens ticked, to the beds named, or nowhere yet.
 *   To place          plantings with no bed. A series asked to wait puts all of its plantings here; one sent to
 *                     gardens or beds leaves here whatever found no ground. A date is never moved to make one
 *                     fit. They count toward nothing (seeds, sowing, benches, the forecast) until placed, so the
 *                     number waiting is shown wherever the page is: in the header, above the crop library, and
 *                     on a row of their own at the top of the timeline.
 *   Sharing a bed     dropped on a free bed a waiting planting takes it whole. Dropped where one crop holds the
 *                     ground then, it asks how the bed is to be shared: by length or by rows.
 *
 * Nothing is added until its button is pressed, and each addition is one step that can be undone.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, S = root.LRFSuccession, F = root.LRFForecast, Lib = root.LRFLibrary, T = root.LRFThumbs;
  const { h, clear, add, num, day, span, toast } = UI;
  const $ = id => document.getElementById(id);
  const lower = c => String((c && c.name) || 'crop').toLowerCase();
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  const field = (label, control, help) => h('label.field', h('span', label), control, help ? h('small', help) : null);
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const KIND = { bed: 'Bed', tower: 'Tower', containers: 'Crates', bench: 'Bench' };
  /** A space named so that the part that tells rows apart comes first: "Bed 12 · North Field". */
  const spaceName = (b, eng = App.state.engine) => { const g = eng.gardenOf(b); return `${KIND[eng.spaceKind(b)] || 'Space'} ${b.bed}${g ? ' · ' + g.name : ''}`; };
  const isOpen = () => !!(App.state.sel && App.state.sel.type === 'series');

  // ───────────────────────────── the series tool ─────────────────────────────
  const P = { cropId: '', varietyId: '', sourceId: '', place: 'gardens', gardenIds: [], bedIds: [], basis: 'planting', from: '', endMode: 'count', count: 4, to: '', every: '', unit: 'whole', amount: 1,
    skipCovered: false, more: false, room: false, roomAll: false, done: null, back: null };
  const seriesCrops = eng => eng.crops().filter(c => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0);
  const forecast = eng => root.LRFHarvestView && eng === App.state.engine ? root.LRFHarvestView.model() : F.build(eng, { year: App.planYear() });
  const everyFor = (crop, source, r) => String(source && r && r.tw && source.towerCycle && source.towerCycle.days ? 7 : Math.max(7, Math.min(28, +((r && r.c.hw) || crop.hw) || 14)));
  /** The first day worth offering: today's planning date, or the first day this crop may go into the ground it is headed for. */
  function firstDay(eng, crop) {
    const ids = P.place === 'beds' ? [] : P.gardenIds.length ? P.gardenIds : S.gardensFor(eng, crop).slice(0, 1).map(g => g.garden.id);
    const bed = P.place === 'beds' ? eng.bedOf(P.bedIds[0]) : S.spaces(eng, crop, ids)[0], year = App.planYear();
    const floors = bed ? [eng.firstFieldDate(crop, bed, year), eng.fieldPlantingWindow(bed, year).from].filter(E.validDate) : [];
    return E.d2s(new Date(Math.max(+App.state.date, ...floors.map(d => +d))));
  }
  /** Start the form from what it was opened on: a planting to copy, a crop, a bed, a garden, a day. */
  function seed(focus) {
    const eng = App.state.engine, crops = seriesCrops(eng), ok = c => !!c && crops.includes(c);
    const source = focus.sourceId ? eng.planting(focus.sourceId) : null, bed = focus.bedId ? eng.bedOf(focus.bedId) : null, used = new Set(App.state.plan.plantings.map(p => p.cropId));
    let crop = eng.crop(source ? source.cropId : focus.cropId);
    // opened on a bed: the crop last planned there, when it can be had in a series
    if (!ok(crop) && bed) crop = eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r && ok(eng.crop(x.p.cropId))).sort((a, b) => b.r.field - a.r.field).map(x => eng.crop(x.p.cropId))[0];
    if (!ok(crop)) crop = [eng.crop(P.cropId), crops.find(c => used.has(c.id) && c.id === 'radish'), crops.find(c => used.has(c.id)), crops[0]].find(ok);
    Object.assign(P, { cropId: crop ? crop.id : '', varietyId: source ? source.varietyId || '' : focus.varietyId || '', sourceId: source && ok(crop) ? source.id : '', place: 'gardens', gardenIds: [], bedIds: [], from: '', done: null, unit: 'whole', amount: 1, roomAll: false });
    if (!crop) return;
    const gardens = S.gardensFor(eng, crop), r = source ? eng.calc(source) : null;
    if (source && r) { P.gardenIds = [r.b.gardenId]; P.every = everyFor(crop, source, r); P.from = E.d2s(E.addDays(r.field, +P.every)); }
    else {
      const planted = gardens.filter(g => g.planted);
      // grown nowhere yet: the first garden it can go in, so the form opens on a series to look at and not on a complaint
      P.gardenIds = (planted.length ? planted : gardens.slice(0, 1)).map(g => g.garden.id);
      // where the crop is grown in towers, a new series follows the cycle those plantings use
      const like = S.models(eng, crop.id).find(m => planted.length && m.r.kind === planted[0].kind && m.r.kind !== 'bed');
      if (like) P.sourceId = like.p.id;
      P.every = everyFor(crop, null, null);
    }
    if (focus.gardenId && gardens.some(g => g.garden.id === focus.gardenId)) P.gardenIds = [focus.gardenId];
    if (bed) { P.gardenIds = gardens.some(g => g.garden.id === bed.gardenId) ? [bed.gardenId] : P.gardenIds; if (S.suits(eng, crop, bed)) { P.place = 'beds'; P.bedIds = [bed.id]; } }
    if (focus.from && E.validDate(E.s2d(focus.from))) P.from = focus.from;
    if (!P.from) P.from = firstDay(eng, crop);
  }
  /** Another crop in the same form: where it goes is kept as far as that crop can go there. */
  function changeCrop(id) {
    const eng = App.state.engine, crop = eng.crop(id), keep = { place: P.place, bedIds: P.bedIds, gardenIds: P.gardenIds, from: P.from };
    if (!crop) return;
    seed({ cropId: id });
    const gardens = new Set(S.gardensFor(eng, crop).map(g => g.garden.id)), beds = keep.bedIds.filter(b => S.suits(eng, crop, eng.bedOf(b))), mine = keep.gardenIds.filter(g => gardens.has(g));
    if (keep.place === 'hold') P.place = 'hold';
    else if (keep.place === 'beds' && beds.length) { P.place = 'beds'; P.bedIds = beds; }
    if (mine.length && keep.place !== 'beds') P.gardenIds = mine;
    if (keep.from && E.s2d(keep.from) >= E.s2d(firstDay(eng, crop))) P.from = keep.from;
  }
  function input(model) {
    const rows = model ? model.rows.filter(r => r.cropId === P.cropId) : [];
    return { cropId: P.cropId, varietyId: P.varietyId || undefined, sourceId: P.sourceId || undefined, place: P.place, gardenIds: P.gardenIds, bedIds: P.bedIds, basis: P.basis, from: P.from, every: P.every, unit: P.unit, amount: P.amount,
      ...(P.endMode === 'count' ? { count: P.count } : { to: P.to }), skipCovered: P.skipCovered, covered: model ? d => { const i = model.index(d); return i >= 0 && i < model.days && rows.some(r => r.days[i] > 1e-9); } : undefined };
  }
  // The series worked out for the form as it stands, kept until the form or the plan changes: the panel, the timeline's ghost
  // bars and the map all read the same one.
  let memo = { eng: null, key: '', result: null };
  function current() {
    if (!App.state.ready) return null;
    const eng = App.state.engine;
    if (!eng.crop(P.cropId)) seed({});
    if (!eng.crop(P.cropId)) return null;
    const copied = P.sourceId ? eng.planting(P.sourceId) : null;
    if (P.sourceId && !(copied && copied.cropId === P.cropId)) P.sourceId = '';
    P.bedIds = P.bedIds.filter(id => eng.bedOf(id));
    const key = JSON.stringify([P.cropId, P.varietyId, P.sourceId, P.place, P.gardenIds, P.bedIds, P.basis, P.from, P.endMode, P.count, P.to, P.every, P.unit, P.amount, P.skipCovered]);
    if (memo.eng !== eng || memo.key !== key) memo = { eng, key, result: S.series(eng, input(P.skipCovered ? forecast(eng) : null)) };
    return memo.result;
  }
  /** What the series tool would add, for the timeline and the map to draw: null unless the tool is open with something to show. */
  function ghosts() {
    if (!isOpen() || P.done) return null;
    const r = current(), ok = r && !r.error;
    return { placed: ok ? r.waves.flatMap(w => w.placed) : [], held: ok ? r.held : [], named: P.place === 'beds' ? P.bedIds.slice() : [] };
  }
  const picking = () => isOpen() && !P.done && P.place === 'beds';
  let redrawPanel = null;
  const refresh = () => { if (redrawPanel) redrawPanel(); App.emit('ghost'); };
  /** A click on a bed while the tool is asking for beds: name it, or take it off the list. True when the click was used. */
  function toggleBed(bedId) {
    const eng = App.state.engine, bed = eng.bedOf(bedId), crop = eng.crop(P.cropId);
    if (!picking() || !bed || !crop) return false;
    if (!S.suits(eng, crop, bed)) { toast(`${crop.name} cannot go in ${App.bedLabel(bed)}.`); return true; }
    P.bedIds = P.bedIds.includes(bedId) ? P.bedIds.filter(id => id !== bedId) : [...P.bedIds, bedId];
    refresh();
    return true;
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
    return h('div.ah-strip.sr-strip', { id: 'srStrip', role: 'img', 'aria-label': `Weeks with a harvest: ${cols.filter(c => now.some(r => F.sum(r.days, c.i0, c.i1) > 1e-9)).length} now, ${cols.filter(c => then.some(r => F.sum(r.days, c.i0, c.i1) > 1e-9)).length} with this series` },
      h('div.ah-strip-row', h('span', 'Now'), cells(now, null)),
      h('div.ah-strip-row', h('span', 'Then'), cells(then, now)),
      h('p.help', `Weeks with a harvest, ${day(cols[0].start)} to ${day(cols[cols.length - 1].start)}. ${gapsThen.length ? `${plural(gapsThen.length, 'gap')} left${gapsNow.length ? ` (${num(gapsNow.length)} now)` : ''}.` : now.length && gapsNow.length ? `Closes ${plural(gapsNow.length, 'gap')}.` : 'No week without one between the first and the last.'}`));
  }

  /** "Where on the farm could this crop go, and when?": openings its whole cycle fits, and beds with nothing planned. */
  function roomList(eng, crop) {
    const found = S.room(eng, crop.id, { varietyId: P.varietyId || undefined }), shown = P.roomAll ? found.openings : found.openings.slice(0, 8), out = [];
    const go = o => { const A = root.LRFAhead; if (A) Object.assign(A.state.O, { key: o.id, pick: { cropId: crop.id, varietyId: P.varietyId || '', date: '', ft: '' }, all: false }); App.select({ type: 'opening', id: o.id, bedId: o.bed.id }); };
    for (const x of shown) out.push(h('button.p-open', { type: 'button', dataset: { roomOpening: x.opening.id }, title: `${lower(crop)} fits here: in from ${day(x.earliest)}, first harvest ${day(x.first)}. Click to see this opening.`, onclick: () => go(x.opening) },
      h('b', span(x.opening.from, x.opening.to)), h('span', `${spaceName(x.opening.bed, eng)}${x.opening.whole ? '' : ` · ${num(x.opening.length, 1)} ft`}`), h('small', `${num(x.opening.days)} d`)));
    if (found.openings.length > shown.length) out.push(h('button.ah-more', { type: 'button', id: 'srRoomMore', onclick: () => { P.roomAll = true; redrawPanel(); } }, `+${num(found.openings.length - shown.length)} more`));
    if (!found.openings.length) out.push(h('p.note.sr-none', { id: 'srRoomNone' }, `No opening between planned crops is long enough for ${lower(crop)}.`));
    if (found.empty.length) out.push(h('p.help', { id: 'srRoomEmpty' }, `Nothing planned all year: ${found.empty.map(g => `${g.garden.name} (${plural(g.beds.length, 'bed')})`).join(', ')}.`));
    out.push(h('p.help', 'Ground beds only. An opening is listed when the whole crop fits in it: growing, harvest and turnover, in season.'));
    return out;
  }

  /** Draw the series tool into the details panel. */
  function panel(host, redraw) {
    redrawPanel = redraw;
    const eng = App.state.engine, result = current(), crop = eng.crop(P.cropId), close = () => { const back = P.back; P.back = null; App.select(back && ((back.type === 'planting' && eng.planting(back.id)) || (back.type === 'bed' && eng.bedOf(back.id))) ? back : null); };
    const x = h('button.icon-btn.close', { type: 'button', id: 'srClose', 'aria-label': 'Close', title: 'Close. Nothing is added.', onclick: close }, '×');
    if (!crop) { add(host, h('header.insp-head', h('p.eyebrow', 'A series'), h('h2', 'Plan a series'), x), h('p.note', 'There is no crop to plan a series of yet.')); return true; }
    const set = change => { Object.assign(P, change, { done: null }); refresh(); };
    const crops = seriesCrops(eng), mine = new Set(S.candidates(eng, true).map(c => c.id)), used = new Set(App.state.plan.plantings.map(p => p.cropId)), own = c => used.has(c.id) || mine.has(c.id), color = eng.cropColor(crop);
    const gardens = S.gardensFor(eng, crop), chosen = new Set(P.gardenIds), models = S.models(eng, crop.id);
    // a series started from one planting copies that planting, whether or not it is the latest of its kind
    const copied = P.sourceId ? eng.planting(P.sourceId) : null;
    if (copied && copied.cropId === crop.id && !models.some(m => m.p.id === copied.id) && eng.calc(copied)) models.unshift({ p: copied, r: eng.calc(copied) });
    const kind = P.place === 'beds' && P.bedIds.length ? eng.spaceKind(eng.bedOf(P.bedIds[0])) : (gardens.find(g => chosen.has(g.garden.id)) || gardens[0] || {}).kind || 'bed';

    const cropSel = h('select', { id: 'srCrop', onchange: e => { changeCrop(e.target.value); refresh(); } },
      h('optgroup', { label: 'Crops you grow' }, crops.filter(own).map(c => h('option', { value: c.id, selected: c.id === crop.id }, c.name))),
      h('optgroup', { label: 'Every other crop' }, crops.filter(c => !own(c)).map(c => h('option', { value: c.id, selected: c.id === crop.id }, c.name))));
    const varSel = h('select', { id: 'srVariety', onchange: e => set({ varietyId: e.target.value }) }, h('option', { value: '' }, P.sourceId ? 'As in the planting copied' : 'No variety chosen'), eng.varietiesOf(crop.id).map(v => h('option', { value: v.id, selected: v.id === P.varietyId }, v.name)));
    const endDefault = () => P.to || E.d2s(E.addDays(E.validDate(E.s2d(P.from)) ? E.s2d(P.from) : App.state.date, 56));
    const where = h('div.seg.sr-place', { role: 'group', 'aria-label': 'Where the plantings go', id: 'srPlace' },
      [['gardens', 'Gardens', 'Each goes into the first free space of the gardens ticked'], ['beds', 'Beds', 'Each goes into the first free one of the beds you name'], ['hold', 'To place', 'None is given a bed: they wait to be dragged onto beds']].map(([id, name, title]) =>
        h('button', { type: 'button', dataset: { place: id }, 'aria-pressed': String(P.place === id), title, onclick: () => set({ place: id }) }, name)));
    let whereBody;
    if (P.place === 'gardens') whereBody = h('div.ah-gardens', { id: 'srGardens' }, gardens.length ? gardens.map(g => h('label', h('input', { type: 'checkbox', value: g.garden.id, checked: chosen.has(g.garden.id), onchange: e => { const next = new Set(P.gardenIds); if (e.target.checked) next.add(g.garden.id); else next.delete(g.garden.id); set({ gardenIds: gardens.map(v => v.garden.id).filter(id => next.has(id)) }); } }),
      h('span', g.garden.name), h('small', `${num(g.spaces)} ${g.kind === 'bed' ? 'bed' : g.kind === 'tower' ? 'tower' : 'group'}${g.spaces === 1 ? '' : 's'}${g.planted ? ' · grown here' : ''}`))) : h('p.help', 'No garden has ground this crop can go in.'));
    else if (P.place === 'beds') {
      const options = App.state.plan.gardens.filter(g => g.active !== false).map(g => [g, App.state.plan.beds.filter(b => b.gardenId === g.id && S.suits(eng, crop, b) && !P.bedIds.includes(b.id)).sort((a, b) => natural(a.bed, b.bed))]).filter(([, list]) => list.length);
      whereBody = h('div.sr-beds', { id: 'srBeds' },
        P.bedIds.length ? h('div.sr-chips', P.bedIds.map(id => { const b = eng.bedOf(id); return h('span.sr-chip', { dataset: { bed: id } }, spaceName(b, eng), h('button', { type: 'button', 'aria-label': `Take ${App.bedLabel(b)} off the list`, title: 'Take off the list', onclick: () => set({ bedIds: P.bedIds.filter(v => v !== id) }) }, '×')); })) : null,
        h('select', { id: 'srBedAdd', 'aria-label': 'Add a bed', onchange: e => { if (e.target.value) set({ bedIds: [...P.bedIds, e.target.value] }); } }, h('option', { value: '' }, P.bedIds.length ? 'Add another…' : 'Choose a bed…'), options.map(([g, list]) => h('optgroup', { label: g.name }, list.map(b => h('option', { value: b.id }, `${KIND[eng.spaceKind(b)] || ''} ${b.bed}`.trim())))) ),
        h('p.help', 'Or click beds on the map, or rows on the timeline. Each planting takes the first of these that is free, in this order.'));
    } else whereBody = h('p.help.sr-holdnote', { id: 'srHoldNote' }, 'None gets a bed now. Each waits under “To place” on its own date, to be dragged onto a bed, and counts toward nothing until then: not seeds, sowing, benches or the forecast.');
    const unitWord = kind === 'tower' ? 'whole towers' : kind === 'containers' ? 'whole groups' : 'whole beds';
    const modelSel = models.length ? h('select', { id: 'srModel', onchange: e => set({ sourceId: e.target.value }) }, h('option', { value: '' }, 'The crop’s own figures'),
      models.map(m => h('option', { value: m.p.id, selected: m.p.id === P.sourceId }, `Like ${App.bedLabel(m.r.b)}, ${day(m.r.field)}${m.r.c.vname ? ' · ' + m.r.c.vname : ''} (${num(E.dayDiff(m.r.first, m.r.field))} days, picked ${num(m.r.harvestDays)})`))) : null;

    add(host,
      h('header.insp-head.planting', { style: { '--crop': color } }, T.el({ varietyId: P.varietyId || undefined, cropId: crop.id, color, label: crop.name, size: 64, cls: 'head' }),
        h('p.eyebrow', 'A series'), h('h2', { id: 'srTitle' }, `${crop.name} every ${num(+P.every || 0)} days`), x),
      h('section.insp-section.form', { id: 'srForm' },
        field('Crop', cropSel), field('Variety', varSel),
        h('div.field-pair', field(P.basis === 'harvest' ? 'First harvest on' : 'First one goes in', h('input', { type: 'date', id: 'srFrom', value: P.from, onchange: e => set({ from: e.target.value }) })),
          field('Then every (days)', h('input', { type: 'number', id: 'srEvery', min: 1, max: 366, step: 1, value: P.every, onchange: e => set({ every: e.target.value }) }))),
        h('div.field-pair', field('How many', h('select', { id: 'srEnd', onchange: e => set({ endMode: e.target.value, to: endDefault() }) }, h('option', { value: 'count', selected: P.endMode === 'count' }, 'This many'), h('option', { value: 'to', selected: P.endMode === 'to' }, 'Until a date'))),
          P.endMode === 'count' ? field('Plantings', h('input', { type: 'number', id: 'srCount', min: 1, max: S.LIMIT, step: 1, value: P.count, onchange: e => set({ count: e.target.value }) }))
            : field('Last one by', h('input', { type: 'date', id: 'srTo', value: P.to, onchange: e => set({ to: e.target.value }) }))),
        h('div.field-pair', field('Each one takes', h('input', { type: 'number', id: 'srAmount', min: 1, max: 2000, step: 1, value: P.amount, onchange: e => set({ amount: e.target.value }) })),
          field('Of', kind === 'bed' ? h('select', { id: 'srUnit', onchange: e => set({ unit: e.target.value, amount: e.target.value === 'ft' ? 30 : 1 }) }, h('option', { value: 'whole', selected: P.unit === 'whole' }, 'whole beds'), h('option', { value: 'ft', selected: P.unit === 'ft' }, 'feet of bed')) : h('input', { type: 'text', value: unitWord, disabled: true, id: 'srUnitWord' }))),
        h('div.field', h('span', 'Where they go'), where), whereBody,
        h('button.linkish.sr-moretoggle', { type: 'button', id: 'srMore', 'aria-expanded': String(P.more), onclick: () => { P.more = !P.more; redraw(); } }, P.more ? 'Fewer settings' : 'More settings'),
        P.more ? h('div.sr-more', { id: 'srMoreBody' },
          modelSel ? field('Days and settings', modelSel) : null,
          h('div.field', h('span', 'Dates are for'), h('div.seg', { role: 'group' },
            h('button', { type: 'button', 'aria-pressed': String(P.basis === 'planting'), id: 'srBasisPlant', onclick: () => set({ basis: 'planting' }) }, 'Going in'),
            h('button', { type: 'button', 'aria-pressed': String(P.basis === 'harvest'), id: 'srBasisHarvest', onclick: () => set({ basis: 'harvest' }) }, 'First harvest')),
            h('small', 'Either way the plantings are the same number of days apart; this only says what the first date means.')),
          h('label.ah-check', h('input', { type: 'checkbox', id: 'srSkip', checked: P.skipCovered, onchange: e => set({ skipCovered: e.target.checked }) }), h('span', `Leave one out when ${lower(crop)} is already being picked on the day it would first be ready`))) : null));

    // what it comes to
    const out = h('section.insp-section.sr-out', { id: 'srOut' }, h('h3', 'What it comes to'));
    if (P.done) {
      const { n, m } = P.done;
      add(out, h('p.sr-sum', { id: 'srDone' }, [n ? `Added ${plural(n, 'planting')}.` : '', m ? `${plural(m, 'planting')} ${m === 1 ? 'waits' : 'wait'} under “To place”: not counted until ${m === 1 ? 'it is' : 'they are'} on a bed.` : ''].filter(Boolean).join(' ')),
        h('div.sr-actions', h('button.btn', { type: 'button', id: 'srUndo', onclick: () => { App.undo(); P.done = null; refresh(); } }, 'Undo'), h('button.btn.primary', { type: 'button', id: 'srAgain', onclick: () => { P.done = null; refresh(); } }, 'Plan another'),
          App.state.view !== 'timeline' ? h('button.linkish', { type: 'button', id: 'srSee', onclick: () => App.setView('timeline') }, 'See them on the timeline') : null));
    } else if (!result || result.error) add(out, h('p.sr-sum.bad', { id: 'srError' }, (result && result.error) || 'Choose a crop.'));
    else {
      const n = result.plantings.length, m = result.held.length, total = result.waves.length, group = F.groupOf(crop, result.unit, (App.state.plan.lrfNext || {}).groups);
      const said = [n ? `${plural(n, 'planting')} onto ${P.place === 'beds' ? 'the beds named' : 'beds'}` : '', m ? `${plural(m, 'planting')} to place, with no bed yet` : ''].filter(Boolean).join('; ');
      add(out, h('p.sr-sum', { id: 'srSum' }, n || m ? `${said}.${n ? ` Harvest ${span(result.firstHarvest, result.lastHarvest)}${result.units > 0 ? `, about ${F.amount(result.units, result.unit, group)}` : ''}.` : ''}${result.skipped ? ` ${num(result.skipped)} left out: already being picked then.` : ''}`
        : result.skipped === total ? `Nothing to add: ${lower(crop)} is already being picked on every one of those days.` : 'None of these can be placed, and nothing is held to place later.'));
      const rows = result.waves.map(w => {
        const head = h('b', day(w.target));
        if (w.skipped) return h('li.skip', head, h('span', `Left out: already being picked ${day(w.firstHarvest)}`));
        const first = w.placed[0], placedText = w.placed.map(v => `${spaceName(v.bed, eng)}${v.r.tw || v.r.physicalLength >= v.r.cap - 1e-6 ? '' : ` (${num(v.r.physicalLength, 1)} ft)`}`).join('; ');
        const why = w.why.map(v => `${v.why}${v.spaces > 1 ? ` (${num(v.spaces)} spaces)` : ''}`).join(' · ');
        const heldText = w.held.length ? `${w.placed.length ? `${w.held.length === 1 && w.held[0].ft ? `${num(w.held[0].ft, 1)} ft more` : plural(w.held.length, 'more')} to place` : w.held.length === 1 ? (w.held[0].ft ? `${num(w.held[0].ft, 1)} ft, to place` : 'To place') : `${num(w.held.length)} to place`}` : w.short > 1e-6 ? 'No room, and not held' : '';
        return h('li' + (w.held.length || w.short > 1e-6 ? '.wait' : ''), { dataset: { wave: w.k + 1 } }, head,
          h('span', placedText || null, placedText && heldText ? h('br') : null, heldText ? h('em', heldText) : null, heldText && why && P.place !== 'hold' ? h('small', why) : null),
          first ? h('small.sr-when', `${first.r.sow ? `sow ${day(first.r.sow)} · ` : ''}pick ${day(first.r.first)}${E.d2s(first.r.field) !== E.d2s(w.target) ? ` · in ${day(first.r.field)}` : ''}`) : w.held[0] && w.held[0].date !== E.d2s(w.target) ? h('small.sr-when', `in ${day(E.s2d(w.held[0].date))}`) : null);
      });
      add(out, h('ol.sr-waves', { id: 'srWaves' }, rows));
      if (n) {
        const model = forecast(eng), plan2 = { ...App.state.plan, plantings: [...App.state.plan.plantings, ...result.plantings] }, eng2 = E.create(plan2, Lib), strip = coverage(model, F.build(eng2, { year: App.planYear() }), crop.id);
        if (strip) add(out, strip);
        if (result.plantings.some(p => { const r = eng2.calc(p); return r && r.sow; })) {
          const was = S.benchRoom(eng), will = S.benchRoom(eng2);
          if (will.cap && will.least) add(out, h('p.help', { id: 'srBench' }, `Heated benches with these seedlings: ${num(Math.floor(will.least.free))} of ${num(will.cap)} tray spaces free in the tightest week (${day(will.least.start)})${was.least ? `; ${num(Math.floor(was.least.free))} now` : ''}.`));
        }
      }
      if (m) add(out, h('p.help', { id: 'srHeldNote' }, `What waits to be placed is in none of these figures${n ? '' : ', and none is worked out for it'}: it counts once it is on a bed.`));
      const label = n && m ? `Add ${num(n)}, and ${num(m)} to place` : n ? `Add ${plural(n, 'planting')}` : m ? `Add ${num(m)} to place` : 'Nothing to add';
      add(out, h('div.sr-actions',
        h('button.btn.primary', { type: 'button', id: 'srAdd', disabled: !(n || m), onclick: () => {
          P.done = { n, m };
          if (!App.addSeries(result, `Add a series of ${lower(crop)}: ${[n ? plural(n, 'planting') : '', m ? `${num(m)} to place` : ''].filter(Boolean).join(', ')}`)) { P.done = null; return; }
          toast([n ? `Added ${plural(n, 'planting')} of ${lower(crop)}` : '', m ? `${num(m)} ${n ? 'more ' : ''}${lower(crop)} to place` : ''].filter(Boolean).join(' · '), { label: 'Undo', run: () => { App.undo(); P.done = null; refresh(); } });
          refresh();
        } }, label),
        App.state.view !== 'timeline' ? h('button.linkish', { type: 'button', id: 'srSee', onclick: () => { App.setView('timeline'); requestAnimationFrame(() => root.LRFTimeline.showGhosts()); } }, 'See it on the timeline')
          : h('small', 'Dashed on the timeline: ', h('button.linkish', { type: 'button', id: 'srFind', onclick: () => { if (!root.LRFTimeline.showGhosts()) toast('They are in a part of the timeline that is filtered out or folded shut.'); } }, 'show me'), '. Nothing is added yet.')),
        h('p.help', 'One step, and it can be undone. A date is never moved to make a planting fit.'));
    }
    add(host, out,
      h('section.insp-section', { id: 'srRoom' },
        h('button.linkish.sr-roomtoggle', { type: 'button', id: 'srRoomToggle', 'aria-expanded': String(P.room), onclick: () => { P.room = !P.room; redraw(); } }, h('span.caret', P.room ? '▾ ' : '▸ '), `Where could ${lower(crop)} go this season?`),
        P.room ? roomList(eng, crop) : null));
    return true;
  }
  /** Open the series tool with something in mind: { sourceId? | cropId?, varietyId?, bedId?, gardenId?, from? }. */
  function open(focus) {
    if (!App.state.ready) return;
    const sel = App.state.sel, eng = App.state.engine, from = focus && focus.sourceId ? eng.planting(focus.sourceId) : null, asked = eng.crop(from ? from.cropId : focus && focus.cropId);
    // a crop named that the tool does not plan is said so: the form never opens on some other crop in its place
    if (asked && !seriesCrops(eng).includes(asked)) { toast(asked.micro ? `${asked.name} is planned from weekly demand, on the Trays view, not as a series.` : `${asked.name} has no harvest to space a series by. Use “more, every so many days” on one of its plantings.`); return; }
    P.back = sel && (sel.type === 'planting' || sel.type === 'bed') ? sel : null;
    seed(focus || {});
    if (!['map', 'timeline'].includes(App.state.view)) App.setView('timeline');
    App.select({ type: 'series' });
  }

  // ───────────────────────────── a planting with no bed yet, in the details panel ─────────────────────────────
  const W = { key: '', all: false };
  function waitingPanel(host, sel, redraw) {
    const eng = App.state.engine, w = App.waitingOne(sel.id);
    if (!w) return false;
    if (W.key !== w.id) Object.assign(W, { key: w.id, all: false });
    const crop = eng.crop(w.cropId) || { name: 'Crop' }, v = eng.variety(w.varietyId), color = eng.cropColor(crop), a = S.about(eng, w), wait = w.wait || {}, date = E.s2d(w.date);
    const mates = wait.s ? App.waiting().filter(q => q.wait && q.wait.s === wait.s) : [w];
    const set = (change, label) => { if (!App.updateWaiting(w.id, change, label)) redraw(); };
    const variety = h('select', { id: 'wtVariety', onchange: e => set({ varietyId: e.target.value || null }, 'Change variety') }, h('option', { value: '' }, 'No variety chosen'), eng.varietiesOf(w.cropId).map(q => h('option', { value: q.id, selected: q.id === w.varietyId }, q.name)));
    if (v && !eng.varietiesOf(w.cropId).includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    const homes = S.homes(eng, w), shown = W.all ? homes : homes.slice(0, 8), r = a && a.r;
    add(host,
      h('header.insp-head.planting', { style: { '--crop': color } }, T.el({ varietyId: w.varietyId, cropId: w.cropId, color, label: (v && v.name) || crop.name, size: 64, cls: 'head' }),
        h('p.eyebrow', { title: wait.of > 1 ? `Number ${num(wait.k)} of a series of ${num(wait.of)}, ${num(wait.every)} days apart` : '' }, `No bed yet${wait.of > 1 ? ` · ${num(wait.k)} of ${num(wait.of)}` : ''}`), h('h2', { id: 'wtTitle' }, v && v.name ? `${crop.name} · ${v.name}` : crop.name),
        h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select(null) }, '×')),
      h('p.wt-note', { id: 'wtNote' }, 'It counts toward nothing until it is on a bed: not seeds required, the sowing lists, the benches or the forecast.'),
      h('section.insp-section.form',
        h('div.field-pair', field(r && r.c.method !== 'TP' ? 'Sowing date' : 'Goes in', h('input', { type: 'date', id: 'wtDate', value: w.date, onchange: e => { if (E.validDate(E.s2d(e.target.value))) set({ date: e.target.value }, 'Change date'); else redraw(); } })),
          field('Length (ft)', h('input', { type: 'number', id: 'wtFt', min: 1, max: 2000, step: 0.5, value: w.ft > 0 ? w.ft : '', placeholder: 'Whole bed', onchange: e => set({ ft: +e.target.value > 0 ? +e.target.value : null }, 'Change length') }))),
        field('Variety', variety)),
      r ? h('section.insp-section', h('h3', 'Its days'),
        h('ol.schedule', { id: 'wtSched' }, r.sow ? h('li', h('span', 'Sow in nursery'), h('b', day(r.sow))) : null, h('li', h('span', r.c.method === 'TP' ? 'Transplant' : 'Direct sow'), h('b', day(r.field))),
          h('li', h('span', 'First harvest'), h('b', day(r.first))), h('li', h('span', 'Last harvest'), h('b', r.harvestDays ? day(r.last) : 'None before the season ends'))),
        h('p.help', `Worked out as if in ${spaceName(a.bed, eng)}. The bed it goes to decides.`)) : null,
      h('section.insp-section', { id: 'wtHomes' }, h('h3', homes.length ? `Free for it on ${day(date)} · ${num(homes.length)}` : `Free for it on ${day(date)}`),
        homes.length ? [shown.map(x => h('button.p-open', { type: 'button', dataset: { home: x.bed.id }, title: `Place it here: ${App.bedLabel(x.bed)}, harvest ${span(x.r.first, x.r.last)}`, onclick: () => App.placeWaiting(w.id, x.bed.id) },
          h('b', `${KIND[eng.spaceKind(x.bed)] || ''} ${x.bed.bed}`.trim()), h('span', (x.garden || {}).name || ''), h('small', x.wanted ? 'where it was sent' : ''))),
          homes.length > shown.length ? h('button.ah-more', { type: 'button', id: 'wtMore', onclick: () => { W.all = true; redraw(); } }, `+${num(homes.length - shown.length)} more`) : null,
          h('p.help', 'Click one to place it there, or drag it onto any bed. A bed that holds one other crop then can be shared: drop it there to choose how.')]
          : h('p.note.sr-none', { id: 'wtNoHome' }, 'No space is free for all of its days, in season. Drag it onto a bed to share one, or change its date.'),
        wait.why ? h('p.help', { id: 'wtWhy' }, `Why it waits: ${wait.why.charAt(0).toLowerCase()}${wait.why.slice(1)} in the ${wait.beds ? 'beds' : 'gardens'} it was sent to.`) : null),
      h('div.insp-actions.wt-actions', h('button.btn.danger', { type: 'button', id: 'wtRemove', onclick: () => App.removeWaiting([w.id]) }, 'Remove'),
        mates.length > 1 ? h('button.linkish', { type: 'button', id: 'wtRemoveAll', onclick: () => App.removeWaiting(mates.map(q => q.id), `Remove ${plural(mates.length, 'planting')} of a series, not yet placed`) }, `Remove all ${num(mates.length)} of this series still to place`) : null));
    return true;
  }

  // ───────────────────────────── "To place": the list above the crop library, and the count in the header ─────────────────────────────
  let boxOpen = true;
  function drawBox() {
    const box = $('waitBox'), badge = $('waitBadge');
    if (!box || !App.state.ready) return;
    const eng = App.state.engine, list = App.waiting().slice().sort((a, b) => a.date.localeCompare(b.date) || natural((eng.crop(a.cropId) || {}).name, (eng.crop(b.cropId) || {}).name)), n = list.length, sel = App.state.sel;
    badge.hidden = !n;
    if (n) { clear(badge); add(badge, h('b', num(n)), ' to place', h('span.wb-more', ' · not counted here')); badge.title = `${plural(n, 'planting')} of a series ${n === 1 ? 'has' : 'have'} no bed yet. ${n === 1 ? 'It is' : 'They are'} not counted in seeds required, the sowing lists, bench load or the forecast until placed. Click to see ${n === 1 ? 'it' : 'them'}.`; }
    box.hidden = !n; clear(box);
    if (!n) return;
    add(box, h('button.wait-head', { type: 'button', id: 'waitHead', 'aria-expanded': String(boxOpen), title: 'Plantings a series made that have no bed yet', onclick: () => { boxOpen = !boxOpen; drawBox(); } },
      h('span.caret', boxOpen ? '▾' : '▸'), h('b', 'To place'), h('small', num(n)), h('em', 'not counted until placed')));
    if (!boxOpen) return;
    const rows = h('div.wait-list', { id: 'waitList' });
    for (const w of list) {
      const c = eng.crop(w.cropId) || { name: 'Crop' }, v = eng.variety(w.varietyId), wait = w.wait || {};
      rows.append(h('div.lib-row.wait-row' + (sel && sel.type === 'waiting' && sel.id === w.id ? '.armed' : ''), { dataset: { waiting: w.id }, role: 'button', tabindex: 0, title: `${App.cropLabel(w)} · goes in ${day(E.s2d(w.date))}${wait.of > 1 ? ` · ${num(wait.k)} of ${num(wait.of)}` : ''}\nDrag onto a bed. It keeps its date.` },
        T.el({ varietyId: w.varietyId, cropId: w.cropId, color: eng.cropColor(c), label: c.name, size: 24, cls: 'key' }),
        h('b.lib-name', v && v.name ? `${c.name} · ${v.name}` : c.name), h('span.lib-count', day(E.s2d(w.date)))));
    }
    add(box, rows);
  }
  function initBox() {
    const box = $('waitBox');
    let press = null;
    box.addEventListener('pointerdown', e => {
      press = { x: e.clientX, y: e.clientY };
      const row = e.target.closest('.wait-row'), w = row && App.waitingOne(row.dataset.waiting), c = w && App.state.engine.crop(w.cropId);
      if (c) root.LRFDrag.watch(e, { payload: { waitingId: w.id }, label: App.cropLabel(w), color: App.state.engine.cropColor(c) });
    });
    // a click shows it in the details panel and turns the map to its day, so what is free then can be seen
    const pick = e => { const row = e.target.closest('.wait-row'), w = row && App.waitingOne(row.dataset.waiting); if (!w) return; App.setDate(E.s2d(w.date)); App.select({ type: 'waiting', id: w.id }); };
    box.addEventListener('click', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return; pick(e); });
    box.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.wait-row')) { e.preventDefault(); pick(e); } });
    $('waitBadge').addEventListener('click', () => {
      if (!['map', 'timeline'].includes(App.state.view)) App.setView('timeline');
      boxOpen = true; drawBox();
      const el = $('waitBox'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
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
    let was = false;
    App.on('plan', drawBox);
    App.on('sel', () => { drawBox(); const now = isOpen(); if (now !== was) { was = now; App.emit('ghost'); } if (!now) redrawPanel = null; });
    App.on('view', () => { if (isOpen() && !['map', 'timeline'].includes(App.state.view)) App.select(null); });
  }
  root.LRFSeries = { init, open, panel, waitingPanel, ghosts, picking, toggleBed, share, drawBox, state: { P } };
})(window);
