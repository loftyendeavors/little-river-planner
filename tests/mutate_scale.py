"""Deliberate faults for the scale (DESIGN.md): each is put into a copy of the style sheet, a script or the design page, and the
line of tools/scale.mjs that answers for it must fail where it passed with no fault in it.
usage: python3 -I mutate_scale.py <the repository> <scratch> [node | list] [words…]     env FROM=, TO= to run a part
node: against "node tools/scale.mjs check" (a second a fault).   list: how many faults there are, and nothing else.
A fault is (its name, the file, the text to change, what it becomes, words of the line that has to fail). Where the text to
change is None the new text is added at the end of the file.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
repo, scratch = [Path(x).resolve() for x in sys.argv[1:3]]
mode = sys.argv[3] if len(sys.argv) > 3 else "node"; words = [w.lower() for w in sys.argv[4:]]
CSS, UI, DESIGN = "css/app.css", "js/ui.js", "DESIGN.md"
BTN = ".btn { border: 1px solid var(--line); background: var(--raised); border-radius: var(--corner-8); padding: 6px 12px; font-weight: 600; }"
SAVE = ".save-state { border: 0; background: none; font: 500 var(--type-13) var(--mono);"
PHONE = "body.phone .top .btn { font-size: var(--type-13); }"
TYPE, CORNER, SPEED, NAMED, LEFT, SCRIPT, PAGE = "every type size", "every corner", "every transition and every animation", "the steps are named once", "everything listed as left alone", "no script sets a size", "DESIGN.md names the same steps"
NODE = [
 ("a size off the scale", CSS, None, ".one-more { font-size: 12.5px; }", TYPE),
 ("a size on the scale, written as a number and not by its name", CSS, PHONE, PHONE.replace("var(--type-13)", "13px"), TYPE),
 ("a face, weight and size written together, the size off the scale", CSS, SAVE, SAVE.replace("var(--type-13)", "12px"), TYPE),
 ("a size in ems, which no step answers for", CSS, None, ".one-more { font-size: 0.9em; }", TYPE),
 ("a label that is not on the map is sized by a figure of its own", CSS, None, ".one-more { font: 600 var(--label-size, 10px) var(--body); }", TYPE),
 ("a control's corner off the scale", CSS, BTN, BTN.replace("var(--corner-8)", "6px"), CORNER),
 ("a corner of two sizes, one of them off the scale", CSS, None, ".one-more { border-radius: var(--corner-8) 7px 0 0; }", CORNER),
 ("a corner as a share of the box", CSS, None, ".one-more { border-radius: 40%; }", CORNER),
 ("a new mark with a corner of its own is not on the list", CSS, None, ".one-more-bar { border-radius: 3px; }", CORNER),
 ("a transition at a third speed", CSS, None, ".one-more { transition: opacity 0.4s var(--ease); }", SPEED),
 ("a transition on an easing of its own", CSS, None, ".one-more { transition: opacity var(--speed-press) ease-in; }", SPEED),
 ("a transition on no easing", CSS, None, ".one-more { transition: opacity var(--speed-press); }", SPEED),
 ("the second of two transitions is slow", CSS, None, ".one-more { transition: opacity var(--speed-press) var(--ease), transform 0.6s var(--ease); }", SPEED),
 ("an animation at a speed of its own", CSS, None, ".one-more { animation: tk-rise 0.4s var(--ease); }", SPEED),
 ("a speed given apart from its transition", CSS, None, ".one-more { transition-duration: 0.3s; }", SPEED),
 ("a step is given another value", CSS, "--type-13: 13px;", "--type-13: 12.5px;", NAMED),
 ("the easing is another curve", CSS, "--ease: cubic-bezier(0.22, 0.9, 0.3, 1);", "--ease: ease-in-out;", NAMED),
 ("a step is named a second time, lower down", CSS, None, ".view-seeds { --corner-8: 6px; }", NAMED),
 ("a step is no longer named", CSS, " --corner-pill: 999px;", "", NAMED),
 ("a mark that is listed has lost its corner", CSS, ".yc-meter i { display: block; height: 100%; background: var(--good); border-radius: 3px; }", ".yc-meter i { display: block; height: 100%; background: var(--good); }", LEFT),
 ("a wait that is listed is gone", CSS, "animation: insp-said 8s linear", "animation: insp-said var(--speed-move) var(--ease)", LEFT),
 ("a script sets a size", UI, None, "document.documentElement.style.fontSize = '12px';", SCRIPT),
 ("a script writes a corner into a style", UI, None, "const oneMore = '<i style=\"border-radius: 3px\"></i>';", SCRIPT),
 ("the design page names other steps of type", DESIGN, "11, 13, 15, 18, 24, 32", "11, 12, 14, 16, 20, 28", PAGE),
 ("the design page names another speed", DESIGN, "240 ms for something that arrives or moves", "300 ms for something that arrives or moves", PAGE),
]
if mode == "list": print(json.dumps({"node": len(NODE)})); sys.exit(0)
faults = NODE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def run(folder):
    """The lines that fail, or None when the check gives no result."""
    p = subprocess.run(["node", str(repo / "tools" / "scale.mjs"), "check", str(folder)], capture_output=True, text=True, timeout=120)
    try: return json.loads(p.stdout.strip().splitlines()[-1])["failed"]
    except Exception: return None
copy = scratch / "mutant-scale"; caught, missed, broken = [], [], []
def fresh():
    if copy.exists(): shutil.rmtree(copy)
    (copy / "css").mkdir(parents=True); shutil.copy(repo / CSS, copy / CSS); shutil.copytree(repo / "js", copy / "js"); shutil.copy(repo / DESIGN, copy / DESIGN)
fresh(); clean = run(copy)
if clean is None: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True)
elif clean: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(clean)[:700], flush=True)
for name, rel, was, new, line in faults:
    fresh(); f = copy / rel; s = f.read_text(encoding="utf-8")
    if was is None: s = s + "\n" + new + "\n"
    elif s.count(was) != 1: broken.append(name); print("BROKEN  " + name + " (found %d times)" % s.count(was), flush=True); continue
    else: s = s.replace(was, new)
    f.write_text(s, encoding="utf-8")
    failed = run(copy)
    ok = clean is not None and failed is not None and any(line in l for l in failed) and not any(line in l for l in clean)
    (caught if ok else missed).append(name); print(("caught  " if ok else "MISSED  ") + name, flush=True)
print(json.dumps({"faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}, ensure_ascii=False))
