"""Number boxes in a real browser: a figure changes only by being typed.
A box that has been clicked used to take the mouse wheel and the Up and Down arrows: one notch changed the figure, the page did
not scroll, and the changed figure was saved when the box was left. One rule now holds for every number box (js/main.js): the
wheel never changes its figure and the page scrolls under it, the two arrows do not step it, and what is typed is saved as before.
This check turns a real wheel and presses real keys: on the Assumptions list, in a planting's side panel, then over every number
box each main screen draws; and it tries the handlers that use the arrow keys for something else, which must still work.
A recorder on the window writes down each wheel and key as it arrives and each change of the box that is being tried, so a
line cannot pass because the wheel fell beside the box.
usage: python3 -I number_boxes_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, DARK=1, STOP_AT_FAIL=1
For the deliberate faults only: BOXES=40 tries the first 40 boxes of each screen. The run of every push tries them all.
"""
import functools, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); DARK = os.environ.get("DARK") == "1"; STOP = os.environ.get("STOP_AT_FAIL") == "1"
BOXES = int(os.environ.get("BOXES", "0"))
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
# The recorder, on the window before the page's own listeners: each wheel and key as it arrives, with whether it fell on the box
# being tried and whether that box had the focus; and each time the browser changed that box or told the page it had.
RECORD = """(() => { const N = window.__nb = { box: null, log: [], list: [] };
  const where = e => e.target !== N.box ? ' beside the box' : document.activeElement !== N.box ? ' on the box, which has not the focus' : '';
  window.addEventListener('wheel', e => N.log.push('wheel' + where(e)), true);
  window.addEventListener('keydown', e => N.log.push(e.key + where(e)), true);
  for (const kind of ['input', 'change']) window.addEventListener(kind, e => { if (e.target === N.box) N.log.push(kind + ' ' + e.target.value); }, true);
})();"""
def fake(y):   # the page's clock: June 9 of the plan's year, ten in the morning, so that the nursery has trays and the ground has crops
    return f"(() => {{ const R = Date, off = new R({int(y)}, 5, 9, 10).getTime() - R.now(); class D extends R {{ constructor(...a) {{ if (a.length) super(...a); else super(R.now() + off); }} static now() {{ return R.now() + off; }} }} window.Date = D; }})();"
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, N = window.__nb, $ = id => document.getElementById(id), eng = S.engine, txt = id => ($(id) || {}).textContent || '';"
       "const drawn = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';"
       # the middle of a box, in whole pixels, once it is brought into view; and whether the box is what lies under that point
       "const at = el => { el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(), x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); return { x, y, under: document.elementFromPoint(x, y) === el }; };"
       "const scroller = el => { for (let s = el.parentElement; s; s = s.parentElement) { const c = getComputedStyle(s); if (/(auto|scroll)/.test(c.overflowY) && s.scrollHeight > s.clientHeight + 1) return s; } return document.scrollingElement; };"
       "const saved = () => ({ key: A.contentKey(), undo: S.undo.map(u => u.label), toast: $('toast').classList.contains('show') ? txt('toast') : '' });")
