"""The year's edge (js/seedlib.js seasonOf, js/sowview.js, js/seeds.js, js/forecast.js, js/harvestview.js) in a real browser, on the
made-up farm, on a pretended Nov 18 of the year before the plan's. Through the page's own steps: a live-tray demand for the plan's
first weeks (sown in December of the year before), a storage crop that keeps three weeks picked once in December of the year before,
a crop of the library planted in the fall before, and a sowing late in the plan's year for a harvest in the next.
  Tasks: the December sowing in its own week, its row saying it is in the year before; the fall planting's work, past and not
  recorded, one quiet line and no late row, which opens it; on the batch's own day, a tick records it, its seed off stock, Undo.
  Seeds: the batch counted to sow once; the foot says what counts with the next season and what is earlier work not recorded.
  Forecast: January's stock carried in on a line of its own under its crop, its Season cell its own, the crop's line without it;
  its popup lists the December planting alone; the season's worth counts it once; on Picked there is no such line; "?" says
  what is carried in and what is to sell after Dec 31.
The cases are added to the plan the page holds, never to the farm. Every subject is found on the plan the page was given by the
engine's own figures: nothing here names a crop, a variety, a bed or a number of any plan. The farm's year is read from its own
description (tests/farm/data/plan-info.json) to set the clock.
usage: python3 -I year_edge_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1480")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
YEAR = json.load(open(Path(__file__).resolve().parent / "farm" / "data" / "plan-info.json"))["counts"]["year"]
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
def fake(y, m, d):
    """The page's clock: a day given as year, month (1 to 12) and day."""
    return "(() => { const R = Date, off = new R(%d, %d, %d, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();" % (y, m - 1, d)
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, V = LRFSowView, SL = LRFSeedLib, F = LRFForecast, T = LRFTrays, $ = id => document.getElementById(id), eng = S.engine, Y = A.planYear();"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const row = key => hooks('tasks-row').find(r => r.dataset.line === key) || null, worth = e => F.build(e).rows.reduce((n, r) => n + r.worth, 0);"
       "const toSow = (e, key) => { const r = SL.required(e, { today: A.today() }).rows.find(x => x.key === key); return r ? r.toSow : 0; };")
def js(page, body, arg=None):
    return page.evaluate("async (arg) => { %s %s }" % (PRE, body), arg)

# the cases, made through the page's own steps: a tray crop given a weight of seed a tray, a January demand, a crop that keeps
SETUP = """
  const demand = (S.plan.liveTrayPlans || []).find(d => d.rows && d.rows.some(r => r.cropId)), microId = demand && demand.rows.find(r => r.cropId).cropId;
  const crops = [...new Set(S.plan.plantings.map(p => p.cropId))].map(id => eng.crop(id)).filter(Boolean);
  const keeper = crops.find(c => !c.micro && !c.frostTender && !eng.isPerennial(c) && c.method === 'TP' && c.material !== 'bulb' && +c.dtm >= 45 && +c.dtm <= 120);
  const late = crops.find(c => !c.micro && !c.frostTender && !eng.isPerennial(c) && c.method === 'DS' && c.material !== 'bulb' && +c.dtm >= 32 && +c.dtm <= 90 && c !== keeper);
  const fall = LRFLibrary.crops.find(c => c.method === 'DS' && !c.frostTender && !c.micro && +c.dtm >= 180 && c.material !== 'bulb');
  const soil = b => { const g = eng.gardenOf(b); return !!g && g.active !== false && b.active !== false && !eng.isRack(b) && !eng.isTower(b) && !eng.isCt(b) && !b.liveTrayPool; };
  const firstIn = b => S.plan.plantings.filter(p => p.bedId === b.id).map(p => p.date).sort()[0] || '9999-12-31';
  const lastIn = b => S.plan.plantings.filter(p => p.bedId === b.id).map(p => { const r = eng.calc(p); return r && E.validDate(eng.occupancyThrough(p, r)) ? E.d2s(eng.occupancyThrough(p, r)) : '9999-12-31'; }).sort().pop() || '0000-01-01';
  const covered = S.plan.beds.filter(b => soil(b) && eng.gardenOf(b).frost === false).sort((a, b) => firstIn(b).localeCompare(firstIn(a)));
  const empty = S.plan.beds.find(b => soil(b) && firstIn(b) === '9999-12-31'), lateBed = covered.find(b => lastIn(b) < Y + '-11-01' && b !== covered[0]);
  if (!(microId && keeper && late && fall && covered.length && firstIn(covered[0]) >= Y + '-05-01' && empty && lateBed)) return null;
  A.setLiveSow(microId, { how: 'open', grams: 12 });
  const ready = T.mondayOnOrAfter(Y + '-01-08');
  const saved = await A.saveTrays('A demand for the first weeks', { v: 1, year: Y, name: 'First weeks', customerId: '', from: ready, through: ready, summer: Y + '-07-01', fall: Y + '-09-16', rows: [{ id: 'edge-jan', name: 'Edge', cropId: microId, days: 21, price: 30, spring: 3, summer: 0, fall: 0 }] });
  const kept = await A.setSell(keeper.id, { keep: 3, pattern: 'once', days: 1 }, 'Kept three weeks');
  const c = S.engine.crop(keeper.id), dec = { id: A.uid(), bedId: covered[0].id, cropId: keeper.id, date: E.d2s(E.addDays(E.s2d((Y - 1) + '-12-21'), -c.dtm)), ft: 10 };
  const garlic = { id: A.uid(), bedId: empty.id, cropId: fall.id, date: (Y - 1) + '-10-15', ft: 20 }, end = { id: A.uid(), bedId: lateBed.id, cropId: late.id, date: Y + '-12-10', ft: 10 };
  const added = A.addPlantings([dec, garlic, end], 'The year edge cases');
  const batch = S.plan.plantings.find(p => p.liveTray && p.liveTray.ready === ready);
  return { saved: !!saved, kept, added, batch: batch && batch.id, batchDate: batch && batch.date, key: batch && (SL.sowing(S.engine, batch).key + '|' + SL.sowing(S.engine, batch).unit), amount: batch && SL.sowing(S.engine, batch).amount,
    dec: dec.id, garlic: garlic.id, end: end.id, keeper: keeper.id, ready };
"""

