"""Preview 0.53 (the small fixes of Nov 16) in a real browser.
The build that is running is said in the header, always: a pill beside the year where there is room, the number alone under
the year at 1400 wide and under, where it costs the header no width. A press opens "What changed": every build, latest first,
with one line on what it did and three things to try at most, and a mark on the builds this browser has not opened it for.
On the Map, what can be done is a card of two columns behind "?" at the end of the map's tools, and no longer a list in the side
panel. Under "Several varieties…" a tick leaves the list of varieties where it was scrolled to. In Edit layout a bed drawn too
small for its grips says so, and the box that matches a whole garden to the photo is named for what it does.
(Loose ends shown only while something needs the grower, the yields nobody has checked as one of its rows, and "Remove this lot"
are in loose_check.py.)
Every subject is found on the plan the page was given; nothing here names a crop, a bed or a figure of any plan.
usage: python3 -I fixes_053_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280, DARK=1, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, re, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1280")); DARK = os.environ.get("DARK") == "1"; STOP = os.environ.get("STOP_AT_FAIL") == "1"
LABEL = os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)"   # the build's label, as tests/env.sh reads it from the page's own script
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
       "const box = el => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };"
       "const saved = () => ({ key: A.contentKey(), undo: S.undo.length });"
       # the header as it stands: the chip, the year it stands by, the tabs, and whether the header is still one line with nothing pushed out of it
       "const head = () => { const t = document.querySelector('header.top'), c = $('buildChip'), cs = c ? getComputedStyle(c) : null; return { chip: box(c), words: c ? [...c.children].filter(drawn).map(x => x.textContent).join('') : '', year: box($('seasonYear')), name: box(document.querySelector('.brand-name')), tabs: box(document.querySelector('nav.views')),"
       " high: Math.round(t.getBoundingClientRect().height), side: t.scrollWidth > t.clientWidth + 1, edge: cs ? parseFloat(cs.borderTopWidth) : -1, inBrand: !!c && !!c.closest('.brand'), button: !!c && c.tagName === 'BUTTON', said: c ? c.getAttribute('aria-label') : '' }; };"
       # the sheet "What changed", as it is read: its parts found by their hooks (tests/README.md, "Hooks"), so that a change of look leaves this alone
       "const hook = (name, within) => (within || document).querySelector(`[data-hook=\"${name}\"]`), hooks = (name, within) => [...(within || document).querySelectorAll(`[data-hook=\"${name}\"]`)];"
       "const sheet = () => { const d = $('changesDlg'); if (!d || !d.open) return null; const r = d.getBoundingClientRect(), l = $('changesList'), done = $('changesDone');"
       " return { title: (d.querySelector('h2') || {}).textContent, lead: (hook('changes-lead', d) || {}).textContent || '', builds: hooks('changes-build', d).map(b => ({ label: b.dataset.build, head: hook('changes-head', b).firstChild.textContent, when: (hook('changes-when', b) || {}).textContent || '', fresh: !!hook('changes-new', b), did: (hook('changes-did', b) || {}).textContent || '', steps: hooks('changes-step', b).length })),"
       " dark: [...d.querySelectorAll('.btn.primary')].map(b => b.textContent), close: d.querySelectorAll('.icon-btn.close').length, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, scrolls: !!l && l.scrollHeight > l.clientHeight + 20, foot: !!done && done.getBoundingClientRect().bottom <= r.bottom && done.getBoundingClientRect().bottom <= innerHeight,"
       " newer: $('changesNewer') ? { text: $('changesNewer').querySelector('span').textContent, press: [...$('changesNewer').querySelectorAll('button')].map(b => [b.textContent, b.classList.contains('primary')]) } : null }; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="dark" if DARK else "light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    def ready():
        page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=60000); page.wait_for_timeout(900)
    page.goto(url); ready()
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)
    page.evaluate("LRFApp.state.undo.length = 0")
    js = lambda body, arg=None: page.evaluate("(arg) => { " + PRE + " " + body + " }", arg)
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def shot(name): page.screenshot(path=str(shots / f"{name}-{WIDTH}.png"))
    def size(w, h=900): page.set_viewport_size({"width": w, "height": h}); wait(450)
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

    js("A.setView('map'); A.select(null);"); wait(700)
    key0 = js("return A.contentKey()")

    # ══ the build in view ══
    size(1707)
    wide = js("return head()")
    note = js("return txt('buildNote')")
    check("the header says the build that is running, by the label the page's own script carries: a button in the brand, named for what it opens; the Backup menu's last line still says it with the plan's facts",
          bool(wide["chip"]) and wide["words"] == f"Preview {LABEL}" and wide["inBrand"] and wide["button"] and wide["said"] == f"Preview {LABEL}: what changed" and note.startswith(f"Preview {LABEL} · "), [wide, note])
    check("above 1400 wide it is a bounded pill beside the year, on the header's one line", bool(wide["chip"]) and wide["edge"] >= 1 and wide["chip"]["left"] >= wide["year"]["right"] and wide["chip"]["top"] < wide["year"]["bottom"] and wide["chip"]["bottom"] > wide["year"]["top"]
          and wide["chip"]["right"] + 4 <= wide["tabs"]["left"] and wide["high"] <= 60 and not wide["side"], wide)
    shot("build-chip-wide")
    narrow = []
    for w in (1400, 1280):
        size(w); narrow.append(js("return head()"))
    size(WIDTH)
    check("at 1400 wide and under it is the number alone, under the year, and takes no width from the header: nothing in the brand reaches further right than before, the year keeps clear of the tabs, the header is one line",
          all(bool(n["chip"]) and n["words"] == LABEL and n["edge"] == 0 and n["chip"]["top"] >= n["year"]["bottom"] - 2 and n["chip"]["left"] == n["year"]["left"] and n["chip"]["w"] <= n["year"]["w"] + 4 and max(n["year"]["right"], n["chip"]["right"]) + 4 <= n["tabs"]["left"]
              and n["chip"]["bottom"] <= n["high"] and n["high"] <= 60 and not n["side"] for n in narrow), narrow)

    # ══ what changed ══
    js("try { localStorage.removeItem('lrf.changes.seen'); } catch (e) {}")
    size(1280)
    opened = press("#buildChip", 500) and js("return sheet()")
    labels = [b["label"] for b in (opened or {}).get("builds", [])]
    order = [tuple(int(x) for x in l.split(".")) for l in labels if re.fullmatch(r"\d+(\.\d+)+", l or "")]
    check("a press opens “What changed”: a title, one sentence, and every build latest first, this build's own first and said to be this build",
          bool(opened) and opened["title"] == "What changed" and 20 < len(opened["lead"]) < 120 and len(labels) >= 7 and len(order) == len(labels) and order == sorted(order, reverse=True) and len(set(order)) == len(order)
          and labels[0] == LABEL and opened["builds"][0]["when"].endswith("this build") and sum(b["when"].endswith("this build") for b in opened["builds"]) == 1 and all(b["head"] == f"Preview {b['label']}" for b in opened["builds"]), opened)
    check("each build has one line on what it did and one to three things to try, with the day it was merged", bool(opened) and all(20 < len(b["did"]) <= 260 and 1 <= b["steps"] <= 3 and re.match(r"[A-Z][a-z]{2} \d{1,2}", b["when"]) for b in opened["builds"]), opened)
    check("it is a sheet that changes nothing: “Done” is its one dark button and it has no × as well; it fits the window, and its list scrolls between the title and the foot", bool(opened) and opened["dark"] == ["Done"] and opened["close"] == 0 and opened["inside"] and opened["scrolls"] and opened["foot"] and opened["newer"] is None, opened)
    shot("what-changed")
    first_time = bool(opened) and all(b["fresh"] for b in opened["builds"])
    press("#changesDone", 400)
    done = js("return { open: !!$('changesDlg'), focus: document.activeElement === $('buildChip'), ...saved() }")
    again = press("#buildChip", 500) and js("return sheet()")
    page.keyboard.press("Escape"); wait(400)
    esc = js("return { open: !!$('changesDlg'), ...saved() }")
    check("the first time in a browser every build is marked “New”; opened again, none is", first_time and bool(again) and len(again["builds"]) == len(labels) and not any(b["fresh"] for b in again["builds"]), [opened, again])
    check("“Done” closes it and gives the chip the focus back; Escape closes it too; the plan is as it was, with nothing to undo", not done["open"] and done["focus"] and not esc["open"] and esc["key"] == key0 and esc["undo"] == 0, [done, esc])
    # a build newer than the one this browser has opened the list for is marked, and no other
    older = labels[1] if len(labels) > 1 else ""
    js("try { localStorage.setItem('lrf.changes.seen', arg); } catch (e) {}", older)
    part = press("#buildChip", 500) and js("return sheet()")
    shut()
    check("where the list was last opened on the build before, this build alone is marked “New”", bool(part) and [b["label"] for b in part["builds"] if b["fresh"]] == [LABEL], part)
    # a newer build fetched and waiting for a reload: said on the chip, and in the sheet with the one press
    before_dot = js("const c = $('buildChip'); return { newer: c.dataset.newer || '', dot: getComputedStyle(c, '::after').content }")
    js("LRFChanges.ready()"); wait(200)
    dot = js("const c = $('buildChip'), a = getComputedStyle(c, '::after'); return { newer: c.dataset.newer || '', dot: a.content, w: parseFloat(a.width), bg: a.backgroundColor, title: c.title }")
    told = press("#buildChip", 500) and js("return sheet()")
    shot("what-changed-newer")
    shut()
    check("when a newer build is ready the chip carries a dot and says so, and the sheet says it with “Reload”, a plain button: “Done” is still the one dark one",
          before_dot["newer"] == "" and before_dot["dot"] in ("none", "normal") and dot["newer"] == "1" and dot["dot"] not in ("none", "normal") and dot["w"] >= 5 and "newer build is ready" in dot["title"]
          and bool(told) and bool(told["newer"]) and "newer build" in told["newer"]["text"] and told["newer"]["press"] == [["Reload", False]] and told["dark"] == ["Done"], [before_dot, dot, told])
    js("const c = $('buildChip'); delete c.dataset.newer;")
    size(390, 800); wait(500)
    phone = js("const t = document.querySelector('header.top'); return { phone: document.body.classList.contains('phone'), chip: drawn($('buildChip')), high: Math.round(t.getBoundingClientRect().height), side: t.scrollWidth > t.clientWidth + 1, note: txt('buildNote') }")
    size(WIDTH); wait(500)
    check("on a phone the header has no room for it and keeps to its one line; the Backup menu's last line says the build there", phone["phone"] and not phone["chip"] and phone["high"] <= 60 and not phone["side"] and phone["note"].startswith(f"Preview {LABEL} · "), phone)

    # ══ the Map's "?" ══
    js("A.setView('map'); A.select(null);"); wait(500)
    side = js("const p = $('inspectorBody'); return { howto: p.querySelectorAll('.howto').length, said: [...p.querySelectorAll('h3')].map(x => x.textContent).filter(t => /on the map/i.test(t)), link: !!p.querySelector('#ovSeries') }")
    tools = js("const t = document.querySelector('.map-tools'), b = $('mapHelp'); return { last: !!b && t.lastElementChild === b, text: b ? b.textContent : '', round: b ? getComputedStyle(b).borderTopLeftRadius : '', box: box(b), said: b ? b.getAttribute('aria-label') : '', open: b ? b.getAttribute('aria-expanded') : '', scale: box($('mapScale')), first: box(t.firstElementChild) }")
    check("what can be done on the map is no longer listed in the side panel; a round “?” stands at the end of the map's tools", side["howto"] == 0 and side["said"] == [] and not side["link"] and tools["last"] and tools["text"] == "?" and tools["said"] == "What can be done on the map" and tools["open"] == "false" and bool(tools["box"]) and tools["box"]["w"] == tools["box"]["h"], [side, tools])
    check("with “?” among them the map's tools keep 8 px or more clear of the scale at the map's other corner", bool(tools["scale"]) and bool(tools["first"]) and tools["first"]["left"] >= tools["scale"]["right"] + 8, tools)
    WANT = ["Plant", "Plan a succession", "Move", "Copy", "Trade", "Share a bed", "Zoom and pan", "Colours"]
    card = press("#mapHelp", 400) and js("""const c = $('mapHelpCard'); if (!c) return null; const r = c.getBoundingClientRect(), dts = [...c.querySelectorAll('dt')], dds = [...c.querySelectorAll('dd')], b = $('mapHelp').getBoundingClientRect();
      return { names: dts.map(d => d.textContent), pairs: dts.length === dds.length, beside: dts.every((d, i) => dds[i] && dds[i].getBoundingClientRect().left >= d.getBoundingClientRect().right && Math.abs(dds[i].getBoundingClientRect().top - d.getBoundingClientRect().top) <= 3),
        oneLine: dts.every(d => { const r = document.createRange(); r.selectNodeContents(d); return r.getClientRects().length === 1; }), full: dds.every(d => d.textContent.trim().length > 10), inside: r.left >= 0 && r.right <= innerWidth && r.top >= b.bottom && r.bottom <= innerHeight, open: $('mapHelp').getAttribute('aria-expanded'), link: !!c.querySelector('dd #ovSeries'), paragraphs: c.querySelectorAll('p').length };""")
    check("it opens a card of two columns under it, inside the window: a name and what it does, for planting, a succession, moving, copying, trading, sharing a bed, the view and the colours, then the tools that carry words of their own",
          bool(card) and card["names"][:8] == WANT and card["pairs"] and card["beside"] and card["oneLine"] and card["full"] and card["inside"] and card["open"] == "true" and card["link"] and card["paragraphs"] == 0, card)
    shot("map-help")
    page.keyboard.press("Escape"); wait(250)
    esc2 = js("return { card: !!$('mapHelpCard'), focus: document.activeElement === $('mapHelp'), open: $('mapHelp').getAttribute('aria-expanded') }")
    press("#mapHelp", 300); page.mouse.click(100, 26); wait(250)   # the farm's name in the header: a click there does nothing else
    away = js("return { card: !!$('mapHelpCard'), ...saved() }")
    check("Escape closes the card and gives “?” the focus back; a click elsewhere closes it; nothing has changed", not esc2["card"] and esc2["focus"] and esc2["open"] == "false" and not away["card"] and away["key"] == key0 and away["undo"] == 0, [esc2, away])
    went = press("#mapHelp", 300) and press("#ovSeries", 700) and js("return { sel: S.sel && S.sel.type, form: !!document.querySelector('#inspectorBody #srForm'), card: !!$('mapHelpCard'), view: S.view, ...saved() }")
    js("A.select(null)"); wait(300)
    check("“plan one now” in it opens the tool for a succession with no crop picked, in the side panel, and the card gives way to it", bool(went) and went["sel"] == "series" and went["form"] and not went["card"] and went["view"] == "map" and went["key"] == key0, went)

    # ══ several varieties in a bed: a tick leaves the list where it was ══
    # the subject: a planting that offers "Several varieties…" and whose crop has more varieties than the list shows at once
    found = None
    cands = js("""const n = new Map(); for (const v of S.plan.varieties) if (v.active !== false && !v.deleted) n.set(v.cropId, (n.get(v.cropId) || 0) + 1);
      const seen = new Set(), out = []; for (const p of S.plan.plantings) { if (seen.has(p.cropId) || (n.get(p.cropId) || 0) < 10) continue; const b = eng.bedOf(p.bedId); if (!b || !eng.isSoilBed(b)) continue; seen.add(p.cropId); out.push({ id: p.id, n: n.get(p.cropId) }); }
      return out.sort((a, b) => b.n - a.n).slice(0, 8);""")
    for c in cands:
        js("A.select({ type: 'planting', id: arg })", c["id"]); wait(500)
        if not press("#fSeveral", 400): continue
        l = js("const l = $('mixPickList'); return l ? { room: l.scrollHeight - l.clientHeight, free: [...l.querySelectorAll('input[data-variety]')].filter(i => !i.disabled && !i.checked).length } : null")
        if l and l["room"] >= 60 and l["free"] >= 2: found = c; break
        press("#mixCancel", 300)
    if found:
        # the panel is scrolled too, as far as leaves the whole list in view: a real click on a box that is out of sight would bring it into view itself
        js("const l = $('mixPickList'), host = $('inspectorBody'); l.scrollTop = l.scrollHeight; host.scrollTop = 0; host.scrollTop = Math.max(0, $('mixPick').getBoundingClientRect().top - host.getBoundingClientRect().top - 40);"); wait(200)
        at = js("""const l = $('mixPickList'), r = l.getBoundingClientRect(), tick = [...l.querySelectorAll('input[data-variety]')].filter(i => !i.disabled && !i.checked).reverse().find(i => { const b = i.getBoundingClientRect(); return b.top >= r.top && b.bottom <= r.bottom; });
          return tick ? { list: l.scrollTop, panel: $('inspectorBody').scrollTop, variety: tick.dataset.variety, says: txt('mixSays') } : null""")
        if at: page.locator('#mixPickList input[data-variety="%s"]' % at["variety"]).click(); wait(500)
        after = js("""const l = $('mixPickList'), i = l && [...l.querySelectorAll('input[data-variety]')].find(x => x.dataset.variety === arg); return l ? { list: l.scrollTop, panel: $('inspectorBody').scrollTop, ticked: !!i && i.checked, focus: !!i && document.activeElement === i, says: txt('mixSays'), ...saved() } : null""", (at or {}).get("variety"))
        shot("several-varieties")
        check("under “Several varieties…”, with the list scrolled to its foot, a tick leaves the list and the panel where they were: the box is ticked, it keeps the keyboard, and what the bed would come to is said under it",
              bool(at) and bool(after) and at["list"] >= 60 and at["panel"] > 0 and abs(after["list"] - at["list"]) <= 1 and abs(after["panel"] - at["panel"]) <= 1 and after["ticked"] and after["focus"] and after["says"] != at["says"] and after["key"] == key0 and after["undo"] == 0, [found, at, after])
        if at: page.locator('#mixPickList input[data-variety="%s"]' % at["variety"]).click(); wait(400)
        off = js("const l = $('mixPickList'); return l ? { list: l.scrollTop } : null")
        press("#mixCancel", 300)
        check("unticked, it stays there too; Cancel leaves the bed as it was", bool(at) and bool(off) and abs(off["list"] - at["list"]) <= 1 and not js("return !!$('mixPick')") and js("return saved()") == {"key": key0, "undo": 0}, [at, off])
    else:
        check("under “Several varieties…”, with the list scrolled to its foot, a tick leaves the list and the panel where they were: the box is ticked, it keeps the keyboard, and what the bed would come to is said under it", False, {"no planting on this plan offers a list of varieties long enough to scroll": cands})
        check("unticked, it stays there too; Cancel leaves the bed as it was", False, "no subject")
    js("A.select(null)"); wait(300)

    # ══ Edit layout: a bed too small for its grips says so; the box that fits a garden to the photo ══
    press("#mapFit", 500)
    bed = js("""const beds = S.plan.beds.filter(b => b.active !== false && eng.isSoilBed(b) && LRFMap.shapeOf(b.id)); beds.sort((a, b) => LRFMap.shapeOf(a.id).L - LRFMap.shapeOf(b.id).L);
      const b = beds[0]; return b ? { id: b.id, garden: b.gardenId, all: S.plan.beds.filter(x => x.gardenId === b.gardenId && x.active !== false).map(x => x.id) } : null""")
    states = []
    if bed:
        js("LRFMapEdit.open({ bedIds: [arg] })", bed["id"]); wait(700)
        read = "const w = [...document.querySelectorAll('#mapEdit .le-word')].map(t => t.textContent).filter(t => /ft/.test(t)); return { grips: document.querySelectorAll('#mapEdit .le-grip').length, word: w[0] || '', picked: LRFMapEdit.picked().length }"
        states.append(js(read))
        for _ in range(14):   # out, until the bed is too small for any grip
            if states[-1]["grips"] == 0 or not press("#mapZoomOut", 450): break
            states.append(js(read))
        for _ in range(14):   # and in again, until it has all four
            if states[-1]["grips"] == 4 or not press("#mapZoomIn", 450): break
            states.append(js(read))
    plain = re.compile(r"^[\d.,]+ × [\d.,]+ ft$")
    fits = lambda s: (s["grips"] == 0 and s["word"].endswith(" · zoom in to drag an end") and plain.match(s["word"].split(" · ")[0])) or (s["grips"] == 2 and s["word"].endswith(" · zoom in to drag a side")) or (s["grips"] == 4 and plain.match(s["word"]))
    check("in Edit layout a bed drawn too small for its grips says “zoom in to drag an end” after its measure; zoomed in until its ends can be dragged it says the same of its sides, and with all four grips it says its measure alone",
          bool(bed) and all(s["picked"] == 1 and fits(s) for s in states) and {0, 2, 4} <= {s["grips"] for s in states} and states[-1]["grips"] == 4, states)
    shot("edit-layout-small-bed")
    if bed and len(bed["all"]) > 1:
        js("LRFMapEdit.open({ bedIds: arg })", bed["all"]); wait(600)
    fit = js("""const i = $('leDrawn'), f = i && i.closest('label, .field'); return i ? { label: f ? (f.querySelector('span') || f).firstChild.textContent : '', all: f ? f.textContent : '', value: i.value, old: [...document.querySelectorAll('#layoutPanel label, #layoutPanel .field')].some(x => /Drawn at/.test(x.textContent)) } : null""")
    check("with a whole garden picked, the box that matches it to the photo is named “Fit to the photo (%)”, and its line says it is a percent of true size that leaves the beds' real sizes alone", bool(fit) and fit["label"] == "Fit to the photo (%)" and "percent of its true size" in fit["all"] and "real sizes do not change" in fit["all"] and not fit["old"], fit)
    js("LRFMapEdit.close()"); wait(400); press("#mapFit", 500)

    js("A.select(null); A.setView('map')"); wait(400)
    end = js("return saved()")
    check("after all of it the plan is the one the check started from, with nothing to undo", end["key"] == key0 and end["undo"] == 0, end)
    check("the page raised no error", not errors, errors[:4])
    browser.close()
finish()
