"""E4 part 1 (0.84), the Successions page, in a real browser (#102's finish line, #90 section 9).
A run of one crop is planned onto whole beds on a page of its own between the Timeline and the Forecast: by an amount a week (the
spacing found, never the size) or by beds every so many days; the run's own amount a week against what is wanted, its average and its
short weeks said; one row a bed with Sow, Plant and First pick in ruled columns; Drop; the frost said on its row, never stopping a
sowing; what has no bed said with the gardens that have room; Add as one step with one Undo; See them on the Timeline as ghosts; a kept
run listed and opened to its plantings; Remove run keeping its plantings unless asked; every way in opening the page filled in, and
the series tool gone. Every figure the page shows is held to the solver's own (LRFSuccession.planRun), asked in the same page.
It finds its subjects on the plan it is given and names nothing of it.
usage: python3 -I successions_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
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
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if os.environ.get("LIVE"): print(("ok   " if ok else "FAIL ") + name + ("" if ok else " " + json.dumps(detail, default=str)[:600]), file=sys.stderr, flush=True)
    if not ok:
        failed.append(name)
        if STOP: finish()
PRE = ("const A = LRFApp, St = A.state, E = LRFEngine, S = LRFSuccession, SU = LRFSuccessions, D = SU.state.D, $ = id => document.getElementById(id), eng = St.engine, year = A.planYear();"
       "const q = h => document.querySelector('[data-hook=\"' + h + '\"]'), qa = h => [...document.querySelectorAll('[data-hook=\"' + h + '\"]')];"
       "const txt = h => (q(h) || {}).textContent || '';"
       "const ask = () => { const by = D.by === 'beds' ? 'beds' : 'amount'; return { cropId: D.cropId, varietyId: D.varietyId || undefined, thing: by === 'amount' && D.thing ? D.thing : undefined, by, ...(by === 'amount' ? { want: +D.want, margin: +D.margin || 0 } : { every: +D.every }), datesFor: D.datesFor, from: D.from, to: D.to, reach: 'spacing', wholeBeds: true, gardenIds: D.gardenId ? [D.gardenId] : [], bedIds: [], then: D.then.slice(), drop: D.drop.slice() }; };"
       "const solve = () => S.planRun(eng, ask());"
       "const day = d => LRFUI.day(d);"
       "const state = () => ({ n: St.plan.plantings.length, undo: St.undo.length, runs: A.runs().length, view: St.view, inRuns: St.plan.plantings.filter(p => p.run).length });")
def setv(page, sel, value):
    page.fill(sel, str(value)); page.dispatch_event(sel, "change"); page.wait_for_timeout(900)

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 1000}, color_scheme="light")
    page = ctx.new_page(); page.set_default_timeout(20000)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=60000); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(6000)
    page.evaluate("LRFApp.state.undo.length = 0")
    def js(body, arg=None):
        try: return page.evaluate("async (arg) => { " + PRE + " " + body + " }", arg)
        except Exception as e:
            errors.append(str(e)[:300]); return None
    def wait(ms=500): page.wait_for_timeout(ms)
    def press(hook, ms=900, nth=0):
        loc = page.locator(f'[data-hook="{hook}"]')
        if loc.count() <= nth: errors.append(f"no {hook}"); return False
        loc.nth(nth).click(); wait(ms); return True
    plan0 = js("return { key: A.contentKey(), n: St.plan.plantings.length };") or {}

    # ── the tab ──
    tabs = js("return [...document.querySelectorAll('[data-hook=\"view-tab\"]')].map(b => b.dataset.viewBtn);") or []
    check("a Successions tab stands between the Timeline and the Forecast", "succession" in tabs and tabs.index("succession") == tabs.index("timeline") + 1 and tabs.index("harvest") == tabs.index("succession") + 1, tabs)
    page.click('[data-view-btn="succession"]'); wait(1800)
    frame = js("return { view: St.view, title: txt('succ-page-title'), help: !!q('succ-help'), figs: txt('succ-figs'), runs: !!q('succ-runs'), nothing: txt('succ-nothing-yet'), cards: qa('succ-card').map(c => c.getAttribute('aria-label')) };") or {}
    check("the page stands in the frame: its title, “?”, one line of figures, the runs at the left and the three numbered cards", frame.get("view") == "succession" and frame.get("title") == "Successions" and frame.get("help") and "runs in the plan" in frame.get("figs", "") and frame.get("runs") and frame.get("cards") == ["What and how much", "When", "Where"], frame)
    check("it says that nothing is added until Add is pressed", frame.get("nothing") == "Nothing is added to the plan until you press Add.", frame.get("nothing"))

    # ── the subject: a crop the plan grows, counted, with a checked yield, and a field garden where a run to an amount a week places at least four whole beds ──
    sub = js("""const A2 = S.candidates(eng, true).filter(c => SU.plans(eng, c) && !(eng.harvestFor(c.id).open || {}).yield && ['head', 'each', 'bunch'].includes(eng.unitOf(c)));
      for (const c of A2) for (const g of S.gardensFor(eng, c).filter(g => g.kind === 'bed' && g.garden.type === 'field')) {
        const one = S.planRun(eng, { cropId: c.id, by: 'beds', every: 7, datesFor: 'planting', from: year + '-06-01', to: year + '-06-01', gardenIds: [g.garden.id] });
        if (one.error || !one.sowings.length) continue;
        const want = Math.max(5, Math.round(one.sowings[0].units * 7 / 10 / 5) * 5);
        const then = S.gardensFor(eng, c).filter(x => x.kind === 'bed' && x.garden.type === 'field' && x.garden.id !== g.garden.id).map(x => x.garden.id);
        const r = S.planRun(eng, { cropId: c.id, by: 'amount', want, datesFor: 'picking', from: year + '-08-02', to: year + '-09-30', gardenIds: [g.garden.id], then });
        if (!r.error && r.sowings.length >= 4 && !r.unplaced.length && r.every >= 2 && r.short[0] === r.weeks[0] && r.sowings.every(x => x.nursery)) return { crop: c.id, name: c.name, garden: g.garden.id, then, want, every: r.every, n: r.sowings.length };
      } return null;""")
    check("the plan has a crop sown in the nursery and a field garden for a run to an amount a week of four whole beds or more, each with a bed", bool(sub), sub)
    if not sub: finish()
    js("void A.openAhead({ mode: 'succession', cropId: arg.crop }); return 1;", sub); wait(1800)
    page.select_option('[data-hook="succ-garden"]', sub["garden"]); wait(1200)
    for g in sub["then"]: page.locator(f'[data-hook="succ-then-garden"][data-garden="{g}"]').click(); wait(600)
    if js("return D.by;") != "amount": press("succ-choice", 1200, nth=1)
    if js("return D.datesFor;") != "picking": page.locator('[data-hook="succ-dates-are-for"] [data-value="picking"]').click(); wait(900)
    setv(page, '[data-hook="succ-want"]', sub["want"]); setv(page, '[data-hook="succ-from"]', "%s-08-02" % js("return year;")); setv(page, '[data-hook="succ-to"]', "%s-09-30" % js("return year;")); wait(1200)
    page.screenshot(path=str(shots / "succ-planned.png"), full_page=True)
    seen = js("""const r = solve(); if (r.error) return { err: r.error };
      const weeks = qa('succ-week').map(w => ({ run: +w.dataset.run, short: w.dataset.short === 'true', shown: w.querySelector('b').textContent }));
      const rows = qa('succ-row').map(row => ({ n: +row.dataset.n, bed: row.dataset.bed, sow: row.querySelector('[data-hook="succ-sow"]').textContent, plant: row.querySelector('[data-hook="succ-plant"]').textContent, first: row.querySelector('[data-hook="succ-first"]').textContent,
        ruled: ['succ-sow', 'succ-plant', 'succ-first'].every(h => parseFloat(getComputedStyle(row.querySelector('[data-hook="' + h + '"]')).borderLeftWidth) >= 1) }));
      return { every: r.every, sowings: r.sowings.map(x => ({ n: x.n, bed: x.bed.id, sow: day(x.sow), plant: day(x.plant), first: day(x.firstPick), units: x.units, gap: x.p.run.gap })), weeks: r.weeks.map(w => ({ run: w.run, short: !!w.short })), average: r.average, short: r.short.map(w => day(w.start)),
        firstShort: r.short[0] === r.weeks[0], shownWeeks: weeks, rows, spacing: txt('succ-spacing'), avg: txt('succ-average'), totals: txt('succ-totals'), title: txt('succ-title'), add: txt('succ-add'), unit: r.totals.unit, units: r.totals.units, have: r.average.have, haveSaid: txt('succ-have'),
        unplaced: r.unplaced.length, unplacedSaid: qa('succ-unplaced').length, beds: txt('succ-beds-used'), used: new Set(r.sowings.filter(x => x.bed.gardenId === D.gardenId).map(x => x.bed.id)).size, n0: St.plan.plantings.length };""") or {}
    check("the page asks the solver what it asks: no error, and one whole bed every so many days, said in words", not seen.get("err") and seen.get("every", 0) >= 2 and seen.get("spacing") == "One whole bed every %s days." % seen.get("every"), [seen.get("err"), seen.get("every"), seen.get("spacing")])
    check("the title says it in his words: the crop, the amount a week and its unit", seen.get("title", "").startswith(sub["name"] + ": %s " % sub["want"]) and seen.get("title", "").endswith(" a week"), seen.get("title"))
    check("one bar a week, each the run's own amount that week as the forecast gives it, short weeks marked", [round(w["run"], 6) for w in seen.get("shownWeeks", [])] == [round(w["run"], 6) for w in seen.get("weeks", [])] and [w["shown"] for w in seen.get("shownWeeks", [])] == [js("return LRFUI.num(arg, 0);", w["run"]) for w in seen.get("weeks", [])] and [w["short"] for w in seen.get("shownWeeks", [])] == [w["short"] for w in seen.get("weeks", [])] and len(seen.get("weeks", [])) >= 8, [seen.get("shownWeeks"), seen.get("weeks")])
    check("the average is said, and it is at least the amount wanted (the widest spacing that gives it)", ("Averages %d." % round(seen.get("average", {}).get("run", -1))) in seen.get("avg", "") and seen.get("average", {}).get("run", 0) >= sub["want"] - 1e-6, [seen.get("avg"), seen.get("average")])
    check("the short first week is said, with what it gives", seen.get("firstShort") and ("The first week gives" in seen.get("avg", "") or seen.get("short", [""])[0] in seen.get("avg", "")), [seen.get("avg"), seen.get("short")])
    check("what the plan already gives is said beside the run, and not taken off", ("already gives" in seen.get("haveSaid", "") and "not taken off" in seen.get("haveSaid", "")) if seen.get("have", 0) > 1e-9 else "gives no" in seen.get("haveSaid", ""), seen.get("haveSaid"))
    check("one row a bed: each sowing's bed, and its Sow, Plant and First pick days as the engine works them out", [(r["n"], r["bed"], r["sow"], r["plant"], r["first"]) for r in seen.get("rows", [])] == [(x["n"], x["bed"], x["sow"], x["plant"], x["first"]) for x in seen.get("sowings", [])] and len(seen.get("rows", [])) >= 4, [seen.get("rows"), seen.get("sowings")])
    check("Sow, Plant and First pick stand in ruled columns", seen.get("rows") and all(r["ruled"] for r in seen["rows"]), seen.get("rows"))
    check("every sowing is one whole bed, the same number of days apart, and the totals say how many beds and about how much", all(x["gap"] == seen.get("every") for x in seen.get("sowings", [])) and ("%d sowings" % len(seen.get("sowings", []))) in seen.get("totals", "") and "whole bed" in seen.get("totals", ""), [seen.get("totals"), seen.get("sowings")])
    check("the garden's beds used are said, against how many it has", seen.get("beds", "").startswith("%d of " % seen.get("used", -1)), [seen.get("beds"), seen.get("used")])
    check("what finds no bed in the run's gardens is said, row for row", seen.get("unplaced") == seen.get("unplacedSaid"), [seen.get("unplaced"), seen.get("unplacedSaid")])
    check("“Add N plantings” names how many, and nothing is in the plan yet", seen.get("add") == "Add %d plantings" % len(seen.get("sowings", [])) and js("return state();")["n"] == plan0.get("n") and js("return St.undo.length;") == 0, [seen.get("add"), js("return state();")])
    room = js("""// a run that outgrows its garden: the same crop at twice the amount, in its garden alone
      const ask2 = { ...ask(), want: +D.want * 3, then: [] }, r = S.planRun(eng, ask2), u = r.error ? null : r.unplaced.find(x => x.room && x.room.length); if (!u) return { none: r.error || 'nothing went without a bed' };
      const keepThen = D.then.slice(); D.want = String(ask2.want); D.then = []; SU.render(); await new Promise(res => setTimeout(res, 1500)); const said = qa('succ-unplaced').find(el => +el.dataset.n === u.n);
      const out = { said: said ? said.textContent : '', names: u.room.map(g => g.garden.name) }; D.want = String(ask2.want / 3); D.then = keepThen; SU.render(); await new Promise(res => setTimeout(res, 1500)); return out;""") or {}
    check("a sowing with no bed is said, never moved, with the gardens that have room for it then", bool(room.get("names")) and all(name in room.get("said", "") for name in room["names"]) and "has no bed" in room.get("said", ""), room)

    # ── drop a row, see them on the Timeline ──
    before = js("return { rows: qa('succ-row').length, n: St.plan.plantings.length };") or {}
    press("succ-drop", 1500, nth=1)
    dropped = js("const r = solve(); return { rows: qa('succ-row').length, n: St.plan.plantings.length, solved: r.sowings.length, gone: !r.sowings.some(x => x.n === 2), said: !!q('succ-dropped'), add: txt('succ-add') };") or {}
    check("Drop leaves that sowing out of the proposal, says so, and adds nothing", dropped.get("rows") == before.get("rows", 0) - 1 == dropped.get("solved") and dropped.get("gone") and dropped.get("said") and dropped.get("n") == before.get("n"), dropped)
    press("succ-undrop", 1500)
    check("Put them back brings the sowing back", js("return qa('succ-row').length;") == before.get("rows"))
    press("succ-see", 2000)
    ghosts = js("return { view: St.view, ghosts: document.querySelectorAll('#tlBody .tl-row[data-bed] .tl-ghost-bar').length, n: St.plan.plantings.length };") or {}
    check("See them on the Timeline shows them there as ghosts, one a sowing, and adds nothing", ghosts.get("view") == "timeline" and ghosts.get("ghosts") == before.get("rows") and ghosts.get("n") == before.get("n"), ghosts)
    page.screenshot(path=str(shots / "succ-ghosts.png"))
    page.click('[data-view-btn="succession"]'); wait(1500)
    check("back on the page, the ghosts are gone from the Timeline and the run is still being planned", js("return !SU.ghosts() && qa('succ-row').length;") == before.get("rows"))

    # ── Add: one step, one Undo ──
    want_rows = js("const r = solve(); return r.sowings.map(x => [x.bed.id, x.p.date, x.n, x.p.run.gap]);") or []
    press("succ-add", 2000)
    added = js("""const run = A.runs()[A.runs().length - 1], mine = run ? S.runPlantings(St.plan, run.id) : [];
      return { s: state(), run: run || null, plantings: mine.map(p => [p.bedId, p.date, p.run.n, p.run.gap]), answer: txt('succ-answer'), undoBtn: !!q('succ-undo'), picked: (document.querySelector('[data-hook="succ-run"][aria-pressed="true"]') || { dataset: {} }).dataset.run,
        kept: qa('succ-kept-row').map(r => r.dataset.planting), links: qa('succ-kept-link').length, keys: Object.keys(run || {}).sort() };""") or {}
    s1 = added.get("s", {})
    check("Add puts the run's plantings in the plan as one step", s1.get("n") == plan0.get("n") + len(want_rows) and s1.get("undo") == 1 and s1.get("runs") == 1, s1)
    check("each carries its run: the run's id, its number and the spacing, on the bed and day it was shown with", sorted(map(tuple, added.get("plantings") or [])) == sorted(map(tuple, want_rows)), [added.get("plantings"), want_rows])
    check("the run is kept as the record #90 names: crop, by, amount, margin, dates for, from, to, spacing, whole beds, gardens", added.get("run") and all(k in added["keys"] for k in ["id", "cropId", "by", "want", "margin", "datesFor", "from", "to", "reach", "every", "wholeBeds", "gardenIds", "then"]) and added["run"]["wholeBeds"] is True and added["run"]["reach"] == "spacing", added.get("keys"))
    check("the answer is said where the action happened, with its Undo", added.get("answer", "").startswith("Added %d plantings" % len(want_rows)) and added.get("undoBtn"), added.get("answer"))
    check("the run is then in the list at the left, picked, and opens to those plantings, each a link", added.get("run") and added.get("picked") == added["run"]["id"] and len(added.get("kept") or []) == len(want_rows) == added.get("links"), [added.get("picked"), added.get("kept")])
    page.screenshot(path=str(shots / "succ-kept.png"), full_page=True)
    press("succ-undo", 1500)
    undone = js("return { s: state(), key: A.contentKey(), answer: !!q('succ-answer') };") or {}
    check("one Undo takes all of it back: the plantings and the run", undone.get("s", {}).get("n") == plan0.get("n") and undone.get("s", {}).get("runs") == 0 and undone.get("key") == plan0.get("key"), undone)
    js("A.redo(); return 1;"); wait(1200)
    check("and Redo puts it all back as one step", js("return state();").get("runs") == 1 and js("return state();").get("inRuns") == len(want_rows))

    # ── the kept run: its links, Remove run ──
    js("const run = A.runs()[0]; document.querySelector('[data-hook=\"succ-run\"][data-run=\"' + run.id + '\"]').click(); return 1;"); wait(1000)
    first = js("return (qa('succ-kept-row')[0] || { dataset: {} }).dataset.planting;")
    press("succ-kept-link", 1200)
    check("a planting of the run is a link to it: the Timeline, with the planting picked", js("return { v: St.view, sel: St.sel && St.sel.type === 'planting' && St.sel.id };") == {"v": "timeline", "sel": first})
    page.click('[data-view-btn="succession"]'); wait(1200)
    js("const run = A.runs()[0]; document.querySelector('[data-hook=\"succ-run\"][data-run=\"' + run.id + '\"]').click(); return 1;"); wait(1000)
    u0 = js("return St.undo.length;")
    press("succ-remove", 1500)
    kept = js("return { s: state(), marks: St.plan.plantings.filter(p => p.run).length, answer: txt('succ-answer') };") or {}
    check("Remove run takes the run out as one step and keeps its plantings as plain plantings", kept.get("s", {}).get("runs") == 0 and kept.get("s", {}).get("n") == plan0.get("n") + len(want_rows) and kept.get("marks") == 0 and kept.get("s", {}).get("undo") == u0 + 1 and "stay as plain plantings" in kept.get("answer", ""), kept)
    press("succ-undo", 1500)
    check("its Undo puts the run back on its plantings", js("return state();").get("runs") == 1 and js("return state();").get("inRuns") == len(want_rows))
    js("const run = A.runs()[0]; document.querySelector('[data-hook=\"succ-run\"][data-run=\"' + run.id + '\"]').click(); return 1;"); wait(1000)
    page.locator('[data-hook="succ-remove-all"]').check(); wait(200)
    press("succ-remove", 1500)
    gone = js("return state();") or {}
    check("asked to, Remove run takes its plantings out too, as one step", gone.get("runs") == 0 and gone.get("n") == plan0.get("n") and gone.get("undo") == u0 + 1, gone)
    js("A.undo(); return 1;"); wait(900); js("A.undo(); return 1;"); wait(900); js("A.undo(); return 1;"); wait(1200)
    check("undoing every step leaves the plan as it was", js("return A.contentKey();") == plan0.get("key"), js("return state();"))

    # ── by beds, and the frost ──
    js("void A.openAhead({ mode: 'succession', cropId: arg.crop }); return 1;", sub); wait(1500)
    page.select_option('[data-hook="succ-garden"]', sub["garden"]); wait(900)
    page.locator('[data-hook="succ-plan-by"] [data-value="beds"]').click(); wait(900)
    page.locator('[data-hook="succ-dates-are-for"] [data-value="planting"]').click(); wait(900)
    setv(page, '[data-hook="succ-from"]', "%s-06-01" % js("return year;")); setv(page, '[data-hook="succ-to"]', "%s-07-27" % js("return year;")); setv(page, '[data-hook="succ-every"]', 14); wait(900)
    beds = js("const r = solve(); return { err: r.error || null, plants: qa('succ-row').map(row => row.querySelector('[data-hook=succ-plant]').textContent), want: r.sowings.map(x => day(x.plant)), onDay: r.sowings.every(x => E.dayDiff(x.plant, E.s2d(year + '-06-01')) === (x.n - 1) * 14), every: txt('succ-spacing') };") or {}
    check("by beds, one whole bed every so many days typed: each planted on its number's day", not beds.get("err") and beds.get("plants") == beds.get("want") and len(beds.get("want") or []) >= 2 and beds.get("onDay") and beds.get("every") == "One whole bed every 14 days.", beds)
    frost = js("""for (const c of S.candidates(eng, true).filter(c => SU.plans(eng, c) && c.frostTender)) for (const g of S.gardensFor(eng, c).filter(g => g.kind === 'bed' && g.garden.type === 'field')) {
        const r = S.planRun(eng, { cropId: c.id, by: 'beds', every: 10, datesFor: 'planting', from: year + '-08-15', to: year + '-09-30', gardenIds: [g.garden.id], then: S.gardensFor(eng, c).filter(x => x.kind === 'bed' && x.garden.id !== g.garden.id).map(x => x.garden.id) });
        if (!r.error && r.sowings.some(x => x.frost)) return { crop: c.id, garden: g.garden.id, then: r.run.then, frost: r.sowings.filter(x => x.frost).map(x => x.n) }; } return null;""")
    check("the plan has a frost-tender crop a run into the fall places where the frost touches it", bool(frost), frost)
    if frost:
        js("void A.openAhead({ mode: 'succession', cropId: arg.crop }); D.gardenId = arg.garden; D.then = arg.then; D.by = 'beds'; D.datesFor = 'planting'; D.every = 10; D.from = year + '-08-15'; D.to = year + '-09-30'; SU.render(); return 1;", frost); wait(2000)
        fr = js("return { marked: qa('succ-row').filter(r => r.dataset.frost === 'true').map(r => +r.dataset.n), said: qa('succ-frost-said').length, count: txt('succ-frost-count') };") or {}
        check("a frost date stops no sowing of a run: each it touches is placed, marked “frost” on its row and said", fr.get("marked") == frost["frost"] and fr.get("said") == len(frost["frost"]) and "frost date" in fr.get("count", ""), [fr, frost])

    # ── a yield nobody has checked ──
    open_crop = js("const c = S.candidates(eng, false).find(c => SU.plans(eng, c) && (eng.harvestFor(c.id).open || {}).yield); return c ? c.id : null;")
    if open_crop:
        js("void A.openAhead({ mode: 'succession', cropId: arg, by: 'amount' }); return 1;", open_crop); wait(1800)
        if js("return D.by;") != "amount": page.locator('[data-hook="succ-plan-by"] [data-value="amount"]').click(); wait(1500)
        un = js("const el = q('succ-error'); return { said: el ? el.textContent : '', unchecked: el ? el.dataset.unchecked : null, add: !!q('succ-add') };") or {}
        check("a crop on a yield nobody has checked is refused to an amount, in words, with nothing to add", "nobody has checked" in un.get("said", "") and un.get("unchecked") == "1" and not un.get("add"), un)
    else: check("a crop on a yield nobody has checked is refused to an amount, in words, with nothing to add", False, "no such crop in this plan")

    # ── Cancel ──
    js("void A.openAhead({ mode: 'succession', cropId: arg.crop }); return 1;", sub); wait(1500)
    n_before = js("return St.plan.plantings.length;")
    press("succ-cancel", 1000)
    check("Cancel leaves nothing being planned, and adds nothing", js("return { draft: !!document.querySelector('[data-hook=\"succ-run\"][data-run=\"draft\"]'), idle: !!q('succ-idle'), n: St.plan.plantings.length };") == {"draft": False, "idle": True, "n": n_before})

    # ── every way in opens the page filled in; the series tool is gone ──
    ways = js("""const out = {}, open = () => St.view === 'succession' && !!q('succ-title');
      // a planting in a field bed whose garden is not the one the page would choose for its crop by itself, so that "that garden" is seen
      const own = c => { const gs = S.gardensFor(eng, c).filter(g => g.kind === 'bed'); return ((gs.find(g => g.planted && g.garden.type === 'field') || gs.find(g => g.planted) || gs[0] || {}).garden || {}).id; };
      const p = St.plan.plantings.find(p => { const r = eng.calc(p); return r && eng.spaceKind(r.b) === 'bed' && !eng.isRack(r.b) && SU.plans(eng, eng.crop(p.cropId)) && eng.gardenOf(r.b).type === 'field' && p.varietyId && own(eng.crop(p.cropId)) !== r.b.gardenId; });
      // a bed's panel
      A.setView('map'); A.select({ type: 'bed', id: p.bedId }); await new Promise(r => setTimeout(r, 500));
      const bedBtn = q('bed-succession') || q('card-succession'); if (bedBtn) { bedBtn.click(); await new Promise(r => setTimeout(r, 1500)); }
      out.bed = { btn: !!bedBtn, open: open(), garden: D.gardenId === eng.bedOf(p.bedId).gardenId, dates: D.datesFor, from: D.from === E.d2s(St.date) };
      // a planting's panel
      A.setView('map'); A.select({ type: 'planting', id: p.id }); await new Promise(r => setTimeout(r, 500));
      const pBtn = q('panel-succession'); if (pBtn) { pBtn.click(); await new Promise(r => setTimeout(r, 1500)); }
      out.planting = { btn: !!pBtn, open: open(), crop: D.cropId === p.cropId, variety: D.varietyId === p.varietyId, garden: D.gardenId === eng.bedOf(p.bedId).gardenId, every: +D.every > 0, after: D.from > p.date };
      // a crop in the library
      A.setView('map'); A.select(null); await new Promise(r => setTimeout(r, 400));
      const lib = document.querySelector('[data-hook="lib-succession"][data-succession="' + p.cropId + '"]'); if (lib) { lib.click(); await new Promise(r => setTimeout(r, 1500)); }
      out.library = { btn: !!lib, open: open(), crop: D.cropId === p.cropId, armed: St.armed == null };
      // the old ways are gone
      A.select({ type: 'series' }); await new Promise(r => setTimeout(r, 300));
      out.gone = { form: !!document.getElementById('srForm'), series: typeof LRFSeries.open === 'undefined' && typeof LRFSuccession.series === 'undefined' && typeof LRFSuccession.pace === 'undefined' && typeof A.addSuccessions === 'undefined' && typeof A.addSeries === 'undefined' };
      A.select(null);
      return out;""") or {}
    b = ways.get("bed", {}); pl = ways.get("planting", {}); lb = ways.get("library", {})
    check("from a bed: “Plan a succession here” opens the page on that garden, planting dates from the map's day", b.get("btn") and b.get("open") and b.get("garden") and b.get("dates") == "planting" and b.get("from"), b)
    check("from a planting: it opens on that crop, variety and garden, the run starting after the planting", pl.get("btn") and pl.get("open") and pl.get("crop") and pl.get("variety") and pl.get("garden") and pl.get("after"), pl)
    check("from a crop in the library: it opens on that crop, and does not pick the crop up to plant", lb.get("btn") and lb.get("open") and lb.get("crop") and lb.get("armed"), lb)
    op = js("""const o = S.openings(eng).find(o => o.garden.type === 'field' && S.fits(eng, o, { mine: true }).some(t => t.ok && SU.plans(eng, t.crop)));
      if (!o) return null; A.setView('map'); A.select({ type: 'opening', id: o.id, bedId: o.bed.id }); await new Promise(r => setTimeout(r, 600));
      const chip = document.querySelector('#inspectorBody .ah-fit'); if (chip) { chip.click(); await new Promise(r => setTimeout(r, 600)); }
      const btn = q('opening-succession'); if (!btn) return { btn: false };
      const day0 = (LRFAhead.state && LRFAhead.state.O && LRFAhead.state.O.pick) ? null : null; btn.click(); await new Promise(r => setTimeout(r, 1500));
      return { btn: true, open: St.view === 'succession', garden: D.gardenId === o.garden.id, dates: D.datesFor };""")
    check("from an opening: it opens on that crop in that garden, planting dates from the opening's day", op and op.get("btn") and op.get("open") and op.get("garden") and op.get("dates") == "planting", op)
    fc = js("""A.setView('harvest'); await new Promise(r => setTimeout(r, 1500));
      const cell = [...document.querySelectorAll('#hvTable tr.hv-row td.hv-c')].find(td => td.textContent.trim() && td.closest('tr').dataset.crop && SU.plans(eng, eng.crop(td.closest('tr').dataset.crop)));
      if (!cell) return { cell: false }; const crop = cell.closest('tr').dataset.crop; cell.click(); await new Promise(r => setTimeout(r, 700));
      const btn = q('fc-succession'); if (!btn) return { cell: true, btn: false, crop }; btn.click(); await new Promise(r => setTimeout(r, 2000));
      return { cell: true, btn: true, open: St.view === 'succession', crop: D.cropId === crop, by: D.by, dates: D.datesFor, want: +D.want > 0 };""") or {}
    check("from a week of a crop on the Forecast: it opens on that crop, to an amount a week, picking from that week", fc.get("btn") and fc.get("open") and fc.get("crop") and fc.get("by") == "amount" and fc.get("dates") == "picking" and fc.get("want"), fc)
    check("the series tool is gone: no panel opens for it, and its functions are no more", ways.get("gone") == {"form": False, "series": True}, ways.get("gone"))
    words = js("""const bad = []; A.setView('succession'); await new Promise(r => setTimeout(r, 900));
      for (const el of [document.body]) { const t = el.innerText; for (const w of ['Plan a series', 'A series', 'Repeat as successions', 'Add successions', 'Plan to a weekly amount', 'Plan a longer series']) if (t.includes(w)) bad.push(w); }
      return bad;""")
    check("no screen visited says “series” for a succession, nor “Plan to a weekly amount”", words == [], words)
    check("the plan is as it was: nothing was added by looking", js("return A.contentKey();") == plan0.get("key"))
    check("no error on the page", not [e for e in errors if "Failed to load resource" not in e], errors[:4])
    finish()
