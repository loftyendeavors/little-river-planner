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

    # ── the top bar: eight views in three groups (Successions joined the first in 0.84) ──
    bar = js("""const nav = document.querySelector('nav.views'), kids = [...nav.children].map(e => e.matches('[data-hook="view-tab"]') ? e.textContent.trim() : e.className === 'views-sep' ? '|' : '?');
      const top = document.querySelector('header.top'), btns = [...nav.querySelectorAll('[data-hook="view-tab"]')];
      return { kids, ids: btns.map(b => b.dataset.viewBtn), titles: btns.every(b => (b.title || '').length > 10), clipped: btns.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent),
        seps: [...nav.querySelectorAll('.views-sep')].map(e => { const r = e.getBoundingClientRect(); return r.width >= 1 && r.height >= 8; }), side: top.scrollWidth > top.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, high: top.getBoundingClientRect().height };""")
    check("the top bar reads Map, Timeline, Successions, Forecast | Tasks, Nursery, Seeds | Assumptions: three groups with a rule between them", bar["kids"] == ["Map", "Timeline", "Successions", "Forecast", "|", "Tasks", "Nursery", "Seeds", "|", "Assumptions"] and all(bar["seps"]) and len(bar["seps"]) == 2, bar)
    check("the views keep their ids (the Nursery is still the view 'trays', Tasks still 'sow'), and each says in a tooltip what it is for", bar["ids"] == ["map", "timeline", "succession", "harvest", "sow", "trays", "seeds", "assume"] and bar["titles"], bar)
    wait(400)
    crowd = js("""const w = $('waitBadge'), wasHidden = w.hidden, wasHtml = w.innerHTML, s = $('saveState'), wasText = s.textContent;
      w.hidden = false; w.innerHTML = '<b>12</b> to place<span class="wb-more"> · not counted here</span>'; s.textContent = 'Saved · folder + cloud 12:44';
      const top = document.querySelector('header.top'), acts = [...document.querySelectorAll('.top-actions > *')].filter(e => getComputedStyle(e).display !== 'none' && !e.hidden);
      const out = { side: top.scrollWidth > top.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, off: acts.filter(e => e.getBoundingClientRect().right > innerWidth + 1).length, high: top.getBoundingClientRect().height,
        clipped: [...document.querySelectorAll('nav.views button, #waitBadge, #settleBadge')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent), settle: !$('settleBadge').hidden };
      w.hidden = wasHidden; w.innerHTML = wasHtml; s.textContent = wasText; return out;""")
    check("the bar fits on one line with both counts showing and the longest save note: nothing clipped, nothing off the side", not bar["side"] and bar["clipped"] == [] and not crowd["side"] and crowd["off"] == 0 and crowd["clipped"] == [] and crowd["high"] <= 60 and bar["high"] <= 60, [bar, crowd])

    # ── To settle, in the header: since the frame it is a row of Loose ends (tests/loose_check.py holds the list itself) ──
    st = js("""const b = $('settleBadge'), cs = getComputedStyle(b), w = getComputedStyle($('waitBadge'));
      return { hidden: b.hidden, text: b.textContent, count: LRFPanels.settleCount(), lots: LRFPanels.looseEnds().filter(r => r.key === 'lots').reduce((n, r) => n + r.n, 0), raw: (() => { const c = LRFRails.cleanup(eng); return { groups: c.groups.length, long: new Set(c.long.map(x => x.r.b.gardenId + '|' + x.want + '|' + x.cap)).size }; })(),
        bg: cs.backgroundColor, flagBg: (() => { const p = document.createElement('i'); p.style.background = 'var(--flag-soft)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })(), title: b.title };""")
    n_settle = st["raw"]["groups"] + st["raw"]["long"]
    said = lambda n: "Loose ends" + (str(n + st["lots"]) if n + st["lots"] else "")   # what the button reads with n to settle
    check("the header counts what waits under To settle: ground booked twice, and plantings longer than their bed a garden at a time", n_settle > 0 and not st["hidden"] and st["text"] == said(n_settle) and st["count"] == n_settle, st)
    check("it is quiet: the page's own ink on its own surface, not the colour of a warning, and its tooltip says what it counts", st["bg"] != st["flagBg"] and "booked twice" in st["title"], st)
    page.click('[data-view-btn="sow"]'); wait(500)
    click("#settleBadge", 300); click('#looseList [data-loose="ground"]', 600)
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
        check("settling one takes one off the count, and undoing puts it back", less["count"] == n_settle - 1 and less["text"] in ((said(n_settle - 1),) if n_settle > 1 or st["lots"] else ("Loose ends", "")) and less["undo"] == 1 and again["text"] == said(n_settle) and again["key"] == key0, [less, again])
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
    to = js("return { view: S.view, scope: V.scope(), title: txt('wkTitle'), where: V.where(), today: A.today() };")
    check("“Open the nursery’s list” on Bench room goes to Tasks, on the week the planner's date is in, with the Nursery's list the one chosen", to["view"] == "sow" and to["scope"] == "nursery" and to["where"]["tab"] == "nursery" and to["where"]["week"] == js("return now") and to["where"]["day"] == to["today"] and to["title"] == "Today", to)
    js("window.__d0 = S.date; A.setView('trays'); A.setDate(E.addDays(E.s2d(now), 21));"); wait(500); click('#nuTabs [data-tab="room"]'); click("#nuToTasks", 600)
    far = js("const r = { view: S.view, where: V.where(), title: txt('wkTitle'), want: E.d2s(E.addDays(E.s2d(now), 21)) }; A.setDate(window.__d0); return r;"); wait(400)
    check("with the planner's date in a later week, the Nursery's way in opens that week, whole", far["view"] == "sow" and far["where"]["week"] == far["want"] and far["where"]["day"] is None and far["title"].startswith("Week of "), far)
    js("V.setScope('all'); V.showWeek(now);"); wait(400)
    for i in range(page.locator(".tk-more").count()): page.locator(".tk-more").first.click(); wait(250)

    # ── Tasks: nursery and field apart ──
    TK = """const today = A.today(), end = E.d2s(E.addDays(E.s2d(now), 6)), open = t => t.state === 'open' || t.state === 'part', ORD = [...NS, ...NJ, ...FS, ...FJ];
      const left = half => V.tasks().filter(t => t.half === half && open(t) && t.due <= end), did = half => V.tasks().filter(t => t.half === half && t.on && t.on >= now && t.on <= end);
      const lists = [...document.querySelectorAll('.view-sow .tk-list')].map(l => ({ id: l.dataset.half, head: l.querySelector('h3').textContent, count: l.querySelector('.tk-count').textContent, box: (r => [Math.round(r.left), Math.round(r.top), Math.round(r.width)])(l.getBoundingClientRect()),
        rows: [...l.querySelectorAll('.tk-row:not(.done)')].map(r => [r.dataset.due, ORD.indexOf(r.dataset.kind), r.dataset.kind, r.dataset.line]), want: left(l.dataset.half).length, done: did(l.dataset.half).length }));"""
    tk = js(TK + """ return { title: txt('wkTitle'), range: txt('tkRange'), where: V.where(), lists, gone: ['#wkKinds', '.sw-stats', '.sw-record', '#wkScope', '#wkSpan', '.wk-half'].filter(s => document.querySelector(s)), days: document.querySelectorAll('#tkDays .tk-day').length, mode: [...document.querySelectorAll('#tkMode button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]),
        bench: !!document.querySelector('.view-sow .bn'), line: txt('bnLine'), print: txt('wkPrint'), side: document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1,
        cells: [...document.querySelectorAll('#tkDays .tk-day')].map(b => [b.dataset.day, b.querySelector('em').textContent]), wantCells: [0, 1, 2, 3, 4, 5, 6].map(i => { const k = E.d2s(E.addDays(E.s2d(now), i)), dn = V.tasks().filter(t => t.on === k).length, op = k < today ? 0 : V.tasks().filter(t => open(t) && (k === today ? t.due <= today : t.due === k)).length; return [k, op ? op.toLocaleString('en-US') : dn ? '✓ ' + dn : '']; }) };""")
    hv = {h["id"]: h for h in tk["lists"]}
    kinds = lambda h: [r[2] for r in hv[h]["rows"]]
    check("the week is in two lists under their own headings, Nursery first and Field after it, side by side where there is room", [h["id"] for h in tk["lists"]] == ["nursery", "field"] and hv["nursery"]["head"] == "Nursery" and hv["field"]["head"] == "Field" and tk["title"] == "This week" and tk["where"]["day"] is None
          and (hv["nursery"]["box"][0] < hv["field"]["box"][0] and hv["nursery"]["box"][1] == hv["field"]["box"][1] if WIDTH > 900 else True) and tk["mode"] == [["Day", "false"], ["Week", "true"]], tk)
    check("the nursery's list is the raising of the plant: sowing in trays and rockwool, live trays, potting up, hardening off, and nothing else", "nursery" in hv and set(kinds("nursery")) <= set(NURSERY_SOW + NURSERY_JOBS) and len(hv["nursery"]["rows"]) == hv["nursery"]["want"] and hv["nursery"]["want"] > 0 and [r[:2] for r in hv["nursery"]["rows"]] == sorted([r[:2] for r in hv["nursery"]["rows"]]), hv.get("nursery"))
    check("the field's list is planting, wherever the plant goes, with seed sown in the ground and crates moved out", "field" in hv and set(kinds("field")) <= set(FIELD_SOW + FIELD_JOBS) and len(hv["field"]["rows"]) == hv["field"]["want"] and hv["field"]["want"] > 0 and [r[:2] for r in hv["field"]["rows"]] == sorted([r[:2] for r in hv["field"]["rows"]]), hv.get("field"))
    lines = [r[3] for h in tk["lists"] for r in h["rows"]]
    check("every task still to do is in one list and only one, and each heading counts what is done of what it holds", len(lines) == hv["nursery"]["want"] + hv["field"]["want"] and len(set(lines)) == len(lines) and all(h["count"] == f"{h['done']} of {h['done'] + h['want']}" for h in tk["lists"]) and tk["range"] == f"{len(lines)} to do", [len(lines), [h["count"] for h in tk["lists"]], tk["range"]])
    check("nothing stands between the head and the work: no tiles, no row of kinds, no record bar, no switch of halves; a week of seven days, and the two lists", tk["gone"] == [] and tk["days"] == 7, tk["gone"])
    check("the bench chart is gone from the foot of Tasks: one line says what stands on the benches this week", not tk["bench"] and "On the benches this week" in tk["line"] and "Bench room, in Nursery" in tk["line"] and not tk["side"], [tk["bench"], tk["line"]])
    lineOk = js("const f = B.figures(), wk = f.weeks.find(w => w.week === now), p = wk.pools.heated, t = [...document.querySelectorAll('#bnLine span[data-pool]')].map(x => [x.dataset.pool, x.textContent]); return { t, used: Math.round(p.used), cap: p.cap };")
    check("that line is the engine's figure for the week", lineOk["t"] and lineOk["t"][0][0] == "heated" and f"{lineOk['used']} of {lineOk['cap']}" in lineOk["t"][0][1], lineOk)
    page.screenshot(path=str(shots / f"r1-tasks-all-{WIDTH}.png"))
    check("the week's seven cells say what each day holds: what was done on the days gone, what is left today with all that is late, what is planned after", tk["cells"] == tk["wantCells"] and any(c[1] for c in tk["cells"]), [tk["cells"], tk["wantCells"]])
    # a day, and back to the week
    tomorrow = js("return E.d2s(E.addDays(E.s2d(A.today()), 1))")
    click(f'#tkDays [data-day="{tomorrow}"]')
    dayv = js("return { where: V.where(), title: txt('wkTitle'), dues: [...new Set([...document.querySelectorAll('.tk-row:not(.done)')].map(r => r.dataset.due))], rows: document.querySelectorAll('.tk-row:not(.done)').length, want: V.tasks().filter(t => (t.state === 'open' || t.state === 'part') && t.due === '" + tomorrow + "').length, pressed: [...document.querySelectorAll('#tkDays [aria-pressed=true]')].map(b => b.dataset.day) };")
    click('#tkMode [data-mode="week"]')
    weekv = js("return V.where()")
    check("a press on a day shows that day alone, and “Week” goes back to the whole week", dayv["where"]["day"] == tomorrow and dayv["title"] == "Tomorrow" and dayv["pressed"] == [tomorrow] and dayv["rows"] == dayv["want"] and dayv["dues"] in ([tomorrow], []) and weekv["day"] is None and weekv["week"] == js("return now"), [dayv, weekv])
    click('.tk-step [data-by="7"]')
    nxt = js("return { where: V.where(), title: txt('wkTitle'), late: document.querySelectorAll('.tk-sec.late').length, today: !!$('wkToday') };")
    click('.tk-step [data-by="-7"]')
    home = js("return { where: V.where(), title: txt('wkTitle'), today: !!$('wkToday'), planner: E.d2s(S.date) };")
    check("the arrows move a week at a time: another week is shown whole, with nothing of this week's lateness in it, and this week opens on today", nxt["where"]["day"] is None and nxt["where"]["week"] == js("return E.d2s(E.addDays(E.s2d(now), 7))") and nxt["title"] == "Next week" and nxt["late"] == 0 and nxt["today"]
          and home["where"]["day"] == js("return A.today()") and home["title"] == "Today" and not home["today"], [nxt, home])
    # the sheet
    js("V.showWeek(now)"); wait(300)
    sheet = js("const s = V.sheet(), t = s.querySelectorAll('table')[0]; return { h1: s.querySelector('h1').textContent, scope: s.dataset.scope, rows: t.querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)').length, want: sowOf().filter(l => !l.skipped).length + jobsOf().filter(l => !l.skipped).length, halves: [...t.querySelectorAll('tr.wkp-half')].map(r => r.textContent), heads: [...t.querySelectorAll('tr.wkp-head')].map(r => r.textContent) };")
    check("the sheet to print is the week's: both lists, Nursery and then Field, its rows the week's tasks, set out by task", tk["print"] == "Print the week" and sheet["h1"].startswith("Week of May 3") and sheet["scope"] == "all" and sheet["rows"] == sheet["want"] and sheet["halves"] == ["Nursery", "Field"] and "Plant out" in sheet["heads"] and "Harden off" in sheet["heads"], sheet)
    page.evaluate("(() => { window.__printed = null; window.print = () => { const s = document.querySelector('#printSheet .wkp'); window.__printed = { h1: s.querySelector('h1').textContent, rows: s.querySelectorAll('table')[0].querySelectorAll('tbody tr:not(.wkp-head):not(.wkp-half)').length }; }; })()")
    click("#wkPrint", 300)
    pr = page.evaluate("window.__printed")
    check("and the button prints exactly that", pr is not None and pr["h1"].startswith("Week of May 3") and pr["rows"] == sheet["want"], pr)
    wait(1700)
    # the arrow keys
    js("V.show(A.today()); document.activeElement && document.activeElement.blur();"); wait(300)
    page.keyboard.press("ArrowRight"); wait(300); k1 = js("return V.where().day")
    page.keyboard.press("ArrowLeft"); page.keyboard.press("ArrowLeft"); wait(300); k2 = js("return V.where().day")
    click("#tkDate"); page.keyboard.press("ArrowRight"); wait(250); k3 = js("return [V.where().day, V.where().pop]"); page.keyboard.press("Escape"); wait(250)
    js("V.show(A.today())"); wait(300)
    check("the left and right arrow keys move a day, and are left alone while a calendar is open", k1 == tomorrow and k2 == js("return E.d2s(E.addDays(E.s2d(A.today()), -1))") and k3 == [k2, "go"], [k1, k2, k3])
    fld = js("""const sow = sowOf(), jobs = jobsOf(), t = V.tasks(); return { sowOpen: sow.filter(l => FS.includes(l.kind) && l.state !== 'done').length, plant: jobs.filter(l => l.section === 'plant').length, towers: t.filter(x => x.id === 'plant' && x.line.members.some(m => m.r.tw)).map(x => x.half), wool: t.filter(x => x.id === 'rockwool').map(x => x.half) };""")
    check("a subject is found: this week the field has seed to sow in the ground as well as planting out", fld["sowOpen"] > 0 and fld["plant"] > 0, fld)
    check("tower planting is field work, and sowing for the towers is the nursery's", len(fld["towers"]) > 0 and set(fld["towers"]) == {"field"} and len(fld["wool"]) > 0 and set(fld["wool"]) == {"nursery"}, [len(fld["towers"]), len(fld["wool"])])
    page.screenshot(path=str(shots / f"r1-tasks-field-{WIDTH}.png"))
    # a row opened by its words
    js("V.showWeek(now)"); wait(300)
    words = page.locator(".tk-list[data-half=field] .tk-row:not(.done) .tk-words")
    words.nth(0).click(); wait(450)
    op1 = js("const o = [...document.querySelectorAll('.tk-row.open')]; return { n: o.length, line: o[0] && o[0].dataset.line, note: o[0] && !!o[0].querySelector('.tk-note'), acts: o[0] ? [...o[0].querySelectorAll('.tk-acts button')].map(b => b.textContent) : [] };")
    words.nth(1).click(); wait(450)
    op2 = js("const o = [...document.querySelectorAll('.tk-row.open')]; return { n: o.length, line: o[0] && o[0].dataset.line, id: V.tasks().find(t => t.key === o[0].dataset.line).line.members[0].p.id, out: E.d2s(V.tasks().find(t => t.key === o[0].dataset.line).line.members[0].r.field) };")
    check("a press on a task's words opens it: a note, “Delay…”, “Skip this task” and its place on the map; opening another closes the first", op1["n"] == 1 and op1["note"] and op1["acts"] == ["Delay…", "Skip this task", "Show on the map"] and op2["n"] == 1 and op2["line"] != op1["line"], [op1, op2])
    click(".tk-row.open [data-act=map]", 600)
    onmap = js("return { view: S.view, sel: S.sel, date: E.d2s(S.date) };")
    check("“Show on the map” goes to the planting, on the day it goes out", onmap["view"] == "map" and onmap["sel"] and onmap["sel"]["type"] == "planting" and onmap["sel"]["id"] == op2["id"] and onmap["date"] == op2["out"], [onmap, op2])
    js("A.select(null); A.setDate(E.s2d(A.today())); V.setScope('field');"); wait(300)
    # remembered
    kept = page.evaluate("localStorage.getItem('lrf-next:tasks')")
    js("NV.setTab('supplies');"); wait(400)   # the Nursery is left on another tab: a new visit must not find it there
    page.reload(); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); wait(900)
    page.click('[data-view-btn="sow"]'); wait(600)
    rem = js("return { scope: V.scope(), where: V.where(), title: txt('wkTitle'), nursery: NV.tab(), key: A.contentKey() };")
    check("which list was last asked for is remembered in the browser from one visit to the next, for a phone to open on; nothing of it is in the plan, and the page opens on today", json.loads(kept or "{}") == {"scope": "field"} and rem["scope"] == "field" and rem["where"]["tab"] == "field" and rem["title"] == "Today" and rem["key"] == key0, [kept, rem])
    check("the Nursery opens on Bench room again at each visit", rem["nursery"] == "room", rem["nursery"])
    js("V.setScope('nursery'); V.showWeek(now);"); wait(400)
    # recording still works
    rec = js("const l = sowOf().find(x => x.state === 'open' && NS.includes(x.kind) && x.kind !== 'live' && x.date >= A.today()); return l ? { key: l.key, ids: l.members.map(m => m.p.id), todo: V.weekCounts(now) } : null;")
    if rec and has(f'.tk-row[data-line={json.dumps(rec["key"])}] .tk-tick'):
        page.locator(f'.tk-row[data-line={json.dumps(rec["key"])}] .tk-tick').click(); page.wait_for_timeout(250); _ah = page.locator('[data-hook="tasks-ahead-yes"]'); _ah.first.click() if _ah.count() and _ah.first.is_visible() else None; wait(1500)   # a tick a week or more ahead asks first (Tasks part 2)
        said = js("return (document.querySelector('.toast') || {}).textContent || ''")
        done = js(f"const ps = {json.dumps(rec['ids'])}.map(id => eng.planting(id)); return {{ done: ps.every(p => p.done && (p.done.sow || p.done.field)), undo: S.undo.length, todo: V.weekCounts(now), state: (V.tasks().find(t => t.key === {json.dumps(rec['key'])}) || {{}}).state }};")
        js("A.undo()"); wait(600)
        check("a task ticked in the nursery's list is recorded as it always was, in one step that undoes", " sown" in said and done["done"] and done["undo"] == 1 and done["state"] == "done" and js("return A.contentKey()") == key0, [said, done])
        check("and what the Nursery says is still to do that week goes down by that one", done["todo"]["sow"] == rec["todo"]["sow"] - 1 and done["todo"]["nursery"] == rec["todo"]["nursery"] - 1 and done["todo"]["field"] == rec["todo"]["field"], [rec["todo"], done["todo"]])
    else: check("a task ticked in the nursery's list is recorded as it always was, in one step that undoes", False, rec)
    js("V.setScope('all');"); wait(300)
    # an empty list says so
    emptyWeek = js("const weeks = new Set([...V.figures().list.filter(l => NS.includes(l.kind)).map(l => l.week), ...V.jobs().filter(l => NJ.includes(l.section) && !l.passed).map(l => l.week)]); for (let d = E.s2d(year + '-12-27'); d.getFullYear() === year; d = E.addDays(d, -7)) { const w = T.monday(E.d2s(d)); if (!weeks.has(w)) return w; } return null;")
    if emptyWeek:
        js(f"V.showWeek({json.dumps(emptyWeek)});"); wait(500)
        none = js("const l = document.querySelector('.tk-list[data-half=nursery]'); return { text: (l.querySelector('.tk-empty') || {}).textContent || '', rows: l.querySelectorAll('.tk-row').length, count: l.querySelector('.tk-count').textContent };")
        check("a week with nothing in the nursery says so, in the nursery's list", "Nothing is planned." in none["text"] and none["rows"] == 0 and none["count"] == "", none)
        js("V.show(A.today());"); wait(400)

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
      const can = id => { const c = eng.crop(id); return !!c && LRFSuccessions.plans(eng, c); };
      return { acts: head ? [...head.children].map(b => [b.id, b.textContent]) : null, oneLine: Math.max(...tops) - Math.min(...tops) <= 14, inBar: !!bar.querySelector('#hvShareBtn, #hvPlanBar'), near: head ? Math.round(head.getBoundingClientRect().right - document.querySelector('.hv-bar').getBoundingClientRect().right) : null,
        clipped: head ? [...head.children].filter(b => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > innerWidth).length : -1, rows: rows.length, want: rows.filter(r => can(r.dataset.crop)).map(r => r.dataset.crop), got: plans.map(p => p.dataset.crop),
        micro: rows.filter(r => { const c = eng.crop(r.dataset.crop); return c && c.micro; }).filter(r => r.querySelector('.hv-plan')).length, hidden: plans.length ? getComputedStyle(plans[0]).opacity : null, side: document.documentElement.scrollWidth > innerWidth + 1 };""")
    check("at the head of Forecast stands the thing done from it, a list to send (a run to an amount a week has its own page since 0.84); the bar under the figures keeps to one line", hvw["acts"] == [["hvShareBtn", "A list to send…"]] and hvw["oneLine"] and not hvw["inBar"] and hvw["clipped"] == 0 and not hvw["side"], hvw)
    check("every crop that can be planned to an amount has “plan…” on its row, tray crops have none, and it shows only when the row is pointed at", hvw["got"] == hvw["want"] and len(hvw["want"]) > 5 and hvw["micro"] == 0 and hvw["hidden"] == "0", hvw)
    if hvw["want"]:
        cid = hvw["want"][min(3, len(hvw["want"]) - 1)]
        page.locator(f'#hvTable tr.hv-row[data-crop={json.dumps(cid)}]').hover(); wait(250)
        seen = js(f"const b = document.querySelector('#hvTable tr.hv-row[data-crop=' + JSON.stringify({json.dumps(cid)}) + '] .hv-plan'), r = b.getBoundingClientRect(), c = b.closest('td').getBoundingClientRect(); return {{ opacity: getComputedStyle(b).opacity, inside: r.left >= c.left - 1 && r.right <= c.right + 1, label: b.getAttribute('aria-label') }};")
        page.locator(f'#hvTable tr.hv-row[data-crop={json.dumps(cid)}] .hv-plan').click(); wait(800)
        tool = js("const D = LRFSuccessions.state.D; return { view: S.view, by: D.by, crop: D.cropId, dates: D.datesFor, want: +D.want > 0, undo: S.undo.length, key: A.contentKey() };")
        check("pointed at, it shows inside the crop's cell; pressed, it opens the Successions page on that crop, to an amount a week, and adds nothing", seen["opacity"] == "1" and seen["inside"] and "succession" in seen["label"] and tool["view"] == "succession" and tool["by"] == "amount" and tool["want"] and tool["undo"] == 0 and tool["key"] == key0, [seen, tool])
        check("and on the crop of that row, by picking dates", tool["crop"] == cid and tool["dates"] == "picking", [tool, cid])
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
    ph = js("""const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0, sc = $('tkTabs'), today = A.today(), open = t => t.state === 'open' || t.state === 'part';
      return { phone: document.body.classList.contains('phone'), view: S.view, shown: [...document.querySelectorAll('.view-sow .tk-list')].filter(vis).map(h => h.dataset.half), tabs: sc ? [...sc.querySelectorAll('button')].map(b => b.dataset.half) : [], scope: vis(sc), btn: sc ? Math.min(...[...sc.querySelectorAll('button')].map(b => b.getBoundingClientRect().height)) : 0,
        inside: sc ? sc.getBoundingClientRect().right <= innerWidth + 1 && sc.getBoundingClientRect().left >= 0 : false, settle: vis($('settleBadge')), line: !!$('bnLine'), bench: !!document.querySelector('.view-sow .bn'), nav: vis(document.querySelector('nav.views')), title: txt('wkTitle'),
        side: document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.view-sow').scrollWidth > document.querySelector('.view-sow').clientWidth + 1, top: document.querySelector('header.top').getBoundingClientRect().height, rows: [...document.querySelectorAll('.tk-row')].filter(vis).length,
        left: { nursery: V.tasks().filter(t => t.half === 'nursery' && open(t) && t.due <= today).length, field: V.tasks().filter(t => t.half === 'field' && open(t) && t.due <= today).length } };""")
    check("on a phone the tasks are still the whole page, one list at a time under two tabs, with nothing running off sideways and the header on one line", ph["phone"] and ph["view"] == "sow" and ph["title"] == "Today" and ph["tabs"] == ["nursery", "field"] and len(ph["shown"]) == 1 and ph["rows"] > 0 and not ph["side"] and not ph["nav"] and ph["top"] <= 60, ph)
    check("which list to show can be chosen there with a thumb; the count to settle, the bench line and the chart are left off", ph["scope"] and ph["inside"] and ph["btn"] >= 34 and not ph["settle"] and not ph["line"] and not ph["bench"], ph)
    page.locator('#tkTabs [data-half="field"]').click(); page.wait_for_timeout(500)
    for i in range(page.locator(".tk-list:not(.off) .tk-more").count()): page.locator(".tk-list:not(.off) .tk-more").first.click(); page.wait_for_timeout(250)
    pn = js("const vis = e => getComputedStyle(e).display !== 'none'; return { scope: V.scope(), halves: [...new Set([...document.querySelectorAll('.tk-row')].filter(r => vis(r.closest('.tk-list'))).map(r => r.closest('.tk-list').dataset.half))], rows: [...document.querySelectorAll('.tk-row:not(.done)')].filter(r => vis(r.closest('.tk-list'))).length, title: txt('wkTitle'), side: document.documentElement.scrollWidth > innerWidth + 1 };")
    check("a tap on Field lists the field's tasks alone", pn["scope"] == "field" and pn["halves"] == ["field"] and pn["rows"] == ph["left"]["field"] and pn["title"] == "Today" and not pn["side"], pn)
    page.screenshot(path=str(shots / "r1-phone.png"))
    page.evaluate("localStorage.removeItem('lrf-next:tasks')")
    ctx.close()
    check("no error was written to the console", errors == [], errors[:5])
    browser.close()
finish()
