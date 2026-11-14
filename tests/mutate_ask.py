"""Deliberate faults for preview 0.38 (the question "split or replace" asked only of a crop brought from the library onto the
map): each is put into a copy of the app folder, and a named check must fail.
usage: python3 -I mutate_ask.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against ask_check.py (about half a minute each). list: how many faults there are, and nothing else.
(The node mode ran ask_test.cjs, the proof of one past build. That proof is retired, tests/what_changed.cjs with tests/this-build.json does its work, and the mode is taken out.)
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
AP, MN = "js/app.js", "js/main.js"
LABEL = os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)"; OTHER = LABEL[:-1] + ("0" if LABEL[-1] != "0" else "1")   # the build's label, as tests/env.sh reads it from the page's own script, and one that is not it
GATE = "if (res.state === 'blocked' && res.why === 'held' && asksToShare(payload) && !target.noSwap && bed && eng.isSoilBed(bed)) {"
WHO = "const asksToShare = payload => !!payload && !payload.plantingId && !payload.waitingId && state.view === 'map';"
SWAP = "payload.plantingId && !target.noSwap) res = Rails.swap(eng, payload, target) || res;"
PAGE = [
 ("anything dropped on held ground is asked, as 0.37 went live", AP, GATE, GATE.replace("asksToShare(payload) && ", "")),
 ("the view is not looked at: the timeline asks too", AP, WHO, WHO.replace(" && state.view === 'map'", "")),
 ("a planting that is moved is asked", AP, WHO, WHO.replace("!payload.plantingId && ", "")),
 ("a planting that is moved is asked, on the timeline only", AP, WHO, WHO.replace("!payload.plantingId && !payload.waitingId && state.view === 'map'", "(state.view === 'map' ? !payload.plantingId : true) && !payload.waitingId")),
 ("a copy made with Alt is asked", AP, WHO, WHO.replace("!payload.plantingId", "(!payload.plantingId || payload.copy)")),
 ("nobody is asked, the library on the map included", AP, WHO, WHO.replace("!!payload &&", "false &&")),
 ("asked everywhere but on the map", AP, WHO, WHO.replace("state.view === 'map'", "state.view !== 'map'")),
 ("a planting that waits is counted among those asked", AP, WHO, WHO.replace(" && !payload.waitingId", "")),
 ("a planting cannot trade into a bed that is being mixed", AP, SWAP, SWAP.replace("!target.noSwap)", "!target.noSwap && !mixingHere)")),
 ("a planting no longer trades places at all", AP, SWAP, SWAP.replace("!target.noSwap)", "!target.noSwap && false)")),
 ("a moved planting on a bed being mixed splits it again", AP, GATE, GATE.replace("asksToShare(payload)", "(asksToShare(payload) || mixingHere)")),
 ("while a planting is in the air the beds are drawn as ones that would ask", AP, GATE, GATE.replace("asksToShare(payload)", "(asksToShare(payload) || target.survey)")),
 ("the label is another build's", MN, "Preview " + LABEL, "Preview " + OTHER),
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
copy = scratch / "mutant-ask"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "ask_check.py"), str(copy), str(scratch / "mutant-ask-shots")], 300)[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
