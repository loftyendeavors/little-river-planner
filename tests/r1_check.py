"""Preview 0.31 (R1, where things live) in a real browser: the top bar in three groups, the Nursery in four tabs with the benches
always open on Set-up, nursery and field apart in Tasks with a scope that is remembered, To settle counted in the header,
the weekly amount reached from the head of Harvest and from a crop's row, and the words that had gone stale.
Nothing here works a figure out anew, so every figure on the page is checked against the engine's own.
The page is told it is Wednesday May 5 of the plan's year.
usage: python3 -I r1_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
def fake(y):   # the page's clock: Wednesday May 5 of the plan's year, ten in the morning
    return f"(() => {{ const R = Date, off = new R({y}, 4, 5, 10).getTime() - R.now(); class D extends R {{ constructor(...a) {{ if (a.length) super(...a); else super(R.now() + off); }} static now() {{ return R.now() + off; }} }} window.Date = D; }})();"
# The two halves, written out here and not read from the page: nursery is the raising of the plant, field is planting and seed sown in place.
NURSERY_SOW, NURSERY_JOBS, FIELD_SOW, FIELD_JOBS = ["plugs", "rockwool", "live"], ["potup", "harden"], ["direct"], ["plant", "move"]
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, N = LRFNursery, B = LRFBench, V = LRFSowView, NV = LRFTraysView, T = LRFTrays, $ = id => document.getElementById(id), eng = S.engine, year = A.planYear(), now = T.monday(A.today());"
       f"const NS = {json.dumps(NURSERY_SOW)}, NJ = {json.dumps(NURSERY_JOBS)}, FS = {json.dumps(FIELD_SOW)}, FJ = {json.dumps(FIELD_JOBS)};"
       "const sowOf = () => V.figures().list.filter(l => l.week === now), jobsOf = () => V.jobs().filter(l => l.week === now && !l.passed);"
       "const want = () => ({ nursery: sowOf().filter(l => NS.includes(l.kind)).length + jobsOf().filter(l => NJ.includes(l.section)).length, field: sowOf().filter(l => FS.includes(l.kind)).length + jobsOf().filter(l => FJ.includes(l.section)).length });"
       "const rowsIn = sel => document.querySelectorAll(sel + ' tbody tr[data-line]').length, txt = id => ($(id) || {}).textContent || '';")
STALE = ["Trays view", "Week view", "Sowing view", "Review…", "starting point", "Link reader", "link reader", "Assumptions tab", "Benches…", "supplier page”"]
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def open_page(width, height, ctx=None):
        ctx = ctx or browser.new_context(viewport={"width": width, "height": height}, color_scheme="dark" if DARK else "light")
        page = ctx.new_page(); page.add_init_script(fake(2027))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
        page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
        if backup and page.evaluate("LRFApp.isSample()"):
            page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
        return ctx, page
    ctx, page = open_page(WIDTH, 900)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    wait = lambda ms=350: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0
    def click(sel, ms=400):   # a thing a fault has removed is not clicked: the named line after it fails, and the check goes on
        if not has(sel): wait(100); return False
        page.locator(sel).first.click(); wait(ms); return True
    key0 = js("return A.contentKey()")
    start = js("return { n: S.plan.plantings.length, undo: S.undo.length, today: A.today(), now };")
    check("the page believes it is May 5 of the plan's year, with a plan in it and nothing to undo", start["today"].endswith("-05-05") and start["now"].endswith("-05-03") and start["n"] > 300 and start["undo"] == 0, start)

    # ── the top bar: seven views in three groups ──
    bar = js("""const nav = document.querySelector('nav.views'), kids = [...nav.children].map(e => e.matches('[data-view-btn]') ? e.textContent.trim() : e.className === 'views-sep' ? '|' : '?');
      const top = document.querySelector('header.top'), btns = [...nav.querySelectorAll('button')];
      return { kids, ids: btns.map(b => b.dataset.viewBtn), titles: btns.every(b => (b.title || '').length > 10), clipped: btns.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent),
        seps: [...nav.querySelectorAll('.views-sep')].map(e => { const r = e.getBoundingClientRect(); return r.width >= 1 && r.height >= 8; }), side: top.scrollWidth > top.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, high: top.getBoundingClientRect().height };""")
    check("the top bar reads Map, Timeline, Harvest | Tasks, Nursery, Seeds | Assumptions: three groups with a rule between them", bar["kids"] == ["Map", "Timeline", "Harvest", "|", "Tasks", "Nursery", "Seeds", "|", "Assumptions"] and all(bar["seps"]) and len(bar["seps"]) == 2, bar)
    check("the views keep their ids (the Nursery is still the view 'trays', Tasks still 'sow'), and each says in a tooltip what it is for", bar["ids"] == ["map", "timeline", "harvest", "sow", "trays", "seeds", "assume"] and bar["titles"], bar)
    wait(400)
    crowd = js("""const w = $('waitBadge'), wasHidden = w.hidden, wasHtml = w.innerHTML, s = $('saveState'), wasText = s.textContent;
      w.hidden = false; w.innerHTML = '<b>12</b> to place<span class="wb-more"> · not counted here</span>'; s.textContent = 'Saved · folder + cloud 12:44';
      const top = document.querySelector('header.top'), acts = [...document.querySelectorAll('.top-actions > *')].filter(e => getComputedStyle(e).display !== 'none' && !e.hidden);
      const out = { side: top.scrollWidth > top.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, off: acts.filter(e => e.getBoundingClientRect().right > innerWidth + 1).length, high: top.getBoundingClientRect().height,
        clipped: [...document.querySelectorAll('nav.views button, #waitBadge, #settleBadge')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent), settle: !$('settleBadge').hidden };
      w.hidden = wasHidden; w.innerHTML = wasHtml; s.textContent = wasText; return out;""")
    check("the bar fits on one line with both counts showing and the longest save note: nothing clipped, nothing off the side", not bar["side"] and bar["clipped"] == [] and not crowd["side"] and crowd["off"] == 0 and crowd["clipped"] == [] and crowd["high"] <= 60 and bar["high"] <= 60, [bar, crowd])

    # ── To settle, in the header ──
    st = js("""const b = $('settleBadge'), cs = getComputedStyle(b), w = getComputedStyle($('waitBadge'));
      return { hidden: b.hidden, text: b.textContent, count: LRFPanels.settleCount(), raw: (() => { const c = LRFRails.cleanup(eng); return { groups: c.groups.length, long: new Set(c.long.map(x => x.r.b.gardenId + '|' + x.want + '|' + x.cap)).size }; })(),
        bg: cs.backgroundColor, flagBg: (() => { const p = document.createElement('i'); p.style.background = 'var(--flag-soft)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })(), title: b.title };""")
    n_settle = st["raw"]["groups"] + st["raw"]["long"]
    check("the header counts what waits under To settle: ground booked twice, and plantings longer than their bed a garden at a time", n_settle > 0 and not st["hidden"] and st["text"] == f"{n_settle} to settle" and st["count"] == n_settle, st)
    check("it is quiet: the page's own ink on its own surface, not the colour of a warning, and its tooltip says what it counts", st["bg"] != st["flagBg"] and "booked twice" in st["title"], st)
    page.click('[data-view-btn="sow"]'); wait(500)
    click("#settleBadge", 600)
    went = js("const el = $('toSettle'), host = $('inspectorBody'); return { view: S.view, sel: S.sel, there: !!el, head: el ? el.querySelector('h3').textContent : '', seen: el ? el.getBoundingClientRect().top < innerHeight - 80 && el.getBoundingClientRect().top >= host.getBoundingClientRect().top - 4 : false, fixes: el ? el.querySelectorAll('.fix').length : 0, undo: S.undo.length, key: A.contentKey() };")
    check("a click on it from another view goes to the map with the list in view, whole, and changes nothing", went["view"] == "map" and went["sel"] is None and went["there"] and went["head"] == f"To settle · {n_settle}" and went["seen"] and went["fixes"] == n_settle and went["undo"] == 0 and went["key"] == key0, went)
    # a box above the list comes and goes (pictures being read after a backup is loaded): the list stays where the click put it
    held = js("""const host = $('inspectorBody'), real = A.photoGaps, top = () => { const el = $('toSettle'); return el ? Math.round(el.getBoundingClientRect().top - host.getBoundingClientRect().top) : null; };
      const out = { before: top(), boxBefore: !!$('photoGaps') };
      A.photoGaps = () => ({ map: true, varieties: 3 }); A.emit('photos'); out.withBox = top(); out.box = !!$('photoGaps'); out.boxHigh = $('photoGaps') ? Math.round($('photoGaps').getBoundingClientRect().height) : 0;
      A.photoGaps = real; A.emit('photos'); out.without = top(); out.boxAfter = !!$('photoGaps');
      host.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
      const at = host.scrollTop; A.photoGaps = () => ({ map: true, varieties: 3 }); A.emit('photos'); out.touched = top(); out.same = host.scrollTop === at;
      A.photoGaps = real; A.emit('photos'); out.key = A.contentKey(); out.undo = S.undo.length; return out;""")
    check("a box that comes or goes above the list does not push it out of sight; once the panel is scrolled by hand it is left alone", held["before"] is not None and abs(held["before"]) <= 4 and held["box"] != held["boxBefore"] and held["boxHigh"] > 60 and abs(held["withBox"]) <= 4 and abs(held["without"]) <= 4
          and held["same"] and abs(held["touched"]) > 60 and held["key"] == key0 and held["undo"] == 0, held)
    if click("#toSettle .fix .fix-btn", 700):
        less = js("return { text: $('settleBadge').hidden ? '' : $('settleBadge').textContent, count: LRFPanels.settleCount(), undo: S.undo.length };")
        js("A.undo()"); wait(600)
        again = js("return { text: $('settleBadge').textContent, key: A.contentKey() };")
        check("settling one takes one off the count, and undoing puts it back", less["count"] == n_settle - 1 and less["text"] == (f"{n_settle - 1} to settle" if n_settle > 1 else "") and less["undo"] == 1 and again["text"] == f"{n_settle} to settle" and again["key"] == key0, [less, again])
    else: check("settling one takes one off the count, and undoing puts it back", False, "no fix to press")
    page.screenshot(path=str(shots / f"r1-settle-{WIDTH}.png"))

    # ── the Nursery: four tabs, opening on Bench room ──
    page.click('[data-view-btn="trays"]'); wait(700)
    nu = js("""const tabs = [...document.querySelectorAll('#nuTabs button')];
      return { tab: NV.tab(), title: txt('nuTitle'), eyebrow: document.querySelector('#trWrap .eyebrow').textContent, tabs: tabs.map(b => [b.dataset.tab, b.textContent, b.getAttribute('aria-pressed')]), lead: txt('nuLead').length,
        top: Math.round($('nuTabs').getBoundingClientRect().top), clipped: tabs.filter(b => b.scrollWidth > b.clientWidth + 1).length, library: getComputedStyle(document.querySelector('.library')).display };""")
    check("the view is the Nursery and opens on Bench room, with Live trays, Supplies and Set-up beside it", nu["tab"] == "room" and nu["title"] == "Bench room" and nu["eyebrow"].startswith("Nursery") and nu["tabs"] == [["room", "Bench room", "true"], ["live", "Live trays", "false"], ["supplies", "Supplies", "false"], ["setup", "Set-up", "false"]] and nu["lead"] > 40 and nu["clipped"] == 0, nu)
    room = js("""const f = B.figures(), t = f.tightest, wk = f.weeks.find(w => w.week === now), heat = wk && wk.pools ? wk.pools.heated : null, c = V.weekCounts(now), tiles = [...document.querySelectorAll('#trWrap .tr-stat')].map(e => [...e.children].map(x => x.textContent));
      const mine = { sow: sowOf().filter(l => NS.includes(l.kind) && l.state !== 'done').length, potup: jobsOf().filter(l => l.section === 'potup' && l.state !== 'done').length, harden: jobsOf().filter(l => l.section === 'harden' && l.state !== 'done').length };
      return { tiles, t: t && { used: Math.round(t.used), cap: t.cap }, heat: heat && { used: Math.round(heat.used), cap: heat.cap }, hard: Math.round(f.hardening.most), days: f.hardenDays, c, mine,
        lines: [...document.querySelectorAll('#bnRoom .bn-pools li')].map(l => l.dataset.pool), charts: [...document.querySelectorAll('#bnRoom .bn-chart')].map(x => x.dataset.pool), shown: f.shown, editor: !!$('bnEditor'), supplies: !!$('bnSupplies'), demand: !!document.querySelector('.tr-demand'), close: !!$('bnEditClose'),
        count: (document.querySelector('.bn-count') || {}).textContent, benches: f.benches.filter(b => b.active).length, cap: f.benches.filter(b => b.active).reduce((n, b) => n + b.cap, 0), edit: txt('bnEdit'), where: !!document.querySelector('#bnRoom .bn-where'),
        near: (() => { const a = document.querySelector('#bnRoom .bn-head h3').getBoundingClientRect(), b = $('bnEdit').getBoundingClientRect(); return Math.round(b.left - a.right); })(), fit: [...document.querySelectorAll('#trWrap .tr-stat strong, #trWrap .tr-stat span')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
        side: document.querySelector('.view-trays').scrollWidth > document.querySelector('.view-trays').clientWidth + 1 };""")
    t = room["tiles"]
    check("Bench room has four tiles, each the engine's own figure: the fullest day, the planning week, hardening off at its most", len(t) == 4 and room["t"] and t[0][1] == f"{room['t']['used']} of {room['t']['cap']}" and room["heat"] and t[1][1] == f"{room['heat']['used']} of {room['heat']['cap']}" and "week of May 3" in t[1][0] and t[2][1] == f"{room['hard']} spaces" and f"{room['days']} days before planting out" in t[2][2], [t, room["t"], room["heat"], room["hard"]])
    check("the fourth says what is to do in the nursery this week: sowings in trays and rockwool, potting up, hardening off, counted from the task list", t[3][0] == "This week in the nursery" and room["c"]["sow"] == room["mine"]["sow"] and room["c"]["potup"] == room["mine"]["potup"] and room["c"]["harden"] == room["mine"]["harden"] and room["c"]["nursery"] == sum(room["mine"].values()) and t[3][1] == f"{room['c']['nursery']} to do" and f"{room['mine']['sow']} to sow" in t[3][2] and f"{room['mine']['harden']} to harden off" in t[3][2] and room["mine"]["sow"] > 0, [t[3], room["c"], room["mine"]])
    check("under them a line and a chart for each kind of bench, and where the room is; no benches to edit, no demand, no supplies on this tab", room["lines"][:len(room["shown"])] == room["shown"] and room["charts"] == room["shown"] and room["where"] and not room["editor"] and not room["supplies"] and not room["demand"] and not room["close"], room)
    check("the way to the benches stands beside the heading and the bench count, not across the page", room["count"] == f"{room['benches']} benches · {room['cap']:,} tray spaces" and room["edit"] == "Edit benches and rules" and 0 < room["near"] < 420, [room["count"], room["edit"], room["near"]])
    check("no tile is clipped and the tab does not scroll sideways", room["fit"] == [] and not room["side"], room["fit"])
    page.screenshot(path=str(shots / f"r1-room-{WIDTH}.png"))
    tops = {"room": nu["top"]}
    # Live trays
    click('#nuTabs [data-tab="live"]')
    live = js("""const plans = (S.plan.liveTrayPlans || []).filter(p => p.year === year), f = NV.figures(), kids = [...$('trWrap').children].map(e => e.id || e.className.split(' ')[0]);
      const wk = document.querySelector('.tr-weeks'), last = [...document.querySelectorAll('#trWrap .tr-plan')].pop();
      return { tab: NV.tab(), title: txt('nuTitle'), top: Math.round($('nuTabs').getBoundingClientRect().top), plans: plans.length, sections: document.querySelectorAll('#trWrap .tr-plan').length, rows: document.querySelectorAll('.tr-demand tbody tr').length, wantRows: plans.reduce((n, p) => n + p.rows.length, 0),
        tiles: [...document.querySelectorAll('#trWrap .tr-stat')].map(e => [...e.children].map(x => x.textContent)), trays: f.trays, weeks: document.querySelectorAll('.tr-week tbody tr').length, chips: document.querySelectorAll('.tr-week .tr-chip').length, batches: f.list.length,
        between: wk && last ? kids.slice(kids.indexOf('tr-plan'), kids.indexOf('tr-weeks')).filter(k => !['tr-plan', 'tr-more', 'tr-callout'].includes(k)) : null, bench: !!document.querySelector('#trWrap .bn'), supplies: !!$('bnSupplies'), link: txt('trToTasks') };""")
    tops["live"] = live["top"]
    check("Live trays holds the demand plans with their four tiles, and nothing of the benches or the supplies", live["tab"] == "live" and live["title"] == "Live trays" and live["sections"] == max(1, live["plans"]) and live["rows"] == live["wantRows"] and len(live["tiles"]) == 4 and live["tiles"][0][0] == "Trays this season" and live["tiles"][0][1] == f"{live['trays']:,}" and not live["bench"] and not live["supplies"], live)
    if live["plans"]:
        check("the same batches week by week come directly under the demand they are worked out from, with nothing between", live["between"] == [] and live["weeks"] > 0 and live["chips"] == live["batches"] and live["link"] == "Record what was sown, in Tasks", live)
    else: check("with no demand yet the tab opens on the way to start a plan", has("#trWrap .tr-empty"), live)
    page.screenshot(path=str(shots / f"r1-live-{WIDTH}.png"))
    # Supplies
    click('#nuTabs [data-tab="supplies"]')
    sup = js("""const s = N.supplies(eng, year, (S.plan.lrfNext || {}).supplies || null), rows = [...document.querySelectorAll('#bnSupplies tbody tr')].filter(r => r.dataset.supply !== 'mix');
      return { tab: NV.tab(), title: txt('nuTitle'), top: Math.round($('nuTabs').getBoundingClientRect().top), want: s.rows.map(r => [r.id, String(r.need)]), got: rows.map(r => [r.dataset.supply, r.children[1].textContent.replace(/,/g, '')]), bench: !!document.querySelector('#trWrap .bn'), demand: !!document.querySelector('.tr-demand'), tiles: document.querySelectorAll('#trWrap .tr-stat').length };""")
    tops["supplies"] = sup["top"]
    check("Supplies is the supplies table and nothing else, row for row the nursery's own count", sup["tab"] == "supplies" and sup["title"] == "Supplies" and sup["got"] == sup["want"] and len(sup["want"]) >= 3 and not sup["bench"] and not sup["demand"], sup)
    # Set-up
    click('#nuTabs [data-tab="setup"]')
    su = js("""const list = eng.benchList(), rows = [...document.querySelectorAll('#bnEditor tbody tr')];
      return { tab: NV.tab(), title: txt('nuTitle'), top: Math.round($('nuTabs').getBoundingClientRect().top), rows: rows.length, list: list.length, boxes: [...document.querySelectorAll('#bnSetup .bn-edit')].map(b => [b.id, (b.querySelector('.bn-edit-head h3') || {}).textContent]), lines: [...document.querySelectorAll('#bnSetup .bn-pools li')].map(l => l.dataset.pool),
        order: (() => { const a = document.querySelector('#bnSetup .bn-pools'), b = $('bnEditor'), c = $('bnRules'); return !!a && !!b && !!c && !!(a.compareDocumentPosition(b) & 4) && !!(b.compareDocumentPosition(c) & 4); })(), harden: $('bnHarden') && $('bnHarden').closest('#bnRules') ? $('bnHarden').value : null, cool: !!($('bnCool') && $('bnCool').closest('#bnRules')), packing: !!($('bnPacking') && $('bnPacking').closest('#bnEditor')),
        counted: [...document.querySelectorAll('#bnCount .bn-facts dt')].map(e => e.textContent), close: !!$('bnEditClose'), toggle: !!$('bnEdit'), charts: document.querySelectorAll('#bnSetup .bn-chart').length, key: A.contentKey(), undo: S.undo.length, days: String(eng.hardenDays()),
        wide: !$('bnEditor') || !$('bnEditor').querySelector('table') || $('bnEditor').querySelector('table').scrollWidth > $('bnEditor').querySelector('.tr-scroll').clientWidth + 1, side: document.querySelector('.view-trays').scrollWidth > document.querySelector('.view-trays').clientWidth + 1 };""")
    tops["setup"] = su["top"]
    check("Set-up is always open: every bench in a table with no button to press first and nothing to close", su["tab"] == "setup" and su["title"] == "Set-up" and su["rows"] == su["list"] and su["rows"] > 0 and not su["close"] and not su["toggle"] and not su["wide"] and not su["side"], su)
    check("it has three subjects under their own names, in this order: the benches, hardening off and growing on, how trays and crates are counted", su["boxes"] == [["bnEditor", "Benches"], ["bnRules", "Hardening off and growing on"], ["bnCount", "How trays and crates are counted"]] and su["packing"] and su["harden"] == su["days"] and su["cool"] and "Shared trays" in su["counted"], su)
    check("a line of the room the benches give stands above them, so a change shows where it is made; the charts stay on Bench room", su["lines"][:1] == ["heated"] and su["order"] and su["charts"] == 0, su)
    check("the tabs stay where they are from one to the next: the title above them is one line on each", len(set(tops.values())) == 1, tops)
    check("looking at all four changes nothing in the plan", su["key"] == key0 and su["undo"] == 0)
    # a change on Set-up shows in the line above it, and is one undoable step
    n = su["rows"]
    if has(f"#bnEditor tbody tr:nth-child({n}) [data-f=kind]"):
        page.select_option(f"#bnEditor tbody tr:nth-child({n}) [data-f=kind]", "outside"); wait(550)
    moved = js("return { lines: [...document.querySelectorAll('#bnSetup .bn-pools li')].map(l => l.dataset.pool), toast: $('toast').firstChild ? $('toast').firstChild.textContent : '', focus: document.activeElement && document.activeElement.getAttribute('aria-label'), tab: NV.tab(), undo: S.undo.length, kind: eng.benchList().pop().kind };")
    check("a bench set outside there is one step: the toast says what it does to the room, the line above gains the benches outside, and the cursor stays in the field", moved["kind"] == "outside" and "outside 0 →" in moved["toast"] and "outside" in moved["lines"] and moved["focus"] == f"Bench {n}: kind" and moved["tab"] == "setup" and moved["undo"] == 1, moved)
    click('#nuTabs [data-tab="room"]')
    two = js("return { charts: [...document.querySelectorAll('#bnRoom .bn-chart')].map(x => x.dataset.pool), tile: document.querySelector('#trWrap .tr-stat span').textContent };")
    js("A.undo()"); wait(500)
    one = js("return { charts: [...document.querySelectorAll('#bnRoom .bn-chart')].map(x => x.dataset.pool), key: A.contentKey(), tile: document.querySelector('#trWrap .tr-stat span').textContent };")
    check("Bench room then draws a chart for the benches outside, and undoing takes it away again", two["charts"] == ["heated", "outside"] and two["tile"] == "Heated benches, fullest" and one["charts"] == ["heated"] and one["tile"] == "Benches at their fullest" and one["key"] == key0, [two, one])
    click("#bnEdit")
    check("“Edit benches and rules” on Bench room goes to Set-up", js("return NV.tab()") == "setup" and has("#bnEditor"))
    page.screenshot(path=str(shots / f"r1-setup-{WIDTH}.png"))
    js("B.openEditor(false);"); wait(300)
    check("what was written for the old toggle still works: shutting the benches is going back to Bench room, opening them is Set-up", js("return NV.tab()") == "room" and js("B.openEditor(true); return NV.tab();") == "setup")
    # the way from the Nursery to its list in Tasks
    click('#nuTabs [data-tab="room"]'); click("#nuToTasks", 600)
    to = js("return { view: S.view, scope: V.scope(), title: txt('wkTitle'), pressed: [...document.querySelectorAll('#wkScope button')].map(b => b.getAttribute('aria-pressed')) };")
    check("“Open the nursery’s list” on Bench room goes to Tasks with only the nursery’s tasks listed", to["view"] == "sow" and to["scope"] == "nursery" and to["title"] == "This week in the nursery" and to["pressed"] == ["false", "true", "false"], to)
    js("V.setScope('all');"); wait(300)

    # ── Tasks: nursery and field apart ──
    tk = js("""const halves = [...document.querySelectorAll('.view-sow .sw-wrap > .wk-half')], w = want();
      const kinds = h => [...h.querySelectorAll(':scope > section')].map(s => s.dataset.kind), lines = [...document.querySelectorAll('.view-sow .sw-wrap > .wk-half tbody tr[data-line]')].map(r => r.dataset.line);
      return { scope: V.scope(), title: txt('wkTitle'), halves: halves.map(h => ({ id: h.dataset.half, head: (h.querySelector('.wk-half-head h3') || {}).textContent, note: (h.querySelector('.wk-half-head span') || {}).textContent, about: (h.querySelector('.wk-half-head small') || {}).textContent || '', kinds: kinds(h), rows: h.querySelectorAll('tbody tr[data-line]').length })),
        want: w, lines: lines.length, unique: new Set(lines).size, scopeBtns: [...document.querySelectorAll('#wkScope button')].map(b => [b.dataset.scope, b.textContent, b.getAttribute('aria-pressed')]), chips: [...document.querySelectorAll('#wkKinds .chip')].map(c => c.textContent),
        bench: !!document.querySelector('.view-sow .bn'), line: txt('bnLine'), print: txt('wkPrint'), tiles: [...document.querySelectorAll('.sw-stats .tr-stat')].map(e => [...e.children].map(x => x.textContent)),
        rule: halves.map(h => { const hd = h.querySelector('.wk-half-head'); return hd ? parseFloat(getComputedStyle(hd).borderBottomWidth) : 0; }), side: document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1 };""")
    hv = {h["id"]: h for h in tk["halves"]}
    check("with everything listed the week is in two halves under their own headings, Nursery first and Field after it, each ruled off", [h["id"] for h in tk["halves"]] == ["nursery", "field"] and hv["nursery"]["head"] == "Nursery" and hv["field"]["head"] == "Field" and all(r >= 2 for r in tk["rule"]) and tk["scopeBtns"] == [["all", "Everything", "true"], ["nursery", "Nursery", "false"], ["field", "Field", "false"]] and tk["title"] == "This week’s tasks", tk)
    check("the nursery's half is the raising of the plant: sowing in trays and rockwool, live trays, potting up, hardening off, and nothing else", "nursery" in hv and set(hv["nursery"]["kinds"]) <= set(NURSERY_SOW + NURSERY_JOBS) and hv["nursery"]["kinds"] == [k for k in NURSERY_SOW + NURSERY_JOBS if k in hv["nursery"]["kinds"]] and hv["nursery"]["rows"] == tk["want"]["nursery"] and tk["want"]["nursery"] > 0 and "Raising the plant" in hv["nursery"]["about"], hv.get("nursery"))
    check("the field's half is planting, wherever the plant goes, with seed sown in the ground and crates moved out", "field" in hv and set(hv["field"]["kinds"]) <= set(FIELD_SOW + FIELD_JOBS) and hv["field"]["kinds"] == [k for k in FIELD_SOW + FIELD_JOBS if k in hv["field"]["kinds"]] and hv["field"]["rows"] == tk["want"]["field"] and tk["want"]["field"] > 0 and "towers" in hv["field"]["about"], hv.get("field"))
    check("every task of the week is in one half and only one, and each heading says how many it holds", tk["lines"] == tk["want"]["nursery"] + tk["want"]["field"] and tk["unique"] == tk["lines"] and hv["nursery"]["note"] == f"{tk['want']['nursery']} tasks" and hv["field"]["note"] == f"{tk['want']['field']} tasks", [tk["lines"], tk["want"], hv["nursery"]["note"], hv["field"]["note"]])
    check("the kinds to narrow by are on a row of their own, the nursery's before the field's, and the first no longer reads like the scope", tk["chips"][0] == "All kinds" and tk["chips"][1:] == [c for c in ["Seedling trays", "Tower seedlings", "Live trays", "Pot up", "Harden off", "Sown in the ground", "Plant out", "Move out"] if c in tk["chips"]] and len(tk["chips"]) >= 4, tk["chips"])
    check("the bench chart is gone from the foot of Tasks: one line says what stands on the benches this week", not tk["bench"] and "On the benches this week" in tk["line"] and "Bench room, in Nursery" in tk["line"] and not tk["side"], [tk["bench"], tk["line"]])
    lineOk = js("const f = B.figures(), wk = f.weeks.find(w => w.week === now), p = wk.pools.heated, t = [...document.querySelectorAll('#bnLine span[data-pool]')].map(x => [x.dataset.pool, x.textContent]); return { t, used: Math.round(p.used), cap: p.cap };")
    check("that line is the engine's figure for the week", lineOk["t"] and lineOk["t"][0][0] == "heated" and f"{lineOk['used']} of {lineOk['cap']}" in lineOk["t"][0][1], lineOk)
    page.screenshot(path=str(shots / f"r1-tasks-all-{WIDTH}.png"))
    allT = js("const e = V.figures().list.filter(l => l.week < now && l.state !== 'done').length + V.jobs().filter(l => l.week < now && l.state !== 'done').length; return { early: e, season: [...document.querySelectorAll('.sw-stats .tr-stat strong')][5].textContent, earlyTile: [...document.querySelectorAll('.sw-stats .tr-stat strong')][4].textContent };")
    # Nursery only
    click('#wkScope [data-scope="nursery"]')
    COUNT = """const sow = sowOf(), jobs = jobsOf(), inN = l => l.kind ? NS.includes(l.kind) : false, e = (ks, js) => V.figures().list.filter(l => l.week < now && l.state !== 'done' && ks.includes(l.kind)).length + V.jobs().filter(l => l.week < now && l.state !== 'done' && js.includes(l.section)).length;
      const tiles = [...document.querySelectorAll('.sw-stats .tr-stat')].map(x => [...x.children].map(c => c.textContent)), sheet = V.sheet();
      const base = { scope: V.scope(), title: txt('wkTitle'), rows: rowsIn('.view-sow .sw-wrap > .wk-half'), heads: document.querySelectorAll('.view-sow .wk-half-head').length, kinds: [...document.querySelectorAll('.view-sow .sw-wrap > .wk-half > section')].map(s => s.dataset.kind), tiles, chips: [...document.querySelectorAll('#wkKinds .chip')].map(c => c.textContent), print: txt('wkPrint'),
        sheet: { h1: sheet.querySelector('h1').textContent, scope: sheet.dataset.scope, rows: sheet.querySelectorAll('table')[0] ? sheet.querySelectorAll('table')[0].querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)').length : 0, halves: sheet.querySelectorAll('tr.wkp-half').length, heads: [...sheet.querySelectorAll('tr.wkp-head')].map(r => r.textContent) },
        line: !!$('bnLine'), summary: (document.querySelector('.sw-earlier summary b') || {}).textContent || '', none: (document.querySelector('.sw-none') || {}).textContent || '' };"""
    nur = js(COUNT + """ return { ...base, want: want().nursery, sow: sow.filter(l => NS.includes(l.kind)), jobsOpen: jobs.filter(l => NJ.includes(l.section) && l.state !== 'done').length, early: e(NS, NJ),
        season: V.figures().list.filter(l => NS.includes(l.kind)).length + V.jobs().filter(l => NJ.includes(l.section) && !l.passed).length, sowOpen: sow.filter(l => NS.includes(l.kind) && l.state !== 'done').length, sowN: sow.filter(l => NS.includes(l.kind)).length, sheetWant: sow.filter(l => NS.includes(l.kind)).length + jobs.filter(l => NJ.includes(l.section)).length };""")
    nur.pop("sow", None)
    check("Nursery lists the nursery's tasks and no other, with no half heading to repeat what the title says", nur["scope"] == "nursery" and nur["title"] == "This week in the nursery" and nur["rows"] == nur["want"] and nur["heads"] == 0 and set(nur["kinds"]) <= set(NURSERY_SOW + NURSERY_JOBS) and len(nur["kinds"]) >= 2, nur)
    check("its tiles count that half alone: what is to sow, the other tasks, what is earlier and not recorded, the season", nur["tiles"][0][1] == f"{nur['sowOpen']} to sow" and nur["tiles"][3][1] == f"{nur['jobsOpen']} to do" and nur["tiles"][4][1] == f"{nur['early']:,}" and nur["tiles"][5][1].endswith(f"of {nur['season']:,}") and "in the nursery" in nur["summary"], [nur["tiles"], nur["sowOpen"], nur["jobsOpen"], nur["early"], nur["season"]])
    check("the kinds offered are the nursery's only, and the line of bench room stays", all(c not in nur["chips"] for c in ("Sown in the ground", "Plant out", "Move out")) and nur["chips"][0] == "All kinds" and nur["line"], nur["chips"])
    check("the sheet to print is the nursery's: named so, its rows the rows on the page, set out by task with no halves to head", nur["print"] == "Print the nursery sheet" and nur["sheet"]["h1"].startswith("Nursery, week of May 3") and nur["sheet"]["scope"] == "nursery" and nur["sheet"]["rows"] == nur["sheetWant"] and nur["sheet"]["halves"] == 0 and "Plant out" not in nur["sheet"]["heads"] and "Harden off" in nur["sheet"]["heads"], nur["sheet"])
    page.evaluate("(() => { window.__printed = null; window.print = () => { const s = document.querySelector('#printSheet .wkp'); window.__printed = { h1: s.querySelector('h1').textContent, rows: s.querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)').length }; }; })()")
    click("#wkPrint", 300)
    pr = page.evaluate("window.__printed")
    check("and the button prints exactly that", pr is not None and pr["h1"].startswith("Nursery, week of") and pr["rows"] == nur["sheetWant"], pr)
    wait(1700)
    page.screenshot(path=str(shots / f"r1-tasks-nursery-{WIDTH}.png"))
    # a kind within the half
    if has('#wkKinds .chip[data-kind="harden"]'):
        click('#wkKinds .chip[data-kind="harden"]')
        only = js("return { kinds: [...document.querySelectorAll('.view-sow .sw-wrap > .wk-half > section')].map(s => s.dataset.kind), rows: rowsIn('.view-sow .sw-wrap > .wk-half'), want: jobsOf().filter(l => l.section === 'harden').length };")
        click('#wkScope [data-scope="field"]')
        reset = js("return { pressed: (document.querySelector('#wkKinds .chip[aria-pressed=true]') || {}).textContent, scope: V.scope() };")
        check("a kind narrows the half to that kind, and changing the half goes back to all of its kinds", only["kinds"] == ["harden"] and only["rows"] == only["want"] and only["want"] > 0 and reset["pressed"] == "All kinds" and reset["scope"] == "field", [only, reset])
    else:
        check("a kind narrows the half to that kind, and changing the half goes back to all of its kinds", False, "no Harden off chip this week")
        click('#wkScope [data-scope="field"]')
    fld = js(COUNT + """ return { ...base, want: want().field, jobsOpen: jobs.filter(l => FJ.includes(l.section) && l.state !== 'done').length, early: e(FS, FJ), season: V.figures().list.filter(l => FS.includes(l.kind)).length + V.jobs().filter(l => FJ.includes(l.section) && !l.passed).length,
        sowOpen: sow.filter(l => FS.includes(l.kind) && l.state !== 'done').length, sheetWant: sow.filter(l => FS.includes(l.kind)).length + jobs.filter(l => FJ.includes(l.section)).length, towers: jobs.filter(l => l.section === 'plant' && l.members.some(m => m.r.tw)).length };""")
    check("a subject is found: this week the field has seed to sow in the ground as well as planting out, so its tiles and its kinds have something to count", fld["sowOpen"] > 0 and "plant" in fld["kinds"] and len(fld["kinds"]) >= 2, [fld["sowOpen"], fld["kinds"]])
    check("Field lists planting, seed sown in the ground and moving out, and no other; tower planting is field work", fld["scope"] == "field" and fld["title"] == "This week in the field" and fld["rows"] == fld["want"] and fld["heads"] == 0 and set(fld["kinds"]) <= set(FIELD_SOW + FIELD_JOBS) and "plant" in fld["kinds"] and fld["towers"] > 0, fld)
    check("its tiles, its sheet and its print button are the field's, and it shows no line of bench room", fld["tiles"][0][1] == f"{fld['sowOpen']} to sow" and fld["tiles"][3][1] == f"{fld['jobsOpen']} to do" and fld["tiles"][4][1] == f"{fld['early']:,}" and fld["print"] == "Print the field sheet" and fld["sheet"]["h1"].startswith("Field, week of") and fld["sheet"]["rows"] == fld["sheetWant"] and "Harden off" not in fld["sheet"]["heads"] and not fld["line"], fld)
    check("the two halves add up to the whole: this week, earlier and not recorded, and the season", nur["want"] + fld["want"] == tk["lines"] and nur["early"] + fld["early"] == allT["early"] and allT["earlyTile"] == f"{allT['early']:,}" and allT["season"].endswith(f"of {nur['season'] + fld['season']:,}"), [nur["want"], fld["want"], tk["lines"], nur["early"], fld["early"], allT])
    page.screenshot(path=str(shots / f"r1-tasks-field-{WIDTH}.png"))
    # remembered
    click('#wkSpan [data-span="2"]')
    kept = page.evaluate("localStorage.getItem('lrf-next:tasks')")
    js("NV.setTab('supplies');"); wait(400)   # the Nursery is left on another tab: a new visit must not find it there
    page.reload(); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); wait(900)
    page.click('[data-view-btn="sow"]'); wait(600)
    rem = js("return { scope: V.scope(), span: V.span(), title: txt('wkTitle'), pressed: [...document.querySelectorAll('#wkScope button')].map(b => b.getAttribute('aria-pressed')), nursery: NV.tab(), key: A.contentKey() };")
    check("which half is shown, and how far ahead, are remembered in the browser from one visit to the next; nothing of it is in the plan", json.loads(kept or "{}") == {"scope": "field", "span": 2} and rem["scope"] == "field" and rem["span"] == 2 and rem["title"] == "2 weeks in the field" and rem["pressed"] == ["false", "false", "true"] and rem["key"] == key0, [kept, rem])
    check("the Nursery opens on Bench room again at each visit", rem["nursery"] == "room", rem["nursery"])
    click('#wkSpan [data-span="1"]'); click('#wkScope [data-scope="nursery"]')
    # recording still works inside a half
    rec = js("const l = sowOf().find(x => x.state === 'open' && NS.includes(x.kind) && x.kind !== 'live'); return l ? { key: l.key, ids: l.members.map(m => m.p.id), todo: V.weekCounts(now) } : null;")
    if rec and has(f'table.sw tbody tr[data-line={json.dumps(rec["key"])}] input[type=checkbox]'):
        page.locator(f'table.sw tbody tr[data-line={json.dumps(rec["key"])}] input[type=checkbox]').check(); wait(450)
        barTxt = js("const b = document.querySelector('.sw-record'); return b ? b.querySelector('b').textContent : '';")
        click("#swRecord", 900)
        done = js(f"const ps = {json.dumps(rec['ids'])}.map(id => eng.planting(id)); return {{ done: ps.every(p => p.done && (p.done.sow || p.done.field)), undo: S.undo.length, todo: V.weekCounts(now), state: (document.querySelector('table.sw tbody tr[data-line=' + JSON.stringify({json.dumps(rec['key'])}) + ']') || {{ dataset: {{}} }}).dataset.state }};")
        js("A.undo()"); wait(600)
        check("a task ticked in the nursery's list is recorded as it always was, in one step that undoes", barTxt == "1 sowing ticked" and done["done"] and done["undo"] == 1 and js("return A.contentKey()") == key0, [barTxt, done])
        check("and what the Nursery says is still to do that week goes down by that one", done["todo"]["sow"] == rec["todo"]["sow"] - 1 and done["todo"]["nursery"] == rec["todo"]["nursery"] - 1 and done["todo"]["field"] == rec["todo"]["field"], [rec["todo"], done["todo"]])
    else: check("a task ticked in the nursery's list is recorded as it always was, in one step that undoes", False, rec)
    js("V.setScope('all');"); wait(300)
    # an empty half says so in its own words
    emptyWeek = js("const weeks = new Set([...V.figures().list.filter(l => NS.includes(l.kind)).map(l => l.week), ...V.jobs().filter(l => NJ.includes(l.section) && !l.passed).map(l => l.week)]); for (let d = E.s2d(year + '-12-27'); d.getFullYear() === year; d = E.addDays(d, -7)) { const w = T.monday(E.d2s(d)); if (!weeks.has(w)) return w; } return null;")
    if emptyWeek:
        js(f"V.setScope('nursery'); A.setDate(E.s2d({json.dumps(emptyWeek)}));"); wait(500)
        none = js("return { text: (document.querySelector('.sw-none') || {}).textContent || '', rows: rowsIn('.view-sow .sw-wrap > .wk-half') };")
        check("a week with nothing in the nursery says so, in the nursery's name", "Nothing is planned in the nursery" in none["text"] and none["rows"] == 0, none)
        js("V.setScope('all'); A.setDate(E.s2d(A.today()));"); wait(400)

    # ── the ways into Live trays from the plan ──
    page.click('[data-view-btn="timeline"]'); wait(700)
    strip = js("const row = document.querySelector('.tl-row.tl-strip'); if (!row) return null; row.scrollIntoView({ block: 'center' }); const r = row.querySelector('.tl-lane').getBoundingClientRect(), s = $('tlScroll').getBoundingClientRect(); return { x: Math.max(r.left, s.left + 150) + 40, y: r.top + r.height / 2, title: row.title };")
    if strip:
        wait(200)
        strip = js("const row = document.querySelector('.tl-row.tl-strip'), r = row.querySelector('.tl-lane').getBoundingClientRect(), s = $('tlScroll').getBoundingClientRect(); return { x: Math.max(r.left, s.left + 150) + 40, y: r.top + r.height / 2, title: row.title };")
        page.mouse.click(strip["x"], strip["y"]); wait(500)
        got = js("return { view: S.view, tab: NV.tab(), title: txt('nuTitle') };")
        check("a click on the timeline's strip of live trays goes to Live trays in the Nursery, and its tooltip says so", got["view"] == "trays" and got["tab"] == "live" and got["title"] == "Live trays" and "in the Nursery view" in strip["title"], [got, strip["title"]])
        batch = js("const p = S.plan.plantings.find(p => p.liveTray && String(p.date).slice(0, 4) === String(year)); return p ? p.id : null;")
        if batch:
            js(f"NV.setTab('room'); A.setView('timeline'); A.select({{ type: 'planting', id: {json.dumps(batch)} }});"); wait(600)
            click("#fToLive", 500)
            got2 = js("return { view: S.view, tab: NV.tab() };")
            check("a tray batch's panel leads there too", got2["view"] == "trays" and got2["tab"] == "live", got2)
            js("A.select(null);")
    else: check("a click on the timeline's strip of live trays goes to Live trays in the Nursery (this plan has no tray demand: nothing to click)", not js("return (S.plan.liveTrayPlans || []).some(p => p.year === year)"))

    # ── Harvest: the weekly amount, from the head of the page and from a crop's row ──
    page.click('[data-view-btn="harvest"]'); wait(800)
    hvw = js("""const head = document.querySelector('.hv-head-acts'), bar = document.querySelector('.hv-bar'), tops = [...bar.children].map(c => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2));
      const rows = [...document.querySelectorAll('#hvTable tr.hv-row')], plans = [...document.querySelectorAll('#hvTable .hv-plan')];
      const can = id => { const c = eng.crop(id); return !!c && !c.micro && +c.dtm > 0 && !eng.isCoverCrop(c); };
      return { acts: head ? [...head.children].map(b => [b.id, b.textContent]) : null, oneLine: Math.max(...tops) - Math.min(...tops) <= 14, inBar: !!bar.querySelector('#hvShareBtn, #hvPlanBar'), near: head ? Math.round(head.getBoundingClientRect().right - document.querySelector('.hv-bar').getBoundingClientRect().right) : null,
        clipped: head ? [...head.children].filter(b => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > innerWidth).length : -1, rows: rows.length, want: rows.filter(r => can(r.dataset.crop)).map(r => r.dataset.crop), got: plans.map(p => p.dataset.crop),
        micro: rows.filter(r => { const c = eng.crop(r.dataset.crop); return c && c.micro; }).filter(r => r.querySelector('.hv-plan')).length, hidden: plans.length ? getComputedStyle(plans[0]).opacity : null, side: document.documentElement.scrollWidth > innerWidth + 1 };""")
    check("at the head of Harvest stand the two things done from it: plan to a weekly amount, and a list to send; the bar under the tiles keeps to one line", hvw["acts"] == [["hvPlanBar", "Plan to a weekly amount…"], ["hvShareBtn", "A list to send…"]] and hvw["oneLine"] and not hvw["inBar"] and hvw["clipped"] == 0 and not hvw["side"], hvw)
    check("every crop that can be planned to an amount has “plan…” on its row, tray crops have none, and it shows only when the row is pointed at", hvw["got"] == hvw["want"] and len(hvw["want"]) > 5 and hvw["micro"] == 0 and hvw["hidden"] == "0", hvw)
    if hvw["want"]:
        cid = hvw["want"][min(3, len(hvw["want"]) - 1)]
        page.locator(f'#hvTable tr.hv-row[data-crop={json.dumps(cid)}]').hover(); wait(250)
        seen = js(f"const b = document.querySelector('#hvTable tr.hv-row[data-crop=' + JSON.stringify({json.dumps(cid)}) + '] .hv-plan'), r = b.getBoundingClientRect(), c = b.closest('td').getBoundingClientRect(); return {{ opacity: getComputedStyle(b).opacity, inside: r.left >= c.left - 1 && r.right <= c.right + 1, label: b.getAttribute('aria-label') }};")
        page.locator(f'#hvTable tr.hv-row[data-crop={json.dumps(cid)}] .hv-plan').click(); wait(800)
        tool = js("const by = document.querySelector('#srBy [data-by=harvest]'); return { view: S.view, sel: S.sel && S.sel.type, by: by ? by.getAttribute('aria-pressed') : null, crop: ($('srCrop') || {}).value, want: !!$('srWant'), undo: S.undo.length, key: A.contentKey() };")
        check("pointed at, it shows inside the crop's cell; pressed, it opens the series tool on that crop, asked by the weekly amount, and adds nothing", seen["opacity"] == "1" and seen["inside"] and "weekly amount" in seen["label"] and tool["view"] == "timeline" and tool["sel"] == "series" and tool["by"] == "true" and tool["want"] and tool["undo"] == 0 and tool["key"] == key0, [seen, tool, cid])
        check("and on the crop of that row", js(f"return LRFSeries.state.P.cropId === {json.dumps(cid)} && ($('srCrop') || {{}}).value === {json.dumps(cid)} && LRFSeries.state.P.by === 'harvest';"), cid)
        js("A.select(null);"); wait(300)
    page.click('[data-view-btn="harvest"]'); wait(600)
    click("#hvPlanBar", 800)
    tool2 = js("const by = document.querySelector('#srBy [data-by=harvest]'); return { view: S.view, sel: S.sel && S.sel.type, by: by ? by.getAttribute('aria-pressed') : null, want: !!$('srWant'), error: txt('srError'), undo: S.undo.length };")
    check("the button at the head opens the same tool, by the weekly amount, on a crop and not on a blank", tool2["view"] == "timeline" and tool2["sel"] == "series" and tool2["by"] == "true" and tool2["want"] and "Choose a crop" not in tool2["error"] and tool2["undo"] == 0, tool2)
    js("A.select(null);"); wait(300)
    page.click('[data-view-btn="harvest"]'); wait(500)
    page.screenshot(path=str(shots / f"r1-harvest-{WIDTH}.png"))

    # ── the words: nothing on any page names a view or a button that is gone ──
    seen_text = {}
    def sweep(name):
        seen_text[name] = js("return [document.querySelector('header.top').innerText, document.querySelector('main.work').innerText, ...[...document.querySelectorAll('main.work [title], header.top [title]')].map(e => e.title), ...[...document.querySelectorAll('main.work [aria-label]')].map(e => e.getAttribute('aria-label'))].join(' ⏎ ');")
    for view in ("map", "timeline", "harvest", "sow", "assume", "seeds"):
        page.click(f'[data-view-btn="{view}"]'); wait(700 if view != "seeds" else 1300); sweep(view)
    js("LRFAssume.setMode('harvest');"); wait(500); sweep("assume-yield"); js("LRFAssume.setMode('days');")
    page.click('[data-view-btn="trays"]'); wait(500)
    for tabname in ("room", "live", "supplies", "setup"):
        js(f"NV.setTab('{tabname}');"); wait(350); sweep("nursery-" + tabname)
    js("NV.setTab('room');")
    stale = sorted({f"{w} ({v})" for v, text in seen_text.items() for w in STALE if w in text})
    check("no page still says Trays view, Week view, Review…, starting point, Link reader, Assumptions tab or Benches…", stale == [] and all(len(t) > 200 for t in seen_text.values()), stale[:8])
    filt = js("A.setView('seeds'); return 0;"); wait(1200)
    chip = js("return [...document.querySelectorAll('#sdFilters .chip, #sdFilters button')].map(b => b.textContent.replace(/[0-9,]+$/, '').trim());")
    check("the Seeds filter for varieties whose days have no stated start says so in the planner's present words", "Days counted from: not said" in chip and not any("starting point" in c for c in chip), chip)
    fitc = js("const f = $('sdFilters'); return { wide: f.scrollWidth > f.clientWidth + 1, clipped: [...f.querySelectorAll('button')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent), side: document.documentElement.scrollWidth > innerWidth + 1 };")
    check("and the longer name still fits its row", not fitc["wide"] and fitc["clipped"] == [] and not fitc["side"], fitc)
    page.click('[data-view-btn="map"]'); wait(400)
    end = js("return { key: A.contentKey(), undo: S.undo.length, n: S.plan.plantings.length, bg: getComputedStyle(document.body).backgroundColor };")
    check("after all of it the plan is as it was found", end["key"] == key0 and end["undo"] == 0 and end["n"] == start["n"], end)
    check("the page is light, whatever the computer says", end["bg"] == "rgb(230, 236, 232)", end["bg"])
    page.evaluate("localStorage.removeItem('lrf-next:tasks')")
    ctx.close()

    # ── a phone: the week is still the whole page, now in its two halves ──
    ctx, page = open_page(390, 844)
    js = lambda body: page.evaluate("(() => { " + PRE + " " + body + " })()")
    ph = js("""const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0, sc = $('wkScope');
      return { phone: document.body.classList.contains('phone'), view: S.view, halves: [...document.querySelectorAll('.view-sow .sw-wrap > .wk-half')].map(h => h.dataset.half), scope: vis(sc), btn: sc ? Math.min(...[...sc.querySelectorAll('button')].map(b => b.getBoundingClientRect().height)) : 0,
        inside: sc ? sc.getBoundingClientRect().right <= innerWidth + 1 && sc.getBoundingClientRect().left >= 0 : false, settle: vis($('settleBadge')), line: !!$('bnLine'), bench: !!document.querySelector('.view-sow .bn'), nav: vis(document.querySelector('nav.views')),
        side: document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1, top: document.querySelector('header.top').getBoundingClientRect().height, rows: rowsIn('.view-sow .sw-wrap > .wk-half'), want: want() };""")
    check("on a phone the week is still the whole page, in its two halves, with nothing running off sideways and the header on one line", ph["phone"] and ph["view"] == "sow" and ph["halves"] == ["nursery", "field"] and ph["rows"] == ph["want"]["nursery"] + ph["want"]["field"] and not ph["side"] and not ph["nav"] and ph["top"] <= 60, ph)
    check("which half to show can be chosen there with a thumb; the count to settle, the bench line and the chart are left off", ph["scope"] and ph["inside"] and ph["btn"] >= 34 and not ph["settle"] and not ph["line"] and not ph["bench"], ph)
    if has('#wkScope [data-scope="nursery"]'):
        page.locator('#wkScope [data-scope="nursery"]').click(); page.wait_for_timeout(500)
    pn = js("return { scope: V.scope(), rows: rowsIn('.view-sow .sw-wrap > .wk-half'), want: want().nursery, title: txt('wkTitle'), side: document.documentElement.scrollWidth > innerWidth + 1 };")
    check("a tap on Nursery lists the nursery's tasks alone", pn["scope"] == "nursery" and pn["rows"] == pn["want"] and pn["title"] == "This week in the nursery" and not pn["side"], pn)
    page.screenshot(path=str(shots / "r1-phone.png"))
    page.evaluate("localStorage.removeItem('lrf-next:tasks')")
    ctx.close()
    check("no error was written to the console", errors == [], errors[:5])
    browser.close()
finish()
