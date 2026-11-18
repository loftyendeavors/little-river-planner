"""Deliberate faults for yield and price, one crop at a time: each is put into a copy of the app, and a line of
yieldcard_check.py that passes with no fault in it must then fail.
usage: python3 -I mutate_card.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part, WIDTH= for the page
page: against yieldcard_check.py (a minute and a half each). list: how many faults there are, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests = [Path(x).resolve() for x in sys.argv[1:4]]
mode = sys.argv[4] if len(sys.argv) > 4 else "page"; words = [w.lower() for w in sys.argv[5:]]
LABEL = os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)"; OTHER = LABEL[:-1] + ("0" if LABEL[-1] != "0" else "1")   # the build's label, as tests/env.sh reads it from the page's own script, and one that is not it
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
YC, AS, AP, EN, SE, MN, CSS = "js/yieldcard.js", "js/assume.js", "js/app.js", "js/engine.js", "js/seeds.js", "js/main.js", "css/app.css"
PAGE = [
 # the page and the checklist
 ("the button opens the list, not one crop at a time", AS, "mode: 'days', way: 'card' };", "mode: 'days', way: 'list' };"),
 ("“All on one page” does nothing", AS, "const was = ui.way; ui.way = button.dataset.ahWay; wayKept(ui.way); render();", "const was = ui.way; render();"),
 ("the page opens on the biggest crop, not on one with nothing set", YC, "ui.cur = ui.order.find(id => made.first.has(id) && ui.first.has(id)) ||", "ui.cur = ui.order.find(id => !ui.first.has(id)) ||"),
 ("the crops with nothing set are not set apart", YC, "first: new Set(first.map(c => c.id)), mine:", "first: new Set(), mine:"),
 ("the rest are smallest first", YC, "big = (a, b) => size(b).worth - size(a).worth ||", "big = (a, b) => size(a).worth - size(b).worth ||"),
 ("the count of what is left counts every crop", YC, "left = ui.order.filter(id => waits(eng, eng.crop(id), eng.harvestFor(id)).any).length;", "left = ui.order.length;"),
 ("the bar counts no tick", YC, "h('p', h('b', `${num(lookedN)} of ${num(ui.order.length)}`)", "h('p', h('b', `${num(0)} of ${num(ui.order.length)}`)"),
 ("the checklist is put in order again at every figure typed", YC, "if (!ui.order.length || ui.scope !== scope || ui.year !== year) {", "if (true) {"),
 ("a click on a crop of the checklist does not open it", YC, "onclick: () => open(id, true) },", "onclick: () => {} },"),
 # the card's columns, rows and boxes
 ("a column for every place the farm has, planted or not", YC, "if (planted.length) return { list: eng.ENVS.filter(env => x.places.has(env) || hc.cells[env].mine != null), planted: true };", "if (planted.length) return { list: eng.ENVS.filter(env => hc.cells[env].used), planted: true };"),
 ("the price box is never amber", YC, "fallback: hc.price.fallback, amber: w.price, label:", "fallback: hc.price.fallback, amber: false, label:"),
 ("an amber box shows a starting value in grey", YC, "placeholder: amber || fallback == null ? '' :", "placeholder: fallback == null ? '' :"),
 ("first picking is the days in the bed and one more, not the DTM", YC, "dataset: { dtm: String(t.value) } }, String(t.value))", "dataset: { dtm: String(t.bed + 1) } }, String(t.bed + 1))"),
 ("first picking is said as DTM again", YC, "dataset: { hook: 'card-first-unit' } }, oneStart ? 'days' : after(t))", "dataset: { hook: 'card-first-unit' } }, oneStart ? 'DTM' : after(t))"),
 ("a crop picked to the season's end is shown on the days side", YC, "dataset: { hook: 'harvest-choice', on: w.season ? 'season' : 'days' } },", "dataset: { hook: 'harvest-choice', on: 'days' } },"),
 ("what it comes to gives the amount as its worth", YC, "u.total += line.total; u.worth += line.worth;", "u.total += line.total; u.worth += line.total;"),
 ("the card spills off a laptop's screen", CSS, "table.yc-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }", "table.yc-grid { width: 1500px; border-collapse: collapse; table-layout: fixed; }"),
 # what a box writes
 ("a price typed on the card is written to nothing", YC, "save: k => App.setSell(c.id, { price: k }, k == null ?", "save: k => App.setSell(c.id, {}, k == null ?"),
 ("a yield typed for one place is saved for another", YC, "return App.setYield('crops', c.id, env, y, y == null ?", "return App.setYield('crops', c.id, eng.ENVS.find(e => e !== env), y, y == null ?"),
 ("the card names its step in words of its own", YC, ": `${c.name}: $${fig(k)}${each(unit)}`) }),", ": `${c.name}: priced at $${fig(k)}`) }),"),
 ("8 of every 10 is saved as 8 a plant", YC, "save: v => { const y = v == null ? null : v / k;", "save: v => { const y = v == null ? null : v;"),
 # a week's figure
 ("the label of a weekly box does not say a week", YC, "`Marketable yield ${PER_SAY[hc.basis]}${weekly ? ' per week' : ''}`;", "`Marketable yield ${PER_SAY[hc.basis]}`;"),
 ("the season's total is the list's round figure, not the engine's for the plantings there", YC, "const list = at && at.per.length ? at.per : [cell.total],", "const list = [cell.total],"),
 # the keyboard
 ("Tab goes to the last empty box, past the next", YC, "to = all.slice(at + 1).find(blank);", "to = all.slice(at + 1).reverse().find(blank);"),
 ("Enter does not take what was typed", YC, "    if (t && t.commit && !await t.commit()) return;\n", ""),
 ("Enter ticks nothing", YC, "const ticked = eng.harvestFor(id).looked === ui.year || App.setLooked(id, true, left.length ?", "const ticked = true || App.setLooked(id, true, left.length ?"),
 ("Enter stays on the crop", YC, "    if (next) ui.cur = next;\n", ""),
 # 7. Enter and what is still empty
 ("Enter ticks a crop that has a box still empty", YC, "if (empties(eng, c).length) { ui.focus = { blank: true }; ui.redraw(); return; }", "if (false) { ui.focus = { blank: true }; ui.redraw(); return; }"),
 ("the button pressed with the mouse goes to the empty box and does not tick", YC, "if (e.detail === 0) enter(null, q); else looksRight(App.state.engine, q, true);", "enter(null, q);"),
 ("what is still empty is not said beside the button", YC, "still.length ? h('p.yc-still', { id: 'ycStill' }", "false ? h('p.yc-still', { id: 'ycStill' }"),
 ("the tick's message does not say what is still empty", YC, "const next = nextAfter(eng, q, id), left = said ? empties(eng, c) : [];", "const next = nextAfter(eng, q, id), left = [];"),
 # 6. the tick's own message
 ("the tick is taken without a word: the message on show is still the figure's", AP, "    toast(`${label}${note ? ' · ' + note : ''}`, { label: 'Undo', run: undo });\n    return true;\n  }\n  /**\n   * Say whom a crop is grown for.", "    return true;\n  }\n  /**\n   * Say whom a crop is grown for."),
 # 4. amber place by place
 ("a yield typed for one place answers for every place", YC, "planted.length ? planted.filter(env => hc.cells[env].mine == null)", "planted.length ? (planted.every(env => hc.cells[env].mine == null) ? planted : [])"),
 ("a crop opened from the checklist has the pointer for typing nowhere", YC, "ui.cur = id; ui.focus = focus ? { blank: true } : null;", "ui.cur = id; ui.focus = null;"),
 # 1. letters
 ("a letter picks no unit, even on “Sold by”", YC, "if (t.dataset.yk === 'unit') unitByLetter(App.state.engine, c, e.key);", "if (false) unitByLetter(App.state.engine, c, e.key);"),
 ("a letter in a number box picks a unit", YC, "if (t.dataset.yk === 'unit') unitByLetter(App.state.engine, c, e.key);", "unitByLetter(App.state.engine, c, e.key);"),
 ("a letter in a number box is typed into it: “1e3” is a thousand", YC, "    } else if (/^[a-z]$/i.test(e.key)) {\n", "    } else if (/^[a-z]$/i.test(e.key) && t.dataset.yk === 'unit') {\n"),
 # 2. a unit changed
 ("a unit is changed without asking, whatever the crop holds", YC, "    if (price != null || yields.length || hit) {\n", "    if (false) {\n"),
 ("the window does not say what the price will now mean", YC, "price != null ? `The price stays $${fig(price)}: it will mean $${fig(price)}${each(to)}, where it meant $${fig(price)}${each(was)}.` : '',", "price != null ? `The price stays $${fig(price)}.` : '',"),
 ("turned down, the unit is changed all the same", YC, "body: `No figure is turned into the new unit. ${says} The card will say so until the crop is ticked again, and one undo takes it all back.` })) { ui.redraw(); return false; }", "body: `No figure is turned into the new unit. ${says} The card will say so until the crop is ticked again, and one undo takes it all back.` })) { ui.redraw(); }"),
 ("a changed unit is passed over in silence", YC, "changed && changed.from !== unit ? h('small.yc-note.warn'", "false ? h('small.yc-note.warn'"),
 ("the note about a changed unit is lost when the card is left", YC, "function open(id, focus) {\n    if (!id) return;\n", "function open(id, focus) {\n    if (!id) return;\n    if (id !== ui.cur) ui.units.clear();\n"),
 ("the note about a changed unit outlives the tick", YC, "ui.units.delete(id); ui.turned.delete(id);", "ui.turned.delete(id);"),
 ("a tick outlives a change of unit", AP, "if ('unit' in change && before && before.unit.value !== (record.unit || before.unit.fallback)) delete record.looked;", "if (false) delete record.looked;"),
 ("the window does not say the tick comes off", YC, "hc.looked === year ? `The tick for ${year} comes off, so ${c.name} goes back among the crops to check.` : ''", "''"),
 ("a crop sold one by one is “sold by the each”", YC, "const soldBy = unit => unit === 'each' ? 'sold each' : `sold by the ${unit}`;", "const soldBy = unit => `sold by the ${unit}`;"),
 # 5. "Picked" and what a yield reads
 ("the message does not say what each yield read and reads now", YC, "    UI.toast(`${label} · ${moved.length ?", "    if (false) UI.toast(`${label} · ${moved.length ?"),
 ("what a yield read before is not said beside its box", YC, "const old = was && was.weekly !== weekly && was.cells[env] != null && cell.value != null ? h('small.yc-total.yc-turned'", "const old = false ? h('small.yc-total.yc-turned'"),
 ("the figure a yield read before is given as the one it reads now", YC, "cells: Object.fromEntries(eng.ENVS.map(env => [env, hc.cells[env].value])) });", "cells: Object.fromEntries(eng.ENVS.map(env => [env, hc2.cells[env].value])) });"),
 # 9. from the card to the list
 ("“See what differs…” on the card is words, not a link", YC, "onclick: () => root.LRFAssume.openAudit() }, '“See what differs…”')", "onclick: () => {} }, '“See what differs…”')"),
 ("the link to the list opens it at the top, not at the crop", AS, "    if (ui.mode === 'harvest' && ui.way === 'list' && crop) showRow(crop);\n", ""),
 ("the link to the list leaves the crop's varieties shut", AS, "if (options.varieties) ui.open.add(crop);", "if (false) ui.open.add(crop);"),
 ("“All on one page” opens at the top, not at the card's crop", AS, "if (ui.way === 'list' && was === 'card') showRow(root.LRFYieldCard.current());", ""),
 ("the view last chosen is forgotten when the page is loaded again", AS, "if (kept === 'list' || kept === 'card') ui.way = kept;", ""),
 # 8. a laptop's screen
 ("the heading keeps its lead above the card, which starts further down the page", CSS, ".view-assume .as-head .eyebrow, .nu-head .eyebrow, .sd-title .eyebrow, .view-assume .as-head #asLead, #nuLead { display: none; }", ".view-assume .as-head .eyebrow, .nu-head .eyebrow, .sd-title .eyebrow, #nuLead { display: none; }\n.view-assume .as-head #asLead { flex-basis: 100%; }"),
 ("the grid's rows are tall again, and the facts run under the bar", CSS, ".yc-grid th, .yc-grid td { text-align: left; vertical-align: top; padding: var(--space-4) var(--space-12) var(--space-4) 0;", ".yc-grid th, .yc-grid td { text-align: left; vertical-align: top; padding: 18px 12px 18px 0;"),
 # 3. a backup with no list
 ("the farm's switch is left behind when the list is carried onto a backup", "js/planio.js", "if (prev.settings && prev.settings.houseKeeps === false && !(next.settings && 'houseKeeps' in next.settings)) {", "if (false) {"),
 ("a tick alone is counted as a figure of the list", "js/planio.js", ".filter(line => Object.keys(line || {}).some(k => !MARKS.includes(k))).length + Object.keys(a.sellV || {}).length : 0;", ".length + Object.keys(a.sellV || {}).length : 0;"),
 # figures that cannot be: each is refused by the card alone
 ("more harvest days than a year holds are taken", YC, "fallback: hw.offer, whole: true, min: 1, max: 400, label:", "fallback: hw.offer, whole: true, min: 1, label:"),
 ("12 of every 10 is taken", YC, "amber, max: tenths ? 10 : undefined, label:", "amber, max: undefined, label:"),
 # the tick
 ("the tick is for the year before", AP, "markStep(cropId, 'looked', on ? year : null)", "markStep(cropId, 'looked', on ? year - 1 : null)"),
 ("a mark writes a figure beside itself", AP, "    if (value == null || value === false) delete record[key]; else record[key] = value;\n    if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];\n  });\n  /**\n   * Tick a crop", "    if (value == null || value === false) delete record[key]; else { record[key] = value; record.keep = 1; }\n    if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];\n  });\n  /**\n   * Tick a crop"),
 ("“Take the tick off” does nothing", YC, "onclick: () => App.setLooked(c.id, false) }, 'Take the tick off')", "onclick: () => {} }, 'Take the tick off')"),
 # the house
 ("the personal-use line is never on a card", YC, "    if (hc.house.part) {\n", "    if (false) {\n"),
 ("a crop sold in full is still shown as partly kept", EN, "part: !micro && !sellsAll && (!!rule.house || share0 < 100) }", "part: !micro && !sellsAll }"),
 ("“Sold in full…” does not ask", AP, "if (hc.house.sold < 100 && !await UI.confirm({ title: `${c.name}: sold in full?`", "if (false && !await UI.confirm({ title: `${c.name}: sold in full?`"),
 ("the window gives today's worth as the worth afterwards", AP, "const was = worthOf(eng), now = worthOf(E.create(withOps(state.plan, ops, 'do'), Lib)), label = `${c.name}: sold in full`;", "const was = worthOf(eng), now = was, label = `${c.name}: sold in full`;"),
 ("marking a crop for personal use writes a share, not a mark", AP, "const ops = hc.house.marked ? null : markStep(cropId, 'house', true);", "const ops = hc.house.marked ? null : markStep(cropId, 'share', 90);"),
 ("what is kept for personal use is saved as what is sold", YC, "save: k => App.setSell(c.id, { share: k == null ? null : 100 - k },", "save: k => App.setSell(c.id, { share: k == null ? null : k },"),
 ("the farm's switch is thrown whatever is answered", AP, "    if (!ok) return false;\n    const label = on ? 'Part of some crops is for personal use'", "    const label = on ? 'Part of some crops is for personal use'"),
 ("with the switch off the engine still takes the house's share", EN, "const mk = liveTray || sellsAll ? 1 :", "const mk = liveTray ? 1 :"),
 ("with the switch off the list still has “Sold %”", AS, "hidden: App.state.plan.settings.houseKeeps === false }, 'Sold %')", "hidden: false }, 'Sold %')"),
 ("with the switch off a crop's record still offers the choice", SE, "    if (!hc.house.farm) return h('div.sd-house', { id: 'sdHouse', dataset: { farm: 'off' } }", "    if (false) return h('div.sd-house', { id: 'sdHouse', dataset: { farm: 'off' } }"),
 ("the shares the grower typed are not listed", YC, "return !hc.micro && hc.share.mine != null; });", "return false; });"),
 # the list
 ("the list shows a yield for every place, planted or not", AS, "const away = !!planted && planted.size > 0 && !planted.has(env) && cell.mine == null;", "const away = false;"),
 ("the label is another build's", "js/built.js", 'label: "' + LABEL + '",', 'label: "' + OTHER + '",'),   # the label is written in js/built.js (tools/shared.cjs)
]
if mode == "list": print(json.dumps({"page": len(PAGE)})); sys.exit(0)
faults = PAGE
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
    work = scratch / "mut-card"
    if work.exists(): shutil.rmtree(work)
    shutil.copytree(app, work)
    if name is not None:
        tried += 1
        text = (work / rel).read_text(encoding="utf-8")
        if text.count(a) != 1:
            broken.append(name); print(f"BROKEN  {name}  the text to change was found {text.count(a)} times", flush=True); continue
        (work / rel).write_text(text.replace(a, b), encoding="utf-8")
    stdout, stderr = alone([sys.executable, "-I", str(tests / "yieldcard_check.py"), str(work), str(scratch / "mut-shots")], 500)
    out = stdout.strip().split("\n")[-1] if stdout.strip() else ""
    try:
        d = json.loads(out); bad = [x["name"] if isinstance(x, dict) else str(x) for x in d.get("failed") or []]; ran = True
    except Exception:
        bad = ["no result: " + (stderr or stdout)[-200:]]; ran = False
    if name is None: already = unfaulted(bad if ran else [], ran); continue
    fails = len(bad) if ran else 0; bad = [x for x in bad if not ran or (already is not None and x not in already)]
    if bad and ran:
        caught.append(name); print(f"caught  {name}  ->  {len(bad)} failed, first: {str(bad[0])[:110]}", flush=True)
    else:
        missed.append(name); print(f"MISSED  {name}  {bad[:1] if bad or not fails else '(only what fails with no fault in it too)'}", flush=True)
print(json.dumps({"mode": mode, "faults": tried, "caught": len(caught), "missed": missed, "broken": broken}))