def open_page(pw, day):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 960}); ctx.add_init_script(fake(*day)); page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000)
    page.wait_for_timeout(1200)
    return browser, page

def run(pw):
    # ── on Nov 18 of the year before: planning ahead ──
    browser, page = open_page(pw, (YEAR - 1, 11, 18))
    case = js(page, SETUP)
    check("the plan has a live-tray demand, a hardy crop that can keep, a crop sown in place, covered ground free in the early months, empty ground, and a crop of the library planted in the fall; each case is made through the page's own steps", case and case["saved"] and case["added"] and case["batchDate"] and case["batchDate"][:4] == str(YEAR - 1), case)
    if not case: finish()
    page.wait_for_timeout(400)

    # Tasks, today: the fall planting's work is past and not recorded: one quiet line, no late row
    page.evaluate("LRFApp.setView('sow')"); page.wait_for_timeout(700)
    t = js(page, """const all = V.tasks(), g = all.find(x => x.line.members.some(m => m.p.id === arg.garlic)), line = hook('tasks-earlier');
      return { line: line && drawn(line) ? line.textContent : null, task: g ? g.key : null, due: g ? g.due : null, shown: g ? !!row(g.key) : null, late: hooks('tasks-row').filter(r => r.dataset.due < A.today() && r.dataset.state !== 'done').map(r => r.dataset.line) };""", case)
    check("Tasks on a day before the plan's year: the fall planting's work, past and not recorded, is one quiet line and no late row", t["line"] == f"1 earlier job from {YEAR - 1}, not recorded" and t["task"] and not t["shown"] and t["due"] < f"{YEAR - 1}-11-18", t)
    page.screenshot(path=str(shots / "tasks-earlier.png"))
    if page.locator('[data-hook="tasks-earlier"]').count(): page.locator('[data-hook="tasks-earlier"]').first.click(); page.wait_for_timeout(400)
    o = js(page, "const r = row(arg); return r ? { state: r.dataset.state, due: r.dataset.due, text: r.textContent } : null;", t["task"])
    check("pressed, the line opens that work as a late row, its row saying it is in the year before", o and o["state"] == "open" and f"in {YEAR - 1}, the year before" in o["text"] and not page.locator('[data-hook="tasks-earlier"]').count(), o)

    # Tasks, the week of the December batch: listed in its own week, saying it is in the year before
    for _ in range(8):
        if js(page, "return !!row('live:' + arg);", case["batch"]): break
        page.locator("[data-act=week][data-by='7']").first.click(); page.wait_for_timeout(300)
    b = js(page, "const r = row('live:' + arg.batch), t = V.tasks().find(x => x.key === 'live:' + arg.batch); return { row: r ? r.textContent : null, due: t ? t.due : null, week: $('tkWeek') ? $('tkWeek').textContent : null };", case)
    check("Tasks: the December sowing for the plan's first weeks is in its own week, its row saying it is in the year before", b["row"] and b["due"] == case["batchDate"] and f"in {YEAR - 1}, the year before" in b["row"], b)
    page.screenshot(path=str(shots / "tasks-december.png"))

    # Tasks, the week of the late sowing for the next season: its work is listed where it is done, saying the season it is for
    js(page, "A.setDate(E.s2d(S.engine.planting(arg).date)); V.open(); return true;", case["end"]); page.wait_for_timeout(600)
    e = js(page, "const t = V.tasks().find(x => x.line.members.some(m => m.p.id === arg)), r = t && row(t.key); return { row: r ? r.textContent : null, due: t ? t.due : null };", case["end"])
    check("Tasks: a sowing late in the plan's year for the next season is listed on its day, its row saying the season it is for", e["row"] and f"for {YEAR + 1}" in e["row"], e)

    # Seeds: the batch counted to sow once; the foot says what is left out, and why
    page.evaluate("LRFApp.setView('seeds')"); page.wait_for_timeout(800)
    s = js(page, """const sl = hook('seeds-later'), se = hook('seeds-earlier'), withOut = S.plan.plantings.filter(p => p.id !== arg.batch);
      const without = E.create({ ...S.plan, plantings: withOut }, LRFLibrary);
      const shown = el => !!el && drawn(el.lastElementChild);   // a line of the foot is laid out by its parts
      return { later: shown(sl) ? sl.textContent : null, earlier: shown(se) ? se.textContent : null, diff: toSow(S.engine, arg.key) - toSow(without, arg.key), amount: arg.amount,
        out: SL.required(S.engine, { today: A.today() }).outside };""", case)
    check("Seeds counts the batch's seed to sow once, for the plan's year", s["amount"] > 0 and abs(s["diff"] - s["amount"]) < 1e-6, s)
    check("Seeds' foot says one planting counts with the next season, and one planting of the year before is earlier work not recorded", s["later"] and f"give" in s["later"] and str(YEAR + 1) in s["later"] and s["earlier"] and str(YEAR - 1) in s["earlier"] and s["out"]["later"] == 1 and s["out"]["earlier"] == 1, s)

    # Forecast, January: the stock carried in, apart, counted once
    page.evaluate("LRFApp.setView('harvest')"); page.wait_for_timeout(400)
    page.evaluate(f"LRFApp.setDate(new Date({YEAR}, 0, 12))"); page.wait_for_timeout(800)
    f = js(page, """const m = F.kept(S.engine, { year: Y }), rw = m.rows.find(r => r.cropId === arg.keeper && !r.thing), line = hook('fc-carried');
      const crop = line && line.previousElementSibling, cells = line ? [...line.querySelectorAll('td.hv-c')] : [], total = line ? line.querySelector('.hv-total').textContent : null, mine = crop ? crop.querySelector('.hv-total').textContent : null;
      return { name: line ? line.querySelector('.hv-name').textContent : null, total, mine, crop: crop ? crop.dataset.crop : null, carried: rw ? rw.carriedTotal : 0, own: rw ? rw.total - rw.carriedTotal : 0,
        want: rw ? F.amount(rw.carriedTotal, rw.unit, rw.group) : null, wantOwn: rw ? F.amount(rw.total - rw.carriedTotal, rw.unit, rw.group) : null, cells: cells.filter(c => c.textContent).length,
        season: hook('fc-season-total') ? hook('fc-season-total').textContent : null, worth: m.rows.reduce((n, r) => n + r.worth, 0) };""", case)
    check("Forecast: the stock carried in from the year before is a line of its own under its crop, with its own Season figure", f["name"] == f"Carried in from {YEAR - 1}" and f["crop"] == case["keeper"] and f["carried"] > 0 and f["total"] == f["want"] and f["cells"] >= 1, f)
    # in the week where the carried line has a figure, the crop's own cell holds only the year's own harvest
    c = js(page, """const m = F.kept(S.engine, { year: Y }), rw = m.rows.find(r => r.cropId === arg.keeper && !r.thing), line = hook('fc-carried'), crop = line && line.previousElementSibling;
      const heads = [...document.querySelectorAll('[data-hook="fc-table"] thead th[data-col]')], cells = line ? [...line.querySelectorAll('td.hv-c')] : [], k = cells.findIndex(x => x.textContent);
      if (k < 0 || !crop) return null;
      const col = F.periods(m, 'week').find(x => x.key === heads[k].dataset.col), own = col ? F.sum(rw.days.map((v, i) => v - rw.carried[i]), col.i0, col.i1) : null, mine = [...crop.querySelectorAll('td.hv-c')][k];
      return { col: heads[k].dataset.col, own, text: mine.textContent, title: mine.title || '', want: own > 1e-9 ? F.amount(own, rw.unit, rw.group) : '' };""", case)
    check("Forecast: the crop's own line is the year's harvest without it, in its Season figure and in the week the carried stock is sold", f["mine"] == f["wantOwn"] and c and ((c["own"] <= 1e-9 and c["text"] == "") or (c["want"] and c["title"].endswith(c["want"]))), [f, c])
    w = js(page, "const without = E.create({ ...S.plan, plantings: S.plan.plantings.filter(p => p.id !== arg.dec) }, LRFLibrary), rw = F.kept(S.engine, { year: Y }).rows.find(r => r.cropId === arg.keeper && !r.thing); return { up: worth(S.engine) - worth(without), carried: rw.carriedWorth, foot: hook('fc-season-total').textContent };", case)
    check("Forecast: the season's worth counts it once", abs(w["up"] - w["carried"]) < 1e-6 and w["carried"] > 0, w)
    page.screenshot(path=str(shots / "forecast-carried.png"))
    # its popup lists the December planting alone, and says it is carried in
    js(page, "const line = hook('fc-carried'), cell = line && [...line.querySelectorAll('td.hv-c')].find(c => c.textContent); if (cell) cell.click(); return !!cell;")
    page.wait_for_timeout(400)
    p = js(page, "const d = hook('fc-from'); return d ? { title: d.querySelector('h2').textContent, rows: hooks('fc-from-row').map(r => r.dataset.planting) } : null;")
    check("Forecast: a figure on the carried line lists the December planting alone, and says it is carried in", p and p["rows"] == [case["dec"]] and f"carried in from {YEAR - 1}" in p["title"], p)
    if page.locator('[data-hook="fc-from"] .btn.primary').count(): page.locator('[data-hook="fc-from"] .btn.primary').click(); page.wait_for_timeout(300)
    # "?" says what is carried in, and what is to sell after Dec 31
    if page.locator('[data-hook="fc-help"]').count(): page.locator('[data-hook="fc-help"]').first.click(); page.wait_for_timeout(400)
    hlp = page.evaluate("[...document.querySelectorAll('.hint')].map(h => h.textContent).join(' ')")
    check("Forecast \"?\": it says what is carried in from the year before and what is to sell after Dec 31", f"Carried in from {YEAR - 1}" in hlp and "After Dec 31" in hlp and str(YEAR + 1) in hlp, hlp[-600:])
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # on Picked there is no carried line: nothing of it is picked in the year
    if page.locator("[data-hv-series=picked]").count(): page.locator("[data-hv-series=picked]").first.click(); page.wait_for_timeout(400)
    check("Forecast on Picked: no carried line, nothing of it being picked in the year", page.locator("[data-hv-series=picked][aria-pressed=true]").count() == 1 and page.locator('[data-hook="fc-carried"]').count() == 0)
    browser.close()

    # ── on the batch's own day: the job of the day, done by a tick, its seed off stock, and Undo ──
    browser, page = open_page(pw, (YEAR - 1, 12, 21))
    case2 = js(page, SETUP)
    page.evaluate("LRFApp.setView('sow')"); page.wait_for_timeout(700)
    before = js(page, "return { toSow: toSow(S.engine, arg.key), row: !!row('live:' + arg.batch), undo: S.undo.length };", case2)
    if before["row"]: page.locator(f'[data-hook="tasks-row"][data-line="live:{case2["batch"]}"] [data-act=tick]').first.click(); page.wait_for_timeout(1500)
    after = js(page, "const p = S.engine.planting(arg.batch); return { toSow: toSow(S.engine, arg.key), done: p && p.done ? p.done.sow : null, toast: (document.querySelector('#toast span') || {}).textContent || '' };", case2)
    check("on its own day the December sowing is on today's list; a tick records it on that day and its seed is no longer to sow", before["row"] and after["done"] == case2["batchDate"] and abs(before["toSow"] - after["toSow"] - case2["amount"]) < 1e-6 and "sown" in after["toast"], [before, after])
    js(page, "A.undo(); return true;"); page.wait_for_timeout(400)
    back = js(page, "const p = S.engine.planting(arg.batch); return { toSow: toSow(S.engine, arg.key), done: !!(p && p.done && p.done.sow) };", case2)
    check("Undo takes the sowing back: its seed is to sow again", not back["done"] and abs(back["toSow"] - before["toSow"]) < 1e-6, back)
    browser.close()
    check("no error on the page", not errors, errors[:5])
    finish()

with sync_playwright() as pw:
    try:
        run(pw)
    except Exception as e:
        errors.append(repr(e)[:400]); check("the check ran to its end", False, repr(e)[:400]); finish()
