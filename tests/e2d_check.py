"""E2d in a real browser, on the made-up farm: a sown crop's yield typed for a bed with its rows, through the card's own box.
  The crop's card (Assumptions, Yield and price) for a sown crop that stands on beds of different rows: the box says the bed it
  speaks of (its length and rows, the commonest the crop stands on there) and shows the crop's own figure for that whole bed; the
  line under it says plainly that the figure says no rows. Nothing is written by opening the card. A figure typed is not taken at
  once: a sheet lists every planting whose yield it changes, before and after, with the season's worth, worked out as the engine
  works it out on a copy of the plan; Cancel leaves the plan as it was. Taken, it is one step: the plan holds the figure a foot of
  that bed with its rows beside it, the plantings on those rows give what the typed figure gives by their length, the others by
  their rows, no date moves, the line under the box says the row-foot, and the planting's panel says the row-foot too. Undo takes
  it back whole. A crop counted a plant, at one spacing everywhere, takes a typed figure at once with its spacing beside it.
Every subject is found on the plan the page was given by the engine's own figures: nothing here names a crop, a bed or a number.
usage: python3 -I e2d_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1480")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, failed, errors = [], [], []
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, HV = LRFHarvestView, UI = LRFUI, $ = id => document.getElementById(id);"
       "const hook = (name, el) => (el || document).querySelector(`[data-hook=\"${name}\"]`), hooks = (name, el) => [...(el || document).querySelectorAll(`[data-hook=\"${name}\"]`)];"
       "const txt = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';"
       "const worthOf = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0), money = n => '$' + Math.round(n).toLocaleString('en-US');"
       "const copy = () => JSON.parse(JSON.stringify(S.plan)), engineOf = plan => E.create(plan, LRFLibrary);"
       "const toast = () => txt(document.querySelector('#toast span'));"
       "const snap = () => ({ key: A.contentKey(), undo: S.undo.length, plan: JSON.stringify({ ...S.plan, lrfNext: null }) });"
       # every planting's dates and ground: what must not move
       "const dates = e => e.plan.plantings.map(p => { const r = e.calc(p); return r ? [p.id, E.d2s(r.field), E.d2s(r.first), E.d2s(r.last), r.harvestDays, String(+e.occupancyThrough(p, r))].join('|') : p.id; }).join('\\n');"
       "const rowsOf = e => F.build(e).rows.map(r => [r.key, r.total.toFixed(9), r.worth.toFixed(9), Array.from(r.days, v => v.toFixed(9)).join(',')].join('|')).join('\\n');"
       "const days = (a, b) => Math.round(E.dayDiff(a, b));"
       "const typeIn = (el, v) => { if (!el) return false; el.focus(); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
    page.evaluate("LRFApp.state.undo.length = 0")
    def js(body, arg=None): return page.evaluate("(arg) => { " + PRE + body + " }", arg)
    def wait(ms): page.wait_for_timeout(ms)
    def shot(name): page.screenshot(path=str(shots / f"{name}.png"))
    def close_dialogs(): js("for (const d of document.querySelectorAll('dialog[open]')) { const b = d.querySelector('.btn.primary'); if (b) b.click(); } return 1;"); wait(300)
    start = js("return snap();")
    # ── the subject: a sown crop that follows its own record, on beds of different rows in one place, with nothing else sold ──
    sub = js("""const eng = S.engine, by = new Map();
      for (const p of S.plan.plantings) { const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null;
        if (!y || y.basis !== 'ft' || y.own || y.by !== 'default' || !y.set || !(y.units > 0) || r.tw || r.ct || r.rack || eng.thingsOf(p.cropId).length || eng.harvestFor(p.cropId).weekly) continue;
        const k = p.cropId + '|' + eng.envOf(r.b); by.set(k, [...(by.get(k) || []), { id: p.id, rows: r.totalRows, ft: r.physicalLength, units: y.units }]); }
      const hit = [...by].filter(([k, list]) => new Set(list.map(x => x.rows)).size > 1 && !eng.harvestFor(k.split('|')[0]).open.yield).sort((a, b) => b[1].length - a[1].length)[0];
      if (!hit) return null;
      const [crop, env] = hit[0].split('|'), st = eng.statedFor(crop, env), hc = eng.harvestFor(crop);
      return { crop, env, name: eng.crop(crop).name, list: hit[1], st, figure: hc.cells[env].value, unit: hc.unit.value };""")
    check("the plan has a sown crop on beds of different rows that follows its own record, to try", bool(sub), sub)
    if not sub: finish()
    C, ENV, ST = sub["crop"], sub["env"], sub["st"]
    def card(): js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", C); wait(700)
    def cell(): return js("const td = document.querySelector(`#ycCard td[data-place=\"${arg}\"] [data-yk=\"y|${arg}\"]`), box = td, tdEl = box && box.closest('td'); if (!box) return null; const kept = hook('yield-kept', tdEl), of = hook('yield-of', tdEl), say = hook('yield-say', tdEl); return { value: box.value, placeholder: box.placeholder, label: box.getAttribute('aria-label'), of: txt(of), kept: txt(kept), rows: kept ? kept.dataset.rows : null, say: !!say, total: txt(tdEl.querySelector('.yc-total')) };", ENV)
    card(); before = cell()
    shot("card-before")
    check("opening the card writes nothing", js("return snap().plan;") == start["plan"] and js("return S.undo.length;") == 0)
    check("the box says the bed it speaks of: its length and its rows, the commonest the crop stands on there", bool(before) and ("%g-ft bed of %d row" % (ST["ft"], ST["rows"])) in before["of"] and ("%g-ft bed of %d row" % (ST["ft"], ST["rows"])) in before["label"], before)
    check("it shows, grey, the crop's own figure for that whole bed", bool(before) and before["value"] == "" and abs(float(before["placeholder"] or 0) - sub["figure"] * ST["ft"]) < 0.51, [before, sub["figure"], ST])
    check("and the line under it says plainly that the figure says no rows, and that its beds differ", bool(before) and "a bed-foot, rows not said" in before["kept"] and "differ" in before["kept"] and before["rows"] == "", before)

    # ── a figure typed: shown first ──
    typed = round(sub["figure"] * ST["ft"] * 1.5)
    want = js("""const eng = S.engine, next = copy(); next.assumptions = { v: 1, crops: {}, varieties: {}, ...(next.assumptions || {}) };
      next.assumptions.crops[arg.crop] = { ...(next.assumptions.crops[arg.crop] || {}), [arg.env]: { yield: Math.round(arg.typed / arg.ft * 1e6) / 1e6, rows: arg.rows } };
      const e2 = engineOf(next), moved = [];
      for (const p of S.plan.plantings) { if (p.cropId !== arg.crop) continue; const a = eng.givenOf(p), b = e2.givenOf(e2.planting(p.id)); if (a && b && Math.abs(a.units - b.units) > 1e-9) moved.push({ id: p.id, was: a.units, now: b.units, field: E.d2s(eng.calc(p).field) }); }
      return { moved, worth: [worthOf(eng), worthOf(e2)], dates: dates(e2) === dates(eng), rows: rowsOf(e2), cell: next.assumptions.crops[arg.crop][arg.env] };""", {"crop": C, "env": ENV, "typed": typed, "ft": ST["ft"], "rows": ST["rows"]})
    def type_it(v): return js("const box = document.querySelector(`#ycCard [data-yk=\"y|${arg.env}\"]`); return typeIn(box, arg.v);", {"env": ENV, "v": v})
    def sheet(): return js("const d = document.querySelector('dialog[open]'); if (!d) return null; const m = hook('yield-moves', d), w = hook('yield-worth', d); return { text: txt(d), n: m ? +m.dataset.n : null, moves: hooks('yield-move', d).map(li => ({ id: li.dataset.planting, was: +li.dataset.was, now: +li.dataset.now, text: txt(li) })), worth: w ? [+w.dataset.was, +w.dataset.now] : null, wtext: txt(w), buttons: [...d.querySelectorAll('button')].map(txt) };")
    type_it(typed); wait(700); sh = sheet()
    shot("sheet")
    check("a figure typed is not taken at once: nothing is written, and a sheet is up", bool(sh) and js("return snap().plan;") == start["plan"] and js("return S.undo.length;") == 0, sh)
    near = lambda a, b: abs(a - b) <= 1e-6 * max(1, abs(a), abs(b))
    check("the sheet lists every planting whose yield the figure changes, before and after, as the engine works them out", bool(sh) and len(sh["moves"]) == sh["n"] == len(want["moved"]) and len(want["moved"]) > 1 and all(any(m["id"] == w["id"] and near(m["was"], w["was"]) and near(m["now"], w["now"]) for m in sh["moves"]) for w in want["moved"]), [sh and sh["moves"][:3], want["moved"][:3]])
    fields = {m["id"]: m["field"] for m in want["moved"]}
    check("each line says the planting date, bed, rows and length", bool(sh) and all(m["id"] in fields and fields[m["id"]] in m["text"] and " row" in m["text"] and " ft" in m["text"] and "→" in m["text"] for m in sh["moves"]), sh and sh["moves"][:2])
    check("it gives the season's worth before and after, the engine's own", bool(sh) and bool(sh["worth"]) and near(sh["worth"][0], want["worth"][0]) and near(sh["worth"][1], want["worth"][1]) and "goes from" in sh["wtext"], [sh and sh["worth"], want["worth"]])
    check("it says what the figure is for, and that one Undo takes it back", bool(sh) and ("%g-ft bed of %d row" % (ST["ft"], ST["rows"])) in sh["text"] and "row-foot" in sh["text"] and "undo" in sh["text"].lower(), sh and sh["text"][:300])
    js("const d = document.querySelector('dialog[open]'), b = d && [...d.querySelectorAll('button')].find(x => !x.classList.contains('primary')); if (b) b.click(); else if (S.undo.length) A.undo(); return 1;"); wait(500)
    check("Cancel leaves the plan as it was, and the box as it was", js("return snap().plan;") == start["plan"] and js("return S.undo.length;") == 0 and (cell() or {}).get("value") == "", cell())

    # ── taken: one step ──
    card(); type_it(typed); wait(700)
    js("const d = document.querySelector('dialog[open]'), b = d && d.querySelector('.btn.primary'); if (b) b.click(); return 1;"); wait(900)
    got = js("""const eng = S.engine, c = ((S.plan.assumptions || {}).crops || {})[arg.crop] || {}; return { cell: c[arg.env] || null, others: Object.keys(c).filter(k => k !== arg.env), undo: S.undo.length, rows: rowsOf(eng), toast: toast(),
      units: Object.fromEntries(S.plan.plantings.filter(p => p.cropId === arg.crop).map(p => [p.id, (eng.givenOf(p) || {}).units])) };""", {"crop": C, "env": ENV})
    check("taken, it is one step, and the plan holds the figure a foot of that bed with its rows beside it", got["undo"] == 1 and got["cell"] == want["cell"] and got["cell"]["rows"] == ST["rows"] and not got["others"], [got["cell"], want["cell"]])
    check("the forecast is the one worked out on a copy of the plan changed by hand, and no date moved", got["rows"] == want["rows"] and want["dates"] and js("return dates(S.engine);") == js("return dates(engineOf(JSON.parse(arg)));", start["plan"]))
    same = [x for x in sub["list"] if x["rows"] == ST["rows"]]; other = [x for x in sub["list"] if x["rows"] != ST["rows"]]
    check("a planting on the box's rows gives the typed figure by its length; one on other rows gives it by its rows as well", bool(same) and bool(other) and all(near(got["units"][x["id"]], x["units"] * 1.5 * (typed / (sub["figure"] * ST["ft"] * 1.5))) for x in same) and all(near(got["units"][x["id"]], x["units"] * (typed / (sub["figure"] * ST["ft"])) * x["rows"] / ST["rows"]) for x in other), [same[:2], other[:2], got["units"]])
    after = cell()
    shot("card-after")
    check("the box holds the figure as typed, and the line under it says the row-foot", bool(after) and float(after["value"] or 0) == typed and "a row-foot" in after["kept"] and after["rows"] == str(ST["rows"]) and ("%.3g" % (typed / ST["ft"] / ST["rows"]))[:4] in after["kept"], after)
    check("the message says the season's worth", "$" in got["toast"] and "goes from" in got["toast"], got["toast"])
    # the planting's own panel says the row-foot
    pid = other[0]["id"]
    line = js("A.setView('map'); A.select({ type: 'planting', id: arg }); return 1;", pid); wait(700)
    said = js("return txt(document.getElementById('fYieldLine'));")
    check("a planting on other rows says, on its panel, that its yield is a row-foot's by its rows and its length", "a row-foot × %d row" % other[0]["rows"] in said and "ft" in said, said)
    js("A.undo(); return 1;"); wait(500)
    check("Undo takes it back whole: the plan is the one the page was given", js("return snap().plan;") == start["plan"])

    # ── a figure that says no rows keeps its meaning when it is typed on the list ("All on one page") ──
    js("""const next = copy(); next.assumptions = { v: 1, crops: {}, varieties: {}, ...(next.assumptions || {}) }; next.assumptions.crops[arg.crop] = { [arg.env]: { yield: arg.y, rows: arg.rows } };
      return A.setYield('crops', arg.crop, arg.env, arg.y, 'a figure for the bed', { rows: arg.rows });""", {"crop": C, "env": ENV, "y": sub["figure"], "rows": ST["rows"]}); wait(500)
    close_dialogs()
    js("return A.setYield('crops', arg.crop, arg.env, arg.y, 'a figure typed on the list');", {"crop": C, "env": ENV, "y": sub["figure"] * 2}); wait(500)
    close_dialogs()
    # a figure kept for other rows than the box's bed: the box shows it for the box's rows; what clearing goes back to says no rows
    js("return A.setYield('crops', arg.crop, arg.env, arg.y, 'a figure for a bed of other rows', { rows: arg.rows });", {"crop": C, "env": ENV, "y": sub["figure"] * 2, "rows": ST["rows"] + 1}); wait(500); close_dialogs()
    card(); odd = js("const box = document.querySelector(`#ycCard [data-yk=\"y|${arg}\"]`); return { value: box.value, tip: box.title };", ENV)
    import re
    back = re.search(r"go back to ([0-9.,]+)", odd["tip"] or ""); shown = float(odd["value"] or 0); wantv = sub["figure"] * 2 * ST["ft"] * ST["rows"] / (ST["rows"] + 1)
    check("a figure kept for a bed of other rows is shown for the box's rows, and clearing it is said to go back to the crop's own figure for the box's bed, by its length alone", abs(shown - wantv) < 0.006 * max(1, wantv) + 0.51 and bool(back) and abs(float(back.group(1).replace(",", "")) - sub["figure"] * ST["ft"]) < 0.51, [odd, wantv, sub["figure"] * ST["ft"]])
    js("A.undo(); return 1;"); wait(300)
    kept = js("return ((S.plan.assumptions || {}).crops || {})[arg.crop][arg.env];", {"crop": C, "env": ENV})
    check("a figure typed on the list's own row keeps the rows the cell says", kept == {"yield": round(sub["figure"] * 2, 3), "rows": ST["rows"]}, kept)
    js("return A.setYield('crops', arg.crop, arg.env, null, 'cleared');", {"crop": C, "env": ENV}); wait(500)
    close_dialogs()
    vid = js("const v = S.plan.varieties.find(v => v.cropId === arg && v.active !== false); return v ? v.id : null;", C)
    if vid:
        js("return A.setYield('varieties', arg.v, arg.env, 1.25, 'a variety, with rows asked for', { rows: 3, inRow: 4 });", {"v": vid, "env": ENV}); wait(500); close_dialogs()
        check("a variety's own figure takes no rows and no spacing, whoever asks: only a crop's own figure says them", js("return ((S.plan.assumptions || {}).varieties || {})[arg.v][arg.env];", {"v": vid, "env": ENV}) == {"yield": 1.25}, js("return ((S.plan.assumptions || {}).varieties || {})[arg.v];", {"v": vid}))
        js("A.undo(); return 1;"); wait(300)
    else: check("a variety's own figure takes no rows and no spacing (the crop has no variety on the plan: not tried)", False)
    check("a figure cleared takes its rows with it", js("return (((S.plan.assumptions || {}).crops || {})[arg.crop] || {})[arg.env] || null;", {"crop": C, "env": ENV}) is None)
    while js("return S.undo.length;") > 0: js("A.undo(); return 1;"); wait(150)

    # ── a crop counted a plant, at one spacing everywhere it stands: taken at once, with its spacing beside it ──
    pl = js("""const eng = S.engine, by = new Map();
      for (const p of S.plan.plantings) { const r = eng.calc(p), y = r ? eng.yieldOf(p, r) : null; if (!y || r.tw || r.ct || r.rack) continue; const k = p.cropId + '|' + eng.envOf(r.b); by.set(k, [...(by.get(k) || []), { y, r }]); }
      const hit = [...by].find(([k, list]) => { const hc = eng.harvestFor(k.split('|')[0]); return list.length > 1 && list.every(x => x.y.basis === 'plant' && x.y.by === 'default' && !x.y.own) && new Set(list.map(x => x.r.inRow)).size === 1 && !hc.open.yield && !hc.weekly && hc.pattern.value !== 'once' && !eng.thingsOf(k.split('|')[0]).length && !eng.isPerennial(eng.crop(k.split('|')[0])); });
      if (!hit) return null; const [crop, env] = hit[0].split('|'); return { crop, env, inRow: hit[1][0].r.inRow, figure: eng.harvestFor(crop).cells[env].value };""")
    check("the plan has a crop counted a plant at one spacing, picked over days, to try", bool(pl), pl)
    if pl:
        js("A.setView('assume'); LRFAssume.setMode('harvest', 'card', arg); return 1;", pl["crop"]); wait(700)
        v = round(pl["figure"] * 1.25, 2)
        js("const box = document.querySelector(`#ycCard [data-yk=\"y|${arg.env}\"]`); return typeIn(box, arg.v);", {"env": pl["env"], "v": v}); wait(900)
        took = js("return { sheet: !!document.querySelector('dialog[open]'), cell: (((S.plan.assumptions || {}).crops || {})[arg.crop] || {})[arg.env] || null, undo: S.undo.length, kept: txt(hook('yield-kept', document.querySelector(`#ycCard td[data-place=\"${arg.env}\"]`))) };", pl)
        check("a figure typed for it is taken at once, no sheet: nothing but the figure moves", not took["sheet"] and took["undo"] == 1, took)
        check("the plan holds it with the spacing in the row it was typed at, and the card says it is held a row-foot", took["cell"] == {"yield": v, "inRow": pl["inRow"]} and "held a row-foot" in took["kept"], took)
        js("A.undo(); return 1;"); wait(400)
    js("""const p = S.engine.planting(arg);
      const ops = Array.from({ length: 13 }, (_, i) => ({ before: null, after: { ...p, id: 'yield-overflow-' + i } }));
      return A.commit('Make a long list of example changes', ops, { unchecked: true });""",
       next(x["id"] for x in sub["list"] if x["rows"] == ST["rows"]))
    card(); type_it(typed); wait(700)
    summary = page.locator('[data-hook="yield-more"] summary')
    more_rows = page.locator('[data-hook="yield-more"] [data-hook="yield-move"]')
    collapsed = summary.count() == 1 and more_rows.count() > 0 and not more_rows.first.is_visible()
    if collapsed:
        summary.click()
    overflow = sheet()
    check("beyond the first twelve changes, every remaining planting can be inspected before saving",
          bool(overflow) and collapsed and more_rows.last.is_visible() and len(overflow["moves"]) == overflow["n"] > 12
          and js("return S.undo.length;") == 1, overflow and overflow["n"])
    if overflow:
        page.locator("dialog[open]").get_by_role("button", name="Cancel", exact=True).click()
    while js("return S.undo.length;") > 0: js("A.undo(); return 1;"); wait(150)
    check("every step undone, the plan is the one the page was given", js("return snap().plan;") == start["plan"])
    check("no error on the page", not errors, errors[:4])
    finish()
