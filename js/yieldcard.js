/* Little River Farm Planner — yield and price, one crop at a time.
 *
 * The other way to see the second half of the Assumptions list. The list has every crop on one page; this shows one crop,
 * with a box for each figure and the box's meaning written beside it:
 *
 *   down the left   every crop as a checklist: those with no price or no yield first, then the rest, biggest first. A crop is
 *                   ticked when "Looks right. Next: …" is pressed, and a bar says how many are looked at for the year.
 *   the card        a small grid. A column for each growing place the crop is planted in; a row for each figure, named in
 *                   plain words. A row is shown only where it is needed, and a cell that is not says why.
 *   under the grid  what it comes to (the forecast's own figures), and what it waits on.
 *   under the list  the sold shares the grower has typed, crop by crop: they are his, and are shown, not questioned.
 *
 * It holds no figures of its own. Every box reads what the list reads (engine.harvestFor) and writes through the call the
 * list's box writes through (App.setSell, App.setYield), with the same words for the step, so a figure typed here and the
 * same figure typed on the list leave the same plan. Nothing is written by opening a crop or walking the checklist; the tick
 * is the one thing this page adds to a plan (App.setLooked).
 *
 * The keyboard: Tab goes to the next box that is still empty and only the grower can fill; Enter is "Looks right. Next: …"
 * and lands on the next crop's first such box; a letter typed in a number box or on "Sold by" picks the unit it begins.
 *
 * Drawn by js/assume.js, which owns the page, its search box and "My crops / All crops".
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, F = root.LRFForecast;
  const { h, clear, num } = UI;
  const $ = id => document.getElementById(id);
  const PLACE = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers', tray: 'Living trays' };
  const FROM = { transplant: 'transplanting', seed: 'seeding in trays', direct: 'direct seeding' }, FIXED = { sown: 'direct seeding', planted: 'planting', tray: 'seeding in trays' };
  const UNITS = ['each', 'bunch', 'lb', 'pint', 'quart', 'clamshell', 'head', 'stem'];
  const PATTERN = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };
  const PATTERN_SAY = { weekly: 'picked gradually', once: 'cleared at once', spread: 'picked on demand' };
  const PATTERN_TIP = { spread: 'The yield is a total, picked evenly over the harvest days: held, and taken as it is wanted.', weekly: 'The yield is what is picked each week. A longer harvest gives more, a shorter one less.', once: 'The yield is a total, and all of it is counted the day the crop is ready.' };
  const PER = { plant: 'a plant', ft: 'a bed-foot', tray: 'a tray' };
  const COUNTED = ['each', 'head'];
  const fig = n => root.LRFAssume.fig(n);
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  const unitWord = unit => unit === 'each' ? '' : ' ' + unit;
  const each = unit => unit === 'each' ? ' each' : ' a ' + unit;

  // cur: the crop on the card. order: the checklist as it stood when the page was opened (it does not jump about while figures
  // are typed). first: the crops that had no price or no yield then. focus: where the pointer for typing goes after the next
  // drawing ({ key } a box, { blank: true } the first empty box). unit: a unit changed here since the card was opened.
  const ui = { cur: null, order: [], first: new Set(), scope: null, year: null, focus: null, unit: null, redraw: () => {} };

  // ───────────────────────── what the plan says of each crop ─────────────────────────
  const cache = new WeakMap();
  /** Every crop's plantings by place, and what the forecast makes of them. Worked out once for an engine. */
  function study(eng) {
    if (cache.has(eng)) return cache.get(eng);
    const plan = eng.plan, crops = new Map(), row = id => { if (!crops.has(id)) crops.set(id, { n: 0, places: new Map(), worth: 0, units: new Map(), personal: 0, own: 0 }); return crops.get(id); };
    const place = (x, env) => { if (!x.places.has(env)) x.places.set(env, { n: 0, total: 0, worth: 0, per: [], own: 0 }); return x.places.get(env); };
    const envOf = p => { const b = eng.bedOf(p.bedId); return b ? (eng.isRack(b) ? 'tray' : eng.envOf(b) || 'tray') : null; };
    for (const p of plan.plantings || []) {
      const env = envOf(p);
      if (!env) continue;
      const x = row(p.cropId), at = place(x, env);
      x.n++; at.n++;
      const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null;
      if (!y) continue;
      if (y.own) { x.own++; at.own++; }
      // a planting that follows the crop's own line: what one plant, or one bed-foot, of it gives over its whole harvest
      else if (y.by !== 'variety' && y.set) at.per.push(y.per);
    }
    const model = F.build(eng);
    for (const line of model.rows) {
      const x = row(line.cropId);
      x.worth += line.worth; x.personal += line.plantings.filter(q => q.personal).length;
      const u = x.units.get(line.unit) || { unit: line.unit, group: line.group, total: 0, worth: 0 };
      u.total += line.total; u.worth += line.worth; x.units.set(line.unit, u);
      for (const q of line.plantings) { const env = envOf(q.p); if (!env) continue; const at = place(x, env); at.total += q.inYear; at.worth += q.inYear * q.price; }
    }
    const waiting = new Map();
    for (const w of App.waiting()) waiting.set(w.cropId, (waiting.get(w.cropId) || 0) + 1);
    const out = { crops, waiting, year: model.year };
    cache.set(eng, out);
    return out;
  }
  const NONE = { n: 0, places: new Map(), worth: 0, units: new Map(), personal: 0, own: 0 };
  /** Is nothing set where only the grower can set it? The same two questions the list asks of a row. */
  function waits(eng, c, hc) {
    if (eng.isCoverCrop(c)) return { price: false, yield: false, any: false };
    const price = hc.open.price && hc.price.mine == null, loose = hc.open.yield && eng.ENVS.every(e => hc.cells[e].mine == null);
    return { price, yield: loose, any: price || loose };
  }
  /** The columns of a crop's grid: the places it is planted in; with nothing planted, every place the farm has. */
  function placesOf(eng, c, hc, x) {
    if (hc.micro) return { list: ['tray'], planted: x.n > 0 };
    const planted = eng.ENVS.filter(env => x.places.has(env));
    if (planted.length) return { list: eng.ENVS.filter(env => x.places.has(env) || hc.cells[env].mine != null), planted: true };
    return { list: eng.ENVS.filter(env => hc.cells[env].used), planted: false };
  }

  // ───────────────────────── the checklist ─────────────────────────
  /** The crops of the checklist, in the order they are walked: those with nothing set first, then the biggest first. */
  function arrange(eng, plan, scope, list) {
    const s = study(eng), used = new Map();
    for (const p of plan.plantings) used.set(p.cropId, (used.get(p.cropId) || 0) + 1);
    const mine = c => root.LRFPanels.isMine(c, used, c.micro ? [] : eng.varietiesOf(c.id), list);
    const all = eng.crops(), shown = all.filter(c => scope !== 'mine' || mine(c));
    const size = c => (s.crops.get(c.id) || NONE), big = (a, b) => size(b).worth - size(a).worth || size(b).n - size(a).n || String(a.name).localeCompare(String(b.name));
    const first = shown.filter(c => waits(eng, c, eng.harvestFor(c.id)).any).sort((a, b) => size(b).n - size(a).n || String(a.name).localeCompare(String(b.name)));
    const rest = shown.filter(c => !first.includes(c)).sort(big);
    return { order: [...first, ...rest].map(c => c.id), first: new Set(first.map(c => c.id)), mine: all.filter(mine).length, all: all.length };
  }
  /** Take the checklist's order afresh: when the page is opened, or the crops it lists change. */
  function reset() { ui.order = []; ui.unit = null; }
  function settle(eng, plan, scope, list) {
    const made = arrange(eng, plan, scope, list), year = study(eng).year;
    if (!ui.order.length || ui.scope !== scope || ui.year !== year) { ui.order = made.order; ui.first = made.first; ui.scope = scope; ui.year = year; }
    else {
      // a crop added since stands at the end; one that is gone is dropped; the rest keep their places
      const now = new Set(made.order);
      ui.order = ui.order.filter(id => now.has(id)).concat(made.order.filter(id => !ui.order.includes(id)));
    }
    if (!ui.order.includes(ui.cur)) ui.cur = ui.order.find(id => made.first.has(id) && ui.first.has(id)) || ui.order.find(id => eng.harvestFor(id).looked !== year) || ui.order[0] || null;
    return made;
  }
  const visible = (eng, q) => ui.order.filter(id => { const c = eng.crop(id); return c && (!q || id === ui.cur || String(c.name).toLowerCase().includes(q)); });
  /** The crop "Looks right" goes on to: the next one down that is not yet looked at, then the first such above. */
  function nextAfter(eng, q, id) {
    const list = visible(eng, q), at = list.indexOf(id), open = x => x !== id && eng.harvestFor(x).looked !== ui.year;
    return list.slice(at + 1).find(open) || list.slice(0, Math.max(0, at)).find(open) || null;
  }

  // ───────────────────────── a box ─────────────────────────
  /**
   * One number. `mine` is the grower's, `fallback` what the plan uses without one (shown grey). `amber`: nothing is set and
   * only he can set it, so the box is empty and says so by its colour. Clearing a box goes back to the fallback.
   */
  function box({ key, mine, fallback, amber, min = 0, max, whole, label, tip, save, wide }) {
    const shown = mine != null ? fig(mine) : '';
    const input = h('input', { type: 'number', min, max, step: whole ? 1 : 'any', value: shown, placeholder: amber || fallback == null ? '' : typeof fallback === 'string' ? fallback : fig(fallback), title: tip, 'aria-label': label, dataset: { yk: key } });
    input.commit = () => {
      if (input.sent) return input.sent;
      const raw = input.value.trim(), n = raw === '' ? null : whole ? Math.round(+raw) : +raw;
      if ((input.validity && input.validity.badInput) || (n != null && (!Number.isFinite(n) || n < min || (max != null && n > max)))) { input.value = shown; return Promise.resolve(false); }
      if ((n == null && mine == null) || (n != null && mine != null && Math.abs(n - mine) < 1e-9)) { input.value = shown; return Promise.resolve(true); }
      input.sent = Promise.resolve(save(n)).then(done => { if (!done) { input.sent = null; ui.redraw(); } return !!done; });
      return input.sent;
    };
    input.addEventListener('change', () => { input.commit(); });
    return h('span.yc-box' + (wide ? '.wide' : '') + (mine != null ? '.mine' : amber ? '.amber' : ''), input);
  }
  const blank = el => el.tagName === 'INPUT' && el.value === '' && !!el.closest('.yc-box.amber');
  const stops = card => [...card.querySelectorAll('[data-yk]')];

  // ───────────────────────── the card ─────────────────────────
  function card(eng, plan, c, q) {
    const s = study(eng), x = s.crops.get(c.id) || NONE, hc = eng.harvestFor(c.id), year = s.year, unit = hc.unit.value, u = unitWord(unit), w = waits(eng, c, hc), cover = eng.isCoverCrop(c);
    const cols = placesOf(eng, c, hc, x), n = cols.list.length, per = PER[hc.basis], varieties = hc.micro ? [] : eng.varietiesOf(c.id);
    const next = nextAfter(eng, q, c.id), nextCrop = next && eng.crop(next), looked = hc.looked === year;
    const head = h('header.yc-head',
      root.LRFThumbs.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 34, cls: 'key' }),
      h('div', h('h3', { id: 'ycName' }, c.name),
        h('p.yc-where', { id: 'ycWhere' }, !x.n ? 'Not planted this season.' : `${plural(x.n, 'planting')}: ${[...x.places.entries()].sort((a, b) => Object.keys(PLACE).indexOf(a[0]) - Object.keys(PLACE).indexOf(b[0])).map(([env, at]) => `${PLACE[env]} ${num(at.n)}`).join(' · ')}`)),
      h('p.yc-state' + (looked ? '.done' : ''), { id: 'ycState' }, looked ? `Looked at for ${year}` : hc.looked ? `Last looked at for ${hc.looked}` : `Not looked at for ${year}`));
    const out = h('section.yc-card', { id: 'ycCard', dataset: { crop: c.id }, 'aria-label': `${c.name}: yield and price` }, head);
    const finish = (...rest) => { UI.add(out, rest, actions()); return out; };
    const actions = () => h('div.yc-actions',
      h('button.btn.primary', { type: 'button', id: 'ycNext', dataset: { next: next || '' }, title: `Ticks ${c.name} as looked at for ${year}${nextCrop ? `, and opens ${nextCrop.name}` : ''}. Enter does the same from any box.`, onclick: () => looksRight(eng, q) }, nextCrop ? `Looks right. Next: ${nextCrop.name}` : 'Looks right.'),
      looked ? h('button.link', { type: 'button', id: 'ycUntick', title: `${c.name} is no longer counted as looked at for ${year}.`, onclick: () => App.setLooked(c.id, false) }, 'Take the tick off') : null,
      h('p.yc-key', h('i.amber'), 'only you can fill', h('i.mine'), 'yours', h('i'), 'what the plan uses now'));
    if (cover) return finish(h('p.yc-plain', { id: 'ycPlain' }, 'A cover crop: nothing is picked from it and nothing is sold, so there is no figure to set here.'));

    // ── what the house keeps: only for a crop that is partly kept, and never on a farm that sells everything ──
    let house = null;
    if (hc.house.part) {
      const keeps = 100 - hc.house.sold, typed = hc.share.mine != null && hc.share.mine < 100 ? 100 - hc.share.mine : null, empty = hc.house.sold >= 100;
      house = h('div.yc-house', { id: 'ycHouse' },
        h('p.yc-houseline', 'The house keeps ',
          box({ key: 'house', mine: typed, fallback: empty ? null : keeps, amber: empty, max: 100, label: `${c.name}: what the house keeps, percent of what is packed`,
            tip: empty ? 'Nothing is set: all that is packed counts as sold. Type the part the house keeps.' : `${fig(hc.house.sold)}% of what is packed counts as sold. ${typed != null ? 'Yours. Clear it to go back to the crop’s record.' : 'From the crop’s record.'}`,
            save: k => App.setSell(c.id, { share: k == null ? null : 100 - k }, k == null ? `${c.name}: sold share back to ${hc.share.fallback}%` : `${c.name}: ${fig(100 - k)}% sold`) }),
          ' % of what is packed'),
        h('p.yc-why', { id: 'ycHouseWhy' }, hc.house.marked ? `Shown because ${c.name} is marked as grown for sale and the house, on its record under Seeds.` : `Shown because ${fig(hc.house.sold)}% of ${c.name} counts as sold today, so the house is taken to keep the rest.`,
          ' ', h('button.link', { type: 'button', id: 'ycSoldAll', title: 'Counts all that is packed as sold. What that does to the season’s worth is shown first.', onclick: () => App.setHouse(c.id, false) }, 'Sold in full…')));
    }

    // ── the grid ──
    const span = (...kids) => h('td.yc-all', { colSpan: n }, kids);
    const row = (id, label, hint, cells) => h('tr', { dataset: { row: id } }, h('th', { scope: 'row' }, h('b', label), hint ? h('small', hint) : null), cells);
    const why = text => h('span.yc-na', text);
    const grid = h('table.yc-grid', { id: 'ycGrid' },
      h('thead', h('tr', h('th'), cols.list.map(env => { const at = x.places.get(env); return h('th', { scope: 'col', dataset: { place: env } }, PLACE[env], h('small', at ? plural(at.n, 'planting') : cols.planted ? 'nothing planted there now' : 'not planted yet')); }))));
    const body = h('tbody');
    grid.append(body);

    // sold by, and for how much: one unit and one price for the crop, wherever it grows
    const ownUnit = varieties.filter(v => eng.sellVRule(v.id).unit).length, ownPrice = varieties.filter(v => eng.sellVRule(v.id).price != null).length;
    const also = (k, what) => k ? h('small.yc-note', `${plural(k, 'variety', 'varieties')} ${k === 1 ? 'has' : 'have'} ${what} of ${k === 1 ? 'its' : 'their'} own, on “All on one page”.`) : null;
    if (hc.micro) body.append(row('unit', 'Sold by', null, span(why('the tray: a live tray is counted and sold by the tray'))));
    else body.append(row('unit', 'Sold by', n > 1 ? 'one unit for the crop, wherever it grows' : null, span(
      h('select.yc-sel' + (hc.unit.mine ? '.mine' : ''), { 'aria-label': `${c.name}: sold by`, dataset: { yk: 'unit' }, title: hc.unit.mine ? `Your choice. The crop’s record says ${hc.unit.fallback}. A letter picks the unit it begins.` : 'From the crop’s record. Choose another to change it; a letter picks the unit it begins.',
        onchange: e => setUnit(c, hc, e.target.value) },
        [...new Set([...UNITS, hc.unit.fallback, unit].filter(Boolean))].map(v => h('option', { value: v, selected: v === unit }, v)), hc.unit.mine ? h('option', { value: '(default)' }, `Back to ${hc.unit.fallback}`) : null),
      ui.unit && ui.unit.id === c.id && ui.unit.from !== unit ? h('small.yc-note.warn', { id: 'ycUnitNote' }, `Changed from ${ui.unit.from} to ${unit}. No figure was turned into the new unit: check the price and each yield.`) : null,
      also(ownUnit, 'a unit'))));
    body.append(row('price', 'Price', `for one ${unit === 'each' ? 'of them' : unit}`, span('$ ',
      box({ key: 'price', mine: hc.price.mine, fallback: hc.price.fallback, amber: w.price, label: `${c.name}: price`,
        tip: hc.price.mine != null ? `Your price for one ${unit === 'each' ? 'of them' : unit}. Clear it to go back to ${fig(hc.price.fallback)}.` : w.price ? 'No price is set, so this crop adds nothing to what the season is worth.' : `From the crop’s record: $${fig(hc.price.fallback)} for one ${unit === 'each' ? 'of them' : unit}.`,
        save: k => App.setSell(c.id, { price: k }, k == null ? `${c.name}: price back to $${fig(hc.price.fallback)}` : `${c.name}: $${fig(k)}${each(unit)}`) }),
      h('span.yc-unit', each(unit).trim()), also(ownPrice, 'a price'))));

    // what it gives: a box for each place, in the crop's own way of being picked
    if (hc.micro) body.append(row('yield', 'Gives, packed', null, span(why('a tray is a tray'))));
    else {
      const pattern = hc.pattern.value, weekly = hc.weekly;
      const tenths = pattern === 'once' && hc.basis === 'plant' && COUNTED.includes(unit) && cols.list.every(env => hc.cells[env].value == null || hc.cells[env].value <= 1);
      const label = tenths ? 'Of every 10 planted, fit to sell' : `Gives, packed, ${per}${weekly ? ' a week' : ''}`;
      const hint = tenths ? 'cut once: the ten that go in, less the ones that do not make it' : weekly ? 'what is picked each week, for as many weeks as it is picked' : pattern === 'once' ? 'in all, taken the day it is cleared' : 'in all, over its harvest days';
      body.append(row('yield', label, hint, cols.list.map(env => {
        const cell = hc.cells[env], at = x.places.get(env), k = tenths ? 10 : 1, where = `${c.name}, ${PLACE[env].toLowerCase()}`;
        const what = `${weekly ? 'picked each week from' : 'in all from'} ${per}`, back = cell.fallback == null ? 'no yield at all' : fig(cell.fallback);
        const mine = cell.mine == null ? null : cell.mine * k, fallback = cell.fallback == null ? null : cell.fallback * k;
        const input = box({ key: `y|${env}`, mine, fallback, amber: w.yield, max: tenths ? 10 : undefined, label: `${where}: ${tenths ? 'of every 10 planted, fit to sell' : `yield, ${per}${weekly ? ' a week' : ''}`}`,
          tip: cell.mine != null ? `Your figure: ${fig(cell.mine)}${u} ${what}. Clear it to go back to ${back}.` : cell.fallback == null ? 'No yield is set for this crop.' : `${w.yield ? 'A starting value nobody has checked' : 'From the crop’s record, not yet checked'}: ${fig(cell.fallback)}${u} ${what}.`,
          save: v => { const y = v == null ? null : v / k; return App.setYield('crops', c.id, env, y, y == null ? `${where}: yield back to ${back}` : `${where}: ${fig(y)}${u} ${weekly ? 'a week' : 'in all'}`); } });
        // one meaning for the box, and beside a week's picking the season's total it comes to: the engine's own figure for the
        // plantings there that follow this line (they differ where one is picked for more days than another)
        let beside = null;
        if (cell.value == null) beside = h('small.yc-total.warn', 'nothing is forecast until this is typed');
        else if (w.yield) beside = h('small.yc-total.warn', `the plan counts ${fig(cell.value)}${u} meanwhile: a starting value nobody has checked`);
        else if (weekly) {
          const list = at && at.per.length ? at.per : [cell.total], lo = Math.min(...list), hi = Math.max(...list), range = fig(lo) === fig(hi) ? fig(lo) : `${fig(lo)} to ${fig(hi)}`;
          beside = h('small.yc-total', { dataset: { lo: String(lo), hi: String(hi), by: at && at.per.length ? 'plantings' : 'line' }, title: at && at.per.length ? `${fig(cell.value)}${u} a week, for the weeks each planting there is picked.${fig(lo) === fig(hi) ? '' : ' The plantings differ in how long they are picked.'}` : `${fig(cell.value)}${u} a week over ${hc.nominal} harvest days.` },
            `comes to ${range}${u} ${per} over the season`);
        } else if (pattern === 'spread' && !tenths) beside = h('small.yc-total', { title: `${fig(cell.total)}${u} over ${hc.nominal} harvest days` }, `about ${fig(cell.weekly)}${u} a week over ${hc.nominal} days`);
        else if (tenths) beside = h('small.yc-total', `${fig(cell.value)}${u} from each plant`);
        return h('td', { dataset: { place: env } }, h('span.yc-line', input, h('span.yc-unit', tenths ? 'of 10' : unit === 'each' ? '' : unit)), beside);
      })));
    }

    // first picking: the crop's DTM for the place, shown and not changed here
    body.append(row('first', 'First picking', h('span', 'its DTM, changed on ', h('button.link', { type: 'button', id: 'ycToDays', title: 'DTM: days to maturity. They are set on the other half of this list, for each place.', onclick: () => root.LRFAssume.setMode('days') }, 'Days to harvest')), cols.list.map(env => {
      if (hc.micro) return h('td', { dataset: { place: env } }, why('set on the tray plan, under Nursery'));
      const t = eng.timingFor(c.id, null, env);
      if (!t || t.value == null) return h('td', { dataset: { place: env } }, why('no days are set for this place'));
      return h('td', { dataset: { place: env } }, h('span.yc-line', h('b.yc-fixed', { dataset: { dtm: String(t.value) } }, String(t.value)), h('span.yc-unit', `days after ${t.fixed ? FIXED[t.fixed] : FROM[t.start]}`), h('span.yc-mark', { title: 'DTM: days to maturity. The figure the Days to harvest list holds for this crop in this place.' }, 'DTM')));
    })));

    // how it is picked, and for how long
    if (hc.micro) body.append(row('pick', 'Picked', null, span(why('when due: a live tray is counted whole on the Monday it is due'))));
    else body.append(row('pick', 'Picked', null, span(
      h('select.yc-sel' + (hc.pattern.mine ? '.mine' : ''), { 'aria-label': `${c.name}: picked`, dataset: { yk: 'pick' }, title: `${PATTERN_TIP[hc.pattern.value]}${hc.pattern.mine ? '' : ' Not set: this is how every crop has been counted so far.'}`,
        onchange: async e => { const value = e.target.value; if (!await App.setSell(c.id, { pattern: value === 'unset' ? null : value }, `${c.name}: ${value === 'unset' ? 'picked as before' : PATTERN_SAY[value]}`)) ui.redraw(); } },
        Object.entries(PATTERN).map(([value, text]) => h('option', { value, selected: hc.pattern.value === value }, text)), hc.pattern.mine ? h('option', { value: 'unset' }, 'Back to not set') : null),
      ' for ',
      box({ key: 'days', mine: hc.days.mine, fallback: hc.season ? 'season' : hc.days.fallback, whole: true, min: 1, max: 400, wide: true, label: `${c.name}: harvest days`,
        tip: hc.days.mine != null ? `Your number: picked for ${hc.days.mine} days. Clear it to go back to ${hc.season ? 'the end of the season' : hc.days.fallback + ' days'}.` : hc.season ? `Picked until the season ends where it grows. A yield is spoken of over ${hc.nominal} days. Type a number to pick it for that many days instead.` : `From the crop’s record: picked for ${hc.days.fallback} days.`,
        save: k => App.setSell(c.id, { days: k }, k == null ? `${c.name}: harvest days as before` : `${c.name}: picked for ${k} days`) }),
      h('span.yc-unit', 'harvest days'),
      h('small.yc-note', PATTERN_TIP[hc.pattern.value]))));

    // last picking: what the two rows above come to. Not a box of its own yet.
    body.append(row('last', 'Last picking', null, cols.list.map(env => h('td', { dataset: { place: env } },
      hc.micro ? why('none: a tray is taken whole') : hc.pattern.value === 'once' ? why('none: cleared in one day') : hc.season && hc.days.mine == null ? why('when the season ends there') : h('span.yc-line', h('b.yc-fixed', String(hc.days.value)), h('span.yc-unit', 'days after the first'))))));

    // ── under the grid: what it comes to, and what it waits on ──
    const comes = [], units = [...x.units.values()].filter(k => k.total > 0);
    if (units.length) {
      for (const k of units) comes.push(h('p', { dataset: { unit: k.unit, total: String(k.total), worth: String(k.worth) } }, h('b', F.amount(k.total, k.unit, k.group)), ` to sell in ${year}, worth `, h('b', money(k.worth)), '.'));
      const split = Object.keys(PLACE).filter(env => x.places.has(env) && x.places.get(env).total > 0).map(env => [env, x.places.get(env)]);
      if (split.length > 1 && units.length === 1) comes.push(h('p.yc-split', split.map(([env, at]) => `${PLACE[env]} ${F.amount(at.total, units[0].unit, units[0].group)}`).join(' · ')));
      comes.push(h('p.yc-fine', hc.house.part && hc.house.sold >= 100 ? 'That is the worth of what is packed for sale: all of it counts as sold until the house’s part is typed above.' : hc.house.part ? `That is what is packed for sale: the house’s ${fig(100 - hc.house.sold)}% is already taken off.` : hc.micro ? 'A tray sown is a tray to sell.' : 'That is the worth of what is packed for sale: all of it counts as sold.',
        x.personal ? ` ${plural(x.personal, 'planting')} marked for personal use ${x.personal === 1 ? 'is' : 'are'} picked and not counted as revenue.` : ''));
    } else comes.push(h('p', !x.n ? `Nothing: ${c.name} is not planted in ${year}.` : `Nothing is forecast for ${year} yet.`));
    const need = [];
    if (w.price) need.push('A price. Until there is one, this crop adds nothing to what the season is worth.');
    if (w.yield) need.push(eng.ENVS.every(env => hc.cells[env].value == null) ? 'A yield. Until there is one, nothing is forecast for this crop.' : 'A yield of your own. The plan counts a starting value nobody has checked.');
    if (hc.house.part && hc.house.sold >= 100) need.push('What the house keeps. The crop is marked as partly kept, and no part is set.');
    if (x.own) need.push(`${plural(x.own, 'planting')} ${x.own === 1 ? 'carries a yield of its own and does' : 'carry a yield of their own and do'} not follow these boxes. “See what differs…” lets them.`);
    const ownYield = varieties.filter(v => eng.ENVS.some(env => eng.harvestFor(c.id, v.id).cells[env].mine != null)).length;
    if (ownYield) need.push(`${plural(ownYield, 'variety', 'varieties')} ${ownYield === 1 ? 'has' : 'have'} a yield of ${ownYield === 1 ? 'its' : 'their'} own, on “All on one page”.`);
    if (s.waiting.get(c.id)) need.push(`${plural(s.waiting.get(c.id), 'planting')} ${s.waiting.get(c.id) === 1 ? 'waits' : 'wait'} under To place, and ${s.waiting.get(c.id) === 1 ? 'is' : 'are'} not counted until ${s.waiting.get(c.id) === 1 ? 'it has' : 'they have'} a bed.`);
    const facts = h('div.yc-facts', { id: 'ycFacts' },
      h('div', { id: 'ycComes' }, h('h4', 'What it comes to'), comes),
      h('div', { id: 'ycWaits' }, h('h4', 'What it waits on'), need.length ? h('ul', need.map(text => h('li', text))) : h('p', 'Nothing: every figure it needs is set.')));
    return finish(house, grid, facts);
  }

  // ───────────────────────── what a press does ─────────────────────────
  /** Change the unit through the list's own call. No yield and no price is turned into the new unit, and the card says so. */
  async function setUnit(c, hc, value) {
    const was = hc.unit.value, to = value === '(default)' ? hc.unit.fallback : value;
    if (to === was) return false;
    if (!ui.unit || ui.unit.id !== c.id) ui.unit = { id: c.id, from: was };
    const done = await App.setSell(c.id, { unit: value === '(default)' || value === hc.unit.fallback ? null : value }, `${c.name}: sold by the ${to}`);
    if (!done) ui.redraw();
    return done;
  }
  /** A letter picks the unit that begins with it; pressed again, the next one that does. */
  function unitByLetter(eng, c, letter) {
    const hc = eng.harvestFor(c.id);
    if (hc.micro) return false;
    const all = [...new Set([...UNITS, hc.unit.fallback, hc.unit.value].filter(Boolean))], fit = all.filter(x => x.toLowerCase().startsWith(letter.toLowerCase()));
    if (!fit.length) return false;
    const to = fit[(fit.indexOf(hc.unit.value) + 1) % fit.length];
    if (to !== hc.unit.value) setUnit(c, hc, to);
    return true;
  }
  /** Tick the crop on the card and open the next one, with the pointer for typing in its first empty box. */
  function looksRight(eng, q) {
    const id = ui.cur, c = eng.crop(id);
    if (!c) return;
    const next = nextAfter(eng, q, id);
    ui.focus = next ? { blank: true } : { key: 'next' };
    if (next) { ui.cur = next; ui.unit = null; }
    const ticked = eng.harvestFor(id).looked === ui.year || App.setLooked(id, true);   // a tick redraws the page by itself
    if (!ticked || eng.harvestFor(id).looked === ui.year) ui.redraw();
    if (!next) UI.toast(`Every crop ${q ? 'that matches ' : ''}is looked at for ${ui.year}.`);
  }
  function open(id, focus) {
    if (!id) return;
    if (id !== ui.cur) ui.unit = null;
    ui.cur = id; ui.focus = focus ? { blank: true } : null;
    ui.redraw();
  }
  async function onKey(e, eng, q) {
    const t = e.target, c = eng.crop(ui.cur);
    if (!c || !t || !t.dataset || e.ctrlKey || e.metaKey || e.altKey) return;
    const isBox = t.tagName === 'INPUT' && !!t.dataset.yk, isSel = t.tagName === 'SELECT' && !!t.dataset.yk;
    if (!isBox && !isSel) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter is "Looks right. Next: …": what is in the box is taken first, and if it is not, nothing is ticked
      e.preventDefault();
      if (isBox && !await t.commit()) return;
      looksRight(App.state.engine, q);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Tab goes to the next box that is still empty; with none left on the card, it goes on as Tab always does
      const all = stops(t.closest('.yc-card')), at = all.indexOf(t), to = all.slice(at + 1).find(blank);
      if (!to) return;
      e.preventDefault();
      ui.focus = { key: to.dataset.yk };
      if (isBox) { if (!await t.commit()) { ui.focus = null; return; } }
      const now = document.querySelector(`#ycCard [data-yk="${CSS.escape(ui.focus ? ui.focus.key : to.dataset.yk)}"]`);
      if (now && ui.focus) { ui.focus = null; now.focus(); }
    } else if (/^[a-z]$/i.test(e.key) && (isBox || t.dataset.yk === 'unit')) {
      e.preventDefault();
      if (isBox && t.value.trim() !== '' && !await t.commit()) return;
      unitByLetter(App.state.engine, c, e.key);
    }
  }

  // ───────────────────────── drawing ─────────────────────────
  /** ctx: { eng, plan, q, list, scope, redraw }. Returns what the page's own header needs: how many crops each scope holds. */
  function render(ctx) {
    const { eng, plan, q, list, scope } = ctx, host = $('ycHost');
    ui.redraw = ctx.redraw;
    const made = settle(eng, plan, scope, list), year = ui.year, s = study(eng);
    const active = document.activeElement, key = active && host.contains(active) && active.dataset ? active.dataset.yk || (active.id === 'ycNext' ? 'next' : null) : null;
    const shown = visible(eng, q), lookedN = ui.order.filter(id => eng.harvestFor(id).looked === year).length, left = ui.order.filter(id => waits(eng, eng.crop(id), eng.harvestFor(id)).any).length;
    const item = id => {
      const c = eng.crop(id), hc = eng.harvestFor(id), x = s.crops.get(id) || NONE, w = waits(eng, c, hc), done = hc.looked === year;
      const say = w.price && w.yield ? 'no price · no yield' : w.price ? 'no price' : w.yield ? (eng.ENVS.every(env => hc.cells[env].value == null) ? 'no yield' : 'yield not checked') : x.worth >= 0.5 ? money(x.worth) : '';
      return h('li', h('button.yc-item' + (done ? '.done' : '') + (w.any ? '.open' : ''), { type: 'button', dataset: { crop: id }, 'aria-current': id === ui.cur ? 'true' : null, title: `${c.name}${done ? `: looked at for ${year}` : ''}`, onclick: () => open(id, true) },
        h('i.yc-tick', { 'aria-hidden': 'true' }, done ? '✓' : ''), root.LRFThumbs.el({ cropId: id, color: eng.cropColor(c), label: c.name, size: 20, cls: 'key' }), h('b', c.name), h('small' + (w.any ? '.warn' : ''), say)));
    };
    const firstNow = shown.filter(id => ui.first.has(id)), restNow = shown.filter(id => !ui.first.has(id));
    // the sold shares typed by the grower, listed where they can be seen together: they stand as typed
    const typed = plan.settings.houseKeeps === false ? [] : ui.order.filter(id => { const hc = eng.harvestFor(id); return !hc.micro && hc.share.mine != null; });
    const side = h('aside.yc-side', { 'aria-label': 'Every crop, as a checklist' },
      h('div.yc-prog', { id: 'ycProg', dataset: { looked: String(lookedN), of: String(ui.order.length) } }, h('p', h('b', `${num(lookedN)} of ${num(ui.order.length)}`), ` looked at for ${year}`),
        h('div.yc-meter', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': ui.order.length, 'aria-valuenow': lookedN, 'aria-label': `Crops looked at for ${year}` }, h('i', { style: { width: `${ui.order.length ? Math.round(lookedN / ui.order.length * 1000) / 10 : 0}%` } }))),
      h('p.yc-left' + (left ? '.warn' : ''), { id: 'ycLeft', dataset: { left: String(left) } }, left ? `${plural(left, 'crop')} left to set: no price or no yield` : 'Every crop has a price and a yield.'),
      h('ol.yc-list', { id: 'ycList' },
        firstNow.length ? h('li.yc-sec', firstNow.some(id => waits(eng, eng.crop(id), eng.harvestFor(id)).any) ? 'No price or no yield' : 'Had no price or no yield') : null, firstNow.map(item),
        restNow.length ? h('li.yc-sec', 'The rest, biggest first') : null, restNow.map(item),
        !shown.length ? h('li.yc-sec', q ? 'No crop matches.' : 'No crops yet.') : null),
      typed.length ? h('p.yc-typed', { id: 'ycTyped' }, 'Sold shares you typed: ', typed.map((id, i) => [i ? ' · ' : '', h('button.link', { type: 'button', dataset: { crop: id }, title: 'Open this crop’s card', onclick: () => open(id) }, `${eng.crop(id).name} ${fig(eng.harvestFor(id).share.mine)}%`)])) : null);
    const c = eng.crop(ui.cur), main = c ? card(eng, plan, c, q) : h('section.yc-card', { id: 'ycCard' }, h('p.yc-plain', 'No crops yet.'));
    main.addEventListener('keydown', e => { onKey(e, App.state.engine, q); });
    const keepScroll = host.querySelector('.yc-list') ? host.querySelector('.yc-list').scrollTop : 0;
    clear(host).append(side, main);
    const listEl = host.querySelector('.yc-list'), cur = listEl.querySelector('[aria-current="true"]');
    listEl.scrollTop = keepScroll;
    if (cur) { const a = cur.offsetTop - listEl.offsetTop, z = a + cur.offsetHeight; if (a < listEl.scrollTop) listEl.scrollTop = Math.max(0, a - 34); else if (z > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = z - listEl.clientHeight + 8; }
    // where the pointer for typing goes: where it was asked to, or back where it was
    const want = ui.focus || (key ? { key } : null);
    ui.focus = null;
    if (want) {
      const all = stops(main), to = want.blank ? all.find(blank) || main.querySelector('[data-yk="price"]') || $('ycNext') : want.key === 'next' ? $('ycNext') : main.querySelector(`[data-yk="${CSS.escape(want.key)}"]`);
      if (to) { to.focus({ preventScroll: !want.blank }); if (to.select && to.tagName === 'INPUT') to.select(); }
    }
    return { mine: made.mine, all: made.all, left };
  }

  root.LRFYieldCard = { render, reset, open, current: () => ui.cur, order: () => ui.order.slice(), state: ui };
})(window);
