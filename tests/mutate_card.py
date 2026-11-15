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
 ("“All on one page” does nothing", AS, "button.addEventListener('click', () => { ui.way = button.dataset.ahWay; render(); });", "button.addEventListener('click', () => { render(); });"),
 ("the crops with nothing set are put last", YC, "return { order: [...first, ...rest].map(c => c.id),", "return { order: [...rest, ...first].map(c => c.id),"),
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
 ("the mark “DTM” is left off", YC, "The figure the Days to harvest list holds for this crop in this place.' }, 'DTM')", "The figure the Days to harvest list holds for this crop in this place.' }, '')"),
 ("harvest days to the season's end are shown as a number", YC, "box({ key: 'days', mine: hc.days.mine, fallback: hc.season ? 'season' : hc.days.fallback,", "box({ key: 'days', mine: hc.days.mine, fallback: hc.days.fallback,"),
 ("what it comes to gives the amount as its worth", YC, "u.total += line.total; u.worth += line.worth;", "u.total += line.total; u.worth += line.total;"),
 ("the card spills off a laptop's screen", CSS, "table.yc-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }", "table.yc-grid { width: 1500px; border-collapse: collapse; table-layout: fixed; }"),
 # what a box writes
 ("a price typed on the card is written to nothing", YC, "save: k => App.setSell(c.id, { price: k }, k == null ?", "save: k => App.setSell(c.id, {}, k == null ?"),
 ("a yield typed for one place is saved for another", YC, "return App.setYield('crops', c.id, env, y, y == null ?", "return App.setYield('crops', c.id, eng.ENVS.find(e => e !== env), y, y == null ?"),
 ("the card names its step in words of its own", YC, ": `${c.name}: $${fig(k)}${each(unit)}`) }),", ": `${c.name}: priced at $${fig(k)}`) }),"),
 ("8 of every 10 is saved as 8 a plant", YC, "save: v => { const y = v == null ? null : v / k;", "save: v => { const y = v == null ? null : v;"),
 # a week's figure
 ("the label of a weekly box does not say a week", YC, "`Gives, packed, ${per}${weekly ? ' a week' : ''}`;", "`Gives, packed, ${per}`;"),
 ("the season's total is the list's round figure, not the engine's for the plantings there", YC, "const list = at && at.per.length ? at.per : [cell.total],", "const list = [cell.total],"),
 # the keyboard
 ("Tab stays in the box it is in", YC, "to = all.slice(at + 1).find(blank);", "to = all.find(blank);"),
 ("Enter does not take what was typed", YC, "      if (isBox && !await t.commit()) return;\n      looksRight(App.state.engine, q);", "      looksRight(App.state.engine, q);"),
 ("Enter ticks nothing", YC, "const ticked = eng.harvestFor(id).looked === ui.year || App.setLooked(id, true);", "const ticked = true;"),
 ("Enter stays on the crop", YC, "if (next) { ui.cur = next; ui.unit = null; }", "if (false) { ui.cur = next; ui.unit = null; }"),
 ("a crop opened from the checklist has the pointer for typing nowhere", YC, "ui.cur = id; ui.focus = focus ? { blank: true } : null;", "ui.cur = id; ui.focus = null;"),
 ("a letter picks no unit", YC, "} else if (/^[a-z]$/i.test(e.key) && (isBox || t.dataset.yk === 'unit')) {", "} else if (false) {"),
 ("a changed unit is passed over in silence", YC, "ui.unit && ui.unit.id === c.id && ui.unit.from !== unit ? h('small.yc-note.warn'", "false ? h('small.yc-note.warn'"),
 # the tick
 ("the tick is for the year before", AP, "markStep(cropId, 'looked', on ? year : null)", "markStep(cropId, 'looked', on ? year - 1 : null)"),
 ("a mark writes a figure beside itself", AP, "    if (value == null || value === false) delete record[key]; else record[key] = value;\n    if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];\n  });\n  /** Tick a crop", "    if (value == null || value === false) delete record[key]; else { record[key] = value; record.keep = 1; }\n    if (Object.keys(record).length) next.sell[cropId] = record; else delete next.sell[cropId];\n  });\n  /** Tick a crop"),
 ("“Take the tick off” does nothing", YC, "onclick: () => App.setLooked(c.id, false) }, 'Take the tick off')", "onclick: () => {} }, 'Take the tick off')"),
 # the house
 ("the house's line is never on a card", YC, "    if (hc.house.part) {\n", "    if (false) {\n"),
 ("a crop sold in full is still shown as partly kept", EN, "part: !micro && !sellsAll && (!!rule.house || share0 < 100) }", "part: !micro && !sellsAll }"),
 ("“Sold in full…” does not ask", AP, "if (hc.house.sold < 100 && !await UI.confirm({ title: `${c.name}: sold in full?`", "if (false && !await UI.confirm({ title: `${c.name}: sold in full?`"),
 ("the window gives today's worth as the worth afterwards", AP, "const was = worthOf(eng), now = worthOf(E.create(withOps(state.plan, ops, 'do'), Lib)), label = `${c.name}: sold in full`;", "const was = worthOf(eng), now = was, label = `${c.name}: sold in full`;"),
 ("marking a crop for the house writes a share, not a mark", AP, "const ops = hc.house.marked ? null : markStep(cropId, 'house', true);", "const ops = hc.house.marked ? null : markStep(cropId, 'share', 90);"),
 ("what the house keeps is saved as what is sold", YC, "save: k => App.setSell(c.id, { share: k == null ? null : 100 - k },", "save: k => App.setSell(c.id, { share: k == null ? null : k },"),
 ("the farm's switch is thrown whatever is answered", AP, "    if (!ok) return false;\n    const label = on ? 'The house keeps part of some crops'", "    const label = on ? 'The house keeps part of some crops'"),
 ("with the switch off the engine still takes the house's share", EN, "const mk = liveTray || sellsAll ? 1 :", "const mk = liveTray ? 1 :"),
 ("with the switch off the list still has “Sold %”", AS, "hidden: App.state.plan.settings.houseKeeps === false }, 'Sold %')", "hidden: false }, 'Sold %')"),
 ("with the switch off a crop's record still offers the choice", SE, "    if (!hc.house.farm) return h('div.sd-house', { id: 'sdHouse', dataset: { farm: 'off' } }", "    if (false) return h('div.sd-house', { id: 'sdHouse', dataset: { farm: 'off' } }"),
 ("the shares the grower typed are not listed", YC, "return !hc.micro && hc.share.mine != null; });", "return false; });"),
 # the list
 ("the list shows a yield for every place, planted or not", AS, "const away = !!planted && planted.size > 0 && !planted.has(env) && cell.mine == null;", "const away = false;"),
 ("the label is another build's", MN, "Preview " + LABEL, "Preview " + OTHER),
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
