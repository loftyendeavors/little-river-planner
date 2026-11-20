/* Little River Farm Planner — more than one thing sold from a crop, on the yield and price card.
 *
 * A crop's own line is the first thing it sells: the columns the card always had, one for each place it is planted in. Each
 * other thing is a column of its own after them, headed "what you sell": its own Sold by, Price, yield in its own unit and way
 * of picking. There are three kinds, and "Add something else you sell" asks which:
 *
 *   a different thing from one place   every planting there is sold as this, and no longer as the crop's own line
 *   two things out of one bed          a share of each bed is grown for it
 *   one harvest, packed two ways       a share of the crop's own harvest is packed as it, so many to one or so much each
 *
 * A row is shown only where a column needs it, and a cell that is not needed says why: "Share of each bed" and "Share of the
 * harvest" only where two things come out of the same plantings, the helper row only where one unit has to be turned into
 * another. A thing counts for nothing until every box it needs is filled; until then the crop is forecast exactly as before,
 * and the card says what the thing waits on.
 *
 * It holds no figures of its own. A box reads engine.thingsOf and writes through App.setThing, which says what a change does to
 * the season's worth before it is made. Drawn by js/yieldcard.js, which owns the card.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, F = root.LRFForecast;
  const { h, num } = UI;
  const PLACE = { field: 'Field', tunnel: 'Unheated tunnel', heated: 'Heated greenhouse', tower: 'Towers' };
  const IN = { field: 'in the field', tunnel: 'in the unheated tunnel', heated: 'in the heated greenhouse', tower: 'in the towers' };
  const PATTERN = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };
  const PATTERN_SAY = { weekly: 'picked gradually', once: 'cleared at once', spread: 'picked on demand' };
  const PATTERN_TIP = { spread: 'On demand: its yield is a total, spread evenly over its harvest window.', weekly: 'Gradually: its yield is a week’s picking.', once: 'Clear: its yield is a total, all of it counted the first day it is picked.' };
  const KIND = { place: 'A different thing from one place', bed: 'Two things out of one bed', harvest: 'One harvest, packed two ways' };
  const fig = n => root.LRFAssume.fig(n);
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  const each = unit => unit === 'each' ? ' each' : ' a ' + unit;
  const one = unit => unit === 'each' ? 'single one' : unit;
  const many = unit => unit === 'each' ? '' : F.unitWord(2, unit) || unit;
  const soldBy = unit => unit === 'each' ? 'sold each' : `sold by the ${unit}`;
  const why = text => h('span.yc-na', text);
  const key = (t, what) => `t|${t.id}|${what}`;
  // the forecast of an engine, worked out once: a card is drawn many times over one plan
  const models = new WeakMap();
  const forecast = eng => { if (!models.has(eng)) models.set(eng, F.build(eng)); return models.get(eng); };

  /** The helper row of one thing: the words that say what its box means, the unit after the box, and the figure in it. */
  function helper(t) {
    if (t.from !== 'harvest') return t.counted ? { label: `A ${one(t.counted)} weighs, packed`, unit: t.unit, value: t.weighs } : null;
    const good = t.of === t.source;   // a figure typed while the crop was sold by another unit is not read as one for this unit
    if (t.way === 'weighs') return { label: `A ${one(t.source)} weighs, packed`, unit: t.unit, value: good ? t.weighs : null, stale: !good && t.weighs != null };
    const weighed = App.state.engine.WEIGHED.includes(t.source);
    return { label: weighed ? `A ${one(t.unit)} weighs, packed` : t.unit === 'bouquet' ? 'A bouquet takes' : `A ${one(t.unit)} holds`, unit: weighed ? t.source : many(t.source) || 'of them', value: good ? t.holds : null, stale: !good && t.holds != null };
  }
  /** What a thing is, in the few words under its name. */
  const whence = (t, c, x) => t.from === 'place' ? `${PLACE[t.place] || 'no place'}${x.places.get(t.place) ? ' · ' + plural(x.places.get(t.place).n, 'planting') : ' · nothing planted there now'}` : t.from === 'bed' ? 'a share of each bed' : `packed from ${c.name}’s harvest`;

  /**
   * What the card needs to know of a crop's things. ctx: { eng, c, hc, x (the card's own study of the crop), per, year, box (the
   * card's own box) }. Returns the pieces the card puts in: the columns' headings, the cells of each row, the two share rows and
   * the helper row, the empty boxes, the lines under the grid, and the button that adds a thing.
   */
  function of(ctx) {
    const { eng, c, hc, x, year, box } = ctx, can = !hc.micro && !eng.isCoverCrop(c), list = can ? eng.thingsOf(c.id) : [], per = eng.perSaid(hc.basis, null, true);
    const beds = list.filter(t => t.from === 'bed'), packs = list.filter(t => t.from === 'harvest'), counting = list.filter(t => t.counts);
    const taken = new Set(counting.filter(t => t.from === 'place').map(t => t.place)), rowsOf = new Map();
    if (list.length) for (const line of forecast(eng).rows) if (line.cropId === c.id && line.thing) rowsOf.set(line.thing, line);
    const label = (t, what) => `${c.name} · ${t.name}: ${what}`;
    // When a window asked and was agreed to, the pointer for typing goes to the next box still empty (the thing's own first),
    // or to "Looks right"; turned down, it goes back to the box the figure was typed in.
    const save = (t, change, what, box) => App.setThing(c.id, t.id, change, label(t, what), { asked: yes => { root.LRFYieldCard.state.focus = yes ? { blank: true, next: true, thing: t.id } : box ? { key: key(t, box) } : null; } });

    /** The places left to the crop's own line: one whose plantings a thing that counts now takes is no longer its column. */
    const places = cols => { const left = cols.list.filter(env => !taken.has(env)); return left.length ? { ...cols, list: left } : cols; };   // the crop's own line always keeps a column
    const left = kind => 100 - list.filter(t => t.from === kind).reduce((n, t) => n + (t.share || 0), 0);
    const inForce = kind => 100 - counting.filter(t => t.from === kind).reduce((n, t) => n + t.share, 0);

    const heads = () => list.map(t => h('th.yc-thing' + (t.counts ? '' : '.open'), { scope: 'col', dataset: { thing: t.id, from: t.from, counts: String(t.counts) } },
      h('span.yc-tname', { title: `${KIND[t.from]}. ${t.counts ? 'It is counted in the forecast.' : 'Not counted yet.'}` }, t.name),
      h('small', whence(t, c, x)),
      h('small.yc-tacts', h('span.yc-tstate' + (t.counts ? '.on' : ''), t.counts ? 'counted' : 'not counted yet'),
        h('button.link', { type: 'button', dataset: { thingName: t.id }, title: `Call ${t.name} something else. Nothing but the name changes.`, onclick: () => rename(c, t) }, 'Rename…'),
        h('button.link', { type: 'button', dataset: { thingRemove: t.id }, title: `Take ${t.name} away again. What that does to the season’s worth is shown first.`, onclick: () => App.removeThing(c.id, t.id) }, 'Take away…'))));

    const share = (t, kind) => {
      if (t.from !== kind) return why(t.from === 'place' ? 'all of its own plantings' : kind === 'bed' ? `packed from ${c.name}’s own share` : 'has its own share of the bed');
      const room = left(kind) + (t.share || 0), of = kind === 'bed' ? 'of each bed' : 'of the harvest';
      // no bound of its own: a share that cannot be is refused in a sentence, where the grower can read why
      return h('span.yc-line', box({ key: key(t, 'share'), mine: t.share, fallback: null, amber: t.share == null, min: -1e9, label: label(t, `share ${of}, percent`),
        tip: `The part ${of} that is ${kind === 'bed' ? 'grown for' : 'packed as'} ${t.name}. The shares add up to 100 with ${c.name}’s own: at most ${fig(room)} can go here.`,
        save: k => save(t, { share: k }, k == null ? `share ${of} emptied` : `${fig(k)}% ${of}`, 'share') }), h('span.yc-unit', '%'));
    };
    const cells = id => list.map(t => {
      const td = (...kids) => h('td.yc-thing', { dataset: { thing: t.id } }, kids), own = t.from !== 'harvest', u = t.counted || t.unit;
      if (id === 'unit') return td(h('select.yc-sel.mine', { 'aria-label': label(t, 'sold by'), dataset: { yk: key(t, 'unit') }, title: `What ${t.name} is sold by. Changing it turns no figure into the new unit: it asks first.`,
        onchange: e => save(t, { unit: e.target.value }, soldBy(e.target.value)).then(done => { if (!done) ctx.redraw(); }) },
        [...new Set([...App.THING_UNITS, t.unit])].map(v => h('option', { value: v, selected: v === t.unit }, v))));
      if (id === 'price') return td('$ ', box({ key: key(t, 'price'), mine: t.price, fallback: null, amber: t.price == null, label: label(t, 'price'), tip: t.price == null ? `No price is set, so ${t.name} is not counted yet.` : `Your price for ${t.unit === 'each' ? 'one' : 'one ' + t.unit} of ${t.name}.`,
        save: k => save(t, { price: k }, k == null ? 'price emptied' : `$${fig(k)}${each(t.unit)}`, 'price') }), h('span.yc-unit', each(t.unit).trim()));
      if (id === 'sharebed') return td(share(t, 'bed'));
      if (id === 'sharepack') return td(share(t, 'harvest'));
      if (id === 'yield') {
        if (!own) return td(why('none of its own: it is packed from the harvest'));
        const weekly = t.pattern === 'weekly', how = weekly ? 'a week' : 'in all', nominal = t.days || hc.nominal;
        // a thing out of each bed: its yield is of the part of the bed grown for it, not of the whole bed (the share is taken once)
        const of = t.from === 'bed' ? `${per} of its ${t.share == null ? 'share' : fig(t.share) + ' %'}` : per;
        return td(h('span.yc-line', box({ key: key(t, 'yield'), mine: t.yield, fallback: null, amber: t.yield == null, label: label(t, `yield, ${per}${weekly ? ' a week' : ''}`),
          tip: `What ${t.from === 'bed' ? `${per} of the part of each bed grown for ${t.name}` : per} gives of ${t.name}, packed, ${weekly ? 'each week it is picked' : 'in all'}, in ${u === 'each' ? 'ones' : many(u)}.${t.from === 'bed' ? ' The share above is taken once: this is not a figure for the whole bed.' : ''}${t.counted ? ` It is sold by the ${t.unit}: the row below turns the one into the other.` : ''}`,
          save: k => save(t, { yield: k }, k == null ? 'yield emptied' : `${fig(k)}${u === 'each' ? '' : ' ' + u} ${how}`, 'yield') }), h('span.yc-unit', u === 'each' ? '' : u)),
          h('small.yc-total', { dataset: { of } }, t.yield == null ? `${of}, ${how}` : weekly ? `${of}, a week: ${fig(t.yield * nominal / 7)} over ${nominal} days` : t.pattern === 'once' ? `${of}, in all, the day it is cleared` : `${of}, in all: about ${fig(t.yield * 7 / nominal)} a week`));
      }
      if (id === 'helper') {
        const hp = helper(t);
        if (!hp) return td(why('not needed: its yield is in its own unit'));
        return td(h('span.yc-line', box({ key: key(t, 'helper'), mine: hp.value, fallback: null, amber: hp.value == null, label: label(t, hp.label.toLowerCase()),
          tip: `${hp.label}: the one figure that turns ${t.from === 'harvest' ? `${c.name}’s ${many(t.source) || 'own count'} into ${many(t.unit) || t.unit}` : `${many(t.counted) || 'what is counted'} into ${many(t.unit) || t.unit}`}. Nothing else does.${hp.stale ? ` The figure typed before was for another unit, and is not used.` : ''}`,
          save: k => save(t, { helper: k }, k == null ? `${hp.label.toLowerCase()} emptied` : `${hp.label.toLowerCase()} ${fig(k)} ${hp.unit}`, 'helper') }), h('span.yc-unit', hp.unit)),
          h('small.yc-total', { dataset: { helper: hp.label } }, hp.label.replace(/^A /, 'a ').replace(/, packed$/, '')));
      }
      // plantings it comes from that go into their bed fewer days before their days to harvest than this: they start the day after (Codex on #83)
      // named, with the days that apply there: the box's number is kept, so widening the planting brings it back
      const shortOf = t => {
        const list = (eng.plan.plantings || []).filter(p => p.cropId === c.id).map(p => { const r = eng.calc(p), x = r && (eng.soldOf(p, r) || []).find(q => q.thing === t.id); return x && x.asked && (x.ahead || 0) < x.asked ? { p, r, x } : null; }).filter(Boolean);
        const day = d => root.LRFUI.day(d), bed = p => App.bedLabel(eng.bedOf(p.bedId), eng);
        // the day it goes into its bed and the day it is first picked, named: a number that does not apply is never left unsaid
        const say = ({ p, r, x }) => x.ahead ? `in ${bed(p)} it goes into its bed ${day(r.field)}, so it is picked ${x.ahead} day${x.ahead === 1 ? '' : 's'} early there, from ${day(x.first)}`
          : `in ${bed(p)} none can apply: it goes into its bed ${day(r.field)} and is first picked with ${c.name} on ${day(x.first)}`;
        return list.length ? `; ${list.slice(0, 2).map(say).join('; ')}${list.length > 2 ? `; and ${list.length - 2} more` : ''}` : '';
      };
      if (id === 'first') {
        if (!own) return td(why(`with ${c.name}: it is packed from ${c.name}’s harvest`));
        // first picked before the crop's own days to harvest (E2c part 2), as baby carrots are pulled before the big ones are cleared:
        // his to type. Empty, it is picked with the crop. No date of a planting moves; the line under the box says what it comes to
        const envs = t.from === 'place' ? [t.place] : [...x.places.keys()].filter(env => eng.ENVS.includes(env));
        const days = [...new Set(envs.map(env => eng.timingFor(c.id, null, env)).filter(tm => tm && tm.value != null).map(tm => tm.value))];
        // empty, it is 0 days before, in grey as what the plan uses now: picked with the crop; typed, the line under it says what it comes to
        const said = t.before == null ? null
          : (days.length === 1 ? `first picked at ${Math.max(1, days[0] - t.before)} days, ${c.name} at ${days[0]}` : `first picked ${t.before} days before ${c.name}, wherever it grows`) + shortOf(t);
        return td(h('span.yc-line', box({ key: key(t, 'before'), mine: t.before, fallback: 0, whole: true, min: 1, label: label(t, `days before ${c.name}’s first picking`),
          tip: t.before != null ? `Your number: ${t.name} is first picked ${t.before} days before ${c.name}’s days to harvest, and never before a planting is in its bed. No date of a planting moves. Clear it to pick it with ${c.name}.`
            : `Only you can fill this: how many days before ${c.name}’s days to harvest ${t.name} is first picked, as baby carrots are before the big ones. Empty: picked with ${c.name}.`,
          save: k => save(t, { before: k }, k == null ? `first picked with ${c.name}` : `first picked ${k} days before ${c.name}`, 'before') }), h('span.yc-unit', 'days before')),
          said ? h('small.yc-total', { dataset: { hook: 'thing-first-said' } }, said) : null);
      }
      if (id === 'pick') {
        if (!own) return td(why(`as ${c.name} is picked`));
        const fallback = hc.season ? 'season' : hc.days.value;
        return td(h('span.yc-line', h('select.yc-sel' + (t.patternMine ? '.mine' : ''), { 'aria-label': label(t, 'picked'), dataset: { yk: key(t, 'pick') }, title: `${PATTERN_TIP[t.pattern]} Changing between Gradually and the other two turns its yield into a week’s figure, or back into a total.`,
          onchange: e => save(t, { pattern: e.target.value }, PATTERN_SAY[e.target.value]).then(done => { if (!done) ctx.redraw(); }) },
          Object.entries(PATTERN).map(([value, text]) => h('option', { value, selected: t.pattern === value }, text))),
          ' for ', box({ key: key(t, 'days'), mine: t.days, fallback, whole: true, min: 1, max: 400, wide: true, label: label(t, 'harvest days'),
            tip: t.days != null ? `Your number: ${t.name} is picked for ${t.days} days, and never after ${c.name}’s own last picking. Clear it to pick it as long as ${c.name}.` : `Nothing set: it is picked as long as ${c.name} is. Type a number to pick it for fewer days.`,
            save: k => save(t, { days: k }, k == null ? `picked as long as ${c.name}` : `picked for ${k} days`, 'days') }), h('span.yc-unit', 'days')));
      }
      if (id === 'last') return td(!own ? why(`as ${c.name}`) : t.pattern === 'once' ? h('span.yc-na', { dataset: { cleared: 'first' } }, t.before ? `none: cleared in one day, ${t.before} days before ${c.name} is first picked` : `none: cleared in one day, the day ${c.name} is first picked. Days before, above, give it a day of its own.`) : t.days != null ? h('span.yc-line', h('b.yc-fixed', String(t.days)), h('span.yc-unit', `days after the first, and no later than ${c.name}’s`)) : why(`with ${c.name}’s own last picking`));
      return td();
    });

    /** The rows that are there only because of things: `row` and `span` are the card's own. */
    const shareRows = (row, span) => {
      const out = [], line = (kind, id, name, n) => {
        const now = inForce(kind), typed = left(kind);
        out.push(row(id, name, 'they add up to 100', span(h('span.yc-line', h('b.yc-fixed', { dataset: { left: String(now) } }, fig(now)), h('span.yc-unit', `% left for ${c.name} itself`)),
          Math.abs(now - typed) > 1e-9 ? h('small.yc-total.warn', { dataset: { typed: String(typed) } }, `${fig(typed)}% once ${n === 1 ? 'the other is' : 'the others are'} counted`) : null)));
      };
      if (beds.length) line('bed', 'sharebed', 'Share of each bed', beds.length);
      if (packs.length) line('harvest', 'sharepack', 'Share of the harvest', packs.length);
      return out;
    };
    const helperRow = (row, span) => {
      const all = list.map(helper).filter(Boolean);
      if (!all.length) return null;
      const same = all.every(hp => hp.label === all[0].label);
      return row('helper', same ? all[0].label : 'What one holds or weighs', 'the one figure that turns a unit into another', span(why('not needed: its yield is in its own unit')));
    };

    /** The boxes of the things that are amber and empty, in the order they stand on the card. */
    const empties = () => {
      const out = [], order = ['price', 'share', 'yield', 'helper'];
      for (const what of order) for (const t of list) {
        const waits = t.waits.includes(what === 'helper' ? t.way === 'yield' ? 'weighs' : t.way : what);
        if (waits) out.push({ key: key(t, what), say: `${t.name}: ${what === 'helper' ? helper(t).label.toLowerCase() : what === 'share' ? (t.from === 'bed' ? 'its share of each bed' : 'its share of the harvest') : what === 'price' ? 'its price' : 'its yield'}` });
      }
      return out;
    };
    /** Under the grid: what each thing waits on. */
    const needs = () => list.filter(t => !t.counts).map(t => h('span', { dataset: { thingWaits: t.id } }, h('b', t.name), t.waits.length ? ` is not counted yet: it waits on ${App.thingWaits(t).join(', ')}.` : ` is not counted: ${App.thingWhy(t)}.`,
      ` Until then ${c.name} is forecast exactly as if ${t.name} had not been added.`));
    /** Plantings of the crop that no thing reaches, and why. */
    const apart = () => {
      if (!counting.length) return null;
      const ownUnit = eng.plan.plantings.filter(p => { if (p.cropId !== c.id) return false; const v = eng.variety(p.varietyId); return !!v && v.cropId === c.id && !!eng.sellVRule(v.id).unit; }).length;
      return ownUnit ? `${plural(ownUnit, 'planting')} of a variety sold by a unit of its own ${ownUnit === 1 ? 'is' : 'are'} counted as that variety is sold, whole.` : null;
    };
    const add = () => can ? h('button.btn.yc-add', { type: 'button', id: 'ycAdd', title: `${c.name} sold another way too, by another unit and price: a column of its own, counted once its boxes are filled.`, onclick: () => ask(ctx, list) }, 'Add something else you sell…') : null;
    return { list, any: list.length > 0, counting, places, heads, cells, shareRows, helperRow, empties, needs, apart, add, row: id => rowsOf.get(id) || null, year };
  }

  /** Call a thing something else. */
  function rename(c, t) {
    const input = h('input', { type: 'text', id: 'thRename', value: t.name, maxLength: 40, 'aria-label': 'What you sell' });
    const close = () => { dialog.close(); dialog.remove(); };
    const go = async () => { const name = input.value.trim(); if (!name || name === t.name) return close(); close(); await App.setThing(c.id, t.id, { name }, `${c.name}: ${t.name} is now called ${name}`); };
    const dialog = h('dialog.dialog', { id: 'thRenameDlg', oncancel: e => { e.preventDefault(); close(); } }, h('h2', `${c.name}: another name for ${t.name}`),
      h('p', 'Only the name changes: on the card, the list, the Forecast page and the list to send.'), h('label.field', h('span', 'What you sell'), input),
      h('div.dialog-actions', h('button.btn', { type: 'button', onclick: close }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: go }, 'Rename')));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    document.body.append(dialog); dialog.showModal(); input.select();
  }

  /** "Add something else you sell": its name, what it is sold by, and which of the three kinds it is. Nothing is forecast from it yet. */
  function ask(ctx, list) {
    const { eng, c, hc, x } = ctx, worth = forecast(eng).rows.reduce((n, r) => n + r.worth, 0);
    // a place of its own: one the crop is planted in, that no other thing has, and that leaves the crop's own line a place
    const mine = eng.ENVS.filter(env => x.places.has(env)), free = mine.filter(env => !list.some(t => t.from === 'place' && t.place === env)), places = free.length > 1 ? free : [];
    const name = h('input', { type: 'text', id: 'thName', maxLength: 40, placeholder: 'babies, bouquets, tops off…', 'aria-label': 'What you sell' });
    const unit = h('select', { id: 'thUnit', 'aria-label': 'Sold by' }, [...new Set([...App.THING_UNITS, hc.unit.value])].map(v => h('option', { value: v, selected: v === hc.unit.value }, v)));
    const place = h('select', { id: 'thPlace', 'aria-label': 'Which place', disabled: !places.length }, places.map(env => h('option', { value: env }, `${PLACE[env]} (${plural(x.places.get(env).n, 'planting')})`)));
    const kind = (value, title, plain, text, extra, off) => h('label.th-kind' + (off ? '.off' : ''), h('input', { type: 'radio', name: 'thFrom', value, disabled: !!off, onchange: () => { add.disabled = false; said.textContent = ''; } }), h('span', h('b', title), h('small.th-plain', plain), h('small', text), extra || null));
    const said = h('p.dlg-status', { id: 'thSaid', role: 'status' });
    // not to be pressed until he has said which of the three it is: none is chosen for him
    const add = h('button.btn.primary', { type: 'button', id: 'thGo', disabled: true, title: 'Choose which of the three it is first.', onclick: () => go() }, 'Add it');
    const close = () => { dialog.close(); dialog.remove(); };
    const go = () => {
      const from = (dialog.querySelector('input[name="thFrom"]:checked') || {}).value, text = name.value.trim();
      if (!from) { said.dataset.kind = 'bad'; said.textContent = 'Choose which of the three it is first.'; return; }
      if (!text) { said.dataset.kind = 'bad'; said.textContent = 'Give it a name first: what you call it when you sell it.'; name.focus(); return; }
      if (text.toLowerCase() === String(c.name).toLowerCase() || list.some(t => t.name.toLowerCase() === text.toLowerCase())) { said.dataset.kind = 'bad'; said.textContent = `${c.name} already sells something called ${text}. Give this one another name.`; name.focus(); return; }
      close();
      const id = App.addThing(c.id, { name: text, from, place: from === 'place' ? place.value : undefined, unit: unit.value });
      if (id) root.LRFYieldCard.state.focus = { blank: true };
      ctx.redraw();
    };
    const dialog = h('dialog.dialog.th-add', { id: 'thAdd', oncancel: e => { e.preventDefault(); close(); } },
      h('h2', `${c.name}: something else you sell`),
      h('p', { id: 'thLead' }, `It gets a column of its own on the card, with its own unit, price, yield and way of picking. Nothing is forecast from it until its boxes are filled: the season’s worth stays ${money(worth)}.`),
      h('div.field-pair', h('label.field', h('span', 'What you sell'), name), h('label.field', h('span', 'Sold by'), unit)),
      h('fieldset.th-kinds', h('legend', 'Which is it?'),
        kind('bed', KIND.bed, 'Picked at different times out of one bed.', `A part of each bed of ${c.name} is grown for it. Each has a share of each bed, and its own yield and picking.`),
        kind('harvest', KIND.harvest, 'The same picking, packed two ways.', `A part of what ${c.name} gives is packed as it. Each has a share of the harvest, and one figure says what one of them holds or weighs.`),
        kind('place', KIND.place, 'Everything from one growing place.', places.length ? `Every planting of ${c.name} there is sold as this, and no longer as ${c.name} itself:` : mine.length > 1 ? `Every other place ${c.name} is planted in already has a thing of its own, or is the last one left to ${c.name} itself.` : `${c.name} is planted in one kind of place only, so there is no second place to sell from.`, places.length ? place : null, !places.length)),
      said,
      h('div.dialog-actions', h('button.btn', { type: 'button', onclick: close }, 'Cancel'), add));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    document.body.append(dialog); dialog.showModal(); name.focus();
  }

  /**
   * "All on one page": a line under a crop for each other thing it sells, with the same figures as its column on the card. The
   * price can be typed here too (a price changed in season); the rest is typed on the card, which the name opens.
   * ctx: { eng, c, hc, figCell (the list's own box), places (how many yield columns the list has), house (is "Sold %" shown) }.
   */
  function listRows(ctx) {
    const { eng, c, hc, figCell } = ctx, list = hc.micro || eng.isCoverCrop(c) ? [] : eng.thingsOf(c.id), per = eng.perSaid(hc.basis, null, true);
    if (!list.length) return [];
    const rows = new Map();
    for (const line of forecast(eng).rows) if (line.cropId === c.id && line.thing) rows.set(line.thing, line);
    return list.map(t => {
      const hp = helper(t), own = t.from !== 'harvest', line = rows.get(t.id), u = t.counted || t.unit, weekly = t.pattern === 'weekly';
      const what = [t.from === 'place' ? `everything ${IN[t.place] || 'in its place'}` : t.share == null ? null : `${fig(t.share)}% of ${t.from === 'bed' ? 'each bed' : 'the harvest'}`,
        own && t.yield != null ? `${fig(t.yield)}${u === 'each' ? '' : ' ' + u} ${per}${weekly ? ' a week' : ''}` : null,
        hp && hp.value != null ? `${hp.label.replace(/^A /, 'a ').replace(/, packed$/, '')} ${fig(hp.value)} ${hp.unit}` : null].filter(Boolean).join(' · ');
      const state = t.counts ? 'counted' : t.waits.length ? `not counted yet: waits on ${App.thingWaits(t).join(', ')}` : `not counted: ${App.thingWhy(t)}`;
      return h('tr.as-thing', { dataset: { thing: t.id, crop: c.id, unit: t.unit, price: t.price == null ? '' : String(t.price), share: t.share == null ? '' : String(t.share), yield: t.yield == null ? '' : String(t.yield), helper: hp && hp.value != null ? String(hp.value) : '',
        pattern: own ? t.pattern : '', days: t.days == null ? '' : String(t.days), counts: String(t.counts), total: line ? String(line.total) : '', worth: line ? String(line.worth) : '' } },
        h('td', h('div.as-name', h('span.as-more'), h('span.as-nc', h('button.linkish.as-tname', { type: 'button', title: `Something else ${c.name} sells: ${KIND[t.from].toLowerCase()}. Opens its column on the card, where its figures are typed.`, onclick: () => root.LRFAssume.setMode('harvest', 'card', c.id) }, `↳ ${t.name}`),
          h('small.as-tstate' + (t.counts ? '.on' : ''), state)))),
        h('td.as-start', h('span.as-fixed', { title: `${t.name} is ${soldBy(t.unit)}. Changed on the card.` }, t.unit)),
        figCell({ cls: '.ah-price' + (t.price == null ? '.amber' : ''), key: `tprice|${t.id}`, mine: t.price, fallback: null, open: t.price == null, label: `${c.name} · ${t.name}: price`, tip: t.price == null ? `No price is set, so ${t.name} is not counted yet.` : `Your price for ${t.unit === 'each' ? 'one' : 'one ' + t.unit} of ${t.name}. What a change does to the season’s worth is shown first.`,
          save: n => App.setThing(c.id, t.id, { price: n }, `${c.name} · ${t.name}: ${n == null ? 'price emptied' : `$${fig(n)}${each(t.unit)}`}`) }),
        h('td.as-start', h('span.as-fixed', own ? PATTERN[t.pattern] : 'as the crop')),
        h('td.as-cell.none', own && t.days != null ? String(t.days) : '—'),
        h('td.as-twhat', { colSpan: ctx.places }, what || 'nothing typed yet'),
        h('td.as-seed.ah-comes', line ? [h('b', F.amount(line.total, line.unit, line.group)), h('small', money(line.worth))] : h('small', t.counts ? 'nothing this season' : 'not counted yet')),
        h('td', { hidden: !ctx.house }), h('td'), h('td'));
    });
  }

  /** A letter on a thing's own "Sold by" picks the unit that begins with it; pressed again, the next one that does. */
  function letter(c, id, char) {
    const t = App.state.engine.thingsOf(c.id).find(x => x.id === id);
    if (!t) return false;
    const fit = [...new Set([...App.THING_UNITS, t.unit])].filter(u => u.toLowerCase().startsWith(String(char).toLowerCase()));
    if (!fit.length) return false;
    const to = fit[(fit.indexOf(t.unit) + 1) % fit.length];
    if (to !== t.unit) App.setThing(c.id, id, { unit: to }, `${c.name} · ${t.name}: ${soldBy(to)}`).then(done => { if (!done) root.LRFYieldCard.state.redraw(); });
    return true;
  }

  root.LRFThings = { of, helper, whence, listRows, letter, KIND, PLACE, IN };
})(window);
