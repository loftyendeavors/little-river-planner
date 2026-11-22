/* Little River Farm Planner — the Successions page: a run of whole beds, planned and kept as one (E4, #90 section 9, #102).
 *
 *   The runs      listed at the left: the one being planned, and each run the plan keeps (lrfNext.runs). "New run" starts one.
 *   01 What       the crop, its variety, and Plan by: one whole bed each sowing every so many days, or a weekly amount, with
 *                 a margin. A sowing is always one whole bed: to reach an amount the spacing changes, never the size.
 *   02 When       whether the dates are for picking or for planting, the first and the last, and the spacing it comes to.
 *   03 Where      the garden the sowings go to, how many of its beds the run takes, and the gardens to go on to if it runs out
 *                 of room.
 *   What it would plant   the run's own amount each week against what is wanted, its average and the weeks that come up short;
 *                 then one row a bed: a strip of the season, and Sow, Plant and First pick in ruled columns. A row can be
 *                 dropped. The last sowing's overshoot is planted and said. "Add N plantings" adds the run as one step with one
 *                 Undo; nothing is added before it.
 *   A kept run    opens to its plantings, each a link to the planting. "Remove run" takes the run's record out and keeps its
 *                 plantings as plain plantings, unless asked to take them too; one Undo puts it back.
 *
 * Every figure is the solver's (LRFSuccession.planRun), which asks the engine and the forecast for each: nothing here works a
 * figure out. Desktop only: a phone shows Tasks. Ways in, ready filled: a bed or an opening, a crop in the library, a planting,
 * and a week of a crop on the Forecast (App.openAhead({ mode: 'succession', … })).
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, S = root.LRFSuccession, F = root.LRFForecast, T = root.LRFThumbs;
  const { h, clear, add, num, day } = UI;
  const $ = id => document.getElementById(id);
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || (one === 'bench' ? 'benches' : one + 's')}`;
  const lower = c => String((c && c.name) || 'crop').toLowerCase();
  const iso = d => (E.validDate(d) ? E.d2s(d) : '');

  // ── what is on the page ──
  // D: the run being planned, as the solver is asked it. pick: what the main part shows, 'draft' or a kept run's id.
  // answer: the one answer to the last action taken here (Add, Remove), with its Undo. shown: the run being planned is drawn on
  // the Timeline as ghosts, after "See them on the Timeline", until it is added, cancelled or opened here again.
  const D = { cropId: '', varietyId: '', thing: '', by: 'amount', want: '', margin: 0, every: 14, datesFor: 'picking', from: '', to: '', gardenId: '', kind: 'bed', sourceId: '', then: [], drop: [], fresh: true };
  // planning: a run is being planned (the page opened on one, or New run); after Add or Cancel none is, until New run
  const UI_STATE = { pick: 'draft', answer: null, shown: false, removeAll: false, planning: true };
  let dirty = true;

  /** Bench sowings are repeated from a manual planting. Nursery demand owns its automatic batches. */
  function plans(eng, crop, planting) {
    if (!crop || eng.isCoverCrop(crop) || eng.isPerennial(crop) || planting?.established || planting?.liveTray) return false;
    if (crop.micro) return !!planting && S.suits(eng, crop, eng.bedOf(planting.bedId));
    if (!(+crop.dtm > 0)) return false;
    return planting ? S.suits(eng, crop, eng.bedOf(planting.bedId)) : eng.plan.beds.some(b => S.suits(eng, crop, b) && (crop.material !== 'bulb' || eng.isCt(b)));
  }
  const crops = (eng, source) => eng.crops().filter(c => plans(eng, c, source && source.cropId === c.id ? source : null));
  const spaceName = kind => S.kindWord[kind] || 'bed';
  const sowingName = kind => ({ bed: 'whole bed', tower: 'whole tower', containers: 'whole group', bench: 'bench place' })[kind] || 'whole bed';
  const blockName = () => D.kind === 'containers' && D.sourceId ? 'block of containers' : sowingName(D.kind);
  const sourceOf = eng => D.sourceId ? eng.planting(D.sourceId) : null;
  const canStartHere = (eng, bed) => !!bed && !eng.isPool(bed) && (!eng.isRack(bed) || eng.plantingsIn(bed.id).some(p => plans(eng, eng.crop(p.cropId), p)));
  const thingsFor = (eng, cropId) => (eng.thingsOf ? eng.thingsOf(cropId) : []).filter(t => t.counts);
  const groupOf = (crop, unit) => F.groupOf(crop, unit, (App.state.plan.lrfNext || {}).groups);
  const word = (n, crop, unit) => F.unitWord(n, unit, groupOf(crop, unit)) || unit || 'each';
  /** The unit an amount of a run is in: the thing it is of, where it is of another thing the crop sells, else the crop's (or the variety's) own. */
  const unitFor = (eng, crop, thingId, varietyId) => { const t = thingId ? thingsFor(eng, crop.id).find(x => x.id === thingId) : null; return t ? t.unit : eng.unitOf(crop, varietyId ? eng.variety(varietyId) : undefined); };
  /** The gardens with beds in the ground this crop can go in, in the farm's order. */
  const bedGardens = (eng, crop) => S.runGardens(eng, crop).filter(g => crop.material !== 'bulb' || g.kind === 'containers');
  function selectGarden(eng, crop, selected, planting) {
    D.gardenId = selected?.garden.id || '';
    D.kind = selected?.kind || 'bed';
    const source = planting && D.kind !== 'bed' && eng.spaceKind(eng.bedOf(planting.bedId)) === D.kind ? planting : S.runSource(eng, crop.id, D.varietyId, D.kind);
    D.sourceId = source?.id || '';
    if (source && !D.varietyId && source.varietyId) D.varietyId = source.varietyId;
    const allowed = new Set(bedGardens(eng, crop).filter(g => g.kind === D.kind).map(g => g.garden.id));
    D.then = D.then.filter(id => id !== D.gardenId && allowed.has(id));
    if (D.kind === 'bench') D.by = 'beds';
  }
  /** The input the solver is given for the run being planned. */
  function ask() {
    const by = D.by === 'beds' ? 'beds' : 'amount';
    return { cropId: D.cropId, kind: D.kind, sourceId: D.sourceId || undefined, varietyId: D.varietyId || undefined, thing: by === 'amount' && D.thing ? D.thing : undefined, by, ...(by === 'amount' ? { want: +D.want, margin: +D.margin || 0 } : { every: +D.every }),
      datesFor: D.datesFor, from: D.from, to: D.to, reach: 'spacing', wholeBeds: true, gardenIds: D.gardenId ? [D.gardenId] : [], bedIds: [], then: D.then.slice(), drop: D.drop.slice() };
  }
  // the run worked out for the page as it stands, kept until the page or the plan changes
  let memo = { eng: null, key: '', result: null };
  function current() {
    const eng = App.state.engine;
    if (!eng.crop(D.cropId)) return null;
    const input = ask(), key = JSON.stringify(input);
    if (memo.eng !== eng || memo.key !== key) memo = { eng, key, result: S.planRun(eng, input) };
    return memo.result;
  }

  // ── starting a run from what it was opened on ──
  /** The first day a crop could go into the garden's ground: the planning date, or the first field date there, whichever is later. */
  function firstDay(eng, crop, gardenId) {
    const bed = S.spaces(eng, crop, [gardenId]).find(b => eng.spaceKind(b) === D.kind), year = App.planYear();
    const floors = bed ? [eng.firstFieldDate(crop, bed, year), eng.fieldPlantingWindow(bed, year).from].filter(E.validDate) : [];
    const d = new Date(Math.max(+App.state.date, +new Date(year, 0, 1), ...floors.map(x => +x)));
    return d.getFullYear() > year ? new Date(year, 11, 31) : d;
  }
  /** A round figure to start the amount on: what one bed gives in the days it is picked, a week. */
  const round = n => (!(n > 0) ? 1 : n >= 20 ? Math.round(n / 5) * 5 : n >= 2 ? Math.round(n) : Math.max(0.1, Math.round(n * 10) / 10));
  /**
   * Fill the page from what it was opened on: { cropId?, varietyId?, sourceId?, bedId?, gardenId?, from?, by?, thing? }. A planting
   * gives its crop, variety and garden, and the run starts after it; a bed or an opening its garden and day; a week on the Forecast
   * its crop, by amount, from that week. Whatever is not given is the farm's own: a crop it grows, the first garden it can go in.
   */
  function seed(focus) {
    const eng = App.state.engine, year = App.planYear();
    let source = focus.sourceId ? eng.planting(focus.sourceId) : null;
    const bed = focus.bedId ? eng.bedOf(focus.bedId) : source ? eng.bedOf(source.bedId) : null;
    if (!source && bed && eng.isRack(bed)) source = eng.plantingsIn(bed.id).filter(p => plans(eng, eng.crop(p.cropId), p)).sort((a, b) => b.date.localeCompare(a.date))[0];
    const list = crops(eng, source), ok = c => !!c && list.includes(c) && (!bed || S.suits(eng, c, bed)) && (!bed || c.material !== 'bulb' || eng.isCt(bed));
    const used = new Set(App.state.plan.plantings.map(p => p.cropId));
    let crop = eng.crop(source ? source.cropId : focus.cropId);
    if (!ok(crop) && bed) crop = eng.plantingsIn(bed.id).filter(p => ok(eng.crop(p.cropId))).sort((a, b) => b.date.localeCompare(a.date)).map(p => eng.crop(p.cropId))[0];
    if (!ok(crop)) crop = [eng.crop(D.cropId), list.find(c => used.has(c.id) && ok(c)), list.find(ok)].find(ok);
    Object.assign(D, { cropId: crop ? crop.id : '', varietyId: '', thing: '', by: focus.by === 'beds' ? 'beds' : 'amount', margin: 0, drop: [], then: [], fresh: false });
    if (!crop) return;
    if (source && source.varietyId) D.varietyId = source.varietyId;
    else if (focus.varietyId && eng.varietiesOf(crop.id).some(v => v.id === focus.varietyId)) D.varietyId = focus.varietyId;
    if (focus.thing && thingsFor(eng, crop.id).some(t => t.id === focus.thing)) D.thing = focus.thing;
    const gardens = bedGardens(eng, crop);
    const selected = (bed && gardens.find(g => g.garden.id === bed.gardenId && g.kind === eng.spaceKind(bed))) ||
      gardens.find(g => g.garden.id === focus.gardenId && g.kind === 'bed') ||
      gardens.find(g => g.planted && g.garden.type === 'field' && g.kind === 'bed') ||
      gardens.find(g => g.planted) || gardens[0];
    selectGarden(eng, crop, selected, source);
    const garden = D.gardenId, r = source ? eng.calc(source) : null;
    const hw = D.kind === 'tower' ? 7 : Math.max(7, Math.min(28, +crop.hw || 14));
    D.every = hw;
    // a planting or a bed: the run's days are planting days, from the day asked (or after the planting); a week on the Forecast:
    // picking days from that week; else picking days, from the first a bed could give
    if (source && r && !focus.bedId) { D.by = 'beds'; D.datesFor = 'planting'; D.from = iso(E.addDays(r.field, hw)); D.to = iso(E.addDays(r.field, hw * 4)); }
    else if (focus.from && focus.to && E.validDate(E.s2d(focus.from)) && E.validDate(E.s2d(focus.to))) {
      // A Forecast period is the grower's selection, even when every candidate space is too late for it.
      D.datesFor = 'picking'; D.from = focus.from; D.to = focus.to;
    }
    else if (focus.bedId || focus.gardenId) { D.datesFor = 'planting'; D.by = focus.by === 'amount' ? 'amount' : 'beds'; const f = E.validDate(E.s2d(focus.from)) ? E.s2d(focus.from) : firstDay(eng, crop, garden); D.from = iso(f); D.to = iso(E.addDays(f, hw * 3)); }
    else {
      D.datesFor = 'picking';
      const start = firstDay(eng, crop, garden), probe = S.planRun(eng, { cropId: crop.id, kind: D.kind, sourceId: D.sourceId || undefined, varietyId: D.varietyId || undefined, by: 'beds', every: 7, datesFor: 'planting', from: iso(start), to: iso(start), gardenIds: garden ? [garden] : [] });
      const soonest = probe && !probe.error && probe.sowings[0] ? probe.sowings[0].firstPick : E.addDays(start, +crop.dtm || 60);
      const asked = E.validDate(E.s2d(focus.from)) && E.s2d(focus.from).getFullYear() === year ? E.s2d(focus.from) : null;
      const a = asked && asked > soonest ? asked : soonest, last = new Date(year, 11, 31);
      // a crop first picked only after the plan's year (one that stands over the winter): its days are planting days, and it is
      // planned by beds, since no week of the year is picked to plan an amount for
      if (a > last) { D.datesFor = 'planting'; if (focus.by !== 'amount') D.by = 'beds'; D.from = iso(start); D.to = iso(E.addDays(start, hw * 3) > last ? last : E.addDays(start, hw * 3)); }
      else { D.from = iso(a); D.to = iso(E.addDays(a, 55) > last ? last : E.addDays(a, 55)); }
    }
    // a crop on a yield nobody has checked plans no amount: unless asked for one, it opens by beds, which it can be planned by
    if (D.by === 'amount' && focus.by !== 'amount' && (eng.harvestFor(crop.id).open || {}).yield) D.by = 'beds';
    if (D.by === 'amount') D.want = focus.to ? (focus.want > 0 ? String(focus.want) : '') : String(round(wantedFor(eng, crop)));
  }
  /** What to start the amount on: the crop's ordinary week where the plan already gives it, else what one bed gives in a week of its picking. */
  function wantedFor(eng, crop) {
    const m = root.LRFHarvestView ? root.LRFHarvestView.model('commercial') : F.build(eng, { year: App.planYear(), use: 'commercial' });
    const unit = unitFor(eng, crop, D.thing, D.varietyId), rows = m.rows.filter(r => r.cropId === crop.id && r.unit === unit && (r.thing || '') === D.thing && r.total > 0), s = rows.length ? F.season(m, rows) : null;
    if (s) return rows.reduce((n, r) => n + F.sum(r.days, s.i0, s.i1), 0) / Math.max(1, F.periods(m, 'week', s.i0, s.i1).length);
    // one bed's sowing, read as the thing asked for where it is another thing the crop sells (a run is only of a thing to an amount)
    const probe = S.planRun(eng, { cropId: crop.id, kind: D.kind, sourceId: D.sourceId || undefined, varietyId: D.varietyId || undefined, ...(D.thing ? { thing: D.thing, by: 'amount', want: 1 } : { by: 'beds' }), every: 7, datesFor: 'planting', from: D.from || iso(App.state.date), to: D.from || iso(App.state.date), gardenIds: D.gardenId ? [D.gardenId] : [] });
    const first = probe && !probe.error && probe.sowings[0];
    return first ? first.units * 7 / Math.max(7, E.dayDiff(first.lastPick, first.firstPick) + 1) : 10;
  }
  /** Another crop on the same page: the dates and the way it is planned are kept, the garden as far as the crop can go there. */
  function changeCrop(id) {
    const eng = App.state.engine, crop = eng.crop(id);
    if (!crop) return;
    const keep = { by: D.by, datesFor: D.datesFor, from: D.from, to: D.to, every: D.every, gardenId: D.gardenId, then: D.then };
    Object.assign(D, { cropId: id, varietyId: '', thing: '', drop: [] });
    const gardens = bedGardens(eng, crop);
    selectGarden(eng, crop, gardens.find(g => g.garden.id === keep.gardenId && g.kind === D.kind) || gardens.find(g => g.planted) || gardens[0]);
    if (D.by === 'amount') D.want = String(round(wantedFor(eng, crop)));
  }

  // ── opening the page ──
  /** Open the page on a new run, filled in from what it was opened on (see seed). A crop the page cannot plan is said so. */
  function open(focus) {
    if (!App.state.ready) return;
    const f = focus || {}, eng = App.state.engine, from = f.sourceId ? eng.planting(f.sourceId) : null, asked = eng.crop(from ? from.cropId : f.cropId);
    if (asked && !plans(eng, asked, from)) { UI.toast(asked.micro ? `${asked.name} is planned from weekly demand, under Live trays in the Nursery view.` : `${asked.name} has no harvest to plan a succession by.`); return; }
    seed(f);
    Object.assign(UI_STATE, { pick: 'draft', answer: null, shown: false, removeAll: false, planning: true });
    App.setView('succession');
    render();
    const view = $('suWrap') && $('suWrap').parentElement;
    if (view) view.scrollTop = 0;   // a run opened from elsewhere is read from its head
  }
  /** What the run being planned would add, for the Timeline to draw as ghosts: only after "See them on the Timeline". */
  function ghosts() {
    if (!UI_STATE.shown || UI_STATE.pick !== 'draft' || !App.state.ready) return null;
    const r = current();
    return r && !r.error ? { placed: r.sowings.map(x => ({ p: x.p, r: x.r, bed: x.bed })), held: [], named: [] } : null;
  }

  // ── the parts of the page ──
  /** A defined term behind "?" beside its control, the term in bold. */
  const term = (name, text) => UI.help(() => h('p', h('b', name), ' ', text), null, null, { label: `What “${name}” means` });
  const fld = (label, control, extra) => h('label.fld', h('span', label, extra || null), control);
  const set = change => { Object.assign(D, change); render(); };
  const seg = (name, data, value, options, onpick) => h('div.seg', { role: 'group', 'aria-label': name, dataset: data },
    options.map(([v, text, title]) => h('button', { type: 'button', 'aria-pressed': String(value === v), title: title || null, dataset: { hook: 'succ-choice', value: v }, onclick: () => { if (value !== v) onpick(v); } }, text)));
  const dateBox = (id, data, value, onset) => h('input', { type: 'date', id, value, dataset: data, onchange: e => { if (E.validDate(E.s2d(e.target.value))) onset(e.target.value); else render(); } });
  const cardOf = (n, title, ...body) => h('section.card.su-card', { dataset: { hook: 'succ-card' }, 'aria-label': title }, h('header.su-card-head', h('span.su-num', n), h('h3', title)), ...body);

  /** 01 What and how much */
  function whatCard(eng, crop, result) {
    const list = crops(eng, sourceOf(eng)), mine = new Set(S.candidates(eng, true).map(c => c.id)), v = eng.variety(D.varietyId), unit = result && !result.error && result.totals ? result.totals.unit : unitFor(eng, crop, D.thing, D.varietyId), sold = thingsFor(eng, crop.id);
    const cropSel = h('select', { id: 'suCrop', dataset: { hook: 'succ-crop' }, onchange: e => { changeCrop(e.target.value); render(); } },
      h('optgroup', { label: 'Crops you grow' }, list.filter(c => mine.has(c.id)).map(c => h('option', { value: c.id, selected: c.id === crop.id }, c.name))),
      h('optgroup', { label: 'Every other crop' }, list.filter(c => !mine.has(c.id)).map(c => h('option', { value: c.id, selected: c.id === crop.id }, c.name))));
    const varSel = h('select', { id: 'suVariety', dataset: { hook: 'succ-variety' }, onchange: e => {
      D.varietyId = e.target.value;
      const source = S.runSource(eng, crop.id, D.varietyId, D.kind);
      D.sourceId = D.kind === 'bench' ? D.sourceId : source?.id || '';
      set({ drop: [] });
    }, disabled: D.kind === 'bench' }, h('option', { value: '' }, 'No variety chosen'), eng.varietiesOf(crop.id).map(x => h('option', { value: x.id, selected: x.id === D.varietyId }, x.name)));
    const photo = T.el({ varietyId: D.varietyId || undefined, cropId: crop.id, color: eng.cropColor(crop), label: (v && v.name) || crop.name, size: 40, cls: 'su-photo' });
    photo.dataset.hook = 'succ-photo';
    const amount = D.by === 'amount';
    return cardOf('01', 'What and how much',
      h('div.su-pair', fld('Crop', cropSel), h('div.su-variety', photo, fld('Variety', varSel))),
      h('div.fld', h('span', 'Plan by', term('Plan by', D.kind === 'bench' ? 'Repeat this planting’s trays every so many days. Weekly live-tray demand is set in Nursery.' : 'Choose the days between sowings, or give a weekly amount and let the planner find the spacing.')),
        seg('Plan by', { hook: 'succ-plan-by' }, D.by, [['beds', D.kind === 'bed' ? 'Beds each sowing' : 'Days apart', `One ${blockName()} every so many days`], ...(D.kind === 'bench' ? [] : [['amount', 'A weekly amount', 'So much a week: the spacing is found']])], by => { if (by === 'amount' && !(+D.want > 0)) D.want = String(round(wantedFor(eng, crop))); set({ by, drop: [] }); })),
      amount ? h('div.su-three',
        fld('Wanted a week', h('input', { type: 'number', id: 'suWant', min: 0, step: 'any', value: D.want, dataset: { hook: 'succ-want' }, onchange: e => set({ want: e.target.value, drop: [] }) })),
        sold.length ? fld('Sold by', h('select', { id: 'suThing', dataset: { hook: 'succ-thing' }, onchange: e => set({ thing: e.target.value, drop: [] }) },
          h('option', { value: '', selected: !D.thing }, `${word(2, crop, unitFor(eng, crop, '', D.varietyId))} · ${crop.name}`), sold.map(t => h('option', { value: t.id, selected: t.id === D.thing }, `${word(2, crop, t.unit)} · ${t.name}`))))
          : fld('Sold by', h('input', { type: 'text', id: 'suUnit', disabled: true, value: word(2, crop, unit), dataset: { hook: 'succ-unit' } })),
        fld('Margin %', h('input', { type: 'number', id: 'suMargin', min: 0, max: 1000, step: 1, value: D.margin, dataset: { hook: 'succ-margin' }, onchange: e => set({ margin: e.target.value, drop: [] }) }),
          term('Margin', 'is planted on top of the amount wanted a week, as a share of it: 10 % on 100 a week plans for 110.')))
        : h('p.su-line', { dataset: { hook: 'succ-each' } }, `Each sowing is one ${blockName()}.`));
  }
  /** 02 When */
  function whenCard(eng, crop, result) {
    const picking = D.datesFor === 'picking', amount = D.by === 'amount', ok = result && !result.error;
    const spacing = ok && result.every ? `One ${blockName()} every ${plural(result.every, 'day')}.` : '';
    return cardOf('02', 'When',
      h('div.fld', h('span', 'Dates are for'), seg('Dates are for', { hook: 'succ-dates-are-for' }, D.datesFor, [['picking', 'Picking', 'The first and the last day of picking'], ['planting', 'Planting', 'The first and the last day a bed is planted']], v => set({ datesFor: v, drop: [] }))),
      h('div.su-pair', fld(picking ? 'First picking' : 'First planting', dateBox('suFrom', { hook: 'succ-from' }, D.from, v => set({ from: v, drop: [] }))), fld(picking ? 'Picked through' : 'Last planting', dateBox('suTo', { hook: 'succ-to' }, D.to, v => set({ to: v, drop: [] })))),
      amount ? h('p.su-line', { dataset: { hook: 'succ-spacing' } }, spacing || 'The spacing is found from the amount.')
        : h('div.su-pair', fld('Every (days)', h('input', { type: 'number', id: 'suEvery', min: 1, max: 366, step: 1, value: D.every, dataset: { hook: 'succ-every' }, onchange: e => set({ every: e.target.value, drop: [] }) })),
          h('p.su-line', { dataset: { hook: 'succ-spacing' } }, ok ? spacing : '')));
  }
  /** 03 Where */
  function whereCard(eng, crop, result) {
    const gardens = bedGardens(eng, crop), first = gardens.find(g => g.garden.id === D.gardenId && g.kind === D.kind), ok = result && !result.error;
    const beds = first ? S.spaces(eng, crop, [first.garden.id]).filter(b => eng.spaceKind(b) === D.kind) : [];
    const used = new Set(ok ? result.sowings.filter(x => x.bed.gardenId === D.gardenId).map(x => x.bed.id) : []), noun = spaceName(D.kind);
    const gardenSel = h('select', { id: 'suGarden', dataset: { hook: 'succ-garden' }, onchange: e => {
      selectGarden(eng, crop, gardens[e.target.selectedIndex], sourceOf(eng));
      set({ drop: [] });
    } }, gardens.map((g, i) => h('option', { value: gardens.findIndex(other => other.garden.id === g.garden.id) === i ? g.garden.id : g.garden.id + '/' + g.kind,
      selected: g === first }, `${g.garden.name} (${plural(g.spaces, spaceName(g.kind))})`)));
    const others = gardens.filter(g => g.kind === D.kind && g.garden.id !== D.gardenId);
    return cardOf('03', 'Where',
      fld('Garden', gardenSel),
      first ? h('div.su-beds', { dataset: { hook: 'succ-beds' } },
        h('div.su-beds-head', h('span', first.garden.name), h('span', { dataset: { hook: 'succ-beds-used' } }, `${num(used.size)} of ${plural(beds.length, noun)} used`)),
        h('div.su-strip', { role: 'img', 'aria-label': `${first.garden.name}: ${num(used.size)} of its ${plural(beds.length, noun)} take a sowing of this run`, style: { '--n': String(Math.max(1, beds.length)), '--crop': eng.cropColor(crop) } },
          beds.map(b => h('i' + (used.has(b.id) ? '.on' : ''), { title: `${App.bedLabel(b)}${used.has(b.id) ? ': a sowing of this run' : ''}` })))) : null,
      others.length ? h('div.fld', h('span', 'Then, if it runs out of room'),
        h('div.su-then', { dataset: { hook: 'succ-then' } }, others.map(g => { const k = D.then.indexOf(g.garden.id);
          return h('button.chip', { type: 'button', 'aria-pressed': String(k >= 0), dataset: { hook: 'succ-then-garden', garden: g.garden.id }, title: k >= 0 ? 'Used, in this order, when the gardens before it run out of room' : 'Use it when the gardens before it run out of room',
            onclick: () => set({ then: k >= 0 ? D.then.filter(x => x !== g.garden.id) : [...D.then, g.garden.id], drop: [] }) }, k >= 0 ? `${num(k + 2)} · ${g.garden.name}` : g.garden.name); }))) : null);
  }

  /** The months a run's rows are drawn over: from the first of the month of its first sowing to the end of the month of its last picking. */
  function spanOf(result) {
    const ds = [result.picking.from, result.picking.to, ...result.sowings.flatMap(x => [x.sow, x.lastPick])].filter(E.validDate);
    const a = new Date(Math.min(...ds.map(Number))), z = new Date(Math.max(...ds.map(Number)));
    const lo = new Date(a.getFullYear(), a.getMonth(), 1), hi = new Date(z.getFullYear(), z.getMonth() + 1, 1);
    return { lo, hi, days: E.dayDiff(hi, lo) };
  }
  const at = (sp, d) => `${Math.max(0, Math.min(100, (E.dayDiff(d, sp.lo) / sp.days) * 100)).toFixed(2)}%`;
  const wide = (sp, a, b) => `${Math.max(0.4, Math.min(100, (Math.max(0, E.dayDiff(b, a)) / sp.days) * 100)).toFixed(2)}%`;
  /** The season's strip for one bed: what is already planted in it, the weeks asked, the nursery, the growing days and the picking. */
  function strip(eng, sp, result, x, color) {
    const already = eng.plantingsIn(x.bed.id).map(p => ({ p, r: eng.calc(p) })).filter(y => y.r && y.p.id !== x.p.id).map(y => ({ a: eng.occupancyFrom(y.p, y.r), z: y.r.last > y.r.field ? y.r.last : y.r.field })).filter(y => y.z >= sp.lo && y.a < sp.hi);
    return h('div.su-season', { style: { '--crop': color } },
      h('span.su-asked', { style: { left: at(sp, result.picking.from), width: wide(sp, result.picking.from, E.addDays(result.picking.to, 1)) } }),
      already.map(y => h('span.su-had', { dataset: { hook: 'succ-already' }, style: { left: at(sp, y.a < sp.lo ? sp.lo : y.a), width: wide(sp, y.a < sp.lo ? sp.lo : y.a, y.z) } })),
      x.nursery ? h('span.su-nursery', { style: { left: at(sp, x.sow), width: wide(sp, x.sow, x.plant) } }) : null,
      h('span.su-grow', { style: { left: at(sp, x.plant), width: wide(sp, x.plant, x.firstPick) } }),
      h('span.su-pick', { style: { left: at(sp, x.firstPick), width: wide(sp, x.firstPick, E.addDays(x.lastPick, 1)) } }));
  }
  /** The months over the strips, as the column's head. */
  const months = sp => { const out = []; for (let d = new Date(sp.lo); d < sp.hi; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(h('span', { style: { left: at(sp, d) } }, UI.MONTHS[d.getMonth()])); return h('div.su-months', out); };
  const KEY = [['su-nursery', 'in the nursery'], ['su-grow', 'growing'], ['su-pick', 'picking'], ['su-had', 'already in the plan'], ['su-asked', 'the weeks asked for']];

  /** The amount a week, the run's own, against what is wanted: a bar a week, the line of the amount, and the short weeks said. */
  function weeksChart(eng, crop, result) {
    const unit = result.totals.unit, want = result.average.wanted, asked = want != null, weeks = result.weeks, top = Math.max(want || 0, ...weeks.map(w => w.run), 1) * 1.15;
    const short = result.short, firstShort = short[0], w2 = n => word(n, crop, unit);
    const says = [`Averages ${num(result.average.run, 0)}.`];
    if (firstShort) says.push(short.length === 1 ? `${firstShort === weeks[0] ? 'The first week' : `The week of ${day(firstShort.start)}`} gives ${num(firstShort.run, 0)}.` : `${plural(short.length, 'week')} ${short.length === 1 ? 'gives' : 'give'} less: ${short.slice(0, 3).map(w => `${day(w.start)} (${num(w.run, 0)})`).join(', ')}${short.length > 3 ? `, and ${num(short.length - 3)} more` : ''}.`);
    const have = result.average.have;
    return h('div.su-weeks', { dataset: { hook: 'succ-weeks' } },
      h('div.su-weeks-head', h('h4', asked ? `${w2(2)} a week, against ${num(want, 1)}` : `${w2(2)} a week`), h('p', { dataset: { hook: 'succ-average' } }, says.join(' '))),
      h('div.su-bars' + (asked ? '' : '.no-line'), { role: 'img', 'aria-label': `${w2(2)} a week from this run: ${weeks.map(w => num(w.run, 0)).join(', ')}${asked ? `, against ${num(want, 1)} wanted` : ''}`, style: { '--n': String(weeks.length), '--line': `${(((want || 0) / top) * 100).toFixed(2)}%` } },
        asked ? h('span.su-want', { dataset: { hook: 'succ-want-line' } }, `${num(want, 1)} a week`) : null,
        weeks.map(w => h('div.su-bar' + (w.short ? '.short' : ''), { dataset: { hook: 'succ-week', week: w.key, run: String(w.run), short: String(!!w.short) }, title: `Week of ${day(w.start)}: ${F.amount(w.run, unit, groupOf(crop, unit))} from this run${asked ? `, ${F.amount(w.wanted, unit, groupOf(crop, unit))} wanted` : ''}${w.have > 1e-9 ? `; the plan already gives ${F.amount(w.have, unit, groupOf(crop, unit))}` : ''}` },
          h('i', { style: { height: `${Math.min(100, (w.run / top) * 100).toFixed(2)}%` } }), h('b', num(w.run, 0))))),
      h('div.su-ticks', { style: { '--n': String(weeks.length) } }, weeks.map(w => h('span', day(w.start)))),
      h('p.su-note', { dataset: { hook: 'succ-have' } }, have > 1e-9 ? `The plan already gives about ${F.amount(have, unit, groupOf(crop, unit))} a week of ${lower(crop)} in these weeks, besides this run; it is not taken off the amount.` : `The plan gives no ${lower(crop)} in these weeks today.`,
        // what the plan gives is what is grown to sell (the forecast's commercial count): said where the crop has plantings for personal use
        F.useOf && eng.plan.plantings.some(p => p.cropId === crop.id && F.useOf(eng, p).personal) ? ' Plantings for personal use are not counted as giving any.' : ''));
  }
  /** One row a bed: the bed and its length, the season's strip, Sow, Plant and First pick in ruled columns, and Drop. */
  function rowsTable(eng, crop, result, sp, editable) {
    const color = eng.cropColor(crop), out = [];
    out.push(h('div.su-row.su-row-head', h('span', spaceName(D.kind).replace(/^./, c => c.toUpperCase())), months(sp), h('span.su-col', 'Sow'), h('span.su-col', 'Plant'), h('span.su-col', 'First pick'), h('span')));
    const last = result.sowings[result.sowings.length - 1];
    for (const x of result.sowings) {
      const over = result.overshoot && x === last;
      out.push(h('div.su-row', { dataset: { hook: 'succ-row', n: String(x.n), bed: x.bed.id, frost: String(!!x.frost) } },
        h('span.su-bed', h('b', App.bedLabel(x.bed, eng)), h('small', eng.isSoilBed(x.bed) ? `${num(x.r.physicalLength, 1)} ft` : `${num(x.r.tw ? x.r.plants : x.r.physicalLength)} ${eng.capUnit(x.bed)}`),
          x.frost ? h('small.frost', { dataset: { hook: 'succ-frost' }, title: UI.plainDays(x.frost) }, 'frost') : null),
        strip(eng, sp, result, x, color),
        h('span.su-col', { dataset: { hook: 'succ-sow' } }, day(x.sow)), h('span.su-col', { dataset: { hook: 'succ-plant' } }, day(x.plant)), h('span.su-col', { dataset: { hook: 'succ-first' } }, day(x.firstPick)),
        editable ? h('button.btn.small.quiet', { type: 'button', dataset: { hook: 'succ-drop' }, title: 'Leave this sowing out of the run. Nothing else moves.', onclick: () => set({ drop: [...D.drop, x.n] }) }, 'Drop') : h('span')));
      if (x.frost) out.push(h('p.su-said', { dataset: { hook: 'succ-frost-said' } }, h('i.dot.amber'), UI.plainDays(x.frost)));
      if (over) out.push(h('p.su-said', { dataset: { hook: 'succ-overshoot' } }, h('i.dot.amber'), `Picked to ${day(result.overshoot.lastPick)}, ${plural(result.overshoot.days, 'day')} past the last day asked for. It is planted; drop it to end the run sooner.`));
    }
    for (const u of result.unplaced) {
      const why = u.why.map(w => `${w.why}${w.spaces > 1 ? ` (${plural(w.spaces, spaceName(D.kind))})` : ''}`).join('; '), room = (u.room || []).map(g => `${g.garden.name} (${plural(g.beds, spaceName(D.kind))})`).join(', ');
      out.push(h('p.su-said.su-none', { dataset: { hook: 'succ-unplaced', n: String(u.n) } }, h('i.dot.red'), `${D.datesFor === 'picking' ? 'First picking' : 'Planting'} ${day(u.target)} has no ${spaceName(D.kind)} in the run’s gardens: ${why || 'no room is free'}.${room ? ` Room then in ${room}.` : ''}`));
    }
    if (D.drop.length && editable) out.push(h('p.su-said', { dataset: { hook: 'succ-dropped' } }, `${plural(D.drop.length, 'sowing')} dropped. `, h('button.link', { type: 'button', dataset: { hook: 'succ-undrop' }, onclick: () => set({ drop: [] }) }, 'Put them back')));
    return h('div.su-table', { dataset: { hook: 'succ-table' } }, out, h('p.su-key', KEY.map(([cls, text]) => h('span', h('i.' + cls), text))));
  }

  /** The main part while a run is being planned. */
  function draftView(host, eng) {
    const crop = eng.crop(D.cropId);
    if (!crop) { add(host, h('p.su-empty', { dataset: { hook: 'succ-empty' } }, 'There is no crop with beds to plan a succession of.')); return; }
    const result = current(), ok = result && !result.error, amount = D.by === 'amount';
    const unit = ok ? result.totals.unit : unitFor(eng, crop, D.thing, D.varietyId);
    const title = amount ? `${crop.name}: ${num(+D.want || 0, 1)} ${word(+D.want || 0, crop, unit)} a week` : `${crop.name}: one ${D.kind === 'bed' ? 'bed' : blockName()} every ${plural(+D.every || 0, 'day')}`;
    add(host, h('div.su-title', h('h2', { id: 'suTitle', dataset: { hook: 'succ-title' } }, title), h('span.su-nothing', { dataset: { hook: 'succ-nothing-yet' } }, 'Nothing is added to the plan until you press Add.')),
      h('div.su-cards', whatCard(eng, crop, result), whenCard(eng, crop, result), whereCard(eng, crop, result)));
    const out = h('section.card.su-out', { dataset: { hook: 'succ-plant-out' }, 'aria-label': 'What it would plant' });
    add(host, out);
    if (!ok) {
      add(out, h('h3', 'What it would plant'), h('p.su-error', { dataset: { hook: 'succ-error', unchecked: result && result.unchecked ? '1' : '' } }, h('i.dot.red'), (result && result.error) || 'Choose a crop.'),
        result && result.unchecked && root.LRFAssume ? h('button.btn', { type: 'button', dataset: { hook: 'succ-to-yield' }, onclick: () => { App.setView('assume'); root.LRFAssume.setMode('harvest'); } }, 'Open Yield and price') : null);
      return;
    }
    const t = result.totals, n = result.sowings.length;
    add(out, h('div.su-out-head', h('h3', 'What it would plant'),
      h('p.frame-figs', { dataset: { hook: 'succ-totals' } }, h('span', h('b', num(n)), n === 1 ? ' sowing' : ' sowings'), h('span', h('b', num(t.beds)), D.kind === 'bed' ? (t.beds === 1 ? ' whole bed' : ' whole beds') : ` ${spaceName(D.kind)}${t.beds === 1 ? '' : (D.kind === 'bench' ? 'es' : 's')}`),
        t.feet > 0 ? h('span', h('b', num(Math.round(t.feet))), ' ft') : null, h('span', 'about ', h('b', F.amount(t.units, t.unit, groupOf(crop, t.unit)))), t.frost ? h('span', { dataset: { hook: 'succ-frost-count' } }, h('b', num(t.frost)), ` cross${t.frost === 1 ? 'es' : ''} a frost date`) : null)));
    if (amount || result.weeks.length) add(out, weeksChart(eng, crop, result));
    if (n || result.unplaced.length) add(out, rowsTable(eng, crop, result, spanOf(result), true));
    add(out, h('div.su-foot',
      h('button.btn.primary', { type: 'button', id: 'suAdd', dataset: { hook: 'succ-add' }, disabled: !n, onclick: addIt }, n ? `Add ${plural(n, 'planting')}` : 'Nothing to add'),
      n ? h('button.link', { type: 'button', dataset: { hook: 'succ-see' }, title: 'Drawn as ghosts on the Timeline, where they would go. Nothing is added.', onclick: () => { UI_STATE.shown = true; App.setView('timeline'); App.emit('ghost'); if (root.LRFTimeline && root.LRFTimeline.showGhosts) setTimeout(() => root.LRFTimeline.showGhosts(), 60); } }, 'See them on the Timeline') : null,
      h('button.btn', { type: 'button', dataset: { hook: 'succ-cancel' }, onclick: cancel }, 'Cancel'),
      h('span.su-foot-note', 'One step, and one Undo takes it back. No date is moved to make a planting fit.')));
  }
  function addIt() {
    const eng = App.state.engine, result = current(), crop = eng.crop(D.cropId);
    if (!result || result.error || !result.sowings.length) return;
    const n = result.sowings.length;
    if (!App.addRun(result, `Add a succession of ${lower(crop)}: ${plural(n, 'planting')}`)) { render(); return; }
    Object.assign(UI_STATE, { pick: result.run.id, shown: false, removeAll: false, planning: false, answer: { kind: 'added', id: result.run.id, text: `Added ${plural(n, 'planting')} of ${lower(crop)}, as one run.`, step: App.state.undo[App.state.undo.length - 1] } });
    render();
  }
  function cancel() {
    Object.assign(UI_STATE, { shown: false, answer: null, planning: false });
    Object.assign(D, { drop: [], fresh: true });
    App.emit('ghost');
    render();
  }
  function newRun() {
    seed({});
    Object.assign(UI_STATE, { pick: 'draft', answer: null, shown: false, removeAll: false, planning: true });
    render();
  }

  /** A kept run's line in its own words: "1 bed every 14 days · Jun 1 to Jul 13", or its amount a week. */
  function runLine(eng, run, crop) {
    const noun = run.kind === 'containers' && run.sourceId ? 'block' : run.kind === 'bench' ? 'bench place' : spaceName(run.kind), unit = unitFor(eng, crop, run.thing, run.varietyId), dates = `${day(E.s2d(run.from))} to ${day(E.s2d(run.to))}`;
    return run.by === 'amount' && run.want > 0 ? `${num(run.want, 1)} ${word(run.want, crop, unit)} a week${run.every ? `, a ${noun} every ${plural(run.every, 'day')}` : ''} · ${dates}` : `1 ${noun} every ${plural(run.every || 0, 'day')} · ${dates}`;
  }
  /** The main part for a run the plan keeps: its plantings, read-only, each a link to the planting; and Remove run. */
  function keptView(host, eng, run) {
    const crop = eng.crop(run.cropId) || { name: 'Crop', id: run.cropId }, list = S.runPlantings(App.state.plan, run.id).map(p => ({ p, r: eng.calc(p) })), v = eng.variety(run.varietyId);
    add(host, h('div.su-title', h('h2', { id: 'suTitle', dataset: { hook: 'succ-title' } }, `${crop.name}: ${runLine(eng, run, crop).split(' · ')[0]}`)),
      h('p.frame-figs', { dataset: { hook: 'succ-kept-figs' } }, h('span', h('b', num(list.length)), list.length === 1 ? ' planting in the plan' : ' plantings in the plan'),
        h('span', 'from ', h('b', day(E.s2d(run.from))), ' to ', h('b', day(E.s2d(run.to)))), run.datesFor === 'picking' ? h('span', 'dates for picking') : h('span', 'dates for planting')));
    const out = h('section.card.su-out', { dataset: { hook: 'succ-kept' }, 'aria-label': 'Its plantings' });
    add(host, out);
    add(out, h('div.su-out-head', h('h3', 'Its plantings'), h('p.su-note', 'A run stays a run once added. Changing it as a run (moving it, changing its spacing) comes in a later build; each planting can be changed on its own.')));
    add(out, h('div.su-row.su-row-head.su-kept-head', h('span'), h('span', 'Planting'), h('span.su-col', 'Sow'), h('span.su-col', 'Plant'), h('span.su-col', 'First pick')));
    for (const x of list) {
      const r = x.r, name = (r && r.c.vname) || (v && v.name) || crop.name;
      out.append(h('div.su-row.su-kept-row', { dataset: { hook: 'succ-kept-row', planting: x.p.id, n: String(x.p.run.n) } },
        T.el({ varietyId: x.p.varietyId, cropId: x.p.cropId, color: eng.cropColor(r ? r.c : crop), label: name, size: 40 }),
        h('span.su-bed', h('button.link', { type: 'button', dataset: { hook: 'succ-kept-link' }, title: 'Show this planting on the Timeline', onclick: () => { App.setView('timeline'); App.select({ type: 'planting', id: x.p.id }); } }, `${num(x.p.run.n)} · ${r ? App.bedLabel(r.b, eng) : 'Planting'}`), h('small', name)),
        h('span.su-col', r ? day(r.sow || r.field) : '—'), h('span.su-col', r ? day(r.field) : '—'), h('span.su-col', r && r.harvestDays > 0 ? day(r.first) : '—')));
    }
    // a planting of the run sent to To place waits with its mark of the run: said here, and taken out with the run when asked (Codex on #103)
    const held = App.waiting().filter(w => w.run && w.run.id === run.id), all = list.length + held.length;
    if (held.length) out.append(h('p.su-note', { dataset: { hook: 'succ-kept-waiting' } }, `${plural(held.length, 'planting')} of it ${held.length === 1 ? 'waits' : 'wait'} under To place, with no bed yet.`));
    if (!all) out.append(h('p.su-note', { dataset: { hook: 'succ-kept-none' } }, 'None of its plantings is in the plan now.'));
    const removalText = () => UI_STATE.removeAll && all ? 'The run and its plantings go, as one step.' : 'Its plantings stay, as plain plantings. One Undo puts the run back.';
    const removalNote = h('span.su-foot-note', { dataset: { hook: 'succ-remove-effect' }, 'aria-live': 'polite' }, removalText());
    const tick = h('input', { type: 'checkbox', checked: UI_STATE.removeAll, dataset: { hook: 'succ-remove-all' }, onchange: e => {
      UI_STATE.removeAll = e.target.checked;
      removalNote.textContent = removalText();
    } });
    add(out, h('div.su-foot', h('button.btn', { type: 'button', dataset: { hook: 'succ-remove' }, onclick: () => removeIt(run, all) }, 'Remove run'),
      all ? h('label.su-tick', tick, h('span', `Take its ${plural(all, 'planting')} out too`)) : null,
      removalNote));
  }
  function removeIt(run, n) {
    const eng = App.state.engine, crop = eng.crop(run.cropId), all = UI_STATE.removeAll && n > 0;
    if (!App.removeRun(run.id, { plantings: all })) { render(); return; }
    Object.assign(UI_STATE, { pick: 'draft', removeAll: false, answer: { kind: 'removed', id: run.id, text: all ? `Removed the run of ${lower(crop)} and its ${plural(n, 'planting')}.` : `Removed the run of ${lower(crop)}; its ${plural(n, 'planting')} stay as plain plantings.`, step: App.state.undo[App.state.undo.length - 1] } });
    render();
  }

  /** The runs at the left: the one being planned, then each the plan keeps. */
  function runsList(eng) {
    const kept = App.runs(), crop = eng.crop(D.cropId), unitWord = crop ? word(+D.want || 0, crop, unitFor(eng, crop, D.thing, D.varietyId)) : '';
    const row = (picked, photo, name, detail, wordAt, data, onclick) => h('button.row.su-run' + (picked ? '.on' : ''), { type: 'button', 'aria-pressed': String(picked), dataset: data, onclick }, photo, h('span', h('b.row-name', name), h('span.row-detail', detail), h('span.row-word', { dataset: { hook: 'succ-run-word' } }, wordAt)));
    return h('aside.card.su-runs', { 'aria-label': 'Runs', dataset: { hook: 'succ-runs' } },
      h('div.su-runs-head', h('h3', 'Runs'), h('button.btn.small', { type: 'button', dataset: { hook: 'succ-new' }, title: 'Start planning a new run', onclick: newRun }, 'New run')),
      crop && UI_STATE.planning ? row(UI_STATE.pick === 'draft', T.el({ varietyId: D.varietyId || undefined, cropId: crop.id, color: eng.cropColor(crop), label: crop.name, size: 40 }), crop.name,
        D.by === 'amount' ? `${num(+D.want || 0, 1)} ${unitWord} a week · ${day(E.s2d(D.from))} to ${day(E.s2d(D.to))}` : `1 ${D.kind === 'bed' ? 'bed' : blockName()} every ${plural(+D.every || 0, 'day')} · ${day(E.s2d(D.from))} to ${day(E.s2d(D.to))}`,
        'Being planned', { hook: 'succ-run', run: 'draft' }, () => { UI_STATE.pick = 'draft'; render(); }) : null,
      kept.map(run => { const c = eng.crop(run.cropId) || { name: 'Crop', id: run.cropId }, n = S.runPlantings(App.state.plan, run.id).length + App.waiting().filter(w => w.run && w.run.id === run.id).length;   // placed and under To place
        return row(UI_STATE.pick === run.id, T.el({ varietyId: run.varietyId, cropId: c.id, color: eng.cropColor(c), label: c.name, size: 40 }), c.name, runLine(eng, run, c), plural(n, 'sowing'), { hook: 'succ-run', run: run.id }, () => { if (UI_STATE.pick !== run.id) UI_STATE.removeAll = false; UI_STATE.pick = run.id; render(); }); }),
      kept.length ? null : h('p.su-note', { dataset: { hook: 'succ-runs-none' } }, 'No run is kept in the plan yet.'));
  }
  /** The one answer to the last action taken here, with its Undo while it is still the last step. */
  function answerLine() {
    const a = UI_STATE.answer;
    if (!a) return null;
    const last = App.state.undo[App.state.undo.length - 1], can = last && last === a.step;
    return h('p.su-answer', { role: 'status', dataset: { hook: 'succ-answer' } }, h('i.dot.green'), a.text, can ? h('button.btn.small', { type: 'button', dataset: { hook: 'succ-undo' }, onclick: () => { App.undo(); UI_STATE.answer = null; UI_STATE.pick = a.kind === 'removed' ? a.id : 'draft'; if (a.kind === 'added') UI_STATE.planning = true; render(); } }, 'Undo') : null);
  }
  let helpBtn = null;
  function render() {
    if (!App.state.ready || App.state.view !== 'succession') { dirty = true; return; }
    dirty = false;
    const host = $('suWrap'), eng = App.state.engine, keep = host.parentElement.scrollTop;
    if (UI_STATE.planning && (D.fresh || !eng.crop(D.cropId))) seed({ cropId: eng.crop(D.cropId) ? D.cropId : undefined });
    if (UI_STATE.pick !== 'draft' && !App.runs().some(r => r.id === UI_STATE.pick)) UI_STATE.pick = 'draft';
    if (!helpBtn) helpBtn = UI.help(() => h('p', h('b', 'A succession'), ' is a crop sown again and again through the season so that it is picked without a gap. ', h('b', 'A run'), ' is one set of those sowings, kept as one: one whole bed or tower, a block of containers, or a planting’s trays on a bench. Nothing is added until Add is pressed, and one Undo takes a run back.'),
      () => $('suWrap'), null, { id: 'suHelp', label: 'What a succession is', hook: 'succ-help' });
    const kept = App.runs(), ids = new Set(kept.map(r => r.id)), inRuns = [...App.state.plan.plantings, ...App.waiting()].filter(p => p.run && ids.has(p.run.id)).length;   // placed and under To place, of the runs kept
    const main = h('div.su-main');
    const run = UI_STATE.pick !== 'draft' ? kept.find(r => r.id === UI_STATE.pick) : null;
    add(clear(host),
      h('header.su-head', h('div.su-head-text', h('h2', { dataset: { hook: 'succ-page-title' } }, 'Successions'), helpBtn),
        h('p.frame-figs', { dataset: { hook: 'succ-figs' } }, h('span', h('b', num(kept.length)), kept.length === 1 ? ' run in the plan' : ' runs in the plan'), h('span', h('b', num(inRuns)), inRuns === 1 ? ' planting in runs' : ' plantings in runs'))),
      answerLine(),
      h('div.su-body', runsList(eng), main));
    if (run) keptView(main, eng, run);
    else if (UI_STATE.planning) draftView(main, eng);
    else add(main, h('div.card.su-out', { dataset: { hook: 'succ-idle' } }, h('p.su-note', 'No run is being planned. A run is one crop sown at regular intervals.'), h('div.su-foot', h('button.btn.primary', { type: 'button', dataset: { hook: 'succ-new-main' }, onclick: newRun }, 'New run'))));
    host.parentElement.scrollTop = keep;
  }
  function init() {
    App.on('plan', () => { memo = { eng: null, key: '', result: null }; render(); });
    App.on('view', () => { if (App.state.view === 'succession') { if (UI_STATE.shown) { UI_STATE.shown = false; App.emit('ghost'); } render(); } else if (dirty) { /* drawn when it is opened */ } });
    App.on('date', () => { if (App.state.view === 'succession') render(); });
  }
  root.LRFSuccessions = { init, open, ghosts, plans, canStartHere, render, state: { D, UI: UI_STATE } };
})(window);
