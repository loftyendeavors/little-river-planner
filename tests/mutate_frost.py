"""Deliberate faults for E2c's rule of the first fall frost in open ground, and a last picking for each place (the engine): each is
put into a copy of the app folder, and a line of frost_test.cjs that passed with no fault in it must fail.
usage: python3 -I mutate_frost.py <app> <scratch> <tests-dir> <plan.json> [node | list] [words…]     env FROM=, TO= to run a part
node: seconds a fault. list: how many faults there are, and nothing else.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
EN = "js/engine.js"
NODE = [
 ("the frost cuts nothing", EN, "const frost = own ? null : frostEnd(c, b, field);", "const frost = null;"),
 ("a last day of the planting's own does not stand over the frost", EN, "const frost = own ? null : frostEnd(c, b, field);", "const frost = frostEnd(c, b, field);"),
 ("under cover is cut as if it were open ground", EN, "return kind ? kind === 'outdoor' : g.type === 'field' || g.type === 'towers';", "return true;"),
 ("hardy crops are cut too", EN, "return c && c.frostTender && b && !isRack(b) && openGround(g)", "return c && b && !isRack(b) && openGround(g)"),
 ("the frost day itself is not picked", EN, "addDays(frostDates(field.getFullYear()).first, finite(g.frostOffset)) : null;", "addDays(frostDates(field.getFullYear()).first, finite(g.frostOffset) - 1) : null;"),
 ("the yield does not follow the days the frost leaves", EN, "part = clamp(pickedDays(r, pattern) / Math.max(1, r.expectedHarvestDays), 0, 1);", "part = clamp((r.frostCut ? r.frostCut.plannedDays : r.harvestDays) / Math.max(1, r.expectedHarvestDays), 0, 1);"),
 ("a crop cleared in one day loses yield to a frost after it is ready", EN, "pattern === 'once' && r.frostCut && r.harvestDays > 0 ? r.frostCut.plannedDays : r.harvestDays;", "r.harvestDays;"),
 ("a crop cleared in one day and ready after the frost is counted whole", EN, "pattern === 'once' && r.frostCut && r.harvestDays > 0 ? r.frostCut.plannedDays", "pattern === 'once' && r.frostCut ? r.frostCut.plannedDays"),
 ("a cut planting does not say so", EN, "      if (r.frostCut && !isCoverCrop(r.c)) {", "      if (false) {"),
 ("a cut planting says the wrong days", EN, "${r.harvestDays} of ${fc.plannedDays} days are picked", "${fc.plannedDays} of ${fc.plannedDays} days are picked"),
 ("the cut is not told to the yield", EN, "...(frostCut ? { frostCut } : {}),", "...({}),"),
 ("a clear recorded after the frost is overruled by it", EN, "const recorded = !!actualClear || !!(p.workflow && p.workflow.outcome === 'failed') || !!failedOn(p),", "const recorded = !!(p.workflow && p.workflow.outcome === 'failed'),"),
 ("a failure recorded after the frost is overruled by it", EN, "const recorded = !!actualClear || !!(p.workflow && p.workflow.outcome === 'failed') || !!failedOn(p),", "const recorded = !!actualClear,"),
 ("a failure recorded with no day is cut by the frost too", EN, "const recorded = !!actualClear || !!(p.workflow && p.workflow.outcome === 'failed') || !!failedOn(p),", "const recorded = !!actualClear || validDate(failure),"),
 ("a crop picked to the season's end and cut by the frost is told twice", EN, "positive(r.c.yieldDays, positive(r.c.hw, 1)) && !r.frostCut) {", "positive(r.c.yieldDays, positive(r.c.hw, 1))) {"),
 ("a planting marked failed after the frost is cut by it as well", EN, "|| !!failedOn(p), shelteredTill", ", shelteredTill"),
 ("a crate under shelter on the frost is cut", EN, "!(shelteredTill && shelteredTill > period.frost.day)", "true"),
 ("a crate moved out before the frost is not cut", EN, "!(shelteredTill && shelteredTill > period.frost.day)", "!shelteredTill"),
 ("a crop cleared in one day reads the line's date", EN, "ownHarvest(p) || rule.pattern === 'once') return null;", "ownHarvest(p)) return null;"),
 ("a planting ready after the frost is also told its harvest period ended", EN, "r.harvestDays === 0 && !r.frostCut) out.push({ k: 'timing',", "r.harvestDays === 0) out.push({ k: 'timing',"),
 ("a place's own date is not read", EN, "      if (mine) ends.push(mine);\n      else {", "      if (false) ends.push(mine);\n      else {"),
 ("a place's own date does not stand over the frost under cover", EN, "      if (mine) ends.push(mine);\n      else {\n        if (c.frostTender && g.frost) ends.push(addDays(frostDates(year).first, finite(g.frostOffset)));",
  "      if (mine) ends.push(mine);\n      if (c.frostTender && g.frost) ends.push(addDays(frostDates(year).first, finite(g.frostOffset)));\n      {"),
 ("a planting with a harvest window of its own follows the line's date", EN, "if (!until || !env || !until[env] || ownHarvest(p) || rule.pattern === 'once') return null;", "if (!until || !env || !until[env] || rule.pattern === 'once') return null;"),
 ("a date set for one place is read in every place", EN, "if (!until || !env || !until[env] || ownHarvest(p) || rule.pattern === 'once') return null;   // a crop cleared in one day has no last picking\n      const v = growingVariety(p);\n      return v && v.cropId === p.cropId && ownHarvest(v) ? null : monthDayDate(year, until[env]);",
  "if (!until || !env || ownHarvest(p) || rule.pattern === 'once') return null;\n      const v = growingVariety(p);\n      return v && v.cropId === p.cropId && ownHarvest(v) ? null : monthDayDate(year, Object.values(until)[0]);"),
 ("a date that is no month and day is read", EN, "for (const env of ENVS) if (validMonthDay(x[env])) out[env] = x[env];", "for (const [env, v] of Object.entries(x)) out[env] = v;"),
 ("a tunnel's season end is said to be the frost", EN, "[frost, openGround(g) ? 'frost' : 'cover']", "[frost, 'frost']"),
 ("under cover with no days kept off, the frost is said to come in the open", EN, "[frost, openGround(g) ? 'frost' : 'cover']", "[frost, finite(g.frostOffset) && !openGround(g) ? 'cover' : 'frost']"),
 ("the card is not told the day the garden closes", EN, "frost: frost && openGround(g) ? frost : null, close: win.close || null };", "frost: frost && openGround(g) ? frost : null, close: null };"),
 ("a date of his runs past the day the garden closes", EN, "      if (win.close) ends.push(win.close);\n      // his own", "      // his own"),
 ("under cover a date of his is said to be cut by the frost", EN, "return { date: ends[0][0], by: ends[0][1], frost: frost && openGround(g) ? frost : null, close: win.close || null };", "return { date: ends[0][0], by: ends[0][1], frost, close: win.close || null };"),
 ("the line's dates are not given to the card", EN, "until: micro ? {} : { ...(rule.until || {}) },", "until: {},"),
]
if mode == "list": print(json.dumps({"node": len(NODE)})); sys.exit(0)
faults = NODE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
copy = scratch / "mutant-frost"; caught, missed, broken = [], [], []
already = None
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("thumbs.json", "farm-map.jpg", "dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    try: out = subprocess.run(["node", str(tests / "frost_test.cjs"), str(copy), str(plan)], capture_output=True, text=True, timeout=300).stdout
    except subprocess.TimeoutExpired: out = "timed out"
    try: d = json.loads(out[out.rfind('{"passed"'):]); names = [str(x) for x in d["failed"]]; ran = True
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
