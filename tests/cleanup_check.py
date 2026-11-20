"""Preview 0.39 (the clean-up build) in a real browser: no screen names the planner's earlier version; rows of figures leave no
grey block; the Forecast table opens with a whole column against the crop names; and the smaller things the build put right.
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
    check("a plan is open and the build says “Preview” and its own label", start.get("n", 0) > 300 and start.get("label", "").startswith("Preview %s ·" % (os.environ.get("LRF_LABEL") or "(LRF_LABEL is not set)")) and not start.get("sample"), start)
    js("A.setDate(E.s2d('2027-06-15')); return 1;"); wait(400)

    # ── the Backup menu ──
    menu = js("return { load: ($('importBtn').querySelector('b') || {}).textContent, loadSmall: ($('importBtn').querySelector('small') || {}).textContent, down: ($('exportBtn').querySelector('b') || {}).textContent, downSmall: ($('exportBtn').querySelector('small') || {}).textContent };") or {}
    check("the Backup menu says “Load a backup…” and “Download a backup”, and names no other planner", menu.get("load") == "Load a backup…" and menu.get("down") == "Download a backup" and "plan as one file" in (menu.get("downSmall") or ""), menu)
    page.click("#dataBtn"); wait(300); look("the Backup menu"); page.keyboard.press("Escape"); js("$('dataMenu').hidden = true; return 1;")

    # ── the map and its panels ──
    look("the map, with the plan's overview")
    page.click("#mapHelp"); wait(300); look("the Map's “?”"); page.keyboard.press("Escape"); wait(200)
    page.click("#buildChip"); wait(400); look("What changed"); page.keyboard.press("Escape"); wait(300)
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
    hv = js("return { lead: (document.querySelector('[data-hook=\"fc-lead\"]') || {}).textContent || '', at: harvest() };") or {}
    check("Forecast says, behind “?”, how a crop is picked in the Assumptions list's own three words", all(w in hv.get("lead", "") for w in ("Gradually:", "Clear:", "On demand:")) and "a week at a time" not in hv.get("lead", ""), hv.get("lead"))
    at = hv.get("at") or {}
    check("the Forecast table opens scrolled, with this week in view and up to three weeks before it (or, where the whole season fits, not scrolled at all)", at.get("nowSeen") and ((at.get("scroll", 0) > 0 and at.get("before") in (1, 2, 3)) or (at.get("scroll") == 0 and at.get("room", 9) <= 1)), at)
    check("and with a whole column against the crop names, not part of one", at.get("off") is not None and abs(at["off"]) <= 1, at)
    for grain in ("day", "month", "week"):
        page.click(f"#hvWrap button[data-hv-grain={grain}]"); wait(700)
        g = js("return harvest();") or {}
        check(f"the same by {grain}: a whole column against the crop names" + ("" if grain == "month" else ", today's in view"), g.get("off") is not None and abs(g["off"]) <= 1 and (grain == "month" or g.get("nowSeen")), g)
    look("Forecast")
    # the whole season at one press, in dollars, and its "?": read for words that do not belong like any other screen
    page.click('[data-hook="fc-season-btn"]'); wait(700); page.click('[data-hook="fc-measure"] [data-measure="dollars"]'); wait(700)
    fs = js("const sc = $('hvScroll'); return sc ? { side: Math.round(sc.scrollWidth - sc.clientWidth), fit: (document.querySelector('[data-hook=\"fc-table\"]') || { dataset: {} }).dataset.fit } : null;") or {}
    check("Forecast's whole season, in dollars, fits the window with nothing to scroll sideways", fs.get("fit") == "season" and fs.get("side", 9) <= 0, fs)
    look("Forecast, the whole season in dollars")
    page.click('[data-hook="fc-help"]'); wait(300); look("Forecast's “?”"); page.keyboard.press("Escape"); wait(200)
    page.click('[data-hook="fc-measure"] [data-measure="amounts"]'); wait(300); page.click("#hvWrap button[data-hv-grain=week]"); wait(500)

    # ── Tasks ──
    js("A.setView('sow'); return 1;"); wait(1000)
    late = js("const e = document.querySelector('#swWrap .tk-empty p'), n = document.querySelector('#swWrap .tk-next'); return e ? [e.textContent, n ? n.textContent : ''] : null;")
    check("an empty day says so in a sentence that ends, and names the next task to come", late is not None and late[0] == "Nothing is planned for today." and late[1].startswith("Next: "), late)
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
    page.click("[data-as-mode=harvest]"); wait(700); look("Assumptions, yield and price")
    if page.locator("[data-ah-way=list]").count() and page.locator("[data-ah-way=list]").first.is_visible(): page.click("[data-ah-way=list]"); wait(600); look("Assumptions, yield and price, all on one page")
    page.click("[data-as-mode=days]"); wait(300)
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
        check("the review window is read both ways: by kind of figure, then by crop", False, "the review window did not open: the plan has no planting that differs from the list, so nothing was read")
        check("the review window names no “old copy”: a copied figure is a “Copied value”", False, "the review window did not open")

    # ── the words, from one glossary (his notes of Nov 16, section 3): the long notes behind "?", the long hovers cut, never DTM ──
    def card(hook, n=0, wait_ms=300):
        """Opens the n-th "?" with this hook, reads its card (by the card's own hook), and closes it again by the same button."""
        got = js("const b = document.querySelectorAll('[data-hook=%s]')[%d]; if (!b || !b.offsetWidth) return null; b.scrollIntoView({ block: 'center' }); b.click();"
                 " const c = document.querySelector('[data-hook=%s-card]'), out = c ? { text: c.innerText, rows: [...c.querySelectorAll('dt')].map(d => d.textContent.trim()) } : { text: '', rows: [] }; b.click(); return out;" % (hook, n, hook))
        wait(wait_ms); return got
    js("A.setView('assume'); LRFAssume.setMode('days'); return 1;"); wait(800)
    days = card("assume-help") or {}
    js("LRFAssume.setMode('harvest'); const way = document.querySelector('[data-ah-way=card]'); if (way) way.click(); return 1;"); wait(800)   # the card, where the crops are a list of buttons
    yields = card("assume-help") or {}
    crops = set(js("return eng.crops().map(c => c.name);") or [])
    titled = js("return $('asTitle').title;")
    check("the Assumptions “?” gives each half's terms: what days are counted from, and marketable yield, the harvest patterns and the harvest window; it lists no crop as a control",
          all(w in (days.get("rows") or []) for w in ("Transplanting", "Seeding in trays", "Direct seeding", "Seed to harvest")) and all(w in (yields.get("rows") or []) for w in ("Marketable yield", "Gradually", "Clear", "On demand", "Harvest window"))
          and not any(r.startswith(c) for r in (days.get("rows") or []) + (yields.get("rows") or []) for c in crops) and not titled, {"days": days.get("rows"), "yield": yields.get("rows"), "title": titled})
    # hovers the build cut to their point: the two lists' heads, the personal-use switch, a crop's unit and harvest pattern on the card, Seeds' “All orders arrived”, Loose ends
    long = js("const t = [...document.querySelectorAll('#asTable thead th[title], #ahHead th[title], [data-yk=pick], [data-yk=unit]')].map(e => e.title).concat([$('ahHouseFarm').title, ($('settleBadge') || {}).title || '']);"
              " return t.filter(x => x.length >= 140);")
    js("A.setView('seeds'); return 1;"); wait(800)
    long = (long or []) + (js("const b = $('sdReceiveAll'); return b && b.title.length >= 140 ? [b.title] : [];") or [])
    check("the long hovers are cut to their point: none of those the build rewrote is 140 characters or more", long == [], long)
    js("A.setView('map'); A.select(null); return 1;"); wait(800)
    settle = js("const s = $('toSettle'); return s ? { paras: [...s.children].filter(x => x.tagName === 'P').length } : null;")
    said = card("settle-help") or {}
    check("To settle's note is behind its “?”: no paragraph stands under its head, and the “?” leads with “To settle” in bold, then says what is counted", settle is not None and settle["paras"] == 0 and (said.get("rows") or [""])[0] == "To settle" and "booked twice" in said.get("text", ""), {"settle": settle, "said": said})
    js("const S2 = LRFSuccession, o = S2.openings(eng).find(o => o.whole && S2.fits(eng, o).length > 3); if (o) A.select({ type: 'opening', id: o.id, bedId: o.bed.id }); return !!o;"); wait(900)
    fits = js("const f = $('ahFits'); return f ? [...f.querySelectorAll('p')].map(p => p.textContent).filter(t => t.length >= 140) : null;")
    said = card("fits-help") or {}
    check("What fits says what makes a crop fit behind its “?”, led by its term in bold, in the glossary's words, and no paragraph stands under it", fits == [] and (said.get("rows") or [""])[0] == "What fits" and "harvest window" in said.get("text", ""), {"standing": fits, "said": said})
    # "Grown for" in a planting's panel: the two words behind "?", each in bold; under the switch nothing, while the planting follows the default
    js("const F = LRFForecast, p = S.plan.plantings.find(p => { const b = eng.bedOf(p.bedId); return b && !eng.isTower(b) && eng.calc(p) && F.useOf(eng, p).by === 'default'; }); if (p) A.select({ type: 'planting', id: p.id }); return !!p;"); wait(800)
    grown = js("const f = $('fUseField'); return f ? { said: f.querySelectorAll('[data-hook=use-said]').length, text: f.innerText, label: (f.querySelector('[data-hook=use-label]') || {}).textContent || '' } : null;")
    said = card("use-help") or {}
    check("Grown for in a planting's panel: Commercial and Personal use are defined behind its “?”, each term in bold, and nothing stands under the switch while the planting follows the default",
          grown is not None and grown["label"] == "Grown for" and grown["said"] == 0 and "left out of revenue" not in grown["text"] and said.get("rows") == ["Commercial", "Personal use"] and "left out of revenue" in said.get("text", ""), {"grown": grown, "said": said})
    bed = js("const p = S.sel && S.sel.type === 'planting' ? eng.planting(S.sel.id) : null; return p ? p.bedId : null;")
    js("LRFMapEdit.open({ bedId: %s, field: 'leUse' }); return 1;" % json.dumps(bed)); wait(700)
    lay = js("const f = $('leUseField'); return f ? { text: f.innerText, label: (f.querySelector('[data-hook=use-label]') || {}).textContent || '' } : null;")
    said = card("use-help") or {}
    js("LRFMapEdit.close(); A.select(null); return 1;"); wait(500)
    check("Grown for in Edit layout: the same two terms behind its “?”, and under the box only what is so of the space",
          lay is not None and lay["label"].startswith("Grown for") and "left out of revenue" not in lay["text"] and said.get("rows") == ["Commercial", "Personal use"], {"layout": lay, "said": said})
    js("A.select(null); A.setView('trays'); LRFTraysView.setTab('setup'); return 1;"); wait(900)
    bench = js("const r = $('bnRules'); return r ? { helps: r.querySelectorAll('[data-hook=bench-help]').length, paras: [...r.querySelectorAll('p')].filter(p => p.textContent.length >= 100).length } : null;")
    said, cool = card("bench-help") or {}, card("bench-help", 1) or {}   # each "?" opened and read: the rules', then the unheated benches'
    check("the Nursery's hardening-off and growing-on rules say what they do behind two “?”, each led by its term in bold, and no paragraph stands beside their heads", bench == {"helps": 2, "paras": 0} and (said.get("rows") or [""])[0] == "Hardening off and growing on" and "harden off" in said.get("text", "") and (cool.get("rows") or [""])[0] == "On the unheated benches" and "unheated benches" in cool.get("text", ""), {"bench": bench, "said": said, "cool": cool})
    dtm = {}
    for where, how in [("map", "A.setView('map'); A.select(null);"), ("timeline", "A.setView('timeline');"), ("forecast", "A.setView('harvest');"), ("tasks", "A.setView('sow');"), ("nursery", "A.setView('trays'); LRFTraysView.setTab('room');"),
                       ("seeds", "A.setView('seeds');"), ("days to harvest", "A.setView('assume'); LRFAssume.setMode('days');"), ("yield and price, one crop at a time", "A.setView('assume'); LRFAssume.setMode('harvest'); document.querySelector('[data-ah-way=card]').click();")]:
        js(how + " return 1;"); wait(700)
        got = js("const t = [document.body.innerText, ...[...document.querySelectorAll('[title], [aria-label]')].map(e => (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || ''))].join(' '); return t.match(/.{0,30}\\bDTM\\b.{0,30}/g) || [];")
        if got is None or got: dtm[where] = got
    check("the letters DTM stand on no screen and in no hover: days to harvest is said in words (8 screens read)", not dtm, dtm)
    js("A.setView('map'); A.select(null); return 1;"); wait(400)

    # ── the Backup windows ──
    js("A.setView('map'); void LRFBackupUI.openSnaps(); return 1;"); wait(700); look("Snapshots"); page.keyboard.press("Escape"); wait(300)
    if js("return !!$('syncBtn') && !$('syncBtn').hidden;"):
        js("void LRFBackupUI.openSync(); return 1;"); wait(700); look("Cloud sync"); page.keyboard.press("Escape"); wait(300)

    # ── a second window of the same browser: it only shows the plan, and a strip across the page says so ──
    second = ctx.new_page(); second.goto(url); second.wait_for_function("window.LRFApp && LRFApp.state.ready"); second.wait_for_timeout(700)
    try: strip = second.evaluate("(() => { " + PRE + " const s = $('windowStrip'); return { shown: !!s && !s.hidden && /another window/.test(s.innerText), words: sweep() }; })()")
    except Exception as e: strip = {"shown": False, "words": [str(e)[:200]]}
    looked.append("A second window")
    if not strip["shown"] or strip["words"]: named["A second window"] = strip["words"] or ["the strip of a window that only shows the plan is not there to be read"]
    second.close()

    check("no screen, tooltip or label names the planner's earlier version (%d screens read)" % len(looked), len(looked) >= 31 and not named, named)
    end = js("return { key: A.contentKey(), undo: S.undo.length, n: S.plan.plantings.length };") or {}
    check("looking changed nothing: the same plan, nothing to undo", end.get("key") == start.get("key") and end.get("undo") == 0 and end.get("n") == start.get("n"), [start, end])
    check("no error on the page", not errors, errors[:4])
    page.screenshot(path=str(shots / f"cleanup-{WIDTH}.png"))
    finish()
