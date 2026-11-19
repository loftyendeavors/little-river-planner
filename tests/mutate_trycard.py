"""Deliberate faults for the card, part 1 (redesign build 5), behind its tick "Try the card": the tick, the card in place of the
side panel, the way back and x, each change made through the panel's own function, the one answer, Undo, the menu, the calendar,
the hint on a bar, what stays in the side panel, and To place's two lines. Each is put into a copy of the app folder, and a line of
trycard_check.py that passed with no fault in it must fail.
usage: python3 -I mutate_trycard.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against trycard_check.py (about forty seconds a fault).
list: how many faults there are, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests = [Path(x).resolve() for x in sys.argv[1:4]]
mode = sys.argv[4] if len(sys.argv) > 4 else "page"; words = [w.lower() for w in sys.argv[5:]]
def alone(cmd, timeout, env=None, cwd=None):
    """Runs one check in a process group of its own. When it is done or out of time, that group is stopped, and so is whatever it
    started and left behind (known by a mark put in its environment): its own browsers and services, and nobody else's."""
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
CD, PN, SR, MP, UI, CSS = "js/card.js", "js/panels.js", "js/series.js", "js/map.js", "js/ui.js", "css/app.css"
PAGE = [
 ("off, the card is on as the page opens", CD, "try { on = root.localStorage.getItem(KEY) === '1'; }", "try { on = root.localStorage.getItem(KEY) !== '0'; }"),
 ("off, the side panel gives way all the same", CD, "    if (!on || !App.state.ready || !inView()) return false;", "    if (!App.state.ready || !inView()) return false;"),
 ("the tick is not kept by the browser", CD, "try { if (on) root.localStorage.setItem(KEY, '1'); else", "try { if (on) void 0; else"),
 ("the tick is not in the Map's “?”", MP, "      ...(root.LRFCard ? [['Try the card', root.LRFCard.tick()]] : [])\n", ""),
 ("the side panel stays beside the card", CSS, 'body[data-card="on"] .inspector { display: none; }\n', ""),
 ("the card stands over the map's tools", CD, "const top = Math.round(Math.max(v.top, t.bottom) - s.top + 8);", "const top = Math.round(v.top - s.top + 8);"),
 ("the card is wider than 384", CSS, "width: min(384px, calc(100% - 24px)); overflow-y: auto;", "width: min(404px, calc(100% - 24px)); overflow-y: auto;"),
 ("× does not close the card", CD, "dataset: { hook: 'card-close' }, onclick: () => App.select(null) }, '×'))", "dataset: { hook: 'card-close' }, onclick: () => {} }, '×'))"),
 ("the bed's name does not go back to the bed", CD, "onclick: () => App.select({ type: 'bed', id: bed.id }) }, App.bedLabel(bed));", "onclick: () => {} }, App.bedLabel(bed));"),
 ("a bed's card lists only what is in the ground", CD, "all.map(x => bedPlantingRow(x, bed, status, date, readOnly, redraw))", "all.filter(x => status.crops.includes(x.r)).map(x => bedPlantingRow(x, bed, status, date, readOnly, redraw))"),
 ("the calendar puts the planting a day after the day picked", CD, "const ed = root.LRFPanels.edit.date(value);", "const ed = root.LRFPanels.edit.date(iso(E.addDays(E.s2d(value), 1)));"),
 ("the calendar says nothing before a day is picked", CD, "          onpointerenter: () => tell(value), onfocus: () => tell(value),\n", ""),
 ("the card writes a variety its own way", CD, "dataset: { hook: 'card-variety' }, onchange: ev => set(Ed.variety(ev.target.value)) }", "dataset: { hook: 'card-variety' }, onchange: ev => set([{ varietyId: ev.target.value, variety: ev.target.selectedOptions[0].text }, 'Change variety']) }"),
 ("the card writes a share of the bed its own way", CD, "onchange: ev => set(Ed.length(e, p, ev.target.value)) }", "onchange: ev => set([{ ft: +ev.target.value + 1 }, 'Change length']) }"),
 ("Grown for sale on a planting's card sets its bed", CD, "if (!App.setUse('planting', [p.id], ev.target.checked ? 'commercial' : 'personal')) draw();", "if (!App.setUse('bed', [bed.id], ev.target.checked ? 'commercial' : 'personal')) draw();"),
 ("an answer is said in a toast as well as on the card", UI, "    if (answerTo && answerTo(message, action)) return;", "    if (answerTo) answerTo(message, action);"),
 ("Undo on the card's “Saved” does nothing", CD, "onclick: () => App.undo() }, 'Undo')", "onclick: () => {} }, 'Undo')"),
 ("after a drop with no variety the variety box is not ringed", CD, "    if (justPlanted && !p.varietyId && varieties.length) variety.classList.add('ask');\n", ""),
 ("a bar shows no hint", CD, "    hintTimer = setTimeout(() => showHint(bar), 350);", "    hintTimer = 0;"),
 ("a bar keeps its hover text beside the hint", CD, "bar.lrfTitle = bar.getAttribute('title'); bar.removeAttribute('title');", "bar.lrfTitle = bar.getAttribute('title');"),
 ("a right-click opens the browser's own menu", CD, "    document.addEventListener('contextmenu', onContext);\n", ""),
 ("“Planting details” opens nothing", CD, "onclick: () => openFull() }, 'Planting details')", "onclick: () => {} }, 'Planting details')"),
 ("the card floats over the view again: nothing makes room for it", CSS, "  body[data-card=\"on\"] .stage:has(> .lrf-card) { padding-right: calc(384px + 2 * var(--space-12)); }\n", ""),
 ("Codex on #85: on a phone Grown for sale's \"?\" is 24 high", CSS, "  .lrf-card .card-use .help-btn, .lrf-card .bed-season-use .help-btn { width: var(--control-phone); height: var(--control-phone); }   /* Codex on #85 */\n", ""),
 ("Codex on #85: on a phone Planting details is a line high", CSS, "  .lrf-card .card-foot .link { display: inline-flex; align-items: center; min-height: var(--control-phone); }\n", ""),
 ("Codex on #85: the docked card keeps the floating shadow", CSS, "  .card.float.lrf-card { box-shadow: var(--shadow-card); }", "  .lrf-card { box-shadow: var(--shadow-card); }"),
 ("Codex on #85: the card docks however narrow the window", CSS, "@media (min-width: 1200px) {\n  body[data-card", "@media (min-width: 701px) {\n  body[data-card"),
 ("the map frames the farm again when the card comes", MP, "      if (root.LRFCard && root.LRFCard.docked()) view.moved = true;\n", ""),
 ("Codex on #85: a bed revealed beside the docked card is moved clear of the card, not into the map", MP, "    const cover = card.left >= b.right - 1 ? { left: b.right, right: Infinity, top: -Infinity, bottom: Infinity } : card;", "    const cover = card;"),
 ("Codex on #85: a bed is left under the card when the window widens to dock it", CD, "draw(); if (DOCKED.matches) revealPicked(); });", "draw(); });"),
 ("Codex on #85: a planting's bed is left under the card when the window widens to dock it", CD, "sel && sel.type === 'bed' ? sel.id : p && p.bedId;", "sel && sel.type === 'bed' ? sel.id : null;"),
 ("the list of what to settle has no side panel to stand in", CD, "    if (!sel) return !settling && !App.state.newer;", "    if (!sel) return true;"),
 ("Codex on #66: a change made with no card open is said on the next card", CD, "tickTimer = setTimeout(() => { planTick = false; }, 0); note(); draw(); });", "tickTimer = setTimeout(() => { planTick = false; }, 0); draw(); });"),
 ("Codex on #66: any word at all is said on the card, and goes with it", CD, "    if (!acting && !refusedNow) return false;\n", ""),
 ("Codex on #66: the calendar says a sowing day set by hand stays", CD, "    if (q.sowOn && !q.liveTray && value !== p.date) delete q.sowOn;", "    void 0;"),
 ("Codex on #66: Grown for sale on a bed's card sets its garden", CD, "if (!App.setUse('bed', [bed.id], ev.target.checked ? 'commercial' : 'personal')) draw();", "if (!App.setUse('garden', [bed.gardenId], ev.target.checked ? 'commercial' : 'personal')) draw();"),
 ("Codex on #66: Edit layout opened from the card has no side panel", CD, "    if (root.LRFMapEdit && root.LRFMapEdit.on()) return false;", "    void 0;"),
 ("Edit layout closed, the side panel stays", CD, "    new MutationObserver(() => draw()).observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });", "    void MutationObserver;"),
 ("Codex on #66: one that cannot go to To place loses its card to its bed's", CD, "    if (r && !e.isPool(r.b) && !root.LRFRails.fixed(e, { p })) App.select({ type: 'bed', id: r.b.id });", "    if (r) App.select({ type: 'bed', id: r.b.id });"),
 ("Codex on #66: on a phone the card's controls are 28 high", CSS, "  .card-box select, .card-box input, .card-date, .card-row-head, .card-repeat input, .lrf-card .btn.small, .card-menu-item, .card-cal-day, .card-cal-month .icon-btn { min-height: var(--control-phone); }", "  .card-repeat input { min-height: var(--control-phone); }"),
 ("a drop is answered in a toast", CD, "    App.on('sel', () => { if (planTick) mark(); });\n", ""),
 ("the card writes days to harvest its own way", CD, "onchange: ev => set(Ed.dtm(p, ev.target.value)) }", "onchange: ev => set([{ dtm: +ev.target.value + 1, timingMode: 'manual' }, 'Change days to harvest']) }"),
 ("the card writes harvest days its own way", CD, "onchange: ev => set(Ed.hw(ev.target.value)) }", "onchange: ev => set([{ hw: +ev.target.value + 1, harvestMode: 'window' }, 'Change harvest days']) }"),
 ("“Add” on the card adds one fewer", CD, "onclick: () => App.addSuccessions(p.id, Math.max(1, Math.min(30, Math.round(+count.value) || 1))", "onclick: () => App.addSuccessions(p.id, Math.max(1, Math.min(30, Math.round(+count.value - 1) || 1))"),
 ("“Send to To place” in the menu removes the planting", CD, "        ['wait', 'Send to To place', () => toWait(p)],", "        ['wait', 'Send to To place', () => App.removePlantings([p.id])],"),
 ("Codex on #66: Send to To place from the card is answered in a toast, the card gone", CD, "    if (r && !e.isPool(r.b) && !root.LRFRails.fixed(e, { p })) App.select({ type: 'bed', id: r.b.id });\n    App.sendToWait(p.id);", "    App.sendToWait(p.id);"),
 ("“Remove planting” in the menu does nothing", CD, "        ['remove', 'Remove planting', () => App.removePlantings([p.id]), null, 'bad']]", "        ['remove', 'Remove planting', () => {}, null, 'bad']]"),
 ("To place's line under the switch is the old one", SR, "'Not in a bed yet, so not in the forecast, seed or sowing lists.'", "'Until it is placed it is not in the forecast, and takes no seed.'"),
 ("the line at the library's foot is the old one", PN, "'Drag one onto a bed or a row. It keeps its date.'", "'Click one to see where it is free, or drag it onto a bed. It keeps its date.'"),
]
if mode == "list": print(json.dumps({"page": len(PAGE)})); sys.exit(0)
faults = PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant-trycard"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "trycard_check.py"), str(copy), str(scratch / "mutant-trycard-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
