"""The card, part 1 (redesign build 5), in a real browser, behind its tick "Try the card".
Off (as the page opens with nothing kept): nothing of the card is drawn, the side panel holds a bed and a planting as before.
The tick is in the Map's "?", and the browser keeps it across a reload. On: on the Map and the Timeline the side panel leaves; a
bed or a planting picked opens one floating card; the bed's name in a planting's card is the way back; x closes. Every change made
through the card gives the planting the panel's own control gives it, for a date, a variety, a share of the bed and "Grown for sale",
and its Undo gives the plan back. A drop is answered on the card, not in a toast. The menu (the card's "..." and a right-click), the
calendar and the hint on a bar. What the card does not hold stands in the side panel. To place's two lines, in his words of Nov 17.
Every subject is found on the plan the page was given: nothing here names a crop, a bed, a garden or a number of any plan.
usage: python3 -I trycard_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1707, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1707")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, $ = id => document.getElementById(id), eng = S.engine;"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const card = () => hook('card'), shown = () => drawn(card()), panel = () => drawn(document.querySelector('.inspector'));"
       "const rec = id => JSON.stringify(S.plan.plantings.find(p => p.id === id) || null), all = () => JSON.stringify(S.plan.plantings);"
       "const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');")
def run_js(page, body, arg=None):
    return page.evaluate("(arg) => { %s %s }" % (PRE, body), arg)
def press(page, selector, ms=300, button="left"):
    """A thing a fault has taken away is not pressed: the named line after it fails, and the check goes on."""
    hit = page.locator(selector)
    if not hit.count() or not hit.first.is_visible(): return False
    hit.first.click(timeout=3000, button=button); page.wait_for_timeout(ms); return True

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = browser.new_context(viewport={"width": WIDTH, "height": 960}).new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    js = lambda body, arg=None: run_js(page, body, arg)
    wait = page.wait_for_timeout
    def open_page():
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
        if backup and page.evaluate("LRFApp.isSample()"):
            page.set_input_files("#importFile", backup); wait(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); wait(1500)
    open_page()
    page.evaluate("try { localStorage.removeItem('lrf.tryCard'); } catch (_) {}")
    open_page()

    # ── the subjects: a field bed with three plantings or more and an opening, a planting in it with a variety and another variety to swap to ──
    pick = js("""const S2 = LRFSuccession;
      for (const b of S.plan.beds) {
        if (!eng.isSoilBed(b) || b.active === false) continue;
        const list = eng.plantingsIn(b.id).filter(p => { const r = eng.calc(p); return r && !eng.isPool(r.b); });
        if (list.length < 3 || !S2.openings(eng, { bedId: b.id }).length) continue;
        const p = list.find(p => { const r = eng.calc(p), f = eng.footprint(p, r); return p.varietyId && !LRFForecast.useOf(eng, p).personal && eng.varietiesOf(p.cropId).length >= 2 && r.cap >= 8 && !r.layout && f && !(f.rows && f.rows.count < f.rows.total); });
        if (!p) continue;
        return { bed: b.id, bedName: String(b.bed), label: A.bedLabel(b), n: eng.plantingsIn(b.id).filter(q => eng.calc(q)).length, open: S2.openings(eng, { bedId: b.id }).length, p: p.id, crop: p.cropId, other: eng.varietiesOf(p.cropId).find(v => v.id !== p.varietyId).id, cap: eng.calc(p).cap, date: p.date, title: eng.calc(p).c.vname || eng.calc(p).c.name };
      } return null;""")
    check("the plan has a field bed with three plantings or more and an opening, and in it a planting whose variety can be changed, for the check to work on", bool(pick), pick)
    if not pick: finish()
    BED, PID = pick["bed"], pick["p"]

    # ══ off ══
    off = js(f"""A.setView('map'); A.select({{ type: 'bed', id: '{BED}' }}); await new Promise(r => setTimeout(r, 400));
      const bed = {{ card: !!card(), panel: panel(), dims: !!$('bedDims'), attr: document.body.dataset.card || null }};
      A.select({{ type: 'planting', id: '{PID}' }}); await new Promise(r => setTimeout(r, 400));
      const pl = {{ card: !!card(), panel: panel(), date: !!$('fDate') }};
      let kept = 'x'; try {{ kept = localStorage.getItem('lrf.tryCard'); }} catch (_) {{}}
      A.select(null); return {{ bed, pl, kept, on: LRFCard.on() }};""".replace("await new Promise(r => setTimeout(r, 400));", "") )
    check("off, as the page opens with nothing kept: a bed and a planting open in the side panel as before, and nothing of the card is drawn",
          off and not off["bed"]["card"] and off["bed"]["panel"] and off["bed"]["dims"] and not off["bed"]["attr"] and not off["pl"]["card"] and off["pl"]["panel"] and off["pl"]["date"] and off["kept"] is None and not off["on"], off)

    # ══ the tick, in the Map's "?" ══
    press(page, "#mapHelp", 400)
    tick = js("const t = hook('card-try'), c = $('mapHelpCard'); return { there: !!t && !!c && c.contains(t), checked: t ? t.checked : null, said: t ? t.closest('dd').previousElementSibling.textContent : '' };")
    check("the Map's “?” holds a tick, “Try the card”, not ticked", tick["there"] and tick["checked"] is False and tick["said"] == "Try the card", tick)
    press(page, "[data-hook='card-try']", 400)
    turned = js("let kept = null; try { kept = localStorage.getItem('lrf.tryCard'); } catch (_) {} return { kept, attr: document.body.dataset.card || null, panel: panel(), card: !!card() };")
    check("ticked: the browser keeps it, and with nothing picked there is no side panel and no card", turned["kept"] == "1" and turned["attr"] == "on" and not turned["panel"] and not turned["card"], turned)
    page.keyboard.press("Escape"); wait(200)
    open_page(); wait(300)
    again = js("return { on: LRFCard.on(), attr: document.body.dataset.card || null, panel: panel() };")
    check("the tick is still on after the page is opened again", again["on"] and again["attr"] == "on" and not again["panel"], again)

    # ══ the Map: a bed's card ══
    js(f"A.setView('map'); A.select(null); return null;"); wait(500)
    zoom0 = js("return LRFMap.zoom();")
    box = js(f"const el = document.querySelector('#map [data-bed=\"{BED}\"]'); if (!el) return null; const r = el.getBoundingClientRect(); return {{ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }};")
    if box: page.mouse.click(box["x"], box["y"]); wait(500)
    bed = js(f"""const c = card(); if (!c) return null; const r = c.getBoundingClientRect(), v = $('mapView').getBoundingClientRect(), t = document.querySelector('.map-tools').getBoundingClientRect(), use = LRFForecast.useOfBed(eng, eng.bedOf('{BED}'));
      return {{ kind: c.dataset.kind, title: hook('card-title').textContent, rows: hooks('card-planting').length, opens: hooks('card-opening').length, year: drawn(hook('card-year')), layout: drawn(hook('card-layout')), sale: hook('card-sale') ? hook('card-sale').checked : null, saleWant: !use.personal,
        panel: panel(), sel: S.sel && S.sel.id, w: Math.round(r.width), radius: getComputedStyle(c).borderTopLeftRadius, zoom: LRFMap.zoom(),
        ...(() => {{ const s = document.querySelector('.stage').getBoundingClientRect(), k = $('mapBar'), kr = k ? k.getBoundingClientRect() : null, b = document.querySelector('#map [data-bed="{BED}"]').getBoundingClientRect();
          return {{ top: Math.round(r.top - s.top), bottom: Math.round(s.bottom - r.bottom), right: Math.round(s.right - r.right), clear: Math.round(r.left - v.right), toolsClear: Math.round(r.left - t.right), keyClear: kr ? Math.round(r.left - kr.right) : null, bedSeen: b.left >= v.left && b.right <= v.right }}; }})() }};""")
    check("a click on a bed on the map opens its card in place of the side panel: the bed's name, Edit layout as a button, the bed's year, its plantings and its openings, Grown for sale as a tick",
          bool(bed) and bed["kind"] == "bed" and bed["title"].endswith(" " + pick["bedName"]) and bed["rows"] == pick["n"] and bed["opens"] == pick["open"] and bed["year"] and bed["layout"] and bed["sale"] == bed["saleWant"] and not bed["panel"] and bed["sel"] == BED, [bed, pick])
    check("the card is docked at the top right, never taller than the view, 384 wide, on a corner of 20, and the map, its tools and its key make room for it: nothing of them under it",
          bool(bed) and bed["w"] == min(384, WIDTH) and bed["radius"] == "20px" and 8 <= bed["right"] <= 16 and 8 <= bed["top"] <= 16 and bed["bottom"] >= 8 and bed["clear"] >= 0 and bed["toolsClear"] >= 0 and (bed["keyClear"] is None or bed["keyClear"] >= 0), bed)
    # what follows from the card in the page's own layout (on GitHub at 1280 the key wrapped on the narrower map) moves nothing either
    js("$('mapBar').style.paddingBottom = '40px'; return null;"); wait(400)
    zoom2 = js("const z = LRFMap.zoom(); $('mapBar').style.paddingBottom = ''; return z;"); wait(300)
    check("the card coming leaves the map's zoom as it was, and the bed clicked still in view; the map's height changing beside it (the key wrapping) leaves it too",
          bool(bed) and abs(bed["zoom"] - zoom0) < 1e-9 and bed["bedSeen"] and zoom2 is not None and abs(zoom2 - zoom0) < 1e-9, [bed, zoom0, zoom2])
    shade = js("const c = card(), t = document.createElement('div'); t.style.boxShadow = 'var(--shadow-card)'; document.body.append(t); const want = getComputedStyle(t).boxShadow; t.remove(); return { got: c ? getComputedStyle(c).boxShadow : null, want };")
    check("the docked card rests beside the view with a card's soft shadow, not a floating one's (Codex on #85)", shade["got"] == shade["want"], shade)
    # below 1200 wide the view would be left too narrow beside it: the card floats under the map's tools, and the map keeps its width
    page.set_viewport_size({"width": 1100, "height": 960}); wait(500)
    narrow = js("""const c = card(), s = document.querySelector('.stage'), v = $('mapView').getBoundingClientRect(), t = document.querySelector('.map-tools').getBoundingClientRect(), r = c ? c.getBoundingClientRect() : null;
      return { card: !!c, pad: getComputedStyle(s).paddingRight, over: r ? r.left < v.right && r.right <= v.right + 1 : null, under: r ? r.top >= t.bottom : null, mapW: Math.round(v.width) };""")
    check("below 1200 wide the card floats under the map's tools over the map, and the map keeps the stage's width (Codex on #85)", narrow["card"] and narrow["pad"] == "0px" and narrow["over"] and narrow["under"] and narrow["mapW"] > 700, narrow)
    # the bed dragged to the map's right edge while the card floats; then the window widened past 1200: docked, the card hides it not
    grab = js(f"""const v = $('mapView').getBoundingClientRect(), b = document.querySelector('#map [data-bed="{BED}"]').getBoundingClientRect(), c = card() ? card().getBoundingClientRect() : null;
      let p = null; for (let y = v.bottom - 140; y > v.top + 80 && !p; y -= 23) for (let x = v.left + 30; x < v.left + v.width / 2 && !p; x += 23) {{ const e = document.elementFromPoint(x, y);
        if (e && e.closest('#map') && !e.closest('#mapBeds > g') && !(c && x >= c.left && x <= c.right && y >= c.top && y <= c.bottom)) p = {{ x, y }}; }}
      return p && {{ x: Math.round(p.x), y: Math.round(p.y), dx: Math.round(v.right - 8 - b.right) }};""")
    def pan(g):
        """The map dragged by hand on empty ground, a move at a time as a hand moves it (a burst of moves can be taken as one)."""
        page.mouse.move(g["x"], g["y"]); page.mouse.down()
        for k in range(1, 15):
            page.mouse.move(g["x"] + g["dx"] * k / 14, g["y"]); wait(20)
        page.mouse.up(); wait(400)
    if grab:
        pan(grab)
    edge = js(f"const v = $('mapView').getBoundingClientRect(), b = document.querySelector('#map [data-bed=\"{BED}\"]').getBoundingClientRect(); return {{ gap: Math.round(v.right - b.right), sel: S.sel && S.sel.id }};")
    # widened to 1280 whatever the check's width: docked there, the map is narrower than it was at 1100, so the bed is at stake
    page.set_viewport_size({"width": 1280, "height": 960}); wait(900)
    redock = js(f"""const c = card(), v = $('mapView').getBoundingClientRect(), b = document.querySelector('#map [data-bed="{BED}"]').getBoundingClientRect(), r = c ? c.getBoundingClientRect() : null;
      return {{ card: !!c, sel: S.sel && S.sel.id, seen: b.left >= v.left - 1 && b.right <= v.right + 1, clear: r ? Math.round(r.left - v.right) : null }};""")
    check("a bed at the map's right edge while the card floats is moved clear when the window widens and the card docks (Codex on #85)",
          bool(grab) and 0 <= edge["gap"] <= 40 and edge["sel"] == BED and redock["card"] and redock["sel"] == BED and redock["seen"] and redock["clear"] is not None and redock["clear"] >= 0, [grab, edge, redock])
    # the same with a planting of that bed picked: docked by the wider window, the map is asked to move that planting's bed clear,
    # as it is for a bed picked (the moving itself is the line above) (Codex on #85, on 4cf52d7)
    page.set_viewport_size({"width": 1100, "height": 960}); wait(500)
    js(f"A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(500)
    js("window.__asked = []; const o = LRFMap.revealBed; window.__putBack = () => { LRFMap.revealBed = o; }; LRFMap.revealBed = function (id) { window.__asked.push(id); return o.apply(this, arguments); }; return null;")
    page.set_viewport_size({"width": 1280, "height": 960}); wait(900)
    asked = js("const a = window.__asked; window.__putBack(); return { asked: a, kind: card() && card().dataset.kind, sel: S.sel && S.sel.type + ':' + S.sel.id };")
    check("a planting picked while the card floats: widened to dock the card, the map is asked to move the planting's bed clear of it (Codex on #85)",
          asked["asked"] == [BED] and asked["kind"] == "planting" and asked["sel"] == "planting:" + PID, asked)
    # a length being typed in the card when the window narrows past 1200: the card is placed again, not drawn again, so the box keeps
    # what is typed and the keyboard, and gives it to the planting when it is left (Codex on #85, on 84db107)
    typed = js(f"const p = eng.planting('{PID}'), r = eng.calc(p); let n = Math.round(r.cap * 0.3); if (Math.abs(n - r.physicalLength) < 1) n = Math.round(r.cap * 0.7); return String(Math.max(1, n));")
    if not page.locator("[data-hook='card-length']").count(): press(page, "[data-hook='card-row'][data-row='share'] .card-row-head", 300)
    page.locator("[data-hook='card-length']").click(); page.keyboard.press("Control+A"); page.keyboard.type(typed); wait(150)
    was = js(f"window.__box = hook('card-length'); return rec('{PID}');")
    page.set_viewport_size({"width": 1100, "height": 960}); wait(500)
    mid = js(f"const b = window.__box; return {{ same: !!b && b.isConnected && b === hook('card-length'), focus: document.activeElement === b, value: b ? b.value : null, held: rec('{PID}') === arg }};", was)
    page.keyboard.press("Tab"); wait(500)
    left = js(f"return {{ moved: rec('{PID}') !== arg, box: hook('card-length') ? hook('card-length').value : null }};", was)
    js("A.undo(); return null;"); wait(400)
    check("a length typed in the card and not yet left is kept when the window narrows past 1200 and the card floats: the same box, with the keyboard, and given to the planting when it is left (Codex on #85)",
          mid["same"] and mid["focus"] and mid["value"] == typed and mid["held"] and left["moved"] and left["box"] == typed, [typed, mid, left])
    # a bench, a tower or containers clicked at the map's right edge with no card open: the docked card comes and the map, the card's
    # width narrower, moves that space clear, as it does a bed (Codex on #85, on 84db107)
    page.set_viewport_size({"width": 1280, "height": 960}); js("A.select(null); return null;"); wait(600)
    sp = js("""const v = $('mapView').getBoundingClientRect(), tools = document.querySelector('.map-tools').getBoundingClientRect();
      const list = S.plan.beds.filter(b => b.active !== false && !eng.isSoilBed(b) && !eng.isPool(b)).map(b => ({ id: b.id, el: document.querySelector(`#map [data-bed="${b.id}"] .bed-base`) })).filter(x => x.el)
        .map(x => { const r = x.el.getBoundingClientRect(); return { id: x.id, kind: eng.spaceKind(eng.bedOf(x.id)), w: r.width, h: r.height, right: r.right, cy: r.top + r.height / 2 }; })
        .filter(x => x.w >= 12 && x.h >= 12 && x.w < v.width / 3).sort((a, b) => b.w - a.w);
      const s = list[0]; if (!s) return null;
      let g = null; for (let y = v.bottom - 140; y > v.top + 80 && !g; y -= 23) for (let x = v.left + 30; x < v.left + v.width / 2 && !g; x += 23) { const e = document.elementFromPoint(x, y); if (e && e.closest('#map') && !e.closest('#mapBeds > g')) g = { x, y }; }
      const ty = Math.min(Math.max(s.cy, tools.bottom + 80), v.bottom - 140);
      return g && { id: s.id, kind: s.kind, x: Math.round(g.x), y: Math.round(g.y), dx: Math.round(v.right - 8 - s.right), dy: Math.round(ty - s.cy) };""")
    def pan2(g):
        page.mouse.move(g["x"], g["y"]); page.mouse.down()
        for k in range(1, 15):
            page.mouse.move(g["x"] + g["dx"] * k / 14, g["y"] + g["dy"] * k / 14); wait(20)
        page.mouse.up(); wait(400)
    spot = None
    if sp:
        pan2(sp)
        spot = js(f"""const el = document.querySelector('#map [data-bed="{sp['id']}"] .bed-base'), r = el.getBoundingClientRect(), v = $('mapView').getBoundingClientRect();
          const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2), at = document.elementFromPoint(x, y);
          return {{ x, y, hit: !!at && at.closest('[data-bed]')?.dataset.bed === '{sp['id']}', gap: Math.round(v.right - r.right), card: !!card() }};""")
    if spot and spot["hit"]:
        js("window.__asked = []; const o = LRFMap.revealBed; window.__putBack = () => { LRFMap.revealBed = o; }; LRFMap.revealBed = function (id) { window.__asked.push(id); return o.apply(this, arguments); }; return null;")
        page.mouse.click(spot["x"], spot["y"]); wait(900)
    bench = js(f"""const a = window.__asked || []; if (window.__putBack) window.__putBack(); const c = card(), v = $('mapView').getBoundingClientRect(), el = document.querySelector('#map [data-bed="{sp['id'] if sp else ''}"] .bed-base'), r = el ? el.getBoundingClientRect() : null, sel = S.sel, p = sel && sel.type === 'planting' ? eng.planting(sel.id) : null;
      return {{ asked: a, card: !!c, of: sel ? (sel.type === 'bed' ? sel.id : p && p.bedId) : null, seen: !!r && r.left >= v.left - 1 && r.right <= v.right + 1, clear: c ? Math.round(c.getBoundingClientRect().left - v.right) : null }};""")
    check("a bench, a tower or containers clicked at the map's right edge with no card open: the docked card comes, and the map moves that space clear of it (Codex on #85)",
          bool(sp) and bool(spot) and spot["hit"] and 0 <= spot["gap"] <= 40 and not spot["card"] and bench["card"] and bench["of"] == sp["id"] and bench["asked"] == [sp["id"]] and bench["seen"] and bench["clear"] is not None and bench["clear"] >= 0, [sp, spot, bench])
    # a planting picked on the Timeline, its bed at the map's right edge as the map was left with no card: back on the Map with the card
    # docked, the map, the card's width narrower, moves that bed clear (Codex on #85, on 98154ee)
    js("A.select(null); return null;"); wait(600)
    bk = js(f"""const v = $('mapView').getBoundingClientRect(), b = document.querySelector('#map [data-bed="{BED}"] .bed-base').getBoundingClientRect();
      let g = null; for (let y = v.bottom - 140; y > v.top + 80 && !g; y -= 23) for (let x = v.left + 30; x < v.left + v.width / 2 && !g; x += 23) {{ const e = document.elementFromPoint(x, y); if (e && e.closest('#map') && !e.closest('#mapBeds > g')) g = {{ x, y }}; }}
      return g && {{ x: Math.round(g.x), y: Math.round(g.y), dx: Math.round(v.right - 8 - b.right), dy: 0 }};""")
    if bk: pan2(bk)
    left_at = js(f"const v = $('mapView').getBoundingClientRect(), b = document.querySelector('#map [data-bed=\"{BED}\"] .bed-base').getBoundingClientRect(); return {{ gap: Math.round(v.right - b.right), card: !!card() }};")
    js(f"A.setView('timeline'); A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(600)
    on_tl = js("return { kind: card() && card().dataset.kind, docked: LRFCard.docked() };")
    js("window.__asked = []; const o = LRFMap.revealBed; window.__putBack = () => { LRFMap.revealBed = o; }; LRFMap.revealBed = function (id) { window.__asked.push(id); return o.apply(this, arguments); }; return null;")
    js("A.setView('map'); return null;"); wait(900)
    back_map = js(f"""const a = window.__asked; window.__putBack(); const c = card(), v = $('mapView').getBoundingClientRect(), b = document.querySelector('#map [data-bed="{BED}"] .bed-base').getBoundingClientRect();
      return {{ asked: a, kind: c && c.dataset.kind, seen: b.left >= v.left - 1 && b.right <= v.right + 1, clear: c ? Math.round(c.getBoundingClientRect().left - v.right) : null }};""")
    check("a planting picked on the Timeline, its bed at the map's right edge: back on the Map with the card docked, the map moves that bed clear of it (Codex on #85)",
          bool(bk) and 0 <= left_at["gap"] <= 40 and not left_at["card"] and on_tl["kind"] == "planting" and on_tl["docked"] and back_map["asked"] == [BED] and back_map["kind"] == "planting" and back_map["seen"] and back_map["clear"] is not None and back_map["clear"] >= 0, [bk, left_at, on_tl, back_map])
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(300)
    page.set_viewport_size({"width": WIDTH, "height": 960}); wait(500)
    page.screenshot(path=str(shots / f"map-bed-{WIDTH}.png"))

    # a planting picked directly (for example from a Timeline bar), the bed's name back, x to close.
    # Bed season rows have their own disclosure and full-record route, covered in bed_season_check.py.
    js(f"A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(400)
    pl = js(f"""const c = card(), p = S.plan.plantings.find(x => x.id === '{PID}'); if (!c) return null;
      return {{ kind: c.dataset.kind, title: hook('card-title').textContent, bed: hook('card-bed') ? hook('card-bed').textContent : '', date: hook('card-date') ? hook('card-date').textContent : '', want: LRFUI.day(E.s2d(p.date)), variety: hook('card-variety') ? hook('card-variety').value : null, bar: drawn(hook('card-bar')), sums: hook('card-sums') ? hook('card-sums').textContent : '', rows: hooks('card-row').map(x => x.dataset.row), panel: panel() }};""")
    check("a planting selected directly opens the planting's card: its name, the bed's name, its life as a bar, what it comes to, its date and variety, its rows",
          bool(pl) and pl["kind"] == "planting" and pl["title"] == pick["title"] and pl["bed"] == pick["label"] and pl["date"] == pl["want"] and pl["variety"] and pl["bar"] and len(pl["sums"]) > 4 and pl["rows"] == ["share", "days", "nursery"] + (["succession"] if js(f"const p = S.plan.plantings.find(x => x.id === '{PID}'); return LRFSuccessions.plans(eng, eng.crop(p.cropId)) && eng.spaceKind(eng.bedOf(p.bedId)) === 'bed';") else []) and not pl["panel"], pl)
    page.screenshot(path=str(shots / f"map-planting-{WIDTH}.png"))
    press(page, "[data-hook='card-bed']", 400)
    back = js("return { kind: card() && card().dataset.kind, sel: S.sel && S.sel.type + ':' + S.sel.id };")
    check("the bed's name in a planting's card goes back to the bed's card", back["kind"] == "bed" and back["sel"] == "bed:" + BED, back)
    press(page, "[data-hook='card-close']", 400)
    closed = js("return { card: !!card(), sel: S.sel, panel: panel() };")
    check("× closes the card, and with nothing picked there is no side panel", not closed["card"] and closed["sel"] is None and not closed["panel"], closed)

    # ══ the Timeline: a bar, a row ══
    js("A.setView('timeline'); A.select(null); return null;"); wait(800)
    js("for (let k = 0; k < 60; k++) { const b = document.querySelector('#tlBody .tl-group-name[aria-expanded=\"false\"]'); if (!b) break; b.click(); } return null;"); wait(300)
    tb = js("""const v = $('timelineView').getBoundingClientRect(); const bar = [...document.querySelectorAll('#tlBody .tl-bar[data-planting]')].find(b => { const r = b.getBoundingClientRect(); const p = eng.planting(b.dataset.planting), x = p && eng.calc(p); return x && !eng.isPool(x.b) && r.width > 40 && r.top > v.top + 140 && r.bottom < v.bottom - 260 && r.right < v.right - 420; });
      if (!bar) return null; const r = bar.getBoundingClientRect(); return { id: bar.dataset.planting, x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + r.height / 2), bed: eng.planting(bar.dataset.planting).bedId };""")
    check("the Timeline has a bar clear of where the card stands, for the check to click", bool(tb), tb)
    if tb:
        page.mouse.click(tb["x"], tb["y"]); wait(500)
        t1 = js("const c = card(), s = document.querySelector('.stage').getBoundingClientRect(), r = c ? c.getBoundingClientRect() : null, v = $('timelineView').getBoundingClientRect(), m = document.querySelector('.tl-months'); return { kind: c && c.dataset.kind, sel: S.sel && S.sel.id, panel: panel(), top: r ? Math.round(r.top - s.top) : null, clear: r ? Math.round(r.left - v.right) : null, monthsClear: r && m ? Math.round(r.left - m.getBoundingClientRect().right) : null };")
        check("on the Timeline a click on a bar opens the planting's card in place of the side panel, docked where it stands on the Map, and the Timeline and its months make room for it",
              t1["kind"] == "planting" and t1["sel"] == tb["id"] and not t1["panel"] and t1["top"] is not None and 8 <= t1["top"] <= 16 and t1["clear"] is not None and t1["clear"] >= 0 and (t1["monthsClear"] is None or t1["monthsClear"] >= 0), t1)
        page.screenshot(path=str(shots / f"timeline-planting-{WIDTH}.png"))
        press(page, "[data-hook='card-bed']", 400)
        t2 = js("return { kind: card() && card().dataset.kind, sel: S.sel && S.sel.type + ':' + S.sel.id };")
        check("on the Timeline the bed's name goes back to the bed's card", t2["kind"] == "bed" and t2["sel"] == "bed:" + tb["bed"], t2)
        press(page, "[data-hook='card-close']", 300)
        # the hint on a bar, in place of its hover text
        page.mouse.move(tb["x"], tb["y"]); wait(800)
        hn = js(f"const h = hook('card-hint'), b = document.querySelector('#tlBody .tl-bar[data-planting=\"{tb['id']}\"]'), p = eng.planting('{tb['id']}'), r = eng.calc(p); return {{ hint: drawn(h), text: h ? h.textContent : '', crop: r.c.name, title: b ? b.getAttribute('title') : 'gone', field: LRFUI.day(r.field) }};")
        check("held over a bar, a hint card says what it is (its crop, its days, how to open it), and the bar's own hover text is held back", hn["hint"] and hn["crop"] in hn["text"] and hn["field"] in hn["text"] and "right-click for more" in hn["text"] and hn["title"] is None, hn)
        page.mouse.move(5, 300); wait(300)
        hn2 = js(f"const b = document.querySelector('#tlBody .tl-bar[data-planting=\"{tb['id']}\"]'); return {{ hint: !!hook('card-hint'), title: b ? b.getAttribute('title') : null }};")
        check("the pointer gone, the hint goes and the bar's hover text is back", not hn2["hint"] and bool(hn2["title"]), hn2)
        # the right-click menu
        page.mouse.click(tb["x"], tb["y"], button="right"); wait(400)
        mn = js("const m = hook('card-menu'); return { menu: drawn(m), acts: hooks('card-menu-item').map(x => x.dataset.act), sel: S.sel && S.sel.id, card: card() && card().dataset.kind };")
        check("a right-click on a bar opens the card's menu where the pointer is: Open, Change the date…, Planting details…, Send to To place, Remove planting; the planting is picked",
              mn["menu"] and all(a in mn["acts"] for a in ["open", "date", "full", "wait", "remove"]) and mn["sel"] == tb["id"] and mn["card"] == "planting", mn)
        page.screenshot(path=str(shots / f"timeline-menu-{WIDTH}.png"))
        press(page, "[data-hook='card-menu-item'][data-act='date']", 400)
        cl = js("return { menu: !!hook('card-menu'), cal: drawn(hook('card-cal')), days: hooks('card-cal-day').length };")
        check("“Change the date…” in the menu opens the calendar", not cl["menu"] and cl["cal"] and cl["days"] >= 28, cl)
        page.keyboard.press("Escape"); wait(200)
        check("Escape closes the calendar", not js("return !!hook('card-cal');"))
    js("A.setView('map'); A.select(null); return null;"); wait(500)

    # ══ the same result as the side panel, and Undo, for a date, a variety, a share of the bed and Grown for sale ══
    def set_value(selector, value):
        """A box given a value and left, once: one change, as a hand makes it."""
        page.evaluate("([s, v]) => { const el = document.querySelector(s); if (!el) return; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }", [selector, value])
    def quiet():
        page.evaluate("document.getElementById('toast').classList.remove('show')")
    def through_panel(do, read=None, pid=None):
        js("LRFCard.turn(false); return null;"); js(f"A.select({{ type: 'planting', id: '{pid or PID}' }}); return null;"); wait(400)
        before = js("return all();")
        do(); wait(500)
        after = read(before) if read else js(f"return rec('{PID}');")
        js("A.undo(); return null;"); wait(400)
        back = js("return all();") == before
        return after, back, before
    def through_card(do, read=None, undo_link=True, pid=None):
        js("LRFCard.turn(true); return null;"); js(f"A.select({{ type: 'planting', id: '{pid or PID}' }}); return null;"); wait(400)
        before = js("return all();")
        quiet(); do(); wait(500)
        after = read(before) if read else js(f"return rec('{PID}');")
        said = js("const s = hook('card-said'); return { said: drawn(s) ? s.textContent : '', undo: drawn(hook('card-undo')), toast: $('toast').classList.contains('show') };")
        if undo_link and said["undo"]: press(page, "[data-hook='card-undo']", 500)
        else: js("A.undo(); return null;"); wait(400)
        back = js("return all();") == before
        return after, back, said, before
    target_day = js(f"const d = E.addDays(E.s2d('{pick['date']}'), 5); return iso(d);")
    def panel_date():
        set_value("#fDate", target_day)
    def card_date():
        press(page, "[data-hook='card-date']", 300)
        if not page.locator(f"[data-hook='card-cal-day'][data-day='{target_day}']").count(): press(page, ".card-cal-month .icon-btn >> nth=1", 200)
        hit = page.locator(f"[data-hook='card-cal-day'][data-day='{target_day}']")
        if hit.count():
            hit.first.hover(); wait(200)
            says = js("const s = hook('card-cal-says'); return s ? s.textContent : '';")
            check("pointed at, a day of the calendar says what it would move before it is picked: the day, how far, the first pick and the ground free", "5 days later" in says and "first pick" in says and "ground free" in says, says)
            hit.first.click(); wait(300)
    a, aback, _ = through_panel(panel_date)
    b, bback, bsaid, _ = through_card(card_date)
    check("a date picked on the card's calendar gives the planting what the panel's date box gives it", a == b and a != js(f"return rec('{PID}');") and target_day in (b or ""), [a, b])
    check("the card's change of date is answered on the card, “Saved” with Undo, and not in a toast as well", "Saved" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], bsaid)
    check("Undo on the card after its change of date gives the plan back as it was (and so does the panel's)", aback and bback, [aback, bback])

    def panel_variety(): page.select_option("#fVariety", pick["other"])
    def card_variety(): page.select_option("[data-hook='card-variety']", pick["other"])
    a, aback, _ = through_panel(panel_variety)
    b, bback, bsaid, _ = through_card(card_variety)
    check("a variety chosen on the card gives the planting what the panel's variety box gives it, said on the card with an Undo that gives the plan back", a == b and pick["other"] in (b or "") and aback and bback and bsaid["undo"] and not bsaid["toast"], [a, b, aback, bback, bsaid])

    half = js(f"const p = eng.planting('{PID}'), r = eng.calc(p); let n = Math.round(r.cap * 0.4); if (Math.abs(n - r.physicalLength) < 1) n = Math.round(r.cap * 0.6); return n;")
    def panel_length(): set_value("#fLength", str(half))
    def card_length():
        if not page.locator("[data-hook='card-length']").count(): press(page, "[data-hook='card-row'][data-row='share'] .card-row-head", 300)
        set_value("[data-hook='card-length']", str(half))
    a, aback, _ = through_panel(panel_length)
    b, bback, bsaid, _ = through_card(card_length)
    check("a share of the bed typed in the card's row gives the planting what the panel's length box gives it, said on the card with an Undo that gives the plan back", a == b and a != js(f"return rec('{PID}');") and aback and bback and bsaid["undo"] and not bsaid["toast"], [a, b, aback, bback, bsaid])

    def panel_sale(): press(page, "#fUse button[data-use='personal']", 300)
    def card_sale(): page.locator("[data-hook='card-sale']").uncheck(); wait(200)
    a, aback, _ = through_panel(panel_sale)
    b, bback, bsaid, _ = through_card(card_sale)
    check("“Grown for sale” unticked on the card gives the planting what the panel's “Personal use” gives it, and Undo gives the plan back", a == b and '"use":"personal"' in (b or "") and aback and bback, [a, b, aback, bback])
    check("its answer, with what it does to the season's worth, is said on the card with Undo, and not in a toast as well", "season’s worth" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], bsaid)

    def card_row(name):
        if not page.locator(f"[data-hook='card-row'][data-row='{name}'].open").count(): press(page, f"[data-hook='card-row'][data-row='{name}'] .card-row-head", 300)
    days = js(f"const p = eng.planting('{PID}'), r = eng.calc(p); return {{ dtm: String(Math.max(1, (p.dtm > 0 ? +p.dtm : +r.c.dtm) - 5)), hw: String((p.hw > 0 ? +p.hw : r.harvestDays) + 5) }};")
    a, aback, _ = through_panel(lambda: set_value("#fDtm", days["dtm"]))
    b, bback, bsaid, _ = through_card(lambda: (card_row("days"), set_value("[data-hook='card-dtm']", days["dtm"])))
    check("days to harvest typed in the card's row give the planting what the panel's box gives it, said on the card with an Undo that gives the plan back", a == b and f'"dtm":{days["dtm"]}' in (b or "") and aback and bback and bsaid["undo"] and not bsaid["toast"], [a, b, aback, bback, bsaid])
    a, aback, _ = through_panel(lambda: set_value("#fHw", days["hw"]))
    b, bback, bsaid, _ = through_card(lambda: (card_row("days"), set_value("[data-hook='card-hw']", days["hw"])))
    check("harvest days typed in the card's row give the planting what the panel's box gives it, said on the card with an Undo that gives the plan back", a == b and f'"hw":{days["hw"]}' in (b or "") and aback and bback and bsaid["undo"] and not bsaid["toast"], [a, b, aback, bback, bsaid])

    # a succession of it: the card's row and the panel's button open the Successions page on the same run (0.84: where "Repeat as a series" added plantings)
    opened = lambda: js("const D = LRFSuccessions.state.D; return JSON.stringify({ view: S.view, crop: D.cropId, variety: D.varietyId, garden: D.gardenId, by: D.by, dates: D.datesFor, from: D.from, to: D.to, every: D.every, n: S.plan.plantings.length });")
    js("LRFCard.turn(false); return null;"); js(f"A.setView('map'); A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(500)
    press(page, "[data-hook='panel-succession']", 1500); a = opened()
    js("LRFCard.turn(true); return null;"); js(f"A.setView('map'); A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(500)
    card_row("succession"); press(page, "[data-hook='card-succession']", 1500); b = opened()
    js("A.setView('map'); return null;"); wait(400)
    check("“Plan a succession of this…” in the card's row opens the Successions page on the run the panel's own button opens it on, and adds nothing", a == b and '"view":"succession"' in (a or "") and json.loads(a or "{}").get("n") == js("return S.plan.plantings.length;"), [a, b])

    # the menu's Send to To place and Remove planting, against the panel's buttons
    whole = lambda before: js("return JSON.stringify([S.plan.plantings, A.waiting()]);")
    def card_menu(act):
        press(page, "[data-hook='card-more']", 300); press(page, f"[data-hook='card-menu-item'][data-act='{act}']", 400)
    def panel_menu(act):   # L3: the panel keeps them in "⋯" at its head, as the card does
        press(page, "[data-hook='panel-more']", 300); press(page, f"[data-hook='card-menu-item'][data-act='{act}']", 400)
    a, aback, _ = through_panel(lambda: panel_menu("wait"), whole)
    b, bback, bsaid, _ = through_card(lambda: card_menu("wait"), whole)
    check("“Send to To place” in the card's menu does what the panel's button does; the bed's card says it, with an Undo that gives the plan back",
          a == b and PID in json.dumps(json.loads(a)[1]) and aback and bback and "To place" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], [a[:300] if a else a, b[:300] if b else b, aback, bback, bsaid])
    a, aback, _ = through_panel(lambda: panel_menu("remove"), whole)
    b, bback, bsaid, _ = through_card(lambda: card_menu("remove"), whole)
    check("“Remove planting” in the card's menu does what the panel's button does; the bed's card says it, with an Undo that gives the plan back",
          a == b and f'"id":"{PID}"' not in a and aback and bback and "Removed" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], [aback, bback, bsaid])

    # a sowing day set by hand: the calendar says what the step will do, which lets that day go and works the sowing out again
    js(f"LRFCard.turn(true); A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(300)
    own = js(f"const p = eng.planting('{PID}'), r = eng.calc(p); if (!r.sow || !(r.sow < r.field)) return null; const d = iso(E.addDays(r.sowDefault || r.sow, -3)); A.planSowings(['{PID}'], d); const q = eng.planting('{PID}'); return {{ set: !!S.engine.planting('{PID}').sowOn, sow: LRFUI.day(S.engine.calc(S.engine.planting('{PID}')).sow) }};")
    check("the planting can carry a sowing day set by hand, for the check to work on", bool(own) and own["set"], own)
    if own and own["set"]:
        quiet(); press(page, "[data-hook='card-date']", 300)
        if not page.locator(f"[data-hook='card-cal-day'][data-day='{target_day}']").count(): press(page, ".card-cal-month .icon-btn >> nth=1", 200)
        hit = page.locator(f"[data-hook='card-cal-day'][data-day='{target_day}']")
        says = ""
        if hit.count(): hit.first.hover(); wait(200); says = js("const s = hook('card-cal-says'); return s ? s.textContent : '';"); hit.first.click(); wait(400)
        got = js(f"const p = S.engine.planting('{PID}'), r = S.engine.calc(p); return {{ sow: LRFUI.day(r.sow), own: !!p.sowOn, date: p.date }};")
        check("with a sowing day set by hand, the calendar says the sowing day the move will give (that day goes, as the step lets it go)", got["date"] == target_day and not got["own"] and ("→ " + got["sow"]) in says and "sow " in says, [own, got, says])
        js("A.undo(); A.undo(); return null;"); wait(300)

    # the bed's card: Grown for sale, against Edit layout's own box for the bed
    bedrec = lambda before: js(f"return JSON.stringify([S.plan.beds.find(b => b.id === '{BED}'), S.plan.plantings]);")
    def bed_through(card_on, do):
        js(f"LRFCard.turn({'true' if card_on else 'false'}); A.setView('map'); A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
        before = js("return all() + JSON.stringify(S.plan.beds);"); quiet(); do(); wait(500)
        after = bedrec(None)
        said = js("const s = hook('card-said'); return { said: drawn(s) ? s.textContent : '', undo: drawn(hook('card-undo')), toast: $('toast').classList.contains('show') };")
        if card_on and said["undo"]: press(page, "[data-hook='card-undo']", 500)
        else: js("A.undo(); return null;"); wait(400)
        return after, js("return all() + JSON.stringify(S.plan.beds);") == before, said
    def layout_box():
        js(f"LRFMapEdit.open({{ bedId: '{BED}', field: 'leUse' }}); return null;"); wait(400)
        if page.locator("#leUse").count(): page.select_option("#leUse", "personal"); wait(300)
        press(page, "#leDone", 400)
    a, aback, _ = bed_through(False, layout_box)
    b, bback, bsaid = bed_through(True, lambda: page.locator("[data-hook='card-sale']").uncheck())
    check("“Grown for sale” unticked on a bed's card gives the bed what Edit layout's “Grown for” box gives it; said on the card with an Undo that gives the plan back",
          a == b and '"use":"personal"' in (b or "") and aback and bback and "personal use" in bsaid["said"] and bsaid["undo"] and not bsaid["toast"], [a[:200] if a else a, b[:200] if b else b, aback, bback, bsaid])

    # a word from elsewhere (a newer version ready) stays a toast while a card is open
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(300); quiet()
    js("LRFUI.toast('A newer version of the planner is ready.', { label: 'Reload', run: () => {} }); return null;"); wait(200)
    al = js("const s = hook('card-said'); return { card: !!card(), said: drawn(s) ? s.textContent : '', toast: $('toast').classList.contains('show') ? $('toast').textContent : '' };")
    check("with a card open, a word that is not the answer to something done on it (a newer version ready) stays in the toast, with its button", al["card"] and "newer version" not in al["said"] and "newer version" in al["toast"] and "Reload" in al["toast"], al)
    quiet()

    # one that cannot be sent to To place keeps its card, which says why
    FX = js("return (S.plan.plantings.find(p => { const r = eng.calc(p); return r && !eng.isPool(r.b) && LRFRails.fixed(eng, { p }); }) || {}).id || null;")
    check("the plan has a planting that cannot be sent to To place (recorded, or standing for years), for the check to work on", bool(FX), FX)
    if FX:
        js(f"LRFCard.turn(true); A.select({{ type: 'planting', id: '{FX}' }}); return null;"); wait(400); quiet()
        before = js("return all();")
        press(page, "[data-hook='card-more']", 300); press(page, "[data-hook='card-menu-item'][data-act='wait']", 400)
        fx = js(f"const s = hook('card-said'); return {{ same: all() === arg, sel: S.sel && S.sel.type + ':' + S.sel.id, kind: card() && card().dataset.kind, said: drawn(s) ? s.textContent : '', toast: $('toast').classList.contains('show') }};", before)
        check("“Send to To place” on one that cannot go changes nothing, keeps its card, and says why there", fx["same"] and fx["sel"] == "planting:" + FX and fx["kind"] == "planting" and "stays where it is" in fx["said"] and not fx["toast"], fx)

    # a change made in the side panel is not said on the next card opened
    js(f"LRFCard.turn(true); A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(300)
    press(page, "[data-hook='card-full']", 400)
    set_value("#fDtm", days["dtm"]); wait(300)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
    stale = js("const s = hook('card-said'); return { card: !!card(), said: drawn(s) ? s.textContent : '' };")
    check("a change made in the side panel (“Planting details”) is not said, with its Undo, on the bed's card opened after it", stale["card"] and stale["said"] == "", stale)
    js("A.undo(); A.select(null); return null;"); wait(300)

    # ══ a drop: answered on the card ══
    js("LRFCard.turn(true); A.setView('map'); A.select(null); return null;"); wait(400); quiet()
    drop = js("""const before = all(), date = S.date; let bed = null, crop = null;
      const c = S.plan.plantings.map(p => eng.crop(p.cropId)).find(c => c && eng.varietiesOf(c.id).length >= 2 && +c.dtm > 0 && !c.micro);
      if (!c) return null; let p = null;
      for (const b of S.plan.beds) { if (b.active === false || !eng.isSoilBed(b) || eng.plantingsIn(b.id).length) continue; p = A.place({ cropId: c.id }, b.id, date); if (p) { bed = b; break; } }
      if (!p) return { placed: false };
      return { placed: true, id: p.id, before, crop: c.name };""")
    wait(400)
    if drop and drop.get("placed"):
        dr = js(f"const s = hook('card-said'), v = hook('card-variety'); return {{ kind: card() && card().dataset.kind, sel: S.sel && S.sel.id, said: drawn(s) ? s.textContent : '', undo: drawn(hook('card-undo')), toast: $('toast').classList.contains('show'), ask: !!v && v.classList.contains('ask') && !v.value }};")
        check("a crop dropped on a bed opens its planting's card, which says what was planted with Undo; no toast; the variety box is ringed when no variety came with it",
              dr["kind"] == "planting" and dr["sel"] == drop["id"] and drop["crop"] in dr["said"] and dr["undo"] and not dr["toast"] and dr["ask"], dr)
        page.screenshot(path=str(shots / f"map-drop-{WIDTH}.png"))
        press(page, "[data-hook='card-undo']", 500)
        un = js(f"return {{ same: all() === {json.dumps(drop['before'])}, sel: S.sel, card: !!card() }};")
        check("Undo on the card takes the drop back: the plan is as it was, and the card closes", un["same"] and un["sel"] is None and not un["card"], un)
    else:
        check("a crop dropped on a bed opens its planting's card, which says what was planted with Undo; no toast; the variety box is ringed when no variety came with it", False, drop)
        check("Undo on the card takes the drop back: the plan is as it was, and the card closes", False, drop)

    # ══ what the card does not hold stands in the side panel ══
    js(f"LRFCard.turn(true); A.setView('map'); A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
    press(page, "[data-hook='card-layout']", 500)
    lay = js("const lp = document.querySelector('.inspector #leUse'); return { on: document.body.dataset.layout === 'on', card: !!card(), panel: panel(), box: drawn(lp), attr: document.body.dataset.card || null };")
    check("“Edit layout” on a bed's card opens Edit layout with its boxes in the side panel, and the card gives way", lay["on"] and not lay["card"] and lay["panel"] and lay["box"] and not lay["attr"], lay)
    press(page, "#leDone", 500)
    lay2 = js("return { on: document.body.dataset.layout === 'on', panel: panel(), attr: document.body.dataset.card || null };")
    check("Done in Edit layout closes it, and with nothing picked there is no side panel again", not lay2["on"] and not lay2["panel"] and lay2["attr"] == "on", lay2)

    js(f"A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(400)
    press(page, "[data-hook='card-full']", 400)
    fl = js("return { card: !!card(), panel: panel(), date: drawn($('fDate')) };")
    check("“Planting details” opens it whole in the side panel, in place of the card", not fl["card"] and fl["panel"] and fl["date"], fl)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
    press(page, "[data-hook='card-opening']", 400)
    op = js("return { card: !!card(), panel: panel(), sel: S.sel && S.sel.type };")
    check("an opening in the bed's card opens in the side panel, as before", not op["card"] and op["panel"] and op["sel"] == "opening", op)
    js("A.select(null); return null;"); wait(300)
    st = js("LRFPanels.showSettle(); return null;"); wait(500)
    st = js("return { panel: panel(), settle: drawn($('toSettle')) };")
    check("the list of what to settle, asked for from Loose ends, stands in the side panel", st["panel"] and st["settle"], st)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(300)
    js("A.select(null); return null;"); wait(300)
    check("once something else has been picked and closed, there is no side panel again", not js("return panel();"))

    # ══ To place's two lines, in his words ══
    wt = js(f"""A.sendToWait('{PID}'); LRFPanels.setScope('wait'); return {{ lead: hook('waiting-lead') ? hook('waiting-lead').textContent : '', foot: hook('lib-hint') ? hook('lib-hint').textContent : '' }};""")
    wait(200)
    check("To place chosen: the line under the switch reads “Not in a bed yet, so not in the forecast, seed or sowing lists.” and the line at the library's foot “Drag one onto a bed or a row. It keeps its date.”",
          wt["lead"] == "Not in a bed yet, so not in the forecast, seed or sowing lists." and wt["foot"] == "Drag one onto a bed or a row. It keeps its date.", wt)
    js("A.undo(); LRFPanels.setScope('mine'); A.select(null); return null;"); wait(300)

    # ══ on a phone: whatever is pressed on the card, its menu and its calendar is 44 high ══
    page.set_viewport_size({"width": 390, "height": 844}); wait(400)
    js(f"if ($('wkFull') && drawn($('wkFull'))) $('wkFull').click(); A.setView('map'); A.select({{ type: 'planting', id: '{PID}' }}); return null;"); wait(600)
    hi = lambda sel: js("const el = document.querySelector(arg); return el ? Math.round(el.getBoundingClientRect().height) : 0;", sel)
    ph = {"x": hi("[data-hook='card-close']"), "date": hi("[data-hook='card-date']"), "variety": hi("[data-hook='card-variety']"), "row": hi("[data-hook='card-row'] .card-row-head")}
    press(page, "[data-hook='card-more']", 300); ph["menu"] = hi("[data-hook='card-menu-item']"); page.keyboard.press("Escape"); wait(200)
    press(page, "[data-hook='card-date']", 300); ph["day"] = hi("[data-hook='card-cal-day']"); page.keyboard.press("Escape"); wait(200)
    ph["help"] = hi("[data-hook='card'] [data-hook='use-help']"); ph["full"] = hi("[data-hook='card-full']")
    ph["inside"] = js("const c = card(); if (!c) return false; const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;")
    check("on a phone (390 wide) the card stands inside the screen, and its ×, date, variety, rows, menu and calendar days, Grown for sale's \"?\" and Planting details are 44 high", ph["inside"] and all(ph[k] >= 44 for k in ["x", "date", "variety", "row", "menu", "day", "help", "full"]), ph)
    page.set_viewport_size({"width": WIDTH, "height": 960}); wait(400)
    js("A.setView('map'); return null;"); wait(300)

    # ══ unticked: as before ══
    js("A.setView('map'); return null;"); wait(300)
    press(page, "#mapHelp", 400); press(page, "[data-hook='card-try']", 400); page.keyboard.press("Escape"); wait(200)
    js(f"A.select({{ type: 'bed', id: '{BED}' }}); return null;"); wait(400)
    un = js("let kept = 'x'; try { kept = localStorage.getItem('lrf.tryCard'); } catch (_) {} return { kept, card: !!card(), panel: panel(), dims: drawn($('bedDims')), attr: document.body.dataset.card || null };")
    check("unticked, the browser forgets it and a bed opens in the side panel again, with nothing of the card", un["kept"] is None and not un["card"] and un["panel"] and un["dims"] and not un["attr"], un)
    js("A.select(null); return null;")
    browser.close()

with sync_playwright() as pw:
    try: run(pw)
    except Exception as e:  # noqa: BLE001 — a check that stops says why, as a failed line
        check("the check ran to its end", False, repr(e)[:600])
finish()
