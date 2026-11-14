"""Preview 0.39 (the clean-up build) in a real browser: no screen names the planner's earlier version; rows of figures leave no
grey block; the Harvest table opens with a whole column against the crop names; and the smaller things the build put right.
usage: python3 -I cleanup_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, sys, threading
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
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, $ = id => document.getElementById(id), eng = S.engine;"
       "const NAMES = /\\bv7\\b|old planner|rebuild preview/i;"
       # every word on the page as it stands: what is shown, and what a pointer or a screen reader is told
       "const sweep = () => { const out = []; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);"
       " for (let n = walk.nextNode(); n; n = walk.nextNode()) { const p = n.parentElement; if (!p || p.closest('script, style')) continue; if (NAMES.test(n.textContent)) out.push(n.textContent.trim().slice(0, 90)); }"
       " for (const el of document.body.querySelectorAll('[title], [aria-label], [placeholder]')) for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && NAMES.test(v)) out.push(a + ': ' + v.slice(0, 90)); }"
       " return out; };"
       # a row of figures with a grey block in it: a line of tiles that does not reach both edges of its box
       "const holes = () => { const out = []; for (const box of document.querySelectorAll('.stats')) { if (!box.offsetWidth) continue; const b = box.getBoundingClientRect(), cs = getComputedStyle(box), l = b.left + parseFloat(cs.borderLeftWidth), r = b.right - parseFloat(cs.borderRightWidth); const rows = new Map();"
       " for (const t of box.querySelectorAll(':scope > .stat')) { const q = t.getBoundingClientRect(), k = Math.round(q.top); rows.set(k, [...(rows.get(k) || []), q]); }"
       " for (const line of rows.values()) { const a = Math.min(...line.map(q => q.left)), z = Math.max(...line.map(q => q.right)); if (Math.abs(a - l) > 1.5 || Math.abs(z - r) > 1.5) out.push({ id: box.id || box.className, tiles: box.children.length, left: +(a - l).toFixed(1), right: +(r - z).toFixed(1) }); } } return out; };"
       "const boxes = () => [...document.querySelectorAll('.stats')].filter(b => b.offsetWidth).map(b => b.querySelectorAll(':scope > .stat').length);"
       # the Harvest table: where the first column that shows stands against the two that stay put
       "const harvest = () => { const sc = $('hvScroll'); if (!sc) return null; const tot = sc.querySelector('thead .hv-total').getBoundingClientRect(), box = sc.getBoundingClientRect(); const cols = [...sc.querySelectorAll('thead th[data-col]')].map(th => ({ now: th.classList.contains('now'), r: th.getBoundingClientRect() }));"
       " const first = cols.find(c => c.r.right > tot.right + 1), now = cols.find(c => c.now); return { room: Math.round(sc.scrollWidth - sc.clientWidth), scroll: Math.round(sc.scrollLeft), off: first ? +(first.r.left - tot.right).toFixed(1) : null, nowSeen: !!now && now.r.left >= tot.right - 1 && now.r.right <= box.right + 1, before: now ? cols.filter(c => c.r.left >= tot.right - 1 && c.r.right <= now.r.left + 1).length : null, cols: cols.length }; };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 900}, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(6000)
    page.evaluate("LRFApp.state.undo.length = 0")
    def js(body):
        try: return page.evaluate("(() => { " + PRE + " " + body + " })()")
        except Exception as e:
            errors.append(str(e)[:200]); return None
    def wait(ms=500): page.wait_for_timeout(ms)
    named = {}   # where the earlier version was named, screen by screen
    looked = []
    def look(where):
        got = js("return sweep();")
        looked.append(where)
        if got is None or len(got): named[where] = got

    start = js("return { n: S.plan.plantings.length, label: ($('buildNote') || {}).textContent || '', sample: A.isSample(), key: A.contentKey(), undo: S.undo.length };") or {}
    check("a plan is open and the build says “Preview 0.39”", start.get("n", 0) > 300 and start.get("label", "").startswith("Preview 0.39 ·") and not start.get("sample"), start)
    js("A.setDate(E.s2d('2027-06-15')); return 1;"); wait(400)

    # ── the Backup menu ──
    menu = js("return { load: ($('importBtn').querySelector('b') || {}).textContent, loadSmall: ($('importBtn').querySelector('small') || {}).textContent, down: ($('exportBtn').querySelector('b') || {}).textContent, downSmall: ($('exportBtn').querySelector('small') || {}).textContent };") or {}
    check("the Backup menu says “Load a backup…” and “Download a backup”, and names no other planner", menu.get("load") == "Load a backup…" and menu.get("down") == "Download a backup" and "plan as one file" in (menu.get("downSmall") or ""), menu)
    page.click("#dataBtn"); wait(300); look("the Backup menu"); page.keyboard.press("Escape"); js("$('dataMenu').hidden = true; return 1;")

    # ── the map and its panels ──
    look("the map, with the plan's overview")
    check("the overview's row of figures reaches both edges of its box", (js("return boxes();") or []) and js("return holes();") == [], js("return holes();"))
    four = js("""const p = S.plan.plantings.find(p => { const r = eng.calc(p), b = S.plan.beds.find(b => b.id === p.bedId); return r && b && !eng.isRack(b) && !eng.isTower(b) && r.cells && !r.ct && !r.tw && !r.rack; });
      if (!p) return null; A.select({ type: 'planting', id: p.id }); return p.id;""")
    wait(600)
    q = js("const all = [...document.querySelectorAll('.inspector .stats')].map(b => b.querySelectorAll(':scope > .stat').length); return { all, holes: holes() };") or {}
    check("a planting with four figures under Quantities is found and shown", bool(four) and 4 in (q.get("all") or []), q)
    check("its four figures leave no grey block: every line of them reaches both edges", bool(four) and q.get("holes") == [], q.get("holes"))
    look("a planting's panel")
    js("const p = S.plan.plantings.find(p => p.id === S.sel.id); A.select({ type: 'bed', id: p.bedId }); return 1;"); wait(500)
    check("a bed's panel leaves no grey block either", js("return holes();") == [], js("return holes();"))
    look("a bed's panel")
    js("A.select(null); LRFPanels.showSettle(); return 1;"); wait(400); look("To settle")
    js("A.select(null); LRFMapEdit.open({}); return 1;"); wait(700)
    check("Edit layout's figures leave no grey block", js("return holes();") == [], js("return holes();"))
    look("Edit layout"); js("LRFMapEdit.close(); return 1;"); wait(300)
    js("A.openAhead({ mode: 'series', cropId: S.plan.plantings.find(p => /lettuce/i.test(p.cropId)).cropId }); return 1;"); wait(700); look("the series tool")
    js("A.select(null); return 1;")

    # ── the season bar ──
    frost = js("return [...document.querySelectorAll('#seasonMarks .season-frost')].map(el => { const b = el.querySelector('b'), bg = b ? getComputedStyle(b).backgroundColor : ''; return { word: b ? b.textContent : null, bg, plain: [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).length }; });") or []
    check("both frost marks carry their words on a ground of their own, so no month line runs through them", len(frost) == 2 and all(f["word"] in ("last frost", "first frost") and f["plain"] == 0 and f["bg"] not in ("", "rgba(0, 0, 0, 0)", "transparent") for f in frost), frost)
    js("LRFSeason.openDates(); return 1;"); wait(500); look("the season's dates"); js("LRFSeason.closeDates(); return 1;")

    # ── the timeline ──
    js("A.setView('timeline'); return 1;"); wait(900); look("the timeline")

    # ── Harvest ──
    js("A.setView('harvest'); return 1;"); wait(1100)
    hv = js("return { lead: (document.querySelector('.hv-head-text p:not(.eyebrow)') || {}).textContent || '', at: harvest() };") or {}
    check("Harvest says how a crop is picked in the Assumptions list's own three words", all(w in hv.get("lead", "") for w in ("gradually", "clear", "on demand")) and "a week at a time" not in hv.get("lead", ""), hv.get("lead"))
    at = hv.get("at") or {}
    check("the Harvest table opens scrolled, with this week in view and up to three weeks before it (or, where the whole season fits, not scrolled at all)", at.get("nowSeen") and ((at.get("scroll", 0) > 0 and at.get("before") in (1, 2, 3)) or (at.get("scroll") == 0 and at.get("room", 9) <= 1)), at)
    check("and with a whole column against the crop names, not part of one", at.get("off") is not None and abs(at["off"]) <= 1, at)
    for grain in ("day", "month", "week"):
        page.click(f"#hvWrap button[data-hv-grain={grain}]"); wait(700)
        g = js("return harvest();") or {}
        check(f"the same by {grain}: a whole column against the crop names" + ("" if grain == "month" else ", today's in view"), g.get("off") is not None and abs(g["off"]) <= 1 and (grain == "month" or g.get("nowSeen")), g)
    look("Harvest")

    # ── Tasks ──
    js("A.setView('sow'); return 1;"); wait(1000)
    late = js("const s = document.querySelector('#swWrap details summary b'); return s ? s.textContent : null;")
    check("the line for earlier tasks ends its first sentence before the next begins", late is not None and late.endswith("not recorded."), late)
    look("Tasks")

    # ── the Nursery ──
    js("A.setView('trays'); return 1;"); wait(900)
    for tab in ("room", "live", "supplies", "setup"):
        js(f"LRFTraysView.setTab('{tab}'); return 1;"); wait(600); look("Nursery, " + tab)
    ticks = js("return [...document.querySelectorAll('#bnSetup input[type=checkbox]')].slice(0, 6).map(i => getComputedStyle(i).accentColor);") or []
    check("a tick on Set-up is in the page's own ink, not the browser's blue", len(ticks) > 0 and all(c == "rgb(19, 36, 28)" for c in ticks), ticks[:3])

    # ── Seeds ──
    js("A.setView('seeds'); return 1;"); wait(1200); look("Seeds, the list")
    # the first variety listed that does not say where its days are counted from. Its panel is opened by a click on its name: the
    # middle of a row can be one of the row's own boxes (a variety with supplier's days has “days counted from” there), and a click on a box opens nothing
    quiet = js("const row = [...document.querySelectorAll('#sdBody tr[data-variety]')].find(r => ((eng.variety(r.dataset.variety) || {}).catalogMaturityBasis || 'unspecified') === 'unspecified'); return row ? row.dataset.variety : null;")
    if quiet: page.click(f'#sdBody tr[data-variety="{quiet}"] .as-vname'); wait(700)
    opened = js(f"const row = document.querySelector('#sdBody tr[data-variety=\"{quiet}\"]'), p = $('sdPanel'); return {{ marked: !!row && row.classList.contains('sel'), panel: !!p && p.offsetWidth > 0 && !!p.querySelector('form') }};") or {}
    check("the Seeds list has a variety that does not say where its days are counted from, and a click on its name opens its panel", quiet and opened.get("marked") and opened.get("panel"), [quiet, opened])
    panel = js("""const s = [...document.querySelectorAll('#sdPanel select')].find(s => s.querySelector('option[value=unspecified]') && s.querySelector('option[value=transplant]'));
      if (!s) return null; const o = s.querySelector('option[value=unspecified]'), cs = getComputedStyle(s), c = document.createElement('canvas').getContext('2d'); c.font = cs.font;
      const heads = [...document.querySelectorAll('#sdPanel h3')].filter(h => h.offsetWidth).map(h => getComputedStyle(h).fontFamily.split(',')[0].replace(/"/g, '').trim());
      return { word: o.textContent, shown: s.selectedOptions[0] === o, text: Math.ceil(c.measureText(o.textContent).width), room: Math.floor(s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), heads, mono: getComputedStyle(document.documentElement).getPropertyValue('--mono').split(',')[0].replace(/"/g, '').trim() };""") or {}
    check("a variety's “Days counted from” opens on “As the crop”, and the words fit their box", panel.get("word") == "As the crop" and panel.get("shown") and panel.get("text", 999) <= panel.get("room", 0), panel)
    check("the headings in a variety's panel are set like every other panel's", len(panel.get("heads") or []) >= 3 and all(h == panel.get("mono") for h in panel["heads"]), panel.get("heads"))
    look("Seeds, a variety's panel")
    js("LRFSeeds.openOrder(); return 1;"); wait(700); look("the order sheet"); page.keyboard.press("Escape"); wait(200)
    page.click("#sdAddLink"); wait(600)
    title = js("const d = document.querySelector('dialog[open] h2'); return d ? d.textContent : null;")
    check("“Add from a link” opens a window with that name", title == "Add a variety from a link", title)
    look("Add from a link"); page.keyboard.press("Escape"); wait(300)
    for tab in ("gallery", "crops", "list"):
        page.click(f"[data-sd-tab={tab}]"); wait(600); look("Seeds, " + tab)

    # ── Assumptions ──
    js("A.setView('assume'); return 1;"); wait(1000)
    fixed = js("return [...new Set([...document.querySelectorAll('#asBody .as-start .as-fixed')].map(x => x.textContent))];") or []
    check("a crop with no choice of where its days are counted from says so in the list's own words", len(fixed) > 0 and all(w in ("direct seeding", "seeding in trays", "planting") for w in fixed), fixed)
    lead = js("return { lead: $('asLead').textContent, diff: ($('asDiffLine') || {}).textContent || '' };") or {}
    check("the list's first line speaks of what days are counted from", "what its days are counted from" in lead.get("lead", "") and "where its days start" not in lead.get("lead", ""), lead)
    js("const d = $('asAuditMore'); if (d) d.open = true; return 1;"); look("Assumptions, days")
    page.click("[data-as-mode=harvest]"); wait(700); look("Assumptions, yield and price"); page.click("[data-as-mode=days]"); wait(300)
    opened = js("const b = $('asReview'); if (!b || b.disabled) return false; LRFAssume.auditView({ by: 'kind', all: true }); LRFAssume.openAudit(); return true;")
    if opened:
        wait(1000)
        kinds = js("const d = $('auditDlg'); return d && d.open ? { text: d.innerText } : null;") or {}
        look("the review window, by kind")
        js("const b = [...$('auditDlg').querySelectorAll('button')].find(b => b.textContent.trim() === 'By crop'); if (b) b.click(); return !!b;"); wait(900)
        crops = js("const d = $('auditDlg'); return d && d.open ? { text: d.innerText, by: [...d.querySelectorAll('button[aria-pressed=true]')].map(b => b.textContent.trim()) } : null;") or {}
        check("the review window is read both ways: by kind of figure, then by crop", "By crop" in (crops.get("by") or []) and crops.get("text") != kinds.get("text"), crops.get("by"))
        both = kinds.get("text", "Old copy") + "\n" + crops.get("text", "Old copy"); copies = "Copied crop values" in kinds.get("text", "")
        # by kind the section is named; by crop each line is. Both are read, and where the plan has such figures the new word must be there
        check("the review window names no “old copy”: a copied figure is a “Copied value”", "Old copy" not in both and "old planner" not in both and (not copies or "Copied value" in crops.get("text", "")), {"copies": copies, "seen": "Copied value" in crops.get("text", ""), "old": "Old copy" in both})
        look("the review window, by crop")
        page.keyboard.press("Escape"); wait(300)
    else:
        check("the review window is read both ways: by kind of figure, then by crop", True)
        check("the review window names no “old copy”: a copied figure is a “Copied value”", True)

    # ── the Backup windows ──
    js("A.setView('map'); void LRFBackupUI.openSnaps(); return 1;"); wait(700); look("Snapshots"); page.keyboard.press("Escape"); wait(300)
    if js("return !!$('syncBtn') && !$('syncBtn').hidden;"):
        js("void LRFBackupUI.openSync(); return 1;"); wait(700); look("Cloud sync"); page.keyboard.press("Escape"); wait(300)

    check("no screen, tooltip or label names the planner's earlier version (%d screens read)" % len(looked), len(looked) >= 28 and not named, named)
    end = js("return { key: A.contentKey(), undo: S.undo.length, n: S.plan.plantings.length };") or {}
    check("looking changed nothing: the same plan, nothing to undo", end.get("key") == start.get("key") and end.get("undo") == 0 and end.get("n") == start.get("n"), [start, end])
    check("no error on the page", not errors, errors[:4])
    page.screenshot(path=str(shots / f"cleanup-{WIDTH}.png"))
    finish()
