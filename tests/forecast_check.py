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
import csv, functools, http.server, json, os, re, sys, threading
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

    # ══ the figures: projected revenue leads (his note of Nov 20), the week in hand beside it, the season's own figures under them ══
    figs = js("""const m = HV.model(), i = m.index(S.date), wk = F.periods(m, 'week', i, i)[0], g = F.glance(m, wk.i0, wk.i1), all = F.glance(m, 0, m.days - 1), line = hook('fc-figs');
      const el = n => line && line.querySelector(`[data-fig="${n}"]`), fig = n => { const e = el(n); return e ? txt(e.querySelector('b')) : null; }, box = n => { const e = el(n); return e ? e.querySelector('b').getBoundingClientRect() : null; };
      const lead = box('season'), week = box('week'), kinds = line ? [...line.querySelectorAll('[data-fig="kind"] b')].map(b => parse(b.textContent)) : [];
      const wantKinds = F.GROUPS.map(([k]) => all.list.filter(x => x.row.group === k).reduce((n, x) => n + x.worth, 0)).filter(v => v >= 1);
      return { season: fig('season'), week: fig('week'), ready: fig('ready'), trays: fig('trays-season'), stems: fig('stems-season'), kinds, wantKinds: wantKinds.length,
        want: { season: money(all.worth), worth: all.worth, week: money(g.worth), ready: g.crops, trays: F.shown(all.trays), stems: F.shown(all.stems) },
        size: el('season') ? getComputedStyle(el('season').querySelector('b')).fontSize : '', sizes: line ? [...new Set(hooks('fc-fig', line).filter(e => e.dataset.fig !== 'season').map(e => getComputedStyle(e.querySelector('b')).fontSize))] : [],
        beside: !!lead && !!week && Math.abs(lead.bottom - week.bottom) < 12 && week.left > lead.right + 200, under: !!lead && !!el('picking') && box('picking').top > lead.bottom,
        tall: line ? Math.round(line.getBoundingClientRect().height) : 0, tiles: document.querySelectorAll('#hvWrap .tr-stat').length };""")
    check("projected revenue leads, at 32 and alone at that size, and is the forecast's own; the week in hand's revenue and crops in harvest stand at the right of the same line", figs["season"] == figs["want"]["season"] and figs["size"] == "32px" and figs["sizes"] == ["13px"] and figs["beside"] and figs["week"] == figs["want"]["week"] and str(figs["ready"]).startswith(str(figs["want"]["ready"]) + " crop"), figs)
    check("under them the season's own figures: revenue by kind adds up to projected revenue, the season's trays and stems are the forecast's, and there is no row of tiles", figs["under"] and len(figs["kinds"]) == figs["wantKinds"] and len(figs["kinds"]) >= 2 and abs(sum(figs["kinds"]) - figs["want"]["worth"]) <= len(figs["kinds"]) * 0.5 + 1 and str(figs["trays"]).replace(",", "") == str(figs["want"]["trays"]).replace(".0", "") and str(figs["stems"]).replace(",", "") == str(figs["want"]["stems"]).replace(".0", "") and figs["tiles"] == 0 and 0 < figs["tall"] <= 80, figs)
    words = js("""const line = hook('fc-figs'), foot = document.querySelector('#hvTable tfoot .hv-name'); return { line: txt(line), foot: txt(foot), lead: txt(line && line.querySelector('[data-fig="season"]')) };""")
    check("the words are a grower's and an accountant's: projected revenue, Harvest, Peak week, and Revenue in the table's foot; never worth", "projected revenue" in str(words["lead"]) and "Harvest " in str(words["line"]) and "Peak week " in str(words["line"]) and words["foot"] == "Revenue" and "worth" not in (str(words["line"]) + str(words["foot"])).lower(), words)
    # the season's revenue week by week, beside projected revenue: one bar a week with revenue, the week in hand in orange
    sp = js("""const m = HV.model(), i = m.index(S.date), now = F.periods(m, 'week', i, i)[0], all = F.periods(m, 'week').map(c => ({ key: c.key, worth: m.rows.reduce((n, r) => n + F.sum(r.value, c.i0, c.i1), 0) }));
      const probe = document.body.appendChild(Object.assign(document.createElement('i'), { style: 'color: var(--flag)' })), flag = getComputedStyle(probe).color; probe.remove();
      const fillOf = g => { const p = g.querySelector('path'); return p ? getComputedStyle(p).fill : null; };
      const lo = all.findIndex(w => w.worth >= 1), hi = all.length - 1 - [...all].reverse().findIndex(w => w.worth >= 1), ws = all.slice(lo, hi + 1), svg = hook('fc-spark'), wks = hooks('fc-spark-week');
      const tall = wks.map(g => { const p = g.querySelector('path'); return p ? p.getBBox().height : 0; }), peak = ws.reduce((b, w) => (w.worth > b.worth ? w : b), ws[0]);
      return { n: wks.length, want: ws.length, keys: wks.every((g, k) => g.dataset.week === ws[k].key && Math.abs(+g.dataset.worth - ws[k].worth) < 0.005), now: wks.filter(g => fillOf(g) === flag).map(g => g.dataset.week), wantNow: now.key,
        nowFill: (() => { const g = wks.find(x => x.dataset.week === now.key); const p = g && g.querySelector('path'); return p ? getComputedStyle(p).fill : null; })(), otherFill: (() => { const g = wks.find(x => x.dataset.week !== now.key && x.querySelector('path')); return g ? getComputedStyle(g.querySelector('path')).fill : null; })(),
        tallest: wks[tall.indexOf(Math.max(...tall))] ? wks[tall.indexOf(Math.max(...tall))].dataset.week : null, peak: peak.key, height: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
        prop: wks.every((g, k) => Math.abs(tall[k] - (ws[k].worth >= 1 ? Math.max(2, Math.round(ws[k].worth / peak.worth * 28)) : 0)) < 0.6), label: svg ? svg.getAttribute('aria-label') : '' };""")
    check("beside projected revenue, the season's revenue week by week: a bar a week from the first week with revenue to the last, each as tall as its week's revenue, the tallest the peak week", sp["n"] == sp["want"] and sp["n"] > 10 and sp["keys"] and sp["prop"] and sp["tallest"] == sp["peak"] and 0 < sp["height"] <= 32 and "peak week" in str(sp["label"]), sp)
    check("the week in hand is the one orange bar", sp["now"] == [sp["wantNow"]] and sp["nowFill"] != sp["otherFill"] and sp["nowFill"] is not None, sp)
    go = js("""const wks = hooks('fc-spark-week'), g = wks[Math.floor(wks.length / 3)]; if (!g) return null; const key = g.dataset.week; g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const m = HV.model(), i = m.index(S.date), wk = F.periods(m, 'week', i, i)[0], probe = document.body.appendChild(Object.assign(document.createElement('i'), { style: 'color: var(--flag)' })), flag = getComputedStyle(probe).color; probe.remove();
      return { key, at: wk.key, now: (hooks('fc-spark-week').find(x => x.querySelector('path') && getComputedStyle(x.querySelector('path')).fill === flag) || {}).dataset };""")
    check("a click on a week's bar goes to that week, and its bar turns orange", go["key"] == go["at"] and go["now"] and go["now"]["week"] == go["key"], go)
    page.evaluate("LRFApp.setDate(new Date(LRFApp.planYear(), 6, 14))"); wait(400)
    click("#hvNext", 500)
    step = js("""const m = HV.model(), i = m.index(S.date), wk = F.periods(m, 'week', i, i)[0], g = F.glance(m, wk.i0, wk.i1), e = hook('fc-figs').querySelector('[data-fig="week"]');
      return { said: txt(e), want: `Week of ${LRFUI.day(wk.start)} ${money(g.worth)}`, season: txt(hook('fc-figs').querySelector('[data-fig="season"] b')) };""")
    check("› moves the week and its figures with it; projected revenue stays", str(step["said"]).startswith(str(step["want"])) and step["season"] == figs["season"], step)
    click("#hvPrev", 500)

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

    # a figure in dollars comes only from the plantings that earn it: one of two plantings in a week is marked for personal use, the
    # page shows Everything in dollars, and that week's popup lists the other alone (Codex on #69)
    u2 = js("return S.undo.length;")
    mix = js("""const m = HV.model(), at = F.periods(m, 'week');
      for (const row of m.rows.filter(r => !r.thing && r.total > 0 && r.worth > 0)) for (const c of at) { const here = row.plantings.filter(x => F.share(x, c.i0, c.i1) > 1e-9 && x.price > 0 && !x.personal); if (here.length >= 2) { A.setUse('planting', [here[0].p.id], 'personal'); return { crop: row.cropId, key: c.key, mine: here[0].p.id }; } }
      return null;""")
    wait(900); settle_dialogs()
    if mix:
        js("HV.setUse('all'); HV.setMeasure('dollars'); return 1;"); wait(700)
        ci = js("return table().cols.indexOf(arg.key);", mix); ri = js("return table().rows.findIndex(r => r.crop === arg.crop && !r.thing);", mix)
        if isinstance(ci, int) and isinstance(ri, int) and ci >= 0 and ri >= 0:
            page.locator('[data-hook="fc-table"] tbody tr.hv-row').nth(ri).locator("td.hv-c").nth(ci).click(); wait(600)
    dp = js("""const d = hook('fc-from'); if (!d) return null; const m = fresh('all'), row = m.rows.find(x => x.cropId === arg.crop && !x.thing), c = F.periods(m, 'week').find(c => c.key === arg.key);
      const earn = row.plantings.filter(x => F.share(x, c.i0, c.i1) * (x.price || 0) > 1e-9), total = earn.reduce((n, x) => n + F.share(x, c.i0, c.i1), 0), worth = earn.reduce((n, x) => n + F.share(x, c.i0, c.i1) * x.price, 0);
      return { ids: hooks('fc-from-row', d).map(li => li.dataset.planting).sort(), want: earn.map(x => x.p.id).sort(), mine: arg.mine, lead: txt(hook('fc-from-lead', d)), wantLead: `${F.amount(total, row.unit, row.group)} to sell · ${earn.length} planting${earn.length === 1 ? '' : 's'} · ${money(worth)}`, personal: hooks('fc-tag', d).filter(x => x.dataset.tag === 'personal').length };""", mix or {})
    check("in dollars, a figure's popup lists only the plantings that earn it: one marked for personal use that week is not among them", mix and dp and dp["ids"] == dp["want"] and dp["mine"] not in dp["ids"] and len(dp["ids"]) >= 1 and dp["lead"] == dp["wantLead"] and dp["personal"] == 0, dp)
    js("const d = document.querySelector('dialog[open]'); if (d) { d.close(); d.remove(); } HV.setMeasure('amounts'); return 1;"); wait(400)
    for _ in range(3):
        if js("return S.undo.length;") > u2: js("A.undo(); return 1;"); wait(600)

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
    # Check the actual download button, not only the formatter, with the options growers use.
    def download_rows():
        try:
            with page.expect_download(timeout=20000) as dl: page.click("#hvCsv")
            with open(dl.value.path(), encoding="utf-8", newline="") as f: return list(csv.reader(f))
        except Exception as e: errors.append("spreadsheet: " + str(e)[:160]); return []
    cs = js("""const m = HV.model('commercial'), s = F.season(m), cols = F.periods(m, 'month', s.i0, s.i1), [head, ...rows] = arg, expected = [];
      for (const row of m.rows) {
        const amounts = cols.map(c => { const q = F.sum(row.days, c.i0, c.i1); return F.counted(row.unit) ? Math.floor(q + 1e-6) : F.shown(q); });
        if (amounts.some(q => q > 0)) expected.push([row.name, 'All', row.unit, ...amounts]);
      }
      return { same: JSON.stringify(rows.map(r => [...r.slice(1, 4), ...r.slice(4).map(Number)])) === JSON.stringify(expected),
        head: !!head && JSON.stringify(head) === JSON.stringify(['Kind', 'Crop', 'Variety', 'Unit', ...cols.map(c => F.MONTHS[c.start.getMonth()] + ' ' + m.year)]),
        seen: [expected.some(r => F.counted(r[2])), expected.some(r => !F.counted(r[2]))] };""", download_rows())
    check("its spreadsheet contains the reviewed months and quantities, rounded down as in the text, and no extra totals or varieties", cs["same"] and cs["head"] and all(cs["seen"]), cs)

    page.select_option("#hvShareKind", "flower")
    flowers = js("""const m = HV.model('commercial'), s = F.season(m), cols = F.periods(m, 'month', s.i0, s.i1), [head, ...rows] = arg, expected = [];
      const periods = $('hvSheet').textContent.split('\\n\\n').slice(1, -1);
      const lines = cols.map(() => []);
      for (const row of m.rows.filter(r => r.group === 'flower')) {
        const amounts = cols.map((c, i) => {
          const qty = F.sum(row.days, c.i0, c.i1), amount = F.sendShown(qty, row.unit);
          if (amount > 0) lines[i].push('    ' + row.name + ': ' + F.sendAmount(qty, row.unit, row.group));
          return String(amount);
        });
        if (amounts.some(q => Number(q) > 0)) expected.push(['Flowers', row.name, 'All', row.unit, ...amounts]);
      }
      return { seen: expected.length, rows: JSON.stringify(rows) === JSON.stringify(expected),
        text: JSON.stringify(periods.map(p => p.split('\\n').filter(l => l.startsWith('    ')))) === JSON.stringify(lines),
        dates: JSON.stringify(head) === JSON.stringify(['Kind', 'Crop', 'Variety', 'Unit', ...cols.map(c => F.MONTHS[c.start.getMonth()] + ' ' + m.year)]) };""", download_rows())
    check("the Flowers-only download and preview contain the same commercial flower amounts in each reviewed month, with varieties and prices off",
          flowers["seen"] > 0 and flowers["rows"] and flowers["text"] and flowers["dates"], flowers)

    page.check("#hvShareVar"); page.check("#hvSharePrice")
    detailed = js("""const m = HV.model('commercial'), s = F.season(m), cols = F.periods(m, 'month', s.i0, s.i1), [head, ...rows] = arg, text = $('hvSheet').textContent;
      const named = rows.filter(r => r[2] !== 'All');
      const checked = rows.filter(r => r[2] === 'All').flatMap(r => {
        const row = m.rows.find(x => x.group === 'flower' && x.name === r[1] && x.unit === r[3]);
        return cols.map((c, i) => {
          const q = row ? F.sum(row.days, c.i0, c.i1) : 0, w = row ? F.sum(row.value, c.i0, c.i1) : 0;
          const price = F.sendShown(q, r[3]) && w > 0 ? (w / q).toFixed(2) : '';
          const col = 4 + i * 2;
          return { price, ok: Number(r[col]) === F.sendShown(q, r[3]) && r[col + 1] === price };
        });
      });
      return { named: named.length, priced: checked.filter(r => r.price).length, ok: rows.every(r => r[0] === 'Flowers') && checked.every(r => r.ok)
        && named.every(r => text.includes('      ' + r[2] + ': ') && r.slice(4).every((v, i) => i % 2 === 0 || v === ''))
        && !!head && head.length === 4 + cols.length * 2 && head.slice(4).every((h, i) => i % 2 === 0 || h.endsWith(' unit price (USD)')) };""", download_rows())
    check("with varieties and prices on, the Flowers-only download names the varieties in the preview and prices the same periods", detailed["named"] > 0 and detailed["priced"] > 0 and detailed["ok"], detailed)

    # A selection containing zero rounded whole items, and a genuine harvest outside the selection.
    tiny = js("""const at = (qty, i = 200) => { const d = new Float64Array(365); d[i] = qty; return d; };
      const v = (id, name, qty) => ({ id, name, days: at(qty) });
      const m = { year: 2027, days: 365, rows: [
        { group: 'produce', name: 'Less than one', unit: 'head', days: at(0.6), value: at(0), varieties: [v('a', 'Alone', 0.6)] },
        { group: 'produce', name: 'Some', unit: 'head', days: at(4), value: at(0), varieties: [v('b', 'Most', 3.4), v('c', 'A little', 0.6)] },
        { group: 'produce', name: 'Later', unit: 'head', days: at(20, 255), value: at(0), varieties: [] }] };
      const cols = [{ i0: 199, i1: 205, start: new Date(2027, 6, 19) }], text = F.csv(m, cols, { grain: 'week', varieties: true });
      return { none: !/Less than one|A little|Later/.test(text), some: text.includes('"Some","All","head","4"') && text.includes('"Most","head","3"'),
        dates: text.includes('"2027-07-19"') && !text.includes('Season total') };""")
    check("a one-week spreadsheet leaves out crops outside that week and crops or varieties rounded down to zero", tiny["none"] and tiny["some"] and tiny["dates"], tiny)

    breakdown = js("""const cols = [0, 7, 14, 21].map(i => ({i0: i, i1: i + 6, start: new Date(2027, 0, 4 + i), end: new Date(2027, 0, 10 + i)}));
      const days = (a, b, c) => { const d = new Float64Array(365); d[0] = a; d[7] = b; d[14] = c; return d; };
      const row = { group: 'flower', name: 'Zinnia', unit: 'stem', days: days(20, 40, 10), value: days(0, 0, 0), varieties: [
        { id: 'queen', name: 'Queen Lime', days: days(12, 0, 10) }, { id: '', name: 'No variety chosen', days: days(8, 40, 0) }
      ] };
      const m = {year: 2027, days: 365, rows: [row]}, options = { grain: 'week', group: 'flower', varieties: true };
      const rows = F.csv(m, cols, options).split('\\r\\n').slice(1);
      const week = F.text(m, cols, options).split('\\n\\n')[2];
      return { rows, week, ok: rows.join('\\n') === [
        '"Flowers","Zinnia","All","stem","20","40","10","0"',
        '"Flowers","Zinnia","Queen Lime","stem","12","","10","0"',
        '"Flowers","Zinnia","No variety chosen","stem","8","","0","0"'
      ].join('\\n') && week.includes('Zinnia: 40 stems') && !week.includes('      ') };""")
    check("variety cells are blank when the preview shows only the crop total, and zero where there is nothing on that row", breakdown["ok"], breakdown)
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
    # E2c: a last picking set for a place, on a crop picked to the season's end: the first, by worth, where a date a month before its
    # season ends there moves the season's worth (worked out on the plan with the step, nothing kept)
    follows_change("a place's last picking set", """const eng = S.engine, year = A.planYear(), m = F.build(eng, { year }), rows = m.rows.filter(r => !r.thing && r.total > 0).sort((a, b) => b.worth - a.worth);
      const worthOf = e => F.build(e, { year }).rows.reduce((n, r) => n + r.worth, 0), was = worthOf(eng);
      for (const row of rows) { const c = eng.crop(row.cropId), hc = eng.harvestFor(row.cropId); if (!c || !hc || hc.micro || !LRFYieldCard.windowOf(eng, c, hc).season) continue;
        for (const x of row.plantings) { const b = x.r.b; if (!b || eng.isRack(b)) continue; const env = eng.envOf(b), md = E.d2s(E.addDays(x.r.last, -30)).slice(5), ops = A.sellOps(c.id, { until: { [env]: md } });
          if (!ops || Math.abs(worthOf(A.engineAfter(ops)) - was) < 1) continue;
          LRFYieldCard.setUntil(c, env, md, () => {}); return [row.cropId, env, md]; } }
      return false;""")
    # E2c: the first fall frost moved, under Season…: a frost-tender crop picked past it in open ground is cut
    follows_change("the first fall frost moved", """const d = A.farmDates(), first = E.s2d(`${d.year}-${d.dates.frostFirst}`), md = E.d2s(E.addDays(first, -21)).slice(5);
      return A.setFarmDates({ ...d.dates, frostFirst: md }) ? md : false;""")

    # a narrow window with the full planner (Codex on #94): the weekly bars shrink with their line and stay inside it. A year of
    # weeks is 362 px of bars, the made-up farm's season about 240, so the window is made narrower than the farm's bars need
    page.set_viewport_size({"width": 260, "height": 800}); wait(400)
    page.evaluate("LRFSowView.leavePhone(); LRFApp.setView('harvest')"); wait(900)
    narrow = js("""const line = hook('fc-figs'), sp = hook('fc-spark'); if (!line || !sp) return null; const a = line.getBoundingClientRect(), b = sp.getBoundingClientRect();
      return { view: S.view, line: [Math.round(a.left), Math.round(a.right)], bars: [Math.round(b.left), Math.round(b.right)], width: Math.round(b.width), height: Math.round(b.height), weeks: hooks('fc-spark-week').length };""")
    check("in a narrow window the weekly bars shrink with their line, keep their shape, and stay inside it", narrow["view"] == "harvest" and narrow["weeks"] > 10 and narrow["bars"][0] >= narrow["line"][0] - 1 and narrow["bars"][1] <= narrow["line"][1] + 1 and narrow["width"] > 0 and narrow["width"] < narrow["weeks"] * 7 - 2 and abs(narrow["height"] / narrow["width"] - 28 / (narrow["weeks"] * 7 - 2)) < 0.02, narrow)
    page.set_viewport_size({"width": WIDTH, "height": 900}); wait(300)

    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
