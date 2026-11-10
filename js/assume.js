/* Little River Farm Planner — the assumptions list.
 *
 * One table for the numbers the whole plan rests on: days to first harvest for
 * every crop, and for each variety that differs, in each growing condition the
 * farm has (field, unheated tunnel, heated greenhouse, towers).
 *
 * Grey is what the planner uses when nothing is set. A number typed here is used
 * exactly as typed, by every planting that has not been given its own. Clearing
 * a cell goes back to the grey number.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI;
  const { h, clear, num } = UI;
  const $ = id => document.getElementById(id);
  const LABEL = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers' };
  const ui = { scope: 'mine', query: '', open: new Set(), dirty: true, frame: 0 };
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  function cell(kind, id, env, t, name) {
    if (t.source === 'none') return h('td.as-cell.none', { title: `Nothing on the farm is ${LABEL[env].toLowerCase()} yet` }, '—');
    const why = { library: 'Planner default, not yet checked against a guide', guide: t.guide ? `${t.guide.sources.map(x => `${x.name} gives ${x.range[0]} to ${x.range[1]} days from ${x.basis}`).join('. ')}${t.guide.kept ? '' : `. The planner had ${t.guide.was}`}` : '', supplier: `The supplier prints ${t.printed} days${t.basis && t.basis !== 'unspecified' ? ' from ' + t.basis : ''} for this variety`, variety: 'Kept on the variety', crop: 'Same as the crop', 'crop-mine': 'Your number for the crop' }[t.source];
    const swings = t.swing && (t.swing[0] < 0.999 || t.swing[1] > 1.001) && t.source !== 'crop-mine';
    const tip = t.mine ? `Your number, used as it is. Clear it to go back to ${t.fallback}.` : `${why}: ${t.fallback} days.${swings ? ` The planner then stretches it by month, from ${Math.round(t.fallback * t.swing[0])} to ${Math.round(t.fallback * t.swing[1])} days. A number you type is used as it is.` : ''}`;
    const where = `${name}, ${LABEL[env].toLowerCase()}`;
    const input = h('input', { type: 'number', min: 1, max: 730, step: 1, value: t.mine || '', placeholder: t.fallback, title: tip, 'aria-label': `${where}: days to harvest`, dataset: { key: `${kind}|${id}|${env}` },
      onchange: async e => {
        const n = Math.round(+e.target.value), days = n > 0 ? Math.min(730, n) : 0;
        if (days === (t.mine || 0)) { e.target.value = t.mine || ''; return; }
        if (!await App.setAssumption(kind, id, env, days, days ? `${where}: ${days} days` : `${where}: back to ${t.fallback} days`)) schedule();
      } });
    return h('td.as-cell' + (t.mine ? '.mine' : t.source === 'supplier' || t.source === 'variety' ? '.own' : t.source === 'guide' ? '.guide' : ''), input);
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

  function render() {
    cancelAnimationFrame(ui.frame);
    if (!App.state.ready || App.state.view !== 'assume') { ui.dirty = true; return; }
    ui.dirty = false;
    const eng = App.state.engine, plan = App.state.plan, q = ui.query.trim().toLowerCase(), list = plan.settings.cropTypeList || {};
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    const used = new Map(), pins = new Map(), usedV = new Map(), pinsV = new Map();
    for (const p of plan.plantings) {
      bump(used, p.cropId); if (eng.pinned(p)) bump(pins, p.cropId);
      if (p.varietyId) { bump(usedV, p.varietyId); if (eng.pinned(p)) bump(pinsV, p.varietyId); }
    }
    places();
    const body = clear($('asBody')), crops = eng.crops().filter(c => !c.micro);
    const useCell = (n, pinned) => h('td.as-use', n ? String(n) : '', pinned ? h('span', { title: `${pinned} of them carry their own days to harvest and do not follow this row. Clear “Days to harvest” on a planting to make it follow.` }, ` · ${pinned} pinned`) : null);
    let shown = 0, mineCount = 0;
    for (const c of crops) {
      const varieties = eng.varietiesOf(c.id), mine = root.LRFPanels.isMine(c, used, varieties, list);
      if (mine) mineCount++;
      if (ui.scope === 'mine' && !mine && !q) continue;
      const nameHit = !q || String(c.name).toLowerCase().includes(q), hits = q ? varieties.filter(v => String(v.name).toLowerCase().includes(q)) : varieties;
      if (!nameHit && !hits.length) continue;
      shown++;
      const open = ui.open.has(c.id) || (q && !nameHit);
      body.append(h('tr.as-crop' + (open ? '.open' : ''),
        h('td', h('div.as-name',
          varieties.length ? h('button.as-more', { type: 'button', 'aria-expanded': String(!!open), 'aria-label': `${open ? 'Hide' : 'Show'} ${varieties.length} varieties of ${c.name}`, title: `${varieties.length} variet${varieties.length === 1 ? 'y' : 'ies'}`, onclick: () => { ui.open.has(c.id) ? ui.open.delete(c.id) : ui.open.add(c.id); render(); } }, open ? '▾' : '▸') : h('span.as-more'),
          h('i.swatch', { style: { background: eng.cropColor(c) } }), h('b', c.name),
          h('small', c.method === 'TP' ? 'from transplant' : 'from sowing'))),
        eng.ENVS.map(env => cell('crops', c.id, env, eng.timingFor(c.id, null, env), c.name)),
        useCell(used.get(c.id) || 0, pins.get(c.id) || 0)));
      if (!open) continue;
      for (const v of (nameHit ? varieties : hits)) {
        body.append(h('tr.as-var',
          h('td', h('div.as-name', h('span.as-vname', v.name), v.catalogDtm ? h('small', `prints ${v.catalogDtm} d${v.catalogMaturityBasis && v.catalogMaturityBasis !== 'unspecified' ? ' from ' + v.catalogMaturityBasis : ''}`) : null)),
          eng.ENVS.map(env => cell('varieties', v.id, env, eng.timingFor(c.id, v.id, env), v.name)),
          useCell(usedV.get(v.id) || 0, pinsV.get(v.id) || 0)));
      }
    }
    if (!shown) body.append(h('tr', h('td.empty', { colSpan: 6 }, q ? `No crop or variety matches “${ui.query}”.` : 'No crops yet.')));
    for (const [scope, count] of [['mine', mineCount], ['all', crops.length]]) { const el = document.querySelector(`[data-as-scope="${scope}"] small`); if (el) el.textContent = count; }
    const set = plan.assumptions ? Object.values(plan.assumptions.crops || {}).concat(Object.values(plan.assumptions.varieties || {})).reduce((n, r) => n + Object.keys(r).length, 0) : 0;
    $('asCount').textContent = set ? `${set} number${set === 1 ? '' : 's'} of your own` : 'Nothing set yet: every number is a default';
    if (focus) { const el = document.querySelector(`#asBody input[data-key="${CSS.escape(focus)}"]`); if (el) { el.focus(); el.select(); } }
  }
  /** Redraw after the browser has moved the focus on, so tabbing from cell to cell keeps its place. */
  function schedule() { cancelAnimationFrame(ui.frame); ui.frame = requestAnimationFrame(render); }

  function init() {
    $('asSearch').addEventListener('input', e => { ui.query = e.target.value; render(); });
    for (const button of document.querySelectorAll('[data-as-scope]')) {
      button.addEventListener('click', () => { ui.scope = button.dataset.asScope; for (const b of document.querySelectorAll('[data-as-scope]')) b.setAttribute('aria-pressed', String(b === button)); render(); });
    }
    App.on('plan', () => { if (App.state.view === 'assume') schedule(); else ui.dirty = true; });
    App.on('view', () => { if (App.state.view === 'assume' && ui.dirty) render(); });
  }

  root.LRFAssume = { init, LABEL };
})(window);
