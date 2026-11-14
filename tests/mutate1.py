"""Deliberate faults for step 1: each is put into a copy of the app, and a named line of step1_test.cjs must fail.
usage: python3 -I mutate1.py <app> <scratch> <tests-dir> <plan.json> [node | list] [words…]     env FROM=, TO= to run a part
node: every fault against step1_test.cjs (a second or two each). list: how many faults there are, and nothing else.
(This was mutate.sh, which did the same with sed; it is in the shape of the others now.)
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
NODE = [
 ('sheet back to 128 cells', 'js/sowing.js', 'cells: 98, rows: 14, columns: 7, widthIn: 10, lengthIn: 20, active: true, template: true, sheet: true', 'cells: 128, rows: 16, columns: 8, widthIn: 10, lengthIn: 20, active: true, template: true, sheet: true'),
 ('the sheet is also used when counting with the multipliers', 'js/engine.js', 'const sheet = legacy ? null : Sow && Sow.ROCKWOOL_SHEET;', 'const sheet = Sow && Sow.ROCKWOOL_SHEET;'),
 ('a named tray no longer wins', 'js/sowing.js', '    if (selected) {', '    if (selected && !(tower && sheet)) {'),
 ('stand-in benches are held to their count again', 'js/engine.js', 'const unbounded = (p, b) => isPool(b) || (isRack(b) && (!(capOf(b) > 0) || !!(p && p.liveTray)));', 'const unbounded = (p, b) => isPool(b);'),
 ('tray batches on a counted bench are listed', 'js/engine.js', '(!(capOf(b) > 0) || !!(p && p.liveTray))', '(!(capOf(b) > 0))'),
 ('every bench is unbounded, hand-set plantings too', 'js/engine.js', 'const unbounded = (p, b) => isPool(b) || (isRack(b) && (!(capOf(b) > 0) || !!(p && p.liveTray)));', 'const unbounded = (p, b) => isPool(b) || isRack(b);'),
 ('a drop on a bench with no count is allowed', 'js/rails.js', "if (eng.isRack(bed) && !(eng.capOf(bed) > 0)) return { state: 'blocked', why: 'no-count', p: base };", ''),
 ('a new tray space keeps the old name', 'js/trays.js', "name: POOL_NAME, type: 'greenhouse'", "name: POOL_NAME_V7, type: 'greenhouse'"),
 ('any garden of that name is renamed', 'js/trays.js', 'g && g.liveTrayPool === true && g.name === POOL_NAME_V7', 'g && g.name === POOL_NAME_V7'),
 ('a quick lot makes a second variety of the same name', 'js/seedlib.js', 'variety = all.find(v => isLive(v) && v.cropId === cropId && varietyKey(v.name) === varietyKey(name)) || null;', 'variety = null;'),
 ('a quick lot of nothing is taken', 'js/seedlib.js', 'if (!(quantity > 0)) throw new Error', 'if (quantity < 0) throw new Error'),
 ('an ordered quick lot is saved as on hand', 'js/seedlib.js', "const status = input.status === 'ordered' ? 'ordered' : 'usable';", "const status = 'usable';"),
 ('the typed vendor is dropped', 'js/seedlib.js', "supplier: vendor || variety.supplier || '' }", "supplier: variety.supplier || '' }"),
]
if mode == "list": print(json.dumps({"node": len(NODE)})); sys.exit(0)
faults = NODE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
def unfaulted(names, ran):
    """What the check does with no fault in it, which is looked at first. A line that fails then can catch nothing, and a check that gives no result can catch nothing at all."""
    if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True); return None
    if names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
    return set(names)
copy = scratch / "mutant"; caught, missed, broken = [], [], []
for name, rel, old, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("thumbs.json", "farm-map.jpg", "dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(old) != 1: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(old)} times", flush=True); continue
        f.write_text(s.replace(old, new), encoding="utf-8")
    out = subprocess.run(["node", str(tests / "step1_test.cjs"), str(copy), str(plan)], capture_output=True, text=True, timeout=300).stdout
    try:
        d = json.loads(out[out.rfind('{"passed"'):]); names = [x["name"] if isinstance(x, dict) else x for x in d["failed"]]
    except Exception: names = ["(the test did not finish: " + out[-200:].replace("\n", " ") + ")"]
    real = [n for n in names if n != "the test ran to its end" and not n.startswith("(the test did not finish")]
    if name is None: already = unfaulted(real, bool(real) or not names); continue
    real = [n for n in real if already is not None and n not in already]
    (caught if real else missed).append(name)
    print(("caught " if real else "MISSED ") + name + " :: " + "; ".join((real or names)[:2])[:230] + (" (which fails with no fault in it too)" if names and not real else ""), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}))
