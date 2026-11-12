/* Little River Farm Planner — the assumptions list.
 *
 * One table for the numbers the whole plan rests on: days to first harvest for
 * every crop, and for each variety that differs, in each growing condition the
 * farm has (field, unheated tunnel, heated greenhouse, towers).
 *
 * Each row says where its days start: the day the crop goes into the bed, the day
 * it is sown in the nursery, or the day seed is sown in place. The numbers in the
 * row count from there; the last column shows what that comes to from seed.
 *
 * Grey is what the planner uses when nothing is set. A number typed here is used
 * as typed, by every planting that has not been given its own. Clearing a cell
 * goes back to the grey number.
 *
 * Above the table: how many plantings still keep figures of their own, and the
 * window that lets them follow the list, with what would move shown first.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI;
  const { h, clear, num } = UI;
  const $ = id => document.getElementById(id);
  const LABEL = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers' };
  const START = { transplant: 'Transplanting', seed: 'Sowing', direct: 'Direct sowing' };
  const FROM = { transplant: 'transplanting', seed: 'sowing', direct: 'direct sowing' };
  const FIXED = { sown: ['sowing', 'Sown in place: its days start at sowing.'], planted: ['planting', 'Planted as a bulb or a bought plant: its days start the day it goes in.'], tray: ['sowing', 'Its days start when the tray is sown.'] };
  const ui = { scope: 'mine', query: '', open: new Set(), dirty: true, frame: 0 };
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;

  function cell(kind, id, env, t, name) {
    if (t.source === 'none') return h('td.as-cell.none', { title: `Nothing on the farm is ${LABEL[env].toLowerCase()} yet` }, '—');
    const why = { library: 'Planner default, not yet checked against a guide', guide: t.guide ? `${t.guide.sources.map(x => `${x.name} gives ${x.range[0]} to ${x.range[1]} days from ${x.basis}`).join('. ')}${t.guide.kept ? '' : `. The planner had ${t.guide.was}`}` : '', supplier: `The supplier prints ${t.printed} days${t.basis && t.basis !== 'unspecified' ? ' from ' + (FROM[t.basis] || t.basis) : ''} for this variety`, variety: 'Kept on the variety', crop: 'Same as the crop', 'crop-mine': 'Your number for the crop' }[t.source];
    const swings = t.swing && (t.swing[0] < 0.999 || t.swing[1] > 1.001) && t.source !== 'crop-mine';
    // What the number comes to in the bed, when the row's days start somewhere else.
    const turned = t.off ? ` Counted from ${FROM[t.start]}: ${t.start === 'seed' ? `less ${t.off} nursery days` : `${t.off} days less as a transplant`}, ${t.bed} in the bed.` : '';
    const tip = t.mine ? `Your number${t.off ? '' : ', used as it is'}.${turned} Clear it to go back to ${t.fallback}.` : `${why}: ${t.fallback} days.${turned}${swings ? ` The planner then stretches it by month, from ${Math.round(t.fallback * t.swing[0])} to ${Math.round(t.fallback * t.swing[1])} days. A number you type is used as it is.` : ''}`;
    const where = `${name}, ${LABEL[env].toLowerCase()}`;
    const input = h('input', { type: 'number', min: 1, max: 730, step: 1, value: t.mine || '', placeholder: t.fallback, title: tip, 'aria-label': `${where}: days to harvest`, dataset: { key: `${kind}|${id}|${env}` },
      onchange: async e => {
        const n = Math.round(+e.target.value), days = n > 0 ? Math.min(730, n) : 0;
        if (days === (t.mine || 0)) { e.target.value = t.mine || ''; return; }
        if (!await App.setAssumption(kind, id, env, days, days ? `${where}: ${days} days` : `${where}: back to ${t.fallback} days`)) schedule();
      } });
    return h('td.as-cell' + (t.mine ? '.mine' : t.source === 'supplier' || t.source === 'variety' ? '.own' : t.source === 'guide' ? '.guide' : ''), input);
  }

  /** "28 + 52 = 80": days in the nursery, days in the bed, and what that comes to from seed. */
  function seedCell(t, env) {
    if (!t || t.source === 'none' || t.fixed || t.method !== 'TP') return h('td.as-seed');
    const short = t.mine && t.mine - t.off < 1;
    return h('td.as-seed' + (short ? '.bad' : ''), { title: `${LABEL[env]}: sown ${t.nursery} days before it goes in the bed, ${t.bed} days there, so ${t.total} days from seed to first harvest.${short ? ' The number leaves nothing for the bed: check where its days start.' : ''}` },
      h('span', `${t.nursery} + ${t.bed} = `), h('b', String(t.total)));
  }

  function places() {
    const eng = App.state.engine, plan = App.state.plan, body = clear($('asPlacesBody')), counts = {};
    for (const g of [...plan.gardens].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const spaces = plan.beds.filter(b => b.gardenId === g.id && b.active !== false);
      if (!spaces.length || g.active === false) continue;
      const towers = spaces.every(b => eng.isTower(b)), env = eng.envOf(spaces[0]);
      if (env) counts[env] = (counts[env] || 0) + 1;
      const pick = towers || !env ? h('span.as-fixed', towers ? 'Towers' : 'Living trays')
        : h('select', { 'aria-label': `Growing conditions in ${g.name}`, onchange: async e => { if (!await App.setGardenType(g.id, e.target.value)) schedule(); } },
          [['field', 'Field'], ['tunnel', 'Unheated tunnel'], ['greenhouse', 'Heated greenhouse']].map(([value, text]) => h('option', { value, selected: g.type === value }, text)));
      body.append(h('label.as-place', h('span', h('b', g.name), h('small', `${spaces.length} space${spaces.length === 1 ? '' : 's'}`)), pick));
    }
    $('asPlacesSum').textContent = `Where things grow · ${eng.ENVS.filter(e => counts[e]).map(e => `${LABEL[e]} ${counts[e]}`).join(' · ')}`;
  }

  // ───────────────────────── where days start ─────────────────────────
  const hintWord = hint => FROM[hint.from];
  /** A published starting point is offered when taking it would change how this crop is counted. */
  function hintFor(eng, c, guessed) {
    const hint = eng.startHint(c.id), rule = eng.startRule(c.id);
    return hint && !rule.set && (hint.from !== 'transplant' || guessed) ? hint : null;
  }
  const hintChange = (eng, c, hint) => ({ cropId: c.id, from: hint.from, less: hint.less != null && hint.less !== eng.START_LESS ? hint.less : null });
  function startCell(eng, c) {
    const fixed = eng.startFixed(c), rule = eng.startRule(c.id);
    if (fixed) return h('td.as-start', h('span.as-fixed', { title: FIXED[fixed][1] }, FIXED[fixed][0]));
    const pick = h('select.as-from' + (rule.set ? '.mine' : ''), { 'aria-label': `${c.name}: days start at`, dataset: { start: c.id },
      title: rule.set ? `Your choice: the numbers in this row count from ${FROM[rule.from]}.` : 'Not set: the numbers count from the day the crop goes in the bed, as they always have.',
      onchange: async e => {
        const value = e.target.value;
        if (!await App.setStart(c.id, { from: value === 'unset' ? null : value }, value === 'unset' ? `${c.name}: days start as before` : `${c.name}: days start at ${FROM[value]}`)) schedule();
      } },
      Object.entries(START).map(([value, text]) => h('option', { value, selected: rule.from === value }, text)), rule.set ? h('option', { value: 'unset' }, 'Back to not set') : null);
    const less = rule.from !== 'direct' ? null : h('label.as-less', { title: 'A figure for seed sown in place. As a transplant the crop is in the bed this many days less. Johnny’s gives about 14.' }, '−',
      h('input', { type: 'number', min: 0, max: 120, step: 1, value: rule.lessSet ? rule.less : '', placeholder: String(rule.less), 'aria-label': `${c.name}: days less as a transplant`, dataset: { less: c.id },
        onchange: async e => { const raw = e.target.value.trim(); if (!await App.setStart(c.id, { less: raw === '' ? null : Math.max(0, Math.round(+raw)) }, raw === '' ? `${c.name}: back to ${eng.START_LESS} days less as a transplant` : `${c.name}: ${Math.max(0, Math.round(+raw))} days less as a transplant`)) schedule(); } }), 'd');
    return h('td.as-start', h('div.as-startbox', pick, less));
  }
  function varietyStartCell(eng, c, v) {
    if (eng.startFixed(c)) return h('td.as-start');
    const basis = eng.STARTS.includes(v.catalogMaturityBasis) ? v.catalogMaturityBasis : 'unspecified';
    return h('td.as-start', h('select.as-from' + (basis !== 'unspecified' ? '.own' : ''), { 'aria-label': `${v.name}: days start at`, dataset: { vstart: v.id },
      title: basis === 'unspecified' ? 'Counted as the crop row says.' : `This variety’s own: its numbers count from ${FROM[basis]}, whatever the crop row says.`,
      onchange: async e => {
        const value = e.target.value, after = { ...v, catalogMaturityBasis: value };
        if (v.catalogDtm && !v.catalogSourceChoice) after.catalogSourceChoice = 'url';
        if (!await App.revise(value === 'unspecified' ? `${v.name}: days start as the crop’s do` : `${v.name}: days start at ${FROM[value]}`, [{ kind: 'variety', before: v, after }])) schedule();
      } },
      h('option', { value: 'unspecified', selected: basis === 'unspecified' }, 'As the crop'), Object.entries(START).map(([value, text]) => h('option', { value, selected: basis === value }, text))));
  }

  // ───────────────────────── figures kept on plantings: the summary ─────────────────────────
  function auditNote() {
    const host = $('asAudit');
    if (!host) return;
    const s = App.auditSurvey(), d = s.days, open = d.own + d.waiting + s.nursery.differ;
    const fig = (label, n, title) => h('span', { title }, h('i', label), h('b', num(n)));
    clear(host).append(
      h('div.au-head', h('b', 'Figures kept on plantings'),
        h('button.btn.small', { type: 'button', id: 'asReview', disabled: !open, title: open ? 'See each group, what would move, and choose. Nothing changes until you press Apply.' : 'Nothing to review: every planting follows the list for its days.', onclick: () => openAudit() }, 'Review…')),
      h('p.au-figs', fig('own days', d.own, 'Plantings that carry their own days to harvest and do not follow this list'), fig('own nursery weeks', s.nursery.differ, 'Plantings that carry nursery weeks from the old planner that differ from the crop’s now'),
        d.waiting ? fig('to place', d.waiting, 'Waiting plantings that carry their own days') : null, fig('tray batches', s.trays, 'Tray batches take their days from the tray plan, which is their own list. They are left alone.')),
      h('p.au-line', { id: 'asAuditLine' }, !d.own ? 'Every planting follows this list for its days to harvest.' : `${num(d.own)} of ${num(s.plantings - s.trays)} plantings in beds, towers and crates keep their own days. ${d.agree ? `${num(d.agree)} carry the number the list already gives; ` : ''}${num(d.differ)} carry a different one.`),
      s.guessed.plantings ? h('p.au-line.au-warn', { id: 'asGuessLine' }, `${plural(s.guessed.plantings, 'planting')} count${s.guessed.plantings === 1 ? 's' : ''} from a start guessed from the wording of a supplier’s page: ${s.guessed.crops.map(id => (App.state.engine.crop(id) || {}).name).filter(Boolean).join(', ')}. Setting “Days start at” for the crop settles it.`) : null,
      h('p.au-fine', `Still to come, with yields: harvest days on ${num(s.later.window)}, turnover days on ${num(s.later.turnover)}, yield on ${num(s.later.yield)}, the old planner’s copy of other crop values on ${num(s.later.copy)}. Spacing set on ${num(s.later.spacing)} stays with the planting: beds differ.${d.recorded ? ` ${plural(d.recorded, 'planting')} with recorded work keep their figures.` : ''}`));
  }

  // ───────────────────────── figures kept on plantings: the review window ─────────────────────────
  let audit = null;
  const DO = { take: 'The list takes', follow: 'Use the list’s', keep: 'Keep their own' };
  function effectText(row, view, choice) {
    if (choice === 'keep') return 'stays as it is';
    if (row.kind === 'wait') return 'no bed yet, so no date to move';
    const moves = row.ids.map(id => view.byId.get(id)).filter(Boolean);
    if (!moves.length) return choice === 'take' && row.take ? `no date moves · ${row.take.level === 'crop' ? 'crop' : 'variety'} line, ${LABEL[row.take.env].toLowerCase()}: ${row.take.typed}` : 'no date moves';
    const span = (list, later, sooner) => { const a = Math.min(...list.map(Math.abs)), b = Math.max(...list.map(Math.abs)); return `${a === b ? b : `${a} to ${b}`} day${b === 1 ? '' : 's'} ${list[0] > 0 ? later : sooner}`; };
    const first = moves.map(m => m.first).filter(Boolean), sow = moves.map(m => m.sow).filter(Boolean), last = moves.map(m => m.last).filter(Boolean), out = [];
    if (first.length) out.push(`harvest ${span(first, 'later', 'sooner')}`); else if (last.length) out.push(`harvest ends ${span(last, 'later', 'sooner')}`);
    if (sow.length) out.push(`sown ${span(sow, 'later', 'earlier')}`);
    return out.join(', ');
  }
  function openAudit() {
    if (audit) return;
    const eng = App.state.engine, made = App.auditStudy(), rows = made.rows, choices = Object.fromEntries(rows.map(r => [r.key, r.choice]));
    const body = h('tbody', { id: 'auBody' }), sum = h('div.au-sum', { id: 'auSum' });
    const apply = h('button.btn.primary', { type: 'button', id: 'auApply' }, 'Apply');
    const close = () => { if (!audit) return; audit = null; el.close(); el.remove(); };
    const name = r => { const c = eng.crop(r.cropId), v = eng.variety(r.varietyId); return [h('b', c ? c.name : 'Crop'), v ? h('small', v.name) : null]; };
    const options = r => r.kind === 'days' ? [r.take ? ['take', `${DO.take} ${r.take.typed}${r.take.typed !== r.days ? ` (${r.days} in the bed)` : ''}`] : null, ['follow', r.agrees ? 'Follow the list' : `${DO.follow} ${r.listDays.length > 1 ? r.listDays[0] + '–' + r.listDays[r.listDays.length - 1] : r.listDays[0]}`], ['keep', DO.keep]]
      : r.kind === 'weeks' ? [['follow', `Use the crop’s ${num(r.listWeeks, 1)} wk`], ['keep', DO.keep]] : [['follow', 'Follow the list'], ['keep', DO.keep]];
    const effects = new Map();
    const draw = () => {
      const view = App.auditPreview(rows, choices), step = view.step;
      view.byId = new Map(view.moves.map(m => [m.id, m]));
      for (const r of rows) { const cell = effects.get(r.key); if (!cell) continue; cell.textContent = effectText(r, view, choices[r.key]); cell.classList.toggle('moves', choices[r.key] !== 'keep' && r.ids.some(id => view.byId.has(id))); }
      const n = step.released + step.thaw + step.waiting, eng2 = view.engine;
      const fig = (label, value, bad) => h('span' + (bad ? '.bad' : ''), h('i', label), h('b', num(value)));
      const pairLine = ([a, b]) => { const p = eng2.planting(a), q = eng2.planting(b), bed = p && eng2.bedOf(p.bedId); return h('li', `${bed ? App.bedLabel(bed) : 'A space'}: ${p ? App.cropLabel(p) : '?'} and ${q ? App.cropLabel(q) : '?'}`); };
      UI.add(clear(sum),
        h('b.au-sumhead', { id: 'auHead' }, n ? `${plural(n, 'planting')} will follow the list` : 'Nothing will change'),
        h('p.au-figs', { id: 'auFigs' }, fig('list takes', step.taken), fig('harvest dates moved', view.harvest, view.harvest > 0), fig('sowing dates moved', view.sowing, view.sowing > 0), fig('new double bookings', view.fresh.length, view.fresh.length > 0)),
        h('p.au-line', `${plural(step.kept, 'planting')} keep${step.kept === 1 ? 's' : ''} ${step.kept === 1 ? 'its' : 'their'} own figures.${view.harvest ? ` The largest move is ${Math.abs(view.most)} day${Math.abs(view.most) === 1 ? '' : 's'} ${view.most > 0 ? 'later' : 'sooner'}.` : ''}`),
        view.fresh.length ? h('ul.au-new', { id: 'auNew' }, view.fresh.slice(0, 6).map(pairLine), view.fresh.length > 6 ? h('li', `and ${num(view.fresh.length - 6)} more`) : null) : null,
        h('p.au-fine', `${view.standing ? `The ${plural(view.standing, 'pair')} already booked into the same ground ${view.standing === 1 ? 'is' : 'are'} not counted as new. ` : ''}${made.held ? `${plural(made.held, 'planting')} with recorded work ${made.held === 1 ? 'is' : 'are'} left as ${made.held === 1 ? 'it is' : 'they are'}. ` : ''}The plan as it stands is kept as a snapshot first, and one undo takes this back.`));
      apply.disabled = !step.ops.length;
    };
    const section = (title, kind, note) => {
      const list = rows.filter(r => r.kind === kind);
      if (!list.length) return;
      body.append(h('tr.au-sec', h('td', { colSpan: 7 }, h('b', title), h('small', note))));
      for (const r of list) {
        const effect = h('td.au-effect'); effects.set(r.key, effect);
        const pick = h('select', { 'aria-label': 'What to do', dataset: { row: r.key }, onchange: e => { choices[r.key] = e.target.value; draw(); } }, options(r).filter(Boolean).map(([value, text]) => h('option', { value, selected: choices[r.key] === value }, text)));
        body.append(h('tr.au-row', { dataset: { key: r.key, kind: r.kind } },
          h('td.au-name', name(r)), h('td.au-where', r.kind === 'wait' ? 'To place' : r.env ? LABEL[r.env] : ''), h('td.au-n', num(r.ids.length)),
          h('td.au-n', r.kind === 'weeks' ? `${num(r.weeks, 1)} wk` : String(r.days)),
          h('td.au-n.au-list', r.kind === 'weeks' ? `${num(r.listWeeks, 1)} wk` : r.kind === 'days' ? (r.listDays.length > 1 ? `${r.listDays[0]}–${r.listDays[r.listDays.length - 1]}` : String(r.listDays[0])) : ''), h('td.au-do', pick), effect));
      }
    };
    section('Days to harvest', 'days', 'their own number, against what the list gives');
    section('Nursery weeks', 'weeks', 'kept from the old planner, where the crop now says otherwise');
    section('To place', 'wait', 'waiting plantings that carry their own days');
    const el = h('dialog.dialog.bk.audit', { id: 'auditDlg', oncancel: e => { e.preventDefault(); close(); } },
      h('button.icon-btn.close', { type: 'button', id: 'auClose', 'aria-label': 'Close', title: 'Close. Nothing is changed.', onclick: () => close() }, '×'),
      h('h2', 'Plantings that keep their own figures'),
      h('p.dlg-lead', 'A planting with a number of its own does not follow the list. For each group: the list can take their number, so nothing moves; they can use the list’s, so dates move; or they can stay as they are. Nothing changes until you press Apply.'),
      h('div.au-scroll', h('table.au', h('thead', h('tr', h('th', 'Crop and variety'), h('th', 'Where'), h('th.au-n', 'Plantings'), h('th.au-n', 'Theirs'), h('th.au-n', { title: 'What the list gives these plantings today, in days in the bed' }, 'List'), h('th', 'What to do'), h('th', 'What that does'))), body)),
      sum,
      h('div.dialog-actions',
        h('button.btn.quiet', { type: 'button', id: 'auKeepAll', title: 'Set every group to stay as it is', onclick: () => { for (const r of rows) choices[r.key] = 'keep'; for (const s of el.querySelectorAll('select[data-row]')) s.value = 'keep'; draw(); } }, 'Keep all'),
        h('button.btn.quiet', { type: 'button', id: 'auSuggested', title: 'Back to what the planner suggests: follow the list wherever no date moves', onclick: () => { for (const r of rows) choices[r.key] = r.choice; for (const s of el.querySelectorAll('select[data-row]')) s.value = choices[s.dataset.row]; draw(); } }, 'Suggested'),
        h('span.grow'),
        h('button.btn', { type: 'button', id: 'auCancel', onclick: () => close() }, 'Cancel'), apply));
    apply.addEventListener('click', async () => {
      if (apply.disabled) return;
      apply.disabled = true;
      const done = await App.auditApply(rows, choices);
      if (done) close(); else apply.disabled = false;
    });
    audit = { el, rows, choices, close, draw };
    document.body.append(el); el.showModal(); draw();
  }

  function render() {
    cancelAnimationFrame(ui.frame);
    if (!App.state.ready || App.state.view !== 'assume') { ui.dirty = true; return; }
    ui.dirty = false;
    const eng = App.state.engine, plan = App.state.plan, q = ui.query.trim().toLowerCase(), list = plan.settings.cropTypeList || {};
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset : null, focusKey = focus && (focus.key ? ['key', focus.key] : focus.start ? ['start', focus.start] : focus.less ? ['less', focus.less] : focus.vstart ? ['vstart', focus.vstart] : null);
    const used = new Map(), pins = new Map(), usedV = new Map(), pinsV = new Map(), where = new Map(), whereV = new Map();
    for (const p of plan.plantings) {
      const own = eng.pinned(p) && !p.liveTray;
      bump(used, p.cropId); if (own) bump(pins, p.cropId);
      if (p.varietyId) { bump(usedV, p.varietyId); if (own) bump(pinsV, p.varietyId); }
      const env = eng.envOf(eng.bedOf(p.bedId));
      if (env) { const m = where.get(p.cropId) || new Map(); bump(m, env); where.set(p.cropId, m); if (p.varietyId) { const mv = whereV.get(p.varietyId) || new Map(); bump(mv, env); whereV.set(p.varietyId, mv); } }
    }
    places(); auditNote();
    const body = clear($('asBody')), crops = eng.crops().filter(c => !c.micro);
    const useCell = (n, pinned) => h('td.as-use', n ? String(n) : '', pinned ? h('span', { title: `${pinned} of them carry their own days to harvest and do not follow this row. “Review…” above lets them follow it.` }, ` · ${pinned} own`) : null);
    // The condition a crop is mostly grown in: the one its "from seed" figure is worked out for.
    const mainEnv = (m, row, or) => { const best = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null; return best && row[best].source !== 'none' ? best : or || eng.ENVS.find(e => row[e].source !== 'none') || 'field'; };
    let shown = 0, mineCount = 0, hints = 0;
    const offers = [];
    for (const c of crops) {
      const varieties = eng.varietiesOf(c.id), mine = root.LRFPanels.isMine(c, used, varieties, list);
      if (mine) mineCount++;
      const rowsV = !eng.startFixed(c) ? varieties.map(v => ({ v, t: Object.fromEntries(eng.ENVS.map(env => [env, eng.timingFor(c.id, v.id, env)])) })) : null;
      const guessed = !!rowsV && rowsV.some(x => eng.ENVS.some(env => x.t[env].startBy === 'guess'));
      const hint = hintFor(eng, c, guessed);
      if (hint && mine) { hints++; offers.push({ c, hint }); }
      if (ui.scope === 'mine' && !mine && !q) continue;
      const nameHit = !q || String(c.name).toLowerCase().includes(q), hits = q ? varieties.filter(v => String(v.name).toLowerCase().includes(q)) : varieties;
      if (!nameHit && !hits.length) continue;
      shown++;
      const open = ui.open.has(c.id) || (q && !nameHit), row = Object.fromEntries(eng.ENVS.map(env => [env, eng.timingFor(c.id, null, env)])), main = mainEnv(where.get(c.id), row);
      body.append(h('tr.as-crop' + (open ? '.open' : ''), { dataset: { crop: c.id } },
        h('td', h('div.as-name',
          varieties.length ? h('button.as-more', { type: 'button', 'aria-expanded': String(!!open), 'aria-label': `${open ? 'Hide' : 'Show'} ${varieties.length} varieties of ${c.name}`, title: `${varieties.length} variet${varieties.length === 1 ? 'y' : 'ies'}`, onclick: () => { ui.open.has(c.id) ? ui.open.delete(c.id) : ui.open.add(c.id); render(); } }, open ? '▾' : '▸') : h('span.as-more'),
          root.LRFThumbs.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 24, cls: 'key' }),
          // the name is never cut short: where the offer does not fit beside it, the offer goes on a line of its own
          h('span.as-nc', h('b', c.name),
            hint ? h('button.as-hint', { type: 'button', dataset: { hint: c.id }, title: `${hint.says}. Press to count this crop that way; what moves is shown first.`, onclick: () => App.setStart(c.id, hintChange(eng, c, hint), `${c.name}: days start at ${hintWord(hint)}`) }, `Johnny’s: ${hintWord(hint)}`) : null))),
        startCell(eng, c),
        eng.ENVS.map(env => cell('crops', c.id, env, row[env], c.name)),
        seedCell(row[main], main),
        useCell(used.get(c.id) || 0, pins.get(c.id) || 0)));
      if (!open) continue;
      for (const v of (nameHit ? varieties : hits)) {
        const t = rowsV ? rowsV.find(x => x.v === v).t : Object.fromEntries(eng.ENVS.map(env => [env, eng.timingFor(c.id, v.id, env)])), guess = eng.ENVS.map(env => t[env]).find(x => x.startBy === 'guess');
        body.append(h('tr.as-var', { dataset: { variety: v.id } },
          h('td', h('div.as-name', root.LRFThumbs.el({ varietyId: v.id, color: eng.cropColor(c), label: v.name, size: 22 }), h('span.as-nc', h('span.as-vname', v.name),
            v.catalogDtm ? h('small', `prints ${v.catalogDtm} d`) : null,
            guess ? h('small.as-guess', { title: 'The supplier does not say where these days start. The old planner went by the wording of its page, which can mislead. Set the crop row, or this variety, to settle it.' }, `read as from ${FROM[guess.start]}: a guess`) : null,
            !guess && v.catalogMaturityBasis === 'seed' && eng.startRule(c.id).from === 'direct' ? h('small.as-guess', { title: 'This variety says its days start at sowing in the nursery, so the whole nursery time comes off. If its supplier meant seed sown in place, as the crop row now says, set it to Direct sowing.' }, 'sowing, not the crop’s direct sowing') : null))),
          varietyStartCell(eng, c, v),
          eng.ENVS.map(env => cell('varieties', v.id, env, t[env], v.name)),
          (mine => seedCell(t[mine], mine))(mainEnv(whereV.get(v.id), t, main)),
          useCell(usedV.get(v.id) || 0, pinsV.get(v.id) || 0)));
      }
    }
    if (!shown) body.append(h('tr', h('td.empty', { colSpan: 8 }, q ? `No crop or variety matches “${ui.query}”.` : 'No crops yet.')));
    for (const [scope, count] of [['mine', mineCount], ['all', crops.length]]) { const el = document.querySelector(`[data-as-scope="${scope}"] small`); if (el) el.textContent = count; }
    const a = plan.assumptions, set = a ? Object.values(a.crops || {}).concat(Object.values(a.varieties || {})).reduce((n, r) => n + Object.keys(r).length, 0) : 0, starts = a && a.starts ? Object.keys(a.starts).length : 0;
    $('asCount').textContent = set || starts ? [set ? `${set} number${set === 1 ? '' : 's'} of your own` : '', starts ? `${starts} starting point${starts === 1 ? '' : 's'} set` : ''].filter(Boolean).join(' · ') : 'Nothing set yet: every number is a default';
    // Every published starting point that differs from how the plan counts now, in one press.
    const all = $('asHints');
    if (all) {
      all.hidden = !offers.length;
      clear(all);
      if (offers.length) all.append(h('span', h('b', `${plural(offers.length, 'crop')} of yours ${offers.length === 1 ? 'has' : 'have'} a published starting point the plan does not use yet`), h('small', offers.map(o => o.c.name).join(', '))),
        h('button.btn.small', { type: 'button', id: 'asHintsAll', title: 'Count each of these crops the way Johnny’s says. What moves is shown before anything changes.', onclick: () => App.setStarts(offers.map(o => hintChange(eng, o.c, o.hint)), `${plural(offers.length, 'crop')}: days start where Johnny’s says`, { ask: true }) }, 'Use them all…'));
    }
    if (focusKey) { const el = document.querySelector(`#asBody [data-${focusKey[0]}="${CSS.escape(focusKey[1])}"]`); if (el) { el.focus(); if (el.select && el.tagName === 'INPUT') el.select(); } }
  }
  /** Redraw after the browser has moved the focus on, so tabbing from cell to cell keeps its place. */
  function schedule() { cancelAnimationFrame(ui.frame); ui.frame = requestAnimationFrame(render); }

  function init() {
    $('asSearch').addEventListener('input', e => { ui.query = e.target.value; render(); });
    for (const button of document.querySelectorAll('[data-as-scope]')) {
      button.addEventListener('click', () => { ui.scope = button.dataset.asScope; for (const b of document.querySelectorAll('[data-as-scope]')) b.setAttribute('aria-pressed', String(b === button)); render(); });
    }
    App.on('plan', () => { if (audit) audit.close(); if (App.state.view === 'assume') schedule(); else ui.dirty = true; });
    App.on('view', () => { if (App.state.view === 'assume' && ui.dirty) render(); });
  }

  root.LRFAssume = { init, LABEL, openAudit, audit: () => audit };
})(window);
