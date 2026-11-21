"""Deliberate faults for N1, Starting and nursery: the three figures it adds and the rule it offers (js/engine.js, js/sowing.js), the
compact plan (js/planio.js), and the card that reads and sets them (js/startcard.js, js/assume.js, js/seeds.js, js/app.js). Each is
put into a copy of the app folder, and a line of n1_test.cjs (node) or n1_check.py (page) that passed with no fault in it must fail.
usage: python3 -I mutate_n1.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: seconds a fault. page: about a minute a fault. list: how many faults there are, and nothing else.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
EN, SW, PI, SC, AS, SD, AP = "js/engine.js", "js/sowing.js", "js/planio.js", "js/startcard.js", "js/assume.js", "js/seeds.js", "js/app.js"
OLD = app.parent / "old" / "js"
NODE = [
 ("a crop's spare is not read in the sowing", SW, "buffer = ownSpare != null && ownSpare <= 100 ? ownSpare : nonnegative(settings.buffer) ?? 10", "buffer = nonnegative(settings.buffer) ?? 10"),
 ("a crop's spare is read where none is typed", SW, "const ownSpare = nonnegative(crop.spare),", "const ownSpare = nonnegative(crop.spare) ?? 12,"),
 ("one station is read where a cell holds one seed", SW, "const station = crop.station === true && seedsPerCell > 1;", "const station = crop.station === true;"),
 ("one station still sows cells over for germination", SW, "minimumCells = station ? bufferedPlants : Math.ceil(bufferedPlants / germination);", "minimumCells = Math.ceil(bufferedPlants / germination);"),
 ("one station is read without being said", SW, "const station = crop.station === true && seedsPerCell > 1;", "const station = seedsPerCell > 1;"),
 ("a variety's seeds a cell is not read", EN, "if (v.spc > 0) e.spc = v.spc;", ""),
 ("a variety's germination is read as its seeds a cell", EN, "if (v.spc > 0) e.spc = v.spc;", "if (v.germ > 0) e.spc = v.germ / 10;"),
 ("a crop's spare is not read for plants bought in", EN, "buffer = 1 + nonNegative(spareOf(c) != null ? spareOf(c) : settings.buffer) / 100;", "buffer = 1 + nonNegative(settings.buffer) / 100;"),
 ("the compact plan drops a variety's seeds a cell", PI, "    'spc'];", "    ];"),
]
PAGE = [
 ("the part is not in the switch", "index.html", '<button type="button" data-as-mode="start" aria-pressed="false">Starting and nursery</button>', ""),
 ("a crop stands in the wrong group", SC, "return c.method === 'DS' ? 'direct' : 'nursery';", "return 'nursery';"),
 ("the list drops the last crop of a group", SC, "crops: shown.filter(c => groupOf(c) === id && hit(c)).sort(", "crops: shown.filter((c, i, all) => groupOf(c) === id && hit(c) && all.filter(x => groupOf(x) === id).pop() !== c).sort("),
 ("the sowings show the plants wanted as the cells sown", SC, "h('b', `${num(b.cells)} ${unit}`)", "h('b', `${num(b.wanted)} ${unit}`)"),
 ("the line of what it comes to counts the seed of one sowing", SC, "cells += b.cells; seeds += b.seeds;", "cells += b.cells; seeds = b.seeds;"),
 ("typing says nothing of what it would move", SC, "line.append(said ? `Would move: ${said}` : 'Moves nothing on this plan.',", "line.append('',"),
 ("typing takes the figure at once", SC, "      const step = ops(x.n);\n      if (!step) return;\n      const said", "      const step = ops(x.n);\n      if (!step) return;\n      commit();\n      const said"),
 ("Enter does not take it", SC, "else if (e.key === 'Enter') { e.preventDefault(); commit(); }", "else if (e.key === 'Enter') { e.preventDefault(); }"),
 ("Esc takes it", SC, "if (e.key === 'Escape') { e.preventDefault(); input.value = shown; clear(line); input.blur(); }", "if (e.key === 'Escape') { e.preventDefault(); commit(); }"),
 ("a variety's figure is written on its crop", SC, "ops: n => varietyOps(eng, v, 'germ', n)", "ops: n => cropOps(eng, c, { germ: n })"),
 ("the offer is used as two steps", SC, "onclick: () => take(key, `Offer used: ${words}`, ops) }, 'Use it'));", "onclick: () => { for (const o of ops) take(key, `Offer used: ${words}`, [o]); take(key, 'and again', cropOps(App.state.engine, App.state.engine.crop(ops[0].after.id), { spare: 11 })); } }, 'Use it'));"),
 ("the offer says no before and after", SC, "h('p', 'Offered: ', words, said ? ` ${said}` : ' It moves nothing on this plan.'),", "h('p', 'Offered: ', words),"),
 ("a switch is taken at a press", SC, "          ui.said = null; ui.redraw();\n        } }, words)));", "          take(key, ui.pending.label, step);\n        } }, words)));"),
 ("the potted-up part is not drawn", SC, "      if (potted) {", "      if (false) {"),
 ("the towers' part is not drawn", SC, "      if (towers) {", "      if (false) {"),
 ("a live tray reads counted with one figure said", EN, "set = cells > 0 && perCell > 0;", "set = cells > 0;"),
 ("Edit crop opens the old form", SD, "onclick: () => toStart(g.id) }, 'Edit crop')", "onclick: () => select({ type: 'crop', id: g.id }) }, 'Edit crop')"),
 ("the tick is not kept apart from the others", AP, "const emptyList = a => !['crops', 'varieties', 'starts', 'sell', 'sellV', 'nursery']", "const emptyList = a => !['crops', 'varieties', 'starts', 'sell', 'sellV']"),
 ("Looks right moves on without the tick", SC, "if (!looked) App.setStartLooked(c.id, true); if (next)", "if (next)"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
copy = scratch / ("mutant-n1-" + mode); caught, missed, broken = [], [], []
already = None
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    cmd = ["node", str(tests / "n1_test.cjs"), str(copy), str(plan), str(OLD)] if mode == "node" else ["python3", "-I", str(tests / "n1_check.py"), str(copy), str(scratch / "shots-n1")]
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=300).stdout
    except subprocess.TimeoutExpired: out = "timed out"
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [str(x.get("name") if isinstance(x, dict) else x) for x in d["failed"]]; ran = True
    except Exception: names = []; ran = False; print("   no result: " + out[-300:].replace("\n", " "), flush=True)
    if name is None:
        if not ran: print("with no fault in it the check gives no result: nothing can be shown to be caught", flush=True)
        elif names: print("with no fault in it the check already fails, so these lines catch nothing: " + "; ".join(names)[:700], flush=True)
        already = set(names) if ran else None
        continue
    fails = len(names); names = [n for n in names if already is not None and n not in already]
    (caught if names else missed).append(name)
    print(("caught " if names else "MISSED ") + name + " :: " + ("; ".join(names[:2])[:200] if names or not fails else "(only what fails with no fault in it too)"), flush=True)
print(json.dumps({"mode": mode, "faults": len(faults), "caught": len(caught), "missed": missed, "broken": broken}))
