/* Little River Farm Planner — the card, part 1 (DESIGN.md, rules 2 and 3), tried beside the side panel.
 *
 * Behind one tick, "Try the card", in the Map's "?": off unless it is ticked, and kept by this browser only (never in the plan).
 * Off, nothing here draws anything and every screen is as it was. On, on the Map and the Timeline, a bed or a planting picked
 * opens one floating card in place of the side panel: the head (what it is, "⋯", ×), one picture, one line of what it comes to,
 * the boxes changed most, a tick, then rows that open in place and show their figures while closed. With nothing picked there is
 * no panel. What the card does not hold (an opening, the series tool, a planting waiting for a bed, the list of what to settle,
 * a planting opened "in full") stands in the side panel as before.
 *
 * Every change made here goes through the very function the side panel uses for it: LRFPanels.edit for a planting's own boxes,
 * App.setUse for whom it is grown for, App.addSuccessions, App.sendToWait, App.removePlantings. The answer to an action taken
 * while the card is open (a drop, a change, an Undo) is said on the card, with Undo, and not in a toast as well (rule 3).
 * The right-click menu, the hint on a bar of the Timeline and the calendar are the same card, smaller.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine;
  const { h, clear, add, day, num, span } = UI;
  const KEY = 'lrf.tryCard', SAID_FOR = 8000, VIEWS = ['map', 'timeline'];
  const NARROW = root.matchMedia('(max-width: 700px)');
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let on = false;
  try { on = root.localStorage.getItem(KEY) === '1'; } catch (_) { /* a browser that keeps nothing: the card stays off */ }
  let full = '';           // a bed or a planting opened in full in the side panel ("All of this planting…"), by its key
  let settling = false;    // the list of what to settle was asked for: it stands in the side panel
  let said = null;         // the answer to the last action taken while the card was open: { text, action, key, at }
  let seen = null, seenKey = '';
  // Whether what is being done now was done on the card: a press or a change on it (or its menu or calendar), or a drop that has
  // just picked what it planted. Only the answer to that is said on the card; any other word (a newer version ready, the plan
  // changed in another window, another device's changes taken in) stays in the toast, where it outlives the card (Codex on #66).
  let acting = false, actTimer = 0, planTick = false, tickTimer = 0;
  const mark = () => { acting = true; clearTimeout(actTimer); actTimer = setTimeout(() => { acting = false; }, 0); };
  const watchActs = el => { el.addEventListener('click', mark, true); el.addEventListener('change', mark, true); el.addEventListener('keydown', mark, true); return el; };   // which card was open when the last change was first seen (as the panel's "Saved" line keeps it)
  let card = null, menu = null, cal = null, hint = null, hintTimer = 0, hintBar = null;
  const opened = new Set();   // the rows of a planting's card that are open, by name: they stay open as the card is drawn again
  let bedRow = null;
  let openingSource = null;

  const keyOf = sel => (sel ? `${sel.type}:${sel.id}` : '');
  const inView = () => VIEWS.includes(App.state.view);
  const eng = () => App.state.engine;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  /** The days a planting is picked, short: "Jun 1 – 14" within a month. */
  const picked = r => (r.first.getMonth() === r.last.getMonth() ? `${day(r.first)} – ${r.last.getDate()}` : span(r.first, r.last));
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
  const nameOf = ({ r }) => `${r.c.vname ? r.c.vname + ' ' : ''}${r.c.name.toLowerCase()}`;
  const bedSeasonOn = bed => bed && eng().isSoilBed(bed) && !NARROW.matches;

  /** The bed or the planting the card holds, or null when what is picked belongs to the side panel. */
  function held(sel = App.state.sel) {
    if (!sel || sel.fromBedSeason || keyOf(sel) === full) return null;
    const e = eng();
    if (sel.type === 'bed') { const bed = e.bedOf(sel.id); return bed ? { kind: 'bed', bed } : null; }
    if (sel.type !== 'planting') return null;
    const p = e.planting(sel.id), r = p && e.calc(p);
    return r && !e.isPool(r.b) ? { kind: 'planting', p, r } : null;   // a live tray batch, or one that cannot be worked out: the panel
  }
  /** Whether the card stands in place of the side panel now. */
  function standing() {
    if (!on || !App.state.ready || !inView()) return false;
    if (root.LRFMapEdit && root.LRFMapEdit.on()) return false;   // Edit layout works in the side panel (Codex on #66)
    const sel = App.state.sel;
    if (!sel) return !settling && !App.state.newer;   // with nothing picked there is no panel, unless it has something to say
    return !!held(sel);
  }
  function sync() {
    const yes = standing();
    if (yes) document.body.dataset.card = 'on'; else delete document.body.dataset.card;
    return yes;
  }

  // ── the answer to an action, on the card (rule 3) ──
  // A toast raised while the card is open is said on the card instead, for as long as the panel's "Saved" line would say it.
  function answer(text, action) {
    if (!card || !card.isConnected || !standing() || !App.state.sel) return false;
    const last = App.lastChange(), refusedNow = last && last.kind === 'refused' && Date.now() - last.at < 50;   // a change the card asked for, turned down
    if (!acting && !refusedNow) return false;
    said = { text, action: action || null, key: keyOf(App.state.sel), at: Date.now() };
    draw();   // drawn again whole: after a drop the variety box is ringed when no variety came with it
    return true;
  }
  /** The change just made, and which card was open when it was made (none, when it was made in the side panel): it is said on
   *  that card only, never on the next one opened (Codex on #66). Heard as the plan changes; a change refused, which changes no
   *  plan, is noted when it is said. */
  function note() {
    const last = App.lastChange();
    if (last && last.at !== seen) {
      seen = last.at; seenKey = card && card.isConnected && standing() ? keyOf(App.state.sel) : '';
    }
  }
  function fillSaid() {
    const el = card && card.querySelector('.card-said');
    if (!el) return;
    clearTimeout(el.lrfTimer);
    clear(el);
    note();
    const key = keyOf(App.state.sel), last = App.lastChange();
    const mine = said && said.key === key && Date.now() - said.at < SAID_FOR;
    const change = last && seenKey === key && Date.now() - last.at < SAID_FOR && (!said || last.at > said.at + 50);
    if (mine && !change) {
      el.dataset.state = 'said';
      const run = said.action;
      add(el, h('span', said.text), run ? h('button.link', { type: 'button', dataset: { hook: 'card-undo' }, onclick: () => { said = null; run.run(); } }, run.label) : null);
    } else if (change) {
      el.dataset.state = last.kind;
      if (last.kind === 'saved') add(el, h('b', 'Saved'), h('span', ` · ${last.label}`), last.canUndo ? h('button.link', { type: 'button', dataset: { hook: 'card-undo' }, onclick: () => App.undo() }, 'Undo') : null);
      else add(el, h('b', 'Not changed'), h('span', ` · ${last.text}`));
    } else { el.dataset.state = 'idle'; el.hidden = true; return; }
    el.hidden = false;
    const at = change ? last.at : said.at;
    el.lrfTimer = setTimeout(() => { if (el.isConnected) fillSaid(); }, SAID_FOR - (Date.now() - at) + 30);
  }

  // ── the parts of a card ──
  function head(title, sub, thumb, more) {
    return h('header.card-head',
      thumb,
      h('div.card-title', h('h2', { dataset: { hook: 'card-title' } }, title), sub ? h('p.card-sub', sub) : null),
      h('button.icon-btn.card-more', { type: 'button', 'aria-label': 'More', 'aria-haspopup': 'menu', title: 'More', dataset: { hook: 'card-more' }, onclick: e => openMenu(more(), e.currentTarget) }, '⋯'),
      h('button.icon-btn.card-x', { type: 'button', 'aria-label': 'Close', dataset: { hook: 'card-close' }, onclick: () => App.select(null) }, '×'));
  }
  const bedLink = bed => h('button.link', { type: 'button', dataset: { hook: 'card-bed' }, title: 'Back to the bed', onclick: () => App.select({ type: 'bed', id: bed.id }) }, App.bedLabel(bed));
  /** A row that opens in place: its name and, closed, its figures; open, what changes them. */
  function fold(name, figures, body) {
    const open = opened.has(name);
    return h('section.card-row' + (open ? '.open' : ''), { dataset: { hook: 'card-row', row: name } },
      h('button.card-row-head', { type: 'button', 'aria-expanded': String(open), onclick: () => { if (open) opened.delete(name); else opened.add(name); draw(); } },
        h('span.card-row-name', { share: 'Share of the bed', days: 'Days and yield', nursery: 'In the nursery', repeat: 'Repeat as a series' }[name]), h('span.card-row-figs', figures), h('i', { 'aria-hidden': 'true' }, '›')),
      open ? h('div.card-row-body', body()) : null);
  }
  const box = (label, control) => h('label.card-box', h('span', label), control);

  /** A planting's life as one bar, drawn as the Timeline draws it: the nursery a thin line, growing a tint, picking in full, turnover hatched. */
  function lifeBar(p, r) {
    const e = eng(), color = e.cropColor(r.c), through = e.occupancyThrough(p, r), free = through === Infinity ? null : E.addDays(through, 1);
    const sow = r.sow && r.sow < r.field ? r.sow : null, a = +(sow || r.field), z = +(free || E.addDays(r.last, 1)), w = Math.max(1, z - a);
    const at = (from, to) => ({ left: `${((+from - a) / w * 100).toFixed(2)}%`, width: `${(Math.max(0, +to - +from) / w * 100).toFixed(2)}%` });
    const pickEnd = E.addDays(r.last, 1);
    const items = [sow ? ['Sow', day(sow)] : null, [sow ? 'In' : 'Sown', day(r.field)], ['Pick', r.harvestDays ? picked(r) : 'none'], ['Free', free ? day(free) : 'stays']].filter(Boolean);
    return h('div.card-bar', { dataset: { hook: 'card-bar' }, style: { '--crop': color } },
      h('div.card-bar-track',
        sow ? h('i.cb-nursery', { style: at(sow, r.field) }) : null,
        h('i.cb-grow', { style: at(r.field, r.harvestDays ? r.first : pickEnd) }),
        r.harvestDays ? h('i.cb-pick', { style: at(r.first, pickEnd) }) : null,
        free ? h('i.cb-turn', { style: at(pickEnd, free) }) : null),
      h('div.card-bar-days', items.map(([k, v]) => h('span', { dataset: { day: k.toLowerCase() } }, k, h('b', v)))));
  }
  /** One line of what a planting comes to: its amount, its price and its worth, as the forecast counts them. */
  function comesTo(p, r) {
    const e = eng(), F = root.LRFForecast, y = e.yieldOf(p, r);
    if (!y) return e.isCoverCrop(r.c) ? 'A cover crop: nothing picked' : 'No yield is set for this crop';
    const personal = F.useOf(e, p).personal, parts = e.soldOf(p, r, y);
    const one = (units, unit, price) => `${F.amount(units, unit, 'produce')}${!personal && price > 0 ? ` at $${num(price, 2)} · ${money(units * price)}` : ''}`;
    const text = parts ? parts.map(x => (x.thing ? `${x.name}: ` : '') + one(x.units, x.unit, x.price)).join('; ') : one(y.units, y.unit, y.price);
    return personal ? `${text} · personal use` : text;
  }

  // ── a planting's card ──
  function plantingCard(p, r) {
    const e = eng(), c = r.c, bed = r.b, color = e.cropColor(c), v = e.variety(p.varietyId), Ed = root.LRFPanels.edit, use = root.LRFForecast.useOf(e, p);
    const set = ed => { if (!ed || !App.updatePlanting(p.id, ...ed)) draw(); };
    const varieties = e.varietiesOf(p.cropId), justPlanted = said && said.key === keyOf(App.state.sel) && Date.now() - said.at < SAID_FOR && /^Plant /.test((App.lastChange() || {}).label || '');
    const variety = h('select', { dataset: { hook: 'card-variety' }, onchange: ev => set(Ed.variety(ev.target.value)) }, h('option', { value: '' }, 'No variety chosen'));
    if (v && !varieties.includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    for (const x of varieties) variety.append(h('option', { value: x.id, selected: x.id === p.varietyId }, x.name));
    if (justPlanted && !p.varietyId && varieties.length) variety.classList.add('ask');
    const sowRec = App.sowingOf(p), dateLabel = c.method === 'TP' ? 'Transplant date' : sowRec && sowRec.kind === 'field' && sowRec.done ? 'Planned sowing date' : 'Sowing date';
    const date = h('button.card-date', { type: 'button', dataset: { hook: 'card-date' }, 'aria-haspopup': 'dialog', title: 'Pick a day: the calendar says what it would move first', onclick: ev => openCalendar(p, ev.currentTarget) }, day(E.s2d(p.date)));
    const sale = h('input', { type: 'checkbox', checked: !use.personal, dataset: { hook: 'card-sale' }, onchange: ev => { if (!App.setUse('planting', [p.id], ev.target.checked ? 'commercial' : 'personal')) draw(); } });
    const saleSays = use.by === 'planting' ? 'Set on this planting' : use.by === 'default' ? '' : `As ${use.by === 'bed' ? 'its bed' : `all of ${(e.gardenOf(bed) || {}).name || 'its garden'}`}`;
    const f = e.footprint(p, r), unit = e.capUnit(bed), lengthKey = r.rack ? 'trays' : 'ft', whole = !(p[lengthKey] > 0) || (!r.layout && r.physicalLength >= r.cap);
    const split = f && f.rows && f.rows.count < f.rows.total;
    const shareFigs = `${whole ? `Whole ${r.ct ? 'group' : r.rack ? 'bench' : 'bed'} · ${num(r.cap, 1)} ${unit}` : `${num(r.physicalLength, 1)} of ${num(r.cap, 1)} ${unit}`}${split ? ` · ${f.rows.count} of ${f.rows.total} rows` : r.rows > 1 && !r.tw && !r.ct && !r.rack ? ` · ${num(r.rows)} rows` : ''}`;
    const nursery = r.cells ? `${num(r.seeds || 0)} seeds · ${r.trays ? plural(Math.ceil(r.trays), r.sowing && r.sowing.medium === 'rockwool' ? 'sheet' : 'tray') : plural(r.cells, 'cell')}` : r.seeds ? `Sown in the bed · ${num(r.seeds)} seeds` : 'Planted out as it is';
    const canSeries = !c.micro && !e.isCoverCrop(c) && +c.dtm > 0;
    return [
      head(c.vname || c.name, [c.vname ? `${c.name} · ` : '', bedLink(bed)], root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color, label: c.vname || c.name, size: 40 }), () => plantingMenu(p)),
      h('p.card-said', { role: 'status', dataset: { hook: 'card-said' }, hidden: true }),
      lifeBar(p, r),
      h('p.card-sums', { dataset: { hook: 'card-sums' } }, comesTo(p, r)),
      h('div.card-boxes', box(dateLabel, date), box('Variety', variety)),
      h('label.card-tick', sale, h('span', 'Grown for sale'), saleSays ? h('small', saleSays) : null),
      r.tw ? null : fold('share', shareFigs, () => [
        box(r.ct ? 'Containers' : r.rack ? 'Trays' : 'Length (ft)', h('input', { type: 'number', min: 1, max: r.cap, step: r.ct || r.rack ? 1 : 0.5, dataset: { hook: 'card-length' }, value: whole ? '' : +(+p[lengthKey]).toFixed(2), placeholder: `Whole · ${num(r.cap, 1)}`, onchange: ev => set(Ed.length(e, p, ev.target.value)) })),
        h('p.card-note', whole ? 'Shorten it to share the bed. Its ends can be dragged on the map.' : `Feet ${num(f ? f.a0 : 0, 1)}–${num(f ? Math.min(f.a1, r.cap) : r.len, 1)}. Empty the box for the whole bed.`)]),
      fold('days', `${p.dtm > 0 ? 'Its own' : 'Your list'}: ${num(c.dtm)} days · pick ${r.harvestMode === 'season' && !(p.hw > 0) ? 'to the season’s end' : plural(r.harvestDays, 'day')}`, () => [
        h('div.card-boxes',
          box('Days to harvest', h('input', { type: 'number', min: 1, max: 730, dataset: { hook: 'card-dtm' }, value: p.dtm > 0 ? p.dtm : '', placeholder: String(c.dtm), onchange: ev => set(Ed.dtm(p, ev.target.value)) })),
          box('Harvest days', h('input', { type: 'number', min: 0, max: 400, dataset: { hook: 'card-hw' }, value: p.hw != null && p.hw !== '' ? p.hw : '', placeholder: r.harvestMode === 'season' ? 'To season end' : String(c.hw), onchange: ev => set(Ed.hw(ev.target.value)) }))),
        h('p.card-note', p.dtm > 0 ? 'Its own days. Empty the box to follow your list.' : 'From your list. A figure here is this planting’s own.')]),
      fold('nursery', nursery, () => [h('p.card-note', r.sowing && r.sowing.batch ? `${r.sowing.batch.tray ? r.sowing.batch.tray.name : 'Pots'}${r.sowing.shared ? ', in one batch with other plantings of this variety' : ''}.` : r.cells ? 'Sown in trays.' : 'Nothing to sow in trays.'),
        h('button.btn.quiet.small', { type: 'button', onclick: () => openFull() }, 'Sowing and its record: All of this planting…')]),
      fold('repeat', `More, every ${num(Math.max(7, Math.min(28, c.hw || 14)))} days`, () => {
        const count = h('input', { type: 'number', min: 1, max: 30, value: 3, 'aria-label': 'How many more', dataset: { hook: 'card-repeat-count' } });
        const every = h('input', { type: 'number', min: 1, max: 120, value: Math.max(7, Math.min(28, c.hw || 14)), 'aria-label': 'Days apart', dataset: { hook: 'card-repeat-every' } });
        return [h('div.card-repeat', count, h('span', 'more, every'), every, h('span', 'days'),
          h('button.btn.small', { type: 'button', dataset: { hook: 'card-repeat-add' }, onclick: () => App.addSuccessions(p.id, Math.max(1, Math.min(30, Math.round(+count.value) || 1)), Math.max(1, Math.round(+every.value) || 14)) }, 'Add')),
          canSeries ? h('button.btn.quiet.small', { type: 'button', onclick: () => App.openAhead({ mode: 'series', sourceId: p.id }) }, 'Plan a longer series…') : null];
      }),
      h('div.card-foot', h('button.btn.quiet.small', { type: 'button', dataset: { hook: 'card-full' }, title: 'Every box of this planting, in the side panel', onclick: () => openFull() }, 'All of this planting…'))];
  }
  function plantingMenu(p) {
    const e = eng(), r = e.calc(p), c = r && r.c;
    return {
      title: App.cropLabel(p), sub: r ? `${App.bedLabel(r.b)} · in ${day(r.field)}` : '',
      items: [
        ['open', 'Open', () => App.select({ type: 'planting', id: p.id })],
        ['date', 'Change the date…', () => { App.select({ type: 'planting', id: p.id }); requestAnimationFrame(() => { const b = card && card.querySelector('.card-date'); if (b) b.click(); }); }],
        c && !c.micro && !e.isCoverCrop(c) && +c.dtm > 0 ? ['series', 'Repeat as a series…', () => App.openAhead({ mode: 'series', sourceId: p.id })] : null,
        ['full', 'All of this planting…', () => { App.select({ type: 'planting', id: p.id }); openFull(); }],
        null,
        ['wait', 'Send to To place', () => toWait(p)],
        ['remove', 'Remove planting', () => App.removePlantings([p.id]), null, 'bad']]
    };
  }

  /** Send a planting to To place from its card: its bed's card takes its place first, as for a removal, so that what the step did
   *  (and its Undo) is said where it was done (Codex on #66). The step itself is the panel's: App.sendToWait. */
  function toWait(p) {
    const e = eng(), r = e.calc(p);
    // one that cannot go (recorded, standing for years, following weekly demand) keeps its card, and is told why there (Codex on #66)
    if (r && !e.isPool(r.b) && !root.LRFRails.fixed(e, { p })) App.select({ type: 'bed', id: r.b.id });
    App.sendToWait(p.id);
  }

  // ── a bed's card ──
  function failureDay(p, r) {
    return E.s2d(r.failed || (p.workflow?.outcome === 'failed' ? p.workflow.failureDate : ''));
  }

  /** The bed's year: a line for each length of it, plantings as bars, openings dashed, the planning date as an orange mark. */
  function bedYear(bed, all, openings) {
    const e = eng(), year = App.planYear(), a = +new Date(year, 0, 1), z = +new Date(year + 1, 0, 1), w = z - a, cap = e.capOf(bed) || 1;
    const x = (from, to) => { const s = Math.max(a, +from), t = Math.min(z, +to); return t > s ? { left: `${((s - a) / w * 100).toFixed(2)}%`, width: `${((t - s) / w * 100).toFixed(2)}%` } : null; };
    const y = (a0, a1) => ({ top: `${(Math.max(0, a0) / cap * 100).toFixed(2)}%`, height: `${(Math.max(0.04 * cap, Math.min(cap, a1) - Math.max(0, a0)) / cap * 100).toFixed(2)}%` });
    const bars = [];
    for (const { p, r } of all) {
      const f = e.footprint(p, r), from = e.occupancyFrom(p, r), through = e.occupancyThrough(p, r), end = through === Infinity ? new Date(z) : E.addDays(through, 1);
      const where = x(from, end);
      if (!where) continue;
      const ys = f ? y(f.a0, f.a1) : r.partial ? y(0, r.len) : y(0, cap);
      const failedOn = failureDay(p, r), failed = E.validDate(failedOn) && failedOn <= App.state.date;
      const title = failed ? `${App.cropLabel(p)} · Failed ${day(failedOn)}` : `${App.cropLabel(p)} · ${span(r.field, r.last)}`;
      bars.push(h('i.cy-bar', { title, style: { ...where, ...ys, '--crop': failed ? 'var(--muted)' : e.cropColor(r.c) } }));
    }
    for (const o of openings) { const where = x(o.from, E.addDays(o.to, 1)); if (where) bars.push(h('i.cy-open', { style: { ...where, ...y(o.a0, o.a1) } })); }
    const date = App.state.date, mark = +date >= a && +date < z ? h('i.cy-now', { style: { left: `${((+date - a) / w * 100).toFixed(2)}%` } }) : null;
    return h('div.card-year', { dataset: { hook: 'card-year' } }, h('div.cy-track', bars, mark), h('div.cy-months', ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map(m => h('span', m))));
  }

  function openingsFor(e, bed) {
    const S = root.LRFSuccession, A = root.LRFAhead, mine = A.state.O.mine;
    if (!openingSource || openingSource.engine !== e || openingSource.bed !== bed || openingSource.mine !== mine) {
      const openings = S.openings(e, { bedId: bed.id, empty: true });
      openingSource = { engine: e, bed, mine, openings: openings.map(opening => ({ opening, fits: A.fitsIn(e, opening) })) };
    }
    return openingSource.openings;
  }

  function bedPlantingFields(p, r, redraw, readOnly) {
    const e = eng(), Ed = root.LRFPanels.edit, varieties = e.varietiesOf(p.cropId), v = e.variety(p.varietyId), sow = App.sowingOf(p);
    const set = ed => { if (!ed || !App.updatePlanting(p.id, ...ed)) redraw(); };
    const label = r.c.method === 'TP' ? 'Transplant date' : sow && sow.kind === 'field' && sow.done ? 'Planned sowing date' : 'Sowing date';
    const date = h('button.card-date', { type: 'button', name: 'bed-date', disabled: readOnly, dataset: { hook: 'bed-planting-date' },
      'aria-label': `${label}, ${day(E.s2d(p.date))}`, 'aria-haspopup': 'dialog', title: 'See what a date moves before choosing it',
      onclick: ev => openCalendar(p, ev.currentTarget) }, day(E.s2d(p.date)));
    const variety = h('select', { name: 'bed-variety', disabled: readOnly, dataset: { hook: 'bed-planting-variety' },
      onchange: ev => set(Ed.variety(ev.target.value)) }, h('option', { value: '' }, 'No variety chosen'));
    if (v && !varieties.includes(v)) variety.append(h('option', { value: v.id, selected: true }, `${v.name} (retired)`));
    for (const item of varieties) variety.append(h('option', { value: item.id, selected: item.id === p.varietyId }, item.name));
    return h('div.bed-planting-fields',
      h('div.card-boxes', h('label.card-box', h('span', label), date), h('label.card-box', h('span', 'Variety'), variety)),
      h('button.link', { type: 'button', dataset: { hook: 'bed-planting-full' }, onclick: () => App.select({ type: 'planting', id: p.id, fromBedSeason: true }) }, 'All of this planting'));
  }

  function bedPlantingRow(x, bed, status, date, readOnly, redraw) {
    const { p, r } = x, e = eng(), f = e.footprint(p, r), through = e.occupancyThrough(p, r);
    const failedOn = failureDay(p, r);
    const failed = E.validDate(failedOn) && failedOn <= date;
    const here = status.crops.some(item => item.planting.id === p.id);
    const turnover = status.resting && e.occupancyFrom(p, r) <= date && date <= through && E.validDate(through);
    const state = failed ? 'failed' : here ? (r.first <= date && date <= r.last ? 'picking' : 'growing') : turnover ? 'turnover' : '';
    const word = { failed: 'Failed', growing: 'Growing', picking: 'Picking', turnover: turnover ? `Turnover · free ${day(E.addDays(through, 1))}` : '' }[state];
    const expanded = bedRow?.id === p.id, part = r.partial && f ? ` · ${num(f.a0, 1)}–${num(Math.min(f.a1, r.cap), 1)} ft` : '';
    let press;
    const trigger = h('button.row.card-item.bed-planting-trigger', { type: 'button', 'aria-expanded': String(expanded), dataset: { hook: 'card-planting', planting: p.id },
      onpointerdown: ev => {
        press = { x: ev.clientX, y: ev.clientY };
        if (!readOnly && inView()) root.LRFDrag.watch(ev, { payload: { plantingId: p.id }, label: App.cropLabel(p), color: e.cropColor(r.c) });
      },
      onclick: ev => {
        if (ev.detail && press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 5) return;
        bedRow = expanded ? null : { bedId: bed.id, id: p.id };
        redraw();
      } },
      root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color: e.cropColor(r.c), label: r.c.vname || r.c.name, size: 40 }),
      h('span.bed-planting-copy', h('span.row-name', r.c.vname ? `${r.c.name} · ${r.c.vname}` : r.c.name), h('span.row-detail', `${day(r.field)} · pick ${r.harvestDays ? picked(r) : 'none'}${part}`)),
      h('span.bed-planting-tail', word ? h('span.row-word', { dataset: { hook: 'bed-planting-status', state } }, word) : null,
        h('span.bed-planting-chevron', { 'aria-hidden': 'true' }, '›')));
    return h('div.bed-planting', { dataset: { state } }, trigger, expanded ? bedPlantingFields(p, r, redraw, readOnly) : null);
  }

  function bedOpeningCard(bed, item, date) {
    const { opening: o, fits } = item, F = root.LRFForecast, groups = (App.state.plan.lrfNext || {}).groups;
    const next = o.after ? `, after the ${nameOf(o.after)}` : o.before ? `, before the ${nameOf(o.before)}` : '';
    const now = o.from <= date && date <= o.to;
    return h('button.card-open.p-open.bed-opening', { type: 'button', dataset: { hook: 'card-opening', opening: o.id }, title: 'See what fits',
      onclick: () => App.select({ type: 'opening', id: o.id, bedId: bed.id, fromBedSeason: true }) },
      h('b', `Open ${plural(o.days, 'day')}${next}`),
      h('small', `${span(o.from, o.to)}${o.whole ? '' : ` · ${num(o.length, 1)} ft`}`),
      now ? h('small.bed-opening-now', { dataset: { hook: 'bed-opening-now' } }, `Open on ${day(date)}`) : null,
      fits.length ? h('span.bed-opening-fits', fits.slice(0, 3).map(t => h('span', { dataset: { hook: 'bed-opening-fit' } }, t.crop.name,
        t.units > 0 ? ` · ${F.amount(t.units, t.unit, F.groupOf(t.crop, t.unit, groups))}` : '')),
      fits.length > 3 ? h('span', `+${num(fits.length - 3)} more`) : null) : null);
  }

  function bedSeason(bed, all, status) {
    const e = eng(), date = App.state.date, g = e.gardenOf(bed) || {}, readOnly = !!App.windowState();
    const use = root.LRFForecast.useOfBed(e, bed), panels = root.LRFPanels, items = openingsFor(e, bed);
    let body;
    const redraw = () => {
      const next = bedSeason(bed, all, status);
      const restore = keepBedFocus(body);
      body.replaceWith(next);
      if (restore) restore(next);
    };
    const sale = h('input', { type: 'checkbox', name: 'bed-sale', checked: !use.personal, disabled: readOnly, dataset: { hook: 'card-sale' },
      onchange: ev => { if (!App.setUse('bed', [bed.id], ev.target.checked ? 'commercial' : 'personal')) ev.target.checked = !use.personal; } });
    body = h('div.bed-season', { dataset: { hook: 'bed-season' } },
      h('div.card-acts',
        readOnly ? null : h('button.btn.small', { type: 'button', id: 'bedLayoutEdit', dataset: { hook: 'card-layout' },
          onclick: () => root.LRFMapEdit.open({ bedId: bed.id, returnToBed: true }) }, 'Edit layout'),
        readOnly ? null : h('button.btn.small', { type: 'button', id: 'bedSeries', dataset: { hook: 'card-series' }, onclick: () => App.openAhead({ mode: 'series', bedId: bed.id }) }, 'Plan a series here')),
      bedYear(bed, all, items.map(item => item.opening)),
      h('div.bed-season-use', { id: 'bedUse', dataset: { use: use.use, by: use.by } },
        h('label.card-tick', sale, h('span', 'Grown for sale')),
        UI.help(null, null, panels.useWords, { label: 'What Grown for means', hook: 'use-help', card: { hook: 'use-help-card' } }),
        use.by === 'garden' ? h('small', `As all of ${g.name || 'its garden'}`) : null),
      readOnly ? h('p.card-note', 'Changes are made in the window working on this plan.') : null,
      all.length ? h('div.bed-plantings', all.map(x => bedPlantingRow(x, bed, status, date, readOnly, redraw))) : h('p.card-note', 'Nothing planted here this season.'),
      items.length ? h('section.bed-openings', { id: 'bedOpenings' }, h('h3', 'Openings'), items.map(item => bedOpeningCard(bed, item, date))) : null);
    return body;
  }

  function keepBedFocus(host) {
    const active = document.activeElement;
    if (!host.contains(active) || !active.closest('.bed-season')) return null;
    if (active.matches('.bed-planting-trigger')) {
      const id = active.dataset.planting;
      return next => {
        const row = [...next.querySelectorAll('.bed-planting-trigger')].find(el => el.dataset.planting === id);
        row?.focus({ preventScroll: true });
      };
    }
    const name = active.name;
    return ['bed-date', 'bed-variety', 'bed-sale'].includes(name) ? next => next.querySelector(`[name="${name}"]`)?.focus({ preventScroll: true }) : null;
  }

  function backToBed(id) {
    App.select({ type: 'bed', id });
    if (!bedRow) return;
    const row = [...document.querySelectorAll('.bed-planting-trigger')].find(el => el.dataset.planting === bedRow.id);
    row?.focus();
  }

  function openBedFromMap(bedId, plantingId) {
    bedRow = plantingId ? { bedId, id: plantingId } : null;
    App.select({ type: 'bed', id: bedId });
    if (plantingId) {
      const row = [...document.querySelectorAll('.bed-planting-trigger')].find(el => el.dataset.planting === plantingId);
      row?.scrollIntoView({ block: 'nearest' });
    }
    revealBed(bedId);
  }

  function bedCard(bed) {
    const e = eng(), date = App.state.date, status = e.bedStatus(bed, date), g = e.gardenOf(bed) || {}, unit = e.capUnit(bed), soil = e.isSoilBed(bed), pool = e.isPool(bed);
    const all = e.plantingsIn(bed.id).map(p => ({ p, r: e.calc(p) })).filter(x => x.r).sort((x, y) => x.r.field - y.r.field);
    const kind = { bed: 'Bed', tower: 'Tower', bench: 'Bench', containers: 'Containers' }[e.spaceKind(bed)] || 'Bed';
    const size = soil ? `${num(bed.w, 2)} × ${num(bed.l, 2)} ft · ${num(bed.w * bed.l)} sq ft` : `${num(status.cap)} ${unit}`;
    if (bedSeasonOn(bed)) return [
      head(`${kind} ${bed.bed}`, `${g.name || 'Garden'} · ${size}`, null, () => bedMenu(bed)),
      h('p.card-said', { role: 'status', dataset: { hook: 'card-said' }, hidden: true }),
      h('p.card-sums', { dataset: { hook: 'card-sums' } }, `${plural(all.length, 'planting')} this season · ${status.crops.length ? `${num(status.used, 1)} of ${num(status.cap, 1)} ${unit} planted on ${day(date)}` : status.resting ? `turning over on ${day(date)}` : `free on ${day(date)}`}`),
      bedSeason(bed, all, status)];
    const S = root.LRFSuccession, openings = soil && S && all.length ? S.openings(e, { bedId: bed.id }) : [];
    const editable = root.LRFMapEdit && (soil || !pool), use = root.LRFForecast.useOfBed(e, bed);
    const sale = h('input', { type: 'checkbox', checked: !use.personal, dataset: { hook: 'card-sale' }, onchange: ev => { if (!App.setUse('bed', [bed.id], ev.target.checked ? 'commercial' : 'personal')) draw(); } });
    const now = status.crops.length ? `${num(status.used, 1)} of ${num(status.cap, 1)} ${unit} planted on ${day(date)}` : status.resting ? `turning over on ${day(date)}` : `free on ${day(date)}`;
    const inGround = x => e.occupancyFrom(x.p, x.r) <= date && date <= x.r.last;   // growing or being picked on the map's date
    const rowOf = x => {
      const f = e.footprint(x.p, x.r), here = inGround(x), part = x.r.partial ? ` · ${f ? `${num(f.a0, 1)}–${num(Math.min(f.a1, x.r.cap), 1)} ft` : `${num(x.r.len, 1)} ${unit}`}` : '';
      return h('button.row.card-item' + (here ? '.now' : ''), { type: 'button', dataset: { hook: 'card-planting', planting: x.p.id }, onclick: () => App.select({ type: 'planting', id: x.p.id }) },
        root.LRFThumbs.el({ varietyId: x.p.varietyId, cropId: x.p.cropId, color: e.cropColor(x.r.c), label: x.r.c.vname || x.r.c.name, size: 40 }),
        h('span', h('span.row-name', x.r.c.vname ? `${x.r.c.vname} · ${x.r.c.name}` : x.r.c.name), h('span.row-detail', `${day(x.r.field)} · pick ${x.r.harvestDays ? picked(x.r) : 'none'}${part}`)),
        h('span.row-word', here ? 'In now' : ''));
    };
    const openRow = o => {
      const n = S.fits(e, o).length, next = o.after ? `, after the ${nameOf(o.after)}` : o.before ? `, before the ${nameOf(o.before)}` : '';
      return h('button.card-open', { type: 'button', dataset: { hook: 'card-opening', opening: o.id }, title: 'See what fits', onclick: () => App.select({ type: 'opening', id: o.id, bedId: bed.id }) },
        h('b', `Open ${plural(o.days, 'day')}${next}`), h('small', `${span(o.from, o.to)}${o.whole ? '' : ` · ${num(o.length, 1)} ft`}${n ? ` · ${plural(n, 'crop')} fit` : ''}`));
    };
    return [
      head(`${kind} ${bed.bed}`, `${g.name || 'Garden'} · ${size}`, null, () => bedMenu(bed)),
      h('p.card-said', { role: 'status', dataset: { hook: 'card-said' }, hidden: true }),
      editable || !e.isRack(bed) ? h('div.card-acts',
        editable ? h('button.btn.small', { type: 'button', dataset: { hook: 'card-layout' }, onclick: () => root.LRFMapEdit.open({ bedId: bed.id }) }, 'Edit layout') : null,
        e.isRack(bed) ? null : h('button.btn.small', { type: 'button', dataset: { hook: 'card-series' }, onclick: () => App.openAhead({ mode: 'series', bedId: bed.id }) }, 'Plan a series here')) : null,
      soil ? bedYear(bed, all, openings) : null,
      h('p.card-sums', { dataset: { hook: 'card-sums' } }, `${plural(all.length, 'planting')} this season · ${now}`),
      editable ? h('label.card-tick', sale, h('span', 'Grown for sale'), use.by === 'garden' ? h('small', `As all of ${g.name || 'its garden'}`) : null) : null,
      all.length ? h('div.card-list', all.map(rowOf)) : h('p.card-note', 'Nothing planned here yet. Drag a crop onto this bed.'),
      openings.length ? h('div.card-list.card-opens', openings.map(openRow)) : null];
  }
  function bedMenu(bed) {
    const e = eng(), editable = root.LRFMapEdit && (e.isSoilBed(bed) || !e.isPool(bed));
    return {
      title: App.bedLabel(bed), sub: '',
      items: [
        ['open', 'Open', () => App.select({ type: 'bed', id: bed.id })],
        editable ? ['layout', 'Edit layout…', () => root.LRFMapEdit.open({ bedId: bed.id, returnToBed: bedSeasonOn(bed) })] : null,
        e.isRack(bed) ? null : ['series', 'Plan a series here…', () => App.openAhead({ mode: 'series', bedId: bed.id })],
        bedSeasonOn(bed) ? null : ['full', 'All of this bed…', () => { App.select({ type: 'bed', id: bed.id }); openFull(); }]]
    };
  }

  /** Open what is picked in the side panel, whole, until something else is picked. */
  function openFull() { full = keyOf(App.state.sel); closePops(); draw(); }

  // ── drawing the card ──
  function place() {
    if (!card) return;
    const stage = card.parentElement, view = document.getElementById(App.state.view === 'map' ? 'mapView' : 'timelineView');
    const tools = view && view.querySelector(App.state.view === 'map' ? '.map-tools' : '.tl-tools');
    if (!stage || !view) return;
    const s = stage.getBoundingClientRect(), v = view.getBoundingClientRect(), t = tools ? tools.getBoundingClientRect() : v;
    const top = Math.round(Math.max(v.top, t.bottom) - s.top + 8);
    card.style.top = top + 'px';
    card.style.maxHeight = Math.max(160, Math.round(v.bottom - s.top - top - 12)) + 'px';
  }
  function draw() {
    const standingNow = sync();
    const what = standingNow ? held() : null;
    if (!what) { if (card) { card.remove(); card = null; } closePops(); return; }
    const stage = document.querySelector('.stage');
    if (!card) { card = watchActs(h('aside.card.float.lrf-card', { role: 'dialog', 'aria-label': 'Details', dataset: { hook: 'card' } })); stage.append(card); }
    const controls = () => [...card.querySelectorAll('button, input, select')];
    const keep = card.scrollTop, focus = document.activeElement && card.contains(document.activeElement) ? controls().indexOf(document.activeElement) : -1;
    const restore = keepBedFocus(card);
    clear(card);
    card.dataset.kind = what.kind;
    add(card, what.kind === 'planting' ? plantingCard(what.p, what.r) : bedCard(what.bed));
    place();
    card.scrollTop = keep;
    fillSaid();
    if (restore) restore(card);
    else if (focus >= 0) { const again = controls()[focus]; if (again) again.focus({ preventScroll: true }); }   // the box that was in use keeps the keyboard
  }
  function revealBed(id) {
    requestAnimationFrame(() => {
      if (App.state.view === 'map' && App.state.sel?.type === 'bed' && App.state.sel.id === id && card?.dataset.kind === 'bed') {
        root.LRFMap.revealBed(id, card.getBoundingClientRect());
      }
    });
  }

  // ── the menu: the card's "⋯", and a right-click on a bed or a planting ──
  function closePops() {
    if (menu) { menu.remove(); menu = null; }
    if (cal) { cal.remove(); cal = null; }
    hideHint();
  }
  function popAt(el, x, y) {
    if (!el.isConnected) document.body.append(el);
    const w = el.offsetWidth, hgt = el.offsetHeight;
    el.style.left = Math.round(Math.max(8, Math.min(x, root.innerWidth - w - 8))) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(y, root.innerHeight - hgt - 8))) + 'px';
  }
  function openMenu(spec, anchor, at) {
    const again = menu && anchor && menu.lrfAnchor === anchor;
    closePops();
    if (again) return;
    menu = watchActs(h('div.card-menu', { role: 'menu', dataset: { hook: 'card-menu' } },
      h('div.card-menu-head', h('b', spec.title), spec.sub ? h('small', spec.sub) : null),
      spec.items.map(item => item ? h('button.card-menu-item' + (item[4] === 'bad' ? '.bad' : ''), { type: 'button', role: 'menuitem', dataset: { hook: 'card-menu-item', act: item[0] }, onclick: () => { closePops(); item[2](); } },
        h('span', item[1]), item[3] ? h('kbd', item[3]) : null) : h('hr'))));
    menu.lrfAnchor = anchor || null;
    if (at) popAt(menu, at.x + 4, at.y + 4);
    else { const r = anchor.getBoundingClientRect(); popAt(menu, r.right - 236, r.bottom + 4); }
    const first = menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function onContext(e) {
    if (!on || !inView()) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const bar = t.closest('#tlBody .tl-bar[data-planting]'), fill = t.closest('#mapBeds [data-planting]'), bedEl = t.closest('#map [data-bed]'), row = t.closest('#tlBody .tl-row[data-bed]');
    const pid = (bar && bar.dataset.planting) || (fill && fill.dataset.planting), bedId = !pid && ((bedEl && bedEl.dataset.bed) || (row && !t.closest('.tl-bar') && row.dataset.bed));
    const p = pid ? eng().planting(pid) : null, bed = bedId ? eng().bedOf(bedId) : null;
    if (!p && !bed) return;
    e.preventDefault();
    App.select(p ? { type: 'planting', id: p.id } : { type: 'bed', id: bed.id });
    openMenu(p ? plantingMenu(p) : bedMenu(bed), null, { x: e.clientX, y: e.clientY });
  }
  function onKey(e) {
    if (e.key === 'Escape' && (menu || cal)) { e.stopPropagation(); if (cal) dismissCalendar(); else closePops(); return; }
    if (!menu) return;
    const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items.length; items[((i < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : i) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus(); }
  }
  function onAway(e) {
    if (menu && !menu.contains(e.target) && !(menu.lrfAnchor && menu.lrfAnchor.contains(e.target))) { menu.remove(); menu = null; }
    if (cal && !cal.contains(e.target) && !(cal.lrfAnchor && cal.lrfAnchor.contains(e.target))) { cal.remove(); cal = null; }
  }

  // ── one calendar for a date: it says what a day would move before the day is picked ──
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const WD = d => `${UI.DAYS[d.getDay()]} ${day(d)}`;
  function moves(p, value) {
    const e = eng(), a = e.calc(p), q = { ...p, date: value };
    if (q.sowOn && !q.liveTray && value !== p.date) delete q.sowOn;   // as App.commit holds it: a sowing day set by hand belongs to the date it was set against (Codex on #66)
    const b = e.calc(q);
    if (!a || !b) return null;
    const free = (x, r) => { const t = e.occupancyThrough(x, r); return t === Infinity ? null : E.addDays(t, 1); };
    const by = E.dayDiff(E.s2d(value), E.s2d(p.date)), blockers = e.conflicts(q, b);
    const clash = blockers.filter(o => !o.rest && o.p && o.p.id !== p.id);
    return { by, a, b, freeA: free(p, a), freeB: free(q, b), clash, rest: blockers.find(o => o.rest) };
  }
  function dismissCalendar() {
    const anchor = cal?.lrfAnchor;
    closePops();
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
  }
  function openCalendar(p, anchor) {
    const again = cal && cal.lrfAnchor === anchor;
    closePops();
    if (again) return;
    const r = eng().calc(p), was = E.s2d(p.date);
    let month = new Date(was.getFullYear(), was.getMonth(), 1);
    cal = watchActs(h('div.card.float.card-cal', { role: 'dialog', 'aria-label': 'Move it to', dataset: { hook: 'card-cal' } }));
    cal.lrfAnchor = anchor;
    const says = h('div.card-cal-says', { dataset: { hook: 'card-cal-says' } });
    const keepInView = () => {
      if (!cal.isConnected) return;
      const r = cal.getBoundingClientRect();
      if (r.bottom > root.innerHeight - 8) popAt(cal, r.left, r.top);
    };
    const tell = value => {
      clear(says);
      if (!value) { add(says, h('span', 'Point at a day to see what it would move.')); return; }
      const m = moves(p, value);
      if (!m) { add(says, h('span', 'That day cannot be worked out.')); return; }
      const mv = (k, u, v) => h('span', `${k} ${day(u)} → `, h('b', v ? day(v) : 'stays'));
      add(says, h('p', h('b', WD(E.s2d(value))), ` · ${m.by === 0 ? 'the day it is on' : `${plural(Math.abs(m.by), 'day')} ${m.by > 0 ? 'later' : 'earlier'}`}`),
        m.a.sow && m.a.sow < m.a.field ? h('p', mv('sow', m.a.sow, m.b.sow)) : null,
        h('p', mv('first pick', m.a.first, m.b.first)),
        h('p', mv('ground free', m.freeA, m.freeB)),
        m.clash.length ? h('p.card-cal-warn', `Runs into ${m.clash.length === 1 ? `the ${App.cropLabel(m.clash[0].p)}` : plural(m.clash.length, 'planting')} in this bed`) : null,
        m.rest ? h('p.card-cal-warn', `The bed is resting until ${day(m.rest.through)}`) : null);
      keepInView();
    };
    const grid = h('div.card-cal-grid');
    const title = h('b');
    function fill() {
      clear(grid);
      title.textContent = `${MONTHS_LONG[month.getMonth()]} ${month.getFullYear()}`;
      for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) grid.append(h('span.card-cal-wd', d));
      const blanks = (month.getDay() + 6) % 7, n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      for (let i = 0; i < blanks; i++) grid.append(h('i'));
      for (let k = 1; k <= n; k++) {
        const d = new Date(month.getFullYear(), month.getMonth(), k), value = iso(d), cur = value === p.date;
        grid.append(h('button.card-cal-day' + (cur ? '.cur' : ''), { type: 'button', dataset: { hook: 'card-cal-day', day: value }, 'aria-label': WD(d), 'aria-current': cur ? 'date' : null,
          onpointerenter: () => tell(value), onfocus: () => tell(value),
          onclick: () => { dismissCalendar(); if (value === p.date) return; const ed = root.LRFPanels.edit.date(value); if (!ed || !App.updatePlanting(p.id, ...ed)) draw(); } }, String(k)));
      }
    }
    const step = n => { month = new Date(month.getFullYear(), month.getMonth() + n, 1); fill(); tell(null); keepInView(); };
    add(cal,
      h('header.card-head', h('div.card-title', h('h2', 'Move it to'), h('p.card-sub', `${r.c.vname || r.c.name} · ${App.bedLabel(r.b)}`)),
        h('button.icon-btn.card-x', { type: 'button', 'aria-label': 'Close', onclick: dismissCalendar }, '×')),
      h('div.card-cal-month', title, h('button.icon-btn', { type: 'button', 'aria-label': 'The month before', onclick: () => step(-1) }, '‹'), h('button.icon-btn', { type: 'button', 'aria-label': 'The month after', onclick: () => step(1) }, '›')),
      grid, says);
    fill(); tell(null);
    const a = anchor.getBoundingClientRect(), c = card ? card.getBoundingClientRect() : a;
    document.body.append(cal);
    const w = cal.offsetWidth, x = c.left - w - 12 >= 8 ? c.left - w - 12 : Math.max(8, Math.min(a.left, root.innerWidth - w - 8));
    popAt(cal, x, c.left - w - 12 >= 8 ? a.top - 40 : a.bottom + 6);
    const cur = cal.querySelector('.card-cal-day.cur');
    if (cur) cur.focus({ preventScroll: true });
  }

  // ── the hint on a bar of the Timeline: what it is, in place of its hover text ──
  function hideHint() {
    clearTimeout(hintTimer);
    if (hint) { hint.remove(); hint = null; }
    if (hintBar) { if (hintBar.lrfTitle != null) hintBar.setAttribute('title', hintBar.lrfTitle); hintBar.lrfTitle = null; hintBar = null; }
  }
  function showHint(bar) {
    const e = eng(), p = e.planting(bar.dataset.planting), r = p && e.calc(p);
    if (!r || !bar.isConnected) return;
    const through = e.occupancyThrough(p, r), free = through === Infinity ? null : E.addDays(through, 1), v = e.variety(p.varietyId), sow = r.sow && r.sow < r.field;
    hint = h('div.card-hint', { role: 'tooltip', dataset: { hook: 'card-hint' } },
      h('div.card-hint-head', root.LRFThumbs.el({ varietyId: p.varietyId, cropId: p.cropId, color: e.cropColor(r.c), label: r.c.vname || r.c.name, size: 40 }),
        h('span', h('b', r.c.name), h('small', `${v ? v.name + ' · ' : ''}${App.bedLabel(r.b)}`))),
      h('p', sow ? ['Sow ', h('b', day(r.sow)), ' · '] : null, 'In ', h('b', day(r.field)), r.harvestDays ? [' · Pick ', h('b', day(r.first)), ' to ', h('b', day(r.last))] : null, ' · Free ', h('b', free ? day(free) : 'stays')),
      h('p', r.tw ? `${plural(r.plants, 'site')}` : r.rack ? plural(r.len, 'tray') : `${num(r.physicalLength || r.len, 1)} ${e.capUnit(r.b)} · ${plural(r.rows, 'row')} · ${plural(r.plants, 'plant')}`),
      h('p.card-hint-foot', 'Click to open · right-click for more'));
    document.body.append(hint);
    const b = bar.getBoundingClientRect(), w = hint.offsetWidth, below = b.bottom + 8 + hint.offsetHeight <= root.innerHeight - 8;
    hint.style.left = Math.round(Math.max(8, Math.min(b.left, root.innerWidth - w - 8))) + 'px';
    hint.style.top = Math.round(below ? b.bottom + 8 : b.top - 8 - hint.offsetHeight) + 'px';
  }
  function onOver(e) {
    if (!on || App.state.view !== 'timeline' || e.pointerType === 'touch') return;
    const bar = e.target.closest && e.target.closest('#tlBody .tl-bar[data-planting]');
    if (bar === hintBar) return;
    hideHint();
    if (!bar || document.body.classList.contains('dragging')) return;
    hintBar = bar; bar.lrfTitle = bar.getAttribute('title'); bar.removeAttribute('title');   // one hint, not the browser's as well
    hintTimer = setTimeout(() => showHint(bar), 350);
  }

  // ── the tick, under the Map's "?" ──
  function tick() {
    const box = h('input', { type: 'checkbox', checked: on, dataset: { hook: 'card-try' }, onchange: e => turn(e.target.checked) });
    return h('label.card-try', box, h('span', 'A floating card in place of the side panel, on the Map and the Timeline. Kept in this browser only.'));
  }
  function turn(yes) {
    on = !!yes;
    try { if (on) root.localStorage.setItem(KEY, '1'); else root.localStorage.removeItem(KEY); } catch (_) { /* kept for this page only */ }
    full = ''; settling = false;
    draw();
    root.LRFPanels.redraw();
  }

  function init() {
    UI.answerHere(answer);
    // a drop picks what it planted in the same breath as it plants it: its answer is the card's
    App.on('sel', () => { if (planTick) mark(); });
    App.on('sel', () => {
      const sel = App.state.sel;
      if (sel) settling = false;
      if (keyOf(sel) !== full) full = '';
      if (said && said.key !== keyOf(sel)) said = null;
      if (bedRow && !root.LRFMapEdit.on() && sel?.id !== bedRow.bedId && !sel?.fromBedSeason) bedRow = null;
      closePops();
      draw();
    });   // an answer belongs to the card it was said on
    App.on('plan', () => { planTick = true; clearTimeout(tickTimer); tickTimer = setTimeout(() => { planTick = false; }, 0); note(); draw(); });
    App.on('date', () => { if (card) draw(); });
    App.on('view', () => { closePops(); draw(); });
    App.on('photos', () => { if (card) draw(); });
    App.on('window', () => { if (card) draw(); });
    App.on('refused', () => { note(); if (card) fillSaid(); });
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onAway, true);
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', () => { if (hint || hintBar) hideHint(); });
    document.addEventListener('wheel', () => { if (hint || hintBar) hideHint(); }, { passive: true });
    NARROW.addEventListener('change', () => { draw(); root.LRFPanels.redraw(); });
    root.addEventListener('resize', () => { if (card) place(); closePops(); });
    new MutationObserver(() => draw()).observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });   // Edit layout opened or closed
    draw();
  }

  root.LRFCard = { init, tick, on: () => on, turn, settle() { settling = true; draw(); }, standing, bedSeasonOn, renderBedSeason: bedSeason, backToBed, openBedFromMap, keepBedFocus };
  init();
})(window);
