"""Step 5b in a real browser: the benches edited in place (kind, size, a typed count, house, order, in use), the room on
each kind of bench, hardening off going outside, how a live tray is sown, supplies for the season with what is on the
shelf, the Seeds list redrawn only where it changed, and that looking changes nothing.
usage: python3 -I step5b_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); DARK = os.environ.get("DARK") == "1"; STOP = os.environ.get("STOP_AT_FAIL") == "1"
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
PRE = "const A = LRFApp, S = A.state, E = LRFEngine, N = LRFNursery, B = LRFBench, SL = LRFSeedLib, T = LRFTrays, $ = id => document.getElementById(id), eng = S.engine, year = A.planYear();"
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def open_page(width, height):
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme="dark" if DARK else "light")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
        if backup:
            page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
        return ctx, page
    ctx, page = open_page(WIDTH, 900)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    wait = lambda ms=350: page.wait_for_timeout(ms)
    toast = lambda: page.evaluate("document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').firstChild.textContent : ''")
    def undo(): page.keyboard.press("Escape"); js("A.undo()"); wait(350)
    bench_row = lambda i: f"#bnEditor tbody tr:nth-child({i})"
    def tab(name): js(f"LRFTraysView.setTab('{name}');"); wait(350)   # 0.31: one of the Nursery's four tabs
    def on_room(body):   # read something that is drawn on Bench room, and come back to Set-up
        tab("room"); out = js(body); tab("setup"); return out
    def fill(sel, value):   # a field a fault has removed is not typed into: the named line after it fails, and the check goes on
        loc = page.locator(sel)
        if not loc.count(): wait(100); return False
        loc.fill(str(value)); loc.dispatch_event("change"); wait(450); return True
    def light_only():   # light, whatever the computer says
        return page.evaluate("getComputedStyle(document.body).backgroundColor")

    # ── the bench section as it opens: one kind of bench, nothing changed ──
    key0 = js("return A.contentKey()")
    page.click('[data-view-btn="trays"]'); wait(700)
    first = js("""const f = B.figures(), lines = [...document.querySelectorAll('.tr-wrap .bn .bn-pools li')].map(l => ({ pool: l.dataset.pool, state: l.dataset.state, text: l.textContent }));
      return { lines, charts: [...document.querySelectorAll('.tr-wrap .bn .bn-chart')].map(c => c.dataset.pool), shown: f.shown, room: f.room, cap: (document.querySelector('.bn-cap-label') || {}).textContent, harden: f.hardening.most, days: f.hardenDays,
        editor: !!$('bnEditor'), button: $('bnEdit').textContent, expanded: $('bnEdit').getAttribute('aria-expanded'), title: document.querySelector('.tr-wrap .bn h3').textContent,
        facts: [...document.querySelectorAll('.bn-facts dt')].map(e => e.textContent), para: document.querySelectorAll('.tr-wrap .bn p.bn-crates, .tr-wrap .bn p.bn-share, .tr-wrap .bn #bnTrays').length,
        tight: f.pools.heated.tightest && { used: f.pools.heated.tightest.used, cap: f.pools.heated.tightest.cap }, benches: f.benches.length, sideways: document.querySelector('.view-trays').scrollWidth > document.querySelector('.view-trays').clientWidth + 1 };""")
    heated = next((l for l in first["lines"] if l["pool"] == "heated"), None)
    check("the bench section says, for each kind of bench with room, how many benches, how many tray spaces and its fullest day", heated and f"{first['benches']} benches" in heated["text"] and f"{first['room']['heated']:,} tray spaces" in heated["text"] and first["tight"] and f"{round(first['tight']['used'], 1):g}" in heated["text"].replace(",", "") and first["charts"] == first["shown"], first)
    check("with every bench under heat there is one chart, and hardening off has a line saying it is counted under heat", first["shown"] == ["heated"] and any(l["pool"] == "harden" and "No bench is listed outside" in l["text"] and f"{first['days']} days before planting out" in l["text"] for l in first["lines"]), first["lines"])
    check("what was three run-on notes is a list with a name for each line: where the room is, on Bench room (0.31: how trays and crates are counted is on Set-up)", first["para"] == 0 and first["facts"] == ["Where the room is"], first["facts"])
    check("on Bench room the benches themselves are not listed: a button beside the bench count leads to Set-up (0.31)", not first["editor"] and first["button"] == "Edit benches and rules" and js("return LRFTraysView.tab()") == "room" and js("return document.querySelector('.bn-count').textContent").startswith(f"{first['benches']} benches"), first["button"])
    page.screenshot(path=str(shots / "n1-bench-room.png"))

    # ── the benches, in place ──
    page.click("#bnEdit"); wait(400)
    ed = js("""const rows = [...document.querySelectorAll('#bnEditor tbody tr')], list = eng.benchList();
      return { rows: rows.length, list: list.length, names: rows.map(r => r.querySelector('[data-f=name]').value), kinds: rows.map(r => r.querySelector('[data-f=kind]').value), holds: rows.map(r => r.querySelector('[data-f=holds]').placeholder), est: list.map(b => String(b.estimate)),
        same: rows.filter(r => r.querySelector('.bn-same')).length, shared: [...N.sharedNames(list.filter(b => b.active))].length, tab: LRFTraysView.tab(), title: $('nuTitle').textContent, close: !!$('bnEditClose'), toggle: !!$('bnEdit'),
        lines: document.querySelectorAll('#bnSetup .bn-pools li').length, above: !!(document.querySelector('#bnSetup .bn-pools').compareDocumentPosition($('bnEditor')) & 4), boxes: [...document.querySelectorAll('#bnSetup .bn-edit-head h3')].map(e => e.textContent), facts: [...document.querySelectorAll('#bnCount .bn-facts dt')].map(e => e.textContent), key: A.contentKey(), undo: S.undo.length,
        wide: $('bnEditor').querySelector('table').scrollWidth > $('bnEditor').querySelector('.tr-scroll').clientWidth + 1, packing: $('bnPacking').value, hard: $('bnHarden').value };""")
    check("Set-up lists every bench with its name, kind and what its area gives, always open, under a line of the room they give (0.31: no toggle, no ×)", ed["rows"] == ed["list"] and ed["rows"] > 0 and ed["holds"] == ed["est"] and all(k == "heated" for k in ed["kinds"]) and ed["tab"] == "setup" and ed["title"] == "Set-up" and not ed["close"] and not ed["toggle"] and ed["lines"] >= 1 and ed["above"] and not ed["wide"], ed)
    check("Set-up has three subjects, each under its own heading: the benches, hardening off and growing on, how trays and crates are counted (0.31)", ed["boxes"] == ["Benches", "Hardening off and growing on", "How trays and crates are counted"], ed["boxes"])
    check("how trays and crates are counted is a named list there: shared trays, and the sheltered crates where the plan has any", "Shared trays" in ed["facts"] and all(f in ("Sheltered crates", "Shared trays") for f in ed["facts"]), ed["facts"])
    check("benches that share a name are marked", (ed["same"] >= 2) == (ed["shared"] >= 1), ed)
    check("opening the benches changes nothing in the plan", ed["key"] == key0 and ed["undo"] == 0)
    page.screenshot(path=str(shots / "n2-benches-open.png"))
    n = ed["rows"]

    # a bench goes outside
    page.select_option(f"{bench_row(n)} [data-f=kind]", "outside"); wait(500)
    out = js("""const f = B.figures(), last = eng.benchList()[eng.benchList().length - 1];
      return { toast: $('toast').firstChild.textContent, room: f.room, shown: f.shown, cap: last.cap, kind: last.kind, edited: S.plan.nursery.lrfEdited,
        lines: [...document.querySelectorAll('.bn-pools li')].map(l => [l.dataset.pool, l.dataset.state, l.textContent]), focus: document.activeElement && document.activeElement.getAttribute('aria-label'), editor: !!$('bnEditor'), undo: S.undo.length,
        outside: f.pools.outside.tightest && f.pools.outside.tightest.used, hard: f.hardening.most };""")
    check("the line of the room above the benches follows the change at once: outside has a line of its own (0.31)", any(l[0] == "outside" for l in out["lines"]), out["lines"])
    out.update(on_room("return { charts: [...document.querySelectorAll('.tr-wrap .bn .bn-chart')].map(c => c.dataset.pool), stat: document.querySelector('#trWrap .tr-stat span').textContent, heads: [...document.querySelectorAll('.bn-pool h4')].map(e => e.textContent) };"))
    check("a bench made an outside bench says what that does to the room, in one step that can be undone", out["kind"] == "outside" and "is outside" in out["toast"] and f"outside 0 → {out['cap']} tray spaces" in out["toast"] and "heated greenhouse" in out["toast"] and out["undo"] == 1 and out["edited"] is True, out)
    check("there is then a chart for the benches outside, named, and hardening off stands there", out["shown"] == ["heated", "outside"] and out["charts"] == ["heated", "outside"] and out["heads"] == ["Heated greenhouse", "Outside"] and out["outside"] > 0 and abs(out["outside"] - min(out["hard"], out["cap"])) < 1e-6, out)
    check("the editor stays open and the cursor stays in the field that was changed", out["editor"] and out["focus"] == f"Bench {n}: kind", out["focus"])
    check("with more than one kind of bench the tile says which it is about", out["stat"] == "Heated benches, fullest", out["stat"])
    # a typed count beats the area
    fill(f"{bench_row(n)} [data-f=holds]", 5)
    held = js("""const b = eng.benchList()[eng.benchList().length - 1], f = B.figures(); return { cap: b.cap, holds: b.holds, est: b.estimate, toast: $('toast').firstChild.textContent, note: (document.querySelector('#bnEditor tbody tr:last-child .bn-holds small') || {}).textContent, room: f.room.outside, line: [...document.querySelectorAll('.bn-pools li')].find(l => l.dataset.pool === 'outside').dataset.state, hardLine: [...document.querySelectorAll('.bn-pools li')].find(l => l.dataset.pool === 'harden').textContent, inside: f.hardening.inside };""")
    check("a count typed for a bench beats what its area gives, and the area's figure is still shown beside it", held["cap"] == 5 and held["holds"] == 5 and held["room"] == 5 and "holds 5 trays" in held["toast"] and held["note"] == f"area gives {held['est']}", held)
    check("a bench outside that is too small is full, not over: what does not fit stays under heat, and the line says how much", held["line"] == "full" and held["inside"] > 0 and f"{round(held['inside'], 1):g} tray spaces stay under heat" in held["hardLine"], held)
    page.screenshot(path=str(shots / "n3-outside.png"))
    fill(f"{bench_row(n)} [data-f=holds]", "")
    check("clearing the count brings the estimate back", js("const b = eng.benchList()[eng.benchList().length - 1]; return b.holds === null && b.cap === b.estimate;"))
    # an unheated bench
    page.select_option(f"{bench_row(n - 1)} [data-f=kind]", "unheated"); wait(500)
    un_charts = on_room("return document.querySelectorAll('.tr-wrap .bn .bn-chart').length;")
    un = js("const f = B.figures(); return { shown: f.shown, charts: " + str(un_charts) + ", room: f.room, heated: eng.heatedTraySpaces(), toast: $('toast').firstChild.textContent, hard: f.hardening.most, un: f.pools.unheated.tightest.used, out: f.pools.outside.tightest ? f.pools.outside.tightest.used : 0, line: [...document.querySelectorAll('.bn-pools li')].find(l => l.dataset.pool === 'harden').textContent };")
    check("an unheated bench is a third kind: its room leaves the heated count", un["shown"] == ["heated", "unheated", "outside"] and un["charts"] == 3 and un["room"]["unheated"] > 0 and un["heated"] == un["room"]["heated"] and "under cover without heat" in un["toast"], un)
    check("what hardens off goes onto the unheated benches first, and outside only for what they have no room for", abs(un["un"] - min(un["hard"], un["room"]["unheated"])) < 1e-6 and un["out"] <= max(0, un["hard"] - un["room"]["unheated"]) + 1e-6 and "The unheated benches, then those outside," in un["line"], un)
    # a crop grown on without heat
    cool0 = js("const o = [...document.querySelectorAll('#bnCoolCrop option')].filter(x => x.value); const want = new Set(); for (const it of eng.benchItems()) if (it.kind === 'prop' && !it.r.tw) want.add(it.p.cropId); const by = new Map(); for (const it of eng.benchItems()) if (it.kind === 'prop' && !it.r.tw && it.r.sow.getMonth() >= 4 && it.r.sow.getMonth() <= 7) by.set(it.p.cropId, (by.get(it.p.cropId) || 0) + 1); const pick = [...by].sort((a, b) => b[1] - a[1])[0]; const tw = new Set(); for (const it of eng.benchItems()) if (it.kind === 'prop' && it.r.tw && !want.has(it.p.cropId)) tw.add(it.p.cropId); return { towerOnly: tw.size, options: o.length, want: want.size, rows: document.querySelectorAll('#bnCool tbody tr').length, pick: pick && pick[0], name: pick && eng.crop(pick[0]).name, heated: B.figures().pools.heated.tightest.used };")
    check("a subject is found: a crop raised for the towers and for nothing else, which that list must leave out", cool0["towerOnly"] > 0, cool0)
    check("under the benches, a list of crops grown on without heat, empty until he adds one, offering every crop raised in trays", cool0["rows"] == 0 and cool0["options"] == cool0["want"] and cool0["options"] > 3 and cool0["pick"], cool0)
    dates1 = js("return S.plan.plantings.map(p => { const r = eng.calc(p); return r ? [E.d2s(r.field), E.d2s(r.first), r.sow ? E.d2s(r.sow) : '', r.seeds, r.trays].join() : ''; }).join('|')")
    page.select_option("#bnCoolCrop", cool0["pick"]); page.click("#bnCoolAdd"); wait(600)
    cool1 = js("const f = B.figures(); return { rules: S.plan.nursery.cool, toast: $('toast').firstChild.textContent, rows: document.querySelectorAll('#bnCool tbody tr').length, focus: document.activeElement && document.activeElement.getAttribute('aria-label'), most: f.cool.most, options: [...document.querySelectorAll('#bnCoolCrop option')].filter(x => x.value).length };")
    check("a crop is added in one step, on the unheated benches all year until its days are set, and the toast says how much then stands there", cool1["rows"] == 1 and cool1["rules"] == [{"cropId": cool0["pick"], "from": "", "to": "", "after": 5}] and "all year until its days are set" in cool1["toast"] and "tray spaces on the unheated benches" in cool1["toast"] and cool1["most"] > 0 and cool1["options"] == cool0["options"] - 1 and (cool1["focus"] or "").endswith("on the unheated benches from"), cool1)
    def setd(f, v):
        loc = page.locator(f"#bnCool tbody tr [data-f={f}]")
        if not loc.count(): return
        loc.fill(v); loc.dispatch_event("change"); wait(500)
    setd("from", "2027-06-01"); setd("to", "2027-09-15"); fill("#bnCool tbody tr [data-f=after]", 4)
    cool2 = js("const f = B.figures(); let bad = 0, inwin = 0; for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = E.addDays(d, 1)) { const r = eng.benchDay(d), md = E.d2s(d).slice(5); if (r.cool > 0 && (md < '06-01' || md > '09-15')) bad++; if (r.cool > 0) inwin++; } return { rules: S.plan.nursery.cool, most: f.cool.most, bad, inwin, un: f.pools.unheated.tightest.used, heated: f.pools.heated.tightest.used, toast: $('toast').firstChild.textContent, dates: S.plan.plantings.map(p => { const r = eng.calc(p); return r ? [E.d2s(r.field), E.d2s(r.first), r.sow ? E.d2s(r.sow) : '', r.seeds, r.trays].join() : ''; }).join('|') };")
    check("with its two days and its days under heat set, the crop stands on the unheated benches in that season only, and no planting's days, seed or trays move", cool2["rules"] == [{"cropId": cool0["pick"], "from": "06-01", "to": "09-15", "after": 4}] and cool2["bad"] == 0 and cool2["inwin"] > 0 and cool2["most"] <= cool1["most"] + 1e-9 and "4 days under heat first" in cool2["toast"] and cool2["dates"] == dates1, {k: cool2[k] for k in ("rules", "most", "bad", "inwin", "toast")})
    page.screenshot(path=str(shots / "n3b-grown-on.png"))
    fill("#bnCool tbody tr [data-f=after]", 99)
    check("days under heat that make no sense are refused in words", "0 to 60" in toast() and js("return S.plan.nursery.cool[0].after") == 4)
    page.click("#bnCool tbody tr [data-f=remove]"); wait(500)
    check("taking the crop off the list puts it back under heat", js("return !S.plan.nursery.cool && B.figures().cool.most === 0 && document.querySelectorAll('#bnCool tbody tr').length === 0") and "raised under heat again" in toast())
    # refused, in words
    fill(f"{bench_row(1)} [data-f=w]", 0)
    bad = js("return { toast: $('toast').firstChild.textContent, value: document.querySelector('#bnEditor tbody tr:first-child [data-f=w]').value, w: eng.benchList()[0].w, undo: S.undo.length };")
    check("a width that makes no sense is refused in words and the field shows what the bench is", "feet" in bad["toast"] and float(bad["value"]) == bad["w"] and bad["w"] > 0, bad)
    # rename, house, order, in use, add, remove
    fill(f"{bench_row(1)} [data-f=name]", "Propagation bench")
    page.select_option(f"{bench_row(1)} [data-f=house]", "+"); wait(400)
    naming = js("const el = document.querySelector('#bnEditor tbody tr:first-child .bn-newhouse input'); return { there: !!el, focus: document.activeElement === el };")
    page.keyboard.press("Escape"); wait(350)
    left = js("return { naming: !!document.querySelector('.bn-newhouse'), editor: !!$('bnEditor'), house: eng.benchList()[0].area };")
    check("a new house is named where the bench is; Escape leaves the bench where it stood and the editor open", naming["there"] and naming["focus"] and not left["naming"] and left["editor"], [naming, left])
    page.select_option(f"{bench_row(1)} [data-f=house]", "+"); wait(400)
    page.locator("#bnEditor tbody tr:first-child .bn-newhouse input").fill("Cold frame yard"); page.keyboard.press("Enter"); wait(500)
    housed = js("const b = eng.benchList()[0]; return { name: b.name, area: b.area, areas: (S.plan.nursery.benchAreas || []).map(a => a.name) };")
    housed["where"] = on_room("return document.querySelector('.bn-where').textContent;")
    check("the bench is renamed and stands in the new house, which Bench room then lists", housed["name"] == "Propagation bench" and housed["area"] == "Cold frame yard" and "Cold frame yard" in housed["areas"] and "Cold frame yard" in housed["where"], housed)
    order0 = js("return eng.benchList().map(b => b.id)")
    page.click(f"{bench_row(1)} [data-f=down]"); wait(400)
    order1 = js("return { ids: eng.benchList().map(b => b.id), focus: document.activeElement && document.activeElement.closest('tr') && document.activeElement.closest('tr').dataset.bench, first: document.querySelector('#bnEditor tbody tr:first-child [data-f=up]').disabled };")
    check("a bench moves down the list, the cursor goes with it, and the first row cannot move up", order1["ids"][0] == order0[1] and order1["ids"][1] == order0[0] and order1["focus"] == order0[0] and order1["first"], order1)
    cap_before = js("return eng.heatedTraySpaces()")
    page.locator(f"{bench_row(3)} [data-f=active]").click(); wait(450)
    off = js("const b = eng.benchList()[2]; return { active: b.active, cap: eng.heatedTraySpaces(), bcap: b.cap, cls: document.querySelector('#bnEditor tbody tr:nth-child(3)').className, toast: $('toast').firstChild.textContent };")
    check("a bench taken out of use holds nothing, and its row is dimmed", off["active"] is False and off["cap"] == cap_before - off["bcap"] and "off" in off["cls"] and "out of use" in off["toast"], off)
    page.click("#bnAdd"); wait(600)
    added = js("const list = eng.benchList(), b = list[list.length - 1], prev = list[list.length - 2]; return { n: list.length, name: b.name, like: b.w === prev.w && b.l === prev.l && b.kind === prev.kind, focus: document.activeElement && document.activeElement.getAttribute('aria-label'), unique: list.filter(x => x.name === b.name).length };")
    check("a bench is added in one click, like the last one, with a name of its own, ready to be renamed", added["n"] == n + 1 and added["like"] and added["unique"] == 1 and added["focus"] == f"Bench {n + 1}: name", added)
    page.click(f"{bench_row(n + 1)} [data-f=remove]"); wait(450)
    check("a bench is removed in one click, and Undo is offered", js("return eng.benchList().length") == n and "removed" in toast())
    # the options
    dates0 = js("return S.plan.plantings.map(p => { const r = eng.calc(p); return r ? [E.d2s(r.field), E.d2s(r.first), r.sow ? E.d2s(r.sow) : '', r.seeds].join() : ''; }).join('|')")
    fill("#bnHarden", 3)
    hard = js("return { days: eng.hardenDays(), nursery: S.plan.nursery.harden, toast: $('toast').firstChild.textContent, line: [...document.querySelectorAll('.bn-pools li')].find(l => l.dataset.pool === 'harden').textContent, dates: S.plan.plantings.map(p => { const r = eng.calc(p); return r ? [E.d2s(r.field), E.d2s(r.first), r.sow ? E.d2s(r.sow) : '', r.seeds].join() : ''; }).join('|') };")
    check("the days of hardening off are set under the benches, and no planting's sowing, planting or harvest day moves", hard["days"] == 3 and hard["nursery"] == 3 and "3 days before planting out" in hard["line"] and hard["dates"] == dates0, {k: hard[k] for k in ("days", "toast", "line")})
    fill("#bnPacking", 70)
    pack = js("return { packing: S.plan.nursery.packing, head: document.querySelector('.bn-edit-head p').textContent, est: eng.benchList()[0].estimate, w: eng.benchList()[0].w, l: eng.benchList()[0].l };")
    check("the share of a bench that takes trays changes what every area gives", pack["packing"] == 70 and "70%" in pack["head"] and pack["est"] == int(pack["w"] * pack["l"] * 0.7 / (200 / 144)), pack)
    fill("#bnPacking", 5)
    check("a share that makes no sense is refused in words", "30 to 100" in toast() and js("return S.plan.nursery.packing") == 70)
    # leaving
    steps = js("return S.undo.length")
    page.locator(f"{bench_row(2)} [data-f=name]").click(); page.keyboard.type(" typed and left"); page.keyboard.press("Escape"); wait(400)
    esc = js("return { editor: !!$('bnEditor'), undo: S.undo.length, name: eng.benchList()[1].name, field: document.querySelector('#bnEditor tbody tr:nth-child(2) [data-f=name]').value, tab: LRFTraysView.tab() };")
    check("Escape while typing drops what was typed and nothing else: the benches stay open, on Set-up (0.31: there is nothing to close)", esc["editor"] and esc["tab"] == "setup" and esc["undo"] == steps and "typed and left" not in esc["name"] and "typed and left" not in esc["field"], esc)
    tab("room")
    away = js("return { editor: !!$('bnEditor'), undo: S.undo.length, button: !!$('bnEdit') };")
    page.click("#bnEdit"); wait(350)
    check("going back to Bench room and in again by its button changes nothing, and the benches are as they were left", not away["editor"] and away["button"] and away["undo"] == steps and js("return LRFTraysView.tab()") == "setup" and js("return !!$('bnEditor') && S.undo.length") == steps, away)
    for _ in range(steps): js("A.undo()"); wait(120)
    wait(300)
    back = js("return { key: A.contentKey(), shown: B.figures().shown, undo: S.undo.length, edited: (S.plan.nursery || {}).lrfEdited };")
    check("undoing every step puts the benches, and the plan, back exactly as they were", back["key"] == key0 and back["shown"] == ["heated"] and back["undo"] == 0, back)

    # ── Tasks shows one line of the benches, and edits nothing (0.31: the section itself is in the Nursery) ──
    page.click('[data-view-btn="sow"]'); wait(700)
    wk = js("const l = document.querySelector('.view-sow #bnLine'); return { bench: !!document.querySelector('.view-sow .bn'), button: !!document.querySelector('.view-sow #bnEdit'), editor: !!document.querySelector('.view-sow #bnEditor'), supplies: !!document.querySelector('.view-sow #bnSupplies'), line: l ? l.textContent : null, pools: l ? [...l.querySelectorAll('span[data-pool]')].map(x => x.dataset.pool) : [] };")
    js("const last = eng.benchList().pop(); A.editNursery('a bench outside, for the check', n => N.setBench(n, last.id, { kind: 'outside' }));"); wait(500)
    wk2 = js("const l = document.querySelector('.view-sow #bnLine'); return { pools: l ? [...l.querySelectorAll('span[data-pool]')].map(x => x.dataset.pool) : [], text: l ? l.textContent : null, kind: eng.benchList().pop().kind };")
    check("Tasks has one line of what stands on the benches this week, no chart, no benches to edit and no supplies; and the line follows a change to the benches", not wk["bench"] and not wk["button"] and not wk["editor"] and not wk["supplies"] and wk["line"] and "On the benches this week" in wk["line"] and wk["pools"] == ["heated"] and wk2["kind"] == "outside" and wk2["pools"] == ["heated", "outside"], [wk, wk2])
    js("if (S.undo.length) A.undo();"); wait(300)
    page.click("#bnLineGo"); wait(500)
    went = js("return { view: S.view, tab: LRFTraysView.tab(), undo: S.undo.length };")
    check("the line leads to Bench room, in the Nursery", went["view"] == "trays" and went["tab"] == "room" and went["undo"] == 0, went)

    # ── how a live tray is sown ──
    page.click('[data-view-btn="trays"]'); wait(600); tab("live")
    live = js("""const rows = [...document.querySelectorAll('.tr-demand tbody tr')], plan = (S.plan.liveTrayPlans || []).find(p => p.year === year), r = plan && plan.rows[1];
      return { rows: rows.length, hows: rows.map(x => (x.querySelector('.tr-how') || {}).value), row: r && r.id, crop: r && r.cropId, name: r && r.name, head: [...document.querySelectorAll('.tr-demand thead th')].map(e => e.firstChild.textContent),
        trays: T.batches(eng, E).filter(b => b.cropId === (r && r.cropId) && String(b.p.date).slice(0, 4) <= String(year)).reduce((n, b) => n + b.trays, 0), fit: document.querySelector('.tr-demand').scrollWidth <= document.querySelector('.tr-plan .tr-scroll').clientWidth + 1, stat: [...document.querySelectorAll('#trWrap .tr-stat')][2].textContent };""")
    check("every crop of the demand plan says how its tray is sown: in cells, where it has no weight and he has said nothing", live["rows"] >= 2 and all(h == "cells" for h in live["hows"]) and "Sown" in live["head"] and live["fit"], live)
    sel = f'.tr-demand tr[data-row="{live["row"]}"]'
    sup0 = js("return N.supplies(eng, year, null).rows.map(r => [r.id, r.need])")
    half = js(f"const c = eng.crop({json.dumps(live['crop'])}), how = eng.liveSow(c); return {{ how: how.how, set: how.set, said: how.said, kept: S.plan.crops.find(x => x.id === c.id).liveSow || null, inputs: [...document.querySelectorAll({json.dumps(sel)} + ' .tr-sown input')].map(i => i.getAttribute('aria-label')), seeds: SL.required(eng).rows.filter(r => r.crop && r.crop.id === c.id).reduce((n, r) => n + r.total, 0) }};")
    check("such a row asks for cells a tray and seeds a cell, counts no seed until both are there, and nothing is written on the crop until he types", half["how"] == "cells" and not half["set"] and not half["said"] and half["kept"] is None and half["seeds"] == 0 and len(half["inputs"]) == 2 and half["inputs"][0].endswith("cells a tray") and half["inputs"][1].endswith("seeds a cell"), half)
    fill(f'{sel} input[aria-label$="cells a tray"]', 72); fill(f'{sel} input[aria-label$="seeds a cell"]', 12)
    full = js(f"""const c = eng.crop({json.dumps(live['crop'])}), mine = T.batches(eng, E).filter(b => b.cropId === c.id), trays = mine.reduce((n, b) => n + b.trays, 0), need = SL.required(eng).rows.filter(r => r.crop && r.crop.id === c.id);
      return {{ toast: $('toast').firstChild.textContent, trays, seeds: mine.reduce((n, b) => n + b.seeds, 0), units: need.map(r => r.unit), total: need.reduce((n, r) => n + r.total, 0), cell: document.querySelector({json.dumps(sel)} + ' .tr-seed').textContent,
        stat: [...document.querySelectorAll('#trWrap .tr-stat')][2].querySelector('strong').textContent, clip: [...document.querySelectorAll('#trWrap .tr-stat strong')].some(e => e.scrollWidth > e.parentElement.clientWidth), fit: document.querySelector('.tr-demand').scrollWidth <= document.querySelector('.tr-plan .tr-scroll').clientWidth + 1,
        crop: S.plan.crops.find(x => x.id === c.id).liveSow, sup: N.supplies(eng, year, null).rows.map(r => [r.id, r.need]), boxes: [...document.querySelectorAll({json.dumps(sel)} + ' .tr-sown input')].map(i => i.scrollWidth <= i.clientWidth + 1) }};""")
    check("with both figures the tray takes cells × seeds a cell, and the row, the tile and seeds required all count seeds", "72 cells × 12 = 864 seeds a tray" in full["toast"] and full["seeds"] == full["trays"] * 864 and full["total"] <= full["seeds"] and full["total"] > 0 and set(full["units"]) == {"seeds"} and f"{full['seeds']:,} seeds" in full["cell"] and "seeds" in full["stat"], full)
    check("the figures are kept on the crop, and the table and its tiles still fit", full["crop"] == {"how": "cells", "cells": 72, "perCell": 12} and full["fit"] and not full["clip"] and all(full["boxes"]), full)
    a, b = dict(sup0), dict(full["sup"])
    check("supplies follow: those live trays go out in 72-cell trays, where before the kind of tray was not known", b.get("tray-72", 0) > a.get("tray-72", 0) and b.get("live-unsaid", 0) < a.get("live-unsaid", 0) and (b.get("tray-72", 0) - a.get("tray-72", 0)) == (a.get("live-unsaid", 0) - b.get("live-unsaid", 0)) and a.get("open", 0) == b.get("open", 0), [a, b])
    page.screenshot(path=str(shots / "n4-live-sown.png"))
    page.click('[data-view-btn="sow"]'); wait(600)
    wkline = js(f"const l = LRFSowView.figures().list.find(x => x.kind === 'live' && x.crop && x.crop.id === {json.dumps(live['crop'])}); if (!l) return null; A.setDate(E.s2d(l.week)); return {{ week: l.week, unit: l.unit }};")
    wait(600)
    wktext = js(f"const rows = [...document.querySelectorAll('.sw-kind[data-kind=live] tbody tr')].map(r => r.textContent); return rows.filter(t => t.includes({json.dumps(live['name'])}));")
    check("the Week view words that sowing in cells and seeds", wkline and wkline["unit"] == "seeds" and any("72 cells, 12 seeds a cell" in t for t in wktext), [wkline, wktext[:2]])
    page.click('[data-view-btn="seeds"]'); wait(1200)
    seedrow = js(f"const key = 'c:' + {json.dumps(live['crop'])} + '|seeds', r = document.querySelector('#sdBody tr.sd-need[data-key=' + JSON.stringify(key) + ']') || [...document.querySelectorAll('#sdBody .sd-var')].find(x => (S.plan.varieties.find(v => v.id === x.dataset.variety) || {{}}).cropId === {json.dumps(live['crop'])}); return r ? r.textContent : null;")
    check("the Seeds list counts that crop in seeds, with no weight word beside the number", seedrow is not None and "g of seed" not in seedrow, seedrow)
    page.click('[data-view-btn="trays"]'); wait(500)
    page.select_option(f"{sel} .tr-how", "open"); wait(450)
    fill(f'{sel} input[aria-label$="grams of seed per tray"]', 15)
    opened = js(f"const c = S.plan.crops.find(x => x.id === {json.dumps(live['crop'])}), how = eng.liveSow(eng.crop(c.id)); return {{ how: how.how, grams: how.grams, kept: c.liveSow, g: T.batches(eng, E).filter(b => b.cropId === c.id).reduce((n, b) => n + b.seedG, 0), seeds: T.batches(eng, E).filter(b => b.cropId === c.id).reduce((n, b) => n + b.seeds, 0), cell: document.querySelector({json.dumps(sel)} + ' .tr-seed').textContent }};")
    check("back in an open tray it is counted by weight, and the cell figures are kept for another time", opened["how"] == "open" and opened["grams"] == 15 and opened["seeds"] == 0 and opened["g"] > 0 and opened["kept"] == {"how": "open", "cells": 72, "perCell": 12} and ("g" in opened["cell"] or "lb" in opened["cell"]), opened)
    # a crop said to be broadcast, with no weight yet, stays broadcast: the default no longer speaks for it
    other = js("const plan = (S.plan.liveTrayPlans || []).find(p => p.year === year); return plan.rows[0].id;")
    osel = f'.tr-demand tr[data-row="{other}"]'
    page.select_option(f"{osel} .tr-how", "open"); wait(500)
    stays = js(f"const plan = (S.plan.liveTrayPlans || []).find(p => p.year === year), c = S.plan.crops.find(x => x.id === plan.rows[0].cropId); return {{ kept: c.liveSow, how: eng.liveSow(eng.crop(c.id)).how, select: document.querySelector({json.dumps(osel)} + ' .tr-how').value, grams: !!document.querySelector({json.dumps(osel)} + ' input[aria-label$=\"grams of seed per tray\"]'), toast: $('toast').firstChild.textContent }};")
    check("a crop said to be sown in an open tray stays so, though it has no weight yet", stays["kept"] == {"how": "open"} and stays["how"] == "open" and stays["select"] == "open" and stays["grams"] and "no seed figure" in stays["toast"], stays)
    while js("return S.undo.length"): js("A.undo()"); wait(100)
    wait(300)
    check("undoing puts the crop and the plan back", js("return A.contentKey()") == key0)

    # ── supplies for the season ──
    tab("supplies")
    sup = js("""const s = N.supplies(eng, year, null), rows = [...document.querySelectorAll('#bnSupplies tbody tr')];
      return { want: s.rows.map(r => [r.id, String(r.need), String(r.buy)]), got: rows.filter(r => r.dataset.supply !== 'mix').map(r => [r.dataset.supply, r.children[1].textContent.replace(/,/g, ''), (r.children[4].firstChild || {}).textContent.replace(/,/g, '')]),
        mix: rows.find(r => r.dataset.supply === 'mix').textContent, notes: document.querySelectorAll('#bnSupplies .bn-sup-notes li').length, how: rows[0].querySelector('.bn-how').textContent, mixIn: rows.filter(r => r.querySelector('[data-f=mix]')).map(r => r.dataset.supply), takes: s.rows.filter(r => r.fills > 0).map(r => r.id),
        fit: document.querySelector('.bn-supplies').scrollWidth <= document.querySelector('#bnSupplies .tr-scroll').clientWidth + 1, first: s.rows[0], after: LRFTraysView.tab() === 'supplies' && $('nuTitle').textContent === 'Supplies' && !document.querySelector('.tr-wrap .bn') };""")
    check("supplies for the season, on a tab of its own (0.31), lists every tray, sheet and pot the plan uses with what is needed, and everything is to buy while nothing is on the shelf", sup["got"] == sup["want"] and len(sup["want"]) >= 4 and sup["after"] and sup["fit"] and sup["notes"] == 3, sup)
    check("each line says how it is counted, and only what takes mix asks how much", "filled over the season" in sup["how"] and sup["mixIn"] == sup["takes"] and "bags of 2.8 cu ft" in sup["mix"], sup)   # 0.33: used once, mix from round figures
    sid = sup["first"]["id"]; srow = f'#bnSupplies tr[data-supply="{sid}"]'
    fill(f"{srow} [data-f=have]", max(1, sup["first"]["need"] - 2))
    had = js(f"const s = N.supplies(eng, year, S.plan.lrfNext.supplies).rows[0]; return {{ have: s.have, buy: s.buy, cell: document.querySelector({json.dumps(srow)}).children[4].textContent, own: S.plan.lrfNext.supplies, toast: $('toast').firstChild.textContent, undo: S.undo.length }};")
    check("what is on the shelf comes off what is to buy, as one step, kept beside the plan", had["have"] == max(1, sup["first"]["need"] - 2) and had["buy"] == sup["first"]["need"] - had["have"] and had["cell"].startswith(str(had["buy"])) and had["own"] == {"have": {sid: had["have"]}} and "on hand" in had["toast"] and had["undo"] == 1, had)
    fill(f"{srow} [data-f=mix]", 3.5)
    mixed = js(f"const s = N.supplies(eng, year, S.plan.lrfNext.supplies), r = s.rows[0], row = document.querySelector('#bnSupplies tr[data-supply=mix]'); return {{ qt: r.mixCuFt, own: r.mixOwn, bags: s.mix.bags, fills: r.fills, total: s.mix.need, text: row.textContent, cell: document.querySelector({json.dumps(srow)}).children[6].textContent.replace(/,/g, ''), missing: s.mix.missing.length, others: s.rows.filter(x => x.fills > 0 && x.mixDefault == null && !x.mixOwn).length, of: s.mix.of }};")
    check("mix one tray takes × the trays filled is the mix, in cubic feet and bags of 2.8 (0.33), his figure over the round one, and no quarts", abs(mixed["qt"] - mixed["fills"] * 3.5) < 1e-9 and mixed["own"] and abs(float(mixed["cell"]) - mixed["qt"]) < 0.06 and f"{round(mixed['total']):,} cu ft" in mixed["text"] and f"{mixed['bags']:,} bags of 2.8 cu ft" in mixed["text"] and " qt" not in mixed["text"] and mixed["missing"] == mixed["others"], mixed)   # nothing waits for a figure but a container the planner has no round figure for and he has typed none
    fill(f"{srow} [data-f=have]", "1.5")
    check("part of a tray on the shelf is refused in words", "whole number" in toast() and js("return S.plan.lrfNext.supplies.have[" + json.dumps(sid) + "]") == had["have"])
    page.screenshot(path=str(shots / "n5-supplies.png"), full_page=False)
    saved = js("return A.exportText ? null : null")
    while js("return S.undo.length"): js("A.undo()"); wait(100)
    wait(300)
    check("undoing clears the shelf again", js("return !(S.plan.lrfNext || {}).supplies && A.contentKey()") == key0)

    # ── the Seeds list is redrawn only where it changed ──
    page.click('[data-view-btn="seeds"]'); wait(1500)
    seeds = js("""const v = S.plan.varieties.find(x => x.active !== false && !x.deleted && document.querySelector('#sdBody .sd-var[data-variety="' + x.id + '"]')), rows = [...document.querySelectorAll('#sdBody tr')];
      window.__rows = new Map(rows.map(r => [r.dataset.variety || r.dataset.crop || r.dataset.key, r])); window.__v = v.id; window.__built = LRFSeeds.drawn().builtEver;
      return { rows: rows.length, id: v.id, name: v.name, imgs: document.querySelectorAll('#sdBody img').length, foot: [...document.querySelectorAll('#sdFoot .sd-foot-list li b')].map(e => e.textContent), para: document.querySelector('#sdFoot').tagName };""")
    page.evaluate("(async () => { const A = LRFApp, v = A.state.plan.varieties.find(x => x.id === window.__v); await A.revise('renamed for the check', [{ kind: 'variety', before: v, after: { ...v, name: v.name + ' (checked)' } }]); })()"); wait(700)
    re = js("""const rows = [...document.querySelectorAll('#sdBody tr')], old = window.__rows; let same = 0, fresh = 0;
      for (const r of rows) { const k = r.dataset.variety || r.dataset.crop || r.dataset.key; if (old.get(k) === r) same++; else fresh++; }
      return { rows: rows.length, same, fresh, built: LRFSeeds.drawn().builtEver - window.__built, name: document.querySelector('#sdBody .sd-var[data-variety="' + window.__v + '"] .as-vname').textContent, order: rows.map(r => r.dataset.variety || r.dataset.crop || r.dataset.key).join() === [...old.keys()].join() };""")
    check("a change to one variety builds one row again; every other row of the list is the row that was there", re["rows"] == seeds["rows"] and re["fresh"] == 1 and re["same"] == seeds["rows"] - 1 and re["built"] == 1 and re["name"].endswith("(checked)"), re)
    js("A.undo()"); wait(600)
    check("the foot of the Seeds list is a short list with a name for each line", seeds["para"] == "DIV" and "Seed counts" in seeds["foot"] and "Vendor size" in seeds["foot"], seeds["foot"])
    page.fill("#sdSearch", "zzzz-no-such"); wait(500)
    emptied = js("return document.querySelectorAll('#sdBody .sd-var').length")
    page.fill("#sdSearch", ""); wait(500)
    refilled = js("const rows = [...document.querySelectorAll('#sdBody tr')]; return { n: rows.length, order: rows.map(r => r.dataset.variety || r.dataset.crop || r.dataset.key).filter(Boolean).length };")
    check("filtering the list away and back leaves it whole and in order", emptied == 0 and refilled["n"] == seeds["rows"], [emptied, refilled, seeds["rows"]])
    check("the plan is as it was found", js("return A.contentKey()") == key0 and js("return S.undo.length") == 0)
    check("the page is light, whatever the computer says", light_only() in ("rgb(230, 236, 232)",), light_only())
    ctx.close()

    # ── a phone has the week and no benches to edit ──
    ctx, page = open_page(390, 844)
    ph = page.evaluate("({ phone: document.body.classList.contains('phone'), bench: !!document.querySelector('.view-sow .bn'), edit: !!document.getElementById('bnEdit') })")
    check("on a phone the week is still the whole page: no bench section", ph["phone"] and not ph["bench"] and not ph["edit"], ph)
    ctx.close()
    check("no error was written to the console", errors == [], errors[:5])
    browser.close()
finish()