# the main screens, as tests/screens_check.py opens them, and whether each is known to draw number boxes (then it must draw one)
VIEW = "document.body.dataset.view"
SCREENS = [
    ("the map", "A.setView('map'); A.select(null);", False),
    ("the timeline", "A.setView('timeline'); A.select(null);", False),
    ("the forecast table", "A.setView('harvest');", False),
    ("Tasks", "A.setView('sow');", False),
    ("the Nursery’s bench room", "A.setView('trays'); LRFTraysView.setTab('room');", False),
    ("the Nursery’s live trays", "A.setView('trays'); LRFTraysView.setTab('live');", True),
    ("the Nursery’s supplies", "A.setView('trays'); LRFTraysView.setTab('supplies');", True),
    ("the Nursery’s set-up", "A.setView('trays'); LRFTraysView.setTab('setup');", True),
    ("Seeds", "A.setView('seeds');", True),
    ("the Assumptions list, days to harvest", "A.setView('assume'); document.querySelector('[data-as-mode=days]').click();", True),
    ("the Assumptions list, yield and price", "A.setView('assume'); document.querySelector('[data-as-mode=harvest]').click(); { const w = document.querySelector('[data-ah-way=list]'); if (w && w.getClientRects().length) w.click(); }", True),
    ("yield and price, one crop at a time", "A.setView('assume'); LRFAssume.setMode('harvest', 'card');", True),
]
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
    page = ctx.new_page(); page.add_init_script(RECORD)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    def ready():
        page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=60000); page.wait_for_timeout(900)
    def load_farm():
        if backup and page.evaluate("LRFApp.isSample()"):
            page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
            if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
            page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    page.goto(url); ready(); load_farm()
    # the same page again on a pretended day of the plan's own year: what Tasks and the Nursery draw does not depend on the day the check is run
    page.add_init_script(fake(page.evaluate("LRFApp.planYear()"))); page.reload(); ready(); load_farm()
    page.evaluate("LRFApp.state.undo.length = 0")
    js = lambda body, arg=None: page.evaluate("(arg) => { " + PRE + " " + body + " }", arg)
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    def watch(selector):
        """The box to try from here on: brought into view, the recorder set on it. Where its middle is, what it shows, how far its list is scrolled."""
        return js("const el = document.querySelector(arg); if (!el || !drawn(el)) return null; N.box = el; N.log = []; const p = at(el), s = scroller(el); return { ...p, value: el.value, placeholder: el.placeholder, scroll: s.scrollTop, room: s.scrollHeight - s.clientHeight }", selector)
    def seen():
        """What the recorder wrote down, what the box shows now, and what the plan holds."""
        return js("const el = N.box, there = !!el && el.isConnected; return { log: N.log.slice(), value: there ? el.value : null, there, focus: there && document.activeElement === el, readOnly: there && el.readOnly, scroll: there ? scroller(el).scrollTop : null, ...saved() }")
    def click_box(w):
        page.mouse.click(w["x"], w["y"]); wait(150)
    def notch(dy):
        """One notch of the wheel with the pointer on the box being tried, wherever the last notch left the list. Returns how far the list was scrolled before it."""
        p = js("const p = at(N.box); return { ...p, scroll: scroller(N.box).scrollTop }")
        page.mouse.move(p["x"], p["y"]); page.mouse.wheel(0, dy); wait(300)
        return p["scroll"]
    def away():
        """A click on the name at the top of the page, which does nothing but take the focus from the box."""
        b = page.locator(".brand-name").bounding_box(); page.mouse.click(round(b["x"] + b["width"] / 2), round(b["y"] + b["height"] / 2)); wait(600)
    def undo_all():
        js("let n = 0; while (S.undo.length && n++ < 400) A.undo(); $('toast').classList.remove('show');"); wait(500)
    same = lambda a, b: a["key"] == b["key"] and a["undo"] == b["undo"]

    start = js("return { n: S.plan.plantings.length, ...saved(), view: S.view, today: E.d2s(new Date()), year: A.planYear(), recorder: !!N }")
    key0 = start["key"]
    check("a plan is open with nothing to undo, on a day of its own year, and the recorder is listening", start["n"] > 300 and start["undo"] == [] and start["recorder"] and start["today"].startswith(str(start["year"])), start)

    # ══ (a) the Assumptions list, yield and price, all on one page (the page opens one crop at a time; the list is its other way): a price box and a yield box ══
    js("A.setView('assume'); document.querySelector('[data-as-mode=harvest]').click(); { const w = document.querySelector('[data-ah-way=list]'); if (w && w.getClientRects().length) w.click(); }"); wait(700)
    # a crop a third of the way down the list, so that the list has room to scroll both ways: its price box and its first yield box, both as drawn
    pick = js("""const rows = [...document.querySelectorAll('#ahBody tr')].filter(tr => { const p = tr.querySelector('input[data-hk^="price|"]'), y = tr.querySelector('input[data-hk^="y|"]'); return p && y && drawn(p) && drawn(y) && !p.disabled && !y.disabled && p.value === '' && y.value === ''; });
      const tr = rows[Math.floor(rows.length / 3)]; if (!tr) return { rows: rows.length };
      return { rows: rows.length, price: tr.querySelector('input[data-hk^="price|"]').dataset.hk, yield: tr.querySelector('input[data-hk^="y|"]').dataset.hk };""")
    P = '[data-hk="%s"]' % pick.get("price", "none"); Y = '[data-hk="%s"]' % pick.get("yield", "none")
    w = watch(P)
    check("the yield and price list draws a price box and a yield box to try, on a list long enough to scroll", bool(w) and w["under"] and bool(watch(Y)) and w["room"] > 300, {"pick": pick, "box": w})
    if w:
        w = watch(P); click_box(w); was = notch(100); a = seen()
        check("a price box that has been clicked, one notch of the wheel over it: the wheel reaches the box, and its figure is what it was", a["log"] == ["wheel"] and a["value"] == w["value"], {"before": w, "after": a})
        check("the list scrolls under that notch as it does anywhere else, and the box is still the one to type in", a["scroll"] is not None and a["scroll"] > was and a["focus"] and not a["readOnly"], {"scrolled from": was, "after": a})
        away(); b = seen()
        check("a click elsewhere, and nothing is saved: the figure, the plan and the undo list are what they were, and no line is shown", b["value"] == w["value"] and b["key"] == key0 and b["undo"] == [] and b["toast"] == "", b)
        undo_all()
        # (d) a typed figure is saved as before: Tab, a decimal point and Enter, Backspace, a minus. No wheel and no arrow in these lines.
        w = watch(P); click_box(w); page.keyboard.type("6"); page.keyboard.press("Tab"); wait(700)
        box = lambda: js("const el = document.querySelector(arg); return { value: el ? el.value : null, mine: !!el && el.closest('td').classList.contains('mine'), ...saved() }", P)
        t = box()
        check("a figure typed in the box and left with Tab is saved as before: the box shows it as the grower’s own, with one step to undo that says it", t["value"] == "6" and t["mine"] and len(t["undo"]) == 1 and "$6 " in t["undo"][0] and t["key"] != key0, t)
        w = watch(P); click_box(w); page.keyboard.press("End"); page.keyboard.type(".25"); a = seen(); page.keyboard.press("Enter"); wait(700); e = box()
        check("a decimal point and two digits typed after it, then Enter: the figure is saved, as before", bool(w) and a["value"] == "6.25" and e["value"] == "6.25" and len(e["undo"]) == 2 and "$6.25 " in e["undo"][-1], {"typed": a, "saved": e})
        w = watch(P); click_box(w); page.keyboard.press("End"); [page.keyboard.press("Backspace") for _ in range(3)]; a = seen(); page.keyboard.press("Tab"); wait(700); k = box()
        check("Backspace takes the last characters off, and what is left is saved when the box is left, as before", bool(w) and a["value"] == "6" and k["value"] == "6" and len(k["undo"]) == 3 and "$6 " in k["undo"][-1], {"typed": a, "saved": k})
        w = watch(P); click_box(w); page.keyboard.press("Control+a"); page.keyboard.type("-3"); a = seen(); page.keyboard.press("Tab"); wait(700); m = box()
        check("a minus can be typed and is refused when the box is left, as before: the box goes back to its figure and nothing is saved", bool(w) and a["value"] == "-3" and m["value"] == "6" and same(m, k), {"typed": a, "after": m})
        # the box now holds a figure of its own: the wheel, the arrows, and typing in the same moment as the wheel
        def held():   # back to the figure typed, whatever a line that failed left behind
            js("let n = 0; while (S.undo.length > 3 && n++ < 50) A.undo(); $('toast').classList.remove('show');"); wait(500)
        w = watch(P); click_box(w); notch(100); notch(-100); a = seen(); away(); b = seen()
        check("with a figure of its own in the box, a notch down and a notch up leave that figure, and leaving the box saves nothing more", bool(w) and w["value"] == "6" and a["log"] == ["wheel", "wheel"] and a["value"] == "6" and b["value"] == "6" and same(b, k), {"at the wheel": a, "after": b})
        held()
        # (c) the arrows
        w = watch(P); click_box(w); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowUp"); wait(300); a = seen(); away(); b = seen()
        check("ArrowDown and ArrowUp in the price box do not step it: the figure is what it was at once and after the box is left, and nothing more is saved", bool(w) and a["log"] == ["ArrowDown", "ArrowDown", "ArrowUp"] and a["value"] == "6" and same(a, k) and b["value"] == "6" and same(b, k), {"at the keys": a, "after": b})
        held()
        # A key can arrive before the box has been let go after the wheel. Whether it does is a matter of a millisecond, so the
        # moment is stretched here: every timer the page sets while the wheel turns runs half a second late, and the keys come first.
        w = watch(P); click_box(w); page.keyboard.press("End"); p = js("return at(N.box)"); page.mouse.move(p["x"], p["y"])
        js("N.timer = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => N.timer.call(window, fn, Math.max(+ms || 0, 500), ...rest);")
        page.mouse.wheel(0, 100); page.keyboard.type(".5"); a = seen()
        js("window.setTimeout = N.timer;"); wait(700); z = seen()
        check("a decimal point and a digit typed before the box has been let go after a notch of the wheel are both typed, after the figure that was there", bool(w) and a["log"][:2] == ["End", "wheel"] and a["value"] == "6.5" and z["value"] == "6.5" and not z["readOnly"], {"at the keys": a, "a moment later": z})
        page.keyboard.press("Control+a"); page.keyboard.type("6"); page.keyboard.press("Tab"); wait(500)   # the figure it had: nothing to save
        undo_all()
        back = box()
        check("undone, the price box is empty again and the plan is the one the check started from", back["value"] == "" and back["key"] == key0 and back["undo"] == [], back)
        # the yield box, as drawn: the wheel both ways and the arrows
        w = watch(Y)
        if w:
            click_box(w); notch(-100); notch(100); page.keyboard.press("ArrowUp"); page.keyboard.press("ArrowDown"); wait(300); a = seen(); away(); b = seen()
        check("a yield box that has been clicked keeps its figure under a notch up, a notch down, ArrowUp and ArrowDown, and nothing is saved when it is left", bool(w) and a["log"] == ["wheel", "wheel", "ArrowUp", "ArrowDown"] and a["value"] == w["value"] and b["value"] == w["value"] and b["key"] == key0 and b["undo"] == [] and b["toast"] == "", {"box": w, "at the keys": a if w else None, "after": b if w else None})
        shot("assumptions"); undo_all()

    # ══ (b) a planting's side panel: Harvest days ══
    js("A.setView('map'); A.select(null);"); wait(500)
    # a planting that carries harvest days of its own, somewhere a wheel notch down has room to change them
    pl = js("const p = S.plan.plantings.find(p => Number.isFinite(+p.hw) && +p.hw >= 5 && +p.hw <= 300 && eng.calc(p)); if (!p) return null; A.select({ type: 'planting', id: p.id }); return { id: p.id, hw: +p.hw };")
    wait(600)
    H = "#fHw"; w = watch(H) if pl else None
    hw = lambda: js("const p = eng.planting(arg); return p ? p.hw : null", pl["id"])
    check("a planting with harvest days of its own opens in the side panel, and the box shows them", bool(pl) and bool(w) and w["under"] and w["value"] == str(pl["hw"]), {"planting": pl, "box": w})
    if pl and w:
        click_box(w); notch(100); a = seen()
        check("“Harvest days”, clicked: one notch of the wheel reaches the box, and its figure is what it was", a["log"] == ["wheel"] and a["value"] == w["value"] and a["focus"] and not a["readOnly"], {"before": w, "after": a})
        away(); b = seen()
        check("a click elsewhere, and nothing is saved: the planting’s harvest days, the plan and the undo list are what they were", hw() == pl["hw"] and b["value"] == w["value"] and b["key"] == key0 and b["undo"] == [] and b["toast"] == "", {"hw": hw(), "after": b})
        undo_all()
        w = watch(H); click_box(w); notch(-100); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowUp"); wait(400); a = seen(); away(); b = seen()
        check("a notch the other way, ArrowDown and ArrowUp in “Harvest days” do not step it: the figure and the planting are what they were, at once and after the box is left", bool(w) and a["log"] == ["wheel", "ArrowDown", "ArrowDown", "ArrowUp"] and a["value"] == str(pl["hw"]) and a["key"] == key0 and a["undo"] == [] and hw() == pl["hw"] and b["key"] == key0 and b["undo"] == [], {"at the keys": a, "after": b})
        undo_all()
        w = watch(H); click_box(w); page.keyboard.press("Control+a"); page.keyboard.type(str(pl["hw"] + 7)); page.keyboard.press("Tab"); wait(700)
        t = {"hw": hw(), **js("const el = document.querySelector(arg); return { value: el ? el.value : null, ...saved() }", H)}
        check("harvest days typed and left with Tab are saved as before: the planting holds them, with one step to undo", t["hw"] == pl["hw"] + 7 and t["value"] == str(pl["hw"] + 7) and t["undo"] == ["Change harvest days"], t)
        shot("harvest-days"); undo_all()
        check("undone, the planting has its harvest days back and the plan is the one the check started from", hw() == pl["hw"] and js("return saved()")["key"] == key0, {"hw": hw()})
        # A box that cannot be edited is left as it is (on Seeds, the stock of a variety held in several lots is such a box): the
        # rule holds a clicked box for the length of one wheel event and lets it go, and must not let go a box it never held.
        # This one wheel event is made by the check and sent to the box, not turned: a real wheel over a box that cannot be
        # edited arrived at another element in this browser, so a turned wheel would try nothing here.
        w = watch(H); js("N.box.readOnly = true;")
        if w: click_box(w); js("N.box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));"); a = seen(); wait(400); z = seen(); js("if (N.box) N.box.readOnly = false;"); away()
        check("a number box that cannot be edited is still one after a notch of the wheel over it, at once and a moment later, and its figure is what it was", bool(w) and a["log"] == ["wheel"] and a["focus"] and a["readOnly"] and z["readOnly"] and z["value"] == w["value"] and z["key"] == key0 and z["undo"] == [], {"box": w, "at the wheel": a if w else None, "a moment later": z if w else None})
        undo_all()

    # ══ (e) every number box each main screen draws ══
    def sweep(name, need):
        """Every number box on show that can be typed in: the focus on it, the pointer on it, a notch of the wheel, ArrowUp, ArrowDown.
        The recorder must have seen the wheel and both keys arrive at the box, and no change of it. Stops at the fourth box that changed."""
        n = js("N.list = [...document.querySelectorAll('input[type=number]')].filter(el => drawn(el) && !el.disabled); return N.list.length")
        bad, beside, tried = [], [], 0
        if BOXES: n = min(n, BOXES)
        for i in range(n):
            for attempt in range(3):
                p = js("const el = N.list[arg]; if (!el || !el.isConnected) return null; N.box = el; N.log = []; const p = at(el); el.focus({ preventScroll: true }); return { ...p, value: el.value, label: el.id || el.getAttribute('aria-label') || el.dataset.hk || el.className }", i)
                if not p: break
                page.mouse.move(p["x"], p["y"]); page.mouse.wheel(0, -100 if i % 2 else 100); page.keyboard.press("ArrowUp"); page.keyboard.press("ArrowDown")
                # read two frames on: by then the list has come to rest under the notch, and the next box is found where it will be
                r = page.evaluate("async () => { const N = window.__nb; await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); return { log: N.log.slice(), value: N.box.isConnected ? N.box.value : null }; }")
                if r["log"][:1] == ["wheel"] or attempt == 2: break
                wait(200)   # the list was still moving under the pointer from the notch before: once more
            if not p: bad.append({"box": i, "why": "it was drawn again while the others were tried, so something changed"}); break
            tried += 1
            if r["log"][:1] != ["wheel"] or r["log"][1:2] != ["ArrowUp"]: beside.append({"box": p["label"], "log": r["log"]})
            elif r["log"] != ["wheel", "ArrowUp", "ArrowDown"] or r["value"] != p["value"]: bad.append({"box": p["label"], "was": p["value"], "is": r["value"], "log": r["log"]})
            if len(bad) >= 4: break
        js("if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"); wait(400)
        s = js("return saved()")
        check(f"{name}: every number box drawn keeps its figure under a notch of the wheel, ArrowUp and ArrowDown, and nothing is saved", (n > 0 or not need) and tried == n and not bad and not beside and s["key"] == key0 and s["undo"] == [],
              {"boxes": n, "tried": tried, "changed": bad, "the wheel or a key fell beside": beside[:4], "saved": s})
        if s["undo"]: undo_all()
        return n
    counts = {}
    for name, how, need in SCREENS:
        js(how); wait(900)
        counts[name] = sweep(name, need)
    # a planting's side panel: drawn by a click on a planting, and where the figures of that one planting are kept
    if pl: js("A.setView('map'); A.select({ type: 'planting', id: arg });", pl["id"]); wait(700)
    counts["a planting’s side panel"] = sweep("a planting’s side panel", True)
    check("each screen that is known to draw number boxes drew some, so none was passed over for want of a box", all(counts.get(name, 0) > 0 for name, how, need in SCREENS if need) and counts["a planting’s side panel"] >= 3, counts)

    # ══ (f) the handlers that use the arrow keys for something else ══
    # Seeds: a variety's row with the focus, and the arrows walk the list
    js("A.select(null); A.setView('seeds'); LRFSeeds.select(null);"); wait(700)
    rows = js("return [...document.querySelectorAll('#sdBody .sd-var')].slice(0, 3).map(tr => tr.dataset.variety)")
    walk = []
    if len(rows) == 3:
        js("LRFSeeds.select({ type: 'variety', id: arg }, true);", rows[0]); wait(500)
        js("const tr = document.querySelector('#sdBody .sd-var'); tr.focus();")
        for key in ("ArrowDown", "ArrowDown", "ArrowUp"):
            page.keyboard.press(key); wait(500)
            walk.append(js("const t = document.activeElement; return t && t.dataset ? t.dataset.variety || null : null"))
    check("on Seeds, with a variety’s row in focus, ArrowDown goes to the next variety and ArrowUp back, as before", len(rows) == 3 and walk == [rows[1], rows[2], rows[1]], {"rows": rows, "walk": walk})
    # the quick line: the arrows walk the suggestions under the variety's name
    js("LRFSeeds.select(null);"); wait(400)
    word = js("const names = S.plan.varieties.filter(v => !v.deleted && v.name).map(v => String(v.name).trim().toLowerCase()), by = {}; for (const n of names) { const k = n.slice(0, 2); if (/^[a-z]{2}$/.test(k)) by[k] = (by[k] || 0) + 1; } return Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;")
    sug = []
    if word and page.locator("#qlVariety").count():
        page.click("#qlVariety"); page.keyboard.type(word[0]); wait(500)
        on = "const l = $('qlList'), on = l && !l.hidden ? [...l.children].findIndex(li => li.getAttribute('aria-selected') === 'true') : -1; return { open: !!l && !l.hidden, n: l ? l.children.length : 0, on, typed: $('qlVariety').value };"
        sug.append(js(on))
        for key in ("ArrowDown", "ArrowDown", "ArrowUp"):
            page.keyboard.press(key); wait(200); sug.append(js(on))
        page.keyboard.press("Escape"); wait(200); js("$('qlVariety').value = ''; $('qlVariety').dispatchEvent(new Event('input', { bubbles: true })); $('qlVariety').blur();"); wait(300)
    check("in the quick line on Seeds, ArrowDown and ArrowUp walk the suggestions under the name being typed, as before", len(sug) == 4 and all(x["open"] and x["n"] >= 3 and x["typed"] == word[0] for x in sug) and [x["on"] for x in sug] == [0, 1, 2, 1], {"typed": word, "suggestions": sug})
    # the layout: the arrows move the ground that is picked, and inside a number box of the layout they move nothing and step nothing
    js("A.setView('map'); A.select(null);"); wait(500)
    beds = js("LRFMapEdit.open(); return S.plan.beds.filter(b => eng.isSoilBed(b) && b.active !== false && LRFMap.shapeOf(b.id)).slice(0, 6).map(b => b.id);")
    wait(600)
    place = lambda: js("const s = LRFMap.shapeOf(arg); return s ? [Math.round(s.x * 1000) / 1000, Math.round(s.y * 1000) / 1000] : null", bed)
    bed, moves, steps = None, [], []
    for bed in beds:   # the first bed with room above it: a step into its neighbour is refused, and proves nothing
        undo_all(); js("LRFMapEdit.pick([arg]); if (document.activeElement && document.activeElement.blur) document.activeElement.blur();", bed); wait(300)
        moves = [place()]
        for keys in (["ArrowUp"], ["ArrowDown", "ArrowDown"]):   # the ground settles a moment after the last key, and is then one step to undo
            for key in keys: page.keyboard.press(key)
            wait(1000); moves.append(place())
        steps = js("return S.undo.map(u => u.label)")
        if all(moves) and moves[1] != moves[0] and moves[2] != moves[1]: break
    ok_moves = bool(bed) and len(moves) == 3 and all(moves) and moves[1][1] < moves[0][1] and moves[2][1] > moves[0][1] and all(m[0] == moves[0][0] for m in moves) and abs((moves[0][1] - moves[1][1]) - (moves[2][1] - moves[0][1])) < 0.01 and len(steps) == 2 and all(x.startswith("Nudge ") for x in steps)
    check("in the layout, ArrowUp moves the bed that is picked one step up and ArrowDown one step down, each a step to undo, as before", ok_moves, {"beds": beds, "bed": bed, "places": moves, "undo": steps})
    undo_all()
    w = watch("#fLayL") if bed else None
    if w:
        before = place(); click_box(w); notch(100); page.keyboard.press("ArrowUp"); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); wait(900); a = seen()
        js("if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"); wait(900); b = js("return saved()")
    check("in a number box of the layout, the wheel and the arrows move no ground and step no figure: the bed, its length and the plan are what they were", bool(w) and a["log"] == ["wheel", "ArrowUp", "ArrowDown", "ArrowDown"] and a["value"] == w["value"] and place() == before and b["key"] == key0 and b["undo"] == [], {"box": w, "at the keys": a if w else None, "after": b if w else None, "bed": [before, place()] if w else None})
    shot("layout"); js("LRFMapEdit.close();"); wait(400); undo_all()

    # ══ (the same rule for two keys) Ctrl+Z and Ctrl+Y: while a box holds typing the plan has not taken, they are the box's own and
    # take back that typing; anywhere else, and in a box whose typing has been taken, they are the planner's. They used to be taken
    # before the page asked whether a box had the focus, so the key meant for a slip of typing took back the last change to the
    # plan. One change is made first, so that there is something to undo. ══
    js("A.select(null); A.setView('map')"); wait(400)
    made = js("return !!A.editStock('A lot, filed by the check', (lib, ctx) => LRFSeedLib.addLot(lib, { key: 'v:a-variety-of-the-check', unit: 'seeds', quantity: 10, status: 'usable' }, ctx), 'A variety of the check')"); wait(600)
    one = js("return saved()")
    typed = False
    if page.locator("#libSearch").count() and page.locator("#libSearch").first.is_visible():
        page.locator("#libSearch").click(); page.keyboard.type("abc"); wait(200); typed = js("return $('libSearch').value") == "abc"
        page.keyboard.press("Control+z"); wait(500)
    inbox = js("return { value: $('libSearch').value, focus: document.activeElement === $('libSearch'), ...saved(), redo: S.redo.length }")
    check("with a change to the plan waiting to be undone, Ctrl+Z in a box that is being typed in takes back the typing and leaves the plan as it is", made and typed and len(one["undo"]) == 1 and inbox["focus"] and inbox["value"] != "abc" and same(inbox, one) and inbox["redo"] == 0, [one, inbox])
    js("$('libSearch').value = ''; $('libSearch').dispatchEvent(new Event('input', { bubbles: true }));"); away(); page.keyboard.press("Control+z"); wait(700)
    out = js("return { ...saved(), redo: S.redo.length }")
    check("outside a box Ctrl+Z is the planner's, as before: the last change to the plan is taken back", out["key"] == key0 and out["undo"] == [] and out["redo"] == 1, out)
    page.locator("#libSearch").click(); page.keyboard.type("x"); page.keyboard.press("Control+y"); page.keyboard.press("Control+Shift+z"); wait(500)
    held = js("return { focus: document.activeElement === $('libSearch'), ...saved(), redo: S.redo.length }")
    check("in a box that is being typed in the redo keys, Ctrl+Y and Ctrl+Shift+Z, put nothing back into the plan", held["focus"] and held["key"] == key0 and held["undo"] == [] and held["redo"] == 1, held)
    js("$('libSearch').value = ''; $('libSearch').dispatchEvent(new Event('input', { bubbles: true }));"); away(); page.keyboard.press("Control+y"); wait(700)
    again = js("return { ...saved(), redo: S.redo.length }")
    check("outside a box Ctrl+Y redoes it", same(again, one) and again["redo"] == 0, again)
    # a list box has no typing to take back: with one in focus the key is the planner's, as it is on a button or on the page
    js("A.setView('assume'); document.querySelector('[data-as-mode=days]').click();"); wait(700)
    on_list = js("const s = [...document.querySelectorAll('#asBody select')].find(drawn); if (!s) return false; s.focus(); return document.activeElement === s && s.tagName === 'SELECT';")
    page.keyboard.press("Control+z"); wait(700)
    lst = js("return { ...saved(), redo: S.redo.length }")
    check("with a list box in focus, which has no typing to take back, Ctrl+Z is the planner's", on_list and lst["key"] == key0 and lst["undo"] == [] and lst["redo"] == 1, [on_list, lst])
    js("if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); S.redo.length = 0;")
    # a figure typed and taken is the plan's: Ctrl+Z undoes it with the cursor still in its box, as it always did
    cell = js("const el = [...document.querySelectorAll('#asBody input[data-key]')].find(drawn); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), key: el.dataset.key, was: el.value || el.placeholder };")
    taken = None
    if cell:
        page.mouse.click(cell["x"], cell["y"]); page.keyboard.press("Control+a"); page.keyboard.type(str(int(float(cell["was"] or 50)) + 3)); page.keyboard.press("Enter"); wait(900)
        taken = js("return { ...saved(), inBox: !!document.activeElement && document.activeElement.tagName === 'INPUT' }")
        page.keyboard.press("Control+z"); wait(900)
    undone = js("return saved()")
    check("a figure typed into a box and taken by the plan is undone by Ctrl+Z with the cursor still in a box, as before", bool(cell) and bool(taken) and len(taken["undo"]) == 1 and taken["key"] != key0 and taken["inBox"] and undone["key"] == key0 and undone["undo"] == [], [cell, taken, undone])
    js("if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); S.redo.length = 0;")

    js("A.select(null); A.setView('map')"); wait(400)
    end = js("return saved()")
    check("after all of it the plan is the one the check started from, with nothing to undo", end["key"] == key0 and end["undo"] == [], end)
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
