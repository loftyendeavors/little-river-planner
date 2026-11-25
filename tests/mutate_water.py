"""Deliberate faults of Water and feed: each is put into a copy of the app, and the line written for it has to fail.

  python3 -I mutate_water.py <app> <work> <tests> list | node | page [words…]

node: the arithmetic (water_feed_test.cjs). page: the Water page in a real browser (water_feed_check.py).
A fault names the line that has to catch it: for node, a piece of the assertion's own text; for page, the line's first words.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

app, work, tests = map(Path, sys.argv[1:4])
mode, *terms = sys.argv[4:]
faults = {
    "node": [
        ("a controller's report chosen in a review takes the watering's fertilizer away", "waterfeed.js",
         "const others=group.reports.filter(r=>r.feed);", "const others=(group.pending || group.reports).filter(r=>r.feed);",
         "assert.ok(Math.abs((W.feedDelivery(settled)?.totals?.n ?? NaN)-0.1728)<1e-12);"),
        ("two feeds that disagree, neither of them chosen, are not held", "waterfeed.js",
         "if(new Set(others.map(r=>feedKey(r.feed))).size>1) return {feed:others[0].feed,held:true};", "",
         "assert.equal(W.feedDelivery(unsure).held,true);"),
        ("tank mixes and logged waterings are added together", "waterfeed.js",
         "return { n: sum('n'), p: sum('p'), k: sum('k'), count: rows.length, unknown: rows.filter(row => row.n == null).length };\n    };\n    const tanks = side(mixes), logged = side(waterings);",
         "return { n: sum('n'), p: sum('p'), k: sum('k'), count: rows.length, unknown: rows.filter(row => row.n == null).length };\n    };\n    const tanks = side([...mixes, ...waterings]), logged = side(waterings);",
         "assert.equal(both.basis,'tanks');assert.equal(both.counted.n,1);"),
        ("logged waterings stand as the feed whatever the tanks hold", "waterfeed.js",
         "!logged.count || (tanks.count && (tanks.n ?? 0) >= (logged.n ?? 0)) ? 'tanks' : 'waterings'", "!logged.count ? 'tanks' : 'waterings'",
         "assert.equal(both.basis,'tanks');assert.equal(both.counted.n,1);"),
        ("the tanks stand as the feed when the waterings account for more", "waterfeed.js",
         "(tanks.count && (tanks.n ?? 0) >= (logged.n ?? 0)) ? 'tanks'", "tanks.count ? 'tanks'",
         "assert.equal(more.basis,'waterings');assert.equal(more.counted.n,0.8);"),
        ("a mix of unknown weight is counted as nothing, unsaid", "waterfeed.js",
         "unknown: rows.filter(row => row.n == null).length", "unknown: 0",
         "assert.equal(partly.counted.n,0.5);assert.equal(partly.counted.unknown,1);"),
    ],
    "page": [
        ("Water shows though nothing is recorded and nothing was said", "waterview.js",
         "return said === '1' || (said !== '0' && hasRecords());", "return said !== '0';",
         "With nothing recorded and nothing said"),
        ("the tick is not kept", "waterview.js",
         "try { root.localStorage.setItem(KEY, yes ? '1' : '0'); }", "try { root.localStorage.removeItem(KEY); }",
         "Its tick under the Map"),
        ("a ticked mix is not counted as fed", "waterview.js",
         "const counted=f.feed.counted;\n    const area=", "const counted=f.feed.basis==='waterings'?f.feed.counted:null;\n    const area=",
         "A ticked tank mix counts as fed with no watering logged"),
        ("the season's picture leaves the mixes out", "waterview.js",
         "      ...f.feed.rows.map(row=>({at:row.at,n:row.n}))];", "      ];",
         "The season’s picture counts the mix"),
        ("a floor typed on the card is not saved", "app.js",
         "else after.measuredSize = { v: 1, widthFt, lengthFt };", "else after.measuredSize = before.measuredSize;",
         "A garden’s floor is typed on its card"),
        ("the floor's width is saved as its length", "app.js",
         "else after.measuredSize = { v: 1, widthFt, lengthFt };", "else after.measuredSize = { v: 1, widthFt: lengthFt, lengthFt };",
         "A garden’s floor is typed on its card"),
        ("unticked, the refills stay on Tasks", "waterview.js",
         "if (!on() || (!tanks.length && !phone)) return null;", "if (!tanks.length && !phone) return null;",
         "Unticked, the page and its lists go"),
        ("unticked, the tab stays in the header", "waterview.js",
         "if (el) el.hidden = !yes;", "if (el) el.hidden = false;",
         "With nothing recorded and nothing said"),
        ("a plan that holds records does not show Water by itself", "waterview.js",
         "return said === '1' || (said !== '0' && hasRecords());", "return said === '1';",
         "A browser that has said neither way shows Water"),
        ("with no mix recorded, a logged watering is not counted", "waterview.js",
         "const counted=f.feed.counted;\n    const area=", "const counted=f.feed.basis==='tanks'?f.feed.counted:null;\n    const area=",
         "With no tank mix recorded, the logged watering stands as the feed"),
        ("the run list opens nothing", "waterview.js",
         "events.map(e=>button(gardenName(e.r.gardenId)+' · '+printed(e),()=>openRun(e),'wf-open-run'))", "events.map(e=>button(gardenName(e.r.gardenId)+' · '+printed(e),()=>{},'wf-open-run'))",
         "The run list offers the same evidence"),
        ("the Season lens says nothing of the season", "waterview.js",
         "      if(period!=='Today') content.push(summaryBoard);", "",
         "The Season lens says the season’s water and runs"),
    ],
}
if mode == "list":
    print(json.dumps({k: len(v) for k, v in faults.items()}))
    sys.exit()

selected = [f for f in faults[mode] if not terms or any(t.lower() in f[0] for t in terms)]
selected = selected[int(os.environ.get("FROM", 0)):int(os.environ.get("TO", len(selected)))]
missed, broken, caught = [], [], []
work.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=work) as tmp:
    copy = Path(tmp) / "app"
    shutil.copytree(app, copy)
    if mode == "node":
        (copy / "tests").mkdir()
        check = copy / "tests/water_feed_test.cjs"
        shutil.copy2(tests / check.name, check)
        shutil.copy2(tests / "plan_shape.cjs", copy / "tests/plan_shape.cjs")
        command = ["node", str(check)]
    else:
        check = tests / "water_feed_check.py"
        command = ["python3", "-I", str(check), str(copy)]
    lines = check.read_text().splitlines()

    def run():
        result = subprocess.run(command, capture_output=True, text=True, timeout=600)
        last = (result.stdout.strip().splitlines() or [""])[-1]
        try: return result, json.loads(last[last.index("{"):])
        except Exception: return result, None

    baseline, said = run()
    if baseline.returncode or not said or said.get("failed") or said.get("passed") != said.get("of"):
        raise SystemExit("The unchanged check did not pass: " + (baseline.stderr or baseline.stdout)[-400:])

    for name, filename, before, after, line in selected:
        path = copy / "js" / filename
        original = path.read_text()
        places = [i for i, text in enumerate(lines, 1) if line in text]
        if original.count(before) != 1 or len(places) != 1:
            broken.append(name)
            print("BROKEN", name, flush=True)
            continue
        path.write_text(original.replace(before, after))
        try:
            result, said = run()
        finally:
            path.write_text(original)
        if mode == "node":   # an assertion that fails stops the file: the line it names is in what was thrown
            found = result.returncode != 0 and "AssertionError" in result.stderr and f"{check}:{places[0]}:" in result.stderr
        else:                # a page line that fails is named in the result
            found = bool(said) and any(label.startswith(line) for label in said.get("failed", []))
        (caught if found else missed).append(name)
        print("caught" if found else "MISSED", name, flush=True)
        if not found:
            print((result.stderr or result.stdout)[-500:], flush=True)
print(json.dumps({"faults": len(selected), "caught": len(caught), "missed": missed, "broken": broken}))
