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
 *
 * A second table, "Yield and price", holds the other half of the list: what each
 * crop is sold by and for, how it is picked (a total over its harvest days, a
 * weekly figure, or all at once), its yield in each growing condition, how long
 * it keeps, and how long its ground is held afterwards.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI;
  const { h, clear, num } = UI;
  const $ = id => document.getElementById(id);
  const LABEL = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers' };
  const START = { transplant: 'Transplanting', seed: 'Seeding in trays', direct: 'Direct seeding' };
  const FROM = { transplant: 'transplanting', seed: 'seeding in trays', direct: 'direct seeding' };
  const FIXED = { sown: ['sowing', 'Sown in place: its days are counted from sowing.'], planted: ['planting', 'Planted as a bulb or a bought plant: its days start the day it goes in.'], tray: ['sowing', 'Its days start when the tray is sown.'] };
  const ui = { scope: 'mine', query: '', open: new Set(), dirty: true, frame: 0, mode: 'days' };
  const SHORT = { field: 'Field', tunnel: 'Tunnel', heated: 'Heated', tower: 'Towers' };
  const UNITS = ['each', 'bunch', 'lb', 'pint', 'quart', 'clamshell', 'head', 'stem'];
  const PATTERN = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };
  const PATTERN_SAY = { weekly: 'picked gradually', once: 'cleared at once', spread: 'picked on demand' };
  const PATTERN_TIP = { spread: 'The yield is a total, picked evenly over the harvest days: held, and taken as it is wanted.', weekly: 'The yield is what is picked each week. A longer harvest gives more, a shorter one less.', once: 'The yield is a total, and all of it is counted the day the crop is ready.' };
  const BASIS = { plant: 'a plant', ft: 'a bed-foot', tray: 'a tray' };
  /** A yield or a price as it is read: no more decimals than it needs. */
  const fig = n => n == null || !Number.isFinite(+n) ? '' : String(+(+n).toFixed(Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : Math.abs(n) >= 0.1 ? 2 : 3));
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
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
    const pick = h('select.as-from' + (rule.set ? '.mine' : ''), { 'aria-label': `${c.name}: days counted from`, dataset: { start: c.id },
      title: rule.set ? `Your choice: the numbers in this row count from ${FROM[rule.from]}.` : 'Not set: the numbers count from the day the crop goes in the bed, as they always have.',
      onchange: async e => {
        const value = e.target.value;
        if (!await App.setStart(c.id, { from: value === 'unset' ? null : value }, value === 'unset' ? `${c.name}: days start as before` : `${c.name}: days counted from ${FROM[value]}`)) schedule();
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
    return h('td.as-start', h('select.as-from' + (basis !== 'unspecified' ? '.own' : ''), { 'aria-label': `${v.name}: days counted from`, dataset: { vstart: v.id },
      title: basis === 'unspecified' ? 'Counted as the crop row says.' : `This variety’s own: its numbers count from ${FROM[basis]}, whatever the crop row says.`,
      onchange: async e => {
        const value = e.target.value, after = { ...v, catalogMaturityBasis: value };
        if (v.catalogDtm && !v.catalogSourceChoice) after.catalogSourceChoice = 'url';
        if (!await App.revise(value === 'unspecified' ? `${v.name}: days start as the crop’s do` : `${v.name}: days counted from ${FROM[value]}`, [{ kind: 'variety', before: v, after }])) schedule();
      } },
      h('option', { value: 'unspecified', selected: basis === 'unspecified' }, 'As the crop'), Object.entries(START).map(([value, text]) => h('option', { value, selected: basis === value }, text))));
  }

  // ───────────────────────── figures kept on plantings: the summary ─────────────────────────
  function auditNote() {
    const host = $('asAudit');
    if (!host) return;
    const s = App.auditSurvey(), d = s.days, hv = s.harvest, later = hv.yield + hv.window + hv.turnover + hv.copy, open = d.own + d.waiting + s.nursery.differ + later;
    const fig = (label, n, title) => h('span', { title }, h('i', label), h('b', num(n)));
    const say = [d.own ? `${num(d.own)} their own days` : '', hv.yield ? `${num(hv.yield)} their own yield` : '', hv.window ? `${num(hv.window)} their own harvest days` : '', s.nursery.differ ? `${num(s.nursery.differ)} their own nursery weeks` : ''].filter(Boolean);
    clear(host).append(
      h('div.au-head', h('b', 'Plantings that differ from your list'),
        h('span.au-acts',
          open ? h('button.btn.small.primary', { type: 'button', id: 'asTidy', title: 'Moves onto the list every figure that can go there with no date, no yield and no dollar changing. It is worked out and shown first; the plan as it stands is kept as a snapshot, and one undo takes it back.', onclick: e => tidy(e.currentTarget) }, 'Move onto the list what changes nothing…') : null,
          h('button.btn.small', { type: 'button', id: 'asReview', disabled: !open, title: open ? 'The plantings that would change if they followed the list, crop by crop, with what would move. Nothing changes until you press Apply.' : 'Nothing to see: every planting follows the list.', onclick: () => openAudit() }, 'See what differs…'))),
      h('p.au-line.au-lead', { id: 'asDiffLine' }, !open ? 'Every planting follows your list.' : `Some plantings still carry figures from the old planner, so your list does not decide them: ${say.length ? say.join(', ') : 'old copies of crop values'}. Most can go onto the list with nothing changing; the rest would move a date or a yield, and are yours to decide.`),
      h('details.au-more', { id: 'asAuditMore' }, h('summary', 'The count, kind by kind'),
      h('p.au-figs', fig('own days', d.own, 'Plantings that carry their own days to harvest and do not follow this list'), fig('own nursery weeks', s.nursery.differ, 'Plantings that carry nursery weeks from the old planner that differ from the crop’s now'),
        fig('own yield', hv.yield, 'Plantings that carry their own yield'), fig('own harvest days', hv.window, 'Plantings that carry their own harvest days'), fig('own turnover', hv.turnover, 'Plantings that carry their own turnover days'),
        hv.copy ? fig('old copies', hv.copy, 'Plantings that carry the old planner’s copy of crop values that bear on the harvest: yield, price, marketable share, harvest days, unit') : null,
        d.waiting ? fig('to place', d.waiting, 'Waiting plantings that carry their own days') : null, fig('tray batches', s.trays, 'Tray batches take their days from the tray plan, which is their own list. They are left alone.'),
        hv.cycles ? fig('tower cycles', hv.cycles, 'A tower cycle’s single harvest day and no turnover are what make it a cycle. They are left alone.') : null),
      h('p.au-line', { id: 'asAuditLine' }, !d.own ? 'Every planting follows this list for its days to harvest.' : `${num(d.own)} of ${num(s.plantings - s.trays)} plantings in beds, towers and crates keep their own days. ${d.agree ? `${num(d.agree)} carry the number the list already gives; ` : ''}${num(d.differ)} carry a different one.`),
      h('p.au-line', { id: 'asHarvestLine' }, !later ? 'Every planting follows this list for its yield, harvest days and turnover.' : `${num(hv.yield)} keep their own yield, ${num(hv.window)} their own harvest days and ${num(hv.turnover)} their own turnover days${hv.copy ? `; ${num(hv.copy)} carry the old planner’s copy of crop values` : ''}. “Review…” shows what letting each go would change, before anything does.`),
      s.guessed.plantings ? h('p.au-line.au-warn', { id: 'asGuessLine' }, `${plural(s.guessed.plantings, 'planting')} count${s.guessed.plantings === 1 ? 's' : ''} from a start guessed from the wording of a supplier’s page: ${s.guessed.crops.map(id => (App.state.engine.crop(id) || {}).name).filter(Boolean).join(', ')}. Setting “Days counted from” for the crop settles it.`) : null,
      h('p.au-fine', `Spacing set on ${num(s.later.spacing)} stays with the planting: beds differ.${d.recorded + hv.recorded ? ` ${plural(d.recorded + hv.recorded, 'planting')} with recorded work keep${d.recorded + hv.recorded === 1 ? 's' : ''} ${d.recorded + hv.recorded === 1 ? 'its' : 'their'} figures.` : ''}`)));
  }
  /**
   * One press for the part nobody needs to think about: every figure that can go onto the list with nothing changing. What it
   * would do is worked out first and said, and it is done only if he agrees; whatever would move a date, a yield, the season's
   * worth or the ground is left exactly as it is, for the window that shows what differs.
   */
  async function tidy(button) {
    if (button) button.disabled = true;
    try {
      const made = App.auditStudy(), rows = made.rows, choices = Object.fromEntries(rows.map(r => [r.key, r.choice]));
      let view = App.auditPreview(rows, choices);
      const quiet = v => !v.harvest && !v.sowing && !v.yields.length && !v.ground.length && !v.fresh.length && !v.crops.length && Math.abs(v.worth[1] - v.worth[0]) < 0.005;
      if (!quiet(view)) {
        // the suggestion is meant to move nothing; if a group would, it is kept, and the rest is looked at again
        const touched = new Set([...view.moves.map(m => m.id), ...view.yields.map(y => y.id), ...view.ground.map(g => g.id), ...view.fresh.flat()]);
        for (const r of rows) if (choices[r.key] !== 'keep' && r.ids.some(id => touched.has(id))) choices[r.key] = 'keep';
        view = App.auditPreview(rows, choices);
      }
      const step = view.step, differ = rows.filter(r => choices[r.key] === 'keep').length;
      if (!step.ops.length || !quiet(view)) { UI.toast(differ ? 'Nothing can go onto the list without something changing. “See what differs…” shows each case.' : 'Every planting already follows your list.'); return false; }
      const ok = await UI.confirm({ title: `Move ${plural(step.plantings, 'planting')} onto your list?`, confirmLabel: 'Move them',
        body: `Worked out on your plan as it stands: ${plural(step.plantings, 'planting')} stop carrying figures of their own, and ${plural(step.taken, 'line')} of your list take the figures they carried. No harvest date, no sowing date, no yield and no dollar changes (the season stays at ${money(view.worth[0])}), and no ground is booked twice that was not before. ${step.kept ? `${plural(step.kept, 'planting')} that would change stay exactly as they are.` : ''} The plan as it stands is kept as a snapshot first, and one undo takes this back.` });
      if (!ok) return false;
      return !!(await App.auditApply(rows, choices));
    } finally { if (button && button.isConnected) button.disabled = false; }
  }

  // ───────────────────────── figures kept on plantings: the review window ─────────────────────────
  let audit = null;
  // how the window sets its groups out; it is kept while the page is open
  const auView = { by: 'crop', all: false };
  const KINDS = ['days', 'weeks', 'wait', 'yield', 'window', 'turn', 'copy'], KIND = { days: 'Days to harvest', weeks: 'Nursery weeks', wait: 'To place', yield: 'Yield', window: 'Harvest days', turn: 'Turnover days', copy: 'Old copy' };
  const DO = { take: 'The list takes', follow: 'Use the list’s', keep: 'Keep their own' };
  const LATER = ['yield', 'window', 'turn', 'copy'];
  const COPY = { yield: 'yield', price: 'price', mk: 'marketable share', hw: 'harvest days', harvestMode: 'how long it is picked', yieldDays: 'length of season', harvestUntil: 'picked until', baseUnit: 'unit', yBasis: 'counted by' };
  const copyValue = (field, v) => v == null ? 'none' : field === 'mk' ? `${Math.round(v * 100)}%` : field === 'price' ? `$${fig(v)}` : field === 'hw' || field === 'yieldDays' ? `${v} d` : field === 'harvestMode' ? (v === 'season' ? 'to season end' : 'a set number of days') : field === 'yBasis' ? (v === 'ft' ? 'bed-foot' : String(v)) : String(v);
  function effectText(row, view, choice) {
    if (choice === 'keep') return 'stays as it is';
    if (row.kind === 'wait') return 'no bed yet, so no date to move';
    const moves = row.ids.map(id => view.byId.get(id)).filter(Boolean);
    const span = (list, later, sooner) => { const a = Math.min(...list.map(Math.abs)), b = Math.max(...list.map(Math.abs)); return `${a === b ? b : `${a} to ${b}`} day${b === 1 ? '' : 's'} ${list[0] > 0 ? later : sooner}`; };
    if (LATER.includes(row.kind)) {
      const out = [], first = moves.map(m => m.first).filter(Boolean), last = moves.map(m => m.last).filter(Boolean);
      if (first.length) out.push(`harvest ${span(first, 'later', 'sooner')}`); else if (last.length) out.push(`harvest ends ${span(last, 'later', 'sooner')}`);
      const ys = row.ids.map(id => view.yById.get(id)).filter(Boolean);
      if (ys.length) {
        const a = ys.reduce((n, y) => n + y.units[0], 0), b = ys.reduce((n, y) => n + y.units[1], 0), wa = ys.reduce((n, y) => n + y.units[0] * y.price[0], 0), wb = ys.reduce((n, y) => n + y.units[1] * y.price[1], 0), unit = ys[0].unit[1];
        if (Math.abs(a - b) > 1e-6) out.push(`yield ${num(a)} → ${num(b)}${unit && unit !== 'each' ? ' ' + unit : ''}`);
        if (Math.abs(wa - wb) >= 0.5) out.push(`worth ${money(wa)} → ${money(wb)}`);
      }
      const ground = row.ids.map(id => view.gById.get(id)).filter(Boolean).map(g => g.days);
      if (ground.length && !moves.length) out.push(`ground held ${span(ground, 'longer', 'less')}`);
      if (out.length) return out.join(', ');
      return choice === 'take' && row.take ? `nothing changes · ${row.take.level === 'crop' ? 'crop' : 'variety'} line${row.take.env ? ', ' + LABEL[row.take.env].toLowerCase() : ''}: ${fig(row.take.typed)}` : 'nothing changes';
    }
    if (!moves.length) return choice === 'take' && row.take ? `no date moves · ${row.take.level === 'crop' ? 'crop' : 'variety'} line, ${LABEL[row.take.env].toLowerCase()}: ${row.take.typed}` : 'no date moves';
    const first = moves.map(m => m.first).filter(Boolean), sow = moves.map(m => m.sow).filter(Boolean), last = moves.map(m => m.last).filter(Boolean), out = [];
    if (first.length) out.push(`harvest ${span(first, 'later', 'sooner')}`); else if (last.length) out.push(`harvest ends ${span(last, 'later', 'sooner')}`);
    if (sow.length) out.push(`sown ${span(sow, 'later', 'earlier')}`);
    return out.join(', ');
  }
  function openAudit() {
    if (audit) return;
    const eng = App.state.engine, made = App.auditStudy(), rows = made.rows, choices = Object.fromEntries(rows.map(r => [r.key, r.choice]));
    const body = h('tbody', { id: 'auBody' }), sum = h('div.au-sum', { id: 'auSum' }), view = auView;
    const apply = h('button.btn.primary', { type: 'button', id: 'auApply' }, 'Apply');
    const close = () => { if (!audit) return; audit = null; el.close(); el.remove(); };
    const name = r => { if (r.same) return [h('b', 'Copies that say what the crop says now')]; const c = eng.crop(r.cropId), v = eng.variety(r.varietyId); return [h('b', c ? c.name : 'Crop'), r.kind === 'copy' ? h('small', COPY[r.field] || r.field) : v ? h('small', v.name) : r.varieties && r.varieties.length > 1 ? h('small', `${r.varieties.length} varieties`) : null]; };
    const unitWord = r => r.unit && r.unit !== 'each' ? ' ' + r.unit : '', weeklyOf = r => { const x = eng.harvestFor(r.cropId); return !!(x && x.weekly); };
    const windowWord = x => x === 'season' ? 'to season end' : x === 'window' ? 'a set window' : `${x} d`, range = (list, f) => !list.length ? '' : list.length > 1 ? `${f(list[0])}–${f(list[list.length - 1])}` : f(list[0]);
    const theirs = r => r.kind === 'weeks' ? `${num(r.weeks, 1)} wk` : r.kind === 'yield' ? `${fig(+r.value)}${unitWord(r)}` : r.kind === 'window' ? windowWord(r.value) : r.kind === 'turn' ? `${r.value} d` : r.kind === 'copy' ? (r.same ? '' : copyValue(r.field, r.value)) : String(r.days);
    const lists = r => r.kind === 'weeks' ? `${num(r.listWeeks, 1)} wk` : r.kind === 'days' ? (r.listDays.length > 1 ? `${r.listDays[0]}–${r.listDays[r.listDays.length - 1]}` : String(r.listDays[0])) : r.kind === 'yield' ? range(r.list.slice().sort((a, b) => a - b), fig) : r.kind === 'window' ? r.list.map(windowWord).join(', ') : r.kind === 'turn' ? range(r.list.slice().sort((a, b) => a - b), x => `${x} d`) : r.kind === 'copy' && !r.same ? copyValue(r.field, r.now) : '';
    const later = r => r.kind === 'copy' ? (r.same ? [['follow', 'Let them go'], ['keep', 'Keep the copies']] : [['follow', `Use the crop’s ${copyValue(r.field, r.now)}`], ['keep', 'Keep the copy']])
      : [r.take ? ['take', `${DO.take} ${fig(r.take.typed)}${r.kind === 'yield' ? (weeklyOf(r) ? ' a week' : '') : ' d'}`] : null, ['follow', r.agrees ? 'Follow the list' : `${DO.follow} ${lists(r)}`], ['keep', DO.keep]];
    const options = r => LATER.includes(r.kind) ? later(r) : r.kind === 'days' ? [r.take ? ['take', `${DO.take} ${r.take.typed}${r.take.typed !== r.days ? ` (${r.days} in the bed)` : ''}`] : null, ['follow', r.agrees ? 'Follow the list' : `${DO.follow} ${r.listDays.length > 1 ? r.listDays[0] + '–' + r.listDays[r.listDays.length - 1] : r.listDays[0]}`], ['keep', DO.keep]]
      : r.kind === 'weeks' ? [['follow', `Use the crop’s ${num(r.listWeeks, 1)} wk`], ['keep', DO.keep]] : [['follow', 'Follow the list'], ['keep', DO.keep]];
    const effects = new Map();
    const draw = () => {
      const view = App.auditPreview(rows, choices), step = view.step;
      view.byId = new Map(view.moves.map(m => [m.id, m])); view.yById = new Map(view.yields.map(y => [y.id, y])); view.gById = new Map(view.ground.map(g => [g.id, g]));
      for (const r of rows) { const cell = effects.get(r.key); if (!cell) continue; cell.textContent = effectText(r, view, choices[r.key]); cell.classList.toggle('moves', choices[r.key] !== 'keep' && r.ids.some(id => view.byId.has(id) || (LATER.includes(r.kind) && (view.yById.has(id) || view.gById.has(id))))); }
      const n = step.plantings, eng2 = view.engine, worthMoved = Math.abs(view.worth[1] - view.worth[0]) >= 0.5;
      const fig = (label, value, bad) => h('span' + (bad ? '.bad' : ''), h('i', label), h('b', num(value)));
      const pairLine = ([a, b]) => { const p = eng2.planting(a), q = eng2.planting(b), bed = p && eng2.bedOf(p.bedId); return h('li', `${bed ? App.bedLabel(bed) : 'A space'}: ${p ? App.cropLabel(p) : '?'} and ${q ? App.cropLabel(q) : '?'}`); };
      UI.add(clear(sum),
        h('b.au-sumhead', { id: 'auHead' }, n ? `${plural(n, 'planting')} will follow the list` : 'Nothing will change'),
        h('p.au-figs', { id: 'auFigs' }, fig('list takes', step.taken), fig('harvest dates moved', view.harvest, view.harvest > 0), fig('sowing dates moved', view.sowing, view.sowing > 0), fig('new double bookings', view.fresh.length, view.fresh.length > 0),
          view.settled.length ? fig('double bookings settled', view.settled.length) : null,
          h('span' + (worthMoved ? '.bad' : ''), { id: 'auWorth', title: 'What the season’s harvest is worth at each crop’s price, before and after this step' }, h('i', 'season’s worth'), h('b', worthMoved ? `${money(view.worth[0])} → ${money(view.worth[1])}` : money(view.worth[0])))),
        h('p.au-line', `${plural(step.kept, 'planting')} keep${step.kept === 1 ? 's' : ''} ${step.kept === 1 ? 'its' : 'their'} own figures.${view.harvest ? ` The largest move is ${Math.abs(view.most)} day${Math.abs(view.most) === 1 ? '' : 's'} ${view.most > 0 ? 'later' : 'sooner'}.` : ''}`),
        view.fresh.length ? h('ul.au-new', { id: 'auNew' }, view.fresh.slice(0, 6).map(pairLine), view.fresh.length > 6 ? h('li', `and ${num(view.fresh.length - 6)} more`) : null) : null,
        view.crops.length ? h('ul.au-new.au-crops', { id: 'auCrops' }, view.crops.slice(0, 6).map(c => h('li', `${c.name}: ${num(c.total[0])} → ${num(c.total[1])}${c.unit && c.unit !== 'each' ? ' ' + c.unit : ''}, ${money(c.worth[0])} → ${money(c.worth[1])}`)), view.crops.length > 6 ? h('li', `and ${num(view.crops.length - 6)} more crops`) : null) : null,
        h('p.au-fine', `${view.standing ? `The ${plural(view.standing, 'pair')} already booked into the same ground ${view.standing === 1 ? 'is' : 'are'} not counted as new. ` : ''}${made.held ? `${plural(made.held, 'planting')} with recorded work ${made.held === 1 ? 'is' : 'are'} left as ${made.held === 1 ? 'it is' : 'they are'}. ` : ''}The plan as it stands is kept as a snapshot first, and one undo takes this back.`));
      apply.disabled = !step.ops.length;
    };
    // What is shown: the groups that would change if they followed the list (the ones the planner suggests keeping), crop by crop;
    // or, on request, every group, and by kind of figure as the window was first built. What is not shown keeps its suggestion.
    const differs = r => r.choice === 'keep', shown = () => (view.all ? rows : rows.filter(differs)), quiet = rows.filter(r => !differs(r)).length;
    const rowEl = (r, first) => {
      const effect = h('td.au-effect'); effects.set(r.key, effect);
      const pick = h('select', { 'aria-label': 'What to do', dataset: { row: r.key }, onchange: e => { choices[r.key] = e.target.value; draw(); } }, options(r).filter(Boolean).map(([value, text]) => h('option', { value, selected: choices[r.key] === value }, text)));
      return h('tr.au-row', { dataset: { key: r.key, kind: r.kind } },
        h('td.au-name', first), h('td.au-where', r.kind === 'wait' ? 'To place' : r.env ? LABEL[r.env] : ''), h('td.au-n', num(r.ids.length)),
        h('td.au-n', r.kind === 'wait' ? String(r.days) : theirs(r)),
        h('td.au-n.au-list', r.kind === 'wait' ? '' : lists(r)), h('td.au-do', pick), effect);
    };
    const section = (title, kind, note) => {
      const list = shown().filter(r => r.kind === kind);
      if (!list.length) return;
      body.append(h('tr.au-sec', h('td', { colSpan: 7 }, h('b', title), h('small', note))));
      for (const r of list) body.append(rowEl(r, name(r)));
    };
    const fill = () => {
      clear(body); effects.clear();
      const list = shown();
      if (!list.length) body.append(h('tr.au-none', h('td', { colSpan: 7, id: 'auNone' }, quiet ? `Nothing differs: all ${plural(quiet, 'group')} can follow your list with nothing changing. Apply does that, or tick the box below to see them.` : 'Every planting follows your list.')));
      else if (view.by === 'kind') {
        section('Days to harvest', 'days', 'their own number, against what the list gives');
        section('Nursery weeks', 'weeks', 'kept from the old planner, where the crop now says otherwise');
        section('To place', 'wait', 'waiting plantings that carry their own days');
        section('Yield', 'yield', 'their own figure, a total over the harvest, against what the list gives');
        section('Harvest days', 'window', 'how long they are picked, against the crop’s');
        section('Turnover days', 'turn', 'how long the ground is held after the last harvest');
        section('Copies from the old planner', 'copy', 'crop values copied onto a planting when it was made');
      } else {
        // crop by crop: everything one crop's plantings carry is read together
        const groups = new Map(), label = r => r.same ? 'Copies that say what the crop says now' : (eng.crop(r.cropId) || { name: 'Crop' }).name;
        for (const r of list) { const k = label(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
        for (const [title, mine] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
          body.append(h('tr.au-sec.au-crop', { dataset: { crop: title } }, h('td', { colSpan: 7 }, h('b', title), h('small', `${plural(mine.reduce((n, r) => n + r.ids.length, 0), 'planting')} in ${plural(mine.length, 'group')}`))));
          for (const r of mine.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))) { const v = eng.variety(r.varietyId); body.append(rowEl(r, [h('b', KIND[r.kind] || r.kind), r.same ? null : r.kind === 'copy' ? h('small', COPY[r.field] || r.field) : v ? h('small', v.name) : r.varieties && r.varieties.length > 1 ? h('small', `${r.varieties.length} varieties`) : null])); }
        }
      }
      draw();
    };
    const el = h('dialog.dialog.bk.audit', { id: 'auditDlg', oncancel: e => { e.preventDefault(); close(); } },
      h('button.icon-btn.close', { type: 'button', id: 'auClose', 'aria-label': 'Close', title: 'Close. Nothing is changed.', onclick: () => close() }, '×'),
      h('h2', 'Plantings that differ from your list'),
      h('p.dlg-lead', 'These carry a figure of their own, and following your list would change a date or a yield. For each group, choose: keep their own, or use the list’s and see what moves. Nothing changes until you press Apply.'),
      h('div.au-view', { id: 'auView' },
        h('div.seg', { role: 'group', 'aria-label': 'How the groups are set out', id: 'auBy' }, [['crop', 'By crop'], ['kind', 'By kind of figure']].map(([id, text]) => h('button', { type: 'button', dataset: { by: id }, 'aria-pressed': String(view.by === id), onclick: e => { view.by = id; for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b.dataset.by === id)); fill(); } }, text))),
        quiet ? h('label.ah-check', h('input', { type: 'checkbox', id: 'auAll', checked: view.all, onchange: e => { view.all = e.target.checked; fill(); } }), h('span', `Also show the ${plural(quiet, 'group')} that can follow the list with nothing changing`)) : null),
      h('div.au-scroll', h('table.au', h('thead', h('tr', h('th', 'Crop and variety'), h('th', 'Where'), h('th.au-n', 'Plantings'), h('th.au-n', 'Theirs'), h('th.au-n', { title: 'What the list gives these plantings today' }, 'List'), h('th', 'What to do'), h('th', 'What that does'))), body)),
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
    document.body.append(el); el.showModal(); fill();
  }

  // ───────────────────────── yield and price: the second table ─────────────────────────
  /** A cell with one number in it. `mine` is the grower's, `fallback` what is used without one. Clearing goes back to the fallback. */
  function figCell({ cls = '', key, mine, fallback, label, tip, min = 0, max, whole, open, save }) {
    const shown = mine != null ? fig(mine) : '';
    const input = h('input', { type: 'number', min, max, step: whole ? 1 : 'any', value: shown, placeholder: fallback == null ? '' : typeof fallback === 'string' ? fallback : fig(fallback), title: tip, 'aria-label': label, dataset: { hk: key },
      onchange: async e => {
        const raw = e.target.value.trim(), n = raw === '' ? null : whole ? Math.round(+raw) : +raw;
        if (n != null && (!Number.isFinite(n) || n < min || (max != null && n > max))) { e.target.value = shown; return; }
        if ((n == null && mine == null) || (n != null && mine != null && Math.abs(n - mine) < 1e-9)) { e.target.value = shown; return; }
        if (!await save(n)) schedule();
      } });
    return h('td.as-cell.ah-c' + cls + (mine != null ? '.mine' : open ? '.open' : ''), input);
  }
  const unitOptions = (value, fallback) => [...new Set([...UNITS, fallback, value].filter(Boolean))];
  function harvestHead() {
    const th = (cls, text, title, small) => h('th' + cls, { title }, small ? h('small', small) : null, text);
    clear($('ahHead')).append(h('tr', h('th', 'Crop'),
      th('.ah-unit', 'Sold by', 'The unit the crop is counted and sold in. The yield and the price are in this unit; one unit is never turned into another.'),
      th('.ah-price', 'Price $', 'What one unit sells for. A variety can have its own.'),
      th('.ah-pick', 'Picked', 'How the harvest comes in. Gradually: picked week by week, and the yield is a week’s picking. Clear: the yield is a total, all of it taken the day it is ready. On demand: the yield is a total, held and taken evenly over the harvest days.'),
      th('.ah-days', 'Days', 'Harvest days: how long the crop is picked, or held to be picked. The ground is held that long.'),
      App.state.engine.ENVS.map(env => th('.ah-y', SHORT[env], `Yield ${LABEL[env].toLowerCase()}, for a plant or a bed-foot as the row says: a total, or a week’s picking where the crop is picked each week`, 'Yield')),
      th('.ah-comes', 'Comes to', 'The total and the weekly figure side by side, for the condition the crop is mostly grown in. One is yours; the other follows from the harvest days.'),
      th('.ah-s', 'Sold %', 'The part of what is picked that is good enough to sell'),
      th('.ah-s', 'Keeps wk', 'Weeks the crop keeps after picking. What is picked is then counted as there to sell evenly over those weeks.'),
      th('.ah-s', 'Turnover', 'Days the ground is held after the last harvest, before the next crop can go in')));
  }
  function comesTo(hc, env, unit) {
    const cell = hc.cells[env];
    if (hc.micro) return h('td.as-seed.ah-comes', 'a tray is a tray');
    if (!cell || cell.value == null) return h('td.as-seed.ah-comes.bad', { title: 'No yield is set, so nothing is forecast for this crop.' }, 'no yield');
    const u = unit === 'each' ? '' : ' ' + unit, weeks = fig(hc.nominal / 7), per = BASIS[hc.basis];
    const tip = `${LABEL[env]}: ${fig(cell.total)}${u} from ${per} over ${hc.nominal} harvest days, which is ${fig(cell.weekly)} a week. ${hc.share.value}% of it is counted as sold.`;
    const from = hc.basis === 'ft' ? 'a bed-ft' : per;
    return h('td.as-seed.ah-comes', { title: tip }, h('b', `${fig(cell.total)}${u}`), h('small', hc.weekly ? `${fig(cell.weekly)} × ${weeks} wk · ${from}` : `${fig(cell.weekly)}/wk · ${from}`));
  }
  function harvestTable(eng, plan, q, list) {
    const used = new Map(), where = new Map(), whereV = new Map(), ownY = new Map();
    for (const p of plan.plantings) {
      bump(used, p.cropId);
      if (p.yield != null && p.yield !== '' && !p.liveTray) bump(ownY, p.cropId);
      const env = eng.envOf(eng.bedOf(p.bedId));
      if (env) { const m = where.get(p.cropId) || new Map(); bump(m, env); where.set(p.cropId, m); if (p.varietyId) { const mv = whereV.get(p.varietyId) || new Map(); bump(mv, env); whereV.set(p.varietyId, mv); } }
    }
    const mainEnv = (m, cells) => { const best = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null; return best && cells[best].used ? best : eng.ENVS.find(e => cells[e].used) || 'field'; };
    harvestHead();
    const body = clear($('ahBody')), crops = eng.crops();
    let shown = 0, mineCount = 0, openYield = 0, openPrice = 0;
    for (const c of crops) {
      const varieties = c.micro ? [] : eng.varietiesOf(c.id), mine = root.LRFPanels.isMine(c, used, varieties, list), hc = eng.harvestFor(c.id);
      if (mine) { mineCount++; if (hc.open.yield && eng.ENVS.every(e => hc.cells[e].mine == null)) openYield++; if (hc.open.price && hc.price.mine == null) openPrice++; }
      if (ui.scope === 'mine' && !mine && !q) continue;
      const nameHit = !q || String(c.name).toLowerCase().includes(q), hits = q ? varieties.filter(v => String(v.name).toLowerCase().includes(q)) : varieties;
      if (!nameHit && !hits.length) continue;
      shown++;
      const open = ui.open.has(c.id) || (q && !nameHit), unit = hc.unit.value, main = mainEnv(where.get(c.id), hc.cells), u = unit === 'each' ? '' : ' ' + unit, loose = hc.open.yield && eng.ENVS.every(e => hc.cells[e].mine == null);
      const unitCell = hc.micro ? h('td.as-start', h('span.as-fixed', { title: 'A live tray is counted and sold by the tray.' }, 'tray'))
        : h('td.as-start', h('select.as-from.ah-sel' + (hc.unit.mine ? '.mine' : ''), { 'aria-label': `${c.name}: sold by`, dataset: { hk: `unit|${c.id}` }, title: hc.unit.mine ? `Your choice. The crop’s record says ${hc.unit.fallback}.` : 'From the crop’s record. Choose another to change it.',
          onchange: async e => { const value = e.target.value; if (!await App.setSell(c.id, { unit: value === '(default)' || value === hc.unit.fallback ? null : value }, `${c.name}: sold by the ${value === '(default)' ? hc.unit.fallback : value}`)) schedule(); } },
          unitOptions(unit, hc.unit.fallback).map(x => h('option', { value: x, selected: x === unit }, x)), hc.unit.mine ? h('option', { value: '(default)' }, `Back to ${hc.unit.fallback}`) : null));
      const pickCell = hc.micro ? h('td.as-start', h('span.as-fixed', { title: 'A live tray is counted whole on the Monday it is due.' }, 'when due'))
        : h('td.as-start', h('select.as-from.ah-sel' + (hc.pattern.mine ? '.mine' : ''), { 'aria-label': `${c.name}: picked`, dataset: { hk: `pick|${c.id}` }, title: `${PATTERN_TIP[hc.pattern.value]}${hc.pattern.mine ? '' : ' Not set: this is how every crop has been counted so far.'}`,
          onchange: async e => { const value = e.target.value; if (!await App.setSell(c.id, { pattern: value === 'unset' ? null : value }, `${c.name}: ${value === 'unset' ? 'picked as before' : PATTERN_SAY[value]}`)) schedule(); } },
          Object.entries(PATTERN).map(([value, text]) => h('option', { value, selected: hc.pattern.value === value }, text)), hc.pattern.mine ? h('option', { value: 'unset' }, 'Back to not set') : null));
      const fixed = (text, title) => h('td.as-cell.none', { title }, text);
      const yields = (kind, id, x, name) => eng.ENVS.map(env => {
        const cell = x.cells[env];
        if (x.micro) return fixed('—', 'A live tray is one tray.');
        if (!cell.used) return fixed('—', `Nothing on the farm is ${LABEL[env].toLowerCase()} yet`);
        const what = `${x.weekly ? 'picked each week from' : 'in all from'} ${BASIS[x.basis]}`, back = cell.fallback == null ? 'no yield at all' : fig(cell.fallback);
        return figCell({ cls: '.ah-y', key: `y|${kind}|${id}|${env}`, mine: cell.mine, fallback: cell.fallback, open: kind === 'crops' && loose, label: `${name}, ${LABEL[env].toLowerCase()}: yield`,
          tip: cell.mine != null ? `Your figure: ${fig(cell.mine)}${u} ${what}. Clear it to go back to ${back}.` : cell.by === 'crop-mine' ? `Your figure for the crop: ${fig(cell.fallback)}${u} ${what}.` : cell.fallback == null ? 'No yield is set for this crop.' : `${kind === 'crops' && loose ? 'A starting value nobody has checked' : 'From the crop’s record, not yet checked'}: ${fig(cell.fallback)}${u} ${what}.`,
          save: n => App.setYield(kind, id, env, n, n == null ? `${name}, ${LABEL[env].toLowerCase()}: yield back to ${back}` : `${name}, ${LABEL[env].toLowerCase()}: ${fig(n)}${u} ${x.weekly ? 'a week' : 'in all'}`) });
      });
      body.append(h('tr.as-crop' + (open ? '.open' : ''), { dataset: { crop: c.id } },
        h('td', h('div.as-name',
          varieties.length ? h('button.as-more', { type: 'button', 'aria-expanded': String(!!open), 'aria-label': `${open ? 'Hide' : 'Show'} ${varieties.length} varieties of ${c.name}`, title: `${varieties.length} variet${varieties.length === 1 ? 'y' : 'ies'}`, onclick: () => { ui.open.has(c.id) ? ui.open.delete(c.id) : ui.open.add(c.id); render(); } }, open ? '▾' : '▸') : h('span.as-more'),
          root.LRFThumbs.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 24, cls: 'key' }),
          h('span.as-nc', h('b', c.name),
            loose ? h('small.as-guess', { title: 'This yield is the starting value a new crop is given, or there is none. Type the real one.' }, hc.cells[main].fallback == null ? 'no yield' : 'yield not checked') : null,
            hc.open.price && hc.price.mine == null ? h('small.as-guess', { title: 'No price is set, so this crop adds nothing to what the season is worth.' }, 'no price') : null,
            ownY.get(c.id) ? h('small', { title: `${ownY.get(c.id)} planting${ownY.get(c.id) === 1 ? ' carries its' : 's carry their'} own yield and ${ownY.get(c.id) === 1 ? 'does' : 'do'} not follow this row. “Review…” above lets them follow it.` }, `${ownY.get(c.id)} own`) : null))),
        unitCell,
        figCell({ cls: '.ah-price', key: `price|${c.id}`, mine: hc.price.mine, fallback: hc.price.fallback, open: hc.open.price, label: `${c.name}: price`, tip: hc.price.mine != null ? `Your price for one ${unit === 'each' ? 'of them' : unit}. Clear it to go back to ${fig(hc.price.fallback)}.` : `From the crop’s record: $${fig(hc.price.fallback)} for one ${unit === 'each' ? 'of them' : unit}.`,
          save: n => App.setSell(c.id, { price: n }, n == null ? `${c.name}: price back to $${fig(hc.price.fallback)}` : `${c.name}: $${fig(n)}${unit === 'each' ? ' each' : ' a ' + unit}`) }),
        pickCell,
        hc.micro ? fixed('—', 'A live tray is ready on one day.') : figCell({ cls: '.ah-days', key: `days|${c.id}`, mine: hc.days.mine, fallback: hc.season ? 'season' : hc.days.fallback, whole: true, min: 1, max: 400, label: `${c.name}: harvest days`,
          tip: hc.days.mine != null ? `Your number: picked for ${hc.days.mine} days. Clear it to go back to ${hc.season ? 'the end of the season' : hc.days.fallback + ' days'}.` : hc.season ? `Picked until the season ends where it grows. A yield is spoken of over ${hc.nominal} days. Type a number to pick it for that many days instead.` : `From the crop’s record: picked for ${hc.days.fallback} days.`,
          save: n => App.setSell(c.id, { days: n }, n == null ? `${c.name}: harvest days as before` : `${c.name}: picked for ${n} days`) }),
        yields('crops', c.id, hc, c.name),
        comesTo(hc, main, unit),
        hc.micro ? fixed('—') : figCell({ cls: '.ah-s', key: `share|${c.id}`, mine: hc.share.mine, fallback: hc.share.fallback, max: 100, label: `${c.name}: sold percent`, tip: `Of what is picked, the part counted as sold. ${hc.share.mine != null ? 'Yours.' : 'From the crop’s record.'}`, save: n => App.setSell(c.id, { share: n }, n == null ? `${c.name}: sold share back to ${hc.share.fallback}%` : `${c.name}: ${fig(n)}% sold`) }),
        hc.micro ? fixed('—') : figCell({ cls: '.ah-s', key: `keep|${c.id}`, mine: hc.keep.mine, fallback: 0, max: 60, label: `${c.name}: keeps, weeks`, tip: 'Weeks it keeps after picking. What is picked is counted as there to sell evenly over those weeks. Nothing set: it is sold as it is picked.', save: n => App.setSell(c.id, { keep: n }, n == null || n === 0 ? `${c.name}: sold as it is picked` : `${c.name}: keeps ${fig(n)} week${n === 1 ? '' : 's'}`) }),
        hc.micro ? fixed('—') : figCell({ cls: '.ah-s', key: `turn|${c.id}`, mine: hc.turnover.mine, fallback: hc.turnover.fallback, whole: true, max: 120, label: `${c.name}: turnover days`, tip: `Days the ground is held after the last harvest. ${hc.turnover.mine != null ? 'Yours for this crop.' : `Nothing set: the farm’s ${hc.turnover.fallback} days.`} A planting with its own number keeps it.`, save: n => App.setSell(c.id, { turnover: n }, n == null ? `${c.name}: turnover back to ${hc.turnover.fallback} days` : `${c.name}: ${n} turnover day${n === 1 ? '' : 's'}`) })));
      if (!open) continue;
      for (const v of (nameHit ? varieties : hits)) {
        const hv = eng.harvestFor(c.id, v.id), vu = hv.unit.value;
        body.append(h('tr.as-var', { dataset: { variety: v.id } },
          h('td', h('div.as-name', root.LRFThumbs.el({ varietyId: v.id, color: eng.cropColor(c), label: v.name, size: 22 }), h('span.as-nc', h('span.as-vname', v.name)))),
          h('td.as-start', h('select.as-from.ah-sel' + (hv.unit.mine ? '.own' : ''), { 'aria-label': `${v.name}: sold by`, dataset: { hk: `vunit|${v.id}` }, title: hv.unit.mine ? `This variety’s own unit. Its yield and price are in ${vu}; give it a yield of its own, since the crop’s is in ${unit}.` : 'Sold as the crop is.',
            onchange: async e => { const value = e.target.value; if (!await App.setSellV(v.id, { unit: value || null }, value ? `${v.name}: sold by the ${value}` : `${v.name}: sold as the crop is`)) schedule(); } },
            h('option', { value: '', selected: !hv.unit.mine }, 'As the crop'), unitOptions(hv.unit.mine, null).map(x => h('option', { value: x, selected: hv.unit.mine === x }, x)))),
          figCell({ cls: '.ah-price', key: `vprice|${v.id}`, mine: hv.price.mine, fallback: hv.price.fallback, label: `${v.name}: price`, tip: hv.price.mine != null ? 'This variety’s own price. Clear it to use the crop’s.' : `The crop’s price: $${fig(hv.price.fallback)}.`, save: n => App.setSellV(v.id, { price: n }, n == null ? `${v.name}: priced as the crop` : `${v.name}: $${fig(n)}${vu === 'each' ? ' each' : ' a ' + vu}`) }),
          h('td'), h('td'),
          yields('varieties', v.id, hv, v.name),
          comesTo(hv, mainEnv(whereV.get(v.id), hv.cells), vu), h('td'), h('td'), h('td')));
      }
    }
    if (!shown) body.append(h('tr', h('td.empty', { colSpan: 13 }, q ? `No crop or variety matches “${ui.query}”.` : 'No crops yet.')));
    for (const [scope, count] of [['mine', mineCount], ['all', crops.length]]) { const el = document.querySelector(`[data-as-scope="${scope}"] small`); if (el) el.textContent = count; }
    const note = $('ahOpen');
    note.hidden = !(openYield || openPrice);
    clear(note);
    if (openYield || openPrice) note.append(h('b', [openYield ? `${plural(openYield, 'crop')} of yours ${openYield === 1 ? 'stands' : 'stand'} on a yield nobody has checked` : '', openPrice ? `${plural(openPrice, 'crop')} ${openPrice === 1 ? 'has' : 'have'} no price` : ''].filter(Boolean).join(' · ')),
      h('small', 'They are marked in the list. Until they are set, what the Harvest view says of them is a placeholder.'));
  }
  /** How many figures of the grower's own the list holds, in words. */
  function countLine(plan) {
    const a = plan.assumptions, cells = a ? Object.values(a.crops || {}).concat(Object.values(a.varieties || {})).flatMap(r => Object.values(r)) : [];
    const days = cells.filter(c => c && c.dtm != null).length, yields = cells.filter(c => c && c.yield != null).length, starts = a && a.starts ? Object.keys(a.starts).length : 0;
    const lines = a ? Object.values(a.sell || {}).concat(Object.values(a.sellV || {})).reduce((n, r) => n + Object.keys(r).length, 0) : 0;
    $('asCount').textContent = days || starts || yields || lines ? [days ? `${days} number${days === 1 ? '' : 's'} of your own` : '', starts ? `“Days counted from” set for ${starts} crop${starts === 1 ? '' : 's'}` : '', yields ? `${yields} yield${yields === 1 ? '' : 's'}` : '', lines ? `${lines} other figure${lines === 1 ? '' : 's'} on crop lines` : ''].filter(Boolean).join(' · ') : 'Nothing set yet: every number is a default';
  }
  const HEAD = {
    days: ['Days to first harvest', 'Each row says where its days start, and its numbers count from there. Every number is used as it stands: nothing is added or taken off for the month or the house. Grey is the default; a variety with its own figure keeps it, and a planting with no variety uses the crop row.'],
    harvest: ['Yield and price', 'What each crop is sold by and for, how it is picked, and what it yields from a plant or a bed-foot in each growing condition. A yield is a total over the harvest days, or a week’s picking where “Picked” says each week. Grey is what the plan uses now; type over it to make it yours. A planting with a figure of its own keeps it until “Review…” lets it go.']
  };
  function chrome() {
    const harvest = ui.mode === 'harvest';
    $('asTitle').textContent = HEAD[ui.mode][0]; $('asLead').textContent = HEAD[ui.mode][1];
    $('asTable').hidden = harvest; $('ahTable').hidden = !harvest;
    if (!harvest) $('ahOpen').hidden = true;
    for (const b of document.querySelectorAll('[data-as-mode]')) b.setAttribute('aria-pressed', String(b.dataset.asMode === ui.mode));
    document.getElementById('assumeView').dataset.mode = ui.mode;
  }

  function render() {
    cancelAnimationFrame(ui.frame);
    if (!App.state.ready || App.state.view !== 'assume') { ui.dirty = true; return; }
    ui.dirty = false;
    const eng = App.state.engine, plan = App.state.plan, q = ui.query.trim().toLowerCase(), list = plan.settings.cropTypeList || {};
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset : null, focusKey = focus && (focus.key ? ['key', focus.key] : focus.start ? ['start', focus.start] : focus.less ? ['less', focus.less] : focus.vstart ? ['vstart', focus.vstart] : focus.hk ? ['hk', focus.hk] : null);
    const refocus = () => { if (!focusKey) return; const el = document.querySelector(`#${focusKey[0] === 'hk' ? 'ahBody' : 'asBody'} [data-${focusKey[0]}="${CSS.escape(focusKey[1])}"]`); if (el) { el.focus(); if (el.select && el.tagName === 'INPUT') el.select(); } };
    const used = new Map(), pins = new Map(), usedV = new Map(), pinsV = new Map(), where = new Map(), whereV = new Map();
    for (const p of plan.plantings) {
      const own = eng.pinned(p) && !p.liveTray;
      bump(used, p.cropId); if (own) bump(pins, p.cropId);
      if (p.varietyId) { bump(usedV, p.varietyId); if (own) bump(pinsV, p.varietyId); }
      const env = eng.envOf(eng.bedOf(p.bedId));
      if (env) { const m = where.get(p.cropId) || new Map(); bump(m, env); where.set(p.cropId, m); if (p.varietyId) { const mv = whereV.get(p.varietyId) || new Map(); bump(mv, env); whereV.set(p.varietyId, mv); } }
    }
    places(); auditNote(); chrome(); countLine(plan);
    if (ui.mode === 'harvest') { $('asHints').hidden = true; harvestTable(eng, plan, q, list); refocus(); return; }
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
            hint ? h('button.as-hint', { type: 'button', dataset: { hint: c.id }, title: `${hint.says}. Press to count this crop that way; what moves is shown first.`, onclick: () => App.setStart(c.id, hintChange(eng, c, hint), `${c.name}: days counted from ${hintWord(hint)}`) }, `Johnny’s: ${hintWord(hint)}`) : null))),
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
            !guess && v.catalogMaturityBasis === 'seed' && eng.startRule(c.id).from === 'direct' ? h('small.as-guess', { title: 'This variety says its days are counted from seeding in trays, so the whole nursery time comes off. If its supplier meant seed sown in place, as the crop row now says, set it to Direct seeding.' }, 'seeding in trays, not the crop’s direct seeding') : null))),
          varietyStartCell(eng, c, v),
          eng.ENVS.map(env => cell('varieties', v.id, env, t[env], v.name)),
          (mine => seedCell(t[mine], mine))(mainEnv(whereV.get(v.id), t, main)),
          useCell(usedV.get(v.id) || 0, pinsV.get(v.id) || 0)));
      }
    }
    if (!shown) body.append(h('tr', h('td.empty', { colSpan: 8 }, q ? `No crop or variety matches “${ui.query}”.` : 'No crops yet.')));
    for (const [scope, count] of [['mine', mineCount], ['all', crops.length]]) { const el = document.querySelector(`[data-as-scope="${scope}"] small`); if (el) el.textContent = count; }
    // Every published starting point that differs from how the plan counts now, in one press.
    const all = $('asHints');
    if (all) {
      all.hidden = !offers.length;
      clear(all);
      if (offers.length) all.append(h('span', h('b', `${plural(offers.length, 'crop')} of yours ${offers.length === 1 ? 'has' : 'have'} published guidance on where days are counted from that the plan does not use yet`), h('small', offers.map(o => o.c.name).join(', '))),
        h('button.btn.small', { type: 'button', id: 'asHintsAll', title: 'Count each of these crops the way Johnny’s says. What moves is shown before anything changes.', onclick: () => App.setStarts(offers.map(o => hintChange(eng, o.c, o.hint)), `${plural(offers.length, 'crop')}: days start where Johnny’s says`, { ask: true }) }, 'Use them all…'));
    }
    refocus();
  }
  /** Redraw after the browser has moved the focus on, so tabbing from cell to cell keeps its place. */
  function schedule() { cancelAnimationFrame(ui.frame); ui.frame = requestAnimationFrame(render); }

  function init() {
    $('asSearch').addEventListener('input', e => { ui.query = e.target.value; render(); });
    for (const button of document.querySelectorAll('[data-as-scope]')) {
      button.addEventListener('click', () => { ui.scope = button.dataset.asScope; for (const b of document.querySelectorAll('[data-as-scope]')) b.setAttribute('aria-pressed', String(b === button)); render(); });
    }
    for (const button of document.querySelectorAll('[data-as-mode]')) button.addEventListener('click', () => { ui.mode = button.dataset.asMode; render(); });
    App.on('plan', () => { if (audit) audit.close(); if (App.state.view === 'assume') schedule(); else ui.dirty = true; });
    App.on('view', () => { if (App.state.view === 'assume' && ui.dirty) render(); });
  }

  root.LRFAssume = { init, LABEL, openAudit, audit: () => audit, auditView: change => Object.assign(auView, change || {}), tidy, setMode: mode => { ui.mode = mode === 'harvest' ? 'harvest' : 'days'; render(); }, mode: () => ui.mode, fig };
})(window);
