"""Deliberate faults for E2d: a sown crop's figure that says the rows it was typed for, a plant's figure that says its spacing, the
row-foot that holds, the bed a box speaks of, and the figure joined with its rows as one value (the engine and the merge): each
is put into a copy of the app folder, and a line of e2d_test.cjs that passed with no fault in it must fail.
usage: python3 -I mutate_e2d.py <app> <scratch> <tests-dir> <plan.json> [node | page | list] [words…]     env FROM=, TO= to run a part
node: seconds a fault (e2d_test.cjs). page: the card in a browser, about half a minute a fault (e2d_check.py). list: how many faults there are, and nothing else.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path
app, scratch, tests, plan = [Path(x).resolve() for x in sys.argv[1:5]]
mode = sys.argv[5] if len(sys.argv) > 5 else "node"; words = [w.lower() for w in sys.argv[6:]]
EN = "js/engine.js"; MG = "js/merge.js"
NODE = [
 ("the rows a figure says are not read", EN, "basis === 'ft' && forRows(cell.rows) ? r.totalRows / forRows(cell.rows)", "basis === 'ft' && false ? r.totalRows / forRows(cell.rows)"),
 ("the rows are divided the wrong way", EN, "? r.totalRows / forRows(cell.rows) :", "? forRows(cell.rows) / r.totalRows :"),
 ("a planting's own share of the rows is used, not the bed's", EN, "? r.totalRows / forRows(cell.rows) :", "? r.rows / forRows(cell.rows) + 0 * r.totalRows + (r.totalRows === forRows(cell.rows) ? 0 : 1) :"),
 ("the spacing a figure says is not read", EN, "basis === 'plant' && forInRow(cell.inRow) ? r.inRow / forInRow(cell.inRow) : 1;", "1;"),
 ("the spacing is divided the wrong way", EN, "? r.inRow / forInRow(cell.inRow) : 1;", "? forInRow(cell.inRow) / r.inRow : 1;"),
 ("a tower and a crate are scaled too", EN, "!cell || r.tw || r.ct || r.rack ? 1 :", "!cell ? 1 :"),
 ("the scale is left out of the yield", EN, "* young * scale, scale,", "* young, scale,"),
 ("the scale is not told", EN, "* young * scale, scale,", "* young * scale,"),
 ("a variety's figure takes the crop's rows", EN, "const cell = fromC != null ? listedCell('crops', p.cropId, env) : null,", "const cell = !own ? listedCell('crops', p.cropId, env) : null,"),
 ("a planting's own yield takes the crop's rows", EN, "const cell = fromC != null ? listedCell('crops', p.cropId, env) : null,", "const cell = listedCell('crops', p.cropId, env),"),
 ("rows that are no whole number are read", EN, "const forRows = v => Number.isSafeInteger(v) && v >= 1 && v <= 1000 ? v : null,", "const forRows = v => +v > 0 ? +v : null,"),
 ("a thousand and one rows are read", EN, "Number.isSafeInteger(v) && v >= 1 && v <= 1000 ? v : null,", "Number.isSafeInteger(v) && v >= 1 ? v : null,"),
 ("rows are read on a crop counted a plant", EN, "basis === 'ft' && forRows(cell.rows) ? r.totalRows", "forRows(cell.rows) ? r.totalRows"),
 ("a spacing is read on a sown crop", EN, "basis === 'plant' && forInRow(cell.inRow) ? r.inRow / forInRow(cell.inRow) : 1;", "forInRow(cell.inRow) ? r.inRow / forInRow(cell.inRow) : 1;"),
 ("the planting does not say the rows its figure is for", EN, "...(rowsFor ? { rowsFor, rowFeet:", "...(false ? { rowsFor, rowFeet:"),
 ("the row-feet are the bed's feet", EN, "rowFeet: r.rows * r.physicalLength,", "rowFeet: r.physicalLength,"),
 ("the row-foot yield is the bed-foot's", EN, "perRowFt: each / rowsFor }", "perRowFt: each }"),
 ("the planting does not say the spacing its figure is for", EN, "...(inRowFor ? { inRowFor } : {}),", ""),
 ("the crop's line does not say the rows", EN, "rows: held && c.yBasis === 'ft' ? forRows(held.rows) : null,", "rows: null,"),
 ("the crop's line does not say the spacing", EN, "inRow: held && c.yBasis !== 'ft' ? forInRow(held.inRow) : null,", "inRow: null,"),
 ("the crop's line says rows in every place", EN, "(v ? mine == null && fromC != null : mine != null) ? listedCell('crops', cropId, env) : null;", "true ? (listedCell('crops', cropId, env) || listedCell('crops', cropId, 'field')) : null;"),
 ("the box speaks of the rarest bed", EN, "const top = m => [...m.values()].sort((a, b) => b.n - a.n)[0];", "const top = m => [...m.values()].sort((a, b) => a.n - b.n)[0];"),
 ("the box's bed is the planting's length, not the bed's", EN, "bump(beds, r.cap + '|' + r.totalRows, { ft: r.cap, rows: r.totalRows });", "bump(beds, r.cap + '|' + r.totalRows, { ft: r.cap + 1, rows: r.totalRows });"),
 ("beds of different rows are not said to differ", EN, "mixed: rowsSeen.size > 1,", "mixed: false,"),
 ("a tower has a bed to speak of", EN, "if (c && !c.micro && env !== 'tower') {", "if (c && !c.micro) { if (env === 'tower') { statedCache.set(key, { ft: 1, rows: 1, inRow: 1, n: 0, mixed: false }); return statedCache.get(key); }"),
 ("with nothing planted the box has no bed", EN, "if (!n) for (const b of S.beds || []) {", "if (false) for (const b of S.beds || []) {"),
 ("a figure with rows is still called a bed-foot", EN, "(rows ? 'a row-foot' : short ? 'a bed-foot' : 'a bed-foot, rows not said')", "(short ? 'a bed-foot' : 'a bed-foot, rows not said')"),
 ("inside a longer phrase a figure with no rows is not the short word", EN, "(rows ? 'a row-foot' : short ? 'a bed-foot' : 'a bed-foot, rows not said')", "(rows ? 'a row-foot' : 'a bed-foot, rows not said')"),
 ("a figure with no rows is called a row-foot", EN, "(rows ? 'a row-foot' : short ? 'a bed-foot' : 'a bed-foot, rows not said')", "'a row-foot'"),
 ("the figure and its rows are joined key by key", MG, "'assumptions.crops.*.*': [['yield', 'rows', 'inRow']] };", "};"),
 ("the rows are joined apart from the figure", MG, "'assumptions.crops.*.*': [['yield', 'rows', 'inRow']] };", "'assumptions.crops.*.*': [['yield', 'inRow']] };"),
 ("a place written with * is not found", MG, "      if (hit) return hit[1];\n", ""),
]
YC = "js/yieldcard.js"; AP = "js/app.js"; PN = "js/panels.js"
PAGE = [
 ("a figure that moves other beds is taken with no sheet", YC, "if (m && m.held && m.list.length) {", "if (false) {"),
 ("the figure is kept for other rows than the box says", YC, "how: { rows: st.rows }, said:", "how: { rows: st.rows + 1 }, said:"),
 ("the figure typed for a bed is kept as if for a foot", YC, "bx && bx.bed ? v / bx.st.ft : tenths", "bx && bx.bed ? v : tenths"),
 ("the box shows a foot's figure, not the bed's", YC, "return { bed: true, st, k: st.ft * (cell.rows ? st.rows / cell.rows : 1),", "return { bed: true, st, k: (cell.rows ? st.rows / cell.rows : 1),"),
 ("a figure kept for other rows is shown as if for the box's", YC, "k: st.ft * (cell.rows ? st.rows / cell.rows : 1),", "k: st.ft,"),
 ("what clearing goes back to takes the typed figure's rows", YC, "kf = bx && bx.bed ? bx.st.ft : 1,", "kf = k,"),
 ("the sheet's worth is not the engine's", YC, "return { held, list, worth: [study(eng).worth, F.build(next)", "return { held, list, worth: [study(eng).worth, 1 + F.build(next)"),
 ("the sheet leaves a planting out", YC, "if (Math.abs(ya.units - yb.units) > 1e-9) {", "if (Math.abs(ya.units - yb.units) > 1e-9 && !list.length) {"),
 ("the sheet does not say the bed's rows", YC, "${at.bed ? plural(x.rows, 'row') : `${fig(x.inRow)} in apart`}, ${fig(x.ft)} ft:", "${fig(x.ft)} ft:"),
 ("the sheet hides plantings beyond the first twelve", YC, "more = m.list.slice(12);", "more = [];"),
 ("the line under the box does not say the row-foot", YC, "`${fig(cell.value / cell.rows)}${u} a row-foot${weekly ? ' a week' : ''}`)", "`${fig(cell.value)}${u}`)"),
 ("a figure with no rows is not said to have none", YC, "`a bed-foot, rows not said${bx.st.mixed ? ': its beds differ in rows' : ''}`", "''"),
 ("the box does not say its bed", YC, "bx && bx.bed && !T.any ? `${unit === 'each' ? '' : unit + ' '}from ${of}` :", "false ? '' :"),
 ("a plant's figure at one spacing is kept without it", YC, "how: cell.inRow || st.spacings <= 1 ? { inRow: st.inRow } : null,", "how: null,"),
 ("a variety's figure takes rows", AP, "    if (kind !== 'crops') how = undefined;", "    "),
 ("a figure typed on the list drops the cell's rows", AP, "if (none || how) { setCell(next, kind, id, env, 'rows', none ? null : whole(how.rows));", "how = how || {}; { setCell(next, kind, id, env, 'rows', none ? null : whole(how.rows));"),
 ("a figure cleared leaves its rows", AP, "if (none || how) { setCell(next, kind, id, env, 'rows', none ? null : whole(how.rows));", "if (how) { setCell(next, kind, id, env, 'rows', none ? null : whole(how.rows));"),
 ("the planting's panel does not say the row-foot", PN, "a row-foot × ${num(r.rows)} row", "a foot × ${num(r.rows)} row"),
]
if mode == "list": print(json.dumps({"node": len(NODE), "page": len(PAGE)})); sys.exit(0)
faults = PAGE if mode == "page" else NODE
if words: faults = [f for f in faults if any(w in f[0].lower() for w in words)]
faults = faults[int(os.environ.get("FROM", "0")):int(os.environ.get("TO", "999"))]
copy = scratch / "mutant-e2d"; caught, missed, broken = [], [], []
already = None
for name, rel, was, new in ([(None, None, None, None)] if faults else []) + faults:
    if copy.exists(): shutil.rmtree(copy)
    shutil.copytree(app, copy, ignore=shutil.ignore_patterns("dev") if mode == "page" else shutil.ignore_patterns("thumbs.json", "farm-map.jpg", "dev"))
    if name is not None:
        f = copy / rel; s = f.read_text(encoding="utf-8")
        if s.count(was) != 1 or was == new: broken.append(name); print(f"BROKEN {name} :: the text to change is there {s.count(was)} times", flush=True); continue
        f.write_text(s.replace(was, new), encoding="utf-8")
    try: out = subprocess.run((["python3", "-I", str(tests / "e2d_check.py"), str(copy), str(scratch / "shots")] if mode == "page" else ["node", str(tests / "e2d_test.cjs"), str(copy), str(plan), str(app.parent / "old" / "js")]), capture_output=True, text=True, timeout=300).stdout
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
