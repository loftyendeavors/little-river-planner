/* Little River Farm Planner — the crop library (left) and the inspector (right). */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine, SL = root.LRFSeedLib;
  const { h, clear, add, day, span, num, toast } = UI;
  const $ = id => document.getElementById(id);

  // ════════════════════════════ crop library ════════════════════════════
  const lib = { query: '', scope: 'mine', open: new Set() };

  function cropMeta(c) {
    if (c.micro) return `Living tray · ${c.dtm} d`;
    return [c.method === 'TP' ? `Transplant${c.gh ? ' ' + num(c.gh, 1) + ' wk' : ''}` : 'Direct sow', `${c.dtm} d`].join(' · ');
  }
  /** Is this crop one of the farm's own: planted this season, or kept with varieties? */
  function isMine(c, used, varieties, list) {
    const added = list.added || [], removed = list.removed || [];
    return used.has(c.id) || ((varieties.length > 0 || added.includes(c.id)) && !removed.includes(c.id));
  }
  function renderLibrary() {
    if (!App.state.ready) return;
    const eng = App.state.engine, plan = App.state.plan, host = clear($('libList')), q = lib.query.trim().toLowerCase();
    const used = new Map();
    for (const p of plan.plantings) used.set(p.cropId, (used.get(p.cropId) || 0) + 1);
    const list = plan.settings.cropTypeList || {}, crops = eng.crops();
    let shown = 0, mineCount = 0;
    for (const c of crops) {
      const varieties = eng.varietiesOf(c.id), mine = isMine(c, used, varieties, list);
      if (mine) mineCount++;
      if (lib.scope === 'mine' && !mine && !q) continue;
      const nameHit = !q || String(c.name).toLowerCase().includes(q) || String(c.family || '').toLowerCase().includes(q);
      const varietyHits = q ? varieties.filter(v => String(v.name).toLowerCase().includes(q)) : varieties;
      if (!nameHit && !varietyHits.length) continue;
      shown++;
      const open = lib.open.has(c.id) || (q && !nameHit), color = eng.cropColor(c), armed = App.state.armed, n = used.get(c.id) || 0;
      const cropArmed = armed && armed.cropId === c.id && !armed.varietyId;
      // One line per crop. How it is grown shows on hover and when the crop is opened.
      const row = h('div.lib-crop' + (open ? '.open' : ''),
        h('div.lib-row' + (cropArmed ? '.armed' : ''), { dataset: { crop: c.id }, role: 'button', tabindex: 0, title: `${c.name} · ${cropMeta(c)}${c.inRow && c.rowSp ? ` · ${num(c.inRow, 1)} in apart in rows ${num(c.rowSp, 1)} in apart` : ''}\nDrag onto a bed, or click and then click beds.` },
          root.LRFThumbs.el({ cropId: c.id, color, label: c.name, size: 24, cls: 'key' }),
          h('b.lib-name', c.name),
          n ? h('span.lib-count', { title: `${n} planting${n === 1 ? '' : 's'} in this plan` }, n) : null,
          varieties.length ? h('button.lib-more', { type: 'button', 'aria-expanded': String(!!open), title: `${varieties.length} variet${varieties.length === 1 ? 'y' : 'ies'}`, 'aria-label': `${open ? 'Hide' : 'Show'} ${varieties.length} varieties of ${c.name}`, dataset: { toggle: c.id } }, open ? '▾' : '▸') : h('span.lib-more')));
      if (open) {
        const box = h('div.lib-vars', h('p.lib-meta', cropMeta(c)));
        for (const v of (nameHit ? varieties : varietyHits)) {
          const on = armed && armed.varietyId === v.id;
          box.append(h('div.lib-row.lib-var' + (on ? '.armed' : ''), { dataset: { crop: c.id, variety: v.id }, role: 'button', tabindex: 0, title: `${v.name}${v.catalogDtm ? ` · ${v.catalogDtm} days printed${v.catalogMaturityBasis && v.catalogMaturityBasis !== 'unspecified' ? ' from ' + v.catalogMaturityBasis : ''}` : ''}` },
            root.LRFThumbs.el({ varietyId: v.id, color, label: v.name, size: 22 }), h('span.lib-name', v.name), v.catalogDtm ? h('span.lib-count', `${v.catalogDtm} d`) : null));
        }
        row.append(box);
      }
      host.append(row);
    }
    if (!shown) host.append(h('p.empty', q ? `No crop or variety matches “${lib.query}”.` : 'No crops yet.'));
    $('libHint').textContent = App.state.armed ? 'Click beds to plant. Press Esc when done.' : 'Drag a crop onto a bed. Or click it, then click beds.';
    for (const [scope, count] of [['mine', mineCount], ['all', crops.length]]) { const el = document.querySelector(`[data-lib-scope="${scope}"] small`); if (el) el.textContent = count; }
  }
  function libraryPayload(row) {
    const c = App.state.engine.crop(row.dataset.crop), v = row.dataset.variety ? App.state.engine.variety(row.dataset.variety) : null;
    return c ? { payload: v ? { cropId: c.id, varietyId: v.id } : { cropId: c.id }, label: v ? `${v.name} · ${c.name}` : c.name, color: App.state.engine.cropColor(c) } : null;
  }
  function initLibrary() {
    const host = $('libList');
    let press = null;
    host.addEventListener('pointerdown', e => {
      const row = e.target.closest('.lib-row');
      press = { x: e.clientX, y: e.clientY };
      if (!row || e.target.closest('.lib-more')) return;
      const spec = libraryPayload(row);
      if (spec) root.LRFDrag.watch(e, spec);
    });
    const activate = e => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) { const id = toggle.dataset.toggle; lib.open.has(id) ? lib.open.delete(id) : lib.open.add(id); renderLibrary(); return; }
      const row = e.target.closest('.lib-row');
      if (!row) return;
      const spec = libraryPayload(row), armed = App.state.armed;
      if (!spec) return;
      const same = armed && armed.cropId === spec.payload.cropId && (armed.varietyId || '') === (spec.payload.varietyId || '');
      App.arm(same ? null : spec.payload);
    };
    host.addEventListener('click', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return; activate(e); });
    host.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.lib-row') && !e.target.closest('.lib-more')) { e.preventDefault(); activate(e); } });
    $('libSearch').addEventListener('input', e => { lib.query = e.target.value; renderLibrary(); });
    for (const button of document.querySelectorAll('[data-lib-scope]')) {
      button.addEventListener('click', () => { lib.scope = button.dataset.libScope; for (const b of document.querySelectorAll('[data-lib-scope]')) b.setAttribute('aria-pressed', String(b === button)); renderLibrary(); });
    }
    App.on('plan', renderLibrary);
    App.on('armed', renderLibrary);
  }

  // ═════════════════════════════ inspector ═════════════════════════════
  const Rails = root.LRFRails;
  const field = (label, control, help) => h('label.field', h('span', label), control, help ? h('small', help) : null);
  const stat = (label, value) => h('div.stat', h('span', label), h('b', value));
  const names = list => list.length <= 2 ? list.join(' and ') : `${list[0]} and ${list.length - 1} more`;

  function plantingRow(p, r) {
    const eng = App.state.engine, f = eng.footprint(p, r);
    const where = f && r.partial ? ` · ${num(f.a0, 1)}–${num(Math.min(f.a1, r.cap), 1)} ft${f.rows && f.rows.count < f.rows.total ? `, ${f.rows.count} of ${f.rows.total} rows` : ''}` : r.partial ? ` · ${num(r.len, 1)} ${eng.capUnit(r.b)}` : '';
    return h('li.p-row', { dataset: { planting: p.id }, role: 'button', tabindex: 0, title: 'Click to edit. Drag onto another bed to move.' },
      root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color: eng.cropColor(r.c), label: r.c.vname || r.c.name, size: 30, cls: 'key' }),
      h('span.p-text', h('b', r.c.vname ? `${r.c.vname} · ${r.c.name}` : r.c.name), h('small', `In ${day(r.field)} · harvest ${span(r.first, r.last)}${where}`)));
  }

  // ── cleanup: overlaps that came in with the plan, each with ways to settle it ──
  const cleanups = new WeakMap();
  const cleanupOf = eng => cleanups.get(eng) || cleanups.set(eng, Rails.cleanup(eng)).get(eng);
  /** This copy of the page was built from a later v7 backup than the plan saved in this browser. */
  function renderNewer(host) {
    const n = App.state.newer;
    if (!n) return;
    const when = t => { const d = new Date(t); return Number.isFinite(+d) ? `${UI.MONTHS[d.getMonth()]} ${d.getDate()}` : 'an earlier date'; };
    const switchPlan = async () => {
      const ok = await UI.confirm({ title: 'Switch to the newer plan?', body: `The plan open here is replaced by your v7 backup of ${when(n.backup)}. Anything changed here since the older plan was loaded (stock counts, recorded sowings, plantings moved) is lost; use Backup first if you want a copy. Your v7 planner is not touched.`, confirmLabel: 'Switch plan', danger: true });
      if (ok) App.useBundled();
    };
    add(host, h('section.insp-section.newer', h('h3', 'A newer plan came with this copy'),
      h('p.help', `This copy of the planner was built from your v7 backup of ${when(n.backup)}${n.counts && n.counts.plantings ? `, ${num(n.counts.plantings)} plantings` : ''}. The plan open now is the one this browser already held${n.held ? `, from ${when(n.held)}` : ''}.`),
      h('div.newer-actions', h('button.btn.primary', { type: 'button', onclick: switchPlan }, `Use the ${when(n.backup)} plan`), h('button.btn', { type: 'button', onclick: () => App.keepMine() }, 'Keep this one'))));
  }
  function renderCleanup(host) {
    const eng = App.state.engine, todo = cleanupOf(eng);
    if (!todo.count) return;
    const sets = new Map();
    for (const x of todo.long) { const key = `${x.r.b.gardenId}|${x.want}|${x.cap}`; (sets.get(key) || sets.set(key, []).get(key)).push(x); }
    const section = h('section.insp-section.cleanup', h('h3', `To settle · ${sets.size + todo.groups.length}`),
      h('p.help', 'Ground booked twice, or plantings longer than their bed. They came in with the v7 plan or from a change to the assumptions. The map will not let you add to them.'));
    const run = (label, ops) => { if (App.commit(label, ops)) UI.toast(label, { label: 'Undo', run: App.undo }); };
    const action = (label, detail, onclick) => h('button.fix-btn', { type: 'button', onclick }, h('b', label), detail ? h('small', detail) : null);

    // Plantings longer than their bed, a garden at a time.
    for (const list of sets.values()) {
      const { r, want, cap } = list[0], garden = eng.gardenOf(r.b) || {}, unit = eng.capUnit(r.b), n = list.length;
      const mates = App.state.plan.beds.filter(b => b.gardenId === r.b.gardenId && b.active !== false && eng.isSoilBed(b)), uniform = eng.isSoilBed(r.b) && mates.every(b => eng.capOf(b) === cap);
      section.append(h('div.fix',
        h('button.fix-title', { type: 'button', onclick: () => { App.setDate(list[0].r.field); App.select({ type: 'planting', id: list[0].p.id }); } }, garden.name || 'Garden'),
        h('p', `${n} planting${n === 1 ? ' is' : 's are'} ${num(want, 1)} ${unit} long in ${num(cap, 1)}-${unit} ${n === 1 ? 'space' : 'beds'}.`),
        h('div.fix-actions',
          action(`Make ${n === 1 ? 'it' : 'them'} ${num(cap, 1)} ${unit}`, 'Plant counts follow the shorter length', () => run(`Fit ${n} planting${n === 1 ? '' : 's'} to ${n === 1 ? 'its bed' : 'their beds'}`, Rails.trimOps(eng, list))),
          uniform ? action(`The beds are ${num(want, 1)} ft`, `Lengthens all ${mates.length} beds in ${garden.name}`, () => { if (App.updateBeds(mates.map(b => b.id), { l: want }, `Set ${garden.name} beds to ${num(want, 1)} ft`)) UI.toast(`${garden.name} beds are now ${num(want, 1)} ft`, { label: 'Undo', run: App.undo }); }) : null)));
    }
    // Two crops booked into the same ground.
    for (const g of todo.groups) {
      const late = App.cropLabel(g.late), early = names(g.early.map(o => App.cropLabel(o.p))), until = Math.max(...g.early.map(o => +o.through));
      const actions = g.options.map(o => {
        if (o.id === 'later') return action(`Plant ${late} ${day(o.date)}`, `${o.days} day${o.days === 1 ? '' : 's'} later${o.also.length ? ` · also moves ${names(o.also.map(x => App.cropLabel(x.p)))} to ${day(o.also[0].date)}` : ''}`, () => run(`Plant ${late} ${day(o.date)}`, o.ops));
        if (o.id === 'sooner') return action(`Last ${early} harvest ${day(o.date)}`, `${o.days} fewer harvest day${o.days === 1 ? '' : 's'} · turnover days kept`, () => run(`End ${early} harvest ${day(o.date)}`, o.ops));
        return action(`No gap before ${late}`, `${o.days ? `${early} ends ${day(o.date)}, ${o.days} harvest day${o.days === 1 ? '' : 's'} less` : `${early} harvest unchanged`} · skips the ${o.gap}-day turnover`, () => run(`No turnover gap before ${late}`, o.ops));
      });
      section.append(h('div.fix',
        h('button.fix-title', { type: 'button', title: 'Show on the map', onclick: () => { App.setDate(g.from); App.select({ type: 'planting', id: g.late.id }); } }, App.bedLabel(g.bed)),
        h('p', Number.isFinite(until) ? `${late} goes in ${day(g.r.field)}, ${g.days} day${g.days === 1 ? '' : 's'} before the ground is clear of ${early} (${day(E.addDays(new Date(until), 1))}).` : `${late} goes in ${day(g.r.field)} on ground that ${early} never leaves.`),
        h('div.fix-actions', actions),
        h('p.help', 'Or drag either one to other ground on the map.')));
    }
    host.append(section);
  }

  const inGround = () => { const eng = App.state.engine, spaces = App.state.plan.beds.filter(b => b.active !== false && !eng.isPool(b)); return `${spaces.filter(b => eng.cropsAt(b.id, App.state.date).length).length} of ${spaces.length}`; };
  function renderOverview(host) {
    const plan = App.state.plan, date = App.state.date;
    if (App.isSample()) {
      add(host, h('section.welcome',
        h('p.eyebrow', 'Start here'), h('h2', 'Load your plan'),
        h('p', 'This is a sample layout so the page is not empty. Load the complete backup (.zip) from your v7 planner and your gardens, beds, plantings, varieties and map photo appear here.'),
        h('button.btn.primary', { type: 'button', onclick: () => $('importFile').click() }, 'Load a v7 backup…'),
        h('p.help', 'You can also drop the file anywhere on this page. Your v7 planner is not changed.')));
    }
    const ground = stat(`In the ground ${day(date)}`, inGround());
    ground.id = 'statGround';
    add(host, h('header.insp-head', h('p.eyebrow', `${plan.settings.farm || 'Farm'} · ${App.planYear()} season`), h('h2', 'Plan overview')),
      h('div.stats', stat('Plantings', num(plan.plantings.length)), stat('Growing spaces', num(plan.beds.filter(b => b.active !== false && !App.state.engine.isPool(b)).length)), ground));
    renderNewer(host);
    renderCleanup(host);
    add(host, h('section.insp-section.howto', h('h3', 'On the map'),
      h('ul.how',
        h('li', h('b', 'Plant'), 'Drag a crop from the library onto a bed. It goes in on the date under the map.'),
        h('li', h('b', 'Move'), 'Drag a planting to other ground. It keeps its date. Hold Alt to leave a copy.'),
        h('li', h('b', 'Trade'), 'Drop a planting on ground that is held and the two trade places, when both fit.'),
        h('li', h('b', 'Share a bed'), 'Select a planting and drag its ends. The feet it gives up take the next crop.'),
        h('li', h('b', 'Look closer'), 'Click a garden name to zoom to it. Wheel zooms, drag pans, Space pans from anywhere.'),
        h('li', h('b', 'Colours'), 'Pale while a crop is growing, full colour while it is being picked, hatched while the bed turns over. Click a crop in the bar under the map to show only that crop.'))));
  }

  function renderBed(host, bed) {
    const eng = App.state.engine, date = App.state.date, status = eng.bedStatus(bed, date), g = eng.gardenOf(bed) || {}, unit = eng.capUnit(bed), soil = eng.isSoilBed(bed);
    const all = eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).sort((a, b) => a.r.field - b.r.field);
    const kind = { bed: 'Bed', tower: 'Tower', bench: 'Bench', containers: 'Containers' }[eng.spaceKind(bed)];
    const size = key => h('input', { type: 'number', min: key === 'w' ? 0.5 : 1, max: key === 'w' ? 30 : 2000, step: 0.5, value: bed[key], id: key === 'w' ? 'fBedW' : 'fBedL',
      onchange: e => { const n = +e.target.value; if (!(n > 0) || !App.updateBeds([bed.id], { [key]: n }, `Change ${App.bedLabel(bed)} ${key === 'w' ? 'width' : 'length'}`)) render(); } });
    host.append(h('header.insp-head',
      h('p.eyebrow', `${g.name || 'Garden'} · ${eng.lib.gardenTypeLabels[g.type] || g.type || ''}`),
      h('h2', `${kind} ${bed.bed}`),
      h('p.spec', soil ? `${num(bed.w * bed.l)} sq ft` : `${num(status.cap)} ${unit}`),
      h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select(null) }, '×')),
      h('div.stats', stat(`On ${day(date)}`, status.crops.length ? `${num(status.used, 1)} of ${num(status.cap, 1)} ${unit} planted` : status.resting ? 'Turning over' : 'Free'),
        stat('This season', `${all.length} planting${all.length === 1 ? '' : 's'}`)));
    if (soil) host.append(h('section.insp-section.form', h('div.field-pair', field('Width (ft)', size('w')), field('Length (ft)', size('l'))),
      h('p.help', 'Whole-bed plantings follow the bed. Rows and plant counts are worked out from these.')));
    const list = h('ul.p-list');
    for (const { p, r } of all) list.append(plantingRow(p, r));
    host.append(h('section.insp-section', h('h3', 'Plantings'), all.length ? list : h('p.note', 'Nothing planned here yet. Drag a crop onto this bed.')));
  }

  /** Buttons for the rows across a bed; the pressed ones are this planting's. */
  function rowPicker(p, f, total, set) {
    const start = f.rows ? f.rows.start : 0, count = f.rows ? f.rows.count : total, end = start + count - 1, box = h('div.rows', { role: 'group', 'aria-label': 'Rows this planting uses' });
    for (let i = 0; i < total; i++) {
      const on = i >= start && i <= end;
      box.append(h('button', { type: 'button', 'aria-pressed': String(on), title: `Row ${i + 1}`, onclick: () => {
        let a = start, b = end;
        if (!on) { a = Math.min(a, i); b = Math.max(b, i); } else if (count === 1) return; else if (i === a) a++; else if (i === b) b--; else { a = i; b = i; }
        const change = Rails.rowsChange(App.state.engine, p, a, b - a + 1, total);
        if (change) set(change, 'Change rows');
      } }, String(i + 1)));
    }
    return box;
  }

  // ── sowing: the one record that moves seed off the shelf ──
  const qty = (n, unit) => `${num(n, unit === 'g' ? 1 : 0)} ${unit === 'g' ? 'g' : unit}`;
  const dayY = d => day(d) + (E.validDate(d) && d.getFullYear() !== App.planYear() ? `, ${d.getFullYear()}` : '');   // a sowing recorded outside the plan's year says so
  /** What a recorded sowing took, in words, from the planting's own record. */
  function sownText(s) {
    const mine = s.uses.filter(u => u && u.source === 'sowing' && u.unit === s.stockUnit), total = mine.reduce((n, u) => n + (+u.quantity || 0), 0), loose = mine.filter(u => !u.lotId).reduce((n, u) => n + (+u.quantity || 0), 0);
    if (!total) return 'No seed use was recorded with it.';
    const word = s.unit === 'g' ? 'g of seed' : s.unit;
    return loose >= total ? `${num(total, s.unit === 'g' ? 1 : 0)} ${word} used, none of it from a counted lot.` : `${num(total, s.unit === 'g' ? 1 : 0)} ${word} used${loose ? `, ${num(loose, s.unit === 'g' ? 1 : 0)} of them not from a counted lot` : ', all off stock'}.`;
  }
  /**
   * The sowing of one planting: a date and the seed used, recorded in one step, or what was recorded and a way to
   * take it back. Used in the inspector and beside a variety's plantings in the seed library.
   */
  function sowingBox(p) {
    const s = App.sowingOf(p);
    if (!s) return null;
    const seed = s.unit === 'seeds' || s.unit === 'g', act = s.kind === 'sow' || seed ? 'Sown' : 'Planted', name = s.variety ? s.variety.name : s.crop.name, word = s.unit === 'g' ? 'g of seed' : s.unit;
    const box = h('div.sow', { dataset: { sowing: p.id, state: s.done ? 'done' : s.sown ? 'later' : 'open' } });
    if (s.done) {
      return add(box, h('p.sow-done', h('b', `✓ ${act} ${dayY(E.s2d(s.done))}`), h('span', sownText(s))),
        h('button.link', { type: 'button', dataset: { sow: 'back' }, onclick: () => {
          const done = App.takeBackSowing(p.id);
          if (done) toast(`${App.cropLabel(p)}: sowing taken back${done.returned ? ` · ${qty(done.returned, done.stockUnit)} returned to stock` : ''}${done.lost ? ` · ${qty(done.lost, done.stockUnit)} could not go back: that lot is gone` : ''}`, { label: 'Undo', run: App.undo });
        } }, 'Take it back'));
    }
    if (s.sown) return add(box, h('p.sow-done', h('span', 'Later work is already recorded for this planting, so its seed is no longer counted as still to sow.')));
    const lots = SL.lotsToUse(App.inventoryNow(), s.key, s.stockUnit), onHand = lots.reduce((n, l) => n + Number(l.quantity), 0), today = App.today();
    const date = h('input', { type: 'date', value: today, max: today, 'aria-label': `${act} on`, dataset: { sow: 'date' } });
    const used = h('input', { type: 'number', min: 0, step: s.stockUnit === 'g' ? 'any' : 1, value: s.estimate, 'aria-label': `${word} used`, dataset: { sow: 'quantity' }, oninput: () => says() });
    const note = h('p.help', { dataset: { sow: 'note' } });
    function says() {
      const n = Math.max(0, +used.value || 0);
      note.textContent = `Planned for ${day(s.planned)}. ` + (!onHand ? `No ${word} on hand ${s.variety ? 'for ' + name : 'with no variety chosen'}, so nothing comes off stock.`
        : n <= onHand ? `${qty(onHand, s.stockUnit)} on hand${lots.length > 1 ? ` in ${lots.length} lots, oldest used first` : ''}: ${qty(Math.round((onHand - n) * 1e6) / 1e6, s.stockUnit)} left after this.`
          : `Only ${qty(onHand, s.stockUnit)} on hand: the other ${qty(Math.round((n - onHand) * 1e6) / 1e6, s.stockUnit)} is recorded as used without a counted lot.`);
    }
    says();
    return add(box,
      h('div.sow-row', h('label', h('span', `${act} on`), date), h('label', h('span', `${s.unit === 'g' ? 'Seed' : s.unit.charAt(0).toUpperCase() + s.unit.slice(1)} used${s.unit === 'g' ? ' (g)' : ''}`), used),
        h('button.btn', { type: 'button', dataset: { sow: 'record' }, onclick: () => {
          const done = App.recordSowing(p.id, { date: date.value, quantity: used.value });
          if (!done) return;
          const off = done.used.reduce((n, u) => n + u.quantity, 0);
          toast(`${App.cropLabel(p)} ${act.toLowerCase()} ${dayY(E.s2d(date.value))} · ${off ? `${qty(off, done.stockUnit)} off stock` : 'nothing off stock'}${done.untracked ? ` · ${qty(done.untracked, done.stockUnit)} not from a counted lot` : ''}${done.overlaps ? ` · it now overlaps ${done.overlaps === 1 ? 'another planting' : done.overlaps + ' plantings'}: see To settle` : ''}`, { label: 'Undo', run: App.undo });
        } }, 'Record')),
      note);
  }

  function renderPlanting(host, p) {
    const eng = App.state.engine, r = eng.calc(p);
    if (!r) { host.append(h('p.note', 'This planting cannot be calculated. Its saved data is kept.'), h('button.btn.danger', { type: 'button', onclick: () => App.removePlantings([p.id]) }, 'Remove planting')); return; }
    const bed = r.b, c = r.c, color = eng.cropColor(c), unit = eng.capUnit(bed), through = eng.occupancyThrough(p, r), f = eng.footprint(p, r);
    const timing = c.catalogTiming || {}, v = eng.variety(p.varietyId), sow = App.sowingOf(p);
    const set = (change, label) => { if (!App.updatePlanting(p.id, change, label)) render(); };

    // Variety
    const varieties = eng.varietiesOf(p.cropId), variety = h('select', { id: 'fVariety', onchange: e => set({ varietyId: e.target.value || null, variety: null }, 'Change variety') }, h('option', { value: '' }, 'No variety chosen'));
    if (v && !varieties.includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    for (const x of varieties) variety.append(h('option', { value: x.id, selected: x.id === p.varietyId }, x.name));
    // Space
    const space = h('select', { id: 'fSpace', onchange: e => { if (!App.place({ plantingId: p.id }, e.target.value, E.s2d(p.date), { noSwap: true })) render(); } });
    for (const garden of App.state.plan.gardens) {
      const options = App.state.plan.beds.filter(b => b.gardenId === garden.id && b.active !== false && (b.id === bed.id || eng.spaceKind(b) === eng.spaceKind(bed)));
      if (!options.length) continue;
      const group = h('optgroup', { label: garden.name });
      for (const b of options) group.append(h('option', { value: b.id, selected: b.id === bed.id }, `${garden.name} · ${eng.isTower(b) ? 'Tower ' : ''}${b.bed}`));
      space.append(group);
    }
    const lengthKey = r.rack ? 'trays' : 'ft', whole = !(p[lengthKey] > 0) || (!r.layout && r.physicalLength >= r.cap);
    const setLength = raw => {
      const n = +raw;
      if (!f) return set({ [lengthKey]: n > 0 && n < r.cap ? n : null }, 'Change length');
      if (r.layout) return set({ ft: Math.min(n > 0 ? n : r.cap, r.cap - r.layout.startFt) }, 'Change length');
      if (!(n > 0) || n >= r.cap) return set({ ft: null, startFt: null }, 'Change length');
      set({ ft: n, startFt: Math.min(f.a0, r.cap - n) > 0 ? Math.min(f.a0, r.cap - n) : null }, 'Change length');
    };
    const split = f && f.rows && f.rows.count < f.rows.total, totalRows = f ? (f.rows ? f.rows.total : r.rows) : 0;
    const whereText = !f ? null : r.partial || split ? `Feet ${num(f.a0, 1)}–${num(Math.min(f.a1, r.cap), 1)} of ${num(r.cap, 1)}. Drag its ends on the map to change them.` : 'Whole bed. Shorten it here, or drag its ends on the map, to share the bed.';
    const dtmSource = timing.activeMode === 'catalog' ? `From the supplier's ${timing.printed}-day figure${timing.conversion === 'seed-minus-nursery' ? `, less ${timing.nurseryDays} nursery days` : ''}.`
      : p.dtm > 0 ? 'Pinned: this planting keeps its own days. Clear the field and it follows the assumptions list.' : v && v.dtm > 0 ? 'Your figure for this variety.' : 'Crop default. Set your own on the Assumptions tab.';
    const fromList = c.assumed ? `From your assumptions list: ${c.assumed.level === 'variety' ? (c.vname || 'this variety') : c.name}, ${root.LRFAssume.LABEL[c.assumed.env].toLowerCase()}.` : null;

    add(host,
      h('header.insp-head.planting', { style: { '--crop': color } },
        root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color, label: c.vname || c.name, size: 64, cls: 'head' }),
        h('p.eyebrow', c.name), h('h2', c.vname || c.name),
        h('button.link', { type: 'button', onclick: () => App.select({ type: 'bed', id: bed.id }) }, App.bedLabel(bed)),
        h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select({ type: 'bed', id: bed.id }) }, '×')),
      h('section.insp-section.form',
        field(c.method === 'TP' ? 'Transplant date' : sow && sow.kind === 'field' && sow.done ? 'Planned sowing date' : 'Sowing date', h('input', { type: 'date', id: 'fDate', value: p.date, onchange: e => { if (E.validDate(E.s2d(e.target.value))) set({ date: e.target.value }, 'Change date'); else render(); } })),
        field('Variety', variety),
        field('Growing space', space),
        r.tw ? null : field(r.ct ? 'Containers' : r.rack ? 'Trays' : 'Length (ft)',
          h('input', { type: 'number', id: 'fLength', min: 1, max: r.cap, step: r.ct || r.rack ? 1 : 0.5, value: whole ? '' : +(+p[lengthKey]).toFixed(2), placeholder: `Whole ${r.ct ? 'group' : r.rack ? 'bench' : 'bed'} · ${num(r.cap, 1)}`,
            onchange: e => setLength(e.target.value) }), whereText),
        f && totalRows >= 2 && totalRows <= 12 ? field('Rows', rowPicker(p, f, totalRows, set), split ? `Uses ${f.rows.count} of ${f.rows.total} rows. The others are free for another crop.` : 'Uses every row. Release some to grow another crop alongside.') : null,
        h('div.field-pair',
          field('Days to harvest', h('input', { type: 'number', id: 'fDtm', min: 1, max: 730, value: p.dtm > 0 ? p.dtm : '', placeholder: String(c.dtm),
            onchange: e => { const n = Math.round(+e.target.value); set(n > 0 ? { dtm: n, timingMode: 'manual' } : { dtm: null, timingMode: p.timingMode === 'manual' ? null : p.timingMode }, 'Change days to harvest'); } })),
          field('Harvest days', h('input', { type: 'number', id: 'fHw', min: 0, max: 400, value: p.hw != null && p.hw !== '' ? p.hw : '', placeholder: r.harvestMode === 'season' ? 'To season end' : String(c.hw),
            onchange: e => { const raw = e.target.value; set(raw === '' ? { hw: null, harvestMode: null } : { hw: Math.max(0, Math.round(+raw)), harvestMode: 'window' }, 'Change harvest days'); } }))),
        h('p.help', fromList || dtmSource)),
      h('section.insp-section',
        h('h3', 'Schedule'),
        h('ol.schedule',
          r.sow ? h('li' + (sow && sow.kind === 'sow' && sow.done ? '.done' : ''), h('span', sow && sow.kind === 'sow' && sow.done ? 'Sown in nursery' : 'Sow in nursery'), h('b', day(r.sow))) : null,
          h('li' + (sow && sow.kind === 'field' && sow.done ? '.done' : ''), h('span', c.method === 'TP' ? 'Transplant' : sow && sow.kind === 'field' && sow.done ? 'Direct sown' : 'Direct sow'), h('b', day(r.field))),
          h('li', h('span', 'First harvest'), h('b', day(r.first))),
          h('li', h('span', 'Last harvest'), h('b', r.harvestDays ? day(r.last) : 'None before the season ends')),
          h('li', h('span', 'Ground free again'), h('b', through === Infinity ? 'Stays planted' : day(E.addDays(through, 1)))))),
      sow ? h('section.insp-section', h('h3', sow.kind === 'sow' || sow.unit === 'seeds' ? 'Sowing' : 'Planting'), sowingBox(p)) : null,
      h('section.insp-section',
        h('h3', 'Quantities'),
        h('div.stats',
          stat(r.tw ? 'Sites' : 'Plants', num(r.plants)),
          r.tw || r.rack || r.ct ? null : stat('Rows', num(r.rows)),
          r.tw || r.rack || r.ct ? null : stat('In-row spacing', `${num(r.inRow, 1)} in`),
          r.cells ? stat('Plugs to raise', `${num(r.cells)} · ${num(r.trays)} tray${r.trays === 1 ? '' : 's'}`) : r.seeds ? stat('Seeds', num(r.seeds)) : null)),
      h('section.insp-section',
        h('h3', 'Repeat as successions'),
        h('div.repeat',
          h('input', { type: 'number', id: 'fRepeatCount', min: 1, max: 30, value: 3, 'aria-label': 'How many more' }), h('span', 'more, every'),
          h('input', { type: 'number', id: 'fRepeatEvery', min: 1, max: 120, value: Math.max(7, Math.min(28, r.c.hw || 14)), 'aria-label': 'Days apart' }), h('span', 'days'),
          h('button.btn', { type: 'button', onclick: () => App.addSuccessions(p.id, Math.max(1, Math.min(30, Math.round(+$('fRepeatCount').value) || 1)), Math.max(1, Math.round(+$('fRepeatEvery').value) || 14)) }, 'Add')),
        h('p.help', `Each one takes this ${unit === 'sites' ? 'tower' : 'bed'} if it is free by then, otherwise the next free one in ${eng.gardenOf(bed).name}.`)),
      h('div.insp-actions', h('button.btn.danger', { type: 'button', onclick: () => App.removePlantings([p.id]) }, 'Remove planting')));
  }

  // Removing a focused field can fire its change handler, which asks for another render: finish this one first.
  let rendering = false, renderAgain = false;
  function render() {
    if (!App.state.ready) return;
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try {
      const host = $('inspectorBody'), keep = host.scrollTop, sel = App.state.sel, eng = App.state.engine;
      clear(host);
      const p = sel && sel.type === 'planting' ? eng.planting(sel.id) : null, bed = sel && sel.type === 'bed' ? eng.bedOf(sel.id) : null;
      if (p) renderPlanting(host, p); else if (bed) renderBed(host, bed); else renderOverview(host);
      host.scrollTop = keep;
    } finally {
      rendering = false;
      if (renderAgain) { renderAgain = false; render(); }
    }
  }
  function initInspector() {
    const host = $('inspectorBody');
    let press = null;
    host.addEventListener('pointerdown', e => {
      press = { x: e.clientX, y: e.clientY };
      const row = e.target.closest('.p-row');
      if (!row) return;
      const p = App.state.engine.planting(row.dataset.planting), r = p && App.state.engine.calc(p);
      if (r) root.LRFDrag.watch(e, { payload: { plantingId: p.id }, label: App.cropLabel(p), color: App.state.engine.cropColor(r.c) });
    });
    const open = e => {
      const row = e.target.closest('.p-row');
      if (!row) return;
      const p = App.state.engine.planting(row.dataset.planting);
      if (p) App.select({ type: 'planting', id: p.id });
    };
    host.addEventListener('click', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return; open(e); });
    host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.p-row')) open(e); });
    App.on('plan', render);
    App.on('sel', render);
    App.on('date', () => {
      const sel = App.state.sel, ground = $('statGround');
      if (sel && sel.type === 'bed') render();
      else if (!sel && ground) { ground.querySelector('span').textContent = `In the ground ${day(App.state.date)}`; ground.querySelector('b').textContent = inGround(); }
    });
  }

  root.LRFPanels = { init() { initLibrary(); initInspector(); }, isMine, sowingBox };
})(window);
