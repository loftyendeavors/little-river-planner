"""Deliberate faults for L3, part 1, the messages and small fixes (#91): a drag that says how far, a refused drop that names the day it was
judged on, Done at the foot of the library, a resize that says what it did and a tip with no "null", "Its own days", a click on a bare
Timeline row that says the date moved, his own days typed for a crop and what it offers, the panel's schedule first, "Seeding in trays"
in its box, the map's key that wraps before it hides, the unheated benches and the celled tray in words, and the quiet link to what can
wait. Each is put into a copy of the app folder, and a line of messages_check.py that passed with no fault in it must fail.
usage: python3 -I mutate_messages.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against messages_check.py (about forty seconds a fault).
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
AP, MP, PN, TL, UI, BN, NU, CSS = "js/app.js", "js/map.js", "js/panels.js", "js/timeline.js", "js/ui.js", "js/bench.js", "js/nursery.js", "css/app.css"
# The panel's order put back as it was: the boxes first, the schedule after. Read from the app's own panel, so that the fault is the
# order and nothing else.
def panel_order():
    s = (app / PN).read_text(encoding="utf-8")
    a = s.index("      // the schedule and what it is expected to give come first, the boxes after (L3; the card's order)\n")
    b = s.index("      h('section.insp-section.form',\n", a)
    c = s.index("        givesField),\n", b) + len("        givesField),\n")
    sched = s[a:b].split("\n", 1)[1]
    return s[a:c], s[b:c] + sched
ORDER_WAS, ORDER_NEW = panel_order()
PAGE = [
 ("a drag says only where it went, not how far", AP, "const moved = result.state !== 'swap' && r0 ? movedSaid(r0.field, r.field) : '';", "const moved = '';"),
 ("the days a drag moved are counted the wrong way", AP, "const n = was && now ? E.dayDiff(now, was) : 0;", "const n = was && now ? E.dayDiff(was, now) : 0;"),
 ("a drop turned down names no day", AP, "return `${bedLabel(bed)}: ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)} · ${when}`;", "return `${bedLabel(bed)}: ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)}`;"),
 ("a planting turned down is said to be judged on the map's date", AP, "own = !!payload.waitingId || (!!source && E.d2s(date) === source.date);", "own = !!payload.waitingId;"),
 ("no Done while a crop is carried", PN, "    $('libDone').hidden = !App.state.armed;\n  }", "    $('libDone').hidden = true;\n  }"),
 ("Done does not put the crop down", PN, "    $('libDone').addEventListener('click', () => App.arm(null));\n", ""),
 ("a resize says nothing", MP, "      else UI.toast(label, { label: 'Undo', run: App.undo });   // a resize says what it did (L3)\n", ""),
 ("a resize says the length it has now as the one it had", MP, "cap = eng.calc(cur.p).cap, ft = n => num(n, 1), was = held(cur.p);", "cap = eng.calc(cur.p).cap, ft = n => num(n, 1), was = res.len;"),
 ("the tip prints null again", MP, "    UI.add(clear(tip), nodes);", "    clear(tip).append(...nodes);"),
 ("Pinned is back", PN, "'Its own days. Empty the box to follow your list.'", "'Pinned: this planting keeps its own days. Clear the field and it follows the assumptions list.'"),
 ("the panel's boxes come before its schedule again", PN, ORDER_WAS, ORDER_NEW),
 ("what it is expected to give goes back among the boxes", PN, "          h('li', h('span', 'Ground free again'), h('b', through === Infinity ? 'Stays planted' : day(E.addDays(through, 1))))),\n        yieldLine(eng, p, r)),", "          h('li', h('span', 'Ground free again'), h('b', through === Infinity ? 'Stays planted' : day(E.addDays(through, 1)))))),"),
 ("a click on a bare Timeline row moves the date without a word", TL, "        if (+App.state.date !== +was) UI.toast(", "        if (false) UI.toast("),
 ("Undo after a click on a bare row leaves the date where it went", TL, "{ label: 'Undo', run: () => App.setDate(was) });", "{ label: 'Undo', run: () => {} });"),
 ("his own days typed for a crop offer nothing", AP, "kind === 'crops' && days > 0 ? keptOwn(id, env, Math.round(days), label, ops) : {}", "{}"),
 ("Set its varieties too sets only one", AP, "for (const v of list) setCell(next, 'varieties', v.id, env, 'dtm', days);", "for (const v of list.slice(0, 1)) setCell(next, 'varieties', v.id, env, 'dtm', days);"),
 ("See the plantings is not offered", AP, "    if (root.LRFAssume && root.LRFAssume.openDiffer) offers.push({ label: 'See the plantings', run: () => root.LRFAssume.openDiffer() });\n", ""),
 ("an answer with more than Undo shows only the first", UI, "    for (const a of actions) host.append(", "    for (const a of actions.slice(0, 1)) host.append("),
 ("Seeding in trays is cut off in its box again", CSS, ".as-from { height: 28px; max-width: 136px;", ".as-from { height: 28px; max-width: 118px;"),
 ("the map's key keeps to one line again", CSS, ".map-legend { position: relative; flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: wrap;", ".map-legend { position: relative; flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: nowrap;"),
 ("the map's key hides its second line", MP, "if (chip.offsetTop - top > step * 1.5)", "if (chip.offsetTop - top > step * 0.5)"),
 ("the map frames the farm again when its key is fitted (#85)", MP, "    bar.classList.toggle('open', legendOpen && chips.length > 0);\n", "    bar.classList.toggle('open', legendOpen && chips.length > 0); fit();\n"),
 ("Grown on without heat is back", BN, "h('h4', 'On the unheated benches')", "h('h4', 'Grown on without heat')"),
 ("a celled tray with no cells set does not say where they are set", NU, "'go out as live trays; set the cells a tray under Live trays, in the Sown column'", "'go out as live trays; say the cells a tray in the demand table'"),
 ("the quiet link shows while something is counted", PN, "    const k = n ? 0 : looseRows.length;", "    const k = looseRows.length;"),
 ("the quiet link never shows", PN, "if (link) { link.hidden = !k;", "if (link) { link.hidden = true;"),
 ("the quiet link opens nothing", PN, "    if (link) link.addEventListener('click', () => openLoose(link));\n", ""),
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
copy = scratch / "mutant-messages"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "messages_check.py"), str(copy), str(scratch / "mutant-messages-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
