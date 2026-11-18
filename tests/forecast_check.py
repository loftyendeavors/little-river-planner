"""The Forecast page (E3), in a real browser: the Harvest tab renamed Forecast; the page in the frame, its title with "?" beside it and
what its paragraphs said behind "?" in the glossary's words; one line of figures; the table in amounts and in dollars, held cell by cell
to the forecast worked out afresh here for every crop and every week, with each week's worth and the season's as their sums; "Whole
season", which fits every week of the season to the window at one press with nothing to scroll sideways; a figure's popup, a row a
planting with its photograph, variety, bed, amount and how it is picked as a tag (the card's own rule for "Own window"); the list to
send, with things counted in whole numbers and "each"; and the forecast kept for the plan's engine, which a change to a planting, a
crop's yield, a price and the harvest choice each leave behind, the page following. Everything is read by its hook, and every subject
is found on the plan the page was given: nothing here names a crop, a bed or a number of any plan.
usage: python3 -I forecast_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, re, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
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
def parse(t):
    try: return float(str(t).replace("$", "").replace(",", "")) if t not in (None, "") else 0.0
    except Exception: return 0.0
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)

# The "?" text, word for word from the glossary note (his notes of Nov 16, section 3), "days to harvest" kept in place of "DTM".
HELP = [
    "How the forecast is worked out\nAmount = plants (or bed-feet, or trays) × marketable yield × sold share.",
    "When it lands follows each crop’s harvest pattern:\nGradually: a week’s picking, every week of its harvest window.\nClear: all of it on the day it is ready.\nOn demand: spread evenly over its harvest window.",
    "Each crop is in the unit it is sold in. A live tray counts whole on the Monday it is due.",
    "Know this. Days to harvest are the same in every month, so an early or late planting is forecast as if it were midsummer. Read the ends of the season as optimistic.",
    "Change a figure under Assumptions › Yield and price. Click a figure to see its plantings.",
]
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, F = LRFForecast, HV = LRFHarvestView, $ = id => document.getElementById(id);"
       "const hook = (name, el) => (el || document).querySelector(`[data-hook=\"${name}\"]`), hooks = (name, el) => [...(el || document).querySelectorAll(`[data-hook=\"${name}\"]`)];"
       "const txt = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;"
       # the forecast worked out afresh here, never the one the page keeps
       "const fresh = which => F.build(S.engine, { year: A.planYear(), ...(which && which !== 'all' ? { use: which } : {}) });"
       "const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });"
       "const qty = n => { const v = F.shown(n); return v ? v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 1 : 0 }) : ''; };"
       "const cash = n => n >= 1 ? money(n) : '';"
       "const parse = t => +String(t || '').replace(/[$,]/g, '') || 0;"
       # the columns the table shows, read from its head, and each row's cells by column
       "const table = () => { const t = hook('fc-table'); if (!t) return null; const cols = [...t.querySelectorAll('thead th[data-col]')].map(th => th.dataset.col);"
       " const rows = [...t.querySelectorAll('tbody tr.hv-row')].map(tr => ({ crop: tr.dataset.crop, thing: tr.dataset.thing || '', season: txt(tr.querySelector('.hv-total')), cells: [...tr.querySelectorAll('td.hv-c')].map(td => td.textContent), titles: [...tr.querySelectorAll('td.hv-c')].map(td => td.title) }));"
       " const foot = t.querySelector('tfoot tr'); return { measure: t.dataset.measure, fit: t.dataset.fit, cols, rows, sums: hooks('fc-kind-total', t).map(tr => ({ group: tr.dataset.group, season: txt(tr.querySelector('.hv-total')), cells: [...tr.querySelectorAll('td.hv-c')].map(td => td.textContent) })),"
       "  foot: foot ? [...foot.querySelectorAll('td:not(.hv-name):not(.hv-total)')].map(td => td.textContent) : null, footTitles: foot ? [...foot.querySelectorAll('td:not(.hv-name):not(.hv-total)')].map(td => td.title) : null, season: txt(hook('fc-season-total', t)) }; };"
       # what the forecast says the table should hold, for the columns it shows (the week that starts on each column's key)
       "const want = (m, cols, rows, dollars) => { const at = new Map(F.periods(m, 'week').map(c => [c.key, c])), list = m.rows.filter(r => r.total > 0);"
       " return { rows: rows.map(r => { const row = list.find(x => x.cropId === r.crop && (x.thing || '') === r.thing); if (!row) return null; const series = dollars ? row.value : row.days;"
       "  return { season: dollars ? money(row.worth) : F.amount(row.total, row.unit, row.group), cells: cols.map(k => { const c = at.get(k); const v = c ? F.sum(series, c.i0, c.i1) : NaN; return dollars ? cash(v) : qty(v); }), full: cols.map(k => { const c = at.get(k); return c ? (dollars ? money(F.sum(row.value, c.i0, c.i1)) : F.amount(F.sum(row.days, c.i0, c.i1), row.unit, row.group)) : ''; }) }; }),"
       "  foot: cols.map(k => { const c = at.get(k); return cash(list.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0)); }), season: money(list.reduce((n, r) => n + r.worth, 0)), worth: list.reduce((n, r) => n + r.worth, 0) }; };"
       "const seen = el => !!el && el.offsetParent !== null;")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="light")
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    page.evaluate("LRFApp.state.undo.length = 0")
    class Missing(dict):
        """What a reading gives when the thing read is not on the page: false, equal to nothing, so the named line fails and the check goes on."""
        def __getitem__(self, k): return Missing()
        def get(self, k, d=None): return Missing() if d is None else d
        def __bool__(self): return False
        def __eq__(self, o): return False
        def __ne__(self, o): return True
        def __hash__(self): return 0
        def __iter__(self): return iter(())
        def __len__(self): return 0
        def __contains__(self, k): return False
        def __lt__(self, o): return False
        __gt__ = __le__ = __ge__ = __lt__
        def __str__(self): return "(not there)"
    def soft(v):
        if v is None: return Missing()
        if isinstance(v, dict): return type("Soft", (dict,), {"__getitem__": lambda s, k: dict.get(s, k, Missing()), "get": lambda s, k, d=None: dict.get(s, k, Missing() if d is None else d)})({k: soft(x) for k, x in v.items()})
        if isinstance(v, list): return [soft(x) for x in v]
        return v
    def js(body, arg=None):
        try: return soft(page.evaluate("(arg) => { " + PRE + " " + body + " }", arg))
        except Exception as e: errors.append(str(e)[:200]); return Missing()
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0 and page.locator(sel).first.is_visible()
    def click(sel, ms=400):
        if not has(sel): wait(100); return False
        try: page.locator(sel).first.click(timeout=4000)
        except Exception: return False
        wait(ms); return True
    def shot(name):
        try: page.screenshot(path=str(shots / f"forecast-{name}-{WIDTH}.png"))
        except Exception: pass
    def settle_dialogs():
        for _ in range(3):
            if has("dialog[open] .btn.primary"): click("dialog[open] .btn.primary", 700)

    # ══ the tab and the frame ══
    tabs = js("return hooks('view-tab').map(b => [b.dataset.viewBtn, b.textContent.trim()]);")
    check("the tab once called Harvest reads Forecast, between Timeline and Tasks; no tab reads Harvest", [t[1] for t in tabs][:4] == ["Map", "Timeline", "Forecast", "Tasks"] and ["harvest", "Forecast"] in tabs and not any(t[1] == "Harvest" for t in tabs), tabs)
    page.click('[data-hook="view-tab"][data-view-btn="harvest"]'); wait(900)
    page.evaluate("LRFApp.setDate(new Date(LRFApp.planYear(), 6, 14))"); wait(400)
    frame = js("""const wrap = $('hvWrap'), title = hook('fc-title'), q = hook('fc-help'), lead = hook('fc-lead');
      const paras = [...wrap.querySelectorAll('p')].filter(p => seen(p) && !p.closest('[data-hook="fc-figs"]') && !p.closest('table'));
      return { title: txt(title), view: S.view, helpNext: !!title && title.nextElementSibling === q, help: seen(q), leadSeen: seen(lead), leadThere: !!lead, eyebrow: [...wrap.querySelectorAll('.eyebrow')].filter(seen).length, paras: paras.map(txt), size: title ? getComputedStyle(title).fontSize : '' };""")
    check("the page is titled Forecast, at 24, with “?” beside the title", frame["title"] == "Forecast" and frame["view"] == "harvest" and frame["helpNext"] and frame["help"] and frame["size"] == "24px", frame)
    check("no eyebrow and no standing paragraph: what the paragraphs said is kept unseen in the page for “?”", frame["eyebrow"] == 0 and frame["paras"] == [] and frame["leadThere"] and not frame["leadSeen"], frame)
    click('[data-hook="fc-help"]', 400)
    hint = js("const t = hook('fc-help-text'); return t ? { paras: [...t.querySelectorAll('p')].map(p => p.innerText.trim()), seen: seen(t), text: t.innerText } : null;")
    check("“?” says how the forecast is worked out in the glossary's words, word for word", hint["seen"] and list(hint["paras"])[:5] == HELP, {"got": hint["paras"], "want": HELP})
    check("and it says “days to harvest”, never DTM", "Days to harvest" in str(hint["text"]) and "DTM" not in str(hint["text"]), hint["text"])
    shot("help")
    page.keyboard.press("Escape"); wait(200)

    # ══ the line of figures ══
    figs = js("""const m = HV.model(), i = m.index(S.date), wk = F.periods(m, 'week', i, i)[0], g = F.glance(m, wk.i0, wk.i1), all = F.glance(m, 0, m.days - 1), line = hook('fc-figs');
      const fig = n => { const el = line && line.querySelector(`[data-fig="${n}"]`); return el ? txt(el.querySelector('b')) : null; };
      return { season: fig('season'), week: fig('week'), ready: fig('ready'), trays: fig('trays'), stems: fig('stems'), want: { season: money(all.worth), week: money(g.worth), ready: g.crops, trays: F.shown(g.trays), stems: F.shown(g.stems) }, one: line ? Math.round(line.getBoundingClientRect().height) : 0, tiles: document.querySelectorAll('#hvWrap .tr-stat').length };""")
    check("one line of figures: the season's worth leads, then the week in hand's, its crops, trays and stems, each the forecast's own", figs["season"] == figs["want"]["season"] and figs["week"] == figs["want"]["week"] and str(figs["ready"]).startswith(str(figs["want"]["ready"]) + " crop"), figs)
    check("the trays and stems are the forecast's for that week, and there is no row of tiles", str(figs["trays"]).replace(",", "") == str(figs["want"]["trays"]).replace(".0", "") and str(figs["stems"]).replace(",", "") == str(figs["want"]["stems"]).replace(".0", "") and figs["tiles"] == 0 and 0 < figs["one"] <= 40, figs)

    # ══ amounts, week by week: every crop and every week against the forecast worked out afresh ══
    click('[data-hv-grain="week"]', 600); click('[data-hook="fc-measure"] [data-measure="amounts"]', 600)
    a = js("const t = table(), w = want(fresh(HV.use()), t.cols, t.rows, false); return { t, w };")
    bad = [i for i, (r, w) in enumerate(zip(a["t"]["rows"], a["w"]["rows"])) if not w or r["cells"] != w["cells"] or r["season"] != w["season"]]
    check("in amounts every crop's figure for every week, and its season, is the forecast's", a["t"]["measure"] == "amounts" and len(a["t"]["rows"]) > 10 and len(a["t"]["cols"]) > 10 and bad == [], {"bad": bad[:3], "row": a["t"]["rows"][bad[0]] if bad else None, "want": a["w"]["rows"][bad[0]] if bad else None})
    check("and the foot gives each week's worth and the season's, in dollars", a["t"]["foot"] == a["w"]["foot"] and a["t"]["season"] == a["w"]["season"], {"foot": a["t"]["foot"][:8], "want": a["w"]["foot"][:8], "season": [a["t"]["season"], a["w"]["season"]]})

    # ══ dollars ══
    click('[data-hook="fc-measure"] [data-measure="dollars"]', 700)
    d = js("const t = table(), m = fresh(HV.use()), w = want(m, t.cols, t.rows, true); const kinds = F.GROUPS.map(([g]) => ({ group: g, worth: m.rows.filter(r => r.total > 0 && r.group === g).reduce((n, r) => n + r.worth, 0), n: m.rows.filter(r => r.total > 0 && r.group === g).length })).filter(k => k.n); return { t, w, kinds: kinds.map(k => ({ group: k.group, season: money(k.worth) })) };")
    bad = [i for i, (r, w) in enumerate(zip(d["t"]["rows"], d["w"]["rows"])) if not w or r["cells"] != w["cells"] or r["season"] != w["season"]]
    check("in dollars every crop's worth for every week, and its season's, is the forecast's", d["t"]["measure"] == "dollars" and len(d["t"]["rows"]) == len(a["t"]["rows"]) and bad == [], {"bad": bad[:3], "row": d["t"]["rows"][bad[0]] if bad else None, "want": d["w"]["rows"][bad[0]] if bad else None})
    rows_sum = sum(parse(r["season"]) for r in d["t"]["rows"]) if d["t"]["rows"] else -1
    week_sum = sum(parse(x) for x in d["t"]["foot"]) if d["t"]["foot"] else -1
    ncols = len(d["t"]["cols"]) if d["t"]["cols"] else 0
    season = parse(d["t"]["season"])
    check("the season's total is the sum of the crops' seasons, and of the weeks' worth (within the rounding of whole dollars)", season > 0 and abs(season - rows_sum) <= len(d["t"]["rows"]) * 0.5 + 1 and abs(season - week_sum) <= ncols * 1.0 + 1 and d["t"]["season"] == d["w"]["season"], {"season": season, "rows": rows_sum, "weeks": week_sum})
    check("in dollars each kind has a line of its own totals, its season the sum of its crops'", [{"group": s["group"], "season": s["season"]} for s in d["t"]["sums"]] == list(d["kinds"]) and len(d["kinds"]) >= 2, {"sums": [[s["group"], s["season"]] for s in d["t"]["sums"]], "want": d["kinds"]})
    shot("dollars")

    # ══ the whole season at one press ══
    click('[data-hook="fc-season-btn"]', 900)
    f = js("""const sc = hook('fc-scroll'), t = table(), m = fresh(HV.use()), s = F.season(m), weeks = s ? F.periods(m, 'week', s.i0, s.i1).map(c => c.key) : [], tbl = hook('fc-table');
      const over = [...tbl.querySelectorAll('td.hv-c, td.hv-total, tfoot td:not(.hv-name)')].filter(td => td.scrollWidth > td.clientWidth + 1 && getComputedStyle(td).color !== 'rgba(0, 0, 0, 0)').length;
      const w = want(m, t.cols, t.rows, true), titles = t.rows.every((r, i) => w.rows[i] && r.titles.every((x, k) => !x || x.endsWith(': ' + w.rows[i].full[k])));
      return { pressed: hook('fc-season-btn').getAttribute('aria-pressed'), fit: t.fit, cols: t.cols, weeks, side: Math.round(sc.scrollWidth - sc.clientWidth), page: Math.round(document.documentElement.scrollWidth - innerWidth), right: Math.round(tbl.getBoundingClientRect().right - innerWidth), over, titles, season: t.season, figure: txt(hook('fc-figs').querySelector('[data-fig="season"] b')), cells: t.rows.length };""")
    check(f"“Whole season” shows every week of the season and no other, at {WIDTH} wide", f["pressed"] == "true" and f["fit"] == "season" and len(f["weeks"]) > 10 and f["cols"] == f["weeks"], {"cols": len(f["cols"]), "weeks": len(f["weeks"]), "fit": f["fit"]})
    check(f"and it fits the window at {WIDTH} wide: nothing to scroll sideways, in the table or the page", f["side"] <= 0 and f["page"] <= 0 and f["right"] <= 0, f)
    check("no figure spills out of its cell, and each cell's full figure is the forecast's", f["over"] == 0 and f["titles"] and f["cells"] > 10, f)
    # what a fitted cell says: "1.2k" rounded down from the figure itself, whatever it rounds to as a whole dollar (Codex on #69)
    tf = js("""const T = HV.tight, t = table(), m = fresh(HV.use()), at = new Map(F.periods(m, 'week').map(c => [c.key, c])), list = m.rows.filter(r => r.total > 0), bad = [];
      t.rows.forEach(r => { const row = list.find(x => x.cropId === r.crop && (x.thing || '') === r.thing); t.cols.forEach((k, i) => { const c = at.get(k), v = F.sum(row.value, c.i0, c.i1), want = T(cash(v), v); if (r.cells[i] !== want) bad.push([r.crop, k, r.cells[i], want]); }); });
      t.cols.forEach((k, i) => { const c = at.get(k), v = list.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0), want = T(cash(v), v); if (t.foot[i] !== want) bad.push(['foot', k, t.foot[i], want]); });
      return { bad: bad.slice(0, 4), edges: [T(money(1299.6), 1299.6), T(money(9999.7), 9999.7), T(money(10999.5), 10999.5), T(money(1000), 1000), T(money(640.2), 640.2), T(qty(12.5), F.shown(12.5))] };""")
    check("each fitted dollar figure and week's worth is “1.2k” rounded down from the figure itself, never from the whole dollar it rounds to", tf["bad"] == [] and tf["edges"] == ["1.2k", "9.9k", "10k", "1k", "640", "12"], tf)
    # and a figure made to stand just under a boundary: a crop's price set so that one week of it is worth $1,299.5 to $1,300
    u1 = js("return S.undo.length;")
    bd = js("""const m = fresh(HV.use()), t = table(), at = new Map(F.periods(m, 'week').map(c => [c.key, c]));
      for (const r of t.rows) { const row = m.rows.find(x => x.cropId === r.crop && (x.thing || '') === r.thing); if (!row || row.thing || !row.plantings.length || row.plantings.some(x => x.personal || x.price !== row.plantings[0].price) || !(row.plantings[0].price > 0)) continue;
        for (const k of t.cols) { const c = at.get(k), q = F.sum(row.days, c.i0, c.i1); if (q > 3 && q < 40) { const price = Math.ceil(1299.6 / q * 100) / 100; A.setSell(row.cropId, { price }, 'a price for the check'); return { crop: row.cropId, key: k, price }; } } }
      return null;""")
    wait(900); settle_dialogs()
    bv = js("""if (!arg.crop) return null; const m = fresh(HV.use()), row = m.rows.find(x => x.cropId === arg.crop && !x.thing), c = F.periods(m, 'week').find(c => c.key === arg.key), t = table(), i = t.cols.indexOf(arg.key), r = t.rows.find(r => r.crop === arg.crop && !r.thing);
      return { v: F.sum(row.value, c.i0, c.i1), text: r && i >= 0 ? r.cells[i] : null, fit: t.fit };""", bd or {})
    check("a week worth just under $1,300 reads “1.2k” in the whole season, not “1.3k”", bd and bv and bv["fit"] == "season" and 1299.5 <= bv["v"] < 1300 and bv["text"] == "1.2k", [bd, bv])
    if js("return S.undo.length;") > u1: js("A.undo(); return 1;"); wait(800)
    check("its corner is the season's total, the same as the Season figure at the top", f["season"] == f["figure"] and parse(f["season"]) > 0, [f["season"], f["figure"]])
    shot("whole-season")
    click('[data-hook="fc-measure"] [data-measure="amounts"]', 700)
    fa = js("const sc = hook('fc-scroll'), t = table(), w = want(fresh(HV.use()), t.cols, t.rows, false); return { side: Math.round(sc.scrollWidth - sc.clientWidth), titles: t.rows.every((r, i) => w.rows[i] && r.titles.every((x, k) => !x || x.endsWith(': ' + w.rows[i].full[k]))), fit: t.fit };")
    check("in amounts too the whole season fits, and each cell's full figure is the forecast's", fa["fit"] == "season" and fa["side"] <= 0 and fa["titles"], fa)
    shot("whole-season-amounts")
    # a narrow window: the columns are too narrow for any figure; the season still fits, and no figure spills (the cells keep their shade)
    page.set_viewport_size({"width": 900, "height": 900}); wait(900)
    nw = js("""const sc = hook('fc-scroll'), tbl = hook('fc-table'), cells = [...tbl.querySelectorAll('td.hv-c:not(.zero)')];
      const shown = cells.filter(td => td.scrollWidth > td.clientWidth + 1 && getComputedStyle(td).color !== 'rgba(0, 0, 0, 0)').length;
      return { side: Math.round(sc.scrollWidth - sc.clientWidth), page: Math.round(document.documentElement.scrollWidth - innerWidth), spilled: shown, titled: cells.every(td => /: \\S/.test(td.title)), n: cells.length, cols: tbl.querySelectorAll('thead th[data-col]').length };""")
    check("made narrow (900 wide, under the planner's own least width), the whole season still fits its table with nothing to scroll sideways; a figure that cannot fit keeps its shade and gives itself under the pointer", nw["side"] <= 0 and nw["spilled"] == 0 and nw["titled"] and nw["n"] > 50 and nw["cols"] == len(f["weeks"]), nw)
    page.set_viewport_size({"width": WIDTH, "height": 900}); wait(900)
    click('[data-hv-grain="week"]', 700)
    back = js("const t = table(); return { fit: t.fit, pressed: hook('fc-season-btn').getAttribute('aria-pressed') };")
    check("Weeks takes the page back from the whole season", back["fit"] == "" and back["pressed"] == "false", back)

    # ══ a figure's popup: a row a planting, with how each is picked as a tag ══
    # a figure of a crop that some planting carries a window of its own for, if the plan has one; else the figure with the most plantings
    sub = js("""const m = HV.model(), eng = S.engine, t = table(), at = new Map(F.periods(m, 'week').map(c => [c.key, c]));
      const owns = o => !!o && (o.harvestMode === 'season' || o.harvestMode === 'window' || (o.hw != null && o.hw !== '' && Number.isFinite(+o.hw) && +o.hw >= 0));
      const follows = p => { const v = eng.variety(p.varietyId), b = eng.bedOf(p.bedId); return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b); };
      let best = null;
      t.rows.forEach((r, ri) => { const row = m.rows.find(x => x.cropId === r.crop && (x.thing || '') === r.thing); t.cols.forEach((k, ci) => { const c = at.get(k); if (!row || !c) return; const here = row.plantings.filter(x => F.share(x, c.i0, c.i1) > 1e-9);
        const own = here.filter(x => { const b = eng.bedOf(x.p.bedId); return b && !eng.isRack(b) && !follows(x.p); }).length, score = (own && own < here.length ? 1000 : own ? 500 : 0) + here.length; if (here.length && (!best || score > best.score)) best = { ri, ci, score, own, n: here.length }; }); });
      return best;""")
    check("a subject: a figure that comes from more than one planting, one of them with a window of its own", sub and sub["n"] >= 2 and sub["own"] >= 1, sub)
    if sub:
        page.locator('[data-hook="fc-table"] tbody tr.hv-row').nth(sub["ri"]).locator("td.hv-c").nth(sub["ci"]).click(); wait(600)
    pop = js("""const d = hook('fc-from'); if (!d) return null; const m = HV.model(), eng = S.engine, t = table(), at = new Map(F.periods(m, 'week').map(c => [c.key, c]));
      const tr = [...hook('fc-table').querySelectorAll('tbody tr.hv-row')][arg.ri], r = t.rows[arg.ri], row = m.rows.find(x => x.cropId === r.crop && (x.thing || '') === r.thing), c = at.get(t.cols[arg.ci]);
      const owns = o => !!o && (o.harvestMode === 'season' || o.harvestMode === 'window' || (o.hw != null && o.hw !== '' && Number.isFinite(+o.hw) && +o.hw >= 0));
      const follows = p => { const v = eng.variety(p.varietyId), b = eng.bedOf(p.bedId); return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b); };
      const WORD = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' };
      const fresh0 = F.build(eng, { year: A.planYear(), ...(HV.use() !== 'all' ? { use: HV.use() } : {}) }).rows.find(x => x.key === row.key);
      const list = fresh0.plantings.map(x => ({ id: x.p.id, here: F.share(x, c.i0, c.i1), pattern: x.pattern, own: (() => { const b = eng.bedOf(x.p.bedId); return !!b && !eng.isRack(b) && !follows(x.p); })(), variety: (eng.variety(x.p.varietyId) || {}).name || 'No variety chosen', bed: A.bedLabel(eng.bedOf(x.p.bedId), eng), personal: x.personal })).filter(x => x.here > 1e-9).sort((a, b) => b.here - a.here);
      const total = list.reduce((n, x) => n + x.here, 0);
      return { lead: txt(hook('fc-from-lead', d)), wantLead: `${F.amount(total, row.unit, row.group)} to sell · ${list.length} planting${list.length === 1 ? '' : 's'}`,
        rows: hooks('fc-from-row', d).map(li => ({ id: li.dataset.planting, photo: !!li.querySelector('.thumb'), variety: txt(hook('fc-from-variety', li)), bed: txt(hook('fc-from-bed', li)), amount: txt(hook('fc-from-amount', li)), tags: hooks('fc-tag', li).map(x => [x.dataset.tag, txt(x)]) })),
        want: list.map(x => ({ id: x.id, variety: x.variety, bed: x.bed, amount: F.amount(x.here, row.unit, row.group), tags: [['pattern', WORD[x.pattern] || 'On demand'], ...(x.own ? [['own', 'Own window']] : [])].concat(x.personal ? [['personal', 'Personal use']] : []) })) };""", sub or {})
    check("the popup leads with how much and from how many plantings: “5.6 lb to sell · 1 planting”", pop and str(pop["lead"]).startswith(str(pop["wantLead"])), pop and [pop["lead"], pop["wantLead"]])
    got = [{"id": r["id"], "variety": r["variety"], "bed": r["bed"], "amount": r["amount"], "tags": [t for t in r["tags"] if t[0] != "keeps"]} for r in (pop["rows"] if pop else [])]
    check("then a row a planting, largest first, with its photograph, variety, bed and amount, as the forecast has them", pop and len(got) == len(pop["want"]) and len(got) >= 2 and all(r["photo"] for r in pop["rows"]) and [{k: g[k] for k in ("id", "variety", "bed", "amount")} for g in got] == [{k: w[k] for k in ("id", "variety", "bed", "amount")} for w in pop["want"]], {"got": got[:3], "want": (pop["want"] or [])[:3] if pop else None})
    check("each row's tags say how it is picked, in the list's three words, and “Own window” by the card's own rule", pop and [g["tags"] for g in got] == [w["tags"] for w in pop["want"]] and any(["own", "Own window"] in g["tags"] for g in got) and any(["own", "Own window"] not in g["tags"] for g in got), {"got": [g["tags"] for g in got], "want": [w["tags"] for w in (pop["want"] if pop else [])]})
    shot("popup")
    click('[data-hook="fc-from"] .btn.primary', 300)

    # a second subject made here and taken back: the crop with most plantings in beds, of two varieties at least, is set to be picked
    # gradually, and one of its varieties is given a harvest window of its own. Its plantings with a figure of their own are counted
    # on demand all the same, and the variety's are "Own window" by the variety: the tags must say each as the forecast and the card do.
    u0 = js("return S.undo.length;")
    made = js("""const eng = S.engine, m = F.build(eng, { year: A.planYear() });
      const owns = o => !!o && (o.harvestMode === 'season' || o.harvestMode === 'window' || (o.hw != null && o.hw !== '' && Number.isFinite(+o.hw) && +o.hw >= 0));
      const follows = p => { const v = eng.variety(p.varietyId), b = eng.bedOf(p.bedId); return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b); };
      const rows = m.rows.filter(r => !r.thing && r.group === 'produce').map(r => ({ r, f: r.plantings.filter(x => follows(x.p) && x.p.varietyId) })).filter(o => new Set(o.f.map(x => x.p.varietyId)).size >= 2).sort((a, b) => b.f.length - a.f.length);
      if (!rows.length) return null;
      const row = rows[0].r, counts = {}; for (const x of rows[0].f) counts[x.p.varietyId] = (counts[x.p.varietyId] || 0) + 1;
      const vid = Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0], v = eng.variety(vid);
      return { crop: row.cropId, variety: vid, hw: Math.max(7, Math.round(+eng.crop(row.cropId).hw || 30) + 14), v };""")
    if made:
        js("A.setSell(arg.crop, { pattern: 'weekly' }, 'picked gradually, for the check'); return 1;", made); wait(900); settle_dialogs()
        js("A.commit('a variety with a window of its own, for the check', [{ kind: 'variety', before: arg.v, after: { ...arg.v, hw: arg.hw } }]); return 1;", made); wait(900)
    sub2 = js("""const m = HV.model(), eng = S.engine, t = table(), at = new Map(F.periods(m, 'week').map(c => [c.key, c])), ri = t.rows.findIndex(r => r.crop === arg.crop && !r.thing);
      if (ri < 0) return null; const row = m.rows.find(x => x.cropId === arg.crop && !x.thing); let best = null;
      // a planting of the variety that has no window or last day of its own: it is "Own window" by its variety alone
      const own0 = p => (p.harvestMode === 'season' || p.harvestMode === 'window' || (p.hw != null && p.hw !== '' && Number.isFinite(+p.hw) && +p.hw >= 0)) || !!p.harvestEnd;
      t.cols.forEach((k, ci) => { const c = at.get(k); if (!c) return; const here = row.plantings.filter(x => F.share(x, c.i0, c.i1) > 1e-9), mine = here.filter(x => x.p.varietyId === arg.variety && !own0(x.p)).length, kinds = new Set(here.map(x => x.pattern)).size; const score = (mine && mine < here.length ? 100 : 0) + (kinds > 1 ? 50 : 0) + here.length; if (here.length && (!best || score > best.score)) best = { ri, ci, score, mine, n: here.length, kinds, weekly: here.filter(x => x.pattern === 'weekly').length }; });
      return best;""", made or {})
    vown = js("const v = S.engine.variety(arg.variety); return v ? v.hw : null;", made or {})
    check("a second subject, made here: a crop picked gradually, a figure of it from plantings of a variety with a window of its own and of another", made and vown == made["hw"] and sub2 and sub2["mine"] >= 1 and sub2["n"] > sub2["mine"] and sub2["weekly"] >= 1, [made and {k: made[k] for k in ("crop", "hw")}, vown, sub2])
    if sub2:
        page.locator('[data-hook="fc-table"] tbody tr.hv-row').nth(sub2["ri"]).locator("td.hv-c").nth(sub2["ci"]).click(); wait(600)
    pop2 = js("""const d = hook('fc-from'); if (!d) return null; const m = HV.model(), eng = S.engine, t = table(), at = new Map(F.periods(m, 'week').map(c => [c.key, c])), c = at.get(t.cols[arg.ci]);
      const owns = o => !!o && (o.harvestMode === 'season' || o.harvestMode === 'window' || (o.hw != null && o.hw !== '' && Number.isFinite(+o.hw) && +o.hw >= 0));
      const follows = p => { const v = eng.variety(p.varietyId), b = eng.bedOf(p.bedId); return !owns(p) && !p.harvestEnd && !(v && v.cropId === p.cropId && owns(v)) && !!b && !eng.isRack(b); };
      const WORD = { weekly: 'Gradually', once: 'Clear', spread: 'On demand' }, row = F.build(eng, { year: A.planYear() }).rows.find(x => x.cropId === t.rows[arg.ri].crop && !x.thing);
      const wanted = Object.fromEntries(row.plantings.filter(x => F.share(x, c.i0, c.i1) > 1e-9).map(x => [x.p.id, [['pattern', WORD[x.pattern]], ...((() => { const b = eng.bedOf(x.p.bedId); return b && !eng.isRack(b) && !follows(x.p); })() ? [['own', 'Own window']] : []), ...(x.personal ? [['personal', 'Personal use']] : [])]]));
      const got = Object.fromEntries(hooks('fc-from-row', d).map(li => [li.dataset.planting, hooks('fc-tag', li).map(x => [x.dataset.tag, txt(x)]).filter(x => x[0] !== 'keeps')]));
      return { same: JSON.stringify(Object.keys(got).sort().map(k => [k, got[k]])) === JSON.stringify(Object.keys(wanted).sort().map(k => [k, wanted[k]])), got, want: wanted, words: [...new Set(Object.values(got).flat().filter(x => x[0] === 'pattern').map(x => x[1]))], own: Object.values(got).filter(x => x.some(y => y[0] === 'own')).length, n: Object.keys(got).length };""", sub2 or {})
    check("its tags: Gradually where the planting is picked gradually, On demand where its own figure makes it so, “Own window” for the variety's own window, as the forecast and the card have each", pop2 and pop2["same"] and "Gradually" in pop2["words"] and 0 < pop2["own"] < pop2["n"], pop2)
    click('[data-hook="fc-from"] .btn.primary', 300)
    for _ in range(4):
        if js("return S.undo.length;") > u0: js("A.undo(); return 1;"); wait(500)
    check("and both changes made for it are taken back", js("return S.undo.length;") == u0, u0)

    # ══ the list to send: things counted in whole numbers, and "each" ══
    click("#hvShareBtn", 600)
    if has("#hvShareRange"): page.select_option("#hvShareRange", "months"); wait(400)
    ls = js("""const m = HV.model('commercial'), s = F.season(m), cols = F.periods(m, 'month', s.i0, s.i1), text = $('hvSheet').textContent, lines = text.split('\\n');
      const wanted = []; let at = -1;
      for (const c of cols) { at = lines.findIndex((l, i) => i > at && l === F.MONTHS[c.start.getMonth()] + ' ' + m.year); const end = lines.findIndex((l, i) => i > at && l === '');
        for (const row of m.rows) { const q = F.sum(row.days, c.i0, c.i1), whole = F.counted(row.unit) ? Math.floor(q + 1e-6) : F.shown(q); if (!(whole > 0)) continue; const line = '    ' + row.name + ': ' + F.sendAmount(q, row.unit, row.group); wanted.push({ line, there: lines.slice(at, end < 0 ? undefined : end).includes(line), counted: F.counted(row.unit), each: row.unit === 'each' && row.group !== 'flower' }); } }
      const items = lines.filter(l => /^    \\S.*: /.test(l)), amounts = items.map(l => l.slice(l.lastIndexOf(': ') + 2));
      return { want: wanted.length, missing: wanted.filter(w => !w.there).slice(0, 4), counted: wanted.filter(w => w.counted).length, each: wanted.filter(w => w.each).length,
        fractions: items.filter(l => { const u = l.slice(l.lastIndexOf(': ') + 2).split(' ').slice(1).join(' '); return /\\./.test(l.slice(l.lastIndexOf(': ') + 2).split(' ')[0]) && !/^(lb|oz|kg|g|bu)$/.test(u); }).slice(0, 4),
        bare: amounts.filter(x => !/^[\\d.,]+ \\S/.test(x)).slice(0, 4), eachSaid: items.filter(l => / each$/.test(l)).length };""")
    check("the list to send has every crop of every month in its own words, the forecast's amount", ls["want"] > 5 and ls["missing"] == [], ls)
    check("things counted are whole numbers there, and a thing sold singly says “each”", ls["counted"] > 0 and ls["fractions"] == [] and ls["bare"] == [] and ls["each"] > 0 and ls["eachSaid"] >= ls["each"], ls)
    shot("list")
    # the spreadsheet of the same list: things counted whole, rounded down, in its season and in every month (Codex on #69)
    csvt = ""
    try:
        if has("#hvCsv"):
            with page.expect_download(timeout=20000) as dl: page.click("#hvCsv")
            csvt = open(dl.value.path(), encoding="utf-8", newline="").read()
    except Exception as e: errors.append("spreadsheet: " + str(e)[:160])
    cs = js("""const m = HV.model('commercial'), s = F.season(m), cols = F.periods(m, 'month', s.i0, s.i1), rows = arg.split('\\r\\n').slice(1).map(l => l.slice(1, -1).split('","'));
      const bad = [], kinds = { counted: 0, weighed: 0 };
      for (const row of m.rows.filter(r => r.total > 0)) { const line = rows.find(l => l[1] === row.name && l[2] === 'All' && l[3] === row.unit); if (!line) { bad.push([row.name, 'no line']); continue; }
        const each = x => F.counted(row.unit) ? Math.floor(x + 1e-6) : Math.round(x * 100) / 100, want = [each(row.total), ...cols.map(c => each(F.sum(row.days, c.i0, c.i1)))], got = line.slice(4).map(Number);
        kinds[F.counted(row.unit) ? 'counted' : 'weighed']++; if (JSON.stringify(got) !== JSON.stringify(want)) bad.push([row.name, got.slice(0, 4), want.slice(0, 4)]); }
      return { bad: bad.slice(0, 3), seen: kinds, fractions: rows.filter(l => l.length > 4 && !['lb', 'oz', 'kg', 'g', 'bu'].includes(l[3])).flatMap(l => l.slice(4)).filter(x => /\\./.test(x)).length };""", csvt)
    # a crop and a variety of less than one thing counted in all: no line of noughts, as the list leaves them out (Codex on #69)
    tiny = js("""const days = new Float64Array(365), more = new Float64Array(365); days[200] = 0.6; more[200] = 3.4; const m = { year: 2027, days: 365, rows: [
        { group: 'produce', name: 'Less than one', unit: 'head', total: 0.6, days, varieties: [{ id: 'a', name: 'Alone', total: 0.6, days }] },
        { group: 'produce', name: 'Some', unit: 'head', total: 4, days: (() => { const d = new Float64Array(365); d[200] = 4; return d; })(), varieties: [{ id: 'b', name: 'Most', total: 3.4, days: more }, { id: 'c', name: 'A little', total: 0.6, days }] }] };
      const cols = [{ i0: 0, i1: 364, start: new Date(2027, 0, 1) }], text = F.csv(m, cols, { grain: 'month' });
      return { none: !text.includes('Less than one') && !text.includes('A little'), some: text.includes('"Some","All","head","4"') && text.includes('"Most"') };""")
    check("its spreadsheet leaves out a crop or a variety of less than one thing counted in all, and keeps the rest", tiny["none"] and tiny["some"], tiny)
    check("its spreadsheet gives things counted in whole numbers too, rounded down, and weighed things to two places, each the forecast's", len(csvt) > 200 and cs["bad"] == [] and cs["fractions"] == 0 and cs["seen"]["counted"] > 0 and cs["seen"]["weighed"] > 0, cs)
    page.keyboard.press("Escape"); wait(300)
    js("const d = document.querySelector('dialog[open]'); if (d) { d.close(); d.remove(); } return 1;")

    # ══ a crop's forecast sold amount by month, in one call ══
    bm = js("""const m = F.build(S.engine, { year: A.planYear(), use: 'commercial' }), row = m.rows.filter(r => r.total > 0).sort((a, b) => b.worth - a.worth)[0], got = F.byMonth(S.engine, row.cropId), line = got.rows.find(r => r.key === row.key);
      return { n: line ? line.sold.length : 0, sold: line ? line.sold.reduce((a, b) => a + b, 0) : -1, worth: line ? line.worth.reduce((a, b) => a + b, 0) : -1, total: row.total, value: row.worth, rows: got.rows.length === m.rows.filter(r => r.cropId === row.cropId).length };""")
    check("one call gives a crop's forecast sold amount and worth by month, the twelve adding up to its season", bm["n"] == 12 and abs(bm["sold"] - bm["total"]) < 1e-6 and abs(bm["worth"] - bm["value"]) < 1e-6 and bm["rows"], bm)

    # ══ the forecast kept for the engine, and the page following every change ══
    click('[data-hook="fc-measure"] [data-measure="dollars"]', 500)
    k0 = js("const e = S.engine, a = F.kept(e, { year: A.planYear() }), b = F.kept(e, { year: A.planYear() }); return { same: a === b && HV.model() === a, built: a !== F.build(e, { year: A.planYear() }), kept: F.isKept(e, { year: A.planYear() }) };")
    check("the forecast is kept for the plan's engine and its options: asked twice it is worked out once, and the page reads that one", k0["same"] and k0["built"] and k0["kept"], k0)
    def follows_change(what, body, arg=None):
        before = js("return { worth: want(fresh(HV.use()), table().cols, table().rows, true).worth, engine: (window.__fcE = S.engine, 1), undo: S.undo.length };")
        r = js(body, arg); wait(700); settle_dialogs(); wait(500)
        after = js("""const e = S.engine, t = table(), w = want(fresh(HV.use()), t.cols, t.rows, true), bad = t.rows.filter((r, i) => !w.rows[i] || r.cells.join('|') !== w.rows[i].cells.join('|') || r.season !== w.rows[i].season).length;
          return { newEngine: e !== window.__fcE, kept: F.isKept(e, { year: A.planYear() }), stale: F.isKept(window.__fcE, { year: A.planYear() }), worth: w.worth, season: t.season, wantSeason: w.season, figure: txt(hook('fc-figs').querySelector('[data-fig="season"] b')), bad, undo: S.undo.length };""")
        check(f"{what}: a new engine, its forecast worked out for it, and the page follows: every cell, every season and the Season figure the new forecast's", r is not False and after["newEngine"] and after["kept"] and abs(after["worth"] - before["worth"]) >= 0.5 and after["bad"] == 0 and after["season"] == after["wantSeason"] and after["figure"] == after["wantSeason"] and after["undo"] == before["undo"] + 1, {"before": before, "after": after, "r": r})
        js("A.undo(); return 1;"); wait(800)
        back = js("const t = table(), w = want(fresh(HV.use()), t.cols, t.rows, true); return { worth: w.worth, season: t.season, want: w.season };")
        check(f"and Undo of it brings the page back to the forecast as it was", abs(back["worth"] - before["worth"]) < 1e-6 and back["season"] == back["want"], {"before": before["worth"], "back": back})
    # a planting: one of the largest by worth is taken out (the plainest change that must move the forecast)
    follows_change("a planting changed", """const m = F.build(S.engine, { year: A.planYear() }), x = m.rows.flatMap(r => r.plantings).filter(x => x.inYear * x.price > 1).sort((a, b) => b.inYear * b.price - a.inYear * a.price)[0];
      return x ? A.removePlantings([x.p.id]) !== false : false;""")
    # a crop's yield: the crop worth most has its yield in the place most of it grows in set half again as large
    follows_change("a crop's yield changed", """const eng = S.engine, m = F.build(eng, { year: A.planYear() }), row = m.rows.filter(r => !r.thing && r.total > 0 && r.group === 'produce').sort((a, b) => b.worth - a.worth)[0];
      const env = (() => { const n = {}; for (const x of row.plantings) { const b = x.r.b; if (b && !eng.isRack(b)) { const e = eng.envOf(b); n[e] = (n[e] || 0) + x.inYear; } } return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0]; })();
      const one = row.plantings.find(x => x.r.b && !eng.isRack(x.r.b) && eng.envOf(x.r.b) === env), y = eng.yieldOf(one.p, one.r), each = y && y.each > 0 ? y.each : 1;
      A.setYield('crops', row.cropId, env, Math.round(each * 1.5 * 1000) / 1000 || 1); return true;""")
    # a price
    follows_change("a price changed", """const m = F.build(S.engine, { year: A.planYear() }), row = m.rows.filter(r => !r.thing && r.total > 0 && r.worth > 0).sort((a, b) => b.worth - a.worth)[0];
      A.setSell(row.cropId, { price: Math.round((row.worth / row.total) * 2 * 100) / 100 }, 'price for the check'); return true;""")
    # the harvest choice: a crop picked to the season's end set to a few days, or one picked for days set to the season's end
    follows_change("the harvest choice changed", """const eng = S.engine, m = F.build(eng, { year: A.planYear() }), rows = m.rows.filter(r => !r.thing && r.group === 'produce' && r.total > 0).sort((a, b) => b.worth - a.worth);
      // the first crop, by worth, whose other side of the choice moves the season's worth (worked out on the plan with the step, nothing kept)
      const worthOf = e => F.build(e, { year: A.planYear() }).rows.reduce((n, r) => n + r.worth, 0), was = worthOf(eng);
      for (const row of rows) { const c = eng.crop(row.cropId), hc = eng.harvestFor(row.cropId); if (!c || !hc || hc.micro || !LRFYieldCard.windowOf) continue; const w = LRFYieldCard.windowOf(eng, c, hc), to = w.season ? 7 : 'season', ops = A.sellOps(c.id, { days: to });
        if (!ops || Math.abs(worthOf(A.engineAfter(ops)) - was) < 1) continue;
        LRFYieldCard.setWindow(c, to, () => {}); return row.cropId; }
      return false;""")

    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
