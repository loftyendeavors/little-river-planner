"""Deliberate faults for more than one thing sold from a crop: each is put into a copy of the app, and a line of things_test.cjs
(node) or of things_check.py (page) that passes with no fault in it must then fail.
usage: python3 -I mutate_things.py <app> <scratch> <tests-dir> <plan.json> <dir of the build before> <backup.zip> [node | page | list] [words…]
env FROM=, TO= to run a part, WIDTH= for the page. node: seconds a fault. page: two to three minutes a fault at the most, less where the
check stops at the first line that fails. list: how many faults there are, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, plan, before, backup = [Path(x).resolve() for x in sys.argv[1:7]]
mode = sys.argv[7] if len(sys.argv) > 7 else "node"; words = [w.lower() for w in sys.argv[8:]]
def alone(cmd, timeout, env=None, cwd=None):
    """Runs one check in a process group of its own. When it is done or out of time, that group is stopped, and so is whatever it
    started and left behind (known by a mark put in its environment): its own browsers, and nobody else's."""
    mark = "LRF_FAULT_RUN=%d.%d" % (os.getpid(), time.time_ns())
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd, env={**(env or os.environ), **dict([mark.split("=")])}, start_new_session=True)
    try: out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGTERM)   # the browser's driver closes its browsers when it is asked to stop
        try: out, err = p.communicate(timeout=10)
        except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL); out, err = p.communicate()
        out += "\ntimed out"
    try: os.killpg(p.pid, signal.SIGKILL)
    except OSError: pass
    for pid in [x for x in (os.listdir("/proc") if os.path.isdir("/proc") else []) if x.isdigit()]:
        try:
            if mark.encode() in open("/proc/%s/environ" % pid, "rb").read().split(b"\0"): os.kill(int(pid), signal.SIGKILL)
        except OSError: pass
    return out, err
