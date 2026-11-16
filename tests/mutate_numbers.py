"""Deliberate faults for the rule of the number boxes (a figure changes only by being typed): each is put into a copy of the app
folder, and a line of number_boxes_check.py that passed with no fault in it must fail.
usage: python3 -I mutate_numbers.py <app> <scratch> <tests-dir> [page | list] [words…]     env FROM=, TO= to run a part
page: against number_boxes_check.py, which tries the first 40 number boxes of each screen here (a minute or two a fault).
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
MN = "js/main.js"
HOLD = "letGo(); heldBox = box; box.readOnly = true; setTimeout(letGo, 0);\n  }, { capture: true, passive: true });"
KEYS = "if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && numberBox(e.target)) e.preventDefault();"
FREE = "    letGo();   // a key pressed in the same moment as the wheel is typed like any other\n"
WHICH = "const numberBox = el => !!el && el.tagName === 'INPUT' && el.type === 'number';"
GUARD = "if (!numberBox(box) || box.readOnly || box !== document.activeElement) return;"
UNDO = "if (mod && !writing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); return; }"
REDO = "if (mod && !writing && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); return; }"
WRITING = "const writing = typing && unsent.has(e.target);"
PAGE = [
 ("the wheel steps a box that has been clicked", MN, HOLD, HOLD.replace("box.readOnly = true; ", "")),
 ("the wheel is stopped at the box: the figure keeps, and the page no longer scrolls under it", MN, HOLD, "e.preventDefault();\n  }, { capture: true, passive: false });"),
 ("after the wheel the box stays one that cannot be typed in, until a key is pressed", MN, HOLD, HOLD.replace(" setTimeout(letGo, 0);", "")),
 ("a key pressed in the same moment as the wheel is lost", MN, FREE, ""),
 ("the arrows step the box", MN, KEYS, KEYS.replace("e.preventDefault();", "void 0;")),
 ("ArrowDown steps the box: only ArrowUp is refused", MN, KEYS, KEYS.replace("(e.key === 'ArrowUp' || e.key === 'ArrowDown')", "e.key === 'ArrowUp'")),
 ("the arrows are kept from every other handler", MN, KEYS, "if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); }"),
 ("the rule holds only for the boxes of the Assumptions list", MN, WHICH, WHICH.replace("el.type === 'number'", "el.type === 'number' && !!el.dataset.hk")),
 ("the wheel makes a box that cannot be edited into one to type in", MN, GUARD, GUARD.replace("box.readOnly || ", "")),
 ("Ctrl+Z in a box takes back the plan's last change", MN, UNDO, UNDO.replace("!writing && ", "")),
 ("Ctrl+Y in a box redoes the plan", MN, REDO, REDO.replace("!writing && ", "")),
 ("in any box the undo key is lost, a list box included", MN, WRITING, "const writing = typing;"),
 ("a box whose typing the plan has taken still keeps the keys to itself", MN, "for (const kind of ['change', 'focusout']) document.addEventListener(kind, e => { if (e.target) unsent.delete(e.target); }, true);", "for (const kind of ['focusout']) document.addEventListener(kind, e => { if (e.target) unsent.delete(e.target); }, true);"),
 ("typing in a box is not noticed: the keys go to the plan", MN, "unsent.add(e.target); }, true);", "void 0; }, true);"),
 ("the undo and redo keys are lost outside a box too", MN, WRITING, "const writing = true;"),
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
copy = scratch / "mutant-numbers"; caught, missed, broken = [], [], []
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append((name, s.count(was))); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    out = alone([sys.executable, "-I", str(tests / "number_boxes_check.py"), str(copy), str(scratch / "mutant-numbers-shots")], 600, env={**os.environ, "BOXES": "40"})[0]
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else str(x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None: already = unfaulted(names, ran); continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": [b[0] for b in broken]}))
