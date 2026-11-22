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
 ("a replacement backup drops the ticks of Starting and nursery", PI, " + Object.values(a.nursery || {}).filter(line => line && line.looked != null).length : 0;", " : 0;"),
 ("the engine counts a spare of 10 where the farm has none set", EN, "buffer = 1 + nonNegative(spareOf(c) != null ? spareOf(c) : settings.buffer) / 100;", "buffer = 1 + nonNegative(spareOf(c) != null ? spareOf(c) : settings.buffer ?? 10) / 100;"),
 ("a variety's germination is not read", EN, "        if (v.germ > 0) e.germ = v.germ;\n", ""),
 ("a variety's nursery days for its place are not read", EN, "      if (profile && own(profile, 'gh')) e.gh = profile.gh;\n", ""),
 ("Started as is joined field by field", "js/merge.js", "'crops[]': [['yield', 'yBasis'], ['method', 'prop', 'plantingMaterial']],", "'crops[]': [['yield', 'yBasis']],"),
 ("a farm spare stored as text is read as unset in the sowing", SW, "buffer = ownSpare != null && ownSpare <= 100 ? ownSpare : nonnegative(settings.buffer) ?? 10,", "buffer = ownSpare != null && ownSpare <= 100 ? ownSpare : (typeof settings.buffer === 'number' ? nonnegative(settings.buffer) : null) ?? 10,"),
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
 ("Enter does not take it", SC, "else if (e.key === 'Enter') { e.preventDefault(); ui.focus = key; commit(); }", "else if (e.key === 'Enter') { e.preventDefault(); }"),
 ("Esc takes it", SC, "if (e.key === 'Escape') { e.preventDefault(); input.value = shown; clear(line); input.blur(); }", "if (e.key === 'Escape') { e.preventDefault(); commit(); }"),
 ("a variety's figure is written on its crop", SC, "ops: n => varietyOps(eng, v, 'germ', n)", "ops: n => cropOps(eng, c, { germ: n })"),
 ("the offer is used as two steps", SC, "onclick: () => take(key, `Offer used: ${label}`, ops) }, 'Use it'));", "onclick: () => { for (const o of ops) take(key, `Offer used: ${label}`, [o]); take(key, 'and again', cropOps(App.state.engine, App.state.engine.crop(ops[0].after.id), { spare: 11 })); } }, 'Use it'));"),
 ("the offer says no before and after", SC, "h('p', 'Offered: ', words, said ? ` ${said}` : ' It moves nothing on this plan.'),", "h('p', 'Offered: ', words),"),
 ("a switch is taken at a press", SC, "          ui.said = null; ui.redraw();\n        } }, words)));", "          take(key, ui.pending.label, step);\n        } }, words)));"),
 ("the potted-up part is not drawn", SC, "      if (potted) {", "      if (false) {"),
 ("the towers' part is not drawn", SC, "      if (towers) {", "      if (false) {"),
 ("a live tray reads counted with one figure said", EN, "set = cells > 0 && perCell > 0;", "set = cells > 0;"),
 ("Edit crop opens the old form", SD, "onclick: () => toStart(g.id) }, 'Edit crop')", "onclick: () => select({ type: 'crop', id: g.id }) }, 'Edit crop')"),
 ("the tick is not kept apart from the others", AP, "const emptyList = a => !['crops', 'varieties', 'starts', 'sell', 'sellV', 'nursery']", "const emptyList = a => !['crops', 'varieties', 'starts', 'sell', 'sellV']"),
 ("the farm's pots a carrier says nothing of what Supplies would count", SC, "said: says ? says(value) : movesSaid(", "said: movesSaid("),
 ("the bench room said is the crops' own trays, live trays left out", SC, "for (const k of N.KIND_IDS) { const x = most(f0, k), y = most(f1, k); if (Math.abs(x - y) > 0.05) out.bench.push({ kind: N.kindName(k), was: x, now: y }); }", "{ const x = benchOfMany(eng, [...ids]).most, y = benchOfMany(next, [...ids]).most; if (Math.abs(x - y) > 0.05) out.bench.push({ kind: N.kindName('heated'), was: x, now: y }); }"),
 ("a pot size is taken at once", SC, "onchange: e => stage('potSize',", "onchange: e => take('potSize',"),
 ("counting germination again is taken at once", SC, "onclick: () => stage('station', `${name}: extra cells for germination again`", "onclick: () => take('station', `${name}: extra cells for germination again`"),
 ("a crop hidden by My crops opens another card", AS, "        ui.scope = 'all';\n", "\n"),
 ("leaving a box by a click takes it", SC, "      if (sent || !edited) return;\n      input.value = shown; edited = false;", "      commit(); if (sent || !edited) return;\n      input.value = shown; edited = false;"),
 ("an emptied record is left", SC, "if (Object.keys(after).length === 1 && before && libCrop(c.id)) {", "if (false) {"),
 ("Tab goes on past the next box", SC, "{ e.preventDefault(); ui.focus = { after: key }; commit(); }", "{ ui.focus = { after: key }; commit(); }"),
 ("Supplies' rows are not said", SC, "for (const x of rows.values()) if (x.was !== x.now) out.supplies.push(x);", ""),
 ("the potting mix is not said", SC, "if (Math.abs(s0.mix.need - s1.mix.need) > 0.005) out.supplies.push(", "if (false) out.supplies.push("),
 ("other crops that move are not said", SC, "    if (m.others.n) parts.push(", "    if (false) parts.push("),
 ("plantings bought in by their own choice are counted as following the crop", SC, "const follow = group === 'bought' ? boughtP.length : beds - boughtP.length", "const follow = beds"),
 ("the offer's line says an element", SC, "take(key, `Offer used: ${label}`, ops)", "take(key, `Offer used: ${words}`, ops)"),
 ("the nursery length offer leaves no line", SC, "if (OFFER_DAYS[c.id] && ((ui.said && ui.said.key === 'days-' + c.id) || (", "if (OFFER_DAYS[c.id] && ((false) || ("),
 ("a library live-tray crop's boxes take typing", SC, "const off = mine ? null : 'This crop comes", "const off = mine ? null : null && 'This crop comes"),
 ("the farm's spare not set reads 10", SC, "fig: { mine: farmSpareSet(plan) ? +plan.settings.buffer : null, fallback: null }, farm: true,", "fig: { mine: farmSpare(plan), fallback: 10 }, farm: false,"),
 ("Undo from the card raises a message too", SC, "App.undo({ quiet: true });", "App.undo();"),
 ("Enter on an unedited box clears a figure of his that repeats the library's", SC, "if (sent || !edited) return false;\n      const x = read();", "if (sent) return false;\n      const x = read(); if (x.n != null && fig.mine != null && fig.fallback != null && eq(x.n, fig.fallback)) x.n = null;"),
 ("the figure every planting counts is stored", SC, "const follows = n => n != null && fig.mine == null && !farm && uses != null && eq(n, uses);", "const follows = n => false;"),
 ("the figure every planting counts stays in the box", SC, "if (follows(x.n)) { input.value = shown; edited = false; }", "if (follows(x.n)) { edited = false; }"),
 ("a crop's spare is held to the farm's figure, not to what its plantings count", SC, "uses: usesOf(eng, eng.plan.plantings.filter(p => p.cropId === c.id), 'spare')", "uses: farmSpare(plan)"),
 ("clearing a variety's days clears every place's figures", SC, "for (const k of ['field', 'greenhouse']) if (cfg[k] && 'gh' in cfg[k]) { delete cfg[k].gh; if (!Object.keys(cfg[k]).length) delete cfg[k]; }", "for (const k of ['field', 'greenhouse']) delete cfg[k];"),
 ("the card's own figures are not said", SC, "if (m.card && m.card.length) parts.push(", "if (false) parts.push("),
 ("the card's line outlives its step", SC, "    sayingStill();\n", "\n"),
 ("leaving a box shifts the card under the pointer", SC, "line.style.visibility = 'hidden';", "clear(line);"),
 ("Tab from the last box loses the pointer", SC, "boxes[at + 1] || main.querySelector('.sn-foot .btn.primary')", "boxes[at + 1]"),
 ("a switched-off box looks like his", SC, "(off ? '.off' : fig.mine != null ? '.mine'", "(fig.mine != null ? '.mine'"),
 ("a live-tray row puts its amber word last", SC, ": 'not counted · live', warn", ": 'live · not counted', warn"),
 ("a variety's box puts its label above it", "css/app.css", ".sn-own .sn-f { grid-template-columns: max-content minmax(0, 1fr); }", ".sn-own .sn-f { grid-template-columns: minmax(0, 1fr); }"),
 ("the Every crop row says 10% spare where none is set", SC, "${farmSpareSet(plan) ? `${num(farmSpare(plan), 1)}% spare` : 'spare not set'}", "${num(farmSpare(plan), 1)}% spare"),
 ("a variety's days are read from the field alone", SC, "return { field, greenhouse, one: field === greenhouse ? field : null, split: field !== greenhouse };", "return { field, greenhouse, one: field, split: false };"),
 ("Started as clears what it leaves undefined", SC, "if (v === undefined) continue;", "if (v === undefined) { delete after[k]; continue; }"),
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
