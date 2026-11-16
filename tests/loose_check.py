"""Loose ends in a real browser: the one list for what needs the grower (DESIGN.md, rule 4).
The header's button says "Loose ends". Its count alone is orange, and counts only what needs the grower: ground booked twice or
longer than its bed, and seed no row can count. What can wait (plantings that differ from the list, published guidance not yet
used, supplier days that do not say where they are counted from) is listed under it and not counted. Each row opens where the
thing is mended. The notices that stood on the Assumptions list and in the Seeds panel are gone from those pages: two are
sheets opened from the list, seed on order is a filter of the Seeds list, and each page has one line of figures.
Every count is read from the plan the page was given; nothing here names a crop, a bed or a number of any plan.
usage: python3 -I loose_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
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
PRE = ("const A = LRFApp, S = A.state, $ = id => document.getElementById(id), eng = S.engine, txt = id => ($(id) || {}).textContent || '';"
       "const drawn = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';"
       "const colour = v => { const p = document.createElement('i'); p.style.background = v; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };"
       "const saved = () => ({ key: A.contentKey(), undo: S.undo.length });"
       # what the page says in the list that is open: its kinds in order, and each row with how many lines its two texts take
       "const list = () => { const l = $('looseList'); if (!l) return null; const r = l.getBoundingClientRect(), lines = el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));"
       " return { kinds: [...l.querySelectorAll('.loose-kind')].map(k => k.dataset.kind), order: [...l.children].map(c => c.classList.contains('loose-kind') ? '#' + c.dataset.kind : c.dataset.loose),"
       " rows: [...l.querySelectorAll('.loose-row')].map(b => ({ key: b.dataset.loose, name: b.querySelector('.row-name').textContent, detail: b.querySelector('.row-detail').textContent, word: b.querySelector('.row-word').textContent.replace('›', '').trim(), lines: [lines(b.querySelector('.row-name')), lines(b.querySelector('.row-detail'))] })),"
       " inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= $('settleBadge').getBoundingClientRect().bottom && r.bottom <= innerHeight + 1, under: Math.abs(r.right - $('settleBadge').getBoundingClientRect().right) <= 16 || r.left <= 13 }; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    def ready():
        page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=60000); page.wait_for_timeout(900)
    page.goto(url); ready()
    sample = page.evaluate("LRFApp.isSample() ? { hidden: document.getElementById('settleBadge').hidden, rows: LRFPanels.looseEnds().length } : null")
    if backup and sample:
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    page.evaluate("LRFApp.state.undo.length = 0")
    js = lambda body, arg=None: page.evaluate("(arg) => { " + PRE + " " + body + " }", arg)
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    def press(selector, ms=300):
        """A thing a fault has taken away, or left under a sheet, is not pressed: the named line after it fails, and the check goes on."""
        hit = page.locator(selector)
        if not hit.count() or not hit.first.is_visible(): wait(100); return False
        try: hit.first.click(timeout=3000)
        except Exception: return False
        wait(ms); return True
    def shut():
        """Leave every sheet and window that is open, as Escape does."""
        for _ in range(4):
            if not js("return !!document.querySelector('dialog[open]')"): return
            page.keyboard.press("Escape"); wait(300)
    def open_list():
        shut()
        if not js("return !!$('looseList')"): press("#settleBadge")
        return js("return list()")
    def row(key, ms=700):
        """Open the list and press one of its rows. False when the row is not there."""
        open_list()
        return press(f'#looseList [data-loose="{key}"]', ms)

    js("A.setView('map'); A.select(null);"); wait(700)
    key0 = js("return A.contentKey()")
    if sample is not None:
        check("on the sample plan the header shows no loose ends: nothing there is the grower's own to mend", sample["hidden"] and sample["rows"] == 0, sample)

    # ══ the button ══
    st = js("""const b = $('settleBadge'), cs = getComputedStyle(b), n = b.querySelector('b'), rows = LRFPanels.looseEnds(), c = LRFRails.cleanup(eng);
      return { hidden: b.hidden, drawn: drawn(b), text: b.textContent, n: n ? n.textContent : '', title: b.title, settle: LRFPanels.settleCount(), raw: c.groups.length + new Set(c.long.map(x => x.r.b.gardenId + '|' + x.want + '|' + x.cap)).size,
        needs: rows.filter(r => r.kind === 'needs').reduce((t, r) => t + r.n, 0), wait: rows.filter(r => r.kind === 'minute').length, keys: rows.map(r => r.key), said: LRFPanels.needsYou(rows),
        bg: cs.backgroundColor, soft: colour('var(--flag-soft)'), nBg: n ? getComputedStyle(n).backgroundColor : '', orange: colour('var(--flag-deep)'), raised: colour('var(--raised)'), popup: b.getAttribute('aria-haspopup'), open: b.getAttribute('aria-expanded') };""")
    check("this plan has something of each kind to list: ground to settle, and things that can wait", st["raw"] > 0 and st["wait"] >= 3 and {"ground", "differ", "guide", "starts"} <= set(st["keys"]), st)
    check("the header says Loose ends, and its count is what needs the grower and nothing that can wait", not st["hidden"] and st["drawn"] and st["text"] == f"Loose ends{st['needs']:,}" and st["n"] == f"{st['needs']:,}" and st["said"] == st["needs"] and st["settle"] == st["raw"] and st["needs"] == st["raw"], st)
    check("the button is the page's own surface, never a coloured panel; its count alone is orange; its tooltip says what is counted", st["bg"] == st["raised"] and st["bg"] != st["soft"] and st["nBg"] == st["orange"] and "booked twice" in st["title"] and "can wait" in st["title"], st)

    # ══ the list ══
    lst = open_list() or {}
    rows = {r["key"]: r for r in lst.get("rows", [])}
    want = js("return LRFPanels.looseEnds().map(r => ({ key: r.key, kind: r.kind, word: r.word }))")
    check("a click opens one list under the button, inside the window, and the button says it is open", bool(lst) and lst["inside"] and lst["under"] and js("return $('settleBadge').getAttribute('aria-expanded')") == "true", lst)
    check("it is in two kinds, what needs the grower first, and every loose end of the plan is a row under its own kind",
          lst.get("kinds") == ["needs", "minute"] and lst.get("order") == ["#needs"] + [w["key"] for w in want if w["kind"] == "needs"] + ["#minute"] + [w["key"] for w in want if w["kind"] == "minute"], [lst.get("order"), want])
    check("each row is a name over one line saying where it is mended, with its count at the right; no name or line is wrapped", len(rows) == len(want) and all(r["lines"] == [1, 1] and r["detail"].startswith("On ") and rows[w["key"]]["word"] == w["word"] for r, w in zip(lst.get("rows", []), want)), lst.get("rows"))
    shot("loose-list")
    page.keyboard.press("Escape"); wait(200)
    esc = js("return { open: !!$('looseList'), focus: document.activeElement === $('settleBadge'), said: $('settleBadge').getAttribute('aria-expanded') }")
    open_list(); page.mouse.click(40, 500); wait(200)
    away = js("return { open: !!$('looseList'), ...saved() }")
    check("Escape closes the list and gives the button the focus back; a click elsewhere closes it; nothing has changed", not esc["open"] and esc["focus"] and esc["said"] == "false" and not away["open"] and away["key"] == key0 and away["undo"] == 0, [esc, away])

    # ══ each row opens where the thing is mended ══
    js("A.setView('sow')"); wait(500)
    went = row("ground") and js("const el = $('toSettle'); return { view: S.view, sel: S.sel, there: drawn(el), head: el ? el.querySelector('h3').textContent : '', fixes: el ? el.querySelectorAll('.fix').length : 0, list: !!$('looseList'), ...saved() };")
    check("ground booked twice opens the Map from another view with its list of fixes, one for each counted, and changes nothing", bool(went) and went["view"] == "map" and went["sel"] is None and went["there"] and went["head"] == f"To settle · {st['raw']}" and went["fixes"] == st["raw"] and not went["list"] and went["key"] == key0 and went["undo"] == 0, went)

    js("A.setView('map')"); wait(300)
    d = row("differ") and js("""const dlg = $('asDifferDlg'), s = A.auditSurvey(), hv = s.harvest; return { view: S.view, open: dlg.open, head: (dlg.querySelector('.au-head b') || {}).textContent, line: txt('asDiffLine'), tidy: drawn($('asTidy')), review: drawn($('asReview')) && !$('asReview').disabled, more: !!$('asAuditMore') && !$('asAuditMore').open,
      figures: s.days.own + s.days.waiting + s.nursery.differ + hv.yield + hv.window + hv.turnover + hv.copy, done: txt('asDifferDone'), dark: dlg.querySelectorAll('.btn.primary').length, onPage: !!document.querySelector('#assumeView #asAudit, #assumeView #asHints, #assumeView .as-audit'), ...saved() };""")
    check("plantings that differ from the list opens the Assumptions list with a sheet: its title, one sentence, the two actions, the count kind by kind closed, and Done as its one dark button",
          bool(d) and d["view"] == "assume" and d["open"] and d["head"] == "Plantings that differ from your list" and "figures of their own" in d["line"] and d["tidy"] and d["review"] and d["more"] and d["done"] == "Done" and d["dark"] == 1 and d["key"] == key0, d)
    check("its row counts the figures the sheet speaks of", bool(d) and rows.get("differ", {}).get("word") == f"{d['figures']:,} figure{'' if d['figures'] == 1 else 's'}", [rows.get("differ"), d])
    shot("loose-differ")
    press("#asReview", 900)
    rv = js("return { review: !!$('auditDlg') && $('auditDlg').open, sheet: $('asDifferDlg').open }")
    page.keyboard.press("Escape"); wait(400)
    check("“See what differs…” closes the sheet and opens the review window, one over nothing", rv["review"] and not rv["sheet"] and not js("return !!$('auditDlg')"), rv)
    row("differ"); press("#asDifferDone")
    frame = js("""const head = document.querySelector('#assumeView .as-head'), t = $('asTitle').getBoundingClientRect(), c = $('asCount'), cr = c.getBoundingClientRect(), mode = document.querySelector('#assumeView .as-mode').getBoundingClientRect(), first = [...document.querySelectorAll('#asBody tr')].find(drawn);
      return { sheet: $('asDifferDlg').open, notices: [...document.querySelectorAll('#assumeView .as-audit, #assumeView #asAudit, #assumeView #asHints')].filter(drawn).length, count: c.textContent.trim().length > 0 && drawn(c), under: cr.top >= t.bottom - 2 && cr.bottom <= mode.top + 1, inHead: head.contains(c), one: Math.round(cr.height / parseFloat(getComputedStyle(c).lineHeight)), first: first ? Math.round(first.getBoundingClientRect().top) : null, ...saved() };""")
    check("Done closes it; on the Assumptions list no notice stands, and one line of figures is under the title, over the page's controls", not frame["sheet"] and frame["notices"] == 0 and frame["count"] and frame["under"] and frame["inHead"] and frame["one"] == 1 and frame["key"] == key0 and frame["undo"] == 0, frame)
    check("the list of crops starts within 340 px of the top of a window 900 high", frame["first"] is not None and frame["first"] <= 340, frame)
    shot("loose-assumptions")

    js("A.setView('map'); LRFAssume.setMode('harvest', 'list');"); wait(300)
    g = row("guide") and js("""const dlg = $('asGuideDlg'), h = $('asHints'); return { view: S.view, mode: document.getElementById('assumeView').dataset.mode, open: dlg.open, head: (h.querySelector('h2') || {}).textContent || '', names: (h.querySelector('small') || {}).textContent || '', chips: new Set([...document.querySelectorAll('#asBody .as-hint')].map(b => b.dataset.hint)).size,
      foot: [...h.querySelectorAll('.sheet-foot .btn')].map(b => [b.textContent, b.classList.contains('primary')]), ...saved() };""")
    n_guide = len(g["names"].split(", ")) if g and g["names"] else 0
    check("published guidance not yet used opens the Assumptions list on Days to harvest with a sheet naming the crops, as many as its row says; Cancel, and “Use them all…” as its one dark button",
          bool(g) and g["view"] == "assume" and g["mode"] == "days" and g["open"] and n_guide > 0 and g["head"].startswith(f"{n_guide} crop") and rows.get("guide", {}).get("word") == f"{n_guide} crop{'' if n_guide == 1 else 's'}" and g["foot"] == [["Cancel", False], ["Use them all…", True]] and g["key"] == key0, [g, rows.get("guide")])
    shot("loose-guide")
    press("#asGuideCancel")
    check("Cancel closes it and nothing has changed", not js("return $('asGuideDlg').open") and js("return saved()") == {"key": key0, "undo": 0})
    if row("guide") and press("#asHintsAll", 900):
        ask = js("const a = document.querySelector('dialog[open]'); return { sheet: $('asGuideDlg').open, ask: !!a && a.id !== 'asGuideDlg', text: a ? a.textContent.slice(0, 160) : '', ...saved() }")
        page.keyboard.press("Escape"); wait(400)
        check("“Use them all…” closes the sheet and asks first, showing what would move: nothing has changed until that is answered", not ask["sheet"] and ask["ask"] and ask["key"] == key0 and ask["undo"] == 0 and js("return saved()") == {"key": key0, "undo": 0}, ask)
    else: check("“Use them all…” closes the sheet and asks first, showing what would move: nothing has changed until that is answered", False, "no row for guidance, or no button in its sheet")

    js("A.setView('map')"); wait(300)
    s1 = row("starts", 900) and js("""const chips = [...document.querySelectorAll('#sdFilters .chip')].map(c => ({ label: c.firstChild.textContent, n: +c.querySelector('small').textContent, on: c.getAttribute('aria-pressed') === 'true' }));
      return { view: S.view, chips, shown: document.querySelectorAll('#sdBody .sd-var').length, ...saved() };""")
    on = [c for c in (s1 or {}).get("chips", []) if c["on"]]
    check("supplier days that do not say where they are counted from opens Seeds with that filter pressed, listing as many varieties as its row says", bool(s1) and s1["view"] == "seeds" and len(on) == 1 and on[0]["label"] == "Days counted from: not said" and rows.get("starts", {}).get("word") == f"{on[0]['n']} variet{'y' if on[0]['n'] == 1 else 'ies'}" and s1["shown"] == on[0]["n"] and s1["key"] == key0, [s1, rows.get("starts")])

    # ══ Seeds: seed on order is a filter; no notice stands in the panel; one line of figures ══
    # A plan loaded from a backup file has no seed stock with it. Then one order is filed first, for a variety the plan sows
    # by the seed, and taken back at the end: the lines below read whatever is on order, and name none of it.
    start_key, undo0 = key0, 0
    if not js("return Object.values(A.stockNow()).some(x => x.onOrder > 0)"):
        if js("const r = LRFSeedLib.required(eng).rows.find(r => r.variety && r.unit === 'seeds' && r.toSow > 0); return !!r && !!A.editStock('An order, filed by the check', (lib, ctx) => LRFSeedLib.addLot(lib, { key: 'v:' + r.variety.id, unit: 'seeds', quantity: 100, status: 'ordered' }, ctx), r.variety.name)"):
            wait(900); undo0 = 1; key0 = js("return A.contentKey()")
    labels = [c["label"] for c in (s1 or {}).get("chips", [])]
    orders = js("return { stock: Object.values(A.stockNow()).filter(x => x.onOrder > 0).length, top: Math.round($('sdScroll').getBoundingClientRect().top) }")
    check("seed on order is a filter of the Seeds list, beside “Short of seed”", "On order" in labels and labels.index("On order") == labels.index("Short of seed") + 1, labels)
    press("#sdFilters .chip:has-text('On order')", 700)
    o = js("""const c = [...document.querySelectorAll('#sdFilters .chip')].find(c => c.getAttribute('aria-pressed') === 'true'), rows = [...document.querySelectorAll('#sdBody .sd-var')];
      return { label: c ? c.firstChild.textContent : '', n: c ? +c.querySelector('small').textContent : -1, shown: rows.length, ordered: rows.filter(r => /ordered/.test(r.textContent)).length, top: Math.round($('sdScroll').getBoundingClientRect().top), ...saved() };""")
    check("pressed, it lists the varieties with seed on order and no others, and the list keeps its place on the page", o["label"] == "On order" and o["n"] > 0 and o["shown"] == o["n"] and o["ordered"] == o["n"] and orders["stock"] >= o["n"] and o["top"] == orders["top"] and o["key"] == key0, [o, orders])
    shot("loose-seeds-on-order")
    panel = js("""const p = $('sdPanel'), f = $('sdFigs'), all = $('sdReceiveAll'); return { sel: !!p.querySelector('.close'), notices: p.querySelectorAll('.sd-task, .sd-stray, .sd-stats, .sd-stat').length, figs: f ? [...f.querySelectorAll('span')].map(s => s.textContent) : [], bold: f ? f.querySelectorAll('b').length : 0,
      lines: f ? [...f.querySelectorAll('span')].map(s => Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight))) : [], all: all ? { text: all.textContent, button: all.classList.contains('btn') && !all.classList.contains('primary'), bg: getComputedStyle(all.parentElement).backgroundColor } : null };""")
    check("with nothing picked the Seeds panel holds no notice and no tiles: its figures in words (varieties and planted, seeds to sow, short of seed, on order), each number in bold, none wrapped", not panel["sel"] and panel["notices"] == 0 and len(panel["figs"]) == 4 and panel["bold"] == 5 and panel["figs"][3] == f"{o['n']} on order" and panel["lines"] == [1, 1, 1, 1], panel)
    check("the day the box comes still has its one press there, as a plain button: “All orders arrived…” asks before anything changes", bool(panel["all"]) and panel["all"]["text"] == "All orders arrived…" and panel["all"]["button"], panel)
    if panel["all"] and press("#sdReceiveAll", 500):
        asked = js("const a = document.querySelector('dialog[open]'); return { title: a ? a.querySelector('h2').textContent : '', ...saved() }")
        shut()
        check("it asks “Mark every order as arrived?”, and Escape leaves every order as it was", asked["title"] == "Mark every order as arrived?" and asked["key"] == key0 and js("return saved()") == {"key": key0, "undo": undo0}, asked)
    else: check("it asks “Mark every order as arrived?”, and Escape leaves every order as it was", False, "no button")

    # ══ seed no row can count: it needs the grower, so it is counted; the plan has none, so one is filed where no row can see it ══
    before = js("return { needs: LRFPanels.needsYou(LRFPanels.looseEnds()), keys: LRFPanels.looseEnds().map(r => r.key), text: $('settleBadge').textContent }")
    made = js("return !!A.editStock('A lot for a variety that is gone', (lib, ctx) => LRFSeedLib.addLot(lib, { key: 'v:a-variety-that-is-gone', unit: 'seeds', quantity: 500, status: 'usable' }, ctx), 'A variety that is gone')"); wait(700)
    after = js("return { needs: LRFPanels.needsYou(LRFPanels.looseEnds()), rows: LRFPanels.looseEnds().filter(r => r.key === 'lots').map(r => [r.kind, r.word, r.n]), text: $('settleBadge').textContent, undo: S.undo.length }")
    check("a lot filed where no row can see it is one more thing that needs the grower: the count goes up by one", made and "lots" not in before["keys"] and after["rows"] == [["needs", "1 lot", 1]] and after["needs"] == before["needs"] + 1 and after["text"] == f"Loose ends{after['needs']:,}", [before, after])
    js("A.setView('seeds'); LRFSeeds.select(null);"); wait(700)
    quiet = js("const p = $('sdPanel'); return { notices: p.querySelectorAll('.sd-stray, .sd-task').length, figs: !!$('sdFigs') }")
    check("even then no notice stands in the Seeds panel while nothing is picked: it is in the list, until it is opened from there", quiet["notices"] == 0 and quiet["figs"], quiet)
    js("A.setView('map')"); wait(300)
    lots = row("lots", 900) and js("""const p = $('sdPanel'), box = $('sdUnlisted'); return { view: S.view, order: (list() || {}).order, box: drawn(box), head: (p.querySelector('h2') || {}).textContent, said: box ? box.querySelector('b').textContent : '', rows: box ? box.querySelectorAll('.sd-strayrow').length : 0, close: !!p.querySelector('.close'), tint: box ? getComputedStyle(box).backgroundColor : '' };""")
    check("its row is under what needs the grower, and opens Seeds with the lot shown in the panel as the thing picked, with a way to close it and no coloured panel", bool(lots) and lots["view"] == "seeds" and lots["box"] and lots["head"] == "Seed no row can count" and lots["said"].startswith("1 lot is not counted") and lots["rows"] == 1 and lots["close"] and lots["tint"] in ("rgba(0, 0, 0, 0)", "transparent"), lots)
    shot("loose-seeds-lots")
    open_list(); order = (js("return list()") or {}).get("order", []); page.keyboard.press("Escape"); wait(200)
    check("in the list it stands after the ground and before everything that can wait", "lots" in order and "#minute" in order and order.index("lots") < order.index("#minute") and order.index("lots") > order.index("#needs"), order)
    shut(); js("A.undo()"); wait(900)
    back = js("return { needs: LRFPanels.needsYou(LRFPanels.looseEnds()), keys: LRFPanels.looseEnds().map(r => r.key), text: $('settleBadge').textContent, box: !!$('sdUnlisted'), figs: !!$('sdFigs'), key: A.contentKey() }")
    check("undone, the count is what it was, and the Seeds panel is back to its line of figures", back["needs"] == before["needs"] and "lots" not in back["keys"] and back["text"] == before["text"] and not back["box"] and back["figs"] and back["key"] == key0, back)

    # ══ a phone shows Tasks and nothing else: no loose ends there ══
    page.set_viewport_size({"width": 390, "height": 800}); wait(700)
    phone = js("return { phone: document.body.classList.contains('phone'), badge: drawn($('settleBadge')), list: !!$('looseList') }")
    page.set_viewport_size({"width": WIDTH, "height": 900}); wait(700)
    check("on a phone the button is not shown", phone["phone"] and not phone["badge"] and not phone["list"], phone)

    if undo0: js("A.undo()"); wait(700)
    js("A.select(null); A.setView('map')"); wait(400)
    end = js("return saved()")
    check("after all of it the plan is the one the check started from", end["key"] == start_key, end)
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
