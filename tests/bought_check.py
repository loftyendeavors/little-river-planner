"""N2, bought-in plants, in a real browser, on the made-up farm. On Seeds, a variety's panel: under In the plan each planting of a crop
raised from seed or bought in as plants has its own switch, Seed | Bought in, with a "?" that gives both terms in bold; under Bought in,
who its plants are bought from and the lot they are sold in, each set at once with Undo. A planting bought in has no sowing on Tasks
and is not among the trays to fill; switched to Seed it is sown again, its harvest where it was; Undo gives the plan back exactly. The
list counts a variety bought in for one planting and sown for another on two lines. The order sheet lists the plants beside seed, under
the grower, in whole lots; marked as ordered they are on order in plants, and the order's arrival makes them on hand.
Every subject is found on the plan the page was given: nothing here names a crop, a variety, a bed or a number of any plan.
usage: python3 -I bought_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1280, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, re, sys, threading
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
def check(name, ok, detail=None):
    results.append({"name": name, "ok": bool(ok), **({"detail": detail} if detail is not None and not ok else {})})
    if not ok:
        failed.append(name)
        if STOP: finish()
def finish():
    print(json.dumps({"passed": len(results) - len(failed), "of": len(results), "failed": failed, "details": [r for r in results if not r["ok"]][:12], "errors": errors[:6]}, default=str))
    sys.stdout.flush(); os._exit(1 if failed else 0)
# the page's clock: November 19 of the year before the plan's, the ordering season
FAKE = "(() => { const R = Date, off = new R(2026, 10, 19, 10).getTime() - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; })();"
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, SL = LRFSeedLib, UI = LRFUI, V = LRFSowView, $ = id => document.getElementById(id), eng = S.engine;"
       "const hook = n => document.querySelector('[data-hook=\"' + n + '\"]'), hooks = n => [...document.querySelectorAll('[data-hook=\"' + n + '\"]')];"
       "const drawn = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';"
       "const iso = d => E.validDate(d) ? E.d2s(d) : null;"
       "const sw = id => hooks('planting-from').find(el => el.dataset.planting === id) || null;"
       "const sowsIt = id => V.figures().list.some(l => l.members.some(m => m.p.id === id));"
       "const plantsIt = id => V.jobs().some(l => l.section === 'plant' && l.members.some(m => m.p.id === id));")
def js(page, body, arg=None):
    return page.evaluate("(arg) => { %s %s }" % (PRE, body), arg)
def press(page, selector, ms=400):
    """A thing a fault has taken away is not pressed: the named line after it fails, and the check goes on."""
    hit = page.locator(selector)
    if not hit.count() or not hit.first.is_visible(): return False
    hit.first.click(timeout=3000); page.wait_for_timeout(ms); return True

def run(pw):
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 960}); ctx.add_init_script(FAKE); page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready", timeout=20000)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1500)

    # ── the subjects, by the engine's own figures: a planting bought in whose variety names its lot and grower; a variety bought in
    # for one planting and sown for another, with no lot on file ──
    pick = js(page, """
      const live = p => { const r = eng.calc(p); return r && !p.established && !p.done && !p.liveTray && r.b.active !== false ? r : null; };
      const plugs = S.plan.plantings.find(p => live(p) && eng.calc(p).boughtIn && p.startedFrom === 'plant' && (eng.variety(p.varietyId) || {}).buyLot > 0 && (eng.variety(p.varietyId) || {}).buyFrom);
      const two = S.plan.plantings.find(p => live(p) && eng.calc(p).boughtIn && p.varietyId && !(eng.variety(p.varietyId) || {}).buyLot
        && S.plan.plantings.some(q => q !== p && q.varietyId === p.varietyId && live(q) && !eng.calc(q).boughtIn && eng.calc(q).plannedSow));
      const sown = two && S.plan.plantings.find(q => q.varietyId === two.varietyId && live(q) && !eng.calc(q).boughtIn && eng.calc(q).plannedSow);
      if (!plugs || !two || !sown) return null;
      const v = eng.variety(plugs.varietyId), r = eng.calc(plugs);
      return { plugs: plugs.id, v: v.id, lot: v.buyLot, from: v.buyFrom, buy: r.buy, two: two.id, tv: two.varietyId, sown: sown.id, sowDay: iso(eng.calc(sown).plannedSow), field: iso(r.field), first: iso(r.first) };""")
    check("the plan has a planting bought in whose variety names its lot and grower, and a variety bought in for one planting and sown for another, for the check to work on", pick, pick)
    if not pick: finish()
    start = js(page, "return { plan: JSON.stringify(S.plan), key: A.contentKey(), undo: S.undo.length };")

    # ── Tasks: no sowing, its planting out there ──
    t = js(page, "return { sows: sowsIt(arg.plugs), plants: plantsIt(arg.plugs), other: sowsIt(arg.sown) };", pick)
    check("a planting bought in has no sowing on Tasks, and its planting out is there", not t["sows"] and t["plants"], t)
    check("a planting of the same variety that is sown has its sowing on Tasks", t["other"], t)

    # ── Seeds: the variety's panel ──
    js(page, "A.setView('seeds'); LRFSeeds.select({ type: 'variety', id: arg.v }); return null;", pick); page.wait_for_timeout(900)
    panel = js(page, """const s = sw(arg.plugs), box = hook('buy-box'), lot = hook('buy-lot'), from = hook('buy-from'), help = hook('from-help');
      const pressed = s ? [...s.querySelectorAll('button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent) : [];
      const pr = $('sdPanel').getBoundingClientRect(), sr = s ? s.getBoundingClientRect() : null, btn = document.querySelector('[data-sowfor="' + arg.plugs + '"]'), br = btn ? btn.getBoundingClientRect() : null;
      return { switch: drawn(s), from: s ? s.dataset.from : '', pressed, box: drawn(box), lot: lot ? lot.value : '', grower: from ? from.value : '', hint: box ? box.textContent : '', help: drawn(help),
        inside: !!sr && !!br && sr.right <= pr.right + 1 && br.right <= pr.right + 1 && sr.left >= pr.left, btn: btn ? btn.textContent : '' };""", pick)
    check("in the variety's panel, the planting bought in has its own switch, at Bought in", panel["switch"] and panel["from"] == "plant" and panel["pressed"] == ["Bought in"], panel)
    check("the switch and the planting's own button stand inside the panel", panel["inside"], panel)
    check("a planting bought in is recorded as planted, not sown", "Planted" in panel["btn"], panel["btn"])
    check("under Bought in, the grower and the lot are the variety's own", panel["box"] and panel["lot"] == str(pick["lot"]) and panel["grower"] == pick["from"], panel)
    check("the box says how many plants are to buy, in whole lots", re.search(r"\d+ plants to buy, \d+ × %d plants" % pick["lot"], panel["hint"]) is not None, panel["hint"])
    press(page, '[data-hook="from-help"]', 300)
    card = js(page, "const c = hook('from-help-card'); return c ? { dt: [...c.querySelectorAll('dt')].map(d => d.textContent), bold: [...c.querySelectorAll('dt')].every(d => parseInt(getComputedStyle(d).fontWeight, 10) >= 600) } : null;")
    check("its \"?\" gives Seed and Bought in, each term in bold", card and card["dt"] == ["Seed", "Bought in"] and card["bold"], card)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.screenshot(path=str(shots / "panel.png"))

    # ── switched to Seed: sown again, the harvest where it was; Undo ──
    js(page, "const s = sw(arg.plugs); const b = s && [...s.querySelectorAll('button')].find(x => x.dataset.to === 'seed'); if (b) b.click(); return null;", pick); page.wait_for_timeout(900)
    a = js(page, "const p = eng.planting ? S.engine.planting(arg.plugs) : null, r = S.engine.calc(p); return { from: p.startedFrom || '', said: S.engine.startedFrom(p), sow: iso(r.plannedSow), field: iso(r.field), first: iso(r.first), undo: S.undo.length, sows: sowsIt(arg.plugs), toast: (document.querySelector('.toast') || {}).textContent || '' };", pick)
    check("Seed on a planting bought in makes it sown, in one step: its sowing is on Tasks again", a["said"] == "seed" and a["sow"] and a["sows"] and a["undo"] == start["undo"] + 1, a)
    check("its days in the bed and its harvest are where they were", a["field"] == pick["field"] and a["first"] == pick["first"], a)
    check("the answer says it, with Undo, and that no planting's dates change", "sown from seed" in a["toast"] and "dates change" in a["toast"], a["toast"])
    js(page, "A.undo(); return null;"); page.wait_for_timeout(700)
    back = js(page, "return { plan: JSON.stringify(S.plan), key: A.contentKey(), undo: S.undo.length };")
    check("Undo gives the plan back exactly", back["plan"] == start["plan"] and back["key"] == start["key"] and back["undo"] == start["undo"], {"key": [start["key"], back["key"]]})

    # ── a sown planting switched to Bought in ──
    js(page, "LRFSeeds.select({ type: 'variety', id: arg.tv }); return null;", pick); page.wait_for_timeout(900)
    js(page, "const s = sw(arg.sown); const b = s && [...s.querySelectorAll('button')].find(x => x.dataset.to === 'plant'); if (b) b.click(); return null;", pick); page.wait_for_timeout(900)
    b = js(page, "const p = S.engine.planting(arg.sown), r = S.engine.calc(p); return { from: p.startedFrom || '', bought: !!r.boughtIn, sow: iso(r.plannedSow), sows: sowsIt(arg.sown), plants: plantsIt(arg.sown), toast: (document.querySelector('.toast') || {}).textContent || '' };", pick)
    check("Bought in on a sown planting writes its own word, and its sowing leaves Tasks; its planting out stays", b["from"] == "plant" and b["bought"] and not b["sow"] and not b["sows"] and b["plants"], b)
    check("the answer says how many plants to buy and the sowing that goes", re.search(r"bought in, \d+ plants to buy, no sowing on", b["toast"]) is not None, b["toast"])
    js(page, "A.undo(); return null;"); page.wait_for_timeout(700)
    check("Undo gives the plan back exactly, again", js(page, "return JSON.stringify(S.plan);") == start["plan"])

    # ── Bought in, then Seed, on one planting, before the panel is drawn again: each reads the planting as it stands ──
    js(page, "const s = sw(arg.sown); for (const to of ['plant', 'seed']) { const b = s && [...s.querySelectorAll('button')].find(x => x.dataset.to === to); if (b) b.click(); } return null;", pick); page.wait_for_timeout(900)
    q = js(page, "const p = S.engine.planting(arg.sown); return { said: S.engine.startedFrom(p), undo: S.undo.length };", pick)
    check("Bought in then Seed at once on one planting: the second reads the first, and the planting is sown again, in two steps", q["said"] == "seed" and q["undo"] == start["undo"] + 2, q)
    js(page, "A.undo(); A.undo(); return null;"); page.wait_for_timeout(700)
    check("two Undos give the plan back exactly", js(page, "return JSON.stringify(S.plan);") == start["plan"])

    # ── the list: a variety counted two ways has a second line, in plants ──
    js(page, "LRFSeeds.select(null); return null;"); page.wait_for_timeout(700)
    lines = js(page, """const row = document.querySelector('tr.sd-var[data-variety="' + arg.tv + '"]'), alt = hooks('seeds-alt-row').filter(r => r.dataset.altFor === arg.tv);
      const need = SL.required(eng, { today: A.today() }).rows.filter(r => r.variety && r.variety.id === arg.tv), plants = need.find(r => r.unit === 'plants');
      const pr = document.querySelector('tr.sd-var[data-variety="' + arg.v + '"]');
      return { row: drawn(row), alt: alt.length, unit: alt[0] ? alt[0].dataset.unit : '', text: alt[0] ? alt[0].textContent : '', plants: plants ? plants.toSow : null, plugs: pr ? pr.textContent : '', fig: (hook('seeds-plants-figure') || {}).textContent || '' };""", pick)
    check("on the list, a variety bought in for one planting and sown for another has a second line, in plants", lines["row"] and lines["alt"] == 1 and lines["unit"] == "plants" and lines["plants"] and str(lines["plants"]) in lines["text"].replace(",", ""), lines)
    check("with no lot on file, that line says so", "lot not on file" in lines["text"], lines["text"])
    check("the variety bought in with a lot on file reads its plants in whole lots", re.search(r"\d+ × %d plants" % pick["lot"], lines["plugs"]) is not None, lines["plugs"])
    want = js(page, "const stock = A.stockNow(); return SL.required(eng, { today: A.today() }).rows.filter(r => r.unit === 'plants').reduce((n, r) => { const s = stock[(r.variety ? 'v:' + r.variety.id : 'c:' + r.crop.id) + '|plants'] || { onHand: 0, onOrder: 0 }; return n + Math.max(0, Math.ceil(r.toSow - s.onHand - s.onOrder)); }, 0);")
    check("the page's figures say the plants still to buy: what plants on hand and on order do not cover", re.search(r"([\d,]+) plants to buy", lines["fig"]) is not None and int(re.search(r"([\d,]+) plants to buy", lines["fig"]).group(1).replace(",", "")) == want, [lines["fig"], want])
    # a new lot of a variety all of whose plantings are bought in is in plants, even with seed of it on the shelf from before
    js(page, "A.editStock('Seed from before', (lib, ctx) => SL.addLot(lib, { key: 'v:' + arg.v, unit: 'seeds', quantity: 10, status: 'usable' }, ctx)); return null;", pick); page.wait_for_timeout(700)
    js(page, "const b = document.querySelector('tr.sd-var[data-variety=\"' + arg.v + '\"] .sd-addlot'); if (b) b.click(); return null;", pick); page.wait_for_timeout(600)
    unit = js(page, "const a = $('lrAmount'); return a ? a.placeholder : '';")
    check("a new lot of a variety bought in for all its plantings is counted in plants", unit == "Plants", unit)
    js(page, "const x = $('lrClose'); if (x) x.click(); A.undo(); return null;"); page.wait_for_timeout(600)
    check("Undo takes the seed from before back", js(page, "return A.contentKey();") == start["key"])

    # ── a lot typed: at once, with Undo ──
    js(page, "LRFSeeds.select({ type: 'variety', id: arg.tv }); return null;", pick); page.wait_for_timeout(900)
    page.locator('[data-hook="buy-lot"]').first.fill("72"); page.locator('[data-hook="buy-lot"]').first.press("Enter"); page.wait_for_timeout(900)
    c = js(page, "const v = S.engine.variety(arg.tv), r = SL.required(S.engine, { today: A.today() }).rows.find(x => x.variety && x.variety.id === arg.tv && x.unit === 'plants'); return { lot: v.buyLot, undo: S.undo.length, cover: r ? SL.toCover(r.toSow, 'plants', v) : null };", pick)
    check("the lot typed in the panel is the variety's, in one step, and its plants are covered in lots of it", c["lot"] == 72 and c["undo"] == start["undo"] + 1 and c["cover"] and c["cover"]["total"] % 72 == 0, c)
    js(page, "A.undo(); return null;"); page.wait_for_timeout(700)
    check("Undo takes the lot back", js(page, "return JSON.stringify(S.plan);") == start["plan"])

    # ── the grower, then the lot, typed one after the other before the panel is drawn again (Codex on #81): both are kept, and the
    # other way round too; the order sheet then lists the plants under that grower in whole lots ──
    for first, second, a1, a2 in (("buy-from", "buy-lot", "A plug grower", "72"), ("buy-lot", "buy-from", "72", "A plug grower")):
        js(page, "LRFSeeds.select({ type: 'variety', id: arg.tv }); return null;", pick); page.wait_for_timeout(900)
        # both changes in one turn of the page, before it can draw the panel again: what a quick hand can do, every time
        js(page, "for (const [n, x] of arg) { const el = hook(n); if (el) { el.value = x; el.dispatchEvent(new Event('change', { bubbles: true })); } } return null;", [[first, a1], [second, a2]]); page.wait_for_timeout(1200)
        g = js(page, """const v = S.engine.variety(arg.tv), rows = SL.required(S.engine, { today: A.today() }).rows.map(r => ({ ...r, short: r.toSow }));
          const sheet = SL.orderSheet(rows, (a, u, x) => SL.toCover(a, u, x)), grp = sheet.groups.find(x => x.lines.some(l => l.variety.id === arg.tv && l.unit === 'plants')), line = grp && grp.lines.find(l => l.variety.id === arg.tv && l.unit === 'plants');
          return { from: v.buyFrom || '', lot: v.buyLot || 0, undo: S.undo.length, group: grp ? grp.name : '', buy: line ? line.buy : 0, amount: line ? line.amount : 0 };""", pick)
        check("the %s typed, then the %s at once: both are kept, in two steps, and the plants are listed under that grower in whole lots of 72" % (first.replace("buy-", ""), second.replace("buy-", "")),
              g["from"] == "A plug grower" and g["lot"] == 72 and g["undo"] == start["undo"] + 2 and g["group"] == "A plug grower" and g["buy"] % 72 == 0 and g["buy"] >= g["amount"] > 0, g)
        js(page, "A.undo(); A.undo(); return null;"); page.wait_for_timeout(800)
        check("two Undos take both back", js(page, "return JSON.stringify(S.plan);") == start["plan"])

    # ── the order sheet: plants beside seed, under the grower, in whole lots; ordered, then arrived ──
    js(page, "LRFSeeds.select(null); return null;"); page.wait_for_timeout(500)
    js(page, "LRFSeeds.openOrder(); return null;"); page.wait_for_timeout(900)
    o = js(page, """const line = document.querySelector('#orderDlg tr[data-line="v:' + arg.v + '|plants"]'), group = line && line.closest('.od-group'), seed = document.querySelector('#orderDlg tr[data-line$="|seeds"]');
      return { line: !!line, text: line ? line.textContent : '', group: group ? group.querySelector('.od-head b').textContent : '', seed: !!seed };""", pick)
    check("the order sheet lists the plants under the grower the variety names, beside seed", o["line"] and o["group"] == pick["from"] and o["seed"], o)
    check("its line reads whole lots", re.search(r"\d+ × %d plants" % pick["lot"], o["text"]) is not None, o["text"])
    page.screenshot(path=str(shots / "order.png"))
    js(page, "const g = [...document.querySelectorAll('#orderDlg .od-group')].find(x => x.querySelector('tr[data-line=\"v:' + arg.v + '|plants\"]')); const b = g && g.querySelector('[data-ordered]'); if (b) b.click(); return null;", pick); page.wait_for_timeout(900)
    d = js(page, "const st = SL.stock(A.inventoryNow())['v:' + arg.v + '|plants'] || { onOrder: 0, onHand: 0 }; return { onOrder: st.onOrder, undo: S.undo.length };", pick)
    check("Mark as ordered puts the lots on order, in plants", d["onOrder"] > 0 and d["onOrder"] % pick["lot"] == 0, d)
    js(page, "const x = $('odClose'); if (x) x.click(); return null;"); page.wait_for_timeout(500)
    js(page, "const r = document.querySelector('tr.sd-var[data-variety=\"' + arg.v + '\"] .sd-recv'); if (r) r.click(); return null;", pick); page.wait_for_timeout(900)
    e = js(page, "const st = SL.stock(A.inventoryNow())['v:' + arg.v + '|plants'] || { onOrder: 0, onHand: 0 }; return { onOrder: st.onOrder, onHand: st.onHand };", pick)
    check("the order's arrival makes the plants on hand", e["onOrder"] == 0 and e["onHand"] == d["onOrder"], e)
    js(page, "A.undo(); A.undo(); return null;"); page.wait_for_timeout(800)
    check("two Undos take the arrival and the order back", js(page, "return A.contentKey();") == start["key"])
    check("no error on the page", not errors, errors[:3])
    finish()

with sync_playwright() as pw:
    try: run(pw)
    except Exception as e:
        errors.append("check stopped: " + repr(e)[:300]); check("the check ran to its end", False); finish()
