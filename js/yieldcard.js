/* Little River Farm Planner — yield and price, one crop at a time.
 *
 * The other way to see the second half of the Assumptions list. The list has every crop on one page; this shows one crop,
 * with a box for each figure and the box's meaning written beside it:
 *
 *   down the left   every crop as a checklist: those with no price, or a yield not yet checked, first; then the rest, biggest
 *                   first. A crop is ticked when "Looks right. Next: …" is pressed, and a bar says how many are looked at.
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
 * The keyboard: Tab goes to the next box that is still empty and only the grower can fill. Enter takes what is in the box and
 * goes to the next such box; with none left it is "Looks right. Next: …" and lands in the next crop's first empty box. A
 * letter picks a unit only while "Sold by" itself is in focus: in a number box a letter does nothing.
 *
 * The harvest window is one joined choice, here and on the list: picked to the season's end, or for a set number of days. It
 * stores nothing of its own: "for N days" is the list's harvest days (App.setSell, `days`), and "to the season's end" clears them
 * and, where the crop's own record is picked for a set number of days, sets that record's `harvestMode` in the same step. What a
 * change moves (each place's last picking, the season's worth, any ground it would book twice) is shown before it is taken.
 *
 * Two things are said where they happen and kept in sight until the crop is ticked again, for as long as the page is open:
 * that a unit was changed (no figure is turned into another unit, so each is to be read again), and what a yield read
 * before "Picked" turned it into a week's figure or back.
 *
 * Drawn by js/assume.js, which owns the page, its search box and "My crops / All crops".
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, F = root.LRFForecast;
  const { h, clear, num } = UI;
  const $ = id => document.getElementById(id);
  const PLACE = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers', tray: 'Living trays' };
  const IN = { field: 'in the field', tunnel: 'in the unheated tunnel', heated: 'in the heated greenhouse', tower: 'in the towers' };
  const FROM = { transplant: 'transplanting', seed: 'seeding in trays', direct: 'direct seeding' }, FIXED = { sown: 'direct seeding', planted: 'planting', tray: 'seeding in trays' };
  const UNITS = ['each', 'bunch', 'lb', 'pint', 'quart', 'clamshell', 'head', 'stem'];
  const PATTERN = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };
  const PATTERN_SAY = { weekly: 'picked gradually', once: 'cleared at once', spread: 'picked on demand' };
  const PATTERN_TIP = { spread: 'On demand: the yield is a total, held and spread evenly over the harvest window.', weekly: 'Gradually: the yield is a week’s picking, every week of the harvest window.', once: 'Clear: the yield is a total, all of it counted the day the crop is ready.' };
  const PER = { plant: 'a plant', ft: 'a bed-foot', tray: 'a tray' }, PER_SAY = { plant: 'per plant', ft: 'per bed-foot', tray: 'per tray' };
  const COUNTED = ['each', 'head'];
  const fig = n => root.LRFAssume.fig(n);
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  const unitWord = unit => unit === 'each' ? '' : ' ' + unit;
  const each = unit => unit === 'each' ? ' each' : ' a ' + unit;
  const soldBy = unit => unit === 'each' ? 'sold each' : `sold by the ${unit}`;
  const worthSaid = (was, now) => Math.abs(now - was) >= 0.5 ? `the season’s worth goes from ${money(was)} to ${money(now)}` : `the season’s worth stays ${money(now)}`;

  // cur: the crop on the card. order: the checklist as it stood when the page was opened (it does not jump about while figures
  // are typed). first: the crops that waited on a price or a yield then. focus: where the pointer for typing goes after the
  // next drawing ({ key } a box, { blank: true } the first empty box). units: crop → { from }, a unit changed since the crop
  // was last ticked. turned: crop → what its yields read before "Picked" turned them. Both last while the page is open.
  const ui = { cur: null, order: [], first: new Set(), scope: null, year: null, focus: null, column: null, units: new Map(), turned: new Map(), redraw: () => {} };

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
    let total = 0;
    for (const line of model.rows) {
      const x = row(line.cropId);
      x.worth += line.worth; x.personal += line.plantings.filter(q => q.personal).length; total += line.worth;
      const u = x.units.get(line.key) || { unit: line.unit, group: line.group, total: 0, worth: 0, thing: line.thing || '', sold: line.sold || '' };
      u.total += line.total; u.worth += line.worth; x.units.set(line.key, u);
      for (const q of line.plantings) { const env = envOf(q.p); if (!env) continue; const at = place(x, env); at.total += q.inYear; at.worth += q.inYear * q.price; }
    }
    const waiting = new Map();
    for (const w of App.waiting()) waiting.set(w.cropId, (waiting.get(w.cropId) || 0) + 1);
    const out = { crops, waiting, year: model.year, worth: total };
    cache.set(eng, out);
    return out;
  }
  const NONE = { n: 0, places: new Map(), worth: 0, units: new Map(), personal: 0, own: 0 };
  const of = (eng, id) => study(eng).crops.get(id) || NONE;
  /** The places whose plantings are sold as another thing, and no longer as the crop's own line (js/things.js). */
  const taken = (eng, id) => new Set(eng.thingsOf(id).filter(t => t.counts && t.from === 'place').map(t => t.place));
  /**
   * What only the grower can set and has not: a price, and a yield for each place the crop is planted in. A yield is asked
   * place by place, so a figure typed for the field leaves the greenhouse's still asked for. A crop planted nowhere is asked
   * for one yield, in any place.
   */
  function waits(eng, c, hc) {
    if (eng.isCoverCrop(c)) return { price: false, yield: false, any: false, places: [], things: 0 };
    const x = of(eng, c.id), price = hc.open.price && hc.price.mine == null, away = taken(eng, c.id), planted = hc.micro ? [] : eng.ENVS.filter(env => x.places.has(env) && !away.has(env));
    const places = !hc.open.yield || hc.micro ? [] : planted.length ? planted.filter(env => hc.cells[env].mine == null)
      : eng.ENVS.every(env => hc.cells[env].mine == null) ? eng.ENVS.filter(env => hc.cells[env].used) : [];
    // another thing the crop sells that still waits on a box of its own: the crop is not set until it counts, or is taken away
    const things = hc.micro ? 0 : eng.thingsOf(c.id).filter(t => !t.counts).length;
    return { price, yield: places.length > 0, places, things, any: price || places.length > 0 || things > 0 };
  }
  /** The boxes of a crop's card that are amber and empty, in the order they stand on it, each with words for it. */
  function empties(eng, c) {
    const hc = eng.harvestFor(c.id), w = waits(eng, c, hc), out = [];
    if (eng.isCoverCrop(c)) return out;
    if (hc.house.part && hc.house.sold >= 100) out.push({ key: 'house', say: 'what is kept for personal use' });
    if (w.price) out.push({ key: 'price', say: 'the price' });
    for (const env of w.places) out.push({ key: `y|${env}`, say: `the yield ${IN[env]}` });
    for (const e of root.LRFThings.of({ eng, c, hc, x: of(eng, c.id), box }).empties()) out.push(e);
    return out;
  }
  /** The columns of a crop's grid: the places it is planted in; with nothing planted, every place the farm has. */
  function placesOf(eng, c, hc, x) {
    if (hc.micro) return { list: ['tray'], planted: x.n > 0 };
    const planted = eng.ENVS.filter(env => x.places.has(env));
    // a place with a figure or a last picking of his own keeps its column, planted there or not, so what he set can be seen and cleared
    const his = env => hc.cells[env].mine != null || !!(hc.until || {})[env];
    if (planted.length) return { list: eng.ENVS.filter(env => x.places.has(env) || his(env)), planted: true };
    return { list: eng.ENVS.filter(env => hc.cells[env].used || !!(hc.until || {})[env]), planted: false };
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
  function reset() { ui.order = []; }
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
      // a window that asks takes the pointer for typing, the box is left, and leaving it says “changed” once more: taken once
      if (input.busy) return Promise.resolve(true);
      input.busy = true;
      input.sent = Promise.resolve(save(n)).then(done => { if (!done) { input.sent = null; ui.redraw(); } return !!done; });
      return input.sent;
    };
    input.addEventListener('change', () => { input.commit(); });
    return h('span.yc-box' + (wide ? '.wide' : '') + (mine != null ? '.mine' : amber ? '.amber' : ''), input);
  }
  const blank = el => el.tagName === 'INPUT' && el.value === '' && !!el.closest('.yc-box.amber');
  /** The thing whose column a box stands in; null for a box of the crop's own. */
  const column = el => { const m = /^t\|([^|]+)\|/.exec((el && el.dataset && el.dataset.yk) || ''); return m ? m[1] : null; };
  /**
   * The boxes of a card in the order Tab walks them. From a box in a thing's column, that column's own boxes come first (those
   * under it, then those above), so that a thing is filled before the pointer goes anywhere else; then every other box.
   */
  const stops = (card, from) => {
    const all = [...card.querySelectorAll('[data-yk]')], col = column(from);
    if (!col) return all;
    const own = all.filter(el => column(el) === col), at = own.indexOf(from);
    return [from, ...own.slice(at + 1), ...own.slice(0, at), ...all.filter(el => column(el) !== col)];
  };
  /** Words on the card that name something kept on the list: a press opens "All on one page" at this crop's row. */
  const toList = (c, text, varieties) => h('button.link', { type: 'button', dataset: { tolist: c.id }, title: `Opens “All on one page” at ${c.name}’s row.`, onclick: () => root.LRFAssume.setMode('harvest', 'list', c.id, { varieties: !!varieties }) }, text);

  // ───────────────────────── the harvest window: to the season's end, or for a set number of days ─────────────────────────
  const owns = o => !!o && (o.harvestMode === 'season' || o.harvestMode === 'window' || (o.hw != null && o.hw !== '' && Number.isFinite(+o.hw) && +o.hw >= 0));
  /** Does a planting take its harvest window from the crop's line? Not when it, or its variety, carries one of its own, or a last day. */
  function follows(eng, p) {
    const v = eng.variety(p.varietyId), b = eng.bedOf(p.bedId);
    return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b);
  }
  const envOfP = (eng, p) => { const b = eng.bedOf(p.bedId); return b && !eng.isRack(b) ? eng.envOf(b) : null; };
  /** Which side of the choice the crop's line is on, and the number of days the other side would take. */
  function windowOf(eng, c, hc) {
    const season = hc.days.mine == null && hc.season, offer = Math.max(1, Math.round(+c.hw > 0 ? +c.hw : hc.nominal || 1));
    return { season, days: season ? null : hc.days.value, offer: season ? offer : hc.days.value };
  }
  /** Each place's last picking under the line as it stands: the dates of the plantings there that follow it and are picked at all, earliest and latest. */
  function endsOf(eng, c) {
    const out = new Map();
    for (const p of eng.plan.plantings || []) {
      if (p.cropId !== c.id || !follows(eng, p)) continue;
      const env = envOfP(eng, p), r = env ? eng.calc(p) : null;
      if (!r || !(r.harvestDays > 0) || !root.LRFEngine.validDate(r.last)) continue;   // ripe after its season's end: never picked, and not in the forecast
      const at = out.get(env) || { lo: r.last, hi: r.last, n: 0 };
      if (r.last < at.lo) at.lo = r.last;
      if (r.last > at.hi) at.hi = r.last;
      at.n++; out.set(env, at);
    }
    return out;
  }
  const iso = d => root.LRFEngine.d2s(d), between = (lo, hi) => +lo === +hi ? UI.day(lo) : `${UI.day(lo)} to ${UI.day(hi)}`;
  /** One side of a place's move in the sheet: its dates, and how many of its plantings are not picked at all. */
  const sideSaid = x => !x.lo ? 'not picked' : `${between(x.lo, x.hi)}${x.none ? ` (${num(x.none)} not picked)` : ''}`;
  /**
   * What a change of the choice would do, worked out on the plan with the step taken and nothing kept: each place's last picking
   * before and after, the plantings that keep their own, the season's worth, and the beds it would book twice that are not now.
   */
  function movesOf(eng, c, ops) {
    const next = App.engineAfter(ops), places = new Map(), pairs = e => { const set = new Map(); for (const p of e.plan.plantings) { const r = e.calc(p); if (r) for (const o of e.conflicts(p, r)) if (!o.rest) set.set([p.id, o.p.id].sort().join('|'), p.bedId); } return set; };
    let n = 0, own = 0;
    for (const p of eng.plan.plantings || []) {
      if (p.cropId !== c.id) continue;
      const env = envOfP(eng, p), a = env ? eng.calc(p) : null, q = next.planting(p.id), b = a && q ? next.calc(q) : null;
      if (!a || !b) continue;
      if (!follows(eng, p)) { own++; continue; }
      if (+a.last === +b.last || (!(a.harvestDays > 0) && !(b.harvestDays > 0))) continue;
      n++;
      // a side with no harvest day is "not picked", never a date: its last day is only the season's end before it is ripe
      const at = places.get(env) || { n: 0, was: { lo: null, hi: null, none: 0 }, now: { lo: null, hi: null, none: 0 } };
      at.n++;
      for (const [side, r] of [[at.was, a], [at.now, b]]) {
        if (!(r.harvestDays > 0)) { side.none++; continue; }
        if (!side.lo || r.last < side.lo) side.lo = r.last;
        if (!side.hi || r.last > side.hi) side.hi = r.last;
      }
      places.set(env, at);
    }
    const was = pairs(eng), then = pairs(next), beds = [...new Set([...then].filter(([k]) => !was.has(k)).map(([, bedId]) => bedId))].map(id => App.bedLabel(next.bedOf(id), next));
    const worth = [study(eng).worth, F.build(next).rows.reduce((t, r) => t + r.worth, 0)];
    return { n, own, places: eng.ENVS.filter(env => places.has(env)).map(env => ({ env, ...places.get(env) })), worth, beds, things: App.thingsAfter(c.id, ops) };
  }
  /**
   * Set the harvest window: `to` is 'season', a number of days, or null (back to the crop's own record). What it moves is shown
   * first, in a sheet, whenever it moves anything; then it is the list's own step, with one Undo.
   */
  async function setWindow(c, to, redraw = () => ui.redraw()) {
    const eng = App.state.engine, change = { days: to }, ops = App.sellOps(c.id, change);
    if (!ops) { redraw(); return false; }
    const label = to === 'season' ? `${c.name}: picked to the season’s end` : to == null ? `${c.name}: harvest days as before` : `${c.name}: picked for ${to} days`;
    if (!await askMoves(eng, c, ops, label, to === 'season' ? 'Pick to the season’s end' : to == null ? 'Go back' : `Pick for ${to} days`)) { redraw(); return false; }
    const done = await App.setSell(c.id, change, label, { told: true, shown: true });
    if (!done) redraw();
    return done;
  }
  /**
   * Set a place's last picking for a crop picked to the season's end: `md` a month and day ('10-31'), or null to go back to the
   * season's end there. What it moves is shown first, as for the choice above; then it is the list's own step, with one Undo.
   */
  async function setUntil(c, env, md, redraw = () => ui.redraw()) {
    const eng = App.state.engine, year = study(eng).year, change = { until: { [env]: md } }, ops = App.sellOps(c.id, change);
    if (!ops) { redraw(); return false; }
    const where = `${c.name}, ${PLACE[env].toLowerCase()}`, label = md ? `${where}: last picking ${UI.day(root.LRFEngine.s2d(`${year}-${md}`))}` : `${where}: picked to the season’s end`;
    if (!await askMoves(eng, c, ops, label, md ? 'End it then' : 'Go back')) { redraw(); return false; }
    const done = await App.setSell(c.id, change, label, { told: true, shown: true });
    if (!done) redraw();
    return done;
  }
  /** Where the season ends in a place with no date of his own, in words: whose day it is. */
  const ENDS_BY = { frost: 'your first frost', cover: 'the first frost, under cover', close: 'the garden closes', record: 'the crop’s record', year: 'the year’s end' };
  /**
   * A place's last picking, for a crop picked to the season's end: a date he can set, the day in force, whose it is, and where the
   * plantings there end if that is not one day. In open ground a date of his past the first frost is cut short by it, and says so.
   */
  function untilCell(eng, c, hc, env, year, at) {
    // a date of his is read as the engine reads it: Feb 29 is Feb 28 in a common year
    const se = eng.seasonEndOf(c.id, env, year), mine = hc.until[env] || null, own = mine ? root.LRFEngine.monthDayDate(year, mine) : null, inForce = own || (se && se.date);
    const where = `${c.name}, ${PLACE[env].toLowerCase()}`, whose = mine ? 'yours' : se ? ENDS_BY[se.by] : '';
    const input = h('input', { type: 'date', value: inForce ? iso(inForce) : '', min: `${year}-01-01`, max: `${year}-12-31`, 'aria-label': `${where}: last picking`, dataset: { yk: `until|${env}`, hook: 'harvest-until', place: env, mine: mine || '' },
      title: mine ? `Your last picking ${IN[env]}. Clear it to go back to ${se ? `${ENDS_BY[se.by]}, ${UI.day(se.date)}` : 'the season’s end there'}.` : `The season ends ${IN[env]} on ${inForce ? UI.day(inForce) : 'no day'}: ${whose}. Pick a date to end it on another day. What that moves is shown first.` });
    input.addEventListener('change', () => {
      const v = input.value, md = v && root.LRFEngine.validDate(root.LRFEngine.s2d(v)) ? v.slice(5) : null;
      if ((md || null) === mine || (!mine && md && inForce && iso(inForce).slice(5) === md)) { input.value = inForce ? iso(inForce) : ''; return; }
      setUntil(c, env, md);
    });
    // what ends a date of his sooner: the first frost in open ground, or the day the garden closes, whichever comes first
    const cut = own && se && se.frost && own > se.frost && !(se.close && se.close < se.frost) ? h('small.yc-total.warn', { dataset: { hook: 'harvest-until-frost' } }, `the first frost, ${UI.day(se.frost)}, cuts it short`) : null;
    const shut = own && se && se.close && own > se.close && !cut ? h('small.yc-total.warn', { dataset: { hook: 'harvest-until-close' } }, `the garden closes ${UI.day(se.close)}, which ends it sooner`) : null;
    const apart = at && (+at.lo !== +at.hi || !inForce || +at.hi !== +inForce) ? h('small.yc-total', `plantings end ${between(at.lo, at.hi)}`) : null;
    // the dates the plantings there come to are carried on the line, as on a crop picked for a number of days (hook harvest-end)
    const line = at ? { hook: 'harvest-end', place: env, from: iso(at.lo), to: iso(at.hi), n: String(at.n) } : {};
    return [h('span.yc-line', { dataset: line }, h('span.yc-box.yc-date' + (mine ? '.mine' : ''), input), h('span.yc-unit', { dataset: { hook: 'harvest-until-whose' } }, whose)), cut, shut, apart];
  }
  /** Show what a step of the harvest window would move, in a sheet, whenever it moves anything; true when he agrees or nothing moves. */
  async function askMoves(eng, c, ops, label, confirmLabel) {
    const m = movesOf(eng, c, ops), moved = Math.abs(m.worth[1] - m.worth[0]) >= 0.5;
    if (m.n || moved || m.beds.length || m.things) {
      const worth = moved ? `the season’s worth goes from ${money(m.worth[0])} to ${money(m.worth[1])}` : `the season’s worth stays ${money(m.worth[0])}`;
      const detail = h('div.yc-moves', { dataset: { hook: 'harvest-moves' } },
        m.places.length ? h('ul.moves', m.places.map(x => h('li', { dataset: { hook: 'harvest-move', place: x.env, wasFrom: x.was.lo ? iso(x.was.lo) : '', wasTo: x.was.hi ? iso(x.was.hi) : '', wasNone: String(x.was.none), nowFrom: x.now.lo ? iso(x.now.lo) : '', nowTo: x.now.hi ? iso(x.now.hi) : '', nowNone: String(x.now.none), n: String(x.n) } },
          h('b', PLACE[x.env]), ` ${plural(x.n, 'planting')}: last picking ${sideSaid(x.was)} → ${sideSaid(x.now)}`))) : null,
        h('p.yc-moves-worth', { dataset: { hook: 'harvest-worth', was: String(m.worth[0]), now: String(m.worth[1]) } }, worth.charAt(0).toUpperCase() + worth.slice(1), '.'),
        h('p', { dataset: { hook: 'harvest-twice', beds: m.beds.join('|') } }, m.beds.length ? `Ground booked twice then: ${m.beds.join(', ')}. Not refused: ${m.beds.length === 1 ? 'it waits' : 'they wait'} under “To settle”.` : 'No ground ends up booked twice.'),
        m.own ? h('p', { dataset: { hook: 'harvest-own', n: String(m.own) } }, `${plural(m.own, 'planting')} ${m.own === 1 ? 'keeps its' : 'keep their'} own harvest days or last picking, and ${m.own === 1 ? 'does' : 'do'} not move.`) : null,
        m.things ? h('p', m.things.said) : null);
      return UI.confirm({ title: `${label}?`, body: `${!m.n ? 'No planting’s last picking moves' : m.n === 1 ? 'One planting’s last picking moves' : `The last picking of ${num(m.n)} plantings moves`}, worked out on your plan as it stands. One undo takes it back.`,
        confirmLabel, detail });
    }
    return true;
  }
  /**
   * The choice itself, one joined control: "To the season's end" | "For [N] days". `input` is the number box, made by the caller
   * (the card's box, or the list's cell); typing in it is the second side's number. `short`: the narrow words, for the list and for
   * a card that has columns for other things sold.
   */
  function windowChoice(eng, c, hc, input, short, redraw) {
    const w = windowOf(eng, c, hc), name = c.name;
    return h('span.yc-hw' + (short ? '.short' : ''), { role: 'group', 'aria-label': `${name}: harvest window`, dataset: { hook: 'harvest-choice', on: w.season ? 'season' : 'days' } },
      h('button.yc-hw-end', { type: 'button', 'aria-pressed': String(w.season), dataset: { hook: 'harvest-season' }, title: w.season ? `Picked until the season ends where it grows. A yield is spoken of over ${hc.nominal} days.` : `Picks ${name} until the season ends where it grows. What that moves is shown first.`,
        onclick: () => { if (!w.season) setWindow(c, 'season', redraw); } }, short ? 'Season' : 'To the season’s end'),
      h('span.yc-hw-n' + (w.season ? '' : '.on'),
        h('button.yc-hw-for', { type: 'button', 'aria-pressed': String(!w.season), dataset: { hook: 'harvest-days' }, title: w.season ? `Picks ${name} for ${w.offer} days, or the number typed beside. What that moves is shown first.` : `Picked for ${w.days} days. Type another number beside to change it.`,
          onclick: () => { if (!w.season) { input.focus(); return; } const typed = Math.round(+input.value); setWindow(c, typed >= 1 && typed <= 400 ? typed : w.offer, redraw); } }, 'For'),
        input, h('span.yc-unit', short ? 'd' : 'days')));
  }

  // ───────────────────────── the card ─────────────────────────
  function card(eng, plan, c, q) {
    const s = study(eng), x = s.crops.get(c.id) || NONE, hc = eng.harvestFor(c.id), year = s.year, unit = hc.unit.value, u = unitWord(unit), w = waits(eng, c, hc), cover = eng.isCoverCrop(c);
    // the other things the crop sells: a column each after the crop's own (js/things.js)
    const T = root.LRFThings.of({ eng, c, hc, x, year, box, redraw: () => ui.redraw() });
    const cols = T.places(placesOf(eng, c, hc, x)), n = cols.list.length, per = PER[hc.basis], varieties = hc.micro ? [] : eng.varietiesOf(c.id);
    const next = nextAfter(eng, q, c.id), nextCrop = next && eng.crop(next), looked = hc.looked === year, still = empties(eng, c);
    const head = h('header.yc-head',
      root.LRFThumbs.el({ cropId: c.id, color: eng.cropColor(c), label: c.name, size: 30, cls: 'key' }),
      h('div', h('h3', { id: 'ycName' }, c.name),
        h('p.yc-where', { id: 'ycWhere' }, !x.n ? 'Not planted this season.' : `${plural(x.n, 'planting')}: ${[...x.places.entries()].sort((a, b) => Object.keys(PLACE).indexOf(a[0]) - Object.keys(PLACE).indexOf(b[0])).map(([env, at]) => `${PLACE[env]} ${num(at.n)}`).join(' · ')}`)),
      T.add(),
      h('p.yc-state' + (looked ? '.done' : ''), { id: 'ycState' }, looked ? `Looked at for ${year}` : hc.looked ? `Last looked at for ${hc.looked}` : `Not looked at for ${year}`));
    const out = h('section.yc-card', { id: 'ycCard', dataset: { crop: c.id }, 'aria-label': `${c.name}: yield and price` }, head);
    const finish = (...rest) => { UI.add(out, rest, actions()); return out; };
    // The button ticks when it is pressed with the mouse, whatever is still empty, and says what is. From the keyboard it is
    // Enter: it goes to the first empty box, and ticks only when there is none.
    const actions = () => h('div.yc-actions', { id: 'ycActions' },
      h('button.btn.primary', { type: 'button', id: 'ycNext', dataset: { next: next || '' }, title: `Ticks ${c.name} as looked at for ${year}${nextCrop ? `, and opens ${nextCrop.name}` : ''}.${still.length ? ` Still empty: ${still.map(e => e.say).join(', ')}.` : ' Enter does the same from any box.'}`,
        onclick: e => { if (e.detail === 0) enter(null, q); else looksRight(App.state.engine, q, true); } }, nextCrop ? `Looks right. Next: ${nextCrop.name}` : 'Looks right.'),
      still.length ? h('p.yc-still', { id: 'ycStill' }, `Still empty: ${still.map(e => e.say).join(', ')}.`) : null,
      looked ? h('button.link', { type: 'button', id: 'ycUntick', title: `${c.name} is no longer counted as looked at for ${year}.`, onclick: () => App.setLooked(c.id, false) }, 'Take the tick off') : null,
      h('p.yc-key', h('i.amber'), 'only you can fill', h('i.mine'), 'yours', h('i'), 'what the plan uses now'));
    if (cover) return finish(h('p.yc-plain', { id: 'ycPlain' }, 'A cover crop: nothing is picked from it and nothing is sold, so there is no figure to set here.'));

    // ── what is kept for personal use: only for a crop that is partly kept, and never on a farm that sells everything ──
    let house = null;
    if (hc.house.part) {
      const keeps = 100 - hc.house.sold, typed = hc.share.mine != null && hc.share.mine < 100 ? 100 - hc.share.mine : null, empty = hc.house.sold >= 100;
      house = h('div.yc-house', { id: 'ycHouse' },
        h('p.yc-houseline', 'Personal use: ',
          box({ key: 'house', mine: typed, fallback: empty ? null : keeps, amber: empty, max: 100, label: `${c.name}: what is kept for personal use, percent of what is packed`,
            tip: empty ? 'Nothing is set: all that is packed counts as sold. Type the part the house keeps.' : `${fig(hc.house.sold)}% of what is packed counts as sold. ${typed != null ? 'Yours. Clear it to go back to the crop’s record.' : 'From the crop’s record.'}`,
            save: k => App.setSell(c.id, { share: k == null ? null : 100 - k }, k == null ? `${c.name}: sold share back to ${hc.share.fallback}%` : `${c.name}: ${fig(100 - k)}% sold`) }),
          ' % of what is packed'),
        h('p.yc-why', { id: 'ycHouseWhy' }, hc.house.marked ? `Shown because ${c.name} is marked as grown for sale and personal use, on its record under Seeds.` : `Shown because ${fig(hc.house.sold)}% of ${c.name} counts as sold today, so the rest is taken to be for personal use.`,
          ' ', h('button.link', { type: 'button', id: 'ycSoldAll', title: 'Counts all that is packed as sold. What that does to the season’s worth is shown first.', onclick: () => App.setHouse(c.id, false) }, 'Sold in full…')));
    }

    // ── the grid ──
    const span = (...kids) => h('td.yc-all', { colSpan: n }, kids);
    const row = (id, label, hint, cells) => h('tr', { dataset: { row: id } }, h('th', { scope: 'row' }, h('b', { dataset: { hook: 'card-row-name' } }, label), hint ? h('small', { dataset: { hook: 'card-row-hint' } }, hint) : null), cells, T.cells(id));
    const why = text => h('span.yc-na', text);
    const grid = h('table.yc-grid', { id: 'ycGrid' },
      h('thead', h('tr', h('th'), cols.list.map(env => { const at = x.places.get(env); return h('th', { scope: 'col', dataset: { place: env } }, PLACE[env], h('small', at ? plural(at.n, 'planting') : cols.planted ? 'nothing planted there now' : 'not planted yet')); }), T.heads())));
    const body = h('tbody');
    grid.append(body);
    if (T.any) grid.classList.add('things');

    // sold by, and for how much: one unit and one price for the crop, wherever it grows
    const ownUnit = varieties.filter(v => eng.sellVRule(v.id).unit).length, ownPrice = varieties.filter(v => eng.sellVRule(v.id).price != null).length;
    const also = (k, what) => k ? h('small.yc-note', `${plural(k, 'variety', 'varieties')} ${k === 1 ? 'has' : 'have'} ${what} of ${k === 1 ? 'its' : 'their'} own, on `, toList(c, '“All on one page”', true), '.') : null;
    const changed = ui.units.get(c.id);
    if (changed && changed.from === unit) ui.units.delete(c.id);
    if (hc.micro) body.append(row('unit', 'Sold by', null, span(why('the tray: a live tray is counted and sold by the tray'))));
    else body.append(row('unit', 'Sold by', null, span(
      h('select.yc-sel' + (hc.unit.mine ? '.mine' : ''), { 'aria-label': `${c.name}: sold by`, dataset: { yk: 'unit' }, title: `${hc.unit.mine ? `Your choice; the crop’s record says ${hc.unit.fallback}.` : 'From the crop’s record.'} One unit for the crop, wherever it grows. A typed letter picks a unit.`,
        onchange: e => setUnit(c, e.target.value) },
        [...new Set([...UNITS, hc.unit.fallback, unit].filter(Boolean))].map(v => h('option', { value: v, selected: v === unit }, v)), hc.unit.mine ? h('option', { value: '(default)' }, `Back to ${hc.unit.fallback}`) : null),
      n > 1 ? h('span.yc-unit', 'wherever it grows') : null,
      changed && changed.from !== unit ? h('small.yc-note.warn', { id: 'ycUnitNote' }, `Changed from ${changed.from} to ${unit}. The price and each yield stand as typed when it was ${soldBy(changed.from)}, and nothing was turned into the new unit: check them. This stays until the crop is ticked again.`) : null,
      also(ownUnit, 'a unit'))));
    body.append(row('price', 'Price', null, span('$ ',
      box({ key: 'price', mine: hc.price.mine, fallback: hc.price.fallback, amber: w.price, label: `${c.name}: price`,
        tip: hc.price.mine != null ? `Your price for one ${unit === 'each' ? 'of them' : unit}. Clear it to go back to ${fig(hc.price.fallback)}.` : w.price ? 'No price is set, so this crop adds nothing to what the season is worth.' : `From the crop’s record: $${fig(hc.price.fallback)} for one ${unit === 'each' ? 'of them' : unit}.`,
        save: k => App.setSell(c.id, { price: k }, k == null ? `${c.name}: price back to $${fig(hc.price.fallback)}` : `${c.name}: $${fig(k)}${each(unit)}`) }),
      h('span.yc-unit', each(unit).trim()), also(ownPrice, 'a price'))));
    // a share for each thing, only where two come out of the same plantings
    body.append(...T.shareRows(row, span));

    // what it gives: a box for each place, in the crop's own way of being picked
    if (hc.micro) body.append(row('yield', 'Marketable yield', null, span(why('a tray is a tray'))));
    else {
      const pattern = hc.pattern.value, weekly = hc.weekly, was = ui.turned.get(c.id);
      if (was && was.weekly === weekly) ui.turned.delete(c.id);
      const tenths = pattern === 'once' && hc.basis === 'plant' && COUNTED.includes(unit) && cols.list.every(env => hc.cells[env].value == null || hc.cells[env].value <= 1);
      const label = tenths ? 'Of every 10 planted, fit to sell' : `Marketable yield ${PER_SAY[hc.basis]}${weekly ? ' per week' : ''}`;
      const hint = tenths ? 'cut once: the ten that go in, less the ones that do not make it' : weekly ? 'packed weight or count, picked each week, for as many weeks as it is picked' : pattern === 'once' ? 'packed weight or count, in all, taken the day it is cleared' : 'packed weight or count, in all, over its harvest days';
      body.append(row('yield', label, hint, cols.list.map(env => {
        const cell = hc.cells[env], at = x.places.get(env), k = tenths ? 10 : 1, where = `${c.name}, ${PLACE[env].toLowerCase()}`, amber = w.places.includes(env);
        const what = `${weekly ? 'picked each week from' : 'in all from'} ${per}`, back = cell.fallback == null ? 'no yield at all' : fig(cell.fallback);
        const mine = cell.mine == null ? null : cell.mine * k, fallback = cell.fallback == null ? null : cell.fallback * k;
        const input = box({ key: `y|${env}`, mine, fallback, amber, max: tenths ? 10 : undefined, label: `${where}: ${tenths ? 'of every 10 planted, fit to sell' : `yield, ${per}${weekly ? ' a week' : ''}`}`,
          tip: cell.mine != null ? `Your figure: ${fig(cell.mine)}${u} ${what}. Clear it to go back to ${back}.` : cell.fallback == null ? 'No yield is set for this crop.' : `${amber ? 'A starting value nobody has checked' : 'From the crop’s record, not yet checked'}: ${fig(cell.fallback)}${u} ${what}.`,
          save: v => { const y = v == null ? null : v / k; return App.setYield('crops', c.id, env, y, y == null ? `${where}: yield back to ${back}` : `${where}: ${fig(y)}${u} ${weekly ? 'a week' : 'in all'}`); } });
        // one meaning for the box, and beside a week's picking the season's total it comes to: the engine's own figure for the
        // plantings there that follow this line (they differ where one is picked for more days than another)
        let beside = null;
        if (cell.value == null) beside = h('small.yc-total.warn', 'nothing is forecast until this is typed');
        else if (amber) beside = h('small.yc-total.warn', `the plan counts ${fig(cell.value)}${u} meanwhile: a starting value nobody has checked`);
        else if (weekly) {
          const list = at && at.per.length ? at.per : [cell.total], lo = Math.min(...list), hi = Math.max(...list), range = fig(lo) === fig(hi) ? fig(lo) : `${fig(lo)} to ${fig(hi)}`;
          beside = h('small.yc-total', { dataset: { lo: String(lo), hi: String(hi), by: at && at.per.length ? 'plantings' : 'line' }, title: at && at.per.length ? `${fig(cell.value)}${u} a week, for the weeks each planting there is picked.${fig(lo) === fig(hi) ? '' : ' The plantings differ in how long they are picked.'}` : `${fig(cell.value)}${u} a week over ${hc.nominal} harvest days.` },
            `comes to ${range}${u} ${per} over the season`);
        } else if (pattern === 'spread' && !tenths) beside = h('small.yc-total', { title: `${fig(cell.total)}${u} over ${hc.nominal} harvest days` }, `about ${fig(cell.weekly)}${u} a week`);
        else if (tenths) beside = h('small.yc-total', `${fig(cell.value)}${u} from each plant`);
        // what the figure read before "Picked" turned it: the same amount over the crop's harvest days, said another way
        const old = was && was.weekly !== weekly && was.cells[env] != null && cell.value != null ? h('small.yc-total.yc-turned', { dataset: { was: String(was.cells[env]), now: String(cell.value) } }, `read ${fig(was.cells[env])}${u} ${was.weekly ? 'a week' : 'in all'} before “Picked” was changed: the same over ${was.nominal} harvest days`) : null;
        return h('td', { dataset: { place: env } }, h('span.yc-line', input, h('span.yc-unit', tenths ? 'of 10' : unit === 'each' ? '' : unit)), beside, old);
      })));
    }

    // a young stand (E2c part 2): for a perennial crop, the share of a mature stand's yield it gives the year it is planted and the year
    // after. The grey figures are published ones and count only for a stand whose year is typed on its planting; his replace them;
    // an empty year is a mature stand, as before
    if (hc.young) body.append(youngRow(eng, c, hc, row, span));

    // where one unit has to be turned into another, the one figure that does it
    if (T.any) UI.add(body, T.helperRow(row, span));

    // first picking: the crop's days to harvest for the place, shown and not changed here
    const timing = hc.micro ? [] : cols.list.map(env => eng.timingFor(c.id, null, env)), after = t => t && t.value != null ? `days after ${t.fixed ? FIXED[t.fixed] : FROM[t.start]}` : '';
    const oneStart = timing.length > 0 && timing.every(t => after(t) && after(t) === after(timing[0]));
    body.append(row('first', 'First picking', h('span', oneStart ? `${after(timing[0])}, set under ` : 'Set under ', h('button.link', { type: 'button', id: 'ycToDays', title: 'Days to harvest are set on the other half of this list, for each place.', onclick: () => root.LRFAssume.setMode('days') }, 'Days to harvest')), cols.list.map((env, i) => {
      if (hc.micro) return h('td', { dataset: { place: env } }, why('set on the tray plan, under Nursery'));
      const t = timing[i];
      if (!t || t.value == null) return h('td', { dataset: { place: env } }, why('no days are set for this place'));
      return h('td', { dataset: { place: env } }, h('span.yc-line', h('b.yc-fixed', { dataset: { dtm: String(t.value) } }, String(t.value)), h('span.yc-unit', { title: `Days to harvest, ${after(t).replace(/^days /, '')}: the figure the Days to harvest list holds for this crop in this place.`, dataset: { hook: 'card-first-unit' } }, oneStart ? 'days' : after(t))));
    })));

    // how it is picked, and for how long
    if (hc.micro) body.append(row('pick', 'Picked', null, span(why('when due: a live tray is counted whole on the Monday it is due'))));
    else {
      const hw = windowOf(eng, c, hc), daysBox = box({ key: 'days', mine: hc.days.mine, fallback: hw.offer, whole: true, min: 1, max: 400, label: `${c.name}: harvest days`,
        tip: hc.days.mine != null ? `Your number: picked for ${hc.days.mine} days. Clear it to go back to ${hc.season ? 'the end of the season' : hc.days.fallback + ' days'}.` : hw.season ? `Type a number to pick it for that many days instead of to the season’s end. What that moves is shown first.` : `From the crop’s record: picked for ${hc.days.fallback} days.`,
        save: k => setWindow(c, k) });
      body.append(row('pick', 'Picked', null, span(h('span.yc-line',
        h('select.yc-sel' + (hc.pattern.mine ? '.mine' : ''), { 'aria-label': `${c.name}: picked`, dataset: { yk: 'pick' }, title: `${PATTERN_TIP[hc.pattern.value]}${hc.pattern.mine ? '' : ' Not set: the default.'}`,
          onchange: e => setPick(c, cols.list, e.target.value) },
          Object.entries(PATTERN).map(([value, text]) => h('option', { value, selected: hc.pattern.value === value }, text)), hc.pattern.mine ? h('option', { value: 'unset' }, 'Back to not set') : null),
        windowChoice(eng, c, hc, daysBox, T.any)))));   // beside the columns of other things sold, the narrow words
    }

    // last picking: what the choice above comes to in each place, as dates: the plantings there that follow the crop's line.
    // Picked to the season's end, each place's end is a date he can set (E2c); picked for a set number of days, the number is
    // said once, above, and this row gives only the dates it comes to.
    const ends = hc.micro ? new Map() : endsOf(eng, c), hw = hc.micro ? null : windowOf(eng, c, hc);
    const dated = env => hw.season && hc.pattern.value !== 'once' && !hc.micro && env !== 'tray';
    const said = env => ends.has(env) ? h('span.yc-line', { dataset: { hook: 'harvest-end', place: env, from: iso(ends.get(env).lo), to: iso(ends.get(env).hi), n: String(ends.get(env).n) } }, h('b.yc-fixed', between(ends.get(env).lo, ends.get(env).hi))) : null;
    body.append(row('last', 'Last picking', hw && hw.season && hc.pattern.value !== 'once' ? 'the season’s end there, or a date of your own' : null, cols.list.map(env => h('td', { dataset: { place: env } },
      hc.micro ? why('none: a tray is taken whole') : hc.pattern.value === 'once' ? why('none: cleared in one day')
        : dated(env) ? untilCell(eng, c, hc, env, year, ends.get(env))
          : said(env) || why('counted from the first picking')))));

    // ── under the grid: what it comes to, and what it waits on ──
    const comes = [], units = [...x.units.values()].filter(k => k.total > 0);
    if (units.length) {
      for (const k of units) comes.push(h('p', { dataset: { unit: k.unit, total: String(k.total), worth: String(k.worth), ...(k.thing ? { thing: k.thing } : {}) } }, k.thing ? `${k.sold}: ` : T.counting.length ? `${c.name}: ` : '', h('b', F.amount(k.total, k.unit, k.group)), ` to sell in ${year}, worth `, h('b', money(k.worth)), '.'));
      const split = Object.keys(PLACE).filter(env => x.places.has(env) && x.places.get(env).total > 0).map(env => [env, x.places.get(env)]);
      if (split.length > 1 && units.length === 1) comes.push(h('p.yc-split', split.map(([env, at]) => `${PLACE[env]} ${F.amount(at.total, units[0].unit, units[0].group)}`).join(' · ')));
      comes.push(h('p.yc-fine', hc.house.part && hc.house.sold >= 100 ? 'That is the worth of what is packed for sale: all of it counts as sold until the part for personal use is typed above.' : hc.house.part ? `That is what is packed for sale: the house’s ${fig(100 - hc.house.sold)}% is already taken off.` : hc.micro ? 'A tray sown is a tray to sell.' : 'That is the worth of what is packed for sale: all of it counts as sold.',
        x.personal ? ` ${plural(x.personal, 'planting')} marked for personal use ${x.personal === 1 ? 'is' : 'are'} picked and not counted as revenue.` : ''));
    } else comes.push(h('p', !x.n ? `Nothing: ${c.name} is not planted in ${year}.` : `Nothing is forecast for ${year} yet.`));
    const need = [];
    if (w.price) need.push('A price. Until there is one, this crop adds nothing to what the season is worth.');
    if (w.yield) { const there = cols.planted && w.places.length < n ? ` ${w.places.map(env => IN[env]).join(' and ')}` : ''; need.push(w.places.every(env => hc.cells[env].value == null) ? `A yield${there}. Until there is one, nothing is forecast ${there ? 'there' : 'for this crop'}.` : `A yield of your own${there}. The plan counts a starting value nobody has checked.`); }
    if (hc.house.part && hc.house.sold >= 100) need.push('What is kept for personal use. The crop is marked as partly kept, and no part is set.');
    for (const line of T.needs()) need.push(line);
    if (T.apart()) need.push(T.apart());
    if (x.own) need.push([`${plural(x.own, 'planting')} ${x.own === 1 ? 'carries a yield of its own and does' : 'carry a yield of their own and do'} not follow these boxes. `, h('button.link', { type: 'button', id: 'ycDiffers', title: 'Opens the window that lists the plantings that differ from the list, with what letting each go would change.', onclick: () => root.LRFAssume.openAudit() }, '“See what differs…”'), ' lets them.']);
    const ownYield = varieties.filter(v => eng.ENVS.some(env => eng.harvestFor(c.id, v.id).cells[env].mine != null)).length;
    if (ownYield) need.push([`${plural(ownYield, 'variety', 'varieties')} ${ownYield === 1 ? 'has' : 'have'} a yield of ${ownYield === 1 ? 'its' : 'their'} own, on `, toList(c, '“All on one page”', true), '.']);
    if (s.waiting.get(c.id)) need.push(`${plural(s.waiting.get(c.id), 'planting')} ${s.waiting.get(c.id) === 1 ? 'waits' : 'wait'} under To place, and ${s.waiting.get(c.id) === 1 ? 'is' : 'are'} not counted until ${s.waiting.get(c.id) === 1 ? 'it has' : 'they have'} a bed.`);
    const facts = h('div.yc-facts', { id: 'ycFacts' },
      h('div', { id: 'ycComes' }, h('h4', 'What it comes to'), comes),
      h('div', { id: 'ycWaits' }, h('h4', 'What it waits on'), need.length ? h('ul', need.map(text => h('li', text))) : h('p', 'Nothing: every figure it needs is set.'),
        hc.micro ? null : h('p.yc-fine', { id: 'ycMore' }, 'How long it keeps, its turnover days and each variety’s own price are on the list: ', toList(c, 'Keeps, Turnover and varieties', true), '.')));
    return finish(house, grid, facts);
  }

  /** The card's row for a young stand (E2c part 2): two boxes, each his or the published figure in grey, and what they count for. */
  function youngRow(eng, c, hc, row, span) {
    const words = ['the year it is planted', 'the year after'], stands = (eng.plan.plantings || []).filter(p => p.cropId === c.id && eng.bedOf(p.bedId));
    const typed = stands.filter(p => Number.isInteger(p.plantedIn)).length, published = hc.young.some(y => y.fallback != null);
    const cell = i => {
      const y = hc.young[i], back = y.fallback == null ? 'all of it' : `${fig(y.fallback)}%`;
      return [box({ key: `young|${i}`, mine: y.mine, fallback: y.fallback, min: 0, max: 100, label: `${c.name}: a young stand, percent of a mature stand’s yield ${words[i]}`,
        tip: y.mine != null ? `Your figure: ${fig(y.mine)}% of a mature stand’s yield ${words[i]}. Clear it to go back to ${back}.` : y.fallback != null ? `Published: ${y.source}. Counted only for a stand whose year is typed on its planting. Type your own to replace it.` : `No published figure for ${c.name}: empty, a stand gives all of it. Type your own.`,
        save: k => App.setSell(c.id, { young: hc.young.map((x, j) => j === i ? k : x.mine) }, k == null ? `${c.name}: a young stand, ${words[i]} back to ${back}` : `${c.name}: a young stand gives ${fig(k)}% ${words[i]}`) }),
        h('span.yc-unit', `% ${words[i]},`)];
    };
    // a stand picked, in part or whole, before the year it is planted: said with its date (none of it is counted that year)
    const early = [];
    for (const p of stands) {
      const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null;
      if (!y || !y.age) continue;
      for (const x of eng.soldOf(p, r, y) || [y]) if (x.age && x.age.season === 0) { const d = x.first || r.first; early.push(`${x.name || c.name} in ${App.bedLabel(eng.bedOf(p.bedId), eng)} first picked ${UI.day(d)}, ${d.getFullYear()}, before the stand is planted (${x.age.year}): none counted that year.`); }
    }
    const said = `${early.join(' ')}${early.length ? ' ' : ''}${published ? 'Grey: published figures (each box says whose), counted only once a stand’s year is typed. Yours replace them.' : `No published figures for ${c.name}: an empty box gives all of it.`} ${stands.length ? `${typed} of ${plural(stands.length, 'stand')} ${typed === 1 ? 'has its' : 'have their'} year typed.` : ''}`;
    return row('young', 'A young stand gives', 'of the yield above, for a stand whose year is typed on its planting; an empty year is a mature stand',
      span(h('span.yc-line', ...cell(0), ...cell(1), h('span.yc-unit', 'all of it from the third')), h('small.yc-total', { dataset: { hook: 'young-said' } }, said.trim())));
  }

  // ───────────────────────── what a press does ─────────────────────────
  /** A unit was changed, here or on the list: remembered until the crop is ticked again, so that the card can go on saying so. */
  function unitChanged(id, from) { if (!ui.units.has(id)) ui.units.set(id, { from }); }
  /**
   * Change the unit through the list's own call. No yield and no price is turned into the new unit. Where the crop has a price
   * or a yield, what stays as typed and what it will now mean is said first, and it is done only if he agrees: one step, which
   * also takes the crop's tick off.
   */
  async function setUnit(c, value) {
    const eng = App.state.engine, hc = eng.harvestFor(c.id), was = hc.unit.value, to = value === '(default)' ? hc.unit.fallback : value, w = waits(eng, c, hc), year = study(eng).year;
    if (to === was) return false;
    const x = of(eng, c.id), cols = placesOf(eng, c, hc, x), per = `${PER[hc.basis]}${hc.weekly ? ' a week' : ''}`;
    const yields = cols.list.filter(env => hc.cells[env].value != null && !w.places.includes(env)).map(env => `${PLACE[env].toLowerCase()} ${fig(hc.cells[env].value)}`), price = hc.price.value > 0 ? hc.price.value : null;
    // what the new unit would do to the other things the crop sells (one packed from its harvest was given a figure for the old unit)
    const unitTo = value === '(default)' || value === hc.unit.fallback ? null : value, hit = App.thingsAfter(c.id, App.sellOps(c.id, { unit: unitTo }));
    if (price != null || yields.length || hit) {
      const says = [
        price != null ? `The price stays $${fig(price)}: it will mean $${fig(price)}${each(to)}, where it meant $${fig(price)}${each(was)}.` : '',
        yields.length ? `The yield stays as typed (${yields.join(', ')} ${per}): it will be counted in ${to === 'each' ? 'ones' : to}, where it was counted in ${was === 'each' ? 'ones' : was}.` : '',
        hc.looked === year ? `The tick for ${year} comes off, so ${c.name} goes back among the crops to check.` : '',
        hit ? hit.said : ''].filter(Boolean).join(' ');
      if (!await UI.confirm({ title: `${c.name}: ${soldBy(to)}, not ${was === 'each' ? 'each' : 'by the ' + was}?`, confirmLabel: 'Change the unit', body: `No figure is turned into the new unit. ${says} The card will say so until the crop is ticked again, and one undo takes it all back.` })) { ui.redraw(); return false; }
    }
    unitChanged(c.id, was);
    const done = await App.setSell(c.id, { unit: unitTo }, `${c.name}: ${soldBy(to)}`, { told: true });   // what it does to a thing was said in the window above
    if (!done) ui.redraw();
    return done;
  }
  /** A letter picks the unit that begins with it; pressed again, the next one that does. Only "Sold by" itself listens. */
  function unitByLetter(eng, c, letter) {
    const hc = eng.harvestFor(c.id);
    if (hc.micro) return false;
    const all = [...new Set([...UNITS, hc.unit.fallback, hc.unit.value].filter(Boolean))], fit = all.filter(x => x.toLowerCase().startsWith(letter.toLowerCase()));
    if (!fit.length) return false;
    const to = fit[(fit.indexOf(hc.unit.value) + 1) % fit.length];
    if (to !== hc.unit.value) setUnit(c, to);
    return true;
  }
  /**
   * Change how the crop is picked, through the list's own call. Between Gradually and the other two the planner turns each
   * yield into a week's figure or back, over the harvest days: what each read and what it reads now is said as it happens,
   * and stays beside the box until the crop is ticked again.
   */
  async function setPick(c, places, value) {
    const eng = App.state.engine, hc = eng.harvestFor(c.id), to = value === 'unset' ? null : value, weekly = (to || 'spread') === 'weekly', turns = weekly !== hc.weekly, was = study(eng).worth;
    const label = `${c.name}: ${value === 'unset' ? 'picked as before' : PATTERN_SAY[value]}`;
    if (!await App.setSell(c.id, { pattern: to }, label)) { ui.redraw(); return false; }
    if (!turns) return true;
    const now = App.state.engine, hc2 = now.harvestFor(c.id), u = unitWord(hc.unit.value), per = PER[hc.basis];
    if (!ui.turned.has(c.id)) ui.turned.set(c.id, { weekly: hc.weekly, nominal: hc.nominal, cells: Object.fromEntries(eng.ENVS.map(env => [env, hc.cells[env].value])) });
    const moved = places.filter(env => hc.cells[env] && hc.cells[env].value != null && hc2.cells[env].value != null).map(env => `${PLACE[env].toLowerCase()} ${fig(hc.cells[env].value)}${u} ${hc.weekly ? 'a week' : 'in all'} is now ${fig(hc2.cells[env].value)}${u} ${hc2.weekly ? 'a week' : 'in all'}`);
    UI.toast(`${label} · ${moved.length ? `the yield of ${per} is written the other way, the same over ${hc.nominal} harvest days: ${moved.join('; ')}` : 'no yield is set to be turned'} · ${worthSaid(was, study(now).worth)}`, { label: 'Undo', run: App.undo });
    ui.redraw();
    return true;
  }
  /** Tick the crop on the card and open the next one, with the pointer for typing in its first empty box. `said`: say what is still empty. */
  function looksRight(eng, q, said) {
    const id = ui.cur, c = eng.crop(id);
    if (!c) return;
    const next = nextAfter(eng, q, id), left = said ? empties(eng, c) : [];
    ui.focus = next ? { blank: true } : { key: 'next' };
    if (next) ui.cur = next;
    ui.units.delete(id); ui.turned.delete(id);   // looked at again: what was changed has been read
    const ticked = eng.harvestFor(id).looked === ui.year || App.setLooked(id, true, left.length ? `still empty: ${left.map(e => e.say).join(', ')}` : '');   // a tick redraws the page by itself
    if (!ticked || eng.harvestFor(id).looked === ui.year) ui.redraw();
    if (!next) UI.toast(`Every crop ${q ? 'that matches ' : ''}is looked at for ${ui.year}.`);
  }
  /**
   * Enter: what is in the box is taken first. Then, while a box only the grower can fill is still empty, the pointer goes to
   * the first of them and nothing is ticked; with none left it is "Looks right. Next: …".
   */
  async function enter(t, q) {
    if (t && t.commit && !await t.commit()) return;
    const eng = App.state.engine, c = eng.crop(ui.cur);
    if (!c) return;
    if (empties(eng, c).length) { ui.focus = { blank: true }; ui.redraw(); return; }
    looksRight(eng, q);
  }
  function open(id, focus) {
    if (!id) return;
    ui.cur = id; ui.focus = focus ? { blank: true } : null; ui.column = null;
    ui.redraw();
  }
  async function onKey(e, eng, q) {
    const t = e.target, c = eng.crop(ui.cur);
    if (!c || !t || !t.dataset || e.ctrlKey || e.metaKey || e.altKey) return;
    const isBox = t.tagName === 'INPUT' && !!t.dataset.yk, isSel = t.tagName === 'SELECT' && !!t.dataset.yk;
    if (!isBox && !isSel) return;
    ui.column = column(t);   // the thing whose column the keys are in: the pointer stays there while it has empty boxes
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enter(isBox ? t : null, q);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Tab goes to the next box that is still empty; with none left on the card, it goes on as Tab always does
      const all = stops(t.closest('.yc-card'), t), at = all.indexOf(t), to = all.slice(at + 1).find(blank);
      if (!to) return;
      e.preventDefault();
      ui.focus = { key: to.dataset.yk };
      if (isBox) { if (!await t.commit()) { ui.focus = null; return; } }
      const now = document.querySelector(`#ycCard [data-yk="${CSS.escape(ui.focus ? ui.focus.key : to.dataset.yk)}"]`);
      if (now && ui.focus) { ui.focus = null; now.focus(); }
    } else if (/^[a-z]$/i.test(e.key)) {
      // a letter picks a unit only on "Sold by" itself; in a number box it is not typed, picks nothing and takes nothing
      e.preventDefault();
      if (t.dataset.yk === 'unit') unitByLetter(App.state.engine, c, e.key);
      if (isSel && column(t) && /\|unit$/.test(t.dataset.yk)) root.LRFThings.letter(c, column(t), e.key);   // a thing's own “Sold by”
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
      const yieldSay = w.places.every(env => hc.cells[env].value == null) ? 'no yield' : 'yield not checked';
      const say = w.price && w.yield ? `no price · ${yieldSay === 'no yield' ? yieldSay : 'not checked'}` : w.price ? 'no price' : w.yield ? yieldSay : x.worth >= 0.5 ? money(x.worth) : '';
      const said = w.things ? `${w.price || w.yield ? say + ' · ' : ''}${plural(w.things, 'thing')} waiting` : say;   // another thing it sells still waits on a box
      return h('li', h('button.yc-item' + (done ? '.done' : '') + (w.any ? '.open' : ''), { type: 'button', dataset: { crop: id }, 'aria-current': id === ui.cur ? 'true' : null, title: `${c.name}${done ? `: looked at for ${year}` : ''}`, onclick: () => open(id, true) },
        h('i.yc-tick', { 'aria-hidden': 'true' }, done ? '✓' : ''), root.LRFThumbs.el({ cropId: id, color: eng.cropColor(c), label: c.name, size: 20, cls: 'key' }), h('b', c.name), h('small' + (w.any ? '.warn' : ''), { title: w.things ? `${plural(w.things, 'thing')} ${c.name} sells ${w.things === 1 ? 'waits' : 'wait'} on a box, and ${w.things === 1 ? 'is' : 'are'} not counted yet.` : null }, said)));
    };
    const firstNow = shown.filter(id => ui.first.has(id)), restNow = shown.filter(id => !ui.first.has(id));
    // the sold shares typed by the grower, listed where they can be seen together: they stand as typed
    const typed = plan.settings.houseKeeps === false ? [] : ui.order.filter(id => { const hc = eng.harvestFor(id); return !hc.micro && hc.share.mine != null; });
    const side = h('aside.yc-side', { 'aria-label': 'Every crop, as a checklist' },
      h('div.yc-prog', { id: 'ycProg', dataset: { looked: String(lookedN), of: String(ui.order.length) } }, h('p', h('b', `${num(lookedN)} of ${num(ui.order.length)}`), ` looked at for ${year}`),
        h('div.yc-meter', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': ui.order.length, 'aria-valuenow': lookedN, 'aria-label': `Crops looked at for ${year}` }, h('i', { style: { width: `${ui.order.length ? Math.round(lookedN / ui.order.length * 1000) / 10 : 0}%` } }))),
      h('p.yc-left' + (left ? '.warn' : ''), { id: 'ycLeft', dataset: { left: String(left) } }, left ? `${plural(left, 'crop')} left to set: no price, or a yield not yet checked${ui.order.some(id => waits(eng, eng.crop(id), eng.harvestFor(id)).things) ? ', or a thing still waiting on a box' : ''}` : 'Every crop has a price and a yield of your own.'),
      h('ol.yc-list', { id: 'ycList' },
        firstNow.length ? h('li.yc-sec', firstNow.some(id => waits(eng, eng.crop(id), eng.harvestFor(id)).any) ? 'No price, or a yield not yet checked' : 'Now set') : null, firstNow.map(item),
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
      // an empty box of the thing last typed in comes before any other; `next`: with none left, the button and not the price
      const all = stops(main), col = want.thing || ui.column, own = col ? all.filter(el => column(el) === col) : [];
      const to = want.blank ? own.find(blank) || all.find(blank) || (want.next ? null : main.querySelector('[data-yk="price"]')) || $('ycNext') : want.key === 'next' ? $('ycNext') : main.querySelector(`[data-yk="${CSS.escape(want.key)}"]`);
      if (to) { to.focus({ preventScroll: !want.blank }); if (to.select && to.tagName === 'INPUT') to.select(); }
    }
    return { mine: made.mine, all: made.all, left };
  }

  root.LRFYieldCard = { render, reset, open, unitChanged, current: () => ui.cur, order: () => ui.order.slice(), state: ui, box, windowOf, windowChoice, setWindow, setUntil, follows };
})(window);