PN = "js/panels.js"
EN, FC, SU, AP, TH, YC, AS, HV, SR, IO, CSS = "js/engine.js", "js/forecast.js", "js/succession.js", "js/app.js", "js/things.js", "js/yieldcard.js", "js/assume.js", "js/harvestview.js", "js/series.js", "js/planio.js", "css/app.css"
NODE = [
 # a plan nobody has touched
 ("the forecast of every plan is a hair off", FC, "const rate = y.units / picked.length,", "const rate = y.units * 1.0000001 / picked.length,"),
 ("a planting is counted once for every part it gives", FC, "variety.total += inYear; any = true;", "variety.total += inYear; any = true; counted++;"),
 # what counts
 ("a thing that still waits on a figure counts all the same", EN, "          if (t.waits.length) continue;\n", ""),
 ("no price is asked of a thing", EN, "          if (t.price == null) t.waits.push('price');\n", ""),
 ("no share is asked of a thing", EN, "if (from !== 'place' && t.share == null) t.waits.push('share');", "if (false) t.waits.push('share');"),
 ("what one weighs is not asked for", EN, "if (counted && t.weighs == null) t.waits.push('weighs');", "if (false) t.waits.push('weighs');"),
 ("a helper figure typed for another unit is read all the same", EN, "else if (t[t.way] == null || t.of !== own) t.waits.push(t.way);", "else if (t[t.way] == null) t.waits.push(t.way);"),
 ("two things on one place both count", EN, "else if (taken.has(t.place)) t.why = 'taken';", "else if (false) t.why = 'taken';"),
 ("shares that pass 100 both count", EN, "else if (sum[t.from] + t.share > 100 + 1e-9) t.why = 'over';", "else if (false) t.why = 'over';"),
 # a different thing from one place
 ("a thing sold from one place reaches every place", EN, "const there = list.find(t => t.from === 'place' && t.place === env);", "const there = list.find(t => t.from === 'place');"),
 ("the crop's own line keeps the plantings a place thing takes", EN, "if (there) return [own(there, 1)];", "if (there) return [{ ...y, thing: null, name: null }, own(there, 1)];"),
 ("what one weighs is left out of the amount", EN, "cut = weekly ? 1 : clamp(days / Math.max(1, nominal), 0, 1), k = t.counted ? t.weighs : 1;", "cut = weekly ? 1 : clamp(days / Math.max(1, nominal), 0, 1), k = 1;"),
 ("a planting with a yield of its own is given in parts too", EN, "if (!y || y.own || (r.rack && !!r.c.micro)) return null;", "if (!y || (r.rack && !!r.c.micro)) return null;"),
 ("the share sold is not taken off a thing", EN, "units: y.count * part * each * k * y.mk * cut, unit: t.unit,", "units: y.count * part * each * k * cut, unit: t.unit,"),
 # two things out of one bed
 ("a thing out of each bed takes the whole bed", EN, "for (const t of beds) parts.push(own(t, t.share / 100));", "for (const t of beds) parts.push(own(t, 1));"),
 ("the crop's own line is left whole beside a thing out of each bed", EN, "const bedLeft = 1 - beds.reduce((n, t) => n + t.share, 0) / 100,", "const bedLeft = 1,"),
 ("a week's picking is counted as a total", EN, "const each = weekly ? t.yield * days / 7 : t.yield,", "const each = t.yield,"),
 ("a thing's own harvest days are passed over", EN, "const days = t.days ? Math.min(t.days, r.harvestDays) : r.harvestDays,", "const days = r.harvestDays,"),
 ("a thing with harvest days of its own is picked to the planting's last day", EN, "last: addDays(r.first, Math.max(0, days - 1)), slice: part };", "last: r.last, slice: part };"),
 ("a thing is picked from the day after the planting's first picking", EN, "by: 'thing', keep: y.keep, first: r.first, last:", "by: 'thing', keep: y.keep, first: addDays(r.first, 1), last:"),
 # one harvest, packed two ways
 ("packed from the harvest, the amount is multiplied by what one holds", EN, "(t.way === 'weighs' ? t.weighs : 1 / t.holds)", "(t.way === 'weighs' ? t.weighs : t.holds)"),
 ("the share packed another way is not taken off the crop's own line", EN, "const parts = [{ ...y, units: source * Math.max(0, packLeft),", "const parts = [{ ...y, units: source,"),
 ("the share of the harvest is not applied to what is packed", EN, "units: source * t.share / 100 * (t.way", "units: source * (t.way"),
 ("a thing sold by weight is said to hold, not to weigh", EN, "t.way = from !== 'harvest' ? 'yield' : WEIGHED.includes(unit) && !WEIGHED.includes(own) ? 'weighs' : 'holds';", "t.way = from !== 'harvest' ? 'yield' : 'holds';"),
 # the forecast's rows
 ("a thing is added into a row keyed as the crop's own", FC, "key = p.cropId + '|' + y.unit + (y.thing ? '|' + y.thing : ''),", "key = p.cropId + '|' + y.unit,"),
 ("a thing's row is named as the crop", FC, "name: short(crop.name || r.c.name || 'Crop') + (y.thing ? ' · ' + y.name : ''),", "name: short(crop.name || r.c.name || 'Crop'),"),
 ("a thing is sold at the crop's price", FC, "const y = personal ? { ...part, price: 0 } : part;", "const y = personal ? { ...part, price: 0 } : { ...part, price: y0.price };"),
 ("a bouquet is counted among the stems", FC, "const inStems = row => !row.thing || /^(each|stems?)$/i.test(String(row.unit));", "const inStems = row => true;"),
 ("a crop that sells two things is two crops", FC, "const cropCount = rows => rows.filter(r => !r.thing).length + new Set(", "const cropCount = rows => rows.length + 0 * new Set("),
 # plan to a weekly amount
 ("the weekly amount is sized by the crop's own line, whatever is asked", SU, "return parts.find(x => (x.thing || '') === (o.thing || '')) || null;", "return parts[0];"),
 ("the weekly amount of a thing is read from the planting whole", SU, "    const y = eng.yieldOf(p, r), parts = y && eng.soldOf ? eng.soldOf(p, r, y) : null;\n", "    const y = eng.yieldOf(p, r), parts = null;\n"),
 # a backup
 ("a backup loaded over the plan does not carry the list", IO, "      plan.assumptions = prev.assumptions; const n = figures(prev.assumptions);", "      const n = figures(prev.assumptions);"),
 # found by a reader of the build: each passed the checks as they then stood
 ("a thing's total is not cut where its planting's harvest is cut short", EN, "cut = weekly ? 1 : clamp(days / Math.max(1, nominal), 0, 1), k =", "cut = 1, k ="),
 ("a thing's own harvest days no longer rescale its total", EN, "nominal = t.days || Math.max(1, r.expectedHarvestDays),", "nominal = Math.max(1, r.expectedHarvestDays),"),
 ("a thing does not keep as its crop keeps", EN, "by: 'thing', keep: y.keep, first: r.first", "by: 'thing', keep: 0, first: r.first"),
 ("a planting of a variety sold by a unit of its own is given in parts", EN, "      if (v && sellVRule(v.id).unit) return null;\n", ""),
 ("a first thing left nothing is told as a yield that works out to nothing", FC, "if ((!y.set || !(y.units > 0)) && !(parts.length > 1 && y.set))", "if ((!y.set || !(y.units > 0)))"),
 # where a thing is listed, and the readings that take a planting whole
 ("a thing's row is grouped by its own unit, not as its crop is", FC, "group: groupOf(crop, y.thing ? eng.unitOf(crop) : y.unit, own),", "group: groupOf(crop, y.unit, own),"),
 ("read as one figure, a planting gives the crop's own line whatever it feeds", EN, "      if (!parts) return y;\n      const units = parts.reduce(", "      if (true) return y;\n      const units = parts.reduce("),
 ("what is packed does not say how", EN, "packed: { of: y.unit, share: t.share, way: t.way,", "packed0: { of: y.unit, share: t.share, way: t.way,"),
 ("the crop's own weekly amount in a place a thing takes gives no reason", SU, "    if (!o.thing && soldElse(eng, first.p, first.r)) return { error: soldElse(eng, first.p, first.r), like };\n", ""),
 # a planting says which of the two it is grown for
 ("a planting said to be for the thing still gives both", EN, "if (only) return [own(only, 1)];", "if (only && false) return [own(only, 1)];"),
 ("a planting said to be for the thing gives it on its share only", EN, "if (only) return [own(only, 1)];", "if (only) return [own(only, only.share / 100)];"),
 ("a planting said to be for the crop alone is still shared out", EN, "const beds = p.gives === 'first' ? [] : shared,", "const beds = shared,"),
 ("a word that names no thing is read as the crop alone", EN, "const beds = p.gives === 'first' ? [] : shared,", "const beds = p.gives ? [] : shared,"),
]
PAGE = [
 # adding
 ("the window that adds a thing gives another worth", TH, "const { eng, c, hc, x } = ctx, worth = forecast(eng).rows.reduce((n, r) => n + r.worth, 0);", "const { eng, c, hc, x } = ctx, worth = forecast(eng).rows.reduce((n, r) => n + r.worth, 1000);"),
 ("a thing can be added with no name", TH, "      if (!text) { said.dataset.kind = 'bad'; said.textContent = 'Give it a name first: what you call it when you sell it.'; name.focus(); return; }\n", ""),
 ("a thing can be called by the crop's own name", TH, "      if (text.toLowerCase() === String(c.name).toLowerCase() || list.some(t => t.name.toLowerCase() === text.toLowerCase())) { said.dataset.kind = 'bad';", "      if (false) { said.dataset.kind = 'bad';"),
 ("a place of its own is offered to a crop planted in one place", TH, "places = free.length > 1 ? free : [];", "places = eng.ENVS.filter(env => ctx.hc.cells[env].used);"),
 ("a place another thing has is offered again", TH, "free = mine.filter(env => !list.some(t => t.from === 'place' && t.place === env)), places = free.length > 1 ? free : [];", "free = mine, places = free.length > 1 ? free : [];"),
 ("the message on adding says nothing of what it waits on, or of the worth", AP, "    toast(`${label} · not counted yet: it waits on ${thingWaits(t).join(', ')} · the season’s worth stays ${dollars(worth)}`, { label: 'Undo', run: undo });\n    return id;", "    toast(label, { label: 'Undo', run: undo });\n    return id;"),
 ("a thing sold by weight from a counted crop is given no helper row", AP, "if (from !== 'harvest' && eng.WEIGHED.includes(unit) && eng.COUNTED.includes(hc.unit.value)) record.counted = hc.unit.value;", "if (false) record.counted = hc.unit.value;"),
 ("every thing is given the same id", AP, "const id = 't-' + uid(), record =", "const id = 't-1', record ="),
 # the card
 ("an empty box of a thing is not amber", TH, "box({ key: key(t, 'price'), mine: t.price, fallback: null, amber: t.price == null,", "box({ key: key(t, 'price'), mine: t.price, fallback: null, amber: false,"),
 ("“Share of each bed” is shown whatever the crop sells", TH, "if (beds.length) line('bed', 'sharebed', 'Share of each bed', beds.length);", "if (list.length) line('bed', 'sharebed', 'Share of each bed', beds.length);"),
 ("“Share of the harvest” is never shown", TH, "if (packs.length) line('harvest', 'sharepack', 'Share of the harvest', packs.length);", "if (false) line('harvest', 'sharepack', 'Share of the harvest', packs.length);"),
 ("the helper row is never shown", TH, "      if (!all.length) return null;\n      const same =", "      if (true) return null;\n      const same ="),
 ("the helper row is shown for a thing whose yield is in its own unit", TH, "if (t.from !== 'harvest') return t.counted ? { label: `A ${one(t.counted)} weighs, packed`, unit: t.unit, value: t.weighs } : null;", "if (t.from !== 'harvest') return { label: `A ${one(t.counted || t.unit)} weighs, packed`, unit: t.unit, value: t.weighs };"),
 ("the card does not say a thing is not counted", TH, "const needs = () => list.filter(t => !t.counts).map(", "const needs = () => list.filter(t => false).map("),
 ("what is still empty in a thing's column is not named beside the button", YC, "    for (const e of root.LRFThings.of({ eng, c, hc, x: of(eng, c.id), box }).empties()) out.push(e);\n", ""),
 ("the first-picking cell says nothing of a first picking of its own", TH, "`with ${c.name}: its own first picking will go here`", "`with ${c.name}`"),
 ("the crop's own share is shown as 100", TH, "const inForce = kind => 100 - counting.filter(t => t.from === kind).reduce((n, t) => n + t.share, 0);", "const inForce = kind => 100;"),
 ("the share once the others count is not said", TH, "Math.abs(now - typed) > 1e-9 ? h('small.yc-total.warn'", "false ? h('small.yc-total.warn'"),
 ("a place a thing takes stays a column of the crop's own", TH, "const places = cols => { const left = cols.list.filter(env => !taken.has(env)); return left.length ? { ...cols, list: left } : cols; };", "const places = cols => cols;"),
 ("a place is taken from the crop's own columns before its thing counts", TH, "const taken = new Set(counting.filter(t => t.from === 'place').map(t => t.place)), rowsOf = new Map();", "const taken = new Set(list.filter(t => t.from === 'place').map(t => t.place)), rowsOf = new Map();"),
 ("the thing's line under the grid is not named", YC, "k.thing ? `${k.sold}: ` : T.counting.length ? `${c.name}: ` : '',", "'',"),
 ("a thing packed from the harvest is given a yield box", TH, "if (!own) return td(why('none of its own: it is packed from the harvest'));", "if (false) return td(why('none of its own: it is packed from the harvest'));"),
 # what a box writes, and what it says first
 ("a thing's price typed on the card is written to its share", TH, "save: k => save(t, { price: k }, k == null ? 'price emptied' : `$${fig(k)}${each(t.unit)}`, 'price') }), h('span.yc-unit', each(t.unit).trim()));", "save: k => save(t, { share: k }, k == null ? 'price emptied' : `$${fig(k)}${each(t.unit)}`, 'price') }), h('span.yc-unit', each(t.unit).trim()));"),
 ("the figure that completes a thing is taken without asking", AP, "    if (t2.counts !== t.counts || (unitTo && typed)) {\n", "    if (unitTo && typed) {\n"),
 ("every change to a thing that counts asks first", AP, "    if (t2.counts !== t.counts || (unitTo && typed)) {\n", "    if (moved || t2.counts !== t.counts || (unitTo && typed)) {\n"),
 ("turned down, the change is made all the same", AP, "      if (options.asked) options.asked(yes);\n      if (!yes) return false;\n", "      if (options.asked) options.asked(yes);\n"),
 ("the window gives the worth as it is for before and after", AP, "body: `${unitSaid}${what} ${worthTold(was, now).replace(/^t/, 'T')}. No date changes,", "body: `${unitSaid}${what} ${worthTold(was, was).replace(/^t/, 'T')}. No date changes,"),
 ("the window opens with Cancel in focus", AP, "document.body.append(dialog); dialog.showModal(); yes.focus();", "document.body.append(dialog); dialog.showModal();"),
 ("the window gives no difference in words", AP, "const worthTold = (was, now) => `${worthSaid(was, now)}${Math.abs(now - was) >= 0.5 ? `: ${dollars(Math.abs(now - was))} ${now > was ? 'more' : 'less'}` : ''}`;", "const worthTold = (was, now) => worthSaid(was, now);"),
 ("when the window closes the pointer for typing is nowhere", TH, "{ asked: yes => { root.LRFYieldCard.state.focus = yes ? { blank: true, next: true, thing: t.id } : box ? { key: key(t, box) } : null; } });", "{ asked: yes => { } });"),
 ("a figure typed before a window is taken twice", YC, "      if (input.busy) return Promise.resolve(true);\n      input.busy = true;\n", ""),
 ("the window does not say the thing is counted from now on", AP, ": t2.counts && !t.counts ? `${name} has every figure it needs, and is counted from now on. Today", ": t2.counts && !t.counts ? `Today"),
 ("the message after a change gives no worth", AP, "    toast(`${label}${state2 ? ' · ' + state2 : ''} · ${worthTold(was, now)}`, { label: 'Undo', run: undo });\n    return { was, now, counts: t2.counts };", "    toast(label, { label: 'Undo', run: undo });\n    return { was, now, counts: t2.counts };"),
 ("a share is not held to 100", AP, "      if (want + others > 100 + 1e-9) return refuse(", "      if (false) return refuse("),
 ("a share over 100 is dropped without a word", TH, "amber: t.share == null, min: -1e9, label:", "amber: t.share == null, max: 100, label:"),
 ("a share over 100 is told as what the others leave", AP, "      if (!(want >= 0) || want > 100) return refuse('A share is 0 to 100.');\n", ""),
 ("more harvest days than its plantings have are taken", AP, "if (longest != null && want > longest) return refuse(", "if (false) return refuse("),
 ("“Rename…” gives the thing a new record", AP, "      if ('name' in change) x.name = String(change.name).trim().replace(/\\s+/g, ' ').slice(0, 40);\n", "      if ('name' in change) { x.name = String(change.name).trim().replace(/\\s+/g, ' ').slice(0, 40); delete things[id]; id = 't-again'; x.id = id; }\n"),
 ("“Rename…” changes nothing", TH, "close(); await App.setThing(c.id, t.id, { name }, `${c.name}: ${t.name} is now called ${name}`); };", "close(); };"),
 ("the window on the crop's own unit says nothing of what it does to a thing", YC, "        hit ? hit.said : ''].filter(Boolean).join(' ');", "        ''].filter(Boolean).join(' ');"),
 # a counted thing never stops counting without a window
 ("a crop's unit changed on the list drops a thing without a word", AP, "    return !hit || askFirst({ title: label, confirmLabel: 'Apply', body: `${hit.said} No date changes, and one undo takes it back.` });", "    return true;"),
 ("a variety given a unit of its own takes its plantings out of a thing without a word", AP, "return ops ? thingsFirst(v ? v.cropId : '', label, ops).then(ok => ok ? assume(label, ops) : false) : Promise.resolve(false);", "return ops ? assume(label, ops) : Promise.resolve(false);"),
 ("the window on the list gives no worth", AP, "Then: ${after.said}. ${worthTold(was, now).replace(/^t/, 'T')}.` };", "Then: ${after.said}.` };"),
 ("the window on the list does not say how many plantings would feed a thing", AP, "else if ((a.get(t.id) || 0) !== (b.get(t.id) || 0)) says.push(", "else if (false) says.push("),
 # keys
 ("Tab from a thing's box goes on in the card's own order", YC, "    return [from, ...own.slice(at + 1), ...own.slice(0, at), ...all.filter(el => column(el) !== col)];", "    return all;"),
 ("Enter goes to the card's first empty box, whatever column the keys were in", YC, "const to = want.blank ? own.find(blank) || all.find(blank) ||", "const to = want.blank ? all.find(blank) ||"),
 ("a letter on a thing's “Sold by” picks nothing", YC, "      if (isSel && column(t) && /\\|unit$/.test(t.dataset.yk)) root.LRFThings.letter(c, column(t), e.key);   // a thing's own “Sold by”\n", ""),
 # words and marks
 ("the bed-share yield's label does not say what it is a yield of", TH, "const of = t.from === 'bed' ? `${per} of its ${t.share == null ? 'share' : fig(t.share) + ' %'}` : per;", "const of = per;"),
 ("a kind is chosen for him", TH, "disabled: !!off, onchange: () => { add.disabled = false; said.textContent = ''; } })", "disabled: !!off, checked: value === 'bed', onchange: () => { add.disabled = false; said.textContent = ''; } })"),
 ("“Add it” can be pressed before a kind is chosen", TH, "id: 'thGo', disabled: true, title:", "id: 'thGo', disabled: false, title:"),
 ("a kind carries no plain line of its own", TH, "h('small.th-plain', plain), ", ""),
 ("the add window asks “How it comes out of the plan”", TH, "h('legend', 'Which is it?')", "h('legend', 'How it comes out of the plan')"),
 ("a crop with a thing waiting is not among the crops left to set", YC, "any: price || places.length > 0 || things > 0 };", "any: price || places.length > 0 };"),
 ("the checklist does not say a thing is waiting", YC, "const said = w.things ? `${w.price || w.yield ? say + ' · ' : ''}${plural(w.things, 'thing')} waiting` : say;", "const said = say;"),
 ("a thing's empty price is not amber on the list", TH, "cls: '.ah-price' + (t.price == null ? '.amber' : ''),", "cls: '.ah-price',"),
 ("a thing packed from the crop's share is said in the old words", TH, "`packed from ${c.name}’s own share`", "`packed from what ${c.name} is left`"),
 ("a thing cleared in one day does not say which day", TH, "h('span.yc-na', { dataset: { cleared: 'first' } }, `none: cleared in one day, the day ${c.name} is first picked. A day of its own comes with a later build.`)", "why('none: cleared in one day')"),
 # the planting's panel, and the weekly amount's sentence
 ("the planting's panel gives the crop's unit and price for a planting that feeds a thing", PN, "    if (parts) return h('p.help', { id: 'fYieldLine', dataset: { things: String(parts.length) } },", "    if (false) return h('p.help', { id: 'fYieldLine', dataset: { things: String(parts.length) } },"),
 ("the weekly amount of a packed thing gives the crop's yield in the thing's unit", SR, "h('b', 'Sized at '), `${k ? packed : gives}${", "h('b', 'Sized at '), `${gives}${"),
 ("the yield is not turned when a thing is picked gradually", AP, "if (weekly !== (t.pattern === 'weekly') && x.yield != null) x.yield = figure3(", "if (false) x.yield = figure3("),
 ("a thing's harvest days are written to nothing", TH, "save: k => save(t, { days: k }, k == null ? `picked as long as ${c.name}` : `picked for ${k} days`, 'days') })", "save: k => save(t, {}, k == null ? `picked as long as ${c.name}` : `picked for ${k} days`, 'days') })"),
 ("the window on a unit does not say that no figure is turned", AP, "const unitSaid = unitTo ? `No figure is turned into the new unit: ", "const unitSaid = unitTo ? `The unit changes: "),
 ("a tick outlives a thing's change of unit", AP, "        delete record.looked;   // looked at in the unit it was then sold by: to be looked at again\n", ""),
 ("a helper figure is kept when the crop is sold by another unit", TH, "const good = t.of === t.source;", "const good = true;"),
 # taking away
 ("a thing is taken away without asking", AP, "    if (!await UI.confirm({ title: `Take ${t.name} away from ${c.name}?`, confirmLabel: 'Take it away',", "    if (false && !await UI.confirm({ title: `Take ${t.name} away from ${c.name}?`, confirmLabel: 'Take it away',"),
 ("“Take away…” empties the thing and leaves it", AP, "const ops = thingStep(cropId, things => { delete things[id]; });", "const ops = thingStep(cropId, things => { things[id] = { id, n: things[id].n, name: things[id].name, from: things[id].from, unit: things[id].unit }; });"),
 # every page
 ("the Harvest page counts each thing as a crop", HV, "chip('all', 'All', F.cropCount(m.rows.filter(r => r.total > 0))),", "chip('all', 'All', m.rows.filter(r => r.total > 0).length),"),
 ("a bouquet is added into “All stems”", HV, "for (const r of part.filter(r => g !== 'flower' || F.inStems(r))) {", "for (const r of part) {"),
 ("a thing's row has no mark of its own on the Harvest page", HV, "        if (row.thing) body[body.length - 1].dataset.thing = row.thing;   // another thing the crop sells: a row of its own, in its own unit\n", ""),
 ("the list to send leaves the things out", FC, "    for (const row of model.rows) {\n      if (options.group && row.group !== options.group) continue;", "    for (const row of model.rows) {\n      if (row.thing || (options.group && row.group !== options.group)) continue;"),
 ("the spreadsheet leaves the things out", FC, "    for (const row of model.rows) {\n      if (!(row.total > 0)) continue;", "    for (const row of model.rows) {\n      if (row.thing || !(row.total > 0)) continue;"),
 ("the row's button opens the weekly amount on the crop's own line", HV, "onclick: () => App.openAhead({ mode: 'series', by: 'harvest', thing: row.thing, cropId: row.cropId }) }, 'plan…')", "onclick: () => App.openAhead({ mode: 'series', by: 'harvest', thing: '', cropId: row.cropId }) }, 'plan…')"),
 ("the weekly amount offers no choice of thing", SR, "sold.length ? field('Of', h('select', { id: 'srThing',", "false ? field('Of', h('select', { id: 'srThing',"),
 ("the weekly amount is sized by the crop's own line though a thing is chosen", SR, "from: P.hFrom, thing: P.thing });\n", "from: P.hFrom, thing: '' });\n"),
 ("the weekly amount does not say what its sizes rest on", SR, "thing: 'its own column on the crop’s card, under Yield and price' }[r.by]", "thing: 'the crop’s own record' }[r.by]"),
 ("“All on one page” has no line for a thing", AS, "for (const line of root.LRFThings.listRows({ eng, c, hc, figCell, places: eng.ENVS.length, house: hc.house.farm })) body.append(line);", "for (const line of []) body.append(line);"),
 ("the list gives a thing another share than the card", TH, "share: t.share == null ? '' : String(t.share), yield:", "share: t.share == null ? '' : String(t.share + 1), yield:"),
 ("a price typed on the list is written to nothing", TH, "save: n => App.setThing(c.id, t.id, { price: n }, `${c.name} · ${t.name}: ${n == null ? 'price emptied' : `$${fig(n)}${each(t.unit)}`}`) }),", "save: n => App.setThing(c.id, t.id, {}, `${c.name} · ${t.name}: ${n == null ? 'price emptied' : `$${fig(n)}${each(t.unit)}`}`) }),"),
 # a laptop's screen, and travelling with the plan
 ("a card with three columns is cut off at a laptop's width", CSS, ".yc-grid td.yc-thing .yc-box input { width: 72px; }", ".yc-grid td.yc-thing .yc-box input { width: 320px; }"),
 ("a backup loaded over the plan does not carry the list", IO, "      plan.assumptions = prev.assumptions; const n = figures(prev.assumptions);", "      const n = figures(prev.assumptions);"),
 ("a planting's days move when a thing counts", EN, "    const effective = p => withHarvestRule(p, effectiveDays(p));", "    const effective = p => { const e = withHarvestRule(p, effectiveDays(p)); return e && !e.micro && thingsOf(p.cropId).some(t => t.counts) ? { ...e, dtm: e.dtm + 1 } : e; };"),
 # a planting says which of the two it is grown for
 ("the planting's panel does not ask which thing it is for", PN, "        givesField,\n", ""),
 ("the answer is kept under another name", AP, "after: changed(before, { gives: want })", "after: changed(before, { given: want })"),
 ("the answer for the thing is saved as the crop alone", PN, "App.setGives(p.id, value === 'both' ? null : value)", "App.setGives(p.id, value === 'both' ? null : 'first')"),
 ("both again leaves a word on the planting", PN, "App.setGives(p.id, value === 'both' ? null : value)", "App.setGives(p.id, value === 'both' ? 'first' : value)"),
 ("the answer says nothing of the season's worth", AP, "toast(`${label} · ${worthSaid(was, now)} · no date moves`,", "toast(`${label} · no date moves`,"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
lo, hi = int(os.environ.get("FROM", "0")), int(os.environ.get("TO", str(len(faults))))
caught, missed, broken, tried = [], [], [], 0
for i, (name, rel, a, b) in [(-1, (None, None, None, None))] + list(enumerate(faults)):
    if name is not None and (i < lo or i >= hi): continue
    if name is None and not faults[lo:hi]: continue
    work = scratch / "mut-things"
    if work.exists(): shutil.rmtree(work)
    shutil.copytree(app, work, ignore=shutil.ignore_patterns("thumbs.json", "farm-map.jpg", "dev")) if mode == "node" else shutil.copytree(app, work)
    if name is not None:
        tried += 1
        text = (work / rel).read_text(encoding="utf-8")
        if text.count(a) != 1:
            broken.append(name); print(f"BROKEN  {name}  the text to change was found {text.count(a)} times", flush=True); continue
        (work / rel).write_text(text.replace(a, b), encoding="utf-8")
    if mode == "node":
        try: stdout, stderr = subprocess.run(["node", str(tests / "things_test.cjs"), str(work), str(plan), str(before / "js")], capture_output=True, text=True, timeout=300).stdout, ""
        except subprocess.TimeoutExpired: stdout, stderr = "", "timed out"
    else:
        # with a fault in it the check stops at the first line that fails: a fault is caught by one line. With none it runs to its end.
        stdout, stderr = alone([sys.executable, "-I", str(tests / "things_check.py"), str(work), str(scratch / "mut-shots"), str(before), str(backup)], 600, env={**os.environ, **({"STOP_AT_FAIL": "1"} if name is not None else {})})
    out = stdout.strip().split("\n")[-1] if stdout.strip() else ""
    try:
        d = json.loads(out); bad = [x["name"] if isinstance(x, dict) else str(x) for x in d.get("failed") or []]; ran = True
    except Exception:
        bad = ["no result: " + (stderr or stdout)[-200:]]; ran = False
    bad = [x for x in bad if not x.startswith("(the test stopped before its end")] or ([] if ran and mode == "node" and not d.get("failed") else bad)
    if name is None: already = unfaulted(bad if ran else [], ran); continue
    fails = len(bad) if ran else 0; bad = [x for x in bad if not ran or (already is not None and x not in already)]
    if bad and ran:
        caught.append(name); print(f"caught  {name}  ->  {len(bad)} failed, first: {str(bad[0])[:110]}", flush=True)
    else:
        missed.append(name); print(f"MISSED  {name}  {bad[:1] if bad or not fails else '(only what fails with no fault in it too)'}", flush=True)
print(json.dumps({"mode": mode, "faults": tried, "caught": len(caught), "missed": missed, "broken": broken}))
