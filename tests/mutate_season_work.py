"""Verify that the season workflow checks catch specific wrong results on the fictional farm."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

app, work, tests = map(Path, sys.argv[1:4])
mode, *terms = sys.argv[4:]
# The last string names the assertion that must detect each change.
faults = {
    "node": [
        ("a later desktop date replaces a picked planting's date", "merge.js",
         "if (!m.size && !t.size) return plan;", "return plan;",
         "assert.equal(joined.plan.plantings[0].date,"),
        ("a tray demand edit shrinks a picked batch", "merge.js",
         "if (p.liveTray) {", "if (false) {", "assert.equal(merged.plan.plantings[0].trays,5)"),
    ],
    "page": [
        ("a saved run offers its recorded sowings for editing", "app.js",
         "p, locked: !!p.liveTray || Trays.locked(state.plan, p, records)", "p, locked: false",
         'get_by_text("Recorded", exact=True).count() == 2'),
        ("weekly buyer demand ignores available produce", "harvestview.js",
         "gap = Math.max(0,sum - available)", "gap = sum", 'assert "14 more needed"'),
        ("a harvest adds culls to its marketable quantity", "app.js",
         "marketable:input.marketable, culls:input.culls", "marketable:input.marketable + input.culls, culls:input.culls",
         'assert "72 marketable, 8 culls"'),
        ("a commercial crop week includes the household picking", "harvestview.js",
         "return planting && !F.useOf(engine, planting).personal;", "return !!planting;",
         'assert "5.75 marketable picked · 1.25 culls"'),
        ("a crop week counts stored stock as a forecast picking", "harvestview.js",
         "picking += F.sum(stock.picked", "picking += F.sum(stock.days",
         'assert "Forecast picking 0 lb"'),
        ("the detailed bench week understates peak occupancy", "bench.js",
         "num(pool.used,1) + ' of '", "num(pool.used - 1,1) + ' of '",
         'assert peak["used"]+" of "+peak["cap"]'),
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
        check = copy / "tests/season_records_test.cjs"
        shutil.copy2(tests / check.name, check)
        command = ["node", str(check)]
    else:
        check = tests / "season_work_check.py"
        command = ["python3", "-I", str(check), str(copy)]
    lines = check.read_text().splitlines()
    baseline = subprocess.run(command, capture_output=True, text=True, timeout=180)
    expected = 14 if mode == "node" else 7
    if baseline.returncode or json.loads(baseline.stdout.strip().splitlines()[-1]) != {"passed": expected, "of": expected, "failed": []}:
        raise SystemExit("The unchanged check did not pass: " + baseline.stderr[-400:])

    for name, filename, before, after, assertion in selected:
        path = copy / "js" / filename
        original = path.read_text()
        locations = [i for i, line in enumerate(lines, 1) if assertion in line]
        if original.count(before) != 1 or len(locations) != 1:
            broken.append(name)
            print("BROKEN", name, flush=True)
            continue
        path.write_text(original.replace(before, after))
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        finally:
            path.write_text(original)
        marker = f"{check}:{locations[0]}:" if mode == "node" else f'"{check}", line {locations[0]},'
        found = result.returncode != 0 and "AssertionError" in result.stderr and marker in result.stderr
        (caught if found else missed).append(name)
        print("caught" if found else "MISSED", name, flush=True)
        if not found:
            print(result.stderr[-500:], flush=True)
print(json.dumps({"faults": len(selected), "caught": len(caught), "missed": missed, "broken": broken}))
