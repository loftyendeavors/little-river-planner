"""Deliberate faults for the year's edge: the season a planting belongs to and Seeds (js/seedlib.js), Tasks' other jobs (js/week.js),
the forecast across Jan 1 (js/forecast.js), and the screens that show them (js/sowview.js, js/seeds.js, js/harvestview.js). Each is put
into a copy of the app folder, and a line of year_edge_test.cjs (node) or year_edge_check.py (page) that passed with no fault in it must fail.
usage: python3 -I mutate_yearedge.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part,
OLD= the scripts of the build before (year_edge_test.cjs compares with them)
node: seconds a fault. page: about twenty seconds a fault. list: how many faults there are, and nothing else.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
old = os.environ.get("OLD") or str(Path(os.environ.get("LRF_WORK", "/tmp/lrf-work")) / "old" / "js")
SL, WK, FC, SV, SD, HV = "js/seedlib.js", "js/week.js", "js/forecast.js", "js/sowview.js", "js/seeds.js", "js/harvestview.js"
NODE = [
 ("a sowing recorded with nothing used counts the plan's amount", SL, "if (last) return last.sowingReview.unit", "if (false) return last.sowingReview.unit"),
 ("Seeds goes by the planting's own date again", SL, "const season = seasonOf(engine, p, r), dated = yearOfDate(p);", "const season = yearOfDate(p), dated = yearOfDate(p);"),
 ("the season is the year of the planting's date", SL, "return calc.first instanceof Date && !Number.isNaN(+calc.first) ? calc.first.getFullYear() : own;", "return own;"),
 ("earlier work not recorded is still counted to sow", SL, "if (dated !== null && dated < year && start && isoOf(start) < today) {", "if (false) {"),
 ("an earlier year two years back is not said", SL, "if (!outside.years.includes(dated)) outside.years.push(dated);", ""),
 ("earlier work not recorded is left out of the plan too", SL, "{ outside.earlier++; row.earlier++; if (", "{ outside.earlier++; row.earlier++; row.total -= amount || 0; if ("),
 ("work dated in the plan's year is folded as earlier too", SL, "if (dated !== null && dated < year && start && isoOf(start) < today) {", "if (dated !== null && dated <= year && start && isoOf(start) < today) {"),
 ("the seed used is not what counts for a sown planting", SL, "row.total += used != null ? used : amount || 0;", "row.total += amount || 0;"),
 ("a sowing for the next season is counted in this one", SL, "if (season !== year) { if (dated === year", "if (season !== year && dated !== year) { if (dated === year"),
 ("the plan's own end is not said", SL, "if (dated === year && season > year) { outside.later++;", "if (false) { outside.later++;"),
 ("a season two years on is not said", SL, "if (dated === year && season > year) { outside.later++;", "if (dated === year && season === year + 1) { outside.later++;"),
 ("Tasks lists only plantings dated in the year", SL, "const onTasks = (engine, p, year, r) => yearOfDate(p) === +year || seasonOf(engine, p, r) === +year;", "const onTasks = (engine, p, year, r) => yearOfDate(p) === +year;"),
 ("Tasks leaves out the year's own work for the next season", SL, "const onTasks = (engine, p, year, r) => yearOfDate(p) === +year || seasonOf(engine, p, r) === +year;", "const onTasks = (engine, p, year, r) => seasonOf(engine, p, r) === +year;"),
 ("Tasks' other jobs go by the planting's date again", WK, "|| !SL.onTasks(engine, p, year, r)) continue;", "|| String(p.date).slice(0, 4) !== String(year)) continue;"),
 ("stock picked before the year is dropped again", FC, "if (!parts.some(y => at(y.last || r.last) + keepOf(y) - 1 >= 0)) continue;", "if (r.last < start) continue;"),
 ("stock carried in is not kept apart", FC, "avail[i - lo + k] += q / keep; if (i < 0) carry[i - lo + k] += q / keep; }", "avail[i - lo + k] += q / keep; }"),
 ("stock carried in is counted twice", FC, "if (carry[k]) { row.carried[i] += carry[k];", "if (carry[k]) { row.days[i] += carry[k]; row.carried[i] += carry[k];"),
 ("what is to sell after Dec 31 is not said", FC, "if (i >= n) { after += avail[k]; continue; }", "if (i >= n) continue;"),
 ("what is to sell after Dec 31 is counted in the season", FC, "if (i >= n) { after += avail[k]; continue; }", "if (i >= n) { after += avail[k]; inYear += avail[k]; continue; }"),
 ("the year stock was carried in from is not kept", FC, "if (from !== null && !row.carriedFrom.includes(from)) row.carriedFrom.push(from);", ""),
 ("a figure's carried part is all of it", FC, "part === 'carried' ? (carry ? carry[i - x.lo] : 0)", "part === 'carried' ? series[i - x.lo]"),
]
PAGE = [
 ("a task for a later season does not say so", SV, "t.next ? `for ${t.next}` : ''", "''"),
 ("a task in the year before does not say so", SV, "return at === year - 1 ? `in ${at}, the year before`", "return at === year - 1 ? ''"),
 ("earlier work comes onto the list as late", SV, "const isEarlier = (t, now) => isOpen(t) && t.before && t.due < now;", "const isEarlier = (t, now) => false;"),
 ("the earlier line does not open", SV, "    else if (act === 'earlier') { ui.shown.earlier = true; render(); }\n", ""),
 ("Seeds' foot names the next season whatever the season", SD, "h('b', `For ${later.join(' and ')}`)", "h('b', `For ${year + 2}`)"),
 ("Seeds' foot does not say what counts with the next season", SD, "out.later ? h('li', { dataset: { hook: 'seeds-later' } }", "false ? h('li', { dataset: { hook: 'seeds-later' } }"),
 ("Seeds' foot does not say what is earlier work", SD, "out.earlier ? h('li', { dataset: { hook: 'seeds-earlier' } }", "false ? h('li', { dataset: { hook: 'seeds-earlier' } }"),
 ("the carried line is not drawn", HV, "        if (carry) {\n          const from", "        if (false) {\n          const from"),
 ("the crop's line keeps the carried stock", HV, "ownOf(m, row), row, carry ? peak : null", "seriesOf(m, row), row, carry ? peak : null"),
 ("the crop's Season figure keeps the carried stock", HV, "row.total - cut, worth = row.worth - cutWorth;", "row.total, worth = row.worth - cutWorth;"),
 ("the carried line's popup lists every planting", HV, "carriedOf(row), row, peak, row, 'carried'));", "carriedOf(row), row, peak, row));"),
 ("the carried line stands on Picked", HV, "x.carriedTotal > 1e-9 && !(series === 'picked' && m.keeps && !dollars());", "x.carriedTotal > 1e-9;"),
 ("\"?\" does not say what is carried in", HV, "...(m.carried && m.carried.total > 1e-9 ?", "...(false ?"),
 ("\"?\" does not say what is after Dec 31", HV, "...(m.after && m.after.total > 1e-9 ?", "...(false ?"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = NODE if mode == "node" else PAGE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
copy = scratch / ("mutant-yearedge-" + mode); caught, missed, broken = [], [], []
already = None
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    cmd = ["node", str(tests / "year_edge_test.cjs"), str(copy), str(plan), old] if mode == "node" else ["python3", "-I", str(tests / "year_edge_check.py"), str(copy), str(scratch / "shots-yearedge")]
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
