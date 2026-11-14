"""The Nursery view (it was the Trays view until 0.31) in headless Chrome, on the plan the app ships with: figures, editing demand, undo, seed rate, the newer-plan notice.
Since 0.31 the view has four tabs (Bench room, Live trays, Supplies, Set-up): the check goes to the tab each thing is on.
usage: python3 -I trays_check.py <app-dir-or-html-file> <shots-dir> [device|cloud|file]
"""
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

target, shots = Path(sys.argv[1]), Path(sys.argv[2])
scenario = sys.argv[3] if len(sys.argv) > 3 else "device"
shots.mkdir(parents=True, exist_ok=True)
server = None
if scenario == "file":
    url = target.resolve().as_uri()
else:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(target)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
results, errors, failed = {}, [], []


def check(name, ok, detail=None):
    results[name] = {"ok": bool(ok), **({"detail": detail} if detail is not None else {})}
    if not ok:
        failed.append(name)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1480, "height": 900}, offline=(scenario == "file"))
    page = context.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))

    if scenario == "cloud":
        # A stand-in for the page database: same calls, same 256 KiB document limit, kept in memory.
        page.add_init_script("""
          window.__docs = new Map(); window.__writes = 0; window.__maxDoc = 0;
          const snap = path => ({ id: path.split('/').pop(), exists: window.__docs.has(path), data: () => window.__docs.has(path) ? JSON.parse(window.__docs.get(path)) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
          const doc = path => ({ path,
            get: async () => snap(path),
            set: async data => { const text = JSON.stringify(data); const bytes = new TextEncoder().encode(text).length; if (bytes > 256 * 1024) { const e = new Error('document over 256 KiB: ' + path + ' ' + bytes); e.code = 'invalid_argument'; throw e; } window.__maxDoc = Math.max(window.__maxDoc, bytes); window.__writes++; window.__docs.set(path, text); },
            delete: async () => { window.__docs.delete(path); },
            onSnapshot: () => () => {} });
          window.claude = { use: async name => name === 'db' ? { doc } : null };
        """)

    def js(expr):
        return page.evaluate(f"(() => {{ const A = LRFApp, S = A.state, E = LRFEngine, T = LRFTrays, eng = S.engine; return {expr}; }})()")

    def ready():
        page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
        page.wait_for_timeout(700)

    def toast():
        return js("({text: document.querySelector('#toast span') ? document.querySelector('#toast span').textContent : '', action: document.querySelector('#toast .toast-action') ? document.querySelector('#toast .toast-action').textContent : null})")

    def tab(name):   # 0.31: one of the Nursery's four tabs
        js(f"LRFTraysView.setTab('{name}')")
        page.wait_for_timeout(350)

    def stats():   # the tiles of Live trays and of Bench room together, as they were on one page; the tab that was open is left open
        was = js("LRFTraysView.tab()")
        out = {}
        for name in ("live", "room"):
            tab(name)
            out.update(js("Object.fromEntries([...document.querySelectorAll('#trWrap .tr-stat')].map(el => [el.querySelector('span').textContent, [el.querySelector('strong').textContent, (el.querySelector('small') || {}).textContent || '']]))"))
        tab(was)
        return out

    def typed(selector, value):
        page.fill(selector, str(value))
        page.dispatch_event(selector, "change")
        page.wait_for_timeout(450)

    page.goto(url)
    ready()
    truth = js("(() => { const list = T.batches(eng, E), plan = (S.plan.liveTrayPlans || [])[0]; return {batches: list.length, trays: list.reduce((n, b) => n + b.trays, 0), revenue: list.reduce((n, b) => n + b.revenue, 0), plans: (S.plan.liveTrayPlans || []).length, rows: plan ? plan.rows.length : 0, plan: plan && plan.name, plantings: S.plan.plantings.length, crops: S.plan.crops.length}; })()")
    original = js("JSON.stringify({plans: S.plan.liveTrayPlans, trays: S.plan.plantings.filter(p => p.liveTray).map(p => [p.liveTray.key, p.date, p.trays, p.price, p.dtm, p.cropId]).sort(), crops: S.plan.crops})")
    page.click('[data-view-btn="trays"]')
    page.wait_for_timeout(600)
    opened_on = js("({tab: LRFTraysView.tab(), title: document.getElementById('nuTitle').textContent, tabs: [...document.querySelectorAll('#nuTabs button')].map(b => b.textContent), nav: document.querySelector('[data-view-btn=\"trays\"]').textContent})")
    check("the view is the Nursery, and opens on Bench room with Live trays, Supplies and Set-up beside it (0.31)", opened_on["tab"] == "room" and opened_on["title"] == "Bench room" and opened_on["tabs"] == ["Bench room", "Live trays", "Supplies", "Set-up"] and opened_on["nav"] == "Nursery", opened_on)
    st = stats()
    shown = js("({cols: document.querySelectorAll('.bn-chart .bn-col').length, segs: document.querySelectorAll('.bn-chart .bn-seg').length, legend: [...document.querySelectorAll('.bn-legend span')].map(e => e.textContent), cap: (document.querySelector('.bn-cap-label') || {}).textContent, library: getComputedStyle(document.querySelector('.library')).display})")
    tab("live")
    shown.update(js("({rows: document.querySelectorAll('.tr-demand tbody tr').length, name: (document.querySelector('.tr-plan .tr-name') || {}).value, weeks: document.querySelectorAll('.tr-week tbody tr').length, foot: [...document.querySelectorAll('.tr-demand tfoot td')].map(e => e.textContent), thumbs: document.querySelectorAll('.tr-demand .thumb').length})"))
    check("the Live trays tab shows the saved demand plan and its season totals", truth["plans"] >= 1 and shown["rows"] == truth["rows"] and shown["name"] == truth["plan"] and st["Trays this season"][0] == f"{truth['trays']:,}" and st["Expected"][0] == "$" + f"{round(truth['revenue']):,}" and f"{truth['batches']} batches" in st["Trays this season"][1] and shown["library"] == "none" and shown["thumbs"] == truth["rows"], {"stats": st, "shown": {k: shown[k] for k in ("rows", "name", "foot")}, "truth": truth})
    bench = js("(() => { let worst = null; for (let d = new Date(A.planYear(), 0, 1); d.getFullYear() === A.planYear(); d = E.addDays(d, 1)) { const r = eng.benchDay(d); if (!worst || r.total - r.cap > worst.total - worst.cap) worst = r; } return {total: worst.total, cap: worst.cap, over: worst.over, date: E.d2s(worst.date), spaces: eng.heatedTraySpaces()}; })()")
    fullest = st["Benches at their fullest"]
    check("the benches chart has a column a week, a legend of what is there, the room the benches hold, and names the fullest day; crates on the floor take none", shown["cols"] >= 20 and shown["segs"] > shown["cols"] and len(shown["legend"]) == js("LRFBench.figures().kinds.length") and "Sheltered crates" not in shown["legend"] and shown["cap"] == f"{bench['spaces']} spaces" and fullest[0] == f"{round(bench['total'])} of {bench['cap']}" and (bench["over"] <= 0.05 or "over" in fullest[1]), {"shown": {k: shown[k] for k in ("cols", "segs", "legend", "cap")}, "bench": bench, "stat": fullest})
    # the trays themselves: plug trays by kind at their most, open trays under rockwool, and the live trays that leave
    tab("supplies")
    use = js("(() => { const f = LRFBench.figures(), rows = Object.fromEntries([...document.querySelectorAll('#bnSupplies tbody tr')].map(r => [r.dataset.supply, r.textContent])); let plug = new Map(), carriers = 0; for (let d = new Date(A.planYear(), 0, 1); d.getFullYear() === A.planYear(); d = E.addDays(d, 1)) { const u = eng.traysOn(d); carriers = Math.max(carriers, u.carriers); for (const t of u.plug) plug.set(t.id, Math.max(plug.get(t.id) || 0, t.n)); } return {rows, plug: [...plug], carriers, sold: f.flats.sold, liveTrays: T.batches(eng, E).reduce((n, b) => n + b.trays, 0)}; })()")
    check("on the Supplies tab, as a table of supplies: plug trays of each kind filled over the season and not said to come back (0.33), the open trays under rockwool, and the live trays that leave with the sale", all("filled over the season" in use["rows"].get(k, "") and "in use at once" not in use["rows"].get(k, "") for k, n in use["plug"]) and len(use["plug"]) >= 2 and f"{use['carriers']} one under each rockwool sheet" in use["rows"].get("open-holes", "") and use["carriers"] >= 1 and use["sold"] == use["liveTrays"] and f"{use['sold']} go out as live trays" in (use["rows"].get("open", "") + use["rows"].get("live-unsaid", "")), use)
    page.screenshot(path=str(shots / "t1-trays-top.png"))
    # hover a column: one readout, every kind that is there
    tab("room")
    col = js("(() => { const cols = [...document.querySelectorAll('.bn-chart .bn-col')]; let best = 0, at = 0; cols.forEach((c, i) => { const n = c.querySelectorAll('.bn-seg').length; if (n > best) { best = n; at = i; } }); const r = cols[at].querySelector('.bn-hit').getBoundingClientRect(); return {i: at, kinds: best, x: r.left + r.width / 2, y: r.top + r.height * 0.6}; })()")
    js("document.querySelector('.tr-wrap .bn').scrollIntoView({block: 'start'})")
    page.wait_for_timeout(200)
    col = js(f"(() => {{ const r = document.querySelectorAll('.bn-chart .bn-col')[{col['i']}].querySelector('.bn-hit').getBoundingClientRect(); return {{i: {col['i']}, kinds: {col['kinds']}, x: r.left + r.width / 2, y: r.top + r.height * 0.6}}; }})()")
    page.mouse.move(col["x"], col["y"])
    page.wait_for_timeout(200)
    tip = js("({hidden: document.querySelector('.bn-tip').hidden, rows: [...document.querySelectorAll('.bn-tip .bn-tip-row')].map(e => e.textContent), head: (document.querySelector('.bn-tip b') || {}).textContent})")
    check("pointing at a week reads out everything on the benches that week", not tip["hidden"] and len(tip["rows"]) == col["kinds"] + 1 and "Week of" in tip["head"] and "tray spaces" in tip["rows"][-1], tip)
    page.screenshot(path=str(shots / "t2-benches.png"))
    page.mouse.move(5, 5)

    # change a weekly number: the batches follow, one undo puts everything back
    tab("live")
    first_row = js("S.plan.liveTrayPlans[0].rows[0]")
    weeks_summer = js("(() => { const m = T.schedule(S.plan.liveTrayPlans[0]); return m.weeks.filter(w => w.season === 'summer').length; })()")
    sel = f'.tr-demand tr[data-row="{first_row["id"]}"] input[aria-label$="summer trays a week"]'
    typed(sel, first_row["summer"] + 2)
    after = js("(() => { const list = T.batches(eng, E); return {trays: list.reduce((n, b) => n + b.trays, 0), batches: list.length, plantings: S.plan.plantings.length, row: S.plan.liveTrayPlans[0].rows[0].summer, undo: S.undo.length, focus: document.activeElement && document.activeElement.getAttribute('aria-label')}; })()")
    t = toast()
    check("two more trays a week in summer adds exactly those trays, as one step with Undo", after["trays"] == truth["trays"] + 2 * weeks_summer and after["row"] == first_row["summer"] + 2 and stats()["Trays this season"][0] == f"{after['trays']:,}" and t["action"] == "Undo" and "→" in t["text"], {"after": after, "weeks": weeks_summer, "toast": t})
    sameBatches = js("(() => { const m = T.schedule(S.plan.liveTrayPlans[0]), have = S.plan.plantings.filter(p => p.liveTray).map(p => [p.liveTray.key, p.date, p.trays, p.price].join('|')).sort(), want = m.batches.map(b => [b.key, b.sow, b.trays, b.price].join('|')).sort(); return JSON.stringify(have) === JSON.stringify(want); })()")
    check("the plantings are the batches the edited demand asks for", sameBatches)
    page.keyboard.press("Control+z")
    page.wait_for_timeout(400)
    check("undo restores the demand and every batch", js("JSON.stringify({plans: S.plan.liveTrayPlans, trays: S.plan.plantings.filter(p => p.liveTray).map(p => [p.liveTray.key, p.date, p.trays, p.price, p.dtm, p.cropId]).sort(), crops: S.plan.crops})") == original and stats()["Trays this season"][0] == f"{truth['trays']:,}")
    typed(sel, "2.5")
    check("a number that makes no sense is refused and put back", js("S.plan.liveTrayPlans[0].rows[0].summer") == first_row["summer"] and page.input_value(sel) == str(first_row["summer"]) and "whole number" in toast()["text"], toast())

    # seed per tray: the one figure the plan was missing for seed
    seed_sel = f'.tr-demand tr[data-row="{first_row["id"]}"] input[aria-label$="grams of seed per tray"]'
    row_trays = js(f"T.batches(eng, E).filter(b => b.p.liveTray && b.p.liveTray.rowId === '{first_row['id']}').reduce((n, b) => n + b.trays, 0)")
    # since 0.28 a tray crop with no weight is taken as sown in cells: this one is said to be broadcast in an open tray first
    page.select_option(f'.tr-demand tr[data-row="{first_row["id"]}"] .tr-how', "open"); page.wait_for_timeout(400)
    typed(seed_sel, 12)
    seeded = js(f"(() => {{ const c = eng.crop('{first_row['cropId']}'), need = LRFSeedLib.required(eng).rows.find(r => r.crop && r.crop.id === c.id && r.unit === 'g'); return {{seedG: c.seedG, total: need && need.total, saved: (S.plan.crops.find(x => x.id === c.id) || {{}}).seedG}}; }})()")
    check("grams of seed per tray is saved on the crop, and the seed list counts it", seeded["saved"] == 12 and seeded["total"] == row_trays * 12 and stats()["Seed for the season"][0] != "—", {"seeded": seeded, "trays": row_trays, "stat": stats()["Seed for the season"]})
    page.keyboard.press("Control+z")
    page.wait_for_timeout(300)
    page.keyboard.press("Control+z")
    page.wait_for_timeout(300)

    # add a crop the planner already knows, give it demand, take it out again
    crops_before = js("S.plan.crops.length")
    page.fill(".tr-plan .tr-add", "Pea shoots")
    page.locator(".tr-plan .tr-addwrap .btn").click()
    page.wait_for_timeout(450)
    added = js("(() => { const rows = S.plan.liveTrayPlans[0].rows, r = rows[rows.length - 1]; return {n: rows.length, name: r.name, cropId: r.cropId, days: r.days, price: r.price, crops: S.plan.crops.length, known: !!eng.crop(r.cropId), id: r.id}; })()")
    check("a crop the planner already keeps is added without making a second copy of it", added["n"] == truth["rows"] + 1 and added["known"] and added["crops"] == crops_before and added["days"] >= 1, added)
    typed(f'.tr-demand tr[data-row="{added["id"]}"] input[aria-label$="spring trays a week"]', 3)
    grown = js(f"S.plan.plantings.filter(p => p.liveTray && p.liveTray.rowId === '{added['id']}').length")
    check("its weekly trays become batches", grown > 0 and js(f"S.plan.plantings.filter(p => p.liveTray && p.liveTray.rowId === '{added['id']}').every(p => p.cropId === '{added['cropId']}' && p.trays === 3)"), {"batches": grown})
    page.locator(f'.tr-demand tr[data-row="{added["id"]}"] .tr-x').click()
    page.wait_for_timeout(450)
    check("taking a crop out removes its batches", js(f"S.plan.plantings.filter(p => p.liveTray && p.liveTray.rowId === '{added['id']}').length") == 0 and js("S.plan.liveTrayPlans[0].rows.length") == truth["rows"])
    # a shorter season
    through = js("S.plan.liveTrayPlans[0].through")
    typed('.tr-plan input[aria-label="Last week of"]', js("T.add(S.plan.liveTrayPlans[0].through, -28)"))
    check("an earlier last week drops the batches after it", js("T.batches(eng, E).length") < truth["batches"] and js("S.plan.liveTrayPlans[0].through") != through)
    for _ in range(12):
        if js("S.undo.length") == 0:
            break
        page.keyboard.press("Control+z")
        page.wait_for_timeout(120)
    page.wait_for_timeout(300)
    check("undoing every step gives back exactly the plan that was loaded", js("JSON.stringify({plans: S.plan.liveTrayPlans, trays: S.plan.plantings.filter(p => p.liveTray).map(p => [p.liveTray.key, p.date, p.trays, p.price, p.dtm, p.cropId]).sort(), crops: S.plan.crops})") == original and js("S.plan.plantings.length") == truth["plantings"])

    # where the sheltered crates stand
    before_peak = stats()["Benches at their fullest"][0]
    tab("setup")   # 0.31: where the crates are counted is said on Set-up, under "How trays and crates are counted"
    link = page.locator("#bnCount .bn-crates .linkish")
    check("where the sheltered crates are counted is a choice on the Set-up tab (0.31)", link.count() == 1, link.count())
    if link.count():
        link.click()
        page.wait_for_timeout(400)
        tab("room")
        on = js("({bench: eng.cratesOnBenches, own: S.plan.lrfNext.crates, legend: [...document.querySelectorAll('.bn-legend span')].map(e => e.textContent)})")
        on["stat"] = stats()["Benches at their fullest"][0]
        check("counting the sheltered crates on the benches adds them to the chart; undo takes them off again", on["bench"] and on["own"] == "bench" and "Sheltered crates" in on["legend"] and on["stat"] != before_peak, on)
        page.keyboard.press("Control+z")
        page.wait_for_timeout(300)
        check("crates are back on the floor", not js("eng.cratesOnBenches") and stats()["Benches at their fullest"][0] == before_peak)
    # trays open on a Monday
    tab("live")
    opened = js("({from: S.plan.liveTrayPlans[0].from, rule: S.plan.lrfNext.trayStart || null})")
    from_sel = '.tr-plan input[aria-label="First ready date"]'
    if opened["rule"] == "monday":
        sat = js("T.add(T.monday(S.plan.liveTrayPlans[0].from), 5)")
        typed(from_sel, sat)
        check("with trays wanted on Mondays, a mid-week first date opens on the Monday after it", js("S.plan.liveTrayPlans[0].from") == js(f"T.mondayOnOrAfter('{sat}')") and "Monday after" in toast()["text"], toast())
        page.keyboard.press("Control+z")
        page.wait_for_timeout(300)
        js("A.setOwn('trayStart', null, 'test: rule off')")
        page.wait_for_timeout(200)
    sat = js("T.add(T.monday(S.plan.liveTrayPlans[0].from), -2)")
    typed(from_sel, sat)
    callout = js("({from: S.plan.liveTrayPlans[0].from, text: (document.querySelector('.tr-callout span') || {}).textContent, button: (document.querySelector('.tr-callout .btn') || {}).textContent})")
    check("without that rule a mid-week opening is kept, and the page says what it doubles", callout["from"] == sat and callout["text"] and "mid-week" in callout["text"] and callout["button"] and callout["button"].startswith("Open on Mon"), callout)
    page.locator(".tr-callout .btn").click()
    page.wait_for_timeout(500)
    fixed = js("({from: S.plan.liveTrayPlans[0].from, rule: S.plan.lrfNext.trayStart, callout: !!document.querySelector('.tr-callout'), monday: new Date(S.plan.liveTrayPlans[0].from + 'T12:00:00').getDay(), batchesOk: S.plan.plantings.filter(p => p.liveTray).every(p => p.liveTray.ready >= S.plan.liveTrayPlans[0].from)})")
    check("one click opens it on the Monday and makes that the rule here", fixed["from"] == js(f"T.mondayOnOrAfter('{sat}')") and fixed["rule"] == "monday" and not fixed["callout"] and fixed["monday"] == 1 and fixed["batchesOk"], fixed)
    for _ in range(6):
        if js("S.undo.length") == 0:
            break
        page.keyboard.press("Control+z")
        page.wait_for_timeout(120)
    check("and it all undoes", js("S.plan.liveTrayPlans[0].from") == opened["from"] and (js("S.plan.lrfNext.trayStart || null") == opened["rule"]))
    # a sown batch is history; the rest of the plan still follows demand
    batch = js("(() => { const p = S.plan.plantings.find(p => p.liveTray && p.liveTray.rowId === S.plan.liveTrayPlans[0].rows[0].id); return {id: p.id, trays: p.trays, date: p.date}; })()")
    js(f"A.recordSowing('{batch['id']}', {{date: A.today(), quantity: 0}})")
    page.wait_for_timeout(500)
    typed(sel, first_row["summer"] + 1)
    typed(f'.tr-demand tr[data-row="{first_row["id"]}"] input[aria-label$="spring trays a week"]', first_row["spring"] + 3)
    held = js(f"(() => {{ const p = S.plan.plantings.find(p => p.id === '{batch['id']}'), others = S.plan.plantings.filter(p => p.liveTray && p.liveTray.rowId === '{first_row['id']}' && p.id !== '{batch['id']}'); return {{trays: p.trays, date: p.date, sown: !!(p.done && p.done.sow), spring: S.plan.liveTrayPlans[0].rows[0].spring, moved: others.filter(q => q.trays === {first_row['spring'] + 3}).length, note: (document.querySelector('.tr-plan .tr-note') || {{}}).textContent, inputs: document.querySelectorAll('.tr-demand input:disabled').length, sownChips: document.querySelectorAll('.tr-chip.done').length}}; }})()")
    t = toast()
    check("a sown batch keeps its trays and date while the others take the new number, and nothing is locked", held["sown"] and held["trays"] == batch["trays"] and held["date"] == batch["date"] and held["spring"] == first_row["spring"] + 3 and held["moved"] > 0 and "left as recorded" in t["text"] and "already sown" in held["note"] and held["sownChips"] == 1, {"held": held, "toast": t})
    page.locator(".tr-plan .btn.danger").click()
    page.wait_for_selector("dialog.dialog")
    said = page.locator("dialog.dialog p").inner_text()
    page.locator("dialog.dialog .btn.danger").click()
    page.wait_for_timeout(500)
    gone = js(f"(() => {{ const p = S.plan.plantings.find(p => p.id === '{batch['id']}'); return {{plans: (S.plan.liveTrayPlans || []).length, planned: S.plan.plantings.filter(p => p.liveTray).length, kept: !!p && !p.liveTray && !!(p.done && p.done.sow), batches: T.batches(eng, E).length, empty: !!document.querySelector('.tr-empty')}}; }})()")
    check("deleting the plan takes its unsown batches and leaves the sown one on the benches", gone["plans"] == truth["plans"] - 1 and gone["planned"] == 0 and gone["kept"] and gone["batches"] == 1 and "already sown stay" in said, {"gone": gone, "said": said})
    for _ in range(8):
        if js("S.undo.length") == 0:
            break
        page.keyboard.press("Control+z")
        page.wait_for_timeout(150)
    page.wait_for_timeout(300)
    check("every one of those steps undoes, the sowing included", js("JSON.stringify({plans: S.plan.liveTrayPlans, trays: S.plan.plantings.filter(p => p.liveTray).map(p => [p.liveTray.key, p.date, p.trays, p.price, p.dtm, p.cropId]).sort(), crops: S.plan.crops})") == original and not js(f"!!(S.plan.plantings.find(p => p.id === '{batch['id']}').done)"))

    # week by week: the planning week is marked; a click on a week moves it
    js("document.querySelector('.tr-weeks').scrollIntoView({block: 'start'})")
    wk = js("(() => { const rows = [...document.querySelectorAll('.tr-week tbody tr')], mid = rows[Math.floor(rows.length / 2)]; return {n: rows.length, week: mid.dataset.week, chips: document.querySelectorAll('.tr-week .tr-chip').length, batches: T.batches(eng, E).length}; })()")
    page.locator(f'.tr-week tbody tr[data-week="{wk["week"]}"] td').first.click()
    page.wait_for_timeout(350)
    now = js("({date: E.d2s(S.date), marked: (document.querySelector('.tr-week tr.now') || {dataset: {}}).dataset.week, stat: [...document.querySelectorAll('.tr-stat span')].map(e => e.textContent).find(t => t.startsWith('Week of'))})")
    check("every batch is on the weekly sheet under the week it is sown, and a click makes that the planning week", wk["chips"] == wk["batches"] and now["date"] == wk["week"] and now["marked"] == wk["week"], {"wk": wk, "now": now})
    page.screenshot(path=str(shots / "t3-weeks.png"))
    page.screenshot(path=str(shots / "t4-trays-full.png"), full_page=False)

    # the seed list knows the tray crops; the other views still open
    for view in ("seeds", "assume", "timeline", "harvest", "map"):
        page.click(f'[data-view-btn="{view}"]')
        page.wait_for_timeout(500)
    check("the other views still open", js("S.view") == "map" and js("document.querySelectorAll('#mapBeds .bed').length") > 50)
    page.wait_for_timeout(1300)

    if scenario == "cloud":
        # leave one real change in place, then read the plan back out of the page database
        page.click('[data-view-btn="trays"]')
        page.wait_for_timeout(400)
        tab("live")
        typed(sel, first_row["summer"] + 1)
        page.wait_for_timeout(1800)
        cloud = page.evaluate("""(async () => { const deepEqual = (a, b) => { if (a === b) return true; if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false; if (Array.isArray(a) !== Array.isArray(b)) return false; const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k])); };
          const store = LRFStore.create(() => {}); await store.connect(); const again = await store.load();
          return { backend: store.backend, docs: window.__docs.size, largestDocBytes: window.__maxDoc, same: deepEqual(again, LRFApp.state.plan), plans: (again.liveTrayPlans || []).length, summer: again.liveTrayPlans[0].rows[0].summer }; })()""")
        check("the page database holds exactly the plan on screen, demand plan included", cloud["backend"] == "cloud" and cloud["same"] and cloud["plans"] == truth["plans"] and cloud["summer"] == first_row["summer"] + 1 and cloud["largestDocBytes"] < 256 * 1024, cloud)
    # a copy of the page built from a newer backup than the plan saved here says so, and switches on request
    if js("A.storage()") == "device":
        js("(() => { const p = JSON.parse(localStorage.getItem('lrf-next:plan')); p.lrfNext = {...p.lrfNext, backup: '2026-11-01T00:00:00.000Z'}; p.plantings = p.plantings.slice(0, p.plantings.length - 100); localStorage.setItem('lrf-next:plan', JSON.stringify(p)); return true; })()")
        page.reload()
        ready()
        older = js("({plantings: S.plan.plantings.length, notice: !!document.querySelector('.insp-section.newer'), text: (document.querySelector('.insp-section.newer .help') || {}).textContent})")
        page.screenshot(path=str(shots / "t5-newer-plan.png"))
        check("an older plan saved in this browser is opened, with a notice that a newer one came with the page", older["plantings"] == truth["plantings"] - 100 and older["notice"] and f"{truth['plantings']}" in older["text"], older)
        page.locator(".insp-section.newer .btn", has_text="Keep this one").click()
        page.wait_for_timeout(1500)
        page.reload()
        ready()
        check("'Keep this one' is remembered", not js("!!document.querySelector('.insp-section.newer')") and js("S.plan.plantings.length") == truth["plantings"] - 100)
        js("(() => { const p = JSON.parse(localStorage.getItem('lrf-next:plan')); delete p.lrfNext.passedOver; localStorage.setItem('lrf-next:plan', JSON.stringify(p)); return true; })()")
        page.reload()
        ready()
        page.locator(".insp-section.newer .btn.primary").click()
        page.wait_for_selector("dialog.dialog")
        page.locator("dialog.dialog .btn.danger").click()
        page.wait_for_timeout(1500)
        ready()
        switched = js("({plantings: S.plan.plantings.length, notice: !!document.querySelector('.insp-section.newer'), trays: (S.plan.liveTrayPlans || []).length, source: S.plan.lrfNext.source})")
        check("'Use the newer plan' replaces it after a confirmation", switched["plantings"] == truth["plantings"] and not switched["notice"] and switched["trays"] == truth["plans"], switched)
    browser.close()
if server:
    server.shutdown()
check("no errors in the console", not errors, errors[:8])
print(json.dumps({"scenario": scenario, "passed": len(results) - len(failed), "of": len(results), "failed": failed, "results": {k: v for k, v in results.items() if not v["ok"]}}, indent=1))
sys.exit(1 if failed else 0)
