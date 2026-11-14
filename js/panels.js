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
          canSeries(eng, c) ? h('button.lib-series', { type: 'button', title: `Plan a series of ${String(c.name).toLowerCase()}: one every so many days`, 'aria-label': `Plan a series of ${c.name}`, dataset: { series: c.id } }, 'series') : null,
          varieties.length ? h('button.lib-more', { type: 'button', 'aria-expanded': String(!!open), title: `${varieties.length} variet${varieties.length === 1 ? 'y' : 'ies'}`, 'aria-label': `${open ? 'Hide' : 'Show'} ${varieties.length} varieties of ${c.name}`, dataset: { toggle: c.id } }, open ? '▾' : '▸') : h('span.lib-more')));
      if (open) {
        const box = h('div.lib-vars', h('p.lib-meta', cropMeta(c)));
        for (const v of (nameHit ? varieties : varietyHits)) {
          const on = armed && armed.varietyId === v.id;
          box.append(h('div.lib-row.lib-var' + (on ? '.armed' : ''), { dataset: { crop: c.id, variety: v.id }, role: 'button', tabindex: 0, title: `${v.name}${v.catalogDtm ? ` · ${v.catalogDtm} days printed${v.catalogMaturityBasis && v.catalogMaturityBasis !== 'unspecified' ? ' from ' + ({ seed: 'sowing', direct: 'direct sowing', transplant: 'transplanting' }[v.catalogMaturityBasis] || v.catalogMaturityBasis) : ''}` : ''}` },
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
  const canSeries = (eng, c) => !c.micro && !eng.isCoverCrop(c) && +c.dtm > 0;
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
      if (!row || e.target.closest('.lib-more, .lib-series')) return;
      const spec = libraryPayload(row);
      if (spec) root.LRFDrag.watch(e, spec);
    });
    const activate = e => {
      const series = e.target.closest('[data-series]');
      if (series) { App.openAhead({ mode: 'series', cropId: series.dataset.series }); return; }
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
    host.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.lib-row') && !e.target.closest('.lib-more, .lib-series')) { e.preventDefault(); activate(e); } });
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

  // ── "Saved": the panel's own word that a change was taken ──
  // A change in this panel applies the moment its field is left; there is nothing to press. This line, under the panel's
  // heading, says so, and for a few seconds after a change says that it was taken, when, and offers its Undo. A change that
  // was refused says why in the same place. It speaks for the change (App.commit); whether the plan is stored is the header's to say.
  const SAID_FOR = 8000;
  const clock = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const selKey = () => { const sel = App.state.sel; return sel ? `${sel.type}:${sel.id}` : ''; };
  let lastSeen = null, lastSel = '';
  function fillSaved(el) {
    const last = App.lastChange();
    // the change is said in the panel that was open when it was made, not in whichever is opened next
    if (last && last.at !== lastSeen) { lastSeen = last.at; lastSel = selKey(); }
    const fresh = last && Date.now() - last.at < SAID_FOR && lastSel === selKey();
    clearTimeout(el.lrfTimer);
    clear(el);
    if (!fresh) { el.dataset.state = 'idle'; add(el, 'Changes apply as you make them.'); return el; }
    el.dataset.state = last.kind;
    el.style.setProperty('--since', `${last.at - Date.now()}ms`);
    if (last.kind === 'saved') add(el, h('b', 'Saved'), h('span', ` · ${last.label} · ${clock(last.at)}`), last.canUndo ? h('button.link', { type: 'button', dataset: { saved: 'undo' }, onclick: () => App.undo() }, 'Undo') : null);
    else add(el, h('b', 'Not changed'), h('span', ` · ${last.text}`));
    el.lrfTimer = setTimeout(() => { if (el.isConnected) fillSaved(el); }, SAID_FOR - (Date.now() - last.at) + 30);
    return el;
  }
  const savedLine = () => fillSaved(h('p.insp-saved', { role: 'status' }));
  // A field is left by clicking somewhere else, and that click can close the panel in the same breath (the map's open ground,
  // another bed). The change was taken and its line was never seen: then, and only then, it is said once in a toast.
  let saidAway = null;
  function sayIfGone() {
    const last = App.lastChange();
    if (!last || last.kind !== 'saved' || last.at !== lastSeen || last.at === saidAway || !lastSel || lastSel === selKey() || Date.now() - last.at > 1500) return;
    saidAway = last.at;
    const host = $('toast');
    if (host && host.classList.contains('show') && host.textContent.includes(last.label)) return;   // it is already being said
    toast(`Saved · ${last.label}`, last.canUndo ? { label: 'Undo', run: App.undo } : undefined);
  }
  const resaid = () => { for (const el of document.querySelectorAll('.insp-saved')) fillSaved(el); };

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
  /** One over-long set is the plantings of one garden that are one length in beds of another. */
  const longSets = todo => { const sets = new Map(); for (const x of todo.long) { const key = `${x.r.b.gardenId}|${x.want}|${x.cap}`; (sets.get(key) || sets.set(key, []).get(key)).push(x); } return sets; };
  /** How many things wait under To settle: the number its heading says. */
  function settleCount(eng = App.state.engine) { const todo = cleanupOf(eng); return todo.count ? longSets(todo).size + todo.groups.length : 0; }
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
  /** One over-long set in plain words: "28 plantings are 22 ft long, but the beds in the north field are 20 ft." */
  function tooLong(eng, list) {
    const { r, want, cap } = list[0], garden = (eng.gardenOf(r.b) || {}).name || 'this garden', n = list.length, one = new Set(list.map(x => x.r.b.id)).size === 1;
    const kind = eng.spaceKind(r.b), what = `${num(n)} planting${n === 1 ? '' : 's'}`;
    if (kind === 'bench') return `${what} ${n === 1 ? 'takes' : 'each take'} ${num(want, 1)} tray${want === 1 ? '' : 's'}, but ${one ? `bench ${r.b.bed}` : 'each bench'} in ${garden} holds ${num(cap, 1)}.`;
    if (kind === 'containers') return `${what} ${n === 1 ? 'fills' : 'each fill'} ${num(want, 1)} container${want === 1 ? '' : 's'}, but ${one ? `${r.b.bed}` : 'each group'} in ${garden} has ${num(cap, 1)}.`;
    return `${what} ${n === 1 ? 'is' : 'are'} ${num(want, 1)} ft long, but ${one ? `bed ${r.b.bed} in ${garden} is` : `the beds in ${garden} are`} ${num(cap, 1)} ft.`;
  }
  /** Pictures the plan should have and has not: said once, here, with the one thing to do about it. */
  function renderPhotos(host) {
    const gaps = App.photoGaps();
    if (!gaps.map && !gaps.varieties) return;
    const n = gaps.varieties, lines = [];
    if (gaps.map) lines.push(h('li', h('b', 'The farm photo'), 'A plan file holds the plan only, so the photo did not come with it. The beds keep their places and wait for it.'));
    if (n) lines.push(h('li', h('b', `${num(n)} variety photo${n === 1 ? '' : 's'}`),
      gaps.working ? `Being fetched from where each was first found: ${num(gaps.left)} to go. Each is kept here once it arrives.`
        : gaps.shown ? `${gaps.shown === n ? 'Shown' : `${num(gaps.shown)} shown`} from the supplier’s own site while this computer is online, not kept here yet. ${gaps.service ? 'The fetch service could not get them this time; the planner tries again in a week.' : 'Those suppliers do not hand their pictures to another site. Add them below. With Cloud sync set up, or a fetch service of your own (Seeds, Add from a link), the planner fetches them itself.'}`
          : 'Their records name a photo but not where it came from.'));
    add(host, h('section.insp-section.photos', { id: 'photoGaps' }, h('h3', 'Pictures missing'), h('ul.how', lines),
      h('button.btn', { type: 'button', id: 'photoGapsAdd', onclick: () => $('photosFile').click() }, 'Add photos…'),
      h('p.help', 'A picture file for the farm photo; for varieties, your complete backup (.zip) or the plan folder’s thumbnails.json. Or drop them anywhere on the page. The plan is not replaced.')));
  }
  function renderCleanup(host) {
    const eng = App.state.engine, todo = cleanupOf(eng);
    if (!todo.count) return;
    const sets = longSets(todo);
    const total = sets.size + todo.groups.length;
    const section = h('section.insp-section.cleanup', { id: 'toSettle' }, h('h3', `To settle · ${total}`),
      h('p.help', 'Ground booked twice, or plantings longer than their bed. They came in with the plan, or follow from a change to the assumptions. Each has a fix in one click; the map will not let you add to them.'));
    const run = (label, ops) => { if (App.commit(label, ops)) UI.toast(label, { label: 'Undo', run: App.undo }); };
    const action = (label, detail, onclick) => h('button.fix-btn', { type: 'button', onclick }, h('b', label), detail ? h('small', detail) : null);

    // Plantings longer than their bed, a garden at a time.
    const makers = [];
    for (const list of sets.values()) makers.push(() => {
      const { r, want, cap } = list[0], garden = eng.gardenOf(r.b) || {}, unit = eng.capUnit(r.b), n = list.length;
      const mates = App.state.plan.beds.filter(b => b.gardenId === r.b.gardenId && b.active !== false && eng.isSoilBed(b)), uniform = eng.isSoilBed(r.b) && mates.every(b => eng.capOf(b) === cap);
      return h('div.fix',
        h('button.fix-title', { type: 'button', onclick: () => { App.setDate(list[0].r.field); App.select({ type: 'planting', id: list[0].p.id }); } }, garden.name || 'Garden'),
        h('p', tooLong(eng, list)),
        h('div.fix-actions',
          action(`Make ${n === 1 ? 'it' : 'them'} ${num(cap, 1)} ${unit}`, unit === 'ft' ? 'Plant counts follow the shorter length' : '', () => run(`Fit ${n} planting${n === 1 ? '' : 's'} to ${n === 1 ? 'its bed' : 'their beds'}`, Rails.trimOps(eng, list))),
          // A bed's length is a fact about the ground and is changed in one place, the layout, under its guard rail. This fix
          // changes nothing itself: it opens the layout with these beds picked and the length ready to set.
          uniform && root.LRFMapEdit ? h('button.fix-btn', { type: 'button', dataset: { fix: 'layout' }, onclick: () => root.LRFMapEdit.open({ bedIds: mates.map(b => b.id), propose: { l: want, why: `${num(want, 1)} ft is what is planted in ${mates.length === 1 ? 'it' : 'them'}` } }) },
            h('b', `Set ${mates.length === 1 ? 'this bed' : 'these beds'} to ${num(want, 1)} ft in Edit layout…`), h('small', `${mates.length === 1 ? 'The bed' : `All ${mates.length} beds`} in ${garden.name}, picked there with the length ready. Nothing changes until you set it.`)) : null));
    });
    // Two crops booked into the same ground.
    for (const g of todo.groups) makers.push(() => {
      const late = App.cropLabel(g.late), early = names(g.early.map(o => App.cropLabel(o.p))), until = Math.max(...g.early.map(o => +o.through));
      const actions = g.options.map(o => {
        if (o.id === 'later') return action(`Plant ${late} ${day(o.date)}`, `${o.days} day${o.days === 1 ? '' : 's'} later${o.also.length ? ` · also moves ${names(o.also.map(x => App.cropLabel(x.p)))} to ${day(o.also[0].date)}` : ''}`, () => run(`Plant ${late} ${day(o.date)}`, o.ops));
        if (o.id === 'sooner') return action(`Last ${early} harvest ${day(o.date)}`, `${o.days} fewer harvest day${o.days === 1 ? '' : 's'} · turnover days kept`, () => run(`End ${early} harvest ${day(o.date)}`, o.ops));
        return action(`No gap before ${late}`, `${o.days ? `${early} ends ${day(o.date)}, ${o.days} harvest day${o.days === 1 ? '' : 's'} less` : `${early} harvest unchanged`} · skips the ${o.gap}-day turnover`, () => run(`No turnover gap before ${late}`, o.ops));
      });
      return h('div.fix',
        h('button.fix-title', { type: 'button', title: 'Show on the map', onclick: () => { App.setDate(g.from); App.select({ type: 'planting', id: g.late.id }); } }, App.bedLabel(g.bed)),
        h('p', Number.isFinite(until) ? `${late} goes in ${day(g.r.field)}, ${g.days} day${g.days === 1 ? '' : 's'} before the ground is clear of ${early} (${day(E.addDays(new Date(until), 1))}).` : `${late} goes in ${day(g.r.field)} on ground that ${early} never leaves.`),
        h('div.fix-actions', actions),
        h('p.help', 'Or drag either one to other ground on the map.'));
    });
    // A long list is folded after its first three, so the overview stays an overview.
    const FIRST = 3, folds = makers.length > FIRST + 1;
    for (const make of folds && !cleanupOpen ? makers.slice(0, FIRST) : makers) section.append(make());
    if (folds) section.append(h('button.fix-more', { type: 'button', 'aria-expanded': String(cleanupOpen), onclick: () => { cleanupOpen = !cleanupOpen; render(); } }, cleanupOpen ? 'Show the first three only' : `Show the other ${makers.length - FIRST}`));
    host.append(section);
  }
  let cleanupOpen = false;

  const inGround = () => { const eng = App.state.engine, spaces = App.state.plan.beds.filter(b => b.active !== false && !eng.isPool(b)); return `${spaces.filter(b => eng.cropsAt(b.id, App.state.date).length).length} of ${spaces.length}`; };
  function renderOverview(host) {
    const plan = App.state.plan, date = App.state.date;
    if (App.isSample() && !App.state.unreadable) {
      add(host, h('section.welcome',
        h('p.eyebrow', 'No plan in this browser'), h('h2', 'Load your plan'),
        h('p', 'This is a sample layout so the page is not empty. A plan stays in the browser it was made in, so one made on another computer or in another browser is not here until you bring it.'),
        h('p', 'Load a backup downloaded from this planner, or the complete backup (.zip) from your v7 planner, and your gardens, beds, plantings, varieties and map photo appear here.'),
        h('div.welcome-actions',
          h('button.btn.primary', { type: 'button', onclick: () => $('importFile').click() }, 'Load a backup…'),
          App.folder().supported ? h('button.btn', { type: 'button', id: 'welcomeFolder', onclick: () => App.openMyFolder() }, 'Open my plan folder…') : null),
        h('p.help', 'You can also drop the file anywhere on this page. The file and your v7 planner are not changed.')));
    }
    const ground = stat(`In the ground ${day(date)}`, inGround());
    ground.id = 'statGround';
    add(host, h('header.insp-head', h('p.eyebrow', `${plan.settings.farm || 'Farm'} · ${App.planYear()} season`), h('h2', 'Plan overview')),
      h('div.stats', stat('Plantings', num(plan.plantings.length)), stat('Growing spaces', num(plan.beds.filter(b => b.active !== false && !App.state.engine.isPool(b)).length)), ground));
    const waits = App.waiting().length;
    if (waits) add(host, h('p.wt-note', { id: 'ovWaiting' }, `${num(waits)} more planting${waits === 1 ? ' has' : 's have'} no bed yet and ${waits === 1 ? 'is' : 'are'} counted nowhere: see “To place”, above the crop library.`));
    renderNewer(host);
    renderPhotos(host);
    renderCleanup(host);
    add(host, h('section.insp-section.howto', h('h3', 'On the map'),
      h('ul.how',
        h('li', h('b', 'Plant'), 'Drag a crop from the library onto a bed. It goes in on the date under the map.'),
        h('li', h('b', 'Series'), h('span', 'One crop every so many days: ', h('button.linkish', { type: 'button', id: 'ovSeries', onclick: () => App.openAhead({ mode: 'series' }) }, 'plan a series'), ', or use “series” beside a crop in the library.')),
        h('li', h('b', 'Move'), 'Drag a planting to other ground. It keeps its date. Hold Alt to leave a copy.'),
        h('li', h('b', 'Trade'), 'Drop a planting on ground that is held and the two trade places, when both fit.'),
        h('li', h('b', 'Share a bed'), 'Drop a crop onto a bed that is held: it asks whether to split the bed or replace what is there, once, and then keeps splitting until you press Done. Or use “Several varieties in this bed…” in a planting’s panel. Push a planting’s end into its neighbour to move the line between them.'),
        h('li', h('b', 'Look closer'), 'Click a garden name to zoom to it. Wheel zooms, drag pans, Space pans from anywhere.'),
        h('li', h('b', 'Colours'), 'Pale while a crop is growing, full colour while it is being picked, hatched while the bed turns over. Click a crop in the bar under the map to show only that crop.'))));
  }

  function renderBed(host, bed) {
    const eng = App.state.engine, date = App.state.date, status = eng.bedStatus(bed, date), g = eng.gardenOf(bed) || {}, unit = eng.capUnit(bed), soil = eng.isSoilBed(bed);
    const all = eng.plantingsIn(bed.id).map(p => ({ p, r: eng.calc(p) })).filter(x => x.r).sort((a, b) => a.r.field - b.r.field);
    const kind = { bed: 'Bed', tower: 'Tower', bench: 'Bench', containers: 'Containers' }[eng.spaceKind(bed)];
    // What the space measures is there to be read at a glance, and this panel never changes it. It is a fact about the farm,
    // so it has one home: the layout, edited on the map (mapedit.js). The link under the figures goes there with this space picked.
    const fig = (label, value, id) => { const el = stat(label, value); if (id) el.id = id; return el; };
    // the unit rides in the label, so a figure never wraps in a narrow panel
    const dims = soil ? [fig('Width (ft)', num(bed.w, 2), 'bedWidth'), fig('Length (ft)', num(bed.l, 2), 'bedLength'), fig('Area (sq ft)', num(bed.w * bed.l), 'bedArea')]
      : [fig({ tower: 'Sites', bench: 'Tray spaces', containers: 'Containers' }[eng.spaceKind(bed)] || 'Holds', num(status.cap), 'bedHolds')];
    host.append(h('header.insp-head',
      h('p.eyebrow', `${g.name || 'Garden'} · ${eng.lib.gardenTypeLabels[g.type] || g.type || ''}`),
      h('h2', `${kind} ${bed.bed}`),
      h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select(null) }, '×')),
      h('div.stats.dims', { id: 'bedDims', 'aria-label': 'Size of this space' }, dims),
      h('div.stats', stat(`On ${day(date)}`, status.crops.length ? `${num(status.used, 1)} of ${num(status.cap, 1)} ${unit} planted` : status.resting ? 'Turning over' : 'Free'),
        stat('This season', `${all.length} planting${all.length === 1 ? '' : 's'}`)));
    if (root.LRFMapEdit && (soil || !eng.isPool(bed))) host.append(h('p.insp-aside', h('button.link', { type: 'button', id: 'bedLayoutEdit',
      title: soil ? 'Sizes are changed in Edit layout: move, turn or resize this bed on the map itself' : 'Move or set out this space on the map itself', onclick: () => root.LRFMapEdit.open({ bedId: bed.id }) }, 'Edit the layout…')));
    // whom this ground is grown for is a fact about the farm too: shown here, set in the layout (for a bed, or a whole garden)
    if (root.LRFMapEdit && (soil || !eng.isPool(bed))) {
      const use = root.LRFForecast.useOfBed(eng, bed);
      host.append(h('p.insp-aside.bed-use', { id: 'bedUse', dataset: { use: use.use, by: use.by } }, 'Grown for ', h('b', use.personal ? 'personal use' : 'sale (commercial)'), use.by === 'garden' ? `, as all of ${g.name || 'its garden'} is` : '', '. ',
        h('button.link', { type: 'button', id: 'bedUseEdit', title: 'Personal use or commercial is set in Edit layout, for a bed or a whole garden. A planting can say otherwise in its own panel.', onclick: () => root.LRFMapEdit.open({ bedId: bed.id, field: 'leUse' }) }, 'Change…')));
    }
    const list = h('ul.p-list');
    for (const { p, r } of all) list.append(plantingRow(p, r));
    host.append(h('section.insp-section', h('h3', 'Plantings'), all.length ? list : h('p.note', 'Nothing planned here yet. Drag a crop onto this bed.'),
      eng.isRack(bed) ? null : h('button.linkish', { type: 'button', id: 'bedSeries', title: 'One crop every so many days, starting in this space', onclick: () => App.openAhead({ mode: 'series', bedId: bed.id }) }, `Plan a series in this ${{ tower: 'tower', containers: 'space' }[eng.spaceKind(bed)] || 'bed'}…`)));
    // room before, after and between what is planned here, and what would go in it
    const Ahead = root.LRFSuccession;
    if (soil && Ahead && all.length) {
      const open = Ahead.openings(eng, { bedId: bed.id });
      if (open.length) host.append(h('section.insp-section', { id: 'bedOpenings' }, h('h3', 'Openings'),
        open.map(o => { const n = Ahead.fits(eng, o).length, next = o.before ? `before the ${o.before.r.c.name.toLowerCase()}` : o.after ? `after the ${o.after.r.c.name.toLowerCase()}` : 'open';
          return h('button.p-open', { type: 'button', title: 'See what fits', dataset: { opening: o.id }, onclick: () => App.select({ type: 'opening', id: o.id, bedId: bed.id }) },
            h('b', span(o.from, o.to)), h('span', `${num(o.days)} days ${next}${o.whole ? '' : ` · ${num(o.length, 1)} ft`}`), h('small', n ? `${num(n)} crop${n === 1 ? '' : 's'} fit` : '')); })));
    }
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
          if (done) toast(`${App.cropLabel(p)}: sowing taken back${done.returned ? ` · ${qty(done.returned, done.stockUnit)} returned to stock` : ''}${done.lost ? ` · ${qty(done.lost, done.stockUnit)} could not go back: that lot is gone` : ''}${done.restored ? ' · back on the day first planned' : ''}`, { label: 'Undo', run: App.undo });
        } }, 'Take it back'));
    }
    if (s.sown) return add(box, h('p.sow-done', h('span', 'Later work is already recorded for this planting, so its seed is no longer counted as still to sow.')));
    const lots = SL.lotsToUse(App.inventoryNow(), s.key, s.stockUnit), onHand = lots.reduce((n, l) => n + Number(l.quantity), 0), today = App.today();
    const date = h('input', { type: 'date', value: today, max: today, 'aria-label': `${act} on`, dataset: { sow: 'date' } });
    const used = h('input', { type: 'number', min: 0, step: s.stockUnit === 'g' ? 'any' : 1, value: s.estimate, 'aria-label': `${word} used`, dataset: { sow: 'quantity' }, oninput: () => says() });
    const note = h('p.help', { dataset: { sow: 'note' } });
    function says() {
      const n = Math.max(0, +used.value || 0);
      note.textContent = `Planned for ${day(s.planned)}. ` + (!onHand ? `No ${s.unit === 'g' ? 'seed' : word} on hand ${s.variety ? 'for ' + name : 'with no variety chosen'}, so nothing comes off stock.`
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
          toast(`${App.cropLabel(p)} ${act.toLowerCase()} ${dayY(E.s2d(date.value))} · ${off ? `${qty(off, done.stockUnit)} off stock` : 'nothing off stock'}${done.untracked ? ` · ${qty(done.untracked, done.stockUnit)} not from a counted lot` : ''}${done.moved ? ` · ${num(done.moved.days)} day${done.moved.days === 1 ? '' : 's'} late, so it goes out as much later` : ''}${done.overlaps ? ` · it now overlaps ${done.overlaps === 1 ? 'another planting' : done.overlaps + ' plantings'}: see To settle` : ''}`, { label: 'Undo', run: App.undo });
        } }, 'Record')),
      note);
  }

  // ── the jobs of one planting, each ticked on the day it was done ──
  let jobOpen = null;   // the job whose day is being typed: { id, kind }
  const JOB_WORDS = { potup: ['Pot up', 'Potted up'], harden: ['Harden off', 'Hardened off'], move: ['Move out', 'Moved out'] };
  /**
   * The schedule's first lines: sow, pot up, harden off, plant out, move out. A job done shows the day it was done and how
   * that sat against the plan. The job that uses the seed is recorded in the box below, with what was used; the others here.
   */
  function jobItems(p, r, c, sow) {
    const Week = root.LRFWeek, eng = App.state.engine, today = App.today(), seedDirect = sow && sow.kind === 'field' && (sow.unit === 'seeds' || sow.unit === 'g');
    const words = st => st.kind === 'sow' ? ['Sow in nursery', 'Sown in nursery'] : st.kind === 'field' ? (c.method === 'TP' ? ['Transplant', 'Transplanted'] : seedDirect ? ['Direct sow', 'Direct sown'] : ['Plant', 'Planted']) : JOB_WORDS[st.kind];
    return Week.steps(eng, p).map(st => {
      const w = words(st), open = jobOpen && jobOpen.id === p.id && jobOpen.kind === st.kind && !st.done;
      const late = st.done ? (st.late > 0 ? `${num(st.late)} d late` : st.late < 0 ? `${num(-st.late)} d early` : '') : '', pushed = !st.done && st.kind !== 'sow' && st.kind !== 'potup' && (Week.pushed(p, 'sow') || Week.pushed(p, 'harden'));
      const save = input => {
        const done = App.recordWork([{ id: p.id, kind: st.kind }], { date: input.value });
        if (!done) return;
        jobOpen = null;
        toast(`${App.cropLabel(p)}: ${w[1].toLowerCase()} ${dayY(E.s2d(input.value))}${done.moved.length ? ` · it goes out ${num(done.moved[0].days)} day${done.moved[0].days === 1 ? '' : 's'} later` : ''}${done.overlaps ? ` · it now overlaps ${done.overlaps === 1 ? 'another planting' : done.overlaps + ' plantings'}: see To settle` : ''}${done.planOfRecord ? ' · the plan as it stood is kept under Snapshots as the plan of record' : ''}`, { label: 'Undo', run: App.undo });
      };
      const date = open ? h('input', { type: 'date', value: today, max: today, 'aria-label': `${w[1]} on`, dataset: { job: 'date' }, onkeydown: e => { if (e.key === 'Enter') save(e.target); else if (e.key === 'Escape') { e.stopPropagation(); jobOpen = null; render(); } } }) : null;
      return h('li' + (st.done ? '.done' : st.passed ? '.passed' : ''), { dataset: { job: st.kind, state: st.done ? 'done' : st.passed ? 'passed' : 'open' } },
        h('span', st.done ? w[1] : w[0],
          st.kind === 'sow' && r.sowSet && !st.done ? h('button.link.sow-own', { type: 'button', title: `You set this day. The plan works out ${day(r.sowDefault)}. Click to use the plan’s day.`, onclick: () => App.planSowings([p.id], null) }, 'your day') : null,
          late ? h('small.job-late', late) : null,
          pushed ? h('small.job-late', { title: 'Its seedlings were sown or hardened off late, so the day moved with them. Change the date above to set another.' }, `${num(pushed.days)} d later`) : null,
          st.passed ? h('small.job-late', 'no day recorded') : null,
          // the job that uses the seed, the bulbs or the plants is recorded below, with what was used
          !st.done && !st.passed && !st.seed && !open ? h('button.link.job-tick', { type: 'button', dataset: { job: 'tick' }, onclick: () => { jobOpen = { id: p.id, kind: st.kind }; render(); } }, 'record') : null,
          st.done && !st.seed ? h('button.link.job-tick', { type: 'button', dataset: { job: 'back' }, onclick: () => { const done = App.takeBackWork([{ id: p.id, kind: st.kind }]); if (done) toast(`${App.cropLabel(p)}: ${w[0].toLowerCase()} taken back${done.restored ? ' · back on the day first planned' : ''}`, { label: 'Undo', run: App.undo }); } }, 'take back') : null),
        open ? h('span.job-record', date, h('button.btn.small', { type: 'button', dataset: { job: 'save' }, onclick: () => save(date) }, 'Record'), h('button.icon-btn.job-x', { type: 'button', 'aria-label': 'Leave it', title: 'Leave it', onclick: () => { jobOpen = null; render(); } }, '×'))
          : h('b', day(st.done ? E.s2d(st.done) : st.planned)));
    });
  }

  /**
   * How a transplanted planting is sown: whole rows of its tray, alone or as its share of a batch sown with others.
   * Set out to be read at a glance: what it is sown in, the batch's figures, this planting's share, then the allowances.
   */
  function sowingNote(r) {
    const w = r && r.sowing, Sow = root.LRFSowing;
    if (!w || !Sow || w.error) return null;
    const batch = w.batch || w, members = (w.memberIds || []).length, g = batch.trayGroup, pots = batch.medium === 'pots', wool = batch.medium === 'rockwool';
    const fig = (label, value) => h('div.sow-fig', h('span', label), h('b', value));
    const figs = [fig('Seeds', num(batch.seeds))];
    if (pots) figs.push(fig('Pots', num(batch.cells)));
    else {
      figs.push(Number.isInteger(batch.rowsSown) && (g || batch.mode === 'row') ? fig(`Rows of ${num(batch.tray.columns)}`, num(batch.rowsSown)) : fig('Cells', num(batch.cells)));
      // where trays are shared, the batch's own count is a fraction of the lot's: show the trays the lot stands in
      figs.push(fig(`${wool ? 'Sheets' : 'Trays'}${g ? ' (shared)' : ''}`, num(g ? g.trays : batch.trays)));
    }
    const others = g ? g.parts.length - 1 : 0;
    const rounding = batch.mode === 'row' ? 'whole rows' : batch.mode === 'half' ? 'half trays' : batch.mode === 'tray' ? 'whole trays' : '';
    return h('div.sow-how', { id: 'sowHow' },
      h('p.sow-head', h('b', pots ? 'Sown in pots' : batch.tray.name), w.shared ? h('span.sow-tag', `one batch · ${num(members)} plantings of this variety`) : null),
      h('div.sow-figs', figs),
      w.shared ? h('p.sow-share', h('span', 'This planting’s share'), h('b', `${num(w.cells)} ${pots ? 'pots' : 'cells'}`), h('b', `${num(w.seeds)} seeds`)) : null,
      g ? h('p.sow-with', wool ? `The ${g.trays === 1 ? 'sheet is' : 'sheets are'} shared with ${num(others)} other tower sowing${others === 1 ? '' : 's'} made that day.`
        : `The ${g.trays === 1 ? 'tray is' : 'trays are'} shared with ${num(others)} other ${others === 1 ? 'variety' : 'varieties'} of this crop sown that day.`) : null,
      rounding ? h('p.sow-foot', `${num(batch.buffer)}% extra · ${num(batch.germination * 100)}% germination · rounded up to ${rounding}`) : null);
  }

  /**
   * A batch of live trays. Its trays, days and dates belong to the weekly demand it was made from, so it is shown, not edited:
   * what can be said here is what was sown (the variety, and the day it happened).
   */
  function renderTrayBatch(host, p, r) {
    const eng = App.state.engine, T = root.LRFTrays, c = r.c, color = eng.cropColor(c), name = T.short(c.name);
    const plan = p.liveTray ? (App.state.plan.liveTrayPlans || []).find(x => x.id === p.liveTray.planId) : null, row = plan ? plan.rows.find(x => x.id === p.liveTray.rowId) : null;
    const v = eng.variety(p.varietyId), price = eng.priceOf(p, c, v), sown = !!(p.done && p.done.sow);
    const mates = plan && row ? App.state.plan.plantings.filter(q => q.liveTray && q.liveTray.planId === plan.id && q.liveTray.rowId === row.id).length : 1;
    const varieties = eng.varietiesOf(p.cropId), variety = h('select', { id: 'fVariety', onchange: async e => {
      const id = e.target.value || null, label = id ? eng.variety(id).name : 'No variety';
      if (plan && row) { const done = await App.saveTrays(`${label} for ${name}`, { ...plan, rows: plan.rows.map(x => x.id === row.id ? { ...x, varietyId: id } : x) }); if (done && !done.unchanged) toast(`${label} for every ${name} batch not yet sown`, { label: 'Undo', run: App.undo }); else render(); }
      else if (!App.updatePlanting(p.id, { varietyId: id, variety: null }, 'Change variety')) render();
    } }, h('option', { value: '' }, 'No variety chosen'));
    if (v && !varieties.includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    for (const x of varieties) variety.append(h('option', { value: x.id, selected: x.id === p.varietyId }, x.name));
    const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(+n) ? 0 : 2 });
    add(host,
      h('header.insp-head.planting', { style: { '--crop': color } },
        root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color, label: name, size: 64, cls: 'head' }),
        h('p.eyebrow', 'Live tray batch'), h('h2', name),
        h('button.link', { type: 'button', onclick: () => root.LRFTraysView.open('live') }, plan ? plan.name : 'Live trays'),
        h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select(null) }, '×')),
      h('section.insp-section',
        h('div.stats', stat('Trays', num(r.len)), stat('Days', num(c.dtm)), stat('Expected', money(r.len * price))),
        h('ol.schedule',
          h('li' + (sown ? '.done' : ''), h('span', sown ? 'Sown' : 'Sow'), h('b', UI.dayLong(r.field).replace(/, \d{4}$/, ''))),
          h('li', h('span', 'Ready'), h('b', UI.dayLong(r.first).replace(/, \d{4}$/, '')))),
        h('p.help', plan ? `From the weekly demand in ${plan.name}${sown ? '. It is sown, so it stays as recorded whatever the demand becomes.' : ': trays, days and dates are set there, and this batch follows them.'}` : 'This batch is not tied to a demand plan.'),
        h('button.btn', { type: 'button', id: 'fToLive', onclick: () => root.LRFTraysView.open('live') }, 'Open Live trays, in Nursery')),
      varieties.length || v ? h('section.insp-section.form', field('Variety sown', variety, plan && row && mates > 1 ? `Applies to all ${num(mates)} ${name} batches not yet sown, so their seed comes off that variety’s stock.` : null)) : null,
      App.sowingOf(p) ? h('section.insp-section', h('h3', 'Sowing'), sowingBox(p)) : null,
      plan ? null : h('div.insp-actions', h('button.btn.danger', { type: 'button', onclick: () => App.removePlantings([p.id]) }, 'Remove batch')));
  }
  /** What a planting is expected to give, and whose figure that rests on: its own, or the list's. */
  function yieldLine(eng, p, r) {
    const y = eng.yieldOf(p, r);
    if (!y || r.rack) return null;
    const F = root.LRFForecast, personal = F.useOf(eng, p).personal, unit = y.unit === 'each' ? '' : ' ' + y.unit, basis = { plant: 'a plant', ft: 'a bed-foot', container: 'a container', tray: 'a tray' }[y.basis] || 'each';
    const whose = y.own ? `its own yield, ${num(y.per, 2)}${unit} from ${basis}: “See what differs…” on the Assumptions list lets it follow the list` : y.by === 'default' ? (y.set ? 'the crop’s own yield, not yet set on the Assumptions list' : 'no yield is set for this crop') : `your list’s yield for ${y.by === 'variety' ? 'the variety' : 'the crop'}`;
    const how = y.pattern === 'weekly' ? `${num(y.perWeek, 2)}${unit} a week from ${basis}` : y.pattern === 'once' ? 'all at once' : '';
    return h('p.help', { id: 'fYieldLine' }, `Expected: ${F.amount(y.units, y.unit, 'produce')}${personal ? ', for personal use: not counted as revenue' : y.price > 0 ? ` at $${num(y.price, 2)}, ${'$' + Math.round(y.units * y.price).toLocaleString('en-US')}` : ''}. From ${whose}${how ? ` (${how})` : ''}.${r.c.harvestBy === 'list' ? ' Harvest days are your list’s.' : ''}`);
  }

  // ── several varieties in one bed (stage c of the bed panel build) ──
  // Under Variety, "Several varieties…" opens the crop's varieties to tick. Each one ticked becomes a planting of its own
  // beside this one, same date and same choices, and the bed is shared in equal parts. What that comes to is said first.
  let several = null;   // { id: the planting, picked: Set of variety ids, by: 'length' | 'rows' }
  function severalBox(eng, p, r, varieties) {
    const mates = Rails.mates(eng, p), inBed = new Set(mates.filter(x => x.p.cropId === p.cropId).map(x => x.p.varietyId || '')), by = several.by;
    const redraw = () => render();
    const row = v => {
      const here = v.id === p.varietyId, there = !here && inBed.has(v.id), tick = h('input', { type: 'checkbox', checked: here || there || several.picked.has(v.id), disabled: here || there, dataset: { variety: v.id },
        onchange: e => { if (e.target.checked) several.picked.add(v.id); else several.picked.delete(v.id); redraw(); } });
      return h('label', tick, root.LRFThumbs.el({ varietyId: v.id, cropId: p.cropId, color: eng.cropColor(r.c), label: v.name, size: 26, cls: 'key' }), h('span', v.name, here ? h('small', ' · this planting') : there ? h('small', ' · in the bed') : null));
    };
    const picked = [...several.picked].filter(id => varieties.some(v => v.id === id)), plan = picked.length ? App.planVarieties(p.id, picked, by) : null;
    const says = !picked.length ? 'Tick the varieties to grow beside this one. Nothing changes until you press Divide the bed.'
      : plan.no ? plan.no
        : `${App.bedLabel(plan.bed)}: ${num(plan.n)} plantings, ${by === 'rows' ? `${num(plan.rows.count)} of ${num(plan.rows.total)} rows each` : `${num(plan.len, 1)} ft each of ${num(r.cap, 1)}`}. ${r.c.vname || r.c.name} goes from ${num(plan.plants[0])} plants to ${num(plan.plants[1])}. The same date for all.`;
    const seg = (value, text) => h('button', { type: 'button', 'aria-pressed': String(by === value), dataset: { by: value }, onclick: () => { several.by = value; redraw(); } }, text);
    return h('div.mix-pick', { id: 'mixPick' },
      h('b', 'Several varieties in this bed'),
      h('div.mix-pick-list', { id: 'mixPickList' }, varieties.map(row)),
      r.rows >= 2 && r.rows <= 12 ? h('div.seg', { id: 'mixBy', role: 'group', 'aria-label': 'How the bed is shared' }, seg('length', 'Along the bed'), seg('rows', 'By rows')) : null,
      h('p.mix-pick-says' + (plan && plan.no ? '.bad' : ''), { id: 'mixSays' }, says),
      h('div.mix-pick-acts', h('button.btn.primary', { type: 'button', id: 'mixDivide', disabled: !plan || !!plan.no, onclick: () => { const added = App.addVarieties(p.id, picked, by); if (added) several = null; render(); } }, 'Divide the bed'),
        h('button.link', { type: 'button', id: 'mixCancel', onclick: () => { several = null; render(); } }, 'Cancel')));
  }
  /** Who a planting shares its bed with, and a way back to equal shares. */
  function matesBox(eng, p) {
    const mates = Rails.mates(eng, p);
    if (mates.length < 2) return null;
    const size = x => x.rect && x.rect.rows && x.rect.rows.count < x.rect.rows.total ? `${num(x.rect.rows.count)} of ${num(x.rect.rows.total)} rows` : `${num(x.r.physicalLength, 1)} ft`;
    // Standing together is not always sharing: where their ground crosses, the bed is booked twice (it waits under To settle).
    // That is said as what it is, and equal shares are offered as one more way to settle it, not as a tidy-up.
    const twice = eng.conflicts(p, eng.calc(p)).some(o => !o.rest);
    if (twice) return h('div.field', { id: 'fMatesField', dataset: { twice: '1' } }, h('span', `Booked into the same ground in ${App.bedLabel(eng.bedOf(p.bedId))}`),
      h('ul.mix-mates', { id: 'fMates' }, mates.map(x => h('li', { dataset: { mate: x.p.id } }, x.p.id === p.id ? h('b', `${App.cropLabel(x.p)} (this one)`) : h('button.link', { type: 'button', onclick: () => App.select({ type: 'planting', id: x.p.id }) }, App.cropLabel(x.p)), h('span', size(x))))),
      h('small', 'They are in the ground on the same days. ', h('button.linkish', { type: 'button', id: 'fEqual', title: 'Each takes an equal share of the bed, so the ground is no longer booked twice. Plant counts follow the feet; no date changes. The fixes by date are under To settle.', onclick: () => App.equalShares(p.id) }, 'Share the bed between them'), ', or settle it by date under To settle.'));
    return h('div.field', { id: 'fMatesField' }, h('span', `Shares ${App.bedLabel(eng.bedOf(p.bedId))} with`),
      h('ul.mix-mates', { id: 'fMates' }, mates.map(x => h('li', { dataset: { mate: x.p.id } }, x.p.id === p.id ? h('b', `${App.cropLabel(x.p)} (this one)`) : h('button.link', { type: 'button', onclick: () => App.select({ type: 'planting', id: x.p.id }) }, App.cropLabel(x.p)), h('span', size(x))))),
      h('small', h('button.linkish', { type: 'button', id: 'fEqual', onclick: () => App.equalShares(p.id) }, 'Make them equal'), ' · on the map, push an end into its neighbour to move the line between them.'));
  }

  function renderPlanting(host, p) {
    const eng = App.state.engine, r = eng.calc(p);
    if (!r) { host.append(h('p.note', 'This planting cannot be calculated. Its saved data is kept.'), h('button.btn.danger', { type: 'button', onclick: () => App.removePlantings([p.id]) }, 'Remove planting')); return; }
    if (eng.isPool(r.b)) { renderTrayBatch(host, p, r); return; }
    const bed = r.b, c = r.c, color = eng.cropColor(c), unit = eng.capUnit(bed), through = eng.occupancyThrough(p, r), f = eng.footprint(p, r);
    const timing = c.catalogTiming || {}, v = eng.variety(p.varietyId), sow = App.sowingOf(p);
    const set = (change, label) => { if (!App.updatePlanting(p.id, change, label)) render(); };

    // Variety
    const varieties = eng.varietiesOf(p.cropId), variety = h('select', { id: 'fVariety', onchange: e => set({ varietyId: e.target.value || null, variety: null }, 'Change variety') }, h('option', { value: '' }, 'No variety chosen'));
    if (v && !varieties.includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    for (const x of varieties) variety.append(h('option', { value: x.id, selected: x.id === p.varietyId }, x.name));
    if (several && several.id !== p.id) several = null;
    const canMix = eng.isSoilBed(bed) && varieties.length >= 2;
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
    const dtmSource = timing.activeMode === 'catalog' ? `From the supplier's ${timing.printed}-day figure${timing.conversion === 'seed-minus-nursery' ? `, less ${timing.nurseryDays} nursery days` : timing.conversion === 'direct-less' ? `, which is for seed sown in place: ${timing.off} days less as a transplant` : ''}.${timing.basisBy === 'guess' ? ' Where those days start is a guess from the wording of the supplier’s page: set it on the Assumptions list.' : ''}`
      : p.dtm > 0 ? 'Pinned: this planting keeps its own days. Clear the field and it follows the assumptions list.' : v && v.dtm > 0 ? 'Your figure for this variety.' : 'Crop default. Set your own on the Assumptions list.';
    // Whom it is grown for: a flag, which follows the bed (and the bed its garden) until it is set here.
    const F = root.LRFForecast, use = F.useOf(eng, p), bedUse = F.useOfBed(eng, bed);
    const useBtn = (value, text) => h('button', { type: 'button', 'aria-pressed': String(use.use === value), dataset: { use: value }, onclick: () => { if (use.use !== value) App.setUse('planting', [p.id], value); } }, text);
    const useHelp = use.by === 'planting' ? `Set on this planting. Its bed is ${bedUse.personal ? 'for personal use' : 'commercial'}.`
      : use.by === 'default' ? 'Personal use is sown, picked and counted like any other planting, and left out of revenue and out of the list you send.'
        : `Follows ${use.by === 'bed' ? 'its bed' : (eng.gardenOf(bed) || {}).name || 'its garden'}, which is ${use.personal ? 'for personal use: left out of revenue and out of the list you send' : 'commercial'}.`;
    const useField = h('div.field', { id: 'fUseField' }, h('span', 'Grown for'), h('div.seg', { id: 'fUse', role: 'group', 'aria-label': 'Grown for', dataset: { use: use.use, by: use.by } }, useBtn('commercial', 'Commercial'), useBtn('personal', 'Personal use')), h('small', useHelp));
    const fromList = c.assumed ? `From your assumptions list: ${c.assumed.level === 'variety' ? (c.vname || 'this variety') : c.name}, ${root.LRFAssume.LABEL[c.assumed.env].toLowerCase()}${c.assumed.off ? `. ${c.assumed.typed} days from ${c.assumed.basis === 'direct' ? 'direct sowing' : 'sowing'}, less ${c.assumed.off}` : ''}.` : null;

    add(host,
      h('header.insp-head.planting', { style: { '--crop': color } },
        root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color, label: c.vname || c.name, size: 64, cls: 'head' }),
        h('p.eyebrow', c.name), h('h2', c.vname || c.name),
        h('button.link', { type: 'button', onclick: () => App.select({ type: 'bed', id: bed.id }) }, App.bedLabel(bed)),
        h('button.icon-btn.close', { type: 'button', 'aria-label': 'Close', onclick: () => App.select({ type: 'bed', id: bed.id }) }, '×')),
      h('section.insp-section.form',
        field(c.method === 'TP' ? 'Transplant date' : sow && sow.kind === 'field' && sow.done ? 'Planned sowing date' : 'Sowing date', h('input', { type: 'date', id: 'fDate', value: p.date, onchange: e => { if (E.validDate(E.s2d(e.target.value))) set({ date: e.target.value }, 'Change date'); else render(); } })),
        field('Variety', variety, canMix && !several ? h('button.linkish', { type: 'button', id: 'fSeveral', title: 'Grow several varieties in this bed: each becomes a planting of its own beside this one, and the bed is shared equally', onclick: () => { several = { id: p.id, picked: new Set(), by: 'length' }; render(); } }, 'Several varieties in this bed…') : null),
        canMix && several ? severalBox(eng, p, r, varieties) : null,
        field('Growing space', space),
        eng.isSoilBed(bed) ? matesBox(eng, p) : null,
        r.tw ? null : field(r.ct ? 'Containers' : r.rack ? 'Trays' : 'Length (ft)',
          h('input', { type: 'number', id: 'fLength', min: 1, max: r.cap, step: r.ct || r.rack ? 1 : 0.5, value: whole ? '' : +(+p[lengthKey]).toFixed(2), placeholder: `Whole ${r.ct ? 'group' : r.rack ? 'bench' : 'bed'} · ${num(r.cap, 1)}`,
            onchange: e => setLength(e.target.value) }), whereText),
        f && totalRows >= 2 && totalRows <= 12 ? field('Rows', rowPicker(p, f, totalRows, set), split ? `Uses ${f.rows.count} of ${f.rows.total} rows. The others are free for another crop.` : 'Uses every row. Release some to grow another crop alongside.') : null,
        h('div.field-pair',
          field('Days to harvest', h('input', { type: 'number', id: 'fDtm', min: 1, max: 730, value: p.dtm > 0 ? p.dtm : '', placeholder: String(c.dtm),
            onchange: e => { const n = Math.round(+e.target.value); set(n > 0 ? { dtm: n, timingMode: 'manual' } : { dtm: null, timingMode: p.timingMode === 'manual' ? null : p.timingMode }, 'Change days to harvest'); } })),
          field('Harvest days', h('input', { type: 'number', id: 'fHw', min: 0, max: 400, value: p.hw != null && p.hw !== '' ? p.hw : '', placeholder: r.harvestMode === 'season' ? 'To season end' : String(c.hw),
            onchange: e => { const raw = e.target.value; set(raw === '' ? { hw: null, harvestMode: null } : { hw: Math.max(0, Math.round(+raw)), harvestMode: 'window' }, 'Change harvest days'); } }))),
        h('p.help', fromList || dtmSource),
        useField,
        yieldLine(eng, p, r)),
      h('section.insp-section',
        h('h3', 'Schedule'),
        h('ol.schedule', { id: 'jobList' },
          jobItems(p, r, c, sow),
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
          r.cells ? stat(r.sowing && r.sowing.medium === 'pots' ? 'Pots to sow' : 'Cells to sow', num(r.cells)) : r.seeds ? stat('Seeds', num(r.seeds)) : null),
        sowingNote(r)),
      h('section.insp-section',
        h('h3', 'Repeat as successions'),
        h('div.repeat',
          h('input', { type: 'number', id: 'fRepeatCount', min: 1, max: 30, value: 3, 'aria-label': 'How many more' }), h('span', 'more, every'),
          h('input', { type: 'number', id: 'fRepeatEvery', min: 1, max: 120, value: Math.max(7, Math.min(28, r.c.hw || 14)), 'aria-label': 'Days apart' }), h('span', 'days'),
          h('button.btn', { type: 'button', onclick: () => App.addSuccessions(p.id, Math.max(1, Math.min(30, Math.round(+$('fRepeatCount').value) || 1)), Math.max(1, Math.round(+$('fRepeatEvery').value) || 14)) }, 'Add')),
        h('p.help', `Each one takes this ${unit === 'sites' ? 'tower' : 'bed'} if it is free by then, otherwise the next free one in ${eng.gardenOf(bed).name}. `,
          canSeries(eng, r.c) ? h('button.linkish', { type: 'button', id: 'fSeriesLink', onclick: () => App.openAhead({ mode: 'series', sourceId: p.id }) }, 'Plan a longer series: see it first, name gardens or beds, or leave them to place') : null)),
      h('div.insp-actions',
        h('button.btn', { type: 'button', id: 'fToWait', title: 'Take it out of this bed and keep it, with its date, under To place. What it shared the bed with takes up its ground.', onclick: () => App.sendToWait(p.id) }, 'Send to To place'),
        h('button.btn.danger', { type: 'button', onclick: () => App.removePlantings([p.id]) }, 'Remove planting')));
  }

  // Removing a focused field can fire its change handler, which asks for another render: finish this one first.
  let rendering = false, renderAgain = false;
  let stale = false;
  const HIDDEN_IN = ['assume', 'seeds', 'trays', 'harvest'];
  function render() {
    if (!App.state.ready) return;
    if (HIDDEN_IN.includes(App.state.view)) { stale = true; return; }   // nothing to see: draw it when its view comes back
    stale = false;
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try {
      const host = $('inspectorBody'), keep = host.scrollTop, sel = App.state.sel, eng = App.state.engine;
      clear(host);
      // an opening that has gone (something was planted in it) gives way to its bed
      const p = sel && sel.type === 'planting' ? eng.planting(sel.id) : null, opening = sel && sel.type === 'opening', bed = sel && sel.type === 'bed' ? eng.bedOf(sel.id) : opening ? eng.bedOf(sel.bedId) : null;
      const Series = root.LRFSeries;
      let overview = false;
      let own = false;   // a planting's or a space's own panel: the ones whose fields change the plan as they are left
      if (p) { renderPlanting(host, p); own = true; } else if (opening && root.LRFAhead && root.LRFAhead.opening(host, sel, render)) { /* drawn */ } else if (bed) { renderBed(host, bed); own = true; }
      else if (sel && sel.type === 'series' && Series && Series.panel(host, render)) { /* the series tool */ }
      else if (sel && sel.type === 'waiting' && Series && Series.waitingPanel(host, sel, render)) { /* a planting with no bed yet */ }
      else { renderOverview(host); overview = true; }
      const headEl = own && host.querySelector('header.insp-head');
      if (headEl) headEl.after(savedLine());
      sayIfGone();
      host.scrollTop = keep;
      if (!overview) holdSettle = false; else if (holdSettle) settleInView(host);
    } finally {
      rendering = false;
      if (renderAgain) { renderAgain = false; render(); }
    }
  }
  // ── To settle, in the header: the count, and one click to the list from any view ──
  // Quiet on purpose: it says how many, in the page's own ink, and nothing else. The list and its fixes stay where they were.
  let settleTimer = 0;
  // After the click, the list is held at the top of the panel until the panel is touched: a box above it can come or go
  // (pictures still being read after a backup is loaded), and the list must not slide out of sight with it.
  let holdSettle = false;
  function settleInView(host) {
    const el = $('toSettle');
    if (!el) { holdSettle = false; return; }
    host.scrollTop += el.getBoundingClientRect().top - host.getBoundingClientRect().top;
  }
  function drawSettle() {
    const badge = $('settleBadge');
    if (!badge || !App.state.ready) return;
    const n = App.isSample() ? 0 : settleCount();
    badge.hidden = !n;
    if (!n) return;
    clear(badge); add(badge, h('b', num(n)), ' to settle');
    badge.title = `${num(n)} ${n === 1 ? 'place' : 'places'} where ground is booked twice, or plantings are longer than their bed. Each has a fix in one click. Click to see ${n === 1 ? 'it' : 'them'}.`;
  }
  /** Worked out a moment after the plan changes, so a run of changes costs one count and typing is never held up by it. */
  function laterSettle() { clearTimeout(settleTimer); settleTimer = setTimeout(drawSettle, 120); }
  function showSettle() {
    if (!['map', 'timeline'].includes(App.state.view)) App.setView('map');
    cleanupOpen = true; holdSettle = true;
    if (App.state.sel) App.select(null); else render();
    requestAnimationFrame(() => { const el = $('toSettle'); if (!el) return; el.scrollIntoView({ block: 'start' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
  }
  function initInspector() {
    const badge = $('settleBadge');
    if (badge) { badge.addEventListener('click', showSettle); App.on('plan', laterSettle); }
    const host = $('inspectorBody');
    for (const kind of ['wheel', 'touchmove', 'keydown']) host.addEventListener(kind, () => { holdSettle = false; }, { passive: true });
    let press = null;
    host.addEventListener('pointerdown', e => {
      holdSettle = false;
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
    App.on('refused', resaid);
    App.on('sel', render);
    App.on('photos', render);
    App.on('view', () => { if (stale) render(); });
    App.on('date', () => {
      const sel = App.state.sel, ground = $('statGround');
      if (sel && sel.type === 'bed') render();
      else if (!sel && ground) { ground.querySelector('span').textContent = `In the ground ${day(App.state.date)}`; ground.querySelector('b').textContent = inGround(); }
    });
  }

  root.LRFPanels = { init() { initLibrary(); initInspector(); }, isMine, sowingBox, settleCount, showSettle, savedLine };
})(window);
