"""Deliberate faults for the variety swap (js/swap.js, and its way in on Seeds). Each is put into a copy of the app folder, and a
line of the check that passed with no fault in it must fail.
usage: python3 -I mutate_swap.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: against swap_test.cjs (a second or two a fault).
page: against swap_check.py (about fifteen seconds a fault).
list: how many faults there are in each, and nothing else.
"""
import json, os, shutil, signal, subprocess, sys, time
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
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
SW, SD, CSS = "js/swap.js", "js/seeds.js", "css/app.css"
NODE = [
 ("a sowing day moves where the nursery weeks differ", SW, "      if (!was || !now || dayOf(was) === dayOf(now) || p.sowOn || p.liveTray) continue;", "      continue;"),
 ("the day in the bed moves the wrong way", SW, "date: E.d2s(E.addDays(E.s2d(p.date), E.dayDiff(was, now)))", "date: E.d2s(E.addDays(E.s2d(p.date), E.dayDiff(now, was)))"),
 ("plantings with days of their own are ticked by default", SW, "(ask ? ask.has(x.p.id) : x.state === 'swap')", "(ask ? ask.has(x.p.id) : true)"),
 ("an unticked planting is swapped all the same", SW, "(ask ? ask.has(x.p.id) : x.state === 'swap')", "x.state === 'swap'"),
 ("an already sown planting is swapped", SW, "    if (s && s.sown) return 'sown';\n", ""),
 ("the season's worth after is the worth before", SW, "out.worth = [worthOf(eng), picked.length ? worthOf(after) : worthOf(eng)];", "out.worth = [worthOf(eng), worthOf(eng)];"),
 ("the new variety's seed is counted on the plan before the step", SW, "now = need(after, to)", "now = need(eng, to)"),
 ("an overlap there before is named as new", SW, "        if (!o.p || before.has(o.p.id)) continue;", "        if (!o.p) continue;"),
 ("an overlap of two swapped plantings is named twice", SW, "if (seen.has(key)) return false; seen.add(key); return true;", "seen.add(key); return true;"),
 ("the swap writes a field of its own into the planting", SW, "const after = { ...p, varietyId: to.id }; delete after.variety;", "const after = { ...p, varietyId: to.id, swappedFrom: p.varietyId }; delete after.variety;"),
 ("the harvest's move is said the wrong way round", SW, "shift: E.dayDiff(r1.first, r0.first)", "shift: E.dayDiff(r0.first, r1.first)"),
 ("the variety itself is offered in its own place", SW, "    return from ? eng.varietiesOf(from.cropId).filter(v => v.id !== from.id) : [];", "    return from ? eng.varietiesOf(from.cropId) : [];"),
 ("another crop's variety may take its place", SW, "(!to || to.cropId !== from.cropId || to.id", "(!to || to.id"),
 ("looking changes the plan", SW, "const after = { ...p, varietyId: to.id }; delete after.variety;", "const after = Object.assign(p, { varietyId: to.id }); delete after.variety;"),
 ("a planting with days of its own loses them when ticked", SW, "const after = { ...p, varietyId: to.id }; delete after.variety;", "const after = { ...p, varietyId: to.id }; delete after.variety; delete after.dtm;"),
 ("a transplant whose new variety has no nursery weeks is left out", SW, "dayOf(was) === dayOf(now) || p.sowOn || p.liveTray) continue;", "dayOf(was) === dayOf(now) || !r.sow || p.sowOn || p.liveTray) continue;"),
 ("a harvest whose end alone moves is not counted", SW, "return { moves: start.length + endOnly.length,", "return { moves: start.length,"),
 ("a harvest whose end alone moves is not said", SW, "    if (endOnly.length) parts.push(", "    if (false) parts.push("),
]
PAGE = [
 ("the way in is not there", SD, "can = !!W && n > 0 && W.choices(App.state.engine, v.id).length > 0;", "can = false;"),
 ("the varieties to pick from are shown without their photographs", SW, "        photo(v),\n", "        null,\n"),
 ("picking a variety writes the swap at once", SW, "onchange: () => { state.to = v.id; state.ticked = null; draw(); }", "onchange: () => { state.to = v.id; state.ticked = null; swap(from.id, v.id, null); draw(); }"),
 ("a tick taken off is ignored", SW, "if (e.target.checked) set.add(r.id); else set.delete(r.id);", "if (e.target.checked) set.add(r.id);"),
 ("the answer is said over the page as well", SW, "    said = { fromId, toId, step, text };\n", "    said = { fromId, toId, step, text }; root.LRFUI.toast(text);\n"),
 ("the answer is never shown", SW, "    if (!said || said.fromId !== varietyId", "    if (true || !said || said.fromId !== varietyId"),
 ("the answer has no Undo", SD, "said.canUndo ? h('button.link'", "false ? h('button.link'"),
 ("each row gives the harvest's old day as its new one", SW, "${day(r.first)} → ${day(r.firstNow)}", "${day(r.first)} → ${day(r.first)}"),
 ("the sheet gives the worth before as the worth after", SW, "`${money(view.worth[0])} → ${money(view.worth[1])}`", "`${money(view.worth[0])} → ${money(view.worth[0])}`"),
 ("an already sown planting can be ticked", SW, "tickable = TICKABLE.includes(r.state) && !!to;", "tickable = !!to;"),
 ("the dark button leaves the sheet open", SW, "      close();\n      if (onDone) onDone(done);", "      if (onDone) onDone(done);"),
 ("the sheet is 960 wide", CSS, ".dialog.sw { width: min(760px,", ".dialog.sw { width: min(960px,"),
 ("Cancel writes the swap", SW, "dataset: { hook: 'swap-cancel' }, onclick: () => close() }", "dataset: { hook: 'swap-cancel' }, onclick: () => { if (state.to) swap(from.id, state.to, state.ticked); close(); } }"),
 ("the line that says what is left out is never drawn", SW, "      leftLine.hidden = !leftLine.textContent;", "      leftLine.hidden = true;"),
 ("the seed line counts what the old variety needs", SW, "Seed of ${to.name}: ${amount(sd.toNow, sd.unit)} to sow", "Seed of ${to.name}: ${amount(sd.fromWas, sd.unit)} to sow"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant-swap"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone(["node", str(tests / "swap_test.cjs"), str(copy), str(plan)], 120)[0] if mode == "node" else alone([sys.executable, "-I", str(tests / "swap_check.py"), str(copy), str(scratch / "mutant-swap-shots")], 600)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
