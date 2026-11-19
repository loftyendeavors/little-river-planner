"""Deliberate faults for E2c part 2: something a crop sells first picked days before the crop's own days to harvest, and a cane stand
by its age (js/engine.js, js/forecast.js, and the screens: js/things.js, js/yieldcard.js, js/panels.js, js/card.js, js/harvestview.js,
js/app.js). Each is put into a copy of the app folder, and a line of early_young_test.cjs (node) or early_young_check.py (page) that
passed with no fault in it must fail.
usage: python3 -I mutate_early.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part,
OLD= the scripts of the build before (early_young_test.cjs compares with them)
node: seconds a fault. page: about a minute a fault. list: how many faults there are, and nothing else.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
old = os.environ.get("OLD") or str(Path(os.environ.get("LRF_WORK", "/tmp/lrf-work")) / "old" / "js")
EN, FC, TH, YC, PN, CD, HV, AP = "js/engine.js", "js/forecast.js", "js/things.js", "js/yieldcard.js", "js/panels.js", "js/card.js", "js/harvestview.js", "js/app.js"
NODE = [
 # days before
 ("days before are not read", EN, "before: from !== 'harvest' ? wholeDays(x.before) : null,", "before: null,"),
 ("a thing packed from the harvest is picked early too", EN, "before: from !== 'harvest' ? wholeDays(x.before) : null,", "before: wholeDays(x.before),"),
 ("days before that are no whole number are read", EN, "before: from !== 'harvest' ? wholeDays(x.before) : null,", "before: from !== 'harvest' && +x.before ? +x.before : null,"),
 ("a thing is picked early before its planting is in its bed", EN, "Math.max(0, Math.min(t.before, dayDiff(r.first, r.field) - 1))", "t.before"),
 ("a planting not picked at all is picked early", EN, "t && t.before && r && r.harvestDays > 0 ?", "t && t.before && r ?"),
 ("the early days are not counted in a thing's days", EN, "there = pickedDays(r, t.pattern) + ahead,", "there = pickedDays(r, t.pattern),"),
 ("On demand spreads its total over the days it had before", EN, "nominal = t.days || Math.max(1, r.expectedHarvestDays + ahead),", "nominal = t.days || Math.max(1, r.expectedHarvestDays),"),
 ("the early picking starts on the crop's own first picking", EN, "start = ahead ? addDays(r.first, -ahead) : r.first;", "start = r.first;"),
 ("an early thing's own days are counted from the crop's first picking", EN, "last: addDays(start, Math.max(0,", "last: addDays(r.first, Math.max(0,"),
 ("the part does not say how many days early", EN, "...(ahead ? { ahead } : {}),", ""),
 ("the forecast picks a thing only on the crop's own days", FC, "if (y.first || eng.pickedOn(r, d)) picked.push(i);", "if (eng.pickedOn(r, d)) picked.push(i);"),
 ("the forecast does not carry the days early", FC, "...(y.ahead ? { ahead: y.ahead } : {}),", ""),
 ("an early picking is not among the planting's notes", EN, "if (x.ahead) out.push({ k: 'pick',", "if (false) out.push({ k: 'pick',"),
 # a young stand
 ("a stand's year is not read", EN, "const age = own || liveTray ? null : standAge(p, r),", "const age = null,"),
 ("a planting's own yield is cut by its age", EN, "const age = own || liveTray ? null : standAge(p, r),", "const age = liveTray ? null : standAge(p, r),"),
 ("a crop that is not perennial is cut by a year", EN, "|| y > at || !isPerennial(r.c)) return null;", "|| y > at) return null;"),
 ("a year after the season is read", EN, "|| y > at || !isPerennial(r.c)) return null;", "|| !isPerennial(r.c)) return null;"),
 ("a stand is counted from the year after it is planted", EN, "const season = Math.min(3, at - y + 1),", "const season = Math.min(3, at - y),"),
 ("the third year is counted as the second", EN, "const season = Math.min(3, at - y + 1),", "const season = Math.min(2, at - y + 1),"),
 ("his share does not replace the published one", EN, "value: m != null ? m : fallback,", "value: fallback != null ? fallback : m,"),
 ("the published share for the year after is another", EN, "{ name: /raspberr/i, shares: [0, 80],", "{ name: /raspberr/i, shares: [0, 70],"),
 ("a crop with no published figure gives nothing in its first year", EN, "share: cell && cell.value != null ? cell.value : 100 };", "share: cell && cell.value != null ? cell.value : 0 };"),
 ("a share out of 0 to 100 is read", EN, "+n >= 0 && +n <= 100 ? +n : null;", "+n >= 0 ? +n : null;"),
 ("the card is not given a perennial crop's shares", EN, "if (!c || !isPerennial(c) || c.micro || isCoverCrop(c)) return null;", "if (!c || c.micro || isCoverCrop(c)) return null;"),
 ("a stand that gives nothing yet is counted as having no yield", FC, "if (y.set && y.age && !(y.age.share > 0)) continue;", ""),
 ("the forecast does not carry a young stand's season", FC, "...(y.age && y.age.season < 3 ? { age: y.age } : {})", ""),
 ("a young stand is not among its notes", EN, "if (y && y.age && y.age.season < 3) out.push({ k: 'stand',", "if (false) out.push({ k: 'stand',"),
 ("a thing of a young stand is not cut", EN, "const young = y.age ? y.age.share / 100 : 1;", "const young = 1;"),
]
PAGE = [
 ("the first-picking cell has no box", TH, "return td(h('span.yc-line', box({ key: key(t, 'before'),", "return td(why('with the crop'), h('span.yc-line', box({ key: key(t, 'before') + 'x',"),
 ("too many days before are taken", AP, "if (room != null && want > room) return refuse(", "if (false) return refuse("),
 ("the line under the box does not say what it comes to", TH, "`first picked at ${Math.max(1, days[0] - t.before)} days, ${c.name} at ${days[0]}`", "`first picked with ${c.name}`"),
 ("the Schedule does not say when the thing is first picked", PN, "          earlyPicks(eng, p, r),\n", ""),
 ("the Schedule lists early pickings in the order they were entered", PN, ".filter(x => x.ahead).sort((a, b) => a.first - b.first || b.ahead - a.ahead).map(x =>", ".filter(x => x.ahead).map(x =>"),
 ("the Schedule puts the early picking after the planting's own first harvest", PN, "          earlyPicks(eng, p, r),\n          h('li', { dataset: { hook: 'schedule-first' } }, h('span', eng.soldOf(p, r)?.some(x => x.ahead) ? 'Days to harvest' : 'First harvest'), h('b', day(r.first))),\n", "          h('li', { dataset: { hook: 'schedule-first' } }, h('span', eng.soldOf(p, r)?.some(x => x.ahead) ? 'Days to harvest' : 'First harvest'), h('b', day(r.first))),\n          earlyPicks(eng, p, r),\n"),
 ("the Schedule still calls the crop's days to harvest its first harvest", PN, "x => x.ahead) ? 'Days to harvest' : 'First harvest'", "x => x.ahead) ? 'First harvest' : 'First harvest'"),
 ("“Show on the map” goes to the crop's own first picking", HV, "const first = x.from || x.r.first;", "const first = x.r.first;"),
 ("the bed's season reads the crop's own first picking", CD, "pick ${r.harvestDays ? picked({ first: from, last: r.last }) : 'none'}", "pick ${r.harvestDays ? picked(r) : 'none'}"),
 ("the popup has no tag for the days early", HV, "x.ahead ? tag('early',", "false ? tag('early',"),
 ("the card has no row for a young stand", YC, "    if (hc.young) body.append(youngRow(eng, c, hc, row, span));\n", ""),
 ("the young stand's boxes do not say whose figure", YC, "`Published: ${y.source}. Counted only for a stand whose year is typed on its planting. Type your own to replace it.`", "'Published.'"),
 ("a young stand's share typed is not his", YC, "save: k => App.setSell(c.id, { young: hc.young.map((x, j) => j === i ? k : x.mine) },", "save: k => App.setSell(c.id, { young: hc.young.map((x, j) => x.mine) },"),
 ("a stand's panel has no year box", PN, "        standField(eng, p, r),\n", ""),
 ("a year after the season is taken", AP, "if (year != null && !(year >= 1900 && year <= at)) return refuse(", "if (false) return refuse("),
 ("the message does not say the stand's season", AP, "${label} · ${said} · ${worthSaid(was, now)} · no date moves", "${label} · ${worthSaid(was, now)} · no date moves"),
 ("the Expected line does not say a young stand's share", PN, "${how ? ` (${how})` : ''}${standSaid(y.age)}.", "${how ? ` (${how})` : ''}."),
 ("the bed's season has no year box", CD, "h('label.card-box', h('span', 'Variety'), variety), standCardBox(p, r, redraw, readOnly)),", "h('label.card-box', h('span', 'Variety'), variety)),"),
 ("the popup has no tag for a young stand", HV, "x.age ? tag('stand',", "false ? tag('stand',"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
copy = scratch / ("mutant-early-" + mode); caught, missed, broken = [], [], []
already = None
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    cmd = ["node", str(tests / "early_young_test.cjs"), str(copy), str(plan), old] if mode == "node" else ["python3", "-I", str(tests / "early_young_check.py"), str(copy), str(scratch / "shots-early")]
    try: out = subprocess.run(cmd, capture_output=True, text=True, timeout=600).stdout
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
