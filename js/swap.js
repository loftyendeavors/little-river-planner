/* Little River Farm Planner — the variety swap.
 *
 * A variety is sold out: another of the same crop is put in its place in the plantings that used it, in one step with one
 * Undo. Each planting keeps its sowing day. Where the two varieties' days to harvest differ, the harvest moves, and the sheet
 * says by how much before anything changes. Neighbouring plantings stay where they are: an overlap the moved harvest would make
 * is named, and the planting is placed anyway (the grower's rule for a change of days).
 *
 * Left out by default, each with a line that says so:
 *   sown        the seed or the plants are in: a sowing, potting up, hardening off, planting out, moving out, a harvest or a
 *               clearing is recorded on it (SeedLib's own test). It is left as it is, and cannot be ticked. Work that puts in no
 *               seed (amending the bed, side-dressing, care) does not stop a swap: the record is kept as it is on the planting
 *   own days    days to harvest are typed on the planting: unticked, and ticked it takes the new variety and keeps its days
 *   standing, live tray, failed   left as they are, and cannot be ticked
 *
 * Nothing new is written into a plan: a planting's variety is `varietyId`, as before. Where the new variety's nursery time
 * differs from the old one's, the planting's day in the bed (`date`) moves by the difference, so that the sowing day stays the
 * same; a sowing day set by hand (`sowOn`) holds by itself, and such a planting keeps its date.
 *
 * The first half has no DOM and no storage, and runs in the browser and in Node:
 *   LRFSwap.choices(engine, fromId)                  -> the crop's other varieties that can take its place
 *   LRFSwap.preview(engine, fromId, toId, options)   -> what the swap would do, worked out on copies of the plan
 *        options: { ticked: [planting ids] (default: every planting the swap takes), stock: LRFSeedLib.stock(…) }
 * The second half is the sheet (LRFSwap.open), opened from a variety on the Seeds page.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root, require('./engine.js'), require('./library.js'), require('./forecast.js'), require('./seedlib.js'));
  else root.LRFSwap = factory(root, root.LRFEngine, root.LRFLibrary, root.LRFForecast, root.LRFSeedLib);
})(typeof self !== 'undefined' ? self : this, function (root, E, Lib, F, SL) {
  'use strict';

  const TICKABLE = ['swap', 'own-days'];
  const dayOf = d => (E.validDate(d) ? E.d2s(d) : null);
  /** The day a planting is sown: in the nursery for a transplant, in place for anything sown where it grows. */
  const sowDay = r => (r ? r.sow || r.field : null);
  const worthOf = eng => F.build(eng).rows.reduce((n, r) => n + r.worth, 0);
  const withPlantings = (plan, swapped) => ({ ...plan, plantings: plan.plantings.map(p => swapped.get(p.id) || p) });

  /** Why a planting is left out of the swap, or 'swap' / 'own-days'. */
  function stateOf(eng, p, r) {
    if (!r) return 'none';
    if (p.established === true) return 'standing';
    if (p.liveTray) return 'tray';
    if (p.workflow && p.workflow.outcome === 'failed') return 'failed';
    const s = SL.sowing(eng, p);
    if (s && s.sown) return 'sown';
    return eng.pinned(p) ? 'own-days' : 'swap';
  }
  /** The first day the seed or the plants went in, for the line that says a planting is left as it is (SeedLib's sowing kinds). */
  const IN_KINDS = ['sow', 'potup', 'harden', 'field', 'move', 'harvest', 'flip'];
  function doneOn(p) {
    const days = IN_KINDS.map(k => SL.doneDate(p, k)).filter(Boolean).sort();
    return days.length ? days[0] : null;
  }

  function choices(eng, fromId) {
    const from = eng.variety(fromId);
    return from ? eng.varietiesOf(from.cropId).filter(v => v.id !== from.id) : [];
  }

  /**
   * The new record of each planting taken: the new variety, and where the nursery time differs, the day in the bed moved so that
   * the sowing day holds. Worked out on the plan with every one of `list` swapped (a planting's days do not hang on another's).
   */
  function records(eng, list, to) {
    const swapped = new Map();
    for (const p of list) { const after = { ...p, varietyId: to.id }; delete after.variety; swapped.set(p.id, after); }
    const first = E.create(withPlantings(eng.plan, swapped), Lib), moved = [];
    for (const p of list) {
      const was = sowDay(eng.calc(p)), r = first.calc(swapped.get(p.id)), now = sowDay(r);
      if (!was || !now || dayOf(was) === dayOf(now) || p.sowOn || p.liveTray) continue;   // a nursery of none, or a new one, moves the day in the bed too
      const after = { ...swapped.get(p.id), date: E.d2s(E.addDays(E.s2d(p.date), E.dayDiff(was, now))) };
      swapped.set(p.id, after); moved.push(p.id);
    }
    const engine = moved.length ? E.create(withPlantings(eng.plan, swapped), Lib) : first;
    // a planting whose sowing day would still move is not taken: the swap never moves a sowing day
    const holds = new Set(list.filter(p => { const r = engine.calc(swapped.get(p.id)); return r && dayOf(sowDay(r)) === dayOf(sowDay(eng.calc(p))); }).map(p => p.id));
    return { swapped, engine, holds };
  }

  /** What one planting would do: its sowing day, and its harvest before and after. */
  function line(p, r0, after, r1) {
    const row = { id: p.id, bedId: p.bedId, sow: sowDay(r0), field: r0.field, first: r0.first, last: r0.last };
    if (after && r1) Object.assign(row, { fieldNow: r1.field, firstNow: r1.first, lastNow: r1.last, shift: E.dayDiff(r1.first, r0.first), endShift: E.dayDiff(r1.last, r0.last), outMoved: E.dayDiff(r1.field, r0.field) });
    return row;
  }

  /**
   * What the ticked plantings' harvests do, in words, for the sheet: { moves (plantings whose first or last picking moves), said }.
   * A harvest whose first day stays and whose end moves is a move too, and is said.
   */
  function harvestSaid(rows) {
    const num = n => Number(n).toLocaleString('en-US'), days = n => `${num(n)} day${n === 1 ? '' : 's'}`;
    const ticked = rows.filter(r => r.ticked), start = ticked.filter(r => r.shift), endOnly = ticked.filter(r => !r.shift && r.endShift);
    const lo = start.length ? Math.min(...start.map(r => r.shift)) : 0, hi = start.length ? Math.max(...start.map(r => r.shift)) : 0, a = Math.min(Math.abs(lo), Math.abs(hi)), z = Math.max(Math.abs(lo), Math.abs(hi));
    const parts = [];
    if (start.length) parts.push(`${start.length === ticked.length ? '' : `in ${num(start.length)}, `}harvest ${lo === hi ? `${days(z)} ${hi > 0 ? 'later' : 'sooner'}` : lo > 0 || hi < 0 ? `${num(a)} to ${days(z)} ${hi > 0 ? 'later' : 'sooner'}` : `up to ${days(z)} either way`}`);
    if (endOnly.length) parts.push(`in ${num(endOnly.length)}, the harvest starts on the same day and ends on another`);
    return { moves: start.length + endOnly.length, said: parts.length ? parts.join('; ') : 'no harvest moves' };
  }

  function preview(eng, fromId, toId, options = {}) {
    const from = eng.variety(fromId), to = toId ? eng.variety(toId) : null;
    if (!from) return { error: 'That variety is not in the plan.' };
    if (toId && (!to || to.cropId !== from.cropId || to.id === from.id || to.active === false || to.deleted)) return { error: 'Only another variety of the same crop can take its place.' };
    const crop = eng.crop(from.cropId), users = eng.plan.plantings.filter(p => p.varietyId === from.id);
    let rows = users.map(p => { const r = eng.calc(p); return { p, r, state: stateOf(eng, p, r) }; }).filter(x => x.state !== 'none');
    rows.sort((a, b) => (sowDay(a.r) - sowDay(b.r)) || String(a.p.id).localeCompare(String(b.p.id)));
    const ask = options.ticked ? new Set(options.ticked) : null;
    const out = { from, to, crop, plantings: rows.length };
    if (!to) {
      out.rows = rows.map(x => ({ ...line(x.p, x.r), state: x.state, ticked: false, done: doneOn(x.p) }));
      return out;
    }
    // every planting that could be ticked, swapped: what each would do, whether or not it is ticked
    const open = rows.filter(x => TICKABLE.includes(x.state));
    const all = records(eng, open.map(x => x.p), to);
    for (const x of open) if (!all.holds.has(x.p.id)) x.state = 'moves-sowing';
    const tickedIds = new Set(rows.filter(x => TICKABLE.includes(x.state) && (ask ? ask.has(x.p.id) : x.state === 'swap')).map(x => x.p.id));
    // the plan with only the ticked plantings swapped: the totals, the overlaps, the seed and the step
    let picked = rows.filter(x => tickedIds.has(x.p.id)).map(x => x.p);
    let mine = picked.length ? records(eng, picked, to) : { swapped: new Map(), engine: eng, holds: new Set() };
    if (picked.some(p => !mine.holds.has(p.id))) {   // never taken with a sowing day that moves, ticked or not
      for (const p of picked) if (!mine.holds.has(p.id)) { tickedIds.delete(p.id); const x = rows.find(y => y.p === p); x.state = 'moves-sowing'; }
      picked = picked.filter(p => tickedIds.has(p.id));
      mine = picked.length ? records(eng, picked, to) : { swapped: new Map(), engine: eng, holds: new Set() };
    }
    const after = mine.engine, overlaps = [];
    for (const p of picked) {
      const q = mine.swapped.get(p.id), r1 = after.calc(q), before = new Set(eng.conflicts(p, eng.calc(p)).filter(o => o.p).map(o => o.p.id));
      for (const o of r1 ? after.conflicts(q, r1) : []) {
        if (!o.p || before.has(o.p.id)) continue;
        const ro = after.calc(o.p);
        overlaps.push({ id: p.id, other: o.p.id, bedId: q.bedId, otherIn: ro ? ro.field : null, otherSwapped: tickedIds.has(o.p.id) });
      }
    }
    // a pair of two swapped plantings is named once
    const seen = new Set();
    out.overlaps = overlaps.filter(o => { const key = [o.id, o.other].sort().join('|'); if (seen.has(key)) return false; seen.add(key); return true; });
    out.rows = rows.map(x => {
      const ticked = tickedIds.has(x.p.id), q = ticked ? mine.swapped.get(x.p.id) : all.swapped.get(x.p.id), source = ticked ? after : all.engine;
      return { ...line(x.p, x.r, q, q ? source.calc(q) : null), state: x.state, ticked, done: doneOn(x.p), overlaps: out.overlaps.filter(o => o.id === x.p.id || o.other === x.p.id).length };
    });
    out.ops = picked.map(p => ({ before: p, after: mine.swapped.get(p.id) }));
    out.engine = after;
    out.ticked = picked.length;
    out.moved = out.rows.filter(r => r.ticked && (r.shift || r.endShift)).length;
    out.worth = [worthOf(eng), picked.length ? worthOf(after) : worthOf(eng)];
    // seed: what the new variety needs against what is on hand and on order; what the old one still needs
    const need = (e, v) => { const rows = SL.required(e).rows.filter(r => r.variety && r.variety.id === v.id); const r = rows.find(x => x.unit === 'seeds') || rows[0]; return r ? { toSow: r.toSow, unit: r.unit } : null; };
    const unitOf = need(eng, from) || need(after, to) || { unit: 'seeds' }, unit = unitOf.unit, stock = options.stock || {}, held = stock['v:' + to.id + '|' + SL.stockUnit(unit)] || { onHand: 0, onOrder: 0 };
    const was = need(eng, to), now = need(after, to), left = need(after, from);
    const toNow = now ? now.toSow : 0;
    out.seed = { unit, toWas: was ? was.toSow : 0, toNow, onHand: held.onHand, onOrder: held.onOrder, short: Math.max(0, unit === 'g' ? Math.round((toNow - held.onHand - held.onOrder) * 10) / 10 : Math.ceil(toNow - held.onHand - held.onOrder)),
      fromWas: (need(eng, from) || { toSow: 0 }).toSow, fromNow: left ? left.toSow : 0 };
    return out;
  }

  // ───────────────────────────── the sheet ─────────────────────────────
  // Opened from a variety on the Seeds page. A title, one sentence, the variety that takes its place (with its photograph), the
  // plantings that would change (each can be unticked), what the change would do, and one foot: Cancel, and the one dark button.
  // Nothing is written until that button is pressed; then one step, with one Undo, and the answer stands where it was asked.
  let sheet = null, said = null;
  const LEFT_WORDS = {
    sown: d => `Sown ${d}: left as it is`,
    standing: () => 'Standing in the ground: left as it is',
    tray: () => 'A live tray: change it in the Nursery',
    failed: () => 'Marked failed: left as it is',
    'moves-sowing': () => 'Its sowing day would move: left as it is'
  };
  function open(fromId, onDone) {
    const App = root.LRFApp, UI = root.LRFUI, T = root.LRFThumbs, { h, clear, add, num, day } = UI;
    if (sheet || !App || !App.state.ready) return null;
    const eng0 = App.state.engine, from = eng0.variety(fromId);
    if (!from) return null;
    const crop = eng0.crop(from.cropId), others = choices(eng0, from.id);
    const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
    const money = n => '$' + Math.round(n).toLocaleString('en-US');
    // a supplier's days are said with where they are counted from: 45 days from seeding is a sooner harvest than 41 from planting out
    const FROM = { seed: ' from seeding', direct: ' sown in place', transplant: ' from planting out' };
    const daysOf = v => (v.catalogDtm ? `${v.catalogDtmMax && v.catalogDtmMax !== v.catalogDtm ? `${v.catalogDtm}–${v.catalogDtmMax}` : v.catalogDtm} days${FROM[v.catalogMaturityBasis] || ''}` : v.dtm > 0 ? `${v.dtm} days` : 'the crop’s days');
    const unitWord = u => (u === 'g' ? 'g' : u === 'seeds' ? 'seeds' : u);
    const amount = (n, u) => `${num(n, u === 'g' ? 1 : 0)} ${unitWord(u)}`;
    const color = crop ? eng0.cropColor(crop) : 'var(--line)';
    const state = { to: null, ticked: null };
    // a variety's photograph goes wherever a variety is named
    const photo = v => { const node = T.el({ varietyId: v.id, color, label: v.name, size: 40 }); node.dataset.hook = 'swap-photo'; return node; };
    const pickBox = h('div.sw-picks', { role: 'radiogroup', 'aria-label': `The variety of ${crop ? crop.name : 'this crop'} that takes its place` });
    const listBox = h('div.sw-list', { dataset: { hook: 'swap-list' } }), leftLine = h('p.sw-left', { dataset: { hook: 'swap-left' } });
    const sum = h('div.sw-sum', { 'aria-live': 'polite', dataset: { hook: 'swap-sum' } });
    const apply = h('button.btn.primary', { type: 'button', disabled: true, dataset: { hook: 'swap-apply' } }, 'Put it in their place');
    const cancel = h('button.btn', { type: 'button', dataset: { hook: 'swap-cancel' }, onclick: () => close() }, 'Cancel');
    const stock = App.stockNow();
    const close = () => { if (!sheet) return; sheet = null; el.close(); el.remove(); };

    for (const v of others) {
      const s = stock['v:' + v.id + '|seeds'] || stock['v:' + v.id + '|g'] || stock['v:' + v.id + '|plants'];
      const held = s && (s.onHand || s.onOrder) ? ` · ${num(s.onHand)} on hand${s.onOrder ? `, ${num(s.onOrder)} ordered` : ''}` : ' · no seed on hand';
      pickBox.append(h('label.row.sw-pick', { dataset: { hook: 'swap-pick', variety: v.id } },
        photo(v),
        h('span', h('span.row-name', v.name), h('span.row-detail', `${daysOf(v)}${held}`)),
        h('input', { type: 'radio', name: 'swapTo', value: v.id, 'aria-label': v.name, onchange: () => { state.to = v.id; state.ticked = null; draw(); } })));
    }

    function draw() {
      const eng = App.state.engine, view = preview(eng, from.id, state.to, { ticked: state.ticked, stock });
      if (view.error) { clear(sum).append(h('p.sw-say', view.error)); apply.disabled = true; return; }
      if (state.ticked == null) state.ticked = view.rows.filter(r => r.ticked).map(r => r.id);
      const to = view.to;
      clear(listBox);
      for (const r of view.rows) {
        const b = eng.bedOf(r.bedId), where = b ? App.bedLabel(b) : 'A bed', tickable = TICKABLE.includes(r.state) && !!to;
        const tick = h('input', { type: 'checkbox', checked: r.ticked, disabled: !tickable, 'aria-label': `${where}, sown ${day(r.sow)}`, dataset: { hook: 'swap-tick' },
          onchange: e => { const set = new Set(state.ticked); if (e.target.checked) set.add(r.id); else set.delete(r.id); state.ticked = [...set]; draw(); } });
        let what;
        if (!TICKABLE.includes(r.state)) what = LEFT_WORDS[r.state] ? LEFT_WORDS[r.state](r.done ? day(E.s2d(r.done)) : '') : 'Left as it is';
        else if (!to) what = `harvest ${day(r.first)}`;
        else if (r.shift) what = `harvest ${plural(Math.abs(r.shift), 'day')} ${r.shift > 0 ? 'later' : 'sooner'}, ${day(r.first)} → ${day(r.firstNow)}`;
        else if (r.endShift) what = `harvest ends ${plural(Math.abs(r.endShift), 'day')} ${r.endShift > 0 ? 'later' : 'sooner'}, ${day(r.last)} → ${day(r.lastNow)}`;
        else what = `harvest stays ${day(r.first)}`;
        const notes = [r.state === 'own-days' ? 'its own days, kept' : '', r.outMoved ? `goes in ${plural(Math.abs(r.outMoved), 'day')} ${r.outMoved > 0 ? 'later' : 'sooner'}, ${day(r.field)} → ${day(r.fieldNow)}` : '', r.ticked && r.overlaps ? `overlaps ${plural(r.overlaps, 'planting')}` : ''].filter(Boolean);
        listBox.append(h('label.sw-row' + (tickable ? '' : '.off') + (r.ticked && r.overlaps ? '.warn' : ''), { dataset: { hook: 'swap-row', planting: r.id, state: r.state } }, tick,
          h('span.sw-where', where, h('small', `sown ${day(r.sow)}`)),
          h('span.sw-what', { dataset: { hook: 'swap-shift' } }, what, notes.length ? h('small', notes.join(' · ')) : null)));
      }
      const count = s => view.rows.filter(r => r.state === s).length, sown = count('sown'), own = count('own-days'), rest = view.rows.filter(r => !TICKABLE.includes(r.state) && r.state !== 'sown').length;
      leftLine.textContent = [sown ? `${plural(sown, 'planting')} already sown ${sown === 1 ? 'is' : 'are'} left as ${sown === 1 ? 'it is' : 'they are'}.` : '',
        own ? `${plural(own, 'planting')} with days of ${own === 1 ? 'its' : 'their'} own ${own === 1 ? 'is' : 'are'} left unticked; ticked, ${own === 1 ? 'it takes' : 'they take'} the new variety and ${own === 1 ? 'keeps its' : 'keep their'} days.` : '',
        rest ? `${plural(rest, 'other')} ${rest === 1 ? 'is' : 'are'} left as ${rest === 1 ? 'it is' : 'they are'}.` : ''].filter(Boolean).join(' ');
      leftLine.hidden = !leftLine.textContent;
      clear(sum);
      if (!to) { add(sum, h('p.sw-say', 'Pick the variety that takes its place to see what moves.')); apply.disabled = true; apply.textContent = 'Put it in their place'; return; }
      const harvest = harvestSaid(view.rows);
      const sd = view.seed, worthMoved = Math.abs(view.worth[1] - view.worth[0]) >= 0.5;
      const fig = (label, value, dataset, marked) => h('span' + (marked ? '.warn' : ''), { dataset }, h('i', label), h('b', value));
      add(sum,
        h('p.frame-figs.sw-figs',
          fig('plantings', `${num(view.ticked)} of ${num(view.rows.filter(r => TICKABLE.includes(r.state)).length)}`, { hook: 'swap-count' }),
          fig('harvest', view.ticked ? `${num(harvest.moves)} move${harvest.moves === 1 ? 's' : ''}` : '—', { hook: 'swap-moves' }),
          fig('season’s worth', worthMoved ? `${money(view.worth[0])} → ${money(view.worth[1])}` : `${money(view.worth[0])}, the same`, { hook: 'swap-worth' }),
          fig('overlaps', num(view.overlaps.length), { hook: 'swap-overlaps' }, view.overlaps.length > 0)),
        view.ticked ? h('p.sw-say', { dataset: { hook: 'swap-by' } }, `Every sowing day stays. In ${plural(view.ticked, 'planting')}: ${harvest.said}.`) : h('p.sw-say', 'Nothing is ticked, so nothing would change.'),
        h('p.sw-say' + (sd.short > 0 ? '.warn' : ''), { dataset: { hook: 'swap-seed' } }, `Seed of ${to.name}: ${amount(sd.toNow, sd.unit)} to sow${sd.toWas ? ` (${amount(sd.toWas, sd.unit)} now)` : ''}, ${amount(sd.onHand, sd.unit)} on hand${sd.onOrder ? `, ${amount(sd.onOrder, sd.unit)} ordered` : ''}${sd.short > 0 ? `, ${amount(sd.short, sd.unit)} short` : sd.toNow ? ', enough' : ''}. ${from.name} then needs ${amount(sd.fromNow, sd.unit)}.`),
        view.overlaps.length ? h('ul.sw-overlaps', { dataset: { hook: 'swap-overlap-list' } }, view.overlaps.slice(0, 6).map(o => {
          const b = eng.bedOf(o.bedId), other = eng.planting(o.other);
          return h('li', `${b ? App.bedLabel(b) : 'A bed'}: the moved harvest runs into ${other ? App.cropLabel(other) : 'the next planting'}${o.otherIn ? ` (goes in ${day(o.otherIn)})` : ''}. It is placed anyway, and waits under “To settle”.`);
        }), view.overlaps.length > 6 ? h('li', `and ${num(view.overlaps.length - 6)} more`) : null) : null);
      apply.disabled = !view.ticked;
      apply.textContent = view.ticked ? `Put ${to.name} in ${plural(view.ticked, 'planting')}` : 'Put it in their place';
    }

    apply.addEventListener('click', () => {
      if (apply.disabled || !state.to) return;
      const done = swap(from.id, state.to, state.ticked);
      if (!done) { draw(); return; }
      close();
      if (onDone) onDone(done);
    });
    const el = h('dialog.dialog.sw', { dataset: { hook: 'swap-sheet' }, oncancel: e => { e.preventDefault(); close(); } },
      h('h2', `Put another variety in place of ${from.name}`),
      h('p.dlg-lead', `For when ${from.name} is sold out. Each planting keeps its sowing day; where the days to harvest differ, the harvest moves. Nothing changes until you press the dark button.`),
      h('header.sw-from', photo(from), h('span', h('span.row-name', from.name), h('span.row-detail', `${crop ? crop.name : 'Crop'} · ${daysOf(from)}`))),
      h('h3.sw-h', 'In its place'), pickBox,
      h('h3.sw-h', 'The plantings'), leftLine, listBox,
      sum,
      h('div.sheet-foot', cancel, apply));
    sheet = { el, close, draw, state };
    document.body.append(el); el.showModal(); draw();
    return sheet;
  }

  /** The one function that writes a swap: the ticked plantings take the new variety, as one step. Returns what it did, or null. */
  function swap(fromId, toId, ticked) {
    const App = root.LRFApp, eng = App.state.engine, view = preview(eng, fromId, toId, { ticked, stock: App.stockNow() });
    if (view.error || !view.ops || !view.ops.length) return null;
    const label = `${view.to.name} in place of ${view.from.name}: ${view.ticked} planting${view.ticked === 1 ? '' : 's'}`;
    if (!App.commit(label, view.ops, { unchecked: true })) return null;   // an overlap the moved harvest makes is placed, and listed to settle
    const step = App.state.undo[App.state.undo.length - 1];
    const money = n => '$' + Math.round(n).toLocaleString('en-US'), worthMoved = Math.abs(view.worth[1] - view.worth[0]) >= 0.5;
    const text = [`${view.to.name} is in ${view.ticked} planting${view.ticked === 1 ? '' : 's'} in place of ${view.from.name}`,
      view.moved ? `the harvest moves in ${view.moved} of them` : 'no harvest moves', 'every sowing day stays',
      worthMoved ? `the season’s worth goes from ${money(view.worth[0])} to ${money(view.worth[1])}` : `the season’s worth stays ${money(view.worth[0])}`,
      view.overlaps.length ? `${view.overlaps.length} overlap${view.overlaps.length === 1 ? '' : 's'} to settle` : ''].filter(Boolean).join(' · ');
    said = { fromId, toId, step, text };
    return { step, text, view };
  }
  /** The answer to the last swap, where it was asked (the variety's own panel on Seeds), while it is still the last step. */
  function answer(varietyId) {
    const App = root.LRFApp;
    if (!said || said.fromId !== varietyId || !App.state.undo.includes(said.step)) return null;
    return { text: said.text, canUndo: App.state.undo[App.state.undo.length - 1] === said.step };
  }

  return { choices, preview, harvestSaid, open, swap, answer, isOpen: () => !!sheet, close: () => { if (sheet) sheet.close(); } };
});
