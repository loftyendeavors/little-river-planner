"""N1, Assumptions › Starting and nursery, in a real browser: the part opens; the list holds every crop once, in its group; a crop
sown several seeds a cell shows what it comes to and its sowings as wanted → sown, held against the engine in the page; a
variety's germination typed says what it would move before anything moves, Enter takes it, the sowings change, Undo puts all
back, Esc leaves it; the offer of one station a cell shows before and after and "Use it" takes it as one step; a potted-up crop
shows Potting up and Pots a carrier 10 | 15; a tower crop shows For the towers; a live-tray crop reads "not counted" until its
two boxes are filled; "Edit crop" on Seeds opens the card; walking the cards and the tick move no figure. Every subject is
found on the plan it is given, by its hooks.
usage: python3 -I n1_check.py <app-dir-or-built-site> <shots-dir> [backup.zip]     env: WIDTH=1480, STOP_AT_FAIL=1
"""
import functools, http.server, json, os, re, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
target, shots = Path(sys.argv[1]), Path(sys.argv[2]); shots.mkdir(parents=True, exist_ok=True)
backup = sys.argv[3] if len(sys.argv) > 3 else None
WIDTH = int(os.environ.get("WIDTH", "1480")); STOP = os.environ.get("STOP_AT_FAIL") == "1"
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
PRE = ("const A = LRFApp, S = A.state, E = LRFEngine, SC = LRFStartCard, $ = id => document.getElementById(id);"
       "const H = (hook, root) => [...(root || document).querySelectorAll(`[data-hook=\"${hook}\"]`)];"
       "const seen = el => !!el && el.offsetParent !== null;"
       # every planting's nursery figures: what "no figure moved" means
       "const sig = () => { const e = S.engine, out = []; for (const p of S.plan.plantings) { const r = e.calc(p); out.push(r ? [p.id, E.d2s(r.sow), E.d2s(r.field), E.d2s(e.potUpDate(r)), E.d2s(e.hardenStart(r)), r.cells, r.trays, r.seeds, r.seedG, r.buy || 0].join('|') : p.id); } return out.join('\\n'); };"
       "const plan = () => JSON.stringify({ ...S.plan, lrfNext: { ...(S.plan.lrfNext || {}), facts: null } });"
       "const cardEl = () => H('start-card').find(seen) || null;"
       "const card = () => { const c = cardEl(); if (!c) return null; const comes = H('start-comes', c)[0];"
       " return { crop: c.dataset.crop, name: (H('start-name', c)[0] || {}).textContent || '', comes: comes ? comes.textContent : '', seeds: comes ? +comes.dataset.seeds : null, state: (H('start-state', c)[0] || {}).textContent || '',"
       "  sowings: H('start-sowing-row', c).map(r => ({ ...r.dataset, text: r.textContent })), parts: ['start-sowing', 'start-potup', 'start-towers', 'start-bench', 'start-live', 'start-direct', 'start-bought'].filter(k => H(k, c).length),"
       "  offers: H('start-offer', c).map(o => ({ offer: o.dataset.offer, text: o.textContent })), carrier: (H('start-carrier', c)[0] || { dataset: {} }).dataset.on || null, carrierSides: H('start-side', H('start-carrier', c)[0]).map(b => b.dataset.side),"
       "  live: (H('start-live-seed', c)[0] || { dataset: {} }).dataset.counted || null, moves: H('start-moves', c).filter(x => x.textContent).map(x => ({ key: x.dataset.key, text: x.textContent, would: x.dataset.would === 'true', said: x.dataset.said === 'true' })),"
       "  next: (H('start-next', c)[0] || { dataset: {} }).dataset.next || null, still: (H('start-still', c)[0] || {}).textContent || '' }; };"
       # the crops a crop's own plantings are sown in, as the engine says
       "const batches = id => S.engine.sowingBatches().filter(b => b.members[0] && b.members[0].r.c.id === id).map(b => ({ ids: b.memberIds.slice().sort().join(','), cells: b.members.reduce((n, m) => n + S.engine.calc(m.p).cells, 0), wanted: b.members.reduce((n, m) => n + S.engine.calc(m.p).plants, 0), seeds: b.members.reduce((n, m) => n + S.engine.calc(m.p).seeds, 0) }));"
       "const mine = () => { const u = new Map(); for (const p of S.plan.plantings) u.set(p.cropId, (u.get(p.cropId) || 0) + 1); const list = S.plan.settings.cropTypeList || {}; return S.engine.crops().filter(c => !S.engine.isCoverCrop(c) && LRFPanels.isMine(c, u, c.micro ? [] : S.engine.varietiesOf(c.id), list)); };")
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": WIDTH, "height": 1000}, color_scheme="light")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    page.goto(url); page.wait_for_function("window.LRFApp && LRFApp.state.ready"); page.wait_for_timeout(900)
    if backup and page.evaluate("LRFApp.isSample()"):
        page.set_input_files("#importFile", backup); page.wait_for_timeout(400)
        if page.locator("dialog[open] .btn.primary").count(): page.locator("dialog[open] .btn.primary").click()
        page.wait_for_function("LRFApp.state.plan.plantings.length > 600 && !LRFApp.isSample()", timeout=60000); page.wait_for_timeout(1200)
    page.evaluate("LRFApp.state.undo.length = 0")
    def js(body):
        try: return page.evaluate("(() => { " + PRE + " " + body + " })()")
        except Exception as e: errors.append(str(e)[:200]); return None
    wait = lambda ms=300: page.wait_for_timeout(ms)
    def has(sel): return page.locator(sel).count() > 0 and page.locator(sel).first.is_visible()
    def click(sel, ms=400):
        if not has(sel): wait(100); return False
        try: page.locator(sel).first.click(timeout=4000)
        except Exception: return False
        wait(ms); return True
    def shot(name): page.screenshot(path=str(shots / f"n1-{name}-{WIDTH}.png"), full_page=True)
    def card(): return js("return card();") or {}
    def open_crop(cid):
        if not click(f'[data-hook="start-item"][data-crop="{cid}"]'): js(f"LRFAssume.setMode('start', null, {json.dumps(cid)}); return 1;"); wait(300)
    def box(key): return f'[data-hook="start-card"] input[data-hook="start-box"][data-key="{key}"]'
    def typing(key, text):
        sel = box(key)
        if not has(sel): return False
        page.locator(sel).first.click(); page.keyboard.press("Control+a")
        if text == "": page.keyboard.press("Delete")
        else: page.keyboard.type(text)
        wait(500); return True
    def moves(key):
        return next((m for m in card().get("moves", []) if m["key"] == key), None)

    before = js("return { sig: sig(), plan: plan(), year: A.planYear() };") or {}
    # every step taken from here on is kept, so that the fields the card writes can be read from what it wrote
    js("window.__steps = new Set(); window.__w = []; A.on('plan', () => { for (const st of [...S.undo, ...S.redo]) if (!__steps.has(st)) { __steps.add(st); if (/[(]check[)]$/.test(st.label)) continue; for (const o of st.ops) __w.push(JSON.parse(JSON.stringify({ kind: o.kind || 'planting', key: o.key || null, before: o.before === undefined ? null : o.before, after: o.after === undefined ? null : o.after }))); } }); return 1;")
    year = before.get("year")
    # ── the part opens ──
    js("A.setView('assume'); return 1;"); wait(400)
    modes = js("return [...document.querySelectorAll('[data-as-mode]')].map(b => b.textContent);") or []
    check("Assumptions is a switch of three parts, Starting and nursery first", modes == ["Starting and nursery", "Days to harvest", "Yield and price"], modes)
    click('[data-as-mode="start"]', 600)
    shown = js("return { host: seen($('snHost')), title: $('asTitle').textContent, figs: (H('start-figs')[0] || {}).textContent || '', days: seen($('asTable')), meter: (H('start-meter')[0] || { dataset: {} }).dataset };") or {}
    check("Starting and nursery opens: its title, its line of figures, the list and a card, and not the days table", shown.get("host") and shown.get("title") == "Starting and nursery" and "Sown in the nursery" in shown.get("figs", "") and "Germination" in shown.get("figs", "") and not shown.get("days"), shown)
    shot("open")
    # ── the list: every crop once, in its group ──
    lst = js("return { items: H('start-item').map(b => ({ id: b.dataset.crop, group: b.dataset.group, say: b.querySelector('small').textContent })), groups: H('start-group').map(g => g.dataset.group), mine: mine().map(c => ({ id: c.id, group: SC.groupOf(c) })), every: H('start-every').length };") or {}
    items, want = lst.get("items", []), lst.get("mine", [])
    ids = [i["id"] for i in items]
    check("the list holds every crop of My crops once, and nothing else", sorted(ids) == sorted(w["id"] for w in want) and len(ids) == len(set(ids)) and len(ids) > 30, [len(ids), len(want)])
    check("each crop stands in the group of how it is started: sown in the nursery, live trays, direct, bought in, in that order", all(i["group"] == next((w["group"] for w in want if w["id"] == i["id"]), None) for i in items) and lst.get("groups") == ["nursery", "live", "direct", "bought"] and [i["group"] for i in items] == sorted([i["group"] for i in items], key=["nursery", "live", "direct", "bought"].index), lst.get("groups"))
    check("an Every crop row heads the list, for the farm's own figures", lst.get("every") == 1)
    check("each crop has one short line of how it is started", all(i["say"] for i in items))
    click('[data-as-scope="all"]', 500)
    n_all = js("return { n: H('start-item').length, all: S.engine.crops().filter(c => !S.engine.isCoverCrop(c)).length };") or {}
    check("All crops lists every crop", n_all.get("n") == n_all.get("all") and n_all.get("n", 0) > len(ids), n_all)
    click('[data-as-scope="mine"]', 500)

    # ── a crop sown several seeds a cell, with varieties and sowings ──
    many = js("const c = S.engine.crops().find(c => SC.groupOf(c) === 'nursery' && +c.spc > 1 && c.station !== true && S.engine.varietiesOf(c.id).length > 1 && batches(c.id).length > 1 && !S.plan.plantings.some(p => p.cropId === c.id && S.engine.isTower(S.engine.bedOf(p.bedId)))); return c ? { id: c.id, name: c.name, seeds: S.plan.plantings.filter(p => p.cropId === c.id).reduce((n, p) => n + ((S.engine.calc(p) || {}).seeds || 0), 0), batches: batches(c.id) } : null;")
    check("the plan has a crop sown several seeds a cell, with varieties and several sowings", bool(many))
    many = many or {"id": "", "name": "", "seeds": -1, "batches": []}
    open_crop(many["id"])
    c = card()
    check(f"its card opens: {many['name']}", c.get("crop") == many["id"] and c.get("name") == many["name"], c.get("crop"))
    check("its one line of what it comes to: weeks before planting, trays, its seed (the engine's), mix and bench room", c.get("seeds") == many["seeds"] and "before planting" in c.get("comes", "") and "trays of" in c.get("comes", "") and "cu ft" in c.get("comes", "") and "tray spaces" in c.get("comes", ""), [c.get("seeds"), many["seeds"], c.get("comes")])
    rows = c.get("sowings", [])
    eng_b = {b["ids"]: b for b in many["batches"]}
    shown_ok = [r for r in rows if r["batch"] in eng_b and int(r["cells"]) == eng_b[r["batch"]]["cells"] and int(r["wanted"]) == eng_b[r["batch"]]["wanted"] and f"{int(r['wanted']):,} wanted → {int(r['cells']):,} " in r["text"]]
    check("its sowings read wanted → sown, each as the engine sows it", len(rows) > 1 and len(shown_ok) == len(rows), rows[:2])
    shot("many")

    # ── a variety's germination: what it would move first, Enter takes it, Undo puts all back ──
    var = js(f"const vs = S.engine.varietiesOf({json.dumps(many['id'])}).filter(v => S.engine.sowingBatches().some(b => b.members[0].p.varietyId === v.id && b.members[0].r.c.id === {json.dumps(many['id'])}) && !(+v.germ > 0)); return vs[0] ? {{ id: vs[0].id, name: vs[0].name }} : null;") or {"id": "", "name": ""}
    click(f'[data-hook="start-variety-own"][data-variety="{var["id"]}"]', 400)
    key = f"v|{var['id']}|germ"
    k0 = js("return { key: A.contentKey(), undo: S.undo.length, plan: plan(), sig: sig() };") or {}
    typing(key, "60")
    m = moves(key) or {}
    k1 = js("return { key: A.contentKey(), undo: S.undo.length, plan: plan() };") or {}
    check(f"typing {var['name']}'s germination says, under the box, what it would move, before anything moves", m.get("would") and "Would move" in m.get("text", "") and "cells" in m.get("text", "") and k1.get("plan") == k0.get("plan") and k1.get("undo") == k0.get("undo"), [m, k1.get("undo"), k0.get("undo")])
    page.keyboard.press("Enter"); wait(700)
    after = js(f"const v = S.engine.variety({json.dumps(var['id'])}); return {{ germ: v && v.germ, undo: S.undo.length, label: (S.undo[S.undo.length - 1] || {{}}).label || '', batches: batches({json.dumps(many['id'])}), toasts: document.querySelectorAll('.toast').length }};") or {}
    c2 = card()
    changed = [r for r in c2.get("sowings", []) if r["batch"] in eng_b and int(r["cells"]) != eng_b[r["batch"]]["cells"]]
    check("Enter takes it: the variety's own germination, one step", after.get("germ") == 60 and after.get("undo") == k0.get("undo", 0) + 1, after)
    check("its sowing lines change, as the engine now sows them, and the line under the box says what was done, with Undo", len(changed) > 0 and any(r["cells"] == str(next((b["cells"] for b in after.get("batches", []) if b["ids"] == r["batch"]), -1)) for r in changed) and any(x["key"] == key and x["said"] for x in c2.get("moves", [])) and has('[data-hook="start-undo"]'), [len(changed), c2.get("moves")])
    js("const t = $('toast'); if (t) { t.textContent = ''; t.classList.remove('show'); } window.__undid = (document.body.innerText.match(/Undid/g) || []).length; return 1;")
    click('[data-hook="start-undo"]', 700)
    k2 = js("return { plan: plan(), sig: sig(), undo: S.undo.length, undid: (document.body.innerText.match(/Undid/g) || []).length - window.__undid, said: (H('start-moves').find(x => x.dataset.said === 'true') || {}).textContent || '' };") or {}
    check("Undo from the card is answered on the card (Undone), with no message as well", k2.get("undid") == 0 and "Undone" in k2.get("said", ""), [k2.get("undid"), k2.get("said")])
    check("Undo puts all back: the plan and every planting's figures as before", k2.get("plan") == k0.get("plan") and k2.get("sig") == k0.get("sig") and k2.get("undo") == k0.get("undo"), k2.get("undo"))
    click(f'[data-hook="start-variety-own"][data-variety="{var["id"]}"]', 400)
    t55 = typing(key, "55"); w55 = (moves(key) or {}).get("would"); page.keyboard.press("Escape"); wait(400)
    k3 = js("return { plan: plan(), undo: S.undo.length };") or {}
    check("Esc leaves it: nothing taken, nothing said", t55 and w55 and k3.get("plan") == k0.get("plan") and not (moves(key) or {}).get("text"), [t55, w55, moves(key)])

    # ── a box takes a figure only with Enter or Tab; one equal to the grey it follows is not stored ──
    lib = js("const has = id => S.plan.crops.some(c => c.id === id); const c = mine().find(c => SC.groupOf(c) === 'nursery' && !has(c.id) && S.plan.plantings.some(p => p.cropId === c.id && S.engine.calc(p) && S.engine.calc(p).sowing)); return c ? { id: c.id, name: c.name } : null;") or {"id": "", "name": ""}
    other_item = js(f"const b = H('start-item').find(b => b.dataset.crop !== {json.dumps(lib['id'])}); return b ? b.dataset.crop : null;")
    open_crop(lib["id"])
    w0 = js("return { all: JSON.stringify(S.plan), undo: S.undo.length };") or {}
    t70 = typing("germ", "70"); w70 = (moves("germ") or {}).get("would")
    if other_item: click(f'[data-hook="start-item"][data-crop="{other_item}"]', 600)
    w1 = js("return { all: JSON.stringify(S.plan), undo: S.undo.length, cur: SC.current() };") or {}
    check(f"a figure typed and left by a click elsewhere is not taken ({lib['name']}'s germination), and the click lands", bool(lib["id"]) and t70 and w70 and w1.get("all") == w0.get("all") and w1.get("undo") == w0.get("undo") and w1.get("cur") == other_item, [w1.get("undo"), w1.get("cur"), other_item])
    open_crop(lib["id"])
    grey = js("const el = document.querySelector('[data-hook=\"start-card\"] input[data-key=\"germ\"]'); return el ? el.placeholder : null;") or ""
    typing("germ", grey); page.keyboard.press("Enter"); wait(600)
    w2 = js("return { all: JSON.stringify(S.plan), undo: S.undo.length, value: (document.querySelector('[data-hook=\"start-card\"] input[data-key=\"germ\"]') || { value: '?' }).value };") or {}
    check("the figure every planting already counts, typed and taken, is not stored, and the box is grey again at once", bool(grey) and w2.get("all") == w0.get("all") and w2.get("undo") == w0.get("undo") and w2.get("value") == "", [grey, w2.get("undo"), w2.get("value")])
    # a box not edited since it took focus takes nothing, whatever it shows; a number equal to his own figure takes nothing
    page.locator(box("germ")).first.click(); page.keyboard.press("Enter"); wait(500)
    u_lib = js(f"const lc = LRFLibrary.crops.find(c => c.id === {json.dumps(lib['id'])}); const was = S.plan.crops.find(c => c.id === {json.dumps(lib['id'])}) || null; A.setStarting('a record repeating the library (check)', [{{ kind: 'crop', before: was, after: {{ ...(was || {{ id: lc.id }}), spc: lc.spc }} }}]); return S.undo.length;")
    rec0 = js("return JSON.stringify(S.plan);")
    page.locator(box("spc")).first.click(); page.keyboard.press("Enter"); wait(500)
    rec1 = js("return { all: JSON.stringify(S.plan), undo: S.undo.length };") or {}
    spc_own = js(f"return String((S.plan.crops.find(c => c.id === {json.dumps(lib['id'])}) || {{}}).spc);")
    typing("spc", spc_own); page.keyboard.press("Enter"); wait(500)
    rec2 = js("return { all: JSON.stringify(S.plan), undo: S.undo.length };") or {}
    check("Enter on a box not edited takes nothing (a figure of his repeating the library's is not deleted), and his own figure typed again takes nothing", rec1.get("all") == rec0 and rec1.get("undo") == u_lib and rec2.get("all") == rec0 and rec2.get("undo") == u_lib, [rec1.get("undo"), rec2.get("undo"), u_lib])
    js("A.undo(); return 1;"); wait(400)
    typing("germ", "70"); page.keyboard.press("Enter"); wait(600)
    typed_ok = js(f"return (S.plan.crops.find(c => c.id === {json.dumps(lib['id'])}) || {{}}).germ;") == 70
    typing("germ", ""); page.keyboard.press("Enter"); wait(600)
    w3 = js("return { all: JSON.stringify(S.plan), crop: S.plan.crops.some(c => c.id === " + json.dumps(lib["id"]) + ") };") or {}
    check("a figure typed, taken, then emptied and taken leaves the whole plan as it was: no empty record of the crop is left", typed_ok and w3.get("all") == w0.get("all") and not w3.get("crop"), [typed_ok, w3.get("crop")])
    # Tab takes it and lands in the next box
    typing("germ", "71"); page.keyboard.press("Tab"); wait(700)
    tab = js("const el = document.activeElement; return { key: el && el.dataset ? el.dataset.sk || null : null, germ: (S.plan.crops.find(c => c.id === " + json.dumps(lib["id"]) + ") || {}).germ };") or {}
    check("Tab takes the figure and the pointer stands in the next box", tab.get("germ") == 71 and tab.get("key") == "spare", tab)
    while (js("return S.undo.length;") or 0) > (w0.get("undo") or 0): js("A.undo(); return 1;"); wait(300)
    open_crop(many["id"])

    # ── the offer: one station a cell, before and after, Use it, one Undo ──
    c3 = card()
    off = next((o for o in c3.get("offers", []) if o["offer"] == "station"), None)
    check("a cell of several seeds is offered as one station, with what it would move, before and after", bool(off) and "no extra cells for germination" in off["text"] and "→" in off["text"] and "cells" in off["text"], off)
    u0 = js("return S.undo.length;")
    click('[data-hook="start-offer-use"][data-offer="station"]', 700)
    st = js(f"const c = S.engine.crop({json.dumps(many['id'])}); return {{ station: c.station, undo: S.undo.length, batches: batches(c.id) }};") or {}
    fewer = [b for b in st.get("batches", []) if b["ids"] in eng_b and b["cells"] < eng_b[b["ids"]]["cells"]]
    check("Use it takes the offer as one step: the crop counts one station a cell, and its sowings take fewer cells", st.get("station") is True and st.get("undo") == (u0 or 0) + 1 and len(fewer) > 0, [st.get("station"), st.get("undo"), u0])
    sl = moves("station") or {}
    check("after Use it the line where the offer stood says what was done in words, with Undo", sl.get("said") and "one station" in sl.get("text", "") and "[object" not in sl.get("text", "") and has('[data-hook="start-undo"]'), sl)
    ps = js("return { plan: plan(), undo: S.undo.length };") or {}
    click('[data-hook="start-station-off"]', 600)
    so = moves("station") or {}
    check("counting germination again says what it would move first, and moves nothing yet", so.get("would") and "cells" in so.get("text", "") and js("return plan();") == ps.get("plan"), so)
    click('[data-hook="start-moves"][data-key="station"] [data-hook="start-use"]', 700)
    back = js(f"return {{ station: S.engine.crop({json.dumps(many['id'])}).station, undo: S.undo.length }};") or {}
    check("Use it takes it as one step, and the line where it was says so, with Undo", back.get("station") is not True and back.get("undo") == ps.get("undo", 0) + 1 and (moves("station") or {}).get("said") and has('[data-hook="start-undo"]'), [back, moves("station")])
    js("A.undo(); return 1;"); wait(500)
    js("A.undo(); return 1;"); wait(600)
    check("one Undo takes the offer back", js("return plan();") == k0.get("plan"))

    # ── a click while a box is typed lands: here on the station offer's Use it ──
    u_c = js("return S.undo.length;")
    typing("germ", "70")
    click('[data-hook="start-offer-use"][data-offer="station"]', 700)
    cl_ = js(f"const c = S.engine.crop({json.dumps(many['id'])}); return {{ station: c.station === true, germ: (S.plan.crops.find(x => x.id === c.id) || {{}}).germ, undo: S.undo.length }};") or {}
    check("a click while a box is being typed lands (the line keeps its room): the offer is used, and the figure typed is not", cl_.get("station") and cl_.get("germ") != 70 and cl_.get("undo") == (u_c or 0) + 1, cl_)
    while (js("return S.undo.length;") or 0) > (u_c or 0): js("A.undo(); return 1;"); wait(300)

    # ── the card's Undo belongs to its own step ──
    u_b = js("return S.undo.length;")
    typing("spc", "5"); page.keyboard.press("Enter"); wait(500)
    typing("germ", "72"); page.keyboard.press("Enter"); wait(500)
    page.locator('[data-hook="start-name"]').first.click(); page.keyboard.press("Control+z"); wait(600)
    b4 = js("return { undo: S.undo.length, said: H('start-moves').filter(x => x.dataset.said === 'true').map(x => x.textContent).join(' | '), links: H('start-undo').length };") or {}
    check("a step undone elsewhere (Ctrl+Z) drops the card's line for the step after it: no Undo stands that would take back another", b4.get("undo") == (u_b or 0) + 1 and "germination" not in b4.get("said", "") and b4.get("links") == 0, b4)
    js("A.undo(); return 1;"); wait(400)
    typing("germ", "72"); page.keyboard.press("Enter"); wait(500)
    lab = js("return (S.undo[S.undo.length - 1] || {}).label || '';")
    click('[data-hook="start-undo"]', 600)
    b5 = js("return { undo: S.undo.length, said: H('start-moves').filter(x => x.dataset.said === 'true').map(x => x.textContent).join(' | ') };") or {}
    page.locator('[data-hook="start-name"]').first.click(); page.keyboard.press("Control+Shift+z"); wait(600)
    b6 = js("return { undo: S.undo.length, said: H('start-moves').filter(x => x.dataset.said === 'true').map(x => x.textContent).join(' | ') };") or {}
    check("the card's Undo takes back the step it names and says that step; a Redo then leaves no Undone standing", b5.get("undo") == u_b and f"Undone: {lab}" in b5.get("said", "") and b6.get("undo") == (u_b or 0) + 1 and "Undone" not in b6.get("said", ""), [lab, b5, b6])
    while (js("return S.undo.length;") or 0) > (u_b or 0): js("A.undo(); return 1;"); wait(300)

    # ── Started as Direct says the crop's own cells and trays going to none ──
    click('[data-hook="start-as"] [data-hook="start-side"][data-side="direct"]', 600)
    dm = moves("started") or {}
    check("Started as Direct says, before Use it, its own cells and trays going to none", dm.get("would") and "its cells" in dm.get("text", "") and "its trays" in dm.get("text", "") and "→ none" in dm.get("text", ""), dm)
    page.keyboard.press("Escape"); wait(300); js("SC.state.pending = null; LRFAssume.setMode('start'); return 1;"); wait(300)

    # ── Started as leaves a figure he said outright: plantingMaterial 'seed' stays through Pot ──
    u_s = js(f"const was = S.plan.crops.find(c => c.id === {json.dumps(many['id'])}) || null; A.setStarting('material said outright (check)', [{{ kind: 'crop', before: was, after: {{ ...(was || {{ id: {json.dumps(many['id'])} }}), plantingMaterial: 'seed' }} }}]); return S.undo.length;")
    click('[data-hook="start-as"] [data-hook="start-side"][data-side="pot"]', 600); click('[data-hook="start-moves"][data-key="started"] [data-hook="start-use"]', 600)
    pmat = js(f"const r = S.plan.crops.find(c => c.id === {json.dumps(many['id'])}) || {{}}; return [r.prop, r.plantingMaterial];") or []
    check("Started as Pot leaves the plantingMaterial he said outright", pmat == ["pot", "seed"], pmat)
    while (js("return S.undo.length;") or 0) > (u_s or 1) - 1: js("A.undo(); return 1;"); wait(300)

    # ── a variety's days: shown per place where they differ, and an unedited Enter or an emptied box touches only that figure ──
    vx = js(f"return S.engine.varietiesOf({json.dumps(many['id'])}).map(v => v.id).slice(0, 2);") or []
    if len(vx) == 2:
        js(f"const a = S.engine.variety({json.dumps(vx[0])}), b = S.engine.variety({json.dumps(vx[1])}); A.setStarting('days by place (check)', [{{ kind: 'variety', before: a, after: {{ ...a, environmentDefaults: {{ v: 1, field: {{ gh: 4 }}, greenhouse: {{ gh: 6 }} }} }} }}, {{ kind: 'variety', before: b, after: {{ ...b, environmentDefaults: {{ v: 1, field: {{ gh: 4, dtm: 50 }}, greenhouse: {{ gh: 4 }} }} }} }}]); return 1;"); wait(500)
    for v in vx: click(f'[data-hook="start-variety-own"][data-variety="{v}"]', 300)
    sp = js(f"return {{ split: H('start-variety-days-split').some(x => x.dataset.variety === {json.dumps(vx[0] if vx else '')}), box: !!document.querySelector('[data-hook=\"start-box\"][data-key=\"v|{vx[0] if vx else ''}|days\"]') }};") or {}
    check("a variety whose days differ in the field and under cover shows each and offers no box", len(vx) == 2 and sp.get("split") and not sp.get("box"), sp)
    u_v = js("return S.undo.length;")
    k1 = f"v|{vx[1] if len(vx) > 1 else ''}|days"
    if has(box(k1)): page.locator(box(k1)).first.click(); page.keyboard.press("Enter"); wait(500)
    vu = js("return S.undo.length;")
    typing(k1, ""); page.keyboard.press("Enter"); wait(600)
    env = js(f"return (S.engine.variety({json.dumps(vx[1] if len(vx) > 1 else '')}) || {{}}).environmentDefaults || null;")
    check("Enter on a variety's unedited days takes nothing; emptied, they clear that figure in each place and nothing else", vu == u_v and env == {"v": 1, "field": {"dtm": 50}}, [vu, u_v, env])
    # at 1707 a variety's boxes keep their labels beside them
    page.set_viewport_size({"width": 1707, "height": 1000}); wait(500)
    lay = js("return H('start-variety-figures').flatMap(f => H('start-field', f)).map(f => { const l = H('start-label', f)[0], i = f.querySelector('input'); if (!l || !i) return null; const a = l.getBoundingClientRect(), b = i.getBoundingClientRect(); return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < b.height && a.right <= b.left + 0.5; });") or []
    page.set_viewport_size({"width": WIDTH, "height": 1000}); wait(400)
    check("at 1707 wide each of a variety's boxes has its label beside it, not wrapped below", len(lay) >= 2 and all(lay), lay)
    while (js("return S.undo.length;") or 0) > (u_v or 1) - 1: js("A.undo(); return 1;"); wait(300)
    # ── walking the cards and the tick move no figure ──
    u1 = js("return S.undo.length;")
    click('[data-hook="start-next"]', 600)
    tk = js(f"return {{ looked: ((S.plan.assumptions || {{}}).nursery || {{}})[{json.dumps(many['id'])}], meter: +(H('start-meter')[0] || {{ dataset: {{}} }}).dataset.looked, sig: sig(), cur: SC.current() }};") or {}
    check("Looks right ticks the crop for the year and opens the next, and moves no figure", (tk.get("looked") or {}).get("looked") == year and tk.get("meter") == 1 and tk.get("sig") == k0.get("sig") and tk.get("cur") != many["id"], tk.get("looked"))
    js("A.undo(); return 1;"); wait(400)

    # ── a potted-up crop: Potting up, and Pots a carrier 10 | 15 ──
    pot = js("const c = S.engine.crops().find(c => c.prop === 'potup' && S.plan.plantings.some(p => p.cropId === c.id && S.engine.calc(p) && S.engine.calc(p).sowing)); return c ? { id: c.id, name: c.name } : null;")
    check("the plan has a crop potted up", bool(pot))
    pot = pot or {"id": "", "name": ""}
    open_crop(pot["id"])
    cp = card()
    check(f"{pot['name']}'s card shows Potting up, with Pots a carrier 10 | 15", "start-potup" in cp.get("parts", []) and cp.get("carrierSides") == ["10", "15"] and cp.get("carrier") in ("10", "15"), cp.get("parts"))
    other = "15" if cp.get("carrier") == "10" else "10"
    p0 = js("return { plan: plan(), undo: S.undo.length };") or {}
    click(f'[data-hook="start-carrier"] [data-hook="start-side"][data-side="{other}"]', 600)
    pm = moves("carrier") or {}
    # the crop's own carriers, as its card counts them: its pots (the plants and their spare) in carriers of so many
    cr = js(f"const pots = S.plan.plantings.filter(p => p.cropId === {json.dumps(pot['id'])}).reduce((n, p) => {{ const r = S.engine.calc(p); return n + (r && r.sowing && r.sowing.potUpCells != null ? r.sowing.potUpCells : 0); }}, 0), was = Math.round(+S.engine.crop({json.dumps(pot['id'])}).perCarrier > 0 ? +S.engine.crop({json.dumps(pot['id'])}).perCarrier : 10); return [Math.ceil(pots / was - 1e-9), was, Math.ceil(pots / {other} - 1e-9)];") or [0, 0, 0]
    say = lambda n, per: f"{n} carrier{'' if n == 1 else 's'} of {per}"
    check("pressing the other side says what it would move first, and moves nothing yet", pm.get("would") and js("return plan();") == p0.get("plan"), pm)
    check("a crop's own pots a carrier says its own carriers before and after (so many carriers of 10 → so many of 15)", cr[0] != cr[2] and f"{say(cr[0], cr[1])} → {say(cr[2], int(other))}" in pm.get("text", ""), [cr, pm.get("text")])
    click('[data-hook="start-use"]', 700)
    check("Use it takes it as one step", js(f"return S.engine.crop({json.dumps(pot['id'])}).perCarrier;") == int(other) and js("return S.undo.length;") == p0.get("undo", 0) + 1)
    js("A.undo(); return 1;"); wait(500)
    size = js("const s = document.querySelector('[data-hook=\"start-pot-size\"]'); return s ? { now: s.value, other: [...s.options].map(o => o.value).find(v => v !== s.value) } : null;") or {}
    q0 = js("return { plan: plan(), undo: S.undo.length };") or {}
    if size.get("other"): page.select_option('[data-hook="start-pot-size"]', size["other"]); wait(600)
    ms = moves("potSize") or {}
    check("another pot size says what it would move first (the pots of each size and the potting mix, as Supplies counts them), and moves nothing yet", ms.get("would") and "potting mix" in ms.get("text", "") and f"{size.get('other')} in pot" in ms.get("text", "") and "its bench room at the most" in ms.get("text", "") and "its pots" in ms.get("text", "") and js("return plan();") == q0.get("plan"), ms)
    click('[data-hook="start-moves"][data-key="potSize"] [data-hook="start-use"]', 700)
    check("Use it takes the pot size as one step", str(js(f"return S.engine.crop({json.dumps(pot['id'])}).potSize;")) == size.get("other") and js("return S.undo.length;") == q0.get("undo", 0) + 1)
    js("A.undo(); return 1;"); wait(500)
    shot("potted")

    # ── a crop whose plantings are started their own way: counted by their own source ──
    mixed = js("const c = mine().find(c => SC.groupOf(c) === 'nursery' && S.plan.plantings.some(p => p.cropId === c.id && (S.engine.calc(p) || {}).boughtIn) && S.plan.plantings.some(p => p.cropId === c.id && S.engine.calc(p) && !S.engine.calc(p).boughtIn && !S.engine.isTower(S.engine.bedOf(p.bedId)))); if (!c) return null; const bed = S.plan.plantings.filter(p => p.cropId === c.id && S.engine.calc(p) && !S.engine.isTower(S.engine.bedOf(p.bedId)) && !S.engine.isRack(S.engine.bedOf(p.bedId))), b = bed.filter(p => S.engine.calc(p).boughtIn); return { id: c.id, odd: b.length, follow: bed.length - b.length, buy: b.reduce((n, p) => n + S.engine.calc(p).buy, 0) };")
    if mixed: open_crop(mixed["id"])
    fo = js("const c = cardEl(), f = c && H('start-follow', c)[0]; return f ? { ...f.dataset, text: f.textContent, comes: (H('start-comes', c)[0] || {}).textContent || '' } : null;") or {}
    check("a sown crop with plantings bought in on Seeds counts each by its own source, and says the plants to buy", bool(mixed) and fo.get("odd") == str(mixed["odd"]) and fo.get("follow") == str(mixed["follow"]) and "All" not in fo.get("text", "") and f"{mixed['buy']:,} plant" in fo.get("text", "") and "bought in" in fo.get("comes", ""), [mixed, fo])

    # ── an offer of a nursery length: after Use it, what was done, with Undo ──
    on = js("for (const id of [...new Set(S.plan.plantings.map(p => p.cropId))]) { LRFAssume.setMode('start', null, id); const o = H('start-offer').find(o => o.dataset.offer.startsWith('days-')); if (o) return id; } return null;")
    wait(300)
    o0 = js("return S.undo.length;")
    click('[data-hook="start-offer-use"][data-offer^="days-"]', 700)
    od = js("const m = H('start-moves').find(x => (x.dataset.key || '').startsWith('days-')); return m ? { text: m.textContent, said: m.dataset.said === 'true' } : null;") or {}
    check("a crop's offered nursery length, used, leaves a line saying what was done, with Undo", bool(on) and js("return S.undo.length;") == (o0 or 0) + 1 and od.get("said") and "weeks" in od.get("text", "") and has('[data-hook="start-undo"]'), [on, od])
    js("A.undo(); return 1;"); wait(400)

    # ── a tower crop ──
    tw = js("const c = S.engine.crops().find(c => SC.groupOf(c) === 'nursery' && S.plan.plantings.some(p => p.cropId === c.id && S.engine.isTower(S.engine.bedOf(p.bedId)))); return c ? c.id : null;")
    open_crop(tw or "")
    ct = card()
    rw = js("const id = SC.current(), own = S.plan.crops.find(c => c.id === id) || null, e2 = A.engineAfter([{ kind: 'crop', before: own, after: { ...(own || { id }), rockwoolDays: 25 } }]); return S.plan.plantings.filter(p => p.cropId !== id && S.engine.calc(p) && e2.calc(e2.planting(p.id)) && Math.abs((S.engine.calc(p).trays || 0) - (e2.calc(e2.planting(p.id)).trays || 0)) > 1e-9).length;")
    typing("rockwoolDays", "25"); rm = moves("rockwoolDays") or {}; page.keyboard.press("Escape"); wait(300)
    check("a tower crop's days in rockwool says what it moves for the other crops sharing its sheets, when it moves them", (rw or 0) > 0 and ("other crop" in rm.get("text", "") and f"{rw} planting" in rm.get("text", "")), [rw, rm.get("text", "")[:300]])
    check("a crop with tower plantings shows For the towers, beside its Sowing", bool(tw) and "start-towers" in ct.get("parts", []) and "start-sowing" in ct.get("parts", []) and has(box("rockwoolDays")), ct.get("parts"))

    # ── a live-tray crop: not counted until its two boxes are filled ──
    lv = js("const c = S.engine.crops().find(c => c.micro && S.plan.crops.some(x => x.id === c.id) && !S.engine.liveSow(c).set && S.engine.liveSow(c).how === 'cells' && S.plan.plantings.some(p => p.cropId === c.id)); return c ? c.id : null;")
    open_crop(lv or "")
    cl = card()
    check("a live-tray crop with no seed figures reads not counted, on its card and its head", bool(lv) and cl.get("live") == "false" and "not counted" in cl.get("state", "").lower() and "Still empty" in cl.get("still", ""), cl.get("live"))
    l0 = js("return S.undo.length;")
    typing("liveCells", "50"); page.keyboard.press("Enter"); wait(600)
    check("with only cells a tray said, it is still not counted", card().get("live") == "false")
    typing("livePerCell", "3"); page.keyboard.press("Tab"); wait(600)
    inside = js("const c = cardEl(), a = document.activeElement; return !!c && !!a && a !== document.body && c.contains(a);")
    check("Tab from the card's last box takes the figure and the pointer stays in the card", inside and js(f"return S.engine.liveSow(S.engine.crop({json.dumps(lv)})).perCell;") == 3, inside)
    cl2 = card()
    check("with seeds a cell said too, a tray's seed is counted", cl2.get("live") == "true" and js(f"return S.engine.liveSow(S.engine.crop({json.dumps(lv)})).seeds;") == 150, cl2.get("live"))
    while (js("return S.undo.length;") or 0) > (l0 or 0): js("A.undo(); return 1;"); wait(300)

    # ── at 1280 the amber word of a live-tray row is never the part cut ──
    page.set_viewport_size({"width": 1280, "height": 900}); wait(500)
    cut = js("return H('start-item').filter(b => b.dataset.group === 'live').map(b => { const sm = b.querySelector('small'), t = sm && sm.firstChild; if (!t || !/^not counted/.test(t.textContent)) return { ok: !/not counted/.test(sm ? sm.textContent : '') }; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 'not counted'.length); return { ok: r.getBoundingClientRect().right <= sm.getBoundingClientRect().right + 0.5 }; });") or []
    page.set_viewport_size({"width": WIDTH, "height": 1000}); wait(400)
    check("at 1280 wide a live-tray row's amber \"not counted\" is whole, never the part cut", len(cut) > 0 and all(x["ok"] for x in cut) and js("return H('start-item').some(b => /^not counted/.test(b.querySelector('small').textContent));"), cut)

    # ── a live-tray crop that comes with the planner: its boxes say why they take nothing ──
    js("LRFAssume.setMode('start'); return 1;"); click('[data-as-scope="all"]', 500)
    libmicro = js("const c = S.engine.crops().find(c => c.micro && !S.plan.crops.some(x => x.id === c.id)); return c ? c.id : null;")
    open_crop(libmicro or "")
    lm = js("const c = cardEl(); return c ? H('start-box', c).map(i => ({ key: i.dataset.key, off: i.disabled, look: getComputedStyle(i).cursor === 'not-allowed' && getComputedStyle(i).borderTopStyle === 'dashed' })) : [];") or []
    check("its switched-off boxes look switched off, not his", len(lm) > 0 and all(x["look"] for x in lm), lm)
    check("a live-tray crop that comes with the planner shows its tray boxes switched off, with the reason", bool(libmicro) and len(lm) > 0 and all(x["off"] for x in lm) and "demand plan" in (js("return (cardEl() || {}).textContent || '';") or ""), lm)
    click('[data-as-scope="mine"]', 400)

    # ── the farm's figures ──
    click('[data-hook="start-every"]', 500)
    cf = card()
    check("Every crop shows the farm's germination and spare, and the pots a carrier Supplies counts by", cf.get("crop") == "(farm)" and has(box("farmGerm")) and has(box("farmSpare")) and has('[data-hook="start-pockets"]'), cf.get("crop"))
    # the farm's germination: its bench room is every crop's added up on the same day, not the most of any one crop
    peak = js("const f = LRFNursery.season(S.engine, A.planYear()); return Math.round(f.weeks.reduce((n, w) => Math.max(n, w.pools && w.pools.heated ? w.pools.heated.used : 0), 0) * 10) / 10;")
    typing("farmGerm", "50")
    fg = moves("farmGerm") or {}
    said = re.search(r"heated greenhouse benches at their fullest ([\d.,]+) → ([\d.,]+) tray spaces", fg.get("text", ""))
    check("typing the farm's germination says the heated benches at their fullest, as Bench room counts them (every crop and live trays added up)", bool(said) and abs(float(said.group(1).replace(",", "")) - (peak or -1)) < 0.06, [peak, fg.get("text", "")[-160:]])
    page.keyboard.press("Escape"); wait(300)
    sup = js("const own = (S.plan.lrfNext || {}).supplies || null, at = LRFNursery.POCKETS.includes(+(own || {}).pockets) ? +own.pockets : LRFNursery.POCKETS[0], other = at === 10 ? 15 : 10, n = x => (LRFNursery.supplies(S.engine, A.planYear(), x == null ? own : LRFNursery.setSupply(own, 'pockets', null, x)).rows.find(r => r.id === 'carrier') || { need: 0 }).need; return { other, a: n(null), b: n(other), plan: plan() };") or {}
    click(f'[data-hook="start-pockets"] [data-hook="start-side"][data-side="{sup.get("other")}"]', 600)
    pk = moves("pockets") or {}
    check("pressing the farm's other pots a carrier says what Supplies would count, before and after, and moves nothing yet", sup.get("a") != sup.get("b") and pk.get("would") and f"carrying trays Supplies counts at the most {sup.get('a')} → {sup.get('b')}; no bench room, date or seed moves" in pk.get("text", "") and js("return plan();") == sup.get("plan"), [sup.get("a"), sup.get("b"), pk])
    click('[data-hook="start-pockets"] ~ * [data-hook="start-use"], [data-hook="start-moves"][data-key="pockets"] [data-hook="start-use"]', 600)
    check("Use it sets the pots a carrier Supplies counts by, as one step, and one Undo takes it back", js("return plan();") != sup.get("plan") and js("return +((S.plan.lrfNext || {}).supplies || {}).pockets || 15;") == sup.get("other") and js("A.undo(); return plan();") == sup.get("plan"))

    # ── a crop not among My crops, opened by name: the list shows all crops, so its card is the one that opens ──
    other = js("const m = new Set(mine().map(c => c.id)); const c = S.engine.crops().find(c => !m.has(c.id) && !S.engine.isCoverCrop(c)); return c ? c.id : null;")
    click('[data-as-scope="mine"]', 400)
    js(f"LRFAssume.setMode('start', null, {json.dumps(other)}); return 1;"); wait(500)
    sc = js("return { crop: (cardEl() || { dataset: {} }).dataset.crop, all: (document.querySelector('[data-as-scope=\"all\"]') || {}).getAttribute('aria-pressed') };") or {}
    check("a crop not among My crops, opened by name, opens its own card, with All crops shown", bool(other) and sc.get("crop") == other and sc.get("all") == "true", [other, sc])

    # ── Seeds' Edit crop opens the card ──
    js("A.setView('seeds'); return 1;"); wait(700)
    want_id = js("const b = H('seeds-edit-crop').find(seen) || H('seeds-edit-crop')[0]; return b ? b.closest('[data-crop]').dataset.crop : null;")
    if want_id:
        try: page.locator('[data-hook="seeds-edit-crop"]').first.click(force=True, timeout=4000)
        except Exception: pass
        wait(700)
    ce = js("return { view: S.view, mode: LRFAssume.mode(), crop: (cardEl() || { dataset: {} }).dataset.crop };") or {}
    check("Edit crop on Seeds opens that crop's card on Starting and nursery", bool(want_id) and ce.get("view") == "assume" and ce.get("mode") == "start" and ce.get("crop") == want_id, [want_id, ce])

    # ── the farm with no spare set: said so, and a figure typed there is his, 10 too, with what it moves ──
    js("A.setView('assume'); LRFAssume.setMode('start'); return 1;"); wait(300)
    nb0 = js("const was = S.plan.settings, after = { ...was }; delete after.buffer; A.setStarting('no spare (check)', [{ kind: 'settings', before: was, after }]); return S.undo.length;")
    click('[data-hook="start-every"]', 500)
    nb = js("const c = cardEl(); return { text: c ? c.textContent : '', box: (document.querySelector('[data-hook=\"start-card\"] input[data-key=\"farmSpare\"]') || {}).value, row: (H('start-every')[0] || {}).textContent || '', figs: (H('start-figs')[0] || {}).textContent || '', comes: (H('start-comes', c)[0] || {}).textContent || '' };") or {}
    check("with no spare set, the Every crop row, the page's line of figures and the farm card say so, and none says 10% spare", all("10% spare" not in nb.get(k, "") and "spare 10%" not in nb.get(k, "") for k in ("row", "figs", "comes")) and all("not set" in nb.get(k, "") for k in ("row", "figs", "comes")), [nb.get("row"), nb.get("figs"), nb.get("comes")])
    # a sown crop with plantings bought in: with no farm spare they follow 0 and its sowings 10; 10 typed in its Spare is his
    if mixed:
        open_crop(mixed["id"])
        bb = js(f"const id = {json.dumps(mixed['id'])}, was = S.plan.crops.find(c => c.id === id) || null, e2 = A.engineAfter([{{ kind: 'crop', before: was, after: {{ ...(was || {{ id }}), spare: 10 }} }}]), buy = e => e.plan.plantings.filter(p => p.cropId === id).reduce((n, p) => n + ((e.calc(p) || {{}}).buy || 0), 0); return [buy(S.engine), buy(e2)];") or [0, 0]
        typing("spare", "10"); sm = moves("spare") or {}; page.keyboard.press("Enter"); wait(600)
        sp10 = js(f"return (S.plan.crops.find(c => c.id === {json.dumps(mixed['id'])}) || {{}}).spare;")
        check("with no farm spare, 10 typed in a crop's Spare is stored as his, its line saying its plants to buy before and after", bb[0] != bb[1] and f"{bb[0]:,} → {bb[1]:,}" in sm.get("text", "") and sp10 == 10, [bb, sm.get("text", "")[:300], sp10])
        js("A.undo(); return 1;"); wait(400)
        click('[data-hook="start-every"]', 500)
    else: check("with no farm spare, 10 typed in a crop's Spare is stored as his, its line saying its plants to buy before and after", False, "no crop with plantings bought in")
    typing("farmSpare", "10")
    nm = moves("farmSpare") or {}
    page.keyboard.press("Enter"); wait(700)
    nbuf = js("return S.plan.settings.buffer;")
    check("with no spare set for the farm the card says so (sowing 10%, plants bought in none); 10 typed there is taken as his, its line saying the plants to buy it moves", "not set" in nb.get("text", "") and nb.get("box") == "" and nm.get("would") and "plants to buy" in nm.get("text", "") and nbuf == 10, [nb.get("box"), nm, nbuf])
    while (js("return S.undo.length;") or 0) > (nb0 or 1) - 1: js("A.undo(); return 1;"); wait(300)

    # ── every control once more, and every field the card wrote: each is named in tests/plan_shape.cjs ──
    open_crop(many["id"])
    d0 = js("return S.undo.length;")
    for k, v in [("spare", "20"), ("days", "49"), ("spc", "3")]: typing(k, v); page.keyboard.press("Enter"); wait(500)
    vv = js(f"const v = S.engine.varietiesOf({json.dumps(many['id'])})[0]; return v ? v.id : null;")
    click(f'[data-hook="start-variety-own"][data-variety="{vv}"]', 400)
    for k, v in [(f"v|{vv}|days", "35"), (f"v|{vv}|spc", "2")]: typing(k, v); page.keyboard.press("Enter"); wait(500)
    tsel = js("const s = document.querySelector('[data-hook=\"start-tray\"]'); return s ? [...s.options].map(o => o.value).find(v => v !== s.value) : null;")
    if tsel: page.select_option('[data-hook="start-tray"]', tsel); wait(500); click('[data-hook="start-moves"][data-key="tray"] [data-hook="start-use"]', 600)
    click('[data-hook="start-as"] [data-hook="start-side"][data-side="direct"]', 500); click('[data-hook="start-moves"][data-key="started"] [data-hook="start-use"]', 600)
    open_crop(pot["id"]); typing("potUpWk", "21"); page.keyboard.press("Enter"); wait(500)
    open_crop(tw or ""); typing("rockwoolDays", "25"); page.keyboard.press("Enter"); wait(500)
    click('[data-hook="start-every"]', 500)
    for k, v in [("farmGerm", "80"), ("farmSpare", "12")]: typing(k, v); page.keyboard.press("Enter"); wait(500)
    written = js("""const paths = new Set();
      const walk = (a, b, at) => { if (b && typeof b === 'object' && !Array.isArray(b)) { const x = a && typeof a === 'object' ? a : {}; for (const k of new Set([...Object.keys(x), ...Object.keys(b)])) { if (JSON.stringify(x[k]) === JSON.stringify(b[k]) || b[k] === undefined) continue; walk(x[k], b[k], at + '.' + k); } } else paths.add(at); };
      for (const o of __w) { if (o.after == null || (o.kind === 'own' && o.key === 'facts')) continue; const base = { crop: 'crops[]', variety: 'varieties[]', settings: 'settings', assume: 'assumptions', own: 'lrfNext.' + o.key }[o.kind]; if (!base) { paths.add('(a step of kind ' + o.kind + ')'); continue; } if (o.kind === 'own' && (o.after === null || typeof o.after !== 'object')) { paths.add(base); continue; } walk(o.before, o.after, base); }
      return [...paths].sort();""") or []
    import subprocess
    shape = json.loads(subprocess.run(["node", "-e", "console.log(JSON.stringify(Object.keys(require(process.argv[1]).SHAPE)))", str(Path(__file__).resolve().parent / "plan_shape.cjs")], capture_output=True, text=True).stdout or "[]")
    pats = [re.compile("^" + re.escape(k).replace("\\*", "[^.]+") + "$") for k in shape]
    unnamed = [w for w in written if not any(pt.match(w) for pt in pats)]
    check(f"every field the card wrote while each of its controls was used ({len(written)} places) is named in tests/plan_shape.cjs", len(written) >= 15 and not unnamed, {"unnamed": unnamed, "written": written})
    while (js("return S.undo.length;") or 0) > (d0 or 0): js("A.undo(); return 1;"); wait(300)

    end = js("return { sig: sig() };") or {}
    check("after all of it, undone, no figure of any planting differs from before", end.get("sig") == before.get("sig"))
    check("no error on the page", not errors, errors[:3])
    finish()
