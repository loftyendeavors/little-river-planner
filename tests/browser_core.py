"""The map and timeline as a grower uses them, in headless Chrome, on whatever plan the app ships with.

A shorter successor to browser_test.py: the same drags and drops, with every expected count read
from the plan itself, so it does not have to be rewritten each time a newer backup is loaded.
usage: python3 -I browser_core.py <app-dir-or-html-file> <shots-dir> [device|file]
"""
import functools
import http.server
import json
import sys
import threading
import time
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

    def js(expr):
        return page.evaluate(f"(() => {{ const A = LRFApp, S = A.state, E = LRFEngine, R = LRFRails, eng = S.engine; return {expr}; }})()")

    def center(selector):
        return js(f"(() => {{ const el = document.querySelector({json.dumps(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return {{x: r.left + r.width / 2, y: r.top + r.height / 2}}; }})()")

    def drag(a, b, alt=False, hold=None, steps=12):
        page.mouse.move(a["x"], a["y"])
        if alt:
            page.keyboard.down("Alt")
        page.mouse.down()
        page.mouse.move(a["x"] + 8, a["y"] + 8, steps=3)
        page.mouse.move(b["x"], b["y"], steps=steps)
        page.wait_for_timeout(90)
        seen = hold() if hold else None
        page.mouse.up()
        if alt:
            page.keyboard.up("Alt")
        page.wait_for_timeout(220)
        return seen

    def toast():
        return js("({text: document.querySelector('#toast span') ? document.querySelector('#toast span').textContent : '', action: document.querySelector('#toast .toast-action') ? document.querySelector('#toast .toast-action').textContent : null})")

    def tally():
        return js("(() => { let over = 0; const pairs = new Set(); for (const p of S.plan.plantings) { const r = eng.calc(p); if (!r) continue; if (eng.overflow(p, r)) over++; for (const o of eng.conflicts(p, r)) pairs.add([p.id, o.p ? o.p.id : 'rest'].sort().join('|')); } return {over, pairs: pairs.size, plantings: S.plan.plantings.length}; })()")

    hint = "({hint: document.querySelector('.drag-hint').textContent, state: document.querySelector('.drag-ghost').dataset.state})"
    t0 = time.time()
    page.goto(url)
    page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    opened = round(time.time() - t0, 1)
    page.wait_for_timeout(1500)
    first = js("({plantings: S.plan.plantings.length, places: S.plan.beds.filter(b => b.active !== false && (eng.gardenOf(b) || {}).active !== false && !eng.isPool(b)).length, pools: S.plan.beds.filter(b => eng.isPool(b)).length, bedEls: document.querySelectorAll('#mapBeds .bed').length, poolEls: S.plan.beds.filter(b => eng.isPool(b) && document.querySelector('#mapBeds [data-bed=\\\"' + b.id + '\\\"]')).length, photo: !!document.getElementById('mapPhoto').getAttribute('href'), settle: (document.querySelector('.cleanup h3') || {}).textContent, flags: document.querySelectorAll('.flag, .flags, .dot, .flag-hard').length, stats: [...document.querySelectorAll('.stats strong, .stats b')].map(e => e.textContent)})")
    check("opens on the farm's plan with its photo, every place drawn and the shared benches not drawn as a bed", first["plantings"] > 100 and first["bedEls"] == first["places"] and first["poolEls"] == 0 and first["photo"] and opened < 8, {**first, "seconds": opened})
    start, n0 = tally(), first["plantings"]
    check("no flags; what came in overlapping is one list, and live trays are not in it", first["flags"] == 0 and (start["over"] + start["pairs"] == 0 or first["settle"]) and js("LRFRails.cleanup(eng).groups.every(g => !eng.isPool(g.bed)) && LRFRails.cleanup(eng).long.every(x => !eng.isPool(x.r.b))"), {"settle": first["settle"], **start})
    page.screenshot(path=str(shots / "01-farm.png"))

    # settle what came in with the plan
    if page.locator(".fix-btn", has_text="Make them").count():
        page.locator(".fix-btn", has_text="Make them").first.click()
        page.wait_for_timeout(250)
    clicks = 0
    while page.locator(".cleanup .fix").count() and clicks < 60:
        page.locator(".cleanup .fix .fix-btn").first.click()
        page.wait_for_timeout(200)
        clicks += 1
    settled = tally()
    check("each overlap is settled with a click and the list goes away", settled["over"] == 0 and settled["pairs"] == 0 and page.locator(".cleanup").count() == 0 and settled["plantings"] == n0, {**settled, "clicks": clicks})
    base_undo = js("S.undo.length")

    # plant: drag a crop from the library onto an empty bed
    page.evaluate("LRFApp.setDate(new Date(LRFApp.planYear(), 5, 15)); LRFMap.fit()")
    page.wait_for_timeout(250)
    free = js("(() => { const b = S.plan.beds.find(b => eng.isSoilBed(b) && b.active !== false && eng.plantingsIn(b.id).length === 0); return {id: b.id, cap: eng.capOf(b)}; })()")
    free.update(center(f'#mapBeds [data-bed="{free["id"]}"] .bed-base'))
    lib = page.locator('.lib-row[data-crop="carrot"]').first.bounding_box()
    seen = drag({"x": lib["x"] + 60, "y": lib["y"] + 12}, free, hold=lambda: (page.screenshot(path=str(shots / "02-dragging.png")), js(hint))[1])
    planted = js("(() => { const p = S.plan.plantings[S.plan.plantings.length - 1]; return {bed: p.bedId, crop: p.cropId, date: p.date, id: p.id, n: S.plan.plantings.length}; })()")
    check("a crop dragged from the library is planted on the planning date", planted["n"] == n0 + 1 and planted["bed"] == free["id"] and planted["date"].endswith("-06-15") and seen["state"] == "ok", {"seen": seen, "planted": planted})

    # held ground refuses a drop
    busy = js("(() => { const b = S.plan.beds.find(b => eng.isSoilBed(b) && eng.bedStatus(b, S.date).free < 1 && eng.plantingsIn(b.id).every(p => !p.bedLayout)); return {id: b.id}; })()")
    busy.update(center(f'#mapBeds [data-bed="{busy["id"]}"] .bed-edge'))
    lib = page.locator('.lib-row[data-crop="beet"]').first.bounding_box()
    seen = drag({"x": lib["x"] + 60, "y": lib["y"] + 12}, busy, hold=lambda: js(hint))
    asked = js("!!document.getElementById('shareAsk')"); page.keyboard.press("Escape"); page.wait_for_timeout(200)
    check("held ground does not take a drop: it says who holds it, plants nothing, and asks whether to split the bed or replace what is there", js("S.plan.plantings.length") == n0 + 1 and seen["state"] in ("split", "blocked") and "Held by" in seen["hint"] and (asked or seen["state"] == "blocked") and not js("!!document.getElementById('shareAsk')"), {"seen": seen, "asked": asked})

    # move a planting to free ground; it keeps its date; undo puts it back
    mover = js(f"""(() => {{ for (const p of S.plan.plantings) {{ const r = eng.calc(p); if (!r || !eng.isSoilBed(r.b) || p.bedLayout || eng.standKey(p) || !(r.field <= S.date && S.date <= r.last) || p.id === {json.dumps(planted["id"])}) continue;
        const to = S.plan.beds.find(b => eng.isSoilBed(b) && b.id !== p.bedId && b.id !== {json.dumps(free["id"])} && R.propose(eng, {{plantingId: p.id}}, {{bedId: b.id, date: E.s2d(p.date)}}).state === 'ok');
        if (to) return {{id: p.id, from: p.bedId, to: to.id, date: p.date}}; }} return null; }})()""")
    a, b = center(f'#mapBeds [data-planting="{mover["id"]}"]'), center(f'#mapBeds [data-bed="{mover["to"]}"] .bed-base')
    seen = drag(a, b, hold=lambda: js(hint))
    moved = js(f"(() => {{ const p = eng.planting({json.dumps(mover['id'])}); return {{bed: p.bedId, date: p.date, clean: eng.conflicts(p).length === 0}}; }})()")
    check("a planting dragged across the map moves and keeps its date", moved["bed"] == mover["to"] and moved["date"] == mover["date"] and moved["clean"] and "Move here" in seen["hint"], {"seen": seen, "moved": moved})
    page.keyboard.press("Control+z")
    page.wait_for_timeout(150)
    check("undo puts it back", js(f"eng.planting({json.dumps(mover['id'])}).bedId") == mover["from"])

    # trade places
    pair = js("""(() => { for (const p of S.plan.plantings) { const r = eng.calc(p); if (!r || !eng.isSoilBed(r.b) || p.bedLayout || eng.standKey(p) || !(r.field <= S.date && S.date <= r.last)) continue;
        for (const b of S.plan.beds) { if (!eng.isSoilBed(b) || b.id === p.bedId) continue; const t = R.swap(eng, {plantingId: p.id}, {bedId: b.id, date: E.s2d(p.date)}); if (t && t.traded.length === 1 && eng.cropsAt(b.id, S.date).length) return {id: p.id, from: p.bedId, to: b.id, other: t.traded[0].id}; } } return null; })()""")
    if pair:
        a, b = center(f'#mapBeds [data-planting="{pair["id"]}"]'), center(f'#mapBeds [data-bed="{pair["to"]}"] .bed-edge')
        seen = drag(a, b, hold=lambda: js(hint))
        traded = js(f"({{mine: eng.planting({json.dumps(pair['id'])}).bedId, theirs: eng.planting({json.dumps(pair['other'])}).bedId}})")
        check("a planting dropped on held ground trades places with what holds it", traded["mine"] == pair["to"] and traded["theirs"] == pair["from"] and seen["state"] == "swap" and tally()["pairs"] == 0, {"seen": seen, "traded": traded})
        page.keyboard.press("Control+z")
        page.wait_for_timeout(150)
        check("one undo reverses the whole trade", js(f"eng.planting({json.dumps(pair['id'])}).bedId") == pair["from"])

    # Alt-drag copies
    count = js("S.plan.plantings.length")
    a, b = center(f'#mapBeds [data-planting="{mover["id"]}"]'), center(f'#mapBeds [data-bed="{mover["to"]}"] .bed-base')
    drag(a, b, alt=True)
    copied = js(f"({{n: S.plan.plantings.length, stays: eng.planting({json.dumps(mover['id'])}).bedId, last: S.plan.plantings[S.plan.plantings.length - 1].bedId}})")
    check("Alt-drag copies a planting", copied["n"] == count + 1 and copied["stays"] == mover["from"] and copied["last"] == mover["to"], copied)
    page.keyboard.press("Control+z")
    perf = js("(() => { const p = S.plan.plantings.find(p => { const r = eng.calc(p); return r && eng.isSoilBed(r.b) && r.field <= S.date && S.date <= r.last; }); const t = performance.now(); for (const b of S.plan.beds) A.preview({plantingId: p.id}, {bedId: b.id, date: E.s2d(p.date)}); return Math.round(performance.now() - t); })()")
    check("sizing up every space for a drag takes well under a second", perf < 600, {"ms": perf})

    # everything since the cleanup can be walked back
    for _ in range(40):
        if js("S.undo.length") <= base_undo:
            break
        page.keyboard.press("Control+z")
    page.wait_for_timeout(200)
    back = tally()
    check("undo walks back to the settled plan", back["plantings"] == n0 and back["pairs"] == 0 and back["over"] == 0, back)

    # timeline: the crowded kinds are summaries until opened; opened, every place has a row and every planting a bar
    page.evaluate("LRFMap.fit()")
    page.click('[data-view-btn="timeline"]')
    page.wait_for_timeout(500)
    shut = js("({banks: document.querySelectorAll('.tl-row.tl-bank').length, towerRows: [...document.querySelectorAll('.tl-row[data-bed]')].filter(r => eng.isTower(eng.bedOf(r.dataset.bed))).length, strips: document.querySelectorAll('.tl-row.tl-strip').length, cropRows: document.querySelectorAll('.tl-row.tl-pool:not(.tl-strip)').length, towerGardens: new Set(S.plan.beds.filter(b => b.active !== false && eng.isTower(b)).map(b => b.gardenId)).size, pools: S.plan.beds.filter(b => b.active !== false && eng.isPool(b)).length})")
    check("as it opens, the timeline shows each bank of towers as one row and live trays as one strip", shut["banks"] == shut["towerGardens"] and shut["towerRows"] == 0 and shut["strips"] == shut["pools"] and shut["cropRows"] == 0, shut)
    # open every summary: each bank, each crate crop, the trays
    for _ in range(60):
        if not js("(() => { const el = document.querySelector('.tl-group-name[aria-expanded=\"false\"], .tl-fold[aria-expanded=\"false\"]'); if (el) el.click(); return !!el; })()"):
            break
    page.wait_for_timeout(200)
    tl = js("({rows: new Set([...document.querySelectorAll('.tl-row[data-bed]:not(.tl-pool)')].map(r => r.dataset.bed)).size, poolRows: document.querySelectorAll('.tl-row.tl-pool:not(.tl-strip)').length, bars: document.querySelectorAll('.tl-bar[data-planting]').length, sums: document.querySelectorAll('.tl-bar.tl-sum').length, poolBars: document.querySelectorAll('.tl-pool .tl-bar').length, trayCrops: new Set(S.plan.plantings.filter(p => eng.isPool(eng.bedOf(p.bedId))).map(p => p.cropId)).size, trayBatches: S.plan.plantings.filter(p => eng.isPool(eng.bedOf(p.bedId))).length, shown: S.plan.beds.filter(b => b.active !== false && (eng.gardenOf(b) || {}).active !== false && !eng.isPool(b)).length})")
    check("opened, the timeline has a row for every place and one for each tray crop, with every planting on it", tl["rows"] == tl["shown"] and tl["poolRows"] == tl["trayCrops"] and tl["bars"] == n0 and tl["sums"] == 0 and tl["poolBars"] == tl["trayBatches"], tl)
    js("LRFTimeline.setScale(4)")
    page.wait_for_timeout(150)
    ppd = js("LRFTimeline.scale()")
    js(f"""document.querySelector('.tl-row[data-bed="{free['id']}"]').scrollIntoView({{block: 'center'}})""")
    page.wait_for_timeout(150)
    lane = js(f"""(() => {{ const row = document.querySelector('.tl-row[data-bed="{free['id']}"]'); const r = row.querySelector('.tl-lane').getBoundingClientRect(); const s = document.getElementById('tlScroll').getBoundingClientRect(); return {{left: r.left, y: r.top + r.height / 2, visibleLeft: Math.max(r.left, s.left + 150)}}; }})()""")
    lib = page.locator('.lib-row[data-crop="carrot"]').first.bounding_box()
    tx = lane["visibleLeft"] + 260
    drag({"x": lib["x"] + 60, "y": lib["y"] + 12}, {"x": tx, "y": lane["y"]})
    drop = js(f"(() => {{ const p = S.plan.plantings[S.plan.plantings.length - 1]; return {{added: S.plan.plantings.length - {n0}, bedOk: p.bedId === '{free['id']}', date: p.date, expected: E.d2s(E.addDays(new Date(A.planYear(), 0, 1), Math.floor(({tx} - {lane['left']}) / {ppd})))}}; }})()")
    check("a crop dropped on a timeline row is planted on the date under the pointer", drop["added"] == 1 and drop["bedOk"] and drop["date"] == drop["expected"], drop)
    bar = page.locator(f'.tl-row[data-bed="{free["id"]}"] .tl-bar').first.bounding_box()
    drag({"x": bar["x"] + 8, "y": bar["y"] + 8}, {"x": bar["x"] + 8 + 14 * ppd, "y": bar["y"] + 8}, steps=6)
    check("sliding its bar two weeks reschedules it", js("S.plan.plantings[S.plan.plantings.length - 1].date") == js(f"E.d2s(E.addDays(E.s2d('{drop['date']}'), 14))"))
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    if tl["poolBars"]:
        # a tray batch is not dragged: it follows weekly demand
        js("document.querySelector('.tl-row.tl-pool:not(.tl-strip)').scrollIntoView({block: 'center'})")
        page.wait_for_timeout(200)
        page.screenshot(path=str(shots / "03-timeline-trays.png"))
        pb = page.locator('.tl-pool .tl-bar').nth(3).bounding_box()
        pid = js("document.querySelectorAll('.tl-pool .tl-bar')[3].dataset.planting")
        was = js(f"eng.planting('{pid}').date")
        seen = drag({"x": pb["x"] + 4, "y": pb["y"] + 6}, {"x": pb["x"] + 60, "y": pb["y"] + 6}, hold=lambda: js(hint), steps=6)
        check("a tray batch dragged on the timeline stays put, and says where demand is changed", js(f"eng.planting('{pid}').date") == was and seen["state"] == "blocked" and "in the Nursery view" in seen["hint"], seen)
    page.wait_for_timeout(1300)
    final = js("({plantings: S.plan.plantings.length, save: document.getElementById('saveState').textContent, onDevice: (() => { try { return !!localStorage.getItem('lrf-next:plan'); } catch (_) { return false; } })()})")
    check("the plan is kept in this browser", final["onDevice"] and "Saved" in final["save"], final)
    page.reload()
    page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    page.wait_for_timeout(600)
    again = tally()
    check("after a reload the settled plan is still there", again["plantings"] == n0 and again["pairs"] == 0 and again["over"] == 0 and page.locator(".cleanup").count() == 0, again)
    browser.close()
if server:
    server.shutdown()
check("no errors in the console", not errors, errors[:8])
print(json.dumps({"scenario": scenario, "passed": len(results) - len(failed), "of": len(results), "failed": failed, "results": {k: v for k, v in results.items() if not v["ok"] or k.startswith("sizing") or k.startswith("opens")}}, indent=1))
sys.exit(1 if failed else 0)
